/**
 * 操作 App 的工具（AI_ASSISTANT.md §8「操作卡流程」）：
 * 1. 模型调用写工具 → 用引擎同一套校验预检查 → 生成操作卡，工具结果告诉模型「等待用户确认」；
 * 2. 用户点「执行」→ 重新解析参数、按执行时的状态再校验一遍、执行，记操作日志（kind ai，「AI 代操作」）；
 * 3. 执行结果在下一次提问时以 <action_results> 告诉模型。
 *
 * 卡片只存在消息的界面数据里，不改发给模型的历史（不影响缓存）。
 */
import type { AppCore } from '../../app/boot';
import { toggleCheck, useLearn } from '../../app/learn';
import { updateRefreshSettings } from '../../app/settings';
import * as repo from '../../data/repos';
import { isLive } from '../../engine/account';
import { ruleOf } from '../../engine/securities';
import { phaseAt } from '../../engine/session';
import { KIND_NAME, type OrderKind } from '../../engine/types';
import {
  formatFen,
  formatPrice,
  yuanToFen,
  yuanToLi,
} from '../../engine/units';
import type { OrderRequest } from '../../engine/validate';
import {
  checkRisk,
  invalidRisk,
  riskOf,
  riskText,
  type RiskLimits,
} from '../../engine/risk';
import { itemById } from '../../learn/roadmap';
import { beijingIso } from '../../market/clock';
import { feeDiff, formOf as feeFormOf, parseFeeForm } from '../../sim/feeForm';
import { cancelState, estimate, sendText } from '../../sim/orderForm';
import {
  BACKGROUND_MS_OPTIONS,
  checkDepositCap,
  SNAPSHOT_KEEP_OPTIONS,
} from '../../sim/settings';
import { BACKGROUND_MODE_NAME, keepName, msName } from '../../sim/settings';
import type { BackgroundMode } from '../../sim/refresher';
import {
  COST_BASIS_NAME,
  prefs,
  usePrefs,
  type CostBasis,
} from '../../ui/prefs';
import { watch } from '../../ui/watchStore';
import type { ActionCard } from '../types';
import { freshQuote, resolveCode, securityOf } from './read';

type Args = Record<string, unknown>;

/** 生成卡片需要的东西（编号、账户由调用方填）。 */
export type CardDraft = Omit<
  ActionCard,
  'no' | 'accountId' | 'status' | 'tool' | 'args'
>;

const KINDS: OrderKind[] = [
  'limit',
  'b5_ioc',
  'b5_limit',
  'cbest',
  'obest',
  'ioc',
  'fok',
  'after',
];

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
    ? Number(v)
    : null;

const fail = (title: string, text: string): CardDraft => ({
  title,
  rows: [],
  check: { ok: false, text },
});

// ---------- 下单 ----------

interface OrderPlan {
  req: OrderRequest;
  draft: CardDraft;
}

