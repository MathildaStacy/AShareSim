import type { Db } from '../data/db';
import * as data from '../data/repos';
import { isLive } from '../engine/account';
import { phaseAt, T } from '../engine/session';
import { beijingIso } from '../market/clock';
import type { MarketClient } from '../market/client';
import type { Simulator } from '../sim/simulator';
import { makePlan } from './planner';
import { buildReport } from './report';
import {
  loadRebalance,
  rebalances,
  reports,
  saveRebalance,
  streak,
} from './repo';
import type { Plan, Rebalance, Strategy, TargetFile } from './types';

export class PortfolioService {
  constructor(
    private db: Db,
    private sim: Simulator,
    private client: MarketClient,
  ) {}
  async preview(targets: TargetFile): Promise<Plan> {
    const accountId = this.sim.accountId;
    const codes = [
      ...new Set([
        ...targets.targets.map(t => t.code),
        ...this.sim.heldCodes(),
      ]),
    ];
    await this.sim.ingest(await this.client.quotes(codes));
    await this.sim.tick();
    if (accountId !== this.sim.accountId) {
      throw new Error('账户已切换，请重新预检');
    }
    return makePlan(targets, {
      state: this.sim.engine.state,
      accountId,
      now: this.sim.now(),
      calendar: this.sim.calendar,
      security: c => this.sim.security(c),
      snapshot: c => this.sim.engine.snapshot(c),
    });
  }
  async draft(
    strategy: Strategy,
    targets: TargetFile,
    plan: Plan,
  ): Promise<Rebalance> {
    if (plan.accountId !== this.sim.accountId) {
      throw new Error('账户已切换，请重新预检');
    }
    return this.db.transaction(async tx => {
      await tx.run(
        'INSERT INTO rebalance(account_id,status,body,updated_at) VALUES (?,?,?,?)',
        [plan.accountId, 'draft', '{}', beijingIso()],
      );
      const id = Number(
        (await tx.get<{ id: number }>('SELECT last_insert_rowid() AS id'))!.id,
      );
      const r: Rebalance = {
        id,
        accountId: plan.accountId,
        strategy: JSON.parse(JSON.stringify(strategy)),
        targets,
        plan,
        status: 'draft',
        createdAt: beijingIso(),
        executionDate: plan.date,
        orderIds: [],
        attempts: {},
        notes: [],
      };
      await saveRebalance(tx, r);
      return r;
    });
  }
  async discardDraft(id: number): Promise<void> {
    await this.db.run(
      "DELETE FROM rebalance WHERE id=? AND account_id=? AND status='draft'",
      [id, this.sim.accountId],
    );
  }
  async execute(
    id: number,
    mode: 'together' | 'sellFirst',
  ): Promise<Rebalance> {
    return this.sim.transact(async (engine, tx, events) => {
      const r = await loadRebalance(tx, id, this.sim.accountId);
      if (r.status !== 'draft') {
        throw new Error('这次调仓已提交，请查看执行进度');
      }
      if (
        (await rebalances(tx, r.accountId)).some(
          x => x.id !== id && x.status === 'executing',
        )
      ) {
        throw new Error('请先完成当前调仓并生成报告');
      }
      const fresh = makePlan(r.targets, {
        state: engine.state,
        accountId: r.accountId,
        now: this.sim.now(),
        calendar: this.sim.calendar,
        security: c => this.sim.security(c),
        snapshot: c => engine.snapshot(c),
      });
      // 持仓或价格变动需要重新确认，绝不默默改变已确认数量/价格。
      if (
        JSON.stringify(fresh.rows.map(x => [x.held, x.request])) !==
        JSON.stringify(r.plan.rows.map(x => [x.held, x.request]))
      ) {
        throw new Error('行情或持仓已变化，请重新生成预检并确认');
      }
      for (const row of fresh.rows) {
        if (
          row.check &&
          !row.check.ok &&
          !(
            mode === 'sellFirst' &&
            row.request?.side === 'B' &&
            row.check.rule === '可用资金'
          )
        ) {
          throw new Error(row.name + '：' + row.check.msg);
        }
      }
      if (
        JSON.stringify(fresh.feeProfile) !== JSON.stringify(r.plan.feeProfile)
      ) {
        throw new Error('费率已变化，请重新预检');
      }
      const selected = fresh.rows.filter(
        x => x.request && !(mode === 'sellFirst' && x.request.side === 'B'),
      );
      if (mode === 'sellFirst' && !selected.length) {
        throw new Error('没有可先执行的卖单，请减少目标权重留出费用');
      }
      r.status = 'executing';
      r.executionDate =
        selected[0]?.check?.route === 'nextDay'
          ? this.sim.calendar.next(this.sim.now().date)
          : this.sim.calendar.onOrAfter(this.sim.now().date);
      for (const row of selected) {
        const placed = engine.placeOrder(this.sim.now(), row.request!);
        events.push(...placed.events);
        if (!placed.ok) {
          throw new Error(placed.msg);
        }
        r.orderIds.push(placed.order.id);
        r.attempts[row.code] = 1;
      }
      if (mode === 'sellFirst') {
        r.notes.push(
          '先卖后买：9:30 后以实际可用资金提交已确认的买入数量；不足则放弃，不自动缩单。',
        );
      }
      await saveRebalance(tx, r);
      return r;
    });
  }
  /** 在前台/后台行情循环中执行已确认策略：一次买入补单，14:50 放弃。重启从持久化次数恢复。 */
  async process(): Promise<void> {
    if (
      !(await rebalances(this.db, this.sim.accountId)).some(
        r => r.status === 'executing',
      )
    ) {
      return;
    }
    await this.sim.transact(async (engine, tx, events) => {
      const now = this.sim.now();
      for (const r of (await rebalances(tx, this.sim.accountId)).filter(
        x => x.status === 'executing',
      )) {
        if (now.date < r.executionDate) {
          continue;
        }
        let changed = false;
        for (const row of r.plan.rows) {
          const req = row.request;
          if (!req) {
            continue;
          }
          const mine = engine.state.orders.filter(
            o => r.orderIds.includes(o.id) && o.code === row.code,
          );
          const remaining = req.qty - mine.reduce((n, o) => n + o.filled, 0);
          if (remaining <= 0) {
            continue;
          }
          if (now.date > r.executionDate || now.t >= T(14, 50)) {
            for (const o of mine.filter(isLive)) {
              const canceled = engine.cancelOrder(now, o.id);
              events.push(...canceled.events);
              if (!canceled.ok) {
                continue;
              }
              changed = true;
            }
            if ((r.attempts[row.code] ?? 0) < 2) {
              r.attempts[row.code] = 2;
              r.notes.push(
                row.code + ' 截止时间未完成，放弃剩余 ' + remaining + ' 股',
              );
              changed = true;
            }
            continue;
          }
          const attempts = r.attempts[row.code] ?? 0;
          if (
            req.side !== 'B' ||
            now.t < T(9, 30) ||
            phaseAt(now.t) !== 'cont' ||
            attempts >= 2 ||
            (attempts === 1 && r.strategy.retry === 'none')
          ) {
            continue;
          }
          const snap = engine.snapshot(row.code),
            ask = snap?.asks[0]?.[0];
          if (
            !snap ||
            snap.date !== now.date ||
            now.t - snap.t < 0 ||
            now.t - snap.t > 60 ||
            !ask
          ) {
            continue;
          }
          // 先卖后买必须等本计划卖单全部结束，否则可用资金判断不稳定。
          if (
            !attempts &&
            engine.state.orders.some(
              o => r.orderIds.includes(o.id) && o.side === 'S' && isLive(o),
            )
          ) {
            continue;
          }
          for (const o of mine.filter(isLive)) {
            const canceled = engine.cancelOrder(now, o.id);
            events.push(...canceled.events);
            if (!canceled.ok) {
              throw new Error(canceled.msg);
            }
          }
          const next = { ...req, qty: remaining, price: ask };
          const checked = engine.check(now, next);
          r.attempts[row.code] = 2;
          changed = true;
          if (!checked.ok) {
            r.notes.push(row.code + ' 补单放弃：' + checked.msg);
            continue;
          }
          const result = engine.placeOrder(now, next);
          events.push(...result.events);
          if (result.ok) {
            r.orderIds.push(result.order.id);
            r.notes.push(row.code + ' 按卖一价补报一次');
          } else {
            r.notes.push(row.code + ' 补单放弃：' + result.msg);
          }
        }
        if (changed) {
          await saveRebalance(tx, r);
        }
      }
    });
  }
  async finish(id: number, note: string) {
    return this.sim.transact(async (engine, tx) => {
      const r = await loadRebalance(tx, id, this.sim.accountId);
      if (r.status === 'reported') {
        return (await reports(tx, r.accountId)).find(
          x => x.rebalanceId === id,
        )!;
      }
      if (r.status !== 'executing') {
        throw new Error('请先确认调仓计划');
      }
      if (this.sim.now().date < r.executionDate) {
        throw new Error('尚未到执行日');
      }
      if (!note.trim()) {
        throw new Error('请写下本周复盘或不调仓原因');
      }
      const report = buildReport(
        r,
        engine.state,
        c => engine.snapshot(c),
        this.sim.now().date,
        beijingIso(),
        note.trim(),
      );
      const otherIds = (await rebalances(tx, r.accountId))
        .filter(x => x.id !== r.id && x.status !== 'draft')
        .flatMap(x => x.orderIds);
      const otherNos = engine.state.orders
        .filter(o => otherIds.includes(o.id))
        .map(o => o.no);
      report.violations = report.violations.filter(
        v => !otherNos.some(no => v.includes(no)),
      );
      await tx.run('DELETE FROM weekly_skip WHERE account_id=? AND week=?', [
        r.accountId,
        report.week,
      ]);
      // 完成报告就是明确放弃尚未提交的部分；之后调度器不再补单。
      await tx.run('INSERT INTO execution_report VALUES (?,?,?,?)', [
        id,
        r.accountId,
        report.week,
        JSON.stringify(report),
      ]);
      r.status = 'reported';
      await saveRebalance(tx, r);
      await data.logActivity(tx, {
        accountId: r.accountId,
        tradeDate: report.date,
        ts: report.createdAt,
        kind: 'learn',
        text: '完成调仓执行报告 #' + id,
        ref: { rebalanceId: id },
      });
      const n = streak(
        (await reports(tx, r.accountId)).map(x => x.week),
        report.date,
      );
      if (n >= 12) {
        for (const key of ['s7-e0', 's7-p0']) {
          await data.addLearnCheck(tx, {
            id: key,
            auto: true,
            doneAt: report.createdAt,
            basis: `连续 ${n} 周执行报告`,
          });
        }
      }
      return report;
    });
  }
  async cancelRemaining(id: number): Promise<void> {
    await this.sim.transact(async (engine, tx, events) => {
      const r = await loadRebalance(tx, id, this.sim.accountId);
      if (r.status !== 'executing') {
        throw new Error('仅执行中的计划可以结束委托');
      }
      for (const o of engine.state.orders.filter(
        x => r.orderIds.includes(x.id) && isLive(x),
      )) {
        const result = engine.cancelOrder(this.sim.now(), o.id);
        events.push(...result.events);
        if (!result.ok) {
          throw new Error(result.msg);
        }
      }
      r.plan.rows.forEach(row => {
        r.attempts[row.code] = 2;
      });
      r.notes.push('用户确认撤销剩余委托并放弃补单');
      await saveRebalance(tx, r);
    });
  }
}
