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

// ---------- F10：公司简况、主要财务指标（AI 的 get_company_profile / get_financials，M4） ----------

/** 东方财富 F10 用「600036.SH」这种代码。 */
const secucode = (code: string) =>
  code.slice(2) + '.' + code.slice(0, 2).toUpperCase();

const F10_BASE =
  'https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=';

export function profileUrl(code: string): string {
  return (
    F10_BASE +
    'RPT_F10_BASIC_ORGINFO&columns=SECURITY_NAME_ABBR,ORG_NAME,INDUSTRYCSRC1,MAIN_BUSINESS,ORG_PROFILE,FOUND_DATE,LISTING_DATE,PROVINCE' +
    '&filter=(SECUCODE%3D%22' +
    secucode(code) +
    '%22)'
  );
}

export interface CompanyProfile {
  name: string;
  fullName: string;
  /** 证监会行业，例如「金融业-货币金融服务」。 */
  industry: string;
  mainBusiness: string;
  profile: string;
  foundDate: string | null;
  listingDate: string | null;
  province: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** 解析公司简况；ETF、指数没有，返回 null（接口返回「返回数据为空」）。 */
export function parseProfile(json: unknown): CompanyProfile | null {
  const r = (json as any)?.result?.data?.[0];
  if (!r) {
    return null;
  }
  return {
    name: str(r.SECURITY_NAME_ABBR),
    fullName: str(r.ORG_NAME),
    industry: str(r.INDUSTRYCSRC1),
    mainBusiness: str(r.MAIN_BUSINESS),
    profile: str(r.ORG_PROFILE),
    foundDate: day(r.FOUND_DATE),
    listingDate: day(r.LISTING_DATE),
    province: str(r.PROVINCE),
  };
}

export function financeUrl(code: string, periods: number): string {
  return (
    F10_BASE +
    'RPT_F10_FINANCE_MAINFINADATA&columns=REPORT_DATE_NAME,EPSJB,TOTALOPERATEREVE,PARENTNETPROFIT,ROEJQ,XSMLL,TOTALOPERATEREVETZ,PARENTNETPROFITTZ' +
    '&filter=(SECUCODE%3D%22' +
    secucode(code) +
    '%22)&pageNumber=1&pageSize=' +
    periods +
    '&sortColumns=REPORT_DATE&sortTypes=-1'
  );
}

/**
 * 一期主要财务指标。金额是元（接口原样，可能有小数，这里只做展示和给 AI 读，不参与记账）；
 * 银行等金融企业没有毛利率（null）。
 */
export interface FinancePeriod {
  /** 「2026中报」「2025年报」。注意报告期是累计值：中报 = 1–6 月。 */
  period: string;
  /** 基本每股收益（元）。 */
  eps: number | null;
  revenue: number | null;
  /** 归属于母公司股东的净利润。 */
  netProfit: number | null;
  /** 营收、归母净利润同比增长（%）。 */
  revenueYoy: number | null;
  netProfitYoy: number | null;
  /** 加权净资产收益率（%）、销售毛利率（%）。 */
  roe: number | null;
  grossMargin: number | null;
}

const numOrNull = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function parseFinance(json: unknown): FinancePeriod[] {
  const rows = (json as any)?.result?.data;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map(r => ({
    period: str(r.REPORT_DATE_NAME),
    eps: numOrNull(r.EPSJB),
    revenue: numOrNull(r.TOTALOPERATEREVE),
    netProfit: numOrNull(r.PARENTNETPROFIT),
    revenueYoy: numOrNull(r.TOTALOPERATEREVETZ),
    netProfitYoy: numOrNull(r.PARENTNETPROFITTZ),
    roe: numOrNull(r.ROEJQ),
    grossMargin: numOrNull(r.XSMLL),
  }));
}
