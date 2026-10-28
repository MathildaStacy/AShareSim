/**
 * 外部工具（MCP，AI_ASSISTANT §13.4）：App 自己当 MCP 客户端，用 Streamable HTTP 传输
 * （HTTP POST，响应是 JSON 或 SSE）：initialize → notifications/initialized → tools/list → tools/call。
 *
 * - 配置存在 settings 表（mcpServers），token 存 Keystore，界面和日志里只显示末 4 位。
 *   Tushare 实测（2026-10-27）：`https://api.tushare.pro/mcp/`，token 放 `Authorization: Bearer`
 *   （文档里写在 URL 路径的形式会返回 missing_token），无状态，响应是 SSE。
 * - 模型看到的不是每个外部工具，而是两个固定的工具：mcp_search（按关键词找工具，返回参数说明）和
 *   mcp_call（调用）。Tushare 一家就有 258 个工具、约 300 KB 的参数定义，全发既贵又挤占上下文；
 *   两个固定工具让工具列表只在打开 / 关闭外部工具时变一次，缓存不受接入了哪些服务影响。
 * - 只读优先：显式写操作和破坏性标记优先拦截；其余按只读标记、读取名称或 Tushare 查询目录判断，
 *   无法确认只读的工具不能启用（App 里目前没有需要改外部数据的场景）。
 * - 结果是外部文本，包在 <external> 里（§13.3），太长截断并告诉模型。
 */
import * as Keychain from 'react-native-keychain';
import type { Db } from '../data/db';
import * as repo from '../data/repos';
import { beijingNow } from '../market/clock';
import { external } from './external';
import type { ToolDef } from './protocol';

export interface McpTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  readOnly: boolean;
  /** 用户启用了没有（会改东西的工具不能启用）。 */
  enabled: boolean;
}

export interface McpServer {
  id: string;
  name: string;
  /** 工具名前缀（tushare__index_weight），只用小写字母和数字。 */
  slug: string;
  url: string;
  /** token 末 4 位；空 = 没有 token。token 本身在 Keystore。 */
  tokenTail: string;
  enabled: boolean;
  tools: McpTool[];
  /** 服务端的说明（initialize 返回的 instructions）。 */
  instructions?: string;
  fetchedAt?: string;
}

export const MCP_PRESETS: Record<
  string,
  { name: string; slug: string; url: string; tokenHint: string; site: string }
> = {
  tushare: {
    name: 'Tushare',
    slug: 'tushare',
    url: 'https://api.tushare.pro/mcp/',
    tokenHint: '在 tushare.pro 个人主页「接口 TOKEN」复制',
    site: 'https://tushare.pro',
  },
};

// ---------- 依赖（测试里替换） ----------

export interface McpTokenStore {
  get(id: string): Promise<string | null>;
  set(id: string, token: string): Promise<void>;
  remove(id: string): Promise<void>;
}

const keychainService = (id: string) => 'asharesim.mcp.' + id;

export const keychainTokens: McpTokenStore = {
  async get(id) {
    const r = await Keychain.getGenericPassword({
      service: keychainService(id),
    });
    return r ? r.password : null;
  },
  async set(id, token) {
    await Keychain.setGenericPassword('mcp-token', token, {
      service: keychainService(id),
      storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
    });
  },
  async remove(id) {
    await Keychain.resetGenericPassword({ service: keychainService(id) });
  },
};

export type McpFetch = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

const deps: { tokens: McpTokenStore; fetch: McpFetch } = {
  tokens: keychainTokens,
  fetch: (url, init) => fetch(url, init),
};

export function setMcpDeps(d: Partial<typeof deps>): void {
  Object.assign(deps, d);
}

export const mcpTokens = () => deps.tokens;

// ---------- 配置 ----------

/** 每次提问都要读（几百个工具定义），按数据库缓存在内存里。 */
const cache = new WeakMap<Db, McpServer[]>();

export async function loadMcpServers(db: Db): Promise<McpServer[]> {
  let servers = cache.get(db);
  if (!servers) {
    servers = await repo.getSetting<McpServer[]>(db, 'mcpServers', []);
    cache.set(db, servers);
  }
  return servers;
}

