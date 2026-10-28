import type { FeeProfile } from '../engine/fees';
import type { OrderCheck } from '../engine/engine';
import type { Security } from '../engine/securities';
import type { OrderRequest } from '../engine/validate';

export interface Strategy {
  id: number;
  version: number;
  name: string;
  pool: string;
  frequency: string;
  benchmark: string;
  retry: 'once' | 'none';
  discipline: string;
  maxWeight: number;
}
export type StrategyInput = Omit<Strategy, 'id' | 'version'>;
export const DEFAULT_STRATEGY: StrategyInput = {
  name: '每周调仓',
  pool: '主板、非 ST；上市时间人工核对',
  frequency: '每周一开盘集合竞价',
  benchmark: 'sh510300',
  retry: 'once',
  discipline: '按信号执行，不加杠杆；计划外交易写明原因。',
  maxWeight: 0.3,
};
export interface Target {
  code: string;
  value: number;
}
export interface TargetFile {
  version: 1;
  mode: 'weight' | 'shares';
  targets: Target[];
}
export interface PlanRow {
  code: string;
  name: string;
  security: Security;
  held: number;
  sellable: number;
  target: number;
  idealQty: number;
  targetQty: number;
  decisionPrice: number;
  decisionAt: string;
  request: OrderRequest | null;
  check: OrderCheck | null;
  fee: number;
  minExtra: number;
  weightError: number;
  warnings: string[];
}
export interface Plan {
  accountId: number;
  date: string;
  t: number;
  feeProfile: FeeProfile;
  equity: number;
  available: number;
  buyNeed: number;
  weightError: number;
  rows: PlanRow[];
}
export interface Rebalance {
  id: number;
  accountId: number;
  strategy: Strategy;
  targets: TargetFile;
  plan: Plan;
  status: 'draft' | 'executing' | 'reported';
  createdAt: string;
  executionDate: string;
  orderIds: number[];
  attempts: Record<string, number>;
  notes: string[];
  /** AI 调仓提案批准后生成的（M5.5）：执行状态回写到提案。 */
  proposalId?: number;
  /** 这次调仓的理由，执行时写进决策日志（买入的每只一条）。 */
  thesis?: string;
}
export interface ReportRow {
  code: string;
  name: string;
  side: string;
  decisionPrice: number;
  orderPrices: number[];
  requested: number;
  filled: number;
  averagePrice: number | null;
  fillRatio: number;
  fees: number;
  minExtra: number;
  slippage: number;
  opportunity: number | null;
  rounding: number | null;
  weightError: number;
  remaining: number;
  reason: string;
  fillIds: number[];
  ledgerIds: number[];
}
export interface ExecutionReport {
  version: 1;
  rebalanceId: number;
  accountId: number;
  strategy: Strategy;
  date: string;
  week: string;
  createdAt: string;
  rows: ReportRow[];
  fees: number;
  minExtra: number;
  slippage: number;
  opportunity: number | null;
  rounding: number | null;
  shortfall: number | null;
  idealFees: number;
  implementationShortfall: number | null;
  violations: string[];
  note: string;
}
