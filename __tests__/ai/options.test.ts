import { listModels } from '../../src/ai/catalog';
import { combineSearch, citedText, evidenceOf } from '../../src/ai/evidence';
import {
  capabilitiesOf,
  inferCapabilities,
  normaliseConfig,
  resolvedService,
  searchAvailability,
} from '../../src/ai/models';
import {
  buildRequest,
  endpointOf,
  parseResponse,
  type RequestInput,
} from '../../src/ai/protocol';
import { kimiSearch } from '../../src/ai/search';
import { loadProviders, loadServices, savePrefs } from '../../src/ai/services';
import { ModelStream } from '../../src/ai/stream';
import type {
  AiProvider,
  AiService,
  Effort,
  ProviderKind,
  StoredMessage,
} from '../../src/ai/types';
import * as aiRepo from '../../src/data/aiRepo';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate, migrations, SCHEMA_VERSION } from '../../src/data/migrations';
import * as repo from '../../src/data/repos';
import { sse } from './helpers/stream';

const provider = (
  kind: ProviderKind = 'custom',
  model = 'relay-model',
  protocol: AiProvider['protocol'] = 'chat',
): AiProvider => ({
  id: 'p',
  kind,
  name: kind,
  protocol,
  baseUrl: 'https://relay.example.com/v1',
  auth: 'bearer',
  cache: 'auto',
  keyTail: '1234',
  models: [{ id: model, enabled: true, price: null }],
});
const config = (p: AiProvider, effort: Effort = 'low', search = false) =>
  normaliseConfig({ providerId: p.id, model: p.models[0].id, effort, search }, [
    p,
  ]);
const service = (p: AiProvider, effort: Effort = 'low', search = false) =>
  resolvedService([p], config(p, effort, search))!;
const msg = (
  role: StoredMessage['role'],
  parts: StoredMessage['parts'],
  raw: StoredMessage['raw'] = null,
): StoredMessage => ({
  id: 1,
  threadId: 1,
  role,
  parts,
  raw,
  ui: null,
  compacted: false,
  createdAt: '',
});
const input = (s: AiService): RequestInput => ({
  service: s,
  system: 'SYS',
  context: 'CTX',
  tools: [
    {
      name: 'get_positions',
      description: '读取持仓',
      schema: { type: 'object', properties: {} },
    },
  ],
  history: [msg('user', [{ t: 'text', text: '现在应不应该买？' }])],
  effort: s.effort,
  cache: true,
  cacheKey: 'device',
  stream: true,
});
const response = (json: unknown, status = 200) => ({
  status,
  text: async () => JSON.stringify(json),
});

test('schema 3 升级保留旧 Key id、服务价格、历史和记忆；只迁移一次', async () => {
  const db = openMemoryDb();
  for (const migration of migrations.slice(0, 3)) {
    for (const sql of migration) {
      await db.run(sql);
    }
  }
  await db.run('PRAGMA user_version = 3');
  const old = {
    id: 'legacy',
    name: '旧中转',
    protocol: 'openai',
    model: 'gpt-6.1-sol',
    baseUrl: 'https://relay.example.com/v1',
    auth: 'bearer',
    effort: 'high',
    cache: 'off',
    keyTail: 'abcd',
    price: { input: 2000, cacheRead: 200, cacheWrite: 0, output: 8000 },
  };
  await repo.setSetting(db, 'aiServices', [old]);
  await savePrefs(db, {
    memoryMode: 'ask',
    includePage: true,
    recentN: 5,
    compactAt: 20,
    activeService: 'legacy',
  });
  const threadId = await aiRepo.createThread(db, '旧对话', '2026-10-27');
  await aiRepo.addMessage(
    db,
    { threadId, role: 'assistant', parts: [{ t: 'text', text: '旧建议' }] },
    '2026-10-27',
  );
  await aiRepo.addMemory(
    db,
    { kind: 'plan', text: '定投计划', sourceThreadId: threadId },
    '2026-10-27',
  );
  expect(await migrate(db)).toEqual({ from: 3, to: SCHEMA_VERSION });
  const ps = await loadProviders(db);
  expect(ps).toMatchObject([
    {
      id: 'legacy',
      cache: 'off',
      keyTail: 'abcd',
      models: [{ id: old.model, enabled: true, price: old.price }],
    },
  ]);
  expect((await loadServices(db))[0]).toMatchObject({
    id: 'legacy',
    effort: 'high',
  });
  expect((await aiRepo.messages(db, threadId))[0].parts).toEqual([
    { t: 'text', text: '旧建议' },
  ]);
  expect((await aiRepo.memories(db))[0].text).toBe('定投计划');
  await repo.setSetting(db, 'aiServices', []);
  expect(await loadProviders(db)).toEqual(ps);
  expect(await migrate(db)).toEqual({
    from: SCHEMA_VERSION,
    to: SCHEMA_VERSION,
  });
  db.close();
});

