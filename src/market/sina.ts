/**
 * 新浪行情：只用来做 ETF 排行。腾讯排行接口没有 ETF 板块（2026-10-26 试过 etf / ETF / fund / lof 等，全部返回空），
 * 自己用腾讯快照排要把 1,700 多只 ETF 全部请求一遍，不划算。
 *
 * 排行只用来显示；点进去以后的详情、盘口和撮合仍然用腾讯快照，所以两边数据有出入也不会影响成交。
 *
 * 接口 `vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?node=etf_hq_fund`：
 * trade 现价（元）、pricechange 涨跌额、changepercent 涨跌幅（%）、volume 成交量（份）、amount 成交额（元）。
 * 这个列表包括债券、货币、黄金、跨境 ETF，它们实盘是 T+0，V1 按 T+1 处理（TRADING_RULES.md §3.6 ⚠️）。
 */
import type { RankItem, RankSort } from './tencent';
import { toLi } from './tencent';

export function sinaEtfRankUrl(sort: RankSort, count: number): string {
  const by = sort === 'amount' ? 'amount' : 'changepercent';
  const asc = sort === 'down' ? 1 : 0;
  return `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=1&num=${count}&sort=${by}&asc=${asc}&node=etf_hq_fund`;
}

export function parseSinaEtfRank(json: unknown): RankItem[] {
  if (!Array.isArray(json)) {
    return [];
  }
  const out: RankItem[] = [];
  for (const r of json) {
    const code = r?.symbol;
    if (typeof code !== 'string' || !/^(sh|sz)\d{6}$/.test(code)) {
      continue;
    }
    const volume = Number(r.volume) || 0;
    // 没有成交时新浪的 trade 是 0
    const last = volume > 0 ? toLi(String(r.trade)) : null;
    out.push({
      code,
      name: String(r.name ?? '').replace(/\s+/g, ''),
      type: 'ETF',
      last,
      change: last != null ? Math.round(Number(r.pricechange) * 1000) : null,
      pct: last != null ? Number(r.changepercent) : null,
      volume,
      amount: Math.round((Number(r.amount) || 0) * 100),
    });
  }
  return out;
}
