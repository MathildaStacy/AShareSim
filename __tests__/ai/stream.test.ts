import { callModel, defaultFetch, type FetchLike } from '../../src/ai/http';
import { ModelStream } from '../../src/ai/stream';
import type { AiService } from '../../src/ai/types';
import { aDelta, aEnd, aStart, aText, sse } from './helpers/stream';

const svc: AiService = {
  id: 's',
  name: '测试',
  protocol: 'anthropic',
  model: 'm',
  baseUrl: 'https://relay.example.com',
  effort: 'low',
  cache: 'auto',
  auth: 'bearer',
  price: null,
  keyTail: 'cret',
};
const req = {
  url: 'https://relay.example.com/v1/messages',
  body: { stream: true },
};
const text = (value: string) => ({
  type: 'message',
  role: 'assistant',
  id: 'msg',
  content: [{ type: 'output_text', text: value, annotations: [] }],
});

test('SSE 跨任意字符切片、CRLF、心跳和未知事件；实时文字与完整用量', () => {
  const seen: string[] = [];
  const parser = new ModelStream('anthropic', 'm', t => seen.push(t));
  const chunks =
    '\uFEFF: heartbeat\r\n\r\n' +
    sse(
      aStart,
      aText,
      aDelta('建议'),
      { type: 'ping' },
      { type: 'future_event' },
      aDelta('继续观察。'),
      ...aEnd,
    ).replace(/\n/g, '\r\n');
  for (const ch of chunks) {
    parser.feed(ch);
  }
  expect(seen).toEqual(['建议', '建议继续观察。']);
  const final = parser.finish();
  expect(final.parts).toEqual([{ t: 'text', text: '建议继续观察。' }]);
  expect(final.usage).toEqual({
    input: 10,
    cacheRead: 20,
    cacheWrite: 5,
    output: 7,
    cacheReported: true,
  });
});

test('Anthropic 拼接工具 JSON、thinking 和签名；结束前不会交出工具调用', () => {
  const parser = new ModelStream('anthropic', 'm');
  parser.feed(
    sse(
      aStart,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: '分析' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'sig' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'tool_use',
          id: 'call',
          name: 'get_quote',
          input: {},
        },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"code":' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '"600036"}' },
      },
      { type: 'content_block_stop', index: 1 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 30 },
      },
      { type: 'message_stop' },
    ),
  );
  const result = parser.finish();
  expect(result.parts).toEqual([
    { t: 'call', id: 'call', name: 'get_quote', args: '{"code":"600036"}' },
  ]);
  expect(result.raw.items[0]).toEqual({
    type: 'thinking',
    thinking: '分析',
    signature: 'sig',
  });
});

