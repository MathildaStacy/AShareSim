/**
 * 两种协议的请求和响应（AI_ASSISTANT.md §6、§7），纯函数，不联网。
 *
 * 请求按「不变的在前、变的在后」排列：tools → 固定系统提示（断点 1）→ 记忆快照和摘要（断点 2）→ 历史 →
 * 最后一条用户消息。历史只追加不改写：每条消息按存下来的 parts 原样转换，模型返回的原始内容
 * （含推理）在同一个服务和模型下原样传回，所以每次请求的前缀字节相同，能读缓存。
 */
import type {
  AiService,
  Effort,
  Part,
  Protocol,
  RawOutput,
  StoredMessage,
  Usage,
} from './types';
import { evidenceOf } from './evidence';
import { searchMethod } from './models';

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema（object）。 */
  schema: Record<string, unknown>;
}

export interface RequestInput {
  service: Pick<AiService, 'protocol' | 'model' | 'baseUrl'> &
    Partial<AiService>;
  /** 固定系统提示（断点 1，所有对话共用）。 */
  system: string;
  /** 记忆快照 + 对话摘要（断点 2，一个对话里不变）。 */
  context: string;
  tools: ToolDef[];
  /** 没压缩的消息，从早到晚；最后一条是这次的提问或工具结果。 */
  history: StoredMessage[];
  /** 发缓存参数（cache_control / prompt_cache_key）。 */
  cache: boolean;
  effort: Effort;
  /** 每台设备固定的 prompt_cache_key。 */
  cacheKey: string;
  /** 压缩时用：不让模型调用工具。 */
  noTools?: boolean;
  stream?: boolean;
}

export interface BuiltRequest {
  url: string;
  body: Record<string, unknown>;
}

export const MAX_OUTPUT_TOKENS = 16000;

/** Base URL → 接口地址。可以填 https://api.anthropic.com、…/v1、或者直接填到 /v1/messages。 */
export function endpointOf(
  protocol: Protocol,
  baseUrl: string,
  kind: 'generate' | 'models' = 'generate',
): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  const m = /^(https?:\/\/[A-Za-z0-9.-]+(?::\d+)?)(\/[^\s]*)?$/i.exec(trimmed);
  if (!m) {
    throw new Error(
      'Base URL 要以 http:// 或 https:// 开头，例如 https://api.anthropic.com',
    );
  }
  const endpoint =
    protocol === 'openai'
      ? 'responses'
      : protocol === 'chat'
      ? 'chat/completions'
      : 'messages';
  const target = kind === 'generate' ? endpoint : 'models';
  let path = m[2] ?? '';
  path = path.replace(/\/(?:chat\/completions|responses|messages|models)$/, '');
  if (!/\/v\d+$/.test(path)) {
    path += '/v1';
  }
  return m[1] + path + '/' + target;
}

const sameModel = (raw: RawOutput | null, s: RequestInput['service']) =>
  !!raw &&
  raw.protocol === s.protocol &&
  raw.model === s.model &&
  (!raw.providerId || raw.providerId === s.id);

const REASONING = new Set(['thinking', 'redacted_thinking', 'reasoning']);

/** 原样传回的内容；关了思考时去掉推理块（没开思考的请求不认它们）。 */
const replay = (raw: RawOutput, effort: Effort): unknown[] =>
  effort === 'off'
    ? raw.items.filter(
        i => !REASONING.has((i as { type?: string })?.type ?? ''),
      )
    : raw.items;

const parseArgs = (args: string): unknown => {
  try {
    return JSON.parse(args || '{}');
  } catch {
    return {};
  }
};

// ---------- Anthropic Messages ----------

type AMessage = { role: 'user' | 'assistant'; content: unknown[] };

