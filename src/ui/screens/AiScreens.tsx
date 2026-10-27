/**
 * AI 的管理页（M4 界面清单）：对话列表、AI 记忆、AI 服务、编辑服务、发给 AI 的上下文。
 * 设置类修改记操作日志（kind setting）；Key 只写「已填 / 未填」和末 4 位，不进任何上下文和日志。
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronRight } from 'lucide-react-native';
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
  aiKeys,
  loadThread,
  maybeCompact,
  newThread,
  preview,
  testConnection,
  threadUsage,
  useChat,
  type ConnectionResult,
  type Preview,
} from '../../ai/chat';
import { capturePage } from '../../ai/context';
import {
  emptyForm,
  formOf,
  keyTailOf,
  loadPrefs,
  loadServices,
  newServiceId,
  parseServiceForm,
  savePrefs,
  saveServices,
  SERVICE_FIELD_NAME,
  DEFAULT_BASE_URL,
  type ServiceForm,
} from '../../ai/services';
import {
  MEMORY_KIND_NAME,
  PROTOCOL_NAME,
  type AiPrefs,
  type AiService,
  type Memory,
  type MemoryKind,
} from '../../ai/types';
import * as aiRepo from '../../data/aiRepo';
import { beijingIso } from '../../market/clock';
import { ConfirmDialog } from '../components/Dialog';
import { CheckBar, ChoiceRow, FieldRow, SwitchRow } from '../components/form';
import { Button, Empty, NavBar, Note, SectionTitle } from '../components/ui';
import { useAiContext, useCore, useViewLog } from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
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
        <Note style={s.note}>
          每个对话单独保存，别的对话不会自动带进来；问「我们上次聊了什么」时 AI
          会检索对话的标题、摘要和消息。删除对话不会删除从它产生的记忆。
        </Note>
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
            sub="自动记住：回答下方显示「已记住」，可以撤销。先问我：每次问你要不要记。关闭：AI 不写记忆。"
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
        <Note style={s.note}>
          记忆每个对话开始时拍一个快照放进请求（改了记忆从下一个对话开始生效，这样缓存不会失效）。AI
          不记持仓、成交、费率、行情：这些每次都用工具现查。
        </Note>
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

// ---------- AI 服务 ----------

export function AiServicesScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const [list, setList] = useState<AiService[]>([]);
  const [active, setActive] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      loadServices(core.db)
        .then(setList)
        .catch(() => undefined);
      loadPrefs(core.db)
        .then(p => setActive(p.activeService))
        .catch(() => undefined);
    }, [core]),
  );
  const activeId = list.find(x => x.id === active)?.id ?? list[0]?.id;
  useViewLog('ai:services', '查看 AI 服务');
  useAiContext('AiServices', () => ({
    name: 'AI 服务',
    lines: list.length
      ? list.map(
          x =>
            x.name +
            '：' +
            PROTOCOL_NAME[x.protocol] +
            '，' +
            x.model +
            '，' +
            x.baseUrl +
            (x.id === activeId ? '（使用中）' : ''),
        )
      : ['还没有配置服务'],
  }));
  return (
    <View style={s.page}>
      <NavBar title="AI 服务" back />
      <ScrollView contentContainerStyle={s.pad}>
        {list.length ? (
          <View style={s.card}>
            {list.map(x => (
              <Pressable
                key={x.id}
                style={({ pressed }) => [s.row, pressed && s.pressed]}
                onPress={() => nav.navigate('AiService', { id: x.id })}
                accessibilityRole="button"
              >
                <View style={s.grow}>
                  <Text style={s.title}>
                    {x.name}
                    {x.id === activeId ? (
                      <Text style={s.badge}> 使用中</Text>
                    ) : null}
                  </Text>
                  <Text style={s.sub}>
                    {PROTOCOL_NAME[x.protocol]} · {x.model} · 思考{' '}
                    {EFFORT_NAME[x.effort]} · 缓存{' '}
                    {x.cache === 'auto' ? '自动' : '关闭'}
                  </Text>
                </View>
                <ChevronRight color={color.ink3} size={18} />
              </Pressable>
            ))}
          </View>
        ) : (
          <Empty text="还没有配置 AI 服务" />
        )}
        <View style={s.btnPad}>
          <Button
            title="添加服务"
            tone="learn"
            onPress={() => nav.navigate('AiService', {})}
          />
        </View>
        <Note style={s.note}>
          支持两种协议：Anthropic Messages 和 OpenAI
          Responses，官方接口或中转服务都行。请求直接发到你填的 Base
          URL，不经过其他服务器；API Key 只存在本机 Android
          Keystore，不会出现在日志、记忆和发给 AI 的上下文里。
        </Note>
      </ScrollView>
    </View>
  );
}

const EFFORT_NAME: Record<AiService['effort'], string> = {
  off: '不发送',
  low: '低',
  medium: '中',
  high: '高',
};

export function AiServiceScreen({ route }: RootScreenProps<'AiService'>) {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const id = route.params?.id ?? null;
  const [orig, setOrig] = useState<AiService | null>(null);
  const [form, setForm] = useState<ServiceForm>(() => emptyForm());
  const [isActive, setIsActive] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<ConnectionResult | null>(null);
  const [del, setDel] = useState(false);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!id) {
      return;
    }
    (async () => {
      const list = await loadServices(core.db);
      const x = list.find(v => v.id === id) ?? null;
      const p = await loadPrefs(core.db);
      setOrig(x);
      if (x) {
        setForm(formOf(x));
      }
      setIsActive((p.activeService ?? list[0]?.id) === id);
    })().catch(() => undefined);
  }, [core, id]);
  const parsed = parseServiceForm(form, !!orig);
  const err = (f: keyof typeof SERVICE_FIELD_NAME) =>
    touched && !parsed.ok ? parsed.errors[f] ?? null : null;
  const set = (patch: Partial<ServiceForm>) =>
    setForm(f => ({ ...f, ...patch }));
  useViewLog(
    'ai:service:' + (id ?? 'new'),
    id ? '编辑 AI 服务' : '添加 AI 服务',
  );
  useAiContext('AiService', () => ({
    name: id ? 'AI 服务 · 编辑' : 'AI 服务 · 添加',
    lines: [
      '名称 ' +
        (form.name || '（空）') +
        '，协议 ' +
        PROTOCOL_NAME[form.protocol],
      'Base URL ' +
        (form.baseUrl || '（空）') +
        '，模型 ' +
        (form.model || '（空）'),
      'API Key：' + (form.key ? '已填（未保存）' : orig ? '已保存' : '未填'),
      '思考强度 ' +
        EFFORT_NAME[form.effort] +
        '，缓存参数 ' +
        (form.cache === 'auto' ? '自动' : '关闭') +
        (form.protocol === 'anthropic' ? '，鉴权头 ' + form.auth : ''),
      '价格（美元 / 百万 tokens）：' +
        (form.priceInput
          ? '输入 ' +
            form.priceInput +
            '，缓存读 ' +
            form.priceCacheRead +
            '，缓存写 ' +
            form.priceCacheWrite +
            '，输出 ' +
            form.priceOutput
          : '没填'),
      '表单校验：' +
        (parsed.ok
          ? '通过'
          : '不通过：' +
            Object.entries(parsed.errors)
              .map(
                ([k, v]) =>
                  SERVICE_FIELD_NAME[k as keyof typeof SERVICE_FIELD_NAME] +
                  ' ' +
                  v,
              )
              .join('；')),
      ...(test
        ? [
            '测试连接：' +
              test.text +
              (test.lines.length ? '（' + test.lines.join('，') + '）' : ''),
          ]
        : []),
    ],
    tip: '协议要和服务对上：Anthropic 官方和兼容 Messages 的中转用 Anthropic Messages；OpenAI 官方用 OpenAI Responses。不支持缓存或思考参数的中转服务，测试连接时会自动关掉。',
  }));

  const keyOf = async (): Promise<string | null> =>
    form.key.trim() || (orig ? await aiKeys().get(orig.id) : null);

  const save = async (makeActive: boolean): Promise<AiService | null> => {
    setTouched(true);
    if (!parsed.ok) {
      return null;
    }
    const list = await loadServices(core.db);
    const sid = orig?.id ?? newServiceId();
    if (parsed.key) {
      await aiKeys().set(sid, parsed.key);
    }
    const svc: AiService = {
      ...parsed.service,
      id: sid,
      keyTail: parsed.key ? keyTailOf(parsed.key) : orig?.keyTail ?? '',
    };
    const next = orig
      ? list.map(x => (x.id === sid ? svc : x))
      : [...list, svc];
    await saveServices(core.db, next);
    const prefs = await loadPrefs(core.db);
    if (makeActive || !prefs.activeService || !list.length) {
      await savePrefs(core.db, { ...prefs, activeService: sid });
      setIsActive(true);
    }
    await core.sim.logSetting(
      (orig ? '修改 AI 服务 ' : '添加 AI 服务 ') +
        svc.name +
        '（' +
        PROTOCOL_NAME[svc.protocol] +
        '，' +
        svc.model +
        '）' +
        (makeActive ? '，设为使用中' : ''),
      { setting: 'aiService' },
    );
    setOrig(svc);
    set({ key: '' });
    return svc;
  };

  const runTest = async () => {
    setTouched(true);
    if (!parsed.ok) {
      return;
    }
    const key = await keyOf();
    if (!key) {
      return;
    }
    setTesting(true);
    setTest(null);
    try {
      const r = await testConnection(
        core,
        { ...parsed.service, id: orig?.id ?? 'test', keyTail: '' },
        key,
      );
      setTest(r);
      // 自动关掉了缓存 / 思考参数：同步到表单
      set({ cache: r.service.cache, effort: r.service.effort });
    } finally {
      setTesting(false);
    }
  };

  return (
    <View style={s.page}>
      <NavBar title={id ? '编辑服务' : '添加服务'} back />
      <ScrollView
        contentContainerStyle={s.pad}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.card}>
          <TextRow
            label="名称"
            value={form.name}
            onChange={v => set({ name: v })}
            error={err('name')}
            placeholder="例如 Claude 中转"
          />
          <ChoiceRow
            label="协议"
            items={[
              ['anthropic', PROTOCOL_NAME.anthropic],
              ['openai', PROTOCOL_NAME.openai],
            ]}
            value={form.protocol}
            onChange={p =>
              set({
                protocol: p,
                baseUrl:
                  form.baseUrl === DEFAULT_BASE_URL[form.protocol] ||
                  !form.baseUrl
                    ? DEFAULT_BASE_URL[p]
                    : form.baseUrl,
              })
            }
          />
          <TextRow
            label="Base URL"
            value={form.baseUrl}
            onChange={v => set({ baseUrl: v })}
            error={err('baseUrl')}
            placeholder="https://…"
          />
          <TextRow
            label="API Key"
            sub={
              orig?.keyTail
                ? '已保存，末 4 位 ' + orig.keyTail + '；填新的会替换'
                : '只存在本机 Android Keystore'
            }
            value={form.key}
            onChange={v => set({ key: v })}
            error={err('key')}
            placeholder={orig ? '不改就留空' : 'sk-…'}
            secure
          />
          <TextRow
            label="模型"
            value={form.model}
            onChange={v => set({ model: v })}
            error={err('model')}
            placeholder="例如 claude-sonnet-5-5"
          />
          <ChoiceRow
            label="思考强度"
            sub="讲解和问答用「低」就够；换强度会让缓存失效。服务不认这个参数时选「不发送」"
            items={[
              ['low', '低'],
              ['medium', '中'],
              ['high', '高'],
              ['off', '不发送'],
            ]}
            value={form.effort}
            onChange={v => set({ effort: v })}
          />
          <ChoiceRow
            label="缓存参数"
            sub={
              form.protocol === 'anthropic'
                ? 'cache_control 断点'
                : 'prompt_cache_key'
            }
            items={[
              ['auto', '自动'],
              ['off', '关闭'],
            ]}
            value={form.cache}
            onChange={v => set({ cache: v })}
          />
          {form.protocol === 'anthropic' ? (
            <ChoiceRow
              label="鉴权头"
              sub="官方用 x-api-key；不少中转服务要 Authorization: Bearer"
              items={[
                ['x-api-key', 'x-api-key'],
                ['bearer', 'Bearer'],
              ]}
              value={form.auth}
              onChange={v => set({ auth: v })}
            />
          ) : null}
        </View>
        <View style={s.card}>
          <SectionTitle title="价格（选填）" right="美元 / 百万 tokens" />
          <FieldRow
            label="输入"
            value={form.priceInput}
            onChangeText={v => set({ priceInput: v })}
          />
          <FieldRow
            label="缓存读"
            value={form.priceCacheRead}
            onChangeText={v => set({ priceCacheRead: v })}
          />
          <FieldRow
            label="缓存写"
            value={form.priceCacheWrite}
            onChangeText={v => set({ priceCacheWrite: v })}
          />
          <FieldRow
            label="输出"
            value={form.priceOutput}
            onChangeText={v => set({ priceOutput: v })}
            error={err('price')}
          />
          <Text style={s.hint}>
            填了以后每条回答下面显示估算费用和「不用缓存要多少」。
          </Text>
        </View>
        {touched && !parsed.ok ? (
          <CheckBar ok={false} text={Object.values(parsed.errors).join('；')} />
        ) : null}
        {test ? (
          <View style={s.card}>
            <CheckBar ok={test.ok} text={test.text} />
            {test.lines.map(l => (
              <Text key={l} style={[s.testLine, num]}>
                {l}
              </Text>
            ))}
          </View>
        ) : null}
        <View style={s.btnCol}>
          <Button
            title={testing ? '测试中…' : '测试连接'}
            disabled={testing}
            onPress={runTest}
          />
          <Button
            title="保存"
            tone="learn"
            onPress={async () => {
              const svc = await save(false);
              if (svc) {
                toast.show('已保存 ' + svc.name, 'learn');
                nav.goBack();
              }
            }}
          />
          {orig && !isActive ? (
            <Button
              title="保存并设为使用中"
              onPress={async () => {
                if (await save(true)) {
                  toast.show(
                    '已切换到 ' + form.name + '（换服务后缓存要重建）',
                    'learn',
                  );
                }
              }}
            />
          ) : null}
          {orig ? (
            <Button title="删除这个服务" onPress={() => setDel(true)} />
          ) : null}
        </View>
      </ScrollView>
      <ConfirmDialog
        visible={del}
        title="删除服务"
        rows={[{ k: '服务', v: orig?.name ?? '' }]}
        okTitle="删除"
        onCancel={() => setDel(false)}
        onOk={async () => {
          setDel(false);
          if (!orig) {
            return;
          }
          const list = (await loadServices(core.db)).filter(
            x => x.id !== orig.id,
          );
          await saveServices(core.db, list);
          await aiKeys()
            .remove(orig.id)
            .catch(() => undefined);
          const prefs = await loadPrefs(core.db);
          if (prefs.activeService === orig.id) {
            await savePrefs(core.db, {
              ...prefs,
              activeService: list[0]?.id ?? null,
            });
          }
          await core.sim.logSetting('删除 AI 服务 ' + orig.name, {
            setting: 'aiService',
          });
          nav.goBack();
        }}
      >
        <Text style={s.dialogNote}>
          Key 会从 Keystore 删除；对话和记忆保留。
        </Text>
      </ConfirmDialog>
    </View>
  );
}

/** 文字输入行（名称、地址、Key、模型这类长文本，键盘不用数字）。 */
function TextRow({
  label,
  sub,
  value,
  onChange,
  error,
  placeholder,
  secure,
}: {
  label: string;
  sub?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  placeholder?: string;
  secure?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {sub ? <Text style={s.sub}>{sub}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={color.ink3}
        style={[s.textInput, error ? s.inputBad : null]}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure}
        selectTextOnFocus
        accessibilityLabel={label}
      />
      {error ? <Text style={s.err}>{error}</Text> : null}
    </View>
  );
}

// ---------- 发给 AI 的上下文 ----------

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
              {pv.cacheNote}。token 数是按字数粗估的，以回答下方的真实用量为准。
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
