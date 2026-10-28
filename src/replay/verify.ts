/**
 * M6 验收：某个交易日的「回放结果」和「当天实时模拟的结果」逐笔比对。
 *
 * 从当天的起点状态出发，按输入日志的顺序重放（快照引用到 quotes_snapshot 里取），
 * 把引擎事件和 account_event 里这一天的记录逐条比对；再把日终状态和下一个起点比对。
 */
import type { Db } from '../data/db';
import * as repo from '../data/repos';
import type { DateStr } from '../engine/calendar';
import { Engine, type EngineInput } from '../engine/engine';
import type { Security } from '../engine/securities';
import { T } from '../engine/session';
import type { AccountState, EngineEvent, Snapshot } from '../engine/types';
import { journalOf, nextSeed, snapHash, type SnapRef } from './journal';
import { applyInput, eventDate, eventKey, type RunnerDeps } from './runner';

export interface VerifyReport {
  date: DateStr;
  /** 起点个数：当天第一次输入算一个，App 重启、重置账户各算一个。 */
  segments: number;
  inputs: number;
  /** 实时 / 回放的事件数（不含提示），以及一致的条数。 */
  live: number;
  replay: number;
  matched: number;
  fills: { live: number; replay: number; matched: number };
  /** 实时有、回放没有；回放有、实时没有。 */
  missing: string[];
  extra: string[];
  /** 日终状态和下一个起点不一致的字段；null = 还没有下一个起点（当天还没结束或之后没再打开）。 */
  endState: string[] | null;
  /** 没法核对的地方（快照已清理、被同秒修正覆盖、当天没有起点）。 */
  notes: string[];
  ok: boolean;
}

/** 多重集合差：a 里有、b 里没有的（按次数）。 */
function minus(a: string[], b: string[]): string[] {
  const left = new Map<string, number>();
  b.forEach(k => left.set(k, (left.get(k) ?? 0) + 1));
  const out: string[] = [];
  for (const k of a) {
    const n = left.get(k) ?? 0;
    if (n > 0) {
      left.set(k, n - 1);
    } else {
      out.push(k);
    }
  }
  return out;
}

const qtyByCode = (s: AccountState) => {
  const m: Record<string, number> = {};
  s.lots.forEach(l => {
    m[l.code] = (m[l.code] ?? 0) + l.qty;
  });
  return m;
};

/** 日终状态里和撮合结果有关的部分（排队估计、说明文字这类不比）。 */
export function stateDiff(replay: AccountState, live: AccountState): string[] {
  const out: string[] = [];
  const cmp = (name: string, x: unknown, y: unknown) => {
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      out.push(
        name + '：回放 ' + JSON.stringify(x) + '，实时 ' + JSON.stringify(y),
      );
    }
  };
  cmp('日期', replay.date, live.date);
  cmp('资金余额（分）', replay.cash, live.cash);
  cmp('冻结（分）', replay.frozen, live.frozen);
  cmp('当日卖出回款（分）', replay.todaySellNet, live.todaySellNet);
  cmp('持仓', qtyByCode(replay), qtyByCode(live));
  cmp('编号', replay.seq, live.seq);
  const liveOrders = new Map(live.orders.map(o => [o.id, o]));
  for (const o of replay.orders) {
    const l = liveOrders.get(o.id);
    if (l && (l.status !== o.status || l.filled !== o.filled)) {
      out.push(
        '委托 ' +
          o.no +
          '：回放 ' +
          o.status +
          ' ' +
          o.filled +
          '，实时 ' +
          l.status +
          ' ' +
          l.filled,
      );
    }
  }
  return out;
}

/** 把日志里的快照引用换回快照。 */
async function snapshotLoader(db: Db, date: DateStr) {
  const cache = new Map<string, Map<number, Snapshot>>();
  return async (
    ref: SnapRef,
  ): Promise<{ snap: Snapshot | null; changed: boolean }> => {
    let byT = cache.get(ref.code);
    if (!byT) {
      byT = new Map(
        (await repo.snapshotsOf(db, ref.code, date)).map(s => [s.t, s]),
      );
      cache.set(ref.code, byT);
    }
    const s = byT.get(ref.t) ?? null;
    return { snap: s, changed: !!s && snapHash(s) !== ref.h };
  };
}

