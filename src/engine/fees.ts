import { addMonths, type DateStr } from './calendar';
import type { Board, Security } from './securities';
import {
  amountFen,
  feeFen,
  RATE_SCALE,
  type Fen,
  type Li,
  type RateE8,
} from './units';

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
  /**
   * 股票、ETF 是否已用真实交割单校准（分开校准）；未校准时界面要标注。手动改对应的佣金率、最低佣金会清掉，
   * 改规费另收两个都清掉（PRODUCT_DESIGN §10）。
   */
  calibratedStock: boolean;
  calibratedEtf: boolean;
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
  calibratedStock: false,
  calibratedEtf: false,
};

/** 费率设置的取值范围：佣金率 0–万 30（千分之三是监管上限），精确到万分之 0.001；最低佣金 0–5 元。 */
export const FEE_LIMITS = {
  maxRate: 300_000,
  rateStep: 10,
  maxMinFen: 500,
} as const;

/** 旧数据（M2 第 3 步以前）只有一个 calibrated 字段，读出来时换成股票、ETF 分开的两个。 */
export function upgradeFeeProfile(
  p: FeeProfile & { calibrated?: boolean },
): FeeProfile {
  const { calibrated, ...rest } = p;
  return {
    ...rest,
    calibratedStock: p.calibratedStock ?? calibrated ?? false,
    calibratedEtf: p.calibratedEtf ?? calibrated ?? false,
  };
}

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
  /** 规费另收时交割单上单列的经手费、证管费。 */
  handling?: Fen;
  reg?: Fen;
}

export type SlipItemKey =
  | 'commission'
  | 'stamp'
  | 'transfer'
  | 'handling'
  | 'reg';

export interface CalibrationResult {
  amount: Fen;
  expected: FeeBreakdown;
  items: {
    key: SlipItemKey;
    label: string;
    app: Fen;
    slip: Fen;
    ok: boolean;
  }[];
  allOk: boolean;
  /** 能从这条交割单推出的费率设置（全部一致时是「已校准」标记）；推不出来时为 null，原因见 note。 */
  suggestion: Partial<FeeProfile> | null;
  /** 佣金能推出的费率区间（亿分之一，[lo, hi)）；佣金触发最低佣金时只有上限。 */
  rateRange: { lo: RateE8; hi: RateE8 } | null;
  note: string;
}

/** 「整」的费率依次是万 1、万 0.5、万 0.1、万 0.05、万 0.01、万 0.005、万 0.001（亿分之一）。 */
const ROUND_STEPS = [10_000, 5_000, 1_000, 500, 100, 50, 10];

/** 区间宽于万 0.05 时，一条交割单定不准费率，建议换成交额更大的。 */
const WIDE_RANGE: RateE8 = 500;

/**
 * 佣金四舍五入到分，所以一条交割单只能推出一个费率区间：费率 r 满足 round(金额 × r) = 佣金。
 * 在区间里取最「整」的值；返回 null 表示区间里没有不超过万 30 的、万分之 0.001 的整数倍（数字可能抄错了）。
 */
export function inferRate(
  amount: Fen,
  commission: Fen,
): { rate: RateE8; lo: RateE8; hi: RateE8 } | null {
  if (amount <= 0 || commission <= 0) {
    return null;
  }
  const lo = ((commission - 0.5) * RATE_SCALE) / amount;
  const hi = ((commission + 0.5) * RATE_SCALE) / amount;
  for (const step of ROUND_STEPS) {
    const top = Math.min(hi, FEE_LIMITS.maxRate + 1);
    for (let r = Math.ceil(lo / step) * step; r < top; r += step) {
      if (feeFen(amount, r) === commission) {
        return { rate: r, lo, hi };
      }
    }
  }
  return null;
}

/** 亿分之一的费率写成「万 x」，最多 3 位小数（万 2.5、万 0.854）。 */
export function wanText(rate: RateE8): string {
  return '万 ' + String(Math.round(rate / 10) / 1000);
}

/**
 * 用一条真实交割单校准费率：按当前设置重算并逐项比对；佣金对不上时反推佣金率和是否免五。
 * 佣金正好等于最低佣金时推不出费率，只能推出「不高于万 x」。
 */