test('OpenAI 文字增量先显示；最终输出保留加密推理、工具参数、模型原始字段和用量', () => {
  const seen: string[] = [];
  const parser = new ModelStream('openai', 'm', t => seen.push(t));
  const reasoning = {
    type: 'reasoning',
    id: 'rs',
    encrypted_content: 'encrypted',
    summary: [],
  };
  const tool = {
    type: 'function_call',
    call_id: 'call',
    id: 'fc',
    name: 'get_quote',
    arguments: '{"code":"600036"}',
  };
  parser.feed(
    sse(
      { type: 'response.created', response: { output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: reasoning },
      { type: 'response.output_item.added', output_index: 1, item: text('') },
      {
        type: 'response.output_text.delta',
        output_index: 1,
        content_index: 0,
        delta: '建议',
      },
      {
        type: 'response.output_text.delta',
        output_index: 1,
        content_index: 0,
        delta: '持有。',
      },
      {
        type: 'response.output_text.done',
        output_index: 1,
        content_index: 0,
        text: '建议持有。',
      },
      {
        type: 'response.output_item.added',
        output_index: 2,
        item: { ...tool, arguments: '' },
      },
      {
        type: 'response.function_call_arguments.delta',
        output_index: 2,
        delta: '{"code":',
      },
      {
        type: 'response.function_call_arguments.delta',
        output_index: 2,
        delta: '"600036"}',
      },
      {
        type: 'response.function_call_arguments.done',
        output_index: 2,
        arguments: tool.arguments,
      },
      { type: 'response.output_item.done', output_index: 2, item: tool },
    ),
  );
  expect(seen).toContain('建议');
  expect(seen.at(-1)).toBe('建议持有。');
  parser.feed(
    sse({
      type: 'response.completed',
      response: {
        status: 'completed',
        output: [
          reasoning,
          { ...text('建议持有。'), phase: 'commentary' },
          tool,
        ],
        usage: {
          input_tokens: 100,
          input_tokens_details: { cached_tokens: 80 },
          output_tokens: 30,
        },
      },
    }),
  );
  const result = parser.finish();
  expect(result.parts).toEqual([
    { t: 'text', text: '建议持有。' },
    { t: 'call', id: 'call', name: 'get_quote', args: tool.arguments },
  ]);
  expect(result.raw.items[0]).toEqual(reasoning);
  expect(result.raw.items[1]).toMatchObject({ phase: 'commentary' });
  expect(result.usage).toMatchObject({ input: 20, cacheRead: 80, output: 30 });
});

test('多行 data 和没有最后空行的终止事件', () => {
  const parser = new ModelStream('anthropic', 'm');
  parser.feed(
    'data: {"type":"message_start",\ndata: "message":{"content":[],"usage":{}}}\n\n',
  );
  parser.feed('data: {"type":"message_stop"}');
  expect(parser.finish().parts).toEqual([]);
});

test('EOF 不等于完整结束，不返回未完成工具；流内错误直接报出', () => {
  const parser = new ModelStream('anthropic', 'm');
  parser.feed(sse(aStart, aText, aDelta('已收到部分')));
  expect(() => parser.finish()).toThrow('未收到结束事件');
  expect(() =>
    parser.feed(sse({ type: 'error', error: { message: 'Overloaded' } })),
  ).toThrow('Overloaded');
  const invalid = new ModelStream('openai', 'm');
  expect(() => invalid.feed('data: {bad}\n\n')).toThrow('无效的事件');
});

test('传输尚未完成时就通知 UI；终止后保留最终解析', async () => {
  let finish!: () => void;
  const gate = new Promise<void>(r => {
    finish = r;
  });
  const seen: string[] = [];
  const first = sse(aStart, aText, aDelta('先给结论'));
  const rest = sse(aDelta('，再讲理由。'), ...aEnd);
  const fetchImpl: FetchLike = async (_url, init) => {
    expect(JSON.parse(init.body).stream).toBe(true);
    init.onChunk!(first);
    await gate;
    init.onChunk!(rest);
    return { status: 200, text: async () => first + rest };
  };
  const response = callModel(svc, 'sk-test-secret', req, {
    fetchImpl,
    onText: t => seen.push(t),
  });
  expect(seen).toEqual(['先给结论']);
  finish();
  expect((await response).parsed.parts).toEqual([
    { t: 'text', text: '先给结论，再讲理由。' },
  ]);
});

test('兼容忽略 stream 的 JSON 服务；HTTP 错误与流内错误都隐藏 Key', async () => {
  const json = {
    content: [{ type: 'text', text: 'OK' }],
    stop_reason: 'end_turn',
  };
  const result = await callModel(svc, 'sk-test-secret', req, {
    fetchImpl: async (_u, init) => {
      const body = JSON.stringify(json);
      init.onChunk!(body);
      return { status: 200, text: async () => body };
    },
  });
  expect(result.parsed.parts).toEqual([{ t: 'text', text: 'OK' }]);
  for (const status of [401, 200]) {
    const body =
      status === 401
        ? JSON.stringify({ error: { message: 'bad sk-test-secret' } })
        : sse({ type: 'error', error: { message: 'bad sk-test-secret' } });
    await expect(
      callModel(svc, 'sk-test-secret', req, {
        fetchImpl: async (_u, init) => {
          if (status === 200) {
            init.onChunk!(body);
          }
          return { status, text: async () => body };
        },
      }),
    ).rejects.toThrow('bad ••••');
  }
});

test('用户停止或超时会中止底层传输', async () => {
  const fetchImpl: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      if (init.signal!.aborted) {
        reject(new Error('abort'));
      }
      init.signal!.addEventListener('abort', () => reject(new Error('abort')));
    });
  const ctl = new AbortController();
  const response = callModel(svc, '', req, { fetchImpl, signal: ctl.signal });
  ctl.abort();
  await expect(response).rejects.toMatchObject({ code: 'cancelled' });
  await expect(
    callModel(svc, '', req, { fetchImpl, timeoutMs: 5 }),
  ).rejects.toMatchObject({ code: 'timeout' });
});

test('RN XHR progress 不重复交付文本，结束前可读取，停止时立即 abort', async () => {
  const original = global.XMLHttpRequest;
  let xhr: any;
  class FakeXhr {
    status = 200;
    responseText = '';
    onprogress: any;
    onload: any;
    onerror: any;
    onabort: any;
    constructor() {
      xhr = this;
    }
    open() {}
    setRequestHeader() {}
    send() {}
    abort = jest.fn(() => this.onabort?.());
  }
  global.XMLHttpRequest = FakeXhr as any;
  try {
    const chunks: string[] = [];
    const ctl = new AbortController();
    const response = defaultFetch(req.url, {
      method: 'POST',
      headers: {},
      body: '',
      signal: ctl.signal,
      onChunk: c => chunks.push(c),
    });
    xhr.responseText = '一';
    xhr.onprogress();
    xhr.responseText = '一二';
    xhr.onprogress();
    expect(chunks).toEqual(['一', '二']);
    xhr.onload();
    expect((await response).status).toBe(200);
    expect(chunks).toEqual(['一', '二']);
    const next = defaultFetch(req.url, {
      method: 'POST',
      headers: {},
      body: '',
      signal: ctl.signal,
      onChunk: () => {},
    });
    ctl.abort();
    await expect(next).rejects.toThrow('停止');
    expect(xhr.abort).toHaveBeenCalledTimes(1);
  } finally {
    global.XMLHttpRequest = original;
  }
});
