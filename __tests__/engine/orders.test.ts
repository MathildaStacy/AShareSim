import {
  cageRange,
  DEFAULT_FEE_PROFILE,
  Liquidity,
  MAX_QUEUE_GAP_SEC,
  phaseAt,
  resolveAuction,
  stepResting,
  T,
  validateOrder,
  walkBook,
  yuanToLi,
  type OrderRequest,
  type ValidateContext,
} from '../../src/engine';
import { realSnap, security, snap } from './helpers/fixtures';

const li = yuanToLi;

function ctx(
  code: string,
  over: Partial<ValidateContext> = {},
): ValidateContext {
  return {
    sec: security(code)!,
    snap: snap({
      code,
      t: T(10, 0),
      prev: 10,
      last: 10,
      bids: [[9.99, 1000]],
      asks: [[10.0, 1000]],
    }),
    phase: 'cont',
    t: T(10, 0),
    isTradingDay: true,
    available: 100_000_000,
    sellable: 0,
    fee: DEFAULT_FEE_PROFILE,
    ...over,
  };
}
const buy = (
  code: string,
  price: number | null,
  qty: number,
  kind: OrderRequest['kind'] = 'limit',
): OrderRequest => ({
  code,
  side: 'B',
  kind,
  price: price == null ? null : li(price),
  qty,
});
const sell = (code: string, price: number, qty: number): OrderRequest => ({
  code,
  side: 'S',
  kind: 'limit',
  price: li(price),
  qty,
});

