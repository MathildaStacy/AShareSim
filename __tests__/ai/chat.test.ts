import { loadProviders, saveProviders } from '../../src/ai/services';
import {
  activeService,
  currentConfig,
  loadThread,
  preview,
  selectConfig,
} from '../../src/ai/chat';
/// <reference types="node" />
/**
 * 对话运行时（AI_ASSISTANT.md §1、§4、§6、§8）：在内存库 + 真实行情样本上，用脚本化的「模型」跑完整流程：
 * 工具调用循环、操作卡（预校验 → 执行 → 下一次提问带 <action_results>）、记忆三种模式、
 * 兼容服务的缓存参数回退、压缩、工具轮数上限、navigate。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ask,
  COMPACT_PROMPT,
  MAX_TOOL_ROUNDS,
  memoryAction,
  newThread,
  runCard,
  setAiDeps,
  stop,
  useChat,
} from '../../src/ai/chat';
import type { FetchLike } from '../../src/ai/http';
import {
  loadPrefs,
  loadServices,
  savePrefs,
  saveServices,
  type KeyStore,
} from '../../src/ai/services';
import type { AiService, StoredMessage } from '../../src/ai/types';
import type { AppCore } from '../../src/app/boot';
import * as aiRepo from '../../src/data/aiRepo';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import * as repo from '../../src/data/repos';
import { aDelta, aEnd, aStart, aText, sse } from './helpers/stream';
import { T } from '../../src/engine';
import type { MarketClient } from '../../src/market/client';
import { parseQuotes } from '../../src/market/tencent';
import { DEFAULT_REFRESH, type Refresher } from '../../src/sim/refresher';
import { Simulator } from '../../src/sim/simulator';

jest.mock('../../src/data/drivers/opSqlite', () => ({
  openDeviceDb: () => {
    throw new Error('测试里不用设备数据库');
  },
}));
jest.mock('../../src/app/tracker', () => ({ nativeTracker: () => null }));

const fx = (name: string) =>
  readFileSync(join(__dirname, '../market/fixtures', name), 'utf8');

const SVC: AiService = {
  id: 's1',
  name: '测试中转',
  protocol: 'anthropic',
  baseUrl: 'https://relay.example.com',
  model: 'claude-sonnet-5-5',
  effort: 'low',
  cache: 'auto',
  auth: 'bearer',
  price: { input: 3000, cacheRead: 300, cacheWrite: 3750, output: 15000 },
  keyTail: 'cret',
};

type Reply = { status?: number; json: unknown };
let replies: Reply[];
let sent: { url: string; headers: Record<string, string>; body: any }[];

const fetchMock: FetchLike = async (url, init) => {
  sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
  const r = replies.shift() ?? { json: textReply('（没有更多脚本）') };
  return { status: r.status ?? 200, text: async () => JSON.stringify(r.json) };
};

const keys = new Map<string, string>();
const keyStore: KeyStore = {
  get: async id => keys.get(id) ?? null,
  set: async (id, k) => {
    keys.set(id, k);
  },
  remove: async id => {
    keys.delete(id);
  },
};

function textReply(
  text: string,
  usage = {
    input_tokens: 50,
    cache_read_input_tokens: 2000,
    cache_creation_input_tokens: 100,
    output_tokens: 20,
  },
) {
  return {
    model: SVC.model,
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage,
  };
}

let tu = 0;
function toolReply(name: string, input: Record<string, unknown>) {
  return {
    model: SVC.model,
    stop_reason: 'tool_use',
    content: [
      { type: 'thinking', thinking: '…', signature: 'sig' },
      { type: 'tool_use', id: 'tu_' + ++tu, name, input },
    ],
    usage: {
      input_tokens: 40,
      cache_read_input_tokens: 1800,
      cache_creation_input_tokens: 0,
      output_tokens: 15,
    },
  };
}

const lastUserText = (body: any): string => {
  const m = body.messages[body.messages.length - 1];
  return m.content.map((c: any) => c.text ?? '').join('\n');
};

const PAGE = {
  route: 'Trade',
  ctx: { name: '交易', lines: ['账户总资产 100,000.00 元'] },
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
  await saveServices(db, [SVC]);
  keys.set('s1', 'sk-test-secret');
  setAiDeps({ keys: keyStore, fetch: fetchMock });
  newThread();
  replies = [];
  sent = [];
  return core;
}

const toolRows = (msgs: StoredMessage[]) => msgs.filter(m => m.role === 'tool');

describe('提问和工具调用', () => {
  test('调一次工具再回答；请求按顺序拼、带页面和最近操作；存下的消息能原样重发', async () => {
    const core = await setup();
    replies = [
      { json: toolReply('get_positions', {}) },
      {
        json: textReply(
          '你有 10 万元现金，还没有持仓。\n\n仅供学习，不构成投资建议',
        ),
      },
    ];
    await ask(core, { question: '我的账户怎么样？', page: PAGE });
    expect(sent).toHaveLength(2);
    expect(sent[0].url).toBe('https://relay.example.com/v1/messages');
    expect(sent[0].headers.Authorization).toBe('Bearer sk-test-secret');
    const first = lastUserText(sent[0].body);
    expect(first).toContain(
      '<now>2026-10-26 周一 14:53（北京时间）· 交易日 · 连续竞价</now>',
    );
    expect(first).toContain('页面：交易');
    expect(first).toContain('<recent_actions>');
    expect(first).toContain('我的账户怎么样？');
    // 第二次请求：第一次的全部内容原样在前（前缀稳定），后面是工具结果
    const m2 = sent[1].body.messages;
    expect(JSON.stringify(m2[0])).toBe(
      JSON.stringify(sent[0].body.messages[0]),
    );
    expect(m2[1].content[0]).toEqual({
      type: 'thinking',
      thinking: '…',
      signature: 'sig',
    });
    expect(m2[2].content[0].type).toBe('tool_result');
    expect(m2[2].content[0].content).toContain('总资产 100,000.00 元');
    const msgs = useChat.getState().messages;
    expect(msgs.map(m => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(msgs[2].ui?.tools?.[0].label).toBe('读取 账户和持仓');
    expect(msgs[0].ui).toMatchObject({
      question: '我的账户怎么样？',
      page: '交易',
    });
    expect(useChat.getState().thread?.title).toBe('我的账户怎么样？');
    // Key 不进数据库
    const dump = JSON.stringify(
      await aiRepo.messages(core.db, msgs[0].threadId),
    );
    expect(dump).not.toContain('sk-test-secret');
  });

  test('换了页面：插一条「你现在在」分隔线', async () => {
    const core = await setup();
    replies = [{ json: textReply('好') }, { json: textReply('好') }];
    await ask(core, { question: '第一问', page: PAGE });
    await ask(core, {
      question: '第二问',
      page: { route: 'Stock', ctx: { name: '个股 · 招商银行', lines: [] } },
    });
    const users = useChat.getState().messages.filter(m => m.role === 'user');
    expect(users[0].ui?.divider).toBeUndefined();
    expect(users[1].ui?.divider).toBe('你现在在：个股 · 招商银行');
  });

  test('读取行情：工具结果带涨跌停、五档，单位是元', async () => {
    const core = await setup();
    replies = [
      { json: toolReply('get_quote', { code: '600036' }) },
      { json: textReply('好') },
    ];
    await ask(core, { question: '招商银行现在多少钱', page: null });
    const out = sent[1].body.messages[2].content[0].content as string;
    expect(out).toContain('招商银行 sh600036 · 沪市主板');
    expect(out).toContain('现价 42.30 元');
    expect(out).toContain('涨停');
    expect(out).toContain('卖1 ');
  });

  test('出错（401）：存一条错误，Key 不出现在错误里', async () => {
    const core = await setup();
    replies = [
      {
        status: 401,
        json: {
          error: {
            type: 'authentication_error',
            message: 'invalid x-api-key sk-test-secret',
          },
        },
      },
    ];
    await ask(core, { question: '你好', page: null });
    const last = useChat.getState().messages.at(-1)!;
    expect(last.ui?.error).toContain('API Key 无效');
    expect(last.ui?.error).not.toContain('sk-test-secret');
  });
});

describe('操作卡', () => {
  test('下单：预校验 → 点执行 → 委托提交、记 AI 代操作 → 下一次提问告诉模型结果', async () => {
    const core = await setup();
    replies = [
      {
        json: toolReply('place_order', {
          code: '510300',
          side: 'B',
          price: 4.17,
          qty: 1000,
        }),
      },
      { json: textReply('确认后会以 4.170 元买入 1000 份。') },
    ];
    await ask(core, { question: '帮我 4.17 买 1000 份沪深300ETF', page: PAGE });
    const out = sent[1].body.messages[2].content[0].content as string;
    expect(out).toContain(
      '已生成操作卡 #1「买入 沪深300ETF华泰柏瑞」，等待用户点「执行」确认；预校验：通过',
    );
    const row = toolRows(useChat.getState().messages)[0];
    const card = row.ui!.tools![0].card!;
    expect(card.status).toBe('pending');
    expect(card.rows.find(r => r.k === '价格')?.v).toBe('4.170');
    expect(core.sim.engine.state.orders).toHaveLength(0); // 还没执行
    await runCard(core, row.id, row.ui!.tools![0].id);
    const after = toolRows(useChat.getState().messages)[0].ui!.tools![0].card!;
    expect(after.status).toBe('done');
    expect(after.result).toContain('已提交，合同号');
    expect(core.sim.engine.state.orders).toHaveLength(1);
    // 同一张卡不能执行第二次
    await runCard(core, row.id, row.ui!.tools![0].id);
    expect(core.sim.engine.state.orders).toHaveLength(1);
    const acts = await repo.recentActivity(core.db, 20, core.sim.accountId);
    expect(
      acts.some(
        a => a.kind === 'ai' && a.text.startsWith('AI 代操作：买入 沪深300ETF'),
      ),
    ).toBe(true);
    replies = [{ json: textReply('委托已经报出去了。') }];
    await ask(core, { question: '下好了吗', page: PAGE });
    const t = lastUserText(sent[2].body);
    expect(t).toContain('<action_results>');
    expect(t).toContain(
      '操作卡 #1「买入 沪深300ETF华泰柏瑞」：用户已执行 → 已提交',
    );
    // 只告诉一次
    replies = [{ json: textReply('好') }];
    await ask(core, { question: '谢谢', page: PAGE });
    expect(lastUserText(sent[3].body)).not.toContain('<action_results>');
  });

  test('预校验不通过（数量不是 100 的整数倍）：卡上写明规则', async () => {
    const core = await setup();
    replies = [
      {
        json: toolReply('place_order', {
          code: 'sh510300',
          side: 'B',
          price: 4.17,
          qty: 150,
        }),
      },
      { json: textReply('这笔下不了。') },
    ];
    await ask(core, { question: '买 150 份', page: null });
    const card = toolRows(useChat.getState().messages)[0].ui!.tools![0].card!;
    expect(card.check.ok).toBe(false);
    expect(card.check.text).toContain('申报单位');
  });

  test('改设置的卡；重置账户后旧卡失效', async () => {
    const core = await setup();
    replies = [
      {
        json: toolReply('set_settings', {
          cost_basis: 'average',
          background_interval: 10,
        }),
      },
      { json: toolReply('reset_account', {}) },
      { json: textReply('确认后会改设置、重置账户。') },
    ];
    await ask(core, {
      question: '成本口径改成买入均价，后台 10 秒，然后重置账户',
      page: null,
    });
    const rows = toolRows(useChat.getState().messages);
    const settingsCard = rows[0].ui!.tools![0];
    const resetCard = rows[1].ui!.tools![0];
    expect(settingsCard.card!.rows.map(r => r.k)).toEqual([
      '持仓成本口径',
      '后台刷新间隔',
    ]);
    await runCard(core, rows[1].id, resetCard.id);
    expect(
      toolRows(useChat.getState().messages)[1].ui!.tools![0].card!.status,
    ).toBe('done');
    // 设置卡是重置前生成的：失效
    await runCard(core, rows[0].id, settingsCard.id);
    const s = toolRows(useChat.getState().messages)[0].ui!.tools![0].card!;
    expect(s.status).toBe('expired');
    expect(core.refresher.settings.backgroundMs).toBe(
      DEFAULT_REFRESH.backgroundMs,
    );
  });

  test('navigate：回答结束后要打开的页面，元换成厘', async () => {
    const core = await setup();
    replies = [
      {
        json: toolReply('navigate', {
          route: 'Order',
          params: { side: 'B', code: '510300', price: 4.85, qty: 100 },
        }),
      },
      { json: textReply('已经帮你填好了。') },
    ];
    await ask(core, {
      question: '打开买入页，4.85 买 100 份沪深300ETF',
      page: null,
    });
    expect(useChat.getState().pendingNav).toEqual({
      route: 'Order',
      params: {
        side: 'B',
        code: 'sh510300',
        name: '沪深300ETF华泰柏瑞',
        price: 4850,
        qty: 100,
      },
    });
  });
});

describe('记忆', () => {
  test('自动记住，可以撤销；记忆快照按对话固定', async () => {
    const core = await setup();
    replies = [
      {
        json: toolReply('remember', {
          text: '每周一集合竞价调仓',
          kind: 'plan',
        }),
      },
      { json: textReply('记住了。') },
    ];
    await ask(core, { question: '我打算每周一集合竞价调仓', page: null });
    expect((await aiRepo.memories(core.db)).map(m => m.text)).toEqual([
      '每周一集合竞价调仓',
    ]);
    // 这个对话的快照是第一次发送时拍的（那时还没有记忆）
    expect(sent[1].body.system[1].text).toContain('（还没有记忆）');
    const row = toolRows(useChat.getState().messages)[0];
    await memoryAction(core, row.id, row.ui!.tools![0].id, 'undo');
    expect(await aiRepo.memories(core.db)).toHaveLength(0);
    // 撤销的结果下一次告诉模型
    replies = [{ json: textReply('好') }];
    await ask(core, { question: '嗯', page: null });
    expect(lastUserText(sent[2].body)).toContain(
      '记忆「每周一集合竞价调仓」：用户撤销了',
    );
  });

  test('先问我：确认后才写入；新对话的快照里有它', async () => {
    const core = await setup();
    const prefs = await loadPrefs(core.db);
    await savePrefs(core.db, { ...prefs, memoryMode: 'ask' });
    replies = [
      {
        json: toolReply('remember', {
          text: 'Java / Go 后端工程师',
          kind: 'background',
        }),
      },
      { json: textReply('要记住吗？') },
    ];
    await ask(core, { question: '我是后端工程师', page: null });
    expect(await aiRepo.memories(core.db)).toHaveLength(0);
    const row = toolRows(useChat.getState().messages)[0];
    expect(row.ui!.tools![0].memory!.status).toBe('pending');
    await memoryAction(core, row.id, row.ui!.tools![0].id, 'confirm');
    const mems = await aiRepo.memories(core.db);
    expect(mems).toHaveLength(1);
    newThread();
    replies = [{ json: textReply('好') }];
    await ask(core, { question: '新话题', page: null });
    expect(sent[2].body.system[1].text).toContain(
      '#' + mems[0].id + ' [背景] Java / Go 后端工程师',
    );
  });

  test('关闭：remember 还在工具列表里，调用后返回「记忆已关闭」', async () => {
    const core = await setup();
    const prefs = await loadPrefs(core.db);
    await savePrefs(core.db, { ...prefs, memoryMode: 'off' });
    replies = [
      { json: toolReply('remember', { text: 'x', kind: 'plan' }) },
      { json: textReply('好') },
    ];
    await ask(core, { question: '记住 x', page: null });
    expect(sent[0].body.tools.map((t: any) => t.name)).toContain('remember');
    expect(sent[1].body.messages[2].content[0].content).toBe(
      '记忆已关闭，没有记住',
    );
    expect(await aiRepo.memories(core.db)).toHaveLength(0);
  });
});

describe('缓存和压缩', () => {
  test('服务不认缓存参数：去掉重发一次并记住', async () => {
    const core = await setup();
    replies = [
      {
        status: 400,
        json: {
          error: { message: 'cache_control: Extra inputs are not permitted' },
        },
      },
      {
        json: textReply('好', { input_tokens: 3000, output_tokens: 5 } as any),
      },
    ];
    await ask(core, { question: '你好', page: null });
    expect(sent).toHaveLength(2);
    expect(JSON.stringify(sent[0].body)).toContain('cache_control');
    expect(JSON.stringify(sent[1].body)).not.toContain('cache_control');
    expect((await loadServices(core.db))[0].cache).toBe('off');
    const last = useChat.getState().messages.at(-1)!;
    expect(last.ui?.notice).toContain('不认缓存参数');
    expect(last.ui?.usage?.cacheReported).toBe(false);
  });

  test('超过阈值压缩：用同样的前缀 + 「请总结」，只留最近 4 轮；摘要进 system 第 2 块', async () => {
    const core = await setup();
    const prefs = await loadPrefs(core.db);
    await savePrefs(core.db, { ...prefs, compactAt: 10 });
    for (let i = 1; i <= 5; i++) {
      replies = [{ json: textReply('答' + i) }];
      await ask(core, { question: '问' + i, page: null });
    }
    expect(sent).toHaveLength(5); // 10 条消息，还没超过
    replies = [
      { json: textReply('答6') },
      { json: textReply('用户在学 A 股规则。') },
    ];
    await ask(core, { question: '问6', page: null });
    expect(sent).toHaveLength(7);
    const compactReq = sent[6].body;
    expect(lastUserText(compactReq)).toBe(COMPACT_PROMPT);
    // 压缩请求和上一次提问的前缀相同（能读缓存）
    expect(JSON.stringify(compactReq.messages[0])).toBe(
      JSON.stringify(sent[5].body.messages[0]),
    );
    const st = useChat.getState();
    expect(st.thread?.summary).toBe('用户在学 A 股规则。');
    expect(st.thread?.compactedCount).toBe(4);
    expect(
      st.messages
        .filter(m => !m.compacted && m.role === 'user')
        .map(m => m.ui?.question),
    ).toEqual(['问3', '问4', '问5', '问6']);
    replies = [{ json: textReply('答7') }];
    await ask(core, { question: '问7', page: null });
    expect(sent[7].body.system[1].text).toContain('用户在学 A 股规则。');
    expect(JSON.stringify(sent[7].body.messages)).not.toContain('问1');
  });

  test('工具调用超过 6 轮就停', async () => {
    const core = await setup();
    replies = Array.from({ length: MAX_TOOL_ROUNDS + 1 }, () => ({
      json: toolReply('get_fee_profile', {}),
    }));
    await ask(core, { question: '一直查', page: null });
    expect(sent).toHaveLength(MAX_TOOL_ROUNDS + 1);
    const msgs = useChat.getState().messages;
    expect(msgs.at(-1)!.ui?.error).toContain('超过 6 轮');
    // 最后一轮的调用也有结果（协议要求），但没有执行
    expect(msgs.at(-2)!.parts[0]).toMatchObject({
      t: 'result',
      output: expect.stringContaining('没有执行'),
    });
  });
});

describe('流式对话', () => {
  test('生成中显示片段，完成后只存一份正文和最终用量', async () => {
    const core = await setup();
    let begin!: () => void;
    const started = new Promise<void>(r => {
      begin = r;
    });
    let finish!: () => void;
    const gate = new Promise<void>(r => {
      finish = r;
    });
    setAiDeps({
      fetch: async (_url, init) => {
        const first = sse(aStart, aText, aDelta('先给结论'));
        const rest = sse(aDelta('，再讲理由。'), ...aEnd);
        init.onChunk!(first);
        begin();
        await gate;
        init.onChunk!(rest);
        return { status: 200, text: async () => first + rest };
      },
    });
    const answer = ask(core, { question: '分析一下', page: null });
    await started;
    expect(useChat.getState().busy).toBe('正在回答…');
    expect(useChat.getState().messages.at(-1)!.parts).toEqual([
      { t: 'text', text: '先给结论' },
    ]);
    expect(
      await aiRepo.messages(core.db, useChat.getState().threadId!),
    ).toHaveLength(1);
    finish();
    await answer;
    const saved = await aiRepo.messages(core.db, useChat.getState().threadId!);
    expect(saved).toHaveLength(2);
    expect(saved[1].parts).toEqual([
      { t: 'text', text: '先给结论，再讲理由。' },
    ]);
    expect(saved[1].ui?.usage).toMatchObject({
      input: 10,
      cacheRead: 20,
      output: 7,
    });
    expect(useChat.getState().messages.some(m => m.id < 0)).toBe(false);
  });

  test('停止保留片段，丢弃未完成工具参数；下一次提问的历史仍合法', async () => {
    const core = await setup();
    let begin!: () => void;
    const started = new Promise<void>(r => {
      begin = r;
    });
    setAiDeps({
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.onChunk!(
            sse(
              aStart,
              aText,
              aDelta('已收到的建议'),
              { type: 'content_block_stop', index: 0 },
              {
                type: 'content_block_start',
                index: 1,
                content_block: {
                  type: 'tool_use',
                  name: 'place_order',
                  id: 'unfinished',
                  input: {},
                },
              },
              {
                type: 'content_block_delta',
                index: 1,
                delta: {
                  type: 'input_json_delta',
                  partial_json: '{"code":"600036"',
                },
              },
            ),
          );
          init.signal!.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
          begin();
        }),
    });
    const answer = ask(core, { question: '分析一下', page: null });
    await started;
    stop();
    await answer;
    const saved = await aiRepo.messages(core.db, useChat.getState().threadId!);
    expect(saved).toHaveLength(2);
    expect(saved[1]).toMatchObject({
      parts: [{ t: 'text', text: '已收到的建议' }],
      raw: null,
      ui: { error: '已停止' },
    });
    expect(core.sim.engine.state.orders).toHaveLength(0);
    expect(useChat.getState().busy).toBeNull();
    setAiDeps({ fetch: fetchMock });
    replies = [{ json: textReply('继续分析。') }];
    await ask(core, { question: '继续', page: null });
    expect(JSON.stringify(sent[0].body.messages)).toContain('已收到的建议');
    expect(JSON.stringify(sent[0].body.messages)).not.toContain('unfinished');
  });

  test('工具块完整但消息还没结束时不执行；结束后继续工具循环', async () => {
    const core = await setup();
    let begin!: () => void;
    const started = new Promise<void>(r => {
      begin = r;
    });
    let finish!: () => void;
    const gate = new Promise<void>(r => {
      finish = r;
    });
    let calls = 0;
    setAiDeps({
      fetch: async (_url, init) => {
        if (++calls === 2) {
          const body = JSON.parse(init.body);
          expect(body.messages[2].content[0]).toMatchObject({
            type: 'tool_result',
            tool_use_id: 'stream_call',
          });
          return {
            status: 200,
            text: async () => JSON.stringify(textReply('账户已查询。')),
          };
        }
        const first = sse(
          aStart,
          {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'tool_use',
              name: 'get_positions',
              id: 'stream_call',
              input: {},
            },
          },
          { type: 'content_block_stop', index: 0 },
        );
        const rest = sse(
          {
            type: 'message_delta',
            delta: { stop_reason: 'tool_use' },
            usage: { output_tokens: 3 },
          },
          { type: 'message_stop' },
        );
        init.onChunk!(first);
        begin();
        await gate;
        init.onChunk!(rest);
        return { status: 200, text: async () => first + rest };
      },
    });
    const answer = ask(core, { question: '查持仓', page: null });
    await started;
    expect(useChat.getState().messages.map(m => m.role)).toEqual(['user']);
    expect(calls).toBe(1);
    finish();
    await answer;
    expect(calls).toBe(2);
    expect(toolRows(useChat.getState().messages)).toHaveLength(1);
  });
});

describe('每个对话的模型 / 思考 / 搜索', () => {
  test('切换、改回与新对话默认值；重启读取各自配置，缓存警告不修改历史', async () => {
    const core = await setup();
    const ps = await loadProviders(core.db);
    ps[0].models.push({ id: 'claude-opus-5-5', enabled: true, price: null });
    await saveProviders(core.db, ps);
    replies = [{ json: textReply('第一轮建议') }];
    await ask(core, { question: '第一轮', page: PAGE });
    const firstId = useChat.getState().threadId!,
      before = await aiRepo.messages(core.db, firstId);
    const first = await currentConfig(core);
    const next = {
      providerId: 's1',
      model: 'claude-opus-5-5',
      effort: 'max' as const,
      search: true,
    };
    await selectConfig(core, next);
    expect((await activeService(core))?.model).toBe('claude-opus-5-5');
    const changed = await preview(core, PAGE);
    expect(changed.rebuild).toMatchObject({
      previous: first,
      reason: '更换模型、调整思考强度、开启搜索',
    });
    expect(changed.cached).toBe(0);
    expect(changed.rebuild!.tokens).toBeGreaterThan(0);
    expect(await aiRepo.messages(core.db, firstId)).toEqual(before);
    await selectConfig(core, first!);
    expect((await preview(core, PAGE)).rebuild).toBeNull();
    await selectConfig(core, next);
    newThread();
    expect(await currentConfig(core)).toEqual(next);
    replies = [{ json: textReply('第二段建议') }];
    await ask(core, { question: '第二段', page: null });
    const secondId = useChat.getState().threadId!;
    expect(secondId).not.toBe(firstId);
    await loadThread(core, firstId);
    expect(await currentConfig(core)).toEqual(next);
    // 已保存但尚未发问的配置也属于原对话。
    await selectConfig(core, first!);
    await loadThread(core, secondId);
    expect(await currentConfig(core)).toEqual(next);
    await loadThread(core, firstId);
    expect(await currentConfig(core)).toEqual(first);
    replies = [{ json: textReply('切换后的建议') }];
    await selectConfig(core, next);
    await ask(core, { question: '继续', page: null });
    const users = (await aiRepo.messages(core.db, firstId)).filter(
      m => m.role === 'user',
    );
    expect(users.at(-1)?.ui?.divider).toContain('开启搜索');
    expect((await preview(core, PAGE)).rebuild).toBeNull();
  });

  test('新闻搜索默认不自动打开，只给主动重问入口；关闭 App 工具的模型不执行写入', async () => {
    const core = await setup(),
      ps = await loadProviders(core.db);
    ps[0].models[0].overrides = { tools: false };
    await saveProviders(core.db, ps);
    replies = [
      { json: toolReply('transfer', { dir: 'in', amount: 1000 }) },
      { json: textReply('需要新闻搜索') },
    ];
    await ask(core, { question: '招商银行最近有什么新闻？', page: null });
    expect(sent[0].body.tools).toEqual([]);
    expect(sent[0].body.tools.some((t: any) => t.name === 'web_search')).toBe(
      false,
    );
    expect(useChat.getState().messages.at(-1)?.ui?.searchOffer).toBe(
      '招商银行最近有什么新闻？',
    );
    expect(
      useChat.getState().messages.some(m => m.ui?.tools?.some(t => t.card)),
    ).toBe(false);
    await selectConfig(core, {
      providerId: 's1',
      model: SVC.model,
      effort: 'low',
      search: true,
    });
    replies = [{ json: textReply('已经开启搜索') }];
    await ask(core, { question: '招商银行最近有什么新闻？', page: null });
    expect(sent.at(-1)!.body.tools[0].type).toBe('web_search_20250305');
    expect(useChat.getState().messages.at(-1)?.ui?.searchOffer).toBeUndefined();
  });
});

describe('空结束快照与历史恢复', () => {
  async function openaiCore() {
    const core = await setup();
    const providers = await loadProviders(core.db);
    providers[0] = {
      ...providers[0],
      protocol: 'openai',
      models: [{ id: 'gpt-6.1-sol', enabled: true, price: null }],
    };
    await saveProviders(core.db, providers);
    await selectConfig(core, {
      providerId: providers[0].id,
      model: 'gpt-6.1-sol',
      effort: 'low',
      search: false,
    });
    return core;
  }
  test('结束后正文、用量、冷加载、继续提问的历史都保留；不重复存正文', async () => {
    const core = await openaiCore();
    let release!: () => void, begin!: () => void;
    const started = new Promise<void>(r => {
      begin = r;
    });
    const gate = new Promise<void>(r => {
      release = r;
    });
    let n = 0,
      followup: any;
    setAiDeps({
      fetch: async (_url, init) => {
        if (n++) {
          followup = JSON.parse(init.body);
          return {
            status: 200,
            text: async () =>
              JSON.stringify({
                output: [
                  {
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: '继续解释。' }],
                  },
                ],
              }),
          };
        }
        const first = sse(
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'message',
              id: 'msg',
              role: 'assistant',
              content: [],
            },
          },
          {
            type: 'response.output_text.delta',
            output_index: 0,
            content_index: 0,
            delta: '你正在查看中证1000指数页面。',
          },
        );
        init.onChunk!(first);
        begin();
        await gate;
        const end = sse({
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
        init.onChunk!(end);
        return { status: 200, text: async () => first + end };
      },
    });
    const task = ask(core, {
      question: '现在在哪个页面？解释一下',
      page: null,
    });
    await started;
    expect(useChat.getState().messages.at(-1)?.parts).toEqual([
      { t: 'text', text: '你正在查看中证1000指数页面。' },
    ]);
    release();
    await task;
    const id = useChat.getState().threadId!;
    const saved = await aiRepo.messages(core.db, id);
    expect(saved).toHaveLength(2);
    expect(saved[1].parts).toEqual([
      { t: 'text', text: '你正在查看中证1000指数页面。' },
    ]);
    expect(saved[1].ui?.usage).toMatchObject({
      input: 4715,
      cacheRead: 3712,
      output: 197,
    });
    expect(saved[1].ui?.error).toBeUndefined();
    await loadThread(core, null);
    await loadThread(core, id);
    expect(useChat.getState().messages[1].parts).toEqual(saved[1].parts);
    await ask(core, { question: '继续', page: null });
    expect(
      JSON.stringify(followup.input).match(/你正在查看中证1000指数页面。/g),
    ).toHaveLength(1);
  });

  test('真正没有正文的响应保留用量、显示错误、不偷偷重试；加密推理不能伪装成回答', async () => {
    const core = await openaiCore();
    let requests = 0;
    setAiDeps({
      fetch: async () => {
        requests++;
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              status: 'completed',
              output: [
                {
                  type: 'reasoning',
                  encrypted_content: 'encrypted-private-data',
                  summary: [],
                },
              ],
              usage: { input_tokens: 4715, output_tokens: 197 },
            }),
        };
      },
    });
    await ask(core, { question: '解释页面', page: null });
    const m = useChat.getState().messages.at(-1)!;
    expect(m.parts).toEqual([]);
    expect(m.ui?.error).toContain('没有可显示的正文');
    expect(m.ui?.usage?.output).toBe(197);
    expect(requests).toBe(1);
    expect(JSON.stringify(m.parts)).not.toContain('encrypted-private-data');
  });

  test('旧记录有 raw 正文可恢复，原表不改写；已丢失正文的旧记录明确提示', async () => {
    const core = await setup();
    const id = await aiRepo.createThread(
      core.db,
      '旧对话',
      '2026-10-27T21:00:00',
    );
    const raw = {
      protocol: 'openai' as const,
      model: 'm',
      items: [
        { type: 'reasoning', encrypted_content: 'cipher', summary: [] },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: '旧记录里尚存的正文。' }],
        },
      ],
    };
    const usage = {
      input: 4715,
      cacheRead: 3712,
      cacheWrite: 0,
      output: 197,
      cacheReported: true,
    };
    const row = await aiRepo.addMessage(
      core.db,
      { threadId: id, role: 'assistant', parts: [], raw, ui: { usage } },
      '2026-10-27T21:00:00',
    );
    await aiRepo.addMessage(
      core.db,
      {
        threadId: id,
        role: 'assistant',
        parts: [],
        raw: { ...raw, items: [] },
        ui: { usage },
      },
      '2026-10-27T21:01:00',
    );
    const messages = await aiRepo.messages(core.db, id);
    expect(messages[0].parts).toEqual([
      { t: 'text', text: '旧记录里尚存的正文。' },
    ]);
    expect(messages[0].raw?.items[0]).toEqual(raw.items[0]);
    expect(messages[1].ui?.error).toContain('没有可显示的正文');
    const stored = await core.db.get<{ parts: string; raw: string }>(
      'SELECT parts,raw FROM ai_message WHERE id = ?',
      [row],
    );
    expect(stored?.parts).toBe('[]');
    expect(JSON.parse(stored!.raw)).toEqual(raw);
  });
});
