/// <reference types="node" />
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import { T } from '../../src/engine/session';
import { TradingCalendar } from '../../src/engine/calendar';
import { newAccount } from '../../src/engine/account';
import { Engine } from '../../src/engine/engine';
import {
  checkRisk,
  equityOf,
  invalidRisk,
  riskText,
  turnoverToday,
} from '../../src/engine/risk';
import type { Snapshot } from '../../src/engine/types';
import type { Security } from '../../src/engine/securities';
import type { MarketClient } from '../../src/market/client';
import type { KBar, Quote } from '../../src/market/tencent';
import { Simulator } from '../../src/sim/simulator';
import { PortfolioService } from '../../src/portfolio/service';
import { DEFAULT_STRATEGY } from '../../src/portfolio/types';
import { loadRebalance, saveStrategy } from '../../src/portfolio/repo';
import {
  createProposal,
  decideProposal,
  executeProposal,
  invalidProposal,
  refreshReviews,
  replanProposal,
  scorecard,
  writeJournal,
  type ProposalInput,
} from '../../src/advice/service';
import * as advice from '../../src/advice/repo';
import { closeOn, datesOf, isDue, reviewOf } from '../../src/advice/score';

const cal = new TradingCalendar();
const snap = (code: string, over: Partial<Snapshot> = {}): Snapshot => ({
  code,
  date: '2026-10-26',
  t: T(9, 0),
  prevClose: 10000,
  last: 10000,
  open: 10000,
  high: 10000,
  low: 10000,
  volume: 100000,
  amount: 100000000,
  bids: [[9990, 10000]],
  asks: [[10010, 10000]],
  up: 11000,
  down: 9000,
  ...over,
});
const NAMES: Record<string, string> = {
  sh600036: '招商银行',
  sz000001: '平安银行',
  sz002024: 'ST易购',
  sh510300: '沪深300ETF',
};
const sec = (code: string): Security => ({
  code,
  name: NAMES[code] ?? code,
  exchange: code.startsWith('sh') ? 'SH' : 'SZ',
  board: code === 'sh510300' ? 'etf' : 'main',
  st: code === 'sz002024',
});
const quote = (s: Snapshot): Quote => ({
  snapshot: s,
  info: {
    code: s.code,
    name: NAMES[s.code] ?? s.code,
    type: s.code === 'sh510300' ? 'ETF' : 'GP-A',
    change: 0,
    pct: 0,
    turnover: 0,
    amplitude: 0,
    volumeRatio: 0,
    pe: 0,
    pb: 0,
    floatCap: 0,
    totalCap: 0,
    outer: 0,
    inner: 0,
  },
});
const bar = (date: string, close: number): KBar =>
  ({ date, open: close, close, high: close, low: close, volume: 1 } as KBar);

function engineWith(cash: number) {
  const st = newAccount('2026-10-26');
  st.cash = cash;
  const e = new Engine(st, { calendar: cal, security: sec });
  ['sh600036', 'sz000001', 'sz002024'].forEach(c => e.primeSnapshot(snap(c)));
  return e;
}
const buy = (code: string, qty: number, price = 10) => ({
  code,
  side: 'B' as const,
  kind: 'limit' as const,
  price: price * 1000,
  protect: null,
  qty,
});
const now = { date: '2026-10-26', t: T(9, 0) };

