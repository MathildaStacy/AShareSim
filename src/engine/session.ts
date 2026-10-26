import type { Exchange } from './securities';

/** 一天内的时间，单位秒（9:30 = 34200）。 */
export type Sec = number;
export const T = (h: number, m: number, s = 0): Sec => h * 3600 + m * 60 + s;

export type Phase =
  | 'pre' // 9:15 前：券商暂存（预埋单）
  | 'auc1' // 9:15–9:20 开盘集合竞价，可撤
  | 'auc2' // 9:20–9:25 开盘集合竞价，不可撤
  | 'wait' // 9:25–9:30 交易所不接收申报，券商暂存
  | 'cont' // 连续竞价
  | 'lunch' // 11:30–13:00 午间休市，券商暂存
  | 'cauc' // 14:57–15:00 收盘集合竞价，不可撤
  | 'closed1' // 15:00–15:05
  | 'after' // 15:05–15:30 盘后固定价格交易撮合
  | 'closed'; // 15:30 以后

export interface PhaseInfo {
  name: string;
  /** 普通委托提交后怎么处理。 */
  route: 'store' | 'auction' | 'continuous' | 'nextDay';
  /** 已报交易所的委托能不能撤（券商暂存的委托任何时候都能撤）。 */
  exchangeCancel: boolean;
  /** 能不能下市价单。 */
  market: boolean;
}

export const PHASES: Record<Phase, PhaseInfo> = {
  pre: { name: '盘前', route: 'store', exchangeCancel: true, market: false },
  auc1: {
    name: '开盘集合竞价',
    route: 'auction',
    exchangeCancel: true,
    market: false,
  },
  auc2: {
    name: '开盘集合竞价',
    route: 'auction',
    exchangeCancel: false,
    market: false,
  },
  wait: {
    name: '等待开盘',
    route: 'store',
    exchangeCancel: false,
    market: false,
  },
  cont: {
    name: '连续竞价',
    route: 'continuous',
    exchangeCancel: true,
    market: true,
  },
  lunch: {
    name: '午间休市',
    route: 'store',
    exchangeCancel: true,
    market: false,
  },
  cauc: {
    name: '收盘集合竞价',
    route: 'auction',
    exchangeCancel: false,
    market: false,
  },
  closed1: {
    name: '已收盘',
    route: 'nextDay',
    exchangeCancel: true,
    market: false,
  },
  after: {
    name: '盘后固定价格交易',
    route: 'nextDay',
    exchangeCancel: true,
    market: false,
  },
  closed: {
    name: '已收盘',
    route: 'nextDay',
    exchangeCancel: true,
    market: false,
  },
};

export function phaseAt(t: Sec): Phase {
  if (t < T(9, 15)) return 'pre';
  if (t < T(9, 20)) return 'auc1';
  if (t < T(9, 25)) return 'auc2';
  if (t < T(9, 30)) return 'wait';
  if (t < T(11, 30)) return 'cont';
  if (t < T(13, 0)) return 'lunch';
  if (t < T(14, 57)) return 'cont';
  if (t < T(15, 0)) return 'cauc';
  if (t < T(15, 5)) return 'closed1';
  if (t < T(15, 30)) return 'after';
  return 'closed';
}

/** 券商暂存的委托在什么时候报送交易所。 */
export function storedSendTime(phase: Phase): Sec | null {
  if (phase === 'pre') return T(9, 15);
  if (phase === 'wait') return T(9, 30);
  if (phase === 'lunch') return T(13, 0);
  return null;
}

export const OPEN_AUCTION_END = T(9, 25);
export const CLOSE = T(15, 0);
export const AFTER_START = T(15, 5);
export const AFTER_END = T(15, 30);
export const SETTLE_TIME = T(15, 30);

/**
 * 盘后固定价格交易的申报时间（2026-07-06 起扩至全部 A 股和沪深 ETF）：
 * 沪市 9:30–11:30、13:00–15:30；深市 9:15–11:30、13:00–15:30。15:05–15:30 按收盘价撮合。
 */
export function afterHoursAccepting(exchange: Exchange, t: Sec): boolean {
  const start = exchange === 'SH' ? T(9, 30) : T(9, 15);
  return (t >= start && t < T(11, 30)) || (t >= T(13, 0) && t < AFTER_END);
}

export function formatSec(t: Sec): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}
