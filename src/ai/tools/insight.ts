/**
 * M5.5 的只读工具（AI_ASSISTANT §13.6、§13.7）：本地库只读查询、横截面选股、账户分析、分红送配、基准行情、
 * 决策日志、记分卡、调仓计划。都直接执行，结果用紧凑文本，数字带单位。
 */
import { BENCH, loadAnalysis, type Bench } from '../../app/analysisData';
import type { AppCore } from '../../app/boot';
import type { Db, Row } from '../../data/db';
import { formatFen, formatPrice } from '../../engine/units';
import { riskOf, riskText } from '../../engine/risk';
import type { Quote, RankItem } from '../../market/tencent';
import { rebalances, reports, strategies } from '../../portfolio/repo';
import * as advice from '../../advice/repo';
import { refreshReviews, scorecard } from '../../advice/service';
import { pctText, scoreLineText } from '../../advice/score';
import {
  PROPOSAL_STATUS_NAME,
  STANCE_NAME,
  type JournalEntry,
  type Proposal,
} from '../../advice/types';
import { resolveCode, type Resolved } from './read';

// ---------- query_local_db ----------

/** 可以查的表（行情、K 线、证券、分红送配、交易日历、事件日志、执行报告、某日状态）。不开放 ai_*、设置和账户表。 */
export const QUERY_TABLES = [
  'quotes_snapshot',
  'kline_day',
  'security',
  'corp_action',
  'trade_calendar',
  'account_event',
  'execution_report',
  'security_day',
];
export const QUERY_MAX_ROWS = 200;
const QUERY_TIMEOUT_MS = 5000;

/** 去掉字符串字面量，标识符（含 "x" `x` [x] 引起来的）全部取出来小写。 */
export function sqlTokens(sql: string): { words: string[]; ok: boolean } {
  const words: string[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      const end = sql.indexOf("'", i + 1);
      if (end < 0) {
        return { words, ok: false };
      }
      i = end + 1;
      // '' 是转义的单引号，接着上一段
      while (sql[i] === "'") {
        const e2 = sql.indexOf("'", i + 1);
        if (e2 < 0) {
          return { words, ok: false };
        }
        i = e2 + 1;
      }
      continue;
    }
    if (ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      const end = sql.indexOf(close, i + 1);
      if (end < 0) {
        return { words, ok: false };
      }
      words.push(sql.slice(i + 1, end).toLowerCase());
      i = end + 1;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) {
        return { words, ok: false };
      }
      i = end + 2;
      continue;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(i));
    if (m) {
      words.push(m[0].toLowerCase());
      i += m[0].length;
      continue;
    }
    if (ch === ';') {
      words.push(';');
    }
    i++;
  }
  return { words, ok: true };
}

const FORBIDDEN = new Set([
  'insert',
  'update',
  'delete',
  'replace',
  'drop',
  'alter',
  'create',
  'attach',
  'detach',
  'pragma',
  'vacuum',
  'reindex',
  'analyze',
  'begin',
  'commit',
  'rollback',
  'savepoint',
  'release',
  'recursive',
  'load_extension',
  'readfile',
  'writefile',
]);

/** 检查 SQL：只能是一条 SELECT / WITH，只引用白名单里的表。返回错误说明。 */
export function checkSql(sql: string, allTables: string[]): string | null {
  const { words, ok } = sqlTokens(sql.trim());
  if (!ok) {
    return '引号或注释没有闭合';
  }
  if (!words.length || !['select', 'with'].includes(words[0])) {
    return '只能用 SELECT 或 WITH 开头的只读查询';
  }
  const semi = words.indexOf(';');
  if (semi >= 0 && semi !== words.length - 1) {
    return '一次只能执行一条语句';
  }
  const bad = words.find(w => FORBIDDEN.has(w));
  if (bad) {
    return '不允许 ' + bad.toUpperCase();
  }
  const allowed = new Set(QUERY_TABLES);
  const tables = new Set(allTables.map(t => t.toLowerCase()));
  const hidden = words.find(
    w => w.startsWith('sqlite_') || (tables.has(w) && !allowed.has(w)),
  );
  if (hidden) {
    return '不能查表 ' + hidden + '。可以查：' + QUERY_TABLES.join('、');
  }
  return null;
}