async function planOrder(
  core: AppCore,
  a: Args,
): Promise<OrderPlan | CardDraft> {
  const side = a.side === 'S' ? 'S' : a.side === 'B' ? 'B' : null;
  const title0 = side === 'S' ? '卖出' : '买入';
  if (!side) {
    return fail('下单', '方向要写 B（买入）或 S（卖出）');
  }
  const r = await resolveCode(core, a.code);
  if (!r) {
    return fail(title0, '找不到证券「' + String(a.code ?? '') + '」');
  }
  const q = await freshQuote(core, r.code).catch(() => null);
  const sec = securityOf(core, {
    ...r,
    name: q?.info.name ?? r.name,
    type: q?.info.type ?? r.type,
  });
  if (!sec) {
    return fail(
      title0 + ' ' + r.name,
      r.name + '（' + r.code + '）不能交易（指数或不支持的品种）',
    );
  }
  const kind = (
    KINDS.includes(a.kind as OrderKind) ? a.kind : 'limit'
  ) as OrderKind;
  const d = ruleOf(sec).decimals;
  const price = num(a.price);
  const protect = num(a.protect);
  const qty = num(a.qty);
  const req: OrderRequest = {
    code: sec.code,
    side,
    kind,
    price: kind === 'limit' && price != null ? yuanToLi(price) : null,
    protect:
      kind !== 'limit' && kind !== 'after' && protect != null
        ? yuanToLi(protect)
        : null,
    qty: qty != null && qty > 0 ? Math.round(qty) : 0,
  };
  const sim = core.sim;
  const snap = q?.snapshot ?? sim.engine.snapshot(sec.code);
  const check = sim.checkOrder(req);
  const risk = checkRisk({
    state: sim.engine.state,
    sec,
    req,
    date: sim.now().date,
    snap,
    priceOf: c => sim.engine.lastPrice(c),
  });
  const est = estimate(req, sec, snap, sim.engine.state.fee);
  const now = sim.now();
  const tradingDay = sim.calendar.isTradingDay(now.date);
  const unit = sec.board === 'etf' ? '份' : '股';
  const title = (side === 'B' ? '买入 ' : '卖出 ') + sec.name;
  return {
    req,
    draft: {
      title,
      rows: [
        { k: '证券', v: sec.name + ' ' + sec.code.slice(2) },
        { k: '委托类型', v: KIND_NAME[kind] },
        {
          k: '价格',
          v:
            kind === 'limit'
              ? req.price != null
                ? formatPrice(req.price, d)
                : '（没填）'
              : kind === 'after'
              ? '当日收盘价'
              : '市价' +
                (req.protect != null
                  ? '（保护限价 ' + formatPrice(req.protect, d) + '）'
                  : ''),
        },
        { k: '数量', v: req.qty.toLocaleString('zh-CN') + ' ' + unit },
        { k: '预估金额', v: formatFen(est.amount) + ' 元' },
        { k: '预估费用', v: formatFen(est.fee.total) + ' 元' },
        ...(side === 'B'
          ? [{ k: '冻结资金', v: formatFen(est.freeze) + ' 元' }]
          : []),
        { k: '风险校验', v: (risk.ok ? '' : '不通过：') + risk.text },
      ],
      check: check.ok
        ? { ok: true, text: '校验通过（和下单页同一套规则）' }
        : {
            ok: false,
            text:
              (check.level === 'block' ? '不能提交（' : '提交后会成为废单（') +
              check.rule +
              '）：' +
              check.msg,
            lesson: check.lesson,
          },
      note: sendText(
        check.route,
        tradingDay ? phaseAt(now.t) : 'closed',
        tradingDay,
      ),
    },
  };
}

// ---------- 其他操作 ----------

function planCancel(core: AppCore, a: Args): CardDraft {
  const id = num(a.order_id);
  const st = core.sim.engine.state;
  const o = st.orders.find(x => x.id === id);
  if (!o) {
    return fail('撤单', '找不到委托 id ' + String(a.order_id));
  }
  const sec = core.sim.security(o.code);
  const name = sec?.name ?? o.code;
  const d = sec ? ruleOf(sec).decimals : 2;
  const now = core.sim.now();
  const tradingDay = core.sim.calendar.isTradingDay(now.date);
  const c = cancelState(
    o.status,
    tradingDay ? phaseAt(now.t) : 'closed',
    tradingDay,
  );
  return {
    title: '撤单 · ' + (o.side === 'B' ? '买入 ' : '卖出 ') + name,
    rows: [
      { k: '合同号', v: o.no },
      {
        k: '委托',
        v:
          o.qty.toLocaleString('zh-CN') +
          (o.price != null
            ? ' @' + formatPrice(o.price, d)
            : ' ' + KIND_NAME[o.kind]),
      },
      { k: '状态', v: o.status + (o.filled ? '，已成交 ' + o.filled : '') },
    ],
    check: !isLive(o)
      ? { ok: false, text: '这笔委托已经' + o.status + '，不用撤' }
      : c.ok
      ? { ok: true, text: '现在可以撤单' }
      : { ok: false, text: '现在不能撤：' + c.why, lesson: 'time' },
  };
}

function planTransfer(
  core: AppCore,
  a: Args,
): { dir: 'in' | 'out'; fen: number; draft: CardDraft } | CardDraft {
  const dir =
    a.direction === 'out' ? 'out' : a.direction === 'in' ? 'in' : null;
  const amount = num(a.amount);
  if (!dir || amount == null || amount <= 0) {
    return fail('银证转账', '要写方向（in 转入 / out 转出）和金额（元）');
  }
  const fen = yuanToFen(amount);
  const c = core.sim.checkTransfer(dir, fen);
  return {
    dir,
    fen,
    draft: {
      title: dir === 'in' ? '银行转证券（模拟入金）' : '证券转银行',
      rows: [{ k: '金额', v: formatFen(fen) + ' 元' }],
      check: c.ok ? { ok: true, text: '可以转账' } : { ok: false, text: c.msg },
    },
  };
}

