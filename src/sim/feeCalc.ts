/**
 * 费用计算器（PRODUCT_DESIGN §6.4）：输入代码、价格、数量，逐项列出买入和卖出的费用、来回费用和保本卖出价。
 * 和下单页、交割单用同一个 calcFee 和当前费率，所以算出来的数和真的成交一致。纯函数。
 */
import { calcFee, commissionParams, STATUTORY } from '../engine/fees';
import type { FeeBreakdown, FeeProfile, Side } from '../engine/fees';
import type { Board } from '../engine/securities';
import {
  amountFen,
  feeFen,
  formatFen,
  formatPrice,
  RATE_SCALE,
  rateToWan,
  type Fen,
  type Li,
} from '../engine/units';
import { recognizeCode } from './calibrateForm';
import { ratePct } from './fillExplain';
import { parsePrice, parseQty } from './orderForm';

export interface FeeCalcForm {
  code: string;
  price: string;
  qty: string;
}

export type FeeCalcField = keyof FeeCalcForm;

export const FEE_CALC_FIELD_NAME: Record<FeeCalcField, string> = {
  code: '证券代码',
  price: '价格',
  qty: '数量',
};

export interface FeeCalcLine {
  label: string;
  formula: string;
  /** 分；null 表示不单独收（含在佣金里）。 */
  value: Fen | null;
}

export interface FeeCalcSide {
  side: Side;
  fee: FeeBreakdown;
  lines: FeeCalcLine[];
  /** 按费率算的佣金（还没和最低佣金比）。 */
  byRate: Fen;
  /** 佣金被最低佣金抬高了。 */
  minHit: boolean;
}

export interface FeeCalcResult {
  code: string;
  board: Board;
  decimals: 2 | 3;
  price: Li;
  qty: number;
  amount: Fen;
  buy: FeeCalcSide;
  sell: FeeCalcSide;
  /** 买卖一个来回（同价）的费用。 */
  roundTrip: Fen;
  /** 来回费用占成交额的比例（%）。 */
  roundTripPct: number;
  /** 保本卖出价：卖出回款 ≥ 买入花的钱的最低价格（按最小价位）。 */
  breakEven: Li;
  breakEvenPct: number;
  /** 成交额达到这个数（分）以上佣金才按费率收；最低佣金为 0 或费率为 0 时为 null。 */
  minThreshold: Fen | null;
}

export type FeeCalcParse =
  | { ok: true; result: FeeCalcResult }
  | { ok: false; errors: { field: FeeCalcField; msg: string }[] };

function sideLines(
  board: Board,
  side: Side,
  amount: Fen,
  profile: FeeProfile,
): FeeCalcSide {
  const etf = board === 'etf';
  const sec = { board };
  const fee = calcFee(sec, side, amount, profile);
  const { rate, minFen } = commissionParams(sec, profile);
  const amt = formatFen(amount);
  const byRate = feeFen(amount, rate);
  const minHit = byRate < minFen;
  const lines: FeeCalcLine[] = [
    {
      label: '佣金',
      formula:
        'max(' +
        amt +
        ' × 万 ' +
        rateToWan(rate) +
        ' = ' +
        formatFen(byRate) +
        ', 最低 ' +
        formatFen(minFen) +
        ')' +
        (minHit ? '，按最低收' : ''),
      value: fee.commission,
    },
    {
      label: '印花税',
      formula: etf
        ? 'ETF 免征'
        : side === 'B'
        ? '买入不收'
        : amt + ' × ' + ratePct(STATUTORY.stamp),
      value: fee.stamp,
    },
    {
      label: '过户费',
      formula: etf ? 'ETF 不收' : amt + ' × ' + ratePct(STATUTORY.transfer),
      value: fee.transfer,
    },
  ];
  const handlingRate = etf ? STATUTORY.handlingEtf : STATUTORY.handlingStock;
  if (profile.regsSeparate) {
    lines.push(
      {
        label: '经手费',
        formula: amt + ' × ' + ratePct(handlingRate),
        value: fee.handling,
      },
      {
        label: '证管费',
        formula: etf ? 'ETF 不收' : amt + ' × ' + ratePct(STATUTORY.reg),
        value: fee.reg,
      },
    );
  } else {
    lines.push({
      label: '经手费、证管费',
      formula: '含在佣金里（券商代交易所收）',
      value: null,
    });
  }
  return { side, fee, lines, byRate, minHit };
}