/** 在只读模式下执行（query_only，事务里），最多 limit 行。 */
export async function queryLocal(
  db: Db,
  sql: string,
  limit: number,
): Promise<{ rows: Row[]; more: boolean }> {
  const all = (
    await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type IN ('table','view')",
    )
  ).map(r => r.name);
  const err = checkSql(sql, all);
  if (err) {
    throw new Error(err);
  }
  const body = sql.trim().replace(/;\s*$/, '');
  const n = Math.min(Math.max(1, Math.round(limit) || 50), QUERY_MAX_ROWS);
  const run = db.transaction(async tx => {
    await tx.run('PRAGMA query_only = ON');
    try {
      return await tx.all<Row>('SELECT * FROM (' + body + ') LIMIT ?', [n + 1]);
    } finally {
      await tx.run('PRAGMA query_only = OFF');
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rows = await Promise.race([
    run,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('查询超过 5 秒，换个更小的范围')),
        QUERY_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  return { rows: rows.slice(0, n), more: rows.length > n };
}

const cell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export async function queryText(
  core: AppCore,
  sql: string,
  limit: number,
): Promise<string> {
  const { rows, more } = await queryLocal(core.db, sql, limit);
  if (!rows.length) {
    return '查询成功，没有结果（价格单位厘，金额单位分，数量单位股 / 份）';
  }
  const cols = Object.keys(rows[0]);
  return [
    '查询结果 ' +
      rows.length +
      ' 行' +
      (more ? '（还有更多，已截断；加条件或 LIMIT 缩小范围）' : '') +
      '。价格单位厘（1 元 = 1000 厘），金额单位分，数量单位股 / 份。',
    cols.join(','),
    ...rows.map(r => cols.map(c => cell(r[c])).join(',')),
  ].join('\n');
}

/** 给模型看的表结构（get 工具说明里用不下，放在结果里）。 */
export const QUERY_SCHEMA =
  'quotes_snapshot(code,date,t 秒,prev_close,open,last,high,low,volume,amount,bids,asks,up,down,suspended)；' +
  'kline_day(code,date,open,close,high,low,volume) 不复权；security(code,name,type,pinyin)；' +
  'corp_action(code,ex_date,record_date,pay_date,cash_per_share_li 每股派现厘,bonus_per_share 每股送转,plan)；' +
  'trade_calendar(year,holidays JSON,confirmed)；account_event(account_id,trade_date,ts,type,body JSON)；' +
  'execution_report(rebalance_id,account_id,week,body JSON)；security_day(code,date,body JSON)';

// ---------- screen ----------

export interface ScreenFilters {
  pct_min?: number;
  pct_max?: number;
  pe_min?: number;
  pe_max?: number;
  pb_max?: number;
  /** 成交额下限（亿元）。 */
  amount_min?: number;
  /** 总市值下限（亿元）。 */
  cap_min?: number;
  turnover_min?: number;
  exclude_st?: boolean;
}

export const SCREEN_UNIVERSE: Record<string, string> = {
  a: '沪深 A 股',
  cyb: '创业板',
  kcb: '科创板',
  etf: 'ETF',
  watch: '自选',
  held: '持仓',
};
const SCREEN_SORT = ['pct', 'amount', 'turnover', 'pe', 'pb', 'cap'] as const;
type ScreenSort = (typeof SCREEN_SORT)[number];

const fnum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() && Number.isFinite(Number(v))
    ? Number(v)
    : null;

/** 按条件过滤和排序一组行情（纯函数，测试用）。 */
export function screenQuotes(
  quotes: Quote[],
  f: ScreenFilters,
  sort: ScreenSort,
  desc: boolean,
): Quote[] {
  const keep = quotes.filter(q => {
    const i = q.info;
    const amount = q.snapshot.amount / 100 / 1e8;
    const tests: [number | undefined, number | null, 'min' | 'max'][] = [
      [f.pct_min, i.pct, 'min'],
      [f.pct_max, i.pct, 'max'],
      [f.pe_min, i.pe, 'min'],
      [f.pe_max, i.pe, 'max'],
      [f.pb_max, i.pb, 'max'],
      [f.amount_min, amount, 'min'],
      [f.cap_min, i.totalCap, 'min'],
      [f.turnover_min, i.turnover, 'min'],
    ];
    for (const [lim, v, kind] of tests) {
      const l = fnum(lim);
      if (l == null) {
        continue;
      }
      if (v == null || (kind === 'min' ? v < l : v > l)) {
        return false;
      }
    }
    if (f.exclude_st !== false && /ST/i.test(i.name)) {
      return false;
    }
    return true;
  });
  const key = (q: Quote): number | null =>
    sort === 'pct'
      ? q.info.pct
      : sort === 'amount'
      ? q.snapshot.amount
      : sort === 'turnover'
      ? q.info.turnover
      : sort === 'pe'
      ? q.info.pe
      : sort === 'pb'
      ? q.info.pb
      : q.info.totalCap;
  return keep.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x == null || y == null) {
      return x == null ? (y == null ? 0 : 1) : -1;
    }
    return desc ? y - x : x - y;
  });
}

