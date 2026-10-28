/**
 * 提案流程（PRODUCT_DESIGN §6.7）：AI 调 propose → 存成提案（不改账户，所以不用确认）→ 你批准或拒绝。
 * 调仓方案批准后用 M5 的调仓服务预检并生成调仓计划，在对话里显示成一张批量操作卡；你点「执行」
 * 才提交委托，之后的补单、执行报告都和手动调仓一样。到期按基准对账，形成记分卡。
 */
import type { Db } from '../data/db';
import { beijingIso } from '../market/clock';
import type { MarketClient } from '../market/client';
import type { KBar } from '../market/tencent';
import { PortfolioService } from '../portfolio/service';
import { loadRebalance, strategies } from '../portfolio/repo';
import type { Rebalance, TargetFile } from '../portfolio/types';
import type { Simulator } from '../sim/simulator';
import * as repo from './repo';
import { addDays } from '../engine/calendar';
import { datesOf, isDue, reviewOf, scoreLine } from './score';
import {
  STANCE_DIR,
  type JournalInput,
  type JournalEntry,
  type Proposal,
  type ProposalItem,
  type ProposalKind,
  type Scorecard,
} from './types';
import * as data from '../data/repos';

export interface AdviceDeps {
  db: Db;
  sim: Simulator;
  client: MarketClient;
}

export interface ProposalInput {
  threadId: number | null;
  kind: ProposalKind;
  items: ProposalItem[];
  horizonDays: number;
  benchmark: string;
  thesis: string;
  invalidation: string;
}

/** 校验提案内容；返回错误说明。 */
export function invalidProposal(p: ProposalInput): string | null {
  if (!p.items.length) {
    return 'items 不能为空';
  }
  if (p.kind === 'single' && p.items.length !== 1) {
    return '单只建议一次只写一只；多只建议分开调用，或者用调仓方案（rebalance）';
  }
  if (!(p.horizonDays >= 1 && p.horizonDays <= 250)) {
    return '期限要在 1–250 个交易日之间';
  }
  if (!p.thesis.trim()) {
    return '要写理由（thesis）';
  }
  if (!p.invalidation.trim()) {
    return '要写失效条件（invalidation）：什么情况说明判断错了';
  }
  if (!/^(sh|sz)\d{6}$/.test(p.benchmark)) {
    return '基准要用完整代码，例如 sh510300';
  }
  const codes = new Set<string>();
  for (const it of p.items) {
    if (codes.has(it.code)) {
      return '代码重复：' + it.code;
    }
    codes.add(it.code);
    if (it.weight != null && !(it.weight >= 0 && it.weight <= 1)) {
      return it.name + ' 的权重要在 0–100% 之间';
    }
  }
  if (p.kind === 'rebalance') {
    if (p.items.some(i => i.weight == null)) {
      return '调仓方案每只都要给目标权重（0–1）';
    }
    if (p.items.reduce((n, i) => n + (i.weight ?? 0), 0) > 1 + 1e-9) {
      return '目标权重合计不能超过 100%';
    }
  }
  return null;
}

export async function createProposal(
  d: AdviceDeps,
  input: ProposalInput,
): Promise<Proposal> {
  const err = invalidProposal(input);
  if (err) {
    throw new Error(err);
  }
  const now = d.sim.now();
  const { baseDate, dueDate } = datesOf(
    d.sim.calendar,
    now.date,
    input.horizonDays,
  );
  const p = await repo.addProposal(d.db, {
    accountId: d.sim.accountId,
    threadId: input.threadId,
    kind: input.kind,
    status: 'proposed',
    items: input.items,
    horizonDays: input.horizonDays,
    benchmark: input.benchmark,
    thesis: input.thesis.trim(),
    invalidation: input.invalidation.trim(),
    createdAt: beijingIso(),
    baseDate,
    dueDate,
    review: null,
  });
  return p;
}

export const targetsOf = (p: Proposal): TargetFile => ({
  version: 1,
  mode: 'weight',
  targets: p.items
    .filter(i => (i.weight ?? 0) > 0)
    .map(i => ({ code: i.code, value: i.weight ?? 0 })),
});

async function load(d: AdviceDeps, id: number): Promise<Proposal> {
  const p = await repo.proposalById(d.db, id);
  if (!p) {
    throw new Error('没有提案 #' + id);
  }
  return p;
}