/**
 * 核对一个交易日。security 是 App 现在的证券表；下单时记下的证券信息（含当时是否 ST）优先。
 */
export async function verifyDay(
  db: Db,
  accountId: number,
  date: DateStr,
  deps: RunnerDeps,
): Promise<VerifyReport> {
  const rows = await journalOf(db, accountId, date);
  const report: VerifyReport = {
    date,
    segments: 0,
    inputs: 0,
    live: 0,
    replay: 0,
    matched: 0,
    fills: { live: 0, replay: 0, matched: 0 },
    missing: [],
    extra: [],
    endState: null,
    notes: [],
    ok: false,
  };
  const secs = new Map<string, Security>();
  const security = (c: string) => secs.get(c) ?? deps.security(c);
  const load = await snapshotLoader(db, date);
  let engine: Engine | null = null;
  let skipped = 0,
    lost = 0,
    changed = 0;
  const events: EngineEvent[] = [];
  for (const row of rows) {
    const { kind, body } = row.input;
    if (kind === 'seed') {
      engine = new Engine(JSON.parse(JSON.stringify(body.state)), {
        calendar: deps.calendar,
        security,
      });
      engine.setCorporateActions(body.actions);
      body.snaps.forEach(s => engine!.primeSnapshot(s));
      report.segments++;
      continue;
    }
    if (!engine) {
      skipped++;
      continue;
    }
    let input: EngineInput;
    if (kind === 'snap' || kind === 'prime') {
      let snap = body.snap;
      if (!snap && body.ref) {
        const got = await load(body.ref);
        if (!got.snap) {
          lost++;
          continue;
        }
        changed += got.changed ? 1 : 0;
        snap = got.snap;
      }
      if (!snap) {
        continue;
      }
      input = { kind, snap };
    } else {
      input = body as EngineInput;
      if (input.kind === 'place' && input.sec) {
        secs.set(input.req.code, input.sec);
      }
    }
    report.inputs++;
    events.push(...applyInput(engine, input));
  }
  if (!report.segments) {
    report.notes.push(
      '这天没有输入日志的起点（日志从 M6 版本开始记录，或者已经随快照清理）',
    );
  }
  if (skipped) {
    report.notes.push(skipped + ' 条输入在起点之前，没有重放');
  }
  if (lost) {
    report.notes.push(lost + ' 个快照已经被清理，没法重放');
  }
  if (changed) {
    report.notes.push(
      changed +
        ' 个快照被同一秒的修正覆盖了，按修正后的重放（原始快照没有保存）',
    );
  }
  if (engine && rows.length) {
    const next = await nextSeed(db, accountId, rows[rows.length - 1].id);
    if (next) {
      report.endState = stateDiff(engine.state, next.state);
    }
    // 实时账户是在下一次打开（或 15:30 以后的第一次输入）时清算这一天的，回放在这里补上
    if (engine.state.date === date && !engine.state.settled) {
      events.push(...engine.advance({ date, t: T(23, 59, 59) }));
    }
  }
  const replayKeys = events
    .filter(e => eventDate(e, date) === date)
    .map(eventKey)
    .filter((k): k is string => k != null);
  const liveRows = await db.all<{ body: string }>(
    'SELECT body FROM account_event WHERE account_id=? AND trade_date=? ORDER BY id',
    [accountId, date],
  );
  const liveKeys = liveRows
    .map(r => eventKey(JSON.parse(r.body) as EngineEvent))
    .filter((k): k is string => k != null);
  report.live = liveKeys.length;
  report.replay = replayKeys.length;
  report.missing = minus(liveKeys, replayKeys);
  report.extra = minus(replayKeys, liveKeys);
  report.matched = liveKeys.length - report.missing.length;
  const isFill = (k: string) => k.startsWith('成交 ');
  report.fills = {
    live: liveKeys.filter(isFill).length,
    replay: replayKeys.filter(isFill).length,
    matched:
      liveKeys.filter(isFill).length - report.missing.filter(isFill).length,
  };
  report.ok =
    report.segments > 0 &&
    !report.missing.length &&
    !report.extra.length &&
    !lost &&
    !changed &&
    !(report.endState ?? []).length;
  return report;
}
