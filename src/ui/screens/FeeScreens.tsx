/**
 * 费率设置、交割单校准（M2 第 4 步，PRODUCT_DESIGN §6.3）。
 * 改费率只对之后提交的委托生效：已挂委托（含预埋单）按提交时记下的费率冻结和计费（§10）。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import * as repo from '../../data/repos';
import { isLive } from '../../engine/account';
import { STATUTORY, wanText, type Side } from '../../engine/fees';
import { formatFen } from '../../engine/units';
import { beijingIso } from '../../market/clock';
import {
  applySuggestion,
  compareSlip,
  EMPTY_SLIP,
  recognizeCode,
  SLIP_FIELD_NAME,
  type SlipField,
  type SlipForm,
} from '../../sim/calibrateForm';
import {
  FEE_FIELD_NAME,
  FEE_STATE_NAME,
  feeDiff,
  feeState,
  formOf,
  isMian5,
  parseFeeForm,
  rateText,
  toggleMian5,
  yuanText,
  type FeeField,
  type FeeForm,
} from '../../sim/feeForm';
import { ratePct } from '../../sim/fillExplain';
import {
  CheckBar,
  ChoiceRow,
  FieldRow,
  KV,
  SwitchRow,
} from '../components/form';
import { AiFab, Button, NavBar, Note, SectionTitle } from '../components/ui';
import { useAiContext, useCore, useLive, useViewLog } from '../hooks';
import type { RootStackParamList } from '../navigation/types';
import { color, num, PAD } from '../theme';
import { toast } from '../toast';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const onOff = (v: boolean) => (v ? '开' : '关');

// ---------- 费率设置 ----------

export function FeesScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  useLive();
  const sim = core.sim;
  const fee = sim.engine.state.fee;
  const feeKey = JSON.stringify(fee);
  const [form, setForm] = useState<FeeForm>(() => formOf(fee));
  const [busy, setBusy] = useState(false);
  // 费率在别处改了（交割单校准套用）就重新填表
  useEffect(() => {
    setForm(formOf(JSON.parse(feeKey)));
  }, [feeKey]);
  const parsed = parseFeeForm(form, fee);
  const diff = parsed.ok ? feeDiff(fee, parsed.profile) : [];
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(fee));
  const errOf = (f: FeeField) =>
    parsed.ok ? null : parsed.errors.find(e => e.field === f)?.msg ?? null;
  const live = sim.engine.state.orders.filter(isLive);
  const set = (k: keyof FeeForm) => (v: string | boolean) =>
    setForm(f => ({ ...f, [k]: v }));
  const stStock = feeState(fee, 'stock');
  const stEtf = feeState(fee, 'etf');

  useViewLog('fees', '查看 费率设置');
  useAiContext('Fees', () => ({
    name: '费率设置',
    lines: [
      '当前费率：股票' +
        rateText(fee, 'stock') +
        '（' +
        FEE_STATE_NAME[stStock] +
        '）；ETF ' +
        rateText(fee, 'etf') +
        '（' +
        FEE_STATE_NAME[stEtf] +
        '）；规费另收 ' +
        onOff(fee.regsSeparate) +
        '，合并计佣 ' +
        onOff(fee.mergeOrder),
      '表单：股票佣金率 万 ' +
        form.stockWan +
        '，股票最低佣金 ' +
        form.stockMin +
        ' 元，ETF 佣金率 万 ' +
        form.etfWan +
        '，ETF 最低佣金 ' +
        form.etfMin +
        ' 元，免五 ' +
        onOff(isMian5(form)) +
        '，规费另收 ' +
        onOff(form.regsSeparate) +
        '，合并计佣 ' +
        onOff(form.mergeOrder),
      parsed.ok
        ? '表单校验通过' +
          (diff.length ? '，未保存的修改：' + diff.join('，') : '，没有修改')
        : '表单校验不通过：' + parsed.errors.map(e => e.msg).join('；'),
      '未完成委托 ' +
        live.length +
        ' 笔' +
        (live.length ? '：改费率不影响它们，仍按提交时的费率冻结和计费' : ''),
    ],
    tip: '佣金是券商收的，可以谈；印花税、过户费是法定的，不能改。可用真实交割单核对佣金设置。',
  }));

  const save = async () => {
    if (!parsed.ok || busy) {
      return;
    }
    setBusy(true);
    try {
      const d = await sim.setFeeProfile(parsed.profile);
      toast.show(d.length ? '费率已保存，只对之后的委托生效' : '没有修改');
    } finally {
      setBusy(false);
    }
  };

  const field = (f: FeeField, unit: string, sub?: string) => (
    <FieldRow
      label={FEE_FIELD_NAME[f]}
      sub={sub}
      value={form[f]}
      onChangeText={set(f)}
      unit={unit}
      error={errOf(f)}
    />
  );

  return (
    <View style={s.page}>
      <NavBar title="费率设置" back />
      <ScrollView
        contentContainerStyle={s.pad}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.status}>
          <StatusPill
            label="股票"
            state={FEE_STATE_NAME[stStock]}
            ok={stStock === 'calibrated'}
          />
          <StatusPill
            label="ETF"
            state={FEE_STATE_NAME[stEtf]}
            ok={stEtf === 'calibrated'}
          />
        </View>
        <View style={s.card}>
          <SectionTitle title="佣金" />
          {field('stockWan', '‱')}
          {field('stockMin', '元')}
          {field('etfWan', '‱')}
          {field('etfMin', '元')}
          <SwitchRow
            label="免五"
            sub="最低佣金设为 0.1 元"
            value={isMian5(form)}
            onChange={v => setForm(f => toggleMian5(f, v))}
          />
          <SwitchRow
            label="规费另收"
            sub="开启后，经手费、证管费不计入佣金"
            value={form.regsSeparate}
            onChange={set('regsSeparate')}
          />
          <SwitchRow
            label="同一委托多笔成交合并计佣"
            value={form.mergeOrder}
            onChange={set('mergeOrder')}
          />
        </View>
        {!parsed.ok ? (
          <CheckBar
            ok={false}
            text={parsed.errors.map(e => e.msg).join('；')}
          />
        ) : diff.length ? (
          <CheckBar ok text={'未保存的修改：' + diff.join('，')} />
        ) : null}
        {live.length ? (
          <Note style={s.note}>
            已挂的 {live.length} 笔委托沿用原费率，需撤单重下才能使用新费率。
          </Note>
        ) : null}
        <View style={s.btns}>
          <View style={s.grow}>
            <Button
              title="恢复表单"
              disabled={!dirty}
              onPress={() => setForm(formOf(fee))}
            />
          </View>
          <View style={s.grow}>
            <Button
              title={busy ? '保存中…' : '保存'}
              tone="buy"
              disabled={!parsed.ok || !diff.length || busy}
              onPress={save}
            />
          </View>
        </View>
        <View style={s.card}>
          <SectionTitle title="法定费用" />
          <KV
            k="印花税"
            v={'卖出 ' + ratePct(STATUTORY.stamp) + '（ETF 免征）'}
          />
          <KV
            k="过户费"
            v={'双向 ' + ratePct(STATUTORY.transfer) + '（ETF 免收）'}
          />
          <KV
            k="经手费"
            v={'双向 ' + ratePct(STATUTORY.handlingStock)}
            sub="默认含在佣金里"
          />
          <KV
            k="证管费"
            v={'双向 ' + ratePct(STATUTORY.reg)}
            sub="默认含在佣金里"
          />
          <KV k="红利税" v="≤1 月 20%，1 月–1 年 10%，＞1 年免" />
        </View>
        <View style={s.btns}>
          <View style={s.grow}>
            <Button
              title="用真实交割单校准"
              tone="learn"
              onPress={() => nav.navigate('Calibrate')}
            />
          </View>
          <View style={s.grow}>
            <Button
              title="费用计算器"
              onPress={() => nav.navigate('FeeCalc')}
            />
          </View>
        </View>
      </ScrollView>
      <AiFab />
    </View>
  );
}

function StatusPill({
  label,
  state,
  ok,
}: {
  label: string;
  state: string;
  ok: boolean;
}) {
  return (
    <View style={[s.pill, ok ? s.pillOk : null]}>
      <Text style={s.pillK}>{label}</Text>
      <Text style={[s.pillV, ok ? { color: color.down } : null]}>{state}</Text>
    </View>
  );
}

// ---------- 交割单校准 ----------

interface LastCalibration {
  ts: string;
  code: string;
  name: string;
  side: Side;
  allOk: boolean;
  note: string;
}

const SIDES: [Side, string][] = [
  ['B', '买入'],
  ['S', '卖出'],
];

const REQUIRED: SlipField[] = [
  'code',
  'price',
  'qty',
  'commission',
  'stamp',
  'transfer',
];

export function CalibrateScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  useLive();
  const sim = core.sim;
  const fee = sim.engine.state.fee;
  const [form, setForm] = useState<SlipForm>(EMPTY_SLIP);
  const [last, setLast] = useState<LastCalibration | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    repo
      .getSetting<LastCalibration | null>(core.db, 'lastCalibration', null)
      .then(setLast)
      .catch(() => undefined);
  }, [core]);
  const required = fee.regsSeparate
    ? [...REQUIRED, 'handling' as const, 'reg' as const]
    : REQUIRED;
  const missing = required.filter(k => !form[k].trim());
  const { parse, result } = compareSlip(form, fee);
  const errOf = (k: SlipField) =>
    !parse.ok && form[k].trim()
      ? parse.errors.find(e => e.field === k)?.msg ?? null
      : null;
  const rec = recognizeCode(form.code);
  const secName = rec
    ? sim.security(rec.code)?.name ??
      (rec.board === 'etf' ? 'ETF' : '股票') + ' ' + rec.code.slice(2)
    : null;
  const set = (k: SlipField) => (v: string) => setForm(f => ({ ...f, [k]: v }));
  const cls = rec?.board === 'etf' ? 'etf' : 'stock';
  const state = feeState(fee, cls);

  useViewLog('calibrate', '查看 交割单校准');
  useAiContext('Calibrate', () => ({
    name: '交割单校准',
    lines: [
      '录入：证券 ' +
        (form.code || '（未填）') +
        (secName ? '（' + secName + '）' : '') +
        '，' +
        (form.side === 'B' ? '买入' : '卖出') +
        '，成交价 ' +
        (form.price || '-') +
        '，数量 ' +
        (form.qty || '-') +
        '，成交金额 ' +
        (form.amount || '（选填未填）') +
        '，佣金 ' +
        (form.commission || '-') +
        '，印花税 ' +
        (form.stamp || '-') +
        '，过户费 ' +
        (form.transfer || '-') +
        (fee.regsSeparate
          ? '，经手费 ' +
            (form.handling || '-') +
            '，证管费 ' +
            (form.reg || '-')
          : ''),
      missing.length
        ? '还没填：' + missing.map(k => SLIP_FIELD_NAME[k]).join('、')
        : parse.ok
        ? '录入校验通过'
        : '录入校验不通过：' + parse.errors.map(e => e.msg).join('；'),
      ...(result
        ? [
            '比对（成交金额 ' +
              formatFen(result.amount) +
              ' 元）：' +
              result.items
                .map(
                  i =>
                    i.label +
                    ' App ' +
                    formatFen(i.app) +
                    ' / 交割单 ' +
                    formatFen(i.slip) +
                    (i.ok ? ' 一致' : ' 差 ' + formatFen(i.slip - i.app)),
                )
                .join('；'),
            '建议：' + result.note,
          ]
        : []),
      '当前费率：股票' +
        rateText(fee, 'stock') +
        '（' +
        FEE_STATE_NAME[feeState(fee, 'stock')] +
        '）；ETF ' +
        rateText(fee, 'etf') +
        '（' +
        FEE_STATE_NAME[feeState(fee, 'etf')] +
        '）',
    ],
    tip: '校准是「费用和真实一致」的验收：抄一条真实交割单，App 用当前费率逐项重算。佣金四舍五入到分，成交额越大反推出的费率越准；佣金正好是最低佣金时推不出费率。',
  }));

  const apply = async () => {
    if (!parse.ok || !result?.suggestion || busy) {
      return;
    }
    setBusy(true);
    try {
      const r = applySuggestion(parse.slip, fee, result.suggestion);
      await sim.setFeeProfile(r.profile, '按真实交割单校准');
      const rec2: LastCalibration = {
        ts: beijingIso(),
        code: parse.code,
        name: secName ?? parse.code,
        side: form.side,
        allOk: r.result.allOk,
        note: r.result.note,
      };
      await repo.setSetting(core.db, 'lastCalibration', rec2);
      setLast(rec2);
      toast.show(
        r.result.allOk
          ? '已套用，重新比对全部一致，标记为已校准'
          : '已套用，重新比对还有对不上的项，看下面的建议',
        r.result.allOk ? 'up' : 'warn',
      );
    } finally {
      setBusy(false);
    }
  };

  const suggestionText = () => {
    if (!result?.suggestion) {
      return null;
    }
    const sg = result.suggestion;
    if (result.allOk) {
      return state === 'calibrated'
        ? null
        : '标记' + (cls === 'etf' ? ' ETF ' : '股票') + '费率为已校准';
    }
    const rate = sg.stockRate ?? sg.etfRate;
    const min = sg.stockMinFen ?? sg.etfMinFen;
    return (
      '套用到费率设置（' +
      (cls === 'etf' ? 'ETF ' : '股票') +
      (rate != null ? wanText(rate) : '') +
      (min != null ? '，最低 ' + yuanText(min) + ' 元' : '') +
      '）'
    );
  };
  const applyTitle = suggestionText();

  return (
    <View style={s.page}>
      <NavBar title="交割单校准" back />
      <ScrollView
        contentContainerStyle={s.pad}
        keyboardShouldPersistTaps="handled"
      >
        <Note style={s.note}>一次填写一笔成交，多笔成交请拆开填写。</Note>
        <View style={s.card}>
          <FieldRow
            label="证券代码"
            sub={secName ?? '6 位代码，自动识别沪深和股票 / ETF'}
            value={form.code}
            onChangeText={set('code')}
            placeholder="例 600036"
            keyboardType="number-pad"
            error={errOf('code')}
          />
          <ChoiceRow
            label="方向"
            items={SIDES}
            value={form.side}
            onChange={v => setForm(f => ({ ...f, side: v }))}
          />
          <FieldRow
            label="成交价"
            value={form.price}
            onChangeText={set('price')}
            unit="元"
            placeholder="例 41.80"
            error={errOf('price')}
          />
          <FieldRow
            label="成交数量"
            value={form.qty}
            onChangeText={set('qty')}
            unit={rec?.board === 'etf' ? '份' : '股'}
            placeholder="例 1000"
            keyboardType="number-pad"
            error={errOf('qty')}
          />
          <FieldRow
            label="成交金额"
            sub="选填，用来对照成交价 × 数量"
            value={form.amount}
            onChangeText={set('amount')}
            unit="元"
            error={errOf('amount')}
          />
          <FieldRow
            label="佣金"
            value={form.commission}
            onChangeText={set('commission')}
            unit="元"
            placeholder="例 10.45"
            error={errOf('commission')}
          />
          <FieldRow
            label="印花税"
            sub="买入和 ETF 填 0"
            value={form.stamp}
            onChangeText={set('stamp')}
            unit="元"
            placeholder="例 20.90"
            error={errOf('stamp')}
          />
          <FieldRow
            label="过户费"
            sub="ETF 一般填 0"
            value={form.transfer}
            onChangeText={set('transfer')}
            unit="元"
            placeholder="例 0.42"
            error={errOf('transfer')}
          />
          {fee.regsSeparate ? (
            <>
              <FieldRow
                label="经手费"
                value={form.handling}
                onChangeText={set('handling')}
                unit="元"
                error={errOf('handling')}
              />
              <FieldRow
                label="证管费"
                value={form.reg}
                onChangeText={set('reg')}
                unit="元"
                error={errOf('reg')}
              />
            </>
          ) : null}
        </View>
        {missing.length ? (
          <Note style={s.note}>
            填完 {missing.map(k => SLIP_FIELD_NAME[k]).join('、')} 后自动比对。
          </Note>
        ) : null}
        {result ? (
          <>
            <SectionTitle
              title="比对"
              right={'成交金额 ' + formatFen(result.amount) + ' 元'}
            />
            <View style={s.card}>
              <View style={[s.tr, s.th]}>
                <Text style={[s.td1, s.thText]}>项目</Text>
                <Text style={[s.td, s.thText]}>App 计算</Text>
                <Text style={[s.td, s.thText]}>交割单</Text>
                <Text style={[s.td, s.thText]}>结果</Text>
              </View>
              {result.items.map(i => (
                <View key={i.key} style={s.tr}>
                  <Text style={s.td1}>{i.label}</Text>
                  <Text style={[s.td, num]}>{formatFen(i.app)}</Text>
                  <Text style={[s.td, num]}>{formatFen(i.slip)}</Text>
                  <Text
                    style={[s.td, num, { color: i.ok ? color.down : color.up }]}
                  >
                    {i.ok ? '一致' : '差 ' + formatFen(i.slip - i.app)}
                  </Text>
                </View>
              ))}
            </View>
            <CheckBar ok={result.allOk} text={result.note} />
            {applyTitle ? (
              <View style={s.btns}>
                <View style={s.grow}>
                  <Button
                    title={busy ? '套用中…' : applyTitle}
                    tone="learn"
                    disabled={busy}
                    onPress={apply}
                  />
                </View>
              </View>
            ) : null}
          </>
        ) : null}
        <View style={s.card}>
          <SectionTitle title="当前费率" />
          <KV
            k="股票"
            v={rateText(fee, 'stock')}
            sub={FEE_STATE_NAME[feeState(fee, 'stock')]}
          />
          <KV
            k="ETF"
            v={rateText(fee, 'etf')}
            sub={FEE_STATE_NAME[feeState(fee, 'etf')]}
          />
          <KV k="规费另收" v={onOff(fee.regsSeparate)} />
        </View>
        {last ? (
          <View style={s.card}>
            <SectionTitle
              title="上次校准"
              right={last.ts.slice(0, 16).replace('T', ' ')}
            />
            <Text style={s.lastText}>
              {last.name} {last.side === 'B' ? '买入' : '卖出'} ·{' '}
              {last.allOk ? '全部一致' : '还有对不上的项'}
              {'\n'}
              {last.note}
            </Text>
          </View>
        ) : null}
        <View style={s.btns}>
          <View style={s.grow}>
            <Button title="去费率设置" onPress={() => nav.navigate('Fees')} />
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
  note: { marginHorizontal: 10, marginTop: 8 },
  grow: { flex: 1 },
  btns: { flexDirection: 'row', gap: 10, paddingHorizontal: 10, marginTop: 10 },
  status: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 10,
  },
  pill: {
    flex: 1,
    backgroundColor: color.card,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: color.line,
  },
  pillOk: { borderColor: color.down },
  pillK: { fontSize: 12, color: color.ink3 },
  pillV: {
    fontSize: 14,
    color: color.warnInk,
    marginTop: 2,
    fontWeight: '500',
  },
  tr: {
    flexDirection: 'row',
    paddingHorizontal: PAD,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  th: { paddingVertical: 6 },
  thText: { fontSize: 11, color: color.ink3 },
  td1: { flex: 1, fontSize: 14, color: color.ink },
  td: { flex: 1, fontSize: 14, color: color.ink, textAlign: 'right' },
  lastText: {
    fontSize: 12,
    lineHeight: 18,
    color: color.ink2,
    paddingHorizontal: PAD,
    paddingBottom: 12,
  },
});
