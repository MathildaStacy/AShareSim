/**
 * 量化学习路线（docs/research/quant-roadmap.html）里 App 覆盖的阶段 0 / 1 / 2 / 3 / 7，
 * 以及能用 App 数据判断的项怎么自动打勾（PRODUCT_DESIGN §6.4 的表）。纯逻辑，界面和 AI 共用。
 */
import type { AccountState, Fill, Order } from '../engine/types';
import { T } from '../engine/session';
import type { LearnCheck } from '../data/repos';

export interface StageItem {
  id: string;
  text: string;
  /** 由 App 判断，不能手动勾选。 */
  auto?: boolean;
  /** 等哪个里程碑才能自动判断（现在先手动勾）。 */
  later?: string;
}

/** 阶段用到的 App 工具：路由名 + 按钮文字。 */
export interface StageTool {
  route: string;
  label: string;
  params?: Record<string, unknown>;
}

export interface Stage {
  no: number;
  title: string;
  dur: string;
  goal: string;
  learn: string[];
  ex: StageItem[];
  pass: StageItem[];
  tools: StageTool[];
  note?: string;
}

export const STAGES: Stage[] = [
  {
    no: 0,
    title: '了解 A 股交易规则',
    dur: '1 到 2 周',
    goal: '了解你将来要交易的市场有哪些规则。',
    learn: [
      '基本交易规则：T+1、主板涨跌停 ±10%、最少买 100 股。',
      '交易时间：集合竞价 9:15 到 9:25（9:20 以后不能撤单）、连续竞价、收盘集合竞价。',
      '交易成本：印花税、过户费、佣金和「免五」、红利税的阶梯税率。',
      '指数体系：沪深300、中证500、中证800、中证1000 分别代表哪些股票，和主板、创业板、科创板是什么关系。',
    ],
    ex: [
      {
        id: 's0-e0',
        text: '在「费率设置」里填入你真实券商的佣金，并用一条真实交割单校准（开户以后做）',
        auto: true,
      },
      {
        id: 's0-e1',
        text: '用集合竞价买一手宽基 ETF，走一遍预埋单、按开盘价成交、查看交割单',
        auto: true,
      },
    ],
    pass: [
      {
        id: 's0-p0',
        text: '能说清一笔股票买卖要交哪些费用（完成「交易费用」小测）',
        auto: true,
      },
      {
        id: 's0-p1',
        text: '能解释为什么集合竞价的成交价就是开盘价（完成集合竞价演示）',
        auto: true,
      },
    ],
    tools: [
      { route: 'Lessons', label: '规则课' },
      { route: 'FeeCalc', label: '费用计算器' },
      { route: 'Auction', label: '集合竞价演示' },
    ],
    note: '路线图原文的练习是「开一个佣金约万分之一、带免五的账户」。你还没开户，App 先用默认费率；开户后用第一条真实交割单校准，这一项会自动打勾。',
  },
  {
    no: 1,
    title: 'Python 数据分析工具',
    dur: '2 到 4 周',
    goal: '熟练用 pandas 处理金融时间序列和截面数据。',
    learn: [
      'pandas 核心操作：索引、groupby、rolling、rank、shift、merge、多重索引。',
      '向量化写法：用整体运算代替 for 循环。做后端转过来，最需要改的就是这个习惯。',
      '用 matplotlib 画基本图表。',
      '工作方式：Jupyter 用来探索，.py 文件和 git 用来沉淀代码。',
    ],
    ex: [
      {
        id: 's1-e0',
        text: '用 App 导出的沪深300、中证800 日线，算每年收益率、年化波动率、最大回撤、滚动一年收益，并画净值曲线',
      },
      { id: 's1-e1', text: '把你自己的交割单 CSV 读进 pandas，按月汇总费用' },
    ],
    pass: [
      {
        id: 's1-p0',
        text: '不写 for 循环，10 行左右算出「每只股票过去 20 日收益在当天全市场的排名」',
      },
    ],
    tools: [{ route: 'DataLab', label: '数据练习与导出' }],
    note: 'Python 在电脑上写。App 给你干净的数据，并用同一份数据算出「标准答案」，方便核对。',
  },
  {
    no: 2,
    title: '统计和投资基础',
    dur: '2 到 4 周',
    goal: '理解收益、风险和「超额收益」这些概念到底在算什么。',
    learn: [
      '收益和风险指标：简单收益和对数收益、波动率、夏普比率、最大回撤。',
      '统计工具：相关性、线性回归、t 检验，以及多重检验问题：试的次数越多，越容易碰巧得到好结果。',
      '超额收益的拆解：beta 和 alpha、跟踪误差、信息比率。',
      '收益从哪里来：风险溢价和市场有效性。',
    ],
    ex: [
      {
        id: 's2-e0',
        text: '在「账户分析」里把你的模拟账户相对沪深300 拆成 beta 和 alpha，看懂每个数是怎么算的',
      },
      {
        id: 's2-e1',
        text: '找 2 到 3 只沪深300 指数增强基金，下载近 5 年净值，算每年超额、跟踪误差、信息比率、超额最大回撤（在电脑上做）',
      },
    ],
    pass: [
      { id: 's2-p0', text: '能把任意组合的收益拆成「基准收益加超额收益」' },
      { id: 's2-p1', text: '能判断这部分超额在统计上是不是显著' },
    ],
    tools: [{ route: 'Analysis', label: '账户分析' }],
    note: '可以和阶段 1 同时进行。',
  },
  {
    no: 3,
    title: '搭建本地数据库',
    dur: '2 到 3 周',
    goal: '一条命令就能把数据更新到最新，并且数据可信。这一阶段你的后端经验最有用。',
    learn: [
      '数据内容：股票列表（包括已退市的）、日线、复权因子、停复牌、ST、涨跌停价、带公告日期的财务数据、行业、指数成分。',
      '存储：parquet 文件或 DuckDB（App 里是 SQLite）。',
      '增量更新：只拉新增的数据。',
      '数据质量检查：价格缺失或跳变、复权是否连续、退市股票是否完整。',
    ],
    ex: [
      {
        id: 's3-e0',
        text: '看懂 App「数据中心」的每张表和每项检查，然后在电脑上写 update_data 命令和检查脚本',
      },
      {
        id: 's3-e1',
        text: '用它复现阶段 1 的指数年度收益，和腾讯、新浪接口交叉核对',
      },
    ],
    pass: [
      {
        id: 's3-p0',
        text: '任意一天都能回答：哪些股票在股票池里、哪些停牌、哪些开盘就是涨跌停价',
      },
      { id: 's3-p1', text: '任意一天只能看到当时已经公告的财务数据' },
    ],
    tools: [
      {
        route: 'Coming',
        label: '数据中心（M5）',
        params: { key: 'datacenter' },
      },
    ],
  },
  {
    no: 7,
    title: '模拟执行',
    dur: '3 个月',
    goal: '验证回测和真实执行流程能不能对得上。本 App 的保守撮合正好用来做这一步。',
    learn: [
      '周五晚上生成买卖清单。',
      '周末人工核对停牌、ST 和重大公告。',
      '周一按集合竞价规则成交（App 自动记录成交依据）。',
      '未成交的单子按固定规则补单。',
      '每笔模拟成交都记录下来。',
    ],
    ex: [
      { id: 's7-e0', text: '连续 12 周不间断执行', later: 'M5' },
      {
        id: 's7-e1',
        text: '用这 3 个月的真实行情重跑回测，和模拟记录逐周对比',
      },
    ],
    pass: [
      { id: 's7-p0', text: '连续 12 周没有漏执行', later: 'M5' },
      {
        id: 's7-p1',
        text: '模拟结果和同期回测重放的偏差能解释清楚，而且比较小',
      },
    ],
    tools: [
      { route: 'Coming', label: '模拟执行（M5）', params: { key: 'exec' } },
    ],
    note: '路线图原文：不用券商模拟盘，它的成交规则太宽松。这里提前做，是因为 App 本身就是一个按真实规则记录「假如成交」的工具。「连续 12 周」在 M5 模拟执行上线后自动判断，现在先手动勾。',
  },
];