async function planWatch(core: AppCore, a: Args) {
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const add: { code: string; name: string }[] = [];
  const remove: { code: string; name: string }[] = [];
  const bad: string[] = [];
  for (const x of list(a.add)) {
    const r = await resolveCode(core, x);
    r ? add.push(r) : bad.push(String(x));
  }
  for (const x of list(a.remove)) {
    const r = await resolveCode(core, x);
    r ? remove.push(r) : bad.push(String(x));
  }
  const rows = [
    ...(add.length ? [{ k: '加入', v: add.map(x => x.name).join('、') }] : []),
    ...(remove.length
      ? [{ k: '移出', v: remove.map(x => x.name).join('、') }]
      : []),
  ];
  return {
    add,
    remove,
    draft: {
      title: '修改自选',
      rows,
      check: bad.length
        ? { ok: false, text: '找不到：' + bad.join('、') }
        : rows.length
        ? { ok: true, text: '可以修改' }
        : { ok: false, text: '没有要改的' },
    } as CardDraft,
  };
}

function planFee(core: AppCore, a: Args) {
  const cur = core.sim.engine.state.fee;
  const f = feeFormOf(cur);
  const set = (
    k: 'stockWan' | 'stockMin' | 'etfWan' | 'etfMin',
    v: unknown,
  ) => {
    const n = num(v);
    if (n != null) {
      f[k] = String(n);
    }
  };
  set('stockWan', a.stock_rate);
  set('stockMin', a.stock_min);
  set('etfWan', a.etf_rate);
  set('etfMin', a.etf_min);
  if (typeof a.regs_separate === 'boolean') {
    f.regsSeparate = a.regs_separate;
  }
  if (typeof a.merge_order === 'boolean') {
    f.mergeOrder = a.merge_order;
  }
  const p = parseFeeForm(f, cur);
  if (!p.ok) {
    return {
      profile: null,
      draft: fail('修改费率', p.errors.map(e => e.msg).join('；')),
    };
  }
  const diff = feeDiff(cur, p.profile);
  return {
    profile: p.profile,
    draft: {
      title: '修改费率',
      rows: diff.map((t, i) => ({ k: '改动 ' + (i + 1), v: t })),
      check: diff.length
        ? { ok: true, text: '可以保存' }
        : { ok: false, text: '和现在的费率一样，不用改' },
      note: '只对之后提交的委托生效；已有委托按提交时的费率算。手动改佣金会清掉「已校准」。',
    } as CardDraft,
  };
}

interface SettingsPlan {
  costBasis?: CostBasis;
  refresh: {
    backgroundMode?: BackgroundMode;
    backgroundMs?: number;
    snapshotKeepDays?: number;
  };
  depositCap?: number;
  risk?: RiskLimits;
}

