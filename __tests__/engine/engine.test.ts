import {
  positions,
  T,
  withdrawable,
  yuanToLi,
  type Engine,
  type OrderRequest,
} from '../../src/engine';
import { makeEngine, snap } from './helpers/fixtures';

const li = yuanToLi;
const at = (date: string, t: number) => ({ date, t });
const limit = (
  code: string,
  side: 'B' | 'S',
  price: number,
  qty: number,
): OrderRequest => ({ code, side, kind: 'limit', price: li(price), qty });

function funded(date: string, yuan = 300_000): Engine {
  const e = makeEngine(date);
  expect(e.deposit(at(date, T(8, 0)), yuan * 100).ok).toBe(true);
  return e;
}

/** 在某天按某个价位直接买到一批股票（卖一挂足量）。 */
function buyAt(
  e: Engine,
  code: string,
  date: string,
  price: number,
  qty: number,
) {
  e.onSnapshot(
    snap({
      code,
      date,
      t: T(10, 0),
      prev: price,
      last: price,
      volume: 1_000_000,
      bids: [[price - 0.01, 10_000]],
      asks: [[price, 100_000]],
    }),
  );
  const r = e.placeOrder(at(date, T(10, 0, 1)), limit(code, 'B', price, qty));
  if (!r.ok) throw new Error(r.msg);
  expect(r.order.status).toBe('已成');
  return r.order;
}

describe('预埋单 → 开盘集合竞价 → T+1', () => {
  test('完整走一遍', () => {
    const e = funded('2026-10-26', 100_000);
    const r = e.placeOrder(
      at('2026-10-26', T(9, 0)),
      limit('sh600036', 'B', 10.1, 1000),
    );
    if (!r.ok) throw new Error(r.msg);
    const o = r.order;
    expect(o).toMatchObject({
      status: '未报',
      stage: 'stored',
      sendAt: T(9, 15),
    });
    expect(e.state.frozen).toBe(1_010_510); // 10,100 + 佣金 5.00 + 过户费 0.10

    e.onSnapshot(
      snap({
        code: 'sh600036',
        t: T(9, 15, 30),
        prev: 10,
        bids: [[10.02, 100]],
        asks: [[10.02, 70]],
      }),
    );
    expect(o).toMatchObject({
      status: '已报',
      stage: 'auction',
      auction: 'open',
    });

    const ev = e.onSnapshot(
      snap({
        code: 'sh600036',
        t: T(9, 25, 3),
        prev: 10,
        open: 10.05,
        last: 10.05,
        volume: 50_000,
        bids: [[10.04, 500]],
        asks: [[10.06, 300]],
      }),
    );
    expect(ev.map(x => x.type)).toEqual(['fill']);
    expect(o.status).toBe('已成');
    const f = e.state.fills[0];
    expect(f).toMatchObject({
      price: li(10.05),
      qty: 1000,
      amount: 1_005_000,
      t: T(9, 25),
    });
    expect(f.fee.total).toBe(510);
    expect(f.basis.rule).toBe('auction');
    expect(e.state.cash).toBe(10_000_000 - 1_005_510);
    expect(e.state.frozen).toBe(0);

    // T+1：今天买的不能卖
    expect(e.holding('sh600036')).toMatchObject({
      held: 1000,
      sellable: 0,
      todayBuy: 1000,
    });
    const s = e.placeOrder(
      at('2026-10-26', T(10, 0)),
      limit('sh600036', 'S', 10.05, 1000),
    );
    expect(s).toMatchObject({ ok: false, rule: '可卖数量' });

    // 下一交易日可以卖
    const ev2 = e.advance(at('2026-10-27', T(9, 0)));
    expect(ev2.map(x => x.type)).toContain('settle');
    expect(e.holding('sh600036')).toMatchObject({
      held: 1000,
      sellable: 1000,
      todayBuy: 0,
    });
  });
});

