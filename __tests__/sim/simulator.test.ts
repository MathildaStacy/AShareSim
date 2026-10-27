/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import * as repo from '../../src/data/repos';
import { T, yuanToLi } from '../../src/engine';
import type { MarketClient } from '../../src/market/client';
import {
  parseMinuteDays,
  parseQuotes,
  type Quote,
} from '../../src/market/tencent';
import { Simulator } from '../../src/sim/simulator';
import { snap } from '../engine/helpers/fixtures';

const fx = (name: string) =>
  readFileSync(join(__dirname, '../market/fixtures', name), 'utf8');

/** 只实现补撮合要用的分时接口，数据是 2026-10-26 抓的招商银行最近 5 日分时。 */
const client = {
  async minuteDays(code: string, type: string) {
    return parseMinuteDays(JSON.parse(fx('day5-sh600036.json')), code, type);
  },
  async corporateActions() {
    return [];
  },
  /** 当日分时：用 10-23 那天（带 15:06–15:30 盘后点）。 */
  async minute(code: string, type: string) {
    return parseMinuteDays(JSON.parse(fx('day5-sh600036.json')), code, type)[3];
  },
} as unknown as MarketClient;

const info = (code: string): Quote['info'] => ({
  code,
  name: '招商银行',
  type: 'GP-A',
  change: null,
  pct: null,
  turnover: null,
  amplitude: null,
  volumeRatio: null,
  pe: null,
  pb: null,
  floatCap: null,
  totalCap: null,
  outer: 0,
  inner: 0,
});

async function setup(clock: { date: string; t: number }) {
  const db = openMemoryDb();
  await migrate(db);
  const sim = await Simulator.open(db, client, () => clock);
  return { db, sim };
}

describe('Simulator：本地库', () => {
  test('第一次打开新建账户，入金后重新打开状态还在', async () => {
    const clock = { date: '2026-10-26', t: T(9, 0) };
    const { db, sim } = await setup(clock);
    const r = await sim.deposit(10_000_000);
    expect(r.ok).toBe(true);
    const again = await Simulator.open(db, client, () => clock);
    expect(again.accountId).toBe(sim.accountId);
    expect(again.engine.state.cash).toBe(10_000_000);
    expect(again.engine.state.depositCap).toBe(40_000_000);
    const log = await repo.recentActivity(db, 5);
    expect(log[0]).toMatchObject({
      kind: 'transfer',
      text: '银行转证券 100000.00 元',
    });
  });

  test('喂真实行情：记下证券信息，只存自选 / 持仓 / 有委托的快照', async () => {
    const { db, sim } = await setup({ date: '2026-10-26', t: T(14, 53) });
    sim.setWatchlist(['sh600036']);
    await sim.ingest(parseQuotes(fx('qt-2026-10-26-1452.txt')));
    expect(sim.security('sh688981')).toMatchObject({
      board: 'kcb',
      name: '中芯国际',
    });
    expect(sim.security('sh000001')).toBeNull(); // 指数不进引擎
    expect(sim.info('sh000001')?.name).toBe('上证指数');
    expect(await repo.snapshotStats(db)).toEqual({
      rows: 1,
      days: 1,
      codes: 1,
    });
    // 同一个快照再来一次不重复存
    await sim.ingest(parseQuotes(fx('qt-2026-10-26-1452.txt')));
    expect((await repo.snapshotStats(db)).rows).toBe(1);
    const last = await repo.lastSnapshot(db, 'sh600036', '2026-10-26');
    expect(last?.bids[0]).toEqual([42_300, 131_300]);
  });

  test('券商拦下的委托不生成委托，但写进操作日志', async () => {
    const { db, sim } = await setup({ date: '2026-10-26', t: T(10, 0) });
    await sim.deposit(10_000_000);
    await sim.ingest(parseQuotes(fx('qt-2026-10-26-1452.txt')));
    const r = await sim.placeOrder({
      code: 'sh600036',
      side: 'B',
      kind: 'limit',
      price: yuanToLi(42.3),
      qty: 150,
    });
    expect(r.ok).toBe(false);
    expect(sim.engine.state.orders).toHaveLength(0);
    const [a] = await repo.recentActivity(db, 1);
    expect(a.kind).toBe('reject');
    expect(a.text).toContain('被拦下');
  });
  test('收盘后的预埋单今天不会成交：不算进后台跟踪', async () => {
    const { sim } = await setup({ date: '2026-10-26', t: T(15, 16) });
    await sim.deposit(10_000_000);
    await sim.ingest(parseQuotes(fx('qt-2026-10-26-1452.txt')));
    const r = await sim.placeOrder({
      code: 'sh600036',
      side: 'B',
      kind: 'limit',
      price: yuanToLi(42.3),
      qty: 100,
    });
    expect(r.ok && r.order.sendDate).toBe('2026-10-27');
    expect(sim.liveOrderCodes()).toEqual(['sh600036']);
    expect(sim.activeOrderCodes('2026-10-26')).toEqual([]);
    expect(sim.activeOrderCodes('2026-10-27')).toEqual(['sh600036']);
  });
});

