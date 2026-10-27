import { TradingCalendar } from '../../src/engine';
import { T } from '../../src/engine';
import type { Simulator } from '../../src/sim/simulator';
import type { MarketClient } from '../../src/market/client';
import {
  DEFAULT_REFRESH,
  Refresher,
  type TrackerPort,
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

  test('可见 1 秒、不可见 3 秒、后台 5 秒；午休睡到 12:59:30（最多 60 秒检查一次）；后台没在跟踪就停', () => {
    const s = DEFAULT_REFRESH;
    expect(nextDelay('session', true, false, s, T(10, 0))).toBe(1000);
    expect(nextDelay('session', true, false, s, T(10, 0), false)).toBe(3000);
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

describe('Refresher：实际调度', () => {
  let refresher: Refresher;
  function setup(visible = ['sh600036'], background = false) {
    const now = { date: '2026-10-26', t: T(10, 0) };
    const sim = {
      calendar: cal,
      recordedCodes: jest.fn(() => new Set(['sz000001'])),
      activeOrderCodes: jest.fn(() => ['sz000001']),
      ingest: jest.fn(async () => []),
      tick: jest.fn(async () => []),
      ingestAfterHours: jest.fn(async () => []),
      catchUp: jest.fn(async () => ({})),
    };
    const quotes = jest.fn(async (_codes: string[]) => []);
    const client = { quotes, traffic: { requests: 0, bytes: 0 } };
    let running = false;
    const tracker: TrackerPort = {
      start: jest.fn(async () => {
        running = true;
        return true;
      }),
      stop: jest.fn(() => {
        running = false;
      }),
      update: jest.fn(),
      userStoppedAt: jest.fn(async () => 0),
      isRunning: jest.fn(async () => running),
    };
    refresher = new Refresher(
      sim as unknown as Simulator,
      client as unknown as MarketClient,
      background ? tracker : null,
      { ...DEFAULT_REFRESH },
      () => now,
    );
    refresher.setExtraCodes(visible);
    refresher.start();
    return { now, sim, quotes, tracker };
  }
  const advance = (ms: number) => jest.advanceTimersByTimeAsync(ms);
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(100_000);
  });
  afterEach(() => {
    refresher?.stop();
    jest.useRealTimers();
  });

  test('可见代码每秒请求，其他记录代码每 3 秒批量带上', async () => {
    const { quotes } = setup();
    await advance(0);
    await advance(3000);
    expect(quotes.mock.calls.map(([codes]) => codes)).toEqual([
      ['sh600036', 'sz000001'],
      ['sh600036'],
      ['sh600036'],
      ['sh600036', 'sz000001'],
    ]);
  });

  test('扣除网络、撮合总耗时，慢请求不重叠、不追赶漏掉的轮次', async () => {
    const { quotes } = setup();
    const times: number[] = [];
    let active = 0,
      maxActive = 0;
    quotes.mockImplementation(async () => {
      times.push(Date.now());
      maxActive = Math.max(maxActive, ++active);
      await new Promise<void>(r =>
        setTimeout(r, times.length === 1 ? 400 : 1500),
      );
      active--;
      return [];
    });
    await advance(1000);
    expect(times).toEqual([100_000, 101_000]);
    await advance(1549);
    expect(times).toHaveLength(2);
    await advance(1);
    expect(times).toEqual([100_000, 101_000, 102_550]);
    expect(maxActive).toBe(1);
  });

  test('请求中切页会记住新订阅，在下一秒获取新集合', async () => {
    const { quotes } = setup();
    quotes.mockImplementation(async () => {
      await new Promise<void>(r => setTimeout(r, 400));
      return [];
    });
    await advance(100);
    refresher.setExtraCodes(['sh600519']);
    await advance(899);
    expect(quotes).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(quotes.mock.calls.map(([codes]) => codes)).toEqual([
      ['sh600036', 'sz000001'],
      ['sh600519'],
    ]);
  });

  test('快速滚动合并可见集合，单秒不因每行进出而重复请求', async () => {
    const { quotes } = setup();
    await advance(100);
    refresher.setExtraCodes(['sh600519']);
    await advance(100);
    refresher.setExtraCodes(['sh510300']);
    await advance(100);
    refresher.setExtraCodes(['sz300750']);
    await advance(699);
    expect(quotes).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(quotes.mock.calls[1][0]).toEqual(['sz300750']);
    await advance(1000);
    expect(quotes.mock.calls[2][0]).toEqual(['sz300750']);
  });

  test('滚动不会推迟下单 kick，也不会突破网络失败的退避周期', async () => {
    const { quotes } = setup();
    await advance(100);
    refresher.kick();
    refresher.setExtraCodes(['sh600519']);
    await advance(0);
    expect(quotes).toHaveBeenCalledTimes(2);
    expect(quotes.mock.calls[1][0]).toContain('sh600519');
    quotes.mockRejectedValue(new Error('offline'));
    await advance(3000);
    expect(refresher.status().failures).toBe(3);
    const count = quotes.mock.calls.length;
    refresher.setExtraCodes(['sh510300']);
    await advance(1999);
    expect(quotes).toHaveBeenCalledTimes(count);
    await advance(1);
    expect(quotes).toHaveBeenCalledTimes(count + 1);
  });

  test('撤掉可见订阅后不空转，也不会推迟尚未到期的慢速批次', async () => {
    const { quotes } = setup();
    await advance(1000);
    refresher.setExtraCodes([]);
    await advance(0);
    await advance(1999);
    expect(quotes).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(quotes.mock.calls[2]).toEqual([['sz000001']]);
    await advance(3000);
    expect(quotes).toHaveBeenCalledTimes(4);
  });

  test('下单 kick 会立刻包含新增委托，后台只按 5 秒跟踪委托代码', async () => {
    const { sim, quotes } = setup(['sh600036'], true);
    await advance(0);
    sim.recordedCodes.mockReturnValue(new Set(['sz000001', 'sh600519']));
    refresher.kick();
    await advance(0);
    expect(quotes.mock.calls[1][0]).toContain('sh600519');
    await refresher.setForeground(false);
    await advance(0);
    const count = quotes.mock.calls.length;
    expect(quotes.mock.calls[count - 1][0]).toEqual(['sz000001']);
    await advance(4999);
    expect(quotes).toHaveBeenCalledTimes(count);
    await advance(1);
    expect(quotes).toHaveBeenCalledTimes(count + 1);
    expect(quotes.mock.calls[count][0]).toEqual(['sz000001']);
  });

  test('回前台先等旧请求，再补撮合；补撮合期间没有新请求', async () => {
    const { sim, quotes } = setup(['sh600036'], true);
    await advance(0);
    quotes.mockImplementation(async () => {
      await new Promise<void>(r => setTimeout(r, 500));
      return [];
    });
    sim.catchUp.mockImplementation(async () => {
      await new Promise<void>(r => setTimeout(r, 300));
      return {};
    });
    await refresher.setForeground(false);
    await advance(100);
    const resume = refresher.setForeground(true);
    await advance(399);
    expect(sim.catchUp).not.toHaveBeenCalled();
    await advance(1);
    expect(sim.catchUp).toHaveBeenCalledTimes(1);
    expect(quotes).toHaveBeenCalledTimes(2);
    await advance(301);
    await resume;
    expect(quotes).toHaveBeenCalledTimes(3);
  });

  test('行情接口失败也推进委托时钟，并按需要开启后台服务', async () => {
    const { quotes, sim, tracker } = setup(['sh600036'], true);
    quotes.mockRejectedValue(new Error('offline'));
    await advance(0);
    expect(sim.tick).toHaveBeenCalledTimes(1);
    expect(tracker.start).toHaveBeenCalledTimes(1);
    expect(refresher.status().lastError).toBe('offline');
  });

  test('失败退避与停止后不再调度；午休不加快请求', async () => {
    const { quotes, now } = setup();
    quotes.mockRejectedValue(new Error('offline'));
    await advance(2000);
    expect(quotes).toHaveBeenCalledTimes(3);
    expect(refresher.status().failures).toBe(3);
    await advance(1999);
    expect(quotes).toHaveBeenCalledTimes(3);
    await advance(1);
    expect(quotes).toHaveBeenCalledTimes(4);
    quotes.mockResolvedValue([]);
    now.t = T(12, 0);
    refresher.kick();
    await advance(0);
    const count = quotes.mock.calls.length;
    await advance(59_999);
    expect(quotes).toHaveBeenCalledTimes(count);
    await advance(1);
    expect(quotes).toHaveBeenCalledTimes(count + 1);
    refresher.stop();
    await advance(120_000);
    expect(quotes).toHaveBeenCalledTimes(count + 1);
  });
});
