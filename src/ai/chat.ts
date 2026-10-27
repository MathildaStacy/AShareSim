/**
 * 对话运行时（AI_ASSISTANT.md §1、§4、§6、§8）：提问 → 拼请求 → 调模型 → 执行工具 → 再请求（最多 6 轮）→
 * 存消息；回答结束后检查要不要压缩。界面通过 useChat 读状态。
 *
 * 缓存相关的约定都在这里落地：每条提问连同当时附带的上下文原样存下、原样重发；记忆按对话拍快照；
 * 操作卡和记忆确认的结果放进下一次提问的 <action_results>，不改历史。
 */
import { create } from 'zustand';
import type { AppCore } from '../app/boot';
import * as aiRepo from '../data/aiRepo';
import * as repo from '../data/repos';
import { beijingIso } from '../market/clock';
import { formatSec } from '../engine/session';
import type { PageContext, Provider } from './context';
import {
  AiError,
  callModel,
  defaultFetch,
  type CallResult,
  type FetchLike,
} from './http';
import {
  addUsage,
  contextBlock,
  estimateTokens,
  memorySnapshotOf,
  nowLine,
  SYSTEM_PROMPT,
  turnContext,
  ZERO_USAGE,
} from './prompt';
import { buildRequest, type BuiltRequest } from './protocol';
import {
  installId,
  keychainStore,
  loadPrefs,
  loadProviders,
  saveProviders,
  savePrefs,
  defaultConversationConfig,
  setProviderCache,
  type KeyStore,
} from './services';
import { executeCard as execCard } from './tools/actions';
import { TOOL_DEFS } from './tools/defs';
import { runTool } from './tools/index';
import { phaseName } from './tools/read';
import type {
  AiPrefs,
  AiService,
  MessageUi,
  Part,
  StoredMessage,
  Thread,
  ToolUi,
  Usage,
  ConversationConfig,
  ModelProgress,
} from './types';
import {
  configChanges,
  normaliseConfig,
  resolvedService,
  sameConfig,
  needsFreshInformation,
} from './models';
import { SEARCH_TOOL, kimiSearch } from './search';
import { combineSearch } from './evidence';

/** 一个问题里最多几轮工具调用（§7）。 */
export const MAX_TOOL_ROUNDS = 6;
/** 压缩后保留最近几轮问答（约 8 条消息，§4）。 */
export const KEEP_EXCHANGES = 4;

// ---------- 依赖（测试里替换） ----------

interface Deps {
  keys: KeyStore;
  fetch: FetchLike;
}

const deps: Deps = { keys: keychainStore, fetch: defaultFetch };

export function setAiDeps(d: Partial<Deps>): void {
  Object.assign(deps, d);
}

export const aiKeys = () => deps.keys;
export const aiTransport = () => deps.fetch;

// ---------- 状态 ----------

export interface LastRequest {
  /** 服务 + 模型 + 思考强度：变了缓存就失效。 */
  svcKey: string;
  protocol: AiService['protocol'];
  at: number;
  threadId: number;
  /** 上一次请求的输入总量（含缓存读写）。 */
  inputTokens: number;
}

interface ChatState {
  threadId: number | null;
  thread: Thread | null;
  messages: StoredMessage[];
  /** 正在做什么：「思考中」「读取 招商银行 实时行情」。 */
  busy: string | null;
  /** 回答结束后要打开的页面（navigate 工具）。 */
  pendingNav: { route: string; params?: Record<string, unknown> } | null;
  lastReq: LastRequest | null;
  /** 打开 AI 页时记下的来源页面（上下文页也用它）。 */
  source: Provider | null;
  config: ConversationConfig | null;
}

export const useChat = create<ChatState>(() => ({
  threadId: null,
  thread: null,
  messages: [],
  busy: null,
  pendingNav: null,
  lastReq: null,
  source: null,
  config: null,
}));

let abort: AbortController | null = null;

export async function loadThread(
  core: AppCore,
  id: number | null,
): Promise<void> {
  if (id == null) {
    useChat.setState({
      threadId: null,
      thread: null,
      messages: [],
      config: await defaultConversationConfig(core.db),
    });
    return;
  }
  const [thread, messages] = await Promise.all([
    aiRepo.thread(core.db, id),
    aiRepo.messages(core.db, id),
  ]);
  const providers = await loadProviders(core.db);
  // 旧会话优先根据实际回复的模型认领配置；沿用供应商 id，因此 Key 无需移动。
  let config = thread?.config;
  if (thread && !config) {
    const last = [...messages]
      .reverse()
      .find(m => m.role === 'assistant' && m.raw);
    const provider = providers.find(
      p =>
        p.models.some(m => m.id === last?.raw?.model) &&
        (last?.raw?.providerId
          ? p.id === last.raw.providerId
          : p.protocol === last?.raw?.protocol),
    );
    config =
      provider && last?.raw
        ? normaliseConfig(
            {
              providerId: provider.id,
              model: last.raw.model,
              effort: 'low',
              search: false,
            },
            providers,
          )
        : await defaultConversationConfig(core.db);
    if (config) {
      await aiRepo.updateThread(
        core.db,
        id,
        { config, lastConfig: messages.length ? config : null },
        thread.updatedAt,
      );
      thread.config = config;
      thread.lastConfig = messages.length ? config : null;
    }
  }
  useChat.setState({
    threadId: thread ? id : null,
    thread,
    messages,
    config: config ? normaliseConfig(config, providers) : null,
  });
}