describe('Simulator：App 被杀后补撮合', () => {
  test('10-23 挂单后 App 被杀，10-26 才打开：先用 10-23 的分时补撮合，再清算跨日', async () => {
    const clock = { date: '2026-10-23', t: T(10, 0) };
    const { db, sim } = await setup(clock);
    await sim.deposit(10_000_000);
    sim.setWatchlist(['sh600036']);
    // 10-23 10:00 的实时快照（10-23 的真实分时：13:39 跌到全天最低 41.43）
    await sim.ingest([
      {
        snapshot: snap({
          code: 'sh600036',
          date: '2026-10-23',
          t: T(10, 0),
          prev: 41.82,
          open: 41.7,
          last: 41.8,
          high: 41.9,
          low: 41.6,
          volume: 30_000_000,
          bids: [[41.79, 500]],
          asks: [[41.8, 800]],
          up: 46,
          down: 37.64,
        }),
        info: info('sh600036'),
      },
    ]);
    const r = await sim.placeOrder({
      code: 'sh600036',
      side: 'B',
      kind: 'limit',
      price: yuanToLi(41.5),
      qty: 1000,
    });
    expect(r.ok).toBe(true);

    // App 被杀，下一次打开已经是 10-26 10:00
    clock.date = '2026-10-26';
    clock.t = T(10, 0);
    const reopened = await Simulator.open(db, client, () => clock);
    const report = await reopened.catchUp();
    expect(report.dates).toEqual(['2026-10-23', '2026-10-26']);
    const order = reopened.engine.state.orders[0];
    expect(order.status).toBe('已成');
    const fill = reopened.engine.state.fills[0];
    expect(fill).toMatchObject({
      date: '2026-10-23',
      price: yuanToLi(41.5),
      qty: 1000,
      basis: { rule: 'through' },
    });
    // 10-23 已清算，今天是 10-26，昨天买的今天能卖（T+1）
    expect(reopened.engine.state.date).toBe('2026-10-26');
    expect(reopened.engine.holding('sh600036')).toMatchObject({
      sellable: 1000,
    });
    const log = await repo.recentActivity(db, 10);
    expect(log.map(x => x.text).join('\n')).toContain('已用分时数据补撮合');
  });

  test('没有未完成委托时不请求分时，直接推进时间', async () => {
    const clock = { date: '2026-10-23', t: T(16, 0) };
    const { sim } = await setup(clock);
    const spy = jest.spyOn(client, 'minuteDays');
    clock.date = '2026-10-26';
    const report = await sim.catchUp();
    expect(spy).not.toHaveBeenCalled();
    expect(report.snapshots).toBe(0);
    expect(sim.engine.state.date).toBe('2026-10-26');
    spy.mockRestore();
  });
});

