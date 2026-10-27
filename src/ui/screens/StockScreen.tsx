/**
 * 个股详情：报价、分时 / 日 K / 周 K、五档盘口 / 成交明细、本股规则卡、F10 简况。指数只有报价和图。
 * 底部「买入 / 卖出」进下单页；点五档里的价格直接带进下单页。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Star } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../app/boot';
import { holdingOf } from '../../engine/account';
import { classify, isSTName, type Security } from '../../engine/securities';
import { formatSec } from '../../engine/session';
import type { Snapshot } from '../../engine/types';
import { beijingNow } from '../../market/clock';
import type { MinuteKPeriod, Tick } from '../../market/tencent';
import { lessonById } from '../../learn/lessons';
import { relatedLessons } from '../../learn/progress';
import type { LessonId } from '../../learn/types';
import { ruleCard, type RuleItem } from '../../sim/ruleCard';
import { KlineChart, MinuteChart } from '../charts/Charts';
import { minuteSeries, patchLastBar, withLivePoint } from '../charts/chartMath';
import {
  AiFab,
  IconButton,
  NavBar,
  SectionTitle,
  Segmented,
} from '../components/ui';
import {
  fmtAmount,
  fmtCap,
  fmtChange,
  fmtHands,
  fmtNum,
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
} from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { quoteView, type QuoteView } from '../quoteView';
import { color, num, PAD, trendColor } from '../theme';
import { useWatch, watch } from '../watchStore';

type Chart = 'min' | MinuteKPeriod | 'day' | 'week';
type Book = 'book' | 'ticks';

const CHARTS: [Chart, string][] = [
  ['min', '分时'],
  ['m15', '15分'],
  ['m30', '30分'],
  ['m60', '60分'],
  ['day', '日K'],
  ['week', '周K'],
];
const BOOKS: [Book, string][] = [
  ['book', '五档盘口'],
  ['ticks', '成交明细'],
];

const MINUTE_REFRESH_MS = 30_000;
/** 分钟 K 线在交易时段每分钟取一次（最后一根还在走）。 */
const MINUTE_K_REFRESH_MS = 60_000;
const TICKS_REFRESH_MS = 6_000;
const TICK_ROWS = 30;
const K_COUNT = 120;

/** 行情到之前 Simulator 还不认识这只证券，用代码和名称先推出板块。 */
function securityOf(v: QuoteView, known: Security | null): Security | null {
  if (known) {
    return known;
  }
  const c = classify(v.code, v.type);
  return c ? { code: v.code, name: v.name, ...c, st: isSTName(v.name) } : null;
}

