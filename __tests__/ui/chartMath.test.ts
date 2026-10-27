/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { T } from '../../src/engine';
import type { Snapshot } from '../../src/engine/types';
import { parseMinute, type KBar } from '../../src/market/tencent';
import {
  klineView,
  minuteSeries,
  minuteX,
  movingAverage,
  patchLastBar,
  sameWeek,
  withLivePoint,
  nearestChartPoint,
  chartCursorY,
} from '../../src/ui/charts/chartMath';

const day = parseMinute(
  JSON.parse(
    readFileSync(
      join(__dirname, '..', 'market', 'fixtures', 'minute-sh600036.json'),
      'utf8',
    ),
  ),
  'sh600036',
  'GP-A',
)!;
const PREV = 41_770; // 招商银行 10-23 收盘

const snap = (over: Partial<Snapshot>): Snapshot => ({
  code: 'sh600036',
  date: '2026-10-26',
  t: T(14, 53, 30),
  prevClose: PREV,
  open: 41_490,
  last: 42_310,
  high: 42_350,
  low: 41_430,
  volume: 83_500_000,
  amount: 350_000_000_000,
  bids: [],
  asks: [],
  up: 45_950,
  down: 37_590,
  ...over,
});

describe('触摸查价坐标', () => {
  test('吸附真实数据点，越界夹紧；午休边界并列时取后一个真实时刻', () => {
    expect(nearestChartPoint([], 40)).toBe(-1);
    expect(nearestChartPoint([4, 10, 20], -100)).toBe(0);
    expect(nearestChartPoint([4, 10, 20], 999)).toBe(2);
    expect(nearestChartPoint([4, 10, 10, 20], 10)).toBe(2);
    expect(nearestChartPoint([4], 200)).toBe(0);
  });
  test('价格 / 成交量分别按绘图范围反算，间隔和越界不产生虚构坐标', () => {
    const price = { top: 14, bottom: 154, high: 50000, low: 40000 };
    const volume = { top: 170, bottom: 216, max: 460000 };
    expect(chartCursorY(-100, price, volume)).toEqual({
      y: 14,
      volume: false,
      value: 50000,
    });
    expect(chartCursorY(84, price, volume).value).toBe(45000);
    expect(chartCursorY(160, price, volume)).toEqual({
      y: 154,
      volume: false,
      value: 40000,
    });
    expect(chartCursorY(165, price, volume)).toEqual({
      y: 170,
      volume: true,
      value: 460000,
    });
    expect(chartCursorY(193, price, volume).value).toBe(230000);
    expect(chartCursorY(900, price, volume)).toEqual({
      y: 216,
      volume: true,
      value: 0,
    });
    expect(
      chartCursorY(84, { ...price, high: 42000, low: 42000 }, volume).value,
    ).toBe(42000);
    expect(chartCursorY(193, price, { ...volume, max: 0 }).value).toBe(0);
  });
});

