/**
 * 持仓（账户概览 + 持仓列表）和持仓详情（两种成本口径、持仓批次、这只的成交记录）。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { holdingOf } from '../../engine/account';
import { divTaxRate } from '../../engine/fees';
import { ruleOf } from '../../engine/securities';
import { formatFen, formatPrice } from '../../engine/units';
import {
  AccountCard,
  costOf,
  FillRow,
  PositionList,
  useAccount,
} from '../components/tradeRows';
import {
  AiFab,
  Button,
  Empty,
  NavBar,
  Details,
  SectionTitle,
} from '../components/ui';
import { fmtPct, fmtQty, fmtSignedFen, trendOf, unitOf } from '../format';
import { useAiContext, useCore, useQuoteCodes, useViewLog } from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { COST_BASIS_NAME, usePrefs } from '../prefs';
import { color, num, PAD, trendColor } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function PositionsScreen() {
  const core = useCore();
  const { sum, pos, floating } = useAccount();
  const basis = usePrefs(s => s.costBasis);
  useQuoteCodes(pos.map(p => p.code));
  useViewLog('positions', '查看 持仓（' + pos.length + ' 只）');
  useAiContext('Positions', () => ({
    name: '持仓',
    lines: [
      '总资产 ' +
        formatFen(sum.total) +
        ' 元，持仓市值 ' +
        formatFen(sum.marketValue) +
        ' 元，可用 ' +
        formatFen(sum.available) +
        ' 元，可取 ' +
        formatFen(sum.withdrawable) +
        ' 元，冻结 ' +
        formatFen(sum.frozen) +
        ' 元，浮动盈亏 ' +
        fmtSignedFen(floating) +
        ' 元',
      '成本口径：' + COST_BASIS_NAME[basis] + '（列表显示这个口径）',
      ...(pos.length
        ? pos.map(p => {
            const sec = core.sim.security(p.code);
            const d = sec ? ruleOf(sec).decimals : 2;
            const c = costOf(p, basis);
            return (
              (sec?.name ?? p.code) +
              '：持仓 ' +
              fmtQty(p.qty) +
              '，可卖 ' +
              fmtQty(p.sellable) +
              (p.todayBuy
                ? '（今日买入 ' + fmtQty(p.todayBuy) + ' T+1）'
                : '') +
              '，' +
              COST_BASIS_NAME[basis] +
              ' ' +
              formatPrice(c.price, 3) +
              '，现价 ' +
              formatPrice(p.lastPrice, d) +
              '，盈亏 ' +
              fmtSignedFen(c.pnl) +
              ' 元（' +
              fmtPct(c.pct) +
              '）'
            );
          })
        : ['没有持仓']),
    ],
    tip: '列表默认显示摊薄成本（和同花顺、东方财富一致）；可用是 T+1 之后能卖的数量。',
  }));
  return (
    <View style={s.page}>
      <NavBar title="持仓" back />
      <ScrollView contentContainerStyle={s.pad}>
        <AccountCard />
        <View style={s.gap} />
        <PositionList empty="还没有持仓。去买入第一笔吧。" />
      </ScrollView>
      <AiFab />
    </View>
  );
}

function KV({ k, v, c }: { k: string; v: string; c?: string }) {
  return (
    <View style={s.kv}>
      <Text style={s.k}>{k}</Text>
      <Text style={[s.v, num, c ? { color: c } : null]}>{v}</Text>
    </View>
  );
}

export function PositionScreen({ route }: RootScreenProps<'Position'>) {
  const { code } = route.params;
  const core = useCore();
  const nav = useNavigation<Nav>();
  const { pos, state } = useAccount();
  useQuoteCodes([code]);
  const sec = core.sim.security(code);
  const name = sec?.name ?? code.slice(2);
  const d = sec ? ruleOf(sec).decimals : 2;
  const unit = unitOf(code, sec?.type);
  const p = pos.find(x => x.code === code) ?? null;
  const h = holdingOf(state, code);
  const lots = state.lots.filter(l => l.code === code);
  const fills = state.fills.filter(f => f.code === code);
  const today = state.date;
  const dil = p ? costOf(p, 'diluted') : null;
  const avg = p ? costOf(p, 'average') : null;
  useViewLog('position:' + code, '查看 持仓详情 ' + name);
  useAiContext('Position:' + code, () => ({
    name: '持仓详情 · ' + name,
    lines: p
      ? [
          '代码 ' +
            code.slice(2) +
            '，现价 ' +
            formatPrice(p.lastPrice, d) +
            '，持仓 ' +
            fmtQty(p.qty) +
            ' ' +
            unit +
            '，可卖 ' +
            fmtQty(p.sellable) +
            '，今日买入（T+1 冻结）' +
            fmtQty(h.todayBuy) +
            '，卖单冻结 ' +
            fmtQty(h.frozenSell) +
            '，市值 ' +
            formatFen(p.marketValue) +
            ' 元',
          '摊薄成本 ' +
            formatPrice(dil!.price, 3) +
            '（成本池 ' +
            formatFen(dil!.cost) +
            ' 元），盈亏 ' +
            fmtSignedFen(dil!.pnl) +
            ' 元（' +
            fmtPct(dil!.pct) +
            '）',
          '买入均价 ' +
            formatPrice(avg!.price, 3) +
            '（成本池 ' +
            formatFen(avg!.cost) +
            ' 元），盈亏 ' +
            fmtSignedFen(avg!.pnl) +
            ' 元（' +
            fmtPct(avg!.pct) +
            '）',
          ...lots.map(
            l =>
              '批次：' +
              l.buyDate +
              ' 买入 ' +
              fmtQty(l.qty) +
              ' ' +
              unit +
              (l.dividend
                ? '，持有期间红利 ' + formatFen(l.dividend) + ' 元'
                : '') +
              '，今天卖出的红利税档位：' +
              divTaxRate(l.buyDate, today).label,
          ),
          '这只共有成交 ' + fills.length + ' 笔',
        ]
      : ['现在没有持有' + name],
    tip: '摊薄成本把卖出盈利和分红都算成降低成本，买入均价只看买入花了多少钱；两者差额就是已经落袋的盈亏和分红。',
  }));

  return (
    <View style={s.page}>
      <NavBar title={name} sub={code.slice(2) + ' · 持仓详情'} back />
      <ScrollView contentContainerStyle={s.pad}>
        {!p ? (
          <Empty text={'现在没有持有' + name + '。'} />
        ) : (
          <>
            <View style={s.card}>
              <KV k="现价" v={formatPrice(p.lastPrice, d)} />
              <KV k="持仓" v={fmtQty(p.qty) + ' ' + unit} />
              <KV k="可卖" v={fmtQty(p.sellable) + ' ' + unit} />
              <KV
                k="今日买入（T+1 冻结）"
                v={fmtQty(h.todayBuy) + ' ' + unit}
              />
              <KV k="卖单冻结" v={fmtQty(h.frozenSell) + ' ' + unit} />
              <KV k="市值" v={formatFen(p.marketValue)} />
            </View>

            <SectionTitle title="持仓成本（两种口径）" />
            <View style={s.costRow}>
              {[
                { label: '摊薄成本', c: dil! },
                { label: '买入均价', c: avg! },
              ].map(({ label, c }) => {
                const tc = trendColor[trendOf(c.pnl)];
                return (
                  <View key={label} style={s.costBox}>
                    <Text style={s.costT}>{label}</Text>
                    <Text style={[s.costPx, num]}>
                      {formatPrice(c.price, 3)}
                    </Text>
                    <Text style={[s.costSub, num]}>
                      成本池 {formatFen(c.cost)}
                    </Text>
                    <Text style={[s.costSub, num, { color: tc }]}>
                      盈亏 {fmtSignedFen(c.pnl)}（{fmtPct(c.pct)}）
                    </Text>
                  </View>
                );
              })}
            </View>
            <Details title="成本计算方式">
              <Text style={s.costHelp}>
                摊薄成本 =（买入金额 + 买入费用 − 卖出回款 − 现金红利 +
                红利税补）÷ 持仓。
                {'\n'}买入均价 = 剩余买入成本（含费用）÷
                持仓；卖出和分红不改变均价。
                {'\n'}送转后成本按股数摊薄，清仓后归零。
              </Text>
            </Details>

            <SectionTitle title="持仓批次" right="先进先出，算红利税用" />
            <View style={s.card}>
              {lots.map(l => (
                <View key={l.id} style={s.lot}>
                  <View style={s.lotL}>
                    <Text style={[s.lotT, num]}>
                      {l.buyDate} 买入 {fmtQty(l.qty)} {unit}
                    </Text>
                    <Text style={s.lotSub}>
                      {l.dividend
                        ? '持有期间红利 ' + formatFen(l.dividend) + ' 元；'
                        : ''}
                      今天卖出：{divTaxRate(l.buyDate, today).label}
                      {l.buyDate === today ? '（今天买的要明天才能卖）' : ''}
                    </Text>
                  </View>
                </View>
              ))}
              <Text style={s.small}>
                卖出时按买入先后（先进先出）确定卖的是哪一批；持有期间分过红的，按这批的持股期限补扣红利税（≤1
                个月 20%，1 个月至 1 年 10%，超过 1 年免税），下一交易日扣。
              </Text>
            </View>
          </>
        )}

        <SectionTitle title="成交记录" right={fills.length + ' 笔'} />
        {fills.length ? (
          fills.map(f => (
            <FillRow
              key={f.id}
              fill={f}
              today={today}
              onPress={() => nav.navigate('FillDetail', { id: f.id })}
            />
          ))
        ) : (
          <Empty text="还没有这只的成交。" />
        )}

        <View style={s.btns}>
          <View style={s.grow}>
            <Button
              title="买入"
              tone="buy"
              onPress={() => nav.navigate('Order', { side: 'B', code, name })}
            />
          </View>
          <View style={s.grow}>
            <Button
              title="卖出"
              tone="sell"
              onPress={() => nav.navigate('Order', { side: 'S', code, name })}
            />
          </View>
          <View style={s.grow}>
            <Button
              title="行情"
              onPress={() =>
                nav.navigate('Stock', { code, name, type: sec?.type })
              }
            />
          </View>
        </View>
      </ScrollView>
      <AiFab />
    </View>
  );
}

const s = StyleSheet.create({
  costHelp: { fontSize: 12, lineHeight: 20, color: color.ink2 },
  page: { flex: 1, backgroundColor: color.bg },
  pad: { paddingBottom: 90 },
  gap: { height: 8 },
  card: { backgroundColor: color.card, paddingVertical: 4 },
  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: PAD,
    paddingVertical: 6,
  },
  k: { fontSize: 14, color: color.ink2 },
  v: { fontSize: 14, color: color.ink },
  costRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 10 },
  costBox: {
    flex: 1,
    backgroundColor: color.card,
    borderRadius: 8,
    padding: 12,
  },
  costT: { fontSize: 13, color: color.ink2 },
  costPx: { fontSize: 22, fontWeight: '600', color: color.ink, marginTop: 4 },
  costSub: { fontSize: 12, color: color.ink2, marginTop: 3 },
  lot: {
    flexDirection: 'row',
    paddingHorizontal: PAD,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  lotL: { flex: 1 },
  lotT: { fontSize: 14, color: color.ink },
  lotSub: { fontSize: 12, color: color.ink2, marginTop: 2 },
  small: {
    fontSize: 11,
    lineHeight: 16,
    color: color.ink3,
    paddingHorizontal: PAD,
    paddingVertical: 8,
  },
  btns: { flexDirection: 'row', gap: 10, padding: 12 },
  grow: { flex: 1 },
});
