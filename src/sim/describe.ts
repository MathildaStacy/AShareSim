/**
 * 把引擎事件写成一句人话，存进操作日志（AI_ASSISTANT.md §3），界面也用它弹提示。
 */
import type { ActivityKind } from '../data/repos';
import { ruleOf, type Security } from '../engine/securities';
import { formatSec } from '../engine/session';
import { KIND_NAME, type EngineEvent, type Order } from '../engine/types';
import { formatFen, formatPrice } from '../engine/units';

export interface Described {
  kind: ActivityKind;
  text: string;
  ref: Record<string, unknown> | null;
}

type SecOf = (code: string) => Security | null;

export function orderHead(o: Order, sec: SecOf): string {
  const s = sec(o.code);
  const name = s?.name ?? o.code;
  const unit = s?.board === 'etf' ? '份' : '股';
  const price =
    o.price != null && s
      ? ' @' + formatPrice(o.price, ruleOf(s).decimals)
      : o.kind !== 'limit'
      ? ' ' + KIND_NAME[o.kind]
      : '';
  return (
    (o.side === 'B' ? '买入 ' : '卖出 ') +
    name +
    ' ' +
    o.qty.toLocaleString('zh-CN') +
    unit +
    price
  );
}

export function describeEvent(e: EngineEvent, sec: SecOf): Described | null {
  switch (e.type) {
    case 'order':
      return {
        kind: 'order',
        text:
          '委托' +
          orderHead(e.order, sec) +
          '（' +
          formatSec(e.order.t) +
          '，' +
          (e.order.note || e.order.status) +
          '）',
        ref: { order_id: e.order.id, order_no: e.order.no },
      };
    case 'reject':
      return {
        kind: 'reject',
        text: '委托' + orderHead(e.order, sec) + ' → 废单：' + e.order.reason,
        ref: { order_id: e.order.id, order_no: e.order.no },
      };
    case 'cancel':
      return {
        kind: 'cancel',
        text:
          (e.bySystem ? '系统撤单 ' : '撤单 ') +
          orderHead(e.order, sec) +
          (e.order.reason ? '：' + e.order.reason : ''),
        ref: { order_id: e.order.id, order_no: e.order.no },
      };
    case 'fill': {
      const s = sec(e.fill.code);
      const d = s ? ruleOf(s).decimals : 2;
      const unit = s?.board === 'etf' ? '份' : '股';
      return {
        kind: 'fill',
        text:
          '成交 ' +
          (e.fill.side === 'B' ? '买入 ' : '卖出 ') +
          (s?.name ?? e.fill.code) +
          ' ' +
          e.fill.qty.toLocaleString('zh-CN') +
          unit +
          ' @' +
          formatPrice(e.fill.price, d) +
          '（' +
          e.fill.basis.text +
          '）',
        ref: { order_id: e.order.id, fill_id: e.fill.id },
      };
    }
    case 'settle':
      return {
        kind: 'system',
        text:
          e.date +
          ' 日终清算' +
          (e.canceled ? '，撤销未成交委托 ' + e.canceled + ' 笔' : ''),
        ref: null,
      };
    case 'divTax':
      return {
        kind: 'system',
        text:
          '扣股息红利税补 ' +
          (sec(e.code)?.name ?? e.code) +
          ' ' +
          formatFen(e.amount) +
          ' 元',
        ref: { code: e.code },
      };
    case 'dividend':
      return {
        kind: 'system',
        text:
          '股息入账 ' +
          (sec(e.code)?.name ?? e.code) +
          ' ' +
          formatFen(e.amount) +
          ' 元',
        ref: { code: e.code },
      };
    case 'bonus':
      return {
        kind: 'system',
        text:
          '红股入账 ' +
          (sec(e.code)?.name ?? e.code) +
          ' ' +
          e.qty.toLocaleString('zh-CN') +
          ' 股',
        ref: { code: e.code },
      };
    case 'warning':
      return { kind: 'system', text: e.message, ref: null };
  }
}

/** 弹出提示用的短句和色调。委托、成交、废单、撤单、清算撤单、红利、补撮合说明都提示。 */
export function toastOf(
  e: EngineEvent,
  sec: SecOf,
): { text: string; tone: 'info' | 'up' | 'sell' | 'warn' | 'bad' } | null {
  switch (e.type) {
    case 'order':
      return {
        text:
          '委托已提交（合同号 ' +
          e.order.no +
          '）：' +
          orderHead(e.order, sec) +
          (e.order.note ? '，' + e.order.note : ''),
        tone: 'info',
      };
    case 'reject':
      return {
        text: '废单：' + orderHead(e.order, sec) + '。' + e.order.reason,
        tone: 'bad',
      };
    case 'cancel':
      return {
        text:
          (e.bySystem ? '系统撤单：' : '撤单成功：') +
          orderHead(e.order, sec) +
          (e.order.filled > 0
            ? '（已成交 ' + e.order.filled.toLocaleString('zh-CN') + '）'
            : '') +
          (e.bySystem && e.order.reason ? '。' + e.order.reason : ''),
        tone: e.bySystem ? 'warn' : 'info',
      };
    case 'fill': {
      const d = describeEvent(e, sec)!;
      return { text: d.text, tone: e.fill.side === 'B' ? 'up' : 'sell' };
    }
    case 'settle':
      return e.canceled
        ? {
            text: e.date + ' 日终清算：撤销未成交委托 ' + e.canceled + ' 笔',
            tone: 'warn',
          }
        : null;
    case 'warning':
      return { text: e.message, tone: 'warn' };
    default: {
      const d = describeEvent(e, sec);
      return d ? { text: d.text, tone: 'info' } : null;
    }
  }
}
