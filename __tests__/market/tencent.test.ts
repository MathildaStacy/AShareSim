/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBonus } from '../../src/market/eastmoney';
import {
  minuteKlineUrl,
  parseKline,
  parseMinute,
  parseMinuteKline,
  parseQuotes,
  parseSearch,
  parseServerTime,
} from '../../src/market/tencent';
import { T } from '../../src/engine';

const fx = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const json = (name: string) => JSON.parse(fx(name));

/** 2026-10-26 14:52 从 qt.gtimg.cn/utf8 抓的真实响应。 */
const quotes = parseQuotes(fx('qt-2026-10-26-1452.txt'));
const q = (code: string) => quotes.find(x => x.snapshot.code === code)!;

describe('腾讯快照 → 引擎 Snapshot', () => {
  test('9 只全部解析出来', () => {
    expect(quotes.map(x => x.snapshot.code)).toEqual([
      'sh600036',
      'sz000001',
      'sh510300',
      'sz159915',
      'sh688981',
      'sz300750',
      'sz002024',
      'sh000001',
      'sz399006',
    ]);
  });

  test('招商银行：价格换成厘、手换成股、成交额用精确到元的字段换成分', () => {
    const { snapshot: s, info } = q('sh600036');
    expect(info.name).toBe('招商银行');
    expect(info.type).toBe('GP-A');
    expect(s.date).toBe('2026-10-26');
    expect(s.t).toBe(T(14, 52, 47));
    expect(s.prevClose).toBe(41_770);
    expect(s.open).toBe(41_490);
    expect(s.last).toBe(42_300);
    expect(s.high).toBe(42_350);
    expect(s.low).toBe(41_430);
    expect(s.volume).toBe(82_878_600); // 828,786 手
    expect(s.amount).toBe(347_961_134_300); // 3,479,611,343 元
    expect(s.bids[0]).toEqual([42_300, 131_300]);
    expect(s.asks[4]).toEqual([42_350, 287_200]);
    expect(s.up).toBe(45_950);
    expect(s.down).toBe(37_590);
    expect(s.suspended).toBeUndefined();
    expect(info.change).toBe(530);
    expect(info.pct).toBe(1.27);
  });

  test('成交额 ÷ 成交量 ≈ 现价：单位换算没错', () => {
    for (const code of [
      'sh600036',
      'sz000001',
      'sh510300',
      'sz159915',
      'sh688981',
      'sz300750',
      'sz002024',
    ]) {
      const s = q(code).snapshot;
      const avgLi = (s.amount * 10) / s.volume; // 分 → 厘
      expect(Math.abs(avgLi / s.last! - 1)).toBeLessThan(0.05);
    }
  });

  test('科创板：成交量字段是股，不是手；盘口仍然是手', () => {
    const { snapshot: s, info } = q('sh688981');
    expect(info.type).toBe('GP-A-KCB');
    expect(s.volume).toBe(29_312_540);
    expect(s.bids[0]).toEqual([102_050, 200]);
  });

  test('ETF：价格 3 位小数，1 手 = 100 份', () => {
    const s = q('sh510300').snapshot;
    expect(s.last).toBe(4_172);
    expect(s.up).toBe(4_596);
    expect(s.volume).toBe(1_606_197_100);
    expect(q('sz159915').snapshot.up).toBe(3_242); // 创业板 ETF ±20%
  });

  test('指数没有涨跌停价和盘口', () => {
    const s = q('sh000001').snapshot;
    expect(s.up).toBeNull();
    expect(s.down).toBeNull();
    expect(s.bids).toEqual([]);
    expect(s.suspended).toBeUndefined();
  });

  test('开盘前没有成交：最新价、最高、最低为空', () => {
    const line =
      'v_sh600036="1~招商银行~600036~41.77~41.77~0.00~0~0~0~41.80~10~0.00~0~0.00~0~0.00~0~0.00~0~41.80~5~0.00~0~0.00~0~0.00~0~0.00~0~~20261027091800~0.00~0.00~0.00~0.00~41.77/0/0~0~0~0.00~7.03~~0.00~0.00~0.00~8726.04~10667.99~0.93~45.95~37.59~0.00~-1~0.00~0~0~0~0~0~0~0~0~0~GP-A~0";';
    const [x] = parseQuotes(line);
    expect(x.snapshot.t).toBe(T(9, 18));
    expect(x.snapshot.last).toBeNull();
    expect(x.snapshot.open).toBeNull();
    expect(x.snapshot.high).toBeNull();
    expect(x.snapshot.suspended).toBeUndefined();
    expect(x.info.pct).toBeNull();
  });

  test('不认识的代码和残缺的行跳过', () => {
    expect(parseQuotes('v_pv_none_match="1";\nv_sh1="1~x";')).toEqual([]);
    expect(parseServerTime('2026102614')).toBeNull();
  });
});

