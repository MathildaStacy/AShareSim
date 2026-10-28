/**
 * 简报和预设流程（AI_ASSISTANT §13.8）。
 *
 * 简报：盘前（交易日开盘前第一次打开）、盘后（15:30 以后）、周报（周五收盘后到周日）。App 把要用的数据拼好，
 * 放在最后一条用户消息里发一次请求，结果存在一个新对话里。不在后台自动请求：打开 AI 页时发现今天的还没看，
 * 或者错过了（盘前简报到了盘中），提示「要不要补一份」，你点了才发。
 *
 * 预设流程：名称 + 固定步骤（要调用哪些工具）+ 输出模板 + 建议的思考强度。运行时作为一条带模板的提问发出去，
 * 模板放在最后一条用户消息里，不改 system，所以不影响缓存。每次运行记下来，方便对比。
 */
import type { AppCore } from '../app/boot';
import type { DateStr, TradingCalendar } from '../engine/calendar';
import { T } from '../engine/session';
import { weekOf } from '../portfolio/repo';
import * as repo from '../data/repos';
import type { Effort } from './types';
import { ordersText, positionsText, tradesText } from './tools/read';
import { portfolioText, scorecardText } from './tools/insight';

export type BriefKind = 'pre' | 'post' | 'week';

export const BRIEF_NAME: Record<BriefKind, string> = {
  pre: '盘前简报',
  post: '盘后简报',
  week: '周报',
};

/** 每种简报上一次生成的日期（周报是那一周的周一）。 */
export type BriefLog = Partial<Record<BriefKind, string>>;

export interface BriefDue {
  kind: BriefKind;
  /** 这份简报对应的日期（周报是周一）。 */
  key: string;
  /** 错过了正常时间（盘前简报到了开盘以后），提示「要不要补一份」。 */
  missed: boolean;
}

/** 现在该有哪几份简报还没看。 */
export function dueBriefings(
  now: { date: DateStr; t: number },
  cal: TradingCalendar,
  log: BriefLog,
): BriefDue[] {
  const out: BriefDue[] = [];
  const trading = cal.isTradingDay(now.date);
  if (trading && log.pre !== now.date && now.t < T(15, 30)) {
    out.push({ kind: 'pre', key: now.date, missed: now.t >= T(9, 30) });
  }
  if (trading && log.post !== now.date && now.t >= T(15, 30)) {
    out.push({ kind: 'post', key: now.date, missed: false });
  }
  const wd = new Date(now.date + 'T00:00:00Z').getUTCDay();
  const week = weekOf(now.date);
  const weekEnd = (wd === 5 && now.t >= T(15, 30)) || wd === 6 || wd === 0;
  if (weekEnd && log.week !== week) {
    out.push({ kind: 'week', key: week, missed: false });
  }
  return out;
}

export async function loadBriefLog(core: AppCore): Promise<BriefLog> {
  return repo.getSetting<BriefLog>(core.db, 'aiBriefings', {});
}

export async function markBriefing(core: AppCore, d: BriefDue): Promise<void> {
  const log = await loadBriefLog(core);
  await repo.setSetting(core.db, 'aiBriefings', { ...log, [d.kind]: d.key });
}

const BRIEF_TEMPLATE: Record<BriefKind, string> = {
  pre:
    '请根据 <briefing_data> 写今天的盘前简报，按这个结构：\n' +
    '1. **今天要注意的事**：除权除息、预埋单和未完成委托会怎么走（几点报送、能不能成交）、正在执行的调仓。\n' +
    '2. **持仓风险**：每只持仓一句话（可卖数量、浮动盈亏、离风险限额还有多远）。\n' +
    '3. **开盘前要不要做什么**：没有就写「不用操作」。\n' +
    '数据里有的直接用，不要重复调用工具；缺数据时再调用对应工具。',
  post:
    '请根据 <briefing_data> 写今天的盘后简报，按这个结构：\n' +
    '1. **今天成交了什么**：每笔的价格、数量、费用；没有成交就写没有。\n' +
    '2. **执行偏差**：调仓计划的完成情况、补单、未成交原因；最低佣金多收的部分。\n' +
    '3. **违规和纪律**：计划外交易、超过单票上限、违背信号（只标记）。\n' +
    '4. **明天要跟进的**：未完成委托、到期的提案和决策日志。\n' +
    '数据里有的直接用，不要重复调用工具。',
  week:
    '请根据 <briefing_data> 写本周周报（路线图阶段 7 打卡），按这个结构：\n' +
    '1. **本周执行**：调仓次数、执行报告的费用、滑点和实现损失；没有报告就说明漏执行。\n' +
    '2. **记分卡**：AI 提案和我的决策各自的命中率和超额收益，样本少时明确说不足以下结论。\n' +
    '3. **纪律**：计划外交易和违规。\n' +
    '4. **下周**：一条最重要的改进。\n' +
    '数据里有的直接用，不要重复调用工具。',
};

