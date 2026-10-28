/**
 * M6：把输入按顺序喂给引擎（实时账户的输入日志、回放练习的操作都走这里）。
 */
import { Engine, type EngineInput } from '../engine/engine';
import type { TradingCalendar } from '../engine/calendar';
import type { Security } from '../engine/securities';
import type { EngineEvent, Snapshot } from '../engine/types';

export interface RunnerDeps {
  calendar: TradingCalendar;
  security: (code: string) => Security | null;
}

/** 事件属于哪个交易日：和 Simulator 写 account_event 的口径一致。 */
export function eventDate(e: EngineEvent, fallback: string): string {
  return 'fill' in e
    ? e.fill.date
    : 'order' in e
    ? e.order.date
    : 'date' in e
    ? e.date
    : fallback;
}

const same = (a: Snapshot | null, b: Snapshot) =>
  !!a && JSON.stringify(a) === JSON.stringify(b);

/**
 * 喂一次输入，返回引擎事件。下单前先恢复下单那一刻引擎里这只证券的快照和竞价成交量基准：
 * 实时引擎在两边一样时是同一个状态，不一样（这只证券之前没有委托、快照没记下来）时以记录为准。
 */
export function applyInput(engine: Engine, input: EngineInput): EngineEvent[] {
  switch (input.kind) {
    case 'advance':
      return engine.advance(input.now);
    case 'place': {
      for (const s of [
        ...(input.held ?? []),
        ...(input.snap ? [input.snap] : []),
      ]) {
        if (!same(engine.snapshot(s.code), s)) {
          engine.primeSnapshot(s);
        }
      }
      engine.restoreMemo(input.req.code, input.now.date, input.memo);
      const r = engine.placeOrder(input.now, input.req);
      return r.events;
    }
    case 'cancel':
      return engine.cancelOrder(input.now, input.id).events;
    case 'deposit':
      return engine.deposit(input.now, input.fen).events;
    case 'withdraw':
      return engine.withdraw(input.now, input.fen).events;
    case 'fee':
      engine.setFeeProfile(input.profile);
      return [];
    case 'cap':
      engine.setDepositCap(input.fen);
      return [];
    case 'risk':
      engine.setRiskLimits(input.limits);
      return [];
    case 'actions':
      engine.setCorporateActions(input.actions);
      return [];
    case 'prime':
      engine.primeSnapshot(input.snap);
      return [];
    case 'snap':
      return engine.onSnapshot(input.snap);
  }
}

/** 引擎事件里不会再变的字段拼成的比对键（委托对象之后还会被成交改写，只取提交时就定下的）。 */
export function eventKey(e: EngineEvent): string | null {
  switch (e.type) {
    case 'order': {
      const o = e.order;
      return [
        '委托',
        o.no,
        o.code,
        o.side,
        o.kind,
        o.kind === 'limit' || o.kind === 'after' ? o.price : '市价',
        o.qty,
        o.date,
        o.t,
      ].join(' ');
    }
    case 'reject':
      return ['废单', e.order.no, e.order.reason].join(' ');
    case 'cancel':
      return [
        '撤单',
        e.order.no,
        e.order.reason,
        e.bySystem ? '系统' : '用户',
      ].join(' ');
    case 'fill': {
      const f = e.fill;
      return [
        '成交',
        f.no,
        '委托' + e.order.no,
        f.code,
        f.side,
        f.price + '×' + f.qty,
        '金额' + f.amount,
        '费用' + f.fee.total,
        '净额' + f.net,
        f.date,
        f.t,
        f.basis.rule,
      ].join(' ');
    }
    case 'settle':
      return ['清算', e.date, '撤销' + e.canceled].join(' ');
    case 'divTax':
      return ['红利税', e.date, e.code, e.amount].join(' ');
    case 'dividend':
      return ['派息', e.date, e.code, e.amount].join(' ');
    case 'bonus':
      return ['红股', e.date, e.code, e.qty].join(' ');
    case 'warning':
      return null;
  }
}
