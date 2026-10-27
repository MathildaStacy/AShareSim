/**
 * App 启动：打开本地库 → 迁移 → 打开模拟账户 → 补撮合 → 拉分红送配 → 开始刷新。
 * 后台跟踪的 Headless JS 任务也从这里拿到同一个 Refresher。
 */
import { AppState } from 'react-native';
import { create } from 'zustand';
import type { Db } from '../data/db';
import { openDeviceDb } from '../data/drivers/opSqlite';
import { migrate } from '../data/migrations';
import * as repo from '../data/repos';
import type { EngineEvent } from '../engine/types';
import { beijingIso, beijingNow } from '../market/clock';
import { MarketClient } from '../market/client';
import { phaseAt } from '../engine/session';
import {
  DEFAULT_REFRESH,
  Refresher,
  type RefreshSettings,
  type RefreshStatus,
} from '../sim/refresher';
import { Simulator } from '../sim/simulator';
import { syncLearn } from './learn';
import { nativeTracker } from './tracker';

export interface AppCore {
  db: Db;
  client: MarketClient;
  sim: Simulator;
  refresher: Refresher;
}

interface AppStore {
  core: AppCore | null;
  error: string | null;
  status: RefreshStatus | null;
  /** 账户状态每变一次加 1，界面据此重新读引擎状态。 */
  version: number;
  /** 报价或交易时段变化时加 1，行情页据此重画。 */
  tick: number;
  lastEvents: EngineEvent[];
}

export const useApp = create<AppStore>(() => ({
  core: null,
  error: null,
  status: null,
  version: 0,
  tick: 0,
  lastEvents: [],
}));

let booting: Promise<AppCore> | null = null;

export function boot(): Promise<AppCore> {
  booting ??= doBoot().catch(e => {
    booting = null;
    useApp.setState({ error: e instanceof Error ? e.message : String(e) });
    throw e;
  });
  return booting;
}

async function doBoot(): Promise<AppCore> {
  const db = openDeviceDb();
  await migrate(db);
  const client = new MarketClient();
  const sim = await Simulator.open(db, client);
  sim.setWatchlist(await repo.watchlist(db));
  const settings = {
    ...DEFAULT_REFRESH,
    ...(await repo.getSetting<Partial<RefreshSettings>>(db, 'refresh', {})),
    foregroundMs: DEFAULT_REFRESH.foregroundMs,
  };
  const refresher = new Refresher(
    sim,
    client,
    nativeTracker(),
    settings,
    beijingNow,
  );
  const core: AppCore = { db, client, sim, refresher };

  sim.subscribe(events => {
    useApp.setState(s => ({ version: s.version + 1, lastEvents: events }));
    // 有成交时看看路线图的自动项（集合竞价买 ETF）是不是满足了
    if (events.some(e => e.type === 'fill')) {
      syncLearn(core).catch(() => undefined);
    }
  });
  sim.subscribeQuotes(() => useApp.setState(s => ({ tick: s.tick + 1 })));
  let phaseKey = '';
  refresher.onStatus(status => {
    const now = sim.now(),
      key = now.date + '|' + phaseAt(now.t) + '|' + status.window;
    const changed = key !== phaseKey;
    phaseKey = key;
    useApp.setState(s => ({ status, tick: s.tick + (changed ? 1 : 0) }));
  });

  await sim.refreshCorporateActions().catch(() => undefined);
  await sim.catchUp().catch(() => undefined);
  await housekeeping(core);
  AppState.addEventListener('change', st => {
    refresher.setForeground(st === 'active');
  });
  refresher.start();
  useApp.setState(s => ({ core, version: s.version + 1 }));
  return core;
}

/** 每天一次：按设置清理旧快照，操作日志保留 500 条 / 90 天。 */
async function housekeeping(core: AppCore): Promise<void> {
  const today = beijingNow().date;
  if ((await repo.getSetting(core.db, 'housekeeping', '')) === today) {
    return;
  }
  await repo.pruneSnapshots(core.db, core.refresher.settings.snapshotKeepDays);
  await repo.pruneActivity(core.db, beijingIso(Date.now() - 90 * 86400_000));
  await repo.setSetting(core.db, 'housekeeping', today);
}

/** 后台跟踪的 Headless JS 任务：前台服务开着时一直等着，跟踪结束时完成。 */
export async function trackerTask(): Promise<void> {
  const core = await boot();
  await core.refresher.whenTrackingEnds();
}
