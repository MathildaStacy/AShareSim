/// <reference types="node" />
import { openMemoryDb } from '../../../src/data/drivers/nodeSqlite';
import { migrate } from '../../../src/data/migrations';
import { T } from '../../../src/engine/session';
import type { Level } from '../../../src/engine/types';
import type { MarketClient } from '../../../src/market/client';
import type { Quote } from '../../../src/market/tencent';
import { Simulator } from '../../../src/sim/simulator';

const client = {
  async minuteDays() {
    throw new Error('offline');
  },
  async corporateActions() {
    return [];
  },
} as unknown as MarketClient;

/** 招商银行的合成行情：价格厘、量股。 */
export function quote(
  date: string,
  t: number,
  last: number,
  volume: number,
  book: { bids?: Level[]; asks?: Level[] } = {},
  code = 'sh600036',
): Quote {
  const prev = code === 'sh600036' ? 40000 : 10000;
  return {
    snapshot: {
      code,
      date,
      t,
      prevClose: prev,
      open: prev,
      last,
      high: Math.max(prev, last),
      low: Math.min(prev, last),
      volume,
      amount: volume * Math.round(last / 10),
      bids: book.bids ?? [[last - 10, 50000]],
      asks: book.asks ?? [[last, 30000]],
      up: prev * 1.1,
      down: prev * 0.9,
    },
    info: {
      code,
      name: code === 'sh600036' ? '招商银行' : '浦发银行',
      type: 'GP-A',
    } as Quote['info'],
  };
}

export async function liveDay() {
  const db = openMemoryDb();
  await migrate(db);
  const clock = { date: '2026-10-26', t: T(9, 0) };
  let sim = await Simulator.open(db, client, () => clock);
  await sim.deposit(10_000_000);
  sim.setWatchlist(['sh600036', 'sh600000']);
  // 预埋单：9:15 报送参加开盘集合竞价
  clock.t = T(9, 5);
  await sim.ingest([quote('2026-10-26', T(9, 4, 30), 40000, 0)]);
  const pre = await sim.placeOrder({
    code: 'sh600036',
    side: 'B',
    kind: 'limit',
    price: 40100,
    qty: 200,
  });
  // 浦发没有委托，也没进自选前的快照不进日志
  clock.t = T(9, 26);
  await sim.ingest([quote('2026-10-26', T(9, 25, 3), 40000, 100000)]);
  clock.t = T(9, 31);
  await sim.ingest([
    quote('2026-10-26', T(9, 30, 3), 40000, 120000),
    quote('2026-10-26', T(9, 30, 3), 10000, 1000, {}, 'sh600000'),
  ]);
  // 主动成交：卖一 40.00 有 30,000 股
  await sim.placeOrder({
    code: 'sh600036',
    side: 'B',
    kind: 'limit',
    price: 40000,
    qty: 500,
  });
  // 挂单排队：39.80 买 300
  const rest = await sim.placeOrder({
    code: 'sh600036',
    side: 'B',
    kind: 'limit',
    price: 39800,
    qty: 300,
  });
  // 再挂一笔等会儿撤掉
  const toCancel = await sim.placeOrder({
    code: 'sh600000',
    side: 'B',
    kind: 'limit',
    price: 9900,
    qty: 1000,
  });
  clock.t = T(9, 40);
  await sim.ingest([quote('2026-10-26', T(9, 39, 57), 39900, 200000)]);
  // 批量调仓走同一个事务：失败的那次不进日志，成功的那次和单笔下单一样
  await expect(
    sim.transact(async engine => {
      engine.placeOrder(sim.now(), {
        code: 'sh600036',
        side: 'B',
        kind: 'limit',
        price: 39900,
        qty: 100,
      });
      throw new Error('预检失败');
    }),
  ).rejects.toThrow('预检失败');
  await sim.transact(async (engine, _tx, events) => {
    const r = engine.placeOrder(sim.now(), {
      code: 'sh600036',
      side: 'B',
      kind: 'limit',
      price: 39900,
      qty: 100,
    });
    events.push(...r.events);
  });
  if (toCancel.ok) {
    await sim.cancelOrder(toCancel.order.id);
  }
  // App 被杀后重新打开：从库里的状态接着跑
  clock.t = T(10, 5);
  sim = await Simulator.open(db, client, () => clock);
  sim.setWatchlist(['sh600036', 'sh600000']);
  // 成交价跌穿 39.80：排队的买单全部成交
  await sim.ingest([quote('2026-10-26', T(10, 4, 57), 39700, 400000)]);
  clock.t = T(10, 6);
  await sim.ingest([quote('2026-10-26', T(10, 5, 0), 39750, 401000)]);
  // 下一个交易日打开：先清算 10-26
  clock.date = '2026-10-27';
  clock.t = T(9, 0);
  sim = await Simulator.open(db, client, () => clock);
  await sim.tick();
  return { db, sim, pre, rest, toCancel };
}
