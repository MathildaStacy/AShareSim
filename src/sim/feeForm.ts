/**
 * 费率设置页的表单逻辑和各页面共用的「费率状态」文字（纯函数）。
 *
 * - 状态：股票、ETF 分开，各自是「默认费率」「自定义」或「已用交割单校准」。
 * - 表单：佣金率按万分之填（精确到万分之 0.001），最低佣金按元填；免五 = 两个最低佣金改成 0.1 元。
 * - 保存时手动改了股票（或 ETF）的佣金率、最低佣金，清掉对应的「已校准」；改规费另收两个都清掉（PRODUCT_DESIGN §10）。
 */
import {
  DEFAULT_FEE_PROFILE,
  FEE_LIMITS,
  MIAN5_MIN_FEN,
  wanText,
  type FeeProfile,
} from '../engine/fees';
import type { Board } from '../engine/securities';
import type { Fen, RateE8 } from '../engine/units';

export type FeeClass = 'stock' | 'etf';

export type FeeState = 'default' | 'custom' | 'calibrated';

export const FEE_STATE_NAME: Record<FeeState, string> = {
  default: '默认费率',
  custom: '自定义',
  calibrated: '已用交割单校准',
};

const CLASS_NAME: Record<FeeClass, string> = { stock: '股票', etf: 'ETF' };

export const classOf = (board: Board): FeeClass =>
  board === 'etf' ? 'etf' : 'stock';

function params(p: FeeProfile, c: FeeClass) {
  return c === 'etf'
    ? { rate: p.etfRate, minFen: p.etfMinFen, calibrated: p.calibratedEtf }
    : {
        rate: p.stockRate,
        minFen: p.stockMinFen,
        calibrated: p.calibratedStock,
      };
}

export function feeState(p: FeeProfile, c: FeeClass): FeeState {
  const x = params(p, c);
  if (x.calibrated) {
    return 'calibrated';
  }
  const d = params(DEFAULT_FEE_PROFILE, c);
  return x.rate === d.rate && x.minFen === d.minFen && !p.regsSeparate
    ? 'default'
    : 'custom';
}

/** 分 → 元，去掉多余的 0：500 → 「5」，10 → 「0.1」，1045 → 「10.45」。 */
export const yuanText = (fen: Fen) => String(fen / 100);

/** 「万 2.5、最低 5 元」 */
export function rateText(p: FeeProfile, c: FeeClass): string {
  const x = params(p, c);
  return wanText(x.rate) + '、最低 ' + yuanText(x.minFen) + ' 元';
}

/** 某一类证券的费率和状态：「佣金万 2.5、最低 5 元（默认费率）」。 */
export function feeLabel(p: FeeProfile, board: Board): string {
  const c = classOf(board);
  const st = feeState(p, c);
  return (
    '佣金' +
    rateText(p, c) +
    (p.regsSeparate ? '，规费另收' : '') +
    '（' +
    FEE_STATE_NAME[st] +
    '）'
  );
}

/** 整体状态一句话（交割单页、AI 页面上下文）。 */
export function feeSummary(p: FeeProfile): string {
  const s = feeState(p, 'stock');
  const e = feeState(p, 'etf');
  if (s === 'default' && e === 'default') {
    return '默认费率：股票万 2.5、ETF 万 0.5，最低 5 元';
  }
  return (['stock', 'etf'] as const)
    .map(c => {
      const st = feeState(p, c);
      return (
        CLASS_NAME[c] +
        (c === 'etf' ? ' ' : '') +
        rateText(p, c) +
        '（' +
        FEE_STATE_NAME[st] +
        '）'
      );
    })
    .join('；')
    .concat(p.regsSeparate ? '；规费另收' : '');
}

// ---------- 表单 ----------

export interface FeeForm {
  /** 万分之几，原文。 */
  stockWan: string;
  stockMin: string;
  etfWan: string;
  etfMin: string;
  regsSeparate: boolean;
  mergeOrder: boolean;
}

export type FeeField = 'stockWan' | 'stockMin' | 'etfWan' | 'etfMin';

export const FEE_FIELD_NAME: Record<FeeField, string> = {
  stockWan: '股票佣金率',
  stockMin: '股票最低佣金',
  etfWan: 'ETF 佣金率',
  etfMin: 'ETF 最低佣金',
};

const wanInput = (rate: RateE8) => String(Math.round(rate / 10) / 1000);

export function formOf(p: FeeProfile): FeeForm {
  return {
    stockWan: wanInput(p.stockRate),
    stockMin: yuanText(p.stockMinFen),
    etfWan: wanInput(p.etfRate),
    etfMin: yuanText(p.etfMinFen),
    regsSeparate: p.regsSeparate,
    mergeOrder: p.mergeOrder,
  };
}

/** 「2.5」→ 25_000（亿分之一），最多 3 位小数。 */
export function parseWan(text: string): RateE8 | null {
  const m = /^\s*(\d+)(?:\.(\d{0,3}))?\s*$/.exec(text);
  if (!m) {
    return null;
  }
  return (
    Number(m[1]) * 10_000 + Number(((m[2] ?? '') + '000').slice(0, 3)) * 10
  );
}

