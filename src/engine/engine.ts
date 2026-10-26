/**
 * 模拟交易引擎：账户、委托、撮合、清算。
 *
 * 引擎不读系统时钟：时间（Now）和行情（Snapshot）都由外部喂进来，所以实时模拟和回放用同一套代码。
 * 状态（AccountState）是纯数据，可以直接存进 SQLite；快照缓存是临时的，不需要持久化。
 */
import { holdingOf, isLive, available, withdrawable } from './account';
import type { DateStr, TradingCalendar } from './calendar';
import {
  buyFreeze,
  divTaxRate,
  fillFee,
  ZERO_FEE,
  type FeeProfile,
} from './fees';
import { checkTransfer, type TransferDir } from './funds';
import {
  Liquidity,
  queueAheadAt,
  UNKNOWN_QUEUE,
  resolveAuction,
  stepResting,
  walkBook,
  liquidityWithin,
  ownLevels,
  oppositeLevels,
  type FillPlan,
} from './matching';
import { ruleOf, type Security } from './securities';
import {
  CLOSE,
  OPEN_AUCTION_END,
  PHASES,
  phaseAt,
  storedSendTime,
  AFTER_START,
  AFTER_END,
  SETTLE_TIME,
  T,
  type Phase,
  type Sec,
} from './session';
import type {
  AccountState,
  CorporateAction,
  EngineEvent,
  Fill,
  LedgerBiz,
  LedgerEntry,
  Order,
  Snapshot,
} from './types';
import { amountFen, type Fen } from './units';
import {
  checkCage,
  checkPriceLimit,
  freezePriceOf,
  validateOrder,
  type OrderRequest,
  type Validation,
} from './validate';

export interface Now {
  date: DateStr;
  t: Sec;
}

export interface EngineDeps {
  calendar: TradingCalendar;
  security: (code: string) => Security | null;
}

export type PlaceResult =
  | { ok: true; order: Order; events: EngineEvent[] }
  | {
      ok: false;
      rule: string;
      msg: string;
      lesson?: string;
      events: EngineEvent[];
    };

/** 下单前的预检（界面实时显示校验结果用），和 placeOrder 用同一套校验，但不改任何状态。 */
export type OrderCheck = Validation & {
  phase: Phase;
  /** 普通委托提交后怎么走：暂存 / 集合竞价 / 连续竞价 / 下一交易日 / 盘后。 */
  route: 'store' | 'auction' | 'continuous' | 'nextDay' | 'after';
};

export type SimpleResult =
  | { ok: true; events: EngineEvent[] }
  | { ok: false; msg: string; lesson?: string; events: EngineEvent[] };

const END_OF_DAY = T(24, 0);
const DAY_CANCEL_REASON = '当日有效，收盘后未成交部分由系统撤销';

export class Engine {
  private snaps = new Map<string, Snapshot>();
  private prevSnaps = new Map<string, Snapshot>();
  private liq = new Map<string, Liquidity>();
  /** 开盘集合竞价成交量（9:25–9:30 之间的第一个快照的累计量）。 */
  private openVolume = new Map<string, number>();
  /** 14:57 前最后一个快照的累计量，用来算收盘集合竞价成交量。 */
  private preCloseVolume = new Map<string, number>();
  private actions: CorporateAction[] = [];
  private events: EngineEvent[] = [];

  constructor(public state: AccountState, private deps: EngineDeps) {}

  // ---------- 查询 ----------

  snapshot(code: string): Snapshot | null {
    return this.snaps.get(code) ?? null;
  }

  lastPrice(code: string): number | null {
    const s = this.snaps.get(code);
    return s ? s.last ?? s.prevClose : null;
  }

  holding(code: string) {
    return holdingOf(this.state, code);
  }

  /**
   * 只记下快照、不撮合也不推进时间。App 重启后用本地存的最后一个快照做「上一个快照」，
   * 之后补撮合（分时数据）和实时快照才有比较的基准。
   */
  primeSnapshot(snap: Snapshot): void {
    this.snaps.set(snap.code, snap);
    this.prevSnaps.set(snap.code, snap);
  }

  setCorporateActions(actions: CorporateAction[]): void {
    this.actions = actions
      .slice()
      .sort((a, b) => (a.exDate < b.exDate ? -1 : 1));
  }

  // ---------- 时间推进 ----------

