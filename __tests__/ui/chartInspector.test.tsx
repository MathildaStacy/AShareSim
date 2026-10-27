/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PanResponder, type PanResponderCallbacks, View } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { T } from '../../src/engine';
import { parseKline, type KBar } from '../../src/market/tencent';
import { KlineChart, MinuteChart } from '../../src/ui/charts/Charts';
import { klineView, minuteSeries } from '../../src/ui/charts/chartMath';

const bars = parseKline(
  JSON.parse(
    readFileSync(
      join(__dirname, '../market/fixtures/kline-day-sh600036.json'),
      'utf8',
    ),
  ),
  'sh600036',
  'day',
  'GP-A',
);
const view = klineView(bars, 60);
const xAt = (i: number) => 4 + ((400 - 8) / 60) * (i + 0.5);
const event = (x: number, y: number) =>
  ({ nativeEvent: { locationX: x, locationY: y, touches: [{}] } } as any);
const gesture = (dx = 0, dy = 0) => ({ dx, dy } as any);
let tree: Renderer.ReactTestRenderer;
let spy: jest.SpyInstance;
let callbacks: PanResponderCallbacks;
const text = () => JSON.stringify(tree.toJSON());
const nodes = (id: string) => tree.root.findAll(n => n.props.testID === id);
const plot = () =>
  tree.root.findAll(
    n => n.type === View && n.props.accessibilityRole === 'adjustable',
  )[0];
async function render(node: React.ReactElement) {
  await act(async () => {
    tree = Renderer.create(node);
  });
  await act(async () => {
    const box = tree.root.findAll(n => n.type === View && n.props.onLayout)[0];
    box.props.onLayout({
      nativeEvent: { layout: { width: 400, height: 230 } },
    });
  });
  callbacks = spy.mock.calls.at(-1)![0];
}
async function tap(x: number, y: number) {
  await act(async () => {
    callbacks.onPanResponderGrant!(event(x, y), gesture());
    callbacks.onPanResponderRelease!(event(x, y), gesture());
  });
}
beforeEach(() => {
  jest.useFakeTimers();
  spy = jest.spyOn(PanResponder, 'create');
});
afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  spy.mockRestore();
  jest.useRealTimers();
});

test('K 线点按吸附实际蜡烛，横纵轴与所选 OHLC 同步，退出后回到最新数据', async () => {
  const lock = jest.fn();
  await render(
    <KlineChart
      bars={bars}
      decimals={2}
      emptyText="无数据"
      onInspectChange={lock}
    />,
  );
  expect(nodes('chart-axis-time')).toHaveLength(0);
  await tap(xAt(12), 84);
  expect(nodes('chart-crosshair-x')[0].props.x1).toBeCloseTo(xAt(12));
  expect(text()).toContain(view.bars[12].date);
  expect(plot().props.accessibilityValue.now).toBe(12);
  expect(plot().props.accessibilityValue.text).toContain(
    '收盘' + (view.bars[12].close / 1000).toFixed(2),
  );
  const price = view.hi - ((84 - 14) / (230 * 0.68 - 18)) * (view.hi - view.lo);
  expect(text()).toContain('价格 ' + (price / 1000).toFixed(2));
  expect(lock).not.toHaveBeenCalledWith(true);
  await act(async () => {
    tree.root
      .findAll(
        n => n.props.accessibilityLabel === '退出查价' && n.props.onPress,
      )[0]
      .props.onPress();
  });
  expect(nodes('chart-axis-time')).toHaveLength(0);
  expect(plot().props.accessibilityValue.now).toBe(view.bars.length - 1);
});

test('横拖 / 长按锁定查价，竖滑交还页面；释放、打断、卸载都会解除滚动锁', async () => {
  const lock = jest.fn();
  await render(
    <KlineChart
      bars={bars}
      decimals={2}
      emptyText="无数据"
      onInspectChange={lock}
    />,
  );
  await act(async () => {
    callbacks.onPanResponderGrant!(event(xAt(2), 50), gesture());
    callbacks.onPanResponderMove!(event(xAt(2), 90), gesture(0, 40));
    jest.advanceTimersByTime(300);
  });
  expect(lock).not.toHaveBeenCalledWith(true);
  expect(
    callbacks.onPanResponderTerminationRequest!(event(0, 0), gesture()),
  ).toBe(true);
  expect(nodes('chart-axis-time')).toHaveLength(0);
  await act(async () => {
    callbacks.onPanResponderGrant!(event(xAt(2), 50), gesture());
    callbacks.onPanResponderMove!(event(xAt(9), 100), gesture(40, 2));
  });
  expect(lock).toHaveBeenLastCalledWith(true);
  expect(plot().props.accessibilityValue.now).toBe(9);
  expect(
    callbacks.onPanResponderTerminationRequest!(event(0, 0), gesture()),
  ).toBe(false);
  await act(async () => {
    callbacks.onPanResponderTerminate!(event(0, 0), gesture());
  });
  expect(lock).toHaveBeenLastCalledWith(false);
  await act(async () => {
    callbacks.onPanResponderGrant!(event(xAt(5), 50), gesture());
    jest.advanceTimersByTime(221);
    callbacks.onPanResponderMove!(event(xAt(5), 193), gesture(0, 143));
  });
  expect(lock).toHaveBeenLastCalledWith(true);
  expect(text()).toContain('量 ');
  await act(async () => {
    callbacks.onPanResponderRelease!(event(0, 0), gesture());
  });
  expect(lock).toHaveBeenLastCalledWith(false);
  expect(nodes('chart-axis-time').length).toBeGreaterThan(0);
  await act(async () => {
    callbacks.onPanResponderGrant!(event(xAt(5), 50), gesture());
    jest.advanceTimersByTime(221);
    tree.unmount();
  });
  expect(lock).toHaveBeenLastCalledWith(false);
});

