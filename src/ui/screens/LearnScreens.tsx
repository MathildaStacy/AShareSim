/**
 * 学习 Tab、阶段页、M5 功能的说明页（M3，PRODUCT_DESIGN §6.4）。
 * 学习进度属于用户、不属于账户；自动项在打开这些页面、有成交、看过交割单、答完小测时检查。
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { syncLearn, toggleCheck, useLearn } from '../../app/learn';
import { LESSONS } from '../../learn/lessons';
import { lessonCheckId } from '../../learn/progress';
import {
  ALL_ITEMS,
  currentStage,
  STAGES,
  stage0Passed,
  stageItems,
  stageProgress,
  type Checks,
  type StageItem,
} from '../../learn/roadmap';
import { ConfirmDialog } from '../components/Dialog';
import { AiFab, Button, NavBar, Note, SectionTitle } from '../components/ui';
import { useAiContext, useCore, useViewLog } from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { color, num, PAD } from '../theme';
import { goRoute } from './LessonScreens';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** 打开学习相关页面时检查一次自动项。 */
function useLearnSync() {
  const core = useCore();
  useFocusEffect(
    useCallback(() => {
      syncLearn(core).catch(() => undefined);
    }, [core]),
  );
}

const day = (iso: string) => iso.slice(0, 10);
const passedLessons = (checks: Checks) =>
  LESSONS.filter(l => checks[lessonCheckId(l.id)]).length;

function itemLine(
  it: StageItem,
  checks: Checks,
  missing: Record<string, string[]>,
): string {
  const c = checks[it.id];
  return (
    (c ? '✓ ' : '○ ') +
    it.text +
    '（' +
    (it.auto ? '自动' : '手动') +
    (c
      ? '，' + day(c.doneAt) + ' 完成' + (c.basis ? '：' + c.basis : '')
      : '') +
    (!c && it.auto && missing[it.id]?.length
      ? '，还差：' + missing[it.id].join('；')
      : '') +
    '）'
  );
}

// ---------- 学习 Tab ----------

type Tool = { label: string; sub: string; go: (nav: Nav) => void };

const TOOLS: Tool[] = [
  { label: '规则课', sub: '12 课 + 小测', go: n => n.navigate('Lessons') },
  { label: '费用计算器', sub: '每一项费用', go: n => n.navigate('FeeCalc') },
  { label: '集合竞价', sub: '开盘价怎么来', go: n => n.navigate('Auction') },
  { label: '数据练习', sub: 'CSV + 标准答案', go: n => n.navigate('DataLab') },
  { label: '账户分析', sub: 'Beta / Alpha', go: n => n.navigate('Analysis') },
  {
    label: '数据中心',
    sub: '检查与核对',
    go: n => n.navigate('DataCenter'),
  },
  {
    label: '组合与调仓',
    sub: '每周执行与复盘',
    go: n => n.navigate('Portfolio'),
  },
  {
    label: '回放练习',
    sub: '周末也能练 · 盲测',
    go: n => n.navigate('Replay'),
  },
];

