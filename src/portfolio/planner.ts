import { available, holdingOf, isLive } from '../engine/account';
import { Engine, type Now } from '../engine/engine';
import { phaseAt } from '../engine/session';
import { TradingCalendar } from '../engine/calendar';
import { buyFreeze, calcFee, commissionParams } from '../engine/fees';
import { ruleOf, type Security } from '../engine/securities';
import type { AccountState, Snapshot } from '../engine/types';
import { amountFen, feeFen } from '../engine/units';
import type { Plan, PlanRow, TargetFile } from './types';

export interface PlanContext {
  state: AccountState;
  accountId: number;
  now: Now;
  calendar: TradingCalendar;
  security: (code: string) => Security | null;
  snapshot: (code: string) => Snapshot | null;
}
export function makePlan(targets: TargetFile, ctx: PlanContext): Plan {
  const codes = [
    ...new Set([
      ...targets.targets.map(r => r.code),
      ...ctx.state.lots.map(l => l.code),
    ]),
  ];
  const price = (code: string) => {
    const s = ctx.snapshot(code);
    const p = s?.last ?? s?.prevClose;
    if (!p || p <= 0 || !s || s.date > ctx.now.date) {
      throw new Error(code + ' 缺少有效行情，请刷新后重试');
    }
    const minDate = ctx.calendar.prev(ctx.calendar.onOrAfter(ctx.now.date));
    if (s.date < minDate) {
      throw new Error(code + ' 行情过旧，请刷新后重试');
    }
    if (
      ctx.calendar.isTradingDay(ctx.now.date) &&
      phaseAt(ctx.now.t) === 'cont' &&
      (s.date !== ctx.now.date || Math.abs(ctx.now.t - s.t) > 60)
    ) {
      throw new Error(code + ' 盘中报价超过 60 秒，请刷新后重试');
    }
    return p;
  };
  const equity =
    ctx.state.cash +
    ctx.state.lots.reduce((n, l) => n + amountFen(price(l.code), l.qty), 0);
  if (equity <= 0) {
    throw new Error('请先入金，再生成调仓计划');
  }
  const shadow = new Engine(JSON.parse(JSON.stringify(ctx.state)), {
    calendar: ctx.calendar,
    security: ctx.security,
  });
  codes.forEach(c => {
    const s = ctx.snapshot(c);
    if (s) {
      shadow.primeSnapshot(s);
    }
  });
  const rows: PlanRow[] = codes.map(code => {
    const sec = ctx.security(code);
    if (!sec) {
      throw new Error(code + ' 不是支持交易的沪深股票或 ETF');
    }
    const p = price(code),
      snap = ctx.snapshot(code)!;
    const { held, sellable } = holdingOf(ctx.state, code);
    const target = targets.targets.find(r => r.code === code)?.value ?? 0;
    const idealQty =
      targets.mode === 'weight' ? (equity * target * 10) / p : target;
    const delta = idealQty - held,
      rule = ruleOf(sec);
    const side: 'B' | 'S' = delta >= 0 ? 'B' : 'S';
    let qty = Math.floor(Math.abs(delta) + 1e-8);
    if (side === 'B') {
      qty =
        qty < rule.buyMin
          ? 0
          : rule.buyMin +
            Math.floor((qty - rule.buyMin) / rule.buyStep) * rule.buyStep;
    } else if (qty < held) {
      qty =
        rule.sellStep === 1
          ? qty < rule.sellMin
            ? 0
            : qty
          : Math.floor(qty / rule.sellStep) * rule.sellStep;
    }
    const targetQty = held + (side === 'B' ? qty : -qty);
    const request = qty
      ? { code, side, kind: 'limit' as const, price: p, qty }
      : null;
    const fee = calcFee(sec, side, amountFen(p, qty), ctx.state.fee);
    const warnings: string[] = [];
    if (sec.st) {
      warnings.push('ST 风险警示');
    }
    if (snap.up == null || snap.down == null) {
      warnings.push('涨跌停价缺失：核对上市前 5 日等特殊状态');
    }
    if ((side === 'B' && p === snap.up) || (side === 'S' && p === snap.down)) {
      warnings.push(
        side === 'B' ? '涨停买入可能无法成交' : '跌停卖出可能无法成交',
      );
    }
    if (snap.date !== ctx.now.date) {
      warnings.push('使用上一交易日报价；报送时重新校验');
    }
    if (ctx.state.orders.some(o => o.code === code && isLive(o))) {
      warnings.push('已有未完成委托：先处理原委托再调仓');
    }
    return {
      code,
      name: sec.name,
      security: sec,
      held,
      sellable,
      target,
      idealQty,
      targetQty,
      decisionPrice: p,
      decisionAt: `${snap.date} ${snap.t}`,
      request,
      check: null,
      fee: fee.total,
      minExtra: Math.max(
        0,
        fee.commission -
          feeFen(amountFen(p, qty), commissionParams(sec, ctx.state.fee).rate),
      ),
      weightError: ((targetQty - idealQty) * p) / 10 / equity,
      warnings,
    };
  });
  // 预检只预留买单资金；不能把尚未成交的卖单收入算入余额。
  for (const r of rows) {
    if (!r.request) {
      continue;
    }
    r.check = shadow.check(ctx.now, r.request);
    if (ctx.state.orders.some(o => o.code === r.code && isLive(o))) {
      r.check = {
        ...r.check,
        ok: false,
        level: 'block',
        rule: '未完成委托',
        msg: '请先处理本证券已有委托',
      };
    }
    if (r.check.ok && r.request.side === 'B') {
      shadow.state.frozen += buyFreeze(
        r.security,
        r.decisionPrice,
        r.request.qty,
        ctx.state.fee,
      );
    }
  }
  return {
    accountId: ctx.accountId,
    date: ctx.now.date,
    t: ctx.now.t,
    feeProfile: { ...ctx.state.fee },
    equity,
    available: available(ctx.state),
    buyNeed: rows.reduce(
      (n, r) =>
        n +
        (r.request?.side === 'B'
          ? buyFreeze(r.security, r.decisionPrice, r.request.qty, ctx.state.fee)
          : 0),
      0,
    ),
    weightError: rows.reduce((n, r) => n + Math.abs(r.weightError), 0),
    rows,
  };
}