export async function screenText(
  core: AppCore,
  args: Record<string, unknown>,
): Promise<{ text: string; label: string }> {
  const universe = String(args.universe ?? 'a');
  if (!(universe in SCREEN_UNIVERSE)) {
    throw new Error(
      'universe 只能是 ' + Object.keys(SCREEN_UNIVERSE).join(' / '),
    );
  }
  const sort = (
    SCREEN_SORT.includes(args.sort as ScreenSort) ? args.sort : 'pct'
  ) as ScreenSort;
  const desc = args.order !== 'asc';
  const n = Math.min(Math.max(1, Math.round(Number(args.n) || 20)), 50);
  const filters = (args.filters ?? {}) as ScreenFilters;
  let codes: string[];
  let source: string;
  if (universe === 'watch') {
    codes = [...core.sim.recordedCodes()].filter(c => core.sim.security(c));
    source = '自选、持仓和有委托的证券';
  } else if (universe === 'held') {
    codes = core.sim.heldCodes();
    source = '当前持仓';
  } else {
    // 排行只给前若干只：按涨幅或成交额各取一段，合起来当候选池
    const pool = new Map<string, RankItem>();
    const take = (xs: RankItem[]) => xs.forEach(x => pool.set(x.code, x));
    if (universe === 'etf') {
      take(await core.client.etfRank('amount', 100));
      take(await core.client.etfRank(desc ? 'up' : 'down', 100));
    } else {
      const board = universe === 'a' ? 'aStock' : universe;
      take(await core.client.rank(board as 'aStock', 'amount', 100));
      take(
        await core.client.rank(board as 'aStock', desc ? 'up' : 'down', 100),
      );
    }
    codes = [...pool.keys()];
    source =
      SCREEN_UNIVERSE[universe] +
      '成交额前 100 和' +
      (desc ? '涨幅' : '跌幅') +
      '前 100（腾讯 / 新浪排行），不是全市场';
  }
  if (!codes.length) {
    return {
      text: '候选池是空的（' + source + '）',
      label: '选股（候选池为空）',
    };
  }
  const quotes = await core.client.quotes(codes);
  const out = screenQuotes(quotes, filters, sort, desc).slice(0, n);
  const lines = out.map(q => {
    const i = q.info;
    const d = i.type === 'ETF' ? 3 : 2;
    return [
      q.snapshot.code,
      i.name,
      q.snapshot.last != null ? formatPrice(q.snapshot.last, d) : '—',
      i.pct != null ? i.pct.toFixed(2) + '%' : '—',
      (q.snapshot.amount / 100 / 1e8).toFixed(2),
      i.turnover != null ? i.turnover.toFixed(2) + '%' : '—',
      i.pe != null ? i.pe.toFixed(2) : '—',
      i.pb != null ? i.pb.toFixed(2) : '—',
      i.totalCap != null ? i.totalCap.toFixed(0) : '—',
    ].join(',');
  });
  return {
    text: [
      '选股：候选 ' +
        quotes.length +
        ' 只（' +
        source +
        '），符合条件 ' +
        out.length +
        ' 只，按 ' +
        sort +
        (desc ? ' 从高到低' : ' 从低到高') +
        '。' +
        (filters.exclude_st === false ? '' : '已排除 ST。'),
      '代码,名称,现价(元),涨跌幅,成交额(亿元),换手率,市盈率(动),市净率,总市值(亿元)',
      ...lines,
    ].join('\n'),
    label:
      '选股：' + SCREEN_UNIVERSE[universe] + ' ' + out.length + ' 只符合条件',
  };
}