  /** 把引擎时间推进到 now：报送暂存委托、日终清算、跨日处理（扣红利税、除权除息）。 */
  advance(now: Now): EngineEvent[] {
    this.events = [];
    this.advanceTo(now);
    return this.flush();
  }

  private flush(): EngineEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private advanceTo(now: Now): void {
    const cal = this.deps.calendar;
    const s = this.state;
    if (now.date > s.date) {
      if (cal.isTradingDay(s.date) && !s.settled) {
        this.runDay(s.date, END_OF_DAY);
        this.settle();
      }
      for (const d of cal.between(s.date, now.date)) {
        this.openDay(d);
        if (d < now.date) {
          this.runDay(d, END_OF_DAY);
          this.settle();
        }
      }
    }
    if (s.date === now.date && cal.isTradingDay(now.date) && !s.settled) {
      this.runDay(now.date, now.t);
      if (now.t >= SETTLE_TIME) {
        this.settle();
      }
    }
  }

  /** 交易日开始：扣上一交易日卖出产生的红利税、处理除权除息、发放到账的红利。 */
  private openDay(d: DateStr): void {
    const s = this.state;
    s.date = d;
    s.settled = false;
    for (const p of s.pendingDivTax.filter(x => x.sellDate < d)) {
      s.cash -= p.amount;
      if (s.costs[p.code]) {
        s.costs[p.code].diluted += p.amount;
      }
      this.ledger(d, T(8, 0), '股息红利税补', p.code, 0, 0, 0, -p.amount, {
        divTax: p.amount,
        note: p.notes.join('；'),
      });
      this.events.push({
        type: 'divTax',
        date: d,
        amount: p.amount,
        code: p.code,
      });
    }
    s.pendingDivTax = s.pendingDivTax.filter(x => x.sellDate >= d);
    for (const a of this.actions) {
      const key = a.code + '@' + a.exDate;
      if (a.exDate <= d && !s.appliedActions.includes(key)) {
        this.applyAction(a, key);
      }
    }
    for (const p of s.pendingDividends.filter(x => x.payDate <= d)) {
      s.cash += p.amount;
      if (s.costs[p.code]) {
        s.costs[p.code].diluted -= p.amount;
      }
      this.ledger(d, T(8, 0), '股息入账', p.code, 0, 0, p.amount, p.amount, {
        note: '派息时不扣税，卖出时按持股期限补扣',
      });
      this.events.push({
        type: 'dividend',
        date: d,
        amount: p.amount,
        code: p.code,
      });
    }
    s.pendingDividends = s.pendingDividends.filter(x => x.payDate > d);
  }

  /** 除权除息：股权登记日收盘时持有的股份享有权益。 */
  private applyAction(a: CorporateAction, key: string): void {
    const s = this.state;
    s.appliedActions.push(key);
    const lots = s.lots.filter(
      l => l.code === a.code && l.buyDate <= a.recordDate,
    );
    const total = lots.reduce((n, l) => n + l.qty, 0);
    if (!total) {
      return;
    }
    if (a.cashPerShareLi > 0) {
      const cash = amountFen(a.cashPerShareLi, total);
      // 按股数分到各批次（红利税按批次先进先出），尾差给第一批
      let given = 0;
      lots.forEach((l, i) => {
        const share =
          i === lots.length - 1
            ? cash - given
            : Math.floor((cash * l.qty) / total);
        l.dividend += share;
        given += share;
      });
      // 发放日到了由 openDay 统一入账（沪深 A 股的发放日通常就是除息日）
      s.pendingDividends.push({
        code: a.code,
        payDate: a.payDate,
        amount: cash,
        action: key,
      });
    }
    if (a.bonusPerShare > 0) {
      // ⚠️ 零碎股按中国结算规则处理，这里先按账户合计向下取整
      const add = Math.floor(total * a.bonusPerShare + 1e-9);
      let given = 0;
      lots.forEach((l, i) => {
        const share =
          i === lots.length - 1
            ? add - given
            : Math.floor((add * l.qty) / total);
        l.qty += share;
        given += share;
      });
      this.ledger(s.date, T(8, 0), '红股入账', a.code, 0, add, 0, 0, {
        note: '每股送转 ' + a.bonusPerShare + ' 股，持股期限沿用原持股',
      });
      this.events.push({ type: 'bonus', date: s.date, qty: add, code: a.code });
    }
  }

