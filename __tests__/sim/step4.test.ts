/// <reference types="node" />
/**
 * M2 第 4 步的纯函数：费率表单、交割单校准表单、资金流水、设置校验。
 */
import { calcFee, DEFAULT_FEE_PROFILE, T, yuanToLi } from '../../src/engine';
import { makeEngine, snap } from '../engine/helpers/fixtures';
import {
  applySuggestion,
  compareSlip,
  EMPTY_SLIP,
  parseSlip,
  recognizeCode,
} from '../../src/sim/calibrateForm';
import {
  feeDiff,
  feeLabel,
  feeState,
  feeSummary,
  formOf,
  isMian5,
  parseFeeForm,
  parseWan,
  parseYuan,
  toggleMian5,
} from '../../src/sim/feeForm';
import { filterFlows, pendingFlows, summarizeFlows } from '../../src/sim/flows';
import { checkDepositCap } from '../../src/sim/settings';

const P = DEFAULT_FEE_PROFILE;

/** 入金 10 万 → 10-23 买入 1000 股 @40 → 10-26 卖出 @42。 */
function makeLedgerFixture() {
  const e = makeEngine('2026-10-23');
  e.deposit({ date: '2026-10-23', t: T(9, 0) }, 10_000_000);
  const trade = (date: string, side: 'B' | 'S', price: number) => {
    e.onSnapshot(
      snap({
        code: 'sh600036',
        date,
        t: T(10, 0),
        prev: 40,
        last: price,
        volume: 1_000_000,
        bids: [[price, 100_000]],
        asks: [[price, 100_000]],
      }),
    );
    const r = e.placeOrder(
      { date, t: T(10, 0, 1) },
      {
        code: 'sh600036',
        side,
        kind: 'limit',
        price: yuanToLi(price),
        qty: 1000,
      },
    );
    if (!r.ok || r.order.status !== '已成') {
      throw new Error('应该立即成交');
    }
  };
  trade('2026-10-23', 'B', 40);
  trade('2026-10-26', 'S', 42);
  return e.state;
}

describe('费率表单', () => {
  test('解析万分之几和元', () => {
    expect(parseWan('2.5')).toBe(25_000);
    expect(parseWan('0.854')).toBe(8_540);
    expect(parseWan('1.2345')).toBeNull();
    expect(parseYuan('0.1')).toBe(10);
    expect(parseYuan('400,000')).toBe(40_000_000);
    expect(parseYuan('1.234')).toBeNull();
  });

  test('默认费率的状态和文字', () => {
    expect(feeState(P, 'stock')).toBe('default');
    expect(feeSummary(P)).toBe(
      '默认费率：股票万 2.5、ETF 万 0.5，最低 5 元，还没用真实交割单校准',
    );
    expect(feeLabel(P, 'etf')).toBe(
      '佣金万 0.5、最低 5 元（默认费率，还没用真实交割单校准）',
    );
  });

  test('校验范围：佣金率不超过万 30，最低佣金 0–5 元', () => {
    const r = parseFeeForm({ ...formOf(P), stockWan: '31', etfMin: '6' }, P);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map(e => e.field)).toEqual(['stockWan', 'etfMin']);
      expect(r.errors[0].msg).toContain('万 30');
    }
  });

  test('免五开关改两个最低佣金', () => {
    const f = toggleMian5(formOf(P), true);
    expect([f.stockMin, f.etfMin]).toEqual(['0.1', '0.1']);
    expect(isMian5(f)).toBe(true);
    expect(toggleMian5(f, false).stockMin).toBe('5');
  });

  test('手动改股票费率清掉股票的「已校准」，改规费另收两个都清掉', () => {
    const cal = { ...P, calibratedStock: true, calibratedEtf: true };
    const a = parseFeeForm({ ...formOf(cal), stockWan: '1' }, cal);
    expect(a.ok && a.profile).toMatchObject({
      stockRate: 10_000,
      calibratedStock: false,
      calibratedEtf: true,
    });
    const b = parseFeeForm({ ...formOf(cal), regsSeparate: true }, cal);
    expect(b.ok && b.profile).toMatchObject({
      calibratedStock: false,
      calibratedEtf: false,
    });
    const c = parseFeeForm({ ...formOf(cal), mergeOrder: false }, cal);
    expect(c.ok && c.profile.calibratedStock).toBe(true);
  });

  test('差别一项一句', () => {
    const next = { ...P, stockRate: 10_000, stockMinFen: 10 };
    expect(feeDiff(P, next)).toEqual([
      '股票佣金率 万 2.5 → 万 1',
      '股票最低佣金 5 元 → 0.1 元',
    ]);
    expect(feeSummary(next)).toContain('股票万 1、最低 0.1 元（自定义）');
  });
});

