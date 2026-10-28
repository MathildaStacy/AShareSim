import { loadThread, selectConfig } from '../../src/ai/chat';
import {
  emptyProvider,
  loadProviders,
  saveProviders,
} from '../../src/ai/services';
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

const rendered: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => {
    for (const t of rendered.splice(0)) {
      t.unmount();
    }
  });
});

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
        <NavigationContainer
          onUnhandledAction={action => {
            // 单屏测试没有上一级，保存后的返回由 Android 端到端覆盖。
            if (action.type !== 'GO_BACK') {
              throw new Error('未处理导航：' + action.type);
            }
          }}
        >
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
  rendered.push(tree);
  const text = () =>
    JSON.stringify(tree.toJSON(), (key, value) =>
      key === 'props'
        ? { accessibilityLabel: value.accessibilityLabel, value: value.value }
        : value,
    );
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
  expect(r.text()).toContain('配置供应商与模型');
  expect(r.text()).not.toContain('AI 不荐股');
});

test('添加供应商和模型：Key 保存在安全存储，设置和日志不含 Key', async () => {
  const r = await render('AiService', AiServiceScreen, {});
  await r.press('添加 自定义');
  await r.press('保存供应商');
  expect(r.text()).toContain('请填写供应商名称');
  await r.type('供应商名称', '测试中转');
  await r.type('Base URL', 'https://relay.example.com');
  await r.type('API Key', 'sk-ui-secret-123456');
  await r.press('协议 Anthropic Messages');
  await r.press('鉴权方式 Bearer');
  await r.type('手动添加模型', 'claude-sonnet-5-5');
  await r.press('添加模型');
  await r.press('保存供应商');
  const list = await loadServices(core.db);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({
    name: '测试中转',
    auth: 'bearer',
    keyTail: '3456',
  });
  expect(await keychainStore.get(list[0].id)).toBe('sk-ui-secret-123456');
  const rows = await core.db.all<{ value: string }>(
    'SELECT value FROM settings',
  );
  expect(JSON.stringify(rows)).not.toContain('sk-ui-secret');
  const acts = await repo.recentActivity(core.db, 5, core.sim.accountId);
  expect(acts[0].text).toContain('添加供应商 测试中转');
  const services = await render('AiServices', AiServicesScreen);
  expect(services.text()).toContain('1 个已启用模型');
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
          text: '确认后会以 **42.30 元**买入 100 股 [招商银行](stock:sh600036)。',
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
  expect(r.text()).toContain('个股 · 招商银行');
  await r.type('问 AI', '帮我 42.30 买 100 股招商银行');
  await r.press('发送');
  await act(async () => {
    await new Promise(res => setTimeout(res, 50));
  });
  const t = r.text();
  expect(t).toContain('帮我 42.30 买 100 股招商银行');
  expect(t).toContain('已附带上下文：页面 个股 · 招商银行');
  expect(t).toContain('操作卡 #1 · 买入 招商银行');
  expect(t).toContain('预校验：校验通过');
  expect(t).toContain('42.30 元');
  expect(t).not.toContain('仅供学习，不构成投资建议');
  expect(t).not.toContain('缓存读 5,500');
  await r.press('用量详情');
  expect(r.text()).toContain('缓存读 5,500 · 写 2,560');
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
  expect(ct).toContain('工具定义（27 个）');
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

test('处理过程默认折叠、展开后可追溯，异常数量可见；向上读时提供回到最新入口', async () => {
  const r = await render('Ai', AiScreen);
  await act(async () => {
    useChat.setState({
      messages: [
        {
          id: 1000,
          threadId: 1,
          role: 'tool',
          parts: [],
          raw: null,
          compacted: false,
          createdAt: '',
          ui: {
            tools: [
              { id: 'read', name: 'get_positions', label: '读取 账户和持仓' },
              {
                id: 'error',
                name: 'get_quote',
                label: '行情查询失败，请重试',
                error: true,
              },
            ],
          },
        },
      ],
    });
  });
  expect(r.text()).toContain('工具记录 2 项');
  expect(r.text()).not.toContain('读取 账户和持仓');
  expect(r.text()).toContain('异常 1 项');
  expect(r.text()).not.toContain('行情查询失败，请重试');
  await r.press('处理过程');
  expect(r.text()).toContain('行情查询失败，请重试');
  expect(r.text()).toContain('读取 账户和持仓');
  await r.press('处理过程');
  expect(r.text()).not.toContain('读取 账户和持仓');
  const list = r.tree.root.findAll(
    n => n.props.onScrollBeginDrag && n.props.onScroll,
  )[0];
  await act(async () => {
    list.props.onScrollBeginDrag();
    list.props.onScroll({
      nativeEvent: {
        contentSize: { height: 2000 },
        contentOffset: { y: 100 },
        layoutMeasurement: { height: 600 },
      },
    });
  });
  expect(r.text()).toContain('回到最新回复');
  await r.press('回到最新回复');
  expect(r.text()).not.toContain('回到最新回复');
  // 收起明细导致原生滚动位置被夹到末尾，也应隐藏按钮，不依赖一次新的手势。
  await act(async () => {
    list.props.onScrollEndDrag();
    list.props.onScroll({
      nativeEvent: {
        contentSize: { height: 1000 },
        contentOffset: { y: 400 },
        layoutMeasurement: { height: 600 },
      },
    });
  });
  expect(r.text()).not.toContain('回到最新回复');
  await act(async () => {
    r.tree.unmount();
  });
});

test('供应商模型列表来自接口；401 / 404 反馈，未知模型可标注，草稿不提前覆盖配置', async () => {
  const before = await loadProviders(core.db);
  let status = 401;
  setAiDeps({
    fetch: async (_url, init) => {
      expect(init.method).toBe('GET');
      return {
        status,
        text: async () =>
          JSON.stringify(
            status === 200
              ? {
                  data: [
                    { id: 'relay-mix-pro' },
                    { id: 'text-embedding-3-small' },
                  ],
                }
              : { error: { message: 'mock failure' } },
          ),
      };
    },
  });
  const r = await render('AiService', AiServiceScreen, {});
  await r.press('添加 自定义');
  await r.type('供应商名称', '新中转');
  await r.type('Base URL', 'https://relay.example.com/v1');
  await r.type('API Key', 'sk-never-in-context');
  await r.press('获取模型列表');
  expect(r.text()).toContain('HTTP 401');
  status = 404;
  await r.press('获取模型列表');
  expect(r.text()).toContain('HTTP 404');
  status = 200;
  await r.press('获取模型列表');
  expect(r.text()).toContain('relay-mix-pro');
  expect(r.text()).toContain('能力未知');
  await r.press('启用模型 relay-mix-pro');
  await r.press('模型能力 relay-mix-pro');
  await r.press('App 工具调用 支持');
  await r.press('联网搜索 支持');
  await r.press('思考参数格式 开关 / 供应商参数');
  await r.press('可用档位 关闭');
  await r.press('可用档位 开启');
  await r.type('上下文长度', '64000');
  await r.press('应用模型设置');
  expect(await loadProviders(core.db)).toEqual(before);
  expect(ctxText()).not.toContain('sk-never-in-context');
  await r.press('保存供应商');
  const after = await loadProviders(core.db),
    p = after.find(x => x.name === '新中转')!;
  expect(p.models.find(m => m.id === 'relay-mix-pro')).toMatchObject({
    enabled: true,
    overrides: {
      tools: true,
      search: true,
      thinking: ['off', 'on'],
      context: 64000,
    },
  });
  expect(p.models.find(m => m.id === 'text-embedding-3-small')?.enabled).toBe(
    false,
  );
  setAiDeps({ fetch: fetchMock });
});

test('聊天模型、搜索、思考跟随对话；虚线搜索可引导选择可用模型', async () => {
  const ps = await loadProviders(core.db),
    p = emptyProvider('deepseek');
  p.models = [{ id: 'deepseek-reasoner', enabled: true, price: null }];
  p.keyTail = '0000';
  await keychainStore.set(p.id, 'mock-test-key');
  await saveProviders(core.db, [...ps, p]);
  newThread();
  await selectConfig(core, {
    providerId: p.id,
    model: 'deepseek-reasoner',
    effort: 'off',
    search: true,
  });
  const r = await render('Ai', AiScreen); // 打开 AI 会接最近对话，随后显式选择新对话
  await act(async () => {
    newThread();
    await selectConfig(core, {
      providerId: p.id,
      model: 'deepseek-reasoner',
      effort: 'off',
      search: false,
    });
  });
  await r.press('思考强度');
  expect(r.text()).toContain('这个模型始终思考，无法关闭');
  await r.press('关闭');
  await r.press('联网搜索');
  expect(r.text()).toContain('DeepSeek 的接口不支持联网搜索');
  await r.press('查看能搜索的模型');
  expect(r.text()).toContain('选择能搜索的模型');
  await r.press('关闭');
  await r.press('选择模型');
  await r.press('测试中转 claude-sonnet-5-5');
  expect(useChat.getState().config?.model).toBe('claude-sonnet-5-5');
  expect(
    r.tree.root.findAll(
      n => n.props.accessibilityLabel === '选择模型' && n.props.onPress,
    )[0].props.accessibilityValue.text,
  ).toBe('claude-sonnet-5-5');
  await r.press('思考强度');
  expect(r.text()).toContain('最高');
  expect(
    r.tree.root.findAll(x => x.props.accessibilityLabel === '思考 关闭'),
  ).toHaveLength(0);
  await r.press('思考 最高');
  expect(useChat.getState().config?.effort).toBe('max');
  expect(
    r.tree.root.findAll(
      n => n.props.accessibilityLabel === '思考强度' && n.props.onPress,
    )[0].props.accessibilityValue.text,
  ).toBe('最高');
  await act(async () => {
    await loadThread(core, null);
  });
});

test('来源和正文编号可点击；隐藏原始思考且保留公开摘要，历史费用使用回答时的价格', async () => {
  const { Linking } = require('react-native');
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const r = await render('Ai', AiScreen);
  await act(async () => {
    useChat.setState({
      messages: [
        {
          id: 9999,
          threadId: useChat.getState().threadId ?? 1,
          role: 'assistant',
          parts: [{ t: 'text', text: '建议持有。' }],
          raw: {
            protocol: 'openai',
            model: 'test-model',
            items: [
              {
                type: 'reasoning',
                summary: [{ type: 'summary_text', text: '**公开处理摘要**' }],
              },
            ],
          },
          compacted: false,
          createdAt: '',
          ui: {
            thinking: '内部推理不可展示',
            price: {
              input: 1000,
              cacheRead: 100,
              cacheWrite: 1250,
              output: 2000,
            },
            usage: {
              input: 100,
              cacheRead: 0,
              cacheWrite: 0,
              output: 100,
              cacheReported: true,
            },
            search: {
              queries: ['公告查询'],
              sources: [
                { url: 'https://www.cmbchina.com/', title: '实际返回的公告' },
              ],
              citations: [{ end: 5, source: 0 }],
              calls: 1,
            },
          },
        },
      ],
    });
  });
  expect(r.text()).toContain('1 个来源');
  expect(r.text()).not.toContain('实际返回的公告');
  expect(r.text()).not.toContain('公开处理摘要');
  await r.press('查看来源');
  expect(r.text()).toContain('实际返回的公告');
  await r.press('用量详情');
  expect(r.text()).toContain('$0.0003');
  await r.press('处理过程');
  expect(r.text()).not.toContain('内部推理不可展示');
  expect(r.text()).not.toContain('**公开处理摘要**');
  expect(r.text()).toContain('公开处理摘要');
  const citation = r.tree.root.findAll(
    n =>
      n.props.accessibilityRole === 'link' &&
      typeof n.props.onPress === 'function' &&
      n.props.accessibilityLabel === '来源 1',
  )[0];
  expect(citation).toBeDefined();
  await act(async () => {
    citation.props.onPress();
  });
  expect(open).toHaveBeenCalledWith('https://www.cmbchina.com/');
  const { Share } = require('react-native');
  const share = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: 'sharedAction' });
  await r.press('分享回答');
  expect(share).toHaveBeenCalledWith({
    message: expect.stringContaining('https://www.cmbchina.com/'),
  });
  share.mockRestore();
  open.mockRestore();
});

