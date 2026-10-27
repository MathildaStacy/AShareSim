/**
 * M3 学习工具的纯逻辑：费用计算器、账户分析、数据练习的答案、小测状态。
 * 费用数字手算核对（TRADING_RULES.md §4 的费率），分析指标用小样本手算核对。
 */
import { newAccount } from '../../src/engine/account';
import { DEFAULT_FEE_PROFILE, ZERO_FEE } from '../../src/engine/fees';
import { T } from '../../src/engine/session';
import type {
  AccountState,
  Fill,
  LedgerEntry,
  Order,
} from '../../src/engine/types';
import { analyze, equitySeries } from '../../src/learn/analysis';
import {
  BIG_CAPS,
  longCsv,
  monthlyFees,
  rank20,
  seriesStats,
  stockSet,
  type DayBar,
} from '../../src/learn/datalab';
import { lessonById } from '../../src/learn/lessons';
import { lessonStatus } from '../../src/learn/progress';
import { evaluateAuto, isBroadEtf } from '../../src/learn/roadmap';
import { parseFeeCalc } from '../../src/sim/feeCalc';

describe('费用计算器', () => {
  it('股票：招商银行 40.00 × 1000，佣金按费率、卖出收印花税', () => {
    const r = parseFeeCalc(
      { code: '600036', price: '40', qty: '1000' },
      DEFAULT_FEE_PROFILE,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    const x = r.result;
    expect(x.code).toBe('sh600036');
    expect(x.amount).toBe(4_000_000);
    expect(x.buy.fee).toMatchObject({
      commission: 1000,
      stamp: 0,
      transfer: 40,
      total: 1040,
    });
    expect(x.sell.fee).toMatchObject({
      commission: 1000,
      stamp: 2000,
      transfer: 40,
      total: 3040,
    });
    expect(x.buy.minHit).toBe(false);
    expect(x.roundTrip).toBe(4080);
    // 40.04 卖出回款 40,009.57 < 买入花费 40,010.40；40.05 回款 40,019.56
    expect(x.breakEven).toBe(40_050);
    expect(x.minThreshold).toBe(2_000_000);
  });

  it('ETF：4.000 × 1000 只有 0.2 元佣金，按最低 5 元收，不收印花税和过户费', () => {
    const r = parseFeeCalc(
      { code: '510300', price: '4', qty: '1000' },
      DEFAULT_FEE_PROFILE,
    );
    if (!r.ok) {
      throw new Error('应当通过');
    }
    const x = r.result;
    expect(x.board).toBe('etf');
    expect(x.buy.fee.total).toBe(500);
    expect(x.sell.fee).toMatchObject({
      commission: 500,
      stamp: 0,
      transfer: 0,
    });
    expect(x.buy.minHit).toBe(true);
    expect(x.roundTripPct).toBeCloseTo(0.25, 6);
    expect(x.breakEven).toBe(4_010);
    expect(x.minThreshold).toBe(10_000_000);
  });

  it('规费另收时多出经手费、证管费两行', () => {
    const r = parseFeeCalc(
      { code: '600036', price: '40', qty: '1000' },
      { ...DEFAULT_FEE_PROFILE, regsSeparate: true },
    );
    if (!r.ok) {
      throw new Error('应当通过');
    }
    expect(r.result.sell.fee.handling).toBe(136); // 40,000 × 0.00341% = 1.364
    expect(r.result.sell.fee.reg).toBe(80);
    expect(r.result.sell.lines.map(l => l.label)).toContain('证管费');
  });

  it('校验：代码、价格、数量逐项报错', () => {
    const r = parseFeeCalc(
      { code: '12', price: '0', qty: '-1' },
      DEFAULT_FEE_PROFILE,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map(e => e.field)).toEqual(['code', 'price', 'qty']);
    }
  });
});