function planSettings(
  core: AppCore,
  a: Args,
): { plan: SettingsPlan; draft: CardDraft } {
  const plan: SettingsPlan = { refresh: {} };
  const rows: { k: string; v: string }[] = [];
  const errs: string[] = [];
  const rs = core.refresher.settings;
  if (a.cost_basis != null) {
    if (a.cost_basis === 'diluted' || a.cost_basis === 'average') {
      plan.costBasis = a.cost_basis;
      rows.push({
        k: '持仓成本口径',
        v:
          COST_BASIS_NAME[usePrefs.getState().costBasis] +
          ' → ' +
          COST_BASIS_NAME[a.cost_basis],
      });
    } else {
      errs.push('成本口径只能是 diluted 或 average');
    }
  }
  if (a.background_mode != null) {
    const m = a.background_mode as BackgroundMode;
    if (m in BACKGROUND_MODE_NAME) {
      plan.refresh.backgroundMode = m;
      rows.push({
        k: '后台跟踪',
        v:
          BACKGROUND_MODE_NAME[rs.backgroundMode] +
          ' → ' +
          BACKGROUND_MODE_NAME[m],
      });
    } else {
      errs.push('后台跟踪只能是 orders / session / off');
    }
  }
  if (a.background_interval != null) {
    const ms = (num(a.background_interval) ?? 0) * 1000;
    if (BACKGROUND_MS_OPTIONS.some(o => o[0] === ms)) {
      plan.refresh.backgroundMs = ms;
      rows.push({
        k: '后台刷新间隔',
        v: msName(rs.backgroundMs) + ' → ' + msName(ms),
      });
    } else {
      errs.push('后台刷新间隔只能是 3 / 5 / 10 / 30 秒');
    }
  }
  if (a.snapshot_keep != null) {
    const days = num(a.snapshot_keep);
    if (days != null && SNAPSHOT_KEEP_OPTIONS.some(o => o[0] === days)) {
      plan.refresh.snapshotKeepDays = days;
      rows.push({
        k: '快照保留',
        v: keepName(rs.snapshotKeepDays) + ' → ' + keepName(days),
      });
    } else {
      errs.push('快照保留只能是 20 / 60 个交易日或 0（永久）');
    }
  }
  if (a.deposit_cap != null) {
    const st = core.sim.engine.state;
    const c = checkDepositCap(
      String(num(a.deposit_cap) ?? a.deposit_cap),
      st.depositTotal,
    );
    if (c.ok) {
      plan.depositCap = c.fen;
      rows.push({
        k: '累计净入金上限',
        v: formatFen(st.depositCap) + ' → ' + formatFen(c.fen) + ' 元',
      });
    } else {
      errs.push(c.msg);
    }
  }
  if (
    a.risk_max_weight != null ||
    a.risk_max_turnover != null ||
    a.risk_no_st != null
  ) {
    const cur = riskOf(core.sim.engine.state);
    const next = { ...cur };
    const pctOf = (v: unknown, what: string) => {
      const n = num(v);
      if (n == null || n < 0) {
        errs.push(what + '要写百分数（0 = 不限）');
        return undefined;
      }
      return n === 0 ? null : n / 100;
    };
    if (a.risk_max_weight != null) {
      const v = pctOf(a.risk_max_weight, '单票上限');
      if (v !== undefined) {
        next.maxWeight = v;
      }
    }
    if (a.risk_max_turnover != null) {
      const v = pctOf(a.risk_max_turnover, '单日换手上限');
      if (v !== undefined) {
        next.maxTurnover = v;
      }
    }
    if (typeof a.risk_no_st === 'boolean') {
      next.noSt = a.risk_no_st;
    }
    const bad = invalidRisk(next);
    if (bad) {
      errs.push(bad);
    } else if (riskText(next) !== riskText(cur)) {
      plan.risk = next;
      rows.push({
        k: '风险限额',
        v: riskText(cur) + ' → ' + riskText(next),
      });
    }
  }
  return {
    plan,
    draft: {
      title: '修改设置',
      rows,
      check: errs.length
        ? { ok: false, text: errs.join('；') }
        : rows.length
        ? { ok: true, text: '可以保存' }
        : { ok: false, text: '没有要改的' },
    },
  };
}

function planLearn(a: Args): CardDraft {
  const item = itemById(String(a.item_id ?? ''));
  if (!item) {
    return fail('学习进度', '路线图里没有 ' + String(a.item_id));
  }
  const done = !!useLearn.getState().checks[item.id];
  const want = a.done !== false;
  return {
    title: want ? '勾选学习项' : '取消勾选学习项',
    rows: [{ k: '项', v: item.text }],
    check: item.auto
      ? { ok: false, text: '这一项由 App 根据你的操作自动判断，不能手动改' }
      : done === want
      ? { ok: false, text: want ? '已经勾上了' : '本来就没勾' }
      : { ok: true, text: '可以修改' },
  };
}

const RESET_DRAFT: CardDraft = {
  title: '重置模拟账户',
  rows: [
    {
      k: '归档',
      v: '当前账户的资金、持仓、委托、交割单、操作日志（只读，可导出）',
    },
    { k: '新账户', v: '从 0 元开始，沿用当前费率和入金上限' },
    { k: '保留', v: '自选、设置、快照、学习进度、AI 对话和记忆' },
  ],
  check: { ok: true, text: '可以重置；未完成的委托随旧账户归档，不再撮合' },
};

/** 生成操作卡（预校验）。 */
export async function previewCard(
  core: AppCore,
  tool: string,
  a: Args,
): Promise<CardDraft> {
  switch (tool) {
    case 'place_order': {
      const p = await planOrder(core, a);
      return 'req' in p ? p.draft : p;
    }
    case 'cancel_order':
      return planCancel(core, a);
    case 'transfer': {
      const p = planTransfer(core, a);
      return 'draft' in p ? p.draft : p;
    }
    case 'set_watchlist':
      return (await planWatch(core, a)).draft;
    case 'set_fee_profile':
      return planFee(core, a).draft;
    case 'set_settings':
      return planSettings(core, a).draft;
    case 'set_learn_check':
      return planLearn(a);
    case 'reset_account':
      return RESET_DRAFT;
  }
  return fail(tool, '不认识的操作');
}

async function logAi(
  core: AppCore,
  text: string,
  ref: Record<string, unknown>,
) {
  await repo.logActivity(core.db, {
    accountId: core.sim.accountId,
    tradeDate: core.sim.engine.state.date,
    ts: beijingIso(),
    kind: 'ai',
    text: 'AI 代操作：' + text,
    ref,
  });
}