/** 打开 AI 页：没选对话时接着最近的一个。 */
export async function openLatest(core: AppCore): Promise<void> {
  if (useChat.getState().threadId != null) {
    await loadThread(core, useChat.getState().threadId);
    return;
  }
  const list = await aiRepo.threads(core.db);
  await loadThread(core, list[0]?.id ?? null);
}

export function newThread(): void {
  useChat.setState({
    threadId: null,
    thread: null,
    messages: [],
    config: null,
  });
}

/** 每段对话拥有自己的配置；最新选择作为下一段新对话的默认值。 */
export async function selectConfig(
  core: AppCore,
  next: ConversationConfig,
): Promise<void> {
  if (useChat.getState().busy) {
    return;
  }
  const providers = await loadProviders(core.db),
    cfg = normaliseConfig(next, providers);
  if (!resolvedService(providers, cfg)) {
    throw new Error('模型已停用或删除，请重新选择');
  }
  const { threadId } = useChat.getState();
  if (threadId != null) {
    await aiRepo.updateThread(core.db, threadId, { config: cfg }, beijingIso());
  }
  await savePrefs(core.db, {
    ...(await loadPrefs(core.db)),
    lastConfig: cfg,
    activeService: cfg.providerId,
  });
  useChat.setState(state => ({
    config: cfg,
    thread: state.thread ? { ...state.thread, config: cfg } : null,
  }));
}

export async function currentConfig(
  core: AppCore,
): Promise<ConversationConfig | null> {
  return (
    useChat.getState().config ?? (await defaultConversationConfig(core.db))
  );
}

export function stop(): void {
  abort?.abort();
}

export async function activeService(
  core: AppCore,
  _prefs?: AiPrefs,
): Promise<AiService | null> {
  const providers = await loadProviders(core.db),
    cfg = await currentConfig(core);
  return cfg
    ? resolvedService(providers, normaliseConfig(cfg, providers))
    : null;
}

const svcKeyOf = (s: AiService) =>
  [
    s.id,
    s.protocol,
    s.baseUrl,
    s.model,
    s.effort,
    s.search,
    s.cache,
    JSON.stringify(s.capabilities),
  ].join('|');

// ---------- 提问 ----------

export interface AskInput {
  question: string;
  /** 来源页面（打开 AI 时记下的路由，提问时重新计算上下文）。 */
  page: { route: string; ctx: PageContext } | null;
}

/** 对话里还没告诉模型的操作卡 / 记忆确认结果；顺便标成已告诉。 */
async function collectResults(
  core: AppCore,
  msgs: StoredMessage[],
): Promise<string[]> {
  const out: string[] = [];
  for (const m of msgs) {
    if (m.role !== 'tool' || !m.ui?.tools) {
      continue;
    }
    let changed = false;
    const tools = m.ui.tools.map(t => {
      const c = t.card;
      if (c && !c.reported && c.status !== 'pending') {
        changed = true;
        out.push(
          '操作卡 #' +
            c.no +
            '「' +
            c.title +
            '」：' +
            (c.status === 'done'
              ? '用户已执行 → ' + c.result
              : c.status === 'failed'
              ? '用户点了执行，但失败 → ' + c.result
              : c.status === 'expired'
              ? '已失效（账户重置）'
              : '用户取消了'),
        );
        return { ...t, card: { ...c, reported: true } };
      }
      const mm = t.memory;
      if (
        mm &&
        !mm.reported &&
        mm.status !== 'pending' &&
        mm.status !== 'done'
      ) {
        changed = true;
        out.push(
          (mm.op === 'add' ? '记忆「' : '忘记记忆「') +
            mm.text +
            '」：' +
            (mm.status === 'declined' ? '用户选择不要' : '用户撤销了'),
        );
        return { ...t, memory: { ...mm, reported: true } };
      }
      if (mm && !mm.reported && mm.status === 'done' && mm.asked) {
        // 先问我模式下用户点了「记住」：告诉模型；自动模式的 done 模型已经知道，不用说
        changed = true;
        out.push(
          (mm.op === 'add' ? '记忆「' : '忘记记忆「') +
            mm.text +
            '」：用户确认了' +
            (mm.id != null && mm.op === 'add' ? '（#' + mm.id + '）' : ''),
        );
        return { ...t, memory: { ...mm, reported: true } };
      }
      return t;
    });
    if (changed) {
      const ui = { ...m.ui, tools };
      await aiRepo.updateMessageUi(core.db, m.id, ui);
      m.ui = ui;
    }
  }
  return out;
}

