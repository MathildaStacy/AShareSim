/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { T, yuanToLi } from '../../src/engine';
import {
  baseFromPrevClose,
  gapSnapshots,
  mergeByTime,
} from '../../src/market/replay';
import { parseMinute, parseMinuteDays } from '../../src/market/tencent';
import { makeEngine, security, snap } from '../engine/helpers/fixtures';

const json = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));

/** 招商银行 2026-10-26 真实分时：10:00 是 41.88，13:37 跌到全天低点 41.62。 */
const day = parseMinute(json('minute-sh600036.json'), 'sh600036', 'GP-A')!;
const li = yuanToLi;

describe('分时补出来的快照', () => {
  test('只补中断之后整分钟的点，带上累计量和到当时为止的最高最低价', () => {
    const base = {
      prevClose: li(41.77),
      up: li(45.95),
      down: li(37.59),
      open: li(41.49),
      high: li(41.95),
      low: li(41.43),
    };
    const s = gapSnapshots('sh600036', day, base, {
      from: T(10, 0, 5),
      to: T(14, 0),
    });
    expect(s[0].t).toBe(T(10, 2)); // 10:01 这一分钟有一部分在 10:00:05 之前，不补
    expect(s[s.length - 1].t).toBe(T(13, 59));
    expect(s.every(x => x.reconstructed && x.bids.length === 0)).toBe(true);
    const at1337 = s.find(x => x.t === T(13, 37))!;
    expect(at1337.last).toBe(li(41.62));
    expect(at1337.low).toBe(li(41.43));
    expect(at1337.volume).toBe(48_462_200);
  });

  test('前几天的分时带前收盘价，没有实时快照时自算涨跌停', () => {
    const days = parseMinuteDays(
      json('day5-sh600036.json'),
      'sh600036',
      'GP-A',
    );
    expect(days.map(d => d.date)).toEqual([
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-26',
    ]);
    const d23 = days[3];
    expect(d23.prevClose).toBe(li(41.82));
    const base = baseFromPrevClose(security('sh600036')!, d23.prevClose!);
    expect(base).toMatchObject({ up: li(46), down: li(37.64) });
    // 15:06–15:30 是盘后固定价格交易，量还在涨、价格是收盘价
    const after = d23.points.filter(p => p.t > T(15, 0));
    expect(after.length).toBe(25);
    expect(after.every(p => p.price === li(41.77))).toBe(true);
    expect(after[after.length - 1].volume).toBeGreaterThan(
      d23.points.find(p => p.t === T(15, 0))!.volume,
    );
  });

  test('多只按时间合并', () => {
    const a = gapSnapshots(
      'sh600036',
      day,
      baseFromPrevClose(security('sh600036')!, li(41.77)),
      { from: T(10, 0), to: T(10, 3) },
    );
    const b = a.map(x => ({ ...x, code: 'sz000001' }));
    expect(mergeByTime([a, b]).map(x => x.t)).toEqual([
      T(10, 1),
      T(10, 1),
      T(10, 2),
      T(10, 2),
    ]);
  });
});

describe('App 被杀后用分时补撮合（真实数据）', () => {
  /** 10:00:03 挂买单，之后 App 被杀，14:00 重新打开。 */
  function run(priceYuan: number) {
    const e = makeEngine();
    e.deposit({ date: '2026-10-26', t: T(9, 0) }, 30_000_000);
    const live = snap({
      code: 'sh600036',
      t: T(10, 0, 3),
      prev: 41.77,
      open: 41.49,
      last: 41.88,
      high: 41.95,
      low: 41.43,
      volume: 19_552_300,
      bids: [
        [41.87, 300],
        [41.7, 2000],
        [41.62, 5000],
      ],
      asks: [[41.88, 500]],
      up: 45.95,
      down: 37.59,
    });
    e.onSnapshot(live);
    const r = e.placeOrder(
      { date: '2026-10-26', t: T(10, 0, 3) },
      {
        code: 'sh600036',
        side: 'B',
        kind: 'limit',
        price: li(priceYuan),
        qty: 1000,
      },
    );
    expect(r.ok).toBe(true);
    // App 重启：内存里的快照没了，用本地存的最后一个快照做基准
    const restarted = makeEngine();
    restarted.state = e.state;
    restarted.primeSnapshot(live);
    const gap = gapSnapshots(
      'sh600036',
      day,
      { ...live, high: live.high, low: live.low },
      { from: live.t, to: T(14, 0) },
    );
    const events = gap.flatMap(s => restarted.onSnapshot(s));
    return { order: restarted.state.orders[0], events };
  }

  test('中断期间价格跌破委托价（13:36 出现 41.67 < 41.70）：按委托价全部成交', () => {
    const { order, events } = run(41.7);
    expect(order.status).toBe('已成');
    const fill = events.find(x => x.type === 'fill');
    expect(fill).toMatchObject({
      fill: {
        price: li(41.7),
        qty: 1000,
        t: T(13, 36),
        basis: { rule: 'through' },
      },
    });
  });

  test('只碰到委托价（最低就是 41.62）：排队判断不了，不成交', () => {
    const { order } = run(41.62);
    expect(order.status).toBe('已报');
    expect(order.filled).toBe(0);
  });
});