test.each([
  ['claude-opus-5-5', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['deepseek-reasoner', ['on']],
  ['deepseek-chat', []],
  ['kimi-k2-thinking', ['on']],
  ['glm-4.7', ['off', 'on']],
  ['glm-5.3', ['low', 'high', 'max']],
  ['gpt-6.1-sol', ['low', 'medium', 'high', 'xhigh', 'max']],
] as [string, Effort[]][])('模型 %s 只提供实际可用档位', (id, levels) => {
  expect(inferCapabilities(id).thinking).toEqual(levels);
});

test('未知模型保持未知，可手动标注；非对话模型不可选，DeepSeek 接口不伪装支持搜索', () => {
  const p = provider();
  expect(capabilitiesOf(p, p.models[0])).toMatchObject({
    known: false,
    thinking: null,
    search: null,
    tools: null,
  });
  expect(searchAvailability(p, p.models[0]).ok).toBe(false);
  p.models[0].overrides = {
    thinking: ['off', 'high'],
    thinkingStyle: 'reasoning',
    search: true,
    tools: false,
  };
  expect(service(p, 'high', true)).toMatchObject({
    search: true,
    effort: 'high',
    capabilities: { tools: false },
  });
  const ds = provider('deepseek', 'deepseek-reasoner');
  ds.models[0].overrides = { search: true };
  expect(searchAvailability(ds, ds.models[0]).ok).toBe(false);
  expect(service(ds, 'off').effort).toBe('on');
  expect(
    service(provider('openai', 'text-embedding-3-small', 'openai')),
  ).toBeNull();
  expect(service(provider('openai', 'gpt-6.1-sol')).capabilities?.tools).toBe(
    false,
  );
});

test('模型列表真实 GET、鉴权与分页；刷新保留启用、价格、标注及手动模型', async () => {
  const p = provider('anthropic', 'manual', 'anthropic');
  p.auth = 'x-api-key';
  p.models.push({
    id: 'claude-opus-5-5',
    enabled: true,
    overrides: { context: 999 },
    price: { input: 1, cacheRead: 2, cacheWrite: 3, output: 4 },
  });
  const sent: any[] = [];
  const models = await listModels(p, 'sk-secret', {
    fetchImpl: async (url, init) => {
      sent.push({ url, ...init });
      return response(
        sent.length === 1
          ? {
              data: [{ id: 'claude-opus-5-5', context_window: 200000 }],
              has_more: true,
              last_id: 'a/b',
            }
          : {
              data: [{ id: 'unknown', context_length: 10000 }],
              has_more: false,
            },
      );
    },
  });
  expect(sent[0]).toMatchObject({
    method: 'GET',
    body: '',
    headers: { 'x-api-key': 'sk-secret', 'anthropic-version': '2023-06-01' },
  });
  expect(sent[1].url).toBe(
    'https://relay.example.com/v1/models?after_id=a%2Fb',
  );
  expect(models.find(m => m.id === 'claude-opus-5-5')).toEqual(p.models[1]);
  expect(models.find(m => m.id === 'unknown')).toMatchObject({
    enabled: false,
    overrides: { context: 10000 },
  });
  expect(models.find(m => m.id === 'manual')).toEqual(p.models[0]);
});

test.each([401, 404, 429, 500])(
  '模型列表 HTTP %s 有明确错误且不泄露 Key',
  async status => {
    const p = provider(),
      before = JSON.stringify(p);
    await expect(
      listModels(p, 'sk-long-sensitive-key', {
        fetchImpl: async () =>
          response({ error: { message: 'bad sk-long-sensitive-key' } }, status),
      }),
    ).rejects.toThrow('HTTP ' + status);
    expect(JSON.stringify(p)).toBe(before);
    try {
      await listModels(p, 'sk-long-sensitive-key', {
        fetchImpl: async () =>
          response({ error: { message: 'bad sk-long-sensitive-key' } }, status),
      });
    } catch (e) {
      expect(String(e)).not.toContain('sk-long-sensitive-key');
    }
  },
);
test('错误分页不会返回部分列表', async () => {
  await expect(
    listModels(provider(), 'key', {
      fetchImpl: async () =>
        response({ data: [], has_more: true, last_id: 'same' }),
    }),
  ).rejects.toThrow('分页游标无效');
});

test.each(['anthropic', 'openai', 'chat'] as const)(
  '完整端点 %s 规范化，models 与 generate 使用同一前缀',
  protocol => {
    const suffix =
      protocol === 'chat'
        ? 'chat/completions'
        : protocol === 'openai'
        ? 'responses'
        : 'messages';
    expect(
      endpointOf(protocol, 'https://api.example.com/v1/' + suffix, 'models'),
    ).toBe('https://api.example.com/v1/models');
    expect(endpointOf(protocol, 'https://api.example.com/v1/' + suffix)).toBe(
      'https://api.example.com/v1/' + suffix,
    );
    expect(endpointOf('chat', 'https://open.bigmodel.cn/api/paas/v4')).toBe(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    );
  },
);

test('Chat 工具循环保留完整 reasoning_content；跨供应商只重建可见文字和工具，空 UI 消息不发送', () => {
  const p = provider('deepseek', 'deepseek-reasoner'),
    s = service(p);
  const parsed = parseResponse('chat', s.model, {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          reasoning_content: '公开推理',
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'get_positions', arguments: '{}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: {
      prompt_tokens: 100,
      prompt_cache_hit_tokens: 80,
      completion_tokens: 20,
    },
  });
  parsed.raw.providerId = p.id;
  const req = input(s);
  req.history.push(
    msg('assistant', parsed.parts, parsed.raw),
    msg('assistant', []),
    msg('tool', [
      { t: 'result', id: 'c1', name: 'get_positions', output: '持仓 0' },
    ]),
  );
  const body = buildRequest(req).body as any;
  expect(body.messages[2]).toEqual(parsed.raw.items[0]);
  expect(body.messages[3]).toEqual({
    role: 'tool',
    tool_call_id: 'c1',
    content: '持仓 0',
  });
  expect(body.messages).toHaveLength(4);
  expect(parsed.usage).toMatchObject({ input: 20, cacheRead: 80, output: 20 });
  const cross = buildRequest({ ...req, service: { ...s, id: 'different' } })
    .body as any;
  expect(JSON.stringify(cross)).not.toContain('公开推理');
  expect(cross.messages[2].tool_calls[0].id).toBe('c1');
});

