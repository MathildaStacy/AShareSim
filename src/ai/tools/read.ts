/**
 * 读取类工具（AI_ASSISTANT.md §8）：直接执行，结果用紧凑文本（K 线是 CSV），数字带单位。
 * 账户数据都是现读引擎状态，不用记忆（PRODUCT_DESIGN §10）。
 */
import type { AppCore } from '../../app/boot';
import { syncLearn, useLearn } from '../../app/learn';
import * as aiRepo from '../../data/aiRepo';
import * as repo from '../../data/repos';
import { holdingOf, isLive, positions, summary } from '../../engine/account';
import { STATUTORY } from '../../engine/fees';
import {
  classify,
  isSTName,
  ruleOf,
  type Security,
} from '../../engine/securities';
import { formatSec, phaseAt, PHASES } from '../../engine/session';
import { KIND_NAME, type Order } from '../../engine/types';
import { formatFen, formatPrice, type Li } from '../../engine/units';
import { LESSONS, lessonById } from '../../learn/lessons';
import { lessonCheckId, lessonStatus } from '../../learn/progress';
import { STAGES, stageItems, stageProgress } from '../../learn/roadmap';
import type { Lesson } from '../../learn/types';
import type { Quote } from '../../market/tencent';
import { feeSummary, rateText } from '../../sim/feeForm';
import { BOARD_NAME, ruleCard } from '../../sim/ruleCard';
import { ratePct } from '../../sim/fillExplain';

// ---------- 证券 ----------

export interface Resolved {
  code: string;
  name: string;
  type: string;
}

/** 6 位代码按首位推交易所：6 / 5 / 9 开头是沪市，其他是深市（指数要带前缀）。 */
export function normalizeCode(input: string): string | null {
  const t = input.trim().toLowerCase();
  if (/^(sh|sz)\d{6}$/.test(t)) {
    return t;
  }
  const m = /^(\d{6})(\.(sh|sz))?$/.exec(t);
  if (!m) {
    return null;
  }
  if (m[3]) {
    return m[3] + m[1];
  }
  return (/^[659]/.test(m[1]) ? 'sh' : 'sz') + m[1];
}

/** 代码或名称 → 证券；名称用腾讯搜索取第一个。 */
export async function resolveCode(
  core: AppCore,
  input: unknown,
): Promise<Resolved | null> {
  const text = String(input ?? '').trim();
  if (!text) {
    return null;
  }
  const code = normalizeCode(text);
  if (code) {
    const q = core.sim.quote(code);
    const sec = core.sim.security(code);
    return {
      code,
      name: q?.info.name ?? sec?.name ?? code,
      type: q?.info.type ?? sec?.type ?? '',
    };
  }
  const hits = await core.client.search(text);
  const hit = hits.find(h => h.name === text) ?? hits[0];
  return hit ? { code: hit.code, name: hit.name, type: hit.type } : null;
}

/** 现拉一次行情并交给模拟器（和刷新一轮一样：更新证券信息、撮合、存快照）。 */
export async function freshQuote(
  core: AppCore,
  code: string,
): Promise<Quote | null> {
  const qs = await core.client.quotes([code]);
  if (!qs.length) {
    return null;
  }
  await core.sim.ingest(qs);
  return qs.find(q => q.snapshot.code === code) ?? qs[0];
}

export function securityOf(core: AppCore, r: Resolved): Security | null {
  const known = core.sim.security(r.code);
  if (known) {
    return known;
  }
  const c = classify(r.code, r.type || undefined);
  return c ? { code: r.code, name: r.name, ...c, st: isSTName(r.name) } : null;
}

const decimalsOf = (sec: Security | null, type: string) =>
  sec ? ruleOf(sec).decimals : type === 'ETF' ? 3 : 2;

const yi = (v: number | null) =>
  v == null ? '—' : (v / 1e8).toFixed(2) + ' 亿元';

const pctText = (v: number | null) =>
  v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';

const qtyText = (n: number) => n.toLocaleString('zh-CN');

// ---------- 行情 ----------