export async function ask(core: AppCore, input: AskInput): Promise<void> {
  const question = input.question.trim();
  if (!question || useChat.getState().busy) {
    return;
  }
  const prefs = await loadPrefs(core.db);
  const config = await currentConfig(core);
  let svc = await activeService(core, prefs);
  if (!svc) {
    throw new AiError(
      'auth',
      '请先在「供应商与模型」中配置 Key 并启用一个对话模型',
    );
  }
  const key = await deps.keys.get(svc.id);
  if (!key) {
    throw new AiError('auth', '「' + svc.name + '」还没有保存 API Key');
  }
  if (config) {
    await savePrefs(core.db, {
      ...prefs,
      lastConfig: config,
      activeService: config.providerId,
    });
  }
  const now = beijingIso();
  // 对话
  let threadId = useChat.getState().threadId;
  if (threadId == null) {
    threadId = await aiRepo.createThread(
      core.db,
      question.replace(/\s+/g, ' ').slice(0, 40),
      now,
    );
  }
  let thread = (await aiRepo.thread(core.db, threadId))!;
  if (thread.memorySnapshot == null) {
    const snap = memorySnapshotOf(await aiRepo.memories(core.db));
    await aiRepo.updateThread(core.db, threadId, { memorySnapshot: snap }, now);
    thread = { ...thread, memorySnapshot: snap };
  }
  const existing = await aiRepo.messages(core.db, threadId);

  // 这次附带的上下文
  const page = prefs.includePage ? input.page?.ctx ?? null : null;
  const acts =
    prefs.recentN > 0
      ? await repo.recentActivity(core.db, prefs.recentN, core.sim.accountId)
      : null;
  const results = await collectResults(core, existing);
  const n = core.sim.now();
  const ph = phaseName(core);
  const ctxText = turnContext({
    now: nowLine(n.date, formatSec(n.t).slice(0, 5), ph.tradingDay, ph.phase),
    page,
    actions: acts,
    actionResults: results,
  });
  const pageName = input.page?.ctx.name ?? null;
  const divider =
    thread.lastConfig && config && !sameConfig(thread.lastConfig, config)
      ? configChanges(thread.lastConfig, config) + '，从这里使用新设置'
      : existing.length &&
        pageName &&
        thread.lastPage &&
        pageName !== thread.lastPage
      ? '你现在在：' + pageName
      : undefined;
  await aiRepo.addMessage(
    core.db,
    {
      threadId,
      role: 'user',
      parts: [
        { t: 'text', text: ctxText },
        { t: 'text', text: question },
      ],
      ui: {
        question,
        page: page ? page.name : null,
        actions: acts?.length ?? 0,
        divider,
      },
    },
    now,
  );
  if (pageName) {
    await aiRepo.updateThread(core.db, threadId, { lastPage: pageName }, now);
  }
  if (config) {
    await aiRepo.updateThread(
      core.db,
      threadId,
      { config, lastConfig: config },
      now,
    );
  }
  await loadThread(core, threadId);

  abort = new AbortController();
  const signal = abort.signal;
  let cardNo = Math.max(
    0,
    ...existing.flatMap(m => (m.ui?.tools ?? []).map(t => t.card?.no ?? 0)),
  );
  const navs: ToolUi['nav'][] = [];
  useChat.setState({ busy: '思考中…', pendingNav: null });
  let partialText = '';
  let progress: ModelProgress = {};
  let searchHistory: ModelProgress['search'];
  let paintedText = '';
  let lastPaint = 0;
  const paint = () => {
    const text = partialText;
    if (Date.now() - lastPaint < 40 && (paintedText || !text)) {
      return;
    }
    lastPaint = Date.now();
    paintedText = text;
    useChat.setState(state =>
      state.threadId !== threadId
        ? state
        : {
            busy: '正在回答…',
            messages: [
              ...state.messages.filter(m => m.id !== -1),
              {
                id: -1,
                threadId: threadId!,
                role: 'assistant',
                parts: [{ t: 'text', text }],
                raw: null,
                ui: {
                  ...progress,
                  config: config ?? undefined,
                  service: svc!.name + ' · ' + svc!.model,
                  price: svc!.price,
                },
                compacted: false,
                createdAt: now,
              },
            ],
          },
    );
  };
  const onText = (text: string) => {
    partialText = text;
    paint();
  };
  const onProgress = (next: ModelProgress) => {
    progress = { ...next, search: combineSearch(searchHistory, next.search) };
    paint();
  };
  try {
    for (let round = 0; ; round++) {
      partialText = '';
      paintedText = '';
      lastPaint = 0;
      progress = {};
      const res = await request(
        core,
        svc,
        key,
        threadId,
        signal,
        undefined,
        undefined,
        onText,
        onProgress,
      );
      svc = res.svc;
      const parsed = res.call.parsed;
      const search = combineSearch(searchHistory, parsed.search);
      const incompleteCalls =
        parsed.stop !== 'tool' && parsed.parts.some(p => p.t === 'call');
      const calls =
        parsed.stop !== 'tool'
          ? []
          : parsed.parts.filter(
              (p): p is Extract<Part, { t: 'call' }> => p.t === 'call',
            );
      await aiRepo.addMessage(
        core.db,
        {
          threadId,
          role: 'assistant',
          parts: incompleteCalls
            ? parsed.parts.filter(p => p.t !== 'call')
            : parsed.parts,
          raw: incompleteCalls ? null : parsed.raw,
          ui: {
            usage: parsed.usage,
            service: svc.name + ' · ' + svc.model,
            price: svc.price,
            config: config ?? undefined,
            thinking: parsed.thinking,
            search,
            searchOffer:
              !svc.search && !calls.length && needsFreshInformation(question)
                ? question
                : undefined,
            notice:
              res.notice ??
              (svc.search && !search && needsFreshInformation(question)
                ? '已允许搜索，但供应商未返回检索记录和来源，无法核验是否实际搜索。'
                : undefined),
            error:
              parsed.stop === 'max_tokens'
                ? '回答太长被截断了（输出上限）'
                : parsed.stop === 'refusal'
                ? '模型拒绝回答'
                : undefined,
          },
        },
        beijingIso(),
      );
      useChat.setState({
        lastReq: {
          svcKey: svcKeyOf(svc),
          protocol: svc.protocol,
          at: Date.now(),
          threadId,
          inputTokens:
            parsed.usage.input +
            parsed.usage.cacheRead +
            parsed.usage.cacheWrite,
        },
      });
      await loadThread(core, threadId);
      if (!calls.length) {
        break;
      }
      if (search) {
        searchHistory = { ...search, citations: [] };
      }
      // 执行工具：每个调用都要有结果（协议要求），超过轮数上限的不执行
      const over = round >= MAX_TOOL_ROUNDS;
      const resultParts: Part[] = [];
      const uis: ToolUi[] = [];
      for (const c of calls) {
        if (over || signal.aborted) {
          resultParts.push({
            t: 'result',
            id: c.id,
            name: c.name,
            output: over
              ? '已到工具调用上限（' + MAX_TOOL_ROUNDS + ' 轮），没有执行'
              : '用户停止了，没有执行',
          });
          uis.push({
            id: c.id,
            name: c.name,
            label: c.name + '（没有执行）',
            error: true,
          });
          continue;
        }
        useChat.setState({ busy: '正在调用 ' + c.name + '…' });
        let out;
        if (
          c.name === SEARCH_TOOL.name &&
          svc.providerKind === 'moonshot' &&
          svc.search
        ) {
          try {
            const found = await kimiSearch(
              svc,
              key,
              c.args,
              signal,
              deps.fetch,
            );
            searchHistory = combineSearch(searchHistory, found.search);
            out = {
              output: found.output,
              ui: {
                id: c.id,
                name: c.name,
                label: '联网搜索：' + found.search.queries[0],
              },
            };
            // 来源保存在工具消息；即便后续模型未返回注解，也可以核查真实检索结果。
            await aiRepo.addMessage(
              core.db,
              {
                threadId,
                role: 'assistant',
                parts: [],
                ui: {
                  search: found.search,
                  usage: { ...ZERO_USAGE, searchRequests: 1 },
                },
              },
              beijingIso(),
            );
          } catch (e) {
            out = {
              output: JSON.stringify({
                error: e instanceof Error ? e.message : String(e),
              }),
              ui: {
                id: c.id,
                name: c.name,
                label: '联网搜索失败',
                error: true,
              },
            };
          }
        } else if (svc.capabilities?.tools === false) {
          out = {
            output: '当前模型未启用 App 工具，未执行',
            ui: {
              id: c.id,
              name: c.name,
              label: '模型不支持 App 工具',
              error: true,
            },
          };
        } else {
          out = await runTool(
            {
              core,
              threadId,
              memoryMode: prefs.memoryMode,
              nextCardNo: () => ++cardNo,
            },
            c.id,
            c.name,
            c.args,
          );
        }
        resultParts.push({
          t: 'result',
          id: c.id,
          name: c.name,
          output: out.output,
        });
        uis.push(out.ui);
        if (out.ui.nav) {
          navs.push(out.ui.nav);
        }
      }
      await aiRepo.addMessage(
        core.db,
        { threadId, role: 'tool', parts: resultParts, ui: { tools: uis } },
        beijingIso(),
      );
      await loadThread(core, threadId);
      if (over || signal.aborted) {
        await addError(
          core,
          threadId,
          signal.aborted
            ? '已停止'
            : '工具调用超过 ' +
                MAX_TOOL_ROUNDS +
                ' 轮，已停止。可以换个问法再问',
        );
        break;
      }
      useChat.setState({ busy: '思考中…' });
    }
  } catch (e) {
    const msg =
      e instanceof AiError
        ? e.message
        : e instanceof Error
        ? e.message
        : String(e);
    if (partialText || progress.thinking || progress.search) {
      // 未结束的工具参数和推理签名不能重发，只保留已经展示的正文。
      await aiRepo.addMessage(
        core.db,
        {
          threadId,
          role: 'assistant',
          parts: [{ t: 'text', text: partialText }],
          ui: {
            ...progress,
            error: msg,
            config: config ?? undefined,
            service: svc.name + ' · ' + svc.model,
            price: svc.price,
          },
        },
        beijingIso(),
      );
      await loadThread(core, threadId);
    } else {
      await addError(core, threadId, msg);
    }
  } finally {
    abort = null;
    useChat.setState({ busy: null });
  }
  const nav = navs[navs.length - 1];
  if (nav && !signal.aborted) {
    useChat.setState({ pendingNav: { route: nav.route, params: nav.params } });
  }
  if (!signal.aborted) {
    await maybeCompact(core, threadId, prefs).catch(() => undefined);
  }
}

