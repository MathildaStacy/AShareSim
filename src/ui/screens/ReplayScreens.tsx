/**
 * M6 回放模式（docs/M6_REPLAY.md）：
 * - 回放首页：可以回放的日期（录到了多少）、盲测、进行中和做完的练习、核对实时模拟。
 * - 新建回放：选证券、起始资金或真实账户、盲测选项。
 * - 核对：某天的实时模拟按输入日志重放，和事件日志逐笔比对。
 * 回放交易页在 ReplayRunScreen.tsx。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatSec } from '../../engine/session';
import { formatFen } from '../../engine/units';
import {
  coverageOf,
  gradeOf,
  pickBlind,
  replayDays,
  type ReplayDay,
} from '../../replay/days';
import { journalDays } from '../../replay/journal';
import {
  accountSeed,
  CASH_OPTIONS,
  createPractice,
  displayDate,
  practices,
  type PracticeRecord,
} from '../../replay/practice';
import { verifyDay } from '../../replay/verify';
import { ChoiceRow, SwitchRow } from '../components/form';
import { Button, Empty, NavBar, Note, SectionTitle } from '../components/ui';
import { fmtSignedFen, trendOf } from '../format';
import { useAiContext, useCore, usePolling, useViewLog } from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { color, num, PAD, trendColor } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const pct = (x: number) => Math.round(x * 100) + '%';
/** 分 → 「10 万」。 */
const wan = (fen: number) => fen / 1_000_000 + ' 万';