export const stageItems = (st: Stage): StageItem[] => [...st.ex, ...st.pass];

export const ALL_ITEMS: StageItem[] = STAGES.flatMap(stageItems);

export const itemById = (id: string) => ALL_ITEMS.find(i => i.id === id);

export type Checks = Record<string, LearnCheck>;

export function stageProgress(
  st: Stage,
  checks: Checks,
): { done: number; total: number } {
  const items = stageItems(st);
  return {
    done: items.filter(i => checks[i.id]).length,
    total: items.length,
  };
}

/** 当前阶段：第一个没做完的阶段；都做完了就是最后一个。 */
export function currentStage(checks: Checks): Stage {
  return (
    STAGES.find(st => {
      const p = stageProgress(st, checks);
      return p.done < p.total;
    }) ?? STAGES[STAGES.length - 1]
  );
}

/** 阶段 0 是否通关（M3 的验收）：两条通关标准都打勾。 */
export const stage0Passed = (checks: Checks) =>
  STAGES[0].pass.every(i => checks[i.id]);

// ---------- 自动打勾 ----------

/** 宽基指数 ETF：名称里有这些宽基指数（不含行业、主题、跨境）。 */
const BROAD =
  /(沪深\s*300|中证\s*500|中证\s*800|中证\s*1000|中证\s*2000|上证\s*50|上证\s*180|科创\s*50|科创\s*100|创业板|双创|A500|A50|A100|深证\s*100|深证成指|中证全指|上证指数)/i;

export function isBroadEtf(name: string): boolean {
  return BROAD.test(name);
}

