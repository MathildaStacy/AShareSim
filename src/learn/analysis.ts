/**
 * 账户分析（PRODUCT_DESIGN §6.4，路线图阶段 2）：从交割单和日 K 反推每天收盘后的总资产，
 * 用时间加权收益扣掉银证转账，再算收益、风险和相对基准的指标。每个指标带公式和代入数字后的算式。纯函数。
 */
import type { DateStr } from '../engine/calendar';
import type { LedgerEntry } from '../engine/types';
import type { Fen, Li } from '../engine/units';

/** 无风险利率（年化），按一年期存款和国债收益率的大致水平取 1.5%。 */
export const RISK_FREE = 0.015;
export const DAYS_PER_YEAR = 252;
/** 样本少于这么多个交易日时标注「不具备统计意义」。 */
export const MIN_SAMPLE = 20;

export interface EquityDay {
  date: DateStr;
  /** 收盘后的资金余额（分）。 */
  cash: Fen;
  /** 持仓按不复权收盘价算的市值（分）。 */
  marketValue: Fen;
  total: Fen;
  /** 当天银证转账净额（转入为正，分）。 */
  flow: Fen;
}

/**
 * 每个交易日收盘后的总资产 = 资金余额 + Σ 持仓数量 × 当天不复权收盘价。
 * - dates：交易日（基准的日 K 日期），只取第一条交割单那天及以后的。
 * - closes：code → date → 不复权收盘价（厘）。缺某天时用之前最近的收盘价，再没有就用最后一次成交价。
 */
export function equitySeries(
  ledger: LedgerEntry[],
  dates: DateStr[],
  closes: Record<string, Record<DateStr, Li>>,
): EquityDay[] {
  const entries = [...ledger].sort((a, b) =>
    a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1,
  );
  if (!entries.length) {
    return [];
  }
  const start = entries[0].date;
  const out: EquityDay[] = [];
  const qty: Record<string, number> = {};
  const lastPx: Record<string, Li> = {};
  let cash = 0;
  let i = 0;
  for (const d of dates.filter(x => x >= start)) {
    let flow = 0;
    for (; i < entries.length && entries[i].date <= d; i++) {
      const e = entries[i];
      cash = e.balance;
      if (e.biz === '银行转证券' || e.biz === '证券转银行') {
        if (e.date === d) {
          flow += e.net;
        }
        continue;
      }
      if (!e.code) {
        continue;
      }
      if (e.biz === '证券买入' || e.biz === '红股入账') {
        qty[e.code] = (qty[e.code] ?? 0) + e.qty;
      } else if (e.biz === '证券卖出') {
        qty[e.code] = (qty[e.code] ?? 0) - e.qty;
      }
      if (e.price > 0 && e.biz !== '红股入账') {
        lastPx[e.code] = e.price;
      }
    }
    let mv = 0;
    for (const [code, q] of Object.entries(qty)) {
      if (q <= 0) {
        continue;
      }
      const c = closes[code]?.[d];
      if (c != null) {
        lastPx[code] = c;
      }
      const px = c ?? lastPx[code] ?? 0;
      mv += Math.round((px * q) / 10);
    }
    out.push({ date: d, cash, marketValue: mv, total: cash + mv, flow });
  }
  return out;
}

export interface Metric {
  key: string;
  name: string;
  /** 显示的数值（百分比带 %）。 */
  value: string;
  raw: number;
  /** 公式。 */
  formula: string;
  /** 代入数字后的计算过程，一行一步。 */
  calc: string[];
  /** 怎么理解。 */
  note?: string;
}

export interface Analysis {
  /** 有收益的交易日数（第一天之后的天数）。 */
  n: number;
  from: DateStr;
  to: DateStr;
  dates: DateStr[];
  /** 每天的收益率：账户、基准。 */
  rp: number[];
  rb: number[];
  /** 累计收益（从第一天收盘起）。 */
  cumP: number[];
  cumB: number[];
  metrics: Metric[];
  tooFew: boolean;
}

const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
const sd = (x: number[]) => {
  if (x.length < 2) {
    return 0;
  }
  const m = mean(x);
  return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1));
};
const cumulate = (x: number[]) => {
  let c = 1;
  return x.map(v => (c *= 1 + v) - 1);
};
const pct = (v: number, d = 2) =>
  Number.isFinite(v) ? (v * 100).toFixed(d) + '%' : '—';
const fx = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
/** 万分之几（日收益常用这个量级）。 */
const wan = (v: number) =>
  Number.isFinite(v) ? (v * 1e4).toFixed(2) + '‱' : '—';

