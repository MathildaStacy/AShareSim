/// <reference types="node" />
import { T } from '../../src/engine/session';
import { journalDays, journalOf } from '../../src/replay/journal';
import { verifyDay } from '../../src/replay/verify';
import { liveDay } from './helpers/liveDay';

describe('M6 输入日志与核对', () => {
  test('实时模拟的一天按日志重放，事件逐笔一致，日终状态一致', async () => {
    const { db, sim } = await liveDay();
    const deps = {
      calendar: sim.calendar,
      security: (c: string) => sim.security(c),
    };
    const r = await verifyDay(db, sim.accountId, '2026-10-26', deps);
    expect(r.notes).toEqual([]);
    expect(r.segments).toBe(2); // 开盘前一段 + 重启后一段
    expect(r.fills.live).toBeGreaterThanOrEqual(4);
    expect(r.fills).toEqual({
      live: r.fills.live,
      replay: r.fills.live,
      matched: r.fills.live,
    });
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
    expect(r.endState).toEqual([]);
    expect(r.ok).toBe(true);
    expect((await journalDays(db, sim.accountId)).map(d => d.date)).toEqual([
      '2026-10-27',
      '2026-10-26',
    ]);
  });

  test('有委托的证券快照只记引用，没委托的证券不记', async () => {
    const { db, sim } = await liveDay();
    const rows = await journalOf(db, sim.accountId, '2026-10-26');
    const snaps = rows.filter(r => r.input.kind === 'snap');
    expect(snaps.length).toBeGreaterThan(0);
    for (const r of snaps) {
      const body = r.input.body as { ref?: { code: string } };
      expect(body.ref).toBeDefined();
    }
    const kinds = rows.map(r => r.input.kind);
    expect(kinds[0]).toBe('seed');
    expect(kinds).toContain('place');
    expect(kinds).toContain('cancel');
    expect(kinds).toContain('deposit');
  });

  test('快照被改过时核对不通过，并写明原因', async () => {
    const { db, sim } = await liveDay();
    await db.run(
      "UPDATE quotes_snapshot SET last=39600 WHERE code='sh600036' AND t=?",
      [T(10, 4, 57)],
    );
    const r = await verifyDay(db, sim.accountId, '2026-10-26', {
      calendar: sim.calendar,
      security: c => sim.security(c),
    });
    expect(r.ok).toBe(false);
    expect(r.notes.join('')).toContain('同一秒的修正覆盖');
  });

  test('实时记录和回放对不上时列出差异', async () => {
    const { db, sim } = await liveDay();
    await db.run(
      "DELETE FROM account_event WHERE id = (SELECT MAX(id) FROM account_event WHERE type='fill')",
    );
    const r = await verifyDay(db, sim.accountId, '2026-10-26', {
      calendar: sim.calendar,
      security: c => sim.security(c),
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([]);
    expect(r.extra).toHaveLength(1);
    expect(r.extra[0]).toMatch(/^成交 /);
    expect(r.fills.replay).toBe(r.fills.live + 1);
  });

  test('没有日志的日期如实说明', async () => {
    const { db, sim } = await liveDay();
    const r = await verifyDay(db, sim.accountId, '2026-10-20', {
      calendar: sim.calendar,
      security: c => sim.security(c),
    });
    expect(r.ok).toBe(false);
    expect(r.notes[0]).toContain('没有输入日志的起点');
  });
});
