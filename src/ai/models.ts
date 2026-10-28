/** 模型能力目录与供应商适配。未知能力保持未知，不把原型的演示模型列表当成接口数据。 */
import type {
  AiProvider,
  AiService,
  ConversationConfig,
  Effort,
  ModelCapabilities,
  ModelEntry,
  ProviderKind,
} from './types';

export const EFFORT_NAME: Record<Effort, string> = {
  off: '关闭',
  on: '开启',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
};
export const EFFORT_ORDER: Effort[] = [
  'off',
  'on',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];
const LEVELS: Effort[] = ['off', 'low', 'medium', 'high'];
const BINARY: Effort[] = ['off', 'on'];

export const PROVIDER_PRESETS: Record<
  ProviderKind,
  {
    name: string;
    protocol: AiProvider['protocol'];
    baseUrl: string;
    color: string;
    initials: string;
  }
> = {
  anthropic: {
    name: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    color: '#C96442',
    initials: 'A',
  },
  openai: {
    name: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    color: '#087F5B',
    initials: 'O',
  },
  deepseek: {
    name: 'DeepSeek',
    protocol: 'chat',
    baseUrl: 'https://api.deepseek.com/v1',
    color: '#4058C7',
    initials: 'D',
  },
  dashscope: {
    name: '通义千问',
    protocol: 'chat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    color: '#615CED',
    initials: '通',
  },
  moonshot: {
    name: 'Kimi',
    protocol: 'chat',
    baseUrl: 'https://api.moonshot.cn/v1',
    color: '#16191E',
    initials: 'K',
  },
  zhipu: {
    name: '智谱 GLM',
    protocol: 'chat',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    color: '#3859FF',
    initials: '智',
  },
  openrouter: {
    name: 'OpenRouter',
    protocol: 'chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    color: '#6467F2',
    initials: 'R',
  },
  custom: {
    name: '自定义',
    protocol: 'chat',
    baseUrl: '',
    color: '#5C626B',
    initials: '+',
  },
};

const baseCaps = (): ModelCapabilities => ({
  chat: true,
  tools: null,
  thinking: null,
  search: null,
  context: null,
  thinkingStyle: 'none',
  known: false,
});
export const bareModel = (id: string) =>
  id
    .split('/')
    .pop()!
    .replace(/:online$/, '')
    .toLowerCase();

