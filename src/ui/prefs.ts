/**
 * 界面偏好（存在 settings 表）：持仓列表的成本口径。默认摊薄成本（和同花顺、东方财富默认一致），
 * 设置页可以改成买入均价（记操作日志）；持仓详情两个都显示。
 */
import { create } from 'zustand';
import type { AppCore } from '../app/boot';
import * as repo from '../data/repos';

export type CostBasis = 'diluted' | 'average';

export const COST_BASIS_NAME: Record<CostBasis, string> = {
  diluted: '摊薄成本',
  average: '买入均价',
};

interface Prefs {
  costBasis: CostBasis;
  loaded: boolean;
}

export const usePrefs = create<Prefs>(() => ({
  costBasis: 'diluted',
  loaded: false,
}));

export const prefs = {
  async load(core: AppCore): Promise<void> {
    const costBasis = await repo.getSetting<CostBasis>(
      core.db,
      'costBasis',
      'diluted',
    );
    usePrefs.setState({ costBasis, loaded: true });
  },
  async setCostBasis(core: AppCore, v: CostBasis): Promise<void> {
    const old = usePrefs.getState().costBasis;
    if (old === v) {
      return;
    }
    usePrefs.setState({ costBasis: v });
    await repo.setSetting(core.db, 'costBasis', v);
    await core.sim.logSetting(
      '持仓成本口径 ' + COST_BASIS_NAME[old] + ' → ' + COST_BASIS_NAME[v],
      { setting: 'costBasis' },
    );
  },
};
