import {
  calcFee,
  DEFAULT_FEE_PROFILE,
  T,
  yuanToLi,
  type Fill,
  type Side,
} from '../../src/engine';
import { basisLines, feeLines, ratePct } from '../../src/sim/fillExplain';
import { security } from '../engine/helpers/fixtures';

const zsyh = security('sh600036')!;
const etf = security('sh510300')!;

function fill(
  code: string,
  side: Side,
  price: number,
  qty: number,
  profile = DEFAULT_FEE_PROFILE,
  fee?: Fill['fee'],
): Fill {
  const sec = security(code)!;
  const priceLi = yuanToLi(price);
  const amount = Math.round((priceLi * qty) / 10);
  const f = fee ?? calcFee(sec, side, amount, profile);
  return {
    id: 1,
    no: 'C200001',
    orderId: 1,
    code,
    side,
    price: priceLi,
    qty,
    amount,
    fee: f,
    net: side === 'B' ? -(amount + f.total) : amount - f.total,
    date: '2026-10-26',
    t: T(10, 0),
    basis: { rule: 'walk', snapT: T(10, 0), level: 1, levelQty: 500, text: '' },
  };
}

const byLabel = (lines: ReturnType<typeof feeLines>) =>
  Object.fromEntries(lines.map(l => [l.label, l]));

test('费率转百分比', () => {
  expect(ratePct(50_000)).toBe('0.05%');
  expect(ratePct(1_000)).toBe('0.001%');
  expect(ratePct(3_410)).toBe('0.00341%');
});

test('卖出 10,000 元股票：佣金 5.00 + 印花税 5.00 + 过户费 0.10（规格 §4 的例子）', () => {
  const l = byLabel(
    feeLines(fill('sh600036', 'S', 10, 1000), zsyh, DEFAULT_FEE_PROFILE, 2),
  );
  expect(l['成交金额']).toMatchObject({
    formula: '10.00 × 1,000',
    value: 1_000_000,
  });
  expect(l['佣金']).toMatchObject({
    formula: 'max(10,000.00 × 万 2.5, 最低 5.00 元)',
    value: 500,
  });
  expect(l['佣金'].note).toBeUndefined();
  expect(l['印花税']).toMatchObject({
    formula: '10,000.00 × 0.05%',
    value: 500,
  });
  expect(l['过户费']).toMatchObject({
    formula: '10,000.00 × 0.001%',
    value: 10,
  });
  expect(l['经手费']).toMatchObject({ value: null });
  expect(l['经手费'].formula).toContain('已含在佣金里');
  expect(l['费用合计'].value).toBe(1010);
  expect(l['资金增加'].value).toBe(1_000_000 - 1010);
});

test('ETF 买入：免印花税、过户费，用 ETF 佣金率', () => {
  const l = byLabel(
    feeLines(fill('sh510300', 'B', 4.13, 1000), etf, DEFAULT_FEE_PROFILE, 3),
  );
  expect(l['成交金额'].formula).toBe('4.130 × 1,000');
  expect(l['佣金'].formula).toContain('万 0.5');
  expect(l['佣金'].formula).toContain('ETF 费率');
  expect(l['印花税']).toMatchObject({ formula: 'ETF 免征', value: 0 });
  expect(l['过户费']).toMatchObject({ formula: 'ETF 免收', value: 0 });
  expect(l['资金减少'].value).toBe(413_000 + 500);
});

test('买入不收印花税；规费另收时列出经手费、证管费金额', () => {
  const profile = { ...DEFAULT_FEE_PROFILE, regsSeparate: true };
  const l = byLabel(
    feeLines(fill('sh600036', 'B', 40, 1000, profile), zsyh, profile, 2),
  );
  expect(l['印花税']).toMatchObject({ formula: '买入不收', value: 0 });
  // 40,000 × 0.00341% = 1.364 → 1.36；× 0.002% = 0.80
  expect(l['经手费']).toMatchObject({
    formula: '40,000.00 × 0.00341%',
    value: 136,
  });
  expect(l['证管费']).toMatchObject({ value: 80 });
});

test('合并计佣：这一笔佣金和单算不同时说明原因', () => {
  // 同一委托第二笔成交：前一笔已经收了 5 元最低佣金，这一笔只补差额
  const f = fill('sh600036', 'B', 10, 100, DEFAULT_FEE_PROFILE, {
    commission: 0,
    stamp: 0,
    transfer: 1,
    handling: 0,
    reg: 0,
    total: 1,
  });
  const l = byLabel(feeLines(f, zsyh, DEFAULT_FEE_PROFILE, 2));
  expect(l['佣金'].value).toBe(0);
  expect(l['佣金'].note).toContain('合并计佣');
  expect(l['佣金'].note).toContain('5.00');
});

test('成交依据的结构化字段', () => {
  const lines = basisLines(
    { rule: 'walk', snapT: T(10, 0, 3), level: 2, levelQty: 400, text: '' },
    'B',
    2,
    '股',
  );
  expect(lines).toEqual([
    { k: '依据', v: '主动成交（按盘口逐档吃单）' },
    { k: '快照时间', v: '10:00:03' },
    { k: '档位', v: '卖2' },
    { k: '该档挂单量', v: '400 股' },
  ]);
  const auc = basisLines(
    {
      rule: 'auction',
      snapT: T(9, 25),
      auctionPrice: 10010,
      auctionVolume: 1_200_000,
      text: '',
    },
    'S',
    2,
    '股',
  );
  expect(auc).toContainEqual({ k: '竞价价格', v: '10.01' });
  expect(auc).toContainEqual({ k: '竞价成交量', v: '1,200,000 股' });
});
