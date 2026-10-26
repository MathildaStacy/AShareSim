/**
 * 交割单校准页的表单（纯函数）：把从券商交割单抄下来的一行解析成 SlipInput，校验后交给引擎的 calibrate()。
 * 证券代码只填 6 位也行，按代码段自动识别沪深和股票 / ETF。
 */
import {
  calibrate,
  type CalibrationResult,
  type SlipInput,
} from '../engine/fees';
import type { FeeProfile, Side } from '../engine/fees';
import { classify, type Board } from '../engine/securities';
import { amountFen, formatFen, type Fen } from '../engine/units';
import { parsePrice, parseQty } from './orderForm';
import { parseYuan } from './feeForm';

export interface SlipForm {
  code: string;
  side: Side;
  price: string;
  qty: string;
  /** 交割单上的成交金额（选填，只用来对照成交价 × 数量）。 */
  amount: string;
  commission: string;
  stamp: string;
  transfer: string;
  handling: string;
  reg: string;
}

export const EMPTY_SLIP: SlipForm = {
  code: '',
  side: 'S',
  price: '',
  qty: '',
  amount: '',
  commission: '',
  stamp: '',
  transfer: '',
  handling: '',
  reg: '',
};

export type SlipField = Exclude<keyof SlipForm, 'side'>;

export const SLIP_FIELD_NAME: Record<SlipField, string> = {
  code: '证券代码',
  price: '成交价',
  qty: '成交数量',
  amount: '成交金额',
  commission: '佣金',
  stamp: '印花税',
  transfer: '过户费',
  handling: '经手费',
  reg: '证管费',
};

/** 「600036」「sh600036」「SZ159915」→ 带前缀的代码和板块；认不出时 null。 */
export function recognizeCode(
  text: string,
): { code: string; board: Board } | null {
  const t = text.trim().toLowerCase();
  let code = t;
  if (/^\d{6}$/.test(t)) {
    code = (/^[569]/.test(t) ? 'sh' : 'sz') + t;
  }
  const c = classify(code);
  return c ? { code, board: c.board } : null;
}

export type SlipParse =
  | { ok: true; slip: SlipInput; code: string; amount: Fen }
  | { ok: false; errors: { field: SlipField; msg: string }[] };

export function parseSlip(f: SlipForm, regsSeparate: boolean): SlipParse {
  const errors: { field: SlipField; msg: string }[] = [];
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
      msg:
        '成交价按交割单填，' +
        (decimals === 3 ? 'ETF 3 位小数' : '股票 2 位小数'),
    });
  }
  const qty = parseQty(f.qty);
  if (qty == null || qty <= 0) {
    errors.push({ field: 'qty', msg: '成交数量填股数或份数' });
  }
  const money = (field: SlipField, required: boolean): Fen => {
    if (!required && !f[field].trim()) {
      return 0;
    }
    const v = parseYuan(f[field]);
    if (v == null) {
      errors.push({
        field,
        msg: SLIP_FIELD_NAME[field] + '填元，最多 2 位小数（没有就填 0）',
      });
      return 0;
    }
    return v;
  };
  const commission = money('commission', true);
  const stamp = money('stamp', true);
  const transfer = money('transfer', true);
  const handling = regsSeparate ? money('handling', true) : 0;
  const reg = regsSeparate ? money('reg', true) : 0;
  const amount = price != null && qty != null ? amountFen(price, qty) : 0;
  if (f.amount.trim() && amount > 0) {
    const a = parseYuan(f.amount);
    if (a == null) {
      errors.push({ field: 'amount', msg: '成交金额填元，最多 2 位小数' });
    } else if (a !== amount) {
      errors.push({
        field: 'amount',
        msg:
          '成交价 × 数量 = ' +
          formatFen(amount) +
          ' 元，和交割单上的成交金额 ' +
          formatFen(a) +
          ' 元对不上，检查成交价和数量（多笔成交合并的交割单要拆开填）',
      });
    }
  }
  if (errors.length || !sec || price == null || qty == null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    code: sec.code,
    amount,
    slip: {
      sec: { board: sec.board },
      side: f.side,
      priceLi: price,
      qty,
      commission,
      stamp,
      transfer,
      ...(regsSeparate ? { handling, reg } : {}),
    },
  };
}

/** 解析通过就比对。 */
export function compareSlip(
  f: SlipForm,
  profile: FeeProfile,
): { parse: SlipParse; result: CalibrationResult | null } {
  const parse = parseSlip(f, profile.regsSeparate);
  return { parse, result: parse.ok ? calibrate(parse.slip, profile) : null };
}

/**
 * 一键套用：把建议并进费率设置，再用同一条交割单重新比对；全部一致就同时标记「已校准」。
 * 全部一致时的建议本身就是「已校准」标记，套用即可。
 */
export function applySuggestion(
  slip: SlipInput,
  profile: FeeProfile,
  suggestion: Partial<FeeProfile>,
): { profile: FeeProfile; result: CalibrationResult } {
  const next = { ...profile, ...suggestion };
  const result = calibrate(slip, next);
  return {
    profile: result.allOk ? { ...next, ...result.suggestion } : next,
    result,
  };
}