/** 简报要用的数据（App 现拼，所以一次请求就够）。 */
export async function briefingData(
  core: AppCore,
  kind: BriefKind,
): Promise<string> {
  const now = core.sim.now();
  const parts: string[] = ['账户和持仓：\n' + positionsText(core)];
  if (kind !== 'week') {
    parts.push('未完成委托：\n' + ordersText(core, 'live', 30));
  }
  if (kind === 'pre') {
    const acts = await core.db.all<{
      code: string;
      ex_date: string;
      record_date: string;
      cash_per_share_li: number;
      bonus_per_share: number;
    }>(
      'SELECT code, ex_date, record_date, cash_per_share_li, bonus_per_share FROM corp_action WHERE ex_date >= ? ORDER BY ex_date LIMIT 20',
      [now.date],
    );
    // 本地库只存持仓和自选证券的分红送配
    const mine = acts;
    parts.push(
      '近期除权除息（本地库）：\n' +
        (mine.length
          ? mine
              .map(
                a =>
                  a.code +
                  ' ' +
                  (core.sim.security(a.code)?.name ?? '') +
                  ' 登记日 ' +
                  a.record_date +
                  ' 除权除息日 ' +
                  a.ex_date +
                  ' 每股派现 ' +
                  (Number(a.cash_per_share_li) / 1000).toFixed(4) +
                  ' 元' +
                  (a.bonus_per_share ? ' 送转 ' + a.bonus_per_share : ''),
              )
              .join('\n')
          : '没有'),
    );
  }
  if (kind === 'post') {
    parts.push('今日交割单：\n' + tradesText(core, now.date, now.date));
  }
  parts.push('组合与调仓：\n' + (await portfolioText(core)));
  if (kind === 'week') {
    parts.push(
      '本周交割单：\n' + tradesText(core, weekOf(now.date), now.date),
      await scorecardText(core),
    );
  }
  return '<briefing_data>\n' + parts.join('\n\n') + '\n</briefing_data>';
}

export function briefingQuestion(d: BriefDue): string {
  return (
    BRIEF_NAME[d.kind] +
    ' ' +
    d.key +
    (d.kind === 'week' ? ' 这一周' : '') +
    (d.missed ? '（补一份）' : '')
  );
}

export const briefingTemplate = (k: BriefKind) => BRIEF_TEMPLATE[k];

// ---------- 预设流程 ----------

export interface Flow {
  id: string;
  name: string;
  /** 要调用的工具（按顺序），写进模板，模型照着调。 */
  steps: string[];
  /** 输出模板。 */
  template: string;
  /** 建议的思考强度（运行前提示，不自动改对话设置）。 */
  effort: Effort;
  /** 运行时要你填一只证券。 */
  needsCode: boolean;
  builtin?: boolean;
}