export function StockScreen({ route }: RootScreenProps<'Stock'>) {
  const { code } = route.params;
  const core = useCore();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  useLive();
  const session = useApp(s => s.status?.window === 'session');
  const inWatch = useWatch(s => s.codes.includes(code));
  const [chart, setChart] = useState<Chart>('min');
  const [book, setBook] = useState<Book>('book');
  const [inspectingChart, setInspectingChart] = useState(false);
  useQuoteCodes([code]);

  const v = quoteView(core.sim, code, route.params);
  const { snap, info, decimals: d } = v;
  const sec = v.index ? null : securityOf(v, core.sim.security(code));
  const type = v.type ?? '';
  const prevClose = snap?.prevClose ?? null;
  useViewLog(
    'stock:' + code,
    '查看 ' +
      v.name +
      '（' +
      code.slice(2) +
      '）' +
      (v.index ? '指数' : '个股详情'),
  );

  const minute = usePolling(
    () => core.client.minute(code, type),
    [code, type],
    session ? MINUTE_REFRESH_MS : null,
  );
  const minuteK = chart === 'm15' || chart === 'm30' || chart === 'm60';
  const kline = usePolling(
    async () =>
      chart === 'min'
        ? null
        : chart === 'm15' || chart === 'm30' || chart === 'm60'
        ? core.client.minuteKline(code, type, chart, K_COUNT)
        : core.client.kline(code, type, chart, K_COUNT),
    [code, type, chart],
    minuteK && session ? MINUTE_K_REFRESH_MS : null,
  );
  const ticks = usePolling(
    async () =>
      book === 'ticks' && !v.index ? core.client.ticks(code, TICK_ROWS) : null,
    [code, book],
    book === 'ticks' && session ? TICKS_REFRESH_MS : null,
  );

  const day = minute.data;
  const series =
    day && prevClose != null
      ? minuteSeries(
          withLivePoint(day.points, snap, day.date),
          prevClose,
          !v.index,
        )
      : null;
  const bars =
    kline.data && (chart === 'day' || chart === 'week')
      ? patchLastBar(kline.data, snap, chart)
      : kline.data && minuteK
      ? kline.data
      : null;

  const now = beijingNow();
  const isTradingDay = core.sim.calendar.isTradingDay(now.date);
  const holding = holdingOf(core.sim.engine.state, code);
  const rules: RuleItem[] = sec
    ? ruleCard({
        sec,
        snap,
        t: now.t,
        isTradingDay,
        holding,
        fee: core.sim.engine.state.fee,
      })
    : [];

  useAiContext('Stock:' + code, () => {
    const lines = [
      '代码 ' + code.slice(2) + (v.index ? '（指数）' : ''),
      snap
        ? '最新 ' +
          fmtPrice(v.last, d) +
          '，涨跌 ' +
          fmtChange(v.change, d) +
          '（' +
          fmtPct(v.pct) +
          '），行情时间 ' +
          snap.date +
          ' ' +
          formatSec(snap.t)
        : '行情还没加载出来',
    ];
    if (snap) {
      lines.push(
        '今开 ' +
          fmtPrice(snap.open, d) +
          '，最高 ' +
          fmtPrice(snap.high, d) +
          '，最低 ' +
          fmtPrice(snap.low, d) +
          '，昨收 ' +
          fmtPrice(snap.prevClose, d) +
          '，成交额 ' +
          fmtAmount(snap.amount),
      );
      if (!v.index) {
        lines.push(
          '买一 ' +
            (snap.bids[0] ? fmtPrice(snap.bids[0][0], d) : '--') +
            '，卖一 ' +
            (snap.asks[0] ? fmtPrice(snap.asks[0][0], d) : '--'),
        );
      }
    }
    lines.push('正在看' + CHARTS.find(c => c[0] === chart)![1] + '图');
    if (info && !v.index) {
      lines.push(
        '市盈率（动）' +
          fmtNum(info.pe) +
          '，市净率 ' +
          fmtNum(info.pb) +
          '，总市值 ' +
          fmtCap(info.totalCap),
      );
    }
    lines.push(...rules.map(r => '规则卡 · ' + r.k + '：' + r.v));
    return {
      name: (v.index ? '指数 · ' : '个股 · ') + v.name,
      lines,
      tip: v.index
        ? '指数不能直接买卖，可以买跟踪它的 ETF。'
        : '规则卡列出这只证券现在适用的交易规则；价格笼子只在连续竞价时生效。',
    };
  });

  const color3 = (p: number | null | undefined) =>
    p == null || prevClose == null
      ? color.ink
      : trendColor[trendOf(p - prevClose)];
  const tc = trendColor[trendOf(v.pct)];

  return (
    <View style={s.page}>
      <NavBar
        title={v.name}
        sub={
          code.slice(2) +
          (sec
            ? ' · ' +
              (sec.board === 'etf'
                ? 'ETF'
                : sec.exchange === 'SH'
                ? '沪市'
                : '深市')
            : v.index
            ? ' · 指数'
            : '')
        }
        back
        right={
          v.index ? null : (
            <IconButton
              label={inWatch ? '移出自选' : '加入自选'}
              onPress={() => watch.toggle(core, code, v.name)}
            >
              <Star
                color={inWatch ? color.warn : color.ink2}
                fill={inWatch ? color.warn : 'none'}
                size={22}
              />
            </IconButton>
          )
        }
      />
      <ScrollView
        contentContainerStyle={s.pad}
        scrollEnabled={!inspectingChart}
      >
        <View style={s.top}>
          <View style={s.big}>
            <Text style={[s.bigPx, num, { color: tc }]}>
              {fmtPrice(v.last, d)}
            </Text>
            <Text style={[s.bigCh, num, { color: tc }]}>
              {fmtChange(v.change, d)}　{fmtPct(v.pct)}
            </Text>
          </View>
          <Text style={[s.time, num]}>
            {snap
              ? (snap.date !== now.date ? snap.date + ' ' : '') +
                formatSec(snap.t) +
                (snap.suspended ? ' · 停牌' : '')
              : '正在获取行情…'}
          </Text>
          <View style={s.kv}>
            <Cell k="今开" v={fmtPrice(snap?.open, d)} c={color3(snap?.open)} />
            <Cell k="最高" v={fmtPrice(snap?.high, d)} c={color3(snap?.high)} />
            <Cell k="最低" v={fmtPrice(snap?.low, d)} c={color3(snap?.low)} />
            <Cell k="昨收" v={fmtPrice(snap?.prevClose, d)} />
            <Cell k="成交量" v={snap ? fmtHands(snap.volume) : '--'} />
            <Cell k="成交额" v={snap ? fmtAmount(snap.amount) : '--'} />
            {v.index ? (
              <Cell
                k="振幅"
                v={
                  info?.amplitude != null
                    ? info.amplitude.toFixed(2) + '%'
                    : '--'
                }
              />
            ) : (
              <>
                <Cell k="涨停" v={fmtPrice(snap?.up, d)} c={color.up} />
                <Cell k="跌停" v={fmtPrice(snap?.down, d)} c={color.down} />
                <Cell
                  k="换手"
                  v={
                    info?.turnover != null
                      ? info.turnover.toFixed(2) + '%'
                      : '--'
                  }
                />
              </>
            )}
          </View>
        </View>
        <Segmented
          items={CHARTS}
          value={chart}
          onChange={setChart}
          style={s.gap}
        />
        {chart === 'min' ? (
          <MinuteChart
            key={code + ':min'}
            series={series}
            date={day?.date}
            priceLabel={v.index ? '点位' : '价格'}
            onInspectChange={setInspectingChart}
            prevClose={prevClose}
            decimals={d}
            emptyText={
              minute.loading
                ? '加载中…'
                : minute.error
                ? '分时加载失败：' + minute.error
                : '还没有分时数据（9:30 开始）'
            }
          />
        ) : (
          <KlineChart
            key={code + ':' + chart}
            bars={bars}
            chartLabel={CHARTS.find(([id]) => id === chart)![1]}
            priceLabel={v.index ? '点位' : '价格'}
            onInspectChange={setInspectingChart}
            decimals={d}
            emptyText={
              kline.loading
                ? '加载中…'
                : kline.error
                ? 'K 线加载失败：' + kline.error
                : '没有 K 线数据'
            }
          />
        )}
        <Text style={s.chartNote}>
          {chart === 'min'
            ? v.index
              ? '蓝：指数点位 · 柱：成交量'
              : '蓝：价格 · 黄：均价 · 柱：成交量'
            : minuteK
            ? '不复权 · 60 根 · 每根 ' +
              chart.slice(1) +
              ' 分钟 · MA5 / 10 / 20'
            : '前复权 · 60 根 · MA5 / 10 / 20'}
        </Text>

        {v.index ? null : (
          <>
            <Segmented
              items={BOOKS}
              value={book}
              onChange={setBook}
              style={s.gap}
            />
            {book === 'book' ? (
              <OrderBook
                snap={snap}
                d={d}
                color3={color3}
                onPick={
                  sec
                    ? (side, price) =>
                        nav.navigate('Order', {
                          side,
                          code,
                          name: v.name,
                          price,
                        })
                    : undefined
                }
              />
            ) : (
              <Ticks
                ticks={ticks.data?.ticks ?? null}
                d={d}
                color3={color3}
                loading={ticks.loading}
                error={ticks.error}
              />
            )}
            {sec ? (
              <RuleCard
                items={rules}
                lessons={relatedLessons(sec.board, sec.st)}
                onLesson={id => nav.navigate('Lesson', { id })}
              />
            ) : null}
            <F10 info={info} etf={sec?.board === 'etf'} />
            {sec && sec.board !== 'etf' ? <Company code={code} /> : null}
          </>
        )}
      </ScrollView>
      {sec ? (
        <View style={[s.tradeBar, { paddingBottom: 8 + insets.bottom }]}>
          <Pressable
            style={({ pressed }) => [
              s.tradeBtn,
              { backgroundColor: color.up },
              pressed && s.tradePressed,
            ]}
            onPress={() =>
              nav.navigate('Order', { side: 'B', code, name: v.name })
            }
            accessibilityRole="button"
          >
            <Text style={s.tradeText}>买入</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              s.tradeBtn,
              { backgroundColor: color.sell },
              pressed && s.tradePressed,
            ]}
            onPress={() =>
              nav.navigate('Order', { side: 'S', code, name: v.name })
            }
            accessibilityRole="button"
          >
            <Text style={s.tradeText}>
              卖出{holding.sellable ? '' : holding.held ? '（T+1）' : ''}
            </Text>
          </Pressable>
        </View>
      ) : null}
      <AiFab lift={sec ? 60 + insets.bottom : 0} />
    </View>
  );
}