describe('下单校验（TRADING_RULES.md §3）', () => {
  test('申报单位', () => {
    expect(validateOrder(buy('sh600036', 10, 100), ctx('sh600036')).ok).toBe(
      true,
    );
    expect(
      validateOrder(buy('sh600036', 10, 150), ctx('sh600036')),
    ).toMatchObject({ ok: false, level: 'block', rule: '申报单位' });
    expect(
      validateOrder(buy('sh688981', 10, 199), ctx('sh688981')),
    ).toMatchObject({ ok: false, rule: '申报单位' });
    expect(validateOrder(buy('sh688981', 10, 201), ctx('sh688981')).ok).toBe(
      true,
    );
  });
  test('零股必须一次卖完', () => {
    const c = ctx('sh600036', { sellable: 250 });
    expect(validateOrder(sell('sh600036', 10, 50), c).ok).toBe(true);
    expect(validateOrder(sell('sh600036', 10, 250), c).ok).toBe(true);
    expect(validateOrder(sell('sh600036', 10, 200), c).ok).toBe(true);
    expect(validateOrder(sell('sh600036', 10, 120), c)).toMatchObject({
      ok: false,
      rule: '申报单位',
    });
    expect(
      validateOrder(
        sell('sh688981', 10, 150),
        ctx('sh688981', { sellable: 150 }),
      ).ok,
    ).toBe(true);
    expect(
      validateOrder(
        sell('sh688981', 10, 150),
        ctx('sh688981', { sellable: 300 }),
      ),
    ).toMatchObject({ ok: false, rule: '申报单位' });
  });
  test('T+1：可卖数量不够', () => {
    expect(
      validateOrder(
        sell('sh600036', 10, 100),
        ctx('sh600036', { sellable: 0 }),
      ),
    ).toMatchObject({ ok: false, rule: '可卖数量', lesson: 't1' });
  });
  test('最小价位', () => {
    expect(
      validateOrder(buy('sh600036', 10.005, 100), ctx('sh600036')),
    ).toMatchObject({ ok: false, rule: '最小价位' });
    const etf = ctx('sh510300', {
      snap: snap({
        code: 'sh510300',
        t: T(10, 0),
        prev: 4.178,
        last: 4.133,
        asks: [[4.134, 1000]],
      }),
    });
    expect(validateOrder(buy('sh510300', 4.134, 100), etf).ok).toBe(true);
  });
  test('涨跌停之外直接拦下', () => {
    expect(
      validateOrder(buy('sh600036', 11.01, 100), ctx('sh600036')),
    ).toMatchObject({ ok: false, level: 'block', rule: '涨跌幅限制' });
  });
  test('超出价格笼子是废单，不是拦下', () => {
    const r = validateOrder(
      sell('sh600036', 9.7, 100),
      ctx('sh600036', { sellable: 100 }),
    );
    expect(r).toMatchObject({ ok: false, level: 'reject', rule: '价格笼子' });
  });
  test('集合竞价阶段不查价格笼子', () => {
    expect(
      validateOrder(
        sell('sh600036', 9.7, 100),
        ctx('sh600036', { sellable: 100, phase: 'auc1', t: T(9, 16) }),
      ).ok,
    ).toBe(true);
  });
  test('资金不足', () => {
    expect(
      validateOrder(
        buy('sh600036', 10, 1000),
        ctx('sh600036', { available: 1_000_000 }),
      ),
    ).toMatchObject({ ok: false, rule: '可用资金' });
  });
  test('市价单只能在连续竞价，且按交易所区分类型', () => {
    const shBuy = (kind: OrderRequest['kind']) => ({
      ...buy('sh600036', null, 100, kind),
      protect: li(10.2),
    });
    // 沪市 2023 年起 4 种：最优五档剩撤、最优五档转限价、对手方最优、本方最优
    for (const k of ['b5_ioc', 'b5_limit', 'cbest', 'obest'] as const) {
      expect(validateOrder(shBuy(k), ctx('sh600036')).ok).toBe(true);
    }
    expect(validateOrder(shBuy('fok'), ctx('sh600036'))).toMatchObject({
      ok: false,
      rule: '委托类型',
    });
    expect(validateOrder(shBuy('ioc'), ctx('sh600036'))).toMatchObject({
      ok: false,
      rule: '委托类型',
    });
    expect(
      validateOrder(buy('sz000001', null, 100, 'cbest'), ctx('sz000001')).ok,
    ).toBe(true);
    expect(
      validateOrder(
        buy('sz000001', null, 100, 'cbest'),
        ctx('sz000001', { phase: 'auc1', t: T(9, 16) }),
      ),
    ).toMatchObject({
      ok: false,
      rule: '委托类型',
    });
  });
  test('沪市市价单必须带保护限价，深市不用', () => {
    expect(
      validateOrder(buy('sh600036', null, 100, 'b5_ioc'), ctx('sh600036')),
    ).toMatchObject({ ok: false, level: 'block', rule: '保护限价' });
    expect(
      validateOrder(
        { ...buy('sh600036', null, 100, 'b5_ioc'), protect: li(10.205) },
        ctx('sh600036'),
      ),
    ).toMatchObject({ ok: false, rule: '最小价位' });
    expect(
      validateOrder(buy('sz000001', null, 100, 'b5_ioc'), ctx('sz000001')).ok,
    ).toBe(true);
  });
  test('沪市市价买入按保护限价冻结资金，深市按涨停价', () => {
    // 沪市：10.20 × 1000 = 10,200 元 + 佣金 5 元 + 过户费 0.10 元；深市：涨停 11.00 × 1000 + 5 元 + 0.11 元
    const sh = {
      ...buy('sh600036', null, 1000, 'b5_ioc'),
      protect: li(10.2),
    };
    expect(
      validateOrder(sh, ctx('sh600036', { available: 1_020_510 })).ok,
    ).toBe(true);
    expect(
      validateOrder(sh, ctx('sh600036', { available: 1_020_509 })),
    ).toMatchObject({ ok: false, rule: '可用资金' });
    const sz = buy('sz000001', null, 1000, 'b5_ioc');
    const szCtx = (available: number) =>
      ctx('sz000001', {
        available,
        snap: snap({
          code: 'sz000001',
          t: T(10, 0),
          prev: 10,
          last: 10,
          bids: [[9.99, 1000]],
          asks: [[10.0, 1000]],
          up: 11,
          down: 9,
        }),
      });
    expect(validateOrder(sz, szCtx(1_100_511)).ok).toBe(true);
    expect(validateOrder(sz, szCtx(1_100_510)).ok).toBe(false);
  });
  test('沪市 ST 只能限价委托，深市 ST 可以用市价委托（2026-10-27 核对规则原文）', () => {
    // 深市规则没有限制风险警示股票的委托方式
    expect(
      validateOrder(buy('sz002024', null, 100, 'cbest'), ctx('sz002024')).ok,
    ).toBe(true);
    // 沪市交易规则第 4.4.9 条：风险警示股票应当采用限价委托
    const shSt = {
      code: 'sh600654',
      name: 'ST中安',
      exchange: 'SH' as const,
      board: 'main' as const,
      st: true,
    };
    expect(
      validateOrder(
        { ...buy('sh600654', null, 100, 'b5_ioc'), protect: li(10.2) },
        ctx('sh600036', { sec: shSt }),
      ),
    ).toMatchObject({ ok: false, rule: '委托类型', lesson: 'kinds' });
  });
  test('风险警示股票单日累计买入不超过 50 万股', () => {
    const c = (before: number) =>
      ctx('sz002024', { stBoughtToday: before, available: 1e12 });
    expect(validateOrder(buy('sz002024', 10, 500_000), c(0)).ok).toBe(true);
    expect(validateOrder(buy('sz002024', 10, 100_000), c(400_000)).ok).toBe(
      true,
    );
    expect(validateOrder(buy('sz002024', 10, 100), c(500_000))).toMatchObject({
      ok: false,
      rule: '风险警示股票买入上限',
      lesson: 'st',
    });
    // 卖出和非 ST 不受限制
    expect(
      validateOrder(
        buy('sz000001', 10, 600_000),
        ctx('sz000001', { available: 1e12 }),
      ).ok,
    ).toBe(true);
  });
  test('单笔上限：主板、ETF 100 万，不分限价市价；创业板 30 / 15 万；科创板 10 / 5 万', () => {
    const big = { available: 1e13 };
    expect(
      validateOrder(
        buy('sz000001', null, 1_000_000, 'cbest'),
        ctx('sz000001', big),
      ).ok,
    ).toBe(true);
    expect(
      validateOrder(buy('sz000001', 10, 1_000_100), ctx('sz000001', big)),
    ).toMatchObject({ ok: false, rule: '单笔上限' });
    expect(
      validateOrder(buy('sz159915', 10, 1_000_100), ctx('sz159915', big)),
    ).toMatchObject({ ok: false, rule: '单笔上限' });
    expect(
      validateOrder(
        buy('sz300750', null, 150_100, 'cbest'),
        ctx('sz300750', big),
      ),
    ).toMatchObject({ ok: false, rule: '单笔上限' });
    expect(
      validateOrder(buy('sz300750', 10, 300_000), ctx('sz300750', big)).ok,
    ).toBe(true);
  });
  test('盘后固定价格交易的申报时间：沪市 9:30 起、深市 9:15 起', () => {
    const at = (code: string, t: number) =>
      validateOrder(
        buy(code, null, 100, 'after'),
        ctx(code, { t, phase: phaseAt(t) }),
      );
    expect(at('sh600036', T(9, 20)).ok).toBe(false);
    expect(at('sz000001', T(9, 20)).ok).toBe(true);
    expect(at('sh600036', T(15, 10)).ok).toBe(true);
    expect(at('sh600036', T(15, 31)).ok).toBe(false);
  });
});