export async function saveMcpServers(
  db: Db,
  servers: McpServer[],
): Promise<void> {
  servers.forEach(s => validateMcpUrl(s.url));
  await repo.setSetting(db, 'mcpServers', servers);
  cache.set(db, servers);
  sessions.clear();
}

/** 至少有一个启用的服务、启用了至少一个工具：对话里才显示「外部工具」开关。 */
export const mcpReady = (servers: McpServer[]) =>
  servers.some(s => s.enabled && s.tools.some(t => t.enabled && t.readOnly));

export function slugOf(name: string, taken: string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 16) || 'mcp';
  let slug = base,
    i = 2;
  while (taken.includes(slug)) {
    slug = base + i++;
  }
  return slug;
}

export const newMcpId = () =>
  'mcp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** 认证参数可能采用大小写、下划线或百分号编码；显示与保存共用同一规则。 */
const SECRET_ASSIGNMENT =
  /([?&/])((?:key|api[_-]?key|token|access[_-]?token|refresh[_-]?token|auth|authorization|password|passwd|secret|client[_-]?secret|credential|signature|jwt|bearer))=([^&#]*)/gi;
function decodedUrl(url: string): string {
  let decoded = url.trim();
  for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(decoded); i++) {
    const next = decodeURIComponent(decoded);
    if (next === decoded) {
      break;
    }
    decoded = next;
  }
  return decoded;
}
function redactUrlCredentials(url: string): string {
  return url
    .replace(/(https?:\/\/)[^/?#]*@/i, '$1••••@')
    .replace(SECRET_ASSIGNMENT, '$1$2=••••')
    .replace(/#.*$/, '#••••');
}
export function displayUrl(url: string): string {
  try {
    const raw = url.trim();
    const decoded = decodedUrl(raw);
    return redactUrlCredentials(raw) !== raw ||
      redactUrlCredentials(decoded) !== decoded
      ? '（含认证信息或片段的地址已隐藏）'
      : raw;
  } catch {
    return '（地址编码不完整）';
  }
}

/** URL 是普通配置，认证信息必须放进单独的 token 安全存储。 */
export function validateMcpUrl(url: string): void {
  if (!/^https?:\/\/[^/?#\s]+(?:[/?#]\S*)?$/i.test(url.trim())) {
    throw new McpError('地址要以 http:// 或 https:// 开头');
  }
  let decoded: string;
  try {
    decoded = decodedUrl(url);
  } catch {
    throw new McpError('地址编码不完整，请检查百分号编码');
  }
  if (
    redactUrlCredentials(url.trim()) !== url.trim() ||
    redactUrlCredentials(decoded) !== decoded
  ) {
    throw new McpError('地址不能包含认证信息或片段，请把密钥填在 token 栏');
  }
}

/** 服务身份取决于端点，不取决于用户为工具分配的唯一前缀。 */
export const isTushareUrl = (url: string) =>
  /^https:\/\/api\.tushare\.pro(?::443)?\/mcp\/?$/i.test(url.trim());

// ---------- 只读判断 ----------

const WRITE_NAME =
  /(^|[_.-])(delete|del|remove|add|create|update|save|set|insert|write|put|post|send|cancel|submit|order|buy|sell|transfer|modify|edit)([_.-]|$)/i;
const WRITE_DESC = /删除|新增|添加|创建|修改|保存|下单|撤单|转账|写入|提交/;

export function isReadOnly(
  t: {
    name: string;
    description?: string;
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  },
  trustedTushare = false,
): boolean {
  const a = t.annotations ?? {};
  if (
    a.readOnlyHint === false ||
    a.destructiveHint === true ||
    WRITE_NAME.test(
      t.name
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2'),
    ) ||
    WRITE_DESC.test(t.description ?? '')
  ) {
    return false;
  }
  return (
    a.readOnlyHint === true ||
    /^(get|list|search|query|read|fetch)([_.-]|[A-Z])/.test(t.name) ||
    /^p_get$/.test(t.name) ||
    (trustedTushare && /^(?:\/?数据接口\/|获取|查询)/.test(t.description ?? ''))
  );
}

// ---------- 传输 ----------

export class McpError extends Error {}

const PROTOCOL_VERSION = '2025-06-18';
const TIMEOUT_MS = 30_000;

interface Session {
  id: string | null;
  version: string;
}
const sessions = new Map<string, Session>();
let rpcId = 0;

/** SSE 或 JSON 响应 → 对应 id 的 JSON-RPC 消息。 */
export function parseRpcResponse(
  text: string,
  contentType: string,
  id: number,
): any {
  const msgs: any[] = [];
  if (/event-stream/i.test(contentType)) {
    // 一个事件可以有多行 data:，空行结束
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter(l => l.startsWith('data:'))
        .map(l => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) {
        try {
          msgs.push(JSON.parse(data));
        } catch {
          // 不是 JSON 的事件（心跳之类）跳过
        }
      }
    }
  } else {
    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      throw new McpError('服务返回的不是 JSON');
    }
    msgs.push(...(Array.isArray(j) ? j : [j]));
  }
  const m = msgs.find(x => x && x.id === id);
  if (!m) {
    throw new McpError('服务没有返回这次请求的结果');
  }
  if (m.error) {
    throw new McpError(
      'MCP 错误' +
        (m.error.code != null ? ' ' + m.error.code : '') +
        '：' +
        String(m.error.message ?? ''),
    );
  }
  return m.result;
}

const redactToken = (s: string, token: string) =>
  token ? s.split(token).join('••••') : s;

async function post(
  server: Pick<McpServer, 'id' | 'url'>,
  token: string,
  session: Session | null,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ result: any; sessionId: string | null }> {
  validateMcpUrl(server.url);
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  if (signal?.aborted) {
    throw new McpError('已停止');
  }
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const id = 'id' in body ? (body.id as number) : -1;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (token) {
      headers.Authorization = 'Bearer ' + token;
    }
    if (session) {
      headers['MCP-Protocol-Version'] = session.version;
      if (session.id) {
        headers['Mcp-Session-Id'] = session.id;
      }
    }
    const res = await deps.fetch(server.url.trim(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', ...body }),
      signal: ctl.signal,
    });
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new McpError(
        token
          ? 'token 不对或没有权限（' + res.status + '）'
          : '这个服务需要 token',
      );
    }
    if (res.status === 404 && session?.id) {
      throw new SessionExpired();
    }
    if (res.status < 200 || res.status >= 300) {
      throw new McpError(
        '服务返回 ' +
          res.status +
          '：' +
          redactToken(text, token).slice(0, 200),
      );
    }
    return {
      result:
        id < 0
          ? null
          : parseRpcResponse(text, res.headers.get('content-type') ?? '', id),
      sessionId: res.headers.get('mcp-session-id'),
    };
  } catch (e) {
    if (e instanceof McpError) {
      e.message = redactToken(e.message, token);
      throw e;
    }
    if (signal?.aborted) {
      throw new McpError('已停止');
    }
    if (ctl.signal.aborted) {
      throw new McpError('外部工具超时（30 秒）');
    }
    throw new McpError(
      redactToken(e instanceof Error ? e.message : String(e), token),
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

class SessionExpired extends McpError {}

async function initialize(
  server: Pick<McpServer, 'id' | 'url'>,
  token: string,
  signal?: AbortSignal,
): Promise<{ session: Session; instructions?: string; serverName?: string }> {
  const r = await post(
    server,
    token,
    null,
    {
      id: ++rpcId,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'AShareSim', version: '0.4' },
      },
    },
    signal,
  );
  const session: Session = {
    id: r.sessionId,
    version: String(r.result?.protocolVersion ?? PROTOCOL_VERSION),
  };
  await post(
    server,
    token,
    session,
    { method: 'notifications/initialized' },
    signal,
  );
  return {
    session,
    instructions:
      typeof r.result?.instructions === 'string'
        ? r.result.instructions
        : undefined,
    serverName: r.result?.serverInfo?.name,
  };
}

/** 调一次方法；会话过期（404）时重新 initialize 再试一次。 */
async function rpc(
  server: Pick<McpServer, 'id' | 'url'>,
  method: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
  tokenOverride?: string,
): Promise<any> {
  const token = tokenOverride ?? (await deps.tokens.get(server.id)) ?? '';
  const sessionKey = JSON.stringify([server.id, server.url, token]);
  for (let attempt = 0; ; attempt++) {
    let s = sessions.get(sessionKey);
    if (!s) {
      s = (await initialize(server, token, signal)).session;
      sessions.set(sessionKey, s);
    }
    try {
      return (
        await post(server, token, s, { id: ++rpcId, method, params }, signal)
      ).result;
    } catch (e) {
      if (e instanceof SessionExpired && attempt === 0) {
        sessions.delete(sessionKey);
        continue;
      }
      throw e;
    }
  }
}

/**
 * 测试连接并获取工具列表（编辑页「连接并获取工具」）。保留之前的启用状态；
 * 新出现的只读工具默认启用，会改东西的不启用。
 */
export async function fetchMcpTools(
  server: Pick<McpServer, 'id' | 'url' | 'tools'>,
  token: string,
  signal?: AbortSignal,
): Promise<{ tools: McpTool[]; instructions?: string; serverName?: string }> {
  const sessionKey = JSON.stringify([server.id, server.url, token]);
  sessions.delete(sessionKey);
  const init = await initialize(server, token, signal);
  sessions.set(sessionKey, init.session);
  const before = new Map(server.tools.map(t => [t.name, t.enabled]));
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r = await rpc(
      server,
      'tools/list',
      cursor ? { cursor } : {},
      signal,
      token,
    );
    if (!Array.isArray(r?.tools)) {
      throw new McpError('tools/list 没有返回 tools');
    }
    for (const t of JSON.parse(redactToken(JSON.stringify(r.tools), token))) {
      if (typeof t?.name !== 'string') {
        continue;
      }
      const readOnly = isReadOnly(t, isTushareUrl(server.url));
      tools.push({
        name: t.name,
        description: typeof t.description === 'string' ? t.description : '',
        schema:
          t.inputSchema && typeof t.inputSchema === 'object'
            ? t.inputSchema
            : { type: 'object' },
        readOnly,
        enabled: readOnly && (before.get(t.name) ?? true),
      });
    }
    cursor = typeof r.nextCursor === 'string' ? r.nextCursor : undefined;
    if (!cursor) {
      break;
    }
  }
  return {
    tools,
    instructions: init.instructions
      ? redactToken(init.instructions, token)
      : undefined,
    serverName: init.serverName,
  };
}

/**
 * 预设服务的 token 检查：Tushare 的 tools/list 不校验 token，调一次很小的接口（交易日历）才知道对不对。
 * 返回 null 表示检查通过或这个服务没有检查方法。
 */
export async function probeMcp(
  server: Pick<McpServer, 'id' | 'url' | 'slug'>,
  token: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!isTushareUrl(server.url)) {
    return null;
  }
  const d = beijingNow().date.replace(/-/g, '');
  const r = await rpc(
    server,
    'tools/call',
    { name: 'trade_cal', arguments: { start_date: d, end_date: d } },
    signal,
    token,
  );
  if (r?.isError) {
    const text = Array.isArray(r.content)
      ? r.content.map((p: any) => String(p?.text ?? '')).join(' ')
      : '';
    return redactToken(text, token).slice(0, 200) || '调用失败';
  }
  return null;
}

