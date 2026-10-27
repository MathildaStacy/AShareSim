/**
 * 数据练习与导出（PRODUCT_DESIGN §6.4，路线图阶段 1）：数据集的 CSV 和练习的「标准答案」。
 * 答案用和 CSV 完全相同的数据算，你在 pandas 里算出来应该一模一样。纯函数。
 */
import type { DateStr } from '../engine/calendar';
import type { LedgerEntry } from '../engine/types';
import type { Fen } from '../engine/units';

/** 一天的收盘价（元，指数是点位）。 */
export interface DayBar {
  date: DateStr;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

/** 练习用的 25 只大盘股（沪深 300 里市值靠前、各行业都有），再加上你的自选和持仓凑够 30 只。 */
export const BIG_CAPS: string[] = [
  'sh600519', // 贵州茅台
  'sh601318', // 中国平安
  'sh600036', // 招商银行
  'sz000858', // 五粮液
  'sz000333', // 美的集团
  'sh601166', // 兴业银行
  'sh600900', // 长江电力
  'sz300750', // 宁德时代
  'sh601398', // 工商银行
  'sh601288', // 农业银行
  'sh601988', // 中国银行
  'sh600030', // 中信证券
  'sz000001', // 平安银行
  'sz002594', // 比亚迪
  'sh600276', // 恒瑞医药
  'sh601012', // 隆基绿能
  'sz000651', // 格力电器
  'sh600887', // 伊利股份
  'sh601899', // 紫金矿业
  'sh600309', // 万华化学
  'sz002415', // 海康威视
  'sz300059', // 东方财富
  'sh601888', // 中国中免
  'sh688981', // 中芯国际
  'sh600028', // 中国石化
];

export const STOCK_SET_SIZE = 30;

/** 25 只大盘股 + 持仓和自选里的股票（不含 ETF、指数），凑够 30 只为止。 */
export function stockSet(held: string[], watch: string[]): string[] {
  const out = [...BIG_CAPS];
  for (const c of [...held, ...watch]) {
    if (out.length >= STOCK_SET_SIZE) {
      break;
    }
    if (/^(sh6|sz0|sz3)/.test(c) && !out.includes(c)) {
      out.push(c);
    }
  }
  return out;
}

export interface YearRet {
  year: string;
  /** 起点：上一年最后一个收盘价；数据第一年没有时用第一天的开盘价。 */
  partialStart: DateStr | null;
  /** 今年还没过完。 */
  toDate: boolean;
  ret: number;
}

export interface SeriesStats {
  n: number;
  first: DateStr;
  last: DateStr;
  years: YearRet[];
  /** 年化波动率 = 日收益标准差 × √252。 */
  vol: number;
  mdd: number;
  mddFrom: DateStr;
  mddTo: DateStr;
  /** 最近 250 个交易日的收益（不足 251 行时为 null）。 */
  roll250: number | null;
}

export function seriesStats(
  bars: DayBar[],
  today: DateStr,
): SeriesStats | null {
  if (bars.length < 2) {
    return null;
  }
  const years: YearRet[] = [];
  const ys = [...new Set(bars.map(b => b.date.slice(0, 4)))];
  for (const y of ys) {
    const first = bars.findIndex(b => b.date.startsWith(y));
    let last = first;
    while (last + 1 < bars.length && bars[last + 1].date.startsWith(y)) {
      last++;
    }
    const base = first > 0 ? bars[first - 1].close : bars[first].open;
    years.push({
      year: y,
      partialStart: first > 0 ? null : bars[first].date,
      toDate: y === today.slice(0, 4),
      ret: bars[last].close / base - 1,
    });
  }
  const rets = bars.slice(1).map((b, i) => b.close / bars[i].close - 1);
  const m = rets.reduce((s, v) => s + v, 0) / rets.length;
  const sd = Math.sqrt(
    rets.reduce((s, v) => s + (v - m) ** 2, 0) / (rets.length - 1),
  );
  let peak = bars[0].close;
  let peakAt = bars[0].date;
  let mdd = 0;
  let mddFrom = bars[0].date;
  let mddTo = bars[0].date;
  for (const b of bars) {
    if (b.close > peak) {
      peak = b.close;
      peakAt = b.date;
    }
    const dd = b.close / peak - 1;
    if (dd < mdd) {
      mdd = dd;
      mddFrom = peakAt;
      mddTo = b.date;
    }
  }
  const n = bars.length;
  return {
    n,
    first: bars[0].date,
    last: bars[n - 1].date,
    years,
    vol: sd * Math.sqrt(252),
    mdd,
    mddFrom,
    mddTo,
    roll250: n > 250 ? bars[n - 1].close / bars[n - 251].close - 1 : null,
  };
}

export interface RankRow {
  code: string;
  ret20: number;
  rank: number;
}

/**
 * 每只股票过去 20 个交易日收益在当天的排名（1 = 涨得最多）。对应 pandas：
 * px.pct_change(20).rank(axis=1, ascending=False)，取最新一天。
 * 只排「最新一天有数据、而且有 21 行以上」的股票；当天停牌没数据的不参与。
 */
export function rank20(series: Record<string, DayBar[]>): {
  date: DateStr | null;
  rows: RankRow[];
} {
  const latest = Object.values(series)
    .map(b => b[b.length - 1]?.date)
    .filter(Boolean)
    .sort()
    .pop();
  if (!latest) {
    return { date: null, rows: [] };
  }
  const rows: RankRow[] = [];
  for (const [code, bars] of Object.entries(series)) {
    const n = bars.length;
    if (n < 21 || bars[n - 1].date !== latest) {
      continue;
    }
    rows.push({
      code,
      ret20: bars[n - 1].close / bars[n - 21].close - 1,
      rank: 0,
    });
  }
  rows.sort((a, b) => b.ret20 - a.ret20);
  // pandas rank 默认 method='average'：并列时取平均名次
  for (let i = 0; i < rows.length; ) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1].ret20 === rows[i].ret20) {
      j++;
    }
    const r = (i + 1 + (j + 1)) / 2;
    for (let k = i; k <= j; k++) {
      rows[k].rank = r;
    }
    i = j + 1;
  }
  return { date: latest, rows };
}

