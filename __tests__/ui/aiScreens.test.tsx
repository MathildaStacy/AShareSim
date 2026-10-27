/// <reference types="node" />
/**
 * AI 界面（M4）的冒烟测试：在内存库上渲染 AI 对话、对话列表、AI 记忆、AI 服务、编辑服务、上下文页；
 * 走一遍添加服务（Key 进 Keystore、不进页面上下文和设置表）、提问、执行操作卡、navigate 预填下单页和转账页。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { newThread, setAiDeps, useChat } from '../../src/ai/chat';
import { currentPageContext, setPageContext } from '../../src/ai/context';
import type { FetchLike } from '../../src/ai/http';
import { keychainStore, loadPrefs, loadServices } from '../../src/ai/services';
import { useApp, type AppCore } from '../../src/app/boot';
import * as aiRepo from '../../src/data/aiRepo';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import * as repo from '../../src/data/repos';
import { T } from '../../src/engine';
import type { MarketClient } from '../../src/market/client';
import { parseQuotes } from '../../src/market/tencent';
import { DEFAULT_REFRESH, type Refresher } from '../../src/sim/refresher';
import { Simulator } from '../../src/sim/simulator';
import type { RootStackParamList } from '../../src/ui/navigation/types';
import { AiScreen } from '../../src/ui/screens/AiScreen';
import {
  AiContextScreen,
  AiMemoryScreen,
  AiServiceScreen,
  AiServicesScreen,
  AiThreadsScreen,
} from '../../src/ui/screens/AiScreens';
import { TransferScreen } from '../../src/ui/screens/FundsScreens';
import { OrderScreen } from '../../src/ui/screens/OrderScreen';

jest.mock('../../src/data/drivers/opSqlite', () => ({
  openDeviceDb: () => {
    throw new Error('测试里不用设备数据库');
  },
}));
jest.mock('../../src/app/tracker', () => ({ nativeTracker: () => null }));

const fx = (name: string) =>
  readFileSync(join(__dirname, '../market/fixtures', name), 'utf8');

const Stack = createNativeStackNavigator<RootStackParamList>();

let replies: unknown[] = [];
const sent: any[] = [];
const fetchMock: FetchLike = async (_url, init) => {
  sent.push(JSON.parse(init.body));
  const json = replies.shift();
  return { status: 200, text: async () => JSON.stringify(json) };
};

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  const clock = { date: '2026-10-26', t: T(14, 53) };
  const quotes = parseQuotes(fx('qt-2026-10-26-1452.txt'));
  const client = {
    quotes: async (codes: string[]) =>
      quotes.filter(q => codes.includes(q.snapshot.code)),
    search: async () => [],
  } as unknown as MarketClient;
  const sim = await Simulator.open(db, client, () => clock);
  await sim.ingest(quotes);
  await sim.deposit(10_000_000);
  const refresher = {
    settings: { ...DEFAULT_REFRESH },
    setExtraCodes() {},
    kick() {},
  } as unknown as Refresher;
  const core = { db, client, sim, refresher } as AppCore;
  useApp.setState({ core, version: 1 });
  // Keystore 用 __mocks__/react-native-keychain.js（内存）
  setAiDeps({ keys: keychainStore, fetch: fetchMock });
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
    await new Promise(r => setTimeout(r, 30));
  });
  const text = () => JSON.stringify(tree.toJSON());
  const type = async (label: string, v: string) => {
    const [n] = tree.root.findAll(
      x => x.props.accessibilityLabel === label && x.props.onChangeText,
    );
    if (!n) {
      throw new Error('找不到输入框：' + label);
    }
    await act(async () => {
      n.props.onChangeText(v);
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
      await new Promise(r => setTimeout(r, 20));
    });
  };
  return { tree, text, type, press };
}

const ctxText = () => currentPageContext()!.ctx.lines.join('\n');

let core: AppCore;
beforeAll(async () => {
  core = await setup();
});

test('没配服务时，AI 页提示去配置', async () => {
  const r = await render('Ai', AiScreen);
  expect(r.text()).toContain('去配置 AI 服务');
  expect(r.text()).toContain('AI 不荐股');
});

test('添加服务：校验、Key 存 Keystore，页面上下文只写「已填」', async () => {
  const r = await render('AiService', AiServiceScreen, {});
  await r.press('保存');
  expect(r.text()).toContain('起个名字');
  await r.type('名称', '测试中转');
  await r.type('Base URL', 'https://relay.example.com');
  await r.type('API Key', 'sk-ui-secret-123456');
  await r.type('模型', 'claude-sonnet-5-5');
  await r.press('鉴权头 Bearer');
  expect(ctxText()).toContain('API Key：已填（未保存）');
  expect(ctxText()).toContain('表单校验：通过');
  expect(ctxText()).not.toContain('sk-ui-secret');
  await r.press('保存');
  const list = await loadServices(core.db);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({
    name: '测试中转',
    auth: 'bearer',
    keyTail: '3456',
  });
  expect(await keychainStore.get(list[0].id)).toBe('sk-ui-secret-123456');
  expect((await loadPrefs(core.db)).activeService).toBe(list[0].id);
  // Key 不在设置表里
  const rows = await core.db.all<{ value: string }>(
    'SELECT value FROM settings',
  );
  expect(JSON.stringify(rows)).not.toContain('sk-ui-secret');
  const acts = await repo.recentActivity(core.db, 5, core.sim.accountId);
  expect(acts[0].text).toContain('添加 AI 服务 测试中转');
  const services = await render('AiServices', AiServicesScreen);
  expect(services.text()).toContain('使用中');
});

test('提问：回答、用到的工具、操作卡、执行；上下文条和用量', async () => {
  setPageContext('Stock', () => ({
    name: '个股 · 招商银行',
    lines: ['现价 42.30 元'],
  }));
  newThread();
  replies = [
    {
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 't1',
          name: 'place_order',
          input: { code: '600036', side: 'B', price: 42.3, qty: 100 },
        },
      ],
      usage: {
        input_tokens: 3000,
        cache_creation_input_tokens: 2500,
        cache_read_input_tokens: 0,
        output_tokens: 40,
      },
    },
    {
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: '确认后会以 **42.30 元**买入 100 股 [招商银行](stock:sh600036)。\n\n仅供学习，不构成投资建议',
        },
      ],
      usage: {
        input_tokens: 80,
        cache_creation_input_tokens: 60,
        cache_read_input_tokens: 5500,
        output_tokens: 30,
      },
    },
  ];
  const r = await render('Ai', AiScreen);
  expect(r.text()).toContain('页面：个股 · 招商银行');
  await r.type('问 AI', '帮我 42.30 买 100 股招商银行');
  await r.press('发送');
  await act(async () => {
    await new Promise(res => setTimeout(res, 50));
  });
  const t = r.text();
  expect(t).toContain('帮我 42.30 买 100 股招商银行');
  expect(t).toContain('附带：个股 · 招商银行');
  expect(t).toContain('操作卡 #1 · 买入 招商银行');
  expect(t).toContain('预校验：校验通过');
  expect(t).toContain('42.30 元');
  expect(t).toContain('缓存读 5,500 · 写 2,560');
  expect(sent[0].messages[0].content[0].text).toContain(
    '页面：个股 · 招商银行',
  );
  await r.press('执行');
  expect(core.sim.engine.state.orders).toHaveLength(1);
  expect(r.text()).toContain('已执行 → 已提交，合同号');
});

test('对话列表、AI 记忆、上下文页', async () => {
  const threads = await render('AiThreads', AiThreadsScreen);
  expect(threads.text()).toContain('帮我 42.30 买 100 股招商银行');
  await aiRepo.addMemory(
    core.db,
    { kind: 'plan', text: '每周一集合竞价调仓', sourceThreadId: null },
    '2026-10-26T15:00:00',
  );
  const mem = await render('AiMemory', AiMemoryScreen);
  expect(mem.text()).toContain('每周一集合竞价调仓');
  expect(ctxText()).toContain('记忆模式：自动记住');
  expect(ctxText()).toContain('[计划] 每周一集合竞价调仓');
  await mem.press('记忆模式 先问我');
  expect((await loadPrefs(core.db)).memoryMode).toBe('ask');
  useChat.setState({
    source: {
      route: 'Stock',
      get: () => ({ name: '个股 · 招商银行', lines: [] }),
    },
  });
  const ctx = await render('AiContext', AiContextScreen);
  const ct = ctx.text();
  expect(ct).toContain('工具定义（23 个）');
  expect(ct).toContain('断点 1（所有对话共用）');
  expect(ct).toContain('实际请求结构（JSON）');
  expect(ct).not.toContain('sk-ui-secret');
  await ctx.press('附带最近操作 5 条');
  expect((await loadPrefs(core.db)).recentN).toBe(5);
});

test('navigate 预填：下单页的价格和数量、转账页的金额', async () => {
  await render('Order', OrderScreen, {
    side: 'B',
    code: 'sh510300',
    price: 4170,
    qty: 300,
  });
  expect(ctxText()).toContain('4.170');
  expect(ctxText()).toContain('300');
  await render('Transfer', TransferScreen, { dir: 'in', amount: 500_000 });
  expect(ctxText()).toContain('输入金额：5000 元');
});
