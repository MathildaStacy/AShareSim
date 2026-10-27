/**
 * 执行一次工具调用：读取类返回结果文本；记忆类按记忆模式写入或等你确认；navigate 记下回答结束后要打开的页面；
 * 写操作生成操作卡。每次调用都给界面一个标签（「读取 招商银行 近 60 根日 K」），回答里的数字都能追溯。
 */
import type { AppCore } from '../../app/boot';
import * as aiRepo from '../../data/aiRepo';
import { yuanToFen, yuanToLi } from '../../engine/units';
import { beijingIso } from '../../market/clock';
import { lessonById } from '../../learn/lessons';
import type { AiPrefs, MemoryKind, ToolUi } from '../types';
import { MEMORY_KIND_NAME } from '../types';
import { previewCard } from './actions';
import { CARD_TOOLS, NAV_ROUTES } from './defs';
import {
  activityText,
  conversationsText,
  feeProfileText,
  financeText,
  findLesson,
  freshQuote,
  klineText,
  learningText,
  lessonText,
  ordersText,
  positionsText,
  profileText,
  quoteText,
  resolveCode,
  ruleCardText,
  securityOf,
  tradesText,
} from './read';
import { LESSONS } from '../../learn/lessons';

export interface ToolEnv {
  core: AppCore;
  threadId: number;
  memoryMode: AiPrefs['memoryMode'];
  /** 下一张操作卡的编号。 */
  nextCardNo: () => number;
}

export interface ToolOutcome {
  output: string;
  ui: ToolUi;
}

const clampInt = (v: unknown, def: number, max: number) => {
  const n = typeof v === 'number' ? Math.round(v) : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
};

const KLINE_NAME: Record<string, string> = {
  day: '日 K',
  week: '周 K',
  month: '月 K',
  m15: '15 分钟 K',
  m30: '30 分钟 K',
  m60: '60 分钟 K',
  minute: '分时',
};

const MEMORY_KINDS: MemoryKind[] = [
  'background',
  'preference',
  'plan',
  'agreement',
];

export async function runTool(
  env: ToolEnv,
  id: string,
  name: string,
  argsJson: string,
): Promise<ToolOutcome> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson || '{}') ?? {};
  } catch {
    return {
      output: '参数不是合法的 JSON：' + argsJson.slice(0, 100),
      ui: { id, name, label: name + '：参数错误', error: true },
    };
  }
  try {
    return await dispatch(env, id, name, args);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      output: '工具执行出错：' + msg,
      ui: { id, name, label: name + ' 出错：' + msg, error: true },
    };
  }
}

async function needCode(env: ToolEnv, args: Record<string, unknown>) {
  const r = await resolveCode(env.core, args.code);
  if (!r) {
    throw new Error('找不到证券「' + String(args.code ?? '') + '」');
  }
  return r;
}

