/**
 * M5.5 的两个页面：提案与记分卡（AI 的建议准不准、你的决策日志）、预设流程（一键运行、对比历次结果）。
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as advice from '../../advice/repo';
import { refreshReviews, scorecard } from '../../advice/service';
import { MIN_SCORE_SAMPLE, pctText } from '../../advice/score';
import {
  PROPOSAL_STATUS_NAME,
  STANCE_NAME,
  type JournalEntry,
  type Proposal,
  type Scorecard,
  type ScoreLine,
} from '../../advice/types';
import { ask, loadThread, newThread, useChat } from '../../ai/chat';
import {
  flowPrompt,
  flowRuns,
  invalidFlow,
  loadFlows,
  recordFlowRun,
  saveCustomFlows,
  type Flow,
  type FlowRun,
} from '../../ai/flows';
import { EFFORT_NAME } from '../../ai/models';
import { beijingIso } from '../../market/clock';
import {
  Button,
  Details,
  Empty,
  NavBar,
  Note,
  SectionTitle,
} from '../components/ui';
import { useAiContext, useCore, useViewLog } from '../hooks';
import type { RootStackParamList } from '../navigation/types';
import { color, num, PAD } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// ---------- 提案与记分卡 ----------

function ScoreBox({ title, l }: { title: string; l: ScoreLine }) {
  return (
    <View style={s.score}>
      <Text style={s.scoreTitle}>{title}</Text>
      {l.n ? (
        <>
          <Text style={[s.scoreBig, num]}>{pctText(l.hitRate, false)}</Text>
          <Text style={s.sub}>命中率 · 已对账 {l.n} 条</Text>
          <Text style={[s.scoreMid, num]}>
            {'平均超额 ' + pctText(l.avgExcess)}
          </Text>
        </>
      ) : (
        <Text style={s.scoreEmpty}>暂无到期结果</Text>
      )}
      <Text style={s.sub}>
        未到期 {l.pending} · 观望 {l.watch}
      </Text>
      {l.thin && l.n > 0 ? (
        <Text style={s.thin}>样本太少 · 少于 {MIN_SCORE_SAMPLE} 条</Text>
      ) : null}
    </View>
  );
}

function proposalTitle(p: Proposal) {
  return p.kind === 'rebalance'
    ? '调仓方案 · ' + p.items.map(i => i.name).join('、')
    : STANCE_NAME[p.items[0].stance] + ' ' + p.items[0].name;
}

function reviewText(r: Proposal['review'] | JournalEntry['review']) {
  if (!r) {
    return null;
  }
  return (
    '收益 ' +
    pctText(r.ret) +
    ' · 基准 ' +
    pctText(r.benchmarkRet) +
    (r.excess != null
      ? ' · 超额 ' + pctText(r.excess) + (r.hit ? ' · 命中' : ' · 未命中')
      : ' · 观望')
  );
}

export function ProposalsScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const [tab, setTab] = useState<'ai' | 'mine'>('ai');
  const [card, setCard] = useState<Scorecard | null>(null);
  const [props, setProps] = useState<Proposal[]>([]);
  const [notes, setNotes] = useState<JournalEntry[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const reload = useCallback(() => {
    (async () => {
      const n = await refreshReviews(core).catch(e => {
        setMsg('对账没完成：' + String(e));
        return 0;
      });
      if (n) {
        setMsg('刚对完 ' + n + ' 条到期的账');
      }
      setCard(await scorecard(core.db));
      setProps(await advice.proposals(core.db, 100));
      setNotes(await advice.journal(core.db, { limit: 100 }));
    })().catch(e => setMsg(String(e)));
  }, [core]);
  useFocusEffect(reload);
  useViewLog('Proposals', '查看 提案与记分卡');
  useAiContext('Proposals', () => ({
    name: '提案与记分卡',
    lines: card
      ? [
          'AI 提案：已对账 ' +
            card.ai.n +
            ' 条，命中率 ' +
            pctText(card.ai.hitRate, false) +
            '，平均超额 ' +
            pctText(card.ai.avgExcess) +
            (card.ai.thin ? '（样本太少）' : ''),
          '我的决策：已对账 ' +
            card.user.n +
            ' 条，命中率 ' +
            pctText(card.user.hitRate, false) +
            '，平均超额 ' +
            pctText(card.user.avgExcess) +
            (card.user.thin ? '（样本太少）' : ''),
        ]
      : [],
  }));
  return (
    <View style={s.page}>
      <NavBar title="提案与记分卡" back />
      <ScrollView contentContainerStyle={s.pad}>
        {card ? (
          <View style={s.scores}>
            <ScoreBox title="AI 的提案" l={card.ai} />
            <ScoreBox title="我自己的决策" l={card.user} />
          </View>
        ) : null}
        {msg ? <Note style={s.note}>{msg}</Note> : null}
        <Details title="记分卡怎么算">
          <Text style={s.body}>
            到期按各自的基准对账：超额 = 方向 ×（标的收益 −
            基准收益），用前复权收盘价，起点是提出当天的收盘。
            被拒绝的提案也会对账。已对账少于 {MIN_SCORE_SAMPLE}{' '}
            条时，样本太少，不足以下结论。
          </Text>
        </Details>
        <View style={s.tabs}>
          {(
            [
              ['ai', 'AI 提案 ' + props.length],
              ['mine', '决策日志 ' + notes.length],
            ] as const
          ).map(([k, t]) => (
            <Pressable
              key={k}
              onPress={() => setTab(k)}
              style={[s.tab, tab === k && s.tabOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === k }}
            >
              <Text style={[s.tabText, tab === k && s.tabTextOn]}>{t}</Text>
            </Pressable>
          ))}
        </View>
        {tab === 'ai' ? (
          props.length ? (
            <View style={s.card}>
              {props.map(p => (
                <Pressable
                  key={p.id}
                  style={({ pressed }) => [s.row, pressed && s.pressed]}
                  accessibilityRole="button"
                  onPress={() => {
                    if (p.rebalanceId != null && p.status === 'executed') {
                      nav.navigate('Rebalance', { id: p.rebalanceId });
                    } else if (p.threadId != null) {
                      loadThread(core, p.threadId).catch(() => undefined);
                      nav.navigate('Ai');
                    }
                  }}
                >
                  <View style={s.grow}>
                    <Text style={s.title} numberOfLines={2}>
                      {'#' + p.id + ' ' + proposalTitle(p)}
                    </Text>
                    <Text style={s.sub}>
                      {p.createdAt.slice(0, 10) +
                        ' · ' +
                        PROPOSAL_STATUS_NAME[p.status]}
                    </Text>
                    <Text style={s.sub}>
                      {p.horizonDays + ' 个交易日 · ' + p.dueDate + ' 对账'}
                    </Text>
                    <Text style={s.sub} numberOfLines={2}>
                      {'理由：' + p.thesis}
                    </Text>
                    {p.review ? (
                      <Text style={[s.review, num]}>
                        {reviewText(p.review)}
                      </Text>
                    ) : p.reviewError ? (
                      <Text style={s.sub}>
                        {'对账未完成：' + p.reviewError}
                      </Text>
                    ) : null}
                  </View>
                  {p.threadId != null ||
                  (p.rebalanceId != null && p.status === 'executed') ? (
                    <ChevronRight size={18} color={color.ink2} />
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : (
            <Empty text="还没有提案。问 AI 买卖建议或调仓方案时，它会把建议记成提案。" />
          )
        ) : notes.length ? (
          <View style={s.card}>
            {notes.map(e => (
              <View key={e.id} style={s.row}>
                <View style={s.grow}>
                  <Text style={s.title}>
                    {(e.side === 'B' ? '买入 ' : '卖出 ') +
                      e.name +
                      (e.source === 'ai' ? ' · AI 提案' : '')}
                  </Text>
                  <Text style={s.sub}>
                    {e.createdAt.slice(0, 10) +
                      ' · ' +
                      e.dueDate +
                      ' 对账 · 基准 ' +
                      e.benchmark}
                  </Text>
                  <Text style={s.body}>{'理由：' + e.thesis}</Text>
                  {e.expectation ? (
                    <Text style={s.sub}>{'预期：' + e.expectation}</Text>
                  ) : null}
                  {e.invalidation ? (
                    <Text style={s.sub}>{'失效条件：' + e.invalidation}</Text>
                  ) : null}
                  {e.review ? (
                    <Text style={[s.review, num]}>{reviewText(e.review)}</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Empty text="还没有决策日志。下买单时在下单页写下理由，调仓确认时写下这次调仓的理由。" />
        )}
      </ScrollView>
    </View>
  );
}

// ---------- 预设流程 ----------

const EMPTY_FLOW: Flow = {
  id: '',
  name: '',
  steps: [],
  template: '',
  effort: 'low',
  needsCode: false,
};

const FLOW_PURPOSE: Record<string, string> = {
  'stock-check': '结合行情、财务和近期事件，分析一只证券的机会与风险。',
  'weekly-review': '回顾本周交易、费用和决策表现，找出下周要改进的事。',
  'pre-rebalance': '检查持仓、资金与交易限制，确认调仓前要处理的问题。',
};

export function AiFlowsScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const busy = useChat(st => st.busy);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [subject, setSubject] = useState<Record<string, string>>({});
  const [edit, setEdit] = useState<(Flow & { stepsText: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    (async () => {
      setFlows(await loadFlows(core));
      setRuns(await flowRuns(core));
    })().catch(() => undefined);
  }, [core]);
  useFocusEffect(reload);
  useViewLog('AiFlows', '查看 预设流程');

  const run = (f: Flow) => {
    const who = (subject[f.id] ?? '').trim();
    if (f.needsCode && !who) {
      setError('「' + f.name + '」要先填一只证券（代码或名称）');
      return;
    }
    if (busy) {
      setError('AI 还在回答上一个问题');
      return;
    }
    setError(null);
    newThread();
    nav.navigate('Ai');
    ask(core, {
      question: '运行预设流程「' + f.name + '」' + (who ? '：' + who : ''),
      page: null,
      attach: { label: '预设流程「' + f.name + '」', text: flowPrompt(f, who) },
    })
      .then(() => {
        const threadId = useChat.getState().threadId;
        return threadId != null
          ? recordFlowRun(core, {
              flowId: f.id,
              threadId,
              at: beijingIso(),
              ...(who ? { subject: who } : {}),
            })
          : undefined;
      })
      .catch(() => undefined);
  };

  const save = async () => {
    if (!edit) {
      return;
    }
    const f: Flow = {
      id: edit.id || 'custom-' + Date.now(),
      name: edit.name.trim(),
      steps: edit.stepsText
        .split('\n')
        .map(x => x.trim())
        .filter(Boolean),
      template: edit.template.trim(),
      effort: edit.effort,
      needsCode: edit.needsCode,
    };
    const err = invalidFlow(f, flows);
    if (err) {
      setError(err);
      return;
    }
    await saveCustomFlows(core, [
      ...flows.filter(x => !x.builtin && x.id !== f.id),
      f,
    ]);
    setEdit(null);
    setError(null);
    reload();
  };

  return (
    <KeyboardAvoidingView style={s.page} behavior="height">
      <NavBar
        title="预设流程"
        back
        right={
          <Button
            small
            style={s.headerButton}
            title="新建"
            onPress={() => setEdit({ ...EMPTY_FLOW, stepsText: '' })}
          />
        }
      />
      <ScrollView
        contentContainerStyle={s.pad}
        keyboardShouldPersistTaps="handled"
      >
        <Note style={s.note}>
          选择流程，在新对话中生成分析。运行记录可随时回看。
        </Note>
        {error ? <Text style={s.error}>{error}</Text> : null}
        {edit ? (
          <View style={s.card}>
            <SectionTitle title={edit.id ? '编辑流程' : '新建流程'} />
            <Text style={s.label}>名称</Text>
            <TextInput
              accessibilityLabel="流程名称"
              style={s.input}
              value={edit.name}
              onChangeText={v => setEdit({ ...edit, name: v })}
            />
            <Text style={s.label}>步骤（一行一个工具，例如 get_quote）</Text>
            <TextInput
              accessibilityLabel="流程步骤"
              style={[s.input, s.area]}
              multiline
              value={edit.stepsText}
              onChangeText={v => setEdit({ ...edit, stepsText: v })}
            />
            <Text style={s.label}>输出模板</Text>
            <TextInput
              accessibilityLabel="输出模板"
              style={[s.input, s.area]}
              multiline
              value={edit.template}
              onChangeText={v => setEdit({ ...edit, template: v })}
            />
            <Pressable
              style={s.row}
              onPress={() => setEdit({ ...edit, needsCode: !edit.needsCode })}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: edit.needsCode }}
            >
              <Text style={s.title}>
                {(edit.needsCode ? '☑ ' : '☐ ') + '运行时要填一只证券'}
              </Text>
            </Pressable>
            <View style={s.btnRow}>
              {edit.id ? (
                <Button
                  title="删除"
                  style={s.touchButton}
                  onPress={async () => {
                    await saveCustomFlows(
                      core,
                      flows.filter(x => !x.builtin && x.id !== edit.id),
                    );
                    setEdit(null);
                    reload();
                  }}
                />
              ) : null}
              <Button
                title="取消"
                style={s.touchButton}
                onPress={() => setEdit(null)}
              />
              <Button
                title="保存"
                style={s.touchButton}
                tone="learn"
                onPress={() => save().catch(e => setError(String(e)))}
              />
            </View>
          </View>
        ) : null}
        {flows.map(f => {
          const mine = runs.filter(r => r.flowId === f.id);
          return (
            <View key={f.id} style={s.card}>
              <View style={s.row}>
                <View style={s.grow}>
                  <Text style={s.flowTitle}>
                    {f.name + (f.builtin ? '' : ' · 自定义')}
                  </Text>
                  <Text style={s.flowPurpose}>
                    {FLOW_PURPOSE[f.id] ?? '按你设定的步骤和输出格式生成分析。'}
                  </Text>
                </View>
                {!f.builtin ? (
                  <Pressable
                    style={s.editButton}
                    accessibilityRole="button"
                    accessibilityLabel={'编辑' + f.name}
                    onPress={() =>
                      setEdit({ ...f, stepsText: f.steps.join('\n') })
                    }
                  >
                    <Text style={s.act}>编辑</Text>
                  </Pressable>
                ) : null}
              </View>
              {f.needsCode ? (
                <TextInput
                  accessibilityLabel={f.name + ' 证券'}
                  placeholder="证券代码或名称，例如 600036"
                  placeholderTextColor={color.ink2}
                  style={[s.input, s.inputPad]}
                  value={subject[f.id] ?? ''}
                  onChangeText={v => setSubject({ ...subject, [f.id]: v })}
                />
              ) : null}
              <View style={s.flowRun}>
                <Button
                  title={'运行' + f.name}
                  tone="learn"
                  style={s.touchButton}
                  disabled={!!busy}
                  onPress={() => run(f)}
                />
              </View>
              <Details title="步骤与输出格式">
                <Text style={s.sub}>
                  {'建议思考强度：' + (EFFORT_NAME[f.effort] ?? f.effort)}
                </Text>
                {f.steps.map((step, i) => (
                  <Text key={i} style={s.flowStep}>
                    {i + 1 + '. ' + step}
                  </Text>
                ))}
                <Text style={s.flowTitle}>输出格式</Text>
                <Text style={s.body}>{f.template}</Text>
              </Details>
              {mine.length ? (
                <Details title={'运行记录 · ' + mine.length + ' 次'}>
                  {mine.slice(0, 5).map(r => (
                    <Pressable
                      key={r.at}
                      style={({ pressed }) => [
                        s.historyRow,
                        pressed && s.pressed,
                      ]}
                      accessibilityRole="button"
                      onPress={() => {
                        loadThread(core, r.threadId).catch(() => undefined);
                        nav.navigate('Ai');
                      }}
                    >
                      <Text style={[s.sub, s.grow]}>
                        {r.at.slice(0, 16).replace('T', ' ') +
                          (r.subject ? ' · ' + r.subject : '')}
                      </Text>
                      <ChevronRight size={18} color={color.ink2} />
                    </Pressable>
                  ))}
                </Details>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { paddingBottom: 40 },
  note: { margin: 10 },
  card: { backgroundColor: color.card, marginTop: 8, paddingBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PAD,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
    gap: 10,
    minHeight: 48,
  },
  pressed: { backgroundColor: color.press },
  grow: { flex: 1 },
  title: { fontSize: 15, lineHeight: 21, color: color.ink },
  body: { fontSize: 14, lineHeight: 20, color: color.ink, marginTop: 2 },
  sub: { fontSize: 12, lineHeight: 18, color: color.ink2, marginTop: 2 },
  flowTitle: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    color: color.ink,
  },
  flowPurpose: {
    fontSize: 14,
    lineHeight: 21,
    color: color.ink2,
    marginTop: 4,
  },
  flowStep: {
    fontSize: 13,
    lineHeight: 20,
    color: color.ink2,
    marginVertical: 4,
  },
  flowRun: {
    alignItems: 'flex-end',
    paddingHorizontal: PAD,
    paddingTop: 12,
    paddingBottom: 4,
  },
  headerButton: { minWidth: 48, minHeight: 48, height: 'auto' },
  touchButton: { minHeight: 48, height: 'auto', paddingVertical: 12 },
  editButton: {
    minWidth: 48,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  historyRow: {
    minHeight: 48,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  review: { fontSize: 13, lineHeight: 19, color: color.learn, marginTop: 4 },
  scores: { flexDirection: 'row', gap: 8, padding: 10 },
  score: { flex: 1, backgroundColor: color.card, borderRadius: 8, padding: 12 },
  scoreTitle: { fontSize: 13, color: color.ink2, marginBottom: 6 },
  scoreBig: {
    fontSize: 26,
    lineHeight: 32,
    color: color.ink,
    fontWeight: '600',
  },
  scoreMid: { fontSize: 13, lineHeight: 20, color: color.ink, marginTop: 6 },
  scoreEmpty: {
    fontSize: 14,
    lineHeight: 22,
    color: color.ink,
    marginVertical: 4,
  },
  thin: { fontSize: 12, lineHeight: 17, color: color.warnInk, marginTop: 6 },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: PAD,
    gap: 8,
    marginTop: 8,
  },
  tab: {
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: color.card,
  },
  tabOn: { backgroundColor: color.ink },
  tabText: { fontSize: 14, color: color.ink },
  tabTextOn: { color: '#FFFFFF' },
  label: {
    fontSize: 13,
    color: color.ink2,
    marginTop: 10,
    paddingHorizontal: PAD,
  },
  input: {
    marginHorizontal: PAD,
    marginTop: 6,
    minHeight: 48,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 6,
    paddingHorizontal: 8,
    fontSize: 15,
    color: color.ink,
  },
  inputPad: { marginTop: 8 },
  area: { minHeight: 96, textAlignVertical: 'top', paddingVertical: 8 },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    flexWrap: 'wrap',
    paddingHorizontal: PAD,
    marginTop: 10,
  },
  act: { fontSize: 14, color: color.learn, padding: 6 },
  error: { color: color.up, fontSize: 13, margin: 10 },
});
