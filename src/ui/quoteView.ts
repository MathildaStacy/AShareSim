/** 界面显示一只证券要用的东西：名称、类型、最新快照、显示字段、价格位数。 */
import type { Simulator } from '../sim/simulator';
import type { RankItem } from '../market/tencent';
import { decimalsOf, isIndex } from './format';

export function quoteView(
  sim: Simulator,
  code: string,
  fallback?: { name?: string; type?: string },
) {
  const q = sim.quote(code);
  const sec = sim.security(code);
  const name = q?.info.name ?? sec?.name ?? fallback?.name ?? code.slice(2);
  const type = q?.info.type ?? sec?.type ?? fallback?.type;
  return {
    code,
    name,
    type,
    snap: q?.snapshot ?? null,
    info: q?.info ?? null,
    last: q?.snapshot.last ?? null,
    pct: q?.info.pct ?? null,
    change: q?.info.change ?? null,
    decimals: decimalsOf(code, type),
    index: isIndex(code, type),
  };
}

export type QuoteView = ReturnType<typeof quoteView>;

export const INDICES: { code: string; name: string }[] = [
  { code: 'sh000001', name: '上证指数' },
  { code: 'sz399001', name: '深证成指' },
  { code: 'sz399006', name: '创业板指' },
  { code: 'sh000300', name: '沪深300' },
  { code: 'sh000905', name: '中证500' },
  { code: 'sh000906', name: '中证800' },
  { code: 'sh000852', name: '中证1000' },
  { code: 'sh000688', name: '科创50' },
];

/** 榜单顺序仍来自低频排行；本分段已获取的快照独立更新价格、涨幅和成交额。 */
export function rankQuote(
  sim: Simulator,
  row: RankItem,
  since: number,
): RankItem {
  const q = sim.quote(row.code);
  if (!q || sim.quoteReceivedAt(row.code) < since) {
    return row;
  }
  return {
    ...row,
    last: q.snapshot.last,
    change: q.info.change,
    pct: q.info.pct,
    amount: q.snapshot.amount,
    volume: q.snapshot.volume,
  };
}
