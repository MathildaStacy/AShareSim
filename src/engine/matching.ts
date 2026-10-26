/**
 * 撮合（TRADING_RULES.md §6）：只根据行情快照推断成交，不确定时宁可保守（少成交、价格更差）。
 * 这里都是纯函数，输入委托剩余量和快照，输出「成交计划」；记账在 engine 里做。
 */
import type { Side } from './fees';
import { formatSec } from './session';
import type { FillBasis, Level, Snapshot } from './types';
import type { Li } from './units';

export interface FillPlan {
  price: Li;
  qty: number;
  basis: FillBasis;
}

const px = (v: Li, d: number) => (v / 1000).toFixed(d);

/**
 * 同一个快照里，我们自己的多笔委托不能重复吃同一档的量。按快照时间重置。
 */
export class Liquidity {
  private t = -1;
  private date = '';
  private used = new Map<string, number>();

  reset(snap: Snapshot): void {
    if (snap.t !== this.t || snap.date !== this.date) {
      this.t = snap.t;
      this.date = snap.date;
      this.used.clear();
    }
  }

  available(book: 'ask' | 'bid', price: Li, qty: number): number {
    return Math.max(0, qty - (this.used.get(book + price) ?? 0));
  }

  take(book: 'ask' | 'bid', price: Li, qty: number): void {
    this.used.set(book + price, (this.used.get(book + price) ?? 0) + qty);
  }
}

/** 对手盘：买单吃卖盘，卖单吃买盘。 */
export const oppositeLevels = (side: Side, snap: Snapshot): Level[] =>
  side === 'B' ? snap.asks : snap.bids;
export const ownLevels = (side: Side, snap: Snapshot): Level[] =>
  side === 'B' ? snap.bids : snap.asks;
const oppBook = (side: Side): 'ask' | 'bid' => (side === 'B' ? 'ask' : 'bid');

/** 价格对买单 / 卖单来说「不差于」限价。 */
const withinLimit = (side: Side, price: Li, limit: Li | null) =>
  limit == null || (side === 'B' ? price <= limit : price >= limit);

/**
 * 主动成交：按快照盘口逐档吃单，成交价是各档价格（不是委托价）。
 * maxLevels 限制最多吃几档（最优五档类市价单是 5）。
 */
export function walkBook(
  side: Side,
  qty: number,
  limit: Li | null,
  snap: Snapshot,
  liq: Liquidity,
  decimals: number,
  maxLevels = 5,
): FillPlan[] {
  const plans: FillPlan[] = [];
  let left = qty;
  const levels = oppositeLevels(side, snap);
  for (let i = 0; i < levels.length && i < maxLevels && left > 0; i++) {
    const [price, levelQty] = levels[i];
    if (!withinLimit(side, price, limit)) {
      break;
    }
    const avail = liq.available(oppBook(side), price, levelQty);
    const take = Math.min(left, avail);
    if (take <= 0) {
      continue;
    }
    liq.take(oppBook(side), price, take);
    left -= take;
    plans.push({
      price,
      qty: take,
      basis: {
        rule: 'walk',
        snapT: snap.t,
        level: i + 1,
        levelQty,
        text:
          formatSec(snap.t) +
          ' 快照' +
          (side === 'B' ? '卖' : '买') +
          (i + 1) +
          ' ' +
          px(price, decimals) +
          ' 挂 ' +
          levelQty +
          '，主动成交 ' +
          take +
          '，按该档价格成交',
      },
    });
  }
  return plans;
}

/** 对手盘在限价以内的可成交总量（全额成交或撤销用）。 */
export function liquidityWithin(
  side: Side,
  limit: Li | null,
  snap: Snapshot,
  liq: Liquidity,
  maxLevels = 5,
): number {
  let sum = 0;
  const levels = oppositeLevels(side, snap);
  for (let i = 0; i < levels.length && i < maxLevels; i++) {
    const [price, q] = levels[i];
    if (!withinLimit(side, price, limit)) {
      break;
    }
    sum += liq.available(oppBook(side), price, q);
  }
  return sum;
}

/** 挂单时估计排在前面的量 = 当时本方该价位的挂单量。比最优价更优的新价位，前面没有人。 */
export function queueAheadAt(side: Side, price: Li, snap: Snapshot): number {
  const lv = ownLevels(side, snap).find(l => l[0] === price);
  return lv ? lv[1] : 0;
}

export interface RestingResult {
  plans: FillPlan[];
  queueAhead: number;
}

/**
 * 挂单在两次快照之间的变化：
 * 1. 对手盘价格到了委托价（买单：卖一 ≤ 委托价）：按委托价和对手盘的量成交。
 * 2. 成交价穿过委托价（买单：出现低于委托价的成交）：全部成交，价格 = 委托价。
 * 3. 成交价等于委托价：用成交量增量先消耗「前面的量」，消耗完才轮到我们。
 */
