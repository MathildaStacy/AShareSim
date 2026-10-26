import {
  DEFAULT_FEE_PROFILE,
  T,
  yuanToLi,
  type Holding,
} from '../../src/engine';
import {
  cancelState,
  defaultPrice,
  defaultProtect,
  estimate,
  kindOptions,
  maxBuy,
  parsePrice,
  parseQty,
  quickQty,
  sendText,
  stepPrice,
  stepQty,
  toRequest,
  cageHint,
  holdingNotes,
} from '../../src/sim/orderForm';
import { security, snap } from '../engine/helpers/fixtures';

const li = yuanToLi;
const zsyh = security('sh600036')!;
const kcb = security('sh688981')!;
const etf = security('sh510300')!;
const pa = security('sz000001')!;

const book = (code = 'sh600036') =>
  snap({
    code,
    t: T(10, 0),
    prev: 10,
    last: 10,
    bids: [
      [9.99, 400],
      [9.98, 1000],
    ],
    asks: [
      [10, 300],
      [10.01, 200],
    ],
  });

describe('输入解析', () => {
  test('价格按字符串转厘，不走浮点', () => {
    expect(parsePrice('10.23', 2)).toBe(10230);
    expect(parsePrice('4.135', 3)).toBe(4135);
    expect(parsePrice('10', 2)).toBe(10000);
    expect(parsePrice('10.', 2)).toBe(10000);
    expect(parsePrice('0.1', 3)).toBe(100);
    expect(parsePrice('10.235', 2)).toBeNull(); // 股票只有 2 位
    expect(parsePrice('', 2)).toBeNull();
    expect(parsePrice('abc', 2)).toBeNull();
  });
  test('数量', () => {
    expect(parseQty('1,000')).toBe(1000);
    expect(parseQty(' 200 ')).toBe(200);
    expect(parseQty('1.5')).toBeNull();
  });
  test('表单 → 请求：限价带价格；沪市市价带保护限价；深市市价不带', () => {
    expect(
      toRequest(
        {
          code: 'sh600036',
          side: 'B',
          kind: 'limit',
          price: '10.01',
          qty: '200',
          protect: '',
        },
        zsyh,
      ),
    ).toEqual({
      code: 'sh600036',
      side: 'B',
      kind: 'limit',
      price: 10010,
      protect: null,
      qty: 200,
    });
    expect(
      toRequest(
        {
          code: 'sh600036',
          side: 'B',
          kind: 'b5_ioc',
          price: '10.01',
          qty: '200',
          protect: '10.20',
        },
        zsyh,
      ),
    ).toMatchObject({ price: null, protect: 10200 });
    expect(
      toRequest(
        {
          code: 'sz000001',
          side: 'B',
          kind: 'cbest',
          price: '',
          qty: '100',
          protect: '10.20',
        },
        pa,
      ),
    ).toMatchObject({ price: null, protect: null });
  });
});

describe('委托类型', () => {
  test('沪市 4 种市价、深市 5 种，都有限价和盘后', () => {
    expect(kindOptions(zsyh).map(k => k.kind)).toEqual([
      'limit',
      'b5_ioc',
      'b5_limit',
      'cbest',
      'obest',
      'after',
    ]);
    expect(kindOptions(pa).map(k => k.kind)).toEqual([
      'limit',
      'cbest',
      'obest',
      'ioc',
      'b5_ioc',
      'fok',
      'after',
    ]);
  });
});

describe('默认值和加减', () => {
  test('买入默认卖一，卖出默认买一，没有盘口用最新价', () => {
    expect(defaultPrice('B', book())).toBe(li(10));
    expect(defaultPrice('S', book())).toBe(li(9.99));
    expect(
      defaultPrice(
        'B',
        snap({ code: 'sh600036', t: T(15, 10), prev: 10, last: 10.05 }),
      ),
    ).toBe(li(10.05));
  });
  test('± 一个价位，不超出涨跌停', () => {
    expect(stepPrice(li(10), 1, zsyh, book())).toBe(li(10.01));
    expect(stepPrice(li(4.13), -1, etf, null)).toBe(li(4.129));
    expect(stepPrice(li(11), 1, zsyh, book())).toBe(li(11)); // 涨停 11.00
  });
  test('± 一手，科创板买入不足 200 直接到 200', () => {
    expect(stepQty(null, 1, zsyh, 'B')).toBe(100);
    expect(stepQty(100, -1, zsyh, 'B')).toBe(0);
    expect(stepQty(null, 1, kcb, 'B')).toBe(200);
    expect(stepQty(250, 1, kcb, 'B')).toBe(350);
    expect(stepQty(250, -1, kcb, 'B')).toBe(0);
  });
  test('保护限价默认：买入卖一 × 102% 向下取，卖出买一 × 98% 向上取，不超出涨跌停', () => {
    expect(defaultProtect(zsyh, 'B', book())).toBe(li(10.2));
    expect(defaultProtect(zsyh, 'S', book())).toBe(li(9.8)); // 9.7902 → 9.80
    const nearUp = snap({
      code: 'sh600036',
      t: T(10, 0),
      prev: 10,
      last: 10.95,
      asks: [[10.95, 100]],
    });
    expect(defaultProtect(zsyh, 'B', nearUp)).toBe(li(11));
  });
});

