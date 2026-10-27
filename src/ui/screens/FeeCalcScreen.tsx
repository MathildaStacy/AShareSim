/**
 * 费用计算器（M3，PRODUCT_DESIGN §6.4）：和下单页、交割单用同一个 calcFee 和当前费率。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatFen, formatPrice } from '../../engine/units';
import { recognizeCode } from '../../sim/calibrateForm';
import {
  FEE_CALC_FIELD_NAME,
  feeCalcSummary,
  parseFeeCalc,
  type FeeCalcField,
  type FeeCalcForm,
  type FeeCalcSide,
} from '../../sim/feeCalc';
import { FEE_STATE_NAME, feeState, rateText } from '../../sim/feeForm';
import { CheckBar, FieldRow } from '../components/form';
import { AiFab, Button, NavBar, Note, SectionTitle } from '../components/ui';
import {
  useAiContext,
  useCore,
  useLive,
  useQuoteCodes,
  useViewLog,
} from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { color, num, PAD } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function SideCard({ x, title }: { x: FeeCalcSide; title: string }) {
  return (
    <View style={s.side}>
      <Text
        style={[s.sideH, { color: x.side === 'B' ? color.up : color.sell }]}
      >
        {title}
      </Text>
      {x.lines.map(l => (
        <View key={l.label} style={s.feeRow}>
          <View style={s.feeTop}>
            <Text style={s.feeK}>{l.label}</Text>
            <Text style={[s.feeV, num]}>
              {l.value == null ? '-' : formatFen(l.value)}
            </Text>
          </View>
          <Text style={[s.formula, num]}>{l.formula}</Text>
        </View>
      ))}
      <View style={[s.feeTop, s.total]}>
        <Text style={s.totalK}>合计</Text>
        <Text style={[s.totalV, num]}>{formatFen(x.fee.total)}</Text>
      </View>
    </View>
  );
}

export function FeeCalcScreen({ route }: RootScreenProps<'FeeCalc'>) {
  const core = useCore();
  const nav = useNavigation<Nav>();
  useLive();
  const sim = core.sim;
  const fee = sim.engine.state.fee;
  const [form, setForm] = useState<FeeCalcForm>(() => {
    const p = route.params;
    const code = p?.code ?? 'sh600036';
    const q = sim.quote(code);
    const d = sim.security(code)?.board === 'etf' ? 3 : 2;
    const price = p?.price ?? q?.snapshot.last;
    return {
      code: code.slice(2),
      price: price != null ? formatPrice(price, d) : '40.00',
      qty: p?.qty ? String(p.qty) : '1000',
    };
  });
  // AI 填好的价格不要被现价覆盖
  const [priceEdited, setPriceEdited] = useState(route.params?.price != null);
  const rec = recognizeCode(form.code);
  useQuoteCodes(rec ? [rec.code] : []);
  const liveLast = rec ? sim.quote(rec.code)?.snapshot.last ?? null : null;
  // 打开时行情还没到：到了以后用现价填价格（你改过就不动）
  useEffect(() => {
    if (!priceEdited && liveLast != null && rec) {
      setForm(f => ({
        ...f,
        price: formatPrice(liveLast, rec.board === 'etf' ? 3 : 2),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveLast, priceEdited, rec?.code]);
  const parsed = parseFeeCalc(form, fee);
  const errOf = (f: FeeCalcField) =>
    parsed.ok ? null : parsed.errors.find(e => e.field === f)?.msg ?? null;
  const name = rec ? sim.security(rec.code)?.name ?? rec.code : '';
  const q = rec ? sim.quote(rec.code) : null;
  const d = rec?.board === 'etf' ? 3 : 2;
  const set = (k: FeeCalcField) => (v: string) =>
    setForm(f => ({ ...f, [k]: v }));
  const stStock = feeState(fee, 'stock');
  const stEtf = feeState(fee, 'etf');
  const feeLine =
    '股票' +
    rateText(fee, 'stock') +
    '（' +
    FEE_STATE_NAME[stStock] +
    '）；ETF ' +
    rateText(fee, 'etf') +
    '（' +
    FEE_STATE_NAME[stEtf] +
    '）';

  useViewLog('feecalc', '查看 费用计算器');
  useAiContext('FeeCalc', () => ({
    name: '学习 · 费用计算器',
    lines: [
      '输入：代码 ' +
        form.code +
        (name ? '（' + name + '）' : '') +
        '，价格 ' +
        form.price +
        '，数量 ' +
        form.qty,
      parsed.ok
        ? '校验通过'
        : '校验不通过：' + parsed.errors.map(e => e.msg).join('；'),
      ...(parsed.ok ? feeCalcSummary(parsed.result, name) : []),
      '费率：' + feeLine,
    ],
    tip: '佣金是券商收的（有最低 5 元）；印花税 0.05% 只在卖出时收，ETF 免；过户费 0.001% 双向，ETF 不收。经手费、证管费默认含在佣金里。',
  }));

  const r = parsed.ok ? parsed.result : null;
  return (
    <View style={s.page}>
      <NavBar title="费用计算器" back />
      <ScrollView
        contentContainerStyle={s.pad}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.card}>
          <FieldRow
            label={FEE_CALC_FIELD_NAME.code}
            sub={
              rec
                ? name +
                  (rec.board === 'etf' ? ' · ETF' : ' · 股票') +
                  (q?.snapshot.last != null
                    ? ' · 现价 ' + formatPrice(q.snapshot.last, d)
                    : '')
                : '6 位代码，按代码段认股票 / ETF'
            }
            value={form.code}
            onChangeText={set('code')}
            keyboardType="number-pad"
            error={errOf('code')}
          />
          <FieldRow
            label={FEE_CALC_FIELD_NAME.price}
            value={form.price}
            onChangeText={v => {
              setPriceEdited(true);
              set('price')(v);
            }}
            unit="元"
            error={errOf('price')}
          />
          <FieldRow
            label={FEE_CALC_FIELD_NAME.qty}
            value={form.qty}
            onChangeText={set('qty')}
            unit={rec?.board === 'etf' ? '份' : '股'}
            keyboardType="number-pad"
            error={errOf('qty')}
          />
        </View>
        {r ? (
          <>
            <CheckBar
              ok
              text={
                '成交额 ' +
                formatFen(r.amount) +
                ' 元 = ' +
                formatPrice(r.price, r.decimals) +
                ' × ' +
                r.qty.toLocaleString('zh-CN')
              }
            />
            <View style={[s.card, s.sides]}>
              <SideCard x={r.buy} title="买入" />
              <View style={s.vline} />
              <SideCard x={r.sell} title="卖出" />
            </View>
            <View style={s.card}>
              <SectionTitle title="买卖一个来回" />
              <View style={s.kv}>
                <Text style={s.kvK}>来回费用</Text>
                <Text style={[s.kvV, num]}>
                  {formatFen(r.roundTrip)} 元（{r.roundTripPct.toFixed(3)}%）
                </Text>
              </View>
              <View style={s.kv}>
                <Text style={s.kvK}>保本卖出价</Text>
                <Text style={[s.kvV, num]}>
                  {formatPrice(r.breakEven, r.decimals)}（涨{' '}
                  {r.breakEvenPct.toFixed(2)}%）
                </Text>
              </View>
              <Text style={s.small}>保本价已计入买入和卖出费用。</Text>
            </View>
            {r.minThreshold != null && r.amount < r.minThreshold ? (
              <Note tone="warn" style={s.note}>
                这笔佣金按费率只有 {formatFen(r.buy.byRate)}{' '}
                元，被最低佣金抬到了 {formatFen(r.buy.fee.commission)}{' '}
                元。成交额 {formatFen(r.minThreshold)} 元以上才按费率收。
              </Note>
            ) : null}
          </>
        ) : null}
        <View style={s.card}>
          <SectionTitle title="费率" right="和下单页、交割单一致" />
          <Text style={s.rate}>{feeLine}</Text>
          <View style={s.btns}>
            <Button
              title="去费率设置"
              small
              onPress={() => nav.navigate('Fees')}
            />
            <Button
              title="规则课：交易费用"
              tone="learn"
              small
              onPress={() => nav.navigate('Lesson', { id: 'fee' })}
            />
          </View>
        </View>
      </ScrollView>
      <AiFab />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { paddingBottom: 90 },
  card: { backgroundColor: color.card, marginTop: 8 },
  note: { margin: 10 },
  sides: { flexDirection: 'row' },
  vline: { width: StyleSheet.hairlineWidth, backgroundColor: color.line },
  side: { flex: 1, paddingHorizontal: 10, paddingVertical: 10 },
  sideH: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  feeRow: { paddingVertical: 5 },
  feeTop: { flexDirection: 'row', justifyContent: 'space-between' },
  feeK: { fontSize: 13, color: color.ink },
  feeV: { fontSize: 13, color: color.ink, fontWeight: '500' },
  formula: { fontSize: 11, lineHeight: 15, color: color.ink3, marginTop: 1 },
  total: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    paddingTop: 6,
    marginTop: 4,
  },
  totalK: { fontSize: 14, color: color.ink, fontWeight: '600' },
  totalV: { fontSize: 14, color: color.ink, fontWeight: '700' },
  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: PAD,
    paddingVertical: 5,
  },
  kvK: { fontSize: 14, color: color.ink2 },
  kvV: { fontSize: 14, color: color.ink, fontWeight: '500' },
  small: {
    fontSize: 12,
    lineHeight: 18,
    color: color.ink3,
    paddingHorizontal: PAD,
    paddingBottom: 12,
    paddingTop: 4,
  },
  rate: { fontSize: 13, color: color.ink2, paddingHorizontal: PAD },
  btns: { flexDirection: 'row', gap: 8, padding: 12 },
});
