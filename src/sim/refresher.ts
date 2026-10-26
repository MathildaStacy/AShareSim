/**
 * 行情刷新和后台跟踪。
 *
 * - 前台：交易时段每 3 秒刷新（当前页面 + 自选 + 持仓 + 有委托的），午休和收盘后每 60 秒一次。
 * - 后台：只有前台服务在跑时 JS 定时器才不会停（见 TrackerService）。默认「有未完成委托时跟踪」：
 *   交易日 9:00–15:30 有未成交委托就开前台服务，只刷新有委托的那几只，默认 5 秒一次；委托都结束、
 *   收盘或者你在通知上点了「停止跟踪」（当天不再自动开启）就停。午休不请求行情。
 * - 前台服务只能在 App 在前台时启动（Android 12 起的限制），所以条件满足时在前台就先开着，通知同时显示流量。
 * - 回到前台时先补撮合（catchUp），再接着刷新。
 */
import type { TradingCalendar } from '../engine/calendar';
import type { Now } from '../engine/engine';
import { T, type Sec } from '../engine/session';
import type { MarketClient } from '../market/client';
import type { Simulator } from './simulator';

export type Window = 'pre' | 'session' | 'lunch' | 'closed';

/** 交易日里现在处在哪一段。session 前后各留 30 秒余量，收盘后到 15:30 盘后交易结束也算。 */
export function marketWindow(now: Now, calendar: TradingCalendar): Window {
  if (!calendar.isTradingDay(now.date)) {
    return 'closed';
  }
  const t = now.t;
  if (t < T(9, 0)) {
    return 'closed';
  }
  if (t < T(9, 14)) {
    return 'pre';
  }
  if (t < T(11, 30, 30)) {
    return 'session';
  }
  if (t < T(12, 59, 30)) {
    return 'lunch';
  }
  if (t < T(15, 30, 30)) {
    return 'session';
  }
  return 'closed';
}

export type BackgroundMode = 'orders' | 'session' | 'off';

export interface RefreshSettings {
  foregroundMs: number;
  backgroundMs: number;
  /** orders：有未完成委托时跟踪；session：交易时段一直跟踪（完整录快照，M6 回放用）；off：不跟踪。 */
  backgroundMode: BackgroundMode;
  /** 快照保留多少个交易日。 */
  snapshotKeepDays: number;
}

export const DEFAULT_REFRESH: RefreshSettings = {
  foregroundMs: 3000,
  backgroundMs: 5000,
  backgroundMode: 'orders',
  snapshotKeepDays: 20,
};

/** 后台跟踪要不要开。 */
export function trackerWanted(
  win: Window,
  mode: BackgroundMode,
  liveOrders: number,
  userStoppedToday: boolean,
): boolean {
  if (mode === 'off' || userStoppedToday || win === 'closed') {
    return false;
  }
  return mode === 'session' || liveOrders > 0;
}

/** 下一次刷新隔多久（毫秒）；null 表示后台不用再刷新了。 */
export function nextDelay(
  win: Window,
  foreground: boolean,
  tracking: boolean,
  s: RefreshSettings,
  t: Sec,
): number | null {
  if (!foreground && !tracking) {
    return null;
  }
  if (win === 'session') {
    return foreground ? s.foregroundMs : s.backgroundMs;
  }
  if (win === 'lunch' || win === 'pre') {
    // 睡到下一段开始（最多 60 秒检查一次）
    const until = win === 'lunch' ? T(12, 59, 30) : T(9, 14);
    return Math.max(1000, Math.min(60_000, (until - t) * 1000));
  }
  return 60_000;
}

/** 前台服务的接口（测试里换成假的）。 */
export interface TrackerPort {
  start(title: string, text: string): Promise<boolean>;
  update(text: string): void;
  stop(): void;
  isRunning(): Promise<boolean>;
  userStoppedAt(): Promise<number>;
}

export interface RefreshStatus {
  window: Window;
  foreground: boolean;
  tracking: boolean;
  lastOk: number | null;
  lastError: string | null;
  failures: number;
  requestsToday: number;
  bytesToday: number;
}

export class Refresher {
  private foreground = true;
  private tracking = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private extra: string[] = [];
  private lastOk: number | null = null;
  private lastError: string | null = null;
  private failures = 0;
  private lastNotify = 0;
  private lastAfter = 0;
  private ended: Promise<void> | null = null;
  private endResolve: (() => void) | null = null;
  private listeners = new Set<(s: RefreshStatus) => void>();

  constructor(
    private sim: Simulator,
    private client: MarketClient,
    private tracker: TrackerPort | null,
    public settings: RefreshSettings,
    private clock: () => Now,
  ) {}

  status(): RefreshStatus {
    const now = this.clock();
    return {
      window: marketWindow(now, this.sim.calendar),
      foreground: this.foreground,
      tracking: this.tracking,
      lastOk: this.lastOk,
      lastError: this.lastError,
      failures: this.failures,
      requestsToday: this.client.traffic.requests,
      bytesToday: this.client.traffic.bytes,
    };
  }

