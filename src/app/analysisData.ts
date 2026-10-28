/**
 * 账户分析的数据准备（账户分析页和 AI 的 get_analysis 共用）：取基准和持仓的不复权日 K，
 * 用交割单反推每天的总资产，再交给 learn/analysis.ts 算指标。
 */
import { addDays } from '../engine/calendar';
import type { Li } from '../engine/units';
import {
  analyze,
  equitySeries,
  type Analysis,
  type EquityDay,
} from '../learn/analysis';
import type { AppCore } from './boot';

export const BENCH = {
  sh000300: '沪深300',
  sh000906: '中证800',
} as const;
export type Bench = keyof typeof BENCH;

export async function loadAnalysis(
  core: AppCore,
  bench: Bench,
): Promise<{ eq: EquityDay[]; a: Analysis | null } | null> {
  const ledger = core.sim.engine.state.ledger;
  if (!ledger.length) {
    return null;
  }
  const start = ledger.reduce(
    (m, e) => (e.date < m ? e.date : m),
    ledger[0].date,
  );
  const codes = [
    ...new Set(ledger.map(e => e.code).filter((c): c is string => !!c)),
  ];
  // 多取几天，第一天之前的基准收盘价用来算第一天的收益
  const from = addDays(start, -10);
  const bars = await core.client.klineRange(bench, '', from, '', '');
  const closes: Record<string, Record<string, Li>> = {};
  for (const c of codes) {
    const type = core.sim.security(c)?.type ?? '';
    const k = await core.client.klineRange(c, type, from, '', '');
    closes[c] = Object.fromEntries(k.map(b => [b.date, b.close]));
  }
  const eq = equitySeries(
    ledger,
    bars.map(b => b.date),
    closes,
  );
  const bmap = Object.fromEntries(bars.map(b => [b.date, b.close]));
  return { eq, a: analyze(eq, bmap, BENCH[bench]) };
}
