/**
 * 交易日历。日期统一用 'YYYY-MM-DD' 字符串。
 *
 * 休市日来源：2026 年的休市日由真实日 K 线反推（2026-10-26 抓取的上证指数日线里缺失的工作日），
 * 之后年份按国务院放假安排和交易所休市通知补充；App 运行时可以用行情接口返回的日线更新。
 */
export type DateStr = string;

/** 交易所休市的工作日（周末本来就休市，不列）。 */
export const HOLIDAYS: readonly DateStr[] = [
  // 2026（由真实日 K 线反推）
  '2026-01-01',
  '2026-01-02',
  '2026-02-16',
  '2026-02-17',
  '2026-02-18',
  '2026-02-19',
  '2026-02-20',
  '2026-02-23',
  '2026-04-06',
  '2026-05-01',
  '2026-05-04',
  '2026-05-05',
  '2026-06-19',
  '2026-09-25',
  '2026-10-01',
  '2026-10-02',
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
  // 2027：⚠️ 等交易所公布休市安排后更新。元旦先按 1 月 1 日休市处理
  '2027-01-01',
];

function parse(d: DateStr): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function format(d: Date): DateStr {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: DateStr, n: number): DateStr {
  const x = parse(d);
  x.setUTCDate(x.getUTCDate() + n);
  return format(x);
}

/** 加月份，月末对齐（1 月 31 日加 1 个月是 2 月 28/29 日）。 */
export function addMonths(d: DateStr, n: number): DateStr {
  const x = parse(d);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  const last = new Date(
    Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0),
  ).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return format(x);
}

export function weekday(d: DateStr): number {
  return parse(d).getUTCDay();
}

export class TradingCalendar {
  private readonly holidays: Set<DateStr>;

  constructor(holidays: readonly DateStr[] = HOLIDAYS) {
    this.holidays = new Set(holidays);
  }

  isTradingDay(d: DateStr): boolean {
    const wd = weekday(d);
    return wd !== 0 && wd !== 6 && !this.holidays.has(d);
  }

  /** 严格晚于 d 的第一个交易日。 */
  next(d: DateStr): DateStr {
    let x = addDays(d, 1);
    while (!this.isTradingDay(x)) {
      x = addDays(x, 1);
    }
    return x;
  }

  /** 严格早于 d 的最后一个交易日。 */
  prev(d: DateStr): DateStr {
    let x = addDays(d, -1);
    while (!this.isTradingDay(x)) {
      x = addDays(x, -1);
    }
    return x;
  }

  /** d 是交易日就返回 d，否则返回下一个交易日。 */
  onOrAfter(d: DateStr): DateStr {
    return this.isTradingDay(d) ? d : this.next(d);
  }

  /** (from, to] 之间的交易日，按时间顺序。 */
  between(from: DateStr, to: DateStr): DateStr[] {
    const out: DateStr[] = [];
    let x = from;
    while (x < to) {
      x = this.next(x);
      if (x <= to) {
        out.push(x);
      }
    }
    return out;
  }
}