function Row({
  title,
  sub,
  right,
  rightColor,
  onPress,
  label,
}: {
  title: string;
  sub: string;
  right?: string;
  rightColor?: string;
  onPress: () => void;
  label: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={s.rowMain}>
        <Text style={[s.rowTitle, num]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={s.rowSub} numberOfLines={2}>
          {sub}
        </Text>
      </View>
      {right ? (
        <Text
          style={[s.rowRight, num, rightColor ? { color: rightColor } : null]}
        >
          {right}
        </Text>
      ) : null}
    </Pressable>
  );
}

const daySub = (d: ReplayDay) => {
  const best = d.codes[0];
  return (
    d.codes.length +
    ' 只有快照；' +
    (best ? best.name + ' 录到 ' + pct(coverageOf(best)) : '') +
    (best?.openAuction ? '，含开盘集合竞价' : '')
  );
};

const practiceSub = (r: PracticeRecord) =>
  (r.config.blind ? '盲测 · ' : '') +
  (r.config.start === 'account'
    ? '真实账户起步'
    : wan(r.config.cash) + '元起步') +
  ' · ' +
  r.config.codes.length +
  ' 只' +
  (r.status === 'running' ? ' · 回放到 ' + fmtClock(r.clock) : '');

const fmtClock = (t: number) => formatSec(t);

/** 回放首页。 */
export function ReplayScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const data = usePolling(
    async () => ({
      days: await replayDays(core.db, core.sim.now()),
      list: await practices(core.db),
      checked: await journalDays(core.db, core.sim.accountId),
    }),
    [core.sim.accountId],
    null,
  );
  const days = data.data?.days ?? [];
  const list = data.data?.list ?? [];
  const checked = (data.data?.checked ?? []).filter(
    d => core.sim.calendar.isTradingDay(d.date) && d.date < core.sim.now().date,
  );
  useViewLog('Replay', '查看 回放练习');
  useAiContext('Replay', () => ({
    name: '回放练习',
    lines: [
      '可以回放的日期 ' +
        days.length +
        ' 天' +
        (days[0]
          ? '，最近 ' + days[0].date + '（' + daySub(days[0]) + '）'
          : ''),
      '练习 ' +
        list.length +
        ' 次，进行中 ' +
        list.filter(r => r.status === 'running').length +
        ' 次',
      '能核对实时模拟的交易日 ' + checked.length + ' 天',
    ],
    tip: '回放用本地录下的快照（自选、持仓、有委托的证券，App 开着或后台跟踪时才录），在沙盒账户里按同一套引擎交易，不影响真实账户。盲测不显示日期，结束后揭晓。',
  }));
  const blind = () => {
    const pick = pickBlind(days);
    if (!pick) {
      setError(
        '还没有录到六成以上的交易日。开着 App 或打开「交易时段全程」后台跟踪录一天再来。',
      );
      return;
    }
    nav.navigate('ReplayNew', { date: pick.date, blind: true });
  };
  return (
    <View style={s.page}>
      <NavBar title="回放练习" back />
      <ScrollView
        contentContainerStyle={[s.pad, { paddingBottom: insets.bottom + 32 }]}
      >
        <Text style={s.lead}>
          用本地录下的行情重放某一天，按同一套规则和费用交易。周末也能练，不影响真实账户。
        </Text>
        {error ? (
          <Note tone="warn" style={s.gap}>
            {error}
          </Note>
        ) : null}
        <Button
          title="盲测回放（随机一天，不显示日期）"
          tone="learn"
          onPress={blind}
        />
        {list.some(r => r.status === 'running') ? (
          <>
            <SectionTitle title="进行中" />
            <View style={s.card}>
              {list
                .filter(r => r.status === 'running')
                .map(r => (
                  <Row
                    key={r.id}
                    title={displayDate(r)}
                    sub={practiceSub(r)}
                    right="继续"
                    rightColor={color.sell}
                    label={'继续回放 ' + r.id}
                    onPress={() => nav.navigate('ReplayRun', { id: r.id })}
                  />
                ))}
            </View>
          </>
        ) : null}
        <SectionTitle
          title="选一天回放"
          right={days.length ? days.length + ' 天' : undefined}
        />
        <View style={s.card}>
          {days.length ? (
            days.map(d => (
              <Row
                key={d.date}
                title={d.date}
                sub={daySub(d)}
                right={gradeOf(d.best)}
                label={'回放 ' + d.date}
                onPress={() => nav.navigate('ReplayNew', { date: d.date })}
              />
            ))
          ) : (
            <Empty
              text={
                data.loading
                  ? '正在读取…'
                  : '还没有录到可以回放的快照。交易时段开着 App，自选、持仓和有委托的证券每个快照都会存下来。'
              }
            />
          )}
        </View>
        {list.some(r => r.status === 'finished') ? (
          <>
            <SectionTitle title="做完的练习" />
            <View style={s.card}>
              {list
                .filter(r => r.status === 'finished')
                .map(r => (
                  <Row
                    key={r.id}
                    title={displayDate(r)}
                    sub={
                      practiceSub(r) +
                      ' · 成交 ' +
                      (r.result?.fills ?? 0) +
                      ' 笔'
                    }
                    right={r.result ? fmtSignedFen(r.result.pnl) : undefined}
                    rightColor={
                      r.result ? trendColor[trendOf(r.result.pnl)] : undefined
                    }
                    label={'查看回放结果 ' + r.id}
                    onPress={() => nav.navigate('ReplayRun', { id: r.id })}
                  />
                ))}
            </View>
          </>
        ) : null}
        <SectionTitle title="核对实时模拟" />
        <Text style={s.body}>
          把某天的实时模拟按记下的输入重放一遍，和当天的委托、成交逐笔比对。
        </Text>
        <View style={s.card}>
          {checked.length ? (
            checked.map(d => (
              <Row
                key={d.date}
                title={d.date}
                sub={d.inputs + ' 条输入'}
                right="核对"
                rightColor={color.learn}
                label={'核对 ' + d.date}
                onPress={() => nav.navigate('ReplayVerify', { date: d.date })}
              />
            ))
          ) : (
            <Empty text="从这个版本开始记录输入；有过交易的交易日结束后就能核对。" />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/** 新建回放：选证券和起点。 */
export function ReplayNewScreen({ route }: RootScreenProps<'ReplayNew'>) {
  const { date, blind: blindParam } = route.params;
  const core = useCore();
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const data = usePolling(
    async () => ({
      day:
        (await replayDays(core.db, core.sim.now())).find(
          d => d.date === date,
        ) ?? null,
      seed: await accountSeed(core.db, core.sim.accountId, date),
    }),
    [date],
    null,
  );
  const day = data.data?.day ?? null;
  const hasSeed = !!data.data?.seed;
  const [picked, setPicked] = useState<string[] | null>(null);
  const [cash, setCash] = useState<number>(CASH_OPTIONS[1]);
  const [start, setStart] = useState<'cash' | 'account'>('cash');
  const [blind, setBlind] = useState(!!blindParam);
  const [hideNames, setHideNames] = useState(!!blindParam);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codes =
    picked ??
    (day?.codes ?? [])
      .filter(c => coverageOf(c) >= 0.3)
      .slice(0, 6)
      .map(c => c.code);
  const toggle = (code: string) =>
    setPicked(
      codes.includes(code)
        ? codes.filter(c => c !== code)
        : codes.length >= 10
        ? codes
        : [...codes, code],
    );
  const hidden = blind;
  useViewLog('ReplayNew', hidden ? '新建盲测回放' : '新建回放 ' + date);
  useAiContext('ReplayNew', () => ({
    name: hidden ? '新建盲测回放' : '新建回放',
    lines: hidden
      ? [
          '盲测：日期已隐藏，不要推测或透露日期',
          '已选 ' + codes.length + ' 只证券',
        ]
      : [
          '日期 ' + date,
          '已选 ' + codes.join('、'),
          start === 'cash'
            ? '起始资金 ' + formatFen(cash) + ' 元'
            : '从当天开盘前的真实账户开始',
        ],
  }));
  const go = async () => {
    if (!codes.length || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await createPractice(core.db, core.sim, {
        date,
        codes,
        start,
        cash,
        blind,
        hideNames: blind && hideNames,
      });
      nav.replace('ReplayRun', { id: r.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={s.page}>
      <NavBar
        title={hidden ? '盲测回放' : '新建回放'}
        sub={hidden ? '日期已隐藏' : date}
        back
      />
      <ScrollView
        contentContainerStyle={[s.pad, { paddingBottom: insets.bottom + 32 }]}
      >
        {error ? (
          <Note tone="warn" style={s.gap}>
            {error}
          </Note>
        ) : null}
        <SectionTitle title="证券" right={codes.length + ' / 10'} />
        <View style={s.card}>
          {(day?.codes ?? []).map(c => {
            const on = codes.includes(c.code);
            const cov = coverageOf(c);
            return (
              <Pressable
                key={c.code}
                onPress={() => toggle(c.code)}
                style={({ pressed }) => [s.row, pressed && s.pressed]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={
                  (hidden && hideNames ? '证券' : c.name) + (on ? ' 已选' : '')
                }
              >
                <View style={[s.check, on && s.checkOn]}>
                  <Text style={s.checkMark}>{on ? '✓' : ''}</Text>
                </View>
                <View style={s.rowMain}>
                  <Text style={s.rowTitle} numberOfLines={1}>
                    {hidden && hideNames
                      ? '（名称已隐藏）'
                      : c.name + ' ' + c.code.slice(2)}
                  </Text>
                  <Text style={[s.rowSub, num]}>
                    录到 {pct(cov)}（{gradeOf(cov)}）·{' '}
                    {formatSec(c.first).slice(0, 5)}–
                    {formatSec(c.last).slice(0, 5)}
                    {c.openAuction ? ' · 含开盘集合竞价' : ''}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          {!day && !data.loading ? (
            <Empty text="这天没有快照了（可能已经被清理）" />
          ) : null}
        </View>
        <SectionTitle title="起点" />
        <View style={s.card}>
          <ChoiceRow
            label="账户"
            items={[
              ['cash', '只有现金'],
              ...(hasSeed
                ? ([['account', '当天的真实账户']] as ['account', string][])
                : []),
            ]}
            value={start}
            onChange={setStart}
          />
          {start === 'cash' ? (
            <ChoiceRow
              label="起始资金"
              items={CASH_OPTIONS.map(v => [v, wan(v)] as [number, string])}
              value={cash}
              onChange={setCash}
            />
          ) : (
            <Text style={s.hint}>
              用那天开盘前真实账户的资金、持仓和已挂的委托（输入日志里当天的起点）。
            </Text>
          )}
          <SwitchRow
            label="盲测"
            sub="不显示日期，交易完再揭晓"
            value={blind}
            onChange={setBlind}
          />
          {blind ? (
            <SwitchRow
              label="同时隐藏证券名称和代码"
              sub="只显示板块，规则照常（涨跌幅、价格笼子）"
              value={hideNames}
              onChange={setHideNames}
            />
          ) : null}
        </View>
        <Note style={s.gap}>
          从 9:10 开始，可以先挂预埋单参加开盘集合竞价。快照只在 App
          开着时录，没录到的时段没有成交机会；盘后固定价格交易没有数据，回放里不能下。
        </Note>
        <Button
          title={busy ? '准备中…' : '开始回放'}
          tone="learn"
          disabled={!codes.length || busy}
          onPress={go}
        />
      </ScrollView>
    </View>
  );
}

/** 核对实时模拟：结果页。 */
export function ReplayVerifyScreen({ route }: RootScreenProps<'ReplayVerify'>) {
  const { date } = route.params;
  const core = useCore();
  const insets = useSafeAreaInsets();
  const r = usePolling(
    () =>
      verifyDay(core.db, core.sim.accountId, date, {
        calendar: core.sim.calendar,
        security: c => core.sim.security(c),
      }),
    [date, core.sim.accountId],
    null,
  );
  const rep = r.data;
  useViewLog('ReplayVerify', '核对实时模拟 ' + date);
  useAiContext('ReplayVerify', () => ({
    name: '核对实时模拟 · ' + date,
    lines: rep
      ? [
          rep.ok ? '逐笔一致' : '有差异或没法完整核对',
          '成交 实时 ' +
            rep.fills.live +
            ' 笔，回放 ' +
            rep.fills.replay +
            ' 笔，一致 ' +
            rep.fills.matched +
            ' 笔',
          '事件 实时 ' +
            rep.live +
            ' 条，回放 ' +
            rep.replay +
            ' 条，一致 ' +
            rep.matched +
            ' 条',
          ...rep.missing.map(k => '实时有、回放没有：' + k),
          ...rep.extra.map(k => '回放有、实时没有：' + k),
          ...(rep.endState ?? []).map(k => '日终状态不同：' + k),
          ...rep.notes,
        ]
      : ['正在核对'],
    tip: '核对从当天的起点状态出发，按记下的输入（下单、撤单、转账、有委托的证券的快照）重放，比对委托、成交、撤单、清算。',
  }));
  return (
    <View style={s.page}>
      <NavBar title="核对实时模拟" sub={date} back />
      <ScrollView
        contentContainerStyle={[s.pad, { paddingBottom: insets.bottom + 32 }]}
      >
        {!rep ? (
          <Empty text={r.error ?? '正在重放…'} />
        ) : (
          <>
            <View style={[s.verdict, rep.ok ? s.verdictOk : s.verdictBad]}>
              <Text
                style={[
                  s.verdictText,
                  { color: rep.ok ? color.down : color.warnInk },
                ]}
              >
                {rep.ok ? '逐笔一致' : rep.segments ? '有差异' : '没法核对'}
              </Text>
              <Text style={[s.body, num]}>
                成交 {rep.fills.matched} / {rep.fills.live} 笔一致；全部事件{' '}
                {rep.matched} / {rep.live} 条一致
                {rep.replay !== rep.live
                  ? '（回放 ' + rep.replay + ' 条）'
                  : ''}
              </Text>
            </View>
            <View style={s.card}>
              <KVLine
                k="起点"
                v={rep.segments + ' 个（当天第一次输入，以及每次重启 App）'}
              />
              <KVLine k="重放的输入" v={rep.inputs + ' 条'} />
              <KVLine
                k="日终状态"
                v={
                  rep.endState == null
                    ? '还没有下一个起点（之后打开过 App 才能比）'
                    : rep.endState.length
                    ? rep.endState.length + ' 处不同'
                    : '和下一个起点一致'
                }
              />
            </View>
            {rep.notes.length ? (
              <Note tone="warn" style={s.gap}>
                {rep.notes.join('\n')}
              </Note>
            ) : null}
            {[
              ['实时有、回放没有', rep.missing],
              ['回放有、实时没有', rep.extra],
              ['日终状态不同', rep.endState ?? []],
            ].map(([title, items]) =>
              (items as string[]).length ? (
                <View key={title as string}>
                  <SectionTitle title={title as string} />
                  <View style={s.card}>
                    {(items as string[]).map((k, i) => (
                      <Text key={i} style={[s.diff, num]}>
                        {k}
                      </Text>
                    ))}
                  </View>
                </View>
              ) : null,
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function KVLine({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.kv}>
      <Text style={s.kvK}>{k}</Text>
      <Text style={[s.kvV, num]}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { padding: PAD, gap: 10 },
  lead: { fontSize: 14, color: color.ink2, lineHeight: 21 },
  body: { fontSize: 13, color: color.ink2, lineHeight: 19 },
  hint: {
    fontSize: 12,
    color: color.ink3,
    lineHeight: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  gap: { marginVertical: 2 },
  card: { backgroundColor: color.card, borderRadius: 10, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
    minHeight: 52,
  },
  pressed: { backgroundColor: color.press },
  rowMain: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 15, color: color.ink, fontWeight: '500' },
  rowSub: { fontSize: 12, color: color.ink3, lineHeight: 17 },
  rowRight: { fontSize: 14, color: color.ink2, fontWeight: '500' },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: color.ink3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: color.learn, borderColor: color.learn },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  verdict: { borderRadius: 10, padding: 14, gap: 6 },
  verdictOk: { backgroundColor: color.downBg },
  verdictBad: { backgroundColor: color.warnBg },
  verdictText: { fontSize: 18, fontWeight: '600' },
  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  kvK: { fontSize: 13, color: color.ink2 },
  kvV: { fontSize: 13, color: color.ink, flexShrink: 1, textAlign: 'right' },
  diff: {
    fontSize: 12,
    color: color.ink,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
    lineHeight: 18,
  },
});