describe('连续竞价', () => {
  const book = (t: number, over: Partial<Parameters<typeof snap>[0]> = {}) =>
    snap({
      code: 'sz000001',
      t,
      prev: 11.2,
      last: 11.12,
      volume: 1_000_000,
      bids: [
        [11.11, 500],
        [11.1, 2000],
      ],
      asks: [
        [11.12, 300],
        [11.13, 400],
        [11.14, 5000],
      ],
      ...over,
    });

  test('逐档吃单、合并计佣、剩余挂单排队成交', () => {
    const e = funded('2026-10-26');
    e.onSnapshot(book(T(10, 0)));
    const r = e.placeOrder(
      at('2026-10-26', T(10, 0, 1)),
      limit('sz000001', 'B', 11.13, 1000),
    );
    if (!r.ok) throw new Error(r.msg);
    const o = r.order;
    expect(o.status).toBe('部成');
    expect(e.state.fills.map(f => [f.price, f.qty])).toEqual([
      [li(11.13), 400],
      [li(11.12), 300],
    ]);
    expect(o.fee.commission).toBe(500); // 两笔成交合计 7,788 元，最低 5 元只收一次
    expect(o.fee.transfer).toBe(8);
    expect(o.queueAhead).toBe(0); // 11.13 比买一更优，前面没有人
    expect(e.state.frozen).toBe(334_403); // 剩余 300 股 × 11.13 + 预估费用 5.03

    e.onSnapshot(
      book(T(10, 0, 3), {
        last: 11.13,
        volume: 1_000_500,
        bids: [[11.13, 200]],
        asks: [[11.14, 5000]],
      }),
    );
    expect(o.status).toBe('已成');
    expect(e.state.fills[0].basis.rule).toBe('queue');
    expect(o.amount).toBe(1_112_700);
    expect(o.fee.total).toBe(511);
    expect(e.state.cash).toBe(30_000_000 - 1_112_700 - 511);
    expect(e.state.frozen).toBe(0);
  });

  test('超出价格笼子是废单：不冻结、不收费', () => {
    const e = funded('2026-10-26');
    e.onSnapshot(book(T(10, 0)));
    const r = e.placeOrder(
      at('2026-10-26', T(10, 1)),
      limit('sz000001', 'B', 11.4, 1000),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.status).toBe('废单');
    expect(r.order.reason).toContain('价格笼子');
    expect(r.events.map(x => x.type)).toEqual(['reject']);
    expect(e.state.frozen).toBe(0);
    expect(e.state.cash).toBe(30_000_000);
  });

  test('撤单：连续竞价可撤，撤单释放冻结', () => {
    const e = funded('2026-10-26');
    e.onSnapshot(book(T(10, 0)));
    const r = e.placeOrder(
      at('2026-10-26', T(10, 1)),
      limit('sz000001', 'B', 11.05, 500),
    );
    if (!r.ok) throw new Error(r.msg);
    expect(e.state.frozen).toBeGreaterThan(0);
    expect(e.cancelOrder(at('2026-10-26', T(10, 5)), r.order.id).ok).toBe(true);
    expect(r.order.status).toBe('已撤');
    expect(e.state.frozen).toBe(0);
  });

  test('9:20–9:25 不能撤单，9:15–9:20 可以', () => {
    const e = funded('2026-10-26');
    const a = e.placeOrder(
      at('2026-10-26', T(9, 16)),
      limit('sz000001', 'B', 11.0, 100),
    );
    const b = e.placeOrder(
      at('2026-10-26', T(9, 17)),
      limit('sz000001', 'B', 11.0, 100),
    );
    if (!a.ok || !b.ok) throw new Error('place failed');
    expect(e.cancelOrder(at('2026-10-26', T(9, 18)), a.order.id).ok).toBe(true);
    const c = e.cancelOrder(at('2026-10-26', T(9, 21)), b.order.id);
    expect(c).toMatchObject({ ok: false, lesson: 'time' });
  });

  test('收盘未成交的委托在清算时由系统撤销', () => {
    const e = funded('2026-10-26');
    e.onSnapshot(book(T(10, 0)));
    const r = e.placeOrder(
      at('2026-10-26', T(10, 1)),
      limit('sz000001', 'B', 11.0, 500),
    );
    if (!r.ok) throw new Error(r.msg);
    const ev = e.advance(at('2026-10-26', T(15, 30)));
    expect(r.order).toMatchObject({
      status: '已撤',
      reason: '当日有效，收盘后未成交部分由系统撤销',
    });
    expect(ev.find(x => x.type === 'settle')).toMatchObject({ canceled: 1 });
    expect(e.state.frozen).toBe(0);
  });
});

