/**
 * 交割单导出 CSV（PRODUCT_DESIGN §6.2）：逐项列出佣金、印花税、过户费、经手费、证管费、股息红利税。
 * 纯函数；金额按元两位小数（不加千分位），价格按品种位数，按时间从早到晚排列，行尾 \r\n（RFC 4180）。
 */
import { formatSec } from '../engine/session';
import type { LedgerEntry } from '../engine/types';
import type { Fen } from '../engine/units';

export const LEDGER_CSV_HEADER = [
  '日期',
  '时间',
  '业务',
  '代码',
  '名称',
  '成交价',
  '数量',
  '成交金额',
  '佣金',
  '印花税',
  '过户费',
  '经手费',
  '证管费',
  '股息红利税',
  '发生金额',
  '资金余额',
  '合同号',
  '成交编号',
  '备注',
];

export interface LedgerCsvOptions {
  nameOf(code: string): string;
  decimalsOf(code: string): 2 | 3;
}

/** 分 → 元，两位小数，负数带减号，不加千分位。 */
export function fenCsv(fen: Fen): string {
  const sign = fen < 0 ? '-' : '';
  const abs = Math.abs(fen);
  return (
    sign + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0')
  );
}

/** RFC 4180：含逗号、引号、换行的字段加引号，引号写两次。 */
export function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

/** 有证券和成交的业务（买卖）才填成交价 / 数量 / 成交金额；红股入账只填数量。 */
function row(e: LedgerEntry, opts: LedgerCsvOptions): string[] {
  const trade = e.biz === '证券买入' || e.biz === '证券卖出';
  const code = e.code;
  return [
    e.date,
    formatSec(e.t),
    e.biz,
    code ? code.replace(/^(sh|sz)/, '') : '',
    code ? opts.nameOf(code) : '',
    trade && code ? (e.price / 1000).toFixed(opts.decimalsOf(code)) : '',
    trade || (e.qty && code) ? String(e.qty) : '',
    trade ? fenCsv(e.amount) : '',
    fenCsv(e.fee.commission),
    fenCsv(e.fee.stamp),
    fenCsv(e.fee.transfer),
    fenCsv(e.fee.handling),
    fenCsv(e.fee.reg),
    fenCsv(e.divTax),
    fenCsv(e.net),
    fenCsv(e.balance),
    e.orderNo,
    e.fillNo,
    e.note,
  ];
}

/** 交割单 → CSV 文本（不含 BOM，导出时由 exportText 加）。state.ledger 是新的在前，这里反过来。 */
export function ledgerCsv(
  entries: LedgerEntry[],
  opts: LedgerCsvOptions,
): string {
  const sorted = [...entries].sort(
    (a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      a.t - b.t ||
      a.id - b.id,
  );
  return (
    [LEDGER_CSV_HEADER, ...sorted.map(e => row(e, opts))]
      .map(r => r.map(csvField).join(','))
      .join('\r\n') + '\r\n'
  );
}

export function ledgerFileName(date: string): string {
  return '交割单_' + date + '.csv';
}