describe('价格笼子', () => {
  const s = (code: string, bid: number, ask: number) =>
    snap({
      code,
      t: T(10, 0),
      prev: 10,
      last: bid,
      bids: [[bid, 100]],
      asks: [[ask, 100]],
    });
  test('主板：2% 和 10 个价位取较宽', () => {
    expect(
      cageRange(security('sh600036')!, 'B', s('sh600036', 9.99, 10))!.max,
    ).toBe(li(10.2));
    expect(
      cageRange(security('sh600036')!, 'S', s('sh600036', 9.99, 10))!.min,
    ).toBe(li(9.8)); // 9.99 × 98% = 9.7902，最低有效价位是 9.80
    // 低价股：2 元的 2% 只有 0.04，按 10 个价位放宽到 0.10
    expect(
      cageRange(security('sh600036')!, 'B', s('sh600036', 1.99, 2))!.max,
    ).toBe(li(2.1));
  });
  test('科创板只有 2%', () => {
    expect(
      cageRange(security('sh688981')!, 'B', s('sh688981', 1.99, 2))!.max,
    ).toBe(li(2.04));
  });
  test('用真实盘口：招商银行 10:12 卖出 40.34 超出笼子', () => {
    const real = realSnap('sh600036', T(11, 30));
    const c = cageRange(security('sh600036')!, 'S', real)!;
    expect(c.base).toBe(real.bids[0][0]);
    expect(li(40.34)).toBeLessThan(c.min!);
  });
});

