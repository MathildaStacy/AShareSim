/**
 * 集合竞价演示（PRODUCT_DESIGN §6.4）：给一组买卖单，按交易所规则算出开盘价。
 *
 * 规则（TRADING_RULES.md §6.1，2026-10-27 核实）：
 * 1. 取成交量最大的价格；
 * 2. 高于它的买单、低于它的卖单全部成交，等于它的买卖至少一方全部成交；
 * 3. 满足条件的价格不止一个时，取未成交量（买卖累计量之差）最小的；
 * 4. 仍有多个：沪市（第 3.5.2 条）取它们的中间价；深市（第 3.4.3 条）开盘集合竞价取最接近前收盘价的。
 *
 * 价格用厘，数量用手。纯函数。
 */
import type { Li } from '../engine/units';

export type AuctionSide = 'B' | 'S';

export interface AuctionOrder {
  id: number;
  side: AuctionSide;
  price: Li;
  /** 手。 */
  qty: number;
}

export interface AuctionRow {
  price: Li;
  /** 价格 ≥ 这一档的买单累计量。 */
  buyCum: number;
  /** 价格 ≤ 这一档的卖单累计量。 */
  sellCum: number;
  /** 按这个价格能成交的量 = 两者较小的。 */
  volume: number;
  /** 未成交量 = 两者之差。 */
  imbalance: number;
  /** 是否满足第 2 条。 */
  valid: boolean;
}

export type AuctionRule = 'SH' | 'SZ';

export interface AuctionResult {
  /** 价格从高到低。 */
  rows: AuctionRow[];
  /** 开盘价；没有能成交的价格为 null。 */
  price: Li | null;
  volume: number;
  /** 怎么选出来的，一步一句。 */
  steps: string[];
}

const yuan = (li: Li) => (li / 1000).toFixed(2);

export function auctionRows(orders: AuctionOrder[]): AuctionRow[] {
  const prices = [...new Set(orders.map(o => o.price))].sort((a, b) => b - a);
  return prices.map(p => {
    let buyCum = 0;
    let sellCum = 0;
    let buyAbove = 0;
    let sellBelow = 0;
    let buyAt = 0;
    let sellAt = 0;
    for (const o of orders) {
      if (o.side === 'B' && o.price >= p) {
        buyCum += o.qty;
        if (o.price > p) {
          buyAbove += o.qty;
        } else {
          buyAt += o.qty;
        }
      }
      if (o.side === 'S' && o.price <= p) {
        sellCum += o.qty;
        if (o.price < p) {
          sellBelow += o.qty;
        } else {
          sellAt += o.qty;
        }
      }
    }
    const volume = Math.min(buyCum, sellCum);
    // 高于 p 的买单、低于 p 的卖单都要能成交；等于 p 的，买方或卖方至少一方全部成交
    const valid =
      volume > 0 &&
      buyAbove <= volume &&
      sellBelow <= volume &&
      (buyAbove + buyAt <= volume || sellBelow + sellAt <= volume);
    return {
      price: p,
      buyCum,
      sellCum,
      volume,
      imbalance: Math.abs(buyCum - sellCum),
      valid,
    };
  });
}

export function auctionPrice(
  orders: AuctionOrder[],
  prevClose: Li,
  rule: AuctionRule,
  tick: Li = 10,
): AuctionResult {
  const rows = auctionRows(orders);
  const steps: string[] = [];
  const valid = rows.filter(r => r.valid);
  if (!valid.length) {
    return {
      rows,
      price: null,
      volume: 0,
      steps: [
        '买单的最高价低于卖单的最低价，没有能成交的价格，开盘价要等连续竞价的第一笔成交',
      ],
    };
  }
  const maxVol = Math.max(...valid.map(r => r.volume));
  let cand = valid.filter(r => r.volume === maxVol);
  steps.push(
    '成交量最大是 ' +
      maxVol +
      ' 手，对应价格 ' +
      cand.map(r => yuan(r.price)).join('、'),
  );
  if (cand.length > 1) {
    const minImb = Math.min(...cand.map(r => r.imbalance));
    cand = cand.filter(r => r.imbalance === minImb);
    steps.push(
      '其中未成交量最小（' +
        minImb +
        ' 手）的是 ' +
        cand.map(r => yuan(r.price)).join('、'),
    );
  }
  let price: Li;
  if (cand.length === 1) {
    price = cand[0].price;
  } else if (rule === 'SH') {
    const hi = cand[0].price;
    const lo = cand[cand.length - 1].price;
    // 中间价按最小价位四舍五入
    price = Math.round((hi + lo) / 2 / tick) * tick;
    steps.push(
      '还是不止一个：沪市取中间价 (' +
        yuan(hi) +
        ' + ' +
        yuan(lo) +
        ') ÷ 2 = ' +
        yuan(price),
    );
  } else {
    // 深市取最接近前收盘价的；一样近时取较高的那个（价格从高到低排，先遇到的较高）
    let best = cand[0];
    for (const r of cand) {
      if (Math.abs(r.price - prevClose) < Math.abs(best.price - prevClose)) {
        best = r;
      }
    }
    price = best.price;
    steps.push(
      '还是不止一个：深市取最接近前收盘价 ' +
        yuan(prevClose) +
        ' 的 ' +
        yuan(price),
    );
  }
  const row = rows.find(r => r.price === price);
  const volume = row ? row.volume : maxVol;
  steps.push(
    '开盘价 ' +
      yuan(price) +
      '：所有买价 ≥ ' +
      yuan(price) +
      ' 的买单和卖价 ≤ ' +
      yuan(price) +
      ' 的卖单都按这个价成交（量不够时按价格优先、时间优先分配）',
  );
  return { rows, price, volume, steps };
}

/** 演示用的初始委托：前收 10.00，开盘价 10.01、成交 800 手（10.02 处低于它的卖单有 1,300 手，超过可成交量，不满足第 2 条）。 */
export const DEMO_PREV: Li = 10_000;

export const DEMO_ORDERS: AuctionOrder[] = [
  { id: 1, side: 'B', price: 10_050, qty: 300 },
  { id: 2, side: 'B', price: 10_020, qty: 500 },
  { id: 3, side: 'B', price: 10_000, qty: 800 },
  { id: 4, side: 'B', price: 9_980, qty: 600 },
  { id: 5, side: 'S', price: 9_950, qty: 200 },
  { id: 6, side: 'S', price: 9_990, qty: 400 },
  { id: 7, side: 'S', price: 10_010, qty: 700 },
  { id: 8, side: 'S', price: 10_030, qty: 600 },
];
