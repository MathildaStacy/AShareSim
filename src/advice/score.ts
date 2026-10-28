/**
 * 到期对账和记分卡（纯函数）。收益用前复权日线收盘价：起点是提出那天（非交易日顺延）的收盘，
 * 终点是到期日的收盘（停牌就用到期日之前最后一根）。超额 = 方向 ×（标的收益 − 基准收益）。
 */
import type { TradingCalendar } from '../engine/calendar';
import { T } from '../engine/session';
import type { KBar } from '../market/tencent';
import type { Review, ScoreLine } from './types';

export const MIN_SCORE_SAMPLE = 20;

/** 起点之后第 n 个交易日。 */
export function addTradingDays(
  cal: TradingCalendar,
  base: string,
  n: number,
): string {
  let d = base;
  for (let i = 0; i < n; i++) {
    d = cal.next(d);
  }
  return d;
}

export function datesOf(
  cal: TradingCalendar,
  createdDate: string,
  horizonDays: number,
): { baseDate: string; dueDate: string } {
  const baseDate = cal.onOrAfter(createdDate);
  return { baseDate, dueDate: addTradingDays(cal, baseDate, horizonDays) };
}

/** 到期日收盘之后（15:30 清算后）才对账。 */
export const isDue = (dueDate: string, now: { date: string; t: number }) =>
  now.date > dueDate || (now.date === dueDate && now.t >= T(15, 30));

/** 不晚于 date 的最后一根收盘价；起点要求正好是那一天或之前最近的一根。 */
export function closeOn(bars: KBar[], date: string): number | null {
  let out: number | null = null;
  for (const b of bars) {
    if (b.date <= date) {
      out = b.close;
    } else {
      break;
    }
  }
  return out;
}

export interface Leg {
  code: string;
  /** 调仓方案的目标权重；单只建议为 null（收益就是这只的收益）。 */
  weight: number | null;
  bars: KBar[];
}

/** 算一次复盘；缺数据时返回错误文字。 */
export function reviewOf(input: {
  legs: Leg[];
  dir: 1 | -1 | 0;
  benchmark: KBar[];
  baseDate: string;
  dueDate: string;
  at: string;
}): Review | string {
  const span = (bars: KBar[], code: string) => {
    const a = closeOn(bars, input.baseDate);
    const b = closeOn(bars, input.dueDate);
    if (a == null || b == null || a <= 0) {
      return (
        code + ' 缺少 ' + input.baseDate + ' 或 ' + input.dueDate + ' 的日线'
      );
    }
    return b / a - 1;
  };
  const legs: { code: string; ret: number }[] = [];
  for (const l of input.legs) {
    const r = span(l.bars, l.code);
    if (typeof r === 'string') {
      return r;
    }
    legs.push({ code: l.code, ret: r });
  }
  const rb = span(input.benchmark, '基准');
  if (typeof rb === 'string') {
    return rb;
  }
  const weighted = input.legs.some(l => l.weight != null);
  const ret = weighted
    ? input.legs.reduce((n, l, i) => n + (l.weight ?? 0) * legs[i].ret, 0)
    : legs[0]?.ret ?? 0;
  const excess = input.dir === 0 ? null : input.dir * (ret - rb);
  return {
    at: input.at,
    baseDate: input.baseDate,
    dueDate: input.dueDate,
    ret,
    benchmarkRet: rb,
    excess,
    hit: excess == null ? null : excess > 0,
    legs,
  };
}

export function scoreLine(
  rows: { review?: Review | null; dueDate: string; watch: boolean }[],
): ScoreLine {
  const done = rows.filter(r => r.review && !r.watch);
  const hits = done.filter(r => r.review!.hit).length;
  const dues = done.map(r => r.dueDate).sort();
  return {
    n: done.length,
    hits,
    hitRate: done.length ? hits / done.length : null,
    avgExcess: done.length
      ? done.reduce((n, r) => n + (r.review!.excess ?? 0), 0) / done.length
      : null,
    pending: rows.filter(r => !r.review).length,
    watch: rows.filter(r => r.watch).length,
    thin: done.length < MIN_SCORE_SAMPLE,
    firstDue: dues[0] ?? null,
    lastDue: dues.at(-1) ?? null,
  };
}

export const pctText = (v: number | null, sign = true) =>
  v == null ? '—' : (sign && v > 0 ? '+' : '') + (v * 100).toFixed(2) + '%';

export function scoreLineText(name: string, l: ScoreLine): string {
  return (
    name +
    '：已对账 ' +
    l.n +
    ' 条' +
    (l.n
      ? '，命中 ' +
        l.hits +
        '（' +
        pctText(l.hitRate, false) +
        '），平均超额 ' +
        pctText(l.avgExcess)
      : '') +
    '；未到期 ' +
    l.pending +
    '，观望 ' +
    l.watch +
    (l.firstDue ? '；对账日 ' + l.firstDue + '–' + l.lastDue : '') +
    (l.thin
      ? '（样本太少，少于 ' + MIN_SCORE_SAMPLE + ' 条，不足以下结论）'
      : '')
  );
}
