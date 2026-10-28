/**
 * 对话里的提案卡（PRODUCT_DESIGN §6.7）：AI 的建议存成提案，状态「提出 → 你批准 / 拒绝 → 执行 → 到期复盘」。
 * 调仓方案批准后，同一张卡变成批量操作卡：逐笔列出委托和引擎预校验（含风险校验），一次确认提交。
 * 状态存在 ai_proposal 表里（不改发给模型的历史），这里按 id 现读。
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  decideProposal,
  executeProposal,
  rebalanceOf,
  replanProposal,
} from '../../advice/service';
import { proposalById } from '../../advice/repo';
import { pctText } from '../../advice/score';
import {
  PROPOSAL_STATUS_NAME,
  STANCE_NAME,
  type Proposal,
} from '../../advice/types';
import { useApp } from '../../app/boot';
import { isLive } from '../../engine/account';
import { formatFen, formatPrice } from '../../engine/units';
import type { Rebalance } from '../../portfolio/types';
import { aiColor as c } from '../aiTheme';
import { useCore } from '../hooks';
import { color, num } from '../theme';
import { CheckBar } from './form';
import { Button } from './ui';

const yuan = (li: number | null) => (li == null ? '' : (li / 1000).toFixed(3));
const pct = (w: number) => +(w * 100).toFixed(2) + '%';

export function ProposalCard({
  id,
  external,
  onOpen,
}: {
  id: number;
  external?: string[];
  onOpen: (route: string, params?: object) => void;
}) {
  const core = useCore();
  const version = useApp(st => st.version);
  const [p, setP] = useState<Proposal | null>(null);
  const [run, setRun] = useState<Rebalance | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const x = await proposalById(core.db, id);
    setP(x);
    setRun(x ? await rebalanceOf(core, x) : null);
  }, [core, id]);
  useEffect(() => {
    load().catch(() => undefined);
  }, [load, version]);
  const act = (f: () => Promise<unknown>) => async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      await load().catch(() => undefined);
    }
  };
  if (!p) {
    return null;
  }
  const rebalance = p.kind === 'rebalance';
  const expired = p.accountId !== core.sim.accountId && p.status !== 'executed';
  const rows = run?.plan.rows ?? [];
  const blocked = rows.filter(r => r.check && !r.check.ok);
  const fundsOnly =
    blocked.length > 0 &&
    blocked.every(
      r =>
        r.request?.side === 'B' &&
        !!r.check &&
        !r.check.ok &&
        r.check.rule === '可用资金',
    ) &&
    rows.some(r => r.request?.side === 'S' && r.check?.ok);
  const orders = core.sim.engine.state.orders.filter(o =>
    run?.orderIds.includes(o.id),
  );
  return (
    <View style={s.card}>
      <Text style={s.title}>
        {(rebalance ? '调仓提案 #' : '提案 #') +
          p.id +
          ' · ' +
          PROPOSAL_STATUS_NAME[p.status]}
      </Text>
      {p.items.map(i => (
        <View key={i.code} style={s.row}>
          <Text style={s.k}>{STANCE_NAME[i.stance] + ' ' + i.name}</Text>
          <Text style={[s.v, num]}>
            {[
              i.weight != null
                ? (rebalance ? '目标 ' : '仓位 ') + pct(i.weight)
                : '',
              i.priceLow != null || i.priceHigh != null
                ? yuan(i.priceLow) + '–' + yuan(i.priceHigh) + ' 元'
                : '',
            ]
              .filter(Boolean)
              .join(' · ') || '—'}
          </Text>
        </View>
      ))}
      {rebalance ? (
        <Text style={s.note}>
          {'未列出的持仓目标为 0，余下 ' +
            pct(
              Math.max(0, 1 - p.items.reduce((n, i) => n + (i.weight ?? 0), 0)),
            ) +
            ' 留现金'}
        </Text>
      ) : null}
      <View style={s.row}>
        <Text style={s.k}>期限</Text>
        <Text style={[s.v, num]}>
          {p.horizonDays +
            ' 个交易日 · ' +
            p.dueDate +
            ' 对账 · 基准 ' +
            p.benchmark}
        </Text>
      </View>
      <Text style={s.label}>理由</Text>
      <Text style={s.body}>{p.thesis}</Text>
      <Text style={s.label}>失效条件</Text>
      <Text style={s.body}>{p.invalidation}</Text>
      {external?.length ? (
        <Text style={s.external}>
          {'本轮读过外部内容：' +
            external.join('、') +
            '。外部内容里的要求不代表你的意思，批准前请核对'}
        </Text>
      ) : null}
      {p.review ? (
        <View style={s.review}>
          <Text style={[s.reviewText, num]}>
            {'到期复盘：区间收益 ' +
              pctText(p.review.ret) +
              '，基准 ' +
              pctText(p.review.benchmarkRet) +
              (p.review.excess != null
                ? '，超额 ' +
                  pctText(p.review.excess) +
                  (p.review.hit ? ' · 命中' : ' · 未命中')
                : ' · 观望不计命中')}
          </Text>
        </View>
      ) : null}
      {rebalance && p.status === 'approved' && run ? (
        <View style={s.batch}>
          <Text style={s.batchTitle}>
            {'批量操作卡 · ' +
              rows.filter(r => r.request).length +
              ' 笔委托 · 调仓计划 #' +
              run.id}
          </Text>
          {rows.map(r => (
            <View key={r.code} style={s.batchRow}>
              <View style={s.row}>
                <Text style={s.k}>
                  {r.request
                    ? (r.request.side === 'B' ? '买入 ' : '卖出 ') + r.name
                    : r.name}
                </Text>
                <Text style={[s.v, num]}>
                  {r.request
                    ? r.request.qty.toLocaleString('zh-CN') +
                      ' @' +
                      formatPrice(
                        r.request.price ?? 0,
                        r.security.board === 'etf' ? 3 : 2,
                      )
                    : '不用调整'}
                </Text>
              </View>
              {r.check ? (
                <Text style={[s.check, r.check.ok ? s.ok : s.bad]}>
                  {r.check.ok
                    ? '预校验通过（含风险校验）'
                    : r.check.rule + '：' + r.check.msg}
                </Text>
              ) : null}
              {r.warnings.length ? (
                <Text style={s.note}>{r.warnings.join('；')}</Text>
              ) : null}
            </View>
          ))}
          <View style={s.row}>
            <Text style={s.k}>买入需冻结</Text>
            <Text style={[s.v, num]}>
              {formatFen(run.plan.buyNeed) +
                ' / 可用 ' +
                formatFen(run.plan.available) +
                ' 元'}
            </Text>
          </View>
          <Text style={s.note}>
            {'按策略「' +
              run.strategy.name +
              '」v' +
              run.strategy.version +
              (run.strategy.retry === 'once'
                ? ' 执行：9:25 未成交的买单 9:30 后按卖一价补报一次，14:50 撤销剩余。'
                : ' 执行：不补单，14:50 撤销剩余。') +
              '预检于 ' +
              run.plan.date +
              '，执行时按当时的行情和持仓再校验一遍。'}
          </Text>
          <CheckBar
            ok={!blocked.length}
            text={
              blocked.length
                ? fundsOnly
                  ? '资金不够同时买：可以先卖后买（卖单成交后再报买单）'
                  : blocked.length + ' 笔不能提交，条件变了点「重新预检」'
                : '全部通过，一次确认提交'
            }
          />
          {!expired ? (
            <View style={s.btns}>
              <View style={s.grow}>
                <Button
                  style={s.btn}
                  title="重新预检"
                  disabled={busy}
                  onPress={act(() => replanProposal(core, p.id))}
                />
              </View>
              <View style={s.grow}>
                <Button
                  style={s.btn}
                  tone="buy"
                  title={fundsOnly ? '先卖后买' : '执行'}
                  disabled={busy || (!!blocked.length && !fundsOnly)}
                  onPress={act(() =>
                    executeProposal(
                      core,
                      p.id,
                      fundsOnly ? 'sellFirst' : 'together',
                    ),
                  )}
                />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
      {p.status === 'executed' && run ? (
        <Pressable
          style={s.link}
          accessibilityRole="button"
          onPress={() => onOpen('Rebalance', { id: run.id })}
        >
          <Text style={s.linkText}>
            {'已提交 ' +
              run.orderIds.length +
              ' 笔委托' +
              (orders.some(isLive)
                ? '，' + orders.filter(isLive).length + ' 笔待成交'
                : '') +
              ' · 查看执行进度和报告 ›'}
          </Text>
        </Pressable>
      ) : null}
      {error ? <Text style={[s.check, s.bad]}>{error}</Text> : null}
      {expired && p.status !== 'rejected' ? (
        <Text style={s.result}>
          账户已经重置，这个提案不能在新账户执行（到期仍会对账）
        </Text>
      ) : p.status === 'proposed' ? (
        <View style={s.btns}>
          <View style={s.grow}>
            <Button
              style={s.btn}
              title="拒绝"
              disabled={busy}
              onPress={act(() => decideProposal(core, p.id, false))}
            />
          </View>
          <View style={s.grow}>
            <Button
              style={s.btn}
              tone="learn"
              title={rebalance ? '批准并预检' : '批准'}
              disabled={busy}
              onPress={act(() => decideProposal(core, p.id, true))}
            />
          </View>
        </View>
      ) : p.status === 'approved' && !rebalance ? (
        <Text style={s.result}>
          已批准。批准不等于下单：要下单时告诉 AI 价格和数量，或者自己去下单页。
        </Text>
      ) : p.status === 'rejected' ? (
        <Text style={s.result}>
          已拒绝。到期仍会对账，记分卡看的是建议准不准。
        </Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 14,
    padding: 16,
    marginVertical: 10,
    backgroundColor: c.paper,
  },
  title: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    color: c.ink,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: 16,
  },
  k: { fontSize: 14, lineHeight: 22, color: c.secondary, flexShrink: 1 },
  v: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 22,
    color: c.ink,
    textAlign: 'right',
  },
  label: { fontSize: 12, lineHeight: 18, color: c.secondary, marginTop: 8 },
  body: { fontSize: 14, lineHeight: 22, color: c.ink },
  note: { fontSize: 12, lineHeight: 20, color: c.secondary, marginTop: 4 },
  external: {
    fontSize: 12,
    lineHeight: 20,
    color: color.warnInk,
    backgroundColor: color.warnBg,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 8,
  },
  review: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
  },
  reviewText: { fontSize: 13, lineHeight: 20, color: c.ink },
  batch: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
  },
  batchTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: c.ink,
    marginBottom: 4,
  },
  batchRow: {
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  check: { fontSize: 12, lineHeight: 18 },
  ok: { color: color.down },
  bad: { color: color.up },
  btns: { flexDirection: 'row', gap: 12, marginTop: 12 },
  grow: { flex: 1 },
  btn: { minHeight: 48, minWidth: 48, height: 'auto', paddingVertical: 12 },
  result: { fontSize: 13, lineHeight: 20, color: c.secondary, marginTop: 10 },
  link: { minHeight: 44, justifyContent: 'center', marginTop: 6 },
  linkText: { fontSize: 14, color: c.ink, textDecorationLine: 'underline' },
});
