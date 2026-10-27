/**
 * 行情刷新和后台跟踪。
 *
 * - 前台：可见报价目标 1 秒，其余自选/持仓/委托维持 3 秒，午休和收盘后每 60 秒一次。
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
  foregroundMs: 1000,
  backgroundMs: 5000,
  backgroundMode: 'orders',
  snapshotKeepDays: 20,
};

/** 不可见但需记录/撮合的证券，维持原来的较慢周期。 */
export const PASSIVE_REFRESH_MS = 3000;
/** 严重超时后不忙循环，也不补发已经错过的请求。 */
const MIN_LOOP_DELAY_MS = 50;

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
  visible = true,
): number | null {
  if (!foreground && !tracking) {
    return null;
  }
  if (win === 'session') {
    return foreground
      ? visible
        ? s.foregroundMs
        : PASSIVE_REFRESH_MS
      : s.backgroundMs;
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
  private timerAt = 0;
  private running = false;
  private extra: string[] = [];
  private passiveAt = 0;
  private pending: 'force' | 'visible' | null = null;
  private lastQuoteStart: number | null = null;
  private stopped = false;
  private resuming = false;
  private resumeWork: Promise<void> = Promise.resolve();
  private inFlight: Promise<void> | null = null;
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
    const next = [...new Set(codes)].sort();
    if (next.join(',') === this.extra.join(',')) {
      return;
    }
    this.extra = next;
    this.wake(false);
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
    this.stopped = false;
    this.wake();
  }

  stop(): void {
    this.stopped = true;
    this.pending = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.tracking) {
      this.tracker?.stop();
      this.endTracking();
    }
  }

  async setForeground(fg: boolean): Promise<void> {
    if (fg === this.foreground) {
      return;
    }
    this.foreground = fg;
    this.passiveAt = 0;
    if (fg) {
      // 先等正在进行的轮询结束，再补撮合；补撮合期间禁止启动另一轮。
      this.resuming = true;
      const work = this.resumeWork.then(async () => {
        await this.inFlight;
        if (this.foreground && !this.stopped) {
          await this.sim.catchUp().catch(() => undefined);
        }
      });
      this.resumeWork = work;
      try {
        await work;
      } finally {
        if (this.resumeWork === work) {
          this.resuming = false;
          this.wake();
        }
      }
    } else {
      this.wake();
    }
  }

  /** 下单、撤单之后立刻刷新一次，并按需要开后台跟踪。 */
  kick(): void {
    this.passiveAt = 0;
    this.wake();
  }

  private visibleDelay(): number {
    return this.foreground && this.lastQuoteStart != null
      ? Math.max(
          0,
          this.backoff(this.settings.foregroundMs) -
            (Date.now() - this.lastQuoteStart),
        )
      : 0;
  }

  private backoff(period: number): number {
    return this.failures > 2
      ? Math.min(60_000, period * 2 ** Math.min(this.failures - 2, 4))
      : period;
  }

  private wake(force = true): void {
    if (this.stopped) {
      return;
    }
    if (this.running || this.resuming) {
      this.pending = force || this.pending === 'force' ? 'force' : 'visible';
      return;
    }
    // 快速滚动会连续改变可见集合，合并到下一次报价周期，避免每过一行就发请求。
    const delay = force ? 0 : this.visibleDelay();
    if (!force && this.timer && this.timerAt <= Date.now() + delay) {
      return;
    }
    this.schedule(delay);
  }

  private schedule(ms: number): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timerAt = Date.now() + ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.inFlight = this.loop().finally(() => {
        this.inFlight = null;
      });
    }, ms);
  }

  private codes(win: Window, started: number): string[] {
    const orders = this.sim.activeOrderCodes(this.clock().date);
    if (!this.foreground) {
      if (!this.tracking) {
        return [];
      }
      return this.settings.backgroundMode === 'session'
        ? [...this.sim.recordedCodes()]
        : orders;
    }
    const recorded = [...this.sim.recordedCodes()];
    if (win !== 'session') {
      return [...new Set([...this.extra, ...recorded])];
    }
    const passiveDue = started >= this.passiveAt;
    if (passiveDue) {
      this.passiveAt = started + PASSIVE_REFRESH_MS;
    }
    return [...new Set([...this.extra, ...(passiveDue ? recorded : [])])];
  }

  private async loop(): Promise<void> {
    if (this.running || this.resuming || this.stopped) {
      return;
    }
    this.running = true;
    this.pending = null;
    const started = Date.now();
    try {
      const now = this.clock(),
        win = marketWindow(now, this.sim.calendar);
      const codes = this.codes(win, started);
      if (
        codes.length &&
        (this.foreground || (this.tracking && win === 'session'))
      ) {
        try {
          this.lastQuoteStart = Date.now();
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
      if (
        win === 'session' &&
        now.t >= T(15, 5) &&
        Date.now() - this.lastAfter > 30000
      ) {
        this.lastAfter = Date.now();
        await this.sim.ingestAfterHours().catch(() => undefined);
      }
      await this.sim.tick();
      await this.updateTracker(win);
    } catch (e) {
      this.failures++;
      this.lastError = e instanceof Error ? e.message : String(e);
    } finally {
      this.running = false;
      const now = this.clock(),
        win = marketWindow(now, this.sim.calendar);
      let period = nextDelay(
        win,
        this.foreground,
        this.tracking,
        this.settings,
        now.t,
        this.extra.length > 0,
      );
      if (period != null && this.foreground && win === 'session') {
        // 滚出最后一个可见报价时，仍按上次慢速批次的期限取数。
        period = Math.min(
          period,
          Math.max(MIN_LOOP_DELAY_MS, this.passiveAt - started),
        );
      }
      if (period != null) {
        period = this.backoff(period);
      }
      if (!this.stopped) {
        const st = this.status();
        this.listeners.forEach(fn => fn(st));
        if (!this.resuming && period != null) {
          // 周期从本轮开始计时，扣除网络、撮合、写库的总耗时；慢请求不积压补发。
          this.schedule(
            this.pending && this.failures <= 2
              ? this.pending === 'force'
                ? 0
                : this.visibleDelay()
              : Math.max(MIN_LOOP_DELAY_MS, period - (Date.now() - started)),
          );
        }
      }
    }
  }

  private async updateTracker(win: Window): Promise<void> {
    if (!this.tracker || this.stopped) {
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
          const started = await this.tracker.start(
            'AShareSim 正在后台跟踪',
            this.notificationText(),
          );
          if (!started) {
            this.endTracking();
          }
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
