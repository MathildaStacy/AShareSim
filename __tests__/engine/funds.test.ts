import {
  calcFee,
  calibrate,
  checkTransfer,
  DEFAULT_FEE_PROFILE,
  inferRate,
  T,
  upgradeFeeProfile,
  upgradeState,
  withdrawable,
  yuanToLi,
  type FeeProfile,
} from '../../src/engine';
import { calendar, makeEngine, snap } from './helpers/fixtures';

const at = (date: string, t: number) => ({ date, t });
const MON = '2026-10-26';
const SAT = '2026-10-24';

describe('银证转账时间（PRODUCT_DESIGN §10）', () => {
  test('新账户第一笔入金不限时间，之后只能交易日 9:00–16:00', () => {
    const e = makeEngine(SAT);
    const st = e.state;
    expect(checkTransfer(st, calendar, at(SAT, T(20, 0)), 'in', 100)).toEqual({
      ok: true,
      firstDeposit: true,
    });
    e.deposit(at(SAT, T(20, 0)), 10_000_000);
    const again = checkTransfer(st, calendar, at(SAT, T(20, 1)), 'in', 100);
    expect(again).toMatchObject({ ok: false, rule: '银证转账时间' });
    expect(!again.ok && again.msg).toContain('休市日');
    expect(checkTransfer(st, calendar, at(MON, T(8, 59)), 'in', 100).ok).toBe(
      false,
    );
    expect(checkTransfer(st, calendar, at(MON, T(9, 0)), 'in', 100).ok).toBe(
      true,
    );
    expect(checkTransfer(st, calendar, at(MON, T(16, 0)), 'out', 100).ok).toBe(
      true,
    );
    expect(checkTransfer(st, calendar, at(MON, T(16, 1)), 'out', 100).ok).toBe(
      false,
    );
  });

  test('金额、上限、可取', () => {
    const e = makeEngine(MON);
    const now = at(MON, T(10, 0));
    expect(checkTransfer(e.state, calendar, now, 'in', 0)).toMatchObject({
      ok: false,
      rule: '金额',
    });
    expect(
      checkTransfer(e.state, calendar, now, 'in', 40_000_001),
    ).toMatchObject({ ok: false, rule: '模拟入金上限' });
    e.deposit(now, 1_000_000);
    // 挂一笔买单冻结资金：冻结的钱不能取
    e.onSnapshot(
      snap({
        code: 'sh600036',
        t: T(10, 0),
        prev: 40,
        last: 40,
        bids: [[39.99, 1000]],
        asks: [[40, 1000]],
      }),
    );
    const r = e.placeOrder(now, {
      code: 'sh600036',
      side: 'B',
      kind: 'limit',
      price: yuanToLi(39),
      qty: 100,
    });
    expect(r.ok).toBe(true);
    const w = withdrawable(e.state);
    expect(w).toBe(1_000_000 - e.state.frozen);
    const c = checkTransfer(e.state, calendar, now, 'out', w + 1);
    expect(c).toMatchObject({ ok: false, rule: '可取资金不足' });
    expect(!c.ok && c.msg).toContain('买入委托冻结了');
    expect(checkTransfer(e.state, calendar, now, 'out', w).ok).toBe(true);
  });
});

describe('改费率只对之后提交的委托生效', () => {
  test('已挂委托的冻结和成交费用按提交时的费率', () => {
    const e = makeEngine(MON);
    const now = at(MON, T(10, 0));
    e.deposit(now, 10_000_000);
    e.onSnapshot(
      snap({
        code: 'sh600036',
        t: T(10, 0),
        prev: 40,
        last: 40,
        volume: 1_000_000,
        bids: [[39.99, 1000]],
        asks: [[40, 1000]],
      }),
    );
    const old = e.placeOrder(now, {
      code: 'sh600036',
      side: 'B',
      kind: 'limit',
      price: yuanToLi(39.5),
      qty: 1000,
    });
    if (!old.ok) throw new Error(old.msg);
    const frozen = old.order.frozen;
    expect(frozen).toBe(3_950_000 + 988 + 40); // 万 2.5 = 9.88，过户费 0.40
    e.setFeeProfile({
      ...DEFAULT_FEE_PROFILE,
      stockRate: 10_000,
      stockMinFen: 10,
    });
    expect(e.state.orders[0].frozen).toBe(frozen);
    const neo = e.placeOrder(at(MON, T(10, 0, 5)), {
      code: 'sh600036',
      side: 'B',
      kind: 'limit',
      price: yuanToLi(39.5),
      qty: 1000,
    });
    if (!neo.ok) throw new Error(neo.msg);
    expect(neo.order.frozen).toBe(3_950_000 + 395 + 40); // 万 1
    // 成交价跌穿 39.5：两笔都按委托价成交，各按自己的费率收佣金
    e.onSnapshot(
      snap({
        code: 'sh600036',
        t: T(10, 0, 10),
        prev: 40,
        last: 39.4,
        volume: 1_100_000,
        bids: [[39.39, 1000]],
        asks: [[39.4, 1000]],
      }),
    );
    const fills = e.state.fills;
    expect(fills.find(f => f.orderId === old.order.id)!.fee.commission).toBe(
      988,
    );
    expect(fills.find(f => f.orderId === neo.order.id)!.fee.commission).toBe(
      395,
    );
  });
});

