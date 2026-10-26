/**
 * 分时图和 K 线图的数据计算，和画图分开，方便测试。价格厘、量股、额分。
 */
import { CLOSE, T, type Sec } from '../../engine/session';
import type { Snapshot } from '../../engine/types';
import type { Li } from '../../engine/units';
import type { KBar, MinutePoint } from '../../market/tencent';

/** 分时横轴：9:30 → 0，11:30 和 13:00 都是 120，15:00 → 240。 */
export const MINUTES = 240;

export function minuteX(t: Sec): number {
  if (t <= T(11, 30)) {
    return Math.max(0, (t - T(9, 30)) / 60);
  }
  if (t < T(13, 0)) {
    return 120;
  }
  return 120 + (t - T(13, 0)) / 60;
}

export interface MinuteSeries {
  x: number[];
  price: Li[];
  /** 均价线 = 累计成交额 ÷ 累计成交量；指数没有意义，为 null。 */
  avg: (Li | null)[] | null;
  /** 每分钟成交量（股），由累计量相减；up 表示这一分钟收盘价不低于上一分钟。 */
  volume: number[];
  up: boolean[];
  /** 纵轴上下界，以昨收为中轴对称。 */
  top: Li;
  bottom: Li;
}

/**
 * points 是 minute/query 的分时（含 15:05 以后的盘后点，这里不画）。
 * 9:30 那个点的量包括开盘集合竞价的成交量，和券商 App 一样画在第一根。
 */
export function minuteSeries(
  points: MinutePoint[],
  prevClose: Li,
  withAvg: boolean,
): MinuteSeries {
  const pts = points.filter(p => p.t >= T(9, 30) && p.t <= CLOSE);
  const x = pts.map(p => minuteX(p.t));
  const price = pts.map(p => p.price);
  const avg = withAvg
    ? pts.map(p =>
        p.volume > 0 ? Math.round((p.amount * 10) / p.volume) : null,
      )
    : null;
  const volume = pts.map((p, i) =>
    Math.max(0, p.volume - (i ? pts[i - 1].volume : 0)),
  );
  const up = pts.map((p, i) => p.price >= (i ? pts[i - 1].price : prevClose));
  let dev = prevClose * 0.005; // 至少 ±0.5%，平盘时不至于一条直线贴满
  for (const v of price) {
    dev = Math.max(dev, Math.abs(v - prevClose));
  }
  for (const v of avg ?? []) {
    if (v != null) {
      dev = Math.max(dev, Math.abs(v - prevClose));
    }
  }
  dev *= 1.05;
  return {
    x,
    price,
    avg,
    volume,
    up,
    top: prevClose + dev,
    bottom: prevClose - dev,
  };
}

/** 简单移动平均：前 n−1 根为 null。 */
export function movingAverage(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) {
      sum -= values[i - n];
    }
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

/**
 * 用实时快照更新最后一根 K 线：日 K 同一天就替换，快照是新的一天就追加；
 * 周 K 只在同一周里更新最高、最低、收盘（成交量用接口的，周内累计我们算不准）。
 */
export function patchLastBar(
  bars: KBar[],
  snap: Snapshot | null,
  period: 'day' | 'week',
): KBar[] {
  if (
    !snap ||
    snap.last == null ||
    snap.open == null ||
    snap.high == null ||
    snap.low == null ||
    !bars.length
  ) {
    return bars;
  }
  const last = bars[bars.length - 1];
  if (period === 'day') {
    const today: KBar = {
      date: snap.date,
      open: snap.open,
      close: snap.last,
      high: snap.high,
      low: snap.low,
      volume: snap.volume,
    };
    if (last.date === snap.date) {
      return [...bars.slice(0, -1), today];
    }
    return last.date < snap.date ? [...bars, today] : bars;
  }
  if (sameWeek(last.date, snap.date) && last.date <= snap.date) {
    return [
      ...bars.slice(0, -1),
      {
        ...last,
        date: snap.date,
        close: snap.last,
        high: Math.max(last.high, snap.high),
        low: Math.min(last.low, snap.low),
      },
    ];
  }
  return bars;
}

/** 两个日期是否在同一周（周一开始）。 */
export function sameWeek(a: string, b: string): boolean {
  const monday = (d: string) => {
    const x = new Date(d + 'T00:00:00Z');
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return x.toISOString().slice(0, 10);
  };
  return monday(a) === monday(b);
}

/** K 线图取最近 n 根，并给出这几根对应的均线和纵轴范围。 */
export function klineView(bars: KBar[], n: number) {
  const closes = bars.map(b => b.close);
  const off = Math.max(0, bars.length - n);
  const view = bars.slice(off);
  const ma = (k: number) => movingAverage(closes, k).slice(off);
  const ma5 = ma(5);
  const ma10 = ma(10);
  const ma20 = ma(20);
  let hi = -Infinity;
  let lo = Infinity;
  for (const b of view) {
    hi = Math.max(hi, b.high);
    lo = Math.min(lo, b.low);
  }
  for (const line of [ma5, ma10, ma20]) {
    for (const v of line) {
      if (v != null) {
        hi = Math.max(hi, v);
        lo = Math.min(lo, v);
      }
    }
  }
  const pad = (hi - lo) * 0.05 || hi * 0.01 || 1;
  return {
    bars: view,
    ma5,
    ma10,
    ma20,
    hi: hi + pad,
    lo: lo - pad,
    vmax: Math.max(1, ...view.map(b => b.volume)),
  };
}

/**
 * 分时数据每 30 秒取一次，中间用实时快照补一个点，让价格线跟着动。
 * 只在当天、连续竞价的时间里补；15:00 以后的快照不补（分时里已经有 15:00 的点）。
 */
export function withLivePoint(
  points: MinutePoint[],
  snap: Snapshot | null,
  date: string,
): MinutePoint[] {
  if (!snap || snap.last == null || snap.date !== date) {
    return points;
  }
  const t = snap.t;
  if (t < T(9, 30) || (t > T(11, 30) && t < T(13, 0)) || t > CLOSE) {
    return points;
  }
  const last = points[points.length - 1];
  if (last && last.t >= t) {
    return points;
  }
  return [
    ...points,
    { t, price: snap.last, volume: snap.volume, amount: snap.amount },
  ];
}