  onStatus(fn: (s: RefreshStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 当前页面要看的证券（个股详情、行情页的指数等）。 */
  setExtraCodes(codes: string[]): void {
    this.extra = codes;
  }

  /**
   * Headless JS 任务等这个 Promise：后台跟踪结束时完成，任务随之结束。
   * 启动前台服务之前就建好，避免任务先跑起来、看到「没在跟踪」就立刻结束。
   */
  whenTrackingEnds(): Promise<void> {
    return this.ended ?? Promise.resolve();
  }

  private endTracking(): void {
    this.tracking = false;
    this.endResolve?.();
    this.ended = null;
    this.endResolve = null;
  }

  start(): void {
    this.schedule(0);
  }

  async setForeground(fg: boolean): Promise<void> {
    if (fg === this.foreground) {
      return;
    }
    this.foreground = fg;
    if (fg) {
      // 回到前台：先补撮合中断的那段（后台跟踪没开或被杀时），再刷新
      await this.sim.catchUp().catch(() => undefined);
      this.schedule(0);
    }
  }

  /** 下单、撤单之后立刻刷新一次，并按需要开后台跟踪。 */
  kick(): void {
    this.schedule(0);
  }

  private schedule(ms: number): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.loop();
    }, ms);
  }

  private codes(): string[] {
    const orders = this.sim.activeOrderCodes(this.clock().date);
    if (!this.foreground) {
      return this.settings.backgroundMode === 'session'
        ? [...this.sim.recordedCodes()]
        : orders;
    }
    return [...new Set([...this.extra, ...this.sim.recordedCodes()])];
  }

  private async loop(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    let delay: number | null = null;
    try {
      const now = this.clock();
      const win = marketWindow(now, this.sim.calendar);
      const codes = this.codes();
      if (codes.length && (win === 'session' || this.foreground)) {
        try {
          const quotes = await this.client.quotes(codes);
          await this.sim.ingest(quotes);
          this.lastOk = Date.now();
          this.lastError = null;
          this.failures = 0;
        } catch (e) {
          this.failures++;
          this.lastError = e instanceof Error ? e.message : String(e);
        }
      }
      // 盘后固定价格交易用分时数据撮合，分钟级别，30 秒查一次就够
      if (
        win === 'session' &&
        now.t >= T(15, 5) &&
        Date.now() - this.lastAfter > 30_000
      ) {
        this.lastAfter = Date.now();
        await this.sim.ingestAfterHours().catch(() => undefined);
      }
      await this.sim.tick();
      await this.updateTracker(win);
      delay = nextDelay(
        win,
        this.foreground,
        this.tracking,
        this.settings,
        now.t,
      );
      // 连续失败时退避，最多 60 秒
      if (delay != null && this.failures > 2) {
        delay = Math.min(60_000, delay * 2 ** Math.min(this.failures - 2, 4));
      }
    } finally {
      this.running = false;
    }
    const st = this.status();
    this.listeners.forEach(fn => fn(st));
    if (delay != null) {
      this.schedule(delay);
    }
  }

  private async updateTracker(win: Window): Promise<void> {
    if (!this.tracker) {
      return;
    }
    const orders = this.sim.activeOrderCodes(this.clock().date).length;
    const stoppedAt = await this.tracker.userStoppedAt();
    const today = this.clock().date;
    const stoppedToday =
      stoppedAt > 0 &&
      new Date(stoppedAt + 8 * 3600_000).toISOString().slice(0, 10) === today;
    const want = trackerWanted(
      win,
      this.settings.backgroundMode,
      orders,
      stoppedToday,
    );
    const running = await this.tracker.isRunning();
    if (want && !running) {
      if (this.foreground) {
        this.ended = new Promise(resolve => {
          this.endResolve = resolve;
        });
        this.tracking = true;
        try {
          await this.tracker.start(
            'AShareSim 正在后台跟踪',
            this.notificationText(),
          );
        } catch {
          this.endTracking();
        }
      } else if (this.tracking) {
        this.endTracking(); // 在后台被停了（通知上点了停止、被系统杀了服务）
      }
    } else if (!want && running) {
      this.tracker.stop();
      this.endTracking();
    } else if (!running && this.tracking) {
      this.endTracking();
    }
    if (this.tracking && Date.now() - this.lastNotify > 15_000) {
      this.lastNotify = Date.now();
      this.tracker.update(this.notificationText());
    }
  }

  private notificationText(): string {
    const orders = this.sim.activeOrderCodes(this.clock().date).length;
    const mb = (this.client.traffic.bytes / 1024 / 1024).toFixed(1);
    const what =
      this.settings.backgroundMode === 'session'
        ? '交易时段全程刷新'
        : '跟踪 ' + orders + ' 只证券的挂单';
    return (
      what +
      ' · 每 ' +
      this.settings.backgroundMs / 1000 +
      ' 秒 · 今日流量约 ' +
      mb +
      ' MB' +
      (this.lastError ? ' · ' + this.lastError : '')
    );
  }
}
