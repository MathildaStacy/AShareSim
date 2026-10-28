/**
 * 外部工具（MCP，AI_ASSISTANT §13.4）：列表页和编辑页。token 存 Keystore，只显示末 4 位；
 * 「连接并获取工具」后按只读 / 会改东西分开，只读的可以逐个开关，会改东西的不能启用。
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Check, ChevronRight, Plus, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  displayUrl,
  fetchMcpTools,
  loadMcpServers,
  isTushareUrl,
  MCP_PRESETS,
  mcpTokens,
  newMcpId,
  probeMcp,
  saveMcpServers,
  slugOf,
  validateMcpUrl,
  type McpServer,
} from '../../ai/mcp';
import { keyTailOf } from '../../ai/services';
import { ConfirmDialog } from '../components/Dialog';
import { SwitchRow } from '../components/form';
import {
  Button,
  Empty,
  IconButton,
  NavBar,
  SectionTitle,
} from '../components/ui';
import { useAiContext, useCore, useViewLog } from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { color, PAD } from '../theme';
import { toast } from '../toast';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const enabledCount = (x: McpServer) => x.tools.filter(t => t.enabled).length;

export function AiMcpScreen() {
  const core = useCore(),
    nav = useNavigation<Nav>(),
    [servers, setServers] = useState<McpServer[]>([]);
  useViewLog('ai:mcp', '查看外部工具');
  useFocusEffect(
    useCallback(() => {
      loadMcpServers(core.db)
        .then(setServers)
        .catch(e => toast.show(String(e)));
    }, [core]),
  );
  useAiContext('AiMcp', () => ({
    name: '外部工具（MCP）',
    lines: servers.length
      ? servers.map(
          x =>
            x.name +
            '：' +
            (x.enabled ? '启用' : '停用') +
            '，' +
            enabledCount(x) +
            '/' +
            x.tools.length +
            ' 个工具启用',
        )
      : ['还没有接入外部工具'],
  }));
  return (
    <View style={s.page}>
      <NavBar
        title="外部工具（MCP）"
        back
        right={
          <IconButton
            label="添加外部工具"
            onPress={() => nav.navigate('AiMcpServer', {})}
          >
            <Plus size={22} color={color.learn} />
          </IconButton>
        }
      />
      <ScrollView contentContainerStyle={s.pad}>
        <Text style={s.intro}>
          接入后，在对话输入框下打开「外部工具」，AI 可以查 App
          自带工具没有的数据（例如指数成分、三大报表明细）。只能读，不能改外部数据。
        </Text>
        {servers.map(x => (
          <Pressable
            key={x.id}
            style={s.row}
            onPress={() => nav.navigate('AiMcpServer', { id: x.id })}
            accessibilityRole="button"
            accessibilityLabel={'编辑外部工具 ' + x.name}
          >
            <View style={s.grow}>
              <Text style={s.title}>{x.name}</Text>
              <Text style={s.sub}>{displayUrl(x.url)}</Text>
              <Text style={s.sub}>
                {(x.enabled ? '' : '已停用 · ') +
                  enabledCount(x) +
                  ' / ' +
                  x.tools.length +
                  ' 个工具启用 · ' +
                  (x.tokenTail ? 'token 已保存' : '没有 token')}
              </Text>
            </View>
            <ChevronRight size={20} color={color.ink3} />
          </Pressable>
        ))}
        {!servers.length ? <Empty text="还没有接入外部工具" /> : null}
        <Button
          title="添加外部工具"
          tone="learn"
          style={s.action}
          onPress={() => nav.navigate('AiMcpServer', {})}
        />
      </ScrollView>
    </View>
  );
}

export function AiMcpServerScreen({ route }: RootScreenProps<'AiMcpServer'>) {
  const core = useCore(),
    nav = useNavigation<Nav>(),
    safe = useSafeAreaInsets();
  const id = route.params?.id;
  const [draft, setDraft] = useState<McpServer | null>(null),
    [original, setOriginal] = useState<McpServer | null>(null),
    [token, setToken] = useState(''),
    [query, setQuery] = useState(''),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState(''),
    [result, setResult] = useState<string | null>(null),
    [deleting, setDeleting] = useState(false);
  const request = useRef<AbortController | null>(null),
    mounted = useRef(true);
  const preset =
    draft && isTushareUrl(draft.url) ? MCP_PRESETS.tushare : undefined;
  const storedTokenTail =
    original?.url === draft?.url.trim() ? original?.tokenTail : '';
  useEffect(() => {
    mounted.current = true;
    if (id) {
      loadMcpServers(core.db)
        .then(ss => {
          const x = ss.find(y => y.id === id);
          if (x) {
            setDraft(x);
            setOriginal(x);
          } else {
            setError('外部工具已被删除');
          }
        })
        .catch(e => setError(String(e)));
    }
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, [core, id]);
  const patch = (p: Partial<McpServer>) => {
    setDraft(x =>
      x
        ? {
            ...x,
            ...p,
            ...(p.url != null && p.url !== x.url
              ? { tools: [], fetchedAt: undefined, instructions: undefined }
              : {}),
          }
        : x,
    );
    if (p.url != null) {
      setResult(null);
    }
    setError('');
  };
  const create = async (presetKey: string | null) => {
    const taken = (await loadMcpServers(core.db)).map(x => x.slug);
    const p = presetKey ? MCP_PRESETS[presetKey] : null;
    setDraft({
      id: newMcpId(),
      name: p?.name ?? '',
      slug: p && !taken.includes(p.slug) ? p.slug : '',
      url: p?.url ?? '',
      tokenTail: '',
      enabled: true,
      tools: [],
    });
  };
  const getToken = async () =>
    token.trim() ||
    (original && original.url === draft?.url.trim()
      ? await mcpTokens().get(original.id)
      : '') ||
    '';
  const validate = () => {
    if (!draft?.name.trim()) {
      throw new Error('请填写名称');
    }
    validateMcpUrl(draft.url.trim());
  };
  const connect = async () => {
    if (busy) {
      return;
    }
    try {
      validate();
      setBusy('正在连接并获取工具…');
      const t = await getToken();
      setError('');
      setResult(null);
      request.current = new AbortController();
      const signal = request.current.signal;
      const r = await fetchMcpTools(
        { ...draft!, url: draft!.url.trim() },
        t,
        signal,
      );
      const probe = await probeMcp(draft!, t, signal);
      if (!mounted.current) {
        return;
      }
      patch({
        tools: r.tools,
        instructions: r.instructions,
        fetchedAt: new Date().toISOString(),
      });
      const writes = r.tools.filter(x => !x.readOnly).length;
      setResult(
        '已获取目录：' +
          r.tools.length +
          ' 个工具' +
          (writes ? '，其中 ' + writes + ' 个未确认只读，不能启用' : '') +
          (probe
            ? '。试调用未通过。'
            : preset
            ? '。试调用通过。'
            : '。尚未试调用数据接口。'),
      );
      if (probe) {
        setError('试调用失败，请检查 token 和接口权限：' + probe);
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
    if (busy) {
      return;
    }
    try {
      validate();
      if (!draft!.tools.length) {
        throw new Error('先点「连接并获取工具」');
      }
      setBusy('保存中…');
      const all = await loadMcpServers(core.db);
      const others = all.filter(x => x.id !== draft!.id);
      const t = await getToken();
      const x: McpServer = {
        ...draft!,
        name: draft!.name.trim(),
        url: draft!.url.trim(),
        slug:
          draft!.slug ||
          slugOf(
            draft!.name,
            others.map(o => o.slug),
          ),
        tokenTail: t ? keyTailOf(t) : '',
      };
      if (t) {
        await mcpTokens().set(x.id, t);
      } else if (original) {
        await mcpTokens().remove(x.id);
      }
      await saveMcpServers(
        core.db,
        all.some(o => o.id === x.id)
          ? all.map(o => (o.id === x.id ? x : o))
          : [...all, x],
      );
      await core.sim.logSetting(
        (original ? '修改' : '添加') + '外部工具 ' + x.name,
        {
          name: x.name,
          url: displayUrl(x.url),
          tools: enabledCount(x) + '/' + x.tools.length,
          token: t ? '已保存' : '无',
        },
      );
      nav.goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
    await saveMcpServers(
      core.db,
      (await loadMcpServers(core.db)).filter(x => x.id !== original.id),
    );
    await mcpTokens().remove(original.id);
    await core.sim.logSetting('删除外部工具 ' + original.name, {
      name: original.name,
    });
    nav.goBack();
  };
  useAiContext('AiMcpServer', () => ({
    name: original ? '外部工具 · 编辑' : '外部工具 · 添加',
    lines: draft
      ? [
          '名称：' + draft.name,
          '地址：' + displayUrl(draft.url),
          'token：' +
            (token.trim()
              ? '已填（未保存）'
              : storedTokenTail
              ? '已保存'
              : '未填'),
          '工具：' +
            draft.tools.length +
            ' 个，启用 ' +
            enabledCount(draft) +
            ' 个，未确认只读的 ' +
            draft.tools.filter(t => !t.readOnly).length +
            ' 个（不能启用）',
          ...(error ? ['错误：' + error] : []),
        ]
      : ['选择要接入的外部工具'],
  }));

  if (!draft) {
    return (
      <View style={s.page}>
        <NavBar title={id ? '编辑外部工具' : '添加外部工具'} back />
        <ScrollView contentContainerStyle={s.pad}>
          {id ? (
            <Text style={s.error}>{error || '正在读取配置…'}</Text>
          ) : (
            <>
              {Object.entries(MCP_PRESETS).map(([k, p]) => (
                <Pressable
                  key={k}
                  style={s.row}
                  onPress={() => create(k)}
                  accessibilityRole="button"
                  accessibilityLabel={'添加 ' + p.name}
                >
                  <View style={s.grow}>
                    <Text style={s.title}>{p.name}</Text>
                    <Text style={s.sub}>{p.url}</Text>
                  </View>
                  <ChevronRight size={20} color={color.ink3} />
                </Pressable>
              ))}
              <Pressable
                style={s.row}
                onPress={() => create(null)}
                accessibilityRole="button"
                accessibilityLabel="添加 自定义 MCP 服务"
              >
                <View style={s.grow}>
                  <Text style={s.title}>自定义</Text>
                  <Text style={s.sub}>
                    任何支持 Streamable HTTP 的远程 MCP 服务
                  </Text>
                </View>
                <ChevronRight size={20} color={color.ink3} />
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  const q = query.trim().toLowerCase();
  const shown = draft.tools.filter(
    t =>
      !q ||
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q),
  );
  const readable = draft.tools.filter(t => t.readOnly);
  const setAll = (on: boolean) =>
    patch({
      tools: draft.tools.map(t =>
        t.readOnly && shown.includes(t) ? { ...t, enabled: on } : t,
      ),
    });
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
        placeholderTextColor={color.ink2}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure}
        editable={!busy}
      />
    </View>
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
            : '添加 ' + (draft.name || '外部工具')
        }
        back
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.pad}
      >
        <View style={s.card}>
          {input('名称', draft.name, v => patch({ name: v }), '例如：Tushare')}
          {input(
            '地址',
            draft.url,
            v => patch({ url: v }),
            'https://example.com/mcp',
          )}
          {input(
            'token',
            token,
            v => {
              setToken(v);
              setError('');
              setResult(null);
            },
            storedTokenTail ? '留空沿用已保存的 token' : '填写 token',
            true,
          )}
          <Text style={s.tokenHint}>
            {storedTokenTail
              ? '已保存，末 4 位 ' + storedTokenTail + '；留空沿用'
              : preset?.tokenHint ?? '服务无需认证时可以留空'}
          </Text>
          {preset ? (
            <Pressable
              style={s.linkPad}
              onPress={() =>
                Linking.openURL(preset.site).catch(() =>
                  setError('无法打开网站，请检查浏览器'),
                )
              }
              accessibilityRole="link"
            >
              <Text style={s.link}>
                {'打开 ' + preset.site + '（接口权限取决于你的积分）'}
              </Text>
            </Pressable>
          ) : null}
          <SwitchRow
            label="启用"
            sub="停用后对话里调不到这个服务的工具"
            value={draft.enabled}
            disabled={!!busy}
            onChange={on => patch({ enabled: on })}
          />
        </View>
        <Button
          title="连接并获取工具"
          tone="learn"
          style={s.action}
          disabled={!!busy}
          onPress={connect}
        />
        {busy ? (
          <View style={s.loading}>
            <ActivityIndicator color={color.learn} />
            <Text style={s.sub}>{busy}</Text>
          </View>
        ) : null}
        {error ? (
          <Text style={s.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        {result ? (
          <View style={s.result}>
            <Text style={s.resultText}>{result}</Text>
          </View>
        ) : null}

        {draft.tools.length ? (
          <>
            <SectionTitle
              title={
                '工具 · 启用 ' + enabledCount(draft) + ' / ' + readable.length
              }
            />
            {input('搜索工具', query, setQuery, '名字或说明，例如 指数')}
            <View style={s.bulk}>
              <Pressable
                style={s.bulkBtn}
                disabled={!!busy}
                accessibilityState={{ disabled: !!busy }}
                onPress={() => setAll(true)}
                accessibilityRole="button"
              >
                <Text style={s.link}>{q ? '启用搜到的' : '全部启用'}</Text>
              </Pressable>
              <Pressable
                style={s.bulkBtn}
                disabled={!!busy}
                accessibilityState={{ disabled: !!busy }}
                onPress={() => setAll(false)}
                accessibilityRole="button"
              >
                <Text style={s.link}>{q ? '停用搜到的' : '全部停用'}</Text>
              </Pressable>
            </View>
            {shown.slice(0, 80).map(t => (
              <Pressable
                key={t.name}
                style={s.tool}
                onPress={() =>
                  patch({
                    tools: draft.tools.map(x =>
                      x.name === t.name && x.readOnly
                        ? { ...x, enabled: !x.enabled }
                        : x,
                    ),
                  })
                }
                disabled={!!busy || !t.readOnly}
                accessibilityRole="checkbox"
                accessibilityLabel={'启用工具 ' + t.name}
                accessibilityState={{
                  checked: t.enabled,
                  disabled: !!busy || !t.readOnly,
                }}
              >
                <View style={[s.checkbox, t.enabled && s.checked]}>
                  {t.enabled ? <Check size={15} color="#FFFFFF" /> : null}
                </View>
                <View style={s.grow}>
                  <Text style={s.title}>{t.name}</Text>
                  <Text style={s.sub} numberOfLines={2}>
                    {t.description.replace(/^\/?数据接口\//, '')}
                  </Text>
                  {!t.readOnly ? (
                    <Text style={s.warning}>未确认只读，不能启用</Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
            {shown.length > 80 ? (
              <Text style={s.sub}>
                {'还有 ' + (shown.length - 80) + ' 个，搜索缩小范围'}
              </Text>
            ) : null}
          </>
        ) : null}

        {original ? (
          <Pressable
            style={s.delete}
            onPress={() => setDeleting(true)}
            disabled={!!busy}
            accessibilityRole="button"
          >
            <Trash2 size={16} color={color.up} />
            <Text style={s.error}>删除外部工具</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <View style={[s.save, { paddingBottom: Math.max(10, safe.bottom) }]}>
        <Button
          title="保存"
          tone="learn"
          style={s.action}
          disabled={!!busy}
          onPress={save}
        />
      </View>
      <ConfirmDialog
        visible={deleting}
        title="删除外部工具？"
        rows={[]}
        okTitle="删除"
        okTone="buy"
        onCancel={() => setDeleting(false)}
        onOk={() => {
          setDeleting(false);
          remove().catch(e => setError(String(e)));
        }}
      >
        <Text style={s.sub}>删除地址和 token，已有对话保留。</Text>
      </ConfirmDialog>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  action: { minHeight: 48 },
  page: { flex: 1, backgroundColor: color.bg },
  pad: { padding: PAD, gap: 10, paddingBottom: 40 },
  intro: { fontSize: 13, lineHeight: 21, color: color.ink2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: color.card,
    padding: 16,
    borderRadius: 12,
    marginVertical: 4,
    minHeight: 80,
  },
  grow: { flex: 1 },
  title: { fontSize: 15, color: color.ink, fontWeight: '500' },
  sub: { fontSize: 12, color: color.ink2, lineHeight: 18, marginTop: 3 },
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
  tokenHint: {
    color: color.ink2,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  linkPad: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  link: { color: color.learn, fontSize: 13, fontWeight: '500' },
  bulk: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bulkBtn: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 },
  tool: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: color.card,
    borderRadius: 10,
    padding: 12,
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
  warning: { color: color.warnInk, fontSize: 12, lineHeight: 18, marginTop: 4 },
  error: { color: color.up, fontSize: 13, lineHeight: 20, marginVertical: 6 },
  loading: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12 },
  result: { padding: 14, borderRadius: 10, backgroundColor: color.learnBg },
  resultText: { color: color.ink, fontSize: 13, lineHeight: 20 },
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
});
