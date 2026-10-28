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

export interface SinaQuote {
  code: string;
  date: string;
  time: string;
  open: number;
  prevClose: number;
  last: number;
  high: number;
  low: number;
  volume: number;
}
/** 新浪股票/ETF 报价数值字段；不依赖 GBK 名称，避免跨源编码影响核对。 */
export function parseSinaQuote(text: string, code: string): SinaQuote {
  const match = text.match(new RegExp('hq_str_' + code + '="([^"]*)"'));
  const v = match?.[1].split(',');
  if (!v || v.length < 32 || !/^\d{4}-\d{2}-\d{2}$/.test(v[30])) {
    throw new Error('新浪没有返回可核对的报价');
  }
  const numbers = [1, 2, 3, 4, 5, 8].map(i => Number(v[i]));
  if (numbers.some(n => !Number.isFinite(n) || n < 0)) {
    throw new Error('新浪报价数值无效');
  }
  return {
    code,
    date: v[30],
    time: v[31],
    open: Math.round(numbers[0] * 1000),
    prevClose: Math.round(numbers[1] * 1000),
    last: Math.round(numbers[2] * 1000),
    high: Math.round(numbers[3] * 1000),
    low: Math.round(numbers[4] * 1000),
    volume: numbers[5],
  };
}