describe('Simulator：盘后固定价格交易用分时数据撮合', () => {
  /** 10-23 真实数据：收盘 41.77、收盘时累计 1,232,174 手，盘后每分钟还在涨，15:30 到 1,232,336 手。 */
  async function placeAfter(placeT: number) {
    const clock = { date: '2026-10-23', t: T(15, 0, 40) };
    const { sim } = await setup(clock);
    await sim.deposit(10_000_000);
    sim.setWatchlist(['sh600036']);
    const close = snap({
      code: 'sh600036',
      date: '2026-10-23',
      t: T(15, 0, 40),
      prev: 41.82,
      open: 41.7,
      last: 41.77,
      high: 42.38,
      low: 41.43,
      volume: 123_217_400,
      up: 46,
      down: 37.64,
    });
    await sim.ingest([{ snapshot: close, info: info('sh600036') }]);
    clock.t = placeT;
    const r = await sim.placeOrder({
      code: 'sh600036',
      side: 'B',
      kind: 'after',
      price: null,
      qty: 500,
    });
    if (!r.ok) {
      throw new Error(r.msg);
    }
    // 快照的量收盘后不再变化：这时喂进来的实时快照不能让它成交
    await sim.ingest([
      { snapshot: { ...close, t: T(15, 20) }, info: info('sh600036') },
    ]);
    expect(r.order.filled).toBe(0);
    return { sim, clock, order: r.order };
  }

  test('只算委托之后完整的分钟：15:10:20 下单，从 15:12 这一分钟起才算', async () => {
    const { sim, clock, order } = await placeAfter(T(15, 10, 20));
    clock.t = T(15, 31);
    const events = await sim.ingestAfterHours();
    expect(order.status).toBe('已成');
    const fill = events.find(e => e.type === 'fill');
    expect(fill).toMatchObject({
      fill: { price: yuanToLi(41.77), basis: { rule: 'after' } },
    });
    if (fill?.type === 'fill') {
      expect(fill.fill.t).toBeGreaterThanOrEqual(T(15, 12));
    }
  });

  test('分两次喂：同一分钟不重复算', async () => {
    const { sim, clock, order } = await placeAfter(T(15, 4));
    clock.t = T(15, 7, 30);
    await sim.ingestAfterHours();
    const first = order.filled;
    await sim.ingestAfterHours();
    expect(order.filled).toBe(first);
    expect(first).toBe(500); // 15:06 这一分钟就有 58 手盘后成交
  });
});

describe('Simulator：资金和设置（M2 第 4 步）', () => {
  test('银证转账查转账时间，被拦下的记进操作日志', async () => {
    const clock = { date: '2026-10-24', t: T(20, 0) }; // 周六晚上
    const { db, sim } = await setup(clock);
    // 新账户第一笔入金不限时间
    expect((await sim.transfer('in', 10_000_000)).ok).toBe(true);
    const r = await sim.transfer('in', 100);
    expect(r.ok).toBe(false);
    const [a] = await repo.recentActivity(db, 1);
    expect(a).toMatchObject({ kind: 'reject', ref: { rule: '银证转账时间' } });
    expect(a.text).toContain('银行转证券 1.00 元被拦下');
    clock.date = '2026-10-26';
    clock.t = T(10, 0);
    expect((await sim.transfer('out', 5_000_000)).ok).toBe(true);
    expect(sim.engine.state.depositTotal).toBe(5_000_000);
  });

  test('改费率、改入金上限都记 setting 日志并保存', async () => {
    const clock = { date: '2026-10-26', t: T(10, 0) };
    const { db, sim } = await setup(clock);
    const fee = { ...sim.engine.state.fee, stockRate: 10_000 };
    expect(await sim.setFeeProfile(fee)).toEqual(['股票佣金率 万 2.5 → 万 1']);
    expect(await sim.setFeeProfile(fee)).toEqual([]); // 没变化不记
    await sim.setDepositCap(50_000_000);
    const log = await repo.recentActivity(db, 5);
    expect(log.map(l => [l.kind, l.text])).toEqual([
      ['setting', '累计净入金上限 400,000.00 → 500,000.00 元'],
      ['setting', '修改费率：股票佣金率 万 2.5 → 万 1'],
    ]);
    const saved = await repo.currentAccount(db);
    expect(saved!.state.fee.stockRate).toBe(10_000);
    expect(saved!.state.depositCap).toBe(50_000_000);
  });

  test('重置账户：旧账户归档，新账户沿用费率和上限；AI 只看当前账户的操作', async () => {
    const clock = { date: '2026-10-26', t: T(10, 0) };
    const { db, sim } = await setup(clock);
    await sim.deposit(10_000_000);
    await sim.setFeeProfile({ ...sim.engine.state.fee, etfRate: 1_000 });
    await sim.setDepositCap(60_000_000);
    const oldId = sim.accountId;
    const r = await sim.resetAccount();
    expect(r.archived).toBe(oldId);
    expect(sim.accountId).toBe(r.current);
    expect(sim.engine.state).toMatchObject({
      cash: 0,
      depositTotal: 0,
      depositCap: 60_000_000,
      ledger: [],
    });
    expect(sim.engine.state.fee.etfRate).toBe(1_000);
    const all = await repo.allAccounts(db);
    expect(all.map(a => [a.name, a.archivedAt != null])).toEqual([
      ['模拟账户 2', false],
      ['模拟账户 1', true],
    ]);
    const old = await repo.accountById(db, oldId);
    expect(old!.state.cash).toBe(10_000_000);
    // 重新打开 App 拿到的是新账户
    const again = await Simulator.open(db, client, () => clock);
    expect(again.accountId).toBe(r.current);
    // 当前账户的最近操作不带旧账户的
    const recent = await repo.recentActivity(db, 20, r.current);
    expect(recent.every(a => a.accountId === r.current)).toBe(true);
    expect((await repo.activityOf(db, oldId, 20)).length).toBeGreaterThan(2);
  });

  test('操作日志清理不动归档账户的', async () => {
    const clock = { date: '2026-10-26', t: T(10, 0) };
    const { db, sim } = await setup(clock);
    await sim.deposit(10_000_000);
    const oldId = sim.accountId;
    await sim.resetAccount();
    await repo.pruneActivity(db, '2999-01-01'); // 当前账户的全部过期
    expect((await repo.activityOf(db, oldId, 50)).length).toBeGreaterThan(0);
    expect((await repo.activityOf(db, sim.accountId, 50)).length).toBe(0);
  });
});