// ---------- get_analysis ----------

export async function analysisText(
  core: AppCore,
  bench: string,
): Promise<string> {
  const b = (bench in BENCH ? bench : 'sh000300') as Bench;
  const r = await loadAnalysis(core, b);
  if (!r) {
    return '还没有交割单（没有入金或成交），没法做账户分析';
  }
  if (!r.a) {
    return '交易日太少（至少要 2 个有收益的交易日），还算不出指标';
  }
  const a = r.a;
  return [
    '账户分析（基准 ' +
      BENCH[b] +
      '，' +
      a.from +
      ' 到 ' +
      a.to +
      '，' +
      a.n +
      ' 个交易日的日收益' +
      (a.tooFew ? '；少于 20 个交易日，不具备统计意义' : '') +
      '）',
    ...a.metrics.map(m => m.name + '：' + m.value + '（' + m.formula + '）'),
    '最近总资产：' +
      r.eq
        .slice(-5)
        .map(e => e.date + ' ' + formatFen(e.total) + ' 元')
        .join('，'),
  ].join('\n');
}

// ---------- get_corp_actions ----------

export async function corpActionsText(
  core: AppCore,
  args: Record<string, unknown>,
): Promise<{ text: string; label: string }> {
  const fmt = (x: {
    code: string;
    name?: string;
    exDate: string;
    recordDate: string;
    payDate: string;
    cashPerShareLi: number;
    bonusPerShare: number;
    plan?: string;
  }) =>
    [
      x.code,
      x.name ?? core.sim.security(x.code)?.name ?? '',
      x.recordDate,
      x.exDate,
      x.payDate,
      (x.cashPerShareLi / 1000).toFixed(4),
      x.bonusPerShare ? String(+x.bonusPerShare.toFixed(4)) : '0',
      x.plan ?? '',
    ].join(',');
  const head =
    '代码,名称,股权登记日,除权除息日,派息日,每股派现(元,税前),每股送转(股),方案';
  if (typeof args.code === 'string' && args.code.trim()) {
    const r = await resolveCode(core, args.code);
    if (!r) {
      throw new Error('找不到证券「' + args.code + '」');
    }
    const rows = await core.client.corporateActions(r.code);
    return {
      text: rows.length
        ? [
            r.name + ' 分红送配（东方财富，最近 ' + rows.length + ' 次）',
            head,
            ...rows.map(x => fmt({ ...x, name: r.name })),
          ].join('\n')
        : r.name + ' 没有分红送配记录（东方财富）',
      label: '读取 ' + r.name + ' 分红送配（东方财富）',
    };
  }
  const today = core.sim.now().date;
  const from = typeof args.from === 'string' ? args.from : today;
  const to = typeof args.to === 'string' ? args.to : '9999-12-31';
  const rows = await core.db.all<{
    code: string;
    ex_date: string;
    record_date: string;
    pay_date: string;
    cash_per_share_li: number;
    bonus_per_share: number;
    plan: string;
  }>(
    'SELECT * FROM corp_action WHERE ex_date >= ? AND ex_date <= ? ORDER BY ex_date LIMIT 100',
    [from, to],
  );
  return {
    text: rows.length
      ? [
          '除权除息日历（本地库，' +
            from +
            ' 起；只有持仓和自选证券的数据，App 每天更新）',
          head,
          ...rows.map(x =>
            fmt({
              code: x.code,
              exDate: x.ex_date,
              recordDate: x.record_date,
              payDate: x.pay_date,
              cashPerShareLi: Number(x.cash_per_share_li),
              bonusPerShare: Number(x.bonus_per_share),
              plan: x.plan,
            }),
          ),
        ].join('\n')
      : from +
        ' 起本地库里没有除权除息安排（只覆盖持仓和自选证券；某只证券的历史用 code 查）',
    label: '读取 除权除息日历（' + from + ' 起）',
  };
}