function Cell({ k, v, c }: { k: string; v: string; c?: string }) {
  return (
    <View style={s.cell}>
      <Text style={s.cellK}>{k}</Text>
      <Text style={[s.cellV, num, c ? { color: c } : null]}>{v}</Text>
    </View>
  );
}

const CN = '一二三四五';

function OrderBook({
  snap,
  d,
  color3,
  onPick,
}: {
  snap: Snapshot | null;
  d: number;
  color3: (p: number | null | undefined) => string;
  /** 点卖盘价格 → 买入，点买盘价格 → 卖出（同花顺的习惯）。 */
  onPick?: (side: 'B' | 'S', price: number) => void;
}) {
  const row = (label: string, lv: [number, number] | undefined) => (
    <Pressable
      key={label}
      style={({ pressed }) => [s.bookRow, pressed && s.bookPressed]}
      disabled={!lv || !onPick}
      onPress={() => lv && onPick?.(label.startsWith('卖') ? 'B' : 'S', lv[0])}
      accessibilityLabel={label + (lv ? ' ' + fmtPrice(lv[0], d) : '')}
    >
      <Text style={s.bookK}>{label}</Text>
      <Text style={[s.bookP, num, { color: lv ? color3(lv[0]) : color.ink3 }]}>
        {lv ? fmtPrice(lv[0], d) : '--'}
      </Text>
      <Text style={[s.bookQ, num]}>{lv ? Math.round(lv[1] / 100) : ''}</Text>
    </Pressable>
  );
  const empty = snap && !snap.bids.length && !snap.asks.length;
  return (
    <View style={s.card}>
      {[4, 3, 2, 1, 0].map(i => row('卖' + CN[i], snap?.asks[i]))}
      <View style={s.bookMid}>
        <Text style={s.bookMidText}>
          最新{' '}
          <Text style={[num, { color: color3(snap?.last) }]}>
            {fmtPrice(snap?.last, d)}
          </Text>
        </Text>
        <Text style={[s.bookMidText, num]}>
          单位：手{onPick ? ' · 点价格下单' : ''}
        </Text>
      </View>
      {[0, 1, 2, 3, 4].map(i => row('买' + CN[i], snap?.bids[i]))}
      {empty ? (
        <Text style={s.small}>
          现在没有挂单（收盘后、开盘前或停牌时盘口是空的）。
        </Text>
      ) : null}
    </View>
  );
}