/**
 * 日收益：r_t = (V_t − F_t) ÷ V_{t−1} − 1，F_t 是当天银证转账净额（假设转账发生在开盘前，钱当天参与涨跌）。
 * 前一天总资产为 0 的那天（例如第一笔入金当天）不算收益。
 */
export function dailyReturns(
  eq: EquityDay[],
  bench: Record<DateStr, number>,
): { dates: DateStr[]; rp: number[]; rb: number[]; from: DateStr | null } {
  const dates: DateStr[] = [];
  const rp: number[] = [];
  const rb: number[] = [];
  let from: DateStr | null = null;
  for (let k = 1; k < eq.length; k++) {
    const prev = eq[k - 1];
    const cur = eq[k];
    const b0 = bench[prev.date];
    const b1 = bench[cur.date];
    if (prev.total <= 0 || b0 == null || b1 == null) {
      continue;
    }
    from ??= prev.date;
    dates.push(cur.date);
    rp.push((cur.total - cur.flow) / prev.total - 1);
    rb.push(b1 / b0 - 1);
  }
  return { dates, rp, rb, from };
}

export function analyze(
  eq: EquityDay[],
  bench: Record<DateStr, number>,
  benchName: string,
): Analysis | null {
  const { dates, rp, rb, from } = dailyReturns(eq, bench);
  const n = rp.length;
  if (n < 2 || !from) {
    return null;
  }
  const cumP = cumulate(rp);
  const cumB = cumulate(rb);
  const rf = RISK_FREE / DAYS_PER_YEAR;
  const Y = DAYS_PER_YEAR;
  const mp = mean(rp);
  const mb = mean(rb);
  const sp = sd(rp);
  const sb = sd(rb);
  const ex = rp.map((v, i) => v - rb[i]);
  const me = mean(ex);
  const se = sd(ex);
  const cov = rp.reduce((s, v, i) => s + (v - mp) * (rb[i] - mb), 0) / (n - 1);
  const beta = sb > 0 ? cov / (sb * sb) : NaN;
  const alpha = (mp - rf - beta * (mb - rf)) * Y;
  const totP = cumP[n - 1];
  const totB = cumB[n - 1];
  const annP = Math.pow(1 + totP, Y / n) - 1;
  const vol = sp * Math.sqrt(Y);
  const sharpe = sp > 0 ? ((mp - rf) / sp) * Math.sqrt(Y) : NaN;
  const te = se * Math.sqrt(Y);
  const ir = te > 0 ? (me * Y) / te : NaN;
  const t = se > 0 ? me / (se / Math.sqrt(n)) : NaN;
  // 最大回撤：净值从之前最高点回落最多的一段
  let peak = 1;
  let peakAt = from;
  let nav = 1;
  let mdd = 0;
  let mddFrom = from;
  let mddTo = from;
  rp.forEach((v, i) => {
    nav *= 1 + v;
    if (nav > peak) {
      peak = nav;
      peakAt = dates[i];
    }
    const dd = nav / peak - 1;
    if (dd < mdd) {
      mdd = dd;
      mddFrom = peakAt;
      mddTo = dates[i];
    }
  });
  const rfText = wan(rf);
  const metrics: Metric[] = [
    {
      key: 'total',
      name: '累计收益 / 基准',
      value: pct(totP) + ' / ' + pct(totB),
      raw: totP,
      formula:
        '累计收益 = (1 + r₁)(1 + r₂)…(1 + rₙ) − 1，r_t = (当日总资产 − 当日转入净额) ÷ 前一日总资产 − 1',
      calc: [
        '账户：' + n + ' 个日收益连乘 − 1 = ' + pct(totP),
        benchName + '：同期收盘价之比 − 1 = ' + pct(totB),
        '超额（简单相减）= ' + pct(totP - totB),
      ],
      note: '用时间加权收益：转入转出的钱不算收益，也不会稀释收益率。',
    },
    {
      key: 'annual',
      name: '年化收益',
      value: pct(annP),
      raw: annP,
      formula: '(1 + 累计收益)^(252 ÷ 天数) − 1',
      calc: ['(1 + ' + pct(totP) + ')^(252 ÷ ' + n + ') − 1 = ' + pct(annP)],
      note: '天数少时年化会把偶然放大很多倍，看看就好。',
    },
    {
      key: 'vol',
      name: '年化波动率',
      value: pct(vol),
      raw: vol,
      formula: '日收益的标准差 × √252',
      calc: [
        '日收益均值 ' + wan(mp) + '，标准差 ' + wan(sp),
        wan(sp) + ' × √252 = ' + pct(vol),
      ],
      note: '波动率衡量净值上下晃的幅度，不分涨跌。沪深 300 长期大约 20% 上下。',
    },
    {
      key: 'sharpe',
      name: '夏普比率',
      value: fx(sharpe),
      raw: sharpe,
      formula: '(日均收益 − 无风险日收益) ÷ 日收益标准差 × √252',
      calc: [
        '无风险利率按年 ' +
          pct(RISK_FREE, 1) +
          '，折成日收益 ' +
          pct(RISK_FREE, 1) +
          ' ÷ 252 = ' +
          rfText,
        '(' +
          wan(mp) +
          ' − ' +
          rfText +
          ') ÷ ' +
          wan(sp) +
          ' × √252 = ' +
          fx(sharpe),
      ],
      note: '每承担一份波动换来多少超过存款的收益。长期 1 以上算好。',
    },
    {
      key: 'mdd',
      name: '最大回撤',
      value: pct(mdd),
      raw: mdd,
      formula: 'min(净值 ÷ 之前的最高净值 − 1)',
      calc:
        mdd < 0
          ? [
              '净值在 ' +
                mddFrom +
                ' 到达高点，到 ' +
                mddTo +
                ' 回落到最低，回撤 ' +
                pct(mdd),
            ]
          : ['净值一直在创新高，没有回撤'],
      note: '如果在最高点买入、最低点卖出会亏多少，最能反映「拿不拿得住」。',
    },
    {
      key: 'beta',
      name: 'Beta',
      value: fx(beta),
      raw: beta,
      formula: 'cov(账户日收益, 基准日收益) ÷ var(基准日收益)',
      calc: [
        'cov = ' +
          (cov * 1e8).toFixed(3) +
          ' × 10⁻⁸，var = ' +
          (sb * sb * 1e8).toFixed(3) +
          ' × 10⁻⁸',
        'Beta = ' + fx(beta),
      ],
      note: 'Beta = 1 表示和基准同涨同跌；0.5 表示基准涨 1% 时平均跟着涨 0.5%。空仓的日子会把 Beta 拉低。',
    },
    {
      key: 'alpha',
      name: 'Alpha（年化）',
      value: pct(alpha),
      raw: alpha,
      formula: '[(账户日均 − r_f) − Beta × (基准日均 − r_f)] × 252',
      calc: [
        '[(' +
          wan(mp) +
          ' − ' +
          rfText +
          ') − ' +
          fx(beta) +
          ' × (' +
          wan(mb) +
          ' − ' +
          rfText +
          ')] × 252 = ' +
          pct(alpha),
      ],
      note: '扣掉「跟着大盘涨跌」那部分之后剩下的收益。收益 ≈ 无风险收益 + Beta × 基准超额 + Alpha。',
    },
    {
      key: 'te',
      name: '跟踪误差',
      value: pct(te),
      raw: te,
      formula: '超额日收益（账户 − 基准）的标准差 × √252',
      calc: [
        '超额日收益均值 ' + wan(me) + '，标准差 ' + wan(se),
        wan(se) + ' × √252 = ' + pct(te),
      ],
      note: '和基准走得有多不一样。指数基金通常 1% 以内，指数增强 3% 到 6%。',
    },
    {
      key: 'ir',
      name: '信息比率',
      value: fx(ir),
      raw: ir,
      formula: '年化超额 ÷ 跟踪误差 = (超额日均 × 252) ÷ 跟踪误差',
      calc: ['(' + wan(me) + ' × 252) ÷ ' + pct(te) + ' = ' + fx(ir)],
      note: '每偏离基准一份换来多少超额。机构指数增强长期做到 1 以上就很好。',
    },
    {
      key: 't',
      name: '超额的 t 统计量',
      value: fx(t),
      raw: t,
      formula: '超额日均 ÷ (超额标准差 ÷ √n)',
      calc: [wan(me) + ' ÷ (' + wan(se) + ' ÷ √' + n + ') = ' + fx(t)],
      note:
        '|t| > 2 才勉强能说「可能不是运气」（约 95% 置信）。' +
        n +
        ' 天的样本远远不够；而且试的策略越多，越容易碰巧得到一个好看的 t 值（多重检验）。',
    },
  ];
  return {
    n,
    from,
    to: dates[n - 1],
    dates,
    rp,
    rb,
    cumP,
    cumB,
    metrics,
    tooFew: n < MIN_SAMPLE,
  };
}