// ---------- get_benchmark ----------

export async function benchmarkText(
  core: AppCore,
  r: Resolved,
  period: 'day' | 'week' | 'month',
  n: number,
): Promise<string> {
  const bars = await core.client.kline(r.code, r.type, period, n + 1, 'qfq');
  if (bars.length < 2) {
    return r.name + ' 没有足够的 K 线';
  }
  const last = bars[bars.length - 1];
  const back = (k: number) => {
    const b = bars[bars.length - 1 - k];
    return b ? pctText(last.close / b.close - 1) : '—';
  };
  const d = r.type === 'ETF' ? 3 : 2;
  const unit = period === 'day' ? '日' : period === 'week' ? '周' : '月';
  const steps = period === 'day' ? [1, 5, 20, 60] : [1, 4, 12];
  return [
    r.name +
      ' ' +
      r.code +
      '（前复权，' +
      bars.length +
      ' 根' +
      unit +
      ' K）最新 ' +
      last.date +
      ' 收盘 ' +
      formatPrice(last.close, d),
    '区间收益：' +
      steps
        .filter(k => k < bars.length)
        .map(k => '近 ' + k + ' ' + unit + ' ' + back(k))
        .join('，') +
      '，全区间 ' +
      pctText(last.close / bars[0].close - 1) +
      '（' +
      bars[0].date +
      ' 起）',
    '日期,收盘',
    ...bars
      .slice(-Math.min(bars.length, 30))
      .map(b => b.date + ',' + formatPrice(b.close, d)),
  ].join('\n');
}

// ---------- 提案、决策日志、记分卡 ----------

const priceRange = (lo: number | null, hi: number | null) =>
  lo == null && hi == null
    ? ''
    : '，价格 ' +
      (lo != null ? (lo / 1000).toFixed(3) : '') +
      '–' +
      (hi != null ? (hi / 1000).toFixed(3) : '') +
      ' 元';

export function proposalLine(p: Proposal): string {
  return (
    '#' +
    p.id +
    ' ' +
    p.createdAt.slice(0, 10) +
    ' ' +
    (p.kind === 'rebalance' ? '调仓方案' : '单只建议') +
    ' [' +
    PROPOSAL_STATUS_NAME[p.status] +
    '] ' +
    p.items
      .map(
        i =>
          STANCE_NAME[i.stance] +
          ' ' +
          i.name +
          (i.weight != null ? ' ' + +(i.weight * 100).toFixed(2) + '%' : '') +
          priceRange(i.priceLow, i.priceHigh),
      )
      .join('；') +
    '。期限 ' +
    p.horizonDays +
    ' 个交易日（到期 ' +
    p.dueDate +
    '），基准 ' +
    p.benchmark +
    '。理由：' +
    p.thesis +
    '。失效条件：' +
    p.invalidation +
    (p.review
      ? '。复盘：区间收益 ' +
        pctText(p.review.ret) +
        '，基准 ' +
        pctText(p.review.benchmarkRet) +
        (p.review.excess != null
          ? '，超额 ' +
            pctText(p.review.excess) +
            (p.review.hit ? '，命中' : '，未命中')
          : '（观望，不计命中）')
      : p.reviewError
      ? '。复盘未完成：' + p.reviewError
      : '')
  );
}