function Ticks({
  ticks,
  d,
  color3,
  loading,
  error,
}: {
  ticks: Tick[] | null;
  d: number;
  color3: (p: number | null | undefined) => string;
  loading: boolean;
  error: string | null;
}) {
  const sideColor = { B: color.up, S: color.down, M: color.ink3 };
  return (
    <View style={s.card}>
      <View style={[s.tickRow, s.tickHead]}>
        <Text style={[s.tickT, s.headText]}>时间</Text>
        <Text style={[s.tickP, s.headText]}>价格</Text>
        <Text style={[s.tickQ, s.headText]}>手数</Text>
        <Text style={[s.tickS, s.headText]}>方向</Text>
      </View>
      {ticks && ticks.length ? (
        [...ticks].reverse().map(x => (
          <View key={x.seq} style={s.tickRow}>
            <Text style={[s.tickT, num]}>
              {formatSec(x.t)}
              {x.t >= 15 * 3600 + 5 * 60 ? ' 盘后' : ''}
            </Text>
            <Text style={[s.tickP, num, { color: color3(x.price) }]}>
              {fmtPrice(x.price, d)}
            </Text>
            <Text style={[s.tickQ, num]}>{Math.round(x.volume / 100)}</Text>
            <Text style={[s.tickS, { color: sideColor[x.side] }]}>
              {x.side}
            </Text>
          </View>
        ))
      ) : (
        <Text style={s.small}>
          {loading
            ? '加载中…'
            : error
            ? '成交明细加载失败：' + error
            : '今天还没有成交'}
        </Text>
      )}
      <Text style={s.small}>
        免费行情的成交明细是「分笔」：每 3 秒左右合并成一行，不是 Level-2
        的逐笔成交。B 表示这几秒以主动买为主（买方直接按卖价成交），S
        以主动卖为主，M 分不出来。15:05
        以后是盘后固定价格交易的成交（实测腾讯的分笔大约到 15:15，之后不全）。
      </Text>
    </View>
  );
}

