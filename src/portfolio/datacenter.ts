import type { Db } from '../data/db';
import * as repo from '../data/repos';
import { addDays, TradingCalendar } from '../engine/calendar';
import { classify, isSTName } from '../engine/securities';
import type { Snapshot } from '../engine/types';
import type { MarketClient } from '../market/client';
import type { SinaQuote } from '../market/sina';
import type { KBar } from '../market/tencent';
import { beijingIso } from '../market/clock';

export interface StockDay {
  code: string;
  date: string;
  name: string;
  board: string | null;
  st: boolean;
  mainPool: boolean;
  listedOneYear: null;
  suspended: boolean;
  openUp: boolean | null;
  openDown: boolean | null;
  observedAt: string;
}
export async function recordStockDay(
  db: Db,
  snapshot: Snapshot,
  name: string,
  type: string,
): Promise<void> {
  const sec = classify(snapshot.code, type);
  if (!sec) {
    return;
  }
  const body: StockDay = {
    code: snapshot.code,
    date: snapshot.date,
    name,
    board: sec.board,
    st: isSTName(name),
    mainPool: sec.board === 'main' && !isSTName(name),
    listedOneYear: null,
    suspended: !!snapshot.suspended,
    openUp:
      snapshot.open == null || snapshot.up == null
        ? null
        : snapshot.open === snapshot.up,
    openDown:
      snapshot.open == null || snapshot.down == null
        ? null
        : snapshot.open === snapshot.down,
    observedAt: beijingIso(),
  };
  await db.run(
    'INSERT INTO security_day VALUES (?,?,?,?) ON CONFLICT(code,date) DO UPDATE SET body=excluded.body,observed_at=excluded.observed_at',
    [body.code, body.date, JSON.stringify(body), body.observedAt],
  );
}
export async function stockDay(
  db: Db,
  code: string,
  date: string,
): Promise<StockDay | null> {
  const row = await db.get<{ body: string }>(
    'SELECT body FROM security_day WHERE code=? AND date=?',
    [code, date],
  );
  return row ? JSON.parse(row.body) : null;
}
export async function inventory(db: Db) {
  const tables = [
    ['quotes_snapshot', '行情快照', 'date'],
    ['kline_day', '不复权日线', 'date'],
    ['security', '证券资料', 'updated_at'],
    ['security_day', '每日证券状态', 'observed_at'],
    ['corp_action', '分红送配', 'fetched_at'],
    ['trade_calendar', '交易日历', 'updated_at'],
    ['account_event', '账户事件', 'ts'],
    ['data_check', '交叉核对', 'checked_at'],
  ];
  return Promise.all(
    tables.map(async ([table, name, at]) => {
      const r = await db.get<{ rows: number; at: string | null }>(
        `SELECT COUNT(*) AS rows,MAX(${at}) AS at FROM ${table}`,
      );
      return { table, name, rows: Number(r?.rows ?? 0), at: r?.at ?? null };
    }),
  );
}
export function quality(bars: KBar[], calendar: TradingCalendar): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  // Only 2026 has a complete holiday schedule in the bundled calendar.
  const unconfirmedYears = [...new Set(bars.map(b => b.date.slice(0, 4)))]
    .filter(year => year !== '2026')
    .sort();
  if (unconfirmedYears.length) {
    issues.push(
      `${unconfirmedYears.join(
        '、',
      )} 年休市日历未确认，未判断这些年份的日线缺失；OHLC 与成交量仍已检查`,
    );
  }
  for (const b of bars) {
    if (seen.has(b.date)) {
      issues.push(b.date + ' 重复日线');
    }
    seen.add(b.date);
    if (
      ![b.open, b.close, b.high, b.low, b.volume].every(Number.isFinite) ||
      b.low <= 0 ||
      b.volume < 0 ||
      b.high < Math.max(b.open, b.close, b.low) ||
      b.low > Math.min(b.open, b.close)
    ) {
      issues.push(b.date + ' OHLC/成交量异常');
    }
    if (!calendar.isTradingDay(b.date)) {
      issues.push(b.date + ' 非交易日日线，请核对日历');
    }
  }
  const dates = [...seen].sort();
  if (dates.length > 1) {
    for (const date of calendar.between(dates[0], dates[dates.length - 1])) {
      if (date.startsWith('2026-') && !seen.has(date)) {
        issues.push(date + ' 缺日线（需区分停牌与数据缺失）');
      }
    }
  }
  return issues;
}
export async function updateBars(
  db: Db,
  client: MarketClient,
  code: string,
  type: string,
  today: string,
) {
  const last = await db.get<{ date: string | null }>(
    'SELECT MAX(date) AS date FROM kline_day WHERE code=?',
    [code],
  );
  const bars = last?.date
    ? await client.klineRange(code, type, addDays(last.date, -7), today, '')
    : await client.kline(code, type, 'day', 1000, '');
  if (!bars.length) {
    throw new Error('行情源未返回日线，本地数据保留');
  }
  const closed = bars.filter(b => b.date <= today);
  await db.transaction(async tx => {
    for (const b of closed) {
      if (![b.open, b.close, b.high, b.low, b.volume].every(Number.isFinite)) {
        throw new Error('日线含无效数值，未写入');
      }
      await tx.run(
        'INSERT INTO kline_day VALUES (?,?,?,?,?,?,?) ON CONFLICT(code,date) DO UPDATE SET open=excluded.open,close=excluded.close,high=excluded.high,low=excluded.low,volume=excluded.volume',
        [code, b.date, b.open, b.close, b.high, b.low, b.volume],
      );
    }
    await repo.setSetting(tx, 'dataUpdated:' + code, beijingIso());
  });
  return closed.length;
}
export interface CrossCheck {
  code: string;
  checkedAt: string;
  tencentDate: string;
  tencentTime: number;
  sinaDate: string;
  sinaTime: string;
  comparable: boolean;
  differences: string[];
  tencentPrice: number | null;
  sinaPrice: number;
}
export function compareQuotes(a: Snapshot, b: SinaQuote): CrossCheck {
  const parts = b.time.split(':').map(Number),
    time = parts[0] * 3600 + parts[1] * 60 + parts[2];
  const comparable =
    a.date === b.date && Number.isFinite(time) && Math.abs(a.t - time) <= 10;
  const differences: string[] = [];
  if (!comparable) {
    differences.push('报价时间不一致，不能判定价格差异');
  } else {
    if (a.last !== b.last) {
      differences.push('最新价不同');
    }
    if (a.prevClose !== b.prevClose) {
      differences.push('前收价不同');
    }
    if (a.open != null && a.open !== b.open) {
      differences.push('开盘价不同');
    }
    if (a.volume !== b.volume) {
      differences.push('成交量不同（可能存在采样时差）');
    }
  }
  return {
    code: a.code,
    checkedAt: beijingIso(),
    tencentDate: a.date,
    tencentTime: a.t,
    sinaDate: b.date,
    sinaTime: b.time,
    comparable,
    differences,
    tencentPrice: a.last,
    sinaPrice: b.last,
  };
}
export async function crossCheck(
  db: Db,
  client: MarketClient,
  code: string,
): Promise<CrossCheck> {
  const [quotes, sina] = await Promise.all([
    client.quotes([code]),
    client.sinaQuote(code),
  ]);
  const q = quotes.find(x => x.snapshot.code === code);
  if (!q) {
    throw new Error('腾讯没有返回报价');
  }
  const check = compareQuotes(q.snapshot, sina);
  await db.run(
    'INSERT INTO data_check(code,date,body,checked_at) VALUES (?,?,?,?)',
    [code, q.snapshot.date, JSON.stringify(check), check.checkedAt],
  );
  return check;
}