  /** 处理当天到 t 为止的定时事件：报送券商暂存的委托。 */
  private runDay(d: DateStr, t: Sec): void {
    const due = this.state.orders
      .filter(
        o =>
          o.stage === 'stored' &&
          o.status === '未报' &&
          o.sendDate != null &&
          o.sendAt != null &&
          (o.sendDate < d || (o.sendDate === d && o.sendAt <= t)),
      )
      .sort((a, b) => a.sendAt! - b.sendAt! || a.id - b.id);
    for (const o of due) {
      this.send(o, d);
    }
  }

  private todaySnap(
    code: string,
    d: DateStr = this.state.date,
  ): Snapshot | null {
    const s = this.snaps.get(code);
    return s && s.date === d ? s : null;
  }

  /** 券商把暂存委托报送交易所。 */
  private send(o: Order, d: DateStr): void {
    const sec = this.sec(o.code);
    const snap = this.todaySnap(o.code, d);
    o.status = '已报';
    if (o.sendAt === T(9, 15)) {
      if (o.price != null && snap) {
        const lim = checkPriceLimit(sec, o.price, snap);
        if (!lim.ok) {
          return this.reject(o, '交易所拒绝（涨跌幅限制）：' + lim.msg);
        }
      }
      o.stage = 'auction';
      o.auction = 'open';
      o.note = '已报送，参加开盘集合竞价';
      if (snap && snap.t >= OPEN_AUCTION_END && snap.open != null) {
        this.resolveAuctionFor(o, snap);
      }
      return;
    }
    o.stage = 'book';
    o.arrived = false;
    o.note = '已报送';
    if (snap && phaseAt(snap.t) === 'cont') {
      this.arrive(o, snap, o.sendAt!);
    }
  }

  /** 日终清算：撤销当日未成交委托，当日卖出回款变为可取。 */
  private settle(): void {
    const s = this.state;
    let n = 0;
    for (const o of s.orders) {
      const waitingFuture =
        o.status === '未报' && o.sendDate != null && o.sendDate > s.date;
      if (isLive(o) && !waitingFuture) {
        this.finishCancel(o, DAY_CANCEL_REASON);
        n++;
      }
    }
    s.todaySellNet = 0;
    s.settled = true;
    this.events.push({ type: 'settle', date: s.date, canceled: n });
  }

  // ---------- 资金 ----------

  deposit(now: Now, fen: Fen): SimpleResult {
    this.events = [];
    this.advanceTo(now);
    const s = this.state;
    if (!(fen > 0)) {
      return { ok: false, msg: '请输入转入金额。', events: this.flush() };
    }
    if (s.depositTotal + fen > s.depositCap) {
      return {
        ok: false,
        msg:
          '累计净入金不能超过上限 ' + (s.depositCap / 100).toFixed(2) + ' 元。',
        events: this.flush(),
      };
    }
    s.cash += fen;
    s.depositTotal += fen;
    this.ledger(now.date, now.t, '银行转证券', null, 0, 0, fen, fen, {
      note: '模拟入金',
    });
    return { ok: true, events: this.flush() };
  }

  withdraw(now: Now, fen: Fen): SimpleResult {
    this.events = [];
    this.advanceTo(now);
    const s = this.state;
    if (!(fen > 0) || fen > withdrawable(s)) {
      return {
        ok: false,
        msg:
          '可取资金 ' +
          (withdrawable(s) / 100).toFixed(2) +
          ' 元。当天卖出的钱下一交易日才能转出。',
        events: this.flush(),
      };
    }
    s.cash -= fen;
    s.depositTotal -= fen;
    this.ledger(now.date, now.t, '证券转银行', null, 0, 0, fen, -fen, {
      note: '模拟出金',
    });
    return { ok: true, events: this.flush() };
  }

  /** 转账前的检查（金额、转账时间、上限、可取），界面实时显示用；deposit / withdraw 本身不查时间。 */
  checkTransfer(now: Now, dir: TransferDir, fen: Fen) {
    return checkTransfer(this.state, this.deps.calendar, now, dir, fen);
  }

  /** 改费率：只对之后提交的委托生效，已有委托按各自提交时的费率（Order.feeProfile）。 */
  setFeeProfile(profile: FeeProfile): void {
    this.state.fee = { ...profile };
  }

  /** 改累计净入金上限（范围由调用方校验）。 */
  setDepositCap(fen: Fen): void {
    this.state.depositCap = fen;
  }

  // ---------- 委托 ----------

  private sec(code: string): Security {
    const s = this.deps.security(code);
    if (!s) {
      throw new Error('unknown security ' + code);
    }
    return s;
  }

