/** 界面上的数字格式：价格按品种位数（股票 2 位、ETF 3 位、指数 2 位），成交量用手，金额用亿 / 万。 */
import { classify, isSTName, type Board } from '../engine/securities';
import type { Fen, Li } from '../engine/units';

export function boardOf(code: string, type?: string): Board | null {
  return classify(code, type)?.board ?? null;
}

export function decimalsOf(code: string, type?: string): 2 | 3 {
  return boardOf(code, type) === 'etf' ? 3 : 2;
}

export const isIndex = (code: string, type?: string) =>
  type === 'ZS' || (type == null && boardOf(code) == null);

export function fmtPrice(li: Li | null | undefined, decimals: number): string {
  return li == null ? '--' : (li / 1000).toFixed(decimals);
}

export function fmtChange(li: Li | null | undefined, decimals: number): string {
  if (li == null) {
    return '--';
  }
  return (li > 0 ? '+' : '') + (li / 1000).toFixed(decimals);
}

export function fmtPct(pct: number | null | undefined): string {
  if (pct == null) {
    return '--';
  }
  return (pct > 0 ? '+' : '') + pct.toFixed(2) + '%';
}

/** 成交量：股 → 手，大了用万手 / 亿手。 */
export function fmtHands(shares: number): string {
  const h = shares / 100;
  if (h >= 1e8) {
    return (h / 1e8).toFixed(2) + '亿手';
  }
  if (h >= 1e4) {
    return (h / 1e4).toFixed(2) + '万手';
  }
  return Math.round(h) + '手';
}

/** 金额：分 → 亿 / 万 / 元。 */
export function fmtAmount(fen: Fen): string {
  const y = fen / 100;
  if (y >= 1e8) {
    return (y / 1e8).toFixed(2) + '亿';
  }
  if (y >= 1e4) {
    return (y / 1e4).toFixed(1) + '万';
  }
  return y.toFixed(0) + '元';
}

/** 市值（接口给的是亿元）。 */
export function fmtCap(yi: number | null | undefined): string {
  if (yi == null) {
    return '--';
  }
  return yi >= 1e4 ? (yi / 1e4).toFixed(2) + '万亿' : yi.toFixed(0) + '亿';
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  return v == null ? '--' : v.toFixed(digits);
}

/** 板块标签：ST / 创 / 科 / ETF。 */
export function tagsOf(code: string, name: string, type?: string): string[] {
  const out: string[] = [];
  if (isSTName(name)) {
    out.push('ST');
  }
  const b = boardOf(code, type);
  if (b === 'cyb') {
    out.push('创');
  } else if (b === 'kcb') {
    out.push('科');
  } else if (b === 'etf') {
    out.push('ETF');
  }
  return out;
}

export type Trend = 'up' | 'down' | 'flat';

export function trendOf(v: number | null | undefined): Trend {
  return v == null || v === 0 ? 'flat' : v > 0 ? 'up' : 'down';
}
