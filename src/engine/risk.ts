/**
 * 风险限额（PRODUCT_DESIGN §6.7，M5.5）：单票上限、单日换手上限、禁买 ST。
 * 在引擎校验里执行，下单页、AI 操作卡和调仓预检用同一套，对你和 AI 下的单一视同仁。
 *
 * 只拦买入：卖出是降低风险的操作，不拦（卖出金额仍计入当日换手，影响之后的买入）。
 * 总资产 = 资金余额 + 持仓市值；没有行情的持仓按买入均价成本估。全部默认关闭。
 */
import { isLive } from './account';
import type { Security } from './securities';
import type { AccountState, Snapshot } from './types';
import { amountFen, type Fen, type Li } from './units';
import { freezePriceOf, type OrderRequest, type Validation } from './validate';

export interface RiskLimits {
  /** 单票上限：买入后这只证券（含未成交买单）占总资产的比例，0–1；null 不限。 */
  maxWeight: number | null;
  /** 单日换手上限：当天委托金额（买 + 卖，含这笔）占总资产的比例，0–10；null 不限。 */
  maxTurnover: number | null;
  /** 禁买 ST / *ST。 */
  noSt: boolean;
}

export const NO_RISK_LIMITS: RiskLimits = {
  maxWeight: null,
  maxTurnover: null,
  noSt: false,
};

export const riskOf = (s: AccountState): RiskLimits => ({
  ...NO_RISK_LIMITS,
  ...(s.risk ?? {}),
});

export const hasRiskLimits = (r: RiskLimits) =>
  r.maxWeight != null || r.maxTurnover != null || r.noSt;

/** 「单票 30% · 换手 50% · 禁买 ST」；都没开时「未设置」。 */
export function riskText(r: RiskLimits): string {
  const out: string[] = [];
  if (r.maxWeight != null) {
    out.push('单票上限 ' + pct(r.maxWeight));
  }
  if (r.maxTurnover != null) {
    out.push('单日换手上限 ' + pct(r.maxTurnover));
  }
  if (r.noSt) {
    out.push('禁买 ST');
  }
  return out.length ? out.join(' · ') : '未设置';
}

const pct = (v: number) => +(v * 100).toFixed(2) + '%';

/** 校验范围；返回错误说明，没问题返回 null。 */
export function invalidRisk(r: RiskLimits): string | null {
  if (r.maxWeight != null && !(r.maxWeight > 0 && r.maxWeight <= 1)) {
    return '单票上限要在 0–100% 之间';
  }
  if (r.maxTurnover != null && !(r.maxTurnover > 0 && r.maxTurnover <= 10)) {
    return '单日换手上限要在 0–1000% 之间';
  }
  return null;
}

export interface RiskInput {
  state: AccountState;
  sec: Security;
  req: OrderRequest;
  date: string;
  snap: Snapshot | null;
  priceOf: (code: string) => Li | null;
}

/** 一笔委托的估算金额：限价按委托价，市价按保护限价 / 涨停价（和冻结资金同一个价）。 */
const notional = (
  req: Pick<OrderRequest, 'kind' | 'price' | 'protect' | 'qty'>,
  snap: Snapshot | null,
): Fen => amountFen(freezePriceOf(req, snap), req.qty);

/** 总资产（分）。 */
export function equityOf(
  s: AccountState,
  priceOf: (code: string) => Li | null,
): Fen {
  const qty = new Map<string, number>();
  s.lots.forEach(l => qty.set(l.code, (qty.get(l.code) ?? 0) + l.qty));
  let mv = 0;
  for (const [code, q] of qty) {
    const p = priceOf(code);
    mv += p != null ? amountFen(p, q) : s.costs[code]?.average ?? 0;
  }
  return s.cash + mv;
}

/** 当天委托的金额：已成交部分按成交额，未完成部分按委托价。废单不算。 */
export function turnoverToday(s: AccountState, date: string): Fen {
  return s.orders
    .filter(o => o.date === date && o.status !== '废单')
    .reduce(
      (n, o) =>
        n +
        o.amount +
        (isLive(o) && o.price != null
          ? amountFen(o.price, o.qty - o.filled)
          : 0),
      0,
    );
}

export interface RiskResult {
  ok: boolean;
  /** 「风险校验通过（单票上限 30%：买入后约 12.4%）」或拦下的原因。 */
  text: string;
  limits: RiskLimits;
}

/** 风险校验。没设限额或卖出时 ok，text 说明为什么不用查。 */
export function checkRisk(i: RiskInput): RiskResult {
  const limits = riskOf(i.state);
  if (!hasRiskLimits(limits)) {
    return { ok: true, text: '未设置风险限额', limits };
  }
  if (i.req.side === 'S') {
    return { ok: true, text: '卖出不受风险限额限制', limits };
  }
  const fail = (text: string): RiskResult => ({ ok: false, text, limits });
  if (limits.noSt && i.sec.st) {
    return fail('已开启禁买 ST：' + i.sec.name + ' 是风险警示股票');
  }
  const equity = equityOf(i.state, i.priceOf);
  const amount = notional(i.req, i.snap);
  const notes: string[] = [];
  if (equity > 0 && limits.maxWeight != null) {
    const qty = i.state.lots
      .filter(l => l.code === i.req.code)
      .reduce((n, l) => n + l.qty, 0);
    const p = i.priceOf(i.req.code);
    const held =
      qty && p != null
        ? amountFen(p, qty)
        : qty
        ? i.state.costs[i.req.code]?.average ?? 0
        : 0;
    const liveBuys = i.state.orders
      .filter(o => o.code === i.req.code && o.side === 'B' && isLive(o))
      .reduce(
        (n, o) => n + notional({ ...o, qty: o.qty - o.filled }, i.snap),
        0,
      );
    const w = (held + liveBuys + amount) / equity;
    if (w > limits.maxWeight + 1e-9) {
      return fail(
        '单票上限 ' +
          pct(limits.maxWeight) +
          '：买入后 ' +
          i.sec.name +
          '（含未成交买单）约占总资产 ' +
          pct(w),
      );
    }
    notes.push('单票买入后约 ' + pct(w));
  }
  if (equity > 0 && limits.maxTurnover != null) {
    const t = (turnoverToday(i.state, i.date) + amount) / equity;
    if (t > limits.maxTurnover + 1e-9) {
      return fail(
        '单日换手上限 ' +
          pct(limits.maxTurnover) +
          '：加上这笔，今天的委托金额约为总资产的 ' +
          pct(t),
      );
    }
    notes.push('今日换手约 ' + pct(t));
  }
  return {
    ok: true,
    text: '风险校验通过' + (notes.length ? '（' + notes.join('，') + '）' : ''),
    limits,
  };
}

/** 引擎用：不通过时变成 block 校验结果。 */
export function riskValidation(i: RiskInput): Validation | null {
  const r = checkRisk(i);
  return r.ok
    ? null
    : { ok: false, level: 'block', rule: '风险限额', msg: r.text };
}
