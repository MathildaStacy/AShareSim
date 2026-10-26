import type { DateStr } from './calendar';
import { DEFAULT_FEE_PROFILE, type FeeProfile } from './fees';
import type { AccountState, Order } from './types';
import { amountFen, type Fen, type Li } from './units';

export function newAccount(
  date: DateStr,
  opts: { fee?: FeeProfile; depositCap?: Fen } = {},
): AccountState {
  return {
    version: 1,
    date,
    settled: false,
    cash: 0,
    frozen: 0,
    todaySellNet: 0,
    depositTotal: 0,
    depositCap: opts.depositCap ?? 40_000_000,
    fee: { ...(opts.fee ?? DEFAULT_FEE_PROFILE) },
    lots: [],
    costs: {},
    orders: [],
    fills: [],
    ledger: [],
    pendingDivTax: [],
    appliedActions: [],
    pendingDividends: [],
    seq: 1000,
  };
}

export const isLive = (o: Order): boolean =>
  o.status === '未报' || o.status === '已报' || o.status === '部成';

export interface Holding {
  held: number;
  /** 可卖：昨天及以前买入的，减去卖单冻结的。 */
  sellable: number;
  /** 今天买入的（T+1 冻结）。 */
  todayBuy: number;
  frozenSell: number;
}

export function holdingOf(state: AccountState, code: string): Holding {
  let held = 0;
  let old = 0;
  for (const l of state.lots) {
    if (l.code === code) {
      held += l.qty;
      if (l.buyDate < state.date) {
        old += l.qty;
      }
    }
  }
  let frozenSell = 0;
  for (const o of state.orders) {
    if (o.code === code && o.side === 'S' && isLive(o)) {
      frozenSell += o.qty - o.filled;
    }
  }
  return {
    held,
    sellable: Math.max(0, old - frozenSell),
    todayBuy: held - old,
    frozenSell,
  };
}

export function available(state: AccountState): Fen {
  return state.cash - state.frozen;
}

/** 可取 = 可用资金减去当日卖出回款（卖出的钱当天可用、次一交易日才可取）。 */
export function withdrawable(state: AccountState): Fen {
  return Math.max(0, available(state) - state.todaySellNet);
}

export interface Position {
  code: string;
  qty: number;
  sellable: number;
  todayBuy: number;
  /** 摊薄成本价和买入均价（厘，四舍五入）。 */
  dilutedPrice: Li;
  averagePrice: Li;
  /** 成本池（分）。 */
  dilutedCost: Fen;
  averageCost: Fen;
  lastPrice: Li;
  marketValue: Fen;
  /** 浮动盈亏按摊薄成本算（和券商 App 默认一致）。 */
  pnl: Fen;
  pnlPct: number;
}

/** 持仓列表。priceOf 给出最新价（厘），没有行情时用 null。 */
export function positions(
  state: AccountState,
  priceOf: (code: string) => Li | null,
): Position[] {
  const codes = [...new Set(state.lots.map(l => l.code))];
  return codes
    .map(code => {
      const h = holdingOf(state, code);
      const cost = state.costs[code] ?? { diluted: 0, average: 0 };
      const last = priceOf(code) ?? 0;
      const mv = amountFen(last, h.held);
      // 成本池单位是分，成本价单位是厘：分 × 10 ÷ 股数
      const perShare = (fen: Fen) =>
        h.held ? Math.round((fen * 10) / h.held) : 0;
      return {
        code,
        qty: h.held,
        sellable: h.sellable,
        todayBuy: h.todayBuy,
        dilutedPrice: perShare(cost.diluted),
        averagePrice: perShare(cost.average),
        dilutedCost: cost.diluted,
        averageCost: cost.average,
        lastPrice: last,
        marketValue: mv,
        pnl: mv - cost.diluted,
        pnlPct:
          cost.diluted > 0 ? ((mv - cost.diluted) / cost.diluted) * 100 : 0,
      };
    })
    .filter(p => p.qty > 0);
}

export interface AccountSummary {
  cash: Fen;
  available: Fen;
  frozen: Fen;
  withdrawable: Fen;
  marketValue: Fen;
  total: Fen;
}

export function summary(
  state: AccountState,
  priceOf: (code: string) => Li | null,
): AccountSummary {
  const mv = positions(state, priceOf).reduce((a, p) => a + p.marketValue, 0);
  return {
    cash: state.cash,
    available: available(state),
    frozen: state.frozen,
    withdrawable: withdrawable(state),
    marketValue: mv,
    total: state.cash + mv,
  };
}
