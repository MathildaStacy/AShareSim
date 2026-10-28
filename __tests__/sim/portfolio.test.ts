/// <reference types="node" />
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import type { Db } from '../../src/data/db';
import { migrate } from '../../src/data/migrations';
import * as data from '../../src/data/repos';
import { T } from '../../src/engine/session';
import { addDays, TradingCalendar } from '../../src/engine/calendar';
import { newAccount } from '../../src/engine/account';
import { calcFee } from '../../src/engine/fees';
import type { Snapshot } from '../../src/engine/types';
import type { Security } from '../../src/engine/securities';
import type { MarketClient } from '../../src/market/client';
import type { Quote } from '../../src/market/tencent';
import { Simulator } from '../../src/sim/simulator';
import { parseTargets, TARGET_CSV } from '../../src/portfolio/targets';
import { makePlan } from '../../src/portfolio/planner';
import { PortfolioService } from '../../src/portfolio/service';
import { DEFAULT_STRATEGY, type TargetFile } from '../../src/portfolio/types';
import {
  loadRebalance,
  reports,
  saveStrategy,
  strategies,
  streak,
  weekOf,
  saveSkip,
} from '../../src/portfolio/repo';
import {
  stockDay,
  quality,
  compareQuotes,
  updateBars,
} from '../../src/portfolio/datacenter';
import { parseSinaQuote } from '../../src/market/sina';

