/**
 * AI 提案、决策日志、记分卡（PRODUCT_DESIGN §6.7，AI_ASSISTANT §13.6）。
 *
 * 提案：AI 的投资建议和调仓方案，状态「提出 → 你批准 / 拒绝 → 执行 → 到期复盘」。批准不等于执行，
 * 执行仍然走操作卡（单只）或批量操作卡（调仓）。到期复盘不看状态：被拒绝的建议也照样对账，
 * 记分卡衡量的是建议准不准，不是你采纳了多少。
 * 决策日志：每次买入写下理由、预期和失效条件；AI 提出的和你自己的分开统计。
 */

/** 买入 / 加仓 / 持有 / 减仓 / 卖出 / 观望。 */
export type Stance = 'buy' | 'add' | 'hold' | 'reduce' | 'sell' | 'watch';

export const STANCE_NAME: Record<Stance, string> = {
  buy: '买入',
  add: '加仓',
  hold: '持有',
  reduce: '减仓',
  sell: '卖出',
  watch: '观望',
};

/** 看多 +1 / 看空 −1 / 观望 0（不计命中率）。 */
export const STANCE_DIR: Record<Stance, 1 | -1 | 0> = {
  buy: 1,
  add: 1,
  hold: 1,
  reduce: -1,
  sell: -1,
  watch: 0,
};

export interface ProposalItem {
  code: string;
  name: string;
  stance: Stance;
  /** 调仓方案：目标权重 0–1；单只建议：建议仓位（占总资产），可以没有。 */
  weight: number | null;
  /** 建议的价格区间（厘），可以没有。 */
  priceLow: number | null;
  priceHigh: number | null;
}

export type ProposalKind = 'single' | 'rebalance';
export type ProposalStatus = 'proposed' | 'approved' | 'rejected' | 'executed';

export const PROPOSAL_STATUS_NAME: Record<ProposalStatus, string> = {
  proposed: '待你决定',
  approved: '已批准',
  rejected: '已拒绝',
  executed: '已执行',
};

/** 到期复盘的结果。收益都是前复权收盘价算的区间收益（小数）。 */
export interface Review {
  at: string;
  baseDate: string;
  dueDate: string;
  /** 标的（调仓方案按目标权重加权，余下现金收益 0）的区间收益。 */
  ret: number;
  benchmarkRet: number;
  /** 方向 ×（标的收益 − 基准收益）；观望为 null。 */
  excess: number | null;
  hit: boolean | null;
  /** 每只的区间收益（解释用）。 */
  legs: { code: string; ret: number }[];
}

export interface Proposal {
  id: number;
  accountId: number;
  threadId: number | null;
  kind: ProposalKind;
  status: ProposalStatus;
  items: ProposalItem[];
  /** 期限（交易日）。 */
  horizonDays: number;
  benchmark: string;
  thesis: string;
  invalidation: string;
  createdAt: string;
  /** 对账起点：提出那天（非交易日顺延到下一个交易日）的收盘价。 */
  baseDate: string;
  dueDate: string;
  decidedAt?: string;
  /** 调仓方案批准后生成的调仓计划（M5 rebalance），一张批量操作卡执行。 */
  rebalanceId?: number;
  executedAt?: string;
  review?: Review | null;
  /** 复盘失败的原因（缺行情等），下次再试。 */
  reviewError?: string;
}

export type JournalSource = 'user' | 'ai';

export interface JournalEntry {
  id: number;
  accountId: number;
  source: JournalSource;
  orderId: number | null;
  rebalanceId: number | null;
  proposalId: number | null;
  code: string;
  name: string;
  side: 'B' | 'S';
  thesis: string;
  expectation: string;
  invalidation: string;
  horizonDays: number;
  benchmark: string;
  createdAt: string;
  baseDate: string;
  dueDate: string;
  review?: Review | null;
  reviewError?: string;
}

export type JournalInput = Pick<
  JournalEntry,
  | 'source'
  | 'orderId'
  | 'rebalanceId'
  | 'proposalId'
  | 'code'
  | 'name'
  | 'side'
  | 'thesis'
  | 'expectation'
  | 'invalidation'
  | 'horizonDays'
  | 'benchmark'
>;

export interface ScoreLine {
  /** 已到期并对账的条数（不含观望）。 */
  n: number;
  hits: number;
  hitRate: number | null;
  /** 平均超额收益（小数）。 */
  avgExcess: number | null;
  /** 还没到期的。 */
  pending: number;
  /** 观望（只记录，不计命中率）。 */
  watch: number;
  /** 样本少于 20 条时「样本太少」（和账户分析一致）。 */
  thin: boolean;
  /** 最早到最晚一条对账日期，看覆盖了几周。 */
  firstDue: string | null;
  lastDue: string | null;
}

export interface Scorecard {
  ai: ScoreLine;
  user: ScoreLine;
}

export const DEFAULT_HORIZON = 20;
export const DEFAULT_BENCHMARK = 'sh510300';