export function inferCapabilities(id: string): ModelCapabilities {
  const b = bareModel(id);
  const c = baseCaps();
  const known = (extra: Partial<ModelCapabilities>) => ({
    ...c,
    known: true,
    tools: true,
    ...extra,
  });
  if (
    /embed|rerank|^tts|whisper|dall-e|^gpt-image|moderation|realtime/.test(b)
  ) {
    return known({ chat: false, tools: false, thinking: [], search: false });
  }
  if (/^claude-(opus|sonnet|haiku)-5-5/.test(b)) {
    const mandatory = /^claude-(opus|sonnet)-/.test(b);
    return known({
      thinking: [
        ...(mandatory ? [] : (['off'] as Effort[])),
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ],
      search: true,
      thinkingStyle: 'adaptive',
    });
  }
  if (/^claude-(opus|sonnet)-4-6/.test(b)) {
    return known({
      thinking: [...LEVELS, 'max'],
      search: true,
      thinkingStyle: 'adaptive',
    });
  }
  if (/^claude-(opus-4-[15]|sonnet-4-[05]|haiku-4-5)/.test(b)) {
    return known({
      thinking: [...LEVELS],
      search: true,
      thinkingStyle: 'budget',
    });
  }
  if (/^gpt-6(?:-astra|\.1-sol)/.test(b)) {
    return known({
      thinking: ['low', 'medium', 'high', 'xhigh', 'max'],
      search: true,
      thinkingStyle: 'reasoning',
    });
  }
  if (/^gpt-5(?:[.-]|$)/.test(b)) {
    const firstGpt5 = /^gpt-5(?:-|$)/.test(b) && !/^gpt-5-[1-9]/.test(b);
    return known({
      thinking: firstGpt5
        ? ['minimal', 'low', 'medium', 'high']
        : [...LEVELS, 'xhigh'],
      search: true,
      thinkingStyle: 'reasoning',
    });
  }
  if (/^gpt-4/.test(b)) {
    return known({ thinking: [], search: true });
  }
  if (/^o[134](?:-|$)/.test(b)) {
    return known({
      thinking: ['low', 'medium', 'high'],
      search: true,
      thinkingStyle: 'reasoning',
    });
  }
  if (/^deepseek-reasoner/.test(b)) {
    return known({ thinking: ['on'], thinkingStyle: 'fixed', search: false });
  }
  if (/^deepseek-chat/.test(b)) {
    return known({ thinking: [], search: false });
  }
  if (/^deepseek-(flash|v4)/.test(b)) {
    return known({
      thinking: ['off', 'low', 'high', 'max'],
      thinkingStyle: 'toggle',
      search: false,
    });
  }
  if (/^qwen.*coder/.test(b)) {
    return known({ thinking: [], search: false });
  }
  if (/^qwen3\.8-2\.4t-a95b/.test(b)) {
    return known({ thinking: ['on'], thinkingStyle: 'fixed', search: true });
  }
  if (/^qwen-(?:max|turbo)(?:-|$)/.test(b)) {
    return known({ thinking: [], search: true });
  }
  if (/^qwen(?:3|-(?:plus|flash))/.test(b)) {
    return known({
      thinking: [...BINARY],
      thinkingStyle: 'toggle',
      search: true,
    });
  }
  if (/^kimi-k3/.test(b)) {
    return known({
      thinking: ['low', 'high', 'max'],
      thinkingStyle: 'toggle',
      search: true,
    });
  }
  if (/^kimi-k2[.-]6/.test(b)) {
    return known({
      thinking: [...BINARY],
      thinkingStyle: 'toggle',
      search: true,
    });
  }
  if (/^kimi-k2-thinking/.test(b)) {
    return known({ thinking: ['on'], thinkingStyle: 'fixed', search: true });
  }
  if (/^kimi-k2[.-]5/.test(b)) {
    return known({
      thinking: [...BINARY],
      thinkingStyle: 'toggle',
      search: true,
    });
  }
  if (/^kimi-k2|^moonshot-v1/.test(b)) {
    return known({ thinking: [], search: true });
  }
  if (/^glm-5\.3/.test(b)) {
    return known({
      thinking: ['low', 'high', 'max'],
      thinkingStyle: 'toggle',
      search: true,
    });
  }
  if (/^glm-5\.2/.test(b)) {
    return known({
      thinking: ['off', 'high', 'max'],
      thinkingStyle: 'toggle',
      search: true,
    });
  }
  if (/^glm-(4\.[567]|5(?:[.-]|$))/.test(b)) {
    return known({
      thinking: [...BINARY],
      thinkingStyle: 'toggle',
      search: true,
    });
  }
  return c;
}

export function capabilitiesOf(
  provider: AiProvider,
  model: ModelEntry,
): ModelCapabilities {
  const c = { ...inferCapabilities(model.id), ...model.overrides };
  // 中转的 Chat Completions 搜索并非通用能力，需显式标注接口支持。
  if (
    provider.kind === 'custom' &&
    provider.protocol === 'chat' &&
    model.overrides?.search == null
  ) {
    c.search = null;
  }
  if (provider.kind === 'openrouter' && c.chat) {
    c.search = true;
  }
  if (
    provider.protocol === 'chat' &&
    /^gpt-6(?:-astra|\.1-sol)/.test(bareModel(model.id))
  ) {
    c.tools = false;
  }
  return c;
}

export type SearchMethod =
  | 'anthropic'
  | 'responses'
  | 'dashscope'
  | 'moonshot'
  | 'zhipu'
  | 'openrouter'
  | 'chat-options'
  | null;
/**
 * Anthropic 联网搜索工具的版本（AI_ASSISTANT §13.1）：带动态过滤的新版只在这些模型上有；
 * 更早的模型和认不出的中转模型名用基础版。
 */
export function anthropicSearchType(model: string): string {
  return /^claude-(?:opus-(?:5-5|5|4-8|4-7|4-6)|sonnet-(?:5-5|5|4-6))(?:-|$)/.test(
    bareModel(model),
  )
    ? 'web_search_20260209'
    : 'web_search_20250305';
}

export function searchMethod(
  p: Pick<AiProvider, 'kind' | 'protocol'>,
): SearchMethod {
  if (p.kind === 'deepseek') {
    return null;
  }
  if (p.protocol === 'anthropic') {
    return 'anthropic';
  }
  if (p.protocol === 'openai') {
    return 'responses';
  }
  if (
    p.kind === 'dashscope' ||
    p.kind === 'moonshot' ||
    p.kind === 'zhipu' ||
    p.kind === 'openrouter'
  ) {
    return p.kind;
  }
  return p.kind === 'custom' ? 'chat-options' : null;
}

