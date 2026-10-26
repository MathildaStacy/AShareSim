/**
 * 下单页的表单逻辑（纯函数，界面和测试共用）：解析输入、默认价格、加减价位和数量、可买数量、仓位快捷键、
 * 预估金额和费用、价格笼子提示、提交后什么时候报送。规则本身都来自引擎，这里只做表单上的换算。
 */
import type { Holding } from '../engine/account';
import {
  buyFreeze,
  calcFee,
  type FeeBreakdown,
  type FeeProfile,
  type Side,
} from '../engine/fees';
import { ruleOf, type Security } from '../engine/securities';
import { PHASES, type Phase } from '../engine/session';
import { KIND_NAME, type OrderKind, type Snapshot } from '../engine/types';
import { amountFen, formatPrice, type Fen, type Li } from '../engine/units';
import {
  cageRange,
  freezePriceOf,
  MARKET_KINDS,
  needsProtect,
  type OrderRequest,
} from '../engine/validate';

export type FormSide = Side;

export interface OrderForm {
  code: string;
  side: FormSide;
  kind: OrderKind;
  /** 输入框里的原文（元）。 */
  price: string;
  qty: string;
  protect: string;
}

/** 委托类型下拉：限价 + 本交易所的市价类型 + 盘后固定价格。 */
export function kindOptions(
  sec: Security,
): { kind: OrderKind; label: string }[] {
  return [
    { kind: 'limit', label: '限价委托' },
    ...MARKET_KINDS[sec.exchange].map(k => ({
      kind: k,
      label: KIND_NAME[k] + (needsProtect(sec) ? '（需保护限价）' : ''),
    })),
    { kind: 'after', label: '盘后固定价格（按收盘价）' },
  ];
}

export const isMarketKind = (k: OrderKind) => k !== 'limit' && k !== 'after';

/**
 * 「10.23」→ 10230 厘。不用浮点乘法，避免 0.1 + 0.2 这类误差；小数位超过品种精度、不是数字时返回 null。
 */
export function parsePrice(text: string, decimals: 2 | 3): Li | null {
  const m = /^\s*(\d+)(?:\.(\d*))?\s*$/.exec(text);
  if (!m) {
    return null;
  }
  const frac = m[2] ?? '';
  if (frac.length > decimals) {
    return null;
  }
  const li = Number(m[1]) * 1000 + Number((frac + '000').slice(0, 3));
  return Number.isSafeInteger(li) ? li : null;
}

export function parseQty(text: string): number | null {
  const m = /^\s*(\d+)\s*$/.exec(text.replace(/,/g, ''));
  return m ? Number(m[1]) : null;
}

export const priceText = (li: Li | null | undefined, decimals: 2 | 3) =>
  li == null ? '' : formatPrice(li, decimals);

/** 默认价格：买入取卖一，卖出取买一（和同花顺一样，挂了就大概率能成交）；没有盘口用最新价、昨收。 */
export function defaultPrice(side: Side, snap: Snapshot | null): Li | null {
  if (!snap) {
    return null;
  }
  const a = snap.asks[0]?.[0];
  const b = snap.bids[0]?.[0];
  const p = side === 'B' ? a ?? b : b ?? a;
  return p ?? snap.last ?? snap.prevClose ?? null;
}

/** ± 一个最小价位，不低于一个价位；有涨跌停时不超出。 */
export function stepPrice(
  li: Li | null,
  dir: 1 | -1,
  sec: Security,
  snap: Snapshot | null,
): Li | null {
  const tick = ruleOf(sec).tickLi;
  const base = li ?? defaultPrice('B', snap);
  if (base == null) {
    return null;
  }
  let p = Math.round(base / tick) * tick + dir * tick;
  if (snap?.up != null && p > snap.up) {
    p = snap.up;
  }
  if (snap?.down != null && p < snap.down) {
    p = snap.down;
  }
  return Math.max(tick, p);
}

/** ± 一手（100 股 / 份）；科创板买入不足 200 股时直接跳到 200。 */
export function stepQty(
  q: number | null,
  dir: 1 | -1,
  sec: Security,
  side: Side,
): number {
  const rule = ruleOf(sec);
  const min = side === 'B' ? rule.buyMin : rule.sellMin;
  const cur = q ?? 0;
  if (dir > 0) {
    return cur < min ? min : cur + 100;
  }
  const next = cur - 100;
  return next < min ? 0 : next;
}