  private phaseOf(now: Now): Phase {
    return this.deps.calendar.isTradingDay(now.date) &&
      now.date === this.state.date
      ? phaseAt(now.t)
      : 'closed';
  }

  /** 下单前的预检：和 placeOrder 同一套校验，不推进时间、不生成委托。 */
  check(now: Now, req: OrderRequest): OrderCheck {
    const c = this.validateFor(now, req);
    return { ...c.v, phase: c.phase, route: c.route };
  }

  private validateFor(now: Now, req: OrderRequest) {
    const s = this.state;
    const sec = this.deps.security(req.code);
    const tradingDay = this.deps.calendar.isTradingDay(now.date);
    const phase = this.phaseOf(now);
    const route: OrderCheck['route'] =
      req.kind === 'after' ? 'after' : PHASES[phase].route;
    const snap = this.todaySnap(req.code, now.date);
    if (!sec) {
      const v: Validation = {
        ok: false,
        level: 'block',
        rule: '交易品种',
        msg: '暂不支持这个品种（V1 支持沪深主板、创业板、科创板和 ETF）。',
      };
      return { sec, v, phase, route, snap };
    }
    const h = holdingOf(s, req.code);
    let v = validateOrder(req, {
      sec,
      snap,
      phase,
      t: now.t,
      isTradingDay: tradingDay,
      available: available(s),
      sellable: h.sellable,
      fee: s.fee,
    });
    if ((v.ok || v.level !== 'block') && route === 'continuous' && !snap) {
      v = {
        ok: false,
        level: 'block',
        rule: '行情',
        msg: '暂时没有' + sec.name + '的行情，稍后再试。',
      };
    }
    return { sec, v, phase, route, snap };
  }

  placeOrder(now: Now, req: OrderRequest): PlaceResult {
    this.events = [];
    this.advanceTo(now);
    const s = this.state;
    const { sec, v, phase, route, snap } = this.validateFor(now, req);
    if (!sec || (!v.ok && v.level === 'block')) {
      const b = v as Extract<Validation, { ok: false }>;
      return {
        ok: false,
        rule: b.rule,
        msg: b.msg,
        lesson: b.lesson,
        events: this.flush(),
      };
    }
    const o: Order = {
      id: ++s.seq,
      no: String(100000 + s.seq),
      code: req.code,
      side: req.side,
      kind: req.kind,
      price: req.price,
      protect: req.kind === 'limit' ? null : req.protect ?? null,
      qty: req.qty,
      filled: 0,
      amount: 0,
      fee: { ...ZERO_FEE },
      status: '已报',
      stage: 'book',
      auction: null,
      date: now.date,
      t: now.t,
      sendDate: null,
      sendAt: null,
      arrived: false,
      queueAhead: 0,
      frozen: 0,
      feeProfile: { ...s.fee },
      reason: '',
      note: '',
      fills: [],
    };
    s.orders.unshift(o);
    if (!v.ok) {
      this.reject(o, '交易所拒绝（' + v.rule + '）：' + v.msg);
      return { ok: true, order: o, events: this.flush() };
    }
    if (o.side === 'B') {
      this.setFrozen(
        o,
        buyFreeze(sec, this.freezePrice(o, snap), o.qty, feeOf(o, s)),
      );
    }
    if (route === 'after') {
      o.stage = 'after';
      o.note = '15:05–15:30 按当日收盘价撮合';
    } else if (route === 'store') {
      o.status = '未报';
      o.stage = 'stored';
      o.sendDate = now.date;
      o.sendAt = storedSendTime(phase);
      o.note =
        phase === 'pre'
          ? '预埋单，9:15 报送参加开盘集合竞价'
          : '券商暂存，' + (phase === 'wait' ? '9:30' : '13:00') + ' 报送';
    } else if (route === 'nextDay') {
      o.status = '未报';
      o.stage = 'stored';
      o.sendDate = this.deps.calendar.next(now.date);
      o.sendAt = T(9, 15);
      o.note = '下一交易日（' + o.sendDate + '）9:15 报送';
    } else if (route === 'auction') {
      o.stage = 'auction';
      o.auction = phase === 'cauc' ? 'close' : 'open';
      o.note = '已进入' + (o.auction === 'open' ? '开盘' : '收盘') + '集合竞价';
    }
    this.events.push({ type: 'order', order: o });
    if (route === 'continuous') {
      this.arrive(o, snap!, now.t);
    }
    return { ok: true, order: o, events: this.flush() };
  }