export function searchAvailability(
  p: AiProvider,
  m: ModelEntry,
): { ok: boolean; reason: string } {
  const c = capabilitiesOf(p, m);
  if (!searchMethod(p)) {
    return { ok: false, reason: p.name + ' 的接口不支持联网搜索' };
  }
  if (c.search == null) {
    return { ok: false, reason: '这个模型的联网搜索能力还没标注' };
  }
  return c.search
    ? { ok: true, reason: '' }
    : { ok: false, reason: prettyModel(m.id) + ' 不支持联网搜索' };
}

export function normaliseEffort(effort: Effort, c: ModelCapabilities): Effort {
  const levels = c.thinking ?? [];
  if (!levels.length) {
    return 'off';
  }
  if (levels.includes(effort)) {
    return effort;
  }
  if (effort === 'off' && levels.includes('off')) {
    return 'off';
  }
  return levels.includes('on')
    ? 'on'
    : levels.includes('low')
    ? 'low'
    : levels[0];
}

export function normaliseConfig(
  config: ConversationConfig,
  providers: AiProvider[],
): ConversationConfig {
  const p = providers.find(x => x.id === config.providerId);
  const m = p?.models.find(x => x.id === config.model);
  if (!p || !m) {
    return config;
  }
  return {
    ...config,
    effort: normaliseEffort(config.effort, capabilitiesOf(p, m)),
    search: config.search && searchAvailability(p, m).ok,
  };
}

export const sameConfig = (
  a: ConversationConfig | null | undefined,
  b: ConversationConfig | null | undefined,
) =>
  !!a &&
  !!b &&
  a.providerId === b.providerId &&
  a.model === b.model &&
  a.effort === b.effort &&
  a.search === b.search &&
  !!a.mcp === !!b.mcp;

export function resolvedService(
  providers: AiProvider[],
  cfg: ConversationConfig | null | undefined,
): AiService | null {
  const p = providers.find(x => x.id === cfg?.providerId);
  const m = p?.models.find(x => x.id === cfg?.model && x.enabled);
  if (!p || !m || !cfg) {
    return null;
  }
  const capabilities = capabilitiesOf(p, m);
  if (!capabilities.chat) {
    return null;
  }
  return {
    id: p.id,
    name: p.name,
    protocol: p.protocol,
    baseUrl: p.baseUrl,
    auth: p.auth,
    cache: p.cache,
    keyTail: p.keyTail,
    model: m.id,
    price: m.price,
    effort: cfg.effort,
    search: cfg.search,
    mcp: !!cfg.mcp && capabilities.tools !== false,
    capabilities,
    providerKind: p.kind,
  };
}

export function prettyModel(id: string): string {
  const raw = id
    .split('/')
    .pop()!
    .replace(/:online$/, '');
  const m = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-|$)/.exec(raw);
  if (m) {
    return m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + '.' + m[3];
  }
  return raw.replace(/^gpt-/, 'GPT-');
}

export function configLabel(
  cfg: ConversationConfig,
  providers: AiProvider[],
): string {
  const p = providers.find(x => x.id === cfg.providerId);
  return (
    (p ? p.name + ' · ' : '') +
    prettyModel(cfg.model) +
    ' · 思考' +
    EFFORT_NAME[cfg.effort] +
    ' · 搜索' +
    (cfg.search ? '开' : '关') +
    (cfg.mcp ? ' · 外部工具开' : '')
  );
}

export function configChanges(
  a: ConversationConfig,
  b: ConversationConfig,
): string {
  const changes: string[] = [];
  if (a.providerId !== b.providerId || a.model !== b.model) {
    changes.push('更换模型');
  }
  if (a.effort !== b.effort) {
    changes.push('调整思考强度');
  }
  if (a.search !== b.search) {
    changes.push((b.search ? '开启' : '关闭') + '搜索');
  }
  if (!!a.mcp !== !!b.mcp) {
    changes.push((b.mcp ? '开启' : '关闭') + '外部工具');
  }
  return changes.join('、');
}

export const needsFreshInformation = (q: string) =>
  /新闻|最新|公告|时事|最近.*(发生|消息)|(?:latest|news|recent events)/i.test(
    q,
  );