export interface MonthFee {
  month: string;
  trades: number;
  commission: Fen;
  stamp: Fen;
  transfer: Fen;
  /** 经手费 + 证管费（规费另收时）。 */
  regs: Fen;
  total: Fen;
}

/** 交割单按月汇总费用（只算买卖，不含红利税）。对应 df.groupby(df.date.str[:7]).sum()。 */
export function monthlyFees(ledger: LedgerEntry[]): MonthFee[] {
  const map = new Map<string, MonthFee>();
  for (const e of ledger) {
    if (e.biz !== '证券买入' && e.biz !== '证券卖出') {
      continue;
    }
    const m = e.date.slice(0, 7);
    const row = map.get(m) ?? {
      month: m,
      trades: 0,
      commission: 0,
      stamp: 0,
      transfer: 0,
      regs: 0,
      total: 0,
    };
    row.trades++;
    row.commission += e.fee.commission;
    row.stamp += e.fee.stamp;
    row.transfer += e.fee.transfer;
    row.regs += e.fee.handling + e.fee.reg;
    row.total += e.fee.total;
    map.set(m, row);
  }
  return [...map.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}

const csvNum = (v: number) => String(Number(v.toFixed(4)));

/** 单个指数 / 证券的日线：date,open,close,high,low,volume。 */
export function barsCsv(bars: DayBar[]): string {
  return [
    'date,open,close,high,low,volume',
    ...bars.map(b =>
      [b.date, b.open, b.close, b.high, b.low, b.volume].map(String).join(','),
    ),
  ].join('\n');
}

/** 长表：date,code,name,open,close,high,low,volume（code 是 6 位数字，不带 sh / sz）。 */
export function longCsv(
  series: Record<string, DayBar[]>,
  nameOf: (code: string) => string,
): string {
  const lines = ['date,code,name,open,close,high,low,volume'];
  for (const [code, bars] of Object.entries(series)) {
    for (const b of bars) {
      lines.push(
        [
          b.date,
          code.slice(2),
          nameOf(code).replace(/,/g, ' '),
          csvNum(b.open),
          csvNum(b.close),
          csvNum(b.high),
          csvNum(b.low),
          b.volume,
        ].join(','),
      );
    }
  }
  return lines.join('\n');
}

/** pandas 写法提示（「看提示」）。 */
export const HINTS = {
  ex1: [
    'import pandas as pd',
    'df = pd.read_csv("沪深300.csv", parse_dates=["date"], index_col="date")',
    'close = df["close"]',
    'ret = close.pct_change()',
    '# 每年收益：每年最后一个收盘价相比上一年最后一个',
    'yearly = close.resample("YE").last().pct_change()',
    'vol = ret.std() * 252 ** 0.5           # 年化波动率',
    'dd = close / close.cummax() - 1        # 回撤序列',
    'mdd = dd.min(); end = dd.idxmin()',
    'start = close[:end].idxmax()           # 回撤从哪天开始',
    'roll = close.pct_change(250)           # 滚动一年收益',
    '(close / close.iloc[0]).plot()         # 净值曲线',
  ],
  ex2: [
    'df = pd.read_csv("交割单.csv")',
    'df["month"] = df["日期"].str[:7]',
    'trades = df[df["业务"].isin(["证券买入", "证券卖出"])]',
    'fees = ["佣金", "印花税", "过户费", "经手费", "证管费"]',
    'trades.groupby("month")[fees].sum()',
  ],
  ex3: [
    'df = pd.read_csv("stocks_qfq_day.csv", dtype={"code": str}, parse_dates=["date"])',
    'px = df.pivot(index="date", columns="code", values="close")',
    'r20 = px.pct_change(20)',
    'rank = r20.rank(axis=1, ascending=False)   # 每天横向排名，1 = 涨得最多',
    'rank.iloc[-1].sort_values()                # 最新一天',
  ],
};