export function quoteText(q: Quote, sec: Security | null): string {
  const s = q.snapshot;
  const i = q.info;
  const d = decimalsOf(sec, i.type);
  const p = (v: Li | null) => (v == null ? '—' : formatPrice(v, d));
  const unit = sec?.board === 'etf' ? '份' : '股';
  const board = sec
    ? (sec.exchange === 'SH' ? '沪市' : '深市') +
      BOARD_NAME[sec.board] +
      (sec.st ? ' · 风险警示' : '')
    : i.type === 'ZS'
    ? '指数'
    : i.type;
  const lines = [
    i.name +
      ' ' +
      s.code +
      ' · ' +
      board +
      ' · 行情时间 ' +
      s.date +
      ' ' +
      formatSec(s.t),
    s.suspended ? '停牌' : '',
    '现价 ' +
      p(s.last) +
      ' 元，涨跌 ' +
      (i.change == null ? '—' : formatPrice(i.change, d)) +
      '（' +
      pctText(i.pct) +
      '），昨收 ' +
      p(s.prevClose),
    '今开 ' + p(s.open) + '，最高 ' + p(s.high) + '，最低 ' + p(s.low),
    s.up != null ? '涨停 ' + p(s.up) + '，跌停 ' + p(s.down) : '不设涨跌幅',
    '成交量 ' +
      qtyText(s.volume) +
      ' ' +
      unit +
      '，成交额 ' +
      yi(s.amount / 100) +
      (i.turnover != null ? '，换手率 ' + i.turnover + '%' : ''),
  ];
  if (i.type !== 'ZS' && i.type !== 'ETF') {
    lines.push(
      '市盈率（动态）' +
        (i.pe ?? '—') +
        '，市净率 ' +
        (i.pb ?? '—') +
        '，总市值 ' +
        (i.totalCap ?? '—') +
        ' 亿元，流通市值 ' +
        (i.floatCap ?? '—') +
        ' 亿元',
    );
  }
  if (s.asks.length || s.bids.length) {
    const lv = (arr: [Li, number][], name: string) =>
      arr
        .map((l, k) => name + (k + 1) + ' ' + p(l[0]) + ' × ' + qtyText(l[1]))
        .join('，');
    lines.push('卖盘：' + lv([...s.asks], '卖'));
    lines.push('买盘：' + lv([...s.bids], '买'));
  }
  return lines.filter(Boolean).join('\n');
}

const PERIOD_NAME: Record<string, string> = {
  day: '日 K',
  week: '周 K',
  month: '月 K',
  m15: '15 分钟 K',
  m30: '30 分钟 K',
  m60: '60 分钟 K',
  minute: '分时',
};

export async function klineText(
  core: AppCore,
  r: Resolved,
  period: string,
  n: number,
): Promise<string> {
  const sec = securityOf(core, r);
  const d = decimalsOf(sec, r.type);
  const p = (v: Li) => formatPrice(v, d);
  if (period === 'minute') {
    const day = await core.client.minute(r.code, r.type);
    if (!day || !day.points.length) {
      return r.name + ' 今天还没有分时数据';
    }
    const pts = day.points.slice(-n);
    return [
      r.name +
        ' ' +
        r.code +
        ' ' +
        day.date +
        ' 分时（共 ' +
        day.points.length +
        ' 个点，这里是最后 ' +
        pts.length +
        ' 个）',
      '时间,价格,成交量(' +
        (sec?.board === 'etf' ? '份' : '股') +
        '),成交额(元)',
      ...pts.map(
        x =>
          formatSec(x.t).slice(0, 5) +
          ',' +
          p(x.price) +
          ',' +
          x.volume +
          ',' +
          (x.amount / 100).toFixed(0),
      ),
    ].join('\n');
  }
  const bars =
    period === 'm15' || period === 'm30' || period === 'm60'
      ? await core.client.minuteKline(r.code, r.type, period, n)
      : await core.client.kline(
          r.code,
          r.type,
          period as 'day' | 'week' | 'month',
          n,
          'qfq',
        );
  if (!bars.length) {
    return r.name + ' 没有' + PERIOD_NAME[period] + '数据';
  }
  return [
    r.name +
      ' ' +
      r.code +
      ' ' +
      PERIOD_NAME[period] +
      '（' +
      (period.startsWith('m') ? '不复权' : '前复权') +
      '），' +
      bars.length +
      ' 根',
    '日期,开,高,低,收,成交量(' + (sec?.board === 'etf' ? '份' : '股') + ')',
    ...bars.map(
      b =>
        b.date +
        ',' +
        p(b.open) +
        ',' +
        p(b.high) +
        ',' +
        p(b.low) +
        ',' +
        p(b.close) +
        ',' +
        b.volume,
    ),
  ].join('\n');
}