  /** 买入冻结用的价格：见 freezePriceOf。 */
  private freezePrice(o: Order, snap: Snapshot | null): number {
    return freezePriceOf(o, snap);
  }

  private setFrozen(o: Order, fen: Fen): void {
    this.state.frozen += fen - o.frozen;
    o.frozen = fen;
  }

  cancelOrder(now: Now, id: number): SimpleResult {
    this.events = [];
    this.advanceTo(now);
    const o = this.state.orders.find(x => x.id === id);
    if (!o) {
      return { ok: false, msg: '找不到这笔委托。', events: this.flush() };
    }
    if (!isLive(o)) {
      return {
        ok: false,
        msg: '这笔委托已经' + o.status + '，不能撤单。',
        events: this.flush(),
      };
    }
    if (o.status !== '未报') {
      const phase = this.phaseOf(now);
      if (!PHASES[phase].exchangeCancel) {
        return {
          ok: false,
          msg:
            '现在是「' +
            PHASES[phase].name +
            '」，交易所不接受撤单' +
            (phase === 'auc2'
              ? '（9:20–9:25）'
              : phase === 'cauc'
              ? '（14:57–15:00）'
              : phase === 'wait'
              ? '（9:25–9:30）'
              : '') +
            '。',
          lesson: 'time',
          events: this.flush(),
        };
      }
    }
    this.finishCancel(o, '用户撤单');
    return { ok: true, events: this.flush() };
  }

  private finishCancel(
    o: Order,
    reason: string,
    bySystem = reason !== '用户撤单',
  ): void {
    o.status = o.filled > 0 ? '部撤' : '已撤';
    o.stage = 'done';
    o.reason = reason;
    o.note = '';
    this.setFrozen(o, 0);
    this.events.push({ type: 'cancel', order: o, bySystem });
  }

  private reject(o: Order, reason: string): void {
    o.status = '废单';
    o.stage = 'done';
    o.reason = reason;
    o.note = '';
    this.setFrozen(o, 0);
    this.events.push({ type: 'reject', order: o });
  }

  // ---------- 行情驱动的撮合 ----------

  /** 喂入一个快照：先推进时间，再撮合这只证券的委托。 */
  onSnapshot(snap: Snapshot): EngineEvent[] {
    this.events = [];
    this.advanceTo({ date: snap.date, t: snap.t });
    const code = snap.code;
    const prevAny = this.prevSnaps.get(code);
    const prev = prevAny && prevAny.date === snap.date ? prevAny : null;
    this.snaps.set(code, snap);
    const dayKey = code + '@' + snap.date;
    if (
      snap.t >= OPEN_AUCTION_END &&
      snap.t < T(9, 30) &&
      !snap.reconstructed &&
      !this.openVolume.has(dayKey)
    ) {
      this.openVolume.set(dayKey, snap.volume);
    }
    if (snap.t < T(14, 57)) {
      this.preCloseVolume.set(dayKey, snap.volume);
    }
    if (snap.date === this.state.date && !snap.suspended) {
      const orders = this.state.orders
        .filter(o => o.code === code && isLive(o) && o.status !== '未报')
        .sort((a, b) => a.id - b.id);
      const phase = phaseAt(snap.t);
      for (const o of orders) {
        if (
          o.stage === 'book' &&
          !o.arrived &&
          phase === 'cont' &&
          !snap.reconstructed
        ) {
          this.arrive(o, snap, snap.t);
        } else if (
          o.stage === 'book' &&
          o.arrived &&
          (phase === 'cauc' || snap.t >= CLOSE)
        ) {
          // 连续竞价没成交的挂单参加收盘集合竞价
          o.stage = 'auction';
          o.auction = 'close';
          o.note = '未成交部分参加收盘集合竞价';
        } else if (o.stage === 'book' && o.arrived && phase === 'cont') {
          this.rest(o, prev, snap);
        }
        if (
          o.stage === 'auction' &&
          o.auction === 'open' &&
          snap.t >= OPEN_AUCTION_END &&
          snap.open != null
        ) {
          this.resolveAuctionFor(o, snap);
        } else if (
          o.stage === 'auction' &&
          o.auction === 'close' &&
          snap.t >= CLOSE &&
          snap.last != null
        ) {
          this.resolveAuctionFor(o, snap);
        } else if (
          o.stage === 'after' &&
          snap.t >= AFTER_START &&
          snap.t < AFTER_END
        ) {
          this.matchAfterHours(o, prev, snap);
        }
      }
    }
    this.prevSnaps.set(code, snap);
    return this.flush();
  }

