/**
 * 北京时间。引擎的日期和时间都按北京时间，和手机设成哪个时区无关（中国没有夏令时，固定 UTC+8）。
 */
import type { DateStr } from '../engine/calendar';
import type { Sec } from '../engine/session';

export interface BeijingNow {
  date: DateStr;
  t: Sec;
}

export function beijingTime(ms: number): BeijingNow {
  const d = new Date(ms + 8 * 3600_000);
  return {
    date: d.toISOString().slice(0, 10),
    t: d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds(),
  };
}

export function beijingNow(): BeijingNow {
  return beijingTime(Date.now());
}

/** 本地时间戳（ISO，带 +08:00），写日志用。 */
export function beijingIso(ms = Date.now()): string {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 19) + '+08:00';
}