function anthropicMessages(input: RequestInput): AMessage[] {
  const out: AMessage[] = [];
  const push = (role: AMessage['role'], content: unknown[]) => {
    if (!content.length) {
      return;
    }
    // 相邻同角色的消息合并（工具结果和下一条提问都是 user）；tool_result 块在前，符合协议要求
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content.push(...content);
    } else {
      out.push({ role, content: [...content] });
    }
  };
  for (const m of input.history) {
    if (m.role === 'assistant') {
      if (sameModel(m.raw, input.service)) {
        push('assistant', replay(m.raw!, input.effort));
        continue;
      }
      // 换了服务或模型：只发文字和工具调用，不发推理内容
      push(
        'assistant',
        m.parts.flatMap((p): unknown[] =>
          p.t === 'text'
            ? p.text
              ? [{ type: 'text', text: p.text }]
              : []
            : p.t === 'call'
            ? [
                {
                  type: 'tool_use',
                  id: p.id,
                  name: p.name,
                  input: parseArgs(p.args),
                },
              ]
            : [],
        ),
      );
    } else {
      push(
        'user',
        m.parts.flatMap((p): unknown[] =>
          p.t === 'text'
            ? [{ type: 'text', text: p.text }]
            : p.t === 'result'
            ? [{ type: 'tool_result', tool_use_id: p.id, content: p.output }]
            : [],
        ),
      );
    }
  }
  return out;
}

function anthropicBody(input: RequestInput): Record<string, unknown> {
  const cc = input.cache ? { cache_control: { type: 'ephemeral' } } : {};
  const enabled = input.effort !== 'off';
  const budget = input.service.capabilities?.thinkingStyle === 'budget';
  return {
    model: input.service.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    ...(input.stream ? { stream: true } : {}),
    ...(enabled
      ? {
          thinking: budget
            ? {
                type: 'enabled',
                budget_tokens:
                  input.effort === 'low'
                    ? 1024
                    : input.effort === 'medium'
                    ? 4096
                    : 8192,
              }
            : { type: 'adaptive' },
          ...(!budget
            ? {
                output_config: {
                  effort: input.effort === 'on' ? 'medium' : input.effort,
                },
              }
            : {}),
        }
      : input.service.capabilities?.thinking?.includes('off')
      ? { thinking: { type: 'disabled' } }
      : {}),
    // 自动断点：落在最后一块，随对话增长后移（§6.2 断点 3）
    ...cc,
    tools: [
      ...(input.service.search && !input.noTools
        ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]
        : []),
      ...input.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.schema,
      })),
    ],
    ...(input.noTools && input.tools.length
      ? { tool_choice: { type: 'none' } }
      : {}),
    system: [
      { type: 'text', text: input.system, ...cc },
      { type: 'text', text: input.context, ...cc },
    ],
    messages: anthropicMessages(input),
  };
}

// ---------- OpenAI Responses ----------

function openaiInput(input: RequestInput): unknown[] {
  const out: unknown[] = [];
  for (const m of input.history) {
    if (m.role === 'assistant') {
      if (sameModel(m.raw, input.service)) {
        out.push(...replay(m.raw!, input.effort));
        continue;
      }
      for (const p of m.parts) {
        if (p.t === 'text' && p.text) {
          out.push({ role: 'assistant', content: p.text });
        } else if (p.t === 'call') {
          out.push({
            type: 'function_call',
            call_id: p.id,
            name: p.name,
            arguments: p.args,
          });
        }
      }
    } else if (m.role === 'tool') {
      for (const p of m.parts) {
        if (p.t === 'result') {
          out.push({
            type: 'function_call_output',
            call_id: p.id,
            output: p.output,
          });
        }
      }
    } else {
      out.push({
        role: 'user',
        content: m.parts.flatMap(p =>
          p.t === 'text' ? [{ type: 'input_text', text: p.text }] : [],
        ),
      });
    }
  }
  return out;
}

function openaiBody(input: RequestInput): Record<string, unknown> {
  const search = input.service.search && !input.noTools;
  const include = [
    ...(input.effort !== 'off' ? ['reasoning.encrypted_content'] : []),
    ...(search ? ['web_search_call.action.sources'] : []),
  ];
  return {
    model: input.service.model,
    store: false,
    ...(input.stream ? { stream: true } : {}),
    ...(input.cache ? { prompt_cache_key: input.cacheKey } : {}),
    ...(input.effort !== 'off'
      ? {
          reasoning: {
            effort: input.effort === 'on' ? 'medium' : input.effort,
            summary: 'auto',
          },
          // store: false 时推理内容要加密后原样传回，否则工具调用之后模型丢了推理（§7）
        }
      : input.service.capabilities?.thinkingStyle === 'reasoning' &&
        input.service.capabilities.thinking?.includes('off')
      ? { reasoning: { effort: 'none' } }
      : {}),
    ...(include.length ? { include } : {}),
    max_output_tokens: MAX_OUTPUT_TOKENS,
    instructions: input.system + '\n\n' + input.context,
    tools: [
      ...(search ? [{ type: 'web_search' }] : []),
      ...input.tools.map(t => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: t.schema,
        strict: false,
      })),
    ],
    ...(input.noTools && input.tools.length ? { tool_choice: 'none' } : {}),
    input: openaiInput(input),
  };
}

