/**
 * 模拟账户的运行时：引擎 + 本地库 + 操作日志 + 补撮合。界面层只和它打交道。
 *
 * - 账户状态整行 JSON 存在 account 表；有事件（下单、成交、清算……）时立即保存，
 *   只是排队量之类的变化最多每 15 秒保存一次。
 * - 快照：自选、持仓、有未完成委托的证券，每个实时快照都存下来（M6 回放用；补撮合也用它定起点）。
 * - 补撮合（catchUp）：App 启动或从后台回来时，有未完成委托就用分时数据把中断的那段补上，再推进时间。
 *   必须在推进时间之前做，否则跨日时清算会先把委托撤掉。
 */
import type { Db } from '../data/db';
import { rebalances } from '../portfolio/repo';
import { recordStockDay } from '../portfolio/datacenter';
import * as repo from '../data/repos';
import { isLive, newAccount } from '../engine/account';
import { TradingCalendar, type DateStr } from '../engine/calendar';
import { DEFAULT_FEE_PROFILE, type FeeProfile } from '../engine/fees';
import {
  checkTransfer,
  type TransferCheck,
  type TransferDir,
} from '../engine/funds';
import {
  Engine,
  type Now,
  type OrderCheck,
  type PlaceResult,
  type SimpleResult,
} from '../engine/engine';
import {
  invalidRisk,
  riskOf,
  riskText,
  type RiskLimits,
} from '../engine/risk';
import { classify, isSTName, type Security } from '../engine/securities';
import { AFTER_END, AFTER_START, CLOSE, T, type Sec } from '../engine/session';
import type { EngineEvent, Snapshot } from '../engine/types';
import { formatFen, type Fen } from '../engine/units';
import type { OrderRequest } from '../engine/validate';
import { beijingIso, beijingNow } from '../market/clock';
import type { MarketClient } from '../market/client';
import { baseFromPrevClose, gapSnapshots, mergeByTime } from '../market/replay';
import type { Quote, QuoteInfo } from '../market/tencent';
import { describeEvent } from './describe';
import { feeDiff } from './feeForm';

/** 默认累计净入金上限 40 万（PRODUCT_DESIGN §6.3）。 */
export const DEFAULT_DEPOSIT_CAP: Fen = 40_000_000;

const SAVE_INTERVAL_MS = 15_000;

/** 日期优先，避免跨交易日时只比较当天秒数。 */
const compareQuoteTime = (a: Snapshot, b: Snapshot) =>
  a.date.localeCompare(b.date) || a.t - b.t;

export interface CatchUpReport {
  /** 补了哪些日期、几只证券、喂了多少个补出来的快照。 */
  dates: DateStr[];
  codes: string[];
  snapshots: number;
  events: EngineEvent[];
  /** 超过 5 个交易日没打开，有的日期补不了。 */
  missed: DateStr[];
}

export type Listener = (events: EngineEvent[]) => void;

export class Simulator {
  engine: Engine;
  private securities = new Map<string, Security & { type: string }>();
  private infos = new Map<string, QuoteInfo>();
  /** 每只代码（含指数）最新一次的行情，界面显示用。 */
  private quotes = new Map<string, Quote>();
  private quoteTimes = new Map<string, number>();
  private quoteListeners = new Set<() => void>();
  private quoteWatermarks = new Map<string, Snapshot | null>();
  private ingesting: Promise<void> = Promise.resolve();
  private watch = new Set<string>();
  private pendingPortfolio: { code: string; date: string }[] = [];
  private dirty = false;
  private lastSave = 0;
  private listeners = new Set<Listener>();
  /** 盘后固定价格交易：每只证券已经喂到哪一分钟（code@date → 秒）。 */
  private afterFed = new Map<string, Sec>();

  private constructor(
    private db: Db,
    private client: MarketClient,
    private currentId: number,
    state: ReturnType<typeof newAccount>,
    readonly calendar: TradingCalendar,
    private clock: () => Now,
  ) {
    this.engine = new Engine(state, {
      calendar,
      security: code => this.securities.get(code) ?? null,
    });
  }

