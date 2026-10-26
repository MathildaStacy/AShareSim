/**
 * 资金流水（纯函数）：从交割单派生，一条交割单一行，余额和交割单一致（PRODUCT_DESIGN §10）。
 * 费用不单独拆一行，写在买卖那一行下面；汇总区单列费用合计和各项。下一交易日补扣的红利税、待到账的红利列在「待发生」。
 */
import type { DateStr } from '../engine/calendar';
import { addFee, ZERO_FEE, type FeeBreakdown } from '../engine/fees';
import type { AccountState, LedgerBiz, LedgerEntry } from '../engine/types';
import type { Fen } from '../engine/units';

export type FlowFilter = 'all' | 'transfer' | 'trade' | 'divfee';

export const FLOW_FILTERS: [FlowFilter, string][] = [
  ['all', '全部'],
  ['transfer', '转账'],
  ['trade', '买卖'],
  ['divfee', '红利税费'],
];

const GROUP: Record<LedgerBiz, Exclude<FlowFilter, 'all'>> = {
  银行转证券: 'transfer',
  证券转银行: 'transfer',
  证券买入: 'trade',
  证券卖出: 'trade',
  股息入账: 'divfee',
  股息红利税补: 'divfee',
  红股入账: 'divfee',
};

export function filterFlows(
  ledger: LedgerEntry[],
  f: FlowFilter,
): LedgerEntry[] {
  return f === 'all' ? ledger : ledger.filter(l => GROUP[l.biz] === f);
}

export interface FlowSummary {
  transferIn: Fen;
  transferOut: Fen;
  /** 买入、卖出的成交金额（不含费用）。 */
  buy: Fen;
  sell: Fen;
  fee: FeeBreakdown;
  dividend: Fen;
  divTax: Fen;
}

export function summarizeFlows(ledger: LedgerEntry[]): FlowSummary {
  const s: FlowSummary = {
    transferIn: 0,
    transferOut: 0,
    buy: 0,
    sell: 0,
    fee: { ...ZERO_FEE },
    dividend: 0,
    divTax: 0,
  };
  for (const l of ledger) {
    switch (l.biz) {
      case '银行转证券':
        s.transferIn += l.net;
        break;
      case '证券转银行':
        s.transferOut -= l.net;
        break;
      case '证券买入':
        s.buy += l.amount;
        break;
      case '证券卖出':
        s.sell += l.amount;
        break;
      case '股息入账':
        s.dividend += l.net;
        break;
      case '股息红利税补':
        s.divTax += l.divTax;
        break;
    }
    s.fee = addFee(s.fee, l.fee);
  }
  return s;
}

export interface PendingFlow {
  kind: '股息红利税补' | '股息入账';
  code: string;
  /** 资金发生额：红利税为负。 */
  net: Fen;
  /** 什么时候发生。 */
  when: string;
  note: string;
}

/** 待发生：卖出产生的红利税下一交易日开盘前扣，现金红利派息日到账。 */
export function pendingFlows(
  st: AccountState,
  nextTradingDay: (d: DateStr) => DateStr,
): PendingFlow[] {
  return [
    ...st.pendingDivTax.map(p => ({
      kind: '股息红利税补' as const,
      code: p.code,
      net: -p.amount,
      when: nextTradingDay(p.sellDate),
      note: p.notes.join('；'),
    })),
    ...st.pendingDividends.map(p => ({
      kind: '股息入账' as const,
      code: p.code,
      net: p.amount,
      when: p.payDate,
      note: '派息时不扣税，卖出时按持股期限补扣',
    })),
  ];
}
