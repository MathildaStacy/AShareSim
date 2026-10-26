/**
 * 东方财富数据中心：分红送配（腾讯接口没有，2026-10-26 确认用这个）。
 *
 * `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET&columns=...&filter=(SECURITY_CODE="600036")`
 *
 * 字段口径（2026-10-26 用招商银行核对）：
 * - PRETAX_BONUS_RMB：每 10 股派现（元，税前），例如 10.03 → 每股 1.003 元 = 1003 厘
 * - BONUS_IT_RATIO：每 10 股送转合计；没有时用 BONUS_RATIO（送股）+ IT_RATIO（转增）
 * - EQUITY_RECORD_DATE / EX_DIVIDEND_DATE：股权登记日、除权除息日
 * - 接口没有派息日字段，沪深 A 股的现金红利通常在除息日到账，按除息日处理（TRADING_RULES.md §5）
 * - 只取 ASSIGN_PROGRESS =「实施分配」的记录（预案、股东大会通过的还没有除权日）
 */
import type { CorporateAction } from '../engine/types';

export const BONUS_COLUMNS =
  'SECURITY_CODE,SECURITY_NAME_ABBR,PRETAX_BONUS_RMB,BONUS_IT_RATIO,BONUS_RATIO,IT_RATIO,EQUITY_RECORD_DATE,EX_DIVIDEND_DATE,ASSIGN_PROGRESS,IMPL_PLAN_PROFILE';

export function bonusUrl(code6: string, pageSize = 10): string {
  return (
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET' +
    '&columns=' +
    BONUS_COLUMNS +
    '&filter=(SECURITY_CODE=%22' +
    code6 +
    '%22)&pageSize=' +
    pageSize +
    '&sortColumns=EX_DIVIDEND_DATE&sortTypes=-1'
  );
}

export interface CorporateActionRow extends CorporateAction {
  /** 方案原文，例如「10派10.03元(含税)」。 */
  plan: string;
}

const day = (s: unknown): string | null =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;

const n = (v: unknown): number => (typeof v === 'number' && v > 0 ? v : 0);

/** 解析分红送配。code 是带交易所前缀的代码（sh600036）。 */
export function parseBonus(json: unknown, code: string): CorporateActionRow[] {
  const rows = (json as any)?.result?.data;
  if (!Array.isArray(rows)) {
    return [];
  }
  const out: CorporateActionRow[] = [];
  for (const r of rows) {
    const exDate = day(r.EX_DIVIDEND_DATE);
    const recordDate = day(r.EQUITY_RECORD_DATE);
    if (r.ASSIGN_PROGRESS !== '实施分配' || !exDate || !recordDate) {
      continue;
    }
    const cash = n(r.PRETAX_BONUS_RMB);
    const bonus10 = n(r.BONUS_IT_RATIO) || n(r.BONUS_RATIO) + n(r.IT_RATIO);
    if (!cash && !bonus10) {
      continue;
    }
    out.push({
      code,
      recordDate,
      exDate,
      payDate: exDate,
      // 每 10 股 x 元 → 每股 x / 10 元 = x × 100 厘。方案最多 3 位小数（例如 10 派 0.865 元），
      // 每股就是 86.5 厘，保留 1 位小数，派息总额由引擎按持股数四舍五入到分
      cashPerShareLi: Math.round(cash * 1000) / 10,
      bonusPerShare: bonus10 / 10,
      plan: String(r.IMPL_PLAN_PROFILE ?? ''),
    });
  }
  return out;
}
