import { buyFreeze, type FeeProfile, type Side } from './fees';
import { ruleOf, type Security } from './securities';
import { afterHoursAccepting, PHASES, type Phase, type Sec } from './session';
import type { OrderKind, Snapshot } from './types';
import type { Fen, Li } from './units';

export interface OrderRequest {
  code: string;
  side: Side;
  kind: OrderKind;
  /** 限价单必填；市价单为 null。 */
  price: Li | null;
  qty: number;
}

/**
 * 校验结果：
 * - block：券商端直接拦下，不生成委托（真实券商 App 也会弹窗拒绝）。
 * - reject：委托生成了，但交易所拒收，状态是「废单」（例如超出价格笼子）。
 */
export type Validation =
  | { ok: true }
  | {
      ok: false;
      level: 'block' | 'reject';
      rule: string;
      msg: string;
      lesson?: string;
    };

const fail = (
  level: 'block' | 'reject',
  rule: string,
  msg: string,
  lesson?: string,
): Validation => ({
  ok: false,
  level,
  rule,
  msg,
  lesson,
});

export const MARKET_KINDS: Record<'SH' | 'SZ', OrderKind[]> = {
  // ⚠️ 2023 年后沪市主板是否也支持对手方最优、本方最优待核实
  SH: ['b5_ioc', 'b5_limit'],
  SZ: ['cbest', 'obest', 'ioc', 'b5_ioc', 'fok'],
};

/** 价格笼子（TRADING_RULES.md §3.3）。返回有效范围，不适用时返回 null。 */
export function cageRange(
  sec: Security,
  side: Side,
  snap: Snapshot,
): { base: Li; max?: Li; min?: Li } | null {
  const rule = ruleOf(sec);
  if (!rule.cage.enabled) {
    return null;
  }
  const { pct, ticks } = rule.cage;
  const tick = rule.tickLi;
  const ask1 = snap.asks[0]?.[0];
  const bid1 = snap.bids[0]?.[0];
  if (side === 'B') {
    const base = ask1 ?? bid1 ?? snap.last ?? snap.prevClose;
    const byPct = Math.floor((base * (100 + pct)) / (100 * tick)) * tick;
    return { base, max: Math.max(byPct, base + ticks * tick) };
  }
  const base = bid1 ?? ask1 ?? snap.last ?? snap.prevClose;
  const byPct = Math.ceil((base * (100 - pct)) / (100 * tick)) * tick;
  return { base, min: Math.min(byPct, base - ticks * tick) };
}

export function checkCage(
  sec: Security,
  side: Side,
  price: Li,
  snap: Snapshot,
): Validation {
  const c = cageRange(sec, side, snap);
  if (!c) {
    return { ok: true };
  }
  const p = (v: Li) => (v / 1000).toFixed(ruleOf(sec).decimals);
  if (side === 'B' && c.max != null && price > c.max) {
    return fail(
      'reject',
      '价格笼子',
      '连续竞价时买入价不能高于 ' +
        p(c.max) +
        '（基准价 ' +
        p(c.base) +
        ' 的 102%' +
        (ruleOf(sec).cage.ticks ? ' 和基准价加 10 个价位中较高的那个' : '') +
        '）。超出的申报交易所直接拒收，成为废单。',
      'cage',
    );
  }
  if (side === 'S' && c.min != null && price < c.min) {
    return fail(
      'reject',
      '价格笼子',
      '连续竞价时卖出价不能低于 ' +
        p(c.min) +
        '（基准价 ' +
        p(c.base) +
        ' 的 98%' +
        (ruleOf(sec).cage.ticks ? ' 和基准价减 10 个价位中较低的那个' : '') +
        '）。超出的申报交易所直接拒收，成为废单。',
      'cage',
    );
  }
  return { ok: true };
}

/** 涨跌停：价格必须在当日涨跌停价之间（不设涨跌幅的除外）。 */
export function checkPriceLimit(
  sec: Security,
  price: Li,
  snap: Snapshot,
): Validation {
  if (sec.noPriceLimit || snap.up == null || snap.down == null) {
    return { ok: true };
  }
  const d = ruleOf(sec).decimals;
  if (price > snap.up || price < snap.down) {
    return fail(
      'reject',
      '涨跌幅限制',
      '委托价必须在跌停价 ' +
        (snap.down / 1000).toFixed(d) +
        ' 和涨停价 ' +
        (snap.up / 1000).toFixed(d) +
        ' 之间。',
      'limit',
    );
  }
  return { ok: true };
}

export interface ValidateContext {
  sec: Security;
  /** 当日行情（报送下一交易日的预埋单时可以没有）。 */
  snap: Snapshot | null;
  phase: Phase;
  t: Sec;
  isTradingDay: boolean;
  /** 可用资金和可卖数量。 */
  available: Fen;
  sellable: number;
  fee: FeeProfile;
}