const SEC: Security = {
  code: 'sh600036',
  name: '招商银行',
  exchange: 'SH',
  board: 'main',
  st: false,
};
const snapshot = (
  code = 'sh600036',
  over: Partial<Snapshot> = {},
): Snapshot => ({
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
const target = (
  code = 'sh600036',
  value = 1000,
  mode: 'shares' | 'weight' = 'shares',
): TargetFile => ({ version: 1, mode, targets: [{ code, value }] });
const quote = (s: Snapshot): Quote => ({
  snapshot: s,
  info: {
    code: s.code,
    name: '招商银行',
    type: s.code.startsWith('sh688') ? 'GP-A-KCB' : 'GP-A',
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
function ctx() {
  const state = newAccount('2026-10-26');
  state.cash = 10000000;
  return {
    state,
    accountId: 1,
    now: { date: '2026-10-26', t: T(9, 0) },
    calendar: new TradingCalendar(),
    security: (c: string) => ({
      ...SEC,
      code: c,
      board: c.startsWith('sh688') ? ('kcb' as const) : ('main' as const),
    }),
    snapshot: (c: string) => snapshot(c),
  };
}
async function setup(cash = 10000000) {
  const db = openMemoryDb();
  await migrate(db);
  const clock = { date: '2026-10-26', t: T(9, 0) };
  const client = {
    quotes: async (codes: string[]) =>
      codes.map(c => quote(snapshot(c, { date: clock.date, t: clock.t }))),
    corporateActions: async () => [],
  } as unknown as MarketClient;
  const sim = await Simulator.open(db, client, () => clock);
  await sim.deposit(cash);
  const service = new PortfolioService(db, sim, client);
  const strategy = await saveStrategy(db, DEFAULT_STRATEGY);
  const draft = async (t = target()) =>
    service.draft(strategy, t, await service.preview(t));
  return { db, clock, client, sim, service, strategy, draft };
}

describe('目标文件和调仓预检', () => {
  test('CSV/JSON 格式版本、百分比和六位代码', () => {
    expect(parseTargets('\uFEFF' + TARGET_CSV).targets).toEqual([
      { code: 'sh510300', value: 0.3 },
      { code: 'sz159915', value: 0.2 },
    ]);
    expect(
      parseTargets('version,1\n代码,目标股数\n600036,0').targets[0],
    ).toEqual({ code: 'sh600036', value: 0 });
    expect(parseTargets(JSON.stringify(target()))).toEqual(target());
  });
  test.each([
    'version,2\ncode,weight\n600036,0.5',
    'version,1\ncode,weight\n600036,60%\n000001,60%',
    'version,1\ncode,shares\n600036,1.5',
    'version,1\ncode,weight\n600036,0.5\nsh600036,0.4',
    'version,1\ncode,weight\n600036,',
    '{"version":1,"mode":"weight","targets":[{"code":"600036","value":null}]}',
  ])('拒绝错误输入 %s', s => {
    expect(() => parseTargets(s)).toThrow();
  });
  test('完整组合：未列入的旧持仓清仓；零股全部卖出', () => {
    const c = ctx();
    c.state.lots = [
      { id: 1, code: 'sz000001', qty: 135, buyDate: '2026-10-23', dividend: 0 },
    ];
    const p = makePlan(target(), c),
      row = p.rows.find(r => r.code === 'sz000001')!;
    expect(row.request).toMatchObject({ side: 'S', qty: 135 });
    expect(row.check?.ok).toBe(true);
  });
  test('科创板 200 起、1 股递增；主板整手；T+1', () => {
    expect(makePlan(target('sh688981', 199), ctx()).rows[0].request).toBeNull();
    expect(makePlan(target('sh688981', 235), ctx()).rows[0].request?.qty).toBe(
      235,
    );
    expect(makePlan(target('sh600036', 235), ctx()).rows[0].request?.qty).toBe(
      200,
    );
    const c = ctx();
    c.state.lots = [
      { id: 1, code: SEC.code, qty: 100, buyDate: c.now.date, dividend: 0 },
    ];
    expect(makePlan(target(SEC.code, 0), c).rows[0].check).toMatchObject({
      ok: false,
      rule: '可卖数量',
    });
  });
  test('累计预留资金不计未成交卖款、提示最低佣金和整手偏差', () => {
    const c = ctx();
    c.state.cash = 150500;
    c.state.lots = [
      {
        id: 1,
        code: 'sh600000',
        qty: 1000,
        buyDate: '2026-10-23',
        dividend: 0,
      },
    ];
    const p = makePlan(
      {
        version: 1,
        mode: 'shares',
        targets: [
          { code: SEC.code, value: 100 },
          { code: 'sz000001', value: 100 },
        ],
      },
      c,
    );
    expect(p.rows[0].check?.ok).toBe(true);
    expect(p.rows[1].check).toMatchObject({ ok: false, rule: '可用资金' });
    expect(p.rows[0].minExtra).toBe(475);
    expect(c.state.frozen).toBe(0);
    expect(
      makePlan(target(SEC.code, 0.3333, 'weight'), ctx()).weightError,
    ).toBeGreaterThan(0);
  });
  test('停牌阻塞，涨停风险和过期行情', () => {
    const c = ctx();
    c.snapshot = code => snapshot(code, { suspended: true });
    expect(makePlan(target(), c).rows[0].check?.ok).toBe(false);
    c.snapshot = code => snapshot(code, { last: 11000 });
    expect(makePlan(target(), c).rows[0].warnings.join()).toContain('涨停');
    c.snapshot = code => snapshot(code, { date: '2026-10-20' });
    expect(() => makePlan(target(), c)).toThrow('行情过旧');
  });
});

describe('持久化执行闭环', () => {
  test('报价变化后仍提交确认过的限价和股数，不按新价重算权重', async () => {
    const { db, service, sim, clock, draft } = await setup();
    clock.t = T(10, 0);
    const r = await draft(target(SEC.code, 0.3, 'weight'));
    const confirmed = r.plan.rows[0].request!;
    clock.t += 10;
    await sim.ingest([
      quote(snapshot(SEC.code, { t: clock.t, last: 10010 })),
    ]);
    await service.execute(r.id, 'together');
    expect(sim.engine.state.orders).toHaveLength(1);
    expect(sim.engine.state.orders[0]).toMatchObject(confirmed);
    expect((await loadRebalance(db, r.id, sim.accountId)).plan).toEqual(
      r.plan,
    );
    await db.close();
  });
  test.each(['持仓', '费率', '风险限额', '停牌', '价格笼子', '60 秒'])(
    '报价变化后仍拦截%s，失败不提交委托',
    async reason => {
      const { db, service, sim, clock, draft } = await setup();
      clock.t = T(10, 0);
      const r = await draft();
      let over: Partial<Snapshot> = { last: 10010 };
      if (reason === '持仓') {
        sim.engine.state.lots.push({
          id: 1,
          code: SEC.code,
          qty: 100,
          buyDate: '2026-10-23',
          dividend: 0,
        });
      } else if (reason === '费率') {
        await sim.setFeeProfile({ ...sim.engine.state.fee, stockMinFen: 400 });
      } else if (reason === '风险限额') {
        await sim.setRiskLimits({
          maxWeight: 0.01,
          maxTurnover: null,
          noSt: false,
        });
      } else if (reason === '停牌') {
        over = { ...over, suspended: true };
      } else if (reason === '价格笼子') {
        over = { last: 9500, asks: [[9500, 10000]] };
      }
      await sim.ingest([quote(snapshot(SEC.code, { t: clock.t, ...over }))]);
      if (reason === '60 秒') {
        clock.t += 61;
      }
      await expect(service.execute(r.id, 'together')).rejects.toThrow(reason);
      expect(sim.engine.state.orders).toHaveLength(0);
      expect((await loadRebalance(db, r.id, sim.accountId)).status).toBe('draft');
      await db.close();
    },
  );
  test('版本保留、批量重复确认只下单一次、账户和事件一起持久化', async () => {
    const { db, service, sim, strategy, draft } = await setup();
    const r = await draft();
    await saveStrategy(db, { ...DEFAULT_STRATEGY, name: '新版' }, strategy.id);
    expect((await strategies(db))[0].version).toBe(2);
    const results = await Promise.allSettled([
      service.execute(r.id, 'together'),
      service.execute(r.id, 'together'),
    ]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(sim.engine.state.orders).toHaveLength(1);
    expect(
      (await loadRebalance(db, r.id, sim.accountId)).strategy.version,
    ).toBe(1);
    const events = await db.all<{ type: string }>(
      'SELECT type FROM account_event',
    );
    expect(events.some(e => e.type === 'order')).toBe(true);
    expect((await data.currentAccount(db))?.state.orders).toHaveLength(1);
    await db.close();
  });
  test('写库失败回滚账户、委托关联和事件，允许原计划重试', async () => {
    const { db, service, sim, draft } = await setup();
    const r = await draft();
    const original = db.transaction.bind(db);
    let fail = true;
    db.transaction = async <TResult>(fn: (tx: Db) => Promise<TResult>) =>
      original(tx =>
        fn({
          ...tx,
          run: async (sql, params) => {
            if (fail && sql.startsWith('INSERT INTO account_event')) {
              throw new Error('disk full');
            }
            return tx.run(sql, params);
          },
        }),
      );
    await expect(service.execute(r.id, 'together')).rejects.toThrow(
      'disk full',
    );
    expect(sim.engine.state.orders).toHaveLength(0);
    expect((await loadRebalance(db, r.id, sim.accountId)).status).toBe('draft');
    fail = false;
    await service.execute(r.id, 'together');
    expect(sim.engine.state.orders).toHaveLength(1);
    await db.close();
  });
  test('部分成交后只补剩余数量，重启不重复补报，报告逐笔对账', async () => {
    const { db, service, sim, clock, client, draft } = await setup();
    const r = await draft();
    await service.execute(r.id, 'together');
    clock.t = T(9, 25);
    await sim.ingest([
      quote(
        snapshot(SEC.code, {
          t: clock.t,
          volume: 400,
          bids: [[9990, 10000]],
          asks: [[10010, 10000]],
        }),
      ),
    ]);
    const first = sim.engine.state.orders[0];
    expect(first.filled).toBeGreaterThan(0);
    expect(first.filled).toBeLessThan(1000);
    clock.t = T(9, 30);
    await sim.ingest([
      quote(
        snapshot(SEC.code, {
          t: clock.t,
          volume: 500,
          last: 10010,
          asks: [[10010, 10000]],
        }),
      ),
    ]);
    await service.process();
    const orders = sim.engine.state.orders;
    expect(orders).toHaveLength(2);
    expect(orders.find(o => o.id !== first.id)?.qty).toBe(1000 - first.filled);
    const again = await Simulator.open(db, client, () => clock);
    const next = new PortfolioService(db, again, client);
    await next.process();
    expect(again.engine.state.orders).toHaveLength(2);
    await again.ingest([
      quote(snapshot(SEC.code, { t: clock.t, last: 10010 })),
    ]);
    const report = await next.finish(r.id, '按纪律执行，补单增加滑点');
    const fills = again.engine.state.fills;
    expect(report.rows[0].filled).toBe(1000);
    expect(report.fees).toBe(fills.reduce((n, f) => n + f.fee.total, 0));
    const ledger = again.engine.state.ledger.filter(l =>
      report.rows[0].ledgerIds.includes(l.id),
    );
    expect(ledger.reduce((n, l) => n + l.fee.total, 0)).toBe(report.fees);
    expect(await reports(db, sim.accountId)).toHaveLength(1);
    expect(await next.finish(r.id, '重复点击')).toEqual(report);
    await db.close();
  });
  test('过期行情不补单，截止后放弃，报告未成交原因', async () => {
    const { db, service, sim, clock, draft } = await setup();
    const r = await draft();
    await service.execute(r.id, 'together');
    clock.t = T(9, 31);
    await service.process();
    expect(sim.engine.state.orders).toHaveLength(1);
    clock.t = T(14, 50);
    await sim.tick();
    await service.process();
    expect(sim.engine.state.orders[0].status).toBe('已撤');
    const report = await service.finish(r.id, '未成交，按规则放弃');
    expect(report.rows[0].remaining).toBe(1000);
    expect(report.rows[0].reason).toContain('放弃');
    await db.close();
  });
  test('先卖后买必须使用已成交回款；不足则不缩单', async () => {
    const { db, service, sim, clock, draft } = await setup(1000);
    sim.engine.state.lots = [
      {
        id: 1,
        code: 'sh600000',
        qty: 1000,
        buyDate: '2026-10-23',
        dividend: 0,
      },
    ];
    const r = await draft();
    expect(r.plan.rows[0].check).toMatchObject({ ok: false, rule: '可用资金' });
    await service.execute(r.id, 'sellFirst');
    expect(sim.engine.state.orders).toHaveLength(1);
    expect(sim.engine.state.orders[0].side).toBe('S');
    clock.t = T(9, 25);
    await sim.ingest([
      quote(snapshot('sh600000', { t: clock.t, volume: 200000 })),
    ]);
    clock.t = T(9, 30);
    await sim.ingest([
      quote(
        snapshot('sh600000', {
          t: clock.t,
          bids: [[10000, 2000]],
          volume: 200000,
        }),
      ),
      quote(snapshot(SEC.code, { t: clock.t, volume: 200000 })),
    ]);
    await service.process();
    const saved = await loadRebalance(db, r.id, sim.accountId);
    expect(saved.notes.join()).toContain('可用资金不足');
    expect(sim.engine.state.orders).toHaveLength(1);
    await db.close();
  });
  test('复盘前必须结束挂单；账户重置后旧调仓不可执行', async () => {
    const { db, service, sim, draft } = await setup();
    const r = await draft();
    await service.execute(r.id, 'together');
    await expect(service.finish(r.id, '复盘')).rejects.toThrow('未完成委托');
    await sim.resetAccount();
    await expect(service.execute(r.id, 'together')).rejects.toThrow('当前账户');
    await db.close();
  });
});

describe('数据中心和周度记录', () => {
  test('每日状态保留当日 ST，不用当前状态反推历史', async () => {
    const { db, sim, clock } = await setup();
    await sim.ingest([quote(snapshot())]);
    clock.date = '2026-10-27';
    await sim.ingest([
      {
        ...quote(snapshot(SEC.code, { date: clock.date })),
        info: { ...quote(snapshot()).info, name: '*ST 招商' },
      },
    ]);
    expect((await stockDay(db, SEC.code, '2026-10-26'))?.st).toBe(false);
    expect((await stockDay(db, SEC.code, clock.date))?.st).toBe(true);
    expect(await stockDay(db, SEC.code, '2026-10-23')).toBeNull();
    await db.close();
  });
  test('日线增量使用重叠窗口、去重覆盖与质量检查', async () => {
    const db = openMemoryDb();
    await migrate(db);
    const bar = {
      date: '2026-10-23',
      open: 10000,
      close: 10000,
      high: 10000,
      low: 10000,
      volume: 100,
    };
    const fetch = jest.fn(async () => [{ ...bar, close: 10010, high: 10010 }]);
    const client = {
      kline: async () => [bar],
      klineRange: fetch,
    } as unknown as MarketClient;
    await updateBars(db, client, SEC.code, 'GP-A', '2026-10-26');
    await updateBars(db, client, SEC.code, 'GP-A', '2026-10-26');
    expect(fetch).toHaveBeenCalledWith(
      SEC.code,
      'GP-A',
      '2026-10-16',
      '2026-10-26',
      '',
    );
    expect((await db.all('SELECT * FROM kline_day')).length).toBe(1);
    expect(
      quality(
        [bar, { ...bar, date: '2026-10-27', low: 20000 }],
        new TradingCalendar(),
      ).join(),
    ).toContain('2026-10-26 缺日线');
    const historical = quality(
      [
        { ...bar, date: '2024-09-30' },
        { ...bar, date: '2024-10-08' },
      ],
      new TradingCalendar(),
    );
    expect(historical).toHaveLength(1);
    expect(historical[0]).toContain('2024 年休市日历未确认');
    await db.close();
  });
  test('双源核对严格对齐时间，新浪数值转换', () => {
    const cells = Array(33).fill('0');
    cells[1] = '10';
    cells[2] = '10';
    cells[3] = '10';
    cells[4] = '10';
    cells[5] = '10';
    cells[8] = '100000';
    cells[30] = '2026-10-26';
    cells[31] = '09:00:00';
    const sina = parseSinaQuote(
      `var hq_str_sh600036="${cells.join(',')}";`,
      SEC.code,
    );
    expect(compareQuotes(snapshot(), sina)).toMatchObject({
      comparable: true,
      differences: [],
    });
    expect(
      compareQuotes(snapshot(), { ...sina, time: '09:01:00' }).comparable,
    ).toBe(false);
  });
  test('自然周跨年、当周未结束保留上周连续、漏一周中断', async () => {
    expect(weekOf('2027-01-01')).toBe('2026-12-28');
    const weeks = Array.from({ length: 12 }, (_, i) =>
      addDays('2026-08-10', i * 7),
    );
    expect(streak(weeks, '2026-10-28')).toBe(12);
    expect(streak([...weeks, weeks[11]], '2026-11-02')).toBe(12);
    expect(streak(weeks, '2026-11-09')).toBe(0);
    const { db, sim } = await setup();
    await saveSkip(db, sim.accountId, '2026-10-19', '2026-10-28', '出差');
    expect(await reports(db, sim.accountId)).toHaveLength(0);
    await db.close();
  });
  test('连续十二周报告自动打勾，重复报告不多计周数', async () => {
    const { db, sim, clock, service, draft } = await setup();
    clock.date = '2026-10-26';
    for (let i = 0; i < 12; i++) {
      clock.date = addDays('2026-10-26', i * 7);
      const r = await draft(target(SEC.code, 0));
      await service.execute(r.id, 'together');
      await service.finish(r.id, '本周目标为现金，按策略不调仓');
    }
    expect(
      (await data.learnChecks(db)).filter(c => c.id.startsWith('s7-')),
    ).toHaveLength(2);
    expect(await reports(db, sim.accountId)).toHaveLength(12);
    await db.close();
  });

  test('费用口径沿用现有引擎', () => {
    expect(
      calcFee(SEC, 'B', 10000000, { ...newAccount('2026-10-26').fee }).total,
    ).toBe(2600);
  });
});