describe('收盘集合竞价和盘后固定价格交易', () => {
  test('连续竞价没成交的挂单参加收盘集合竞价', () => {
    const e = funded('2026-10-26');
    const s = (t: number, last: number, volume: number) =>
      snap({
        code: 'sh600036',
        t,
        prev: 10,
        last,
        volume,
        bids: [[last - 0.01, 1000]],
        asks: [[last, 1000]],
      });
    e.onSnapshot(s(T(14, 50), 10.05, 100_000));
    const r = e.placeOrder(
      at('2026-10-26', T(14, 50, 1)),
      limit('sh600036', 'B', 10.0, 1000),
    );
    if (!r.ok) throw new Error(r.msg);
    expect(r.order.status).toBe('已报');
    e.onSnapshot(s(T(14, 56), 10.04, 110_000));
    e.onSnapshot(s(T(14, 58), 10.04, 110_000));
    expect(r.order).toMatchObject({ stage: 'auction', auction: 'close' });
    // 收盘价 9.98，低于委托价 10.00：按收盘价成交
    e.onSnapshot(
      snap({
        code: 'sh600036',
        t: T(15, 0, 2),
        prev: 10,
        last: 9.98,
        low: 9.98,
        volume: 140_000,
        bids: [[9.97, 500]],
        asks: [[9.98, 800]],
      }),
    );
    expect(r.order.status).toBe('已成');
    expect(e.state.fills[0]).toMatchObject({
      price: li(9.98),
      t: T(15, 0),
      basis: { rule: 'auction', auctionVolume: 30_000 },
    });
  });

  test('盘后固定价格交易按收盘价成交', () => {
    const e = funded('2026-10-26');
    e.onSnapshot(
      snap({
        code: 'sh600036',
        t: T(14, 0),
        prev: 10,
        last: 10.02,
        volume: 100_000,
      }),
    );
    const r = e.placeOrder(at('2026-10-26', T(14, 0, 5)), {
      code: 'sh600036',
      side: 'B',
      kind: 'after',
      price: null,
      qty: 1000,
    });
    if (!r.ok) throw new Error(r.msg);
    expect(r.order.stage).toBe('after');
    e.onSnapshot(
      snap({
        code: 'sh600036',
        t: T(15, 0, 5),
        prev: 10,
        last: 10.03,
        volume: 150_000,
      }),
    );
    expect(r.order.filled).toBe(0); // 15:05 才开始撮合
    e.onSnapshot(
      snap({
        code: 'sh600036',
        t: T(15, 6),
        prev: 10,
        last: 10.03,
        volume: 155_000,
      }),
    );
    expect(r.order.status).toBe('已成');
    expect(e.state.fills[0]).toMatchObject({
      price: li(10.03),
      basis: { rule: 'after' },
    });
  });
});

