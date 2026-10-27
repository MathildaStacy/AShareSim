/**
 * 账户分析（M3，PRODUCT_DESIGN §6.4，路线图阶段 2）：累计收益曲线和 10 个指标，每个指标点开看公式和代入过程。
 * 数据：交割单 + 持仓证券和基准的不复权日 K（腾讯），算法在 src/learn/analysis.ts。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { addDays } from '../../engine/calendar';
import type { Li } from '../../engine/units';
import {
  analyze,
  equitySeries,
  MIN_SAMPLE,
  RISK_FREE,
} from '../../learn/analysis';
import { LinesChart } from '../charts/Charts';
import {
  AiFab,
  Button,
  Empty,
  NavBar,
  Note,
  Segmented,
} from '../components/ui';
import { useAiContext, useCore, usePolling, useViewLog } from '../hooks';
import type { RootStackParamList } from '../navigation/types';
import { color, num, PAD } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export const BENCH = {
  sh000300: '沪深300',
  sh000906: '中证800',
} as const;
type Bench = keyof typeof BENCH;

export function AnalysisScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const [bench, setBench] = useState<Bench>('sh000300');
  const [open, setOpen] = useState<string | null>(null);
  const ledger = core.sim.engine.state.ledger;
  const start = ledger.length
    ? ledger.reduce((m, e) => (e.date < m ? e.date : m), ledger[0].date)
    : null;
  const codes = [
    ...new Set(ledger.map(e => e.code).filter((c): c is string => !!c)),
  ];
  const data = usePolling(
    async () => {
      if (!start) {
        return null;
      }
      // 多取几天，第一天之前的基准收盘价用来算第一天的收益
      const from = addDays(start, -10);
      const bars = await core.client.klineRange(bench, '', from, '', '');
      const closes: Record<string, Record<string, Li>> = {};
      for (const c of codes) {
        const type = core.sim.security(c)?.type ?? '';
        const k = await core.client.klineRange(c, type, from, '', '');
        closes[c] = Object.fromEntries(k.map(b => [b.date, b.close]));
      }
      const eq = equitySeries(
        ledger,
        bars.map(b => b.date),
        closes,
      );
      const bmap = Object.fromEntries(bars.map(b => [b.date, b.close]));
      return { eq, a: analyze(eq, bmap, BENCH[bench]) };
    },
    [bench, ledger.length],
    null,
  );
  const a = data.data?.a ?? null;
  const eq = data.data?.eq ?? [];

  useViewLog('analysis', '查看 账户分析');
  useAiContext('Analysis', () => ({
    name: '学习 · 账户分析',
    lines: [
      '基准：' +
        BENCH[bench] +
        '，无风险利率按年 ' +
        (RISK_FREE * 100).toFixed(1) +
        '%',
      a
        ? '样本：' + a.from + ' 到 ' + a.to + '，' + a.n + ' 个交易日的日收益'
        : data.loading
        ? '数据加载中'
        : '还没有足够的数据（' +
          (ledger.length ? '交易日少于 2 天' : '还没有交割单') +
          '）',
      ...(a?.tooFew
        ? ['样本少于 ' + MIN_SAMPLE + ' 个交易日，指标不具备统计意义']
        : []),
      ...(a ? a.metrics.map(m => m.name + ' ' + m.value) : []),
      ...(eq.length
        ? [
            '最新一天总资产 ' +
              (eq[eq.length - 1].total / 100).toFixed(2) +
              ' 元（' +
              eq[eq.length - 1].date +
              '）',
          ]
        : []),
      ...(open && a
        ? (() => {
            const m = a.metrics.find(x => x.key === open);
            return m
              ? [
                  '展开了「' +
                    m.name +
                    '」：' +
                    m.formula +
                    '；' +
                    m.calc.join('；'),
                ]
              : [];
          })()
        : []),
      ...(data.error ? ['加载出错：' + data.error] : []),
    ],
    tip: '每天的总资产 = 收盘后资金余额 + 持仓 × 不复权收盘价，从交割单和日 K 反推；日收益用时间加权，扣掉银证转账。',
  }));

  return (
    <View style={s.page}>
      <NavBar title="账户分析" sub="阶段 2" back />
      <Segmented
        items={Object.entries(BENCH).map(([k, v]) => [
          k as Bench,
          '基准：' + v,
        ])}
        value={bench}
        onChange={setBench}
      />
      <ScrollView contentContainerStyle={s.pad}>
        {!ledger.length ? (
          <>
            <Empty text="还没有交割单。转入资金、买入几笔、过几个交易日之后再来看。" />
            <View style={s.btns}>
              <Button
                title="去银证转账"
                small
                onPress={() => nav.navigate('Transfer')}
              />
            </View>
          </>
        ) : data.loading && !data.data ? (
          <Empty text="正在取日 K…" />
        ) : data.error && !data.data ? (
          <Empty text={'加载失败：' + data.error} />
        ) : !a ? (
          <Empty text="至少要有两个交易日的收盘数据才能算收益。明天收盘后再来看。" />
        ) : (
          <>
            <View style={s.card}>
              <LinesChart
                series={[
                  {
                    name: '我的账户',
                    color: color.up,
                    values: a.cumP.map(v => v * 100),
                  },
                  {
                    name: BENCH[bench],
                    color: color.priceLine,
                    values: a.cumB.map(v => v * 100),
                  },
                  {
                    name: '超额',
                    color: color.learn,
                    values: a.cumP.map((v, i) => (v - a.cumB[i]) * 100),
                    width: 1,
                  },
                ]}
                labels={[a.from, a.to]}
              />
              <Text style={s.small}>
                {a.from} 收盘起 {a.n}{' '}
                个交易日。用时间加权收益：转入转出的钱不算收益。
              </Text>
            </View>
            {a.tooFew ? (
              <Note tone="warn" style={s.note}>
                样本只有 {a.n} 个交易日（少于 {MIN_SAMPLE}
                ），下面的指标不具备统计意义，先看懂它们怎么算。
              </Note>
            ) : null}
            <View style={s.card}>
              {a.metrics.map(m => {
                const on = open === m.key;
                return (
                  <View key={m.key}>
                    <Pressable
                      onPress={() => setOpen(on ? null : m.key)}
                      style={({ pressed }) => [s.metric, pressed && s.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={m.name}
                    >
                      <Text style={s.mName}>{m.name}</Text>
                      <Text style={[s.mVal, num]}>{m.value}</Text>
                      <Text style={s.chev}>{on ? '▾' : '▸'}</Text>
                    </Pressable>
                    {on ? (
                      <View style={s.formula}>
                        <Text style={s.fLabel}>公式</Text>
                        <Text style={[s.fText, num]}>{m.formula}</Text>
                        <Text style={s.fLabel}>代入</Text>
                        {m.calc.map((c, i) => (
                          <Text key={i} style={[s.fText, num]}>
                            {c}
                          </Text>
                        ))}
                        {m.note ? <Text style={s.fNote}>{m.note}</Text> : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </>
        )}
        <Note style={s.note}>
          数据怎么来的：每天的总资产 = 当天收盘后的资金余额 + 持仓 ×
          不复权收盘价，从交割单和日 K
          反推（不复权价才和你的成交价可比；送转股在交割单里记为红股入账）。日收益
          r = (当日总资产 − 当日转入净额) ÷ 前一日总资产 − 1。
        </Note>
      </ScrollView>
      <AiFab />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { paddingBottom: 90 },
  card: { backgroundColor: color.card, marginTop: 8 },
  note: { margin: 10 },
  btns: { flexDirection: 'row', justifyContent: 'center', padding: 12 },
  small: {
    fontSize: 11.5,
    color: color.ink3,
    paddingHorizontal: PAD,
    paddingBottom: 10,
  },
  metric: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PAD,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  pressed: { backgroundColor: color.press },
  mName: { flex: 1, fontSize: 15, color: color.ink },
  mVal: { fontSize: 15, color: color.ink, fontWeight: '600' },
  chev: { width: 18, textAlign: 'right', color: color.ink3 },
  formula: {
    backgroundColor: color.learnBg,
    paddingHorizontal: PAD,
    paddingVertical: 10,
  },
  fLabel: { fontSize: 11, color: color.learn, marginTop: 4 },
  fText: { fontSize: 13, lineHeight: 20, color: color.ink },
  fNote: { fontSize: 12, lineHeight: 18, color: color.ink2, marginTop: 6 },
});