// ---------- OpenAI Chat Completions 及兼容供应商 ----------
function chatMessages(input: RequestInput): unknown[] {
  const out: unknown[] = [
    { role: 'system', content: input.system + '\n\n' + input.context },
  ];
  for (const m of input.history) {
    if (m.role === 'assistant') {
      if (!m.parts.length && !m.raw) {
        continue;
      }
      if (sameModel(m.raw, input.service)) {
        // DeepSeek 等服务要求原样回传 reasoning_content，包括未调用工具的回答。
        out.push(...m.raw!.items);
        continue;
      }
      const calls = m.parts.filter(
        (p): p is Extract<Part, { t: 'call' }> => p.t === 'call',
      );
      out.push({
        role: 'assistant',
        content:
          m.parts
            .map(p => (p.t === 'text' ? p.text : ''))
            .filter(Boolean)
            .join('\n') || null,
        ...(calls.length
          ? {
              tool_calls: calls.map(c => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: c.args },
              })),
            }
          : {}),
      });
    } else if (m.role === 'tool') {
      for (const p of m.parts) {
        if (p.t === 'result') {
          out.push({ role: 'tool', tool_call_id: p.id, content: p.output });
        }
      }
    } else {
      out.push({
        role: 'user',
        content: m.parts.map(p => (p.t === 'text' ? p.text : '')).join('\n'),
      });
    }
  }
  return out;
}

function chatBody(input: RequestInput): Record<string, unknown> {
  const s = input.service,
    kind = s.providerKind,
    on = input.effort !== 'off';
  const thinking: Record<string, unknown> = {};
  if (s.capabilities?.thinking?.length || (!s.capabilities && on)) {
    if (kind === 'dashscope') {
      if (s.capabilities?.thinkingStyle !== 'fixed') {
        thinking.enable_thinking = on;
      }
    } else if (kind === 'deepseek' || kind === 'moonshot' || kind === 'zhipu') {
      if (s.capabilities?.thinkingStyle !== 'fixed') {
        thinking.thinking = { type: on ? 'enabled' : 'disabled' };
      }
      if (
        on &&
        !['on', 'off'].includes(input.effort) &&
        (s.capabilities?.thinking?.length ?? 0) > 2
      ) {
        thinking.reasoning_effort = input.effort;
      }
    } else if (kind === 'openrouter') {
      thinking.reasoning = {
        enabled: on,
        ...(on && input.effort !== 'on' ? { effort: input.effort } : {}),
      };
    } else if (s.capabilities?.thinkingStyle === 'toggle') {
      thinking.thinking = { type: on ? 'enabled' : 'disabled' };
      if (on && input.effort !== 'on') {
        thinking.reasoning_effort = input.effort;
      }
    } else if (on) {
      thinking.reasoning_effort =
        input.effort === 'on' ? 'medium' : input.effort;
    } else if (s.capabilities?.thinkingStyle === 'reasoning') {
      thinking.reasoning_effort = 'none';
    }
  }
  const tools: unknown[] = input.tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.schema,
    },
  }));
  const search: Record<string, unknown> = {};
  if (s.search && !input.noTools) {
    const method = searchMethod({ kind: kind ?? 'custom', protocol: 'chat' });
    if (method === 'dashscope') {
      search.enable_search = true;
      search.include_tool_usage = true;
    }
    if (method === 'zhipu') {
      tools.unshift({
        type: 'web_search',
        web_search: {
          enable: true,
          search_result: true,
          search_engine: 'search_pro',
          count: 5,
        },
      });
    }
    if (method === 'openrouter') {
      search.plugins = [{ id: 'web', max_results: 5 }];
    }
    if (method === 'chat-options') {
      search.web_search_options = {};
    }
  }
  return {
    model: s.model,
    messages: chatMessages(input),
    ...thinking,
    ...search,
    ...(kind === 'openai'
      ? { max_completion_tokens: MAX_OUTPUT_TOKENS }
      : { max_tokens: MAX_OUTPUT_TOKENS }),
    ...(input.stream
      ? { stream: true, stream_options: { include_usage: true } }
      : {}),
    ...(tools.length
      ? { tools, ...(input.noTools ? { tool_choice: 'none' } : {}) }
      : {}),
  };
}

