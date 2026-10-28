/// <reference types="node" />
/**
 * 评测用的 App：内存库 + 用录好的行情 / 资讯样本回答所有网络请求（__tests__/market/fixtures），
 * 所以工具结果固定。2026-10-26 14:53，账户 10 万元，持有 1,000 股招商银行。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppCore } from '../../../../src/app/boot';
import { openMemoryDb } from '../../../../src/data/drivers/nodeSqlite';
import { migrate } from '../../../../src/data/migrations';
import { T } from '../../../../src/engine';
import { MarketClient } from '../../../../src/market/client';
import { DEFAULT_REFRESH, type Refresher } from '../../../../src/sim/refresher';
import { Simulator } from '../../../../src/sim/simulator';
import { saveStrategy } from '../../../../src/portfolio/repo';
import { DEFAULT_STRATEGY } from '../../../../src/portfolio/types';
import { parseQuotes } from '../../../../src/market/tencent';

const fx = (name: string) =>
  readFileSync(join(__dirname, '../../../market/fixtures', name), 'utf8');

const ROUTES: [RegExp, string][] = [
  [/fqkline\/get\?param=sh600036,day/, 'kline-day-sh600036.json'],
  [/fqkline\/get\?param=sh510300,week/, 'kline-week-sh510300.json'],
  [/np-anotice-stock/, 'em-ann-600036.json'],
  [/np-cnotice-stock/, 'em-ann-content.json'],
  [/reportapi\.eastmoney/, 'em-research-600036.json'],
  [/search-api-web/, 'em-news.txt'],
  [/smartbox\.gtimg/, 'smartbox-zsyh.txt'],
  [/RPT_SHAREBONUS_DET/, 'eastmoney-bonus-600036.json'],
  [/getBoardRankList/, 'rank-astock.json'],
];

export const QT = fx('qt-2026-10-26-1452.txt');

/** 录好的行情：只返回请求里那几只的那几行。 */
function qt(url: string): string {
  const codes = decodeURIComponent(url.split('q=')[1] ?? '').split(',');
  return QT.split('\n')
    .filter(l => codes.some(c => l.startsWith('v_' + c + '=')))
    .join('\n');
}

export const fixtureFetch = async (url: string): Promise<string> => {
  if (url.includes('qt.gtimg.cn')) {
    return qt(url);
  }
  const hit = ROUTES.find(([re]) => re.test(url));
  if (!hit) {
    throw new Error('评测没有录这个请求：' + url);
  }
  return fx(hit[1]);
};

export async function evalCore(): Promise<AppCore> {
  const db = openMemoryDb();
  await migrate(db);
  const clock = { date: '2026-10-26', t: T(14, 53) };
  const client = new MarketClient(fixtureFetch);
  const sim = await Simulator.open(db, client, () => clock);
  await sim.ingest(parseQuotes(QT));
  await sim.deposit(10_000_000);
  const r = await sim.placeOrder({
    code: 'sh600036',
    side: 'B',
    kind: 'limit',
    price: 40_000,
    qty: 1000,
    protect: null,
  });
  if (!r.ok) {
    throw new Error(r.msg);
  }
  await saveStrategy(db, DEFAULT_STRATEGY);
  const refresher = {
    settings: { ...DEFAULT_REFRESH },
    setExtraCodes() {},
    kick() {},
  } as unknown as Refresher;
  return { db, client, sim, refresher } as AppCore;
}
