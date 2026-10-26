/**
 * 金额和价格一律用整数，避免浮点误差：
 * - 价格：厘（0.001 元）。股票最小价位 10 厘，ETF 1 厘。
 * - 金额：分（0.01 元）。
 * - 费率：亿分之一（1e-8）。万 2.5 = 0.00025 = 25_000。
 */
export type Li = number;
export type Fen = number;
export type RateE8 = number;

export const RATE_SCALE = 100_000_000;

/** 非负整数除法，四舍五入（.5 进位）。 */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (numerator < 0) {
    return -divRoundHalfUp(-numerator, denominator);
  }
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/** 成交金额（分）= 价格（厘）× 数量 ÷ 10。股票价格是 10 厘的整数倍，ETF 数量是 100 的整数倍，所以通常整除。 */
export function amountFen(priceLi: Li, qty: number): Fen {
  return divRoundHalfUp(priceLi * qty, 10);
}

/** 按费率计算费用（分），四舍五入到分。 */
export function feeFen(amount: Fen, rate: RateE8): Fen {
  return divRoundHalfUp(amount * rate, RATE_SCALE);
}

export function yuanToFen(yuan: number): Fen {
  return Math.round(yuan * 100);
}

export function yuanToLi(yuan: number): Li {
  return Math.round(yuan * 1000);
}

export function fenToYuan(fen: Fen): number {
  return fen / 100;
}

export function liToYuan(li: Li): number {
  return li / 1000;
}

/** 价格（厘）显示成字符串：股票 2 位小数，ETF 3 位。 */
export function formatPrice(priceLi: Li, decimals: 2 | 3): string {
  return (priceLi / 1000).toFixed(decimals);
}

export function formatFen(fen: Fen): string {
  const sign = fen < 0 ? '-' : '';
  const abs = Math.abs(fen);
  const yuan = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + yuan + '.' + String(abs % 100).padStart(2, '0');
}

/** 万分之 x（例如 2.5）转成亿分之一的整数费率。 */
export function rateFromWan(wan: number): RateE8 {
  return Math.round(wan * 10_000);
}

export function rateToWan(rate: RateE8): number {
  return rate / 10_000;
}