export interface AutoInput {
  /** 当前账户和已归档账户的状态（学习进度不随账户重置）。 */
  states: AccountState[];
  /** 证券名称。 */
  nameOf: (code: string) => string;
  /** 交割单页最近一次被浏览的时间（ISO，北京时间），没有为 null。 */
  ledgerViewedAt: string | null;
  /** 规则课「交易费用」是否通过、集合竞价演示是否答对。 */
  feeLessonPassed: boolean;
  auctionDemoDone: boolean;
}

export interface AutoResult {
  done: boolean;
  /** 完成时的依据（存进 learn_check.basis）。 */
  basis: string;
  /** 没完成时还差什么。 */
  missing: string[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const hhmm = (t: number) =>
  pad2(Math.floor(t / 3600)) + ':' + pad2(Math.floor((t % 3600) / 60));
const hhmmss = (t: number) => hhmm(t) + ':' + pad2(t % 60);

/** 开盘集合竞价的成交（成交依据是集合竞价，时间在午盘之前）。 */
export const isOpenAuctionFill = (f: Fill) =>
  f.basis.rule === 'auction' && f.t < T(12, 0);

/**
 * 「用集合竞价买一手宽基 ETF」：9:25 前提交的宽基 ETF 买入委托，在开盘集合竞价按开盘价成交至少 100 份。
 * 返回最早的一笔，没有就返回 null。
 */
export function auctionEtfBuy(
  states: AccountState[],
  nameOf: (code: string) => string,
): { fill: Fill; order: Order } | null {
  let best: { fill: Fill; order: Order } | null = null;
  for (const st of states) {
    for (const f of st.fills) {
      if (f.side !== 'B' || !isOpenAuctionFill(f)) {
        continue;
      }
      if (!f.code.match(/^(sh5|sz159)/) || !isBroadEtf(nameOf(f.code))) {
        continue;
      }
      const o = st.orders.find(x => x.id === f.orderId);
      if (!o || o.filled < 100) {
        continue;
      }
      const placedBefore = o.date < f.date || o.t < T(9, 25);
      if (!placedBefore) {
        continue;
      }
      if (
        !best ||
        f.date < best.fill.date ||
        (f.date === best.fill.date && f.t < best.fill.t)
      ) {
        best = { fill: f, order: o };
      }
    }
  }
  return best;
}

/** 每个自动项现在满足了没有。 */
export function evaluateAuto(input: AutoInput): Record<string, AutoResult> {
  const out: Record<string, AutoResult> = {};

  const calibrated = input.states.find(
    s => s.fee.calibratedStock || s.fee.calibratedEtf,
  );
  out['s0-e0'] = calibrated
    ? {
        done: true,
        basis:
          '费率已用真实交割单校准（' +
          [
            calibrated.fee.calibratedStock ? '股票' : '',
            calibrated.fee.calibratedEtf ? 'ETF' : '',
          ]
            .filter(Boolean)
            .join('、') +
          '）',
        missing: [],
      }
    : {
        done: false,
        basis: '',
        missing: ['开户后在「交割单校准」里抄一条真实交割单，比对一致后套用'],
      };

  const buy = auctionEtfBuy(input.states, input.nameOf);
  const fillIso = buy
    ? buy.fill.date + 'T' + hhmmss(buy.fill.t) + '+08:00'
    : null;
  const viewed =
    fillIso != null &&
    input.ledgerViewedAt != null &&
    input.ledgerViewedAt >= fillIso;
  if (buy && viewed) {
    out['s0-e1'] = {
      done: true,
      basis:
        buy.fill.date +
        ' 开盘集合竞价买入 ' +
        input.nameOf(buy.fill.code) +
        ' ' +
        buy.fill.qty +
        ' 份 @' +
        (buy.fill.price / 1000).toFixed(3) +
        '（' +
        (buy.order.date < buy.fill.date ? buy.order.date + ' ' : '') +
        hhmm(buy.order.t) +
        ' 提交的预埋单），之后查看了交割单',
      missing: [],
    };
  } else {
    out['s0-e1'] = {
      done: false,
      basis: '',
      missing: buy
        ? ['成交之后打开一次交割单（交易 → 交割单）']
        : [
            '9:25 前（可以是前一天晚上）提交一笔宽基 ETF（例如沪深300ETF 510300）的限价买入委托，至少 100 份。价格挂得比前收盘价高一点（例如高 1%），集合竞价按开盘价成交，不会按你的委托价',
            '9:25 开盘集合竞价按开盘价成交',
            '成交之后打开一次交割单',
          ],
    };
  }

  out['s0-p0'] = input.feeLessonPassed
    ? { done: true, basis: '规则课「交易费用」小测全部答对', missing: [] }
    : {
        done: false,
        basis: '',
        missing: ['规则课「交易费用」的小测全部答对'],
      };
  out['s0-p1'] = input.auctionDemoDone
    ? { done: true, basis: '集合竞价演示的小测答对', missing: [] }
    : { done: false, basis: '', missing: ['集合竞价演示里的小测答对'] };
  return out;
}
