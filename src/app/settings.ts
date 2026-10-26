/**
 * 设置页的修改：存进 settings 表、交给运行中的 Refresher，并记操作日志（kind setting）。
 */
import * as repo from '../data/repos';
import type { RefreshSettings } from '../sim/refresher';
import { BACKGROUND_MODE_NAME, keepName, msName } from '../sim/settings';
import type { AppCore } from './boot';

/** 改后台跟踪和快照保留；返回改了哪些（一项一句）。 */
export async function updateRefreshSettings(
  core: AppCore,
  patch: Partial<Omit<RefreshSettings, 'foregroundMs'>>,
): Promise<string[]> {
  const old = core.refresher.settings;
  const next: RefreshSettings = { ...old, ...patch };
  const diff: string[] = [];
  if (next.backgroundMode !== old.backgroundMode) {
    diff.push(
      '后台跟踪 ' +
        BACKGROUND_MODE_NAME[old.backgroundMode] +
        ' → ' +
        BACKGROUND_MODE_NAME[next.backgroundMode],
    );
  }
  if (next.backgroundMs !== old.backgroundMs) {
    diff.push(
      '后台刷新间隔 ' +
        msName(old.backgroundMs) +
        ' → ' +
        msName(next.backgroundMs),
    );
  }
  if (next.snapshotKeepDays !== old.snapshotKeepDays) {
    diff.push(
      '快照保留 ' +
        keepName(old.snapshotKeepDays) +
        ' → ' +
        keepName(next.snapshotKeepDays),
    );
  }
  if (!diff.length) {
    return diff;
  }
  core.refresher.settings = next;
  // 前台间隔不是设置项，不存，跟着版本走
  await repo.setSetting(core.db, 'refresh', {
    backgroundMs: next.backgroundMs,
    backgroundMode: next.backgroundMode,
    snapshotKeepDays: next.snapshotKeepDays,
  });
  if (next.snapshotKeepDays !== old.snapshotKeepDays) {
    await repo.pruneSnapshots(core.db, next.snapshotKeepDays);
  }
  await core.sim.logSetting(diff.join('，'), { setting: 'refresh' });
  // 马上按新设置开关后台跟踪
  core.refresher.kick();
  return diff;
}
