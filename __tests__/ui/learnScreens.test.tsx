/// <reference types="node" />
/**
 * 学习界面（M3）的冒烟测试：在内存库上把学习 Tab、阶段、规则课、费用计算器、集合竞价演示、账户分析、
 * 数据练习都渲染一遍；走一遍「交易费用」小测和竞价演示小测，检查阶段 0 两条通关标准自动打勾、
 * 重置账户不清学习进度、页面上下文带了输入值和作答。
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
import { T } from '../../src/engine';
import type { MarketClient } from '../../src/market/client';
import { parseQuotes } from '../../src/market/tencent';
import { DEFAULT_REFRESH, type Refresher } from '../../src/sim/refresher';
import { Simulator } from '../../src/sim/simulator';
import type { RootStackParamList } from '../../src/ui/navigation/types';
import { useLearn } from '../../src/app/learn';
import { stage0Passed } from '../../src/learn/roadmap';
import type { KBar } from '../../src/market/tencent';
import { AnalysisScreen } from '../../src/ui/screens/AnalysisScreen';
import { AuctionScreen } from '../../src/ui/screens/AuctionScreen';
import { DataLabScreen } from '../../src/ui/screens/DataLabScreen';
import { FeeCalcScreen } from '../../src/ui/screens/FeeCalcScreen';
import {
  ComingScreen,
  LearnScreen,
  StageScreen,
} from '../../src/ui/screens/LearnScreens';
import { LessonScreen } from '../../src/ui/screens/LessonScreens';
import { LESSONS } from '../../src/learn/lessons';

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
  const bars = (closes: number[], dates: string[]): KBar[] =>
    closes.map((c, i) => ({
      date: dates[i],
      open: c,
      close: c,
      high: c,
      low: c,
      volume: 100,
    }));
  const dates = ['2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28'];
  const client = {
    klineRange: async () =>
      bars([4_000_000, 4_010_000, 4_030_000, 3_990_000], dates),
    kline: async () =>
      bars(
        Array.from({ length: 30 }, (_, i) => 10_000 + i * 10),
        Array.from(
          { length: 30 },
          (_, i) => '2026-09-' + String(i + 1).padStart(2, '0'),
        ),
      ),
  } as unknown as MarketClient;
  const sim = await Simulator.open(db, client, () => clock);
  sim.setWatchlist(['sh600036']);
  await sim.ingest(parseQuotes(fx('qt-2026-10-26-1452.txt')));
  await sim.deposit(10_000_000);
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
const wait = () =>
  act(async () => {
    await new Promise(r => setTimeout(r, 30));
  });

let core: AppCore;
beforeAll(async () => {
  core = await setup();
});

test('学习 Tab：当前阶段、工具格、阶段卡片', async () => {
  const r = await render('Tabs', LearnScreen);
  for (const t of [
    '当前阶段',
    '规则课',
    '费用计算器',
    '集合竞价',
    '账户分析',
    '数据练习',
    '完整路线',
  ]) {
    expect(r.text()).toContain(t);
  }
  expect(r.text()).toContain('了解 A 股交易规则');
  expect(ctxText()).toContain('当前阶段：阶段 0');
  expect(ctxText()).toContain('规则课通过 0 / 12 课');
});

test('规则课「交易费用」：全部答对算通过，阶段 0 第一条通关标准自动打勾', async () => {
  const fee = LESSONS.find(l => l.id === 'fee')!;
  const r = await render('Lesson', LessonScreen, { id: 'fee' });
  expect(r.text()).toContain('交易费用');
  // 第一题先答错一次再重做
  const wrong = fee.quiz[0].options.findIndex(
    (_, i) => i !== fee.quiz[0].answer,
  );
  await r.press(fee.quiz[0].options[wrong]);
  expect(ctxText()).toContain('答错，正确答案');
  await r.press('重做');
  for (const q of fee.quiz) {
    await r.press(q.options[q.answer]);
  }
  await wait();
  const { checks } = useLearn.getState();
  expect(checks['lesson:fee']).toBeTruthy();
  expect(checks['s0-p0']?.auto).toBe(true);
  expect(ctxText()).toContain('已通过');
  // 重做不会取消通过
  await r.press('重做');
  expect(useLearn.getState().checks['lesson:fee']).toBeTruthy();
});

test('集合竞价演示：开盘价 10.01，小测答对后阶段 0 通关', async () => {
  const r = await render('Auction', AuctionScreen);
  expect(r.text()).toContain('开盘价 10.01 · 成交 800 手');
  expect(ctxText()).toContain('开盘价 10.01');
  await r.type('价格', '12.00');
  expect(ctxText()).toContain('只能在 9.00 到 11.00 之间');
  await r.press('10.01');
  await wait();
  await wait();
  const { checks } = useLearn.getState();
  expect(checks['demo:auction']).toBeTruthy();
  expect(checks['s0-p1']).toBeTruthy();
  expect(stage0Passed(checks)).toBe(true);
});

test('阶段页：手动项能勾，自动项不能手动改；阶段 0 显示通关', async () => {
  const s0 = await render('Stage', StageScreen, { no: 0 });
  expect(s0.text()).toContain('阶段 0 已通关');
  expect(ctxText()).toContain('还差');
  const s1 = await render('Stage', StageScreen, { no: 1 });
  const item = '把你自己的交割单 CSV 读进 pandas，按月汇总费用';
  await s1.press(item);
  expect(useLearn.getState().checks['s1-e1']?.auto).toBe(false);
  expect(ctxText()).toContain('✓ ' + item + '（手动');
  await s1.press(item);
  expect(useLearn.getState().checks['s1-e1']).toBeUndefined();
});

test('重置账户不清学习进度', async () => {
  await core.sim.resetAccount();
  await render('Tabs', LearnScreen);
  await wait();
  expect(stage0Passed(useLearn.getState().checks)).toBe(true);
  await core.sim.deposit(10_000_000);
});

test('费用计算器：页面上下文带输入值、校验结果和各项费用', async () => {
  const r = await render('FeeCalc', FeeCalcScreen, { code: 'sh600036' });
  await r.type('价格', '40');
  await r.type('数量', '1000');
  expect(ctxText()).toContain('价格 40，数量 1000');
  expect(ctxText()).toContain('校验通过');
  expect(ctxText()).toContain('来回费用 40.80 元');
  expect(r.text()).toContain('保本卖出价');
  await r.type('证券代码', '12');
  expect(ctxText()).toContain('校验不通过');
});

test('账户分析：从交割单和日 K 算出指标，样本少时标注', async () => {
  const r = await render('Analysis', AnalysisScreen);
  await wait();
  expect(r.text()).toContain('累计收益');
  expect(r.text()).toContain('样本');
  expect(r.text()).toContain('收益计算方式');
  await r.press('Beta');
  expect(ctxText()).toContain('展开了「Beta」');
});

test('数据练习：指数数据和答案', async () => {
  const r = await render('DataLab', DataLabScreen);
  await wait();
  expect(r.text()).toContain('指数日线');
  expect(ctxText()).toContain('沪深300 日线 4 行');
  await r.press('对答案');
  expect(ctxText()).toContain('每年收益');
  await r.press('加载');
  await wait();
  expect(ctxText()).toContain('股票长表 25 只');
});

test('M5 说明页', async () => {
  const r = await render('Coming', ComingScreen, { key: 'exec' });
  expect(r.text()).toContain('M5 要做什么');
  expect(ctxText()).toContain('模拟执行');
});
