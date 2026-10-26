/** 编辑自选：按住右侧把手拖动排序，松手保存；置顶、删除立即生效。 */
import { ArrowUpToLine, GripVertical, Trash2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Empty, IconButton, NavBar, Tags } from '../components/ui';
import { tagsOf } from '../format';
import { useCore } from '../hooks';
import { quoteView } from '../quoteView';
import { color, num, PAD } from '../theme';
import { useWatch, watch } from '../watchStore';
import { move } from '../watchSort';

const ROW_H = 56;

export function WatchEditScreen() {
  const core = useCore();
  const codes = useWatch(s => s.codes);
  const [list, setList] = useState(codes);
  const [dragging, setDragging] = useState<string | null>(null);
  const dy = useRef(new Animated.Value(0)).current;
  const drag = useRef({ from: 0, cur: 0, list });
  drag.current.list = list;

  useEffect(() => {
    if (!dragging) {
      setList(codes);
    }
  }, [codes, dragging]);

  const onStart = (code: string) => {
    const i = drag.current.list.indexOf(code);
    drag.current.from = i;
    drag.current.cur = i;
    dy.setValue(0);
    setDragging(code);
  };
  const onMove = (gdy: number) => {
    const d = drag.current;
    const n = d.list.length;
    const target = Math.max(
      0,
      Math.min(n - 1, d.from + Math.round(gdy / ROW_H)),
    );
    if (target !== d.cur) {
      const next = move(d.list, d.cur, target);
      d.list = next;
      d.cur = target;
      setList(next);
    }
    dy.setValue(gdy - (d.cur - d.from) * ROW_H);
  };
  const onEnd = () => {
    const next = drag.current.list;
    dy.setValue(0);
    setDragging(null);
    if (next.join() !== codes.join()) {
      watch.reorder(core, next).catch(() => undefined);
    }
  };

  return (
    <View style={s.page}>
      <NavBar title="编辑自选" back />
      <ScrollView scrollEnabled={!dragging}>
        <Text style={s.hint}>按住右边的把手上下拖动排序；松手就保存。</Text>
        {list.length === 0 ? <Empty text="自选是空的" /> : null}
        {list.map((code, i) => {
          const v = quoteView(core.sim, code);
          const active = dragging === code;
          return (
            <Animated.View
              key={code}
              style={[
                s.row,
                active && s.active,
                active && { transform: [{ translateY: dy }] },
              ]}
            >
              <View style={s.nm}>
                <Text style={s.name} numberOfLines={1}>
                  {v.name}
                </Text>
                <View style={s.sub}>
                  <Text style={[s.code, num]}>{code.slice(2)}</Text>
                  <Tags tags={tagsOf(code, v.name, v.type)} />
                </View>
              </View>
              <IconButton
                label={'置顶 ' + v.name}
                onPress={() =>
                  i > 0 &&
                  watch.reorder(core, move(list, i, 0)).catch(() => undefined)
                }
              >
                <ArrowUpToLine
                  color={i > 0 ? color.ink2 : color.line}
                  size={20}
                />
              </IconButton>
              <IconButton
                label={'删除 ' + v.name}
                onPress={() => watch.remove(core, code, v.name)}
              >
                <Trash2 color={color.up} size={20} />
              </IconButton>
              <Handle
                label={'拖动排序 ' + v.name}
                onStart={() => onStart(code)}
                onMove={onMove}
                onEnd={onEnd}
              />
            </Animated.View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Handle(props: {
  label: string;
  onStart: () => void;
  onMove: (dy: number) => void;
  onEnd: () => void;
}) {
  const cb = useRef(props);
  cb.current = props;
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => cb.current.onStart(),
      onPanResponderMove: (_, g) => cb.current.onMove(g.dy),
      onPanResponderRelease: () => cb.current.onEnd(),
      onPanResponderTerminate: () => cb.current.onEnd(),
    }),
  ).current;
  return (
    <View
      {...pan.panHandlers}
      style={s.handle}
      accessible
      accessibilityLabel={props.label}
    >
      <GripVertical color={color.ink3} size={22} />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  hint: { fontSize: 12, color: color.ink2, padding: PAD },
  row: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: PAD,
    backgroundColor: color.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  active: {
    zIndex: 10,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  nm: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500', color: color.ink },
  sub: { flexDirection: 'row', alignItems: 'center' },
  code: { fontSize: 11, color: color.ink3 },
  handle: {
    width: 52,
    height: ROW_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
