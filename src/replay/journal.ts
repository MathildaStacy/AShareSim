/**
 * M6：实时账户的输入日志（engine_input）。
 *
 * 引擎是确定性的：同一个起点状态、同样顺序的输入，得到同样的事件。所以这里只记输入：
 * - seed：起点。每个交易日第一次输入前记一次（账户状态 + 引擎里的最新快照 + 分红送配），
 *   App 重启、重置账户时也记一次（这时引擎内存是空的，从库里读出的状态才是真实起点）。
 * - 下单、撤单、转账、改费率 / 上限 / 限额、分红送配变化、时间推进（改了状态时）、喂快照（见 EngineInput）。
 *   快照已经存进 quotes_snapshot 的只记引用和校验值，补出来的、没存的记全文。
 *
 * 起点状态去掉了前一交易日以前的已完成委托、成交和交割单：撮合用不到它们，编号由 seq 接着往下发。
 */
import type { Db } from '../data/db';
import type { DateStr, TradingCalendar } from '../engine/calendar';
import { isLive } from '../engine/account';
import type { Engine, EngineInput, EngineRecorder } from '../engine/engine';
import type { AccountState, CorporateAction, Snapshot } from '../engine/types';

export type SeedReason = 'day' | 'open' | 'reset';

export interface SeedBody {
  reason: SeedReason;
  state: AccountState;
  snaps: Snapshot[];
  actions: CorporateAction[];
}

/** 快照引用：回放时到 quotes_snapshot 里按 code + date + t 取，h 不一致说明被同秒修正覆盖过。 */
export interface SnapRef {
  code: string;
  date: DateStr;
  t: number;
  h: string;
}

/** 存进库里的一行。快照类输入的 snap 换成 ref（已存进快照库时）。 */
export type StoredInput =
  | { kind: 'seed'; body: SeedBody }
  | { kind: 'snap' | 'prime'; body: { snap?: Snapshot; ref?: SnapRef } }
  | {
      kind: Exclude<EngineInput['kind'], 'snap' | 'prime'>;
      body: EngineInput;
    };

export interface JournalRow {
  id: number;
  date: DateStr;
  input: StoredInput;
}

/** 快照的校验值（djb2），只用来发现「同一秒的快照被修正覆盖过」。 */
export function snapHash(s: Snapshot): string {
  const text = JSON.stringify([
    s.prevClose,
    s.open,
    s.last,
    s.high,
    s.low,
    s.volume,
    s.amount,
    s.bids,
    s.asks,
    s.up,
    s.down,
    !!s.suspended,
  ]);
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = (h * 33 + text.charCodeAt(i)) % 4294967296;
  }
  return h.toString(16);
}

/** 起点状态：留下未完成委托和前一交易日起的记录，其他历史撮合用不到。 */
export function trimState(
  state: AccountState,
  calendar: TradingCalendar,
  date: DateStr,
): AccountState {
  const copy: AccountState = JSON.parse(JSON.stringify(state));
  const from = calendar.prev(calendar.onOrAfter(date));
  const keep = (d: DateStr) => d >= from;
  copy.orders = copy.orders.filter(
    o => isLive(o) || keep(o.date) || (o.sendDate != null && keep(o.sendDate)),
  );
  copy.fills = copy.fills.filter(f => keep(f.date));
  copy.ledger = copy.ledger.filter(l => keep(l.date));
  return copy;
}

const inputDate = (i: EngineInput): DateStr | null =>
  'now' in i ? i.now.date : 'snap' in i && i.snap ? i.snap.date : null;

/**
 * 实时账户的记录器：挂在 Simulator 的引擎上，攒在内存里，和账户状态同一个事务写库。
 */
export class JournalWriter implements EngineRecorder {
  private rows: { date: DateStr; input: StoredInput }[] = [];
  private seedDate: DateStr | null = null;
  /** 每只证券最后一次存进快照库的快照（t + 校验值）。 */
  private saved = new Map<string, { date: DateStr; t: number; h: string }>();

  constructor(private calendar: TradingCalendar) {}