/** 调仓方案：按最新策略预检，生成调仓计划（批量操作卡的内容）。 */
async function draftFor(d: AdviceDeps, p: Proposal): Promise<Rebalance> {
  if (p.accountId !== d.sim.accountId) {
    throw new Error('账户已经重置，这个提案不能在新账户执行');
  }
  const strategy = (await strategies(d.db))[0];
  if (!strategy) {
    throw new Error(
      '先在「组合与调仓」里建立策略，调仓方案按策略的补单规则执行',
    );
  }
  const service = new PortfolioService(d.db, d.sim, d.client);
  const targets = targetsOf(p);
  const plan = await service.preview(targets);
  return service.draft(strategy, targets, plan, {
    proposalId: p.id,
    thesis: 'AI 提案 #' + p.id + '：' + p.thesis,
  });
}

/** 批准 / 拒绝。批准调仓方案时同时生成调仓计划；预检失败（缺行情等）时提案保持待定，返回原因。 */
export async function decideProposal(
  d: AdviceDeps,
  id: number,
  approve: boolean,
): Promise<Proposal> {
  const p = await load(d, id);
  if (p.status !== 'proposed') {
    return p;
  }
  if (approve && p.kind === 'rebalance') {
    const r = await draftFor(d, p);
    p.rebalanceId = r.id;
  }
  p.status = approve ? 'approved' : 'rejected';
  p.decidedAt = beijingIso();
  await repo.saveProposal(d.db, p);
  await data.logActivity(d.db, {
    accountId: d.sim.accountId,
    tradeDate: d.sim.engine.state.date,
    ts: p.decidedAt,
    kind: 'ai',
    text: (approve ? '批准' : '拒绝') + ' AI 提案 #' + p.id,
    ref: { proposal: p.id },
  });
  return p;
}

/** 调仓计划过时（行情或持仓变了）时重新预检：丢掉旧草稿，换一份新的。 */
export async function replanProposal(
  d: AdviceDeps,
  id: number,
): Promise<Proposal> {
  const p = await load(d, id);
  if (p.kind !== 'rebalance' || p.status !== 'approved') {
    throw new Error('只有已批准、还没执行的调仓方案可以重新预检');
  }
  const service = new PortfolioService(d.db, d.sim, d.client);
  if (p.rebalanceId != null) {
    await service.discardDraft(p.rebalanceId);
  }
  p.rebalanceId = (await draftFor(d, p)).id;
  await repo.saveProposal(d.db, p);
  return p;
}

/** 批量操作卡「执行」：一次确认提交整份调仓计划（M5 同一套校验，执行时再校验一遍）。 */
export async function executeProposal(
  d: AdviceDeps,
  id: number,
  mode: 'together' | 'sellFirst',
): Promise<Proposal> {
  const p = await load(d, id);
  if (
    p.kind !== 'rebalance' ||
    p.status !== 'approved' ||
    p.rebalanceId == null
  ) {
    throw new Error('先批准这个调仓方案');
  }
  if (p.accountId !== d.sim.accountId) {
    throw new Error('账户已经重置，这张卡失效了');
  }
  const service = new PortfolioService(d.db, d.sim, d.client);
  const r = await service.execute(p.rebalanceId, mode);
  p.status = 'executed';
  p.executedAt = beijingIso();
  await repo.saveProposal(d.db, p);
  await data.logActivity(d.db, {
    accountId: d.sim.accountId,
    tradeDate: d.sim.engine.state.date,
    ts: p.executedAt,
    kind: 'ai',
    text:
      'AI 代操作：执行调仓提案 #' +
      p.id +
      '，提交 ' +
      r.orderIds.length +
      ' 笔委托' +
      (mode === 'sellFirst' ? '（先卖后买）' : ''),
    ref: { proposal: p.id, rebalanceId: r.id },
  });
  return p;
}

/** 单只建议批准后你自己下单（或让 AI 生成下单卡）；这里只在对应委托提交后标记已执行。 */
export async function markExecuted(d: AdviceDeps, id: number): Promise<void> {
  const p = await load(d, id);
  if (p.status === 'approved') {
    p.status = 'executed';
    p.executedAt = beijingIso();
    await repo.saveProposal(d.db, p);
  }
}

export async function rebalanceOf(
  d: AdviceDeps,
  p: Proposal,
): Promise<Rebalance | null> {
  if (p.rebalanceId == null || p.accountId !== d.sim.accountId) {
    return null;
  }
  return loadRebalance(d.db, p.rebalanceId, p.accountId).catch(() => null);
}

// ---------- 决策日志 ----------