async function addError(core: AppCore, threadId: number, error: string) {
  await aiRepo.addMessage(
    core.db,
    { threadId, role: 'assistant', parts: [], ui: { error } },
    beijingIso(),
  );
  await loadThread(core, threadId);
}

/** 按 §1 的顺序拼这次请求（tools → 系统提示 → 记忆快照和摘要 → 历史）。 */
export async function buildFor(
  core: AppCore,
  svc: AiService,
  threadId: number,
  extra?: Part[],
  noTools?: boolean,
  stream = true,
): Promise<BuiltRequest> {
  const thread = (await aiRepo.thread(core.db, threadId))!;
  const history = (await aiRepo.messages(core.db, threadId)).filter(
    m => !m.compacted,
  );
  if (extra) {
    history.push({
      id: -1,
      threadId,
      role: 'user',
      parts: extra,
      raw: null,
      ui: null,
      compacted: false,
      createdAt: '',
    });
  }
  return buildRequest({
    service: svc,
    system: SYSTEM_PROMPT,
    context: contextBlock(thread.memorySnapshot ?? '', thread.summary),
    tools: modelTools(svc, noTools),
    history,
    cache: svc.cache === 'auto',
    effort: svc.effort,
    cacheKey: await installId(core.db),
    noTools,
    stream,
  });
}

