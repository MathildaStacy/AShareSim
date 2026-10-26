/**
 * 银证转账的规则（PRODUCT_DESIGN §6.3、§10）：
 * - 时间：交易日 9:00–16:00（券商常见规则，各家略有不同）。新账户的第一笔入金不限时间。
 * - 银行转证券：累计净入金（转入 − 转出）不超过上限。
 * - 证券转银行：只能转可取资金，当天卖出的钱下一交易日才可取，冻结资金不能取。
 *
 * Engine.deposit / withdraw 只查金额、上限和可取，不查时间（引擎测试、调试页直接用）；界面走这里。
 */
import { withdrawable } from './account';
import type { TradingCalendar } from './calendar';
import { formatSec, T, type Sec } from './session';
import type { AccountState } from './types';
import { formatFen, type Fen } from './units';

export type TransferDir = 'in' | 'out';

export const TRANSFER_OPEN: Sec = T(9, 0);
export const TRANSFER_CLOSE: Sec = T(16, 0);

export type TransferCheck =
  | { ok: true; firstDeposit: boolean }
  | { ok: false; rule: string; msg: string };

/** 还没有入过金的账户（新开的或重置后的）：第一笔入金不限时间。 */
export function isFirstDeposit(state: AccountState): boolean {
  return !state.ledger.some(l => l.biz === '银行转证券');
}

/** 现在能不能转账（不看金额）。 */
export function transferWindowOpen(
  calendar: TradingCalendar,
  now: { date: string; t: Sec },
): boolean {
  return (
    calendar.isTradingDay(now.date) &&
    now.t >= TRANSFER_OPEN &&
    now.t <= TRANSFER_CLOSE
  );
}

export function checkTransfer(
  state: AccountState,
  calendar: TradingCalendar,
  now: { date: string; t: Sec },
  dir: TransferDir,
  fen: Fen,
): TransferCheck {
  if (!Number.isInteger(fen) || fen <= 0) {
    return { ok: false, rule: '金额', msg: '请输入转账金额。' };
  }
  const first = dir === 'in' && isFirstDeposit(state);
  if (!first && !transferWindowOpen(calendar, now)) {
    return {
      ok: false,
      rule: '银证转账时间',
      msg:
        '银证转账时间是交易日 9:00–16:00（各券商略有不同），现在是 ' +
        now.date +
        (calendar.isTradingDay(now.date) ? ' ' : '（休市日）') +
        formatSec(now.t) +
        '。' +
        (dir === 'in'
          ? '想在下一交易日开盘就有钱买，要提前一个交易日转入。'
          : ''),
    };
  }
  if (dir === 'in') {
    const left = state.depositCap - state.depositTotal;
    if (fen > left) {
      return {
        ok: false,
        rule: '模拟入金上限',
        msg:
          '累计净入金上限 ' +
          formatFen(state.depositCap) +
          ' 元，已转入 ' +
          formatFen(state.depositTotal) +
          ' 元，还可转入 ' +
          formatFen(Math.max(0, left)) +
          ' 元。上限可以在「设置」里改。',
      };
    }
    return { ok: true, firstDeposit: first };
  }
  const w = withdrawable(state);
  if (fen > w) {
    const reasons: string[] = [];
    if (state.todaySellNet > 0) {
      reasons.push(
        '今天卖出的 ' + formatFen(state.todaySellNet) + ' 元下一交易日才可取',
      );
    }
    if (state.frozen > 0) {
      reasons.push('买入委托冻结了 ' + formatFen(state.frozen) + ' 元');
    }
    return {
      ok: false,
      rule: '可取资金不足',
      msg:
        '可取资金 ' +
        formatFen(w) +
        ' 元' +
        (reasons.length ? '（' + reasons.join('，') + '）' : '') +
        '。',
    };
  }
  return { ok: true, firstDeposit: false };
}
