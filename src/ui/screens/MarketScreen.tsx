/** 行情：8 个主要指数，沪深 A / 创业板 / 科创板 / ETF 的涨幅、跌幅、成交额排行。 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Search } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useApp } from '../../app/boot';
import type { RankItem, RankSort } from '../../market/tencent';
import { QuoteRow } from '../components/QuoteRow';
import {
  AiFab,
  Empty,
  IconButton,
  NavBar,
  Note,
  SectionTitle,
  Segmented,
} from '../components/ui';
import {
  decimalsOf,
  fmtAmount,
  fmtChange,
  fmtPct,
  fmtPrice,
  trendOf,
} from '../format';
import {
  useAiContext,
  useCore,
  useLive,
  usePolling,
  useQuoteCodes,
  useViewLog,
  useVisibleCodes,
} from '../hooks';
import type { RootStackParamList } from '../navigation/types';
import { INDICES, quoteView, rankQuote } from '../quoteView';
import { color, num, PAD, trendColor } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Seg = 'idx' | 'aStock' | 'cyb' | 'kcb' | 'etf';

const SEGS: [Seg, string][] = [
  ['idx', '指数'],
  ['aStock', '沪深A'],
  ['cyb', '创业板'],
  ['kcb', '科创板'],
  ['etf', 'ETF'],
];
const SEG_NAME = Object.fromEntries(SEGS) as Record<Seg, string>;

const RANKS: [RankSort, string][] = [
  ['up', '涨幅榜'],
  ['down', '跌幅榜'],
  ['amount', '成交额榜'],
];

/** 每个榜显示几只；交易时段停在这一页时多久刷新一次。 */
const RANK_N = 10;
const RANK_REFRESH_MS = 10_000;

type Ranks = Record<RankSort, RankItem[]>;