describe('撮合', () => {
  const book = snap({
    code: 'sh600036',
    t: T(10, 0),
    prev: 10,
    last: 10,
    bids: [
      [9.99, 300],
      [9.98, 500],
    ],
    asks: [
      [10.0, 200],
      [10.01, 300],
      [10.02, 1000],
    ],
  });
  test('按盘口逐档吃单，成交价是各档价格', () => {
    const plans = walkBook('B', 600, li(10.01), book, new Liquidity(), 2);
    expect(plans.map(p => [p.price, p.qty])).toEqual([
      [li(10.0), 200],
      [li(10.01), 300],
    ]);
    expect(plans[0].basis.text).toContain('卖1 10.00');
  });
  test('同一个快照里不重复吃同一档', () => {
    const liq = new Liquidity();
    liq.reset(book);
    walkBook('B', 200, li(10.0), book, liq, 2);
    expect(walkBook('B', 200, li(10.0), book, liq, 2)).toEqual([]);
  });
  test('排队：成交量增量先消耗前面的量', () => {
    const prev = snap({
      ...{ code: 'sh600036', t: T(10, 0), prev: 10, last: 10 },
      volume: 10_000,
      bids: [[9.99, 300]],
      asks: [[10, 100]],
    });
    const cur1 = snap({
      code: 'sh600036',
      t: T(10, 0, 3),
      prev: 10,
      last: 9.99,
      low: 9.99,
      volume: 10_200,
      bids: [[9.99, 400]],
      asks: [[10, 100]],
    });
    const r1 = stepResting(
      'B',
      li(9.99),
      100,
      300,
      prev,
      cur1,
      new Liquidity(),
      2,
    );
    expect(r1.plans).toEqual([]);
    expect(r1.queueAhead).toBe(100);
    const cur2 = snap({
      code: 'sh600036',
      t: T(10, 0, 6),
      prev: 10,
      last: 9.99,
      low: 9.99,
      volume: 10_350,
      bids: [[9.99, 300]],
      asks: [[10, 100]],
    });
    const r2 = stepResting(
      'B',
      li(9.99),
      100,
      r1.queueAhead,
      cur1,
      cur2,
      new Liquidity(),
      2,
    );
    expect(r2.plans.map(p => [p.price, p.qty])).toEqual([[li(9.99), 50]]);
  });
  test('成交价穿过委托价：全部成交，价格是委托价', () => {
    const prev = snap({
      code: 'sh600036',
      t: T(10, 0),
      prev: 10,
      last: 10,
      low: 9.99,
      volume: 10_000,
    });
    const cur = snap({
      code: 'sh600036',
      t: T(10, 0, 3),
      prev: 10,
      last: 9.97,
      low: 9.97,
      volume: 12_000,
      asks: [[9.98, 100]],
    });
    const r = stepResting(
      'B',
      li(9.98),
      500,
      9999,
      prev,
      cur,
      new Liquidity(),
      2,
    );
    expect(r.plans.reduce((a, p) => a + p.qty, 0)).toBe(100); // 卖一到了委托价，先按对手盘的量成交
    const cur2 = snap({
      code: 'sh600036',
      t: T(10, 0, 3),
      prev: 10,
      last: 9.97,
      low: 9.97,
      volume: 12_000,
      asks: [[9.99, 100]],
    });
    const r2 = stepResting(
      'B',
      li(9.98),
      500,
      9999,
      prev,
      cur2,
      new Liquidity(),
      2,
    );
    expect(r2.plans).toHaveLength(1);
    expect(r2.plans[0]).toMatchObject({
      price: li(9.98),
      qty: 500,
      basis: { rule: 'through' },
    });
  });
  test('涨停封板：按涨停价买入排在封单后面，通常不成交', () => {
    const prev = snap({
      code: 'sh600036',
      t: T(10, 0),
      prev: 10,
      last: 11,
      volume: 100_000,
      bids: [[11, 5_000_000]],
    });
    const cur = snap({
      code: 'sh600036',
      t: T(10, 0, 3),
      prev: 10,
      last: 11,
      volume: 130_000,
      bids: [[11, 5_100_000]],
    });
    const r = stepResting(
      'B',
      li(11),
      1000,
      5_000_000,
      prev,
      cur,
      new Liquidity(),
      2,
    );
    expect(r.plans).toEqual([]);
    expect(r.queueAhead).toBe(4_970_000);
  });
});