/** 「5」「0.1」「12,345.6」→ 分，最多 2 位小数。 */
export function parseYuan(text: string): Fen | null {
  const m = /^\s*(\d+)(?:\.(\d{0,2}))?\s*$/.exec(text.replace(/,/g, ''));
  if (!m) {
    return null;
  }
  const fen = Number(m[1]) * 100 + Number(((m[2] ?? '') + '00').slice(0, 2));
  return Number.isSafeInteger(fen) ? fen : null;
}

/** 免五：两个最低佣金都不高于 0.1 元。 */
export const isMian5 = (f: FeeForm) =>
  (parseYuan(f.stockMin) ?? 500) <= MIAN5_MIN_FEN &&
  (parseYuan(f.etfMin) ?? 500) <= MIAN5_MIN_FEN;

/** 打开免五：最低佣金改成 0.1 元；关掉：改回 5 元。 */
export function toggleMian5(f: FeeForm, on: boolean): FeeForm {
  const v = yuanText(on ? MIAN5_MIN_FEN : 500);
  return { ...f, stockMin: v, etfMin: v };
}

export type FeeParse =
  | { ok: true; profile: FeeProfile }
  | { ok: false; errors: { field: FeeField; msg: string }[] };

/** 校验表单并生成新的费率设置（按 §10 清掉被手动改动的「已校准」）。 */
export function parseFeeForm(f: FeeForm, current: FeeProfile): FeeParse {
  const errors: { field: FeeField; msg: string }[] = [];
  const rate = (field: FeeField): RateE8 => {
    const r = parseWan(f[field]);
    if (r == null) {
      errors.push({
        field,
        msg: FEE_FIELD_NAME[field] + '填万分之几，例如 2.5，最多 3 位小数',
      });
      return 0;
    }
    if (r > FEE_LIMITS.maxRate) {
      errors.push({
        field,
        msg:
          FEE_FIELD_NAME[field] + '不能超过万 30（千分之三是监管规定的上限）',
      });
    }
    return r;
  };
  const min = (field: FeeField): Fen => {
    const v = parseYuan(f[field]);
    if (v == null) {
      errors.push({
        field,
        msg: FEE_FIELD_NAME[field] + '填元，例如 5 或 0.1',
      });
      return 0;
    }
    if (v > FEE_LIMITS.maxMinFen) {
      errors.push({ field, msg: FEE_FIELD_NAME[field] + '在 0–5 元之间' });
    }
    return v;
  };
  const stockRate = rate('stockWan');
  const stockMinFen = min('stockMin');
  const etfRate = rate('etfWan');
  const etfMinFen = min('etfMin');
  if (errors.length) {
    return { ok: false, errors };
  }
  const regsChanged = f.regsSeparate !== current.regsSeparate;
  const stockChanged =
    regsChanged ||
    stockRate !== current.stockRate ||
    stockMinFen !== current.stockMinFen;
  const etfChanged =
    regsChanged ||
    etfRate !== current.etfRate ||
    etfMinFen !== current.etfMinFen;
  return {
    ok: true,
    profile: {
      stockRate,
      stockMinFen,
      etfRate,
      etfMinFen,
      regsSeparate: f.regsSeparate,
      mergeOrder: f.mergeOrder,
      calibratedStock: current.calibratedStock && !stockChanged,
      calibratedEtf: current.calibratedEtf && !etfChanged,
    },
  };
}

const onOff = (v: boolean) => (v ? '开' : '关');

/** 两份费率设置的差别，一项一句（写操作日志、保存提示用）。 */
export function feeDiff(a: FeeProfile, b: FeeProfile): string[] {
  const out: string[] = [];
  const pair = (label: string, x: string, y: string) => {
    if (x !== y) {
      out.push(label + ' ' + x + ' → ' + y);
    }
  };
  pair('股票佣金率', wanText(a.stockRate), wanText(b.stockRate));
  pair(
    '股票最低佣金',
    yuanText(a.stockMinFen) + ' 元',
    yuanText(b.stockMinFen) + ' 元',
  );
  pair('ETF 佣金率', wanText(a.etfRate), wanText(b.etfRate));
  pair(
    'ETF 最低佣金',
    yuanText(a.etfMinFen) + ' 元',
    yuanText(b.etfMinFen) + ' 元',
  );
  pair('规费另收', onOff(a.regsSeparate), onOff(b.regsSeparate));
  pair('合并计佣', onOff(a.mergeOrder), onOff(b.mergeOrder));
  pair(
    '股票费率状态',
    a.calibratedStock ? '已校准' : '未校准',
    b.calibratedStock ? '已校准' : '未校准',
  );
  pair(
    'ETF 费率状态',
    a.calibratedEtf ? '已校准' : '未校准',
    b.calibratedEtf ? '已校准' : '未校准',
  );
  return out;
}
