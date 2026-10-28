/**
 * 两种协议的请求和响应（AI_ASSISTANT.md §6、§7）：地址拼接、缓存断点、历史原样重发（前缀稳定）、
 * 换模型时不发推理、关掉思考时去掉推理块、响应和用量解析。
 */
import {
  buildRequest,
  endpointOf,
  headersOf,
  parseResponse,
  type RequestInput,
} from '../../src/ai/protocol';
import { compatOf, redact } from '../../src/ai/http';
import type { StoredMessage } from '../../src/ai/types';
import { TOOL_DEFS } from '../../src/ai/tools/defs';

let seq = 1;
const msg = (
  role: StoredMessage['role'],
  parts: StoredMessage['parts'],
  raw: StoredMessage['raw'] = null,
): StoredMessage => ({
  id: seq++,
  threadId: 1,
  role,
  parts,
  raw,
  ui: null,
  compacted: false,
  createdAt: '',
});

const anth = {
  protocol: 'anthropic' as const,
  model: 'claude-sonnet-5-5',
  baseUrl: 'https://api.anthropic.com',
};
const oai = {
  protocol: 'openai' as const,
  model: 'gpt-5.6',
  baseUrl: 'https://api.openai.com/v1',
};

const base = (
  service: RequestInput['service'],
  history: StoredMessage[],
): RequestInput => ({
  service,
  system: 'SYS',
  context: '<memory>…</memory>',
  tools: TOOL_DEFS,
  history,
  cache: true,
  effort: 'low',
  cacheKey: 'asharesim-test',
});

// 一轮带工具调用的对话：提问 → 调 get_positions → 结果 → 回答
const user1 = msg('user', [
  { t: 'text', text: '<now>…</now>' },
  { t: 'text', text: '我的持仓怎么样？' },
]);
const anthRaw1 = {
  protocol: 'anthropic' as const,
  model: 'claude-sonnet-5-5',
  items: [
    { type: 'thinking', thinking: '要查持仓', signature: 'sig' },
    { type: 'tool_use', id: 'tu_1', name: 'get_positions', input: {} },
  ],
};
const call1 = msg(
  'assistant',
  [{ t: 'call', id: 'tu_1', name: 'get_positions', args: '{}' }],
  anthRaw1,
);
const result1 = msg('tool', [
  { t: 'result', id: 'tu_1', name: 'get_positions', output: '没有持仓' },
]);
const answer1 = msg('assistant', [{ t: 'text', text: '你现在没有持仓。' }], {
  protocol: 'anthropic',
  model: 'claude-sonnet-5-5',
  items: [{ type: 'text', text: '你现在没有持仓。' }],
});
const user2 = msg('user', [
  { t: 'text', text: '<now>…</now>' },
  { t: 'text', text: '那怎么买？' },
]);

