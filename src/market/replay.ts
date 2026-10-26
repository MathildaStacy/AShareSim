/**
 * 补撮合：App 被停、被杀或断网时没有实时快照，下次打开时用腾讯分时数据（每分钟一个点）把中断的那段补出来，
 * 再喂给引擎。
 *
 * 补出来的快照只有最新价和累计量，没有盘口，标记为 reconstructed。引擎对它只做「成交价穿过委托价」的判断：
 * 某一分钟的价格比委托价更好，说明这个价位的单子必然已经全部成交，一定成立；排队、集合竞价等于开盘价 / 收盘价
 * 这些需要盘口的情况一律按没成交处理（宁可保守）。
 */
import type { DateStr } from '../engine/calendar';
import {
  BOARD_RULES,
  computeLimits,
  type Security,
} from '../engine/securities';
import type { Sec } from '../engine/session';
import type { Snapshot } from '../engine/types';
import type { Li } from '../engine/units';
import type { MinuteDay } from './tencent';

export interface GapRange {
  /** 已经有实时快照覆盖到的时间：只补严格晚于它一整分钟的点，避免把它之前的成交算进来。 */
  from: Sec;
  /** 下一个实时快照的时间（没有就是收盘以后）：只补早于它的点。 */
  to: Sec;
}

export interface GapBase {
  prevClose: Li;
  up: Li | null;
  down: Li | null;
  open: Li | null;
  /** 中断前最后一个实时快照的最高 / 最低价（当天没有就是 null）。 */
  high: Li | null;
  low: Li | null;
}

/** 没有当天的实时快照时，用前收盘价自算涨跌停（以后有了实时快照还是以接口给的为准）。 */
export function baseFromPrevClose(sec: Security, prevClose: Li): GapBase {
  const rule = BOARD_RULES[sec.board];
  const lim = sec.noPriceLimit
    ? { up: null, down: null }
    : computeLimits(prevClose, rule.defaultLimitPct, rule.tickLi);
  return {
    prevClose,
    up: lim.up,
    down: lim.down,
    open: null,
    high: null,
    low: null,
  };
}

/**
 * 把一天的分时转成补出来的快照。分时点「0931」是 9:30–9:31 这一分钟的最后成交价和截至 9:31 的累计量，
 * 时间记为 9:31:00。
 */
export function gapSnapshots(
  code: string,
  day: MinuteDay,
  base: GapBase,
  range: GapRange,
): Snapshot[] {
  const out: Snapshot[] = [];
  let high = base.high;
  let low = base.low;
  const first = day.points[0];
  const open = base.open ?? first?.price ?? null;
  for (const p of day.points) {
    high = high == null || p.price > high ? p.price : high;
    low = low == null || p.price < low ? p.price : low;
    if (p.t < range.from + 60 || p.t >= range.to) {
      continue;
    }
    out.push({
      code,
      date: day.date as DateStr,
      t: p.t,
      prevClose: base.prevClose,
      open,
      last: p.price,
      high,
      low,
      volume: p.volume,
      amount: p.amount,
      bids: [],
      asks: [],
      up: base.up,
      down: base.down,
      reconstructed: true,
    });
  }
  return out;
}

/** 多只证券补出来的快照按时间合并，引擎按时间顺序处理。 */
export function mergeByTime(lists: Snapshot[][]): Snapshot[] {
  return lists
    .flat()
    .sort((a, b) =>
      a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.t - b.t,
    );
}