  private liqFor(snap: Snapshot): Liquidity {
    let l = this.liq.get(snap.code);
    if (!l) {
      l = new Liquidity();
      this.liq.set(snap.code, l);
    }
    l.reset(snap);
    return l;
  }

  /** 委托到达交易所（连续竞价）：检查涨跌停和价格笼子，然后按盘口成交，剩余挂单。 */
  private arrive(o: Order, snap: Snapshot, t: Sec): void {
    const sec = this.sec(o.code);
    const d = ruleOf(sec).decimals;
    const liq = this.liqFor(snap);
    o.arrived = true;
    o.stage = 'book';
    const rem = () => o.qty - o.filled;
    const apply = (plans: FillPlan[]) =>
      plans.forEach(p => this.doFill(o, p, t));
    const cancelRest = (why: string) => {
      if (rem() > 0) {
        this.finishCancel(o, why, true);
      }
    };
    // 沪市市价单的保护限价：成交价和转为限价后的价格都不超过它（买入不高于、卖出不低于）
    const protect = o.kind === 'limit' ? null : o.protect ?? null;
    const capped = (price: number) =>
      protect == null
        ? price
        : o.side === 'B'
        ? Math.min(price, protect)
        : Math.max(price, protect);
    const restAt = (price: number) => {
      if (rem() <= 0) {
        return;
      }
      o.price = price;
      o.queueAhead = queueAheadAt(o.side, price, snap);
      o.note = queueNote(o, sec);
      if (o.side === 'B') {
        this.setFrozen(o, buyFreeze(sec, price, rem(), feeOf(o, this.state)));
      }
    };

    if (o.kind === 'limit') {
      const lim = checkPriceLimit(sec, o.price!, snap);
      if (!lim.ok) {
        return this.reject(o, '交易所拒绝（涨跌幅限制）：' + lim.msg);
      }
      const cage = checkCage(sec, o.side, o.price!, snap);
      if (!cage.ok) {
        return this.reject(o, '交易所拒绝（价格笼子）：' + cage.msg);
      }
      apply(walkBook(o.side, rem(), o.price, snap, liq, d, Infinity));
      restAt(o.price!);
      return;
    }
    if (o.kind === 'b5_ioc' || o.kind === 'ioc') {
      apply(walkBook(o.side, rem(), protect, snap, liq, d, 5));
      return cancelRest(
        '即时成交剩余撤销' +
          (protect != null ? '（五档内或保护限价内的量不够）' : ''),
      );
    }
    if (o.kind === 'fok') {
      if (liquidityWithin(o.side, protect, snap, liq, 5) < rem()) {
        return this.finishCancel(
          o,
          '全额成交或撤销：对手盘五档内的量不够，整笔撤销',
          true,
        );
      }
      apply(walkBook(o.side, rem(), protect, snap, liq, d, 5));
      return;
    }
    if (o.kind === 'b5_limit') {
      const plans = walkBook(o.side, rem(), protect, snap, liq, d, 5);
      apply(plans);
      if (rem() > 0) {
        const own = ownLevels(o.side, snap)[0];
        const price = plans.length ? plans[plans.length - 1].price : own?.[0];
        if (price == null) {
          return cancelRest('没有成交也没有本方报价，剩余部分撤销');
        }
        restAt(capped(price));
      }
      return;
    }
    if (o.kind === 'cbest') {
      const best = oppositeLevels(o.side, snap)[0];
      if (!best) {
        return this.finishCancel(o, '对手方没有报价，委托撤销', true);
      }
      const price = capped(best[0]);
      apply(walkBook(o.side, rem(), price, snap, liq, d, 1));
      restAt(price);
      return;
    }
    if (o.kind === 'obest') {
      const own = ownLevels(o.side, snap)[0];
      if (!own) {
        return this.finishCancel(o, '本方没有报价，委托撤销', true);
      }
      const price = capped(own[0]);
      restAt(price);
      if (price === own[0]) {
        o.queueAhead = own[1];
      }
      return;
    }
  }

  private rest(o: Order, prev: Snapshot | null, snap: Snapshot): void {
    const sec = this.sec(o.code);
    const r = stepResting(
      o.side,
      o.price!,
      o.qty - o.filled,
      o.queueAhead,
      prev,
      snap,
      this.liqFor(snap),
      ruleOf(sec).decimals,
    );
    o.queueAhead = r.queueAhead;
    r.plans.forEach(p => this.doFill(o, p, snap.t));
    if (isLive(o)) {
      o.note = queueNote(o, sec);
    }
  }