test('新对话清空草稿，快捷问题只在空对话显示，流式正文和忙碌控件可读', async () => {
  const r = await render('Ai', AiScreen);
  await r.press('新对话');
  expect(r.text()).toContain('有什么想聊的？');
  await r.type('问 AI', '这是一段尚未发送的草稿');
  await r.press('新对话');
  expect(
    r.tree.root.findAll(
      n => n.props.accessibilityLabel === '问 AI' && n.props.onChangeText,
    )[0].props.value,
  ).toBe('');
  await act(async () => {
    useChat.setState({
      busy: '正在回答',
      messages: [
        {
          id: 10001,
          threadId: 1,
          role: 'user',
          parts: [],
          raw: null,
          compacted: false,
          createdAt: '',
          ui: { question: '请分析投资判断', page: '自选', actions: 2 },
        },
        {
          id: -1,
          threadId: 1,
          role: 'assistant',
          ui: null,
          parts: [{ t: 'text', text: '## 投资判断\n\n先核实盈利与估值。' }],
          raw: null,
          compacted: false,
          createdAt: '',
        },
      ],
    });
  });
  expect(r.text()).toContain('先核实盈利与估值');
  expect(r.text()).not.toContain('有什么想聊的');
  expect(r.text()).not.toContain('这次约');
  expect(
    r.tree.root.findAll(
      n => n.props.accessibilityLabel === '停止' && n.props.onPress,
    ),
  ).toHaveLength(1);
  expect(
    r.tree.root.findAll(
      n => n.props.accessibilityLabel === '新对话' && n.props.onPress,
    )[0].props.disabled,
  ).toBe(true);
  await act(async () => {
    useChat.setState({ busy: null });
  });
});