describe('endpointOf', () => {
  test('官方地址、带 /v1、填到接口为止都行', () => {
    expect(endpointOf('anthropic', 'https://api.anthropic.com')).toBe(
      'https://api.anthropic.com/v1/messages',
    );
    expect(endpointOf('anthropic', 'https://relay.example.com/v1/')).toBe(
      'https://relay.example.com/v1/messages',
    );
    expect(
      endpointOf('anthropic', 'https://relay.example.com/v1/messages'),
    ).toBe('https://relay.example.com/v1/messages');
    expect(endpointOf('openai', 'https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/responses',
    );
    expect(endpointOf('openai', 'https://relay.example.com/openai')).toBe(
      'https://relay.example.com/openai/v1/responses',
    );
    expect(endpointOf('openai', 'https://x.com/v1', 'models')).toBe(
      'https://x.com/v1/models',
    );
    expect(() => endpointOf('openai', 'api.openai.com')).toThrow('http');
    // 默认地址后面又粘了一个地址
    expect(() =>
      endpointOf('anthropic', 'https://api.anthropic.comhttp://localhost:8787'),
    ).toThrow('http');
    expect(endpointOf('anthropic', 'http://localhost:8787')).toBe(
      'http://localhost:8787/v1/messages',
    );
  });

  test('鉴权头：Anthropic 默认 x-api-key，可选 Bearer；OpenAI 用 Bearer', () => {
    expect(
      headersOf({ protocol: 'anthropic', auth: 'x-api-key' }, 'k'),
    ).toEqual({
      'Content-Type': 'application/json',
      'x-api-key': 'k',
      'anthropic-version': '2023-06-01',
    });
    expect(
      headersOf({ protocol: 'anthropic', auth: 'bearer' }, 'k').Authorization,
    ).toBe('Bearer k');
    expect(
      headersOf({ protocol: 'openai', auth: 'x-api-key' }, 'k').Authorization,
    ).toBe('Bearer k');
  });
});

describe('Anthropic Messages 请求', () => {
  test('3 个缓存断点：system 两块 + 顶层自动断点；工具按名字排序', () => {
    const { body } = buildRequest(base(anth, [user1]));
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    const system = body.system as any[];
    expect(system).toHaveLength(2);
    expect(system.every(b => b.cache_control?.type === 'ephemeral')).toBe(true);
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config).toEqual({ effort: 'low' });
    const names = (body.tools as any[]).map(t => t.name);
    expect(names).toHaveLength(36);
    expect(names).toEqual([...names].sort());
  });

  test('关掉缓存时不带任何 cache_control；关掉思考时不带 thinking', () => {
    const { body } = buildRequest({
      ...base(anth, [user1]),
      cache: false,
      effort: 'off',
    });
    expect(JSON.stringify(body)).not.toContain('cache_control');
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
  });

  test('同一个模型原样传回推理块；工具结果和下一条提问合并成一条 user（tool_result 在前）', () => {
    const { body } = buildRequest(
      base(anth, [user1, call1, result1, answer1, user2]),
    );
    const m = body.messages as any[];
    expect(m.map(x => x.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect(m[1].content[0]).toEqual({
      type: 'thinking',
      thinking: '要查持仓',
      signature: 'sig',
    });
    expect(m[2].content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'tu_1',
      content: '没有持仓',
    });
    // 中途出错没有回答时，工具结果和下一条提问相邻，合并
    const { body: b2 } = buildRequest(
      base(anth, [user1, call1, result1, user2]),
    );
    const m2 = b2.messages as any[];
    expect(m2.map(x => x.role)).toEqual(['user', 'assistant', 'user']);
    expect(m2[2].content.map((c: any) => c.type)).toEqual([
      'tool_result',
      'text',
      'text',
    ]);
  });

  test('换了模型：只发文字和工具调用，不发推理', () => {
    const { body } = buildRequest(
      base({ ...anth, model: 'claude-opus-5-5' }, [
        user1,
        call1,
        result1,
        answer1,
      ]),
    );
    const m = body.messages as any[];
    expect(m[1].content).toEqual([
      { type: 'tool_use', id: 'tu_1', name: 'get_positions', input: {} },
    ]);
  });

  test('关了思考：同一个模型也去掉推理块', () => {
    const { body } = buildRequest({
      ...base(anth, [user1, call1]),
      effort: 'off',
    });
    expect((body.messages as any[])[1].content.map((c: any) => c.type)).toEqual(
      ['tool_use'],
    );
  });

  test('前缀稳定：追加一轮后，之前的消息逐字节不变（缓存能读）', () => {
    const a = JSON.stringify(
      buildRequest(base(anth, [user1, call1, result1, answer1])).body,
    );
    const b = JSON.stringify(
      buildRequest(base(anth, [user1, call1, result1, answer1, user2])).body,
    );
    // 去掉 a 末尾的 ]} 后应该是 b 的前缀
    expect(b.startsWith(a.slice(0, -2))).toBe(true);
  });
});

describe('OpenAI Responses 请求', () => {
  const oRaw = {
    protocol: 'openai' as const,
    model: 'gpt-5.6',
    items: [
      { type: 'reasoning', id: 'rs_1', encrypted_content: 'enc', summary: [] },
      {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name: 'get_positions',
        arguments: '{}',
      },
    ],
  };
  const oCall = msg(
    'assistant',
    [{ t: 'call', id: 'call_1', name: 'get_positions', args: '{}' }],
    oRaw,
  );
  const oResult = msg('tool', [
    { t: 'result', id: 'call_1', name: 'get_positions', output: '没有持仓' },
  ]);

  test('无状态：store false，带 prompt_cache_key 和加密推理；instructions = 系统提示 + 记忆', () => {
    const { url, body } = buildRequest(base(oai, [user1, oCall, oResult]));
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(body.store).toBe(false);
    expect(body.prompt_cache_key).toBe('asharesim-test');
    expect(body.include).toEqual(['reasoning.encrypted_content']);
    expect(body.reasoning).toEqual({ effort: 'low', summary: 'auto' });
    expect(body.instructions).toBe('SYS\n\n<memory>…</memory>');
    const input = body.input as any[];
    expect(input[0]).toEqual({
      role: 'user',
      content: [
        { type: 'input_text', text: '<now>…</now>' },
        { type: 'input_text', text: '我的持仓怎么样？' },
      ],
    });
    expect(input[1]).toEqual(oRaw.items[0]);
    expect(input[2]).toEqual(oRaw.items[1]);
    expect(input[3]).toEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: '没有持仓',
    });
    expect((body.tools as any[])[0]).toMatchObject({
      type: 'function',
      name: 'cancel_order',
      strict: false,
    });
  });

  test('Anthropic 的历史换到 OpenAI：转换成 function_call，不带推理', () => {
    const { body } = buildRequest(base(oai, [user1, call1, result1, answer1]));
    const input = body.input as any[];
    expect(input[1]).toEqual({
      type: 'function_call',
      call_id: 'tu_1',
      name: 'get_positions',
      arguments: '{}',
    });
    expect(input[3]).toEqual({
      role: 'assistant',
      content: '你现在没有持仓。',
    });
  });
});

