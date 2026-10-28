/**
 * M6：哪些日期可以回放。快照只在 App 开着（或后台跟踪）时录，所以要看每只证券录到了多少。
 */
import type { Db } from '../data/db';
import type { DateStr } from '../engine/calendar';
import { CLOSE, T, type Sec } from '../engine/session';

/** 连续竞价共 240 分钟。 */
export const TRADING_MINUTES = 240;

export interface CodeCoverage {
  code: string;
  name: string;
  count: number;
  first: Sec;
  last: Sec;
  /** 连续竞价里录到快照的分钟数（0–240）。 */
  minutes: number;
  /** 录到了 9:25–9:30 的快照（开盘集合竞价能按真实开盘量判断）。 */
  openAuction: boolean;
}

export interface ReplayDay {
  date: DateStr;
  codes: CodeCoverage[];
  /** 覆盖最好的那只证券的覆盖率（0–1）。 */
  best: number;
}

export const coverageOf = (c: CodeCoverage) => c.minutes / TRADING_MINUTES;

export function gradeOf(coverage: number): '完整' | '大部分' | '部分' | '零散' {
  return coverage >= 0.95
    ? '完整'
    : coverage >= 0.7
    ? '大部分'
    : coverage >= 0.3
    ? '部分'
    : '零散';
}

/**
 * 可以回放的日期（新的在前）：有快照、早于今天；今天收盘以后也可以。
 * 名称取当天的证券状态（数据中心记的），没有就用证券表里的。
 */
export async function replayDays(
  db: Db,
  today: { date: DateStr; t: Sec },
): Promise<ReplayDay[]> {
  const rows = await db.all<{
    date: string;
    code: string;
    n: number;
    first: number;
    last: number;
    minutes: number;
    auc: number;
    day_name: string | null;
    name: string | null;
  }>(
    `SELECT q.date, q.code, COUNT(*) AS n, MIN(q.t) AS first, MAX(q.t) AS last,
       COUNT(DISTINCT CASE WHEN (q.t >= ? AND q.t < ?) OR (q.t >= ? AND q.t < ?) THEN q.t / 60 END) AS minutes,
       MAX(CASE WHEN q.t >= ? AND q.t < ? THEN 1 ELSE 0 END) AS auc,
       json_extract(d.body, '$.name') AS day_name, s.name AS name
     FROM quotes_snapshot q
     LEFT JOIN security_day d ON d.code = q.code AND d.date = q.date
     LEFT JOIN security s ON s.code = q.code
     WHERE q.date < ? OR (q.date = ? AND ? >= ?)
     GROUP BY q.date, q.code
     ORDER BY q.date DESC, minutes DESC, q.code`,
    [
      T(9, 30),
      T(11, 30),
      T(13, 0),
      CLOSE,
      T(9, 25),
      T(9, 30),
      today.date,
      today.date,
      today.t,
      CLOSE,
    ],
  );
  const days: ReplayDay[] = [];
  for (const r of rows) {
    let day = days[days.length - 1];
    if (!day || day.date !== r.date) {
      day = { date: r.date, codes: [], best: 0 };
      days.push(day);
    }
    const c: CodeCoverage = {
      code: r.code,
      name: r.day_name ?? r.name ?? r.code,
      count: Number(r.n),
      first: Number(r.first),
      last: Number(r.last),
      minutes: Math.min(TRADING_MINUTES, Number(r.minutes)),
      openAuction: Number(r.auc) > 0,
    };
    day.codes.push(c);
    day.best = Math.max(day.best, coverageOf(c));
  }
  return days;
}

/** 盲测从覆盖率够高的日期里随机挑一天，证券按覆盖率取前几只。 */
export function pickBlind(
  days: ReplayDay[],
  random: () => number = Math.random,
  max = 6,
): { date: DateStr; codes: string[] } | null {
  const good = days.filter(d => d.best >= 0.6);
  if (!good.length) {
    return null;
  }
  const day = good[Math.floor(random() * good.length) % good.length];
  return {
    date: day.date,
    codes: day.codes
      .filter(c => coverageOf(c) >= 0.6)
      .slice(0, max)
      .map(c => c.code),
  };
}