describe('集合竞价（§6.1）', () => {
  const after = (bids: [number, number][], asks: [number, number][], up = 11) =>
    snap({
      code: 'sh600036',
      t: T(9, 25, 3),
      prev: 10,
      open: 10.05,
      last: 10.05,
      volume: 50_000,
      bids,
      asks,
      up,
    });
  test('买价高于开盘价：按开盘价成交', () => {
    const r = resolveAuction(
      'B',
      li(10.1),
      1000,
      li(10.05),
      50_000,
      after([[10.04, 500]], [[10.06, 300]]),
      'open',
      2,
    );
    expect(r.plan).toMatchObject({ price: li(10.05), qty: 1000 });
  });
  test('等于开盘价、本方在开盘价还有剩余：保守不成交，排在剩余后面', () => {
    const r = resolveAuction(
      'B',
      li(10.05),
      1000,
      li(10.05),
      50_000,
      after([[10.05, 800]], [[10.06, 300]]),
      'open',
      2,
    );
    expect(r.plan).toBeNull();
    expect(r.queueAhead).toBe(800);
  });
  test('等于开盘价、对手方在开盘价有剩余：本方全部成交', () => {
    const r = resolveAuction(
      'B',
      li(10.05),
      1000,
      li(10.05),
      50_000,
      after([[10.04, 800]], [[10.05, 300]]),
      'open',
      2,
    );
    expect(r.plan).toMatchObject({ price: li(10.05), qty: 1000 });
  });
  test('一字涨停开盘：按涨停价买入不成交', () => {
    const s = snap({
      code: 'sh600036',
      t: T(9, 25, 3),
      prev: 10,
      open: 11,
      last: 11,
      volume: 50_000,
      bids: [[11, 9_000_000]],
    });
    const r = resolveAuction('B', li(11), 1000, li(11), 50_000, s, 'open', 2);
    expect(r.plan).toBeNull();
    expect(r.note).toContain('涨停');
  });
  test('没观察到竞价刚结束的行情（App 9:25 后才打开）：等于开盘价不成交，高于开盘价照常成交', () => {
    const late = snap({
      code: 'sh600036',
      t: T(10, 30),
      prev: 10,
      open: 10.05,
      last: 10.2,
      volume: 900_000,
      bids: [[10.19, 500]],
      asks: [[10.2, 300]],
    });
    const eq = resolveAuction(
      'B',
      li(10.05),
      1000,
      li(10.05),
      900_000,
      late,
      'open',
      2,
      false,
    );
    expect(eq.plan).toBeNull();
    expect(eq.note).toContain('没有观察到');
    const better = resolveAuction(
      'B',
      li(10.1),
      1000,
      li(10.05),
      900_000,
      late,
      'open',
      2,
      false,
    );
    expect(better.plan).toMatchObject({ price: li(10.05), qty: 1000 });
  });
});

describe('快照间隔太长（后台被停、用分时补撮合）', () => {
  const base = { code: 'sh600036', prev: 10, last: 9.99, low: 9.95 };
  test('间隔超过 MAX_QUEUE_GAP_SEC：不消耗排队', () => {
    const prev = snap({ ...base, t: T(10, 0), volume: 10_000 });
    const cur = snap({ ...base, t: T(10, 40), volume: 900_000 });
    const r = stepResting(
      'B',
      li(9.99),
      100,
      300,
      prev,
      cur,
      new Liquidity(),
      2,
    );
    expect(r.plans).toEqual([]);
    expect(r.queueAhead).toBe(300);
  });
  test('间隔多长都按「成交价穿过委托价」成交', () => {
    const prev = snap({ ...base, t: T(10, 0), volume: 10_000 });
    const cur = snap({ ...base, t: T(10, 40), last: 9.97, volume: 900_000 });
    const r = stepResting(
      'B',
      li(9.99),
      100,
      300,
      prev,
      cur,
      new Liquidity(),
      2,
    );
    expect(r.plans).toMatchObject([
      { price: li(9.99), qty: 100, basis: { rule: 'through' } },
    ]);
    expect(MAX_QUEUE_GAP_SEC).toBe(20);
  });
});