export function buildRequest(input: RequestInput): BuiltRequest {
  if (input.service.capabilities?.tools === false) {
    // 有些接口完全不接收 function/tool 消息。切过去时保留可读内容，避免历史工具块导致 400。
    input = {
      ...input,
      history: input.history.map(m => ({
        ...m,
        raw: null,
        role: m.role === 'tool' ? 'user' : m.role,
        parts: m.parts.map(p =>
          p.t === 'call'
            ? { t: 'text', text: '历史工具调用 ' + p.name + '：' + p.args }
            : p.t === 'result'
            ? { t: 'text', text: '历史工具结果 ' + p.name + '：' + p.output }
            : p,
        ),
      })),
    };
  }
  return {
    url: endpointOf(input.service.protocol, input.service.baseUrl),
    body:
      input.service.protocol === 'anthropic'
        ? anthropicBody(input)
        : input.service.protocol === 'chat'
        ? chatBody(input)
        : openaiBody(input),
  };
}

/** 请求头（不含 Key 的部分也在这里，方便上下文页展示「实际请求结构」）。 */
export function headersOf(
  service: Pick<AiService, 'protocol' | 'auth'>,
  key: string,
): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (service.protocol !== 'anthropic' || service.auth === 'bearer') {
    h.Authorization = 'Bearer ' + key;
  } else {
    h['x-api-key'] = key;
  }
  if (service.protocol === 'anthropic') {
    h['anthropic-version'] = '2023-06-01';
  }
  return h;
}

// ---------- 响应 ----------

export type Stop = 'end' | 'tool' | 'max_tokens' | 'refusal' | 'other';

export interface ParsedResponse {
  parts: Part[];
  raw: RawOutput;
  usage: Usage;
  stop: Stop;
  /** 服务返回的模型名（测试连接时显示）。 */
  model: string | null;
  thinking?: string;
  search?: import('./types').SearchTrace;
}

const count = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;

const has = (o: any, k: string) => o != null && o[k] != null;

export class ProtocolError extends Error {}

export function parseResponse(
  protocol: Protocol,
  model: string,
  json: any,
): ParsedResponse {
  if (json == null || typeof json !== 'object') {
    throw new ProtocolError('响应不是 JSON 对象');
  }
  const parsed =
    protocol === 'anthropic'
      ? parseAnthropic(model, json)
      : protocol === 'chat'
      ? parseChat(model, json)
      : parseOpenai(model, json);
  const progress = evidenceOf(protocol, json);
  return {
    ...parsed,
    ...progress,
    usage: {
      ...parsed.usage,
      ...(progress.search?.calls != null
        ? { searchRequests: progress.search.calls }
        : {}),
    },
  };
}

function parseChat(model: string, json: any): ParsedResponse {
  const m = json.choices?.[0]?.message;
  if (!m || typeof m !== 'object') {
    throw new ProtocolError(
      '响应里没有 choices[0].message（不是 Chat Completions 格式）',
    );
  }
  const parts: Part[] = [];
  if (typeof m.content === 'string' && m.content) {
    parts.push({ t: 'text', text: m.content });
  }
  for (const c of m.tool_calls ?? []) {
    if (c.type === 'function') {
      parts.push({
        t: 'call',
        id: String(c.id),
        name: String(c.function?.name),
        args:
          typeof c.function?.arguments === 'string'
            ? c.function.arguments
            : '{}',
      });
    }
  }
  const u = json.usage ?? {},
    d = u.prompt_tokens_details ?? {};
  const read = count(d.cached_tokens ?? u.prompt_cache_hit_tokens),
    write = count(d.cache_write_tokens);
  const reason = json.choices[0].finish_reason;
  return {
    parts,
    raw: { protocol: 'chat', model, items: [m] },
    usage: {
      input: Math.max(0, count(u.prompt_tokens) - read - write),
      cacheRead: read,
      cacheWrite: write,
      output: count(u.completion_tokens),
      cacheReported:
        has(d, 'cached_tokens') || has(u, 'prompt_cache_hit_tokens'),
    },
    stop:
      reason === 'length'
        ? 'max_tokens'
        : reason === 'content_filter'
        ? 'refusal'
        : parts.some(p => p.t === 'call')
        ? 'tool'
        : 'end',
    model: typeof json.model === 'string' ? json.model : null,
  };
}