/**
 * 用户点「执行」：按现在的状态重新校验并执行。返回结果（成功 / 失败），一句话。
 * 校验不通过时也会执行一遍下单（引擎拦下的会记进操作日志），和下单页一致。
 */
export async function executeCard(
  core: AppCore,
  card: ActionCard,
): Promise<{ ok: boolean; result: string }> {
  if (card.accountId !== core.sim.accountId) {
    return { ok: false, result: '账户已经重置，这张卡失效了' };
  }
  const a = card.args;
  let out: { ok: boolean; result: string };
  switch (card.tool) {
    case 'place_order': {
      const p = await planOrder(core, a);
      if (!('req' in p)) {
        out = { ok: false, result: p.check.text };
        break;
      }
      const r = await core.sim.placeOrder(p.req);
      core.refresher.kick();
      if (!r.ok) {
        out = { ok: false, result: '被拦下（' + r.rule + '）：' + r.msg };
      } else {
        const o = r.order;
        out = {
          ok: o.status !== '废单',
          result:
            o.status === '废单'
              ? '废单：' + o.reason
              : '已提交，合同号 ' + o.no + '，' + (o.note || o.status),
        };
      }
      break;
    }
    case 'cancel_order': {
      const r = await core.sim.cancelOrder(num(a.order_id) ?? -1);
      out = r.ok
        ? { ok: true, result: '已撤单' }
        : { ok: false, result: r.msg };
      break;
    }
    case 'transfer': {
      const p = planTransfer(core, a);
      if (!('draft' in p)) {
        out = { ok: false, result: p.check.text };
        break;
      }
      const r = await core.sim.transfer(p.dir, p.fen);
      out = r.ok
        ? {
            ok: true,
            result:
              (p.dir === 'in' ? '已转入 ' : '已转出 ') +
              formatFen(p.fen) +
              ' 元',
          }
        : { ok: false, result: r.msg };
      break;
    }
    case 'set_watchlist': {
      const p = await planWatch(core, a);
      if (!p.draft.check.ok) {
        out = { ok: false, result: p.draft.check.text };
        break;
      }
      for (const x of p.add) {
        if (!watch.has(x.code)) {
          await watch.add(core, x.code, x.name);
        }
      }
      for (const x of p.remove) {
        if (watch.has(x.code)) {
          await watch.remove(core, x.code, x.name);
        }
      }
      out = { ok: true, result: '自选已更新' };
      break;
    }
    case 'set_fee_profile': {
      const p = planFee(core, a);
      if (!p.profile || !p.draft.check.ok) {
        out = { ok: false, result: p.draft.check.text };
        break;
      }
      const diff = await core.sim.setFeeProfile(
        p.profile,
        'AI 代操作：修改费率',
      );
      out = { ok: true, result: '费率已保存：' + diff.join('，') };
      break;
    }
    case 'set_settings': {
      const p = planSettings(core, a);
      if (!p.draft.check.ok) {
        out = { ok: false, result: p.draft.check.text };
        break;
      }
      if (p.plan.costBasis) {
        await prefs.setCostBasis(core, p.plan.costBasis);
      }
      if (Object.keys(p.plan.refresh).length) {
        await updateRefreshSettings(core, p.plan.refresh);
      }
      if (p.plan.depositCap != null) {
        await core.sim.setDepositCap(p.plan.depositCap);
      }
      if (p.plan.risk) {
        await core.sim.setRiskLimits(p.plan.risk);
      }
      out = {
        ok: true,
        result:
          '设置已保存：' + p.draft.rows.map(r => r.k + ' ' + r.v).join('；'),
      };
      break;
    }
    case 'set_learn_check': {
      const d = planLearn(a);
      if (!d.check.ok) {
        out = { ok: false, result: d.check.text };
        break;
      }
      await toggleCheck(core, String(a.item_id));
      out = {
        ok: true,
        result: (a.done === false ? '已取消勾选：' : '已勾选：') + d.rows[0].v,
      };
      break;
    }
    case 'reset_account': {
      await core.sim.resetAccount();
      core.refresher.kick();
      out = { ok: true, result: '已重置：旧账户已归档，新账户从 0 元开始' };
      break;
    }
    default:
      out = { ok: false, result: '不认识的操作' };
  }
  // 重置账户后 accountId 已经是新账户：日志记在新账户上，「最近操作」能看到
  await logAi(core, card.title + ' → ' + out.result, {
    card: card.no,
    tool: card.tool,
    ok: out.ok,
  });
  return out;
}