async function dispatch(
  env: ToolEnv,
  id: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const { core } = env;
  const ok = (output: string, label: string): ToolOutcome => ({
    output,
    ui: { id, name, label },
  });
  switch (name) {
    case 'get_quote': {
      const r = await needCode(env, args);
      const q = await freshQuote(core, r.code);
      if (!q) {
        throw new Error('没有拿到 ' + r.name + ' 的行情');
      }
      return ok(
        quoteText(
          q,
          securityOf(core, { ...r, name: q.info.name, type: q.info.type }),
        ),
        '读取 ' + q.info.name + ' 实时行情',
      );
    }
    case 'get_kline': {
      const r = await needCode(env, args);
      const period = String(args.period ?? 'day');
      if (!(period in KLINE_NAME)) {
        throw new Error('period 只能是 ' + Object.keys(KLINE_NAME).join(' / '));
      }
      const n = clampInt(args.n, 60, 300);
      return ok(
        await klineText(core, r, period, n),
        '读取 ' +
          r.name +
          (period === 'minute'
            ? ' 今日分时'
            : ' 近 ' + n + ' 根' + KLINE_NAME[period]),
      );
    }
    case 'get_company_profile': {
      const r = await needCode(env, args);
      return ok(
        await profileText(core, r),
        '读取 ' + r.name + ' 公司简况（东方财富）',
      );
    }
    case 'get_financials': {
      const r = await needCode(env, args);
      const n = clampInt(args.periods, 4, 8);
      return ok(
        await financeText(core, r, n),
        '读取 ' + r.name + ' 近 ' + n + ' 期财务指标（东方财富）',
      );
    }
    case 'get_positions':
      return ok(positionsText(core), '读取 账户和持仓');
    case 'get_orders': {
      const scope = ['today', 'live', 'all'].includes(String(args.scope))
        ? String(args.scope)
        : 'today';
      return ok(
        ordersText(core, scope, clampInt(args.n, 20, 100)),
        '读取 ' +
          (scope === 'live'
            ? '未完成委托'
            : scope === 'all'
            ? '全部委托'
            : '当日委托'),
      );
    }
    case 'get_trades': {
      const from = typeof args.from === 'string' ? args.from : undefined;
      const to = typeof args.to === 'string' ? args.to : undefined;
      return ok(
        tradesText(core, from, to),
        '读取 交割单' +
          (from || to
            ? '（' + (from ?? '') + '–' + (to ?? '') + '）'
            : '（最近 20 条）'),
      );
    }
    case 'get_fee_profile':
      return ok(feeProfileText(core), '读取 费率设置');
    case 'get_rule': {
      if (typeof args.code === 'string' && args.code.trim()) {
        const r = await needCode(env, args);
        return ok(await ruleCardText(core, r), '读取 ' + r.name + ' 规则卡');
      }
      if (typeof args.topic === 'string' && args.topic.trim()) {
        const l = findLesson(args.topic);
        if (!l) {
          return ok(
            '没有找到「' +
              args.topic +
              '」相关的规则课。规则课：' +
              LESSONS.map(x => x.id + ' ' + x.title).join('；'),
            '查找规则课「' + args.topic + '」',
          );
        }
        return ok(lessonText(l), '读取 规则课「' + l.title + '」');
      }
      return ok(
        '规则课：' +
          LESSONS.map(x => x.id + ' ' + x.title + '：' + x.summary).join('\n'),
        '读取 规则课列表',
      );
    }
    case 'get_learning':
      return ok(await learningText(core), '读取 学习进度');
    case 'get_activity': {
      const kinds = Array.isArray(args.kinds) ? args.kinds.map(String) : null;
      const n = clampInt(args.n, 20, 100);
      return ok(
        await activityText(core, n, kinds),
        '读取 最近 ' + n + ' 条操作记录',
      );
    }
    case 'search_conversations': {
      const q = String(args.query ?? '').trim();
      if (!q) {
        throw new Error('query 不能为空');
      }
      return ok(
        await conversationsText(core, q, env.threadId),
        '检索 其他对话「' + q + '」',
      );
    }
    case 'remember':
      return remember(env, id, args);
    case 'forget':
      return forget(env, id, args);
    case 'navigate':
      return navigate(env, id, args);
  }
  if (CARD_TOOLS.has(name)) {
    const draft = await previewCard(core, name, args);
    const no = env.nextCardNo();
    return {
      output:
        '已生成操作卡 #' +
        no +
        '「' +
        draft.title +
        '」，等待用户点「执行」确认；预校验：' +
        (draft.check.ok ? '通过' : '不通过：' + draft.check.text) +
        (draft.rows.length
          ? '。参数：' + draft.rows.map(r => r.k + ' ' + r.v).join('，')
          : ''),
      ui: {
        id,
        name,
        label: '操作卡 #' + no + ' ' + draft.title,
        card: {
          ...draft,
          no,
          tool: name,
          args,
          accountId: core.sim.accountId,
          status: 'pending',
        },
      },
    };
  }
  throw new Error('没有这个工具：' + name);
}

async function remember(
  env: ToolEnv,
  id: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const text = String(args.text ?? '').trim();
  const kind = (
    MEMORY_KINDS.includes(args.kind as MemoryKind) ? args.kind : 'background'
  ) as MemoryKind;
  if (!text) {
    throw new Error('text 不能为空');
  }
  if (env.memoryMode === 'off') {
    return {
      output: '记忆已关闭，没有记住',
      ui: { id, name: 'remember', label: '记忆已关闭，没有记住' },
    };
  }
  if (env.memoryMode === 'ask') {
    return {
      output: '已请用户确认要不要记住；用户确认前不要当作已经记住',
      ui: {
        id,
        name: 'remember',
        label: '要记住吗？',
        memory: {
          op: 'add',
          id: null,
          kind,
          text,
          status: 'pending',
          asked: true,
        },
      },
    };
  }
  const mid = await aiRepo.addMemory(
    env.core.db,
    { kind, text, sourceThreadId: env.threadId },
    beijingIso(),
  );
  return {
    output: '已记住（#' + mid + '，' + MEMORY_KIND_NAME[kind] + '）',
    ui: {
      id,
      name: 'remember',
      label: '已记住',
      memory: { op: 'add', id: mid, kind, text, status: 'done' },
    },
  };
}

