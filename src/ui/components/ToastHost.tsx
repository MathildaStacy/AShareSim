/** 全局提示：显示 toast 队列的第一条；引擎事件（成交、废单、撤单……）自动变成提示。 */
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../app/boot';
import { toastOf } from '../../sim/describe';
import { color } from '../theme';
import { toast, useToast, type ToastTone } from '../toast';

const BAR: Record<ToastTone, string> = {
  info: color.ink3,
  up: color.up,
  sell: color.sell,
  warn: color.warn,
  bad: color.up,
  learn: color.learn,
};

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const head = useToast(s => s.queue[0] ?? null);

  // 引擎事件 → 提示（启动时的补撮合也会经过这里）
  useEffect(
    () =>
      useApp.subscribe((st, prev) => {
        if (st.lastEvents === prev.lastEvents || !st.core) {
          return;
        }
        const sim = st.core.sim;
        for (const e of st.lastEvents) {
          const t = toastOf(e, c => sim.security(c));
          if (t) {
            toast.show(t.text, t.tone);
          }
        }
      }),
    [],
  );

  useEffect(() => {
    if (!head) {
      return;
    }
    const ms = Math.min(6000, 2200 + head.text.length * 45);
    const timer = setTimeout(() => toast.dismiss(head.id), ms);
    return () => clearTimeout(timer);
  }, [head]);

  if (!head) {
    return null;
  }
  return (
    <Pressable
      onPress={() => toast.dismiss(head.id)}
      style={[
        s.box,
        { bottom: insets.bottom + 76, borderLeftColor: BAR[head.tone] },
      ]}
      accessibilityRole="alert"
      accessibilityLabel={head.text}
    >
      <Text style={s.text}>
        {head.text}
        {head.more ? '（另有 ' + head.more + ' 条，见「交易 → 查询」）' : ''}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  box: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: 'rgba(31,35,41,0.94)',
    borderRadius: 8,
    borderLeftWidth: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    elevation: 8,
  },
  text: { color: '#FFFFFF', fontSize: 13, lineHeight: 19 },
});
