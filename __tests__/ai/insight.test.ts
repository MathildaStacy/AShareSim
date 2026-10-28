/// <reference types="node" />
/**
 * M5.5 的只读工具和提案工具：SQL 只读保护、选股过滤、propose 存成提案卡、风险限额操作卡。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppCore } from '../../src/app/boot';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import { T } from '../../src/engine';
import type { MarketClient } from '../../src/market/client';
import { parseQuotes } from '../../src/market/tencent';
import { DEFAULT_REFRESH, type Refresher } from '../../src/sim/refresher';
import { Simulator } from '../../src/sim/simulator';
import {
  checkSql,
  queryLocal,
  screenQuotes,
  sqlTokens,
} from '../../src/ai/tools/insight';
import { runTool, type ToolEnv } from '../../src/ai/tools/index';
import { executeCard, previewCard } from '../../src/ai/tools/actions';
import * as advice from '../../src/advice/repo';
import type { ActionCard } from '../../src/ai/types';

jest.mock('../../src/data/drivers/opSqlite', () => ({
  openDeviceDb: () => {
    throw new Error('测试里不用设备数据库');
  },
}));
jest.mock('../../src/app/tracker', () => ({ nativeTracker: () => null }));

const fx = (name: string) =>
  readFileSync(join(__dirname, '../market/fixtures', name), 'utf8');
const quotes = parseQuotes(fx('qt-2026-10-26-1452.txt'));

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  const clock = { date: '2026-10-26', t: T(14, 53) };
  const client = {
    quotes: async (codes: string[]) =>
      quotes.filter(q => codes.includes(q.snapshot.code)),
    search: async () => [],
    rank: async () =>
      quotes.map(q => ({
        code: q.snapshot.code,
        name: q.info.name,
        type: q.info.type,
        last: q.snapshot.last,
        change: 0,
        pct: q.info.pct,
        volume: q.snapshot.volume,
        amount: q.snapshot.amount,
      })),
  } as unknown as MarketClient;
  const sim = await Simulator.open(db, client, () => clock);
  await sim.ingest(quotes);
  await sim.deposit(10_000_000);
  const refresher = {
    settings: { ...DEFAULT_REFRESH },
    setExtraCodes() {},
    kick() {},
  } as unknown as Refresher;
  const core = { db, client, sim, refresher } as AppCore;
  let no = 0;
  const env: ToolEnv = {
    core,
    threadId: 1,
    memoryMode: 'auto',
    nextCardNo: () => ++no,
  };
  return { core, env, db, sim };
}

describe('query_local_db', () => {
  const TABLES = ['account', 'settings', 'ai_memory', 'kline_day', 'security'];
  test('只能一条 SELECT / WITH，只能查白名单表', () => {
    expect(checkSql('SELECT * FROM kline_day', TABLES)).toBeNull();
    expect(
      checkSql(
        'WITH x AS (SELECT code FROM security) SELECT * FROM x;',
        TABLES,
      ),
    ).toBeNull();
    expect(checkSql('DELETE FROM kline_day', TABLES)).toMatch('SELECT');
    expect(checkSql('SELECT 1; DROP TABLE kline_day', TABLES)).toMatch('一条');
    expect(checkSql('SELECT * FROM account', TABLES)).toMatch(
      '不能查表 account',
    );
    expect(checkSql('SELECT * FROM "settings"', TABLES)).toMatch('settings');
    expect(checkSql('SELECT * FROM [ai_memory]', TABLES)).toMatch('ai_memory');
    expect(checkSql('SELECT name FROM sqlite_master', TABLES)).toMatch(
      'sqlite_master',
    );
    expect(
      checkSql('WITH RECURSIVE r(n) AS (SELECT 1) SELECT * FROM r', TABLES),
    ).toMatch('RECURSIVE');
    // 字符串里的表名和关键字不算
    expect(
      checkSql("SELECT 'account; delete' AS x FROM kline_day", TABLES),
    ).toBeNull();
    expect(sqlTokens("SELECT 'it''s' FROM t").words).toEqual([
      'select',
      'from',
      't',
    ]);
    expect(checkSql("SELECT 'oops FROM kline_day", TABLES)).toMatch('闭合');
  });

  test('在只读模式下执行，限制行数；之后写库照常', async () => {
    const { db } = await setup();
    for (let i = 0; i < 5; i++) {
      await db.run('INSERT INTO kline_day VALUES (?,?,?,?,?,?,?)', [
        'sh600036',
        '2026-10-2' + i,
        1,
        2,
        3,
        0,
        9,
      ]);
    }
    const r = await queryLocal(
      db,
      'SELECT date FROM kline_day ORDER BY date',
      3,
    );
    expect(r.rows.map(x => x.date)).toEqual([
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
    ]);
    expect(r.more).toBe(true);
    await expect(queryLocal(db, 'SELECT * FROM account', 3)).rejects.toThrow(
      '不能查表',
    );
    expect(
      (await queryLocal(db, 'SELECT count(*) AS n FROM kline_day', 5)).rows[0]
        .n,
    ).toBe(5);
    await db.run("INSERT INTO settings VALUES ('x','1')");
    expect(await db.get("SELECT value FROM settings WHERE key='x'")).toEqual({
      value: '1',
    });
  });
});

test('screen：按条件过滤、排除 ST、排序', () => {
  const out = screenQuotes(
    quotes,
    { pe_max: 20, exclude_st: true },
    'pe',
    false,
  );
  expect(out.length).toBeGreaterThan(0);
  expect(out.every(q => q.info.pe != null && q.info.pe <= 20)).toBe(true);
  expect(out.some(q => /ST/.test(q.info.name))).toBe(false);
  const pes = out.map(q => q.info.pe!);
  expect(pes).toEqual([...pes].sort((a, b) => a - b));
  expect(screenQuotes(quotes, { amount_min: 1e9 }, 'pct', true)).toEqual([]);
});

describe('propose 和风险限额', () => {
  test('propose 存成提案卡；参数不全时报错，不生成', async () => {
    const { env, db } = await setup();
    const bad = await runTool(
      env,
      't1',
      'propose',
      JSON.stringify({
        kind: 'single',
        items: [{ code: 'sh600036', stance: 'buy' }],
        horizon_days: 20,
        thesis: '估值低',
        invalidation: '',
      }),
    );
    expect(bad.ui.error).toBe(true);
    expect(bad.output).toContain('失效条件');
    const ok = await runTool(
      env,
      't2',
      'propose',
      JSON.stringify({
        kind: 'single',
        items: [
          {
            code: '600036',
            stance: 'buy',
            weight: 0.1,
            price_low: 38.5,
            price_high: 40,
          },
        ],
        horizon_days: 20,
        thesis: '股息率高',
        invalidation: '跌破 36 元',
      }),
    );
    expect(ok.ui.proposal).toEqual({ id: 1 });
    expect(ok.output).toContain('已记下提案 #1');
    expect(ok.output).toContain('批准不等于下单');
    const p = (await advice.proposalById(db, 1))!;
    expect(p.items[0]).toMatchObject({
      code: 'sh600036',
      name: '招商银行',
      priceLow: 38500,
      priceHigh: 40000,
    });
    expect(p.benchmark).toBe('sh510300');
    const card = await runTool(env, 't3', 'get_scorecard', '{}');
    expect(card.output).toContain('AI 提案：已对账 0 条');
    expect(card.output).toContain('#1');
  });

  test('set_settings 改风险限额：卡上写明前后，执行后下单卡多一行风险校验', async () => {
    const { core } = await setup();
    const d = await previewCard(core, 'set_settings', {
      risk_max_weight: 10,
      risk_no_st: true,
    });
    expect(d.check.ok).toBe(true);
    expect(d.rows).toContainEqual({
      k: '风险限额',
      v: '未设置 → 单票上限 10% · 禁买 ST',
    });
    const card = {
      ...d,
      no: 1,
      tool: 'set_settings',
      args: { risk_max_weight: 10, risk_no_st: true },
      accountId: core.sim.accountId,
      status: 'pending',
    } as ActionCard;
    expect((await executeCard(core, card)).ok).toBe(true);
    const order = await previewCard(core, 'place_order', {
      code: 'sh600036',
      side: 'B',
      price: 40,
      qty: 500,
    });
    expect(order.check.ok).toBe(false);
    expect(order.check.text).toContain('风险限额');
    expect(order.rows.find(r => r.k === '风险校验')!.v).toMatch(
      /^不通过：单票上限 10%/,
    );
    const bad = await previewCard(core, 'set_settings', {
      risk_max_weight: 150,
    });
    expect(bad.check).toMatchObject({ ok: false });
  });
});
