import { addMonths, type DateStr } from './calendar';
import type { Board, Security } from './securities';
import { amountFen, feeFen, type Fen, type Li, type RateE8 } from './units';

export type Side = 'B' | 'S';

/** 券商相关的费率设置（TRADING_RULES.md §4）。法定费用不在这里，随版本发布。 */
export interface FeeProfile {
  stockRate: RateE8;
  stockMinFen: Fen;
  etfRate: RateE8;
  etfMinFen: Fen;
  /** 经手费、证管费单列（默认含在佣金里）。 */
  regsSeparate: boolean;
  /** 同一委托的多笔成交合并计算佣金（最低 5 元按委托算）⚠️。 */
  mergeOrder: boolean;
  /** 是否已用真实交割单校准；未校准时界面要标注。 */
  calibrated: boolean;
}

/**
 * 默认费率：股票万 2.5、ETF 万 0.5，最低 5 元。还没开户时就用它；它不低于多数券商线上开户的费率，
 * 所以模拟结果只会比实盘略差，不会更好（和撮合「宁可保守」的原则一致）。开户后用真实交割单校准。
 */
export const DEFAULT_FEE_PROFILE: FeeProfile = {
  stockRate: 25_000,
  stockMinFen: 500,
  etfRate: 5_000,
  etfMinFen: 500,
  regsSeparate: false,
  mergeOrder: true,
  calibrated: false,
};

/** 免五：不设 5 元最低佣金。⚠️ 有的券商最低收 0.1 元，有的不设最低，校准时按交割单确定。 */
export const MIAN5_MIN_FEN: Fen = 10;

/** 法定费率（亿分之一）。 */
export const STATUTORY = {
  stamp: 50_000, // 印花税 0.05%，仅卖出，ETF 免征
  transfer: 1_000, // 过户费 0.001%，双向，ETF 免收 ⚠️
  handlingStock: 3_410, // 经手费 0.00341%
  handlingEtf: 450, // ⚠️ ETF 经手费率待核实
  reg: 2_000, // 证管费 0.002%
} as const;

export interface FeeBreakdown {
  commission: Fen;
  stamp: Fen;
  transfer: Fen;
  handling: Fen;
  reg: Fen;
  total: Fen;
}

export const ZERO_FEE: FeeBreakdown = {
  commission: 0,
  stamp: 0,
  transfer: 0,
  handling: 0,
  reg: 0,
  total: 0,
};

const FEE_KEYS = [
  'commission',
  'stamp',
  'transfer',
  'handling',
  'reg',
] as const;

function isEtf(board: Board): boolean {
  return board === 'etf';
}

export function commissionParams(
  sec: Pick<Security, 'board'>,
  profile: FeeProfile,
): { rate: RateE8; minFen: Fen } {
  return isEtf(sec.board)
    ? { rate: profile.etfRate, minFen: profile.etfMinFen }
    : { rate: profile.stockRate, minFen: profile.stockMinFen };
}

/** 一笔成交金额对应的各项费用。 */
export function calcFee(
  sec: Pick<Security, 'board'>,
  side: Side,
  amount: Fen,
  profile: FeeProfile,
): FeeBreakdown {
  if (amount <= 0) {
    return { ...ZERO_FEE };
  }
  const etf = isEtf(sec.board);
  const { rate, minFen } = commissionParams(sec, profile);
  const commission = Math.max(feeFen(amount, rate), minFen);
  const stamp = !etf && side === 'S' ? feeFen(amount, STATUTORY.stamp) : 0;
  const transfer = etf ? 0 : feeFen(amount, STATUTORY.transfer);
  const handling = profile.regsSeparate
    ? feeFen(amount, etf ? STATUTORY.handlingEtf : STATUTORY.handlingStock)
    : 0;
  const reg = profile.regsSeparate ? feeFen(amount, STATUTORY.reg) : 0;
  return {
    commission,
    stamp,
    transfer,
    handling,
    reg,
    total: commission + stamp + transfer + handling + reg,
  };
}

export function subFee(a: FeeBreakdown, b: FeeBreakdown): FeeBreakdown {
  const out = { ...ZERO_FEE };
  for (const k of FEE_KEYS) {
    out[k] = a[k] - b[k];
  }
  out.total = a.total - b.total;
  return out;
}

export function addFee(a: FeeBreakdown, b: FeeBreakdown): FeeBreakdown {
  const out = { ...ZERO_FEE };
  for (const k of FEE_KEYS) {
    out[k] = a[k] + b[k];
  }
  out.total = a.total + b.total;
  return out;
}

/**
 * 同一委托的第 n 笔成交的费用。合并计佣时，按「累计成交额的费用 − 之前已收的费用」计算，
 * 这样整笔委托的费用和一次成交完全一样，最低 5 元只收一次。
 */
export function fillFee(
  sec: Pick<Security, 'board'>,
  side: Side,
  prevCumAmount: Fen,
  fillAmount: Fen,
  profile: FeeProfile,
): FeeBreakdown {
  if (!profile.mergeOrder) {
    return calcFee(sec, side, fillAmount, profile);
  }
  return subFee(
    calcFee(sec, side, prevCumAmount + fillAmount, profile),
    calcFee(sec, side, prevCumAmount, profile),
  );
}

