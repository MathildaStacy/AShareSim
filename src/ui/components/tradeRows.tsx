/**
 * 交易类页面共用的块：账户概览、持仓列表、委托行、成交行、委托状态颜色。
 * 交易 Tab、下单页（撤单 / 持仓分段）、持仓页、查询页都用这些。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { positions, summary, type Position } from '../../engine/account';
import { ruleOf } from '../../engine/securities';
import { formatSec } from '../../engine/session';
import {
  KIND_NAME,
  type Fill,
  type Order,
  type OrderStatus,
} from '../../engine/types';
import { formatFen, formatPrice } from '../../engine/units';
import { todayPnl } from '../../sim/pnl';
import { fmtPct, fmtQty, fmtSignedFen, tagsOf, trendOf } from '../format';
import { useCore, useLive } from '../hooks';
import type { RootStackParamList } from '../navigation/types';
import { usePrefs, type CostBasis } from '../prefs';
import { color, num, PAD, trendColor } from '../theme';
import { Empty, Tags } from './ui';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** 账户数字：总资产、市值、可用、可取、冻结、浮动盈亏、当日参考盈亏。 */
export function useAccount() {
  const core = useCore();
  useLive();
  const sim = core.sim;
  const st = sim.engine.state;
  const priceOf = (c: string) => sim.engine.lastPrice(c);
  const sum = summary(st, priceOf);
  const pos = positions(st, priceOf);
  const floating = pos.reduce((a, p) => a + p.pnl, 0);
  const today = todayPnl(st, c => {
    const s = sim.engine.snapshot(c);
    return s && s.date === st.date
      ? { last: s.last, prevClose: s.prevClose }
      : null;
  });
  return { sum, pos, floating, today, state: st };
}

/** 某个口径下的成本价和盈亏。 */
export function costOf(p: Position, basis: CostBasis) {
  const price = basis === 'diluted' ? p.dilutedPrice : p.averagePrice;
  const cost = basis === 'diluted' ? p.dilutedCost : p.averageCost;
  const pnl = p.marketValue - cost;
  return { price, cost, pnl, pct: cost > 0 ? (pnl / cost) * 100 : 0 };
}

export function AccountCard() {
  const { sum, floating, today, state } = useAccount();
  const cell = (k: string, v: string, c?: string) => (
    <View style={s.acCell}>
      <Text style={s.acK}>{k}</Text>
      <Text style={[s.acV, num, c ? { color: c } : null]}>{v}</Text>
    </View>
  );
  return (
    <View style={s.card}>
      <View style={s.acTop}>
        <Text style={s.acK}>总资产（元）· 模拟账户 · {state.date}</Text>
        <Text style={[s.acTotal, num]}>{formatFen(sum.total)}</Text>
      </View>
      <View style={s.acGrid}>
        {cell(
          '浮动盈亏',
          fmtSignedFen(floating),
          trendColor[trendOf(floating)],
        )}
        {cell('当日参考盈亏', fmtSignedFen(today), trendColor[trendOf(today)])}
        {cell('持仓市值', formatFen(sum.marketValue))}
        {cell('可用', formatFen(sum.available))}
        {cell('可取', formatFen(sum.withdrawable))}
        {cell('冻结', formatFen(sum.frozen))}
      </View>
    </View>
  );
}

