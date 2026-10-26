/**
 * 腾讯行情适配层：把接口返回的原始数据转成引擎用的单位。
 *
 * - 价格：元 → 厘（0.001 元）
 * - 数量：手 → 股 / 份（1 手 = 100）。例外：科创板（GP-A-KCB）的成交量字段本来就是股，
 *   盘口仍然是手（2026-10-26 用中芯国际、九号公司核对：成交额 ÷ 成交量 ÷ 现价 ≈ 1，盘口买一「2」只能是手）
 * - 成交额：用第 35 个字段「现价/成交量/成交额（元）」，精确到元，再换成分；第 37 个字段是万元，精度不够
 * - 时间：第 30 个字段 YYYYMMDDHHMMSS 是行情服务器时间（北京时间），直接作为快照时间
 *
 * 接口：
 * - 快照和五档 `https://qt.gtimg.cn/utf8/q=sh600036,sz000001`（加 /utf8/ 返回 UTF-8，默认是 GBK）
 * - 分时 `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=sh600036`
 * - 最近 5 日分时 `https://web.ifzq.gtimg.cn/appstock/app/day/query?code=sh600036`
 * - K 线 `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600036,day,,,250,qfq`
 * - 搜索 `https://smartbox.gtimg.cn/s3/?v=2&q=zsyh&t=all&c=1`
 */
import type { DateStr } from '../engine/calendar';
import type { Level, Snapshot } from '../engine/types';
import type { Sec } from '../engine/session';
import type { Fen, Li } from '../engine/units';

/** 快照之外、界面要显示的字段。 */
export interface QuoteInfo {
  code: string;
  name: string;
  /** 腾讯证券类型：GP-A / GP-A-CYB / GP-A-KCB / ETF / ZS（指数）等。 */
  type: string;
  /** 涨跌额（厘）和涨跌幅（%）。 */
  change: Li | null;
  pct: number | null;
  /** 换手率（%）、振幅（%）、量比。 */
  turnover: number | null;
  amplitude: number | null;
  volumeRatio: number | null;
  /** 市盈率（动态）、市净率。 */
  pe: number | null;
  pb: number | null;
  /** 流通市值、总市值（亿元）。 */
  floatCap: number | null;
  totalCap: number | null;
  /** 外盘、内盘（股）。 */
  outer: number;
  inner: number;
}

export interface Quote {
  snapshot: Snapshot;
  info: QuoteInfo;
}

const num = (s: string | undefined): number | null => {
  if (s == null || s.trim() === '') {
    return null;
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

/** 元 → 厘；0 和负数（腾讯用 0 表示没有、用 -1 表示指数没有涨跌停）返回 null。 */
export const toLi = (s: string | undefined): Li | null => {
  const v = num(s);
  return v == null || v <= 0 ? null : Math.round(v * 1000);
};

/** 科创板的成交量字段单位是股，其他是手。 */
export function volumeUnit(type: string): number {
  return type === 'GP-A-KCB' ? 1 : 100;
}

/** 'YYYYMMDDHHMMSS' → 日期和当天秒数。 */
export function parseServerTime(s: string): { date: DateStr; t: Sec } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) {
    return null;
  }
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    t: Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6]),
  };
}

function levels(f: string[], start: number): Level[] {
  const out: Level[] = [];
  for (let i = 0; i < 5; i++) {
    const price = toLi(f[start + i * 2]);
    const hands = num(f[start + i * 2 + 1]) ?? 0;
    if (price != null && hands > 0) {
      out.push([price, Math.round(hands * 100)]);
    }
  }
  return out;
}