export function modelTools(svc: AiService, noTools = false) {
  return [
    ...(!noTools && svc.search && svc.providerKind === 'moonshot'
      ? [SEARCH_TOOL]
      : []),
    ...(svc.capabilities?.tools === false ? [] : TOOL_DEFS),
  ];
}

/** 调一次模型；服务不认缓存 / 思考字段时去掉重发一次，并记住（§6.4）。 */
async function request(
  core: AppCore,
  svc0: AiService,
  key: string,
  threadId: number,
  signal: AbortSignal,
  extra?: Part[],
  noTools?: boolean,
  onText?: (text: string) => void,
  onProgress?: (progress: ModelProgress) => void,
): Promise<{ call: CallResult; svc: AiService; notice?: string }> {
  let svc = svc0;
  let notice: string | undefined;
  for (let attempt = 0; ; attempt++) {
    const req = await buildFor(core, svc, threadId, extra, noTools, !!onText);
    try {
      const call = await callModel(svc, key, req, {
        signal,
        fetchImpl: deps.fetch,
        onText,
        onProgress,
      });
      return { call, svc, notice };
    } catch (e) {
      if (!(e instanceof AiError) || !e.compat || attempt >= 2) {
        throw e;
      }
      if (e.compat === 'cache' && svc.cache === 'auto') {
        svc = { ...svc, cache: 'off' };
        notice = '这个服务不认缓存参数，已在服务设置里改成「关闭」';
      } else if (
        e.compat === 'effort' &&
        svc.effort !== 'off' &&
        (!svc.capabilities || svc.capabilities.thinking?.includes('off'))
      ) {
        svc = { ...svc, effort: 'off' };
        notice = '这个服务不认思考强度参数，已在服务设置里改成「不发送」';
      } else {
        throw e;
      }
      if (e.compat === 'cache') {
        await setProviderCache(core.db, svc.id, 'off');
      } else {
        await saveProviders(
          core.db,
          (
            await loadProviders(core.db)
          ).map(p =>
            p.id === svc.id
              ? {
                  ...p,
                  models: p.models.map(m =>
                    m.id === svc.model
                      ? {
                          ...m,
                          overrides: {
                            ...m.overrides,
                            thinking: [],
                            thinkingStyle: 'none' as const,
                          },
                        }
                      : m,
                  ),
                }
              : p,
          ),
        );
        const cfg = {
          providerId: svc.id,
          model: svc.model,
          effort: 'off' as const,
          search: svc.search ?? false,
        };
        await aiRepo.updateThread(
          core.db,
          threadId,
          { config: cfg, lastConfig: cfg },
          beijingIso(),
        );
        await savePrefs(core.db, {
          ...(await loadPrefs(core.db)),
          lastConfig: cfg,
        });
        useChat.setState({ config: cfg });
      }
    }
  }
}

// ---------- 操作卡和记忆确认 ----------

async function patchTool(
  core: AppCore,
  msgId: number,
  toolId: string,
  f: (t: ToolUi) => ToolUi,
): Promise<void> {
  const msgs = useChat.getState().messages;
  const m = msgs.find(x => x.id === msgId);
  if (!m?.ui?.tools) {
    return;
  }
  const ui: MessageUi = {
    ...m.ui,
    tools: m.ui.tools.map(t => (t.id === toolId ? f(t) : t)),
  };
  await aiRepo.updateMessageUi(core.db, msgId, ui);
  await loadThread(core, m.threadId);
}

const running = new Set<string>();