describe('旧数据升级', () => {
  test('一个 calibrated 字段 → 股票、ETF 分开', () => {
    const { calibratedStock, calibratedEtf, ...rest } = DEFAULT_FEE_PROFILE;
    expect(calibratedStock || calibratedEtf).toBe(false);
    const old = { ...rest, calibrated: true } as unknown as FeeProfile;
    expect(upgradeFeeProfile(old)).toEqual({
      ...rest,
      calibratedStock: true,
      calibratedEtf: true,
    });
    const st = makeEngine(MON).state;
    const legacy = { ...st, fee: old };
    expect(upgradeState(legacy).fee).not.toHaveProperty('calibrated');
  });
});

describe('交割单校准：反推费率', () => {
  const stock = { board: 'main' as const };
  const etf = { board: 'etf' as const };
  const P = DEFAULT_FEE_PROFILE;

  test('在区间里取最整的值', () => {
    // 41,800 元佣金 5.02：区间 [万 1.1998, 万 1.2022)，取万 1.2
    expect(inferRate(4_180_000, 502)).toMatchObject({ rate: 12_000 });
    // 100,000 元佣金 8.54：只有万 0.854 对得上
    expect(inferRate(10_000_000, 854)?.rate).toBe(8_540);
    // 找不到万分之 0.001 的整数倍时为 null
    expect(inferRate(100, 1)).toBeNull();
  });

  test('成交额太小时提示区间宽，换一条成交额更大的', () => {
    // 1,500 元的 ETF 免五，佣金 0.15：区间 [万 0.967, 万 1.033)
    const r = calibrate(
      {
        sec: etf,
        side: 'B',
        priceLi: yuanToLi(1.5),
        qty: 1000,
        commission: 15,
        stamp: 0,
        transfer: 0,
      },
      P,
    );
    expect(r.suggestion).toEqual({ etfRate: 10_000, etfMinFen: 10 });
    expect(r.note).toContain('免五');
    expect(r.note).toContain('成交额太小');
  });

  test('佣金正好 5 元：只能推出不高于万 x', () => {
    const r = calibrate(
      {
        sec: stock,
        side: 'B',
        priceLi: yuanToLi(10),
        qty: 3000,
        commission: 500,
        stamp: 0,
        transfer: 30,
      },
      { ...P, stockRate: 30_000 },
    );
    expect(r.suggestion).toBeNull();
    expect(r.note).toContain('不高于万 1.668');
  });

  test('规费另收时多比对经手费、证管费；ETF 一致时标记 ETF 已校准', () => {
    const profile = { ...P, regsSeparate: true };
    const amount = 4_180_000;
    const fee = calcFee(stock, 'S', amount, profile);
    const r = calibrate(
      {
        sec: stock,
        side: 'S',
        priceLi: yuanToLi(41.8),
        qty: 1000,
        commission: fee.commission,
        stamp: fee.stamp,
        transfer: fee.transfer,
        handling: fee.handling,
        reg: fee.reg + 1,
      },
      profile,
    );
    expect(r.items.map(i => i.key)).toEqual([
      'commission',
      'stamp',
      'transfer',
      'handling',
      'reg',
    ]);
    expect(r.allOk).toBe(false);
    expect(r.note).toContain('证管费对不上');
    const e = calibrate(
      {
        sec: etf,
        side: 'B',
        priceLi: yuanToLi(4.13),
        qty: 10_000,
        commission: 500,
        stamp: 0,
        transfer: 0,
      },
      P,
    );
    expect(e.allOk).toBe(true);
    expect(e.suggestion).toEqual({ calibratedEtf: true });
  });
});
