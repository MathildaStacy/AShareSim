/** 自选：3 个主要指数、交易时段、自选列表（按涨跌幅 / 现价排序）。 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pencil, Search } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { beijingNow } from '../../market/clock';
import { nowRule } from '../../sim/ruleCard';
import { AiFab, Button, IconButton, NavBar } from '../components/ui';
import { QUOTE_COL, QuoteRow } from '../components/QuoteRow';
import { fmtChange, fmtPct, fmtPrice, trendOf } from '../format';
import {
  useAiContext,
  useCore,
  useLive,
  useQuoteCodes,
  useViewLog,
  useVisibleCodes,
} from '../hooks';
import type { RootStackParamList } from '../navigation/types';
import { INDICES, quoteView } from '../quoteView';
import { color, num, PAD, trendColor } from '../theme';
import { useWatch, watch } from '../watchStore';
import {
  DEFAULT_SORT,
  nextSort,
  sortCodes,
  type SortKey,
  type WatchSort,
} from '../watchSort';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const TOP3 = INDICES.slice(0, 3);

/** 自选为空时可以一键加的几只（宽基 ETF + 两只大盘股）。 */
const SUGGEST = [
  { code: 'sh510300', name: '沪深300ETF' },
  { code: 'sz159915', name: '创业板ETF' },
  { code: 'sh600036', name: '招商银行' },
  { code: 'sh600519', name: '贵州茅台' },
];

export function PhaseBar() {
  const core = useCore();
  const now = beijingNow();
  const r = nowRule(now.t, core.sim.calendar.isTradingDay(now.date));
  const [name, desc] = r.text.split('：');
  return (
    <View style={s.phase}>
      <View
        style={[
          s.dot,
          { backgroundColor: r.canCancel ? color.down : color.warn },
        ]}
      />
      <Text style={s.phaseName}>{name}</Text>
      <Text style={s.phaseDesc} numberOfLines={2}>
        {desc}
      </Text>
    </View>
  );
}

