/**
 * 自选列表：自选页、搜索、个股页的星标、编辑页共用。改动立刻写库、告诉 Simulator（要存快照的证券）并刷新一次。
 */
import { create } from 'zustand';
import type { AppCore } from '../app/boot';
import * as repo from '../data/repos';
import { beijingIso } from '../market/clock';
import { viewLogger } from './hooks';

interface WatchStore {
  codes: string[];
  loaded: boolean;
}

export const useWatch = create<WatchStore>(() => ({
  codes: [],
  loaded: false,
}));

async function reload(core: AppCore): Promise<void> {
  const codes = await repo.watchlist(core.db);
  core.sim.setWatchlist(codes);
  useWatch.setState({ codes, loaded: true });
}

export const watch = {
  load: reload,

  has: (code: string) => useWatch.getState().codes.includes(code),

  async add(core: AppCore, code: string, name: string): Promise<void> {
    await repo.addWatch(core.db, code, beijingIso());
    await reload(core);
    core.refresher.kick();
    await viewLogger(core).setting('加入自选 ' + name, { code });
  },

  async remove(core: AppCore, code: string, name: string): Promise<void> {
    await repo.removeWatch(core.db, code);
    await reload(core);
    await viewLogger(core).setting('移出自选 ' + name, { code });
  },

  async toggle(core: AppCore, code: string, name: string): Promise<void> {
    return watch.has(code)
      ? watch.remove(core, code, name)
      : watch.add(core, code, name);
  },

  async reorder(core: AppCore, codes: string[]): Promise<void> {
    useWatch.setState({ codes });
    await repo.reorderWatchlist(core.db, codes);
    core.sim.setWatchlist(codes);
  },
};