export async function profileText(core: AppCore, r: Resolved): Promise<string> {
  const pr = await core.client.companyProfile(r.code);
  if (!pr) {
    return r.name + '（' + r.code + '）没有公司简况（ETF、指数没有 F10）';
  }
  const intro =
    pr.profile.length > 600 ? pr.profile.slice(0, 600) + '…' : pr.profile;
  return [
    pr.fullName + '（' + pr.name + '，' + r.code + '）',
    '行业：' + pr.industry,
    '成立 ' +
      (pr.foundDate ?? '—') +
      '，上市 ' +
      (pr.listingDate ?? '—') +
      '，' +
      pr.province,
    '主营业务：' + pr.mainBusiness,
    '简介：' + intro,
    '来源：东方财富 F10',
  ].join('\n');
}

export async function financeText(
  core: AppCore,
  r: Resolved,
  periods: number,
): Promise<string> {
  const rows = await core.client.financials(r.code, periods);
  if (!rows.length) {
    return r.name + '（' + r.code + '）没有财务数据（ETF、指数没有）';
  }
  const num2 = (v: number | null) => (v == null ? '—' : v.toFixed(2));
  return [
    r.name +
      ' 主要财务指标（东方财富 F10；报告期是累计值，例如中报 = 1–6 月；金融企业没有毛利率）',
    '报告期,营业总收入,同比,归母净利润,同比,基本每股收益(元),ROE加权(%),毛利率(%)',
    ...rows.map(f =>
      [
        f.period,
        yi(f.revenue),
        pctText(f.revenueYoy),
        yi(f.netProfit),
        pctText(f.netProfitYoy),
        num2(f.eps),
        num2(f.roe),
        num2(f.grossMargin),
      ].join(','),
    ),
  ].join('\n');
}

// ---------- 账户 ----------

const nameOf = (core: AppCore, code: string) =>
  core.sim.security(code)?.name ?? core.sim.quote(code)?.info.name ?? code;

const decOf = (core: AppCore, code: string) => {
  const s = core.sim.security(code);
  return s ? ruleOf(s).decimals : 2;
};

export function positionsText(core: AppCore): string {
  const st = core.sim.engine.state;
  const priceOf = (c: string) => core.sim.engine.lastPrice(c);
  const sum = summary(st, priceOf);
  const pos = positions(st, priceOf);
  const lines = [
    '账户（' +
      st.date +
      '）：总资产 ' +
      formatFen(sum.total) +
      ' 元 = 资金余额 ' +
      formatFen(sum.cash) +
      ' + 持仓市值 ' +
      formatFen(sum.marketValue) +
      '；可用 ' +
      formatFen(sum.available) +
      '，可取 ' +
      formatFen(sum.withdrawable) +
      '，冻结 ' +
      formatFen(sum.frozen) +
      '；累计净入金 ' +
      formatFen(st.depositTotal) +
      ' 元（上限 ' +
      formatFen(st.depositCap) +
      '）',
  ];
  if (!pos.length) {
    lines.push('没有持仓');
    return lines.join('\n');
  }
  lines.push(
    '持仓：代码,名称,数量,可卖,今日买入,摊薄成本价,买入均价,现价,市值(元),浮动盈亏(元,按摊薄成本),盈亏比例',
  );
  for (const p of pos) {
    const d = decOf(core, p.code);
    lines.push(
      [
        p.code,
        nameOf(core, p.code),
        p.qty,
        p.sellable,
        p.todayBuy,
        formatPrice(p.dilutedPrice, d),
        formatPrice(p.averagePrice, d),
        formatPrice(p.lastPrice, d),
        formatFen(p.marketValue),
        formatFen(p.pnl),
        p.pnlPct.toFixed(2) + '%',
      ].join(','),
    );
  }
  return lines.join('\n');
}

