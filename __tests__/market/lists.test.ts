/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSinaEtfRank, sinaEtfRankUrl } from '../../src/market/sina';
import {
  parseRank,
  parseTicks,
  parseTickTimeline,
  rankUrl,
} from '../../src/market/tencent';
import { T } from '../../src/engine';

const fx = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const json = (name: string) => JSON.parse(fx(name));

describe('腾讯排行', () => {
  test('涨幅榜第一名：现价换成厘、成交量手换成股、成交额万元换成分', () => {
    const list = parseRank(json('rank-astock.json'));
    expect(list).toHaveLength(5);
    expect(list[0]).toEqual({
      code: 'sz301314',
      name: '科瑞思',
      type: 'GP-A-CYB',
      last: 56_140,
      change: 9_360,
      pct: 20.01,
      volume: 782_000,
      amount: 4_390_000_000, // 4390 万元
    });
  });

  test('成交额 ÷ 成交量 ≈ 现价（科创板的成交量带小数，也是手）', () => {
    for (const r of parseRank(json('rank-astock.json'))) {
      const avg = (r.amount * 10) / r.volume; // 厘
      expect(Math.abs(avg / r.last! - 1)).toBeLessThan(0.1);
    }
  });

  test('北交所和格式不对的行去掉', () => {
    const list = parseRank({
      data: {
        rank_list: [
          { code: 'bj920092', name: '汉鑫科技', zxj: '20.00' },
          { code: 'sh600036', name: '招商银行', zxj: '42.50', zd: '0.73' },
          { name: '没有代码' },
        ],
      },
    });
    expect(list.map(r => r.code)).toEqual(['sh600036']);
    expect(parseRank({ code: 12 })).toEqual([]);
  });

  test('跌幅榜是涨跌幅升序，成交额榜按 turnover 降序', () => {
    expect(rankUrl('cyb', 'down', 10)).toContain(
      'board_code=cyb&sort_type=priceRatio&direct=up',
    );
    expect(rankUrl('aStock', 'up', 10)).toContain('direct=down');
    expect(rankUrl('kcb', 'amount', 10)).toContain(
      'sort_type=turnover&direct=down',
    );
  });
});

describe('新浪 ETF 排行', () => {
  test('现价 3 位小数换成厘，成交量是份，成交额元换成分', () => {
    const list = parseSinaEtfRank(json('sina-etf-up.json'));
    expect(list).toHaveLength(15);
    expect(list[0]).toMatchObject({
      code: 'sz159707',
      name: '地产ETF',
      type: 'ETF',
      last: 512,
      change: 19,
      volume: 259_414_100,
      amount: 13_149_794_100,
    });
    expect(list[0].pct).toBeCloseTo(3.854);
    for (const r of list) {
      expect(Math.abs((r.amount * 10) / r.volume / r.last! - 1)).toBeLessThan(
        0.1,
      );
    }
  });

  test('没有成交时没有现价和涨跌幅', () => {
    const [r] = parseSinaEtfRank([
      { symbol: 'sh510300', name: '沪深300ETF', trade: '0.000', volume: 0 },
    ]);
    expect(r.last).toBeNull();
    expect(r.pct).toBeNull();
  });

  test('跌幅榜升序，涨幅榜和成交额榜降序', () => {
    expect(sinaEtfRankUrl('down', 10)).toContain('sort=changepercent&asc=1');
    expect(sinaEtfRankUrl('up', 10)).toContain('sort=changepercent&asc=0');
    expect(sinaEtfRankUrl('amount', 10)).toContain('sort=amount&asc=0');
  });
});

describe('成交明细（分笔）', () => {
  test('分页时间表：日期和页数', () => {
    expect(parseTickTimeline(fx('ticks-timeline-sh600036.txt'))).toEqual({
      date: '2026-10-26',
      pages: 68,
    });
  });

  test('第一行是开盘集合竞价：时间、价格、涨跌、手换成股、元换成分、方向', () => {
    const { page, ticks } = parseTicks(fx('ticks-sh600036-p0.txt'));
    expect(page).toBe(0);
    expect(ticks[0]).toEqual({
      seq: 0,
      t: T(9, 25, 2),
      price: 41_490,
      change: -180,
      volume: 1_775_400,
      amount: 7_366_134_600,
      side: 'S',
    });
    expect(ticks[1].t).toBe(T(9, 30, 2));
    // 大约每 3 秒一行
    expect(ticks[2].t - ticks[1].t).toBe(3);
  });

  test('最后一页：15:00 收盘集合竞价一行，15:05 以后是收盘价的盘后固定价格成交', () => {
    const { page, ticks } = parseTicks(fx('ticks-sh600036-last.txt'));
    expect(page).toBe(67);
    const close = ticks.find(x => x.t === T(15, 0, 2))!;
    expect(close).toMatchObject({ price: 42_500, volume: 3_855_400 });
    const after = ticks.filter(x => x.t >= T(15, 5));
    expect(after.length).toBeGreaterThan(5);
    expect(after.every(x => x.price === 42_500)).toBe(true);
    expect(ticks[ticks.length - 1]).toMatchObject({
      seq: 4719,
      t: T(15, 14, 26),
      side: 'B',
    });
  });

  test('科创板和 ETF 的量也是手：成交额 ÷ (价格 × 量) ≈ 1', () => {
    for (const name of ['ticks-sh688981-last.txt', 'ticks-sh510300-p29.txt']) {
      const { ticks } = parseTicks(fx(name));
      expect(ticks.length).toBeGreaterThan(10);
      for (const x of ticks.filter(y => y.volume >= 1000)) {
        const ratio = (x.amount * 10) / (x.price * x.volume);
        expect(Math.abs(ratio - 1)).toBeLessThan(0.06);
      }
    }
  });

  test('格式不对时返回空', () => {
    expect(parseTicks('v_detail_data_sh600036=[0,""]').ticks).toEqual([]);
    expect(parseTicks('garbage').page).toBe(-1);
    expect(parseTickTimeline('garbage')).toBeNull();
  });
});
