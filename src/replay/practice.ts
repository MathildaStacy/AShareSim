/**
 * M6 回放练习：用本地存下的某天快照，在沙盒账户里按同一套引擎重新交易一遍。
 *
 * - 起点：只有现金（5–40 万），或者那天开盘前的真实账户（输入日志里当天的第一个起点）。
 * - 时间由你控制（暂停、倍速、跳到下一时段），到了某个时刻就把这之前的快照按时间顺序喂给引擎。
 * - 库里只存起点和你的操作（下单、撤单带当时的回放时间），打开时从头重算，结果和当时一样。
 * - 盲测：不显示日期（可以连证券名称和代码一起隐藏），结束后揭晓。
 * - 不支持盘后固定价格交易：快照里没有 15:05 以后的盘后成交量。
 */
import type { Db } from '../data/db';
import * as repo from '../data/repos';
import { newAccount } from '../engine/account';
import type { DateStr, TradingCalendar } from '../engine/calendar';
import { Engine, type Now, type OrderCheck } from '../engine/engine';
import { equityOf } from '../engine/risk';
import { isSTName, type Security } from '../engine/securities';
import {
  AFTER_START,
  CLOSE,
  SETTLE_TIME,
  T,
  phaseAt,
  type Sec,
} from '../engine/session';
import type {
  AccountState,
  CorporateAction,
  EngineEvent,
  Snapshot,
} from '../engine/types';
import type { Fen, Li } from '../engine/units';
import type { OrderRequest } from '../engine/validate';
import { beijingIso } from '../market/clock';
import { mergeByTime } from '../market/replay';
import type { MinutePoint } from '../market/tencent';
import type { Simulator } from '../sim/simulator';
import type { SeedBody } from './journal';

/** 回放从 9:10 开始：可以先下预埋单，9:15 报送参加开盘集合竞价。 */
export const PRACTICE_START = T(9, 10);
export const CASH_OPTIONS: Fen[] = [
  5_000_000, 10_000_000, 20_000_000, 40_000_000,
];

export interface PracticeConfig {
  date: DateStr;
  codes: string[];
  start: 'cash' | 'account';
  /** start = cash 时的起始资金（分）。 */
  cash: Fen;
  blind: boolean;
  /** 盲测时连证券名称和代码一起隐藏（只显示板块）。 */
  hideNames: boolean;
}

export type PracticeInput =
  | { kind: 'place'; now: Now; req: OrderRequest }
  | { kind: 'cancel'; now: Now; id: number };

export interface PracticeResult {
  startEquity: Fen;
  endEquity: Fen;
  pnl: Fen;
  fees: Fen;
  orders: number;
  fills: number;
  /** 每只证券当天最后一个快照的价格。 */
  closes: Record<string, Li>;
}

export interface PracticeRecord {
  id: number;
  date: DateStr;
  status: 'running' | 'finished';
  config: PracticeConfig;
  seed: {
    state: AccountState;
    actions: CorporateAction[];
    secs: Record<string, Security>;
  };
  inputs: PracticeInput[];
  /** 回放时钟（秒）。 */
  clock: Sec;
  result: PracticeResult | null;
  createdAt: string;
  updatedAt: string;
}

type Body = Omit<
  PracticeRecord,
  'id' | 'date' | 'status' | 'createdAt' | 'updatedAt'
>;

// ---------- 存取 ----------

export async function savePractice(db: Db, r: PracticeRecord): Promise<void> {
  const body: Body = {
    config: r.config,
    seed: r.seed,
    inputs: r.inputs,
    clock: r.clock,
    result: r.result,
  };
  r.updatedAt = beijingIso();
  await db.run(
    'UPDATE replay_session SET status=?, body=?, updated_at=? WHERE id=?',
    [r.status, JSON.stringify(body), r.updatedAt, r.id],
  );
}

type Row = {
  id: number;
  date: string;
  status: string;
  body: string;
  created_at: string;
  updated_at: string;
};
const fromRow = (r: Row): PracticeRecord => ({
  id: Number(r.id),
  date: r.date,
  status: r.status as PracticeRecord['status'],
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  ...(JSON.parse(r.body) as Body),
});

