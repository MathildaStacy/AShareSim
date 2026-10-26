import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fmtPrice, tagsOf, trendOf } from '../format';
import { color, num, PAD, trendColor } from '../theme';
import { PctPill, Tags } from './ui';

/** 行情列表的一行：名称 + 代码 + 板块标签、最新价、涨跌幅色块（或者自定义的右侧）。 */
export function QuoteRow({
  code,
  name,
  type,
  last,
  pct,
  decimals,
  onPress,
  right,
}: {
  code: string;
  name: string;
  type?: string;
  last: number | null;
  pct: number | null;
  decimals: number;
  onPress: () => void;
  right?: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && s.pressed]}
      accessibilityRole="button"
    >
      <View style={s.nm}>
        <Text style={s.name} numberOfLines={1}>
          {name}
        </Text>
        <View style={s.sub}>
          <Text style={[s.code, num]}>{code.slice(2)}</Text>
          <Tags tags={tagsOf(code, name, type)} />
        </View>
      </View>
      <Text style={[s.px, num, { color: trendColor[trendOf(pct)] }]}>
        {fmtPrice(last, decimals)}
      </Text>
      <View style={s.pc}>{right ?? <PctPill pct={pct} />}</View>
    </Pressable>
  );
}

export const QUOTE_COL = 92;

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PAD,
    paddingVertical: 10,
    minHeight: 56,
    backgroundColor: color.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  pressed: { backgroundColor: color.press },
  nm: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500', color: color.ink },
  sub: { flexDirection: 'row', alignItems: 'center', marginTop: 1 },
  code: { fontSize: 11, color: color.ink3 },
  px: { width: QUOTE_COL, textAlign: 'right', fontSize: 16 },
  pc: { width: QUOTE_COL, alignItems: 'flex-end' },
});
