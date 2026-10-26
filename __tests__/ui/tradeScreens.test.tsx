/// <reference types="node" />
/**
 * 交易界面的冒烟测试：用真实行情（2026-10-26 14:52 腾讯快照）和真实引擎跑一笔买入，
 * 再把下单、撤单、持仓、查询、详情页都渲染一遍，检查能画出来、关键文字在、页面上下文带了校验结果。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { currentPageContext } from '../../src/ai/context';
import { useApp, type AppCore } from '../../src/app/boot';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import * as repo from '../../src/data/repos';
import { T, yuanToLi } from '../../src/engine';
import type { MarketClient } from '../../src/market/client';
import { parseQuotes } from '../../src/market/tencent';
import { Simulator } from '../../src/sim/simulator';
import type { Refresher } from '../../src/sim/refresher';
import {
  FillDetailScreen,
  OrderDetailScreen,
} from '../../src/ui/screens/DetailScreens';
import { OrderScreen } from '../../src/ui/screens/OrderScreen';
import { OrdersScreen } from '../../src/ui/screens/OrdersScreen';
import {
  PositionScreen,
  PositionsScreen,
} from '../../src/ui/screens/PositionsScreen';
import { TradeScreen } from '../../src/ui/screens/TabScreens';
import type { RootStackParamList } from '../../src/ui/navigation/types';

jest.mock('../../src/data/drivers/opSqlite', () => ({
  openDeviceDb: () => {
    throw new Error('测试里不用设备数据库');
  },
}));
jest.mock('../../src/app/tracker', () => ({
  nativeTracker: () => null,
  batterySettings: {},
}));

const fx = (name: string) =>
  readFileSync(join(__dirname, '../market/fixtures', name), 'utf8');

const Stack = createNativeStackNavigator<RootStackParamList>();

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  const clock = { date: '2026-10-26', t: T(14, 53) };
  const client = {} as MarketClient;
  const sim = await Simulator.open(db, client, () => clock);
  sim.setWatchlist(['sh600036']);
  await sim.ingest(parseQuotes(fx('qt-2026-10-26-1452.txt')));
  await sim.deposit(30_000_000);
  const snap = sim.engine.snapshot('sh600036')!;
  // 按卖一价买 200 股：主动成交
  const r = await sim.placeOrder({
    code: 'sh600036',
    side: 'B',
    kind: 'limit',
    price: snap.asks[0][0],
    qty: 200,
  });
  if (!r.ok) {
    throw new Error(r.msg);
  }
  // 再挂一笔低价买单，留一个能撤的委托
  const r2 = await sim.placeOrder({
    code: 'sh600036',
    side: 'B',
    kind: 'limit',
    price: snap.bids[0][0] - 50,
    qty: 100,
  });
  if (!r2.ok) {
    throw new Error(r2.msg);
  }
  const refresher = {
    setExtraCodes() {},
    kick() {},
  } as unknown as Refresher;
  const core = { db, client, sim, refresher } as AppCore;
  useApp.setState({ core, version: 1 });
  return { core, filled: r.order, resting: r2.order };
}

async function render<K extends keyof RootStackParamList>(
  name: K,
  component: React.ComponentType<any>,
  params: RootStackParamList[K],
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
  const text = JSON.stringify(tree.toJSON());
  return { tree, text };
}

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  ctx = await setup();
});

test('引擎先跑出成交、持仓、交割单', () => {
  const st = ctx.core.sim.engine.state;
  expect(ctx.filled.status).toBe('已成');
  expect(st.fills.length).toBe(1);
  expect(st.ledger.map(l => l.biz)).toEqual(['证券买入', '银行转证券']);
});

test('下单页：表单、五档、预估费用和校验结果；页面上下文带表单和校验', async () => {
  const { text } = await render('Order', OrderScreen, {
    side: 'B',
    code: 'sh600036',
    price: yuanToLi(40),
  });
  expect(text).toContain('招商银行');
  expect(text).toContain('卖一');
  expect(text).toContain('全仓');
  expect(text).toContain('费用约');
  const page = currentPageContext()!;
  expect(page.ctx.name).toBe('买入 · 招商银行');
  const all = page.ctx.lines.join('\n');
  expect(all).toContain('价格 40.00 元');
  expect(all).toMatch(/表单(校验|能提交)/);
  expect(all).toContain('默认费率');
});

test('撤单分段：列出未完成委托', async () => {
  const { text } = await render('Order', OrderScreen, { side: 'C' });
  expect(text).toContain('全撤');
  expect(text).toContain('撤单');
  expect(currentPageContext()!.ctx.lines.join('\n')).toContain('现在能撤');
});

test('交易 Tab、持仓、持仓详情', async () => {
  expect((await render('Tabs', TradeScreen, undefined)).text).toContain(
    '当日参考盈亏',
  );
  expect(
    (await render('Positions', PositionsScreen, undefined)).text,
  ).toContain('招商银行');
  const { text } = await render('Position', PositionScreen, {
    code: 'sh600036',
  });
  expect(text).toContain('摊薄成本');
  expect(text).toContain('买入均价');
});

test('查询四个分段和两个详情页', async () => {
  for (const tab of ['today', 'fills', 'hist', 'ledger'] as const) {
    await render('Orders', OrdersScreen, { tab });
  }
  const ledger = await render('Orders', OrdersScreen, { tab: 'ledger' });
  expect(ledger.text).toContain('导出 CSV');
  const od = await render('OrderDetail', OrderDetailScreen, {
    id: ctx.resting.id,
  });
  expect(od.text).toContain('撤单');
  const fill = ctx.core.sim.engine.state.fills[0];
  const fd = await render('FillDetail', FillDetailScreen, { id: fill.id });
  expect(fd.text).toContain('成交依据');
  expect(fd.text).toContain('佣金');
});

test('下单流程：填数量 → 买入 → 委托确认 → 引擎生成委托', async () => {
  const { tree } = await render('Order', OrderScreen, {
    side: 'B',
    code: 'sh600036',
    price: yuanToLi(40),
  });
  const before = ctx.core.sim.engine.state.orders.length;
  const [qty] = tree.root.findAll(
    n => n.props.accessibilityLabel === '数量' && n.props.onChangeText,
  );
  await act(async () => {
    qty.props.onChangeText('100');
  });
  expect(currentPageContext()!.ctx.lines.join('\n')).toContain('表单校验通过');
  const pressByText = async (label: string) => {
    const [btn] = tree.root.findAll(
      n =>
        typeof n.props.onPress === 'function' &&
        n.props.accessibilityRole === 'button' &&
        n.findAll(c => c.props.children === label).length > 0,
    );
    await act(async () => {
      await btn.props.onPress();
    });
  };
  await pressByText('买入');
  await pressByText('确认买入');
  const st = ctx.core.sim.engine.state;
  expect(st.orders.length).toBe(before + 1);
  expect(st.orders[0]).toMatchObject({
    side: 'B',
    price: yuanToLi(40),
    qty: 100,
    status: '已报',
  });
});

test('被拦下：卖出超过可卖数量，弹出违反的规则，并记进操作日志', async () => {
  const { tree } = await render('Order', OrderScreen, {
    side: 'S',
    code: 'sh600036',
  });
  const [qty] = tree.root.findAll(
    n => n.props.accessibilityLabel === '数量' && n.props.onChangeText,
  );
  await act(async () => {
    qty.props.onChangeText('100');
  });
  // 今天买的 T+1 不能卖
  expect(currentPageContext()!.ctx.lines.join('\n')).toContain(
    '校验不通过：可卖数量',
  );
  const [btn] = tree.root.findAll(
    n =>
      typeof n.props.onPress === 'function' &&
      n.props.accessibilityRole === 'button' &&
      n.findAll(c => c.props.children === '卖出').length > 0,
  );
  await act(async () => {
    await btn.props.onPress();
  });
  expect(JSON.stringify(tree.toJSON())).toContain('T+1');
  const log = await repo.recentActivity(ctx.core.db, 1);
  expect(log[0]).toMatchObject({ kind: 'reject' });
});
