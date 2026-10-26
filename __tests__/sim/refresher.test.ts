import { TradingCalendar } from '../../src/engine';
import { T } from '../../src/engine';
import {
  DEFAULT_REFRESH,
  marketWindow,
  nextDelay,
  trackerWanted,
} from '../../src/sim/refresher';

const cal = new TradingCalendar();
const at = (date: string, t: number) => marketWindow({ date, t }, cal);

describe('刷新时段', () => {
  test('交易日各时间段', () => {
    expect(at('2026-10-26', T(8, 59))).toBe('closed');
    expect(at('2026-10-26', T(9, 5))).toBe('pre');
    expect(at('2026-10-26', T(9, 14))).toBe('session');
    expect(at('2026-10-26', T(11, 30, 29))).toBe('session');
    expect(at('2026-10-26', T(12, 0))).toBe('lunch');
    expect(at('2026-10-26', T(12, 59, 30))).toBe('session');
    expect(at('2026-10-26', T(15, 30, 29))).toBe('session'); // 盘后固定价格交易到 15:30
    expect(at('2026-10-26', T(15, 31))).toBe('closed');
  });

  test('周末和节假日全天 closed', () => {
    expect(at('2026-10-25', T(10, 0))).toBe('closed');
    expect(at('2026-10-01', T(10, 0))).toBe('closed');
  });

  test('前台 3 秒、后台 5 秒；午休睡到 12:59:30（最多 60 秒检查一次）；后台没在跟踪就停', () => {
    const s = DEFAULT_REFRESH;
    expect(nextDelay('session', true, false, s, T(10, 0))).toBe(3000);
    expect(nextDelay('session', false, true, s, T(10, 0))).toBe(5000);
    expect(nextDelay('session', false, false, s, T(10, 0))).toBeNull();
    expect(nextDelay('lunch', false, true, s, T(12, 0))).toBe(60_000);
    expect(nextDelay('lunch', false, true, s, T(12, 59))).toBe(30_000);
    expect(nextDelay('closed', true, false, s, T(16, 0))).toBe(60_000);
  });
});

describe('后台跟踪开不开', () => {
  test('默认：有未完成委托才开', () => {
    expect(trackerWanted('session', 'orders', 1, false)).toBe(true);
    expect(trackerWanted('session', 'orders', 0, false)).toBe(false);
    expect(trackerWanted('pre', 'orders', 1, false)).toBe(true);
    expect(trackerWanted('lunch', 'orders', 1, false)).toBe(true);
  });
  test('收盘、关掉、当天在通知上点了停止：不开', () => {
    expect(trackerWanted('closed', 'orders', 1, false)).toBe(false);
    expect(trackerWanted('session', 'off', 1, false)).toBe(false);
    expect(trackerWanted('session', 'orders', 1, true)).toBe(false);
  });
  test('交易时段全程：没有委托也开', () => {
    expect(trackerWanted('session', 'session', 0, false)).toBe(true);
  });
});