  private resolveAuctionFor(o: Order, snap: Snapshot): void {
    const sec = this.sec(o.code);
    const kind = o.auction!;
    if (o.price == null) {
      return this.finishCancel(o, '集合竞价只接受限价委托', true);
    }
    const lim = checkPriceLimit(sec, o.price, snap);
    if (!lim.ok) {
      return this.reject(o, '交易所拒绝（涨跌幅限制）：' + lim.msg);
    }
    const dayKey = o.code + '@' + snap.date;
    const auctionPrice = kind === 'open' ? snap.open! : snap.last!;
    // 没有抓到竞价刚结束时的快照时，用能拿到的最接近的累计量；收盘竞价量拿不到时按 0 处理（保守，不成交）
    const volume =
      kind === 'open'
        ? this.openVolume.get(dayKey) ?? snap.volume
        : Math.max(
            0,
            snap.volume - (this.preCloseVolume.get(dayKey) ?? snap.volume),
          );
    const r = resolveAuction(
      o.side,
      o.price,
      o.qty - o.filled,
      auctionPrice,
      volume,
      snap,
      kind,
      ruleOf(sec).decimals,
      (kind === 'close' || this.openVolume.has(dayKey)) && !snap.reconstructed,
    );
    if (r.plan) {
      this.doFill(o, r.plan, kind === 'open' ? OPEN_AUCTION_END : CLOSE);
    }
    if (isLive(o)) {
      if (kind === 'open') {
        o.stage = 'book';
        o.auction = null;
        o.arrived = true;
        o.queueAhead = r.queueAhead;
      } else {
        o.stage = 'done';
        o.auction = null;
      }
      o.note = r.note;
    }
  }

  /** 盘后固定价格交易：按收盘价、时间优先撮合。看不到盘后委托簿，只按观察到的盘后成交量增量成交（保守）。⚠️ */
  private matchAfterHours(
    o: Order,
    prev: Snapshot | null,
    snap: Snapshot,
  ): void {
    const close = snap.last;
    if (close == null) {
      return;
    }
    if (
      o.price != null &&
      (o.side === 'B' ? o.price < close : o.price > close)
    ) {
      o.note =
        '委托价' + (o.side === 'B' ? '低于' : '高于') + '收盘价，不能成交';
      return;
    }
    const dv =
      prev && prev.t >= CLOSE ? Math.max(0, snap.volume - prev.volume) : 0;
    if (dv <= 0) {
      return;
    }
    const qty = Math.min(o.qty - o.filled, dv);
    const d = ruleOf(this.sec(o.code)).decimals;
    this.doFill(
      o,
      {
        price: close,
        qty,
        basis: {
          rule: 'after',
          snapT: snap.t,
          volumeDelta: dv,
          text:
            '盘后固定价格交易：按收盘价 ' +
            (close / 1000).toFixed(d) +
            ' 成交，依据两次快照间的盘后成交量 ' +
            dv,
        },
      },
      snap.t,
    );
  }

  // ---------- 记账 ----------