/**
 * 沪市市价单的默认保护限价：买入 = 卖一 × 102%（向下取到价位），卖出 = 买一 × 98%（向上取），
 * 都不超出涨跌停。规则没有规定取多少，这只是一个控制滑点的常见做法，可以改。
 */
export function defaultProtect(
  sec: Security,
  side: Side,
  snap: Snapshot | null,
): Li | null {
  if (!snap) {
    return null;
  }
  const tick = ruleOf(sec).tickLi;
  const base = defaultPrice(side, snap);
  if (base == null) {
    return null;
  }
  if (side === 'B') {
    const p = Math.floor((base * 102) / (100 * tick)) * tick;
    return snap.up != null ? Math.min(p, snap.up) : p;
  }
  const p = Math.ceil((base * 98) / (100 * tick)) * tick;
  return snap.down != null ? Math.max(p, snap.down) : p;
}

/** 表单 → 委托请求。价格解析失败时填 null，由引擎校验给出「请输入委托价格」这类提示。 */
export function toRequest(form: OrderForm, sec: Security): OrderRequest {
  const d = ruleOf(sec).decimals;
  return {
    code: form.code,
    side: form.side,
    kind: form.kind,
    price: form.kind === 'limit' ? parsePrice(form.price, d) : null,
    protect:
      isMarketKind(form.kind) && needsProtect(sec)
        ? parsePrice(form.protect, d)
        : null,
    qty: parseQty(form.qty) ?? 0,
  };
}

/**
 * 最多能买多少：冻结金额（委托金额 + 预估费用）不超过可用资金，满足申报单位和单笔上限。
 * freezePrice 是冻结用的价格（限价单 = 委托价，市价单见 freezePriceOf）。
 */