let seq = 1;
function entry(p: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: seq++,
    date: '2026-10-26',
    t: 0,
    biz: '证券买入',
    code: null,
    price: 0,
    qty: 0,
    amount: 0,
    fee: { ...ZERO_FEE },
    divTax: 0,
    net: 0,
    balance: 0,
    orderNo: '',
    fillNo: '',
    note: '',
    ...p,
  };
}

describe('账户分析', () => {
  const ledger = [
    entry({
      date: '2026-10-20',
      biz: '银行转证券',
      net: 10_000_000,
      balance: 10_000_000,
    }),
    entry({
      date: '2026-10-20',
      biz: '证券买入',
      code: 'sh600036',
      price: 40_000,
      qty: 1000,
      net: -4_001_040,
      balance: 5_998_960,
    }),
    entry({
      date: '2026-10-22',
      biz: '银行转证券',
      net: 1_000_000,
      balance: 6_998_960,
    }),
  ];
  const dates = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'];
  const closes = {
    sh600036: {
      '2026-10-20': 40_000,
      '2026-10-21': 41_000,
      '2026-10-22': 40_500,
    },
  };
  const bench = {
    '2026-10-19': 99,
    '2026-10-20': 100,
    '2026-10-21': 101,
    '2026-10-22': 100.5,
  };

  it('每天总资产 = 资金余额 + 持仓 × 不复权收盘价，从第一条交割单开始', () => {
    const eq = equitySeries(ledger, dates, closes);
    expect(eq.map(d => d.date)).toEqual(dates.slice(1));
    expect(eq.map(d => d.total)).toEqual([9_998_960, 10_098_960, 11_048_960]);
    expect(eq.map(d => d.flow)).toEqual([10_000_000, 0, 1_000_000]);
  });

  it('时间加权收益扣掉转入，指标按公式算', () => {
    const eq = equitySeries(ledger, dates, closes);
    const a = analyze(eq, bench, '沪深300')!;
    expect(a.n).toBe(2);
    expect(a.from).toBe('2026-10-20');
    const r2 = 10_098_960 / 9_998_960 - 1;
    const r3 = (11_048_960 - 1_000_000) / 10_098_960 - 1;
    expect(a.rp[0]).toBeCloseTo(r2, 12);
    expect(a.rp[1]).toBeCloseTo(r3, 12);
    expect(a.rb[0]).toBeCloseTo(0.01, 12);
    expect(a.rb[1]).toBeCloseTo(100.5 / 101 - 1, 12);
    const total = a.metrics.find(m => m.key === 'total')!;
    expect(total.raw).toBeCloseTo((1 + r2) * (1 + r3) - 1, 12);
    expect(a.tooFew).toBe(true);
    // 两个点的 Beta = 两段收益变化之比
    const beta = a.metrics.find(m => m.key === 'beta')!;
    expect(beta.raw).toBeCloseTo((r3 - r2) / (a.rb[1] - a.rb[0]), 10);
    for (const m of a.metrics) {
      expect(m.formula.length).toBeGreaterThan(0);
      expect(m.calc.length).toBeGreaterThan(0);
    }
  });

  it('只有一天时没有指标', () => {
    expect(
      analyze(equitySeries(ledger, dates.slice(0, 2), closes), bench, 'x'),
    ).toBeNull();
  });
});

const bar = (date: string, close: number, open = close): DayBar => ({
  date,
  open,
  close,
  high: close,
  low: close,
  volume: 1,
});

