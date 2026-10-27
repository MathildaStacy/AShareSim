/**
 * AI 助手（M4）的数据结构：服务配置、存下来的消息、界面附加数据（工具标签、操作卡、记忆变更、用量）。
 * 请求怎么拼见 AI_ASSISTANT.md §1、§7。
 */

/** Anthropic Messages / OpenAI Responses。 */
export type Protocol = 'anthropic' | 'openai';

export const PROTOCOL_NAME: Record<Protocol, string> = {
  anthropic: 'Anthropic Messages',
  openai: 'OpenAI Responses',
};

/** 思考强度；off 不发送 thinking / reasoning 字段（不支持的中转服务用）。按服务固定，换了缓存失效。 */
export type Effort = 'off' | 'low' | 'medium' | 'high';

/** 美元 / 百万 tokens，存成千分之一美元的整数（3 美元 = 3000）。 */
export interface Price {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

export interface AiService {
  id: string;
  name: string;
  protocol: Protocol;
  /** 例如 https://api.anthropic.com；可以带 /v1，也可以是中转服务的地址。 */
  baseUrl: string;
  model: string;
  effort: Effort;
  /** 缓存参数（cache_control / prompt_cache_key）：服务不认时自动改成 off（§6.4）。 */
  cache: 'auto' | 'off';
  /** Anthropic 协议的鉴权头：官方是 x-api-key，不少中转服务要 Authorization: Bearer。 */
  auth: 'x-api-key' | 'bearer';
  price: Price | null;
  /** Key 的末 4 位，界面显示「已保存，末 4 位 xxxx」；Key 本身存在 Android Keystore。 */
  keyTail: string;
}

// ---------- 消息 ----------

/** 协议无关的消息内容。args / output 是字符串，原样发送，保证每次发送的字节相同（缓存）。 */
export type Part =
  | { t: 'text'; text: string }
  | { t: 'call'; id: string; name: string; args: string }
  | { t: 'result'; id: string; name: string; output: string };

export type Role = 'user' | 'assistant' | 'tool';

/** 模型返回的原始内容：Anthropic 是 content 块，OpenAI 是 output 项（含推理）。 */
export interface RawOutput {
  protocol: Protocol;
  model: string;
  items: unknown[];
}

export interface Usage {
  /** 没走缓存的输入（不含缓存读写）。 */
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  /** 服务有没有报告缓存数据（没有时界面写「该服务没有报告缓存数据」，不估算）。 */
  cacheReported: boolean;
}

export type CardStatus = 'pending' | 'done' | 'failed' | 'canceled' | 'expired';

/** 操作卡（AI_ASSISTANT.md §8）：AI 的写操作，你点「执行」才生效。 */
export interface ActionCard {
  /** 对话里的编号，从 1 开始（「操作卡 #2」）。 */
  no: number;
  tool: string;
  /** 工具参数（模型给的原文），执行时重新解析和校验。 */
  args: Record<string, unknown>;
  title: string;
  rows: { k: string; v: string }[];
  /** 生成时的预校验：通过 / 不通过的原因。 */
  check: { ok: boolean; text: string; lesson?: string };
  note?: string;
  /** 生成时的账户；重置账户后旧卡失效。 */
  accountId: number;
  status: CardStatus;
  result?: string;
  /** 执行结果已经在下一次提问的 <action_results> 里告诉了模型。 */
  reported?: boolean;
}

export type MemoryKind = 'background' | 'preference' | 'plan' | 'agreement';

export const MEMORY_KIND_NAME: Record<MemoryKind, string> = {
  background: '背景',
  preference: '偏好',
  plan: '计划',
  agreement: '约定',
};

/** 一次记忆变更：自动记住时 done（可撤销），先问我时 pending（记住 / 不用）。 */
export interface MemoryChange {
  op: 'add' | 'forget';
  /** add：新记忆的 id（pending 时还没有）；forget：被删的记忆 id。 */
  id: number | null;
  kind: MemoryKind;
  text: string;
  status: 'done' | 'pending' | 'undone' | 'declined';
  /** 先问我模式：等你点「记住 / 不用」。 */
  asked?: boolean;
  /** 你的决定（确认 / 不用 / 撤销）已经在下一次提问里告诉了模型。 */
  reported?: boolean;
}

/** 一次工具调用在界面上的样子。 */
export interface ToolUi {
  id: string;
  name: string;
  /** 「读取 招商银行 近 60 日 K 线」。 */
  label: string;
  error?: boolean;
  card?: ActionCard;
  memory?: MemoryChange;
  /** navigate：回答结束后打开的页面。 */
  nav?: { route: string; params?: Record<string, unknown>; label: string };
}

export interface MessageUi {
  /** user：你的问题原文和附带了什么。 */
  question?: string;
  page?: string | null;
  actions?: number;
  /** user：换了页面时的分隔线「你现在在：xxx」。 */
  divider?: string;
  /** assistant：这一次请求的用量和服务。 */
  usage?: Usage;
  service?: string;
  /** tool：每个工具调用。 */
  tools?: ToolUi[];
  /** assistant：出错或被停止时的说明。 */
  error?: string;
  /** assistant：提示（例如「这个服务不认缓存参数，已自动关闭」）。 */
  notice?: string;
}

export interface StoredMessage {
  id: number;
  threadId: number;
  role: Role;
  parts: Part[];
  raw: RawOutput | null;
  ui: MessageUi | null;
  compacted: boolean;
  createdAt: string;
}

export interface Thread {
  id: number;
  title: string;
  summary: string;
  compactedCount: number;
  lastPage: string | null;
  memorySnapshot: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Memory {
  id: number;
  kind: MemoryKind;
  text: string;
  sourceThreadId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** AI 的偏好（settings 表 aiPrefs）。 */
export interface AiPrefs {
  memoryMode: 'auto' | 'ask' | 'off';
  /** 附带页面上下文。 */
  includePage: boolean;
  /** 附带最近几条操作：0 / 5 / 10 / 20。 */
  recentN: number;
  /** 超过多少条消息压缩：10 / 20 / 40。 */
  compactAt: number;
  /** 当前使用的服务。 */
  activeService: string | null;
}

export const DEFAULT_AI_PREFS: AiPrefs = {
  memoryMode: 'auto',
  includePage: true,
  recentN: 10,
  compactAt: 20,
  activeService: null,
};