function orderLine(core: AppCore, o: Order): string {
  const d = decOf(core, o.code);
  const unit = core.sim.security(o.code)?.board === 'etf' ? '份' : '股';
  return [
    'id ' + o.id,
    '合同号 ' + o.no,
    o.date + ' ' + formatSec(o.t),
    (o.side === 'B' ? '买入 ' : '卖出 ') +
      nameOf(core, o.code) +
      '(' +
      o.code +
      ')',
    qtyText(o.qty) + unit,
    o.price != null ? '@' + formatPrice(o.price, d) : '',
    KIND_NAME[o.kind],
    '状态 ' + o.status + (o.filled ? '，已成交 ' + qtyText(o.filled) : ''),
    o.reason ? '原因：' + o.reason : '',
    o.note ? '说明：' + o.note : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function ordersText(core: AppCore, scope: string, n: number): string {
  const st = core.sim.engine.state;
  const list = [...st.orders]
    .reverse()
    .filter(o =>
      scope === 'live'
        ? isLive(o)
        : scope === 'all'
        ? true
        : o.date === st.date,
    )
    .slice(0, n);
  const head =
    (scope === 'live'
      ? '未完成委托'
      : scope === 'all'
      ? '全部委托（最近的在前）'
      : '当日委托（' + st.date + '）') +
    '：' +
    list.length +
    ' 笔';
  return [head, ...list.map(o => orderLine(core, o))].join('\n');
}

export function tradesText(core: AppCore, from?: string, to?: string): string {
  const st = core.sim.engine.state;
  let list = st.ledger.filter(
    l => (!from || l.date >= from) && (!to || l.date <= to),
  );
  if (!from && !to) {
    list = list.slice(-20);
  }
  if (!list.length) {
    return '这段时间没有交割单记录';
  }
  return [
    '交割单（' +
      list.length +
      ' 条，金额单位元）：日期 时间,业务,证券,价格,数量,成交金额,佣金,印花税,过户费,经手费,证管费,红利税,资金发生额,资金余额,合同号,备注',
    ...list.map(l => {
      const d = l.code ? decOf(core, l.code) : 2;
      return [
        l.date + ' ' + formatSec(l.t),
        l.biz,
        l.code ? nameOf(core, l.code) + '(' + l.code + ')' : '',
        l.price ? formatPrice(l.price, d) : '',
        l.qty || '',
        formatFen(l.amount),
        formatFen(l.fee.commission),
        formatFen(l.fee.stamp),
        formatFen(l.fee.transfer),
        formatFen(l.fee.handling),
        formatFen(l.fee.reg),
        formatFen(l.divTax),
        formatFen(l.net),
        formatFen(l.balance),
        l.orderNo,
        l.note,
      ].join(',');
    }),
  ].join('\n');
}

export function feeProfileText(core: AppCore): string {
  const f = core.sim.engine.state.fee;
  return [
    '费率状态：' + feeSummary(f),
    '股票佣金 ' +
      rateText(f, 'stock') +
      (f.calibratedStock ? '（已用交割单校准）' : '（未校准）'),
    'ETF 佣金 ' +
      rateText(f, 'etf') +
      (f.calibratedEtf ? '（已用交割单校准）' : '（未校准）'),
    '规费（经手费、证管费）' + (f.regsSeparate ? '另收' : '含在佣金里'),
    '同一委托多笔成交' +
      (f.mergeOrder
        ? '合并计算佣金（最低佣金按委托算）'
        : '每笔成交分别计算佣金'),
    '法定费用：印花税 ' +
      ratePct(STATUTORY.stamp) +
      '（仅卖出，ETF 免征）；过户费 ' +
      ratePct(STATUTORY.transfer) +
      '（双向，ETF 不收）；经手费 股票 ' +
      ratePct(STATUTORY.handlingStock) +
      '、ETF ' +
      ratePct(STATUTORY.handlingEtf) +
      '；证管费 ' +
      ratePct(STATUTORY.reg) +
      '（只收股票）。经手费和证管费在「规费另收」时单列，否则含在佣金里',
    '改费率只对之后提交的委托生效，已有委托按提交时的费率算',
  ].join('\n');
}

// ---------- 规则和学习 ----------

export function lessonText(l: Lesson): string {
  const out = [
    '规则课「' +
      l.title +
      '」（id ' +
      l.id +
      '，对应 TRADING_RULES ' +
      l.spec +
      '）',
    l.summary,
  ];
  for (const b of l.blocks) {
    if (b.t === 'p' || b.t === 'eg' || b.t === 'warn') {
      out.push(
        (b.t === 'eg' ? '例：' : b.t === 'warn' ? '注意：' : '') + b.text,
      );
    } else if (b.t === 'h') {
      out.push('【' + b.text + '】');
    } else if (b.t === 'list') {
      out.push(...b.items.map(i => '- ' + i));
    } else {
      out.push(...b.rows.map(r => r.join(' | ')));
    }
  }
  out.push('小测：');
  l.quiz.forEach((q, i) =>
    out.push(
      i +
        1 +
        '. ' +
        q.q +
        ' 正确答案：' +
        q.options[q.answer] +
        '。' +
        q.explain,
    ),
  );
  return out.join('\n').replace(/\*\*/g, '');
}

export function findLesson(topic: string): Lesson | null {
  const t = topic.trim().toLowerCase();
  return (
    lessonById(t) ??
    LESSONS.find(l => l.title.toLowerCase().includes(t)) ??
    LESSONS.find(l => l.summary.toLowerCase().includes(t)) ??
    LESSONS.find(l =>
      l.blocks.some(b => 'text' in b && b.text.toLowerCase().includes(t)),
    ) ??
    null
  );
}

export async function ruleCardText(
  core: AppCore,
  r: Resolved,
): Promise<string> {
  const q =
    (await freshQuote(core, r.code).catch(() => null)) ??
    core.sim.quote(r.code);
  const sec = securityOf(core, {
    ...r,
    name: q?.info.name ?? r.name,
    type: q?.info.type ?? r.type,
  });
  if (!sec) {
    return r.name + '（' + r.code + '）不是能交易的 A 股或 ETF（可能是指数）';
  }
  const now = core.sim.now();
  const items = ruleCard({
    sec,
    snap: q?.snapshot ?? null,
    t: now.t,
    isTradingDay: core.sim.calendar.isTradingDay(now.date),
    holding: holdingOf(core.sim.engine.state, r.code),
    fee: core.sim.engine.state.fee,
  });
  return [
    sec.name + '（' + sec.code + '）规则卡：',
    ...items.map(
      i => i.k + '：' + i.v + (i.ok === false ? '（✕）' : i.ok ? '（✓）' : ''),
    ),
  ].join('\n');
}

export async function learningText(core: AppCore): Promise<string> {
  await syncLearn(core).catch(() => undefined);
  const { checks, answers, missing } = useLearn.getState();
  const out: string[] = [];
  for (const st of STAGES) {
    const p = stageProgress(st, checks);
    out.push(
      '阶段 ' + st.no + ' ' + st.title + '：' + p.done + ' / ' + p.total,
    );
    for (const it of stageItems(st)) {
      const c = checks[it.id];
      out.push(
        '  ' +
          (c ? '✓' : '○') +
          ' [' +
          it.id +
          (it.auto ? '，自动' : '，手动') +
          '] ' +
          it.text +
          (c ? '（' + c.doneAt.slice(0, 10) + '）' : '') +
          (!c && missing[it.id]?.length
            ? '；还差：' + missing[it.id].join('、')
            : ''),
      );
    }
  }
  out.push('规则课：');
  for (const l of LESSONS) {
    const s = lessonStatus(l, answers);
    out.push(
      '  ' +
        (checks[lessonCheckId(l.id)] ? '✓ 已通过' : '○ 未通过') +
        ' ' +
        l.title +
        '（' +
        l.id +
        '，本轮答对 ' +
        s.correct +
        ' / ' +
        s.total +
        '）',
    );
  }
  return out.join('\n');
}

// ---------- 记录 ----------

export async function activityText(
  core: AppCore,
  n: number,
  kinds: string[] | null,
): Promise<string> {
  const rows = await repo.recentActivity(
    core.db,
    kinds?.length ? n * 10 : n,
    core.sim.accountId,
  );
  const list = (
    kinds?.length ? rows.filter(a => kinds.includes(a.kind)) : rows
  ).slice(0, n);
  if (!list.length) {
    return '没有符合条件的操作记录';
  }
  return list
    .map(
      a => a.ts.slice(0, 16).replace('T', ' ') + ' [' + a.kind + '] ' + a.text,
    )
    .join('\n');
}

export async function conversationsText(
  core: AppCore,
  query: string,
  threadId: number,
): Promise<string> {
  const hits = await aiRepo.searchConversations(core.db, query, threadId);
  if (!hits.length) {
    return '其他对话里没有找到「' + query + '」';
  }
  return hits
    .map(h =>
      [
        '对话「' + h.title + '」（' + h.updatedAt.slice(0, 10) + '）',
        h.summary ? '摘要：' + h.summary.slice(0, 300) : '',
        ...h.snippets,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}

/** 「现在」：交易日和时段（拼进每次提问的 <now>）。 */
export function phaseName(core: AppCore): {
  tradingDay: boolean;
  phase: string;
} {
  const now = core.sim.now();
  return {
    tradingDay: core.sim.calendar.isTradingDay(now.date),
    phase: PHASES[phaseAt(now.t)].name,
  };
}