/** 点「执行」：同一张卡只能执行一次。 */
export async function runCard(
  core: AppCore,
  msgId: number,
  toolId: string,
): Promise<void> {
  const k = msgId + ':' + toolId;
  const m = useChat.getState().messages.find(x => x.id === msgId);
  const card = m?.ui?.tools?.find(t => t.id === toolId)?.card;
  if (!card || card.status !== 'pending' || running.has(k)) {
    return;
  }
  running.add(k);
  try {
    if (card.accountId !== core.sim.accountId) {
      await patchTool(core, msgId, toolId, t => ({
        ...t,
        card: {
          ...t.card!,
          status: 'expired',
          result: '账户已经重置，这张卡失效了',
        },
      }));
      return;
    }
    const r = await execCard(core, card);
    await patchTool(core, msgId, toolId, t => ({
      ...t,
      card: { ...t.card!, status: r.ok ? 'done' : 'failed', result: r.result },
    }));
  } finally {
    running.delete(k);
  }
}

export async function cancelCard(core: AppCore, msgId: number, toolId: string) {
  await patchTool(core, msgId, toolId, t =>
    t.card && t.card.status === 'pending'
      ? { ...t, card: { ...t.card, status: 'canceled' } }
      : t,
  );
}

/** 记忆变更的按钮：记住 / 不用（先问我模式）、撤销（自动模式）。 */
export async function memoryAction(
  core: AppCore,
  msgId: number,
  toolId: string,
  action: 'confirm' | 'decline' | 'undo',
): Promise<void> {
  const m = useChat.getState().messages.find(x => x.id === msgId);
  const mm = m?.ui?.tools?.find(t => t.id === toolId)?.memory;
  if (!m || !mm) {
    return;
  }
  const now = beijingIso();
  let next = mm;
  if (action === 'confirm' && mm.status === 'pending') {
    if (mm.op === 'add') {
      const id = await aiRepo.addMemory(
        core.db,
        { kind: mm.kind, text: mm.text, sourceThreadId: m.threadId },
        now,
      );
      next = { ...mm, id, status: 'done' };
    } else {
      await aiRepo.deleteMemory(core.db, mm.id!);
      next = { ...mm, status: 'done' };
    }
  } else if (action === 'decline' && mm.status === 'pending') {
    next = { ...mm, status: 'declined' };
  } else if (action === 'undo' && mm.status === 'done') {
    if (mm.op === 'add' && mm.id != null) {
      await aiRepo.deleteMemory(core.db, mm.id);
    } else if (mm.op === 'forget' && mm.id != null) {
      await aiRepo.restoreMemory(core.db, {
        id: mm.id,
        kind: mm.kind,
        text: mm.text,
        sourceThreadId: m.threadId,
        createdAt: now,
        updatedAt: now,
      });
    }
    next = { ...mm, status: 'undone', reported: false };
  } else {
    return;
  }
  await patchTool(core, msgId, toolId, t => ({ ...t, memory: next }));
}

// ---------- 压缩（§4） ----------

/** 显示的消息数：你的提问 + AI 的回答（没压缩的）。 */
export const liveMessageCount = (msgs: StoredMessage[]) =>
  msgs.filter(m => m.role === 'user' && !m.compacted).length * 2;

export const COMPACT_PROMPT =
  '（App 自动发送）这个对话太长了，请把上面除最近 ' +
  KEEP_EXCHANGES +
  ' 轮问答以外的较早部分总结成摘要，供之后的对话参考：保留结论、用户的决定和偏好、待办和没解决的问题；不要保留行情、价格、持仓这类会变的数字（之后会用工具现查）。只输出摘要正文，不要调用工具，不要加「仅供学习」那句话。';

export async function maybeCompact(
  core: AppCore,
  threadId: number,
  prefs: AiPrefs,
  force = false,
): Promise<boolean> {
  const msgs = (await aiRepo.messages(core.db, threadId)).filter(
    m => !m.compacted,
  );
  if (!force && liveMessageCount(msgs) <= prefs.compactAt) {
    return false;
  }
  const users = msgs.filter(m => m.role === 'user');
  if (users.length <= KEEP_EXCHANGES) {
    return false;
  }
  const keepFrom = users[users.length - KEEP_EXCHANGES].id;
  const svc = await activeService(core, prefs);
  const key = svc ? await deps.keys.get(svc.id) : null;
  if (!svc || !key) {
    return false;
  }
  useChat.setState({ busy: '压缩较早的消息…' });
  try {
    const extra: Part[] = [{ t: 'text', text: COMPACT_PROMPT }];
    const ctl = new AbortController();
    let res = await request(core, svc, key, threadId, ctl.signal, extra, true);
    let text = res.call.parsed.parts
      .map(p => (p.t === 'text' ? p.text : ''))
      .join('')
      .trim();
    if (!text) {
      // 模型还是调用了工具：不让它调用再要一次
      res = await request(
        core,
        res.svc,
        key,
        threadId,
        ctl.signal,
        extra,
        true,
      );
      text = res.call.parsed.parts
        .map(p => (p.t === 'text' ? p.text : ''))
        .join('')
        .trim();
    }
    if (!text) {
      return false;
    }
    const thread = (await aiRepo.thread(core.db, threadId))!;
    const compactedUsers = users.filter(u => u.id < keepFrom).length;
    const now = beijingIso();
    await aiRepo.markCompacted(core.db, threadId, keepFrom - 1);
    await aiRepo.updateThread(
      core.db,
      threadId,
      {
        summary: thread.summary ? thread.summary + '\n\n' + text : text,
        compactedCount: thread.compactedCount + compactedUsers * 2,
        // 压缩后历史被改写，缓存反正要重建一次，顺便刷新记忆快照（§6.1）
        memorySnapshot: memorySnapshotOf(await aiRepo.memories(core.db)),
      },
      now,
    );
    await loadThread(core, threadId);
    return true;
  } finally {
    useChat.setState({ busy: null });
  }
}