describe('市价委托', () => {
  const s = (code: string) =>
    snap({
      code,
      t: T(10, 0),
      prev: 10,
      last: 10,
      volume: 1_000_000,
      bids: [[9.99, 400]],
      asks: [
        [10, 300],
        [10.01, 200],
      ],
    });

  test('最优五档即时成交剩余撤销：成交 500，剩余撤销，按涨停价冻结后全部释放', () => {
    const e = funded('2026-10-26');
    e.onSnapshot(s('sh600036'));
    const r = e.placeOrder(at('2026-10-26', T(10, 0, 1)), {
      code: 'sh600036',
      side: 'B',
      kind: 'b5_ioc',
      price: null,
      qty: 1000,
    });
    if (!r.ok) throw new Error(r.msg);
    expect(r.order).toMatchObject({ status: '部撤', filled: 500 });
    expect(e.state.frozen).toBe(0);
  });
  test('全额成交或撤销：量不够整笔撤销', () => {
    const e = funded('2026-10-26');
    e.onSnapshot(s('sz000001'));
    const r = e.placeOrder(at('2026-10-26', T(10, 0, 1)), {
      code: 'sz000001',
      side: 'B',
      kind: 'fok',
      price: null,
      qty: 1000,
    });
    if (!r.ok) throw new Error(r.msg);
    expect(r.order).toMatchObject({ status: '已撤', filled: 0 });
  });
  test('对手方最优：按卖一价成交，剩余按卖一价挂单', () => {
    const e = funded('2026-10-26');
    e.onSnapshot(s('sz000001'));
    const r = e.placeOrder(at('2026-10-26', T(10, 0, 1)), {
      code: 'sz000001',
      side: 'B',
      kind: 'cbest',
      price: null,
      qty: 1000,
    });
    if (!r.ok) throw new Error(r.msg);
    expect(r.order).toMatchObject({
      status: '部成',
      filled: 300,
      price: li(10),
    });
  });
});

describe('资金', () => {
  test('累计净入金上限 40 万', () => {
    const e = makeEngine('2026-10-26');
    expect(e.deposit(at('2026-10-26', T(9, 0)), 40_000_000).ok).toBe(true);
    expect(e.deposit(at('2026-10-26', T(9, 1)), 1).ok).toBe(false);
  });
});

describe('红利税（招商银行示例）', () => {
  test('持股 1 个月到 1 年，卖出后下一交易日补扣 10%', () => {
    const e = funded('2026-06-01');
    e.setCorporateActions([
      {
        code: 'sh600036',
        recordDate: '2026-07-09',
        exDate: '2026-07-10',
        payDate: '2026-07-10',
        cashPerShareLi: 2000,
        bonusPerShare: 0,
      },
    ]);
    buyAt(e, 'sh600036', '2026-06-02', 40, 2000);
    expect(e.state.cash).toBe(30_000_000 - 8_002_080);

    const ev = e.advance(at('2026-07-10', T(9, 0)));
    expect(ev.find(x => x.type === 'dividend')).toMatchObject({
      amount: 400_000,
    });
    expect(e.state.ledger[0]).toMatchObject({ biz: '股息入账', net: 400_000 });

    e.onSnapshot(
      snap({
        code: 'sh600036',
        date: '2026-10-26',
        t: T(10, 0),
        prev: 42,
        last: 42,
        volume: 1_000_000,
        bids: [[42, 5000]],
        asks: [[42.01, 5000]],
      }),
    );
    const r = e.placeOrder(
      at('2026-10-26', T(10, 0, 1)),
      limit('sh600036', 'S', 42, 2000),
    );
    if (!r.ok) throw new Error(r.msg);
    const f = e.state.fills[0];
    expect(f.fee).toMatchObject({
      commission: 2100,
      stamp: 4200,
      transfer: 84,
      total: 6384,
    });
    expect(f.divTaxPending).toBe(40_000);
    const cash = 30_000_000 - 8_002_080 + 400_000 + 8_393_616;
    expect(e.state.cash).toBe(cash);
    expect(withdrawable(e.state)).toBe(cash - 8_393_616); // 当天卖出的钱可用不可取
    expect(e.state.costs.sh600036).toBeUndefined(); // 清仓后成本归零

    const ev2 = e.advance(at('2026-10-27', T(9, 0)));
    expect(ev2.find(x => x.type === 'divTax')).toMatchObject({
      amount: 40_000,
    });
    expect(e.state.ledger[0]).toMatchObject({
      biz: '股息红利税补',
      divTax: 40_000,
      net: -40_000,
    });
    expect(e.state.cash).toBe(cash - 40_000);
    expect(withdrawable(e.state)).toBe(cash - 40_000);
  });

  test('持股 1 个月以内卖出补扣 20%', () => {
    const e = funded('2026-06-25');
    e.setCorporateActions([
      {
        code: 'sh600036',
        recordDate: '2026-07-09',
        exDate: '2026-07-10',
        payDate: '2026-07-10',
        cashPerShareLi: 1000,
        bonusPerShare: 0,
      },
    ]);
    buyAt(e, 'sh600036', '2026-06-26', 40, 1000);
    e.onSnapshot(
      snap({
        code: 'sh600036',
        date: '2026-07-15',
        t: T(10, 0),
        prev: 40,
        last: 40,
        volume: 1_000_000,
        bids: [[40, 5000]],
      }),
    );
    e.placeOrder(
      at('2026-07-15', T(10, 0, 1)),
      limit('sh600036', 'S', 40, 1000),
    );
    expect(e.state.fills[0].divTaxPending).toBe(20_000); // 1,000 元红利 × 20%
  });
});