// ---------- 给模型的两个工具 ----------

export const MCP_TOOL_DEFS: ToolDef[] = [
  {
    name: 'mcp_call',
    description:
      '调用一个外部数据工具（MCP）。tool 用 mcp_search 返回的完整名字（服务前缀__工具名），args 按它的参数说明填。返回外部数据，只读。',
    schema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: '例如 tushare__index_weight' },
        args: { type: 'object', description: '工具参数' },
      },
      required: ['tool'],
      additionalProperties: false,
    },
  },
  {
    name: 'mcp_search',
    description:
      '在用户接入的外部数据工具（MCP，例如 Tushare）里找工具：App 自带工具查不到的数据（指数成分和权重、三大报表明细、融资融券、龙虎榜、股东、宏观数据等）先用这个找。query 写要查的数据，返回最匹配的工具名、说明和参数；query 留空列出全部工具名。找到后用 mcp_call 调用。',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '例如「指数成分」「利润表」' },
        n: { type: 'integer', description: '返回几个，默认 5，最多 10' },
      },
      additionalProperties: false,
    },
  },
];

const fullName = (s: McpServer, t: McpTool) => s.slug + '__' + t.name;

/** 「/数据接口/沪深股票/基础数据/股票列表-获取…」→ 去掉开头的「/数据接口/」。 */
const shortDesc = (d: string) => d.replace(/^\/?数据接口\//, '');

function enabledTools(servers: McpServer[]) {
  return servers
    .filter(s => s.enabled)
    .flatMap(s =>
      s.tools
        .filter(t => t.enabled && t.readOnly)
        .map(t => ({ server: s, tool: t })),
    );
}

/** 关键词打分：整句命中、空格分开的每个词命中、中文双字命中；名字命中权重高。 */
export function scoreTool(t: McpTool, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) {
    return 0;
  }
  const name = t.name.toLowerCase(),
    desc = t.description.toLowerCase();
  let score = 0;
  if (name === q) {
    score += 20;
  }
  const terms = q.split(/[\s,，、;；]+/).filter(Boolean);
  for (const w of terms) {
    if (name.includes(w)) {
      score += 6;
    }
    if (desc.includes(w)) {
      score += 4;
    }
  }
  // 中文没有空格：按相邻两字再算一遍，「指数成份股」也能找到「指数成分和权重」
  const han = q.replace(/[^一-鿿]/g, '');
  for (let i = 0; i + 2 <= han.length; i++) {
    if (desc.includes(han.slice(i, i + 2))) {
      score += 1;
    }
  }
  return score;
}

