import {
  calcFee,
  calibrate,
  DEFAULT_FEE_PROFILE,
  divTaxRate,
  fillFee,
  MIAN5_MIN_FEN,
  yuanToLi,
  type FeeProfile,
} from '../../src/engine';

const stock = { board: 'main' as const };
const etf = { board: 'etf' as const };
const P = DEFAULT_FEE_PROFILE;

describe('费用（TRADING_RULES.md §4）', () => {
  test('规格里的例子：卖出 1 万元 = 佣金 5.00 + 印花税 5.00 + 过户费 0.10', () => {
    const f = calcFee(stock, 'S', 1_000_000, P);
    expect(f).toMatchObject({
      commission: 500,
      stamp: 500,
      transfer: 10,
      total: 1010,
    });
  });
  test('买入 1 万元不收印花税', () => {
    expect(calcFee(stock, 'B', 1_000_000, P)).toMatchObject({
      commission: 500,
      stamp: 0,
      transfer: 10,
      total: 510,
    });
  });
  test('卖出 41,800 元：佣金 10.45、印花税 20.90、过户费 0.42', () => {
    expect(calcFee(stock, 'S', 4_180_000, P)).toMatchObject({
      commission: 1045,
      stamp: 2090,
      transfer: 42,
    });
  });
  test('ETF 只收佣金', () => {
    expect(calcFee(etf, 'S', 9_046_000, P)).toMatchObject({
      commission: 500,
      stamp: 0,
      transfer: 0,
      total: 500,
    });
  });
  test('免五：2,000 元按费率收 0.50 元', () => {
    const f = calcFee(stock, 'B', 200_000, {
      ...P,
      stockMinFen: MIAN5_MIN_FEN,
    });
    expect(f.commission).toBe(50);
  });
  test('规费另收', () => {
    const f = calcFee(stock, 'B', 10_000_000, { ...P, regsSeparate: true });
    expect(f.handling).toBe(341); // 10 万 × 0.00341%
    expect(f.reg).toBe(200);
  });
  test('规费另收时 ETF：经手费 0.004%，不收证管费（2026-10-27 核对收费表）', () => {
    const f = calcFee(etf, 'S', 10_000_000, { ...P, regsSeparate: true });
    expect(f.handling).toBe(400); // 10 万 × 0.004%
    expect(f.reg).toBe(0);
    expect(f.stamp + f.transfer).toBe(0);
  });
  test('同一委托分两笔成交，最低 5 元只收一次', () => {
    const first = fillFee(stock, 'B', 0, 1_000_000, P);
    const second = fillFee(stock, 'B', 1_000_000, 1_000_000, P);
    expect(first.commission).toBe(500);
    expect(second.commission).toBe(0); // 累计 2 万元 × 万 2.5 = 5.00，已经收过
    expect(first.total + second.total).toBe(
      calcFee(stock, 'B', 2_000_000, P).total,
    );
    const separate: FeeProfile = { ...P, mergeOrder: false };
    expect(fillFee(stock, 'B', 1_000_000, 1_000_000, separate).commission).toBe(
      500,
    );
  });
});

describe('红利税', () => {
  test('三档税率', () => {
    expect(divTaxRate('2026-06-02', '2026-07-02').pct).toBe(20);
    expect(divTaxRate('2026-06-02', '2026-07-03').pct).toBe(10);
    expect(divTaxRate('2026-06-02', '2027-06-02').pct).toBe(10);
    expect(divTaxRate('2026-06-02', '2027-06-03').pct).toBe(0);
  });
});

describe('交割单校准', () => {
  const slip = {
    sec: stock,
    side: 'S' as const,
    priceLi: yuanToLi(41.8),
    qty: 1000,
    stamp: 2090,
    transfer: 42,
  };
  test('一致', () => {
    const r = calibrate({ ...slip, commission: 1045 }, P);
    expect(r.allOk).toBe(true);
    expect(r.suggestion).toEqual({ calibratedStock: true });
  });
  test('反推佣金率：5.02 元 → 万 1.20', () => {
    const r = calibrate({ ...slip, commission: 502 }, P);
    expect(r.allOk).toBe(false);
    expect(r.suggestion).toEqual({ stockRate: 12_000, stockMinFen: 500 });
    expect(
      calcFee(stock, 'S', r.amount, { ...P, ...r.suggestion }).commission,
    ).toBe(502);
  });
  test('佣金低于 5 元说明免五', () => {
    const r = calibrate({ ...slip, commission: 418 }, P);
    expect(r.suggestion).toEqual({
      stockRate: 10_000,
      stockMinFen: MIAN5_MIN_FEN,
    });
    expect(r.note).toContain('免五');
  });
  test('正好 5 元推不出费率', () => {
    // 41,800 元只收了 5 元：费率低于万 1.2 且触发了最低佣金，具体是多少推不出来
    const r = calibrate({ ...slip, commission: 500 }, P);
    expect(r.suggestion).toBeNull();
    expect(r.note).toContain('最低 5 元');
  });
});
