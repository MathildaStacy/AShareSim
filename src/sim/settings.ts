/**
 * 设置页的选项和校验（纯函数）：成本口径、快照保留、后台跟踪模式和间隔、累计净入金上限。
 * 取值范围见 PRODUCT_DESIGN §10。
 */
import { formatFen, type Fen } from '../engine/units';
import { parseYuan } from './feeForm';
import type { BackgroundMode } from './refresher';

/** 快照保留：按有快照的日期数算；0 表示永久保留。 */
export const SNAPSHOT_KEEP_OPTIONS: [number, string][] = [
  [20, '20 个交易日'],
  [60, '60 个交易日'],
  [0, '永久'],
];

export const BACKGROUND_MODE_OPTIONS: [BackgroundMode, string][] = [
  ['orders', '有委托时自动'],
  ['session', '交易时段全程'],
  ['off', '关闭'],
];

export const BACKGROUND_MODE_NAME = Object.fromEntries(
  BACKGROUND_MODE_OPTIONS,
) as Record<BackgroundMode, string>;

export const BACKGROUND_MS_OPTIONS: [number, string][] = [
  [3000, '3 秒'],
  [5000, '5 秒'],
  [10_000, '10 秒'],
  [30_000, '30 秒'],
];

export const keepName = (days: number) =>
  SNAPSHOT_KEEP_OPTIONS.find(o => o[0] === days)?.[1] ?? days + ' 个交易日';

export const msName = (ms: number) => ms / 1000 + ' 秒';

export const DEPOSIT_CAP_MIN: Fen = 1_000_000;
export const DEPOSIT_CAP_MAX: Fen = 1_000_000_000;

export type CapCheck = { ok: true; fen: Fen } | { ok: false; msg: string };

/** 累计净入金上限：1 万–1,000 万元，不能低于当前累计净入金。 */
export function checkDepositCap(text: string, depositTotal: Fen): CapCheck {
  const fen = parseYuan(text);
  if (fen == null) {
    return { ok: false, msg: '填金额（元），例如 400000' };
  }
  if (fen < DEPOSIT_CAP_MIN || fen > DEPOSIT_CAP_MAX) {
    return { ok: false, msg: '上限在 1 万到 1,000 万元之间' };
  }
  if (fen < depositTotal) {
    return {
      ok: false,
      msg:
        '不能低于已经转入的 ' +
        formatFen(depositTotal) +
        ' 元（累计净入金 = 转入 − 转出）',
    };
  }
  return { ok: true, fen };
}