export function LearnScreen() {
  const nav = useNavigation<Nav>();
  const { checks, recent } = useLearn();
  const [full, setFull] = useState(false);
  useLearnSync();
  useViewLog('learn', '查看 学习');
  const cur = currentStage(checks);
  const done = ALL_ITEMS.filter(i => checks[i.id]).length;
  const passed = passedLessons(checks);
  useAiContext('Learn', () => ({
    name: '学习',
    lines: [
      '当前阶段：阶段 ' + cur.no + ' ' + cur.title,
      '总进度 ' + done + ' / ' + ALL_ITEMS.length + ' 项',
      ...STAGES.map(st => {
        const p = stageProgress(st, checks);
        return (
          '阶段 ' + st.no + ' ' + st.title + '：' + p.done + ' / ' + p.total
        );
      }),
      '规则课通过 ' + passed + ' / ' + LESSONS.length + ' 课',
      '阶段 0 ' + (stage0Passed(checks) ? '已通关' : '未通关'),
      ...(recent.length ? ['刚自动打勾：' + recent.join('；')] : []),
    ],
    tip: 'App 覆盖量化路线图的阶段 0–3 和阶段 7；阶段 4–6（单因子、回测、机器学习）在电脑上写代码。',
  }));
  return (
    <View style={s.page}>
      <NavBar title="学习" />
      <ScrollView contentContainerStyle={s.pad}>
        <Pressable
          onPress={() => nav.navigate('Stage', { no: cur.no })}
          style={s.hero}
          accessibilityRole="button"
        >
          <Text style={s.heroK}>当前阶段</Text>
          <Text style={s.heroT}>
            阶段 {cur.no} · {cur.title}
          </Text>
          <View style={s.bar}>
            <View
              style={[
                s.barFill,
                { width: (done / ALL_ITEMS.length) * 100 + '%' },
              ]}
            />
          </View>
          <Text style={[s.heroSub, num]}>
            总进度 {done} / {ALL_ITEMS.length} · 规则课 {passed} /{' '}
            {LESSONS.length} · 阶段 4–6 在电脑上做
          </Text>
        </Pressable>
        <View style={s.grid}>
          {TOOLS.map(t => (
            <Pressable
              key={t.label}
              onPress={() => t.go(nav)}
              style={({ pressed }) => [s.tool, pressed && s.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t.label}
            >
              <Text style={s.toolT}>{t.label}</Text>
              <Text style={s.toolSub}>
                {t.label === '规则课' ? passed + ' / 12 通过' : t.sub}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setFull(true)}
            style={({ pressed }) => [s.tool, pressed && s.pressed]}
            accessibilityRole="button"
            accessibilityLabel="完整路线"
          >
            <Text style={s.toolT}>完整路线</Text>
            <Text style={s.toolSub}>10 个阶段</Text>
          </Pressable>
        </View>
        <SectionTitle title="路线图" right="能自动判断的项会自动打勾" />
        <View style={s.card}>
          {STAGES.map(st => {
            const p = stageProgress(st, checks);
            const all = p.done === p.total;
            return (
              <Pressable
                key={st.no}
                onPress={() => nav.navigate('Stage', { no: st.no })}
                style={({ pressed }) => [s.stage, pressed && s.pressed]}
                accessibilityRole="button"
                accessibilityLabel={'阶段 ' + st.no}
              >
                <View
                  style={[s.stNo, all && s.stNoDone, st === cur && s.stNoCur]}
                >
                  <Text style={[s.stNoText, (all || st === cur) && s.white]}>
                    {all ? '✓' : st.no}
                  </Text>
                </View>
                <View style={s.grow}>
                  <Text style={s.stT}>{st.title}</Text>
                  <Text style={s.stSub}>
                    {st.dur} · {p.done} / {p.total}
                  </Text>
                </View>
                <ChevronRight color={color.ink3} size={20} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <ConfirmDialog
        visible={full}
        title="完整路线图"
        rows={[]}
        okTitle="知道了"
        okTone="plain"
        onOk={() => setFull(false)}
        onCancel={() => setFull(false)}
        cancelTitle="关闭"
      >
        <Text style={s.dlg}>
          完整的 10 个阶段在仓库 docs/research/quant-roadmap.html。App
          只覆盖和「了解 A 股」直接相关的阶段 0–3，并提前做阶段
          7（模拟执行）。阶段 4 单因子、5 回测、6
          机器学习需要在电脑上写代码，App 负责给它们提供数据和成交记录。
        </Text>
      </ConfirmDialog>
      <AiFab />
    </View>
  );
}

// ---------- 阶段 ----------

function ItemRow({
  it,
  checks,
  missing,
  onPress,
}: {
  it: StageItem;
  checks: Checks;
  missing: string[];
  onPress: () => void;
}) {
  const c = checks[it.id];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.item, pressed && !it.auto && s.pressed]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!c }}
      accessibilityLabel={it.text}
    >
      <View style={[s.box, c && s.boxOn]}>
        {c ? <Text style={s.boxTick}>✓</Text> : null}
      </View>
      <View style={s.grow}>
        <Text style={[s.itemT, c && s.itemDone]}>{it.text}</Text>
        <Text style={s.itemMeta}>
          {it.auto
            ? '自动'
            : it.later
            ? '手动（' + it.later + ' 上线后自动）'
            : '手动'}
          {c ? ' · ' + day(c.doneAt) + ' 完成' : ''}
        </Text>
        {c?.auto && c.basis ? <Text style={s.basis}>{c.basis}</Text> : null}
        {!c && it.auto && missing.length ? (
          <Text style={s.missing}>
            还差：
            {missing.length === 1
              ? missing[0]
              : missing.map((m, i) => '\n' + (i + 1) + '. ' + m).join('')}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function StageScreen({ route }: RootScreenProps<'Stage'>) {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const { checks, missing } = useLearn();
  useLearnSync();
  const st = STAGES.find(x => x.no === route.params.no) ?? STAGES[0];
  const p = stageProgress(st, checks);
  useViewLog('stage:' + st.no, '查看 学习 · 阶段 ' + st.no);
  useAiContext('Stage:' + st.no, () => ({
    name: '学习 · 阶段 ' + st.no + ' ' + st.title,
    lines: [
      '目标：' + st.goal + '（' + st.dur + '）',
      '完成 ' + p.done + ' / ' + p.total,
      ...st.ex.map(i => '练习 ' + itemLine(i, checks, missing)),
      ...st.pass.map(i => '通关标准 ' + itemLine(i, checks, missing)),
      ...(st.no === 0
        ? [
            '阶段 0 ' +
              (stage0Passed(checks) ? '已通关' : '未通关') +
              '（两条通关标准都打勾）',
          ]
        : []),
    ],
    tip: st.note,
  }));
  const toggle = (id: string) => toggleCheck(core, id).catch(() => undefined);
  const items = (list: StageItem[]) =>
    list.map(it => (
      <ItemRow
        key={it.id}
        it={it}
        checks={checks}
        missing={missing[it.id] ?? []}
        onPress={() => toggle(it.id)}
      />
    ));
  return (
    <View style={s.page}>
      <NavBar
        title={'阶段 ' + st.no + ' · ' + st.title}
        sub={st.dur + ' · ' + p.done + ' / ' + stageItems(st).length}
        back
      />
      <ScrollView contentContainerStyle={s.pad}>
        <View style={[s.card, s.goal]}>
          <Text style={s.goalT}>{st.goal}</Text>
          {st.note ? <Text style={s.goalNote}>{st.note}</Text> : null}
        </View>
        <SectionTitle title="要学的" />
        <View style={[s.card, s.learn]}>
          {st.learn.map(t => (
            <Text key={t} style={s.learnLi}>
              • {t}
            </Text>
          ))}
        </View>
        <SectionTitle title="练习" right="自动项不能手动改" />
        <View style={s.card}>{items(st.ex)}</View>
        <SectionTitle title="通关标准" />
        <View style={s.card}>{items(st.pass)}</View>
        {st.no === 0 && stage0Passed(checks) ? (
          <Note tone="learn" style={s.note}>
            阶段 0 已通关
          </Note>
        ) : null}
        <SectionTitle title="用到的工具" />
        <View style={[s.card, s.tools]}>
          {st.tools.map(t => (
            <Button
              key={t.label}
              title={t.label}
              tone="learn"
              small
              onPress={() => goRoute(nav, t.route, t.params)}
            />
          ))}
        </View>
      </ScrollView>
      <AiFab />
    </View>
  );
}

// ---------- M5 功能说明 ----------

const COMING = {
  datacenter: {
    title: '数据中心',
    stage: 3,
    plan: [
      '本地库表一览：每张表的行数、最后更新时间',
      '增量更新：只拉新增的数据',
      '数据质量检查：价格缺失或跳变、复权是否连续',
      '和腾讯、新浪接口交叉核对',
      '某日股票状态查询：是否在股票池、是否停牌、是否开盘就涨跌停',
    ],
    now: 'App 已经在本地存自选和持仓的 3 秒快照（设置里可以改保留天数），这是以后回放和检查的原料。阶段 3 的练习先在电脑上做，做完在阶段页手动勾选。',
  },
  exec: {
    title: '模拟执行',
    stage: 7,
    plan: [
      '本周调仓清单：手动录入或导入 CSV',
      '生成周一开盘集合竞价的预埋单',
      '成交后自动记录，未成交按固定规则补单',
      '周度打卡、连续周数、执行偏差',
      '书面交易纪律：加仓条件、暂停条件、不加杠杆',
    ],
    now: '现在就可以手动走这个流程：周五晚上在下单页挂预埋单，周一 9:25 按开盘价成交，成交依据写在成交详情里。连续 12 周的判断等 M5 上线后自动做，现在先手动勾选。',
  },
} as const;

export function ComingScreen({ route }: RootScreenProps<'Coming'>) {
  const nav = useNavigation<Nav>();
  const c = COMING[route.params.key];
  useViewLog('coming:' + route.params.key, '查看 学习 · ' + c.title + '（M5）');
  useAiContext('Coming:' + route.params.key, () => ({
    name: '学习 · ' + c.title + '（M5 上线）',
    lines: [
      '功能：' + c.title + '，对应路线图阶段 ' + c.stage + '，计划在 M5 做',
      'M5 的计划：' + c.plan.join('；'),
      '现在能做的：' + c.now,
    ],
  }));
  return (
    <View style={s.page}>
      <NavBar title={c.title} sub="M5 上线" back />
      <ScrollView contentContainerStyle={s.pad}>
        <SectionTitle title="M5 要做什么" />
        <View style={[s.card, s.learn]}>
          {c.plan.map(t => (
            <Text key={t} style={s.learnLi}>
              • {t}
            </Text>
          ))}
        </View>
        <SectionTitle title="现在能做的" />
        <Note tone="learn" style={s.note}>
          {c.now}
        </Note>
        <View style={s.tools}>
          <Button
            title={'去阶段 ' + c.stage}
            tone="learn"
            small
            onPress={() => nav.navigate('Stage', { no: c.stage })}
          />
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
  grow: { flex: 1 },
  white: { color: '#FFFFFF' },
  pressed: { backgroundColor: color.press },
  hero: {
    backgroundColor: color.learn,
    margin: 10,
    marginBottom: 2,
    borderRadius: 10,
    padding: 14,
  },
  heroK: { fontSize: 12, color: '#CFE6E4' },
  heroT: { fontSize: 18, fontWeight: '600', color: '#FFFFFF', marginTop: 2 },
  bar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginTop: 10,
    overflow: 'hidden',
  },
  barFill: { height: 6, backgroundColor: '#FFFFFF' },
  heroSub: { fontSize: 12, color: '#E5F3F2', marginTop: 8 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: color.card,
    marginTop: 8,
    paddingVertical: 4,
  },
  tool: {
    width: '25%',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 2,
  },
  toolT: { fontSize: 13, color: color.ink, fontWeight: '500' },
  toolSub: { fontSize: 10.5, color: color.ink3, marginTop: 2 },
  stage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: PAD,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  stNo: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.learnLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stNoCur: { backgroundColor: color.warn, borderColor: color.warn },
  stNoDone: { backgroundColor: color.learn, borderColor: color.learn },
  stNoText: { fontSize: 14, fontWeight: '600', color: color.learn },
  stT: { fontSize: 15, color: color.ink, fontWeight: '500' },
  stSub: { fontSize: 12, color: color.ink3, marginTop: 2 },
  dlg: { fontSize: 13, lineHeight: 20, color: color.ink2, marginTop: 8 },
  goal: { padding: PAD },
  goalT: { fontSize: 15, lineHeight: 22, color: color.ink },
  goalNote: { fontSize: 12, lineHeight: 18, color: color.ink3, marginTop: 6 },
  learn: { paddingHorizontal: PAD, paddingVertical: 10 },
  learnLi: { fontSize: 14, lineHeight: 22, color: color.ink2 },
  item: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: PAD,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: color.learnLine,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxOn: { backgroundColor: color.learn, borderColor: color.learn },
  boxTick: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  itemT: { fontSize: 14, lineHeight: 21, color: color.ink },
  itemDone: { color: color.ink2 },
  itemMeta: { fontSize: 11, color: color.ink3, marginTop: 3 },
  basis: { fontSize: 12, lineHeight: 17, color: color.learn, marginTop: 3 },
  missing: { fontSize: 12, lineHeight: 18, color: color.warnInk, marginTop: 4 },
  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
});