  private doFill(o: Order, plan: FillPlan, t: Sec): void {
    const s = this.state;
    const sec = this.sec(o.code);
    const qty = Math.min(plan.qty, o.qty - o.filled);
    if (qty <= 0) {
      return;
    }
    const amount = amountFen(plan.price, qty);
    const fee = fillFee(sec, o.side, o.amount, amount, feeOf(o, s));
    o.amount += amount;
    o.filled += qty;
    for (const k of [
      'commission',
      'stamp',
      'transfer',
      'handling',
      'reg',
      'total',
    ] as const) {
      o.fee[k] += fee[k];
    }
    o.status = o.filled >= o.qty ? '已成' : '部成';
    const fill: Fill = {
      id: ++s.seq,
      no: 'C' + (200000 + s.seq),
      orderId: o.id,
      code: o.code,
      side: o.side,
      price: plan.price,
      qty,
      amount,
      fee,
      net: 0,
      date: s.date,
      t,
      basis: plan.basis,
    };
    const cost =
      s.costs[o.code] ?? (s.costs[o.code] = { diluted: 0, average: 0 });
    if (o.side === 'B') {
      fill.net = -(amount + fee.total);
      s.cash += fill.net;
      s.lots.push({
        id: ++s.seq,
        code: o.code,
        qty,
        buyDate: s.date,
        dividend: 0,
      });
      cost.diluted += amount + fee.total;
      cost.average += amount + fee.total;
      const left = o.qty - o.filled;
      this.setFrozen(
        o,
        left > 0
          ? buyFreeze(
              sec,
              this.freezePrice(o, this.todaySnap(o.code)),
              left,
              feeOf(o, s),
            )
          : 0,
      );
    } else {
      fill.net = amount - fee.total;
      s.cash += fill.net;
      s.todaySellNet += fill.net;
      const heldBefore = holdingOf(s, o.code).held;
      this.sellLots(o.code, qty, fill, sec);
      // 买入均价口径：按当前均价扣减成本池，均价不变
      cost.average -= Math.round((cost.average * qty) / heldBefore);
      cost.diluted -= fill.net;
      if (heldBefore - qty <= 0) {
        delete s.costs[o.code];
      }
    }
    if (o.status === '已成') {
      o.stage = 'done';
      o.note = '';
      this.setFrozen(o, 0);
    }
    o.fills.push(fill.id);
    s.fills.unshift(fill);
    this.ledger(
      s.date,
      t,
      o.side === 'B' ? '证券买入' : '证券卖出',
      o.code,
      plan.price,
      qty,
      amount,
      fill.net,
      { fee, orderNo: o.no, fillNo: fill.no },
    );
    this.events.push({ type: 'fill', order: o, fill });
  }

  /** 卖出按先进先出扣减批次，并计算持有期间分红对应的红利税。 */
  private sellLots(code: string, qty: number, fill: Fill, sec: Security): void {
    const s = this.state;
    let left = qty;
    let tax = 0;
    const notes: string[] = [];
    const unit = sec.board === 'etf' ? '份' : '股';
    for (const l of s.lots.filter(x => x.code === code && x.buyDate < s.date)) {
      if (!left) {
        break;
      }
      const take = Math.min(l.qty, left);
      if (l.dividend > 0) {
        const div = Math.round((l.dividend * take) / l.qty);
        const r = divTaxRate(l.buyDate, s.date);
        const t = Math.round((div * r.pct) / 100);
        l.dividend -= div;
        if (t > 0) {
          tax += t;
          notes.push(
            l.buyDate +
              ' 买入的 ' +
              take +
              ' ' +
              unit +
              '，' +
              r.label +
              '，补税 ' +
              (t / 100).toFixed(2) +
              ' 元',
          );
        }
      }
      l.qty -= take;
      left -= take;
    }
    s.lots = s.lots.filter(l => l.qty > 0);
    if (tax > 0) {
      s.pendingDivTax.push({
        code,
        amount: tax,
        sellDate: s.date,
        fillId: fill.id,
        notes,
      });
      fill.divTaxPending = tax;
      fill.divTaxNotes = notes;
    }
  }

  private ledger(
    date: DateStr,
    t: Sec,
    biz: LedgerBiz,
    code: string | null,
    price: number,
    qty: number,
    amount: Fen,
    net: Fen,
    extra: Partial<
      Pick<LedgerEntry, 'fee' | 'divTax' | 'orderNo' | 'fillNo' | 'note'>
    > = {},
  ): void {
    const s = this.state;
    s.ledger.unshift({
      id: ++s.seq,
      date,
      t,
      biz,
      code,
      price,
      qty,
      amount,
      fee: extra.fee ?? { ...ZERO_FEE },
      divTax: extra.divTax ?? 0,
      net,
      balance: s.cash,
      orderNo: extra.orderNo ?? '',
      fillNo: extra.fillNo ?? '',
      note: extra.note ?? '',
    });
  }
}

/** 这笔委托用的费率：提交时记下的，旧数据没有就用账户当前的。 */
export function feeOf(o: Order, s: AccountState): FeeProfile {
  return o.feeProfile ?? s.fee;
}

function queueNote(o: Order, sec: Security): string {
  if (o.queueAhead === UNKNOWN_QUEUE) {
    return '挂单排队，排队位置未知（进入连续竞价时没有实时行情），只在成交价穿过委托价时成交';
  }
  return (
    '挂单排队' +
    (o.queueAhead
      ? '，前面约 ' +
        o.queueAhead.toLocaleString('zh-CN') +
        (sec.board === 'etf' ? ' 份' : ' 股')
      : '')
  );
}