/** 持仓列表：名称 / 市值、盈亏 / 盈亏率、持仓 / 可用、成本 / 现价。成本按设置的口径（默认摊薄成本）。 */
export function PositionList({
  onPress,
  empty = '还没有持仓。',
}: {
  onPress?: (p: Position) => void;
  empty?: string;
}) {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const { pos } = useAccount();
  const basis = usePrefs(st => st.costBasis);
  if (!pos.length) {
    return <Empty text={empty} />;
  }
  return (
    <View style={s.card}>
      <View style={[s.pRow, s.pHead]}>
        <Text style={[s.pc1, s.headText]}>名称/市值</Text>
        <Text style={[s.pc, s.headText]}>盈亏/盈亏率</Text>
        <Text style={[s.pc, s.headText]}>持仓/可用</Text>
        <Text style={[s.pc, s.headText]}>
          {basis === 'diluted' ? '摊薄成本' : '买入均价'}/现价
        </Text>
      </View>
      {pos.map(p => {
        const sec = core.sim.security(p.code);
        const d = sec ? ruleOf(sec).decimals : 2;
        const c = costOf(p, basis);
        const tc = trendColor[trendOf(c.pnl)];
        return (
          <Pressable
            key={p.code}
            onPress={() =>
              onPress ? onPress(p) : nav.navigate('Position', { code: p.code })
            }
            style={({ pressed }) => [s.pRow, pressed && s.pressed]}
            accessibilityRole="button"
          >
            <View style={s.pc1}>
              <View style={s.nameLine}>
                <Text style={s.name} numberOfLines={1}>
                  {sec?.name ?? p.code}
                </Text>
                <Tags tags={tagsOf(p.code, sec?.name ?? '', sec?.type)} />
              </View>
              <Text style={[s.sub, num]}>{formatFen(p.marketValue)}</Text>
            </View>
            <View style={s.pc}>
              <Text style={[s.val, num, { color: tc }]}>
                {fmtSignedFen(c.pnl)}
              </Text>
              <Text style={[s.sub, num, { color: tc }]}>{fmtPct(c.pct)}</Text>
            </View>
            <View style={s.pc}>
              <Text style={[s.val, num]}>{fmtQty(p.qty)}</Text>
              <Text style={[s.sub, num]}>
                {fmtQty(p.sellable)}
                {p.todayBuy ? ' · T+1' : ''}
              </Text>
            </View>
            <View style={s.pc}>
              <Text style={[s.val, num]}>{formatPrice(c.price, 3)}</Text>
              <Text
                style={[
                  s.sub,
                  num,
                  { color: trendColor[trendOf(p.lastPrice - c.price)] },
                ]}
              >
                {formatPrice(p.lastPrice, d)}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export const STATUS_COLOR: Record<OrderStatus, string> = {
  未报: color.warn,
  已报: color.sell,
  部成: color.sell,
  已成: color.down,
  已撤: color.ink3,
  部撤: color.ink3,
  废单: color.up,
};

export function SideBadge({ side }: { side: 'B' | 'S' }) {
  return (
    <Text
      style={[s.bs, { backgroundColor: side === 'B' ? color.up : color.sell }]}
    >
      {side === 'B' ? '买' : '卖'}
    </Text>
  );
}

/** 一行委托。right 不传时显示状态。 */
export function OrderRow({
  order: o,
  onPress,
  right,
  today,
}: {
  order: Order;
  onPress?: () => void;
  right?: ReactNode;
  /** 当前交易日；委托不是今天的就在时间前面加日期。 */
  today: string;
}) {
  const core = useCore();
  const sec = core.sim.security(o.code);
  const d = sec ? ruleOf(sec).decimals : 2;
  const avg = o.filled ? Math.round((o.amount * 10) / o.filled) : null;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [s.oRow, pressed && s.pressed]}
      accessibilityRole="button"
    >
      <View style={s.l1}>
        <View style={s.nameLine}>
          <SideBadge side={o.side} />
          <Text style={s.name} numberOfLines={1}>
            {sec?.name ?? o.code}
          </Text>
          <Text style={[s.code, num]}>{o.code.slice(2)}</Text>
        </View>
        {right ?? (
          <Text style={[s.status, { color: STATUS_COLOR[o.status] }]}>
            {o.status}
          </Text>
        )}
      </View>
      <View style={s.l2}>
        <Text style={[s.l2t, num]}>
          {(o.date === today ? '' : o.date.slice(5) + ' ') + formatSec(o.t)} ·{' '}
          {KIND_NAME[o.kind]}
        </Text>
        <Text style={[s.l2t, num]}>
          委托{' '}
          {o.price != null && o.kind !== 'after'
            ? formatPrice(o.price, d)
            : o.kind === 'after'
            ? '收盘价'
            : '市价'}{' '}
          × {fmtQty(o.qty)}
        </Text>
        <Text style={[s.l2t, num]}>
          成交{' '}
          {avg != null ? formatPrice(avg, d) + ' × ' + fmtQty(o.filled) : '0'}
        </Text>
      </View>
      {o.reason || o.note ? (
        <Text style={s.note} numberOfLines={2}>
          {o.reason || o.note}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** 一行成交，下面带成交依据。 */
export function FillRow({
  fill: f,
  onPress,
  today,
}: {
  fill: Fill;
  onPress?: () => void;
  today: string;
}) {
  const core = useCore();
  const sec = core.sim.security(f.code);
  const d = sec ? ruleOf(sec).decimals : 2;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [s.oRow, pressed && s.pressed]}
      accessibilityRole="button"
    >
      <View style={s.l1}>
        <View style={s.nameLine}>
          <SideBadge side={f.side} />
          <Text style={s.name} numberOfLines={1}>
            {sec?.name ?? f.code}
          </Text>
          <Text style={[s.code, num]}>{f.code.slice(2)}</Text>
        </View>
        <Text style={[s.l2t, num]}>
          {(f.date === today ? '' : f.date.slice(5) + ' ') + formatSec(f.t)}
        </Text>
      </View>
      <View style={s.l2}>
        <Text style={[s.l2t, num]}>
          {formatPrice(f.price, d)} × {fmtQty(f.qty)}
        </Text>
        <Text style={[s.l2t, num]}>金额 {formatFen(f.amount)}</Text>
        <Text style={[s.l2t, num]}>费用 {formatFen(f.fee.total)}</Text>
      </View>
      <Text style={s.note} numberOfLines={2}>
        {f.basis.text}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: color.card },
  pressed: { backgroundColor: color.press },
  acTop: { paddingHorizontal: PAD, paddingTop: 14 },
  acTotal: { fontSize: 26, fontWeight: '600', color: color.ink, marginTop: 2 },
  acGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: PAD,
    paddingVertical: 10,
  },
  acCell: { width: '33.33%', paddingVertical: 4 },
  acK: { fontSize: 12, color: color.ink3 },
  acV: { fontSize: 14, color: color.ink, marginTop: 1 },
  pRow: {
    flexDirection: 'row',
    paddingHorizontal: PAD,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  pHead: { paddingVertical: 6 },
  headText: { fontSize: 11, color: color.ink3 },
  pc1: { flex: 1.25 },
  pc: { flex: 1, alignItems: 'flex-end' },
  nameLine: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  name: { fontSize: 15, color: color.ink, flexShrink: 1 },
  code: { fontSize: 11, color: color.ink3, marginLeft: 6 },
  val: { fontSize: 14, color: color.ink },
  sub: { fontSize: 12, color: color.ink2, marginTop: 2 },
  bs: {
    color: '#FFFFFF',
    fontSize: 11,
    lineHeight: 16,
    width: 16,
    textAlign: 'center',
    borderRadius: 2,
    marginRight: 6,
    overflow: 'hidden',
  },
  oRow: {
    backgroundColor: color.card,
    paddingHorizontal: PAD,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  l1: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  l2: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: 6,
  },
  l2t: { fontSize: 12, color: color.ink2 },
  status: { fontSize: 13, fontWeight: '600' },
  note: { fontSize: 11, lineHeight: 16, color: color.ink3, marginTop: 3 },
});