/** 卖出回款 ≥ 买入花费的最低价（按最小价位往上找；涨幅太大找不到时返回买入价的两倍）。 */
export function breakEvenPrice(
  board: Board,
  price: Li,
  qty: number,
  profile: FeeProfile,
): Li {
  const sec = { board };
  const tick = board === 'etf' ? 1 : 10;
  const buyAmount = amountFen(price, qty);
  const cost = buyAmount + calcFee(sec, 'B', buyAmount, profile).total;
  const net = (p: Li) => {
    const a = amountFen(p, qty);
    return a - calcFee(sec, 'S', a, profile).total;
  };
  // 先粗找上界再二分，避免一档一档试
  let lo = price;
  let hi = price;
  while (net(hi) < cost && hi < price * 2) {
    hi += Math.max(tick, Math.round(price / 100 / tick) * tick);
  }
  if (net(hi) < cost) {
    return price * 2;
  }
  while (hi - lo > tick) {
    const mid = lo + Math.floor((hi - lo) / 2 / tick) * tick;
    if (net(mid) >= cost) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return net(lo) >= cost ? lo : hi;
}

export function parseFeeCalc(
  f: FeeCalcForm,
  profile: FeeProfile,
): FeeCalcParse {
  const errors: { field: FeeCalcField; msg: string }[] = [];
  const sec = recognizeCode(f.code);
  if (!sec) {
    errors.push({
      field: 'code',
      msg: '填 6 位证券代码，支持沪深主板、创业板、科创板和 ETF',
    });
  }
  const decimals = sec?.board === 'etf' ? 3 : 2;
  const price = parsePrice(f.price, decimals);
  if (price == null || price <= 0) {
    errors.push({
      field: 'price',
      msg: '价格要大于 0，最多 ' + decimals + ' 位小数',
    });
  }
  const qty = parseQty(f.qty);
  if (qty == null || qty <= 0) {
    errors.push({ field: 'qty', msg: '数量填正整数（股 / 份）' });
  }
  if (errors.length || !sec || price == null || qty == null) {
    return { ok: false, errors };
  }
  const amount = amountFen(price, qty);
  const buy = sideLines(sec.board, 'B', amount, profile);
  const sell = sideLines(sec.board, 'S', amount, profile);
  const roundTrip = buy.fee.total + sell.fee.total;
  const breakEven = breakEvenPrice(sec.board, price, qty, profile);
  const { rate, minFen } = commissionParams({ board: sec.board }, profile);
  return {
    ok: true,
    result: {
      code: sec.code,
      board: sec.board,
      decimals,
      price,
      qty,
      amount,
      buy,
      sell,
      roundTrip,
      roundTripPct: amount ? (roundTrip / amount) * 100 : 0,
      breakEven,
      breakEvenPct: ((breakEven - price) / price) * 100,
      minThreshold:
        rate > 0 && minFen > 0 ? Math.ceil((minFen * RATE_SCALE) / rate) : null,
    },
  };
}

/** 页面上下文和页面上的一句话总结。 */
export function feeCalcSummary(r: FeeCalcResult, name: string): string[] {
  const p = (li: Li) => formatPrice(li, r.decimals);
  const sideText = (x: FeeCalcSide) =>
    (x.side === 'B' ? '买入' : '卖出') +
    '费用 ' +
    formatFen(x.fee.total) +
    ' 元（' +
    x.lines
      .filter(l => l.value != null)
      .map(l => l.label + ' ' + formatFen(l.value!))
      .join('、') +
    (x.minHit ? '，佣金按最低收' : '') +
    '）';
  return [
    name +
      ' ' +
      p(r.price) +
      ' × ' +
      r.qty +
      ' = 成交额 ' +
      formatFen(r.amount) +
      ' 元',
    sideText(r.buy),
    sideText(r.sell),
    '来回费用 ' +
      formatFen(r.roundTrip) +
      ' 元（成交额的 ' +
      r.roundTripPct.toFixed(3) +
      '%），保本卖出价 ' +
      p(r.breakEven) +
      '（涨 ' +
      r.breakEvenPct.toFixed(2) +
      '%）',
    ...(r.minThreshold != null && r.amount < r.minThreshold
      ? [
          '成交额 ' +
            formatFen(r.minThreshold) +
            ' 元以上佣金才按费率收，现在被最低佣金放大了',
        ]
      : []),
  ];
}
