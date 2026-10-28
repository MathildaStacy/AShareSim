import type { Db } from '../data/db';
import { addDays, weekday } from '../engine/calendar';
import { beijingIso } from '../market/clock';
import type {
  ExecutionReport,
  Rebalance,
  Strategy,
  StrategyInput,
} from './types';

export const weekOf = (date: string) =>
  addDays(date, -((weekday(date) + 6) % 7));
export function streak(weeks: string[], today: string): number {
  const set = new Set(weeks);
  let week = weekOf(today),
    n = 0;
  if (!set.has(week)) {
    week = addDays(week, -7);
  }
  while (set.has(week)) {
    n++;
    week = addDays(week, -7);
  }
  return n;
}
export async function strategies(db: Db): Promise<Strategy[]> {
  const rows = await db.all<{ body: string }>(
    'SELECT body FROM strategy_version s WHERE version=(SELECT MAX(version) FROM strategy_version WHERE id=s.id) ORDER BY id DESC',
  );
  return rows.map(r => JSON.parse(r.body));
}
export async function saveStrategy(
  db: Db,
  input: StrategyInput,
  id?: number,
): Promise<Strategy> {
  if (
    !input.name.trim() ||
    !input.pool.trim() ||
    !input.discipline.trim() ||
    !input.frequency.trim() ||
    !/^(sh|sz)\d{6}$/.test(input.benchmark) ||
    !['once', 'none'].includes(input.retry) ||
    !(input.maxWeight > 0 && input.maxWeight <= 1)
  ) {
    throw new Error(
      '请填写策略、股票池、频率和纪律，单票上限需在 0–100% 之间，基准使用完整证券代码',
    );
  }
  return db.transaction(async tx => {
    const latest = (await strategies(tx)).find(s => s.id === id);
    const row = await tx.get<{ id: number }>(
      'SELECT COALESCE(MAX(id),0)+1 AS id FROM strategy_version',
    );
    const strategy: Strategy = {
      ...input,
      name: input.name.trim(),
      id: id ?? Number(row!.id),
      version: (latest?.version ?? 0) + 1,
    };
    await tx.run('INSERT INTO strategy_version VALUES (?,?,?,?)', [
      strategy.id,
      strategy.version,
      JSON.stringify(strategy),
      beijingIso(),
    ]);
    return strategy;
  });
}
export async function rebalances(
  db: Db,
  accountId: number,
): Promise<Rebalance[]> {
  return (
    await db.all<{ body: string }>(
      'SELECT body FROM rebalance WHERE account_id=? ORDER BY id DESC',
      [accountId],
    )
  ).map(r => JSON.parse(r.body));
}
export async function loadRebalance(
  db: Db,
  id: number,
  accountId: number,
): Promise<Rebalance> {
  const r = await db.get<{ body: string }>(
    'SELECT body FROM rebalance WHERE id=? AND account_id=?',
    [id, accountId],
  );
  if (!r) {
    throw new Error('当前账户没有这次调仓');
  }
  return JSON.parse(r.body);
}
export async function saveRebalance(db: Db, r: Rebalance): Promise<void> {
  await db.run(
    'UPDATE rebalance SET status=?,body=?,updated_at=? WHERE id=? AND account_id=?',
    [r.status, JSON.stringify(r), beijingIso(), r.id, r.accountId],
  );
}
export async function reports(
  db: Db,
  accountId: number,
): Promise<ExecutionReport[]> {
  return (
    await db.all<{ body: string }>(
      'SELECT body FROM execution_report WHERE account_id=? ORDER BY week DESC,rebalance_id DESC',
      [accountId],
    )
  ).map(r => JSON.parse(r.body));
}
export async function saveSkip(
  db: Db,
  accountId: number,
  date: string,
  today: string,
  reason: string,
): Promise<void> {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date ||
    date > today ||
    !reason.trim()
  ) {
    throw new Error('请填写有效的过去日期和漏执行原因');
  }
  const week = weekOf(date);
  if ((await reports(db, accountId)).some(r => r.week === week)) {
    throw new Error('该周已有报告，无需登记漏执行');
  }
  await db.run(
    'INSERT INTO weekly_skip VALUES (?,?,?) ON CONFLICT(account_id,week) DO UPDATE SET reason=excluded.reason',
    [accountId, week, reason.trim()],
  );
}