export async function writeJournal(
  d: AdviceDeps,
  input: JournalInput,
): Promise<JournalEntry> {
  if (!input.thesis.trim()) {
    throw new Error('要写理由');
  }
  if (!(input.horizonDays >= 1 && input.horizonDays <= 250)) {
    throw new Error('期限要在 1–250 个交易日之间');
  }
  const now = d.sim.now();
  return repo.addJournal(d.db, {
    ...input,
    thesis: input.thesis.trim(),
    expectation: input.expectation.trim(),
    invalidation: input.invalidation.trim(),
    accountId: d.sim.accountId,
    createdAt: beijingIso(),
    ...datesOf(d.sim.calendar, now.date, input.horizonDays),
  });
}

// ---------- 到期对账 ----------

/** 把已到期、还没对账的提案和日志对一遍账。返回这次对账了几条。 */
export async function refreshReviews(d: AdviceDeps): Promise<number> {
  const now = d.sim.now();
  const props = (await repo.proposals(d.db, 1000)).filter(
    p => !p.review && isDue(p.dueDate, now),
  );
  const notes = (await repo.journal(d.db, { limit: 1000 })).filter(
    e => !e.review && isDue(e.dueDate, now),
  );
  if (!props.length && !notes.length) {
    return 0;
  }
  const want = new Map<string, { from: string; to: string }>();
  const need = (code: string, from: string, to: string) => {
    const w = want.get(code);
    want.set(code, {
      from: w && w.from < from ? w.from : from,
      to: w && w.to > to ? w.to : to,
    });
  };
  for (const p of props) {
    for (const c of [...p.items.map(i => i.code), p.benchmark]) {
      need(c, p.baseDate, p.dueDate);
    }
  }
  for (const e of notes) {
    need(e.code, e.baseDate, e.dueDate);
    need(e.benchmark, e.baseDate, e.dueDate);
  }
  const bars = new Map<string, KBar[] | string>();
  for (const [code, w] of want) {
    try {
      bars.set(
        code,
        await d.client.klineRange(
          code,
          d.sim.info(code)?.type ?? d.sim.security(code)?.type ?? '',
          // 起点那天停牌时用之前最近的一根收盘，所以多取两周
          addDays(w.from, -14),
          w.to,
          'qfq',
        ),
      );
    } catch (e) {
      bars.set(code, '取 ' + code + ' 日线失败：' + String(e));
    }
  }
  const series = (code: string): KBar[] | string => bars.get(code) ?? [];
  let n = 0;
  const at = beijingIso();
  for (const p of props) {
    const failed = [...p.items.map(i => i.code), p.benchmark]
      .map(series)
      .find(s => typeof s === 'string');
    const dir =
      p.kind === 'rebalance' ? 1 : STANCE_DIR[p.items[0]?.stance ?? 'watch'];
    const r =
      typeof failed === 'string'
        ? failed
        : reviewOf({
            legs: p.items.map(i => ({
              code: i.code,
              weight: p.kind === 'rebalance' ? i.weight ?? 0 : null,
              bars: series(i.code) as KBar[],
            })),
            dir,
            benchmark: series(p.benchmark) as KBar[],
            baseDate: p.baseDate,
            dueDate: p.dueDate,
            at,
          });
    if (typeof r === 'string') {
      p.reviewError = r;
    } else {
      p.review = r;
      delete p.reviewError;
      n++;
    }
    await repo.saveProposal(d.db, p);
  }
  for (const e of notes) {
    const failed = [e.code, e.benchmark]
      .map(series)
      .find(s => typeof s === 'string');
    const r =
      typeof failed === 'string'
        ? failed
        : reviewOf({
            legs: [
              { code: e.code, weight: null, bars: series(e.code) as KBar[] },
            ],
            dir: e.side === 'B' ? 1 : -1,
            benchmark: series(e.benchmark) as KBar[],
            baseDate: e.baseDate,
            dueDate: e.dueDate,
            at,
          });
    if (typeof r === 'string') {
      e.reviewError = r;
    } else {
      e.review = r;
      delete e.reviewError;
      n++;
    }
    await repo.saveJournal(d.db, e);
  }
  return n;
}

/** 记分卡：AI 的提案和你自己的决策分开统计（AI 提案生成的调仓日志算在提案里，不重复算）。 */
export async function scorecard(db: Db): Promise<Scorecard> {
  const props = await repo.proposals(db, 1000);
  const notes = (await repo.journal(db, { limit: 1000 })).filter(
    e => e.source === 'user',
  );
  return {
    ai: scoreLine(
      props.map(p => ({
        review: p.review,
        dueDate: p.dueDate,
        watch: p.kind === 'single' && p.items[0]?.stance === 'watch',
      })),
    ),
    user: scoreLine(
      notes.map(e => ({ review: e.review, dueDate: e.dueDate, watch: false })),
    ),
  };
}