describe('风险限额', () => {
  test('默认关闭；范围校验和文字', () => {
    const e = engineWith(1_000_000_00);
    expect(e.check(now, buy('sh600036', 100000)).ok).toBe(false); // 资金不够
    expect(e.check(now, buy('sh600036', 10000)).ok).toBe(true);
    expect(
      invalidRisk({ maxWeight: 1.2, maxTurnover: null, noSt: false }),
    ).toMatch('单票上限');
    expect(riskText({ maxWeight: 0.3, maxTurnover: 0.5, noSt: true })).toBe(
      '单票上限 30% · 单日换手上限 50% · 禁买 ST',
    );
  });

  test('单票上限按买入后（含未成交买单）占总资产算，只拦买入', () => {
    const e = engineWith(1_000_000_00); // 100 万
    e.setRiskLimits({ maxWeight: 0.3, maxTurnover: null, noSt: false });
    const ok = e.check(now, buy('sh600036', 20000)); // 20 万 = 20%
    expect(ok.ok).toBe(true);
    const placed = e.placeOrder(now, buy('sh600036', 20000));
    expect(placed.ok).toBe(true);
    const over = e.check(now, buy('sh600036', 20000)); // 再 20 万 → 40%
    expect(over).toMatchObject({ ok: false, level: 'block', rule: '风险限额' });
    expect((over as { msg: string }).msg).toContain('约占总资产 40%');
    // 别的证券不受影响
    expect(e.check(now, buy('sz000001', 20000)).ok).toBe(true);
  });

  test('禁买 ST、单日换手上限；卖出不拦', () => {
    const e = engineWith(1_000_000_00);
    e.setRiskLimits({ maxWeight: null, maxTurnover: 0.25, noSt: true });
    expect(e.check(now, buy('sz002024', 100))).toMatchObject({
      ok: false,
      rule: '风险限额',
    });
    expect(e.placeOrder(now, buy('sh600036', 20000)).ok).toBe(true);
    expect(turnoverToday(e.state, now.date)).toBe(200_000_00);
    const r = checkRisk({
      state: e.state,
      sec: sec('sz000001'),
      req: buy('sz000001', 10000),
      date: now.date,
      snap: null,
      priceOf: () => 10000,
    });
    expect(r.ok).toBe(false);
    expect(r.text).toContain('单日换手上限 25%');
    const sell = checkRisk({
      state: e.state,
      sec: sec('sz000001'),
      req: { ...buy('sz000001', 10000), side: 'S' },
      date: now.date,
      snap: null,
      priceOf: () => 10000,
    });
    expect(sell).toMatchObject({ ok: true, text: '卖出不受风险限额限制' });
  });

  test('没有行情的持仓按买入均价成本估总资产', () => {
    const st = newAccount('2026-10-26');
    st.cash = 100;
    st.lots.push({
      id: 1,
      code: 'sh600036',
      qty: 100,
      buyDate: '2026-10-20',
      dividend: 0,
    });
    st.costs.sh600036 = { diluted: 99_000, average: 100_000 };
    expect(equityOf(st, () => null)).toBe(100_100);
    expect(equityOf(st, () => 12_000)).toBe(100 + 120_000);
  });
});

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  const clock = { date: '2026-10-26', t: T(9, 0) };
  const bars: Record<string, KBar[]> = {};
  const client = {
    quotes: async (codes: string[]) =>
      codes.map(c => quote(snap(c, { date: clock.date, t: clock.t }))),
    corporateActions: async () => [],
    klineRange: async (code: string) => {
      if (!bars[code]) {
        throw new Error('no data');
      }
      return bars[code];
    },
  } as unknown as MarketClient;
  const sim = await Simulator.open(db, client, () => clock);
  await sim.deposit(300_000_00); // 30 万（默认入金上限 40 万）
  const d = { db, sim, client };
  return { db, clock, client, sim, d, bars };
}

const rebalanceInput = (over: Partial<ProposalInput> = {}): ProposalInput => ({
  threadId: 1,
  kind: 'rebalance',
  items: [
    {
      code: 'sh600036',
      name: '招商银行',
      stance: 'buy',
      weight: 0.2,
      priceLow: null,
      priceHigh: null,
    },
    {
      code: 'sh510300',
      name: '沪深300ETF',
      stance: 'buy',
      weight: 0.3,
      priceLow: null,
      priceHigh: null,
    },
  ],
  horizonDays: 5,
  benchmark: 'sh510300',
  thesis: '银行股息率高，ETF 做底仓',
  invalidation: '招商银行跌破 9 元',
  ...over,
});

