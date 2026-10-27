/**
 * 请求里的文字部分（AI_ASSISTANT.md §1）：固定系统提示、记忆快照和摘要、每次提问附带的上下文。
 * 固定系统提示里没有任何会变的东西（日期、行情、页面都在最后一条用户消息里），所有对话共用一份缓存。
 */
import type { Activity } from '../data/repos';
import {
  formatPageContext,
  formatRecentActions,
  type PageContext,
} from './context';
import { MEMORY_KIND_NAME, type Memory, type Price, type Usage } from './types';

export const SYSTEM_PROMPT = `你是 AShareSim 里的 AI 助手。AShareSim 是一个 A 股模拟炒股 App：行情、交易规则、税费都是真实的，只有入金是模拟的。用户用它学习 A 股规则和税费，并为以后做个人量化打基础；用户从没炒过股，是后端工程师。

## 怎么回答
- 用中文。先给结论，再讲原因；讲术语从原理讲起，配一个具体的数字例子。
- 数字（行情、K 线、财务、持仓、委托、成交、交割单、费率）一律调用工具现查，不凭记忆、不编造，并说明来自哪里。用户消息里的 <page_context>（用户正在看的页面）和 <recent_actions>（最近操作）只是线索，具体数字以工具结果为准。
- 单位：价格和金额用元，数量用股或份，比例用 %。
- 讲交易规则时引用规则课，写成链接：[规则课·交易费用](lesson:fee)。课的 id：time 交易时间与集合竞价、t1 T+1、limit 涨跌停、cage 价格笼子、unit 申报单位与零股、fee 交易费用、div 红利税、exright 除权除息、st ST 与退市、ipo 新股前 5 日、boards 各板块差异、kinds 委托类型。提到证券时可以写成 [招商银行](stock:sh600036)。
- 可以用加粗、列表和简单表格；回答要短，用户想深入再展开。
- 每个回答最后单独一行写：仅供学习，不构成投资建议。

## 不做
- 不荐股：不说该买什么、卖什么、在什么价位进出、仓位多少，不预测涨跌，不评价哪只是「好股票」。用户问「能不能买」时，讲清楚该看哪些数据和规则，让用户自己判断。

## 操作 App
- navigate 打开页面并可以把表单填好，直接执行（回答结束后跳转）。
- place_order、cancel_order、transfer、set_watchlist、set_fee_profile、set_settings、set_learn_check、reset_account 只生成操作卡，用户点「执行」才生效。卡片会显示 App 用交易引擎做的预校验结果。
- 只做用户明确要求的操作。代码、方向、价格、数量、金额都必须是用户说出来的；没说清楚就先问，不替用户选，也不主动提议操作。
- 生成操作卡后只能说「确认后会……」，不能说「已经下单 / 已经转账」。执行结果会在用户下一次提问的 <action_results> 里告诉你。
- 小测和集合竞价演示要用户自己做，不能替用户答。

## 记忆
- 用户说出值得长期记住的背景、偏好、计划、约定时调用 remember；新说法和旧记忆矛盾时先 forget 再 remember。
- 不记 App 里有最新值的东西：持仓、成交、委托、资金、费率、行情。例如用户说「我的佣金是万 1 免五」，不要记，而是建议在费率设置里改或用交割单校准（也可以用 set_fee_profile 生成操作卡）。
- <memory> 是这个对话开始时的记忆快照；对话中途新记的以工具结果为准。
- 用户问以前聊过什么时，用 search_conversations。<conversation_summary> 是本对话较早部分的摘要。`;

/** 断点 2：记忆快照 + 对话摘要。没有内容时也有固定文字（空文本块会被拒）。 */
export function contextBlock(memorySnapshot: string, summary: string): string {
  return (
    '<memory>\n' +
    (memorySnapshot || '（还没有记忆）') +
    '\n</memory>\n<conversation_summary>\n' +
    (summary || '（这个对话还没有压缩过）') +
    '\n</conversation_summary>'
  );
}

/** 记忆快照：一行一条，带 id（forget 用）和类别。 */
export function memorySnapshotOf(mems: Memory[]): string {
  return mems
    .map(m => '#' + m.id + ' [' + MEMORY_KIND_NAME[m.kind] + '] ' + m.text)
    .join('\n');
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

/** 「2026-10-27 周二 14:32（北京时间）· 交易日 · 连续竞价」。 */
export function nowLine(
  date: string,
  hm: string,
  tradingDay: boolean,
  phase: string,
): string {
  const [y, mo, d] = date.split('-').map(Number);
  const wd = WEEKDAY[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return (
    '<now>' +
    date +
    ' 周' +
    wd +
    ' ' +
    hm +
    '（北京时间）· ' +
    (tradingDay ? '交易日 · ' + phase : '休市') +
    '</now>'
  );
}

/** 每次提问附带的上下文（最后一条用户消息的第一块）。 */
export function turnContext(input: {
  now: string;
  page: PageContext | null;
  actions: Activity[] | null;
  actionResults: string[];
}): string {
  const out = [input.now];
  if (input.page) {
    out.push(formatPageContext(input.page));
  }
  if (input.actions && input.actions.length) {
    out.push(formatRecentActions(input.actions));
  }
  if (input.actionResults.length) {
    out.push(
      '<action_results>\n' +
        input.actionResults.join('\n') +
        '\n</action_results>',
    );
  }
  return out.join('\n');
}

// ---------- 估算 ----------

/**
 * 粗估 token 数：中文约 1 字 0.8 token，其他约 3.5 字符 1 token。只用于发送前的预估，
 * 真实用量以响应里的 usage 为准。
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) > 0x2e80) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.ceil(cjk * 0.8 + other / 3.5);
}

/** 按服务价格估算费用（美元）；withCache = false 时算「不用缓存要多少」。 */
export function costOf(u: Usage, p: Price, withCache = true): number {
  const inTokens = withCache ? u.input : u.input + u.cacheRead + u.cacheWrite;
  const usd =
    inTokens * p.input +
    (withCache ? u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite : 0) +
    u.output * p.output;
  // 价格是千分之一美元 / 百万 tokens
  return usd / 1000 / 1_000_000;
}

export function fmtUsd(v: number): string {
  return v < 0.01 ? '$' + v.toFixed(4) : '$' + v.toFixed(3);
}

export const addUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  output: a.output + b.output,
  cacheReported: a.cacheReported || b.cacheReported,
});

export const ZERO_USAGE: Usage = {
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  cacheReported: false,
};