async function forget(
  env: ToolEnv,
  id: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const mid = Number(args.id);
  const m = await aiRepo.memoryById(env.core.db, mid);
  if (!m) {
    throw new Error('没有 #' + args.id + ' 这条记忆');
  }
  if (env.memoryMode === 'off') {
    return {
      output: '记忆已关闭，没有删除',
      ui: { id, name: 'forget', label: '记忆已关闭，没有删除' },
    };
  }
  const change = {
    op: 'forget' as const,
    id: m.id,
    kind: m.kind,
    text: m.text,
  };
  if (env.memoryMode === 'ask') {
    return {
      output: '已请用户确认要不要删除 #' + m.id,
      ui: {
        id,
        name: 'forget',
        label: '要忘记吗？',
        memory: { ...change, status: 'pending', asked: true },
      },
    };
  }
  await aiRepo.deleteMemory(env.core.db, m.id);
  return {
    output: '已删除记忆 #' + m.id,
    ui: {
      id,
      name: 'forget',
      label: '已忘记',
      memory: { ...change, status: 'done' },
    },
  };
}

/** 模型给的参数 → 页面参数（元换成厘 / 分，代码补前缀）。 */
async function navigate(
  env: ToolEnv,
  id: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const route = String(args.route ?? '');
  const meta = NAV_ROUTES[route];
  if (!meta) {
    throw new Error('不能打开 ' + route);
  }
  const p = (args.params ?? {}) as Record<string, unknown>;
  const params: Record<string, unknown> = {};
  let label = meta.label;
  const code = async () => {
    const r = await needCode(env, p);
    params.code = r.code;
    params.name = r.name;
    label += ' · ' + r.name;
  };
  const n = (v: unknown) => (v == null || v === '' ? null : Number(v));
  switch (route) {
    case 'Stock':
    case 'Position':
      await code();
      break;
    case 'Order': {
      const side = ['B', 'S', 'C', 'P'].includes(String(p.side))
        ? String(p.side)
        : 'B';
      params.side = side;
      label =
        side === 'S'
          ? '卖出'
          : side === 'C'
          ? '撤单'
          : side === 'P'
          ? '持仓'
          : '买入';
      if (p.code) {
        await code();
      }
      const price = n(p.price);
      if (price != null && price > 0) {
        params.price = yuanToLi(price);
      }
      const qty = n(p.qty);
      if (qty != null && qty > 0) {
        params.qty = Math.round(qty);
      }
      if (typeof p.kind === 'string') {
        params.kind = p.kind;
      }
      break;
    }
    case 'Orders':
      if (['today', 'fills', 'hist', 'ledger'].includes(String(p.tab))) {
        params.tab = p.tab;
      }
      break;
    case 'OrderDetail':
    case 'FillDetail':
      params.id = Number(p.id);
      if (!Number.isFinite(params.id)) {
        throw new Error('要给 id');
      }
      break;
    case 'Transfer': {
      params.dir = p.dir === 'out' ? 'out' : 'in';
      const amount = n(p.amount);
      if (amount != null && amount > 0) {
        params.amount = yuanToFen(amount);
      }
      break;
    }
    case 'Stage': {
      const no = Number(p.no);
      if (![0, 1, 2, 3, 7].includes(no)) {
        throw new Error('阶段只有 0 / 1 / 2 / 3 / 7');
      }
      params.no = no;
      label += ' ' + no;
      break;
    }
    case 'Lesson': {
      const l = lessonById(String(p.id ?? ''));
      if (!l) {
        throw new Error('没有这一课：' + String(p.id));
      }
      params.id = l.id;
      label += '「' + l.title + '」';
      break;
    }
    case 'FeeCalc': {
      if (p.code) {
        await code();
      }
      const price = n(p.price);
      if (price != null && price > 0) {
        params.price = yuanToLi(price);
      }
      const qty = n(p.qty);
      if (qty != null && qty > 0) {
        params.qty = Math.round(qty);
      }
      break;
    }
  }
  return {
    output:
      '回答结束后会打开「' +
      label +
      '」' +
      (Object.keys(params).length ? '，表单已按参数填好（不会自动提交）' : ''),
    ui: {
      id,
      name: 'navigate',
      label: '打开 ' + label,
      nav: {
        route,
        params: Object.keys(params).length ? params : undefined,
        label,
      },
    },
  };
}