export function calibrate(
  slip: SlipInput,
  profile: FeeProfile,
): CalibrationResult {
  const amount = amountFen(slip.priceLi, slip.qty);
  const expected = calcFee(slip.sec, slip.side, amount, profile);
  const etf = isEtf(slip.sec.board);
  const list: { key: SlipItemKey; label: string; slip: Fen }[] = [
    { key: 'commission', label: '佣金', slip: slip.commission },
    { key: 'stamp', label: '印花税', slip: slip.stamp },
    { key: 'transfer', label: '过户费', slip: slip.transfer },
  ];
  if (profile.regsSeparate) {
    list.push(
      { key: 'handling', label: '经手费', slip: slip.handling ?? 0 },
      { key: 'reg', label: '证管费', slip: slip.reg ?? 0 },
    );
  }
  const items = list.map(i => ({
    ...i,
    app: expected[i.key],
    ok: expected[i.key] === i.slip,
  }));
  const allOk = items.every(i => i.ok);
  const flag: Partial<FeeProfile> = etf
    ? { calibratedEtf: true }
    : { calibratedStock: true };
  if (allOk) {
    return {
      amount,
      expected,
      items,
      allOk,
      suggestion: flag,
      rateRange: null,
      note:
        '全部一致，' + (etf ? 'ETF' : '股票') + '费率设置和你的券商对上了。',
    };
  }
  let suggestion: Partial<FeeProfile> | null = null;
  let rateRange: CalibrationResult['rateRange'] = null;
  const notes: string[] = [];
  if (!items[0].ok) {
    const { minFen } = commissionParams(slip.sec, profile);
    const c = slip.commission;
    // 佣金低于当前最低佣金：账户的最低佣金不高于它（免五）
    const newMin =
      c < minFen ? (c >= MIAN5_MIN_FEN ? MIAN5_MIN_FEN : 0) : minFen;
    const atMin = c === 500 || (c === newMin && c > 0);
    if (c === 0) {
      notes.push(
        '佣金是 0：有的券商对 ETF 免佣金，把佣金率和最低佣金都设成 0 即可。',
      );
      suggestion = etf
        ? { etfRate: 0, etfMinFen: 0 }
        : { stockRate: 0, stockMinFen: 0 };
    } else if (atMin) {
      const hi = Math.floor(((c + 0.5) * RATE_SCALE) / amount);
      rateRange = { lo: 0, hi };
      notes.push(
        '这条成交的佣金正好 ' +
          (c / 100).toFixed(2) +
          ' 元，触发了最低 ' +
          (c / 100).toFixed(c % 100 ? 2 : 0) +
          ' 元，推不出佣金率，只能看出不高于' +
          wanText(Math.floor(hi / 10) * 10) +
          '。换一条成交额更大的交割单再试（最低 5 元时成交额 2 万元以上）。',
      );
    } else {
      const inf = inferRate(amount, c);
      if (!inf) {
        notes.push(
          '按成交金额 ' +
            (amount / 100).toFixed(2) +
            ' 元，找不到能算出佣金 ' +
            (c / 100).toFixed(2) +
            ' 元的费率，检查一下成交价、数量和佣金有没有抄错。',
        );
      } else {
        rateRange = { lo: inf.lo, hi: inf.hi };
        suggestion = etf
          ? { etfRate: inf.rate, etfMinFen: newMin }
          : { stockRate: inf.rate, stockMinFen: newMin };
        notes.push(
          '按这条交割单，你的' +
            (etf ? ' ETF ' : '股票') +
            '佣金率是' +
            wanText(inf.rate) +
            (c < minFen
              ? '；佣金低于最低佣金 ' +
                String(minFen / 100) +
                ' 元，说明账户免五'
              : '') +
            '。',
        );
        if (inf.hi - inf.lo > WIDE_RANGE) {
          notes.push(
            '佣金只精确到分，这条成交额太小，费率在' +
              wanText(Math.ceil(inf.lo / 10) * 10) +
              '到' +
              wanText(Math.floor(inf.hi / 10) * 10) +
              '之间都对得上，取了最整的值；换一条成交额更大的交割单可以确认。',
          );
        }
      }
    }
  }
  const legalBad = items.slice(1).filter(i => !i.ok);
  if (legalBad.length) {
    notes.push(
      legalBad.map(i => i.label).join('、') +
        '对不上：印花税、过户费是法定费率，通常是抄错了数字' +
        (etf && legalBad.some(i => i.key === 'transfer')
          ? '（ETF 过户费各券商做法不一，App 按免收算）'
          : '') +
        '；如果你的券商把经手费、证管费单列，打开「规费另收」再试。',
    );
  }
  return {
    amount,
    expected,
    items,
    allOk,
    suggestion,
    rateRange,
    note: notes.join('\n'),
  };
}
