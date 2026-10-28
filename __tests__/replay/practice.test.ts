/// <reference types="node" />
import { T } from '../../src/engine/session';
import { pickBlind, replayDays, coverageOf } from '../../src/replay/days';
import {
  accountSeed,
  createPractice,
  displayCode,
  displayDate,
  displayName,
  loadPractice,
  practices,
  PracticeSession,
} from '../../src/replay/practice';
import { liveDay, quote } from './helpers/liveDay';

const BUY = {
  code: 'sh600036',
  side: 'B' as const,
  kind: 'limit' as const,
  price: 40100,
  qty: 200,
};

describe('M6 回放练习', () => {
  test('列出有快照的日期和每只证券的覆盖情况', async () => {
    const { db } = await liveDay();
    const days = await replayDays(db, { date: '2026-10-27', t: T(9, 0) });
    expect(days.map(d => d.date)).toEqual(['2026-10-26']);
    const cmb = days[0].codes.find(c => c.code === 'sh600036')!;
    expect(cmb).toMatchObject({ name: '招商银行', openAuction: true });
    expect(cmb.minutes).toBeGreaterThan(0);
    expect(coverageOf(cmb)).toBeLessThan(0.1);
    // 当天还没收盘的不列
    expect(await replayDays(db, { date: '2026-10-26', t: T(14, 0) })).toEqual(
      [],
    );
    // 覆盖率太低的日期不进盲测
    expect(pickBlind(days)).toBeNull();
    expect(
      pickBlind(
        [{ ...days[0], best: 0.9, codes: [{ ...cmb, minutes: 230 }] }],
        () => 0,
      ),
    ).toEqual({ date: '2026-10-26', codes: ['sh600036'] });
  });

  test('现金起步：预埋单参加开盘集合竞价，连续竞价主动成交，重开后结果一样', async () => {
    const { db, sim } = await liveDay();
    const rec = await createPractice(db, sim, {
      date: '2026-10-26',
      codes: ['sh600036'],
      start: 'cash',
      cash: 10_000_000,
      blind: false,
      hideNames: false,
    });
    const s = await PracticeSession.open(db, rec, sim.calendar);
    expect(s.now.t).toBe(T(9, 10));
    expect(s.engine.state.cash).toBe(10_000_000);
    expect(s.place(BUY).ok).toBe(true);
    expect(s.engine.state.orders[0].status).toBe('未报');
    s.runTo(T(9, 26));
    expect(s.engine.state.fills).toHaveLength(1);
    expect(s.engine.state.fills[0].basis.rule).toBe('auction');
    s.step(5 * 60); // 9:31
    expect(s.quote('sh600036')?.t).toBe(T(9, 30, 3));
    const r = s.place({ ...BUY, price: 40000, qty: 500 });
    expect(r.ok).toBe(true);
    expect(s.engine.state.fills).toHaveLength(2);
    expect(s.points('sh600036').length).toBeGreaterThan(0);
    await s.save(db);

    const again = await PracticeSession.open(
      db,
      (await loadPractice(db, rec.id))!,
      sim.calendar,
    );
    expect(again.now.t).toBe(s.now.t);
    expect(again.engine.state).toEqual(s.engine.state);

    const result = again.finish();
    await again.save(db);
    expect(result.fills).toBe(2);
    expect(result.orders).toBe(2);
    expect(result.fees).toBeGreaterThan(0);
    expect(result.startEquity).toBe(10_000_000);
    expect(result.pnl).toBe(result.endEquity - result.startEquity);
    expect((await practices(db))[0]).toMatchObject({
      id: rec.id,
      status: 'finished',
    });
  });

  test('午间休市直接跳到 13:00；时钟不倒退', async () => {
    const { db, sim } = await liveDay();
    const rec = await createPractice(db, sim, {
      date: '2026-10-26',
      codes: ['sh600036'],
      start: 'cash',
      cash: 5_000_000,
      blind: false,
      hideNames: false,
    });
    const s = await PracticeSession.open(db, rec, sim.calendar);
    s.runTo(T(11, 29));
    s.step(120);
    expect(s.now.t).toBe(T(13, 0));
    s.runTo(T(10, 0));
    expect(s.now.t).toBe(T(13, 0));
  });

  test('盲测：结束前不显示日期，隐藏名称时也不显示代码', async () => {
    const { db, sim } = await liveDay();
    const rec = await createPractice(db, sim, {
      date: '2026-10-26',
      codes: ['sh600036'],
      start: 'cash',
      cash: 10_000_000,
      blind: true,
      hideNames: true,
    });
    expect(displayDate(rec)).toBe('日期已隐藏');
    expect(displayName(rec, 'sh600036')).toBe('证券 A');
    expect(displayCode(rec, 'sh600036')).toBe('••••••');
    const s = await PracticeSession.open(db, rec, sim.calendar);
    s.finish();
    expect(displayDate(s.record)).toBe('2026-10-26 周一');
    expect(displayName(s.record, 'sh600036')).toBe('招商银行');
  });

  test('从那天开盘前的真实账户开始', async () => {
    const { db, sim } = await liveDay();
    const rec = await createPractice(db, sim, {
      date: '2026-10-26',
      codes: ['sh600036'],
      start: 'account',
      cash: 0,
      blind: false,
      hideNames: false,
    });
    // 那天第一次打开时账户还是空的（入金是之后的输入）
    expect(rec.seed.state.cash).toBe(0);
    await expect(
      createPractice(db, sim, {
        date: '2026-10-20',
        codes: ['sh600036'],
        start: 'account',
        cash: 0,
        blind: false,
        hideNames: false,
      }),
    ).rejects.toThrow('没有开盘前真实账户的起点记录');
    // 当天第一个起点是盘中才记的（例如那天中午才装上新版本）：不是开盘前的账户
    const first = await db.get<{ id: number }>(
      "SELECT MIN(id) AS id FROM engine_input WHERE trade_date='2026-10-26' AND kind='seed' AND body LIKE '%\"cash\":0,%'",
    );
    await db.run(
      "DELETE FROM engine_input WHERE trade_date='2026-10-26' AND id < (SELECT MAX(id) FROM engine_input WHERE trade_date='2026-10-26' AND kind='seed')",
    );
    expect(first?.id).toBeDefined();
    expect(await accountSeed(db, sim.accountId, '2026-10-26')).toBeNull();
    expect(await accountSeed(db, sim.accountId, '2026-10-27')).not.toBeNull();
  });
});

describe('M6 回放分时', () => {
  test('15:00 以后的快照（收盘集合竞价结果）算进 15:00 那个点', async () => {
    const { db, sim } = await liveDay();
    const rec = await createPractice(db, sim, {
      date: '2026-10-26',
      codes: ['sh600036'],
      start: 'cash',
      cash: 5_000_000,
      blind: false,
      hideNames: false,
    });
    const snaps = [
      [T(14, 59, 57), 40100],
      [T(15, 0, 3), 40200],
      [T(15, 6, 0), 40200],
    ].map(([t, last]) => quote('2026-10-26', t, last, 500000).snapshot);
    const s = new PracticeSession(rec, snaps, sim.calendar);
    s.runTo(T(15, 10));
    const pts = s.points('sh600036');
    expect(pts[pts.length - 1]).toMatchObject({ t: T(15, 0), price: 40200 });
  });
});
