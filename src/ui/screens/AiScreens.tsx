/**
 * AI 的管理页（M4 界面清单）：对话列表、AI 记忆、AI 服务、编辑服务、发给 AI 的上下文。
 * 设置类修改记操作日志（kind setting）；Key 只写「已填 / 未填」和末 4 位，不进任何上下文和日志。
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  loadThread,
  maybeCompact,
  newThread,
  preview,
  threadUsage,
  useChat,
  type Preview,
} from '../../ai/chat';
import { capturePage } from '../../ai/context';
import { loadPrefs, savePrefs } from '../../ai/services';
import {
  MEMORY_KIND_NAME,
  type AiPrefs,
  type Memory,
  type MemoryKind,
} from '../../ai/types';
import * as aiRepo from '../../data/aiRepo';
import { beijingIso } from '../../market/clock';
import { ConfirmDialog } from '../components/Dialog';
import { ChoiceRow, SwitchRow } from '../components/form';
import { Button, Empty, NavBar, Note, SectionTitle } from '../components/ui';
import { useAiContext, useCore, useViewLog } from '../hooks';
import type { RootStackParamList } from '../navigation/types';
import { toast } from '../toast';
import { color, num, PAD } from '../theme';
import { usageText } from './AiScreen';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// ---------- 对话列表 ----------

export function AiThreadsScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const current = useChat(st => st.threadId);
  const [list, setList] = useState<aiRepo.ThreadListItem[]>([]);
  const [del, setDel] = useState<aiRepo.ThreadListItem | null>(null);
  const reload = useCallback(() => {
    aiRepo
      .threads(core.db)
      .then(setList)
      .catch(() => undefined);
  }, [core]);
  useFocusEffect(reload);
  return (
    <View style={s.page}>
      <NavBar
        title="对话列表"
        back
        right={
          <Button
            small
            title="新对话"
            onPress={() => {
              newThread();
              nav.goBack();
            }}
          />
        }
      />
      <ScrollView contentContainerStyle={s.pad}>
        {list.length ? (
          <View style={s.card}>
            {list.map(t => (
              <Pressable
                key={t.id}
                style={({ pressed }) => [s.row, pressed && s.pressed]}
                onPress={() => {
                  loadThread(core, t.id).catch(() => undefined);
                  nav.goBack();
                }}
                onLongPress={() => setDel(t)}
                accessibilityRole="button"
              >
                <View style={s.grow}>
                  <Text style={s.title} numberOfLines={1}>
                    {t.id === current ? '● ' : ''}
                    {t.title}
                  </Text>
                  <Text style={s.sub} numberOfLines={2}>
                    {t.updatedAt.slice(0, 16).replace('T', ' ')} · {t.messages}{' '}
                    条消息
                    {t.summary ? ' · 摘要：' + t.summary : ''}
                  </Text>
                </View>
                <Text style={s.del} onPress={() => setDel(t)}>
                  删除
                </Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Empty text="还没有对话。回到 AI 页直接提问就会新建一个。" />
        )}
      </ScrollView>
      <ConfirmDialog
        visible={!!del}
        title="删除对话"
        rows={[{ k: '对话', v: del?.title ?? '' }]}
        okTitle="删除"
        onCancel={() => setDel(null)}
        onOk={async () => {
          const t = del!;
          setDel(null);
          await aiRepo.deleteThread(core.db, t.id);
          if (t.id === current) {
            newThread();
          }
          reload();
        }}
      >
        <Text style={s.dialogNote}>
          从这个对话记下的记忆会保留，可以在 AI 记忆里单独删。
        </Text>
      </ConfirmDialog>
    </View>
  );
}

// ---------- AI 记忆 ----------

const MODE_ITEMS: [AiPrefs['memoryMode'], string][] = [
  ['auto', '自动记住'],
  ['ask', '先问我'],
  ['off', '关闭'],
];

const KINDS: MemoryKind[] = ['background', 'preference', 'plan', 'agreement'];

export function AiMemoryScreen() {
  const core = useCore();
  const [prefs, setPrefs] = useState<AiPrefs | null>(null);
  const [mems, setMems] = useState<Memory[]>([]);
  const [edit, setEdit] = useState<{
    id: number | null;
    kind: MemoryKind;
    text: string;
  } | null>(null);
  const [del, setDel] = useState<Memory | null>(null);
  const reload = useCallback(() => {
    loadPrefs(core.db)
      .then(setPrefs)
      .catch(() => undefined);
    aiRepo
      .memories(core.db)
      .then(setMems)
      .catch(() => undefined);
  }, [core]);
  useFocusEffect(reload);
  useViewLog('ai:memory', '查看 AI 记忆');
  useAiContext('AiMemory', () => ({
    name: 'AI 记忆',
    lines: [
      '记忆模式：' +
        (MODE_ITEMS.find(m => m[0] === prefs?.memoryMode)?.[1] ?? '—'),
      '共 ' +
        mems.length +
        ' 条' +
        (mems.length > 50 ? '（超过 50 条，建议合并）' : ''),
      ...mems.map(
        m => '#' + m.id + ' [' + MEMORY_KIND_NAME[m.kind] + '] ' + m.text,
      ),
    ],
    tip: '记忆按类别列出，每条有来源对话和日期；AI 不记持仓、成交、费率、行情这类 App 里有最新值的数据。',
  }));
  const setMode = async (mode: AiPrefs['memoryMode']) => {
    if (!prefs || prefs.memoryMode === mode) {
      return;
    }
    const next = { ...prefs, memoryMode: mode };
    setPrefs(next);
    await savePrefs(core.db, next);
    await core.sim.logSetting(
      'AI 记忆模式 ' +
        MODE_ITEMS.find(m => m[0] === prefs.memoryMode)![1] +
        ' → ' +
        MODE_ITEMS.find(m => m[0] === mode)![1],
      { setting: 'aiMemoryMode' },
    );
  };
  const save = async () => {
    if (!edit || !edit.text.trim()) {
      return;
    }
    const now = beijingIso();
    if (edit.id == null) {
      await aiRepo.addMemory(
        core.db,
        { kind: edit.kind, text: edit.text.trim(), sourceThreadId: null },
        now,
      );
      await core.sim.logSetting('手动添加 AI 记忆：' + edit.text.trim(), {
        setting: 'aiMemory',
      });
    } else {
      await aiRepo.updateMemory(
        core.db,
        edit.id,
        { kind: edit.kind, text: edit.text.trim() },
        now,
      );
      await core.sim.logSetting(
        '修改 AI 记忆 #' + edit.id + '：' + edit.text.trim(),
        { setting: 'aiMemory' },
      );
    }
    setEdit(null);
    reload();
  };
  return (
    <View style={s.page}>
      <NavBar title="AI 记忆" back />
      <ScrollView
        contentContainerStyle={s.pad}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.card}>
          <ChoiceRow
            label="记忆模式"
            items={MODE_ITEMS}
            value={prefs?.memoryMode ?? 'auto'}
            onChange={setMode}
          />
        </View>
        {mems.length > 50 ? (
          <Note tone="warn" style={s.note}>
            超过 50 条了：记忆每次都会全部带上，建议把重复或过时的合并、删除。
          </Note>
        ) : null}
        {KINDS.map(k => {
          const list = mems.filter(m => m.kind === k);
          return (
            <View key={k} style={s.card}>
              <SectionTitle
                title={MEMORY_KIND_NAME[k]}
                right={list.length + ' 条'}
              />
              {list.map(m => (
                <View key={m.id} style={s.row}>
                  <View style={s.grow}>
                    <Text style={s.memText}>{m.text}</Text>
                    <Text style={s.sub}>
                      #{m.id} · {m.updatedAt.slice(0, 10)}
                      {m.sourceThreadId
                        ? ' · 来自对话 #' + m.sourceThreadId
                        : ' · 手动添加'}
                    </Text>
                  </View>
                  <Text
                    style={s.act}
                    onPress={() =>
                      setEdit({ id: m.id, kind: m.kind, text: m.text })
                    }
                  >
                    改
                  </Text>
                  <Text style={s.del} onPress={() => setDel(m)}>
                    删
                  </Text>
                </View>
              ))}
            </View>
          );
        })}
        <View style={s.card}>
          {edit ? (
            <View style={s.editBox}>
              <ChoiceRow
                label={edit.id == null ? '添加记忆' : '修改记忆 #' + edit.id}
                items={KINDS.map(
                  k => [k, MEMORY_KIND_NAME[k]] as [MemoryKind, string],
                )}
                value={edit.kind}
                onChange={k => setEdit({ ...edit, kind: k })}
              />
              <TextInput
                value={edit.text}
                onChangeText={t => setEdit({ ...edit, text: t })}
                style={s.textArea}
                multiline
                placeholder="例如：每周一集合竞价调仓"
                placeholderTextColor={color.ink3}
                accessibilityLabel="记忆内容"
              />
              <View style={s.btnRow}>
                <Button title="取消" onPress={() => setEdit(null)} />
                <Button
                  title="保存"
                  tone="learn"
                  disabled={!edit.text.trim()}
                  onPress={save}
                />
              </View>
            </View>
          ) : (
            <View style={s.editBox}>
              <Button
                title="手动添加一条"
                onPress={() =>
                  setEdit({ id: null, kind: 'background', text: '' })
                }
              />
            </View>
          )}
        </View>
      </ScrollView>
      <ConfirmDialog
        visible={!!del}
        title="删除记忆"
        rows={[{ k: '#' + (del?.id ?? ''), v: del?.text ?? '' }]}
        okTitle="删除"
        onCancel={() => setDel(null)}
        onOk={async () => {
          const m = del!;
          setDel(null);
          await aiRepo.deleteMemory(core.db, m.id);
          await core.sim.logSetting('删除 AI 记忆 #' + m.id + '：' + m.text, {
            setting: 'aiMemory',
          });
          reload();
        }}
      />
    </View>
  );
}

export { AiServiceScreen, AiServicesScreen } from './AiProviderScreens';

export function AiContextScreen() {
  const core = useCore();
  const chatSource = useChat(st => st.source);
  const [source] = useState(() => chatSource ?? capturePage());
  const messages = useChat(st => st.messages);
  const threadId = useChat(st => st.threadId);
  const [prefs, setPrefs] = useState<AiPrefs | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [clear, setClear] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const reload = useCallback(() => {
    (async () => {
      setPrefs(await loadPrefs(core.db));
      setPv(
        await preview(
          core,
          source ? { route: source.route, ctx: source.get() } : null,
        ),
      );
    })().catch(() => undefined);
  }, [core, source]);
  useEffect(reload, [reload, messages.length]);
  const update = async (patch: Partial<AiPrefs>, text: string) => {
    if (!prefs) {
      return;
    }
    const next = { ...prefs, ...patch };
    setPrefs(next);
    await savePrefs(core.db, next);
    await core.sim.logSetting(text, { setting: 'aiContext' });
    reload();
  };
  const tu = threadUsage(messages.filter(m => !m.compacted));
  const totalIn = tu.input + tu.cacheRead + tu.cacheWrite;
  const svc = pv?.service ?? null;
  return (
    <View style={s.page}>
      <NavBar title="发给 AI 的上下文" back />
      <ScrollView contentContainerStyle={s.pad}>
        <View style={s.card}>
          <SectionTitle
            title="这次会发送"
            right={
              pv ? '约 ' + pv.total.toLocaleString('zh-CN') + ' tokens' : ''
            }
          />
          {pv?.sections.map(sec => (
            <View key={sec.key}>
              <Pressable
                style={({ pressed }) => [s.row, pressed && s.pressed]}
                onPress={() => setOpen(open === sec.key ? null : sec.key)}
                accessibilityRole="button"
              >
                <View style={s.grow}>
                  <Text style={s.title}>{sec.title}</Text>
                  <Text style={s.sub}>{sec.breakpoint}</Text>
                </View>
                <Text style={[s.tokens, num]}>
                  {sec.tokens.toLocaleString('zh-CN')}
                </Text>
              </Pressable>
              {open === sec.key ? (
                <Text style={s.mono} selectable>
                  {sec.text.length > 6000
                    ? sec.text.slice(0, 6000) + '\n…（太长，只显示前 6000 字）'
                    : sec.text}
                </Text>
              ) : null}
            </View>
          ))}
          {pv ? (
            <Text style={s.hint}>
              预计 {pv.cached.toLocaleString('zh-CN')} tokens 走缓存：
              {pv.cacheNote}。
            </Text>
          ) : null}
        </View>
        {prefs ? (
          <View style={s.card}>
            <SwitchRow
              label="附带页面上下文"
              sub="你在看的页面和上面的关键数据（表单页带输入值和校验结果）"
              value={prefs.includePage}
              onChange={v =>
                update(
                  { includePage: v },
                  'AI 附带页面上下文 ' + (v ? '开' : '关'),
                )
              }
            />
            <ChoiceRow
              label="附带最近操作"
              items={[
                [0, '不带'],
                [5, '5 条'],
                [10, '10 条'],
                [20, '20 条'],
              ]}
              value={prefs.recentN}
              onChange={v =>
                update(
                  { recentN: v },
                  'AI 附带最近操作 ' + prefs.recentN + ' → ' + v + ' 条',
                )
              }
            />
            <ChoiceRow
              label="压缩阈值"
              sub="对话超过这么多条消息时，把较早的总结成摘要，只留最近 8 条原文"
              items={[
                [10, '10 条'],
                [20, '20 条'],
                [40, '40 条'],
              ]}
              value={prefs.compactAt}
              onChange={v =>
                update(
                  { compactAt: v },
                  'AI 压缩阈值 ' + prefs.compactAt + ' → ' + v + ' 条',
                )
              }
            />
            {threadId != null ? (
              <View style={s.btnPad}>
                <Button
                  small
                  title={compacting ? '压缩中…' : '现在压缩这个对话'}
                  disabled={compacting}
                  onPress={async () => {
                    setCompacting(true);
                    try {
                      const done = await maybeCompact(
                        core,
                        threadId,
                        prefs,
                        true,
                      );
                      toast.show(
                        done ? '已压缩成摘要' : '消息太少，不用压缩',
                        'learn',
                      );
                    } catch (e) {
                      toast.show(
                        e instanceof Error ? e.message : String(e),
                        'bad',
                      );
                    } finally {
                      setCompacting(false);
                    }
                  }}
                />
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={s.card}>
          <SectionTitle title="本对话的缓存" />
          {tu.cacheReported ? (
            <Text style={[s.para, num]}>
              累计输入 {totalIn.toLocaleString('zh-CN')} tokens，其中缓存读{' '}
              {tu.cacheRead.toLocaleString('zh-CN')}（命中率{' '}
              {totalIn ? ((tu.cacheRead / totalIn) * 100).toFixed(0) : 0}
              %）、缓存写 {tu.cacheWrite.toLocaleString('zh-CN')}。{'\n'}
              {usageText(tu, svc)}
            </Text>
          ) : (
            <Text style={s.para}>
              {totalIn ? '该服务没有报告缓存数据。' : '这个对话还没有提问。'}
            </Text>
          )}
          <Text style={s.para}>
            会让缓存失效：换服务或模型、改思考强度、压缩对话、超过 5
            分钟没提问（Anthropic；OpenAI 约 30 分钟）。
            {'\n'}
            不会：换页面、开关页面上下文、调操作条数、新增记忆（从下一个对话开始生效）。
          </Text>
        </View>
        {pv?.request ? (
          <View style={s.card}>
            <Pressable
              style={({ pressed }) => [s.row, pressed && s.pressed]}
              onPress={() => setOpen(open === 'json' ? null : 'json')}
              accessibilityRole="button"
            >
              <View style={s.grow}>
                <Text style={s.title}>实际请求结构（JSON）</Text>
                <Text style={s.sub}>
                  POST {pv.request.url}，请求头里的 Key 不显示
                </Text>
              </View>
            </Pressable>
            {open === 'json' ? (
              <Text style={s.mono} selectable>
                {requestJson(pv.request.body)}
              </Text>
            ) : null}
          </View>
        ) : null}
        <View style={s.btnPad}>
          <Button title="清空操作日志" onPress={() => setClear(true)} />
        </View>
      </ScrollView>
      <ConfirmDialog
        visible={clear}
        title="清空操作日志"
        rows={[]}
        okTitle="清空"
        onCancel={() => setClear(false)}
        onOk={async () => {
          setClear(false);
          await aiRepo.clearActivity(core.db);
          toast.show('操作日志已清空');
          reload();
        }}
      >
        <Text style={s.dialogNote}>
          清空后 AI
          看不到你之前的操作；归档账户的操作日志随账户保存，不会被清。学习进度、委托、交割单都不受影响。
        </Text>
      </ConfirmDialog>
    </View>
  );
}

/** 请求体太长时把每条消息的长文字截短，方便看结构。 */
function requestJson(body: Record<string, unknown>): string {
  const cut = (v: unknown): unknown => {
    if (typeof v === 'string') {
      return v.length > 300 ? v.slice(0, 300) + '…（' + v.length + ' 字）' : v;
    }
    if (Array.isArray(v)) {
      return v.map(cut);
    }
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cut(x)]));
    }
    return v;
  };
  const b = {
    ...body,
    tools:
      '（' +
      (body.tools as unknown[]).length +
      ' 个工具定义，见上面「工具定义」）',
  };
  return JSON.stringify(cut(b), null, 2);
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { paddingBottom: 40 },
  card: { backgroundColor: color.card, marginTop: 8 },
  note: { margin: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PAD,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
    gap: 10,
  },
  pressed: { backgroundColor: color.press },
  grow: { flex: 1 },
  title: { fontSize: 15, color: color.ink },
  sub: { fontSize: 12, lineHeight: 17, color: color.ink3, marginTop: 2 },
  badge: { fontSize: 12, color: color.learn },
  del: { fontSize: 13, color: color.up, paddingHorizontal: 4 },
  act: { fontSize: 13, color: color.learn, paddingHorizontal: 4 },
  memText: { fontSize: 14, lineHeight: 20, color: color.ink },
  editBox: { paddingBottom: 12 },
  textArea: {
    marginHorizontal: PAD,
    minHeight: 64,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 6,
    padding: 8,
    fontSize: 15,
    color: color.ink,
    textAlignVertical: 'top',
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: PAD,
    marginTop: 10,
  },
  btnPad: { padding: 10 },
  btnCol: { padding: 10, gap: 10 },
  field: {
    paddingHorizontal: PAD,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  fieldLabel: { fontSize: 15, color: color.ink },
  textInput: {
    marginTop: 6,
    height: 40,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 4,
    paddingHorizontal: 8,
    fontSize: 15,
    color: color.ink,
  },
  inputBad: { borderColor: color.up },
  err: { fontSize: 12, lineHeight: 17, color: color.up, marginTop: 4 },
  hint: {
    fontSize: 12,
    lineHeight: 17,
    color: color.ink3,
    padding: PAD,
    paddingTop: 8,
  },
  testLine: {
    fontSize: 13,
    color: color.ink2,
    paddingHorizontal: PAD,
    paddingVertical: 3,
  },
  tokens: { fontSize: 13, color: color.ink2 },
  mono: {
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
    color: color.ink2,
    paddingHorizontal: PAD,
    paddingVertical: 8,
    backgroundColor: color.bg,
  },
  para: {
    fontSize: 13,
    lineHeight: 20,
    color: color.ink2,
    paddingHorizontal: PAD,
    paddingBottom: 10,
  },
  dialogNote: { fontSize: 13, lineHeight: 19, color: color.ink2, marginTop: 8 },
});
