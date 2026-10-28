import { useEffect, useState, type ComponentProps } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { color } from '../theme';

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => {
      if (alive) {
        setReduced(v);
      }
    });
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduced,
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
export function PortfolioButton({
  title,
  onPress,
  disabled = false,
  loading = false,
  tone = 'ghost',
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'ghost' | 'sell' | 'learn';
  style?: ComponentProps<typeof View>['style'];
}) {
  const foreground = tone === 'ghost' ? color.ink : color.card;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        {
          backgroundColor:
            tone === 'sell'
              ? color.sell
              : tone === 'learn'
              ? color.learn
              : color.card,
        },
        tone === 'ghost' && s.border,
        style,
        (disabled || loading) && s.disabled,
        pressed && s.pressed,
      ]}
    >
      <View style={s.row}>
        {loading ? <ActivityIndicator size="small" color={foreground} /> : null}
        <Text style={[s.text, { color: foreground }]}>{title}</Text>
      </View>
    </Pressable>
  );
}
export function PortfolioSegments<K extends string>({
  items,
  value,
  onChange,
}: {
  items: [K, string][];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <View style={s.segments}>
      {items.map(([key, label]) => (
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: value === key }}
          key={key}
          onPress={() => onChange(key)}
          style={({ pressed }) => [
            s.segment,
            value === key && s.selected,
            pressed && s.pressed,
          ]}
        >
          <Text style={[s.text, value === key ? s.selectedText : s.muted]}>
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flexShrink: 1,
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1,
  },
  border: { borderWidth: 1, borderColor: color.baseLine },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
  segments: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segment: {
    flexGrow: 1,
    minHeight: 48,
    padding: 12,
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.baseLine,
  },
  selected: { borderColor: color.sell },
  selectedText: { color: color.sell },
  muted: { color: color.ink2 },
});
