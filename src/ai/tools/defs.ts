/**
 * AI 的工具（AI_ASSISTANT.md §8、§13.2）：27 个，按名字排序，任何设置下都不增减（工具列表变了缓存就失效）。
 * 读取类直接执行；记忆类按记忆模式执行；操作 App 的除 navigate 外都只生成操作卡。
 * 外部工具（MCP）打开时另加 mcp_search / mcp_call 两个（mcp.ts），按对话开关。
 */
import { ANN_TYPES } from '../../market/emNews';
import type { ToolDef } from '../protocol';

const CODE = {
  type: 'string',
  description:
    '证券代码，带或不带交易所前缀都行（sh600036 / 600036 / 510300），也可以是名称（招商银行）',
};

const AS_OF = {
  type: 'string',
  description:
    '截止日期 YYYY-MM-DD，只返回这天及以前发布的（复盘过去某天时用，避免用到当时还不知道的消息）；不给 = 今天',
};

const obj = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

/** navigate 能去的页面和参数（也是界面上「打开 xx」的名字）。 */
export const NAV_ROUTES: Record<string, { label: string; params: string }> = {
  Watch: { label: '自选', params: '' },
  Market: { label: '行情', params: '' },
  Trade: { label: '交易', params: '' },
  Learn: { label: '学习', params: '' },
  Me: { label: '我的', params: '' },
  Stock: { label: '个股详情', params: 'code' },
  Search: { label: '搜索', params: '' },
  WatchEdit: { label: '编辑自选', params: '' },
  Order: {
    label: '下单',
    params:
      'side（B 买入 / S 卖出 / C 撤单 / P 持仓），code，price（元），qty，kind（limit / after / 市价类型）',
  },
  Positions: { label: '持仓', params: '' },
  Position: { label: '持仓详情', params: 'code' },
  Orders: {
    label: '查询',
    params:
      'tab（today 当日委托 / fills 当日成交 / hist 历史委托 / ledger 交割单）',
  },
  OrderDetail: { label: '委托详情', params: 'id（委托 id）' },
  FillDetail: { label: '成交详情', params: 'id（成交 id）' },
  Transfer: { label: '银证转账', params: 'dir（in / out），amount（元）' },
  Flows: { label: '资金流水', params: '' },
  Fees: { label: '费率设置', params: '' },
  Calibrate: { label: '交割单校准', params: '' },
  Settings: { label: '设置', params: '' },
  PowerGuide: { label: '后台跟踪与省电', params: '' },
  Accounts: { label: '历史账户', params: '' },
  Stage: { label: '学习阶段', params: 'no（0 / 1 / 2 / 3 / 7）' },
  Lessons: { label: '规则课', params: '' },
  Lesson: { label: '规则课详情', params: 'id（课的 id）' },
  FeeCalc: { label: '费用计算器', params: 'code，price（元），qty' },
  Auction: { label: '集合竞价演示', params: '' },
  Analysis: { label: '账户分析', params: '' },
  DataLab: { label: '数据练习', params: '' },
  AiMemory: { label: 'AI 记忆', params: '' },
  AiServices: { label: '供应商与模型', params: '' },
  AiMcp: { label: '外部工具（MCP）', params: '' },
};

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'cancel_order',
    description:
      '撤单：生成操作卡，用户点「执行」才撤。order_id 用 get_orders 查到的委托 id。',
    schema: obj({ order_id: { type: 'integer' } }, ['order_id']),
  },
  {
    name: 'forget',
    description: '删除一条长期记忆（id 见 <memory> 或 remember 的结果）。',
    schema: obj({ id: { type: 'integer' } }, ['id']),
  },
  {
    name: 'get_activity',
    description:
      '查更早的操作记录（当前账户），从新到旧。kinds 可选 view order reject cancel fill transfer setting learn export system ai。',
    schema: obj({
      n: { type: 'integer', description: '条数，默认 20，最多 100' },
      kinds: { type: 'array', items: { type: 'string' } },
    }),
  },
  {
    name: 'get_announcements',
    description:
      '公司公告列表（东方财富，从新到旧）：日期、分类、标题、art_code、链接。type 按大类筛：all 全部 / report 财务报告（年报季报、业绩预告、分红实施）/ financing 融资 / risk 风险提示（停牌、异常波动）/ info 信息变更 / major 重大事项 / restructure 资产重组 / holding 持股变动（增减持）。ETF、指数没有公告。',
    schema: obj(
      {
        code: CODE,
        n: { type: 'integer', description: '条数，默认 20，最多 50' },
        type: { type: 'string', enum: Object.keys(ANN_TYPES) },
        as_of: AS_OF,
      },
      ['code'],
    ),
  },
  {
    name: 'get_company_profile',
    description:
      '公司简况：全称、行业、主营业务、简介、成立和上市日期（东方财富 F10）。ETF 没有。',
    schema: obj({ code: CODE }, ['code']),
  },
  {
    name: 'get_fee_profile',
    description:
      '当前费率设置：股票 / ETF 佣金率和最低佣金、规费是否另收、是否已用交割单校准，以及印花税、过户费等法定费用。',
    schema: obj({}),
  },
  {
    name: 'get_financials',
    description:
      '最近几期主要财务指标：营收、归母净利润（含同比）、每股收益、ROE、毛利率（东方财富）。报告期是累计值。',
    schema: obj(
      {
        code: CODE,
        periods: { type: 'integer', description: '期数，默认 4，最多 8' },
      },
      ['code'],
    ),
  },
  {
    name: 'get_kline',
    description:
      'K 线，CSV 格式。period：day / week / month（前复权）、m15 / m30 / m60（分钟线，不复权，最多约 50 个交易日）、minute（当日分时，每分钟价格和成交量）。',
    schema: obj(
      {
        code: CODE,
        period: {
          type: 'string',
          enum: ['day', 'week', 'month', 'm15', 'm30', 'm60', 'minute'],
        },
        n: { type: 'integer', description: '根数，默认 60，最多 300' },
      },
      ['code', 'period'],
    ),
  },
  {
    name: 'get_learning',
    description:
      '学习进度：路线图各阶段完成情况、规则课通过情况、自动打勾的项还差什么。',
    schema: obj({}),
  },
  {
    name: 'get_orders',
    description:
      '委托：scope = today 当日委托 / live 未完成 / all 全部（最近的在前）。含委托 id、合同号、状态、成交数量、废单或撤单原因、当前说明。',
    schema: obj({
      scope: { type: 'string', enum: ['today', 'live', 'all'] },
      n: { type: 'integer', description: '条数，默认 20，最多 100' },
    }),
  },
  {
    name: 'get_positions',
    description:
      '账户概览（总资产、市值、资金余额、可用、可取、冻结、累计净入金）和持仓（数量、可卖、今日买入、摊薄成本价和买入均价、现价、市值、浮动盈亏）。',
    schema: obj({}),
  },
  {
    name: 'get_quote',
    description:
      '实时行情：现价、涨跌、开高低、昨收、涨跌停价、成交量额、换手率、市盈率、市净率、市值、五档盘口、所属板块。',
    schema: obj({ code: CODE }, ['code']),
  },
  {
    name: 'get_research',
    description:
      '个股研报（东方财富，近 2 年，从新到旧）：发布日期、机构、评级、标题、对今年起 3 个年度的 EPS 和 PE 预测、链接。看机构观点和盈利预测时用。',
    schema: obj(
      {
        code: CODE,
        n: { type: 'integer', description: '篇数，默认 10，最多 30' },
        as_of: AS_OF,
      },
      ['code'],
    ),
  },
  {
    name: 'get_rule',
    description:
      '交易规则：topic 给规则课 id 或关键词（如 fee、价格笼子），返回规则课讲解和小测答案要点；code 给证券代码，返回这只证券的规则卡（板块、涨跌幅、申报单位、价格笼子、现在能否撤单、可卖数量）。都不给时返回规则课列表。',
    schema: obj({ topic: { type: 'string' }, code: CODE }),
  },
  {
    name: 'get_trades',
    description:
      '成交和交割单（含逐项费用：佣金、印花税、过户费、经手费、证管费、红利税）。from / to 是 YYYY-MM-DD，不给时返回最近 20 条。',
    schema: obj({
      from: { type: 'string' },
      to: { type: 'string' },
    }),
  },
  {
    name: 'navigate',
    description:
      '回答结束后打开 App 的某个页面，可以带参数把表单填好（只是填好，不会提交）。route 和 params：' +
      Object.entries(NAV_ROUTES)
        .map(
          ([r, v]) =>
            r + ' ' + v.label + (v.params ? '（' + v.params + '）' : ''),
        )
        .join('；'),
    schema: obj(
      {
        route: { type: 'string', enum: Object.keys(NAV_ROUTES) },
        params: { type: 'object' },
      },
      ['route'],
    ),
  },
  {
    name: 'place_order',
    description:
      '下单：生成操作卡（就是委托确认），用户点「执行」才提交。只用用户说出的参数。side B 买 / S 卖；kind 默认 limit，市价单沪市 b5_ioc / b5_limit（要 protect 保护限价），深市 b5_ioc / cbest / obest / ioc / fok，盘后 after；price 元（限价单必填）；qty 股 / 份。',
    schema: obj(
      {
        code: CODE,
        side: { type: 'string', enum: ['B', 'S'] },
        kind: {
          type: 'string',
          enum: [
            'limit',
            'b5_ioc',
            'b5_limit',
            'cbest',
            'obest',
            'ioc',
            'fok',
            'after',
          ],
        },
        price: { type: 'number' },
        qty: { type: 'integer' },
        protect: { type: 'number', description: '沪市市价单的保护限价（元）' },
      },
      ['code', 'side', 'qty'],
    ),
  },
  {
    name: 'read_announcement',
    description:
      '读一条公告的正文（纯文本，按页，每页约 5,000 字）。art_code 用 get_announcements 查到的。年报、半年报全文只有 PDF 链接，改读摘要。',
    schema: obj(
      {
        art_code: { type: 'string' },
        page: { type: 'integer', description: '第几页，默认 1' },
        as_of: AS_OF,
      },
      ['art_code'],
    ),
  },
  {
    name: 'remember',
    description:
      '记住一条关于用户的长期信息（背景、偏好、计划、约定）。不要记持仓、成交、资金、费率、行情。',
    schema: obj(
      {
        text: { type: 'string' },
        kind: {
          type: 'string',
          enum: ['background', 'preference', 'plan', 'agreement'],
        },
      },
      ['text', 'kind'],
    ),
  },
  {
    name: 'reset_account',
    description: '重置模拟账户：生成操作卡。旧账户归档，新账户从 0 元开始。',
    schema: obj({}),
  },
  {
    name: 'search_conversations',
    description: '在其他对话的标题、摘要和消息里检索关键词。',
    schema: obj({ query: { type: 'string' } }, ['query']),
  },
  {
    name: 'search_news',
    description:
      '搜财经新闻（东方财富）：时间、媒体、标题、摘要、链接。keyword 写公司名、行业或事件（例如「招商银行 分红」）。行业动态、政策解读这类再用联网搜索补。',
    schema: obj(
      {
        keyword: { type: 'string' },
        n: { type: 'integer', description: '条数，默认 10，最多 20' },
        as_of: AS_OF,
      },
      ['keyword'],
    ),
  },
  {
    name: 'set_fee_profile',
    description:
      '改费率设置：生成操作卡，只对之后提交的委托生效。只填要改的项：stock_rate / etf_rate 是万分之几（2.5 = 万 2.5），stock_min / etf_min 是最低佣金（元，免五填 0），regs_separate 规费另收，merge_order 同一委托合并计佣。',
    schema: obj({
      stock_rate: { type: 'number' },
      stock_min: { type: 'number' },
      etf_rate: { type: 'number' },
      etf_min: { type: 'number' },
      regs_separate: { type: 'boolean' },
      merge_order: { type: 'boolean' },
    }),
  },
  {
    name: 'set_learn_check',
    description:
      '勾选或取消路线图里的手动项（item_id 见 get_learning）：生成操作卡。自动项、规则课小测、集合竞价演示不能代做。',
    schema: obj({ item_id: { type: 'string' }, done: { type: 'boolean' } }, [
      'item_id',
      'done',
    ]),
  },
  {
    name: 'set_settings',
    description:
      '改设置：生成操作卡。cost_basis diluted 摊薄成本 / average 买入均价；background_mode orders 有委托时自动 / session 交易时段全程 / off；background_interval 秒（3 / 5 / 10 / 30）；snapshot_keep 交易日（20 / 60，0 = 永久）；deposit_cap 累计净入金上限（元）。',
    schema: obj({
      cost_basis: { type: 'string', enum: ['diluted', 'average'] },
      background_mode: { type: 'string', enum: ['orders', 'session', 'off'] },
      background_interval: { type: 'integer' },
      snapshot_keep: { type: 'integer' },
      deposit_cap: { type: 'number' },
    }),
  },
  {
    name: 'set_watchlist',
    description: '加入或移出自选：生成操作卡。',
    schema: obj({
      add: { type: 'array', items: CODE },
      remove: { type: 'array', items: CODE },
    }),
  },
  {
    name: 'transfer',
    description:
      '银证转账（模拟入金 / 出金）：生成操作卡。direction in 银行转证券 / out 证券转银行，amount 元。交易日 9:00–16:00 才能转。',
    schema: obj(
      {
        direction: { type: 'string', enum: ['in', 'out'] },
        amount: { type: 'number' },
      },
      ['direction', 'amount'],
    ),
  },
];

/** 生成操作卡的工具。 */
export const CARD_TOOLS = new Set([
  'cancel_order',
  'place_order',
  'reset_account',
  'set_fee_profile',
  'set_learn_check',
  'set_settings',
  'set_watchlist',
  'transfer',
]);
