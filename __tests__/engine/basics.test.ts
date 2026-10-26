import {
  addMonths,
  amountFen,
  BOARD_RULES,
  classify,
  computeLimits,
  divRoundHalfUp,
  feeFen,
  formatFen,
  TradingCalendar,
  yuanToLi,
} from '../../src/engine';
import { REAL, security } from './helpers/fixtures';

describe('整数金额', () => {
  test('四舍五入到分', () => {
    expect(divRoundHalfUp(15, 10)).toBe(2);
    expect(divRoundHalfUp(14, 10)).toBe(1);
    expect(divRoundHalfUp(25, 10)).toBe(3);
    expect(feeFen(1_000_000, 25_000)).toBe(250); // 1 万元 × 万 2.5 = 2.50 元
    expect(feeFen(4_180_000, 1_000)).toBe(42); // 41,800 元 × 0.001% = 0.418 → 0.42
  });
  test('成交金额', () => {
    expect(amountFen(yuanToLi(41.8), 1000)).toBe(4_180_000);
    expect(amountFen(yuanToLi(4.133), 100)).toBe(41_330);
    expect(amountFen(yuanToLi(104.15), 201)).toBe(2_093_415);
  });
  test('金额格式', () => {
    expect(formatFen(1_234_567)).toBe('12,345.67');
    expect(formatFen(-5)).toBe('-0.05');
  });
});

describe('交易日历', () => {
  const cal = new TradingCalendar();
  test('国庆和周末休市', () => {
    expect(cal.isTradingDay('2026-10-01')).toBe(false);
    expect(cal.isTradingDay('2026-10-07')).toBe(false);
    expect(cal.isTradingDay('2026-10-10')).toBe(false); // 周六
    expect(cal.next('2026-09-30')).toBe('2026-10-08');
    expect(cal.prev('2026-10-08')).toBe('2026-09-30');
    expect(cal.next('2026-10-23')).toBe('2026-10-26'); // 周五 → 周一
  });
  test('和真实日 K 线逐日一致（2026 年）', () => {
    const real = REAL.kline.sh000300
      .map(r => r[0])
      .filter(d => d >= '2026-01-01');
    const ours: string[] = [];
    let d = '2025-12-31';
    while (d < '2026-10-26') {
      d = cal.next(d);
      ours.push(d);
    }
    expect(ours.filter(x => x >= real[0])).toEqual(
      real.filter(x => x <= '2026-10-26'),
    );
  });
  test('加月份，月末对齐', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-06-02', 1)).toBe('2026-07-02');
    expect(addMonths('2026-03-15', 12)).toBe('2027-03-15');
  });
});

describe('板块识别', () => {
  test('代码前缀', () => {
    expect(classify('sh600036')?.board).toBe('main');
    expect(classify('sz002594')?.board).toBe('main');
    expect(classify('sz300750')?.board).toBe('cyb');
    expect(classify('sz301001')?.board).toBe('cyb');
    expect(classify('sh688981')?.board).toBe('kcb');
    expect(classify('sh510300')?.board).toBe('etf');
    expect(classify('sh588000')?.board).toBe('etf');
    expect(classify('sz159915')?.board).toBe('etf');
    expect(classify('sh000300')).toBeNull(); // 指数不能交易
    expect(classify('bj830799')).toBeNull(); // 北交所不在 V1 范围
  });
  test('ST 识别', () => {
    expect(security('sz002024')?.st).toBe(true);
    expect(security('sh600180')?.st).toBe(true);
    expect(security('sh600036')?.st).toBe(false);
  });
  test('自算涨跌停价和腾讯接口逐只一致', () => {
    const mismatches: string[] = [];
    for (const [code, q] of Object.entries(REAL.quotes)) {
      const sec = security(code);
      if (!sec) continue;
      const rule = BOARD_RULES[sec.board];
      // ETF 的涨跌幅跟随跟踪的指数，用接口值反推比例；股票用板块默认值（ST 自 2026-07-06 起也是 10%）
      const pct =
        sec.board === 'etf'
          ? Math.round((q.up / q.prev - 1) * 20) * 5
          : rule.defaultLimitPct;
      const lim = computeLimits(yuanToLi(q.prev), pct, rule.tickLi);
      if (lim.up !== yuanToLi(q.up) || lim.down !== yuanToLi(q.down)) {
        mismatches.push(
          code +
            ' ' +
            q.name +
            ' 自算 ' +
            lim.up / 1000 +
            '/' +
            lim.down / 1000 +
            ' 接口 ' +
            q.up +
            '/' +
            q.down,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });
});
