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
  /**
   * 保护限价：沪市市价单必填（上交所交易规则 2023 年修订第 3.3.5 条），买入是能接受的最高价、卖出是最低价。
   * 成交价和转为限价后的价格都不会超过它。深市市价单没有这一项。
   */
  protect?: Li | null;
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

/**
 * 各交易所的市价委托类型。沪市（主板和科创板）自 2023-04-10 起是 4 种（上交所交易规则 2023 年修订第 3.3.4 条，
 * 2026-10-26 核对），并且必须带保护限价；深市 5 种，没有保护限价。
 */
export const MARKET_KINDS: Record<'SH' | 'SZ', OrderKind[]> = {
  SH: ['b5_ioc', 'b5_limit', 'cbest', 'obest'],
  SZ: ['cbest', 'obest', 'ioc', 'b5_ioc', 'fok'],
};

/** 沪市市价单要带保护限价。 */
export const needsProtect = (sec: Pick<Security, 'exchange'>): boolean =>
  sec.exchange === 'SH';

/** 买入冻结用的价格：限价单用委托价；沪市市价单用保护限价；深市市价单和盘后单用涨停价（没有时用最新价）。 */
export function freezePriceOf(
  req: Pick<OrderRequest, 'kind' | 'price' | 'protect'>,
  snap: Snapshot | null,
): Li {
  if ((req.kind === 'limit' || req.kind === 'after') && req.price != null) {
    return req.price;
  }
  if (req.kind !== 'limit' && req.kind !== 'after' && req.protect != null) {
    return req.protect;
  }
  return snap?.up ?? snap?.last ?? snap?.prevClose ?? 0;
}

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
  /** 风险警示股票：这一交易日已经委托买入的数量（已成交 + 未撤的），算 50 万股上限用。 */
  stBoughtToday?: number;
}

/** 风险警示股票单日累计买入上限（股）。 */
export const ST_DAILY_BUY_MAX = 500_000;

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
    // 沪市风险警示股票只能限价委托（沪市交易规则第 4.4.9 条）。深市规则没有这条限制（第 3.3.3、3.3.5 条，
    // 2026-10-27 核对），深市 ST 可以用市价委托
    if (sec.st && sec.exchange === 'SH') {
      return fail(
        'block',
        '委托类型',
        '沪市风险警示（ST）股票只能用限价委托，不能用市价委托。',
        'kinds',
      );
    }
    if (needsProtect(sec)) {
      if (req.protect == null || !(req.protect > 0)) {
        return fail(
          'block',
          '保护限价',
          '沪市市价委托必须填保护限价：买入是你能接受的最高价，卖出是最低价。',
          'kinds',
        );
      }
      if (req.protect % rule.tickLi !== 0) {
        return fail(
          'block',
          '最小价位',
          '保护限价必须是 ' + (rule.tickLi / 1000).toFixed(d) + ' 元的整数倍。',
          'unit',
        );
      }
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

  // 风险警示股票单日累计买入不超过 50 万股（沪市第 4.4.10 条、深市第 4.5.4 条），已成交和已申报未撤的都算
  if (req.side === 'B' && sec.st) {
    const before = ctx.stBoughtToday ?? 0;
    if (before + q > ST_DAILY_BUY_MAX) {
      return fail(
        'block',
        '风险警示股票买入上限',
        '风险警示股票每天累计买入不能超过 50 万股（已成交和未撤的委托都算），这只今天已经委托买入 ' +
          before.toLocaleString('zh-CN') +
          ' 股。',
        'st',
      );
    }
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
    const need = buyFreeze(sec, freezePriceOf(req, snap), q, ctx.fee);
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
