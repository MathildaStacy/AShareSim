/**
 * M5.5 的两个页面：提案与记分卡（AI 的建议准不准、你的决策日志）、预设流程（一键运行、对比历次结果）。
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import {
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
import { Button, Empty, NavBar, Note, SectionTitle } from '../components/ui';
import { useAiContext, useCore, useViewLog } from '../hooks';
import type { RootStackParamList } from '../navigation/types';
import { color, num, PAD } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// ---------- 提案与记分卡 ----------

function ScoreBox({ title, l }: { title: string; l: ScoreLine }) {
  return (
    <View style={s.score}>
      <Text style={s.scoreTitle}>{title}</Text>
      <Text style={[s.scoreBig, num]}>
        {l.hitRate == null ? '—' : pctText(l.hitRate, false)}
      </Text>
      <Text style={s.sub}>命中率（已对账 {l.n} 条）</Text>
      <Text style={[s.scoreMid, num]}>{pctText(l.avgExcess)}</Text>
      <Text style={s.sub}>平均超额收益</Text>
      <Text style={s.sub}>
        未到期 {l.pending} · 观望 {l.watch}
      </Text>
      {l.thin ? (
        <Text style={s.thin}>
          样本太少（少于 {MIN_SCORE_SAMPLE} 条），不足以下结论
        </Text>
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
        <Note style={s.note}>
          {'到期按各自的基准对账：超额 = 方向 ×（标的收益 − 基准收益），用前复权收盘价，起点是提出当天的收盘。' +
            '被你拒绝的提案也照样对账：记分卡看的是建议准不准。' +
            (msg ? '\n' + msg : '')}
        </Note>
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
                        PROPOSAL_STATUS_NAME[p.status] +
                        ' · ' +
                        p.horizonDays +
                        ' 个交易日，' +
                        p.dueDate +
                        ' 对账'}
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
    <View style={s.page}>
      <NavBar
        title="预设流程"
        back
        right={
          <Button
            small
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
          一个流程 = 固定步骤（要调用哪些工具）+
          输出模板。运行时在新对话里发一条带模板的提问，模板放在你的消息里，不改系统提示，所以不影响缓存。
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
              <Button title="取消" onPress={() => setEdit(null)} />
              <Button
                title="保存"
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
                  <Text style={s.title}>
                    {f.name + (f.builtin ? '' : ' · 自定义')}
                  </Text>
                  <Text style={s.sub}>
                    {f.steps.length +
                      ' 步 · 建议思考强度 ' +
                      (EFFORT_NAME[f.effort] ?? f.effort)}
                  </Text>
                  <Text style={s.sub} numberOfLines={2}>
                    {f.steps.join(' → ')}
                  </Text>
                </View>
                {!f.builtin ? (
                  <Text
                    style={s.act}
                    onPress={() =>
                      setEdit({ ...f, stepsText: f.steps.join('\n') })
                    }
                  >
                    编辑
                  </Text>
                ) : null}
              </View>
              {f.needsCode ? (
                <TextInput
                  accessibilityLabel={f.name + ' 证券'}
                  placeholder="证券代码或名称，例如 600036"
                  placeholderTextColor={color.ink3}
                  style={[s.input, s.inputPad]}
                  value={subject[f.id] ?? ''}
                  onChangeText={v => setSubject({ ...subject, [f.id]: v })}
                />
              ) : null}
              <View style={s.btnRow}>
                <Button
                  title="运行"
                  tone="learn"
                  small
                  disabled={!!busy}
                  onPress={() => run(f)}
                />
              </View>
              {mine.length ? (
                <View>
                  <Text style={[s.label, s.inputPad]}>
                    历次运行（点开对比）
                  </Text>
                  {mine.slice(0, 5).map(r => (
                    <Pressable
                      key={r.at}
                      style={({ pressed }) => [s.row, pressed && s.pressed]}
                      accessibilityRole="button"
                      onPress={() => {
                        loadThread(core, r.threadId).catch(() => undefined);
                        nav.navigate('Ai');
                      }}
                    >
                      <Text style={s.sub}>
                        {r.at.slice(0, 16).replace('T', ' ') +
                          (r.subject ? ' · ' + r.subject : '') +
                          ' ›'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
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
  sub: { fontSize: 12, lineHeight: 17, color: color.ink3, marginTop: 2 },
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
  scoreMid: { fontSize: 18, lineHeight: 24, color: color.ink, marginTop: 6 },
  thin: { fontSize: 12, lineHeight: 17, color: color.warnInk, marginTop: 6 },
  tabs: { flexDirection: 'row', paddingHorizontal: PAD, gap: 8, marginTop: 8 },
  tab: {
    minHeight: 40,
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
    minHeight: 44,
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
    paddingHorizontal: PAD,
    marginTop: 10,
  },
  act: { fontSize: 14, color: color.learn, padding: 6 },
  error: { color: color.up, fontSize: 13, margin: 10 },
});
