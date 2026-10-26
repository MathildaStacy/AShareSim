import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/** 后台跟踪挂单的前台服务（Android）。iOS 后补，现在只有 Android 实现。 */
export interface Spec extends TurboModule {
  /** 启动前台服务和 Headless JS 任务 AShareSimTracker；已经在跑就只更新通知。 */
  start(title: string, text: string): Promise<boolean>;
  update(text: string): void;
  stop(): void;
  isRunning(): Promise<boolean>;
  /** 用户最后一次在通知上点「停止跟踪」的时间（毫秒），没点过是 0。 */
  userStoppedAt(): Promise<number>;
  /** 系统电池优化有没有对本 App 关掉（HyperOS 还要另外在「省电策略」里设无限制）。 */
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  requestIgnoreBatteryOptimizations(): void;
  /** 打开本 App 的系统设置页（HyperOS 的省电策略、自启动都从这里进）。 */
  openAppSettings(): void;
}

export default TurboModuleRegistry.get<Spec>('BackgroundTracker');