function RuleCard({
  items,
  lessons,
  onLesson,
}: {
  items: RuleItem[];
  lessons: LessonId[];
  onLesson: (id: LessonId) => void;
}) {
  return (
    <View style={s.rule}>
      <Text style={s.ruleH}>这只证券的交易规则</Text>
      {items.map(it => (
        <View key={it.k} style={s.ruleIt}>
          <Text style={s.ruleK}>{it.k}</Text>
          <Text style={s.ruleV}>
            {it.ok === true ? (
              <Text style={{ color: color.down }}>✓ </Text>
            ) : null}
            {it.ok === false ? (
              <Text style={{ color: color.up }}>✕ </Text>
            ) : null}
            {it.v}
          </Text>
        </View>
      ))}
      <Text style={s.ruleLessonsH}>相关规则课</Text>
      <View style={s.ruleLessons}>
        {lessons.map(id => (
          <Pressable
            key={id}
            onPress={() => onLesson(id)}
            style={s.ruleLesson}
            accessibilityRole="button"
          >
            <Text style={s.ruleLessonText}>{lessonById(id)?.title ?? id}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function F10({ info, etf }: { info: QuoteView['info']; etf: boolean }) {
  const rows: [string, string, string][] = [
    ...(etf
      ? []
      : ([
          [
            '市盈率（动）',
            fmtNum(info?.pe),
            '股价 ÷ 每股收益（按今年已披露的利润折算成全年）。粗略说是按现在的利润多少年回本，亏损时为负',
          ],
          [
            '市净率',
            fmtNum(info?.pb),
            '股价 ÷ 每股净资产。银行、地产常低于 1，科技股常很高',
          ],
        ] as [string, string, string][])),
    [
      '总市值',
      fmtCap(info?.totalCap),
      etf ? '价格 × 基金份额，也就是基金规模' : '股价 × 总股本',
    ],
    [
      '流通市值',
      fmtCap(info?.floatCap),
      etf ? 'ETF 的份额都能交易，和总市值一样' : '股价 × 能在市场上交易的股份',
    ],
    [
      '换手率',
      info?.turnover != null ? info.turnover.toFixed(2) + '%' : '--',
      '今天成交量 ÷ 流通股本，越高说明交易越活跃',
    ],
    [
      '量比',
      fmtNum(info?.volumeRatio),
      '今天每分钟平均成交量 ÷ 过去 5 天的。大于 1 说明比平时活跃',
    ],
    [
      '振幅',
      info?.amplitude != null ? info.amplitude.toFixed(2) + '%' : '--',
      '（最高 − 最低）÷ 昨收',
    ],
    [
      '外盘 / 内盘',
      info ? fmtHands(info.outer) + ' / ' + fmtHands(info.inner) : '--',
      '外盘是按卖价主动买入的量，内盘是按买价主动卖出的量',
    ],
  ];
  return (
    <View style={s.card}>
      <SectionTitle title="F10 简况" right="来自腾讯行情" />
      {rows.map(([k, val, why]) => (
        <View key={k} style={s.f10Row}>
          <View style={s.f10Line}>
            <Text style={s.f10K}>{k}</Text>
            <Text style={[s.f10V, num]}>{val}</Text>
          </View>
          <Text style={s.f10Why}>{why}</Text>
        </View>
      ))}
    </View>
  );
}

/** 公司简况（东方财富 F10，M4）：行业、主营业务、简介，只取一次；更多财务数据问 AI。 */
function Company({ code }: { code: string }) {
  const core = useCore();
  const [open, setOpen] = useState(false);
  const pr = usePolling(() => core.client.companyProfile(code), [code], null);
  if (!pr.data) {
    return null;
  }
  const p = pr.data;
  return (
    <View style={s.card}>
      <SectionTitle title="公司简况" right="来自东方财富 F10" />
      <View style={s.f10Row}>
        <Text style={s.f10K}>{p.fullName}</Text>
        <Text style={s.f10Why}>
          {p.industry +
            ' · ' +
            p.province +
            ' · 上市 ' +
            (p.listingDate ?? '--')}
        </Text>
      </View>
      <View style={s.f10Row}>
        <Text style={s.f10K}>主营业务</Text>
        <Text style={s.f10Why}>{p.mainBusiness}</Text>
      </View>
      <Pressable onPress={() => setOpen(!open)} style={s.f10Row}>
        <Text style={s.f10Why} numberOfLines={open ? undefined : 3}>
          {p.profile}
        </Text>
        <Text style={s.small}>{open ? '收起' : '展开全文'}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { paddingBottom: 90 },
  gap: { marginTop: 8 },
  top: {
    backgroundColor: color.card,
    paddingHorizontal: PAD,
    paddingTop: 10,
    paddingBottom: 6,
  },
  big: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  bigPx: { fontSize: 32, fontWeight: '600' },
  bigCh: { fontSize: 15 },
  time: { fontSize: 12, color: color.ink2, marginTop: 2 },
  kv: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  cell: {
    width: '33.33%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingRight: 10,
    paddingVertical: 3,
  },
  cellK: { fontSize: 12, color: color.ink3 },
  cellV: { fontSize: 12, color: color.ink },
  chartNote: {
    fontSize: 11,
    color: color.ink3,
    backgroundColor: color.card,
    paddingHorizontal: PAD,
    paddingBottom: 8,
  },
  card: { backgroundColor: color.card, paddingVertical: 6 },
  bookRow: { flexDirection: 'row', paddingHorizontal: PAD, paddingVertical: 3 },
  bookPressed: { backgroundColor: color.press },
  tradeBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: color.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  tradeBtn: {
    flex: 1,
    height: 42,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tradePressed: { opacity: 0.85 },
  tradeText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  bookK: { width: 40, fontSize: 13, color: color.ink3 },
  bookP: { flex: 1, textAlign: 'right', fontSize: 14 },
  bookQ: { width: 80, textAlign: 'right', fontSize: 14, color: color.ink2 },
  bookMid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 3,
    paddingHorizontal: PAD,
    paddingVertical: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  bookMidText: { fontSize: 12, color: color.ink2 },
  small: {
    fontSize: 11,
    lineHeight: 16,
    color: color.ink3,
    paddingHorizontal: PAD,
    paddingVertical: 6,
  },
  tickHead: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  headText: { color: color.ink3, fontSize: 12 },
  tickRow: { flexDirection: 'row', paddingHorizontal: PAD, paddingVertical: 3 },
  tickT: { width: 100, fontSize: 13, color: color.ink2 },
  tickP: { flex: 1, textAlign: 'right', fontSize: 13 },
  tickQ: { width: 80, textAlign: 'right', fontSize: 13, color: color.ink },
  tickS: { width: 44, textAlign: 'right', fontSize: 13, fontWeight: '600' },
  rule: {
    margin: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.learnLine,
    backgroundColor: color.card,
  },
  ruleLessonsH: {
    fontSize: 12,
    color: color.ink3,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E1EEEC',
  },
  ruleLessons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    padding: 12,
    paddingTop: 6,
  },
  ruleLesson: {
    borderWidth: 1,
    borderColor: color.learnLine,
    backgroundColor: color.learnBg,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  ruleLessonText: { fontSize: 12, color: color.learn },
  ruleH: {
    fontWeight: '600',
    color: color.learn,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    fontSize: 15,
  },
  ruleIt: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E1EEEC',
  },
  ruleK: { width: 84, fontSize: 13, color: color.ink2 },
  ruleV: { flex: 1, fontSize: 13, lineHeight: 19, color: color.ink },
  f10Row: { paddingHorizontal: PAD, paddingVertical: 6 },
  f10Line: { flexDirection: 'row', justifyContent: 'space-between' },
  f10K: { fontSize: 14, color: color.ink },
  f10V: { fontSize: 14, color: color.ink },
  f10Why: { fontSize: 11, lineHeight: 16, color: color.ink3, marginTop: 1 },
});
