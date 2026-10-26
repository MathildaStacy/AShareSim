/**
 * 搜索：代码 / 名称 / 拼音首字母。先查本地证券表，同时请求腾讯 smartbox（停顿 300 毫秒再发）。
 * 从下单页进来（pick）时，点一行带着代码回到下单页；指数不能下单，不显示。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as repo from '../../data/repos';
import type { SearchHit } from '../../market/tencent';
import { BOARD_NAME } from '../../sim/ruleCard';
import { Button, Empty, NavBar, Note, Tags } from '../components/ui';
import { boardOf, isIndex, tagsOf } from '../format';
import { useCore } from '../hooks';
import { matchLocal } from '../search';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { color, num, PAD } from '../theme';
import { useWatch, watch } from '../watchStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function exchangeName(code: string) {
  return code.startsWith('sh') ? '上交所' : '深交所';
}

export function SearchScreen({ route }: RootScreenProps<'Search'>) {
  const pick = route.params?.pick ?? null;
  const core = useCore();
  const nav = useNavigation<Nav>();
  const watched = useWatch(s => s.codes);
  const [q, setQ] = useState('');
  const [local, setLocal] = useState<repo.SecurityRow[]>([]);
  const [remote, setRemote] = useState<SearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    repo
      .allSecurities(core.db)
      .then(setLocal)
      .catch(() => undefined);
  }, [core]);

  useEffect(() => {
    const k = q.trim();
    if (!k) {
      setRemote([]);
      setError(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const hits = await core.client.search(k);
        if (alive) {
          setRemote(hits);
          setError(null);
        }
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (alive) {
          setBusy(false);
        }
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [core, q]);

  const seen = new Set<string>();
  const hits = [...matchLocal(local, q), ...remote].filter(h =>
    seen.has(h.code) ||
    (pick && (isIndex(h.code, h.type) || !boardOf(h.code, h.type)))
      ? false
      : (seen.add(h.code), true),
  );

  return (
    <View style={s.page}>
      <NavBar title={pick ? '选择证券' : '搜索'} back />
      <View style={s.box}>
        <TextInput
          value={q}
          onChangeText={setQ}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="代码 / 名称 / 拼音首字母，例如 600519、茅台、gzmt"
          placeholderTextColor={color.ink3}
          style={s.input}
          returnKeyType="search"
        />
      </View>
      {error ? (
        <Note tone="warn" style={s.note}>
          搜索失败：{error}
          {hits.length ? '。下面是本地已有的结果' : ''}
        </Note>
      ) : null}
      <FlatList
        data={hits}
        keyboardShouldPersistTaps="handled"
        keyExtractor={h => h.code}
        renderItem={({ item: h }) => {
          const index = isIndex(h.code, h.type);
          const b = boardOf(h.code, h.type);
          const inWatch = watched.includes(h.code);
          return (
            <Pressable
              style={({ pressed }) => [s.row, pressed && s.pressed]}
              onPress={() =>
                pick
                  ? nav.popTo('Order', {
                      side: pick.side,
                      kind: pick.kind,
                      code: h.code,
                      name: h.name,
                    })
                  : nav.navigate('Stock', {
                      code: h.code,
                      name: h.name,
                      type: h.type,
                    })
              }
            >
              <View style={s.grow}>
                <View style={s.line}>
                  <Text style={s.name}>{h.name}</Text>
                  <Text style={[s.code, num]}> {h.code.slice(2)}</Text>
                  <Tags tags={tagsOf(h.code, h.name, h.type)} />
                </View>
                <Text style={s.meta}>
                  {(index ? '指数' : b ? BOARD_NAME[b] : '') +
                    ' · ' +
                    exchangeName(h.code)}
                </Text>
              </View>
              {index || pick ? null : (
                <Button
                  small
                  tone={inWatch ? 'ghost' : 'buy'}
                  title={inWatch ? '已自选' : '＋自选'}
                  onPress={() => watch.toggle(core, h.code, h.name)}
                />
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Empty
            text={
              !q.trim()
                ? pick
                  ? '输入要买卖的证券。支持沪深主板、创业板、科创板和 ETF。'
                  : '支持沪深 A 股、ETF 和指数。北交所、债券、港股暂不支持。'
                : busy
                ? '搜索中…'
                : '没有找到'
            }
          />
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  box: { padding: 10, backgroundColor: color.card },
  input: {
    height: 42,
    borderRadius: 6,
    backgroundColor: color.bg,
    paddingHorizontal: 12,
    fontSize: 15,
    color: color.ink,
  },
  note: { margin: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: PAD,
    paddingVertical: 11,
    backgroundColor: color.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  pressed: { backgroundColor: color.press },
  grow: { flex: 1, minWidth: 0 },
  line: { flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 15, fontWeight: '500', color: color.ink },
  code: { fontSize: 12, color: color.ink3 },
  meta: { fontSize: 11, color: color.ink3, marginTop: 2 },
});