describe('数据练习的答案', () => {
  it('每年收益以上一年最后收盘为起点，第一年用第一天开盘价；最大回撤记起止日期', () => {
    const bars = [
      bar('2024-12-30', 100, 95),
      bar('2024-12-31', 110),
      bar('2025-06-30', 88),
      bar('2025-12-31', 99),
      bar('2026-10-26', 121),
    ];
    const s = seriesStats(bars, '2026-10-27')!;
    expect(s.years.map(y => [y.year, Number(y.ret.toFixed(6))])).toEqual([
      ['2024', Number((110 / 95 - 1).toFixed(6))],
      ['2025', -0.1],
      ['2026', Number((121 / 99 - 1).toFixed(6))],
    ]);
    expect(s.years[0].partialStart).toBe('2024-12-30');
    expect(s.years[2].toDate).toBe(true);
    expect(s.mdd).toBeCloseTo(-0.2, 10);
    expect([s.mddFrom, s.mddTo]).toEqual(['2024-12-31', '2025-06-30']);
    expect(s.roll250).toBeNull();
  });

  it('20 日收益排名：最新一天停牌的不参与，并列取平均名次', () => {
    const mk = (end: number, last = '2026-10-26') =>
      Array.from({ length: 21 }, (_, i) =>
        bar(
          i === 20 ? last : '2026-09-' + String(i + 1).padStart(2, '0'),
          i === 20 ? end : 10,
        ),
      );
    const r = rank20({
      sh600000: mk(11),
      sz000001: mk(12),
      sz000002: mk(11),
      sh600001: mk(15, '2026-10-23'),
    });
    expect(r.date).toBe('2026-10-26');
    expect(r.rows.map(x => [x.code, x.rank])).toEqual([
      ['sz000001', 1],
      ['sh600000', 2.5],
      ['sz000002', 2.5],
    ]);
  });

  it('交割单按月汇总费用，只算买卖', () => {
    const fee = (c: number, s: number) => ({
      ...ZERO_FEE,
      commission: c,
      stamp: s,
      total: c + s,
    });
    const rows = monthlyFees([
      entry({ date: '2026-09-30', biz: '证券买入', fee: fee(500, 0) }),
      entry({ date: '2026-10-08', biz: '证券卖出', fee: fee(500, 200) }),
      entry({ date: '2026-10-09', biz: '证券买入', fee: fee(600, 0) }),
      entry({ date: '2026-10-10', biz: '银行转证券' }),
    ]);
    expect(rows).toEqual([
      expect.objectContaining({ month: '2026-09', trades: 1, total: 500 }),
      expect.objectContaining({
        month: '2026-10',
        trades: 2,
        commission: 1100,
        stamp: 200,
        total: 1300,
      }),
    ]);
  });

  it('股票池：25 只大盘股 + 持仓和自选里的股票（不要 ETF），最多 30 只', () => {
    expect(BIG_CAPS).toHaveLength(25);
    expect(new Set(BIG_CAPS).size).toBe(25);
    const set = stockSet(
      ['sz159915', 'sh600000'],
      ['sh600036', 'sz002001', 'sz300001', 'sh688001', 'sz000002', 'sz000004'],
    );
    expect(set).toHaveLength(30);
    expect(set).toContain('sh600000');
    expect(set).not.toContain('sz159915');
    expect(set).not.toContain('sz000004');
  });

  it('长表 CSV 的代码是 6 位数字', () => {
    const csv = longCsv(
      { sh600036: [bar('2026-10-26', 40.123456)] },
      () => '招商,银行',
    );
    expect(csv.split('\n')).toEqual([
      'date,code,name,open,close,high,low,volume',
      '2026-10-26,600036,招商 银行,40.1235,40.1235,40.1235,40.1235,1',
    ]);
  });
});

describe('小测状态', () => {
  it('全部答对才算这一轮通过', () => {
    const fee = lessonById('fee')!;
    const ans = fee.quiz.map((q, i) => ({
      lesson: 'fee',
      q: i,
      choice: q.answer,
      correct: true,
      answeredAt: '',
    }));
    expect(lessonStatus(fee, ans).allCorrect).toBe(true);
    expect(lessonStatus(fee, ans.slice(1)).allCorrect).toBe(
      fee.quiz.length === 0,
    );
    expect(
      lessonStatus(fee, [{ ...ans[0], correct: false }, ...ans.slice(1)])
        .allCorrect,
    ).toBe(false);
  });
});