/** 参数说明：紧凑的一行一个参数，太长截断。 */
function schemaText(schema: Record<string, unknown>): string {
  const props = (schema.properties ?? {}) as Record<string, any>;
  const req = new Set(
    Array.isArray(schema.required) ? (schema.required as string[]) : [],
  );
  const lines = Object.entries(props).map(([k, v]) => {
    const type =
      v?.type ??
      (Array.isArray(v?.anyOf)
        ? v.anyOf
            .map((x: any) => x?.type)
            .filter(Boolean)
            .join('|')
        : '');
    const enumText = Array.isArray(v?.enum)
      ? ' 可选 ' + v.enum.slice(0, 20).join('/')
      : '';
    const desc = String(v?.description ?? '').replace(/\s+/g, ' ');
    return (
      '  ' +
      k +
      (type ? '(' + type + ')' : '') +
      (req.has(k) ? ' 必填' : '') +
      (desc
        ? '：' + (desc.length > 900 ? desc.slice(0, 900) + '…' : desc)
        : '') +
      enumText
    );
  });
  return lines.length ? lines.join('\n') : '  （没有参数）';
}

/**
 * 不给 query 时的目录：按说明里的路径分类（「/数据接口/沪深股票/财务数据/利润表-…」→ 分类「沪深股票/财务数据」、
 * 简称「利润表」），一类一行。
 */