  /** 打开（第一次启动时新建）当前账户。 */
  static async open(
    db: Db,
    client: MarketClient,
    clock: () => Now = beijingNow,
  ): Promise<Simulator> {
    const nowIso = beijingIso();
    await repo.seedCalendar(db, nowIso);
    const years = await repo.calendarYears(db);
    const calendar = new TradingCalendar(years.flatMap(y => y.holidays));
    let acc = await repo.currentAccount(db);
    if (!acc) {
      const state = newAccount(clock().date, {
        fee: DEFAULT_FEE_PROFILE,
        depositCap: DEFAULT_DEPOSIT_CAP,
      });
      const id = await repo.createAccount(db, '模拟账户 1', state, nowIso);
      acc = { id, name: '模拟账户 1', state, createdAt: nowIso };
    }
    const sim = new Simulator(db, client, acc.id, acc.state, calendar, clock);
    for (const s of await repo.allSecurities(db)) {
      sim.rememberSecurity(s.code, s.name, s.type);
    }
    for (const c of await repo.watchlist(db)) {
      sim.watch.add(c);
    }
    sim.engine.setCorporateActions(await repo.corporateActions(db));
    await sim.syncPortfolioCodes(db);
    return sim;
  }

  /** 交易和行情共用串行队列，批量调仓期间不插入单笔操作。 */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.ingesting.then(work);
    this.ingesting = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** 引擎副本、账户、调仓记录、事件同事务提交，写库失败不发布内存状态。 */
  transact<T>(
    work: (engine: Engine, tx: Db, events: EngineEvent[]) => Promise<T>,
  ): Promise<T> {
    return this.serial(async () => {
      const engine = this.engine.fork();
      const events = engine.advance(this.clock());
      const now = beijingIso();
      const result = await this.db.transaction(async tx => {
        const value = await work(engine, tx, events);
        await repo.saveAccountState(tx, this.accountId, engine.state, now);
        await this.writeEvents(tx, events, engine.state.date, now);
        return value;
      });
      this.engine = engine;
      await this.syncPortfolioCodes(this.db);
      this.dirty = false;
      this.listeners.forEach(fn => fn(events));
      return result;
    });
  }

  private async writeEvents(
    tx: Db,
    events: EngineEvent[],
    date: string,
    ts: string,
  ): Promise<void> {
    for (const e of events) {
      const eventDate =
        'fill' in e
          ? e.fill.date
          : 'order' in e
          ? e.order.date
          : 'date' in e
          ? e.date
          : date;
      await tx.run(
        'INSERT INTO account_event(account_id,trade_date,ts,type,body) VALUES (?,?,?,?,?)',
        [this.accountId, eventDate, ts, e.type, JSON.stringify(e)],
      );
      const d = describeEvent(e, c => this.securities.get(c) ?? null);
      if (d) {
        await repo.logActivity(tx, {
          accountId: this.accountId,
          tradeDate: eventDate,
          ts,
          ...d,
        });
      }
    }
  }

  private async syncPortfolioCodes(db: Db): Promise<void> {
    this.pendingPortfolio = (await rebalances(db, this.accountId))
      .filter(r => r.status === 'executing')
      .flatMap(r =>
        r.plan.rows
          .filter(
            row =>
              row.request?.side === 'B' &&
              (r.attempts[row.code] ?? 0) < 2 &&
              ((r.attempts[row.code] ?? 0) === 0 ||
                r.strategy.retry === 'once'),
          )
          .map(row => ({ code: row.code, date: r.executionDate })),
      );
  }

  // ---------- 查询 ----------

  /** 当前账户的 id；重置账户后换成新账户的。 */
  get accountId(): number {
    return this.currentId;
  }

  security(code: string): (Security & { type: string }) | null {
    return this.securities.get(code) ?? null;
  }

  info(code: string): QuoteInfo | null {
    return this.infos.get(code) ?? null;
  }

  /** 最新行情（快照 + 显示字段）。指数不进引擎，只能从这里拿。 */
  quote(code: string): Quote | null {
    return this.quotes.get(code) ?? null;
  }

  /** 最近收到有效（含完全相同）报价的时间；倒退报价不会刷新这个时间。 */
  quoteReceivedAt(code: string): number {
    return this.quoteTimes.get(code) ?? 0;
  }

