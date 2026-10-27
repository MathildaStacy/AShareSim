/** 图表共用的触摸查价：轻点定位，横向拖动或长按后锁定，竖向滑动留给页面。 */
import { X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { color, num } from '../theme';
import { clamp } from './chartMath';

export interface ChartTouch {
  key: string;
  y: number;
}

export function useChartTouch(options: {
  hit: (x: number, y: number) => ChartTouch | null;
  enabled: boolean;
  onInspectChange?: (locked: boolean) => void;
}) {
  const [touch, setTouch] = useState<ChartTouch | null>(null);
  const current = useRef(options);
  current.current = options;
  const locked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    locked.current = false;
    current.current.onInspectChange?.(false);
  };
  const lock = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    locked.current = true;
    current.current.onInspectChange?.(true);
  };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: e =>
          current.current.enabled && e.nativeEvent.touches.length === 1,
        onPanResponderGrant: e => {
          const { locationX: x, locationY: y } = e.nativeEvent;
          setTouch(current.current.hit(x, y));
          timer.current = setTimeout(lock, 220);
        },
        onPanResponderStart: e => {
          if (e.nativeEvent.touches.length > 1) {
            stop();
            setTouch(null);
          }
        },
        onPanResponderMove: (e, g) => {
          if (e.nativeEvent.touches.length !== 1) return;
          if (!locked.current) {
            if (Math.abs(g.dy) > 7 && Math.abs(g.dy) > Math.abs(g.dx)) {
              stop();
              setTouch(null);
              return;
            }
            if (Math.abs(g.dx) > 7) lock();
          }
          if (locked.current) {
            setTouch(
              current.current.hit(
                e.nativeEvent.locationX,
                e.nativeEvent.locationY,
              ),
            );
          }
        },
        onPanResponderRelease: stop,
        onPanResponderTerminate: () => {
          stop();
          setTouch(null);
        },
        onPanResponderTerminationRequest: () => !locked.current,
        onShouldBlockNativeResponder: () => locked.current,
      }),
    [],
  );
  useEffect(() => stop, []);
  return {
    touch,
    select: setTouch,
    clear: () => {
      stop();
      setTouch(null);
    },
    panHandlers: responder.panHandlers,
  };
}

/** 固定在图外，手指不会遮住开高低收；窄屏 / 大字号自动变成两列。 */
export function ChartReadout({
  title,
  fields,
  selected,
  onClear,
  width,
}: {
  title: string;
  fields: { label: string; value: string }[];
  selected: boolean;
  onClear: () => void;
  width: number;
}) {
  const { fontScale } = useWindowDimensions();
  const wide = width / fontScale >= 360;
  return (
    <View style={s.readout}>
      <View style={s.heading}>
        <Text style={[s.date, num]}>{title}</Text>
        {selected ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="退出查价"
            onPress={onClear}
            style={({ pressed }) => [s.close, pressed && s.pressed]}
          >
            <X size={17} color={color.ink2} />
          </Pressable>
        ) : (
          <Text style={s.hint}>点按查价</Text>
        )}
      </View>
      <View style={s.fields}>
        {fields.map(field => (
          <View key={field.label} style={[s.field, wide ? s.quarter : s.half]}>
            <Text style={s.label}>{field.label}</Text>
            <Text style={[s.value, num]}>{field.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** 原生文字随系统字号缩放；测量后夹紧，日期与纵轴标签不会超出图的边缘。 */
export function ChartAxisLabels({
  x,
  y,
  width,
  height,
  time,
  value,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  time: string;
  value: string;
}) {
  const [timeSize, setTimeSize] = useState({ width: 170, height: 26 });
  const [valueHeight, setValueHeight] = useState(26);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        testID="chart-axis-value"
        style={[
          s.badge,
          s.valueBadge,
          {
            top: clamp(
              y - valueHeight / 2,
              0,
              height - timeSize.height - valueHeight - 3,
            ),
            maxWidth: width,
          },
        ]}
        onLayout={e => setValueHeight(e.nativeEvent.layout.height)}
      >
        <Text style={[s.badgeText, num]}>{value}</Text>
      </View>
      <View
        testID="chart-axis-time"
        style={[
          s.badge,
          s.timeBadge,
          {
            maxWidth: width - 8,
            left: clamp(x - timeSize.width / 2, 4, width - timeSize.width - 4),
          },
        ]}
        onLayout={e => setTimeSize(e.nativeEvent.layout)}
      >
        <Text style={[s.badgeText, num]}>{time}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  readout: { paddingHorizontal: 4, paddingBottom: 10 },
  heading: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  date: {
    flex: 1,
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 20,
    color: color.ink,
    fontWeight: '600',
  },
  hint: { fontSize: 12, color: color.ink2, paddingLeft: 8 },
  close: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  pressed: { backgroundColor: color.press },
  fields: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  field: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  quarter: { width: '25%' },
  half: { width: '50%' },
  valueBadge: { right: 0 },
  timeBadge: { bottom: 0 },
  label: { fontSize: 12, color: color.ink2 },
  value: { fontSize: 13, color: color.ink, fontWeight: '500' },
  badge: {
    position: 'absolute',
    backgroundColor: color.ink,
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  badgeText: {
    color: color.card,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
});