describe('响应解析', () => {
  test('Anthropic：文字、工具调用、缓存用量', () => {
    const r = parseResponse('anthropic', 'm', {
      model: 'claude-sonnet-5-5',
      stop_reason: 'tool_use',
      content: [
        { type: 'thinking', thinking: 'x', signature: 's' },
        { type: 'text', text: '我查一下' },
        {
          type: 'tool_use',
          id: 'tu_9',
          name: 'get_quote',
          input: { code: '600036' },
        },
      ],
      usage: {
        input_tokens: 120,
        cache_read_input_tokens: 3000,
        cache_creation_input_tokens: 400,
        output_tokens: 80,
      },
    });
    expect(r.stop).toBe('tool');
    expect(r.parts).toEqual([
      { t: 'text', text: '我查一下' },
      { t: 'call', id: 'tu_9', name: 'get_quote', args: '{"code":"600036"}' },
    ]);
    expect(r.raw.items).toHaveLength(3);
    expect(r.usage).toEqual({
      input: 120,
      cacheRead: 3000,
      cacheWrite: 400,
      output: 80,
      cacheReported: true,
    });
  });

  test('Anthropic 中转服务没有缓存字段：cacheReported false', () => {
    const r = parseResponse('anthropic', 'm', {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'OK' }],
      usage: { input_tokens: 10, output_tokens: 1 },
    });
    expect(r.stop).toBe('end');
    expect(r.usage.cacheReported).toBe(false);
  });

  test('OpenAI：input_tokens 含缓存读，扣掉得到没走缓存的', () => {
    const r = parseResponse('openai', 'm', {
      status: 'completed',
      output: [
        { type: 'reasoning', id: 'rs', encrypted_content: 'e', summary: [] },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '你好' }],
        },
      ],
      usage: {
        input_tokens: 5000,
        input_tokens_details: { cached_tokens: 4096 },
        output_tokens: 30,
      },
    });
    expect(r.stop).toBe('end');
    expect(r.parts).toEqual([{ t: 'text', text: '你好' }]);
    expect(r.usage).toMatchObject({
      input: 904,
      cacheRead: 4096,
      output: 30,
      cacheReported: true,
    });
  });

  test('格式不对时报协议错误', () => {
    expect(() => parseResponse('openai', 'm', { content: [] })).toThrow(
      'output',
    );
    expect(() => parseResponse('anthropic', 'm', { output: [] })).toThrow(
      'content',
    );
  });
});

describe('兼容服务和 Key 保护', () => {
  test('400 里说的是缓存或思考字段', () => {
    expect(compatOf('cache_control: Extra inputs are not permitted')).toBe(
      'cache',
    );
    expect(compatOf('Unknown parameter: prompt_cache_key')).toBe('cache');
    expect(compatOf('thinking: unexpected field')).toBe('effort');
    expect(compatOf('max_tokens too large')).toBeNull();
  });

  test('错误信息里的 Key 被抹掉', () => {
    expect(
      redact('bad key sk-ant-abcdefghijklmnop', 'sk-ant-abcdefghijklmnop'),
    ).toBe('bad key ••••');
    expect(redact('header sk-proj-1234567890abcdef', 'other')).toBe(
      'header sk-proj••••',
    );
  });
});

test('兼容 Responses 的字符串 / text 块 / 汇总 output_text，正文与可重放内容一致', () => {
  for (const response of [
    {
      output: [
        { type: 'message', role: 'assistant', content: '兼容服务的正文。' },
      ],
    },
    {
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: '兼容服务的正文。' }],
        },
      ],
    },
    { output: [], output_text: '兼容服务的正文。' },
  ]) {
    const parsed = parseResponse('openai', 'm', response);
    expect(parsed.parts).toEqual([{ t: 'text', text: '兼容服务的正文。' }]);
    expect(parsed.raw.items).toEqual([
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '兼容服务的正文。' }],
      },
    ]);
  }
});