export function stepResting(
  side: Side,
  price: Li,
  remaining: number,
  queueAhead: number,
  prev: Snapshot | null,
  cur: Snapshot,
  liq: Liquidity,
  decimals: number,
): RestingResult {
  const dv = prev ? Math.max(0, cur.volume - prev.volume) : 0;
  const better = (p: Li) => (side === 'B' ? p < price : p > price);
  const p = (v: Li) => px(v, decimals);

  // 1. 对手盘挂到了我们的价格以内
  const opp = oppositeLevels(side, cur);
  if (opp.length && withinLimit(side, opp[0][0], price)) {
    const plans: FillPlan[] = [];
    let left = remaining;
    for (let i = 0; i < opp.length && left > 0; i++) {
      const [lp, lq] = opp[i];
      if (!withinLimit(side, lp, price)) {
        break;
      }
      const take = Math.min(left, liq.available(oppBook(side), lp, lq));
      if (take <= 0) {
        continue;
      }
      liq.take(oppBook(side), lp, take);
      left -= take;
      plans.push({
        price,
        qty: take,
        basis: {
          rule: 'queue',
          snapT: cur.t,
          level: i + 1,
          levelQty: lq,
          text:
            formatSec(cur.t) +
            ' 快照' +
            (side === 'B' ? '卖' : '买') +
            (i + 1) +
            ' ' +
            p(lp) +
            ' 到达委托价，按委托价 ' +
            p(price) +
            ' 成交 ' +
            take,
        },
      });
    }
    if (plans.length) {
      return { plans, queueAhead: 0 };
    }
  }

  if (!prev || dv <= 0 || cur.last == null) {
    return { plans: [], queueAhead };
  }

  // 2. 成交价穿过委托价
  const prevExtreme = side === 'B' ? prev.low : prev.high;
  const curExtreme = side === 'B' ? cur.low : cur.high;
  const newExtreme =
    curExtreme != null &&
    (prevExtreme == null ||
      (side === 'B' ? curExtreme < prevExtreme : curExtreme > prevExtreme));
  if (
    better(cur.last) ||
    (newExtreme && curExtreme != null && better(curExtreme))
  ) {
    const seen = better(cur.last) ? cur.last : curExtreme!;
    return {
      plans: [
        {
          price,
          qty: remaining,
          basis: {
            rule: 'through',
            snapT: cur.t,
            volumeDelta: dv,
            text:
              formatSec(prev.t) +
              '–' +
              formatSec(cur.t) +
              ' 出现 ' +
              p(seen) +
              ' 的成交，' +
              (side === 'B' ? '低于' : '高于') +
              '委托价，价格优先，委托价上的单子已全部成交',
          },
        },
      ],
      queueAhead: 0,
    };
  }

  // 3. 成交价等于委托价：消耗排队
  if (cur.last === price) {
    if (dv <= queueAhead) {
      return { plans: [], queueAhead: queueAhead - dv };
    }
    const qty = Math.min(remaining, dv - queueAhead);
    return {
      plans: [
        {
          price,
          qty,
          basis: {
            rule: 'queue',
            snapT: cur.t,
            queueAhead,
            volumeDelta: dv,
            text:
              formatSec(prev.t) +
              '–' +
              formatSec(cur.t) +
              ' 在 ' +
              p(price) +
              ' 成交 ' +
              dv +
              '，排在前面的约 ' +
              queueAhead +
              ' 先成交，余下 ' +
              (dv - queueAhead) +
              ' 轮到本委托',
          },
        },
      ],
      queueAhead: 0,
    };
  }
  return { plans: [], queueAhead };
}

export interface AuctionResult {
  plan: FillPlan | null;
  /** 没成交时转入连续竞价，估计排在前面的量。 */
  queueAhead: number;
  note: string;
}

/**
 * 集合竞价（§6.1）。auctionPrice 是开盘价 / 收盘价，volume 是集合竞价成交量，after 是竞价结束后的第一个快照。
 * - 买价高于开盘价（卖价低于）：按开盘价成交。
 * - 委托价等于开盘价：如果竞价后本方在这个价位还有剩余挂单，说明这个价位的单子没有全部成交，保守起见不成交、排在剩余挂单后面；
 *   开盘就涨停（买）/ 跌停（卖）时也一样。
 */
export function resolveAuction(
  side: Side,
  price: Li,
  remaining: number,
  auctionPrice: Li,
  volume: number,
  after: Snapshot,
  kind: 'open' | 'close',
  decimals: number,
): AuctionResult {
  const name = kind === 'open' ? '开盘' : '收盘';
  const p = (v: Li) => px(v, decimals);
  const tag = kind === 'open' ? '09:25:00' : '15:00:00';
  const strictly = side === 'B' ? price > auctionPrice : price < auctionPrice;
  const equal = price === auctionPrice;
  const atLimit =
    side === 'B'
      ? after.up != null && auctionPrice >= after.up
      : after.down != null && auctionPrice <= after.down;
  const own = ownLevels(side, after)[0];
  const leftover = own && own[0] === auctionPrice && own[1] > 0 ? own[1] : 0;

  if (volume > 0 && (strictly || (equal && !atLimit && leftover === 0))) {
    const qty = Math.min(remaining, volume);
    return {
      plan: {
        price: auctionPrice,
        qty,
        basis: {
          rule: 'auction',
          snapT: after.t,
          auctionPrice,
          auctionVolume: volume,
          text:
            tag +
            ' ' +
            name +
            '集合竞价：' +
            name +
            '价 ' +
            p(auctionPrice) +
            (side === 'B'
              ? equal
                ? ' 等于'
                : ' 低于'
              : equal
              ? ' 等于'
              : ' 高于') +
            '委托价 ' +
            p(price) +
            '，按' +
            name +
            '价成交（集合竞价所有成交都用同一个价格）',
        },
      },
      queueAhead: 0,
      note: '',
    };
  }
  if (equal) {
    const why = atLimit
      ? name + '即' + (side === 'B' ? '涨停' : '跌停') + '，排在封单之后'
      : '这个价位竞价后还剩 ' + leftover + ' 未成交，保守起见排在它们后面';
    return {
      plan: null,
      queueAhead: leftover,
      note:
        '委托价等于' +
        name +
        '价，但' +
        why +
        (kind === 'open' ? '，转入连续竞价排队' : ''),
    };
  }
  return {
    plan: null,
    queueAhead: queueAheadAt(side, price, after),
    note:
      '委托价未达到' +
      name +
      '价' +
      (kind === 'open' ? '，转入连续竞价排队' : ''),
  };
}
