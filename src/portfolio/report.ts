import { isLive } from '../engine/account';
import { calcFee, commissionParams } from '../engine/fees';
import { amountFen, feeFen } from '../engine/units';
import type { AccountState, Snapshot } from '../engine/types';
import { weekOf } from './repo';
import type { ExecutionReport, Rebalance } from './types';

/** 价格差单位为分；正数代表比决策价更差。未成交和整手用报告日最新价计机会损失，缺行情保留 null。 */
export function buildReport(
  r: Rebalance,
  state: AccountState,
  snapshot: (code: string) => Snapshot | null,
  date: string,
  createdAt: string,
  note: string,
): ExecutionReport {
  const orders = state.orders.filter(o => r.orderIds.includes(o.id));
  if (orders.some(isLive)) {
    throw new Error('还有未完成委托，请先等待成交或撤单');
  }
  const rows = r.plan.rows.map(row => {
    const mine = orders.filter(o => o.code === row.code);
    const fills = state.fills.filter(f => mine.some(o => o.id === f.orderId));
    const ledger = state.ledger.filter(l => fills.some(f => f.no === l.fillNo));
    const filled = fills.reduce((n, f) => n + f.qty, 0);
    const requested = row.request?.qty ?? 0;
    const direction = row.request?.side === 'S' ? -1 : 1;
    const slippage = fills.reduce(
      (n, f) =>
        n + direction * (f.amount - amountFen(row.decisionPrice, f.qty)),
      0,
    );
    const fees = fills.reduce((n, f) => n + f.fee.total, 0);
    let minExtra = 0;
    for (const o of mine) {
      const profile = o.feeProfile ?? state.fee;
      const rate = commissionParams(row.security, profile).rate;
      minExtra += profile.mergeOrder
        ? Math.max(0, o.fee.commission - feeFen(o.amount, rate))
        : fills
            .filter(f => f.orderId === o.id)
            .reduce(
              (n, f) =>
                n + Math.max(0, f.fee.commission - feeFen(f.amount, rate)),
              0,
            );
    }
    const mark = snapshot(row.code);
    const markPrice = mark?.date === date ? mark.last : null;
    const remaining = Math.max(0, requested - filled);
    const opportunity = !remaining
      ? 0
      : markPrice == null
      ? null
      : Math.round(
          (direction * (markPrice - row.decisionPrice) * remaining) / 10,
        );
    const roundingQty = row.idealQty - row.targetQty;
    const rounding =
      Math.abs(roundingQty) < 1e-8
        ? 0
        : markPrice == null
        ? null
        : Math.round((roundingQty * (markPrice - row.decisionPrice)) / 10);
    return {
      code: row.code,
      name: row.name,
      side: row.request?.side ?? '—',
      decisionPrice: row.decisionPrice,
      orderPrices: mine.map(o => o.price ?? 0),
      requested,
      filled,
      averagePrice: filled
        ? fills.reduce((n, f) => n + f.price * f.qty, 0) / filled
        : null,
      fillRatio: requested ? filled / requested : 1,
      fees,
      minExtra,
      slippage,
      opportunity,
      rounding,
      weightError: row.weightError,
      remaining,
      reason: remaining
        ? [
            mine
              .map(o => o.reason)
              .filter(Boolean)
              .join('；'),
            ...r.notes.filter(n => n.includes(row.code)),
            !mine.length && row.check && !row.check.ok ? row.check.msg : '',
          ]
            .filter(Boolean)
            .join('；') || '未成交后放弃'
        : '',
      fillIds: fills.map(f => f.id),
      ledgerIds: ledger.map(l => l.id),
    };
  });
  const violations: string[] = [];
  const week = weekOf(r.executionDate);
  for (const o of state.orders.filter(
    order =>
      weekOf(order.sendDate ?? order.date) === week &&
      !r.orderIds.includes(order.id),
  )) {
    violations.push(
      `计划外委托 ${o.no} ${o.code} ${o.side === 'B' ? '买入' : '卖出'} ${
        o.qty
      }`,
    );
    const expected = r.plan.rows.find(x => x.code === o.code)?.request;
    if (expected && expected.side !== o.side) {
      violations.push(`违背信号 ${o.no}：方向与本次计划相反`);
    }
  }
  for (const row of r.plan.rows) {
    const weight = amountFen(row.decisionPrice, row.targetQty) / r.plan.equity;
    if (weight > r.strategy.maxWeight + 1e-9) {
      violations.push(
        `${row.name} 计划权重 ${(weight * 100).toFixed(2)}% 超过单票上限 ${(
          r.strategy.maxWeight * 100
        ).toFixed(0)}%`,
      );
    }
  }
  const holdings = [...new Set(state.lots.map(l => l.code))];
  const marks = holdings.map(code => ({
    code,
    price: snapshot(code)?.last,
    qty: state.lots.filter(l => l.code === code).reduce((n, l) => n + l.qty, 0),
  }));
  if (marks.every(m => m.price != null)) {
    const equity =
      state.cash + marks.reduce((n, m) => n + amountFen(m.price!, m.qty), 0);
    for (const m of marks) {
      if (
        equity > 0 &&
        amountFen(m.price!, m.qty) / equity > r.strategy.maxWeight + 1e-9
      ) {
        violations.push(
          `${m.code} 实际权重 ${(
            (amountFen(m.price!, m.qty) / equity) *
            100
          ).toFixed(2)}% 超过单票上限`,
        );
      }
    }
  } else {
    violations.push('实际单票权重检查不完整：部分持仓缺少行情');
  }
  const sum = (key: 'fees' | 'minExtra' | 'slippage') =>
    rows.reduce((n, x) => n + x[key], 0);
  const nullableSum = (key: 'opportunity' | 'rounding') =>
    rows.some(x => x[key] == null)
      ? null
      : rows.reduce((n, x) => n + (x[key] ?? 0), 0);
  const opportunity = nullableSum('opportunity'),
    rounding = nullableSum('rounding');
  // 与“全量按决策价、按费率计佣”的基线比较：实际成本减去理想全量费用。
  const idealFees = r.plan.rows.reduce((n, x) => {
    const profile = { ...r.plan.feeProfile, stockMinFen: 0, etfMinFen: 0 };
    return (
      n +
      calcFee(
        x.security,
        x.request?.side ?? (x.idealQty < x.held ? 'S' : 'B'),
        Math.round((Math.abs(x.idealQty - x.held) * x.decisionPrice) / 10),
        profile,
      ).total
    );
  }, 0);
  const fees = sum('fees'),
    slippage = sum('slippage');
  return {
    version: 1,
    rebalanceId: r.id,
    accountId: r.accountId,
    strategy: r.strategy,
    date,
    week,
    createdAt,
    rows,
    fees,
    minExtra: sum('minExtra'),
    slippage,
    opportunity,
    rounding,
    idealFees,
    implementationShortfall:
      opportunity == null || rounding == null
        ? null
        : slippage + fees + opportunity + rounding,
    shortfall:
      opportunity == null || rounding == null
        ? null
        : slippage + fees - idealFees + opportunity + rounding,
    violations,
    note,
  };
}
export function reportCsv(report: ExecutionReport): string {
  const esc = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  return [
    [
      'format_version',
      'rebalance_id',
      'strategy',
      'strategy_version',
      'code',
      'decision_li',
      'order_prices_li',
      'average_li',
      'requested',
      'filled',
      'fees_fen',
      'minimum_extra_fen',
      'slippage_fen',
      'opportunity_fen',
      'rounding_fen',
      'reason',
      'fill_ids',
      'ledger_ids',
    ],
    ...report.rows.map(r => [
      1,
      report.rebalanceId,
      report.strategy.name,
      report.strategy.version,
      r.code,
      r.decisionPrice,
      r.orderPrices.join('|'),
      r.averagePrice,
      r.requested,
      r.filled,
      r.fees,
      r.minExtra,
      r.slippage,
      r.opportunity,
      r.rounding,
      r.reason,
      r.fillIds.join('|'),
      r.ledgerIds.join('|'),
    ]),
  ]
    .map(row => row.map(esc).join(','))
    .join('\r\n');
}