  /** 记一个起点：App 打开、重置账户时调用（引擎内存是空的，或者换了账户）。 */
  seed(engine: Engine, date: DateStr, reason: SeedReason): void {
    this.rows.push({
      date,
      input: {
        kind: 'seed',
        body: {
          reason,
          state: trimState(engine.state, this.calendar, date),
          snaps: engine.snapshots(),
          actions: engine.corporateActions(),
        },
      },
    });
    this.seedDate = date;
  }

  begin(date: DateStr, engine: Engine): void {
    if (this.seedDate == null || date > this.seedDate) {
      this.seed(engine, date, 'day');
    }
  }

  /** Simulator 把快照存进库以后告诉这里，之后喂引擎时只记引用。 */
  markSaved(s: Snapshot): void {
    this.saved.set(s.code, { date: s.date, t: s.t, h: snapHash(s) });
  }

  record(input: EngineInput): void {
    const date = inputDate(input) ?? this.seedDate ?? '';
    if (input.kind === 'snap' || input.kind === 'prime') {
      const s = input.snap;
      const mark = this.saved.get(s.code);
      const h = snapHash(s);
      const ref =
        !s.reconstructed &&
        mark &&
        mark.date === s.date &&
        mark.t === s.t &&
        mark.h === h
          ? { code: s.code, date: s.date, t: s.t, h }
          : null;
      this.rows.push({
        date,
        input: { kind: input.kind, body: ref ? { ref } : { snap: s } },
      });
      return;
    }
    this.rows.push({ date, input: { kind: input.kind, body: input } });
  }

  /** 事务开始前记下位置，失败时撤回这之后记的输入。 */
  mark(): { n: number; seedDate: DateStr | null } {
    return { n: this.rows.length, seedDate: this.seedDate };
  }

  rollback(m: { n: number; seedDate: DateStr | null }): void {
    this.rows.length = m.n;
    this.seedDate = m.seedDate;
  }

  get pending(): number {
    return this.rows.length;
  }

  /** 写进 engine_input（调用方放在和账户状态同一个事务里）。 */
  async flush(tx: Db, accountId: number): Promise<void> {
    const rows = this.rows;
    this.rows = [];
    for (const r of rows) {
      await tx.run(
        'INSERT INTO engine_input(account_id,trade_date,kind,body) VALUES (?,?,?,?)',
        [accountId, r.date, r.input.kind, JSON.stringify(r.input.body)],
      );
    }
  }
}

/** 某个账户某天的输入，按顺序。 */
export async function journalOf(
  db: Db,
  accountId: number,
  date: DateStr,
): Promise<JournalRow[]> {
  const rows = await db.all<{
    id: number;
    trade_date: string;
    kind: string;
    body: string;
  }>(
    'SELECT id,trade_date,kind,body FROM engine_input WHERE account_id=? AND trade_date=? ORDER BY id',
    [accountId, date],
  );
  return rows.map(r => ({
    id: Number(r.id),
    date: r.trade_date,
    input: { kind: r.kind, body: JSON.parse(r.body) } as StoredInput,
  }));
}

/** 这个日期之后的第一个起点（核对日终状态用）。 */
export async function nextSeed(
  db: Db,
  accountId: number,
  afterId: number,
): Promise<SeedBody | null> {
  const r = await db.get<{ body: string }>(
    "SELECT body FROM engine_input WHERE account_id=? AND id>? AND kind='seed' ORDER BY id LIMIT 1",
    [accountId, afterId],
  );
  return r ? JSON.parse(r.body) : null;
}

/** 有输入日志的交易日（新的在前），带输入条数。 */
export async function journalDays(
  db: Db,
  accountId: number,
): Promise<{ date: DateStr; inputs: number }[]> {
  const rows = await db.all<{ trade_date: string; n: number }>(
    'SELECT trade_date, COUNT(*) AS n FROM engine_input WHERE account_id=? GROUP BY trade_date ORDER BY trade_date DESC',
    [accountId],
  );
  return rows.map(r => ({ date: r.trade_date, inputs: Number(r.n) }));
}

/** 输入日志跟着快照一起清理：快照库里最早的日期之前的没法再核对。 */
export async function pruneJournal(db: Db): Promise<number> {
  const r = await db.run(
    'DELETE FROM engine_input WHERE trade_date < (SELECT MIN(date) FROM quotes_snapshot)',
  );
  return r.changes;
}
