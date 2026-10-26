/**
 * 当日参考盈亏（券商 App 的叫法）：今天这些持仓和成交让账户多了还是少了多少钱。
 * = 昨天就有的持仓 ×（现价 − 昨收）+ 今天买入的 ×（现价 − 成交价）− 买入费用 + 今天卖出的 ×（成交价 − 昨收）− 卖出费用。
 * 只是参考：除权除息日的昨收是除权价，红利到账不算进来。
 */
import { holdingOf } from '../engine/account';
import type { AccountState } from '../engine/types';
import { amountFen, type Fen, type Li } from '../engine/units';

export interface PriceRef {
  last: Li | null;
  prevClose: Li;
}

export function todayPnl(
  state: AccountState,
  priceOf: (code: string) => PriceRef | null,
): Fen {
  let pnl = 0;
  const codes = new Set([
    ...state.lots.map(l => l.code),
    ...state.fills.filter(f => f.date === state.date).map(f => f.code),
  ]);
  for (const code of codes) {
    const p = priceOf(code);
    if (!p) {
      continue;
    }
    const last = p.last ?? p.prevClose;
    const h = holdingOf(state, code);
    const old = h.held - h.todayBuy;
    pnl += amountFen(last, old) - amountFen(p.prevClose, old);
    for (const f of state.fills) {
      if (f.code !== code || f.date !== state.date) {
        continue;
      }
      if (f.side === 'B') {
        pnl += amountFen(last, f.qty) - f.amount - f.fee.total;
      } else {
        pnl += f.amount - amountFen(p.prevClose, f.qty) - f.fee.total;
      }
    }
  }
  return pnl;
}