test('流式结束帧只有用量时，正文仍在屏幕上并能从历史重新打开', async () => {
  const runtime = await setup();
  const p = emptyProvider('openai');
  p.models = [{ id: 'gpt-6.1-sol', enabled: true, price: null }];
  p.keyTail = '0000';
  await saveProviders(runtime.db, [p]);
  await keychainStore.set(p.id, 'mock-ui-key');
  newThread();
  await selectConfig(runtime, {
    providerId: p.id,
    model: 'gpt-6.1-sol',
    effort: 'low',
    search: true,
  });
  let release!: () => void, begin!: () => void;
  const started = new Promise<void>(r => {
    begin = r;
  });
  const gate = new Promise<void>(r => {
    release = r;
  });
  const event = (v: unknown) => 'data: ' + JSON.stringify(v) + '\n\n';
  setAiDeps({
    fetch: async (_url, init) => {
      const first =
        event({
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'message', role: 'assistant', id: 'msg', content: [] },
        }) +
        event({
          type: 'response.output_text.delta',
          output_index: 0,
          content_index: 0,
          delta: '你正在查看中证1000指数页面。',
        });
      init.onChunk!(first);
      begin();
      await gate;
      const final = event({
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [],
          usage: {
            input_tokens: 8427,
            input_tokens_details: { cached_tokens: 3712 },
            output_tokens: 197,
          },
        },
      });
      init.onChunk!(final);
      return { status: 200, text: async () => first + final };
    },
  });
  const r = await render('Ai', AiScreen);
  const done = new Promise<void>(resolve => {
    const unsub = useChat.subscribe(state => {
      if (
        !state.busy &&
        state.messages.some(m => m.role === 'assistant' && m.id > 0)
      ) {
        unsub();
        resolve();
      }
    });
  });
  await r.type('问 AI', '现在在哪个页面？解释一下');
  await r.press('发送');
  await started;
  expect(r.text()).toContain('你正在查看中证1000指数页面');
  await act(async () => {
    release();
    await done;
  });
  expect(r.text()).toContain('你正在查看中证1000指数页面');
  expect(r.text()).toContain('197 词元');
  expect(r.text()).not.toContain('没有可显示的正文');
  const id = useChat.getState().threadId!;
  await act(async () => {
    await loadThread(runtime, null);
    await loadThread(runtime, id);
  });
  expect(r.text()).toContain('你正在查看中证1000指数页面');
  await r.press('用量详情');
  expect(r.text()).toContain('缓存读 3,712');
  setAiDeps({ fetch: fetchMock });
});