describe('路线图自动打勾', () => {
  const name = (c: string) =>
    ({ sh510300: '沪深300ETF', sh512880: '证券ETF' }[c] ?? c);
  const base = {
    nameOf: name,
    feeLessonPassed: false,
    auctionDemoDone: false,
  };
  function state(o: {
    code?: string;
    orderDate?: string;
    orderT?: number;
    rule?: 'auction' | 'walk';
    qty?: number;
  }): AccountState {
    const st = newAccount('2026-10-28');
    const code = o.code ?? 'sh510300';
    const qty = o.qty ?? 100;
    st.orders.push({
      id: 1,
      date: o.orderDate ?? '2026-10-28',
      t: o.orderT ?? T(9, 18),
      filled: qty,
    } as Order);
    st.fills.push({
      id: 2,
      orderId: 1,
      code,
      side: 'B',
      price: 4_812,
      qty,
      date: '2026-10-28',
      t: T(9, 25, 3),
      basis: { rule: o.rule ?? 'auction', snapT: T(9, 25, 3), text: '' },
    } as Fill);
    return st;
  }

  it('9:25 前提交、开盘集合竞价成交的宽基 ETF 买入，之后看过交割单才算完成', () => {
    const st = state({ orderDate: '2026-10-27', orderT: T(21, 0) });
    const notYet = evaluateAuto({
      ...base,
      states: [st],
      ledgerViewedAt: null,
    });
    expect(notYet['s0-e1'].done).toBe(false);
    expect(notYet['s0-e1'].missing).toEqual([
      '成交之后打开一次交割单（交易 → 交割单）',
    ]);
    const before = evaluateAuto({
      ...base,
      states: [st],
      ledgerViewedAt: '2026-10-28T09:20:00+08:00',
    });
    expect(before['s0-e1'].done).toBe(false);
    const done = evaluateAuto({
      ...base,
      states: [st],
      ledgerViewedAt: '2026-10-28T09:40:00+08:00',
    });
    expect(done['s0-e1'].done).toBe(true);
    expect(done['s0-e1'].basis).toContain('2026-10-27 21:00 提交的预埋单');
  });

  it('行业 ETF、连续竞价成交、不足 100 份都不算', () => {
    const viewed = '2026-10-29T00:00:00+08:00';
    for (const st of [
      state({ code: 'sh512880' }),
      state({ rule: 'walk' }),
      state({ orderT: T(9, 26) }),
    ]) {
      expect(
        evaluateAuto({ ...base, states: [st], ledgerViewedAt: viewed })['s0-e1']
          .done,
      ).toBe(false);
    }
    expect(isBroadEtf('华夏沪深300ETF')).toBe(true);
    expect(isBroadEtf('中证A500ETF')).toBe(true);
    expect(isBroadEtf('半导体ETF')).toBe(false);
  });

  it('归档账户里的成交也算（学习进度不随账户重置）', () => {
    const archived = state({});
    const current = newAccount('2026-10-30');
    const r = evaluateAuto({
      ...base,
      states: [current, archived],
      ledgerViewedAt: '2026-10-29T00:00:00+08:00',
    });
    expect(r['s0-e1'].done).toBe(true);
  });

  it('通关两项看小测和演示，校准项看费率', () => {
    const st = newAccount('2026-10-28');
    const r = evaluateAuto({
      states: [st],
      nameOf: name,
      ledgerViewedAt: null,
      feeLessonPassed: true,
      auctionDemoDone: true,
    });
    expect(r['s0-p0'].done && r['s0-p1'].done).toBe(true);
    expect(r['s0-e0'].done).toBe(false);
    st.fee.calibratedEtf = true;
    expect(
      evaluateAuto({ ...base, states: [st], ledgerViewedAt: null })['s0-e0']
        .basis,
    ).toContain('ETF');
  });
});