describe('Simulator：报价时间水位与去重', () => {
  const fresh = () =>
    parseQuotes(fx('qt-2026-10-26-1452.txt')).find(
      q => q.snapshot.code === 'sh600036',
    )!;
  const copy = (q: Quote): Quote => JSON.parse(JSON.stringify(q));
  afterEach(() => jest.restoreAllMocks());

  test('倒退数据不覆盖报价、不撮合、不写库、不通知（即使价格不同）', async () => {
    const { db, sim } = await setup({ date: '2026-10-26', t: T(14, 53) });
    sim.setWatchlist(['sh600036']);
    const q = fresh();
    await sim.ingest([q]);
    const match = jest.spyOn(sim.engine, 'onSnapshot');
    const sql = jest.spyOn(db, 'run');
    const changed = jest.fn();
    sim.subscribeQuotes(changed);
    const old = copy(q);
    old.snapshot.t -= 3;
    old.snapshot.last = old.snapshot.last! - 100;
    await sim.ingest([old]);
    expect(sim.quote('sh600036')).toEqual(q);
    expect(match).not.toHaveBeenCalled();
    expect(sql).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  test('完全重复只更新收到报价的时间，元数据变化只通知界面', async () => {
    const { db, sim } = await setup({ date: '2026-10-26', t: T(14, 53) });
    sim.setWatchlist(['sh600036']);
    const q = fresh();
    await sim.ingest([q]);
    const match = jest.spyOn(sim.engine, 'onSnapshot');
    const sql = jest.spyOn(db, 'run');
    const changed = jest.fn();
    sim.subscribeQuotes(changed);
    jest.spyOn(Date, 'now').mockReturnValue(123456);
    await sim.ingest([copy(q)]);
    expect(sim.quoteReceivedAt('sh600036')).toBe(123456);
    expect(match).not.toHaveBeenCalled();
    expect(sql).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    const metadata = copy(q);
    metadata.info.pe = 12;
    await sim.ingest([metadata]);
    expect(sim.info('sh600036')?.pe).toBe(12);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(match).not.toHaveBeenCalled();
    expect(sql).not.toHaveBeenCalled();
    const stale = copy(q);
    stale.snapshot.t -= 3;
    jest.spyOn(Date, 'now').mockReturnValue(234567);
    await sim.ingest([stale]);
    expect(sim.quoteReceivedAt('sh600036')).toBe(123456);
  });

  test('同秒的盘口/成交量修正仍撮合并覆盖本地快照，批量只通知一次', async () => {
    const { db, sim } = await setup({ date: '2026-10-26', t: T(14, 53) });
    sim.setWatchlist(['sh600036']);
    const q = fresh();
    await sim.ingest([q]);
    const fixed = copy(q);
    fixed.snapshot.last = fixed.snapshot.last! + 10;
    fixed.snapshot.volume += 100;
    fixed.snapshot.bids[0][1] += 100;
    const match = jest.spyOn(sim.engine, 'onSnapshot');
    const changed = jest.fn();
    sim.subscribeQuotes(changed);
    await sim.ingest([fixed, copy(fixed)]);
    expect(match).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
    expect((await repo.snapshotStats(db)).rows).toBe(1);
    expect(await repo.latestSnapshot(db, 'sh600036')).toMatchObject(
      fixed.snapshot,
    );
  });

  test('按证券和日期校验：新交易日早盘可覆盖昨收，昨天较大的秒数不能回退', async () => {
    const { sim } = await setup({ date: '2026-10-27', t: T(10, 0) });
    const yesterday = fresh();
    const today = copy(yesterday);
    today.snapshot.date = '2026-10-27';
    today.snapshot.t = T(9, 30);
    const other = copy(yesterday);
    other.snapshot.code = other.info.code = 'sz000001';
    await sim.ingest([today, yesterday, other]);
    expect(sim.quote('sh600036')?.snapshot.date).toBe('2026-10-27');
    expect(sim.quote('sz000001')?.snapshot.date).toBe('2026-10-26');
    await sim.ingest([yesterday]);
    expect(sim.quote('sh600036')).toEqual(today);
  });

  test('重启后首次响应也不能落后于已记录快照', async () => {
    const clock = { date: '2026-10-26', t: T(14, 53) };
    const { db, sim } = await setup(clock);
    sim.setWatchlist(['sh600036']);
    const q = fresh();
    await sim.ingest([q]);
    const reopened = await Simulator.open(db, client, () => clock);
    reopened.setWatchlist(['sh600036']);
    const old = copy(q);
    old.snapshot.t -= 3;
    const match = jest.spyOn(reopened.engine, 'onSnapshot');
    await reopened.ingest([old]);
    expect(reopened.quote('sh600036')).toBeNull();
    expect(match).not.toHaveBeenCalled();
    await reopened.ingest([q]);
    expect(reopened.quote('sh600036')).toEqual(q);
  });

  test('指数也拦截旧值，且不会进入撮合或快照表', async () => {
    const { db, sim } = await setup({ date: '2026-10-26', t: T(14, 53) });
    const q = parseQuotes(fx('qt-2026-10-26-1452.txt')).find(
      x => x.snapshot.code === 'sh000001',
    )!;
    const match = jest.spyOn(sim.engine, 'onSnapshot');
    await sim.ingest([q]);
    const old = copy(q);
    old.snapshot.t -= 3;
    await sim.ingest([old]);
    expect(sim.quote(q.snapshot.code)).toEqual(q);
    expect(match).not.toHaveBeenCalled();
    expect((await repo.snapshotStats(db)).rows).toBe(0);
  });

  test('并发到达的响应在写库等待期间仍串行校验，最终不会被旧响应覆盖', async () => {
    const { db, sim } = await setup({ date: '2026-10-26', t: T(14, 53) });
    sim.setWatchlist(['sh600036']);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(r => {
      release = r;
    });
    const started = new Promise<void>(r => {
      entered = r;
    });
    const save = repo.saveSnapshot;
    jest.spyOn(repo, 'saveSnapshot').mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      return save(...args);
    });
    const q = fresh(),
      old = copy(q);
    old.snapshot.t -= 3;
    const first = sim.ingest([q]);
    await started;
    const second = sim.ingest([old]);
    release();
    await Promise.all([first, second]);
    expect(sim.quote('sh600036')).toEqual(q);
    expect(await repo.latestSnapshot(db, 'sh600036')).toMatchObject(q.snapshot);
  });

  test('写库失败后缓存不抢先发布，后续相同数据可重试，队列不被拒绝状态阻断', async () => {
    const { db, sim } = await setup({ date: '2026-10-26', t: T(14, 53) });
    sim.setWatchlist(['sh600036']);
    const q = fresh();
    jest
      .spyOn(repo, 'saveSnapshot')
      .mockRejectedValueOnce(new Error('disk busy'));
    const match = jest.spyOn(sim.engine, 'onSnapshot');
    await expect(sim.ingest([q])).rejects.toThrow('disk busy');
    expect(sim.quote('sh600036')).toBeNull();
    expect(match).not.toHaveBeenCalled();
    await sim.ingest([copy(q)]);
    expect(sim.quote('sh600036')).toEqual(q);
    expect(match).toHaveBeenCalledTimes(1);
    expect((await repo.snapshotStats(db)).rows).toBe(1);
  });
});
