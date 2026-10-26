import {
  classify,
  DEFAULT_FEE_PROFILE,
  Engine,
  isSTName,
  newAccount,
  TradingCalendar,
  yuanToLi,
  type FeeProfile,
  type Level,
  type Security,
  type Snapshot,
} from '../../../src/engine';
import realData from '../../../docs/design/prototype/snapshot-2026-10-26.json';

/** 2026-10-26 11:30 从腾讯接口抓的真实行情（原型用的同一份数据）。 */
export interface RealQuote {
  name: string;
  code: string;
  price: number;
  prev: number;
  open: number;
  vol: number;
  bids: [number, number][];
  asks: [number, number][];
  high: number;
  low: number;
  amount: number;
  up: number;
  down: number;
  type: string;
}
export const REAL = realData as unknown as {
  quotes: Record<string, RealQuote>;
  kline: Record<string, [string, number, number, number, number, number][]>;
};

const NAMES: Record<string, string> = {
  sh600036: '招商银行',
  sh600519: '贵州茅台',
  sz000001: '平安银行',
  sz300750: '宁德时代',
  sh688981: '中芯国际',
  sh510300: '沪深300ETF',
  sz159915: '创业板ETF',
  sz000858: '五粮液',
  sz002024: 'ST易购',
  sh603000: '人民网',
};

export function security(code: string): Security | null {
  const c = classify(code, REAL.quotes[code]?.type);
  if (!c) return null;
  const name = REAL.quotes[code]?.name ?? NAMES[code] ?? code;
  return { code, name, ...c, st: isSTName(name) };
}

export const calendar = new TradingCalendar();

export function makeEngine(
  date = '2026-10-26',
  fee: Partial<FeeProfile> = {},
): Engine {
  return new Engine(
    newAccount(date, { fee: { ...DEFAULT_FEE_PROFILE, ...fee } }),
    { calendar, security },
  );
}

const lv = (rows: [number, number][]): Level[] =>
  rows.map(([p, q]) => [yuanToLi(p), q]);

export interface SnapIn {
  code: string;
  date?: string;
  t: number;
  prev: number;
  last?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number;
  bids?: [number, number][];
  asks?: [number, number][];
  up?: number | null;
  down?: number | null;
}

/** 用元写快照，转成引擎用的厘。涨跌停默认按 ±10%。 */
export function snap(s: SnapIn): Snapshot {
  const li = (v: number | null | undefined) => (v == null ? null : yuanToLi(v));
  const up = s.up === undefined ? Math.round(s.prev * 110) / 100 : s.up;
  const down = s.down === undefined ? Math.round(s.prev * 90) / 100 : s.down;
  return {
    code: s.code,
    date: s.date ?? '2026-10-26',
    t: s.t,
    prevClose: yuanToLi(s.prev),
    open: li(s.open ?? (s.last != null ? s.prev : null)),
    last: li(s.last ?? null),
    high: li(s.high ?? s.last ?? null),
    low: li(s.low ?? s.last ?? null),
    volume: s.volume ?? 0,
    amount: 0,
    bids: lv(s.bids ?? []),
    asks: lv(s.asks ?? []),
    up: li(up),
    down: li(down),
  };
}

/** 真实快照转成引擎快照（腾讯的量单位是手）。 */
export function realSnap(code: string, t: number): Snapshot {
  const q = REAL.quotes[code];
  return {
    code,
    date: '2026-10-26',
    t,
    prevClose: yuanToLi(q.prev),
    open: yuanToLi(q.open),
    last: yuanToLi(q.price),
    high: yuanToLi(q.high),
    low: yuanToLi(q.low),
    volume: q.vol * 100,
    amount: Math.round(q.amount * 1_000_000),
    bids: q.bids
      .filter(b => b[1] > 0)
      .map(([p, v]) => [yuanToLi(p), v * 100] as Level),
    asks: q.asks
      .filter(a => a[1] > 0)
      .map(([p, v]) => [yuanToLi(p), v * 100] as Level),
    up: yuanToLi(q.up),
    down: yuanToLi(q.down),
  };
}
