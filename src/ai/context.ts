/**
 * 页面上下文（AI_ASSISTANT.md §2）：每个页面声明「用户此刻在屏幕上看到什么」，提问时附带给 AI。
 * M2 只有占位的 AI 页，用来在手机上核对每个页面给出的内容；M4 接模型时按 §1 的顺序拼进请求。
 */
import type { Activity } from '../data/repos';

export interface PageContext {
  /** 「个股 · 招商银行」「行情 · 创业板排行」 */
  name: string;
  /** 页面上看得到的关键数据，一行一条，带单位。 */
  lines: string[];
  /** 用户问「解释这个页面」时的要点。 */
  tip?: string;
}

interface Provider {
  route: string;
  get: () => PageContext;
}

let provider: Provider | null = null;

/** 页面获得焦点时登记；AI 页自己不登记，所以打开 AI 时拿到的是来源页面。 */
export function setPageContext(route: string, get: () => PageContext): void {
  provider = { route, get };
}

/** 每次提问重新计算，行情和表单都是最新值。 */
export function currentPageContext(): {
  route: string;
  ctx: PageContext;
} | null {
  if (!provider) {
    return null;
  }
  return { route: provider.route, ctx: provider.get() };
}

export function formatPageContext(ctx: PageContext): string {
  return [
    '<page_context>',
    '页面：' + ctx.name,
    ...ctx.lines.map(l => '- ' + l),
    ...(ctx.tip ? ['要点：' + ctx.tip] : []),
    '</page_context>',
  ].join('\n');
}

/** 最近操作，从早到晚。 */
export function formatRecentActions(acts: Activity[]): string {
  return [
    '<recent_actions>',
    ...[...acts]
      .reverse()
      .map(
        a =>
          a.ts.slice(5, 16).replace('T', ' ') + ' [' + a.kind + '] ' + a.text,
      ),
    '</recent_actions>',
  ].join('\n');
}