describe('持仓成本两种口径（TRADING_RULES.md §5）', () => {
  test('卖出盈利让摊薄成本下降，买入均价不变', () => {
    const e = funded('2026-10-21');
    buyAt(e, 'sh600036', '2026-10-21', 10, 1000); // 10,005.10
    buyAt(e, 'sh600036', '2026-10-22', 12, 1000); // 12,005.12
    e.onSnapshot(
      snap({
        code: 'sh600036',
        date: '2026-10-23',
        t: T(10, 0),
        prev: 13,
        last: 13,
        volume: 1_000_000,
        bids: [[13, 5000]],
      }),
    );
    e.placeOrder(
      at('2026-10-23', T(10, 0, 1)),
      limit('sh600036', 'S', 13, 1000),
    ); // 净回款 12,988.37
    const [p] = positions(e.state, () => li(13));
    expect(p.qty).toBe(1000);
    expect(p.averagePrice).toBe(li(11.005)); // (10,005.10 + 12,005.12) / 2,000
    expect(p.dilutedCost).toBe(2_201_022 - 1_298_837);
    expect(p.dilutedPrice).toBe(li(9.022));
  });

  test('送转股：股数增加、成本不变，买入均价按比例下降', () => {
    const e = funded('2026-06-01');
    e.setCorporateActions([
      {
        code: 'sh600036',
        recordDate: '2026-07-09',
        exDate: '2026-07-10',
        payDate: '2026-07-10',
        cashPerShareLi: 0,
        bonusPerShare: 0.5,
      },
    ]);
    buyAt(e, 'sh600036', '2026-06-02', 10, 1000);
    const ev = e.advance(at('2026-07-10', T(9, 0)));
    expect(ev.find(x => x.type === 'bonus')).toMatchObject({ qty: 500 });
    const [p] = positions(e.state, () => li(6.7));
    expect(p.qty).toBe(1500);
    expect(p.averageCost).toBe(1_000_510);
    expect(p.averagePrice).toBe(6670);
  });
});

describe('跨日和节假日', () => {
  test('9 月 30 日收盘后的委托在 10 月 8 日 9:15 报送', () => {
    const e = funded('2026-09-30');
    const r = e.placeOrder(
      at('2026-09-30', T(16, 0)),
      limit('sh600036', 'B', 10, 100),
    );
    if (!r.ok) throw new Error(r.msg);
    expect(r.order).toMatchObject({
      status: '未报',
      sendDate: '2026-10-08',
      sendAt: T(9, 15),
    });
    e.advance(at('2026-10-05', T(10, 0)));
    expect(r.order.status).toBe('未报'); // 假期里清算不能把它撤掉
    e.advance(at('2026-10-08', T(9, 16)));
    expect(r.order).toMatchObject({ status: '已报', stage: 'auction' });
  });
  test('周末下单', () => {
    const e = funded('2026-10-23');
    const r = e.placeOrder(
      at('2026-10-24', T(11, 0)),
      limit('sh600036', 'B', 10, 100),
    );
    if (!r.ok) throw new Error(r.msg);
    expect(r.order.sendDate).toBe('2026-10-26');
  });
});