export async function loadPractice(
  db: Db,
  id: number,
): Promise<PracticeRecord | null> {
  const r = await db.get<Row>('SELECT * FROM replay_session WHERE id=?', [id]);
  return r ? fromRow(r) : null;
}

export async function practices(db: Db): Promise<PracticeRecord[]> {
  return (
    await db.all<Row>('SELECT * FROM replay_session ORDER BY id DESC')
  ).map(fromRow);
}

export async function deletePractice(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM replay_session WHERE id=?', [id]);
}

/** 当天的证券信息：名称（是否 ST）按那天数据中心记下的，板块按代码。 */
async function securitiesOn(
  db: Db,
  sim: Simulator,
  codes: string[],
  date: DateStr,
): Promise<Record<string, Security>> {
  const out: Record<string, Security> = {};
  for (const code of codes) {
    const base = sim.security(code);
    if (!base) {
      continue;
    }
    const day = await db.get<{ body: string }>(
      'SELECT body FROM security_day WHERE code=? AND date=?',
      [code, date],
    );
    const name: string = day
      ? JSON.parse(day.body).name ?? base.name
      : base.name;
    out[code] = {
      code,
      name,
      exchange: base.exchange,
      board: base.board,
      st: isSTName(name),
      ...(base.noPriceLimit ? { noPriceLimit: true } : {}),
    };
  }
  return out;
}

/**
 * 这天开盘前的真实账户：输入日志里当天的第一个起点，而且那时这天还没有委托、成交和资金变动。
 * 第一个起点是盘中或收盘后才记的（例如那天才装上 M6 版本），就不是开盘前的账户，返回 null。
 */
export async function accountSeed(
  db: Db,
  accountId: number,
  date: DateStr,
): Promise<SeedBody | null> {
  const row = await db.get<{ body: string }>(
    "SELECT body FROM engine_input WHERE account_id=? AND trade_date=? AND kind='seed' ORDER BY id LIMIT 1",
    [accountId, date],
  );
  if (!row) {
    return null;
  }
  const seed: SeedBody = JSON.parse(row.body);
  const s = seed.state;
  const touched =
    s.date > date ||
    s.orders.some(o => o.date === date) ||
    s.fills.some(f => f.date === date) ||
    s.ledger.some(l => l.date === date && l.t >= T(9, 0));
  return touched ? null : seed;
}

/** 开一次回放练习。start = account 时用这天开盘前的真实账户（accountSeed）。 */
export async function createPractice(
  db: Db,
  sim: Simulator,
  config: PracticeConfig,
): Promise<PracticeRecord> {
  let state: AccountState;
  let actions: CorporateAction[];
  if (config.start === 'account') {
    const seed = await accountSeed(db, sim.accountId, config.date);
    if (!seed) {
      throw new Error('这天没有开盘前真实账户的起点记录，只能用现金开始');
    }
    state = seed.state;
    actions = seed.actions;
  } else {
    const live = sim.engine.state;
    state = newAccount(config.date, {
      fee: live.fee,
      depositCap: Math.max(live.depositCap, config.cash),
    });
    if (live.risk) {
      state.risk = { ...live.risk };
    }
    const e = new Engine(state, {
      calendar: sim.calendar,
      security: () => null,
    });
    e.deposit({ date: config.date, t: T(9, 0) }, config.cash);
    actions = sim.engine.corporateActions();
  }
  const held = state.lots.map(l => l.code);
  const codes = [...new Set([...config.codes, ...held])];
  const secs = await securitiesOn(db, sim, codes, config.date);
  const now = beijingIso();
  const body: Body = {
    config: { ...config, codes: config.codes.filter(c => secs[c]) },
    seed: { state, actions, secs },
    inputs: [],
    clock: PRACTICE_START,
    result: null,
  };
  const id = await db.transaction(async tx => {
    await tx.run(
      'INSERT INTO replay_session(date,status,body,created_at,updated_at) VALUES (?,?,?,?,?)',
      [config.date, 'running', JSON.stringify(body), now, now],
    );
    const row = await tx.get<{ id: number }>(
      'SELECT last_insert_rowid() AS id',
    );
    return Number(row?.id);
  });
  return (await loadPractice(db, id))!;
}

// ---------- 运行 ----------