/** 解析一行 `v_sh600036="1~招商银行~600036~..."`。格式不对时返回 null。 */
export function parseQuoteLine(line: string): Quote | null {
  const m = /^\s*v_(\w+)="(.*)"\s*$/s.exec(line);
  if (!m) {
    return null;
  }
  const code = m[1];
  const f = m[2].split('~');
  if (f.length < 62) {
    return null;
  }
  const time = parseServerTime(f[30]);
  const prevClose = toLi(f[4]);
  if (!time || prevClose == null) {
    return null;
  }
  const type = f[61];
  const unit = volumeUnit(type);
  // 「现价/成交量/成交额」：成交额单位是元
  const tradeTriple = f[35].split('/');
  const volume = Math.round((num(f[6]) ?? 0) * unit);
  const amount: Fen = Math.round((num(tradeTriple[2]) ?? 0) * 100);
  const bids = levels(f, 9);
  const asks = levels(f, 19);
  const last = volume > 0 ? toLi(f[3]) : null;
  const open = toLi(f[5]);
  const snapshot: Snapshot = {
    code,
    date: time.date,
    t: time.t,
    prevClose,
    open,
    last,
    high: volume > 0 ? toLi(f[33]) : null,
    low: volume > 0 ? toLi(f[34]) : null,
    volume,
    amount,
    bids,
    asks,
    up: toLi(f[47]),
    down: toLi(f[48]),
  };
  // ⚠️ 腾讯没有明确的停牌字段：连续竞价时段（9:30 以后）既没有成交也没有任何挂单，只能是停牌
  if (
    type !== 'ZS' &&
    time.t >= 9 * 3600 + 30 * 60 &&
    volume === 0 &&
    bids.length === 0 &&
    asks.length === 0
  ) {
    snapshot.suspended = true;
  }
  const info: QuoteInfo = {
    code,
    name: f[1].replace(/\s+/g, ''),
    type,
    change: last != null ? last - prevClose : null,
    pct: last != null ? num(f[32]) : null,
    turnover: num(f[38]),
    amplitude: num(f[43]),
    volumeRatio: num(f[49]),
    pe: num(f[39]),
    pb: num(f[46]),
    floatCap: num(f[44]),
    totalCap: num(f[45]),
    outer: Math.round((num(f[7]) ?? 0) * unit),
    inner: Math.round((num(f[8]) ?? 0) * unit),
  };
  return { snapshot, info };
}

/** 解析 qt.gtimg.cn 的整个响应（多行，分号分隔）。不认识的代码（v_pv_none_match）跳过。 */
export function parseQuotes(text: string): Quote[] {
  const out: Quote[] = [];
  for (const line of text.split(';')) {
    if (!line.trim()) {
      continue;
    }
    const q = parseQuoteLine(line);
    if (q) {
      out.push(q);
    }
  }
  return out;
}

/** 分时：每分钟一个点，价格是这一分钟的最后成交价，量和额是当日累计。 */
export interface MinutePoint {
  t: Sec;
  price: Li;
  volume: number;
  amount: Fen;
}

export interface MinuteDay {
  date: DateStr;
  /** 前收盘价（最近 5 日分时才有，当日分时为 null，用快照里的）。 */
  prevClose: Li | null;
  points: MinutePoint[];
}

function parseMinuteRows(rows: string[], unit: number): MinutePoint[] {
  const out: MinutePoint[] = [];
  for (const r of rows) {
    const [hhmm, price, vol, amt] = r.split(' ');
    const p = toLi(price);
    if (!/^\d{4}$/.test(hhmm) || p == null) {
      continue;
    }
    out.push({
      t: Number(hhmm.slice(0, 2)) * 3600 + Number(hhmm.slice(2)) * 60,
      price: p,
      volume: Math.round((num(vol) ?? 0) * unit),
      amount: Math.round((num(amt) ?? 0) * 100),
    });
  }
  return out;
}

