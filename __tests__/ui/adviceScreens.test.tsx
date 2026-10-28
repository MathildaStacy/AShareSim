/// <reference types="node" />
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useApp, type AppCore } from '../../src/app/boot';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import type { MarketClient } from '../../src/market/client';
import type { Quote } from '../../src/market/tencent';
import { Simulator } from '../../src/sim/simulator';
import type { Refresher } from '../../src/sim/refresher';
import type { RootStackParamList } from '../../src/ui/navigation/types';
import { saveStrategy, loadRebalance } from '../../src/portfolio/repo';
import { DEFAULT_STRATEGY } from '../../src/portfolio/types';
import { T } from '../../src/engine/session';
import { createProposal } from '../../src/advice/service';
import { proposalById } from '../../src/advice/repo';
import { ProposalCard } from '../../src/ui/components/ProposalCard';
import {
  AiFlowsScreen,
  ProposalsScreen,
} from '../../src/ui/screens/AdviceScreens';
import { SettingsScreen } from '../../src/ui/screens/SettingsScreens';
import { flowRuns, loadFlows } from '../../src/ai/flows';
import { DEFAULT_REFRESH } from '../../src/sim/refresher';

jest.mock('../../src/data/drivers/opSqlite', () => ({
  openDeviceDb: jest.fn(),
}));
jest.mock('../../src/app/tracker', () => ({
  nativeTracker: () => null,
  batterySettings: { isIgnoring: async () => true },
  notificationPermission: { granted: async () => true },
}));
const mockAsk = jest.fn(async () => undefined);
jest.mock('../../src/ai/chat', () => {
  const actual = jest.requireActual('../../src/ai/chat');
  return { ...actual, ask: (...a: unknown[]) => mockAsk(...(a as [])) };
});

const Stack = createNativeStackNavigator<RootStackParamList>();
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(async () => {
  for (const t of mounted.splice(0)) {
    await act(async () => t.unmount());
  }
});
const quote = (code: string): Quote =>
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
      bids: [[9990, 100000]],
      asks: [[10000, 100000]],
      up: 11000,
      down: 9000,
    },
    info: {
      code,
      name: code === 'sh510300' ? '沪深300ETF' : '招商银行',
      type: code === 'sh510300' ? 'ETF' : 'GP-A',
    },
  } as Quote);

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  const client = {
    quotes: async (codes: string[]) => codes.map(quote),
    klineRange: async () => [],
  } as unknown as MarketClient;
  const sim = await Simulator.open(db, client, () => ({
    date: '2026-10-26',
    t: T(10, 0),
  }));
  await sim.ingest([quote('sh600036'), quote('sh510300')]);
  await sim.deposit(10000000);
  const refresher = {
    settings: { ...DEFAULT_REFRESH },
    setExtraCodes() {},
    kick() {},
  } as unknown as Refresher;
  const core = { db, client, sim, refresher } as AppCore;
  useApp.setState({ core, version: 1 });
  await saveStrategy(db, DEFAULT_STRATEGY);
  return core;
}

async function render(
  name: keyof RootStackParamList,
  component: React.ComponentType<any>,
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
            <Stack.Screen name={name} component={component} />
            <Stack.Screen name="Ai" component={() => null} />
            <Stack.Screen name="Rebalance" component={() => null} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>,
    );
  });
  mounted.push(tree);
  const settle = () =>
    act(async () => {
      await new Promise(r => setTimeout(r, 30));
    });
  await settle();
  const text = () => JSON.stringify(tree.toJSON());
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
    await settle();
  };
  const type = async (label: string, v: string) => {
    const [n] = tree.root.findAll(
      x => x.props.accessibilityLabel === label && x.props.onChangeText,
    );
    await act(async () => n.props.onChangeText(v));
  };
  return { tree, text, press, type, settle };
}

test('提案卡：批准调仓方案 → 批量操作卡逐笔预校验 → 一次执行', async () => {
  const core = await setup();
  const p = await createProposal(core, {
    threadId: null,
    kind: 'rebalance',
    items: [
      {
        code: 'sh600036',
        name: '招商银行',
        stance: 'buy',
        weight: 0.2,
        priceLow: null,
        priceHigh: null,
      },
      {
        code: 'sh510300',
        name: '沪深300ETF',
        stance: 'buy',
        weight: 0.3,
        priceLow: null,
        priceHigh: null,
      },
    ],
    horizonDays: 5,
    benchmark: 'sh510300',
    thesis: '底仓',
    invalidation: '跌破 9 元',
  });
  const Host = () => <ProposalCard id={p.id} onOpen={() => undefined} />;
  const r = await render('Proposals', Host);
  expect(r.text()).toContain('调仓提案 #1 · 待你决定');
  expect(r.text()).toContain('余下 50% 留现金');
  await r.press('批准并预检');
  expect(r.text()).toContain('批量操作卡 · 2 笔委托');
  expect(r.text()).toContain('预校验通过（含风险校验）');
  expect(r.text()).toContain('全部通过，一次确认提交');
  await r.press('执行');
  expect((await proposalById(core.db, p.id))!.status).toBe('executed');
  expect(core.sim.engine.state.orders).toHaveLength(2);
  expect(r.text()).toContain('已提交 2 笔委托');
  const rb = await loadRebalance(
    core.db,
    (await proposalById(core.db, p.id))!.rebalanceId!,
    core.sim.accountId,
  );
  expect(rb.status).toBe('executing');
});