describe('分时和 K 线', () => {
  test('分时：每分钟最后成交价、累计量（股）和累计额（分）', () => {
    const m = parseMinute(json('minute-sh600036.json'), 'sh600036', 'GP-A')!;
    expect(m.date).toBe('2026-10-26');
    expect(m.points[0]).toEqual({
      t: T(9, 30),
      price: 41_490,
      volume: 1_775_400,
      amount: 7_366_134_600,
    });
    // 11:30 和 13:00 都有一个点，量不变
    const noon = m.points.filter(p => p.t === T(11, 30) || p.t === T(13, 0));
    expect(noon).toHaveLength(2);
    expect(noon[0].volume).toBe(noon[1].volume);
  });

  test('科创板分时的量也是股', () => {
    const m = parseMinute(
      json('minute-sh688981.json'),
      'sh688981',
      'GP-A-KCB',
    )!;
    const p = m.points[0];
    const avgLi = (p.amount * 10) / p.volume;
    expect(Math.abs(avgLi / p.price - 1)).toBeLessThan(0.05);
  });

  test('日 K（前复权）和周 K', () => {
    const d = parseKline(
      json('kline-day-sh600036.json'),
      'sh600036',
      'day',
      'GP-A',
    );
    expect(d.length).toBe(31); // 请求 30 根，盘中会多给一根当天的
    expect(d[d.length - 1]).toMatchObject({ date: '2026-10-26', open: 41_490 });
    const w = parseKline(
      json('kline-week-sh510300.json'),
      'sh510300',
      'week',
      'ETF',
    );
    expect(w.length).toBe(21);
    // 没有除权的股票，腾讯在前复权请求里直接返回 day
    const k = parseKline(
      json('kline-day-sh688981.json'),
      'sh688981',
      'day',
      'GP-A-KCB',
    );
    expect(k[k.length - 1].volume).toBeGreaterThan(1_000_000);
  });

  test('分钟 K 线（15 分钟，2026-10-26 真实数据）', () => {
    expect(minuteKlineUrl('sz000001', 'm15', 120)).toBe(
      'https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=sz000001,m15,,120',
    );
    const k = parseMinuteKline(
      json('kline-m15-sz000001.json'),
      'sz000001',
      'm15',
      'GP-A',
    );
    expect(k.length).toBe(48);
    // 一天 16 根：9:45 … 11:30、13:15 … 15:00
    const day = k.filter(b => b.date.startsWith('2026-10-26'));
    expect(day.length).toBe(16);
    expect(day[0]).toMatchObject({ date: '2026-10-26 09:45', open: 11_150 });
    expect(day[7].date).toBe('2026-10-26 11:30');
    expect(day[8].date).toBe('2026-10-26 13:15');
    expect(day[15]).toMatchObject({ date: '2026-10-26 15:00', close: 11_300 });
    // 手 → 股；16 根加起来等于当天日 K 的 1,323,113 手
    expect(day.reduce((a, b) => a + b.volume, 0)).toBe(132_311_300);
    // 科创板的量本来就是股
    const kcb = parseMinuteKline(
      json('kline-m15-sh688981.json'),
      'sh688981',
      'm15',
      'GP-A-KCB',
    ).filter(b => b.date.startsWith('2026-10-26'));
    expect(kcb.reduce((a, b) => a + b.volume, 0)).toBe(31_278_556);
    expect(parseMinuteKline({}, 'sz000001', 'm15', 'GP-A')).toEqual([]);
  });
});

describe('搜索', () => {
  test('只保留沪深 A 股 / ETF / 指数，名称从 \\u 转义还原', () => {
    expect(parseSearch(fx('smartbox-zsyh.txt'))).toEqual([
      { code: 'sh600036', name: '招商银行', pinyin: 'zsyh', type: 'GP-A' },
      { code: 'sh601916', name: '浙商银行', pinyin: 'zsyh', type: 'GP-A' },
    ]);
    expect(parseSearch('v_hint="N"')).toEqual([]);
  });
});

describe('东方财富分红送配', () => {
  test('招商银行 2025 年度：10 派 10.03 元 → 每股 1003 厘，派息日按除息日', () => {
    const rows = parseBonus(json('eastmoney-bonus-600036.json'), 'sh600036');
    expect(rows[0]).toEqual({
      code: 'sh600036',
      recordDate: '2026-07-09',
      exDate: '2026-07-10',
      payDate: '2026-07-10',
      cashPerShareLi: 1003,
      bonusPerShare: 0,
      plan: '10派10.03元(含税)',
    });
  });

  test('送转和 3 位小数的派息', () => {
    const rows = parseBonus(
      {
        result: {
          data: [
            {
              ASSIGN_PROGRESS: '实施分配',
              EQUITY_RECORD_DATE: '2026-06-01 00:00:00',
              EX_DIVIDEND_DATE: '2026-06-02 00:00:00',
              PRETAX_BONUS_RMB: 0.865,
              BONUS_RATIO: 3,
              IT_RATIO: 2,
              IMPL_PLAN_PROFILE: '10送3转2派0.865元(含税)',
            },
            {
              ASSIGN_PROGRESS: '股东大会决议通过',
              EQUITY_RECORD_DATE: null,
              EX_DIVIDEND_DATE: null,
              PRETAX_BONUS_RMB: 5,
            },
          ],
        },
      },
      'sz000001',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cashPerShareLi).toBe(86.5);
    expect(rows[0].bonusPerShare).toBe(0.5);
  });
});