describe('交割单校准表单', () => {
  test('识别代码', () => {
    expect(recognizeCode('600036')).toEqual({
      code: 'sh600036',
      board: 'main',
    });
    expect(recognizeCode('159915')).toEqual({ code: 'sz159915', board: 'etf' });
    expect(recognizeCode('510300')?.code).toBe('sh510300');
    expect(recognizeCode('830799')).toBeNull(); // 北交所不支持
  });

  const slip = {
    ...EMPTY_SLIP,
    code: '600036',
    side: 'S' as const,
    price: '41.80',
    qty: '1000',
    commission: '10.45',
    stamp: '20.90',
    transfer: '0.42',
  };

  test('一致', () => {
    const { parse, result } = compareSlip(slip, P);
    expect(parse.ok).toBe(true);
    expect(result?.allOk).toBe(true);
  });

  test('成交金额对不上时报错', () => {
    const r = parseSlip({ ...slip, amount: '41,900' }, false);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]).toMatchObject({ field: 'amount' });
      expect(r.errors[0].msg).toContain('41,800.00');
    }
  });

  test('一键套用后重新比对，全部一致就标记已校准', () => {
    const { parse, result } = compareSlip({ ...slip, commission: '4.18' }, P);
    if (!parse.ok || !result?.suggestion) {
      throw new Error('应该能推出费率');
    }
    const r = applySuggestion(parse.slip, P, result.suggestion);
    expect(r.result.allOk).toBe(true);
    expect(r.profile).toMatchObject({
      stockRate: 10_000,
      stockMinFen: 10,
      calibratedStock: true,
      calibratedEtf: false,
    });
    expect(
      calcFee({ board: 'main' }, 'S', 4_180_000, r.profile).commission,
    ).toBe(418);
  });

  test('规费另收时经手费、证管费必填', () => {
    const r = parseSlip(slip, true);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map(e => e.field)).toEqual(['handling', 'reg']);
    }
  });
});

describe('资金流水', () => {
  const st = makeLedgerFixture();

  test('从交割单派生：筛选和汇总', () => {
    expect(filterFlows(st.ledger, 'transfer').map(l => l.biz)).toEqual([
      '银行转证券',
    ]);
    expect(filterFlows(st.ledger, 'trade').map(l => l.biz)).toEqual([
      '证券卖出',
      '证券买入',
    ]);
    const s = summarizeFlows(st.ledger);
    expect(s.transferIn).toBe(10_000_000);
    expect(s.buy).toBe(4_000_000);
    expect(s.sell).toBe(4_200_000);
    expect(s.fee.total).toBe(st.ledger.reduce((a, l) => a + l.fee.total, 0));
    // 余额：最后一条交割单的余额 = 现金
    expect(st.ledger[0].balance).toBe(st.cash);
  });

  test('待发生：下一交易日扣红利税', () => {
    const p = pendingFlows(
      {
        ...st,
        pendingDivTax: [
          {
            code: 'sh600036',
            amount: 1234,
            sellDate: '2026-10-23',
            fillId: 1,
            notes: ['持股 1 个月以内，税负 20%'],
          },
        ],
      },
      () => '2026-10-26',
    );
    expect(p).toEqual([
      {
        kind: '股息红利税补',
        code: 'sh600036',
        net: -1234,
        when: '2026-10-26',
        note: '持股 1 个月以内，税负 20%',
      },
    ]);
  });
});

describe('累计净入金上限', () => {
  test('1 万–1,000 万，不能低于已转入', () => {
    expect(checkDepositCap('400000', 0)).toEqual({ ok: true, fen: 40_000_000 });
    expect(checkDepositCap('5000', 0).ok).toBe(false);
    expect(checkDepositCap('20000000', 0).ok).toBe(false);
    const r = checkDepositCap('100000', 20_000_000);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.msg).toContain('200,000.00');
  });
});