test('提案卡：风险限额拦下时执行按钮不可点，单只建议批准不下单', async () => {
  const core = await setup();
  await core.sim.setRiskLimits({
    maxWeight: 0.1,
    maxTurnover: null,
    noSt: false,
  });
  const p = await createProposal(core, {
    threadId: null,
    kind: 'rebalance',
    items: [
      {
        code: 'sh600036',
        name: '招商银行',
        stance: 'buy',
        weight: 0.2,
        priceLow: null,
        priceHigh: null,
      },
    ],
    horizonDays: 5,
    benchmark: 'sh510300',
    thesis: '试',
    invalidation: '试',
  });
  const single = await createProposal(core, {
    threadId: null,
    kind: 'single',
    items: [
      {
        code: 'sh600036',
        name: '招商银行',
        stance: 'buy',
        weight: 0.05,
        priceLow: 9800,
        priceHigh: 10000,
      },
    ],
    horizonDays: 20,
    benchmark: 'sh510300',
    thesis: '试',
    invalidation: '试',
  });
  const Host = () => (
    <>
      <ProposalCard id={p.id} onOpen={() => undefined} />
      <ProposalCard id={single.id} onOpen={() => undefined} />
    </>
  );
  const r = await render('Proposals', Host);
  await act(async () => {
    const [btn] = r.tree.root.findAll(
      n =>
        n.props.accessibilityRole === 'button' &&
        n.findAll(c => c.props.children === '批准并预检').length > 0,
    );
    await btn.props.onPress();
  });
  await r.settle();
  expect(r.text()).toContain('风险限额：单票上限 10%');
  const exec = r.tree.root.findAll(
    n =>
      n.props.accessibilityRole === 'button' &&
      n.findAll(c => c.props.children === '执行').length > 0,
  )[0];
  expect(exec.props.accessibilityState).toEqual({ disabled: true });
  await r.press('批准');
  expect(r.text()).toContain('批准不等于下单');
  expect(core.sim.engine.state.orders).toHaveLength(0);
});

test('提案与记分卡页：样本太少、提案列表', async () => {
  const core = await setup();
  await createProposal(core, {
    threadId: null,
    kind: 'single',
    items: [
      {
        code: 'sh600036',
        name: '招商银行',
        stance: 'watch',
        weight: null,
        priceLow: null,
        priceHigh: null,
      },
    ],
    horizonDays: 5,
    benchmark: 'sh510300',
    thesis: '等回调',
    invalidation: '放量突破',
  });
  const r = await render('Proposals', ProposalsScreen);
  expect(r.text()).toContain('AI 的提案');
  expect(r.text()).toContain('样本太少');
  expect(r.text()).toContain('#1 观望 招商银行');
  await act(async () => {
    const [tab] = r.tree.root.findAll(
      n =>
        n.props.accessibilityRole === 'tab' &&
        n.findAll(c => c.props.children === '决策日志 0').length > 0,
    );
    tab.props.onPress();
  });
  expect(r.text()).toContain('还没有决策日志');
});

test('预设流程：内置三个；运行时模板放在附带内容里；记下运行；自定义流程校验', async () => {
  const core = await setup();
  const r = await render('AiFlows', AiFlowsScreen);
  expect(r.text()).toContain('个股体检');
  expect(r.text()).toContain('周度复盘');
  expect(r.text()).toContain('调仓前检查');
  const runs = r.tree.root.findAll(
    n =>
      n.props.accessibilityRole === 'button' &&
      n.findAll(c => c.props.children === '运行').length > 0,
  );
  await act(async () => runs[0].props.onPress());
  expect(r.text()).toContain('要先填一只证券');
  await r.type('个股体检 证券', '600036');
  await act(async () => runs[0].props.onPress());
  await r.settle();
  expect(mockAsk).toHaveBeenCalledTimes(1);
  const input = (mockAsk.mock.calls[0] as unknown[])[1] as {
    question: string;
    attach: { label: string; text: string };
  };
  expect(input.question).toBe('运行预设流程「个股体检」：600036');
  expect(input.attach.label).toBe('预设流程「个股体检」');
  expect(input.attach.text).toContain('<flow name="个股体检">');
  expect(input.attach.text).toContain('get_financials');
  expect(input.attach.text).toContain('最后用 propose 记下这条建议');
  await r.settle();
  expect((await flowRuns(core)).length).toBe(0); // 没有对话 id（ask 被替换）时不记
  const r2 = await render('AiFlows', AiFlowsScreen);
  await r2.press('新建');
  await r2.press('保存');
  expect(r2.text()).toContain('要写名称');
  await r2.type('流程名称', '看分红');
  await r2.type('流程步骤', 'get_corp_actions\nget_quote');
  await r2.type('输出模板', '列出股息率');
  await r2.press('保存');
  expect((await loadFlows(core)).map(f => f.name)).toContain('看分红');
});

test('设置页：风险限额保存后下单校验生效', async () => {
  const core = await setup();
  const r = await render('Settings', SettingsScreen);
  expect(r.text()).toContain('风险限额');
  await r.type('单票上限', '15');
  await act(async () => {
    const [sw] = r.tree.root.findAll(
      n => n.props.accessibilityLabel === '禁买 ST' && n.props.onValueChange,
    );
    sw.props.onValueChange(true);
  });
  await r.press('保存风险限额');
  expect(core.sim.engine.state.risk).toEqual({
    maxWeight: 0.15,
    maxTurnover: null,
    noSt: true,
  });
  const c = core.sim.checkOrder({
    code: 'sh600036',
    side: 'B',
    kind: 'limit',
    price: 10000,
    qty: 2000,
    protect: null,
  });
  expect(c).toMatchObject({ ok: false, rule: '风险限额' });
});