/** 时钟上可以一键跳到的时刻。 */
export const STOPS: { t: Sec; label: string }[] = [
  { t: T(9, 15), label: '9:15 开盘集合竞价' },
  { t: T(9, 25), label: '9:25 开盘价揭晓' },
  { t: T(9, 30), label: '9:30 连续竞价' },
  { t: T(11, 30), label: '11:30 午间休市' },
  { t: T(13, 0), label: '13:00 下午开盘' },
  { t: T(14, 57), label: '14:57 收盘集合竞价' },
  { t: CLOSE, label: '15:00 收盘' },
];

export function nextStop(t: Sec): { t: Sec; label: string } | null {
  return STOPS.find(s => s.t > t) ?? null;
}

export class PracticeSession {
  readonly engine: Engine;
  private feed: Snapshot[];
  private cursor = 0;
  private latest = new Map<string, Snapshot>();
  /** 每只证券每分钟最后一个快照（分时图）。 */
  private minutes = new Map<string, Map<number, Snapshot>>();
  /** 全部事件，界面显示成交记录和提示用。 */
  readonly log: EngineEvent[] = [];
  now: Now;

  constructor(
    public record: PracticeRecord,
    snapshots: Snapshot[],
    calendar: TradingCalendar,
  ) {
    const seed = JSON.parse(JSON.stringify(record.seed.state));
    this.engine = new Engine(seed, {
      calendar,
      security: c => record.seed.secs[c] ?? null,
    });
    this.engine.setCorporateActions(record.seed.actions);
    this.feed = snapshots.filter(s => s.date === record.date);
    this.now = { date: record.date, t: 0 };
    for (const input of record.inputs) {
      this.runTo(input.now.t);
      this.log.push(...this.apply(input));
    }
    this.runTo(Math.max(record.clock, PRACTICE_START));
  }

  /** 读出快照（自选的和起点持仓的）并重算到上次的时钟。 */
  static async open(
    db: Db,
    record: PracticeRecord,
    calendar: TradingCalendar,
  ): Promise<PracticeSession> {
    const lists: Snapshot[][] = [];
    for (const code of Object.keys(record.seed.secs)) {
      lists.push(await repo.snapshotsOf(db, code, record.date));
    }
    return new PracticeSession(record, mergeByTime(lists), calendar);
  }

  get date(): DateStr {
    return this.record.date;
  }

  get finished(): boolean {
    return this.record.status === 'finished';
  }

  /** 有快照的证券（可交易）。 */
  get codes(): string[] {
    return this.record.config.codes;
  }

  security(code: string): Security | null {
    return this.record.seed.secs[code] ?? null;
  }

  quote(code: string): Snapshot | null {
    return this.latest.get(code) ?? null;
  }

  /** 这只证券到当前时刻为止的分时（每分钟最后一个快照）。 */
  points(code: string): MinutePoint[] {
    const m = this.minutes.get(code);
    if (!m) {
      return [];
    }
    return [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([minute, s]) => ({
        t: (minute + 1) * 60,
        price: s.last ?? s.prevClose,
        volume: s.volume,
        amount: s.amount,
      }));
  }

  /** 第一个快照和最后一个快照的时间（回放时钟的范围）。 */
  span(): { first: Sec; last: Sec } | null {
    return this.feed.length
      ? { first: this.feed[0].t, last: this.feed[this.feed.length - 1].t }
      : null;
  }

  /** 两个快照之间超过 5 分钟就算「这段没录到」。 */
  gapAt(code: string): boolean {
    const s = this.latest.get(code);
    return !!s && phaseAt(this.now.t) === 'cont' && this.now.t - s.t > 5 * 60;
  }

  private priceOf = (code: string): Li | null => {
    const s = this.latest.get(code);
    return s ? s.last ?? s.prevClose : null;
  };

  equity(): Fen {
    return equityOf(this.engine.state, this.priceOf);
  }

  startEquity(): Fen {
    const first = new Map<string, Snapshot>();
    for (const s of this.feed) {
      if (!first.has(s.code)) {
        first.set(s.code, s);
      }
    }
    return equityOf(
      this.record.seed.state,
      c => first.get(c)?.prevClose ?? null,
    );
  }

