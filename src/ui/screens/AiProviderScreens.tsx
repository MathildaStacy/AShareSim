/** 供应商拥有连接和 Key，模型拥有能力与价格；编辑期间保留本地草稿，保存后才生效。 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Check, ChevronRight, Plus, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listModels } from '../../ai/catalog';
import {
  aiKeys,
  aiTransport,
  testConnection,
  useChat,
  type ConnectionResult,
} from '../../ai/chat';
import {
  capabilitiesOf,
  EFFORT_NAME,
  EFFORT_ORDER,
  normaliseConfig,
  prettyModel,
  PROVIDER_PRESETS,
  resolvedService,
} from '../../ai/models';
import { endpointOf } from '../../ai/protocol';
import {
  emptyProvider,
  keyTailOf,
  loadProviders,
  saveProviders,
} from '../../ai/services';
import {
  PROTOCOL_NAME,
  type AiProvider,
  type ModelCapabilities,
  type ModelEntry,
  type Protocol,
  type ProviderKind,
} from '../../ai/types';
import { AiSheet, CapabilityTags, ProviderMark } from '../components/AiOptions';
import { ConfirmDialog } from '../components/Dialog';
import { ChoiceRow, SwitchRow } from '../components/form';
import {
  Button,
  Empty,
  IconButton,
  NavBar,
  Note,
  SectionTitle,
} from '../components/ui';
import { useAiContext, useCore, useViewLog } from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { color, PAD } from '../theme';
import { toast } from '../toast';

type Nav = NativeStackNavigationProp<RootStackParamList>;
export function AiServicesScreen() {
  const core = useCore(),
    nav = useNavigation<Nav>(),
    [providers, setProviders] = useState<AiProvider[]>([]);
  useViewLog('ai:providers', '查看供应商与模型');
  useFocusEffect(
    useCallback(() => {
      loadProviders(core.db)
        .then(setProviders)
        .catch(e => toast.show(String(e)));
    }, [core]),
  );
  return (
    <View style={s.page}>
      <NavBar
        title="供应商与模型"
        back
        right={
          <IconButton
            label="添加供应商"
            onPress={() => nav.navigate('AiService', {})}
          >
            <Plus size={22} color={color.learn} />
          </IconButton>
        }
      />
      <ScrollView contentContainerStyle={s.pad}>
        <Note>
          供应商保存连接和
          Key，模型分别设置能力与价格。聊天时可随时选择已启用的模型。
        </Note>
        {providers.map(p => (
          <Pressable
            key={p.id}
            style={s.provider}
            onPress={() => nav.navigate('AiService', { id: p.id })}
            accessibilityRole="button"
            accessibilityLabel={'编辑供应商 ' + p.name}
          >
            <ProviderMark provider={p} />
            <View style={s.grow}>
              <Text style={s.title}>{p.name}</Text>
              <Text style={s.sub}>{PROTOCOL_NAME[p.protocol]}</Text>
              <Text style={s.sub}>
                {p.models.filter(m => m.enabled).length +
                  ' 个已启用模型 · ' +
                  (p.keyTail ? 'Key 已保存' : '待填写 Key')}
              </Text>
            </View>
            <ChevronRight size={20} color={color.ink3} />
          </Pressable>
        ))}
        {!providers.length ? <Empty text="还没有供应商" /> : null}
        <Button
          title="添加供应商"
          tone="learn"
          onPress={() => nav.navigate('AiService', {})}
        />
        <Text style={s.foot}>
          API Key 只保存在本机安全存储，不会写入日志、记忆或发给 AI
          的上下文。模型列表由你的接口实时返回。
        </Text>
      </ScrollView>
    </View>
  );
}

export function AiServiceScreen({ route }: RootScreenProps<'AiService'>) {
  const core = useCore(),
    nav = useNavigation<Nav>(),
    safe = useSafeAreaInsets();
  const id = route.params?.id;
  const [draft, setDraft] = useState<AiProvider | null>(null),
    [original, setOriginal] = useState<AiProvider | null>(null),
    [key, setKey] = useState(''),
    [query, setQuery] = useState(''),
    [manual, setManual] = useState('');
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState(''),
    [result, setResult] = useState<ConnectionResult | null>(null),
    [editing, setEditing] = useState<ModelEntry | null>(null),
    [deleting, setDeleting] = useState(false),
    [testModel, setTestModel] = useState('');
  const request = useRef<AbortController | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (id) {
      loadProviders(core.db)
        .then(ps => {
          const p = ps.find(x => x.id === id);
          if (p) {
            setDraft(p);
            setOriginal(p);
          } else {
            setError('供应商已被删除');
          }
        })
        .catch(e => setError(String(e)));
    }
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, [core, id]);
  const patch = (p: Partial<AiProvider>) => {
    setDraft(x => (x ? { ...x, ...p } : x));
    setResult(null);
    setError('');
  };
  const changeModel = (model: ModelEntry) =>
    patch({ models: draft!.models.map(m => (m.id === model.id ? model : m)) });
  const getKey = async () =>
    key.trim() || (id ? await aiKeys().get(id) : null) || '';
  const validate = () => {
    if (!draft?.name.trim()) {
      throw new Error('请填写供应商名称');
    }
    endpointOf(draft.protocol, draft.baseUrl);
  };
  const fetchModels = async () => {
    try {
      validate();
      const credential = await getKey();
      if (!credential) {
        throw new Error('请先填写 API Key');
      }
      setBusy('正在获取模型列表…');
      setError('');
      request.current = new AbortController();
      const models = await listModels(draft!, credential, {
        signal: request.current.signal,
        fetchImpl: aiTransport(),
      });
      if (mounted.current) {
        patch({ models, fetchedAt: new Date().toISOString() });
        toast.show('已获取 ' + models.length + ' 个模型，请勾选要启用的模型');
      }
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (mounted.current) {
        setBusy(null);
      }
    }
  };
  const save = async () => {
    try {
      validate();
      const credential = await getKey();
      if (!credential) {
        throw new Error('请填写 API Key');
      }
      if (
        !draft!.models.some(m => m.enabled && capabilitiesOf(draft!, m).chat)
      ) {
        throw new Error('请至少启用一个对话模型');
      }
      setBusy('保存中…');
      const p = {
        ...draft!,
        name: draft!.name.trim(),
        baseUrl: draft!.baseUrl.trim(),
        keyTail: keyTailOf(credential),
      };
      if (key.trim()) {
        await aiKeys().set(p.id, credential);
      }
      const ps = await loadProviders(core.db);
      await saveProviders(
        core.db,
        ps.some(x => x.id === p.id)
          ? ps.map(x => (x.id === p.id ? p : x))
          : [...ps, p],
      );
      await core.sim.logSetting(
        (original ? '修改' : '添加') + '供应商 ' + p.name,
        {
          provider: p.name,
          protocol: p.protocol,
          models: p.models.filter(m => m.enabled).map(m => m.id),
          key: '已保存',
        },
      );
      nav.goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    try {
      validate();
      const credential = await getKey();
      if (!credential) {
        throw new Error('请先填写 API Key');
      }
      const m =
        draft!.models.find(x => x.id === testModel) ??
        draft!.models.find(x => x.enabled && capabilitiesOf(draft!, x).chat);
      if (!m) {
        throw new Error('先获取模型列表并启用一个对话模型，或手动添加模型');
      }
      setBusy('正在测试 ' + prettyModel(m.id) + '…');
      setError('');
      const cfg = normaliseConfig(
        { providerId: draft!.id, model: m.id, effort: 'low', search: false },
        [draft!],
      );
      const service = resolvedService(
        [
          {
            ...draft!,
            models: draft!.models.map(x =>
              x.id === m.id ? { ...x, enabled: true } : x,
            ),
          },
        ],
        cfg,
      )!;
      const r = await testConnection(core, service, credential);
      if (mounted.current) {
        setResult(r);
        patch({
          cache: r.service.cache,
          models: draft!.models.map(x =>
            x.id === m.id &&
            service.effort !== 'off' &&
            r.service.effort === 'off'
              ? {
                  ...x,
                  overrides: {
                    ...x.overrides,
                    thinking: [],
                    thinkingStyle: 'none',
                  },
                }
              : x,
          ),
        });
        setResult(r);
      }
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (mounted.current) {
        setBusy(null);
      }
    }
  };
  const remove = async () => {
    if (!original) {
      return;
    }
    await saveProviders(
      core.db,
      (await loadProviders(core.db)).filter(p => p.id !== original.id),
    );
    await aiKeys().remove(original.id);
    if (useChat.getState().config?.providerId === original.id) {
      useChat.setState({ config: null });
    }
    nav.goBack();
  };
  useAiContext('AiService', () => ({
    name: original ? '供应商 · 编辑' : '供应商 · 添加',
    lines: draft
      ? [
          '供应商：' + draft.name,
          '协议：' + PROTOCOL_NAME[draft.protocol],
          'Base URL：' + draft.baseUrl,
          'API Key：' +
            (key.trim() ? '已填（未保存）' : draft.keyTail ? '已保存' : '未填'),
          '启用模型：' +
            draft.models
              .filter(m => m.enabled)
              .map(m => m.id)
              .join('、'),
        ]
      : ['选择供应商预设'],
  }));
  const input = (
    label: string,
    value: string,
    onChangeText: (v: string) => void,
    placeholder?: string,
    secure = false,
  ) => (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={s.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color.ink3}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure}
        editable={!busy}
      />
    </View>
  );
  if (!draft) {
    return (
      <View style={s.page}>
        <NavBar title={id ? '编辑供应商' : '添加供应商'} back />
        <ScrollView contentContainerStyle={s.pad}>
          {id ? (
            <Text style={s.error}>{error || '正在读取配置…'}</Text>
          ) : (
            <>
              <Text style={s.intro}>选择供应商</Text>
              <Text style={s.sub}>预设接口，也支持自定义中转地址。</Text>
              {(Object.keys(PROVIDER_PRESETS) as ProviderKind[]).map(kind => {
                const p = emptyProvider(kind);
                return (
                  <Pressable
                    key={kind}
                    style={s.provider}
                    onPress={() => setDraft(p)}
                    accessibilityRole="button"
                    accessibilityLabel={'添加 ' + PROVIDER_PRESETS[kind].name}
                  >
                    <ProviderMark provider={p} />
                    <View style={s.grow}>
                      <Text style={s.title}>{PROVIDER_PRESETS[kind].name}</Text>
                      <Text style={s.sub}>{PROTOCOL_NAME[p.protocol]}</Text>
                    </View>
                    <ChevronRight size={20} color={color.ink3} />
                  </Pressable>
                );
              })}
            </>
          )}
        </ScrollView>
      </View>
    );
  }
  const matches = draft.models.filter(m =>
    (m.id + ' ' + (m.name ?? '')).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <KeyboardAvoidingView
      style={s.page}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <NavBar
        title={
          original
            ? '编辑 ' + original.name
            : '添加 ' + PROVIDER_PRESETS[draft.kind].name
        }
        back
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.pad}
      >
        <View style={s.card}>
          {input(
            '供应商名称',
            draft.name,
            v => patch({ name: v }),
            '例如：我的中转服务',
          )}
          <ChoiceRow
            label="协议"
            value={draft.protocol}
            items={(Object.keys(PROTOCOL_NAME) as Protocol[]).map(p => [
              p,
              PROTOCOL_NAME[p],
            ])}
            onChange={protocol =>
              patch({
                protocol,
                auth: protocol === 'anthropic' ? 'x-api-key' : 'bearer',
              })
            }
          />
          {input(
            'Base URL',
            draft.baseUrl,
            v => patch({ baseUrl: v }),
            'https://api.example.com/v1',
          )}
          {input(
            'API Key',
            key,
            setKey,
            draft.keyTail
              ? '已保存，末 4 位 ' + draft.keyTail + '；留空沿用'
              : '填写 API Key',
            true,
          )}
          {draft.protocol === 'anthropic' ? (
            <ChoiceRow
              label="鉴权方式"
              value={draft.auth}
              items={[
                ['x-api-key', 'x-api-key'],
                ['bearer', 'Bearer'],
              ]}
              onChange={auth => patch({ auth })}
            />
          ) : null}
          <SwitchRow
            label="缓存参数"
            sub="兼容中转：接口拒绝缓存参数时会提示并关闭。实际命中以服务用量为准。"
            value={draft.cache === 'auto'}
            onChange={on => patch({ cache: on ? 'auto' : 'off' })}
          />
        </View>
        <SectionTitle
          title={'模型 · 已启用 ' + draft.models.filter(m => m.enabled).length}
        />
        <Button
          title="获取模型列表"
          tone="learn"
          disabled={!!busy}
          onPress={fetchModels}
        />
        {error ? (
          <Text style={s.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Text style={s.foot}>
          从接口读取真实模型列表。勾选后才能在聊天中使用；手动添加的模型会保留。
        </Text>
        {draft.models.length
          ? input('搜索模型', query, setQuery, '搜索模型 ID 或名称')
          : null}
        {matches.map(m => {
          const caps = capabilitiesOf(draft, m);
          return (
            <View key={m.id} style={s.model}>
              <Pressable
                style={s.modelMain}
                onPress={() => changeModel({ ...m, enabled: !m.enabled })}
                disabled={!!busy || !caps.chat}
                accessibilityRole="checkbox"
                accessibilityLabel={'启用模型 ' + m.id}
                accessibilityState={{
                  checked: m.enabled,
                  disabled: !caps.chat,
                }}
              >
                <View style={[s.checkbox, m.enabled && s.checked]}>
                  {m.enabled ? <Check size={15} color="#FFFFFF" /> : null}
                </View>
                <View style={s.grow}>
                  <Text style={s.title}>{prettyModel(m.id)}</Text>
                  <Text style={s.sub}>{m.id}</Text>
                  <CapabilityTags caps={caps} />
                  {!caps.chat ? (
                    <Text style={s.foot}>非对话模型，不能用于 AI 助手</Text>
                  ) : null}
                  {caps.tools === false ? (
                    <Text style={s.warning}>不能读取 App 的行情与持仓</Text>
                  ) : null}
                </View>
              </Pressable>
              <Pressable
                style={s.capBtn}
                onPress={() => setEditing(m)}
                disabled={!!busy}
                accessibilityRole="button"
                accessibilityLabel={'模型能力 ' + m.id}
              >
                <Text style={s.link}>能力与价格</Text>
              </Pressable>
            </View>
          );
        })}
        {input(
          '手动添加模型',
          manual,
          setManual,
          '模型 ID，例如 relay-mix-pro',
        )}
        <Button
          title="添加模型"
          disabled={!!busy || !manual.trim()}
          onPress={() => {
            const mid = manual.trim();
            if (/\s/.test(mid)) {
              setError('模型 ID 不能包含空格');
              return;
            }
            if (draft.models.some(m => m.id === mid)) {
              setError('模型已经在列表中');
              return;
            }
            patch({
              models: [
                ...draft.models,
                { id: mid, enabled: true, price: null },
              ],
            });
            setManual('');
          }}
        />
        {draft.models.filter(m => m.enabled && capabilitiesOf(draft, m).chat)
          .length ? (
          <ChoiceRow
            label="测试使用的模型"
            value={
              testModel ||
              draft.models.find(
                m => m.enabled && capabilitiesOf(draft, m).chat,
              )!.id
            }
            items={draft.models
              .filter(m => m.enabled && capabilitiesOf(draft, m).chat)
              .map(m => [m.id, prettyModel(m.id)])}
            onChange={setTestModel}
          />
        ) : null}
        <Button title="测试连接" onPress={test} disabled={!!busy} />
        {busy ? (
          <View style={s.loading}>
            <ActivityIndicator color={color.learn} />
            <Text style={s.sub}>{busy}</Text>
          </View>
        ) : null}
        {result ? (
          <View style={[s.result, !result.ok && s.resultBad]}>
            <Text style={result.ok ? s.link : s.error}>{result.text}</Text>
            {result.lines.map((line, i) => (
              <Text key={i} style={s.sub}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}

        <Text style={s.foot}>
          Key 仅保存在本机。测试连接会发送少量
          token，联网搜索可能另收费。标注的能力必须与接口一致。
        </Text>
        {original ? (
          <Pressable
            style={s.delete}
            onPress={() => setDeleting(true)}
            disabled={!!busy}
            accessibilityRole="button"
          >
            <Trash2 size={16} color={color.up} />
            <Text style={s.error}>删除供应商</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <View style={[s.save, { paddingBottom: Math.max(10, safe.bottom) }]}>
        <Button
          title="保存供应商"
          tone="learn"
          disabled={!!busy}
          onPress={save}
        />
      </View>
      {editing ? (
        <ModelEditor
          provider={draft}
          model={editing}
          onClose={() => setEditing(null)}
          onSave={m => {
            changeModel(m);
            setEditing(null);
          }}
        />
      ) : null}
      <ConfirmDialog
        visible={deleting}
        title="删除供应商？"
        rows={[]}
        okTitle="删除"
        okTone="buy"
        onCancel={() => setDeleting(false)}
        onOk={() => {
          setDeleting(false);
          remove().catch(e => setError(String(e)));
        }}
      >
        <Text style={s.sub}>删除连接与 Key，已有消息保留。</Text>
      </ConfirmDialog>
    </KeyboardAvoidingView>
  );
}
function ModelEditor({
  provider,
  model,
  onClose,
  onSave,
}: {
  provider: AiProvider;
  model: ModelEntry;
  onClose: () => void;
  onSave: (m: ModelEntry) => void;
}) {
  const [caps, setCaps] = useState<ModelCapabilities>(() =>
      capabilitiesOf(provider, model),
    ),
    [price, setPrice] = useState(() => ({
      input: model.price ? String(model.price.input / 1000) : '',
      cacheRead: model.price ? String(model.price.cacheRead / 1000) : '',
      cacheWrite: model.price ? String(model.price.cacheWrite / 1000) : '',
      output: model.price ? String(model.price.output / 1000) : '',
    })),
    [error, setError] = useState('');
  const [context, setContext] = useState(
    caps.context ? String(caps.context) : '',
  );
  const set = (p: Partial<ModelCapabilities>) => setCaps(x => ({ ...x, ...p }));
  const save = () => {
    const prices = Object.values(price);
    if (
      prices.some(x => x.trim()) &&
      prices.some(
        x =>
          !/^\d+(?:\.\d{1,3})?$/.test(x) ||
          !Number.isSafeInteger(Math.round(Number(x) * 1000)),
      )
    ) {
      setError('价格请全部填写非负数，最多 3 位小数；不估算费用可全部留空');
      return;
    }
    if (
      context &&
      (!/^\d+$/.test(context) ||
        !Number.isSafeInteger(Number(context)) ||
        Number(context) <= 0)
    ) {
      setError('上下文长度请填正整数');
      return;
    }
    onSave({
      ...model,
      overrides: { ...caps, context: context ? Number(context) : null },
      price: prices.every(x => !x)
        ? null
        : {
            input: Math.round(Number(price.input) * 1000),
            cacheRead: Math.round(Number(price.cacheRead) * 1000),
            cacheWrite: Math.round(Number(price.cacheWrite) * 1000),
            output: Math.round(Number(price.output) * 1000),
          },
    });
  };
  return (
    <AiSheet title="模型能力与价格" visible onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={[s.title, s.pad]}>{model.id}</Text>
        <Note>
          按模型文档或中转接口的真实能力标注。未知能力保持未知；只有明确支持时才启用。
        </Note>
        {(['chat', 'tools', 'search'] as const).map((k, i) => (
          <ChoiceRow
            key={k}
            label={['对话模型', 'App 工具调用', '联网搜索'][i]}
            value={caps[k] === null ? 'unknown' : caps[k] ? 'yes' : 'no'}
            items={
              k === 'chat'
                ? [
                    ['yes', '支持'],
                    ['no', '不支持'],
                  ]
                : [
                    ['unknown', '未知'],
                    ['yes', '支持'],
                    ['no', '不支持'],
                  ]
            }
            onChange={v => set({ [k]: v === 'unknown' ? null : v === 'yes' })}
          />
        ))}
        <ChoiceRow
          label="思考参数格式"
          value={caps.thinkingStyle}
          items={[
            ['none', '不发送'],
            ['adaptive', 'Claude 自适应'],
            ['budget', 'Claude 预算'],
            ['reasoning', '推理强度'],
            ['toggle', '开关 / 供应商参数'],
            ['fixed', '始终思考'],
          ]}
          onChange={thinkingStyle =>
            set({
              thinkingStyle,
              ...(thinkingStyle === 'none'
                ? { thinking: [] }
                : thinkingStyle === 'fixed'
                ? { thinking: ['on'] }
                : {}),
            })
          }
        />
        <Text style={[s.label, s.pad]}>可用的思考档位（多选）</Text>
        <View style={s.levels}>
          {EFFORT_ORDER.map(e => (
            <Pressable
              key={e}
              style={[s.level, caps.thinking?.includes(e) && s.checked]}
              onPress={() =>
                set({
                  thinking: caps.thinking?.includes(e)
                    ? caps.thinking.filter(x => x !== e)
                    : EFFORT_ORDER.filter(
                        x => x === e || caps.thinking?.includes(x),
                      ),
                })
              }
              accessibilityRole="checkbox"
              accessibilityLabel={'可用档位 ' + EFFORT_NAME[e]}
              accessibilityState={{
                checked: caps.thinking?.includes(e) ?? false,
              }}
            >
              <Text style={caps.thinking?.includes(e) ? s.white : s.sub}>
                {EFFORT_NAME[e]}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={s.field}>
          <Text style={s.label}>上下文长度（tokens，未知留空）</Text>
          <TextInput
            accessibilityLabel="上下文长度"
            style={s.input}
            value={context}
            onChangeText={setContext}
            keyboardType="number-pad"
          />
        </View>
        <SectionTitle title="价格 · 美元 / 百万 tokens" />
        {(['input', 'cacheRead', 'cacheWrite', 'output'] as const).map(
          (k, i) => (
            <View style={s.field} key={k}>
              <Text style={s.label}>
                {['普通输入', '缓存读取', '缓存写入', '输出'][i]}
              </Text>
              <TextInput
                accessibilityLabel={
                  ['普通输入价格', '缓存读取价格', '缓存写入价格', '输出价格'][
                    i
                  ]
                }
                style={s.input}
                value={price[k]}
                onChangeText={v => setPrice(x => ({ ...x, [k]: v }))}
                placeholder="留空不估算费用"
                placeholderTextColor={color.ink3}
                keyboardType="decimal-pad"
              />
            </View>
          ),
        )}
        {error ? <Text style={s.error}>{error}</Text> : null}
        <View style={s.pad}>
          <Button title="应用模型设置" tone="learn" onPress={save} />
          <Button
            title="恢复自动识别"
            onPress={() => {
              onSave({ ...model, overrides: undefined });
            }}
          />
        </View>
      </ScrollView>
    </AiSheet>
  );
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { padding: PAD, gap: 10 },
  grow: { flex: 1 },
  intro: { fontSize: 20, fontWeight: '600', color: color.ink, marginTop: 8 },
  provider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: color.card,
    padding: 16,
    borderRadius: 12,
    marginVertical: 4,
    minHeight: 80,
  },
  title: { fontSize: 15, color: color.ink, fontWeight: '500' },
  sub: { fontSize: 12, color: color.ink2, lineHeight: 18, marginTop: 3 },
  foot: { fontSize: 12, lineHeight: 18, color: color.ink2, marginVertical: 8 },
  card: { backgroundColor: color.card, borderRadius: 12, overflow: 'hidden' },
  field: { paddingHorizontal: 14, paddingVertical: 10 },
  label: { fontSize: 13, color: color.ink, fontWeight: '500', marginBottom: 8 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#D9DDE2',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: color.ink,
    backgroundColor: color.card,
  },
  model: {
    backgroundColor: color.card,
    borderRadius: 10,
    padding: 12,
    marginVertical: 3,
  },
  modelMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    minHeight: 48,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#C2C9CE',
    marginTop: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checked: { backgroundColor: color.learn, borderColor: color.learn },
  capBtn: {
    minHeight: 48,
    alignSelf: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  link: { color: color.learn, fontSize: 13, fontWeight: '500' },
  error: { color: color.up, fontSize: 13, lineHeight: 20, marginVertical: 6 },
  warning: { color: color.warnInk, fontSize: 12, lineHeight: 18, marginTop: 8 },
  loading: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12 },
  result: { padding: 14, borderRadius: 10, backgroundColor: color.learnBg },
  resultBad: { backgroundColor: color.upBg },
  delete: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  save: {
    padding: 12,
    backgroundColor: color.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  levels: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 14,
  },
  level: {
    borderWidth: 1,
    borderColor: '#CCD3D8',
    minWidth: 52,
    minHeight: 48,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  white: { color: '#FFFFFF', fontSize: 13 },
});
