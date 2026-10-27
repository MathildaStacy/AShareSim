/** 通用小组件：导航栏、分段、标签、涨跌幅色块、空状态、AI 悬浮按钮。 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmtPct, trendOf } from '../format';
import type { RootStackParamList } from '../navigation/types';
import { color, num, PAD } from '../theme';

export function NavBar({
  title,
  sub,
  back,
  right,
}: {
  title: string;
  sub?: string;
  back?: boolean;
  right?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  return (
    <View style={[s.nav, { paddingTop: insets.top }]}>
      <View style={s.navRow}>
        {back ? (
          <Pressable
            onPress={() => nav.goBack()}
            style={s.iconBtn}
            accessibilityLabel="返回"
            hitSlop={6}
          >
            <ChevronLeft color={color.ink} size={24} />
          </Pressable>
        ) : null}
        <View style={[s.navTitle, !back && s.navTitleRoot]}>
          <Text style={[s.navH1, !back && s.navH1Root]} numberOfLines={1}>
            {title}
          </Text>
          {sub ? (
            <Text style={[s.navSub, num]} numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
        </View>
        <View style={s.navRight}>{right}</View>
      </View>
    </View>
  );
}

export function IconButton({
  onPress,
  label,
  children,
}: {
  onPress: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={4}
    >
      {children}
    </Pressable>
  );
}

export function Segmented<K extends string>({
  items,
  value,
  onChange,
  style,
}: {
  items: [K, string][];
  value: K;
  onChange: (k: K) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[s.seg, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.segInner}
      >
        {items.map(([k, label]) => (
          <Pressable
            key={k}
            onPress={() => onChange(k)}
            style={[s.segBtn, value === k && s.segOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: value === k }}
          >
            <Text style={[s.segText, value === k && s.segTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const TAG_STYLE: Record<string, { c: string; b: string; bg?: string }> = {
  ST: { c: '#FFFFFF', b: color.warn, bg: color.warn },
  创: { c: color.cyb, b: color.cybLine },
  科: { c: color.kcb, b: color.kcbLine },
  ETF: { c: color.etf, b: color.etfLine },
};

export function Tags({ tags }: { tags: string[] }) {
  return (
    <>
      {tags.map(t => {
        const st = TAG_STYLE[t] ?? { c: color.ink3, b: color.line };
        return (
          <Text
            key={t}
            style={[
              s.tag,
              { color: st.c, borderColor: st.b, backgroundColor: st.bg },
            ]}
          >
            {t}
          </Text>
        );
      })}
    </>
  );
}

/** 涨跌幅色块（红涨绿跌，平盘灰）。 */
export function PctPill({ pct }: { pct: number | null | undefined }) {
  const tr = trendOf(pct);
  return (
    <View
      style={[
        s.pill,
        {
          backgroundColor:
            tr === 'up' ? color.up : tr === 'down' ? color.down : color.flat,
        },
      ]}
    >
      <Text style={[s.pillText, num]}>{fmtPct(pct)}</Text>
    </View>
  );
}

export function SectionTitle({
  title,
  right,
}: {
  title: string;
  right?: ReactNode;
}) {
  return (
    <View style={s.secH}>
      <Text style={s.secHText}>{title}</Text>
      {typeof right === 'string' ? (
        <Text style={s.secHSmall}>{right}</Text>
      ) : (
        right
      )}
    </View>
  );
}

export function Note({
  children,
  tone,
  style,
}: {
  children: ReactNode;
  tone?: 'warn' | 'learn';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        s.note,
        tone === 'warn' && { backgroundColor: color.warnBg },
        tone === 'learn' && { backgroundColor: color.learnBg },
        style,
      ]}
    >
      <Text
        style={[
          s.noteText,
          tone === 'warn' && { color: color.warnInk },
          tone === 'learn' && s.noteTextLearn,
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  tone = 'ghost',
  small,
  disabled,
}: {
  title: string;
  onPress: () => void;
  tone?: 'ghost' | 'buy' | 'sell' | 'learn' | 'plain';
  small?: boolean;
  disabled?: boolean;
}) {
  const bg =
    tone === 'buy'
      ? color.up
      : tone === 'sell'
      ? color.sell
      : tone === 'learn'
      ? color.learn
      : tone === 'plain'
      ? color.bg
      : color.card;
  const fg = tone === 'ghost' || tone === 'plain' ? color.ink : '#FFFFFF';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        s.btn,
        small && s.btnSm,
        { backgroundColor: bg },
        tone === 'ghost' && s.btnGhost,
        (pressed || disabled) && { opacity: disabled ? 0.45 : 0.8 },
      ]}
    >
      <Text style={[s.btnText, small && s.btnTextSm, { color: fg }]}>
        {title}
      </Text>
    </Pressable>
  );
}

export function Empty({ text }: { text: string }) {
  return <Text style={s.empty}>{text}</Text>;
}

/** 右下角「AI」按钮：打开 AI 对话，提问时附带当前页面的上下文（AI_ASSISTANT.md §2）。 */
export function AiFab({ lift = 0 }: { lift?: number }) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <Pressable
      onPress={() => nav.navigate('Ai')}
      style={({ pressed }) => [
        s.fab,
        lift ? { bottom: 16 + lift } : null,
        pressed && { opacity: 0.85 },
      ]}
      accessibilityLabel="问 AI"
      accessibilityRole="button"
    >
      <Text style={s.fabText}>AI</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  nav: {
    backgroundColor: color.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  navRow: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  navTitle: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  navTitleRoot: { alignItems: 'flex-start', paddingLeft: 10 },
  navH1: { fontSize: 17, fontWeight: '600', color: color.ink },
  navH1Root: { fontSize: 20 },
  navSub: { fontSize: 11, color: color.ink3 },
  navRight: {
    minWidth: 44,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: color.bg },
  seg: {
    backgroundColor: color.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  segInner: { paddingHorizontal: 6 },
  segBtn: {
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 9,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  segOn: { borderBottomColor: color.up },
  segText: { fontSize: 14, color: color.ink2 },
  segTextOn: { color: color.ink, fontWeight: '600' },
  tag: {
    fontSize: 10,
    lineHeight: 14,
    paddingHorizontal: 3,
    borderWidth: 1,
    borderRadius: 2,
    marginLeft: 4,
    overflow: 'hidden',
  },
  pill: {
    minWidth: 76,
    borderRadius: 3,
    paddingVertical: 5,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  pillText: { color: '#FFFFFF', fontSize: 15, fontWeight: '500' },
  secH: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: PAD,
    paddingTop: 14,
    paddingBottom: 6,
  },
  secHText: { fontSize: 15, fontWeight: '600', color: color.ink },
  secHSmall: { fontSize: 12, color: color.ink3 },
  note: {
    backgroundColor: color.bg,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  noteText: { fontSize: 12, lineHeight: 18, color: color.ink2 },
  noteTextLearn: { color: '#0B5552' },
  btn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSm: { height: 32, paddingHorizontal: 10, borderRadius: 4 },
  btnGhost: { borderWidth: 1, borderColor: color.line },
  btnText: { fontSize: 15, fontWeight: '500' },
  btnTextSm: { fontSize: 13 },
  empty: {
    paddingVertical: 36,
    paddingHorizontal: 20,
    textAlign: 'center',
    color: color.ink3,
    fontSize: 13,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: color.ink,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  fabText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
});
