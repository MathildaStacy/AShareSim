/** 资金、费率、设置页共用的表单行：键值行、输入行、开关行、选项行。 */
import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import { color, num, PAD } from '../theme';

export function KV({
  k,
  v,
  c,
  sub,
}: {
  k: string;
  v: string;
  c?: string;
  sub?: string;
}) {
  return (
    <View style={s.kv}>
      <Text style={s.k}>{k}</Text>
      <View style={s.vBox}>
        <Text style={[s.v, num, c ? { color: c } : null]}>{v}</Text>
        {sub ? <Text style={s.vSub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

export function FieldRow({
  label,
  sub,
  value,
  onChangeText,
  unit,
  placeholder,
  error,
  keyboardType = 'decimal-pad',
  wide,
}: {
  label: string;
  sub?: string;
  value: string;
  onChangeText: (v: string) => void;
  unit?: string;
  placeholder?: string;
  error?: string | null;
  keyboardType?: KeyboardTypeOptions;
  /** 输入框占满一行（金额这类主输入）。 */
  wide?: boolean;
}) {
  return (
    <View style={s.row}>
      <View style={s.line}>
        <View style={s.grow}>
          <Text style={s.label}>{label}</Text>
          {sub ? <Text style={s.sub}>{sub}</Text> : null}
        </View>
        <View style={[s.inputBox, wide && s.inputWide, error ? s.bad : null]}>
          <TextInput
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={color.ink3}
            keyboardType={keyboardType}
            style={[s.input, num]}
            accessibilityLabel={label}
            selectTextOnFocus
          />
          {unit ? <Text style={s.unit}>{unit}</Text> : null}
        </View>
      </View>
      {error ? <Text style={s.err}>{error}</Text> : null}
    </View>
  );
}

export function SwitchRow({
  label,
  sub,
  value,
  onChange,
}: {
  label: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={[s.row, s.line]}>
      <View style={s.grow}>
        <Text style={s.label}>{label}</Text>
        {sub ? <Text style={s.sub}>{sub}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: color.up, false: color.line }}
        thumbColor="#FFFFFF"
        accessibilityLabel={label}
      />
    </View>
  );
}

/** 一组互斥选项（小按钮），选中的高亮。 */
export function ChoiceRow<K extends string | number>({
  label,
  sub,
  items,
  value,
  onChange,
}: {
  label: string;
  sub?: ReactNode;
  items: [K, string][];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      {typeof sub === 'string' ? <Text style={s.sub}>{sub}</Text> : sub}
      <View style={s.chips}>
        {items.map(([k, l]) => {
          const on = k === value;
          return (
            <Pressable
              key={String(k)}
              onPress={() => onChange(k)}
              style={[s.chip, on && s.chipOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={label + ' ' + l}
            >
              <Text style={[s.chipText, on && s.chipTextOn]}>{l}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** 校验结果条：通过绿、拦下红。 */
export function CheckBar({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View style={[s.check, ok ? s.checkOk : s.checkBad]}>
      <Text style={s.checkText}>
        {ok ? '✓ ' : '✕ '}
        {text}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: PAD,
    paddingVertical: 6,
    gap: 12,
  },
  k: { fontSize: 14, color: color.ink2 },
  vBox: { flexShrink: 1, alignItems: 'flex-end' },
  v: { fontSize: 14, color: color.ink, textAlign: 'right' },
  vSub: { fontSize: 11, color: color.ink3, marginTop: 1, textAlign: 'right' },
  row: {
    paddingHorizontal: PAD,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
  label: { fontSize: 15, color: color.ink },
  sub: { fontSize: 12, lineHeight: 17, color: color.ink3, marginTop: 2 },
  inputBox: {
    width: 128,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 4,
    paddingHorizontal: 8,
  },
  inputWide: { width: undefined, flex: 1.6 },
  bad: { borderColor: color.up },
  input: { flex: 1, padding: 0, fontSize: 15, color: color.ink },
  unit: { fontSize: 12, color: color.ink3, marginLeft: 4 },
  err: { fontSize: 12, lineHeight: 17, color: color.up, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { borderColor: color.up, backgroundColor: color.upBg },
  chipText: { fontSize: 13, color: color.ink2 },
  chipTextOn: { color: color.up, fontWeight: '600' },
  check: {
    marginHorizontal: 10,
    marginTop: 8,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  checkOk: { backgroundColor: color.downBg },
  checkBad: { backgroundColor: color.upBg },
  checkText: { fontSize: 13, lineHeight: 19, color: color.ink },
});