export function MarketScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  useLive();
  const [seg, setSeg] = useState<Seg>('idx');
  const session = useApp(st => st.status?.window === 'session');
  const { visibleCodes, ...viewability } = useVisibleCodes<RankItem>(seg);
  const quoteEpoch = useRef<{ seg: Seg; at: number } | null>(null);
  if (quoteEpoch.current?.seg !== seg) {
    quoteEpoch.current = { seg, at: Date.now() };
  }
  const quoteSince = quoteEpoch.current.at;
  useQuoteCodes(seg === 'idx' ? INDICES.map(i => i.code) : visibleCodes);
  useViewLog(
    'market:' + seg,
    '查看 行情 · ' + SEG_NAME[seg] + (seg === 'idx' ? '' : '排行'),
  );

  const ranks = usePolling<Ranks | null>(
    async () => {
      if (seg === 'idx') {
        return null;
      }
      const get = (sort: RankSort) =>
        seg === 'etf'
          ? core.client.etfRank(sort, RANK_N)
          : core.client.rank(seg, sort, RANK_N);
      const [up, down, amount] = await Promise.all(RANKS.map(([k]) => get(k)));
      return { up, down, amount };
    },
    [seg],
    seg !== 'idx' && session ? RANK_REFRESH_MS : null,
  );

  const sections = useMemo(
    () =>
      ranks.data
        ? RANKS.map(([key, title]) => ({ key, title, data: ranks.data![key] }))
        : [],
    [ranks.data],
  );
  const liveRank = (row: RankItem) => rankQuote(core.sim, row, quoteSince);
  useAiContext('Market', () => {
    if (seg === 'idx') {
      return {
        name: '行情 · 指数',
        lines: INDICES.map(i => {
          const v = quoteView(core.sim, i.code, i);
          return (
            i.name + ' ' + fmtPrice(v.last, 2) + '（' + fmtPct(v.pct) + '）'
          );
        }),
        tip: '指数代表一篮子股票的整体涨跌，不能直接买卖，可以买跟踪它的 ETF。',
      };
    }
    const d = ranks.data;
    const line = (
      title: string,
      list: RankItem[] | undefined,
      amount = false,
    ) =>
      title +
      '：' +
      (list ?? [])
        .slice(0, 5)
        .map(raw => {
          const r = liveRank(raw);
          return r.name + ' ' + (amount ? fmtAmount(r.amount) : fmtPct(r.pct));
        })
        .join('、');
    return {
      name: '行情 · ' + SEG_NAME[seg] + '排行',
      lines: d
        ? [
            line('涨幅前 5', d.up),
            line('跌幅前 5', d.down),
            line('成交额前 5', d.amount, true),
            seg === 'etf'
              ? 'ETF 排行数据来自新浪，其余行情来自腾讯'
              : '排行数据来自腾讯',
          ]
        : ['排行还没加载出来'],
    };
  });

  const open = (code: string, name: string, type?: string) =>
    nav.navigate('Stock', { code, name, type });

  return (
    <View style={s.page}>
      <NavBar
        title="行情"
        right={
          <IconButton label="搜索" onPress={() => nav.navigate('Search')}>
            <Search color={color.ink2} size={22} />
          </IconButton>
        }
      />
      <Segmented items={SEGS} value={seg} onChange={setSeg} />
      {seg === 'idx' ? (
        <ScrollView contentContainerStyle={s.pad}>
          <View style={s.grid}>
            {INDICES.map(i => {
              const v = quoteView(core.sim, i.code, i);
              const c = trendColor[trendOf(v.pct)];
              return (
                <Pressable
                  key={i.code}
                  style={({ pressed }) => [s.cell, pressed && s.pressed]}
                  onPress={() => open(i.code, i.name, 'ZS')}
                >
                  <Text style={s.cellName}>{i.name}</Text>
                  <Text style={[s.cellPx, num, { color: c }]}>
                    {fmtPrice(v.last, 2)}
                  </Text>
                  <Text style={[s.cellCh, num, { color: c }]}>
                    {fmtChange(v.change, 2)} {fmtPct(v.pct)}
                  </Text>
                </Pressable>
              );
            })}
            <View style={s.cell} />
          </View>
          <View style={s.card}>
            <SectionTitle title="这些指数分别代表什么" />
            <Text style={s.explain}>
              上证指数、深证成指：沪市、深市全部股票的整体走势。{'\n'}
              沪深 300：沪深两市市值大、流动性好的 300 只股票，代表大盘蓝筹。
              {'\n'}
              中证 500：排除沪深 300 以后的 500 只中盘股。{'\n'}
              中证 800 = 沪深 300 + 中证 500。{'\n'}
              中证 1000：再往下 1000 只小盘股。{'\n'}
              创业板指、科创 50：创业板和科创板里规模最大、交易最活跃的公司。
              {'\n'}
              指数不能直接买卖。想买指数，可以买跟踪它的 ETF，例如沪深 300 →
              510300。
            </Text>
          </View>
        </ScrollView>
      ) : (
        <SectionList
          key={seg}
          sections={sections}
          {...viewability}
          keyExtractor={row => row.code}
          contentContainerStyle={s.pad}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            ranks.error && !ranks.data ? (
              <Note tone="warn" style={s.noteGap}>
                排行加载失败：{ranks.error}
              </Note>
            ) : undefined
          }
          ListEmptyComponent={
            <Empty text={ranks.loading ? '加载中…' : '没有数据'} />
          }
          renderSectionHeader={({ section }) => (
            <View style={s.card}>
              <SectionTitle
                title={section.title}
                right={section.key === 'amount' ? '成交额 · 涨跌幅' : undefined}
              />
            </View>
          )}
          renderItem={({ item, section }) => {
            const r = liveRank(item);
            return (
              <QuoteRow
                code={r.code}
                name={r.name}
                type={r.type}
                last={r.last}
                pct={r.pct}
                decimals={decimalsOf(r.code, r.type)}
                onPress={() => open(r.code, r.name, r.type)}
                right={
                  section.key === 'amount' ? (
                    <View style={s.amt}>
                      <Text style={[s.amtText, num]}>
                        {fmtAmount(r.amount)}
                      </Text>
                      <Text
                        style={[
                          s.amtPct,
                          num,
                          { color: trendColor[trendOf(r.pct)] },
                        ]}
                      >
                        {fmtPct(r.pct)}
                      </Text>
                    </View>
                  ) : undefined
                }
              />
            );
          }}
          ListFooterComponent={
            seg === 'etf' ? (
              <Note style={s.noteGap}>ETF 当前均按 T+1 模拟交易。</Note>
            ) : undefined
          }
        />
      )}
      <AiFab />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { paddingBottom: 90 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: StyleSheet.hairlineWidth,
    backgroundColor: color.line,
  },
  cell: {
    width: '33.2%',
    flexGrow: 1,
    backgroundColor: color.card,
    alignItems: 'center',
    paddingVertical: 10,
  },
  pressed: { backgroundColor: color.press },
  cellName: { fontSize: 12, color: color.ink2 },
  cellPx: { fontSize: 16, fontWeight: '600', marginTop: 1 },
  cellCh: { fontSize: 11 },
  card: { backgroundColor: color.card, marginTop: 8 },
  explain: {
    fontSize: 13,
    lineHeight: 22,
    color: color.ink2,
    paddingHorizontal: PAD,
    paddingBottom: 12,
  },
  amt: { alignItems: 'flex-end' },
  amtText: { fontSize: 15, color: color.ink },
  amtPct: { fontSize: 11 },
  noteGap: { margin: 10 },
});