const yyyymmdd = (s: string): DateStr =>
  `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

/** 解析当日分时 minute/query。type 用来判断量的单位（科创板是股）。 */
export function parseMinute(
  json: unknown,
  code: string,
  type: string,
): MinuteDay | null {
  const d = (json as any)?.data?.[code]?.data;
  if (!d || !Array.isArray(d.data) || typeof d.date !== 'string') {
    return null;
  }
  return {
    date: yyyymmdd(d.date),
    prevClose: null,
    points: parseMinuteRows(d.data, volumeUnit(type)),
  };
}

/** 解析最近 5 日分时 day/query，按日期从早到晚。 */
export function parseMinuteDays(
  json: unknown,
  code: string,
  type: string,
): MinuteDay[] {
  const days = (json as any)?.data?.[code]?.data;
  if (!Array.isArray(days)) {
    return [];
  }
  return days
    .filter(d => typeof d?.date === 'string' && Array.isArray(d.data))
    .map(d => ({
      date: yyyymmdd(d.date),
      prevClose: toLi(d.prec),
      points: parseMinuteRows(d.data, volumeUnit(type)),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export type KlinePeriod = 'day' | 'week' | 'month';

/** 一根 K 线：价格厘，量股。 */
export interface KBar {
  date: DateStr;
  open: Li;
  close: Li;
  high: Li;
  low: Li;
  volume: number;
}

/** 解析 fqkline/get。前复权数据在 qfqday / qfqweek 里，没有除权的股票腾讯直接给 day / week。 */
export function parseKline(
  json: unknown,
  code: string,
  period: KlinePeriod,
  type: string,
): KBar[] {
  const d = (json as any)?.data?.[code];
  const rows: unknown = d?.['qfq' + period] ?? d?.[period];
  if (!Array.isArray(rows)) {
    return [];
  }
  const unit = volumeUnit(type);
  const out: KBar[] = [];
  for (const r of rows) {
    const [date, o, c, h, l, v] = r as string[];
    const open = toLi(o);
    const close = toLi(c);
    const high = toLi(h);
    const low = toLi(l);
    if (open == null || close == null || high == null || low == null) {
      continue;
    }
    out.push({
      date,
      open,
      close,
      high,
      low,
      volume: Math.round((num(v) ?? 0) * unit),
    });
  }
  return out;
}

export interface SearchHit {
  code: string;
  name: string;
  pinyin: string;
  type: string;
}

/**
 * 解析 smartbox 搜索结果：`v_hint="sh~600036~招...~zsyh~GP-A^..."`。
 * 只保留沪深的 A 股、ETF 和指数，名称是 \u 转义的。
 */
export function parseSearch(text: string): SearchHit[] {
  const m = /v_hint="(.*)"/s.exec(text);
  if (!m || m[1] === 'N') {
    return [];
  }
  let body: string;
  try {
    body = JSON.parse('"' + m[1] + '"');
  } catch {
    return [];
  }
  const out: SearchHit[] = [];
  for (const item of body.split('^')) {
    const [market, num6, name, pinyin, type] = item.split('~');
    if (
      (market === 'sh' || market === 'sz') &&
      /^\d{6}$/.test(num6) &&
      /^(GP-A|GP-A-CYB|GP-A-KCB|ETF|ZS)$/.test(type ?? '')
    ) {
      out.push({ code: market + num6, name, pinyin: pinyin ?? '', type });
    }
  }
  return out;
}

// ---------- 排行 ----------

/** 排行榜的一行。ETF 榜来自新浪（腾讯排行没有 ETF 板块），字段相同。 */
export interface RankItem {
  code: string;
  name: string;
  type: string;
  /** 最新价（厘），停牌或没有成交为 null。 */
  last: Li | null;
  change: Li | null;
  pct: number | null;
  /** 成交量（股 / 份）和成交额（分）。 */
  volume: number;
  amount: Fen;
}

export type RankBoard = 'aStock' | 'cyb' | 'kcb';
export type RankSort = 'up' | 'down' | 'amount';

/**
 * 腾讯排行 `proxy.finance.qq.com/cgi/cgi-bin/rank/hs/getBoardRankList`（2026-10-26 实测）：
 * board_code 只认 aStock / cyb / kcb；sort_type=priceRatio 按涨跌幅、turnover 按成交额，direct=down 降序。
 */
export function rankUrl(board: RankBoard, sort: RankSort, count: number) {
  const sortType = sort === 'amount' ? 'turnover' : 'priceRatio';
  const direct = sort === 'down' ? 'up' : 'down';
  return `https://proxy.finance.qq.com/cgi/cgi-bin/rank/hs/getBoardRankList?_appver=11.17.0&board_code=${board}&sort_type=${sortType}&direct=${direct}&offset=0&count=${count}`;
}