test.each([
  [
    'deepseek',
    'deepseek-v4-pro',
    'high',
    { thinking: { type: 'enabled' }, reasoning_effort: 'high' },
  ],
  ['dashscope', 'qwen3.8-max', 'off', { enable_thinking: false }],
  ['zhipu', 'glm-4.7', 'on', { thinking: { type: 'enabled' } }],
  ['moonshot', 'kimi-k2.6', 'off', { thinking: { type: 'disabled' } }],
  [
    'openrouter',
    'openai/gpt-5.5',
    'high',
    { reasoning: { enabled: true, effort: 'high' } },
  ],
] as [ProviderKind, string, Effort, Record<string, unknown>][])(
  '%s 按供应商发送思考参数',
  (kind, id, e, expected) => {
    expect(
      buildRequest(input(service(provider(kind, id), e))).body,
    ).toMatchObject(expected);
  },
);

test('搜索参数按协议适配；后台摘要强制移除搜索，不按问题自动开启', () => {
  const a = service(
    provider('anthropic', 'claude-opus-5-5', 'anthropic'),
    'low',
    true,
  );
  expect((buildRequest(input(a)).body.tools as any[])[0]).toMatchObject({
    type: 'web_search_20260209',
    name: 'web_search',
  });
  // 新版搜索工具只在 Opus 4.6+ / Sonnet 4.6+ 上有；Haiku、更早的模型、认不出的中转模型名用基础版
  for (const [id, type] of [
    ['claude-sonnet-4-6', 'web_search_20260209'],
    ['anthropic/claude-opus-4-7', 'web_search_20260209'],
    ['claude-opus-5', 'web_search_20260209'],
    ['claude-haiku-5-5', 'web_search_20250305'],
    ['claude-sonnet-4-5', 'web_search_20250305'],
    ['my-relay-model', 'web_search_20250305'],
  ]) {
    const svc = service(provider('anthropic', id, 'anthropic'), 'low');
    expect(
      (buildRequest(input({ ...svc, search: true })).body.tools as any[])[0]
        .type,
    ).toBe(type);
  }
  const o = service(
    provider('openai', 'gpt-6.1-sol', 'openai'),
    'medium',
    true,
  );
  expect(buildRequest(input(o)).body).toMatchObject({
    tools: [{ type: 'web_search' }, { type: 'function' }],
    include: ['reasoning.encrypted_content', 'web_search_call.action.sources'],
  });
  const router = service(provider('openrouter', 'openai/gpt-5.5'), 'low', true);
  expect(buildRequest(input(router)).body.plugins).toEqual([
    { id: 'web', max_results: 5 },
  ]);
  const glm = service(provider('zhipu', 'glm-4.7'), 'on', true);
  expect((buildRequest(input(glm)).body.tools as any[])[0]).toMatchObject({
    type: 'web_search',
    web_search: { search_result: true },
  });
  const q = service(provider('dashscope', 'qwen3.8-max'), 'on', true);
  expect(buildRequest(input(q)).body).toMatchObject({
    enable_search: true,
    include_tool_usage: true,
  });
  expect(
    buildRequest({ ...input(q), noTools: true, tools: [] }).body.enable_search,
  ).toBeUndefined();
  expect(buildRequest(input({ ...o, search: false })).body.tools).toHaveLength(
    1,
  );
});