test('刷新追加数据保持日期，移出可见区或换周期清除旧十字线', async () => {
  const fullBars = Array.from({ length: 60 }, (_, i) => ({
    ...bars[i % bars.length],
    date: new Date(Date.UTC(2026, 7, i + 1)).toISOString().slice(0, 10),
  }));
  await render(
    <KlineChart key="day" bars={fullBars} decimals={2} emptyText="无数据" />,
  );
  await tap(xAt(12), 84);
  const selectedDate = fullBars[12].date;
  const next = { ...bars.at(-1)!, date: '2099-01-01' };
  await act(async () => {
    tree.update(
      <KlineChart
        key="day"
        bars={[...fullBars, next]}
        decimals={2}
        emptyText="无数据"
      />,
    );
  });
  expect(plot().props.accessibilityValue.text).toContain(selectedDate);
  expect(nodes('chart-crosshair-x')[0].props.x1).toBeCloseTo(xAt(11));
  await act(async () => {
    tree.update(
      <KlineChart
        key="day"
        bars={[...fullBars.slice(20), next]}
        decimals={2}
        emptyText="无数据"
      />,
    );
  });
  expect(nodes('chart-axis-time')).toHaveLength(0);
  await act(async () => {
    tree.update(
      <KlineChart key="week" bars={bars} decimals={2} emptyText="无数据" />,
    );
  });
  expect(nodes('chart-axis-time')).toHaveLength(0);
});

test('空数据不启用查价；单根平盘 ETF 保留三位精度，可用读屏逐根调整和退出', async () => {
  await render(<KlineChart bars={[]} decimals={3} emptyText="没有 K 线数据" />);
  expect(
    callbacks.onStartShouldSetPanResponder!(event(50, 50), gesture()),
  ).toBe(false);
  expect(text()).toContain('没有 K 线数据');
  const flat: KBar = {
    date: '2026-10-27 09:45',
    open: 4853,
    high: 4853,
    low: 4853,
    close: 4853,
    volume: 0,
  };
  await act(async () => {
    tree.update(
      <KlineChart
        bars={[flat]}
        decimals={3}
        chartLabel="15分"
        emptyText="无数据"
      />,
    );
  });
  await act(async () => {
    plot().props.onAccessibilityAction({
      nativeEvent: { actionName: 'decrement' },
    });
  });
  expect(text()).toContain('价格 4.853');
  expect(text()).not.toContain('NaN');
  expect(plot().props.accessibilityValue.now).toBe(0);
  await act(async () => {
    plot().props.onAccessibilityAction({
      nativeEvent: { actionName: 'escape' },
    });
  });
  expect(nodes('chart-axis-time')).toHaveLength(0);
});

test('分时吸附真实时刻，午休不出现虚构时间，未来空白停在最后成交点；指数标明点位', async () => {
  const series = minuteSeries(
    [
      { t: T(11, 30), price: 5000000, volume: 100, amount: 0 },
      { t: T(13, 0), price: 5001000, volume: 100, amount: 0 },
      { t: T(13, 1, 25), price: 5002000, volume: 200, amount: 0 },
    ],
    5000000,
    false,
  );
  await render(
    <MinuteChart
      series={series}
      prevClose={5000000}
      decimals={2}
      date="2026-10-27"
      priceLabel="点位"
      emptyText="无数据"
    />,
  );
  await tap(200, 80);
  expect(plot().props.accessibilityValue.text).toContain('2026-10-27 13:00');
  expect(text()).toContain('点位 ');
  expect(text()).not.toContain('12:00');
  await tap(999, 80);
  expect(plot().props.accessibilityValue.text).toContain('13:01:25');
  expect(nodes('chart-crosshair-x')[0].props.x1).toBeLessThan(210);
});