function catalog(all: { server: McpServer; tool: McpTool }[]): string[] {
  const groups = new Map<string, string[]>();
  for (const x of all) {
    const head = shortDesc(x.tool.description).split(/[-，。]/)[0];
    const path = head.includes('/') ? head.split('/') : [];
    const group =
      x.server.name +
      (path.length > 1 ? ' ' + path.slice(0, -1).join('/') : '');
    const short = (path.length ? path[path.length - 1] : head).slice(0, 14);
    const list = groups.get(group) ?? [];
    list.push(fullName(x.server, x.tool) + (short ? ' ' + short : ''));
    groups.set(group, list);
  }
  return [...groups].map(([g, list]) => g + '：' + list.join('；'));
}

export async function mcpSearch(
  db: Db,
  query: string,
  n: number,
): Promise<string> {
  const all = enabledTools(await loadMcpServers(db));
  if (!all.length) {
    return '还没有启用任何外部工具。用户可以在「AI → 外部工具（MCP）」里接入，例如 Tushare。';
  }
  if (!query.trim()) {
    return [
      '已启用的外部工具 ' +
        all.length +
        ' 个，按分类列出（名字 简称）。用 mcp_search(query) 看说明和参数：',
      external({ source: 'MCP 工具目录' }, catalog(all).join('\n')),
    ].join('\n');
  }
  const hits = all
    .map(x => ({ ...x, score: scoreTool(x.tool, query) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
  if (!hits.length) {
    return (
      '没有找到和「' +
      query +
      '」相关的外部工具。换个说法（例如「利润表」「指数成分」），或 query 留空看全部工具名。'
    );
  }
  return [
    '和「' + query + '」最相关的 ' + hits.length + ' 个外部工具：',
    external(
      { source: 'MCP 工具说明' },
      hits
        .map(
          x =>
            '\n' +
            fullName(x.server, x.tool) +
            '\n说明：' +
            shortDesc(x.tool.description) +
            '\n参数：\n' +
            schemaText(x.tool.schema),
        )
        .join('\n'),
    ),
  ].join('\n');
}

/** 一次结果最多给模型多少字（约 4k tokens）。 */
export const MCP_RESULT_CHARS = 8000;

export interface McpCallOutcome {
  output: string;
  label: string;
  error?: boolean;
}

export async function mcpCall(
  db: Db,
  toolName: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<McpCallOutcome> {
  const servers = await loadMcpServers(db);
  const m = /^([a-z0-9]+)__(.+)$/.exec(toolName.trim());
  const server = m ? servers.find(s => s.slug === m[1]) : undefined;
  const tool = server?.tools.find(t => t.name === m![2]);
  if (!server || !tool) {
    throw new Error(
      '没有外部工具「' + toolName + '」，先用 mcp_search 找到完整名字',
    );
  }
  if (!server.enabled || !tool.enabled || !tool.readOnly) {
    throw new Error(
      tool.readOnly
        ? '外部工具「' + toolName + '」被用户关掉了'
        : '「' + toolName + '」会改外部数据，App 不允许调用',
    );
  }
  const label = server.name + ' · ' + tool.name;
  const result = await rpc(
    server,
    'tools/call',
    {
      name: tool.name,
      arguments: args && typeof args === 'object' ? args : {},
    },
    signal,
  );
  const parts = Array.isArray(result?.content) ? result.content : [];
  let text = parts
    .map((p: any) =>
      p?.type === 'text'
        ? String(p.text ?? '')
        : p?.type === 'resource' && typeof p.resource?.text === 'string'
        ? p.resource.text
        : '[' + String(p?.type ?? '内容') + '，略]',
    )
    .join('\n')
    .trim();
  if (!text && result?.structuredContent != null) {
    text = JSON.stringify(result.structuredContent);
  }
  text = redactToken(text, (await deps.tokens.get(server.id)) ?? '');
  const cut = text.length > MCP_RESULT_CHARS;
  const body =
    (cut ? text.slice(0, MCP_RESULT_CHARS) : text) || '（工具没有返回内容）';
  return {
    label,
    error: result?.isError === true,
    output:
      (result?.isError ? '外部工具返回错误：\n' : '') +
      external(
        { source: server.name + '·' + tool.name, date: beijingNow().date },
        body,
      ) +
      (cut
        ? '\n结果太长，只给了前 ' +
          MCP_RESULT_CHARS +
          ' 字（共 ' +
          text.length +
          ' 字）。缩小日期范围、指定代码或用 fields 参数只取需要的字段。'
        : ''),
  };
}