export function journalLine(e: JournalEntry): string {
  return (
    '#' +
    e.id +
    ' ' +
    e.createdAt.slice(0, 10) +
    ' [' +
    (e.source === 'ai' ? 'AI 提案' : '你') +
    '] ' +
    (e.side === 'B' ? '买入 ' : '卖出 ') +
    e.name +
    (e.orderId != null ? '（委托 id ' + e.orderId + '）' : '') +
    (e.rebalanceId != null ? '（调仓 #' + e.rebalanceId + '）' : '') +
    '。理由：' +
    e.thesis +
    (e.expectation ? '。预期：' + e.expectation : '') +
    (e.invalidation ? '。失效条件：' + e.invalidation : '') +
    '。到期 ' +
    e.dueDate +
    (e.review
      ? '，区间收益 ' +
        pctText(e.review.ret) +
        '，相对 ' +
        e.benchmark +
        ' 超额 ' +
        pctText(e.review.excess)
      : '')
  );
}

export async function journalText(
  core: AppCore,
  code: string | null,
  n: number,
): Promise<string> {
  const rows = await advice.journal(core.db, {
    accountId: core.sim.accountId,
    code: code ?? undefined,
    limit: n,
  });
  return rows.length
    ? '决策日志（当前账户，从新到旧 ' +
        rows.length +
        ' 条）\n' +
        rows.map(journalLine).join('\n')
    : '当前账户还没有决策日志' + (code ? '（' + code + '）' : '');
}

export async function scorecardText(core: AppCore): Promise<string> {
  await refreshReviews(core).catch(() => 0);
  const card = await scorecard(core.db);
  const recent = (await advice.proposals(core.db, 10)).map(proposalLine);
  return [
    '记分卡（到期按基准对账，超额 = 方向 ×（标的收益 − 基准收益），前复权收盘价）',
    scoreLineText('AI 提案', card.ai),
    scoreLineText('你自己的决策', card.user),
    recent.length ? '最近的提案：\n' + recent.join('\n') : '还没有提案',
  ].join('\n');
}

export async function portfolioText(core: AppCore): Promise<string> {
  const st = await strategies(core.db);
  const runs = await rebalances(core.db, core.sim.accountId);
  const reps = await reports(core.db, core.sim.accountId);
  const risk = riskOf(core.sim.engine.state);
  return [
    '风险限额：' + riskText(risk),
    st.length
      ? '策略：\n' +
        st
          .map(
            s =>
              '#' +
              s.id +
              ' ' +
              s.name +
              ' v' +
              s.version +
              '：股票池 ' +
              s.pool +
              '；频率 ' +
              s.frequency +
              '；基准 ' +
              s.benchmark +
              '；单票上限 ' +
              +(s.maxWeight * 100).toFixed(2) +
              '%；补单 ' +
              (s.retry === 'once' ? '9:30 后按卖一价补一次' : '不补单') +
              '；纪律：' +
              s.discipline,
          )
          .join('\n')
      : '还没有策略（调仓方案要先在「组合与调仓」里建立策略）',
    runs.length
      ? '最近的调仓：\n' +
        runs
          .slice(0, 5)
          .map(
            r =>
              '#' +
              r.id +
              ' ' +
              r.createdAt.slice(0, 10) +
              ' ' +
              { draft: '待确认', executing: '执行中', reported: '已复盘' }[
                r.status
              ] +
              (r.proposalId != null
                ? '（AI 提案 #' + r.proposalId + '）'
                : '') +
              '：' +
              r.plan.rows
                .map(
                  x =>
                    x.name +
                    ' ' +
                    x.held +
                    '→' +
                    x.targetQty +
                    (x.check && !x.check.ok ? '（' + x.check.msg + '）' : ''),
                )
                .join('，'),
          )
          .join('\n')
      : '还没有调仓记录',
    reps.length
      ? '最近的执行报告：\n' +
        reps
          .slice(0, 4)
          .map(
            r =>
              r.week +
              ' 周 #' +
              r.rebalanceId +
              '：实际费用 ' +
              formatFen(r.fees) +
              ' 元，最低佣金多收 ' +
              formatFen(r.minExtra) +
              ' 元，滑点 ' +
              formatFen(r.slippage) +
              ' 元，实现损失 ' +
              (r.shortfall == null
                ? '未计算'
                : formatFen(r.shortfall) + ' 元') +
              (r.violations.length ? '；违规：' + r.violations.join('；') : ''),
          )
          .join('\n')
      : '还没有执行报告',
  ].join('\n');
}