function parseAnthropic(model: string, json: any): ParsedResponse {
  if (!Array.isArray(json.content)) {
    throw new ProtocolError(
      '响应里没有 content（不是 Anthropic Messages 格式）',
    );
  }
  const parts: Part[] = [];
  for (const b of json.content) {
    if (b?.type === 'text' && typeof b.text === 'string') {
      parts.push({ t: 'text', text: b.text });
    } else if (b?.type === 'tool_use') {
      parts.push({
        t: 'call',
        id: String(b.id),
        name: String(b.name),
        args: JSON.stringify(b.input ?? {}),
      });
    }
  }
  const u = json.usage ?? {};
  const stop: Stop =
    json.stop_reason === 'tool_use'
      ? 'tool'
      : json.stop_reason === 'max_tokens'
      ? 'max_tokens'
      : json.stop_reason === 'refusal'
      ? 'refusal'
      : json.stop_reason === 'end_turn' || json.stop_reason === 'stop_sequence'
      ? 'end'
      : parts.some(p => p.t === 'call')
      ? 'tool'
      : 'other';
  return {
    parts,
    raw: { protocol: 'anthropic', model, items: json.content },
    usage: {
      input: count(u.input_tokens),
      cacheRead: count(u.cache_read_input_tokens),
      cacheWrite: count(u.cache_creation_input_tokens),
      output: count(u.output_tokens),
      cacheReported:
        has(u, 'cache_read_input_tokens') ||
        has(u, 'cache_creation_input_tokens'),
    },
    stop,
    model: typeof json.model === 'string' ? json.model : null,
  };
}

function parseOpenai(model: string, json: any): ParsedResponse {
  if (!Array.isArray(json.output)) {
    throw new ProtocolError('响应里没有 output（不是 OpenAI Responses 格式）');
  }
  const parts: Part[] = [];
  for (const item of json.output) {
    if (item?.type === 'message' && Array.isArray(item.content)) {
      const text = item.content
        .map((c: any) =>
          c?.type === 'output_text'
            ? String(c.text ?? '')
            : c?.type === 'refusal'
            ? String(c.refusal ?? '')
            : '',
        )
        .join('');
      if (text) {
        parts.push({ t: 'text', text });
      }
    } else if (item?.type === 'function_call') {
      parts.push({
        t: 'call',
        id: String(item.call_id),
        name: String(item.name),
        args: typeof item.arguments === 'string' ? item.arguments : '{}',
      });
    }
  }
  const u = json.usage ?? {};
  const d = u.input_tokens_details ?? {};
  const read = count(d.cached_tokens);
  const write = count(d.cache_write_tokens ?? u.cache_write_tokens);
  const stop: Stop =
    json.status === 'incomplete'
      ? json.incomplete_details?.reason === 'content_filter'
        ? 'refusal'
        : 'max_tokens'
      : parts.some(p => p.t === 'call')
      ? 'tool'
      : 'end';
  return {
    parts,
    raw: { protocol: 'openai', model, items: json.output },
    usage: {
      input: Math.max(0, count(u.input_tokens) - read - write),
      cacheRead: read,
      cacheWrite: write,
      output: count(u.output_tokens),
      cacheReported: has(d, 'cached_tokens'),
    },
    stop,
    model: typeof json.model === 'string' ? json.model : null,
  };
}

/** 从错误响应里取出说明（两种协议和多数中转服务的格式）。 */
export function errorMessageOf(json: any, fallback: string): string {
  const e = json?.error;
  if (typeof e === 'string') {
    return e;
  }
  if (e && typeof e.message === 'string') {
    return e.message;
  }
  if (typeof json?.message === 'string') {
    return json.message;
  }
  if (typeof json?.detail === 'string') {
    return json.detail;
  }
  return fallback;
}
