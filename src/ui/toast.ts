/**
 * 全局提示（Toast）：界面操作的结果，以及引擎事件（委托、成交、废单、撤单、补撮合说明、红利税……）。
 * 一次显示一条，排队；积压太多时后来的合并成「另有 N 条」。
 */
import { create } from 'zustand';

export type ToastTone = 'info' | 'up' | 'sell' | 'warn' | 'bad';

export interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
  /** 合并进来的条数。 */
  more: number;
}

interface ToastStore {
  queue: Toast[];
}

export const useToast = create<ToastStore>(() => ({ queue: [] }));

let seq = 1;
const MAX_QUEUE = 4;

export const toast = {
  show(text: string, tone: ToastTone = 'info'): void {
    useToast.setState(s => {
      if (s.queue.length < MAX_QUEUE) {
        return { queue: [...s.queue, { id: seq++, text, tone, more: 0 }] };
      }
      const last = s.queue[s.queue.length - 1];
      return {
        queue: [...s.queue.slice(0, -1), { ...last, more: last.more + 1 }],
      };
    });
  },
  dismiss(id: number): void {
    useToast.setState(s => ({ queue: s.queue.filter(t => t.id !== id) }));
  },
};
