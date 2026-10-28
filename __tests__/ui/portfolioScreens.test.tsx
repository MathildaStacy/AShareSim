/// <reference types="node" />
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { currentPageContext } from '../../src/ai/context';
import { useApp, type AppCore } from '../../src/app/boot';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import type { MarketClient } from '../../src/market/client';
import type { Quote } from '../../src/market/tencent';
import { Simulator } from '../../src/sim/simulator';
import type { Refresher } from '../../src/sim/refresher';
import type { RootStackParamList } from '../../src/ui/navigation/types';
import {
  PortfolioScreen,
  StrategyScreen,
  RebalanceScreen,
} from '../../src/ui/screens/PortfolioScreens';
import { DataCenterScreen } from '../../src/ui/screens/DataCenterScreen';
import { saveStrategy, rebalances, reports } from '../../src/portfolio/repo';
import { DEFAULT_STRATEGY } from '../../src/portfolio/types';
import { T } from '../../src/engine/session';
jest.mock('../../src/data/drivers/opSqlite', () => ({
  openDeviceDb: jest.fn(),
}));
jest.mock('../../src/app/tracker', () => ({
  nativeTracker: () => null,
  batterySettings: {},
}));
const Stack = createNativeStackNavigator<RootStackParamList>();
async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  const client = {
    quotes: async (codes: string[]) =>
      codes.map(
        code =>
          ({
            snapshot: {
              code,
              date: '2026-10-26',
              t: T(10, 0),
              prevClose: 10000,
              last: 10000,
              open: 10000,
              high: 10000,
              low: 10000,
              volume: 10000,
              amount: 10000000,
              bids: [[9990, 1000]],
              asks: [[10000, 1000]],
              up: 11000,
              down: 9000,
            },
            info: { code, name: '测试证券', type: 'GP-A' },
          } as Quote),
      ),
  } as unknown as MarketClient;
  const sim = await Simulator.open(db, client, () => ({
    date: '2026-10-26',
    t: T(10, 0),
  }));
  await sim.deposit(10000000);
  const refresher = { setExtraCodes() {}, kick() {} } as unknown as Refresher;
  const core = { db, client, sim, refresher } as AppCore;
  useApp.setState({ core, version: 1 });
  return core;
}
async function render<K extends keyof RootStackParamList>(
  name: K,
  component: React.ComponentType<any>,
  params?: RootStackParamList[K],
) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 400, height: 800 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen
              name={name}
              component={component}
              initialParams={params as never}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>,
    );
  });
  await act(async () => {
    await new Promise(r => setTimeout(r, 20));
  });
  const text = () => JSON.stringify(tree.toJSON());
  const input = (label: string) =>
    tree.root.findAll(
      n => n.props.accessibilityLabel === label && n.props.onChangeText,
    )[0];
  const type = async (label: string, v: string) => {
    await act(async () => {
      input(label).props.onChangeText(v);
    });
  };
  const press = async (label: string) => {
    const [btn] = tree.root.findAll(
      n =>
        typeof n.props.onPress === 'function' &&
        (n.props.accessibilityLabel === label ||
          (n.props.accessibilityRole === 'button' &&
            n.findAll(c => c.props.children === label).length > 0)),
    );
    if (!btn) {
      throw new Error('找不到按钮：' + label);
    }
    await act(async () => {
      await btn.props.onPress();
    });
  };
  return {
    tree,
    text,
    type,
    press,
    unmount: async () => {
      await act(async () => tree.unmount());
    },
  };
}

describe('M5 页面与确认流程', () => {
  test('入口空状态、策略配置、数据中心与页面上下文', async () => {
    const core = await setup();
    for (const [name, component] of [
      ['Portfolio', PortfolioScreen],
      ['Strategy', StrategyScreen],
      ['DataCenter', DataCenterScreen],
    ] as const) {
      const view = await render(name, component);
      expect(view.text()).toContain(
        name === 'Portfolio'
          ? '准备本周的调仓'
          : name === 'Strategy'
          ? '先约定怎样执行'
          : '让每次调仓有据可查',
      );
      expect(currentPageContext()?.route).toBe(name);
      await view.unmount();
    }
    await core.db.close();
  });
  test('手动目标 → 预检 → 确认前无委托 → 单次批量成交 → 报告', async () => {
    const core = await setup();
    await saveStrategy(core.db, DEFAULT_STRATEGY);
    const view = await render('Rebalance', RebalanceScreen);
    await view.type('证券代码 1', '600036');
    await view.type('权重 %', '10');
    await view.press('生成调仓预检');
    expect(view.text()).toContain('确认前，先看能否执行');
    expect(core.sim.engine.state.orders).toHaveLength(0);
    await view.press('批量确认');
    expect(view.text()).toContain('批量委托确认');
    expect(core.sim.engine.state.orders).toHaveLength(0);
    await view.press('确认执行');
    expect(core.sim.engine.state.orders).toHaveLength(1);
    await view.type('本周复盘', '按信号执行，检查费用偏差');
    await view.press('生成执行报告 · 完成本周打卡');
    expect((await rebalances(core.db, core.sim.accountId))[0].status).toBe(
      'reported',
    );
    expect(await reports(core.db, core.sim.accountId)).toHaveLength(1);
    expect(view.text()).toContain('执行报告');
    await view.unmount();
    await core.db.close();
  });
});
