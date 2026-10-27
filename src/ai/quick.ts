/**
 * 输入框上方的快捷问题（AI_ASSISTANT.md §3）：跟着最后一条非浏览操作和当前页面变。
 */
import type { Activity } from '../data/repos';
import type { PageContext } from './context';

export function quickQuestions(
  acts: Activity[],
  page: PageContext | null,
): string[] {
  const out: string[] = [];
  const last = acts.find(a => a.kind !== 'view');
  if (last) {
    if (last.kind === 'reject') {
      out.push(
        last.text.includes('废单')
          ? '刚才那笔为什么是废单？'
          : last.text.includes('转')
          ? '刚才为什么转不了账？'
          : '刚才为什么下不了单？',
      );
    } else if (last.kind === 'fill') {
      out.push('解释刚才这笔成交');
    } else if (last.kind === 'cancel') {
      out.push('刚才那笔为什么撤了？');
    } else if (last.kind === 'order') {
      out.push('刚才那笔委托什么时候能成交？');
    } else if (last.kind === 'learn' && last.text.includes('答错')) {
      out.push('我刚才那道题错在哪？');
    } else if (last.kind === 'system' && last.text.includes('红利税')) {
      out.push('为什么扣了红利税？');
    }
  }
  if (page) {
    out.push('解释这个页面');
    if (page.name.startsWith('个股')) {
      out.push('介绍一下这家公司', '最近走势怎么样？');
    } else if (/买入|卖出/.test(page.name)) {
      out.push('这笔要交多少费用？');
    } else if (page.name.includes('持仓')) {
      out.push('我的持仓盈亏是怎么算的？');
    } else if (page.name.includes('规则课')) {
      out.push('用例子再讲一遍');
    }
  }
  return [...new Set(out)].slice(0, 4);
}