test('Chat 流式拼接思考、正文、多个工具参数与最后 usage，结束前不交出可执行工具', () => {
  const progress: any[] = [],
    texts: string[] = [];
  const parser = new ModelStream(
    'chat',
    'glm-4.7',
    t => texts.push(t),
    p => progress.push(p),
  );
  const chunk = (delta: any, finish_reason: string | null = null) => ({
    choices: [{ index: 0, delta, finish_reason }],
  });
  const start = sse(
    chunk({ reasoning_content: '先查' }),
    chunk({ content: '建议' }),
    chunk({
      tool_calls: [
        {
          index: 0,
          id: 'a',
          type: 'function',
          function: { name: 'get_positions', arguments: '{' },
        },
      ],
    }),
    chunk({
      tool_calls: [
        { index: 0, function: { arguments: '}' } },
        {
          index: 1,
          id: 'b',
          function: { name: 'get_quote', arguments: '{"code":"600036"}' },
        },
      ],
    }),
  );
  for (const ch of start) {
    parser.feed(ch);
  }
  expect(texts).toEqual(['建议']);
  expect(progress.at(-1).thinking).toBe('先查');
  expect(() => parser.finish()).toThrow('未收到结束事件');
  parser.feed(
    sse(chunk({}, 'tool_calls'), {
      choices: [],
      usage: {
        prompt_tokens: 120,
        prompt_tokens_details: { cached_tokens: 100 },
        completion_tokens: 10,
      },
    }) + 'data: [DONE]\n\n',
  );
  const r = parser.finish();
  expect(r.stop).toBe('tool');
  expect(r.parts.filter(p => p.t === 'call')).toHaveLength(2);
  expect(r.usage).toMatchObject({ input: 20, cacheRead: 100, output: 10 });
  expect((r.raw.items[0] as any).reasoning_content).toBe('先查');
});

test('只有 [DONE]、没有 finish_reason 的 Chat 流不能执行工具', () => {
  const parser = new ModelStream('chat', 'm');
  parser.feed('data: [DONE]\n\n');
  expect(() => parser.finish()).toThrow('未收到结束事件');
});

