/**
 * 后台跟踪前台服务的 JS 封装：启动前先申请通知权限（Android 13 起要运行时申请）。
 * 没有原生模块时（iOS、测试）返回 null，App 照常运行，只是没有后台跟踪。
 */
import { PermissionsAndroid, Platform } from 'react-native';
import Native from '../native/NativeBackgroundTracker';
import type { TrackerPort } from '../sim/refresher';

let asked = false;

async function ensureNotificationPermission(): Promise<void> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33 || asked) {
    return;
  }
  asked = true;
  const perm = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (!(await PermissionsAndroid.check(perm))) {
    // 不给权限服务也能跑，只是通知栏看不到流量和「停止跟踪」按钮
    await PermissionsAndroid.request(perm);
  }
}

export function nativeTracker(): TrackerPort | null {
  const m = Native;
  if (!m) {
    return null;
  }
  return {
    async start(title, text) {
      await ensureNotificationPermission();
      return m.start(title, text);
    },
    update: text => m.update(text),
    stop: () => m.stop(),
    isRunning: () => m.isRunning(),
    userStoppedAt: () => m.userStoppedAt(),
  };
}

export const batterySettings = {
  isIgnoring: () =>
    Native?.isIgnoringBatteryOptimizations() ?? Promise.resolve(false),
  request: () => Native?.requestIgnoreBatteryOptimizations(),
  openAppSettings: () => Native?.openAppSettings(),
};