describe('可买数量和仓位', () => {
  test('冻结金额（含费用）不超过可用：1 万元按 10 元买，最多 900 股', () => {
    // 1000 股要 10,000 + 5 + 0.10，超了；900 股 9,000 + 5 + 0.09 = 9,005.09
    expect(maxBuy(zsyh, li(10), 1_000_000, DEFAULT_FEE_PROFILE)).toBe(900);
    expect(maxBuy(zsyh, li(10), 1_000_510, DEFAULT_FEE_PROFILE)).toBe(1000);
    expect(maxBuy(zsyh, li(10), 100_000, DEFAULT_FEE_PROFILE)).toBe(0); // 1000 元买不起 1 手
    expect(maxBuy(zsyh, null, 1_000_000, DEFAULT_FEE_PROFILE)).toBe(0);
  });
  test('科创板 1 股递增，至少 200 股', () => {
    // 10,000 元按 50 元：199 股 9,950 + 5 + 0.10 ≤ 10,000；但不足 200 股不能买
    expect(maxBuy(kcb, li(50), 1_000_000, DEFAULT_FEE_PROFILE)).toBe(0);
    // 20,000 元按 50 元：399 股 19,950 + 5 + 0.20 = 19,955.20
    expect(maxBuy(kcb, li(50), 2_000_000, DEFAULT_FEE_PROFILE)).toBe(399);
  });
  test('单笔上限：主板限价 100 万股', () => {
    expect(maxBuy(zsyh, li(1), 10_000_000_000, DEFAULT_FEE_PROFILE)).toBe(
      1_000_000,
    );
  });
  test('快捷键：买入按可买分、卖出按可卖分；全仓卖出带零股', () => {
    expect(quickQty(2, 'B', zsyh, 900, 0)).toBe(400);
    expect(quickQty(3, 'B', zsyh, 900, 0)).toBe(300);
    expect(quickQty(4, 'B', zsyh, 300, 0)).toBe(0);
    expect(quickQty(1, 'S', zsyh, 0, 1050)).toBe(1050);
    expect(quickQty(2, 'S', zsyh, 0, 1050)).toBe(500);
    expect(quickQty(2, 'B', kcb, 399, 0)).toBe(0); // 199 不够 200
    expect(quickQty(2, 'S', kcb, 0, 450)).toBe(225);
  });
});

describe('预估', () => {
  test('限价买入：金额、费用、冻结', () => {
    const e = estimate(
      {
        code: 'sh600036',
        side: 'B',
        kind: 'limit',
        price: li(10),
        qty: 1000,
      },
      zsyh,
      book(),
      DEFAULT_FEE_PROFILE,
    );
    expect(e).toMatchObject({ amount: 1_000_000, freeze: 1_000_510 });
    expect(e.fee).toMatchObject({ commission: 500, transfer: 10, total: 510 });
  });
  test('卖出 10,000 元：佣金 5 + 印花税 5 + 过户费 0.10（规格 §4 的例子）', () => {
    const e = estimate(
      {
        code: 'sh600036',
        side: 'S',
        kind: 'limit',
        price: li(10),
        qty: 1000,
      },
      zsyh,
      book(),
      DEFAULT_FEE_PROFILE,
    );
    expect(e.fee.total).toBe(1010);
    expect(e.freeze).toBe(0);
  });
  test('市价买入按卖一估算金额，按保护限价冻结', () => {
    const e = estimate(
      {
        code: 'sh600036',
        side: 'B',
        kind: 'b5_ioc',
        price: null,
        protect: li(10.2),
        qty: 100,
      },
      zsyh,
      book(),
      DEFAULT_FEE_PROFILE,
    );
    expect(e).toMatchObject({ price: li(10), amount: 100_000 });
    expect(e.freezePrice).toBe(li(10.2));
    expect(e.freeze).toBe(102_000 + 500 + 1);
  });
});

describe('提示文字', () => {
  test('价格笼子只在连续竞价显示', () => {
    expect(cageHint(zsyh, 'B', book(), 'cont', true)?.bound).toBe(li(10.2));
    expect(cageHint(zsyh, 'S', book(), 'cont', true)?.bound).toBe(li(9.8));
    expect(cageHint(zsyh, 'B', book(), 'auc1', true)).toBeNull();
    expect(cageHint(etf, 'B', book('sh510300'), 'cont', true)).toBeNull(); // ETF ⚠️ 暂不校验
  });
  test('报送时间', () => {
    expect(sendText('store', 'pre', true)).toContain('9:15');
    expect(sendText('auction', 'auc2', true)).toContain('不能撤单');
    expect(sendText('nextDay', 'closed', true)).toContain('下一交易日');
    expect(sendText('store', 'pre', false)).toContain('休市');
    expect(sendText('after', 'cont', true)).toContain('15:05');
  });
  test('撤单：未报随时能撤，已报看时段', () => {
    expect(cancelState('未报', 'auc2', true).ok).toBe(true);
    expect(cancelState('已报', 'auc2', true)).toMatchObject({ ok: false });
    expect(cancelState('已报', 'auc2', true).why).toContain('9:20–9:25');
    expect(cancelState('部成', 'cont', true).ok).toBe(true);
    expect(cancelState('已报', 'cauc', true).ok).toBe(false);
  });
  test('可卖说明', () => {
    const h: Holding = {
      held: 500,
      sellable: 200,
      todayBuy: 200,
      frozenSell: 100,
    };
    expect(holdingNotes(h, '股')).toEqual([
      '今日买入 200 股要到下一交易日才能卖（T+1）',
      '已有卖单冻结 100 股',
    ]);
  });
});