// ---------- 预估和上下文页（§6.5） ----------

export interface Section {
  key: string;
  title: string;
  text: string;
  tokens: number;
  /** 属于哪个缓存断点。 */
  breakpoint: string;
}

export interface Preview {
  sections: Section[];
  total: number;
  /** 预计走缓存的部分和原因。 */
  cached: number;
  cacheNote: string;
  request: BuiltRequest | null;
  service: AiService | null;
  rebuild: {
    tokens: number;
    reason: string;
    previous: ConversationConfig;
  } | null;
}

const TTL_MS: Record<AiService['protocol'], number> = {
  anthropic: 5 * 60_000,
  openai: 30 * 60_000,
  chat: 5 * 60_000,
};

/** 下一次提问会发什么：每部分的原文和 token 估算、预计走缓存的部分。 */
export async function preview(
  core: AppCore,
  page: { route: string; ctx: PageContext } | null,
  question = '（你的问题）',
): Promise<Preview> {
  const prefs = await loadPrefs(core.db);
  const svc = await activeService(core, prefs);
  const { threadId, lastReq } = useChat.getState();
  const thread =
    threadId != null ? await aiRepo.thread(core.db, threadId) : null;
  const msgs =
    threadId != null
      ? (await aiRepo.messages(core.db, threadId)).filter(m => !m.compacted)
      : [];
  const snap =
    thread?.memorySnapshot ?? memorySnapshotOf(await aiRepo.memories(core.db));
  const acts =
    prefs.recentN > 0
      ? await repo.recentActivity(core.db, prefs.recentN, core.sim.accountId)
      : null;
  const n = core.sim.now();
  const ph = phaseName(core);
  const turn = turnContext({
    now: nowLine(n.date, formatSec(n.t).slice(0, 5), ph.tradingDay, ph.phase),
    page: prefs.includePage ? page?.ctx ?? null : null,
    actions: acts,
    actionResults: [],
  });
  const actualTools = svc
    ? (buildRequest({
        service: svc,
        system: '',
        context: '',
        tools: modelTools(svc),
        history: [],
        cache: svc.cache === 'auto',
        effort: svc.effort,
        cacheKey: '',
      }).body.tools as unknown[])
    : TOOL_DEFS;
  const toolsText = JSON.stringify(actualTools ?? []);
  const histText = msgs
    .map(m =>
      m.parts
        .map(p =>
          p.t === 'text' ? p.text : p.t === 'call' ? p.name + p.args : p.output,
        )
        .join('\n'),
    )
    .join('\n');
  const sections: Section[] = [
    {
      key: 'tools',
      title: '工具定义（' + (actualTools?.length ?? 0) + ' 个）',
      text: toolsText,
      tokens: estimateTokens(toolsText),
      breakpoint: '断点 1（所有对话共用）',
    },
    {
      key: 'system',
      title: '固定系统提示',
      text: SYSTEM_PROMPT,
      tokens: estimateTokens(SYSTEM_PROMPT),
      breakpoint: '断点 1（所有对话共用）',
    },
    {
      key: 'memory',
      title: '记忆快照和对话摘要',
      text: contextBlock(snap, thread?.summary ?? ''),
      tokens: estimateTokens(contextBlock(snap, thread?.summary ?? '')),
      breakpoint: '断点 2（这个对话里不变）',
    },
    {
      key: 'history',
      title: '历史消息（' + msgs.length + ' 条，含工具调用）',
      text: histText || '（新对话，没有历史）',
      tokens: estimateTokens(histText),
      breakpoint: '自动断点（上一轮写入，这一轮读取）',
    },
    {
      key: 'turn',
      title: '这次附带：时间、页面、最近操作',
      text: turn,
      tokens: estimateTokens(turn),
      breakpoint: '不缓存（下一轮变成前缀）',
    },
    {
      key: 'question',
      title: '你的问题',
      text: question,
      tokens: estimateTokens(question),
      breakpoint: '不缓存',
    },
  ];
  const total = sections.reduce((a, s) => a + s.tokens, 0);
  const cfg = await currentConfig(core);
  const rebuild =
    thread?.lastConfig && cfg && !sameConfig(thread.lastConfig, cfg)
      ? {
          tokens: Math.max(0, total - sections[4].tokens - sections[5].tokens),
          reason: configChanges(thread.lastConfig, cfg),
          previous: thread.lastConfig,
        }
      : null;
  const fixed = sections[0].tokens + sections[1].tokens;
  let cached = 0;
  let cacheNote: string;
  if (!svc) {
    cacheNote = '还没有配置 AI 服务';
  } else if (rebuild) {
    cacheNote =
      '设置已变化，预计重建 ' +
      rebuild.tokens.toLocaleString('zh-CN') +
      ' tokens，以服务实际用量为准';
  } else if (svc.cache === 'off') {
    cacheNote =
      svc.protocol === 'openai'
        ? '缓存参数已关闭；服务端可能仍会自动缓存，以响应里的用量为准'
        : '这个服务的缓存参数已关闭，不走缓存';
  } else if (!lastReq) {
    cacheNote = '这次打开 App 以来第一次提问，缓存是冷的（第一次要写入缓存）';
  } else if (lastReq.svcKey !== svcKeyOf(svc)) {
    cacheNote = '模型、思考、搜索或供应商配置已变化，预计缓存要重建';
  } else if (Date.now() - lastReq.at > TTL_MS[svc.protocol]) {
    cacheNote =
      '距上次提问超过 ' +
      TTL_MS[svc.protocol] / 60_000 +
      ' 分钟，缓存可能已过期';
  } else if (lastReq.threadId === threadId) {
    // 这次附带的上下文和问题是新的，不会命中
    const fresh = sections[4].tokens + sections[5].tokens;
    cached = Math.min(total - fresh, lastReq.inputTokens);
    cacheNote = '接着上一轮，前缀预计可读缓存；以服务报告为准';
  } else {
    cached = fixed;
    cacheNote = '换了对话：工具和系统提示能读缓存，记忆和历史要重新写入';
  }
  let built: BuiltRequest | null = null;
  if (svc && threadId != null) {
    built = await buildFor(core, svc, threadId, [
      { t: 'text', text: turn },
      { t: 'text', text: question },
    ]);
  }
  return {
    sections,
    total,
    cached,
    cacheNote,
    request: built,
    service: svc,
    rebuild,
  };
}

