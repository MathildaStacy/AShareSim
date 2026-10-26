/** 确认弹窗（委托确认、撤单确认）：键值行 + 说明 + 确认 / 取消。 */
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { color, num } from '../theme';

export interface DialogRow {
  k: string;
  v: string;
  color?: string;
}

export function ConfirmDialog({
  visible,
  title,
  rows,
  children,
  okTitle,
  okTone = 'buy',
  onOk,
  onCancel,
  cancelTitle = '取消',
}: {
  visible: boolean;
  title: string;
  rows: DialogRow[];
  children?: ReactNode;
  okTitle: string;
  okTone?: 'buy' | 'sell' | 'plain';
  onOk: () => void;
  onCancel: () => void;
  cancelTitle?: string;
}) {
  const okBg =
    okTone === 'buy' ? color.up : okTone === 'sell' ? color.sell : color.ink;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={s.mask}>
        <View style={s.box} accessibilityViewIsModal>
          <Text style={s.title}>{title}</Text>
          <View style={s.rows}>
            {rows.map(r => (
              <View key={r.k} style={s.row}>
                <Text style={s.k}>{r.k}</Text>
                <Text style={[s.v, num, r.color ? { color: r.color } : null]}>
                  {r.v}
                </Text>
              </View>
            ))}
          </View>
          {children}
          <View style={s.btns}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [s.btn, pressed && s.pressed]}
              accessibilityRole="button"
            >
              <Text style={s.cancel}>{cancelTitle}</Text>
            </Pressable>
            <Pressable
              onPress={onOk}
              style={({ pressed }) => [
                s.btn,
                s.ok,
                { backgroundColor: okBg },
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
            >
              <Text style={s.okText}>{okTitle}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  mask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 28,
  },
  box: { backgroundColor: color.card, borderRadius: 10, padding: 16 },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: color.ink,
    textAlign: 'center',
  },
  rows: { marginTop: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: 12,
  },
  k: { fontSize: 14, color: color.ink2 },
  v: { flex: 1, fontSize: 14, color: color.ink, textAlign: 'right' },
  btns: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: {
    flex: 1,
    height: 42,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.line,
  },
  ok: { borderWidth: 0 },
  pressed: { backgroundColor: color.press },
  cancel: { fontSize: 15, color: color.ink },
  okText: { fontSize: 15, color: '#FFFFFF', fontWeight: '600' },
});