describe('分时', () => {
  test('横轴：9:30 → 0，11:30 和 13:00 都是 120，15:00 → 240', () => {
    expect(minuteX(T(9, 30))).toBe(0);
    expect(minuteX(T(11, 30))).toBe(120);
    expect(minuteX(T(12, 10))).toBe(120);
    expect(minuteX(T(13, 0))).toBe(120);
    expect(minuteX(T(15, 0))).toBe(240);
  });

  test('招商银行 10-26：均价 = 累计成交额 ÷ 累计成交量，每分钟量由累计量相减', () => {
    const s = minuteSeries(day.points, PREV, true);
    expect(s.x).toHaveLength(day.points.length);
    expect(s.x[0]).toBe(0);
    expect(s.x[s.x.length - 1]).toBe(120 + 113); // 14:53
    // 9:30 那一分钟包括开盘集合竞价：73,661,346 元 ÷ 1,775,400 股 = 41.49 元
    expect(s.avg![0]).toBe(41_490);
    expect(s.volume[0]).toBe(1_775_400);
    expect(s.volume[1]).toBe(day.points[1].volume - day.points[0].volume);
    expect(s.volume.every(v => v >= 0)).toBe(true);
    // 午休前后两个点量不变，中间那根量是 0
    const i1300 = day.points.findIndex(p => p.t === T(13, 0));
    expect(s.volume[i1300]).toBe(0);
    // 纵轴以昨收为中轴对称，盖住全部价格和均价
    expect(s.top - PREV).toBeCloseTo(PREV - s.bottom);
    expect(Math.max(...s.price)).toBeLessThanOrEqual(s.top);
    expect(Math.min(...s.price)).toBeGreaterThanOrEqual(s.bottom);
  });

  test('指数不画均价线；15:05 以后的盘后点不画', () => {
    const pts = [
      { t: T(14, 59), price: 42_480, volume: 100, amount: 4_248_000 },
      { t: T(15, 0), price: 42_500, volume: 200, amount: 8_498_000 },
      { t: T(15, 10), price: 42_500, volume: 210, amount: 8_923_000 },
    ];
    const s = minuteSeries(pts, PREV, false);
    expect(s.avg).toBeNull();
    expect(s.x).toEqual([239, 240]);
  });

  test('平盘时纵轴至少 ±0.5%', () => {
    const s = minuteSeries(
      [{ t: T(9, 30), price: PREV, volume: 100, amount: 417_700 }],
      PREV,
      true,
    );
    // 0.5% × 1.05（上下各留 5% 空白）
    expect(s.top).toBeCloseTo(PREV + PREV * 0.005 * 1.05);
    expect(s.bottom).toBeCloseTo(PREV - PREV * 0.005 * 1.05);
  });

  test('实时快照补一个点：当天、连续竞价时间、比最后一个分时点新才补', () => {
    const pts = day.points;
    const live = withLivePoint(pts, snap({}), day.date);
    expect(live).toHaveLength(pts.length + 1);
    expect(live[live.length - 1]).toEqual({
      t: T(14, 53, 30),
      price: 42_310,
      volume: 83_500_000,
      amount: 350_000_000_000,
    });
    expect(withLivePoint(pts, snap({ date: '2026-10-23' }), day.date)).toBe(
      pts,
    );
    expect(withLivePoint(pts, snap({ t: T(12, 0) }), day.date)).toBe(pts);
    expect(withLivePoint(pts, snap({ t: T(15, 2) }), day.date)).toBe(pts);
    expect(withLivePoint(pts, snap({ t: T(14, 0) }), day.date)).toBe(pts);
  });
});

describe('K 线', () => {
  const bar = (
    date: string,
    close: number,
    high = close,
    low = close,
  ): KBar => ({
    date,
    open: close,
    close,
    high,
    low,
    volume: 1000,
  });

  test('均线：前 n−1 根为空', () => {
    expect(movingAverage([1, 2, 3, 4, 5, 6], 3)).toEqual([
      null,
      null,
      2,
      3,
      4,
      5,
    ]);
  });

  test('只显示最近 n 根，但均线用全部数据算', () => {
    const bars = Array.from({ length: 30 }, (_, i) =>
      bar('2026-09-' + String(i + 1).padStart(2, '0'), (i + 1) * 1000),
    );
    const v = klineView(bars, 10);
    expect(v.bars).toHaveLength(10);
    expect(v.bars[0].close).toBe(21_000);
    // 第 21 根的 MA20 = (2 + … + 21) × 1000 ÷ 20 = 11,500
    expect(v.ma20[0]).toBe(11_500);
    expect(v.ma5[0]).toBe(19_000);
    expect(v.hi).toBeGreaterThan(30_000);
    expect(v.lo).toBeLessThan(v.ma20[0]!);
  });

  test('日 K：同一天用快照替换最后一根，新的一天追加', () => {
    const bars = [bar('2026-10-23', 41_770)];
    const same = patchLastBar([bar('2026-10-26', 41_500)], snap({}), 'day');
    expect(same).toEqual([
      {
        date: '2026-10-26',
        open: 41_490,
        close: 42_310,
        high: 42_350,
        low: 41_430,
        volume: 83_500_000,
      },
    ]);
    expect(patchLastBar(bars, snap({}), 'day')).toHaveLength(2);
    // 开盘前没有成交，不改
    expect(patchLastBar(bars, snap({ last: null }), 'day')).toBe(bars);
  });

  test('周 K：同一周只更新收盘、最高、最低', () => {
    const w = [bar('2026-10-26', 41_000, 41_200, 40_900)];
    const [x] = patchLastBar(w, snap({ t: T(10, 0) }), 'week');
    expect(x).toMatchObject({
      close: 42_310,
      high: 42_350,
      low: 40_900,
      volume: 1000,
    });
    const lastWeek = [bar('2026-10-23', 41_770)];
    expect(patchLastBar(lastWeek, snap({}), 'week')).toBe(lastWeek);
  });

  test('同一周（周一开始）', () => {
    expect(sameWeek('2026-10-26', '2026-10-30')).toBe(true);
    expect(sameWeek('2026-10-25', '2026-10-26')).toBe(false); // 周日和周一
    expect(sameWeek('2026-10-23', '2026-10-26')).toBe(false);
  });
});