export function maxBuy(
  sec: Security,
  freezePrice: Li | null,
  available: Fen,
  fee: FeeProfile,
): number {
  if (freezePrice == null || freezePrice <= 0 || available <= 0) {
    return 0;
  }
  const { buyMin, buyStep, maxLimitQty } = ruleOf(sec);
  const qtyAt = (i: number) => buyMin + i * buyStep;
  const ok = (i: number) =>
    buyFreeze(sec, freezePrice, qtyAt(i), fee) <= available;
  // 不算费用时最多能买的数量，再按申报单位取整；费用很小，在 [0, hi] 里二分
  let top = Math.floor((available * 10) / freezePrice);
  if (maxLimitQty != null) {
    top = Math.min(top, maxLimitQty);
  }
  if (top < buyMin || !ok(0)) {
    return 0;
  }
  let lo = 0;
  let hi = Math.floor((top - buyMin) / buyStep);
  if (ok(hi)) {
    return qtyAt(hi);
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return qtyAt(lo);
}

/** 仓位快捷键：全仓 / 1/2 / 1/3 / 1/4。买入按可买数量分，卖出按可卖数量分；分完不够一个申报单位时返回 0。 */
export function quickQty(
  div: 1 | 2 | 3 | 4,
  side: Side,
  sec: Security,
  maxBuyQty: number,
  sellable: number,
): number {
  const rule = ruleOf(sec);
  if (side === 'B') {
    const q = Math.floor(maxBuyQty / div);
    if (q < rule.buyMin) {
      return 0;
    }
    return (
      rule.buyMin + Math.floor((q - rule.buyMin) / rule.buyStep) * rule.buyStep
    );
  }
  if (div === 1) {
    return sellable; // 全部卖出时零股一起卖
  }
  const q = Math.floor(sellable / div);
  if (rule.sellStep === 1) {
    return q >= rule.sellMin ? q : 0;
  }
  return Math.floor(q / rule.sellStep) * rule.sellStep;
}

export interface Estimate {
  /** 估算成交价：限价 = 委托价；市价 = 对手方一档；盘后 = 收盘价（最新价）。 */
  price: Li | null;
  qty: number;
  amount: Fen;
  fee: FeeBreakdown;
  /** 买入要冻结的资金（委托金额 + 预估费用，按冻结价）。 */
  freeze: Fen;
  freezePrice: Li | null;
}

export function estimate(
  req: OrderRequest,
  sec: Security,
  snap: Snapshot | null,
  fee: FeeProfile,
): Estimate {
  let price: Li | null;
  if (req.kind === 'limit') {
    price = req.price;
  } else if (req.kind === 'after') {
    price = snap?.last ?? null;
  } else {
    const opp = req.side === 'B' ? snap?.asks[0]?.[0] : snap?.bids[0]?.[0];
    price = opp ?? snap?.last ?? null;
  }
  const qty = req.qty > 0 ? req.qty : 0;
  const amount = price != null ? amountFen(price, qty) : 0;
  const fp = freezePriceOf(req, snap);
  return {
    price,
    qty,
    amount,
    fee: calcFee(sec, req.side, amount, fee),
    freeze:
      req.side === 'B' && qty > 0 && fp > 0 ? buyFreeze(sec, fp, qty, fee) : 0,
    freezePrice: fp > 0 ? fp : null,
  };
}

/** 价格笼子提示（只在连续竞价的限价单上显示）。 */
export function cageHint(
  sec: Security,
  side: Side,
  snap: Snapshot | null,
  phase: Phase,
  isTradingDay: boolean,
): { text: string; bound: Li } | null {
  if (!snap || !isTradingDay || phase !== 'cont') {
    return null;
  }
  const c = cageRange(sec, side, snap);
  if (!c) {
    return null;
  }
  const d = ruleOf(sec).decimals;
  return side === 'B'
    ? { text: '价格笼子：买入价 ≤ ' + formatPrice(c.max!, d), bound: c.max! }
    : { text: '价格笼子：卖出价 ≥ ' + formatPrice(c.min!, d), bound: c.min! };
}

/** 提交后什么时候报送、怎么撮合（委托确认弹窗和表单底部显示）。 */
export function sendText(
  route: 'store' | 'auction' | 'continuous' | 'nextDay' | 'after',
  phase: Phase,
  isTradingDay: boolean,
): string {
  if (route === 'after') {
    return phase === 'after'
      ? '现在是盘后固定价格交易时段，提交后按当日收盘价、时间优先撮合。'
      : '盘后固定价格委托：15:05–15:30 按当日收盘价撮合，买入价低于 / 卖出价高于收盘价不能成交。';
  }
  if (!isTradingDay) {
    return '今天休市，这是预埋单，券商会在下一交易日 9:15 报送交易所。';
  }
  switch (phase) {
    case 'pre':
      return '还没开盘，这是预埋单，券商会在 9:15 报送交易所，参加开盘集合竞价。';
    case 'auc1':
      return '开盘集合竞价中，9:25 统一撮合；9:20 前还可以撤单。';
    case 'auc2':
      return '9:20–9:25 开盘集合竞价，提交后不能撤单，9:25 统一撮合。';
    case 'wait':
      return '9:25–9:30 交易所不接收申报，券商暂存，9:30 报送。';
    case 'cont':
      return '连续竞价中，提交后立即报送交易所，按价格优先、时间优先撮合。';
    case 'lunch':
      return '午间休市，券商暂存，13:00 报送。';
    case 'cauc':
      return '收盘集合竞价（14:57–15:00），提交后不能撤单，15:00 统一撮合。';
    default:
      return '今天已收盘，这笔委托会在下一交易日 9:15 报送交易所。';
  }
}

/** 撤单：未报的（券商暂存）随时能撤；已报交易所的看时段。和引擎 cancelOrder 的判断一致。 */
export function cancelState(
  status: string,
  phase: Phase,
  isTradingDay: boolean,
): { ok: boolean; why: string } {
  if (status === '未报') {
    return { ok: true, why: '还在券商暂存，没报交易所，随时能撤' };
  }
  const p = isTradingDay ? PHASES[phase] : PHASES.closed;
  if (p.exchangeCancel) {
    return { ok: true, why: '' };
  }
  const range =
    phase === 'auc2'
      ? '9:20–9:25'
      : phase === 'cauc'
      ? '14:57–15:00'
      : phase === 'wait'
      ? '9:25–9:30'
      : '';
  return {
    ok: false,
    why:
      '现在是' +
      p.name +
      (range ? '（' + range + '）' : '') +
      '，交易所不接受撤单',
  };
}

/** 卖出前的提示：持有期间分过红，卖出后下一交易日补扣红利税。 */
export function holdingNotes(h: Holding, unit: string): string[] {
  const out: string[] = [];
  if (h.todayBuy > 0) {
    out.push(
      '今日买入 ' +
        h.todayBuy.toLocaleString('zh-CN') +
        ' ' +
        unit +
        '要到下一交易日才能卖（T+1）',
    );
  }
  if (h.frozenSell > 0) {
    out.push(
      '已有卖单冻结 ' + h.frozenSell.toLocaleString('zh-CN') + ' ' + unit,
    );
  }
  return out;
}
