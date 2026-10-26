/**
 * 交易、学习、我的：M2 第 2 步只放账户概览和入口，交易界面在第 3 步，资金和设置在第 4 步，学习在 M3。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronRight } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../../app/boot';
import * as repo from '../../data/repos';
import { summary } from '../../engine/account';
import { formatFen } from '../../engine/units';
import { AiFab, NavBar, Note, SectionTitle } from '../components/ui';
import { useAiContext, useCore, useLive, useViewLog } from '../hooks';
import type { RootStackParamList } from '../navigation/types';
import { color, num, PAD } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function useSummary() {
  const core = useCore();
  useLive();
  const st = core.sim.engine.state;
  return {
    sum: summary(st, c => core.sim.engine.lastPrice(c)),
    state: st,
  };
}

function AccountCard() {
  const { sum, state } = useSummary();
  const cell = (k: string, v: string) => (
    <View style={s.acCell}>
      <Text style={s.acK}>{k}</Text>
      <Text style={[s.acV, num]}>{v}</Text>
    </View>
  );
  return (
    <View style={s.card}>
      <View style={s.acTop}>
        <Text style={s.acK}>总资产（元）· {state.date}</Text>
        <Text style={[s.acTotal, num]}>{formatFen(sum.total)}</Text>
      </View>
      <View style={s.acGrid}>
        {cell('可用', formatFen(sum.available))}
        {cell('可取', formatFen(sum.withdrawable))}
        {cell('持仓市值', formatFen(sum.marketValue))}
        {cell('冻结', formatFen(sum.frozen))}
        {cell('累计转入', formatFen(state.depositTotal))}
        {cell('转入上限', formatFen(state.depositCap))}
      </View>
    </View>
  );
}

function Entry({
  title,
  sub,
  onPress,
}: {
  title: string;
  sub?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [s.entry, pressed && s.pressed]}
      accessibilityRole="button"
    >
      <View style={s.grow}>
        <Text style={[s.entryT, !onPress && { color: color.ink3 }]}>
          {title}
        </Text>
        {sub ? <Text style={s.entrySub}>{sub}</Text> : null}
      </View>
      {onPress ? <ChevronRight color={color.ink3} size={20} /> : null}
    </Pressable>
  );
}

export function TradeScreen() {
  const core = useCore();
  const { sum } = useSummary();
  useViewLog('trade', '查看 交易');
  useAiContext('Trade', () => ({
    name: '交易',
    lines: [
      '总资产 ' +
        formatFen(sum.total) +
        ' 元，可用 ' +
        formatFen(sum.available) +
        ' 元，持仓市值 ' +
        formatFen(sum.marketValue) +
        ' 元',
      '持仓 ' +
        core.sim.heldCodes().length +
        ' 只，未完成委托 ' +
        core.sim.liveOrderCodes().length +
        ' 只证券',
      '下单、持仓、委托、成交、交割单界面在 M2 第 3 步上线',
    ],
  }));
  return (
    <View style={s.page}>
      <NavBar title="交易" />
      <ScrollView contentContainerStyle={s.pad}>
        <AccountCard />
        <Note style={s.note}>
          买入、卖出、撤单、持仓、当日委托、成交和交割单在 M2 第 3
          步上线；银证转账（模拟入金）在第 4 步。现在可以在「我的 →
          调试页」转入资金、试下单。
        </Note>
      </ScrollView>
      <AiFab />
    </View>
  );
}

const LEARN = [
  ['路线图进度', '阶段 0 / 1 / 2 / 3 / 7 的练习和通关标准'],
  ['规则课', 'T+1、涨跌停、集合竞价、价格笼子、交易费用等 11 课'],
  ['费用计算器', '每一笔费用怎么算出来'],
  ['集合竞价演示', '开盘价怎么按「成交量最大」产生'],
  ['账户分析', '收益、波动、夏普、回撤……每个指标都有公式'],
  ['数据中心 · 模拟执行', '本地行情库、周度调仓打卡'],
];

export function LearnScreen() {
  useViewLog('learn', '查看 学习');
  useAiContext('Learn', () => ({
    name: '学习',
    lines: ['学习模块在 M3 上线，现在只有入口'],
  }));
  return (
    <View style={s.page}>
      <NavBar title="学习" />
      <ScrollView contentContainerStyle={s.pad}>
        <Note tone="learn" style={s.note}>
          学习模块在 M3
          上线。个股详情页里的「本股规则卡」已经可以看每只证券现在适用的规则。
        </Note>
        <View style={s.card}>
          {LEARN.map(([t, sub]) => (
            <Entry key={t} title={t} sub={sub + '（M3）'} />
          ))}
        </View>
      </ScrollView>
      <AiFab />
    </View>
  );
}

const WINDOW_NAME = {
  pre: '盘前',
  session: '交易时段',
  lunch: '午间休市',
  closed: '休市',
};

export function MeScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const status = useApp(st => st.status);
  const [stats, setStats] = useState({ rows: 0, days: 0, codes: 0 });
  useEffect(() => {
    repo
      .snapshotStats(core.db)
      .then(setStats)
      .catch(() => undefined);
  }, [core, status?.lastOk]);
  useViewLog('me', '查看 我的');
  const mb = ((status?.bytesToday ?? 0) / 1024 / 1024).toFixed(2);
  useAiContext('Me', () => ({
    name: '我的',
    lines: [
      '行情：' +
        (status ? WINDOW_NAME[status.window] : '') +
        '，今日请求 ' +
        (status?.requestsToday ?? 0) +
        ' 次，约 ' +
        mb +
        ' MB',
      '本地快照 ' +
        stats.rows +
        ' 条（' +
        stats.codes +
        ' 只，' +
        stats.days +
        ' 天）',
    ],
  }));
  return (
    <View style={s.page}>
      <NavBar title="我的" />
      <ScrollView contentContainerStyle={s.pad}>
        <AccountCard />
        <View style={s.card}>
          <SectionTitle title="行情刷新" />
          <Text style={[s.line, num]}>
            {status
              ? WINDOW_NAME[status.window] +
                ' · ' +
                (status.foreground ? '前台' : '后台') +
                ' · 后台跟踪' +
                (status.tracking ? '开' : '关')
              : '…'}
          </Text>
          <Text style={[s.line, num]}>
            今日请求 {status?.requestsToday ?? 0} 次 · 约 {mb} MB
            {status?.lastError ? ' · 出错：' + status.lastError : ''}
          </Text>
          <Text style={[s.line, num, s.lineLast]}>
            本地快照 {stats.rows} 条（{stats.codes} 只，{stats.days} 天）
          </Text>
        </View>
        <View style={s.card}>
          <Entry title="银证转账 · 资金流水" sub="M2 第 4 步" />
          <Entry
            title="费率设置 · 交割单校准"
            sub="M2 第 4 步。现在用默认费率：股票万 2.5、ETF 万 0.5，最低 5 元"
          />
          <Entry
            title="后台跟踪 · 省电设置"
            sub="M2 第 4 步（HyperOS 省电策略引导）"
          />
          <Entry title="AI 设置" sub="M4" />
          <Entry
            title="调试页"
            sub="数据层、刷新、补撮合、后台跟踪的调试工具"
            onPress={() => nav.navigate('Debug')}
          />
        </View>
        <View style={s.card}>
          <SectionTitle title="关于与免责声明" />
          <Text style={s.about}>
            AShareSim 用真实行情、真实 A
            股规则和真实税费做模拟交易，只有入金是模拟的。行情来自腾讯（ETF
            排行来自新浪），分红送配来自东方财富。本 App
            只用于学习和模拟，不构成任何投资建议，不连接任何券商，不能下真实订单。规则和费率以交易所、中国结算和券商的最新公告为准。
          </Text>
        </View>
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
  acTop: { paddingHorizontal: PAD, paddingTop: 14 },
  acTotal: { fontSize: 26, fontWeight: '600', color: color.ink, marginTop: 2 },
  acGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: PAD,
    paddingVertical: 10,
  },
  acCell: { width: '33.33%', paddingVertical: 4 },
  acK: { fontSize: 12, color: color.ink3 },
  acV: { fontSize: 14, color: color.ink, marginTop: 1 },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PAD,
    paddingVertical: 12,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  pressed: { backgroundColor: color.press },
  grow: { flex: 1 },
  entryT: { fontSize: 15, color: color.ink },
  entrySub: { fontSize: 12, color: color.ink3, marginTop: 2 },
  line: {
    fontSize: 13,
    color: color.ink2,
    paddingHorizontal: PAD,
    paddingVertical: 2,
  },
  lineLast: { paddingBottom: 12 },
  about: {
    fontSize: 12,
    lineHeight: 19,
    color: color.ink2,
    paddingHorizontal: PAD,
    paddingBottom: 14,
  },
});
