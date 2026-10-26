/**
 * 委托详情（字段、过程时间线、撤单）和成交详情（成交依据、费用算式、红利税补）。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { isLive } from '../../engine/account';
import { ruleOf } from '../../engine/securities';
import { formatSec, PHASES, phaseAt } from '../../engine/session';
import { KIND_NAME, type Order } from '../../engine/types';
import { formatFen, formatPrice } from '../../engine/units';
import { feeOf } from '../../engine/engine';
import { feeDiff, feeLabel } from '../../sim/feeForm';
import { basisLines, feeLines } from '../../sim/fillExplain';
import { cancelState } from '../../sim/orderForm';
import { ConfirmDialog } from '../components/Dialog';
import { SideBadge, STATUS_COLOR } from '../components/tradeRows';
import {
  AiFab,
  Button,
  Empty,
  NavBar,
  Note,
  SectionTitle,
} from '../components/ui';
import { fmtQty, unitOf } from '../format';
import {
  useAiContext,
  useCore,
  useLive,
  useQuoteCodes,
  useViewLog,
} from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { color, num, PAD } from '../theme';
import { toast } from '../toast';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function KV({ k, v, c }: { k: string; v: string; c?: string }) {
  return (
    <View style={s.kv}>
      <Text style={s.k}>{k}</Text>
      <Text style={[s.v, num, c ? { color: c } : null]}>{v}</Text>
    </View>
  );
}

function orderPriceText(o: Order, d: 2 | 3): string {
  if (o.kind === 'after') {
    return '收盘价';
  }
  return o.price != null
    ? formatPrice(o.price, d) + (o.kind !== 'limit' ? '（市价转限价）' : '')
    : '市价';
}

// ---------- 委托详情 ----------

export function OrderDetailScreen({ route }: RootScreenProps<'OrderDetail'>) {
  const { id } = route.params;
  const core = useCore();
  const nav = useNavigation<Nav>();
  useLive();
  const [confirm, setConfirm] = useState(false);
  const st = core.sim.engine.state;
  const o = st.orders.find(x => x.id === id) ?? null;
  const sec = o ? core.sim.security(o.code) : null;
  const d = sec ? ruleOf(sec).decimals : 2;
  const name = o ? sec?.name ?? o.code.slice(2) : '';
  const unit = o ? unitOf(o.code, sec?.type) : '股';
  useQuoteCodes(o && isLive(o) ? [o.code] : []);
  const now = core.sim.now();
  const tradingDay = core.sim.calendar.isTradingDay(now.date);
  const phase = phaseAt(now.t);
  const cs = o && isLive(o) ? cancelState(o.status, phase, tradingDay) : null;
  const fills = o
    ? o.fills
        .map(fid => st.fills.find(f => f.id === fid))
        .filter((f): f is NonNullable<typeof f> => f != null)
    : [];
  const avg = o && o.filled ? Math.round((o.amount * 10) / o.filled) : null;
  const sideName = o?.side === 'B' ? '买入' : '卖出';

  useViewLog('order:' + id, o ? '查看 委托详情 ' + o.no + ' ' + name : null);
  useAiContext('OrderDetail:' + id, () => {
    if (!o) {
      return { name: '委托详情', lines: ['找不到这笔委托'] };
    }
    return {
      name: '委托详情 · ' + name + ' ' + sideName,
      lines: [
        '合同号 ' +
          o.no +
          '，' +
          o.date +
          ' ' +
          formatSec(o.t) +
          ' 提交（当时是' +
          PHASES[phaseAt(o.t)].name +
          '），状态 ' +
          o.status,
        '委托类型 ' +
          KIND_NAME[o.kind] +
          '，委托价 ' +
          orderPriceText(o, d) +
          ' × ' +
          fmtQty(o.qty) +
          ' ' +
          unit +
          (o.protect != null ? '，保护限价 ' + formatPrice(o.protect, d) : ''),
        '已成交 ' +
          fmtQty(o.filled) +
          (avg != null ? '，成交均价 ' + formatPrice(avg, d) : '') +
          '，成交金额 ' +
          formatFen(o.amount) +
          ' 元，费用 ' +
          formatFen(o.fee.total) +
          ' 元' +
          (o.side === 'B' ? '，冻结资金 ' + formatFen(o.frozen) + ' 元' : ''),
        ...(o.note ? ['状态说明：' + o.note] : []),
        ...(o.reason ? ['原因：' + o.reason] : []),
        ...fills.map(
          f =>
            '成交 ' +
            formatSec(f.t) +
            ' ' +
            formatPrice(f.price, d) +
            ' × ' +
            fmtQty(f.qty) +
            '：' +
            f.basis.text,
        ),
        ...(cs ? [cs.ok ? '现在可以撤单' : '现在不能撤单：' + cs.why] : []),
      ],
      tip: '「未报」是券商暂存还没报交易所；废单是交易所拒收（例如超出价格笼子），原因写在过程里。',
    };
  });

  if (!o) {
    return (
      <View style={s.page}>
        <NavBar title="委托详情" back />
        <Empty text="找不到这笔委托。" />
      </View>
    );
  }

  const doCancel = async () => {
    setConfirm(false);
    const r = await core.sim.cancelOrder(o.id);
    if (!r.ok) {
      toast.show(r.msg, 'bad');
    }
  };

  return (
    <View style={s.page}>
      <NavBar title="委托详情" sub={o.no} back />
      <ScrollView contentContainerStyle={s.pad}>
        <View style={s.card}>
          <View style={s.head}>
            <View style={s.headL}>
              <SideBadge side={o.side} />
              <Text style={s.title}>{name}</Text>
              <Text style={[s.code, num]}>{o.code.slice(2)}</Text>
            </View>
            <Text style={[s.status, { color: STATUS_COLOR[o.status] }]}>
              {o.status}
            </Text>
          </View>
          <KV k="合同号" v={o.no} />
          <KV k="委托类型" v={KIND_NAME[o.kind]} />
          <KV
            k="委托价 × 数量"
            v={orderPriceText(o, d) + ' × ' + fmtQty(o.qty)}
          />
          {o.protect != null ? (
            <KV k="保护限价" v={formatPrice(o.protect, d)} />
          ) : null}
          <KV
            k="成交均价 × 数量"
            v={
              (avg != null ? formatPrice(avg, d) : '--') +
              ' × ' +
              fmtQty(o.filled)
            }
          />
          <KV k="成交金额" v={formatFen(o.amount)} />
          <KV k="费用合计" v={formatFen(o.fee.total)} />
          {o.side === 'B' ? <KV k="冻结资金" v={formatFen(o.frozen)} /> : null}
          {o.note ? <Text style={s.noteText}>{o.note}</Text> : null}
          {cs ? (
            <View style={s.cancel}>
              <Button
                title="撤单"
                onPress={() => setConfirm(true)}
                disabled={!cs.ok}
              />
              {!cs.ok ? <Text style={s.why}>{cs.why}</Text> : null}
              {cs.ok && cs.why ? <Text style={s.why}>{cs.why}</Text> : null}
            </View>
          ) : null}
        </View>

        <SectionTitle title="过程" />
        <View style={[s.card, s.tl]}>
          <Step
            title="提交委托"
            sub={
              o.date + ' ' + formatSec(o.t) + ' · ' + PHASES[phaseAt(o.t)].name
            }
          />
          {o.status === '未报' && o.sendDate && o.sendAt != null ? (
            <Step
              title="等待报送"
              sub={
                '券商暂存，计划 ' +
                o.sendDate +
                ' ' +
                formatSec(o.sendAt) +
                ' 报送交易所'
              }
            />
          ) : null}
          {fills.map(f => (
            <Step
              key={f.id}
              title={'成交 ' + formatPrice(f.price, d) + ' × ' + fmtQty(f.qty)}
              sub={formatSec(f.t) + ' · ' + f.basis.text}
              done
              onPress={() => nav.navigate('FillDetail', { id: f.id })}
            />
          ))}
          {isLive(o) ? (
            <Step title={o.status} sub={o.note || '等待撮合'} />
          ) : null}
          {o.status === '已撤' || o.status === '部撤' || o.status === '废单' ? (
            <Step title={o.status} sub={o.reason} bad={o.status === '废单'} />
          ) : null}
          {o.status === '已成' ? <Step title="全部成交" done /> : null}
        </View>
      </ScrollView>
      <ConfirmDialog
        visible={confirm}
        title="撤单确认"
        rows={[
          { k: '证券', v: name + ' ' + o.code.slice(2) },
          { k: '方向', v: sideName },
          { k: '委托', v: orderPriceText(o, d) + ' × ' + fmtQty(o.qty) },
          { k: '已成交', v: fmtQty(o.filled) },
        ]}
        okTitle="确认撤单"
        okTone="plain"
        onOk={doCancel}
        onCancel={() => setConfirm(false)}
      />
      <AiFab />
    </View>
  );
}

function Step({
  title,
  sub,
  done,
  bad,
  onPress,
}: {
  title: string;
  sub?: string;
  done?: boolean;
  bad?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [s.step, pressed && s.pressed]}
    >
      <View
        style={[
          s.dot,
          done && { backgroundColor: color.down },
          bad && { backgroundColor: color.up },
        ]}
      />
      <View style={s.grow}>
        <Text style={s.stepT}>
          {title}
          {onPress ? <Text style={s.link}>　查看依据 ›</Text> : null}
        </Text>
        {sub ? <Text style={s.stepSub}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

// ---------- 成交详情 ----------

export function FillDetailScreen({ route }: RootScreenProps<'FillDetail'>) {
  const { id } = route.params;
  const core = useCore();
  const nav = useNavigation<Nav>();
  const st = core.sim.engine.state;
  const f = st.fills.find(x => x.id === id) ?? null;
  const o = f ? st.orders.find(x => x.id === f.orderId) ?? null : null;
  const sec = f ? core.sim.security(f.code) : null;
  const d = sec ? ruleOf(sec).decimals : 2;
  const name = f ? sec?.name ?? f.code.slice(2) : '';
  const unit = f ? unitOf(f.code, sec?.type) : '股';
  const board = sec?.board ?? 'main';
  // 费用按这笔委托提交时的费率算（之后改费率不影响已有委托）
  const profile = o ? feeOf(o, st) : st.fee;
  const lines = f ? feeLines(f, { board }, profile, d) : [];
  const basis = f ? basisLines(f.basis, f.side, d, unit) : [];
  const feeState =
    '按委托提交时的费率：' +
    feeLabel(profile, board) +
    (profile !== st.fee && feeDiff(profile, st.fee).length
      ? '。之后改过费率，只对新委托生效。'
      : '。');
  const sideName = f?.side === 'B' ? '买入' : '卖出';

  useViewLog('fill:' + id, f ? '查看 成交详情 ' + f.no + ' ' + name : null);
  useAiContext('FillDetail:' + id, () => {
    if (!f) {
      return { name: '成交详情', lines: ['找不到这笔成交'] };
    }
    return {
      name: '成交详情 · ' + name + ' ' + sideName,
      lines: [
        sideName +
          ' ' +
          name +
          ' ' +
          fmtQty(f.qty) +
          ' ' +
          unit +
          ' @' +
          formatPrice(f.price, d) +
          '，' +
          f.date +
          ' ' +
          formatSec(f.t) +
          '，成交编号 ' +
          f.no +
          (o ? '，合同号 ' + o.no : ''),
        '成交依据：' + f.basis.text,
        ...basis.map(b => b.k + '：' + b.v),
        ...lines.map(
          l =>
            l.label +
            ' = ' +
            l.formula +
            (l.value != null ? ' = ' + formatFen(l.value) + ' 元' : '') +
            (l.note ? '（' + l.note + '）' : ''),
        ),
        ...(f.divTaxPending
          ? [
              '股息红利税补 ' +
                formatFen(f.divTaxPending) +
                ' 元，下一交易日扣：' +
                (f.divTaxNotes ?? []).join('；'),
            ]
          : []),
        feeState,
      ],
      tip: '成交依据说明这笔模拟成交是凭哪个快照、哪一档、多少量算出来的；模拟撮合拿不准时按保守处理。',
    };
  });

  if (!f) {
    return (
      <View style={s.page}>
        <NavBar title="成交详情" back />
        <Empty text="找不到这笔成交。" />
      </View>
    );
  }

  return (
    <View style={s.page}>
      <NavBar title="成交详情" sub={f.no} back />
      <ScrollView contentContainerStyle={s.pad}>
        <View style={s.card}>
          <View style={s.head}>
            <View style={s.headL}>
              <SideBadge side={f.side} />
              <Text style={s.title}>
                {name} {sideName} {fmtQty(f.qty)}
                {unit} @{' '}
              </Text>
              <Text style={[s.title, num]}>{formatPrice(f.price, d)}</Text>
            </View>
          </View>
          <Text style={[s.meta, num]}>
            {f.date} {formatSec(f.t)} · 成交编号 {f.no}
            {o ? ' · 合同号 ' + o.no : ''}
          </Text>
          {o ? (
            <Pressable
              onPress={() => nav.navigate('OrderDetail', { id: o.id })}
              style={({ pressed }) => [s.linkRow, pressed && s.pressed]}
            >
              <Text style={s.link}>查看委托 ›</Text>
            </Pressable>
          ) : null}
        </View>

        <SectionTitle title="成交依据" />
        <Note tone="learn" style={s.note}>
          {f.basis.text}
        </Note>
        <View style={s.card}>
          {basis.map(b => (
            <KV key={b.k} k={b.k} v={b.v} />
          ))}
        </View>

        <SectionTitle title="费用怎么算" />
        <View style={s.card}>
          {lines.map(l => (
            <View key={l.label} style={s.feeRow}>
              <View style={s.feeLine}>
                <Text style={s.k}>{l.label}</Text>
                <Text style={[s.v, num, l.value == null && s.muted]}>
                  {l.value != null ? formatFen(l.value) : '—'}
                </Text>
              </View>
              <Text style={[s.formula, num]}>{l.formula}</Text>
              {l.note ? <Text style={s.feeNote}>{l.note}</Text> : null}
            </View>
          ))}
        </View>
        {f.divTaxPending ? (
          <Note tone="warn" style={s.note}>
            股息红利税补 {formatFen(f.divTaxPending)}{' '}
            元，下一交易日从资金账户扣收：
            {(f.divTaxNotes ?? []).join('；')}
          </Note>
        ) : null}
        <Note style={s.note}>{feeState}</Note>
      </ScrollView>
      <AiFab />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { paddingBottom: 90 },
  card: { backgroundColor: color.card, paddingVertical: 6 },
  note: { marginHorizontal: 10, marginBottom: 8 },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: PAD,
    paddingVertical: 8,
  },
  headL: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  title: { fontSize: 16, fontWeight: '600', color: color.ink },
  code: { fontSize: 12, color: color.ink3, marginLeft: 6 },
  status: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12, color: color.ink2, paddingHorizontal: PAD },
  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: PAD,
    paddingVertical: 5,
    gap: 12,
  },
  k: { fontSize: 14, color: color.ink2 },
  v: { flexShrink: 1, fontSize: 14, color: color.ink, textAlign: 'right' },
  muted: { color: color.ink3 },
  noteText: {
    fontSize: 12,
    lineHeight: 18,
    color: color.ink2,
    paddingHorizontal: PAD,
    paddingTop: 4,
  },
  cancel: { paddingHorizontal: PAD, paddingTop: 10, paddingBottom: 6 },
  why: { fontSize: 12, color: color.ink3, marginTop: 6 },
  tl: { paddingHorizontal: PAD },
  step: { flexDirection: 'row', paddingVertical: 8, gap: 10 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
    backgroundColor: color.flat,
  },
  grow: { flex: 1 },
  stepT: { fontSize: 14, color: color.ink, fontWeight: '500' },
  stepSub: { fontSize: 12, lineHeight: 17, color: color.ink2, marginTop: 2 },
  link: { fontSize: 13, color: color.learn },
  linkRow: { paddingHorizontal: PAD, paddingVertical: 8 },
  pressed: { backgroundColor: color.press },
  feeRow: {
    paddingHorizontal: PAD,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  feeLine: { flexDirection: 'row', justifyContent: 'space-between' },
  formula: { fontSize: 12, color: color.ink3, marginTop: 2 },
  feeNote: { fontSize: 11, lineHeight: 16, color: color.warnInk, marginTop: 2 },
});
