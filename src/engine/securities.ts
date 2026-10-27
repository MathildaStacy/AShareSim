import { divRoundHalfUp, type Li } from './units';

export type Exchange = 'SH' | 'SZ';
export type Board = 'main' | 'cyb' | 'kcb' | 'etf';

export interface Security {
  /** 带交易所前缀的代码，例如 sh600519、sz159915。 */
  code: string;
  name: string;
  exchange: Exchange;
  board: Board;
  /** 风险警示（ST / *ST）。 */
  st: boolean;
  /** 上市前 5 个交易日等不设涨跌幅的情况。 */
  noPriceLimit?: boolean;
}

export interface BoardRule {
  tickLi: Li;
  /** 价格显示位数。 */
  decimals: 2 | 3;
  /** 默认涨跌幅，只用来交叉校验；实际以行情给出的涨跌停价为准。 */
  defaultLimitPct: number;
  /** 买入：最少数量和递增单位。 */
  buyMin: number;
  buyStep: number;
  /** 卖出：整数倍单位（科创板以 1 股递增，最少 200 股，余额不足时一次卖完）。 */
  sellMin: number;
  sellStep: number;
  /**
   * 单笔申报上限，null 表示暂不校验。沪深交易规则（2026 年修订）第 3.3.9 条：竞价交易单笔不超过 100 万股（份），
   * 不分限价、市价；创业板限价 30 万股、市价 15 万股（深市第 3.3.9 条），科创板限价 10 万股、市价 5 万股（沪市第 6.7 条）。
   * 2026-10-27 核对：以前写的「主板市价 50 万股」没有依据。
   */
  maxLimitQty: number | null;
  maxMarketQty: number | null;
  cage: CageRule;
}

export interface CageRule {
  enabled: boolean;
  /** 买入价 ≤ 基准价 × (100 + pct)%，卖出价 ≥ 基准价 × (100 − pct)%。 */
  pct: number;
  /** 与「基准价 ± N 个最小价位」取较宽者，0 表示没有这一条。 */
  ticks: number;
}

/**
 * 各板块规则（TRADING_RULES.md §1、§3）。2026-10-27 对照沪深交易规则（2026 年修订）原文核对过单笔上限和价格笼子。
 */
export const BOARD_RULES: Record<Board, BoardRule> = {
  main: {
    tickLi: 10,
    decimals: 2,
    defaultLimitPct: 10,
    buyMin: 100,
    buyStep: 100,
    sellMin: 100,
    sellStep: 100,
    maxLimitQty: 1_000_000,
    maxMarketQty: 1_000_000,
    cage: { enabled: true, pct: 2, ticks: 10 },
  },
  cyb: {
    tickLi: 10,
    decimals: 2,
    defaultLimitPct: 20,
    buyMin: 100,
    buyStep: 100,
    sellMin: 100,
    sellStep: 100,
    maxLimitQty: 300_000,
    maxMarketQty: 150_000,
    // 深市第 3.3.16 条对股票统一规定 102% 与基准价上十个最小价位取高（2026-10-27 核对），创业板也有兜底
    cage: { enabled: true, pct: 2, ticks: 10 },
  },
  kcb: {
    tickLi: 10,
    decimals: 2,
    defaultLimitPct: 20,
    buyMin: 200,
    buyStep: 1,
    sellMin: 200,
    sellStep: 1,
    maxLimitQty: 100_000,
    maxMarketQty: 50_000,
    // 科创板只有 2%，没有 10 个价位的兜底（沪市第 6.8 条）
    cage: { enabled: true, pct: 2, ticks: 0 },
  },
  etf: {
    tickLi: 1,
    decimals: 3,
    defaultLimitPct: 10,
    buyMin: 100,
    buyStep: 100,
    sellMin: 100,
    sellStep: 100,
    // 单笔 100 万份（第 3.3.9 条，创业板、科创板的专项上限只管股票）
    maxLimitQty: 1_000_000,
    maxMarketQty: 1_000_000,
    // 价格笼子只管股票（沪市第 3.3.14 条、深市第 3.3.16 条），ETF 只受涨跌幅限制（2026-10-27 核对）
    cage: { enabled: false, pct: 2, ticks: 10 },
  },
};

/** 腾讯行情第 62 个字段的证券类型。 */
export type TencentType = 'GP-A' | 'GP-A-CYB' | 'GP-A-KCB' | 'ETF' | string;

/**
 * 按代码前缀判断板块；有行情字段时以行情字段为准。
 * 返回 null 表示 V1 不支持的品种（北交所、债券、指数等）。
 */
export function classify(
  code: string,
  tencentType?: TencentType,
): { exchange: Exchange; board: Board } | null {
  const m = /^(sh|sz)(\d{6})$/.exec(code);
  if (!m) {
    return null;
  }
  const exchange: Exchange = m[1] === 'sh' ? 'SH' : 'SZ';
  if (tencentType === 'ETF') {
    return { exchange, board: 'etf' };
  }
  if (tencentType === 'GP-A-KCB') {
    return { exchange, board: 'kcb' };
  }
  if (tencentType === 'GP-A-CYB') {
    return { exchange, board: 'cyb' };
  }
  const n = m[2];
  if (exchange === 'SH') {
    if (/^(600|601|603|605)/.test(n)) {
      return { exchange, board: 'main' };
    }
    if (/^(688|689)/.test(n)) {
      return { exchange, board: 'kcb' };
    }
    if (/^(51|56|58)/.test(n)) {
      return { exchange, board: 'etf' };
    }
    return null;
  }
  if (/^(000|001|002|003)/.test(n)) {
    return { exchange, board: 'main' };
  }
  if (/^(300|301)/.test(n)) {
    return { exchange, board: 'cyb' };
  }
  if (/^159/.test(n)) {
    return { exchange, board: 'etf' };
  }
  return null;
}

export function ruleOf(sec: Security): BoardRule {
  return BOARD_RULES[sec.board];
}

/** 名称里带 ST（含 *ST）就是风险警示股。 */
export function isSTName(name: string): boolean {
  return /ST/i.test(name);
}

/** 自算涨跌停价，只用于和行情接口给出的值交叉校验。 */
export function computeLimits(
  prevCloseLi: Li,
  pct: number,
  tickLi: Li,
): { up: Li; down: Li } {
  const up = divRoundHalfUp(prevCloseLi * (100 + pct), 100 * tickLi) * tickLi;
  const down = divRoundHalfUp(prevCloseLi * (100 - pct), 100 * tickLi) * tickLi;
  return { up, down };
}