describe('提案 → 批准 → 批量操作卡 → 执行报告', () => {
  test('提案内容校验', () => {
    expect(invalidProposal(rebalanceInput({ thesis: ' ' }))).toMatch('理由');
    expect(invalidProposal(rebalanceInput({ invalidation: '' }))).toMatch(
      '失效条件',
    );
    expect(
      invalidProposal(
        rebalanceInput({
          items: rebalanceInput().items.map(i => ({ ...i, weight: 0.6 })),
        }),
      ),
    ).toMatch('合计');
    expect(invalidProposal(rebalanceInput({ kind: 'single' }))).toMatch(
      '一次只写一只',
    );
    expect(invalidProposal(rebalanceInput({ horizonDays: 0 }))).toMatch('期限');
  });

  test('批准调仓方案生成调仓计划；执行一次提交全部委托，买入写决策日志', async () => {
    const { d, db, sim } = await setup();
    const p = await createProposal(d, rebalanceInput());
    expect(p).toMatchObject({
      status: 'proposed',
      baseDate: '2026-10-26',
      dueDate: '2026-11-02',
    });
    await expect(decideProposal(d, p.id, true)).rejects.toThrow(
      '先在「组合与调仓」',
    );
    await saveStrategy(db, DEFAULT_STRATEGY);
    const ok = await decideProposal(d, p.id, true);
    expect(ok.status).toBe('approved');
    const r = await loadRebalance(db, ok.rebalanceId!, sim.accountId);
    expect(r).toMatchObject({ status: 'draft', proposalId: p.id });
    expect(r.plan.rows.map(x => [x.code, x.request?.qty])).toEqual([
      ['sh600036', 6000],
      ['sh510300', 9000],
    ]);
    const done = await executeProposal(d, p.id, 'together');
    expect(done.status).toBe('executed');
    expect(sim.engine.state.orders).toHaveLength(2);
    const notes = await advice.journal(db);
    expect(notes.map(n => [n.code, n.source, n.proposalId])).toEqual([
      ['sh510300', 'ai', p.id],
      ['sh600036', 'ai', p.id],
    ]);
    expect(notes[0].orderId).toBe(
      sim.engine.state.orders.find(o => o.code === 'sh510300')!.id,
    );
    // 同一张卡不能执行两次
    await expect(executeProposal(d, p.id, 'together')).rejects.toThrow();
    expect(sim.engine.state.orders).toHaveLength(2);
    // 拒绝已执行的提案不改状态
    expect((await decideProposal(d, p.id, false)).status).toBe('executed');
  });

  test('风险限额对调仓预检同样生效；条件变了可以重新预检', async () => {
    const { d, db, sim } = await setup();
    await saveStrategy(db, DEFAULT_STRATEGY);
    await sim.setRiskLimits({
      maxWeight: 0.25,
      maxTurnover: null,
      noSt: false,
    });
    const p = await createProposal(d, rebalanceInput());
    const ok = await decideProposal(d, p.id, true);
    const r = await loadRebalance(db, ok.rebalanceId!, sim.accountId);
    const etf = r.plan.rows.find(x => x.code === 'sh510300')!;
    expect(etf.check).toMatchObject({ ok: false, rule: '风险限额' });
    await expect(executeProposal(d, p.id, 'together')).rejects.toThrow(
      '单票上限',
    );
    await sim.setRiskLimits({ maxWeight: 0.5, maxTurnover: null, noSt: false });
    const again = await replanProposal(d, p.id);
    expect(again.rebalanceId).not.toBe(ok.rebalanceId);
    expect((await executeProposal(d, p.id, 'together')).status).toBe(
      'executed',
    );
  });

  test('重置账户沿用风险限额，旧提案不能在新账户执行', async () => {
    const { d, db, sim } = await setup();
    await saveStrategy(db, DEFAULT_STRATEGY);
    await sim.setRiskLimits({ maxWeight: 0.3, maxTurnover: null, noSt: true });
    const p = await createProposal(d, rebalanceInput());
    await sim.resetAccount();
    expect(sim.engine.state.risk).toEqual({
      maxWeight: 0.3,
      maxTurnover: null,
      noSt: true,
    });
    await expect(decideProposal(d, p.id, true)).rejects.toThrow('账户已经重置');
  });
});

