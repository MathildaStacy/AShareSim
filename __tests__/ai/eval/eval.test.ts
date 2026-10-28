/// <reference types="node" />
/**
 * AI 回归评测（AI_ASSISTANT §13.9）。默认用录好的模型响应、不联网；换提示词或模型时联网跑：
 *
 *   AI_EVAL_LIVE=1 AI_EVAL_BASE_URL=https://… AI_EVAL_KEY=sk-… AI_EVAL_MODEL=… \
 *   [AI_EVAL_PROTOCOL=anthropic|openai|chat] [AI_EVAL_AUTH=bearer|x-api-key] \
 *   [AI_EVAL_PRICE=输入,缓存读,缓存写,输出（美元 / 百万 token）] npm run eval:live
 *
 * 每题检查三件事：该调的工具调了、回答里的数字都能溯源、用户没授权时没有生成操作卡。
 */
import { ask, newThread, setAiDeps, useChat } from '../../../src/ai/chat';
import type { FetchLike } from '../../../src/ai/http';
import { costOf, fmtUsd, addUsage, ZERO_USAGE } from '../../../src/ai/prompt';
import {
  answerText,
  traceNumbers,
  turnSources,
} from '../../../src/ai/provenance';
import { saveServices, type KeyStore } from '../../../src/ai/services';
import type {
  AiService,
  Price,
  StoredMessage,
  Usage,
} from '../../../src/ai/types';
import { CASES, type EvalCall } from './helpers/cases';
import { evalCore } from './helpers/harness';

jest.mock('../../../src/data/drivers/opSqlite', () => ({
  openDeviceDb: () => {
    throw new Error('测试里不用设备数据库');
  },
}));
jest.mock('../../../src/app/tracker', () => ({ nativeTracker: () => null }));

const env = process.env;
const LIVE = env.AI_EVAL_LIVE === '1';
const price = (): Price | null => {
  const p = (env.AI_EVAL_PRICE ?? '').split(',').map(Number);
  return p.length === 4 && p.every(Number.isFinite)
    ? {
        input: p[0] * 1000,
        cacheRead: p[1] * 1000,
        cacheWrite: p[2] * 1000,
        output: p[3] * 1000,
      }
    : null;
};
const SVC: AiService = LIVE
  ? {
      id: 'eval',
      name: '评测',
      protocol: (env.AI_EVAL_PROTOCOL as AiService['protocol']) ?? 'anthropic',
      baseUrl: env.AI_EVAL_BASE_URL ?? '',
      model: env.AI_EVAL_MODEL ?? '',
      effort: 'low',
      cache: 'auto',
      auth: (env.AI_EVAL_AUTH as AiService['auth']) ?? 'bearer',
      price: price(),
      keyTail: (env.AI_EVAL_KEY ?? '').slice(-4),
    }
  : {
      id: 'eval',
      name: '录好的响应',
      protocol: 'anthropic',
      baseUrl: 'https://recorded.invalid',
      model: 'claude-sonnet-5-5',
      effort: 'low',
      cache: 'auto',
      auth: 'bearer',
      price: { input: 3000, cacheRead: 300, cacheWrite: 3750, output: 15000 },
      keyTail: 'test',
    };

const keys: KeyStore = {
  get: async () => (LIVE ? env.AI_EVAL_KEY ?? null : 'sk-recorded'),
  set: async () => {},
  remove: async () => {},
};

let script: unknown[] = [];
let tu = 0;
const usage = {
  input_tokens: 40,
  cache_read_input_tokens: 1800,
  cache_creation_input_tokens: 0,
  output_tokens: 30,
};
const toolReply = (calls: EvalCall[]) => ({
  model: SVC.model,
  stop_reason: 'tool_use',
  content: calls.map(c => ({
    type: 'tool_use',
    id: 'tu_' + ++tu,
    name: c.name,
    input: c.input,
  })),
  usage,
});
const textReply = (text: string) => ({
  model: SVC.model,
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
  usage,
});

const recorded: FetchLike = async () => {
  const r = script.shift() ?? textReply('（没有更多录好的响应）');
  return { status: 200, text: async () => JSON.stringify(r) };
};

/** Node 的 fetch，流式时把每段文字交给 onChunk。 */
const liveFetch: FetchLike = async (url, init) => {
  const { onChunk, ...req } = init;
  const res = await fetch(url, req as RequestInit);
  let full = '';
  if (onChunk && res.body) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = dec.decode(value, { stream: true });
      full += chunk;
      onChunk(chunk);
    }
  } else {
    full = await res.text();
  }
  return { status: res.status, text: async () => full };
};

let total: Usage = ZERO_USAGE;

afterAll(() => {
  if (LIVE) {
    const p = SVC.price;
    console.log(
      '评测用量：输入 ' +
        (total.input + total.cacheRead + total.cacheWrite) +
        '（缓存读 ' +
        total.cacheRead +
        '），输出 ' +
        total.output +
        ' token' +
        (p
          ? '，约 ' + fmtUsd(costOf(total, p))
          : '（没给 AI_EVAL_PRICE，不估费用）'),
    );
  }
});

describe.each(CASES.map(c => [c.category + ' · ' + c.id, c] as const))(
  '%s',
  (_, c) => {
    test(
      '调对工具、数字有来源、没授权不生成操作卡',
      async () => {
        const core = await evalCore();
        await saveServices(core.db, [SVC]);
        setAiDeps({ keys, fetch: LIVE ? liveFetch : recorded });
        newThread();
        script = LIVE ? [] : [...c.rounds.map(toolReply), textReply(c.answer)];
        await ask(core, { question: c.question, page: c.page });
        const msgs: StoredMessage[] = useChat.getState().messages;
        const q = msgs.find(m => m.role === 'user') ?? null;
        const answer = msgs.filter(m => m !== q);
        answer
          .filter(m => m.role === 'assistant')
          .forEach(m => {
            total = addUsage(total, m.ui?.usage ?? ZERO_USAGE);
          });
        const tools = answer.flatMap(m =>
          m.role === 'tool'
            ? m.parts.flatMap(p => (p.t === 'result' ? [p.name] : []))
            : [],
        );
        const uis = answer.flatMap(m => m.ui?.tools ?? []);
        const text = answerText(answer);
        const trace = traceNumbers(text, turnSources(q, answer));
        expect({
          id: c.id,
          errors: uis.filter(u => u.error).map(u => u.label),
        }).toEqual({ id: c.id, errors: [] });
        for (const t of c.tools) {
          expect({ id: c.id, tools }).toEqual({
            id: c.id,
            tools: expect.arrayContaining([t]),
          });
        }
        expect({ id: c.id, missing: trace.missing.map(m => m.text) }).toEqual({
          id: c.id,
          missing: [],
        });
        expect({ id: c.id, cards: uis.filter(u => u.card).length }).toEqual({
          id: c.id,
          cards: 0,
        });
        expect({
          id: c.id,
          proposals: uis.filter(u => u.proposal).length,
        }).toEqual({
          id: c.id,
          proposals: c.proposals ?? 0,
        });
        expect(text.length).toBeGreaterThan(20);
      },
      LIVE ? 180_000 : 10_000,
    );
  },
);