/** 沪深两市的 6 位代码（排行里混着北交所 bj92xxxx，V1 不支持）。 */
const isHuShen = (code: string) => /^(sh|sz)\d{6}$/.test(code);

/**
 * 解析腾讯排行：zxj 现价（元）、zd 涨跌额、zdf 涨跌幅（%）、volume 成交量（手，科创板带小数，也是手）、
 * turnover 成交额（万元）。
 */
export function parseRank(json: unknown): RankItem[] {
  const list = (json as any)?.data?.rank_list;
  if (!Array.isArray(list)) {
    return [];
  }
  const out: RankItem[] = [];
  for (const r of list) {
    if (typeof r?.code !== 'string' || !isHuShen(r.code)) {
      continue;
    }
    const last = toLi(r.zxj);
    out.push({
      code: r.code,
      name: String(r.name ?? '').replace(/\s+/g, ''),
      type: String(r.stock_type ?? ''),
      last,
      change: last != null ? Math.round((num(r.zd) ?? 0) * 1000) : null,
      pct: last != null ? num(r.zdf) : null,
      volume: Math.round((num(r.volume) ?? 0) * 100),
      amount: Math.round((num(r.turnover) ?? 0) * 1_000_000),
    });
  }
  return out;
}

// ---------- 成交明细（分笔） ----------

/**
 * 一行成交明细。腾讯免费接口给的是「分笔」：约每 3 秒合并成一行，不是 Level-2 的逐笔成交。
 * side：B 这几秒以主动买为主（买方按卖价成交），S 主动卖为主，M 分不出来。
 */
export interface Tick {
  seq: number;
  t: Sec;
  price: Li;
  /** 和上一行比的价格变化（厘）。 */
  change: Li;
  /** 股 / 份。接口给的是手，科创板也是手（2026-10-26 和快照的成交量对过）。 */
  volume: number;
  amount: Fen;
  side: 'B' | 'S' | 'M';
}

/**
 * 成交明细接口：
 * - `stock.gtimg.cn/data/index.php?appn=detail&action=timeline&c=sh600036` 返回每一页的时间范围，页数随交易增加
 * - `...&action=data&c=sh600036&p=N` 返回第 N 页（约 70 行），行格式「序号/时间/价格/涨跌/量（手）/额（元）/方向」
 *
 * 15:05 以后还有收盘价的成交，是盘后固定价格交易。
 */
export const tickTimelineUrl = (code: string) =>
  `https://stock.gtimg.cn/data/index.php?appn=detail&action=timeline&c=${code}`;
export const tickPageUrl = (code: string, page: number) =>
  `https://stock.gtimg.cn/data/index.php?appn=detail&action=data&c=${code}&p=${page}`;

/** 解析分页时间表：日期和页数。 */
export function parseTickTimeline(
  text: string,
): { date: DateStr; pages: number } | null {
  const m = /v_\w+=\[(\d{8}),"(.*)"\]/s.exec(text);
  if (!m) {
    return null;
  }
  return {
    date: yyyymmdd(m[1]),
    pages: m[2] ? m[2].split('|').length : 0,
  };
}

const hmsToSec = (s: string): Sec | null => {
  const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(s);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
};

/** 解析一页成交明细，按时间从早到晚。 */
export function parseTicks(text: string): { page: number; ticks: Tick[] } {
  const m = /v_\w+=\[(\d+),"(.*)"\]/s.exec(text);
  if (!m) {
    return { page: -1, ticks: [] };
  }
  const ticks: Tick[] = [];
  for (const row of m[2].split('|')) {
    const [seq, time, price, change, vol, amt, side] = row.split('/');
    const t = hmsToSec(time ?? '');
    const p = toLi(price);
    if (t == null || p == null) {
      continue;
    }
    ticks.push({
      seq: Number(seq),
      t,
      price: p,
      change: Math.round((num(change) ?? 0) * 1000),
      volume: Math.round((num(vol) ?? 0) * 100),
      amount: Math.round((num(amt) ?? 0) * 100),
      side: side === 'B' || side === 'S' ? side : 'M',
    });
  }
  return { page: Number(m[1]), ticks };
}