/** 一个对话里累计的用量（上下文页的命中率）。 */
export function threadUsage(msgs: StoredMessage[]): Usage {
  return msgs.reduce(
    (a, m) => (m.ui?.usage ? addUsage(a, m.ui.usage) : a),
    ZERO_USAGE,
  );
}

/** 一次回答（一个提问之后、下一个提问之前）的用量合计。 */
export function answerUsage(msgs: StoredMessage[], from: number): Usage | null {
  let u: Usage | null = null;
  for (let i = from; i < msgs.length && msgs[i].role !== 'user'; i++) {
    const x = msgs[i].ui?.usage;
    if (x) {
      u = addUsage(u ?? ZERO_USAGE, x);
    }
  }
  return u;
}

// ---------- 测试连接 ----------

export interface ConnectionResult {
  ok: boolean;
  text: string;
  /** 自动关掉缓存参数 / 思考参数之后的服务配置。 */
  service: AiService;
  lines: string[];
}

/**
 * 测试连接（编辑服务页）：用真实的工具定义和系统提示发一个小问题，看延迟、返回的模型、有没有报告缓存。
 * 服务不认缓存字段 / 思考字段时自动改成关闭再试（§6.4）。
 */
export async function testConnection(
  core: AppCore,
  svc0: AiService,
  key: string,
): Promise<ConnectionResult> {
  let svc = svc0;
  const lines: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const req = buildRequest({
      service: svc,
      system: SYSTEM_PROMPT,
      context: contextBlock('', ''),
      tools: modelTools(svc),
      history: [
        {
          id: 0,
          threadId: 0,
          role: 'user',
          parts: [
            { t: 'text', text: '测试连接：请只回复「OK」，不要调用工具。' },
          ],
          raw: null,
          ui: null,
          compacted: false,
          createdAt: '',
        },
      ],
      cache: svc.cache === 'auto',
      effort: svc.effort,
      cacheKey: await installId(core.db),
    });
    try {
      const r = await callModel(svc, key, req, {
        fetchImpl: deps.fetch,
        timeoutMs: 60_000,
      });
      const u = r.parsed.usage;
      lines.push(
        '延迟 ' + (r.latencyMs / 1000).toFixed(1) + ' 秒',
        '返回的模型：' + (r.parsed.model ?? '（服务没有返回）'),
        u.cacheReported
          ? '报告了缓存数据：读 ' +
              u.cacheRead +
              '、写 ' +
              u.cacheWrite +
              ' tokens'
          : svc.cache === 'off'
          ? '缓存参数已关闭'
          : '该服务没有报告缓存数据',
        '输入 ' + u.input + '、输出 ' + u.output + ' tokens',
      );
      return { ok: true, text: '连接成功', service: svc, lines };
    } catch (e) {
      if (
        e instanceof AiError &&
        e.compat === 'cache' &&
        svc.cache === 'auto'
      ) {
        svc = { ...svc, cache: 'off' };
        lines.push('服务不认缓存参数，已改成「关闭」');
        continue;
      }
      if (
        e instanceof AiError &&
        e.compat === 'effort' &&
        svc.effort !== 'off' &&
        (!svc.capabilities || svc.capabilities.thinking?.includes('off'))
      ) {
        svc = { ...svc, effort: 'off' };
        lines.push('服务不认思考强度参数，已改成「不发送」');
        continue;
      }
      return {
        ok: false,
        text: e instanceof Error ? e.message : String(e),
        service: svc,
        lines,
      };
    }
  }
  return { ok: false, text: '试了 3 次都不行', service: svc, lines };
}