  subscribeQuotes(fn: () => void): () => void {
    this.quoteListeners.add(fn);
    return () => this.quoteListeners.delete(fn);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 有未完成委托的证券。 */
  liveOrderCodes(): string[] {
    return [
      ...new Set(this.engine.state.orders.filter(isLive).map(o => o.code)),
    ];
  }

  /** 今天就可能成交的委托所在的证券（不含等到下一交易日才报送的预埋单），后台跟踪只看它们。 */
  activeOrderCodes(today: DateStr): string[] {
    return [
      ...new Set([
        ...this.pendingPortfolio.filter(p => p.date === today).map(p => p.code),
        ...this.engine.state.orders
          .filter(
            o =>
              isLive(o) &&
              !(
                o.status === '未报' &&
                o.sendDate != null &&
                o.sendDate > today
              ),
          )
          .map(o => o.code),
      ]),
    ];
  }

  /** 有盘后固定价格委托在等成交的证券。 */
  afterOrderCodes(): string[] {
    return [
      ...new Set(
        this.engine.state.orders
          .filter(o => isLive(o) && o.stage === 'after')
          .map(o => o.code),
      ),
    ];
  }

  heldCodes(): string[] {
    return [...new Set(this.engine.state.lots.map(l => l.code))];
  }

  /** 要存快照的证券：自选 + 持仓 + 有未完成委托。 */
  recordedCodes(): Set<string> {
    return new Set([
      ...this.watch,
      ...this.pendingPortfolio.map(p => p.code),
      ...this.heldCodes(),
      ...this.liveOrderCodes(),
    ]);
  }

  setWatchlist(codes: string[]): void {
    this.watch = new Set(codes);
  }

  // ---------- 行情 ----------

  private rememberSecurity(code: string, name: string, type: string): void {
    const c = classify(code, type);
    if (!c) {
      return;
    }
    this.securities.set(code, { code, name, type, ...c, st: isSTName(name) });
  }

  /** 喂入一批实时行情：更新证券信息、撮合、存快照。 */
  ingest(quotes: Quote[]): Promise<EngineEvent[]> {
    // AI 查询与轮询可能同时返回；把校验、撮合和写库作为同一段串行操作。
    const work = this.ingesting.then(() => this.ingestBatch(quotes));
    this.ingesting = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  }

  private async ingestBatch(quotes: Quote[]): Promise<EngineEvent[]> {
    const nowIso = beijingIso();
    const recorded = this.recordedCodes();
    const events: EngineEvent[] = [];
    let changed = false,
      fed = false;
    const sorted = [...quotes].sort((a, b) =>
      compareQuoteTime(a.snapshot, b.snapshot),
    );
    for (const q of sorted) {
      const { snapshot: s, info } = q;
      const previous = this.quotes.get(s.code);
      if (!this.quoteWatermarks.has(s.code)) {
        this.quoteWatermarks.set(
          s.code,
          recorded.has(s.code)
            ? await repo.latestSnapshot(this.db, s.code)
            : null,
        );
      }
      const baseline = [
        previous?.snapshot,
        this.engine.snapshot(s.code),
        this.quoteWatermarks.get(s.code),
      ]
        .filter((x): x is Snapshot => !!x)
        .sort(compareQuoteTime)
        .at(-1);
      if (baseline && compareQuoteTime(s, baseline) < 0) {
        continue;
      }
      this.quoteTimes.set(s.code, Date.now());
      if (previous && JSON.stringify(previous) === JSON.stringify(q)) {
        continue;
      }
      const snapshotChanged =
        !previous || JSON.stringify(previous.snapshot) !== JSON.stringify(s);
      const known = this.securities.get(s.code);
      if (
        info.type !== 'ZS' &&
        (!known || known.name !== info.name || known.type !== info.type)
      ) {
        await repo.upsertSecurity(
          this.db,
          { code: s.code, name: info.name, type: info.type, pinyin: '' },
          nowIso,
        );
        this.rememberSecurity(s.code, info.name, info.type);
      }
      // 先落库再发布缓存；写库失败时下次相同响应仍可重试。
      if (
        snapshotChanged &&
        recorded.has(s.code) &&
        this.securities.has(s.code)
      ) {
        await repo.saveSnapshot(this.db, s);
      }
      if (snapshotChanged && this.securities.has(s.code)) {
        await recordStockDay(this.db, s, info.name, info.type);
      }
      this.infos.set(s.code, info);
      this.quotes.set(s.code, q);
      this.quoteWatermarks.set(s.code, s);
      changed = true;
      if (!snapshotChanged || !this.securities.has(s.code)) {
        continue; // 指数只显示；仅元数据变化不重复撮合
      }
      // 15:05 以后腾讯快照的成交量不再变化（不含盘后固定价格交易），有盘后委托的证券改用分时数据，
      // 见 ingestAfterHours；这时的实时快照不喂引擎，否则成交量会在两种来源之间来回跳
      if (!(s.t >= AFTER_START && this.afterOrderCodes().includes(s.code))) {
        events.push(...this.engine.onSnapshot(s));
        fed = true;
      }
    }
    if (fed && this.liveOrderCodes().length) {
      this.dirty = true;
    }
    if (changed) {
      await this.commit(events);
      this.quoteListeners.forEach(fn => fn());
    }
    return events;
  }

  /** 没有行情时推进时间：报送暂存委托、15:30 清算、跨日。 */
  tick(): Promise<EngineEvent[]> {
    return this.serial(() => this.tickNow());
  }

  private async tickNow(): Promise<EngineEvent[]> {
    const events = this.engine.advance(this.clock());
    await this.commit(events);
    return events;
  }

  // ---------- 交易和资金 ----------

  /** 下单前预检（下单页实时显示校验结果）：和 placeOrder 同一套校验，不改状态。 */
  checkOrder(req: OrderRequest): OrderCheck {
    return this.engine.check(this.clock(), req);
  }

  /** 引擎时钟（北京时间）。界面判断时段也用它，测试里可以注入。 */
  now(): Now {
    return this.clock();
  }

  placeOrder(req: OrderRequest): Promise<PlaceResult> {
    return this.serial(() => this.placeOrderNow(req));
  }

  private async placeOrderNow(req: OrderRequest): Promise<PlaceResult> {
    const r = this.engine.placeOrder(this.clock(), req);
    if (!r.ok) {
      // 券商拦下的委托不生成委托记录，但要记进操作日志（AI 回答「刚才为什么下不了单」）
      const sec = this.securities.get(req.code);
      await repo.logActivity(this.db, {
        accountId: this.accountId,
        tradeDate: this.engine.state.date,
        ts: beijingIso(),
        kind: 'reject',
        text:
          (req.side === 'B' ? '买入 ' : '卖出 ') +
          (sec?.name ?? req.code) +
          ' 被拦下：' +
          r.msg,
        ref: { rule: r.rule },
      });
    }
    await this.commit(r.events, true);
    return r;
  }

  cancelOrder(id: number): Promise<SimpleResult> {
    return this.serial(() => this.cancelOrderNow(id));
  }

  private async cancelOrderNow(id: number): Promise<SimpleResult> {
    const r = this.engine.cancelOrder(this.clock(), id);
    await this.commit(r.events, true);
    return r;
  }

  deposit(fen: Fen): Promise<SimpleResult> {
    return this.serial(() => this.depositNow(fen));
  }

  private async depositNow(fen: Fen): Promise<SimpleResult> {
    const r = this.engine.deposit(this.clock(), fen);
    if (r.ok) {
      await this.logTransfer('银行转证券 ' + (fen / 100).toFixed(2) + ' 元');
    }
    await this.commit(r.events, r.ok);
    return r;
  }

  withdraw(fen: Fen): Promise<SimpleResult> {
    return this.serial(() => this.withdrawNow(fen));
  }

  private async withdrawNow(fen: Fen): Promise<SimpleResult> {
    const r = this.engine.withdraw(this.clock(), fen);
    if (r.ok) {
      await this.logTransfer('证券转银行 ' + (fen / 100).toFixed(2) + ' 元');
    }
    await this.commit(r.events, r.ok);
    return r;
  }

  /** 银证转账前的检查（金额、转账时间、上限、可取），转账页实时显示用。 */
  checkTransfer(dir: TransferDir, fen: Fen): TransferCheck {
    return checkTransfer(
      this.engine.state,
      this.calendar,
      this.clock(),
      dir,
      fen,
    );
  }

  /**
   * 银证转账（转账页）：先按转账时间等规则检查，再入金 / 出金。被拦下的记进操作日志（kind reject），
   * AI 能回答「刚才为什么转不了」。调试页的 deposit 不查转账时间。
   */
  async transfer(dir: TransferDir, fen: Fen): Promise<SimpleResult> {
    const c = this.checkTransfer(dir, fen);
    if (!c.ok) {
      await this.log(
        'reject',
        (dir === 'in' ? '银行转证券 ' : '证券转银行 ') +
          formatFen(Math.max(0, fen)) +
          ' 元被拦下：' +
          c.msg,
        { rule: c.rule },
      );
      return { ok: false, msg: c.msg, events: [] };
    }
    return dir === 'in' ? this.deposit(fen) : this.withdraw(fen);
  }

  private async logTransfer(text: string): Promise<void> {
    await this.log('transfer', text);
  }

  private async log(
    kind: repo.ActivityKind,
    text: string,
    ref: Record<string, unknown> | null = null,
  ): Promise<void> {
    await repo.logActivity(this.db, {
      accountId: this.currentId,
      tradeDate: this.engine.state.date,
      ts: beijingIso(),
      kind,
      text,
      ref,
    });
  }

  /** 设置的修改记进操作日志（kind setting）。 */
  logSetting(text: string, ref: Record<string, unknown> | null = null) {
    return this.log('setting', text, ref);
  }

  // ---------- 费率和账户设置 ----------

  /**
   * 改费率：只对之后提交的委托生效（已有委托按各自提交时的费率）。why 写进操作日志，例如「按交割单校准」。
   * 没有变化时返回空数组，不记日志。
   */
  setFeeProfile(profile: FeeProfile, why = '修改费率'): Promise<string[]> {
    return this.serial(() => this.setFeeProfileNow(profile, why));
  }

  private async setFeeProfileNow(
    profile: FeeProfile,
    why: string,
  ): Promise<string[]> {
    const diff = feeDiff(this.engine.state.fee, profile);
    if (!diff.length) {
      return diff;
    }
    this.engine.setFeeProfile(profile);
    await this.logSetting(why + '：' + diff.join('，'), { setting: 'fee' });
    await this.commit([], true);
    this.listeners.forEach(fn => fn([]));
    return diff;
  }

  /** 改累计净入金上限（范围由设置页校验，见 sim/settings.ts）。 */
  setDepositCap(fen: Fen): Promise<void> {
    return this.serial(() => this.setDepositCapNow(fen));
  }

  private async setDepositCapNow(fen: Fen): Promise<void> {
    const old = this.engine.state.depositCap;
    if (fen === old) {
      return;
    }
    this.engine.setDepositCap(fen);
    await this.logSetting(
      '累计净入金上限 ' + formatFen(old) + ' → ' + formatFen(fen) + ' 元',
      { setting: 'depositCap' },
    );
    await this.commit([], true);
    this.listeners.forEach(fn => fn([]));
  }

  setRiskLimits(r: RiskLimits): Promise<void> {
    return this.serial(() => this.setRiskLimitsNow(r));
  }

  private async setRiskLimitsNow(r: RiskLimits): Promise<void> {
    const err = invalidRisk(r);
    if (err) {
      throw new Error(err);
    }
    const old = riskText(riskOf(this.engine.state));
    this.engine.setRiskLimits(r);
    await this.logSetting('风险限额 ' + old + ' → ' + riskText(r), {
      setting: 'risk',
    });
    await this.commit([], true);
    this.listeners.forEach(fn => fn([]));
  }

  /**
   * 重置账户：旧账户（状态、委托、交割单、操作日志）原样归档、只读，未完成委托随旧账户归档、不再撮合。
   * 新账户从 0 元开始，沿用当前的费率设置和入金上限（这两项是「你的券商」的设置）。返回旧账户和新账户的 id。
   */
  resetAccount(): Promise<{ archived: number; current: number }> {
    return this.serial(() => this.resetAccountNow());
  }

  private async resetAccountNow(): Promise<{
    archived: number;
    current: number;
  }> {
    const nowIso = beijingIso();
    const old = this.engine.state;
    const oldId = this.currentId;
    const state = newAccount(this.clock().date, {
      fee: old.fee,
      depositCap: old.depositCap,
    });
    if (old.risk) {
      state.risk = { ...old.risk };
    }
    let newId = 0;
    // 旧账户里没完成的委托不再撮合：状态原样保留，说明改掉（否则还写着「9:15 报送」）
    for (const o of old.orders.filter(isLive)) {
      o.note = '随账户归档，不再撮合';
    }
    await this.db.transaction(async tx => {
      await repo.saveAccountState(tx, oldId, old, nowIso);
      await repo.archiveAccount(tx, oldId, nowIso);
      const n = (await repo.allAccounts(tx)).length;
      newId = await repo.createAccount(
        tx,
        '模拟账户 ' + (n + 1),
        state,
        nowIso,
      );
      await repo.logActivity(tx, {
        accountId: oldId,
        tradeDate: old.date,
        ts: nowIso,
        kind: 'setting',
        text: '重置账户：这个账户已归档',
        ref: { setting: 'reset', next: newId },
      });
      await repo.logActivity(tx, {
        accountId: newId,
        tradeDate: state.date,
        ts: nowIso,
        kind: 'setting',
        text: '重置账户：旧账户已归档（可在「历史账户」查看），新账户从 0 元开始，沿用原来的费率和入金上限',
        ref: { setting: 'reset', archived: oldId },
      });
    });
    this.engine.state = state;
    this.currentId = newId;
    this.pendingPortfolio = [];
    this.afterFed.clear();
    this.dirty = false;
    this.listeners.forEach(fn => fn([]));
    return { archived: oldId, current: newId };
  }

  // ---------- 盘后固定价格交易 ----------

  /**
   * 15:05–15:30 用当日分时撮合盘后委托：腾讯快照的成交量收盘后就不变了，分时数据里 15:06–15:30 每分钟一个点，
   * 累计量包含盘后成交（2026-10-26 核对，见 TRADING_RULES.md §6.2）。只用已经走完的分钟。
   */
  ingestAfterHours(): Promise<EngineEvent[]> {
    return this.serial(() => this.ingestAfterHoursNow());
  }

  private async ingestAfterHoursNow(): Promise<EngineEvent[]> {
    const now = this.clock();
    if (now.t < AFTER_START || now.t > AFTER_END + 120) {
      return [];
    }
    const lists: Snapshot[][] = [];
    for (const code of this.afterOrderCodes()) {
      const sec = this.securities.get(code);
      const live =
        this.engine.snapshot(code) ??
        (await repo.lastSnapshot(this.db, code, now.date));
      if (!sec || !live || live.date !== now.date) {
        continue;
      }
      let day;
      try {
        day = await this.client.minute(code, sec.type);
      } catch {
        continue;
      }
      if (!day || day.date !== now.date) {
        continue;
      }
      const key = code + '@' + now.date;
      const fed = this.afterFed.get(key);
      // 只用委托之后完整的分钟：分时点 t 是 (t-60, t] 这一分钟的累计，委托前的盘后成交不能算给它
      const placedAt = Math.min(
        ...this.engine.state.orders
          .filter(o => o.code === code && isLive(o) && o.stage === 'after')
          .map(o => (o.date === now.date ? o.t : CLOSE)),
      );
      const start = Math.max(fed ?? CLOSE, live.t, placedAt);
      const all = gapSnapshots(code, day, live, {
        from: CLOSE - 60,
        to: now.t,
      });
      const feed = all.filter(x => x.t >= start + 60);
      if (fed == null) {
        // 第一次：用委托前最后一个分钟点做比较基准
        const before = all.filter(x => x.t < start + 60 && x.t > live.t);
        if (before.length) {
          this.engine.primeSnapshot(before[before.length - 1]);
        }
      }
      if (feed.length) {
        this.afterFed.set(key, feed[feed.length - 1].t);
        lists.push(feed);
      }
    }
    const events: EngineEvent[] = [];
    for (const s of mergeByTime(lists)) {
      events.push(...this.engine.onSnapshot(s));
    }
    await this.commit(events);
    return events;
  }

  // ---------- 补撮合 ----------

  /**
   * App 启动或从后台回来时调用：有未完成委托就用分时数据补上中断的那段，然后推进到现在。
   * 网络失败时不补，直接推进（宁可少成交）。
   */
  catchUp(): Promise<CatchUpReport> {
    const work = this.ingesting.then(() => this.catchUpBatch());
    this.ingesting = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  }

  private async catchUpBatch(): Promise<CatchUpReport> {
    const now = this.clock();
    const report: CatchUpReport = {
      dates: [],
      codes: [],
      snapshots: 0,
      events: [],
      missed: [],
    };
    const state = this.engine.state;
    const codes = this.liveOrderCodes();
    // 要补的交易日：没清算的当前日期（或下一个交易日）到今天
    const first = !this.calendar.isTradingDay(state.date)
      ? this.calendar.onOrAfter(state.date)
      : state.settled
      ? this.calendar.next(state.date)
      : state.date;
    const dates: DateStr[] = [];
    for (let d = first; d <= now.date; d = this.calendar.next(d)) {
      dates.push(d);
    }
    if (codes.length && dates.length) {
      const lists: Snapshot[][] = [];
      for (const code of codes) {
        const sec = this.securities.get(code);
        if (!sec) {
          continue;
        }
        let days;
        try {
          days = await this.client.minuteDays(code, sec.type);
        } catch {
          continue;
        }
        report.codes.push(code);
        for (const d of dates) {
          const day = days.find(x => x.date === d);
          if (!day) {
            if (d < now.date && !report.missed.includes(d)) {
              report.missed.push(d);
            }
            continue;
          }
          const live = await repo.lastSnapshot(this.db, code, d);
          if (live) {
            this.engine.primeSnapshot(live);
          }
          const prevClose = live?.prevClose ?? day.prevClose;
          if (prevClose == null) {
            continue;
          }
          const base = live
            ? {
                prevClose,
                up: live.up,
                down: live.down,
                open: live.open,
                high: live.high,
                low: live.low,
              }
            : baseFromPrevClose(sec, prevClose);
          const to = d < now.date ? T(24, 0) : now.t;
          lists.push(gapSnapshots(code, day, base, { from: live?.t ?? 0, to }));
          if (!report.dates.includes(d)) {
            report.dates.push(d);
          }
        }
      }
      for (const s of mergeByTime(lists)) {
        report.events.push(...this.engine.onSnapshot(s));
        report.snapshots++;
      }
      if (report.missed.length) {
        report.events.push({
          type: 'warning',
          message:
            report.missed.join('、') +
            ' 没有分时数据（超过 5 个交易日没打开），这几天的委托没法补撮合，按未成交处理',
        });
      }
    }
    report.events.push(...this.engine.advance(now));
    if (report.snapshots > 0) {
      report.events.unshift({
        type: 'warning',
        message:
          '后台跟踪中断过，已用分时数据补撮合（' +
          report.dates.join('、') +
          '，' +
          report.codes.length +
          ' 只）：只按成交价穿过委托价判断，排队部分不补',
      });
    }
    await this.commit(report.events, true);
    if (report.snapshots) {
      this.quoteListeners.forEach(fn => fn());
    }
    return report;
  }

  /** 拉持仓股的分红送配（每天一次），交给引擎处理除权除息。 */
  async refreshCorporateActions(): Promise<void> {
    const today = this.clock().date;
    const done = await repo.getSetting<string>(
      this.db,
      'corpActionsFetched',
      '',
    );
    if (done === today) {
      return;
    }
    const nowIso = beijingIso();
    for (const code of this.heldCodes()) {
      try {
        await repo.saveCorporateActions(
          this.db,
          await this.client.corporateActions(code),
          nowIso,
        );
      } catch {
        return; // 网络不好时下次再拉
      }
    }
    this.engine.setCorporateActions(await repo.corporateActions(this.db));
    await repo.setSetting(this.db, 'corpActionsFetched', today);
  }

  // ---------- 保存 ----------

  private async commit(events: EngineEvent[], force = false): Promise<void> {
    const nowMs = Date.now();
    if (
      events.length ||
      force ||
      (this.dirty && nowMs - this.lastSave > SAVE_INTERVAL_MS)
    ) {
      const nowIso = beijingIso(nowMs);
      const state = this.engine.state;
      await this.db.transaction(async tx => {
        await repo.saveAccountState(tx, this.accountId, state, nowIso);
        await this.writeEvents(tx, events, state.date, nowIso);
      });
      this.dirty = false;
      this.lastSave = nowMs;
    }
    if (events.length) {
      this.listeners.forEach(fn => fn(events));
    }
  }
}