test('流式更新跟随底部；拖动历史、展开过程和流式落库不抢走阅读位置', async () => {
  const r = await render('Ai', AiScreen);
  const { ScrollView } = require('react-native');
  const list = r.tree.root
    .findAllByType(ScrollView)
    .find(n => n.props.onScrollBeginDrag)!;
  const toEnd = list.instance.scrollToEnd as jest.Mock;
  const sample = (id: number, text: string) => ({
    id,
    threadId: 5,
    role: 'assistant' as const,
    parts: [{ t: 'text' as const, text }],
    raw: null,
    compacted: false,
    createdAt: '',
    ui: { search: { queries: ['测试检索'], sources: [], citations: [] } },
  });
  await r.press('新对话');
  await act(async () =>
    useChat.setState({
      busy: '正在回答',
      messages: [
        { ...sample(1, '提问'), role: 'user', ui: { question: '提问' } },
        sample(-1, '第一段'),
      ],
    }),
  );
  toEnd.mockClear();
  await act(async () => list.props.onContentSizeChange(400, 900));
  expect(toEnd).toHaveBeenCalled();
  await act(async () => {
    list.props.onScrollBeginDrag();
    list.props.onScroll({
      nativeEvent: {
        contentSize: { height: 2000 },
        contentOffset: { y: 200 },
        layoutMeasurement: { height: 600 },
      },
    });
    list.props.onScrollEndDrag();
  });
  toEnd.mockClear();
  await r.press('处理过程');
  await act(async () => {
    useChat.setState(state => ({
      messages: [state.messages[0], sample(-1, '第一段\n\n第二段')],
    }));
  });
  await act(async () => list.props.onContentSizeChange(400, 2100));
  expect(toEnd).not.toHaveBeenCalled();
  await act(async () =>
    useChat.setState(state => ({
      busy: null,
      messages: [state.messages[0], sample(2, '第一段\n\n第二段')],
    })),
  );
  await act(async () => list.props.onContentSizeChange(400, 2200));
  expect(toEnd).not.toHaveBeenCalled();
  expect(
    r.tree.root.findAll(
      n => n.props.accessibilityLabel === '处理过程' && n.props.onPress,
    )[0].props.accessibilityState.expanded,
  ).toBe(true);
  await r.press('回到最新回复');
  expect(toEnd).toHaveBeenCalledWith({ animated: true });
});

