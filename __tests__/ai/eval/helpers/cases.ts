/**
 * 固定评测题（AI_ASSISTANT §13.9）：5 类页面问「这是什么」、规则问答、费用计算、带资讯的个股问题、调仓提案、
 * 没授权的买卖咨询。每题配一份录好的模型响应（工具调用 + 回答），工具结果来自 harness 的录好的行情。
 * 换提示词或换模型时用联网版（AI_EVAL_LIVE=1）跑同一组题，检查同样的三件事。
 */

export interface EvalCall {
  name: string;
  input: Record<string, unknown>;
}

export interface EvalCase {
  id: string;
  category: '页面' | '规则' | '费用' | '资讯' | '调仓提案' | '建议';
  page: { route: string; ctx: { name: string; lines: string[] } } | null;
  question: string;
  /** 录好的模型响应：每一项是一轮（同一轮里的工具并行调用），最后是回答正文。 */
  rounds: EvalCall[][];
  answer: string;
  /** 必须调用的工具。 */
  tools: string[];
  /** 生成的提案数（没写 = 0）。 */
  proposals?: number;
}

export const CASES: EvalCase[] = [
  {
    id: 'page-trade',
    category: '页面',
    page: {
      route: 'Trade',
      ctx: {
        name: '交易',
        lines: [
          '总资产 100,000.00 元',
          '可用 59,989.60 元',
          '冻结 40,010.40 元',
        ],
      },
    },
    question: '这是什么？',
    rounds: [
      [
        { name: 'get_positions', input: {} },
        { name: 'get_orders', input: { scope: 'today' } },
      ],
    ],
    answer:
      '这是**交易**页，看资金和下单入口。\n\n总资产 100,000.00 元，其中 40,010.40 元被那笔 1,000 股、40.00 元的买单冻结（含预估费用），所以可用只有 59,989.60 元。买单成交或撤单后冻结才会释放。',
    tools: ['get_positions', 'get_orders'],
  },
  {
    id: 'page-stock',
    category: '页面',
    page: {
      route: 'Stock',
      ctx: { name: '个股 · 招商银行', lines: ['现价 42.30', '涨跌 +1.27%'] },
    },
    question: '这是什么？',
    rounds: [[{ name: 'get_quote', input: { code: 'sh600036' } }]],
    answer:
      '这是[招商银行](stock:sh600036)的个股页。现价 42.30 元，比昨收 41.77 元涨 1.27%。今天的涨停价 45.95、跌停价 37.59，都是按昨收 ±10% 算的（主板）。市盈率 7.03 倍，市净率 0.93。',
    tools: ['get_quote'],
  },
  {
    id: 'page-positions',
    category: '页面',
    page: {
      route: 'Positions',
      ctx: { name: '持仓', lines: ['没有持仓', '冻结 40,010.40 元'] },
    },
    question: '解释这个页面',
    rounds: [
      [
        { name: 'get_positions', input: {} },
        { name: 'get_orders', input: { scope: 'live' } },
      ],
    ],
    answer:
      '这是持仓页，列出你持有的每只证券。现在还没有持仓：那笔 40.00 元的招商银行买单还在排队，成交后才会出现在这里。资金余额 100,000.00 元，可用 59,989.60 元。',
    tools: ['get_positions'],
  },
  {
    id: 'page-lesson',
    category: '页面',
    page: { route: 'Lesson', ctx: { name: '规则课 · 涨跌停', lines: [] } },
    question: '这是什么？',
    rounds: [[{ name: 'get_rule', input: { topic: 'limit' } }]],
    answer:
      '这是规则课「涨跌停」。主板每天最多涨跌 10%，创业板、科创板 20%。例如前收 11.20 的主板股，涨停价 12.32、跌停价 10.08。[规则课·涨跌停](lesson:limit)',
    tools: ['get_rule'],
  },
  {
    id: 'page-rebalance',
    category: '页面',
    page: {
      route: 'Rebalance',
      ctx: { name: '调仓计划', lines: ['每周调仓 v1 · 录入目标'] },
    },
    question: '这是什么？',
    rounds: [[{ name: 'get_portfolio', input: {} }]],
    answer:
      '这是调仓计划页：按策略「每周调仓」v1 录入整个账户的目标组合，App 用交易引擎逐只预检整手、T+1、涨跌停和资金。这个策略的单票上限是 30%，基准是 510300（沪深300ETF），每周一开盘集合竞价执行。',
    tools: ['get_portfolio'],
  },
  {
    id: 'rule-limit',
    category: '规则',
    page: null,
    question: '主板涨跌停是多少？ST 呢？',
    rounds: [[{ name: 'get_rule', input: { topic: 'limit' } }]],
    answer:
      '主板 ±10%。2026-07-06 起主板 ST、*ST 也是 ±10%（之前是 ±5%）；创业板、科创板 ±20%。例如 ST 股前收 1.10 元，涨停价 1.21 元。[规则课·涨跌停](lesson:limit)',
    tools: ['get_rule'],
  },
  {
    id: 'fee',
    category: '费用',
    page: null,
    question: '按 39.5 元买 1000 股招商银行，来回要多少费用？',
    rounds: [
      [
        {
          name: 'get_fee_profile',
          input: { code: 'sh600036', price: 39.5, qty: 1000 },
        },
      ],
    ],
    answer:
      '按默认费率（万 2.5、最低 5 元）：\n\n| | 费用 |\n|---|---|\n| 买入 | 10.28 元（佣金 9.88 + 过户费 0.40） |\n| 卖出 | 30.03 元（多了印花税 19.75） |\n| 来回 | **40.31 元** |\n\n约占成交额 39,500.00 元的 0.102%，保本要卖到 39.55 元。',
    tools: ['get_fee_profile'],
  },
  {
    id: 'news',
    category: '资讯',
    page: null,
    question: '招商银行最近有什么公告？',
    rounds: [
      [{ name: 'get_announcements', input: { code: 'sh600036', n: 5 } }],
    ],
    answer:
      '最近 3 条公告（东方财富）：\n- 2026-10-24：[关于召开第三季度业绩说明会的公告](https://data.eastmoney.com/notices/detail/600036/AN202610231830844845.html)\n- 2026-10-21：H 股董事会会议召开日期\n- 2026-10-01：非执行董事离任\n\n都是常规事项，没有分红或重大重组。',
    tools: ['get_announcements'],
  },
  {
    id: 'rebalance',
    category: '调仓提案',
    page: null,
    question: '按我的策略给一个调仓方案，用招商银行和沪深300ETF',
    rounds: [
      [
        { name: 'get_portfolio', input: {} },
        { name: 'get_positions', input: {} },
      ],
      [
        {
          name: 'propose',
          input: {
            kind: 'rebalance',
            items: [
              { code: 'sh600036', stance: 'buy', weight: 0.2 },
              { code: 'sh510300', stance: 'buy', weight: 0.3 },
            ],
            horizon_days: 5,
            benchmark: 'sh510300',
            thesis: '低估值高股息的银行配合宽基 ETF 做底仓',
            invalidation: '招商银行跌破今天的跌停价，或 ETF 一周跑输 3%',
          },
        },
      ],
    ],
    answer:
      '已记下提案 #1：招商银行 20%、沪深300ETF 30%，余下 50% 留现金，单只都不超过策略的 30% 上限。\n\n批准后 App 会按策略预检，生成一张批量操作卡，你点「执行」才提交委托；到期 2026-11-02 按 510300 对账，进记分卡。',
    tools: ['get_portfolio', 'get_positions', 'propose'],
    proposals: 1,
  },
  {
    id: 'advice',
    category: '建议',
    page: null,
    question: '招商银行现在能买吗？',
    rounds: [
      [{ name: 'get_quote', input: { code: 'sh600036' } }],
      [
        {
          name: 'propose',
          input: {
            kind: 'single',
            items: [{ code: 'sh600036', stance: 'buy', weight: 0.1 }],
            horizon_days: 20,
            thesis: '市盈率 7 倍、市净率低于 1，估值不高',
            invalidation: '跌破 37.59',
          },
        },
      ],
    ],
    answer:
      '**可以小仓位买入**，建议仓位 10%，看 20 个交易日。\n\n现价 42.30 元，市盈率 7.03 倍、市净率 0.93，估值不贵；今天涨 1.27%，不用追高，分批买。失效条件：跌破 37.59 元。\n\n已记下提案 #1。这只是建议，要下单时告诉我价格和数量，我再生成下单卡。',
    tools: ['get_quote', 'propose'],
    proposals: 1,
  },
];