  /** 把时钟推进到 t：按时间顺序喂这之前的快照，再推进引擎时间。时钟不倒退。 */
  runTo(t: Sec): EngineEvent[] {
    const target = Math.max(t, this.now.t);
    const out: EngineEvent[] = [];
    while (
      this.cursor < this.feed.length &&
      this.feed[this.cursor].t <= target
    ) {
      const s = this.feed[this.cursor++];
      this.latest.set(s.code, s);
      let m = this.minutes.get(s.code);
      if (!m) {
        m = new Map();
        this.minutes.set(s.code, m);
      }
      // 15:00–15:05 的快照带着收盘集合竞价的结果，算进 15:00 那个点（和腾讯分时一样）
      if (s.t >= T(9, 30) && s.t < AFTER_START) {
        m.set(Math.min(Math.floor((s.t - 1) / 60), CLOSE / 60 - 1), s);
      }
      out.push(...this.engine.onSnapshot(s));
    }
    this.now = { date: this.record.date, t: target };
    out.push(...this.engine.advance(this.now));
    this.log.push(...out);
    return out;
  }

  /** 倍速走 seconds 秒；跨过午休直接到 13:00。 */
  step(seconds: number): EngineEvent[] {
    let t = this.now.t + seconds;
    if (t > T(11, 30) && t < T(13, 0)) {
      t = T(13, 0);
    }
    return this.runTo(Math.min(t, SETTLE_TIME));
  }

  private apply(input: PracticeInput): EngineEvent[] {
    return input.kind === 'place'
      ? this.engine.placeOrder(input.now, input.req).events
      : this.engine.cancelOrder(input.now, input.id).events;
  }

  check(req: OrderRequest): OrderCheck {
    return this.engine.check(this.now, req);
  }

  place(req: OrderRequest) {
    const r = this.engine.placeOrder(this.now, req);
    // 被券商拦下的不记：重放时它本来也不会改变任何状态
    if (r.ok) {
      this.record.inputs.push({ kind: 'place', now: { ...this.now }, req });
    }
    this.log.push(...r.events);
    return r;
  }

  cancel(id: number) {
    const r = this.engine.cancelOrder(this.now, id);
    if (r.ok) {
      this.record.inputs.push({ kind: 'cancel', now: { ...this.now }, id });
    }
    this.log.push(...r.events);
    return r;
  }

  /** 结束：推进到 15:30 清算，算结果并揭晓日期。 */
  finish(): PracticeResult {
    this.runTo(SETTLE_TIME);
    const s = this.engine.state;
    const today = s.fills.filter(f => f.date === this.date);
    const closes: Record<string, Li> = {};
    for (const [code, snap] of this.latest) {
      closes[code] = snap.last ?? snap.prevClose;
    }
    const startEquity = this.startEquity();
    const endEquity = this.equity();
    const result: PracticeResult = {
      startEquity,
      endEquity,
      pnl: endEquity - startEquity,
      fees: today.reduce((n, f) => n + f.fee.total, 0),
      orders: s.orders.filter(o => o.date === this.date).length,
      fills: today.length,
      closes,
    };
    this.record.status = 'finished';
    this.record.result = result;
    return result;
  }

  async save(db: Db): Promise<void> {
    this.record.clock = this.now.t;
    await savePractice(db, this.record);
  }
}

// ---------- 显示 ----------

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 盲测隐藏名称时的显示名：证券 A、证券 B……（按开始时的顺序，持仓的接在后面）。 */
export function displayName(r: PracticeRecord, code: string): string {
  const sec = r.seed.secs[code];
  if (r.config.blind && r.config.hideNames && r.status !== 'finished') {
    const i = Object.keys(r.seed.secs).indexOf(code);
    return '证券 ' + (LETTERS[i] ?? String(i + 1));
  }
  return sec?.name ?? code;
}

export function displayCode(r: PracticeRecord, code: string): string {
  return r.config.blind && r.config.hideNames && r.status !== 'finished'
    ? '••••••'
    : code;
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function displayDate(r: PracticeRecord): string {
  if (r.config.blind && r.status !== 'finished') {
    return '日期已隐藏';
  }
  const d = new Date(r.date + 'T00:00:00Z');
  return r.date + ' ' + WEEK[d.getUTCDay()];
}