test('外部工具（MCP）：添加 Tushare、连接获取工具、写工具不能启用、token 不进设置；对话里出现开关', async () => {
  core = await setup();
  newThread();
  useChat.setState({ busy: null });
  const provider = emptyProvider('anthropic');
  provider.models = [{ id: 'claude-sonnet-4-6', enabled: true, price: null }];
  await saveProviders(core.db, [provider]);
  const { setMcpDeps, loadMcpServers, mcpTokens } = require('../../src/ai/mcp');
  const {
    AiMcpScreen,
    AiMcpServerScreen,
  } = require('../../src/ui/screens/AiMcpScreens');
  const tools = JSON.parse(
    readFileSync(join(__dirname, '../ai/fixtures/tushare-tools.json'), 'utf8'),
  );
  const auth: string[] = [];
  setMcpDeps({
    fetch: async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      auth.push(init.headers.Authorization);
      const result =
        body.method === 'initialize'
          ? { protocolVersion: '2025-06-18', instructions: 'Tushare' }
          : body.method === 'tools/list'
          ? { tools }
          : body.method === 'tools/call'
          ? { content: [{ type: 'text', text: 'cal_date\n20261028' }] }
          : null;
      return {
        status: body.id == null ? 202 : 200,
        headers: { get: () => 'text/event-stream' },
        text: async () =>
          body.id == null
            ? ''
            : 'event: message\ndata: ' +
              JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) +
              '\n\n',
      };
    },
  });
  const r = await render('AiMcpServer', AiMcpServerScreen, {});
  await r.press('添加 Tushare');
  expect(r.text()).toContain('https://api.tushare.pro/mcp/');
  await r.press('保存');
  expect(r.text()).toContain('先点「连接并获取工具」');
  await r.type('token', 'ts-token-abcd9876');
  await r.press('连接并获取工具');
  expect(auth.every(a => a === 'Bearer ts-token-abcd9876')).toBe(true);
  expect(r.text()).toContain(
    '连接成功：9 个工具，其中 2 个会改外部数据，不能启用',
  );
  expect(r.text()).toContain('工具 · 启用 7 / 7');
  expect(r.text()).toContain('会改外部数据，不能启用');
  await r.press('启用工具 income');
  expect(r.text()).toContain('工具 · 启用 6 / 7');
  await r.press('启用工具 p_delete'); // 不能启用
  expect(r.text()).toContain('工具 · 启用 6 / 7');
  expect(ctxText()).toContain('会改外部数据的 2 个（不能启用）');
  expect(ctxText()).not.toContain('ts-token');
  await r.press('保存');
  const [srv] = await loadMcpServers(core.db);
  expect(srv).toMatchObject({
    name: 'Tushare',
    slug: 'tushare',
    tokenTail: '9876',
  });
  expect(srv.tools.find((t: any) => t.name === 'income').enabled).toBe(false);
  expect(await mcpTokens().get(srv.id)).toBe('ts-token-abcd9876');
  const settings = JSON.stringify(
    await repo.getSetting(core.db, 'mcpServers', []),
  );
  expect(settings).not.toContain('ts-token-abcd9876');
  const acts = await repo.recentActivity(core.db, 5, core.sim.accountId);
  expect(JSON.stringify(acts)).not.toContain('ts-token-abcd9876');

  const list = await render('AiMcp', AiMcpScreen);
  expect(list.text()).toContain('6 / 9 个工具启用 · token 已保存');

  const ai = await render('Ai', AiScreen);
  await ai.press('外部工具');
  expect(useChat.getState().config?.mcp).toBe(true);

  const edit = await render('AiMcpServer', AiMcpServerScreen, { id: srv.id });
  await edit.type('地址', 'https://other.example/mcp?api_key=hidden-secret');
  expect(ctxText()).not.toContain('hidden-secret');
  await edit.press('保存');
  expect(edit.text()).toContain('地址不能包含认证信息');
  await edit.type('地址', 'https://other.example/mcp');
  await edit.press('保存');
  expect(edit.text()).toContain('先点「连接并获取工具」');
  expect((await loadMcpServers(core.db))[0].url).toBe(
    'https://api.tushare.pro/mcp/',
  );
});