export const BUILTIN_FLOWS: Flow[] = [
  {
    id: 'stock-check',
    name: '个股体检',
    steps: [
      'get_quote',
      'get_kline（day，120 根）',
      'get_company_profile',
      'get_financials（4 期）',
      'get_announcements（10 条）',
      'get_research（5 篇）',
      'get_corp_actions（code）',
      'get_positions',
    ],
    template:
      '## 结论\n一句话：买入 / 持有 / 减仓 / 卖出 / 观望，期限和仓位。\n' +
      '## 估值和盈利\n市盈率、市净率、ROE、营收和利润增速，和研报预测对比。\n' +
      '## 走势\n近 120 日涨跌、波动、关键价位。\n' +
      '## 事件\n最近的公告、分红送配，带日期和链接。\n' +
      '## 风险\n三条具体风险和失效条件。\n' +
      '最后用 propose 记下这条建议。',
    effort: 'medium',
    needsCode: true,
    builtin: true,
  },
  {
    id: 'weekly-review',
    name: '周度复盘',
    steps: [
      'get_trades（本周）',
      'get_portfolio',
      'get_journal',
      'get_scorecard',
      'get_analysis',
      'get_benchmark（sh510300，week，12 根）',
    ],
    template:
      '## 本周做了什么\n成交、调仓、执行报告的费用和实现损失。\n' +
      '## 和基准比\n本周和近 12 周账户收益对比沪深300ETF。\n' +
      '## 决策对账\n到期的提案和决策日志，命中和没命中的原因。\n' +
      '## 纪律\n计划外交易、违规。\n' +
      '## 下周\n一条最重要的改进。',
    effort: 'medium',
    needsCode: false,
    builtin: true,
  },
  {
    id: 'pre-rebalance',
    name: '调仓前检查',
    steps: [
      'get_portfolio',
      'get_positions',
      'get_orders（live）',
      'get_corp_actions（本周除权除息日历）',
      'get_fee_profile',
      'get_rule（unit）',
    ],
    template:
      '逐项检查，每项写「通过 / 有风险 / 不通过」和原因：\n' +
      '1. 有没有未完成委托会和调仓冲突\n' +
      '2. 可卖数量（T+1）够不够\n' +
      '3. 本周有没有持仓除权除息\n' +
      '4. 资金够不够同时报买单，要不要先卖后买\n' +
      '5. 最低 5 元佣金会让哪几只的实际费率偏高\n' +
      '6. 风险限额（单票上限、换手）会不会拦下\n' +
      '最后给一句结论：可以按计划调仓 / 先处理哪几项。',
    effort: 'low',
    needsCode: false,
    builtin: true,
  },
];

export interface FlowRun {
  flowId: string;
  threadId: number;
  at: string;
  /** 个股体检的对象。 */
  subject?: string;
}

export async function loadFlows(core: AppCore): Promise<Flow[]> {
  const mine = await repo.getSetting<Flow[]>(core.db, 'aiFlows', []);
  return [...BUILTIN_FLOWS, ...mine];
}

export async function saveCustomFlows(
  core: AppCore,
  flows: Flow[],
): Promise<void> {
  await repo.setSetting(
    core.db,
    'aiFlows',
    flows.filter(f => !f.builtin),
  );
}

export async function flowRuns(core: AppCore): Promise<FlowRun[]> {
  return repo.getSetting<FlowRun[]>(core.db, 'aiFlowRuns', []);
}

export async function recordFlowRun(
  core: AppCore,
  run: FlowRun,
): Promise<void> {
  const runs = await flowRuns(core);
  // 每个流程留最近 20 次
  const kept = [run, ...runs].filter(
    (r, i, all) =>
      all.slice(0, i).filter(x => x.flowId === r.flowId).length < 20,
  );
  await repo.setSetting(core.db, 'aiFlowRuns', kept);
}

/** 校验自定义流程；返回错误说明。 */
export function invalidFlow(f: Flow, all: Flow[]): string | null {
  if (!f.name.trim()) {
    return '要写名称';
  }
  if (all.some(x => x.id !== f.id && x.name === f.name.trim())) {
    return '已经有同名的流程';
  }
  if (!f.steps.length) {
    return '至少写一个步骤';
  }
  if (!f.template.trim()) {
    return '要写输出模板';
  }
  return null;
}

/** 运行时发出去的模板（放在最后一条用户消息里）。 */
export function flowPrompt(f: Flow, subject?: string): string {
  return (
    '<flow name="' +
    f.name +
    '">\n' +
    (subject ? '对象：' + subject + '\n' : '') +
    '按顺序调用这些工具（同一轮能并行就并行）：\n' +
    f.steps.map((s, i) => i + 1 + '. ' + s).join('\n') +
    '\n输出严格按这个模板：\n' +
    f.template +
    '\n</flow>'
  );
}