/** 买入冻结金额：委托金额 + 预估费用。 */
export function buyFreeze(
  sec: Pick<Security, 'board'>,
  priceLi: Li,
  qty: number,
  profile: FeeProfile,
): Fen {
  const amount = amountFen(priceLi, qty);
  return amount + calcFee(sec, 'B', amount, profile).total;
}

// ---------- 红利税（财税〔2015〕101 号） ----------

export interface DivTaxRate {
  /** 税率，百分比。 */
  pct: 0 | 10 | 20;
  label: string;
}

/**
 * 持股期限 ≤ 1 个月 20%，1 个月–1 年 10%，> 1 年免税。
 * 持股期限按自然月算：「持股一个月是指从上月某日至本月同日的前一日连续持股」，所以 1 月 8 日买入、2 月 8 日卖出
 * 正好是 1 个月（20%），2 月 9 日卖出才是 1 个月以上。月末买入按月末对齐（1 月 31 日买入，2 月 28 日卖出是 1 个月）。
 * 依据和测试见 __tests__/engine/official.test.ts。
 */
export function divTaxRate(buyDate: DateStr, sellDate: DateStr): DivTaxRate {
  if (sellDate <= addMonths(buyDate, 1)) {
    return { pct: 20, label: '持股 1 个月以内，税负 20%' };
  }
  if (sellDate <= addMonths(buyDate, 12)) {
    return { pct: 10, label: '持股 1 个月至 1 年，税负 10%' };
  }
  return { pct: 0, label: '持股超过 1 年，免税' };
}

// ---------- 交割单校准 ----------

export interface SlipInput {
  sec: Pick<Security, 'board'>;
  side: Side;
  priceLi: Li;
  qty: number;
  commission: Fen;
  stamp: Fen;
  transfer: Fen;
}

export interface CalibrationResult {
  amount: Fen;
  expected: FeeBreakdown;
  items: {
    key: 'commission' | 'stamp' | 'transfer';
    label: string;
    app: Fen;
    slip: Fen;
    ok: boolean;
  }[];
  allOk: boolean;
  /** 能从这条交割单推出的费率设置；推不出来时为 null，原因见 note。 */
  suggestion: Partial<FeeProfile> | null;
  note: string;
}

/**
 * 用一条真实交割单校准费率：按当前设置重算并逐项比对；佣金对不上时反推佣金率和是否免五。
 * 佣金正好 5 元说明触发了最低佣金，推不出费率。
 */
export function calibrate(
  slip: SlipInput,
  profile: FeeProfile,
): CalibrationResult {
  const amount = amountFen(slip.priceLi, slip.qty);
  const expected = calcFee(slip.sec, slip.side, amount, profile);
  const items = [
    {
      key: 'commission' as const,
      label: '佣金',
      app: expected.commission,
      slip: slip.commission,
    },
    {
      key: 'stamp' as const,
      label: '印花税',
      app: expected.stamp,
      slip: slip.stamp,
    },
    {
      key: 'transfer' as const,
      label: '过户费',
      app: expected.transfer,
      slip: slip.transfer,
    },
  ].map(i => ({ ...i, ok: i.app === i.slip }));
  const allOk = items.every(i => i.ok);
  if (allOk) {
    return {
      amount,
      expected,
      items,
      allOk,
      suggestion: { calibrated: true },
      note: '全部一致，费率设置和你的券商对上了。',
    };
  }
  let suggestion: Partial<FeeProfile> | null = null;
  let note = '';
  const commissionOk = items[0].ok;
  if (!commissionOk) {
    const { minFen } = commissionParams(slip.sec, profile);
    const etf = isEtf(slip.sec.board);
    if (slip.commission === 500) {
      note =
        '这条成交的佣金正好 5 元，触发了最低 5 元，推不出佣金率。换一条成交额 2 万元以上的交割单再试。';
    } else {
      // 佣金率精确到万分之 0.01（亿分之 100）
      const rate =
        Math.round((slip.commission * 100_000_000) / amount / 100) * 100;
      const mian5 = slip.commission < 500;
      const newMin = mian5 ? Math.min(minFen, MIAN5_MIN_FEN) : 500;
      suggestion = etf
        ? { etfRate: rate, etfMinFen: newMin }
        : { stockRate: rate, stockMinFen: newMin };
      note =
        '按这条交割单，你的佣金率是万 ' +
        (rate / 10_000).toFixed(2) +
        (mian5 ? '，佣金低于 5 元，说明账户免五' : '') +
        '。';
    }
  }
  const legalBad = items.slice(1).filter(i => !i.ok);
  if (legalBad.length) {
    note +=
      (note ? '\n' : '') +
      legalBad.map(i => i.label).join('、') +
      '对不上：印花税和过户费是法定费率，通常是抄错了数字；如果你的券商把经手费、证管费单列，打开「规费另收」再试。';
  }
  return { amount, expected, items, allOk, suggestion, note };
}