test('原生搜索真实查询、网页、编号注解可点击；不展示 encrypted_content，不修改 raw 正文', () => {
  const json = {
    output: [
      {
        type: 'reasoning',
        encrypted_content: 'SECRET',
        summary: [{ type: 'summary_text', text: '检索摘要' }],
      },
      {
        type: 'web_search_call',
        action: {
          query: '招商银行 新闻',
          sources: [{ url: 'https://example.com', title: '公告' }],
        },
      },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: '建议持有。',
            annotations: [
              {
                type: 'url_citation',
                start_index: 0,
                end_index: 5,
                url: 'https://example.com',
                title: '公告',
              },
            ],
          },
        ],
      },
    ],
  };
  const e = evidenceOf('openai', json);
  expect(e.thinking).toBe('检索摘要');
  expect(JSON.stringify(e)).not.toContain('SECRET');
  expect(e.search).toMatchObject({
    queries: ['招商银行 新闻'],
    calls: 1,
    sources: [{ url: 'https://example.com' }],
  });
  expect(citedText('建议持有。', e.search)).toBe('建议持有。[1](source:0)');
  expect((json.output[2] as any).content[0].text).toBe('建议持有。');
  const merged = combineSearch(
    { ...e.search!, citations: [] },
    {
      queries: ['另一查询'],
      sources: [
        { url: 'https://second.com', title: '财报' },
        { url: 'https://example.com', title: '公告' },
      ],
      citations: [{ end: 3, source: 1 }],
    },
  )!;
  expect(merged.sources).toHaveLength(2);
  expect(merged.citations[0].source).toBe(0);
  expect(citedText('事实[2]', { ...merged, citations: [] })).toBe(
    '事实[2](source:1)',
  );
});

test('Kimi 搜索使用新 REST 端点，真实结果进入工具响应，可取消且不泄露 Key', async () => {
  const s = service(provider('moonshot', 'kimi-k2.6'), 'on', true),
    sent: any[] = [];
  const r = await kimiSearch(
    s,
    'secret',
    '{"query":"招商银行 2026 公告"}',
    new AbortController().signal,
    async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return response({
        search_results: [
          {
            title: '公告',
            url: 'https://cmbchina.com/news',
            chunks: [{ text: '财报摘要' }],
          },
        ],
      });
    },
  );
  expect(sent[0]).toEqual({
    url: 'https://relay.example.com/v1/tools/search_pro',
    body: { text_query: '招商银行 2026 公告', limit: 5, timeout_seconds: 30 },
  });
  expect(r.search).toMatchObject({ calls: 1, queries: ['招商银行 2026 公告'] });
  expect(r.output).toContain('财报摘要');
  await expect(
    kimiSearch(s, 'secret', '{"query":""}', new AbortController().signal),
  ).rejects.toThrow('搜索词');
});

test('Kimi 搜索取消能中止传输；网络报错同样移除完整 Key', async () => {
  const s = service(provider('moonshot', 'kimi-k2.6'), 'on', true),
    ctl = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>(r => {
    started = r;
  });
  const pending = kimiSearch(
    s,
    'sk-private-search-key',
    '{"query":"最新公告"}',
    ctl.signal,
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
        started();
      }),
  );
  await ready;
  ctl.abort();
  await expect(pending).rejects.toThrow('搜索已停止');
  try {
    await kimiSearch(
      s,
      'sk-private-search-key',
      '{"query":"最新公告"}',
      new AbortController().signal,
      async () => {
        throw new Error('network sk-private-search-key');
      },
    );
  } catch (e) {
    expect(String(e)).not.toContain('sk-private-search-key');
    expect(String(e)).toContain('network');
  }
});

test('不支持工具的 Chat 模型保留历史可读结果，但不向接口重放 function/tool 角色', () => {
  const s = service(provider('openai', 'gpt-6.1-sol'));
  const req = input(s);
  req.history = [
    msg('assistant', [
      { t: 'call', id: 'old', name: 'get_positions', args: '{}' },
    ]),
    msg('tool', [
      { t: 'result', id: 'old', name: 'get_positions', output: '当前持仓为空' },
    ]),
  ];
  const body = buildRequest(req).body as any;
  expect(
    body.messages.some((m: any) => m.role === 'tool' || m.tool_calls),
  ).toBe(false);
  expect(JSON.stringify(body.messages)).toContain('当前持仓为空');
});

test('引用贴在段落句尾，Kimi 等普通编号 URL 统一映射为真实来源', () => {
  const search = {
    queries: [],
    sources: [{ url: 'https://example.com/a', title: '原文' }],
    citations: [{ end: 6, source: 0 }],
  };
  expect(citedText('结论。\n\n\n下一段', search)).toBe(
    '结论。[1](source:0)\n\n\n下一段',
  );
  expect(
    citedText('结论[7](https://example.com/a)', { ...search, citations: [] }),
  ).toBe('结论[1](source:0)');
});
