/// <reference types="node" />
/**
 * 资金和设置界面（M2 第 4 步）的冒烟测试：在内存库上用真实行情把银证转账、资金流水、费率设置、交割单校准、
 * 设置、省电引导、历史账户都渲染一遍，走一遍转账、改费率、校准套用、重置账户，检查页面上下文带了输入值和校验结果。
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
import { T } from '../../src/engine';
import type { MarketClient } from '../../src/market/client';
import { parseQuotes } from '../../src/market/tencent';
import { DEFAULT_REFRESH, type Refresher } from '../../src/sim/refresher';
import { Simulator } from '../../src/sim/simulator';
import type { RootStackParamList } from '../../src/ui/navigation/types';
import {
  AccountsScreen,
  ArchivedAccountScreen,
} from '../../src/ui/screens/AccountsScreens';
import { CalibrateScreen, FeesScreen } from '../../src/ui/screens/FeeScreens';
import { FlowsScreen, TransferScreen } from '../../src/ui/screens/FundsScreens';
import {
  PowerGuideScreen,
  SettingsScreen,
} from '../../src/ui/screens/SettingsScreens';
import { MeScreen, TradeScreen } from '../../src/ui/screens/TabScreens';

jest.mock('../../src/data/drivers/opSqlite', () => ({
  openDeviceDb: () => {
    throw new Error('测试里不用设备数据库');
  },
}));
jest.mock('../../src/app/tracker', () => ({
  nativeTracker: () => null,
  batterySettings: {
    isIgnoring: async () => false,
    request: () => undefined,
    openAppSettings: () => undefined,
  },
  notificationPermission: {
    granted: async () => true,
    request: async () => true,
  },
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
  const refresher = {
    settings: { ...DEFAULT_REFRESH },
    setExtraCodes() {},
    kick() {},
  } as unknown as Refresher;
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
  return { tree, text, type, press };
}

const ctxText = () => currentPageContext()!.ctx.lines.join('\n');

let core: AppCore;
beforeAll(async () => {
  core = await setup();
});

test('交易 Tab 和「我的」：第 4 步的入口都是真页面', async () => {
  const trade = await render('Tabs', TradeScreen);
  expect(trade.text()).not.toContain('第 4 步');
  expect(trade.text()).toContain('去银证转账');
  const me = await render('Tabs', MeScreen);
  for (const t of [
    '银证转账',
    '资金流水',
    '费率设置',
    '交割单校准',
    '设置',
    '后台跟踪与省电',
    '历史账户',
    '重置账户',
  ]) {
    expect(me.text()).toContain(t);
  }
  expect(ctxText()).toContain('默认费率');
});

test('银证转账：页面上下文带输入金额和校验结果，转入后生成交割单', async () => {
  const r = await render('Transfer', TransferScreen, { dir: 'in' });
  await r.type('转账金额', '500000');
  expect(ctxText()).toContain('输入金额：500000 元');
  expect(ctxText()).toContain('校验不通过：模拟入金上限');
  expect(r.text()).toContain('还可转入');
  await r.press('10 万');
  expect(ctxText()).toContain('校验通过');
  await r.press('转入');
  const st = core.sim.engine.state;
  expect(st.depositTotal).toBe(10_000_000);
  expect(st.ledger[0].biz).toBe('银行转证券');
  expect(r.text()).toContain('今天的转账');
  // 转出超过可取
  const out = await render('Transfer', TransferScreen, { dir: 'out' });
  await out.type('转账金额', '200000');
  expect(ctxText()).toContain('校验不通过：可取资金不足');
});

test('资金流水：汇总和列表', async () => {
  const r = await render('Flows', FlowsScreen);
  expect(r.text()).toContain('费用合计');
  expect(r.text()).toContain('银行转证券');
  expect(ctxText()).toContain('转入 100,000.00 元');
});

test('费率设置：校验、保存，已挂委托不受影响', async () => {
  const snap = core.sim.engine.snapshot('sh600036')!;
  const placed = await core.sim.placeOrder({
    code: 'sh600036',
    side: 'B',
    kind: 'limit',
    price: snap.bids[0][0] - 50,
    qty: 100,
  });
  if (!placed.ok) {
    throw new Error(placed.msg);
  }
  const frozen = placed.order.frozen;
  const r = await render('Fees', FeesScreen);
  expect(r.text()).toContain('法定费用');
  await r.type('股票佣金率', '31');
  expect(ctxText()).toContain('表单校验不通过');
  expect(ctxText()).toContain('万 30');
  await r.type('股票佣金率', '1');
  expect(ctxText()).toContain('未保存的修改：股票佣金率 万 2.5 → 万 1');
  expect(ctxText()).toContain('未完成委托 1 笔');
  expect(r.text()).toContain('笔委托沿用原费率');
  await r.press('保存');
  expect(core.sim.engine.state.fee.stockRate).toBe(10_000);
  expect(core.sim.engine.state.orders[0].frozen).toBe(frozen);
  const [log] = await repo.recentActivity(core.db, 1);
  expect(log).toMatchObject({ kind: 'setting' });
  await core.sim.cancelOrder(placed.order.id);
});

test('交割单校准：录入 → 比对 → 套用 → 已校准', async () => {
  const r = await render('Calibrate', CalibrateScreen);
  await r.type('证券代码', '600036');
  await r.type('成交价', '41.80');
  await r.type('成交数量', '1000');
  expect(ctxText()).toContain('还没填：佣金、印花税、过户费');
  await r.type('佣金', '4.18');
  await r.type('印花税', '20.90');
  await r.type('过户费', '0.42');
  expect(r.text()).toContain('App 计算');
  expect(ctxText()).toContain('录入校验通过');
  // 上一个测试把股票佣金率改成了万 1（最低 5 元），所以 App 算出 5.00
  expect(ctxText()).toContain('佣金 App 5.00 / 交割单 4.18');
  expect(ctxText()).toContain('免五');
  const btn = r.tree.root.findAll(
    n =>
      typeof n.props.onPress === 'function' &&
      n.props.accessibilityRole === 'button' &&
      n.findAll(
        c =>
          typeof c.props.children === 'string' &&
          c.props.children.startsWith('套用到费率设置'),
      ).length > 0,
  )[0];
  await act(async () => {
    await btn.props.onPress();
  });
  expect(core.sim.engine.state.fee).toMatchObject({
    stockRate: 10_000,
    stockMinFen: 10,
    calibratedStock: true,
  });
  expect(await repo.getSetting(core.db, 'lastCalibration', null)).toMatchObject(
    { code: 'sh600036', allOk: true },
  );
});

test('设置：改后台跟踪模式记日志；入金上限校验', async () => {
  const r = await render('Settings', SettingsScreen);
  expect(ctxText()).toContain('后台跟踪：有委托时自动');
  await r.press('后台跟踪 交易时段全程');
  expect(core.refresher.settings.backgroundMode).toBe('session');
  expect(await repo.getSetting(core.db, 'refresh', {})).toMatchObject({
    backgroundMode: 'session',
  });
  const [log] = await repo.recentActivity(core.db, 1);
  expect(log.text).toBe('后台跟踪 有委托时自动 → 交易时段全程');
  await r.type('累计净入金上限', '50000');
  expect(ctxText()).toContain('校验不通过：不能低于已经转入的 100,000.00 元');
  await r.press('持仓列表的成本口径 买入均价');
  const [log2] = await repo.recentActivity(core.db, 1);
  expect(log2.text).toBe('持仓成本口径 摊薄成本 → 买入均价');
});

test('后台跟踪与省电：检测结果和步骤', async () => {
  const r = await render('PowerGuide', PowerGuideScreen);
  expect(r.text()).toContain('省电策略');
  expect(ctxText()).toContain('① 系统电池优化：没关闭');
  expect(ctxText()).toContain('⑤ 通知权限：已允许');
  await r.press('我已设置');
  expect(await repo.getSetting(core.db, 'powerGuide', {})).toMatchObject({
    saver: true,
  });
});

test('历史账户：重置 → 旧账户归档，可以查看交割单', async () => {
  const oldId = core.sim.accountId;
  const r = await render('Accounts', AccountsScreen);
  await r.press('重置账户');
  await r.press('归档并重置');
  expect(core.sim.accountId).not.toBe(oldId);
  expect(core.sim.engine.state.cash).toBe(0);
  // 费率沿用
  expect(core.sim.engine.state.fee.calibratedStock).toBe(true);
  const a = await render('ArchivedAccount', ArchivedAccountScreen, {
    id: oldId,
  });
  expect(a.text()).toContain('导出 CSV');
  expect(a.text()).toContain('银行转证券');
  expect(ctxText()).toContain('交割单 1 条');
  expect(currentPageContext()!.ctx.name).toBe('历史账户 · 模拟账户 1');
});