export function WatchScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  useLive();
  const { codes, loaded } = useWatch();
  const [sort, setSort] = useState<WatchSort>(DEFAULT_SORT);
  useEffect(() => {
    if (!loaded) {
      watch.load(core).catch(() => undefined);
    }
  }, [core, loaded]);
  const { visibleCodes, ...viewability } = useVisibleCodes<{ code: string }>(
    'watch',
  );
  useQuoteCodes([
    ...TOP3.map(i => i.code),
    ...visibleCodes.filter(c => codes.includes(c)),
  ]);
  // 自选还没从本地库读出来时不记，否则会记成「0 只」
  useViewLog('watch', loaded ? '查看 自选（' + codes.length + ' 只）' : null);

  const rows = codes.map(c => quoteView(core.sim, c));
  const byCode = new Map(rows.map(r => [r.code, r]));
  const sorted = sortCodes(codes, sort, (c, k) => {
    const r = byCode.get(c);
    return k === 'pct' ? r?.pct ?? null : r?.last ?? null;
  }).map(c => byCode.get(c)!);

  useAiContext('Watch', () => ({
    name: '自选',
    lines: [
      ...TOP3.map(i => {
        const v = quoteView(core.sim, i.code, i);
        return i.name + ' ' + fmtPrice(v.last, 2) + '（' + fmtPct(v.pct) + '）';
      }),
      ...(rows.length
        ? rows.map(
            r =>
              r.name +
              '（' +
              r.code.slice(2) +
              '）' +
              fmtPrice(r.last, r.decimals) +
              ' 元，' +
              fmtPct(r.pct),
          )
        : ['自选列表是空的']),
    ],
    tip: '可见自选报价目标每 1 秒请求一次；点表头可以按涨跌幅或现价排序。',
  }));

  const head = (key: SortKey, label: string) => (
    <Pressable
      onPress={() => setSort(nextSort(sort, key))}
      style={s.headCol}
      accessibilityRole="button"
      accessibilityLabel={'按' + label + '排序'}
    >
      <Text style={s.headText}>
        {label} {sort.key === key ? (sort.dir === 'desc' ? '↓' : '↑') : '⇅'}
      </Text>
    </Pressable>
  );

  return (
    <View style={s.page}>
      <NavBar
        title="自选"
        right={
          <>
            <IconButton label="搜索" onPress={() => nav.navigate('Search')}>
              <Search color={color.ink2} size={22} />
            </IconButton>
            <IconButton
              label="编辑自选"
              onPress={() => nav.navigate('WatchEdit')}
            >
              <Pencil color={color.ink2} size={20} />
            </IconButton>
          </>
        }
      />
      <FlatList
        data={sorted}
        {...viewability}
        keyExtractor={r => r.code}
        ListHeaderComponent={
          <>
            <View style={s.idx3}>
              {TOP3.map(i => {
                const v = quoteView(core.sim, i.code, i);
                const c = trendColor[trendOf(v.pct)];
                return (
                  <Pressable
                    key={i.code}
                    style={s.idxCell}
                    onPress={() =>
                      nav.navigate('Stock', {
                        code: i.code,
                        name: i.name,
                        type: 'ZS',
                      })
                    }
                  >
                    <Text style={s.idxName}>{i.name}</Text>
                    <Text style={[s.idxPx, num, { color: c }]}>
                      {fmtPrice(v.last, 2)}
                    </Text>
                    <Text style={[s.idxCh, num, { color: c }]}>
                      {fmtChange(v.change, 2)} {fmtPct(v.pct)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <PhaseBar />
            {codes.length ? (
              <View style={s.head}>
                <Text style={[s.headText, s.headFirst]}>名称代码</Text>
                {head('price', '最新')}
                {head('pct', '涨跌幅')}
              </View>
            ) : null}
          </>
        }
        renderItem={({ item: r }) => (
          <QuoteRow
            {...r}
            onPress={() =>
              nav.navigate('Stock', {
                code: r.code,
                name: r.name,
                type: r.type,
              })
            }
          />
        )}
        ListEmptyComponent={
          loaded ? (
            <View style={s.empty}>
              <Text style={s.emptyText}>
                还没有自选。可以先加几只常见的，或者搜索代码 / 名称 /
                拼音首字母。
              </Text>
              <View style={s.suggest}>
                {SUGGEST.map(x => (
                  <Button
                    key={x.code}
                    small
                    title={'＋ ' + x.name}
                    onPress={() => watch.add(core, x.code, x.name)}
                  />
                ))}
              </View>
            </View>
          ) : undefined
        }
        ListFooterComponent={
          <View style={s.footer}>
            <Button
              small
              title="＋ 添加自选"
              onPress={() => nav.navigate('Search')}
            />
          </View>
        }
        contentContainerStyle={s.listPad}
      />
      <AiFab />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  listPad: { paddingBottom: 80 },
  idx3: {
    flexDirection: 'row',
    backgroundColor: color.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  idxCell: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  idxName: { fontSize: 12, color: color.ink2 },
  idxPx: { fontSize: 18, fontWeight: '600', marginTop: 1 },
  idxCh: { fontSize: 11 },
  phase: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: PAD,
    paddingVertical: 8,
    backgroundColor: color.card,
    marginTop: 8,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  phaseName: { fontSize: 13, fontWeight: '600', color: color.ink },
  phaseDesc: { flex: 1, fontSize: 12, color: color.ink2 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PAD,
    paddingVertical: 7,
    marginTop: 8,
    backgroundColor: color.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  headFirst: { flex: 1 },
  headCol: { width: QUOTE_COL, alignItems: 'flex-end', paddingVertical: 2 },
  headText: { fontSize: 12, color: color.ink3 },
  empty: { padding: 20, marginTop: 8, backgroundColor: color.card },
  emptyText: { fontSize: 13, color: color.ink2, lineHeight: 20 },
  suggest: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  footer: { padding: 14, alignItems: 'center' },
});