describe('到期对账和记分卡', () => {
  test('日期：非交易日顺延，到期日收盘后才对账', () => {
    expect(datesOf(cal, '2026-10-24', 1)).toEqual({
      baseDate: '2026-10-26',
      dueDate: '2026-10-27',
    });
    expect(isDue('2026-10-27', { date: '2026-10-27', t: T(15, 0) })).toBe(
      false,
    );
    expect(isDue('2026-10-27', { date: '2026-10-27', t: T(15, 30) })).toBe(
      true,
    );
    expect(
      closeOn([bar('2026-10-26', 1), bar('2026-10-28', 2)], '2026-10-27'),
    ).toBe(1);
  });

  test('超额 = 方向 ×（标的 − 基准）；调仓按权重，现金收益 0', () => {
    const base = { baseDate: '2026-10-26', dueDate: '2026-11-02', at: 'x' };
    const b = [bar('2026-10-26', 100), bar('2026-11-02', 102)];
    const up = [bar('2026-10-26', 10), bar('2026-11-02', 11)];
    const single = reviewOf({
      ...base,
      legs: [{ code: 'a', weight: null, bars: up }],
      dir: 1,
      benchmark: b,
    });
    expect(single).toMatchObject({ hit: true });
    expect((single as { excess: number }).excess).toBeCloseTo(0.08);
    const short = reviewOf({
      ...base,
      legs: [{ code: 'a', weight: null, bars: up }],
      dir: -1,
      benchmark: b,
    });
    expect(short).toMatchObject({ hit: false });
    const port = reviewOf({
      ...base,
      legs: [{ code: 'a', weight: 0.5, bars: up }],
      dir: 1,
      benchmark: b,
    });
    expect((port as { ret: number }).ret).toBeCloseTo(0.05);
    const watch = reviewOf({
      ...base,
      legs: [{ code: 'a', weight: null, bars: up }],
      dir: 0,
      benchmark: b,
    });
    expect(watch).toMatchObject({ excess: null, hit: null });
    expect(
      reviewOf({
        ...base,
        legs: [{ code: 'a', weight: null, bars: [] }],
        dir: 1,
        benchmark: b,
      }),
    ).toMatch('缺少');
  });

  test('到期后取日线对账；AI 和你自己的分开统计，样本太少标出来', async () => {
    const { d, db, clock, bars } = await setup();
    const single = (stance: 'buy' | 'watch') =>
      createProposal(d, {
        ...rebalanceInput(),
        kind: 'single',
        items: [{ ...rebalanceInput().items[0], stance, weight: null }],
      });
    const a = await single('buy');
    await single('watch');
    await writeJournal(d, {
      source: 'user',
      orderId: null,
      rebalanceId: null,
      proposalId: null,
      code: 'sz000001',
      name: '平安银行',
      side: 'B',
      thesis: '估值低',
      expectation: '一周涨 3%',
      invalidation: '跌破 10 元',
      horizonDays: 5,
      benchmark: 'sh510300',
    });
    expect(await refreshReviews(d)).toBe(0); // 没到期
    clock.date = '2026-11-02';
    clock.t = T(16, 0);
    bars.sh600036 = [bar('2026-10-26', 10), bar('2026-11-02', 10.5)];
    bars.sh510300 = [bar('2026-10-26', 4), bar('2026-11-02', 4.04)];
    expect(await refreshReviews(d)).toBe(2); // 平安银行缺日线，下次再试
    const failed = (await advice.journal(db))[0];
    expect(failed.reviewError).toContain('sz000001');
    bars.sz000001 = [bar('2026-10-26', 11), bar('2026-11-02', 10.8)];
    expect(await refreshReviews(d)).toBe(1);
    const card = await scorecard(db);
    expect(card.ai).toMatchObject({
      n: 1,
      hits: 1,
      watch: 1,
      pending: 0,
      thin: true,
    });
    expect(card.ai.avgExcess).toBeCloseTo(0.04);
    expect(card.user).toMatchObject({ n: 1, hits: 0, thin: true });
    expect(
      (await advice.proposalById(db, a.id))!.review!.legs[0].ret,
    ).toBeCloseTo(0.05);
  });
});

test('调仓服务：手动调仓的买入也写决策日志（来源是你）', async () => {
  const { d, db, sim } = await setup();
  const strategy = await saveStrategy(db, DEFAULT_STRATEGY);
  const service = new PortfolioService(db, sim, d.client);
  const t = {
    version: 1 as const,
    mode: 'shares' as const,
    targets: [{ code: 'sh600036', value: 1000 }],
  };
  const r = await service.draft(strategy, t, await service.preview(t), {
    thesis: '试一下',
  });
  await service.execute(r.id, 'together');
  expect(
    (await advice.journal(db)).map(e => [e.source, e.thesis, e.rebalanceId]),
  ).toEqual([['user', '试一下', r.id]]);
});