/** 提交时的校验（TRADING_RULES.md §3）。价格笼子和涨跌停在报送交易所时再查一次，见 engine。 */
export function validateOrder(
  req: OrderRequest,
  ctx: ValidateContext,
): Validation {
  const { sec, snap, phase } = ctx;
  const rule = ruleOf(sec);
  const d = rule.decimals;

  if (snap?.suspended) {
    return fail('block', '停牌', sec.name + '今天停牌，不能交易。');
  }

  // 1. 交易时段和委托类型
  if (req.kind === 'after') {
    if (!ctx.isTradingDay || !afterHoursAccepting(sec.exchange, ctx.t)) {
      return fail(
        'block',
        '盘后固定价格交易时间',
        '盘后固定价格交易的申报时间是' +
          (sec.exchange === 'SH'
            ? ' 9:30–11:30、13:00–15:30'
            : ' 9:15–11:30、13:00–15:30') +
          '，15:05 起按收盘价撮合。',
        'time',
      );
    }
  } else if (req.kind !== 'limit') {
    if (!MARKET_KINDS[sec.exchange].includes(req.kind)) {
      return fail(
        'block',
        '委托类型',
        (sec.exchange === 'SH' ? '沪市' : '深市') + '不支持这种市价委托。',
        'kinds',
      );
    }
    if (!ctx.isTradingDay || !PHASES[phase].market) {
      return fail(
        'block',
        '委托类型',
        '市价委托只能在连续竞价时段（9:30–11:30、13:00–14:57）提交。',
        'kinds',
      );
    }
  }

  // 2. 价格
  if (req.kind === 'limit') {
    if (req.price == null || !(req.price > 0)) {
      return fail('block', '委托价格', '请输入委托价格。');
    }
    if (req.price % rule.tickLi !== 0) {
      return fail(
        'block',
        '最小价位',
        '价格必须是 ' + (rule.tickLi / 1000).toFixed(d) + ' 元的整数倍。',
        'unit',
      );
    }
  }

  // 3. 数量
  const q = req.qty;
  if (!Number.isInteger(q) || q <= 0) {
    return fail('block', '委托数量', '请输入委托数量。');
  }
  const unit = sec.board === 'etf' ? '份' : '股';
  if (req.side === 'B') {
    if (q < rule.buyMin || (q - rule.buyMin) % rule.buyStep !== 0) {
      return fail(
        'block',
        '申报单位',
        rule.buyStep === 1
          ? '科创板买入至少 ' + rule.buyMin + ' 股，超过部分可以 1 股递增。'
          : '买入必须是 ' + rule.buyMin + ' ' + unit + '（1 手）的整数倍。',
        'unit',
      );
    }
  } else {
    if (q > ctx.sellable) {
      return fail(
        'block',
        '可卖数量',
        ctx.sellable
          ? '最多可卖 ' +
              ctx.sellable +
              ' ' +
              unit +
              '。今天买入的要到下一交易日才能卖（T+1）。'
          : '没有可卖的' + unit + '。今天买入的要到下一交易日才能卖（T+1）。',
        't1',
      );
    }
    const sellAll = q === ctx.sellable;
    if (rule.sellStep === 1) {
      if (q < rule.sellMin && !sellAll) {
        return fail(
          'block',
          '申报单位',
          '科创板卖出至少 ' +
            rule.sellMin +
            ' 股；不足 ' +
            rule.sellMin +
            ' 股时必须一次全部卖出。',
          'unit',
        );
      }
    } else if (
      q % rule.sellStep !== 0 &&
      q % rule.sellStep !== ctx.sellable % rule.sellStep
    ) {
      return fail(
        'block',
        '申报单位',
        '卖出必须是 100 ' +
          unit +
          '的整数倍；不足 100 ' +
          unit +
          '的零股只能一次性卖出。',
        'unit',
      );
    }
  }
  const maxQty =
    req.kind === 'limit' || req.kind === 'after'
      ? rule.maxLimitQty
      : rule.maxMarketQty;
  if (maxQty != null && q > maxQty) {
    return fail(
      'block',
      '单笔上限',
      '单笔申报不能超过 ' + maxQty.toLocaleString('zh-CN') + ' ' + unit + '。',
      'unit',
    );
  }

  // 4. 涨跌停和价格笼子（当日要报送交易所的委托）
  const goesToday = ctx.isTradingDay && PHASES[phase].route !== 'nextDay';
  if (req.kind === 'limit' && req.price != null && snap && goesToday) {
    const lim = checkPriceLimit(sec, req.price, snap);
    if (!lim.ok) {
      return { ...lim, level: 'block' };
    }
    if (phase === 'cont') {
      const cage = checkCage(sec, req.side, req.price, snap);
      if (!cage.ok) {
        return cage;
      }
    }
  }

  // 5. 资金
  if (req.side === 'B') {
    const freezePrice =
      req.kind === 'limit'
        ? req.price!
        : snap?.up ?? snap?.last ?? snap?.prevClose ?? 0;
    const need = buyFreeze(sec, freezePrice, q, ctx.fee);
    if (need > ctx.available) {
      return fail(
        'block',
        '可用资金',
        '可用资金不足：需要冻结 ' +
          (need / 100).toFixed(2) +
          ' 元（含预估费用），可用 ' +
          (ctx.available / 100).toFixed(2) +
          ' 元。',
      );
    }
  }
  return { ok: true };
}
