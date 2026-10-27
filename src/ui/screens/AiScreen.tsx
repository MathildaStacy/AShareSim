/**
 * AI 对话（PRODUCT_DESIGN §6.5、M4 界面清单）：上下文条、消息（你的问题、分隔线、回答、用到的工具、操作卡、
 * 记忆变更、用量和费用）、快捷问题、输入框（预计 token 和走缓存的部分）。
 * AI 页自己不登记页面上下文：打开时记下来源页面，每次提问重新计算它的上下文。
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  Globe,
  Menu,
  Square,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  activeService,
  answerUsage,
  ask,
  cancelCard,
  memoryAction,
  newThread,
  openLatest,
  preview,
  runCard,
  stop,
  useChat,
  currentConfig,
  selectConfig,
  type Preview,
} from '../../ai/chat';
import { capturePage } from '../../ai/context';
import { costOf, estimateTokens, fmtUsd } from '../../ai/prompt';
import { quickQuestions } from '../../ai/quick';
import { loadPrefs, loadProviders } from '../../ai/services';
import {
  EFFORT_NAME,
  normaliseConfig,
  prettyModel,
  resolvedService,
  searchAvailability,
} from '../../ai/models';
import { citedText } from '../../ai/evidence';
import {
  MEMORY_KIND_NAME,
  type ActionCard,
  type AiService,
  type MemoryChange,
  type StoredMessage,
  type ToolUi,
  type Usage,
  type AiProvider,
  type ModelEntry,
} from '../../ai/types';
import * as aiRepo from '../../data/aiRepo';
import * as repo from '../../data/repos';
import { CheckBar } from '../components/form';
import {
  EffortPicker,
  ModelPicker,
  SearchUnavailable,
} from '../components/AiOptions';
import { Markdown } from '../components/Markdown';
import { Button, IconButton, NavBar } from '../components/ui';
import { useCore } from '../hooks';
import type { RootStackParamList } from '../navigation/types';
import { color, num, PAD } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const TAB_ROUTES = new Set(['Watch', 'Market', 'Trade', 'Learn', 'Me']);

const fmtInt = (n: number) => n.toLocaleString('zh-CN');

/** 一次回答的用量：「输入 1,200 · 缓存读 8,300 · 写 400 · 输出 350 tokens · 约 $0.004（不用缓存 $0.012）」。 */
export function usageText(
  u: Usage,
  svc: Pick<AiService, 'price'> | null,
): string {
  const parts = [
    '输入 ' + fmtInt(u.input),
    u.cacheReported
      ? '缓存读 ' + fmtInt(u.cacheRead) + ' · 写 ' + fmtInt(u.cacheWrite)
      : '该服务没有报告缓存数据',
    '输出 ' + fmtInt(u.output) + ' tokens',
  ];
  if (svc?.price) {
    parts.push(
      '约 ' +
        fmtUsd(costOf(u, svc.price)) +
        (u.cacheReported
          ? '（不用缓存 ' + fmtUsd(costOf(u, svc.price, false)) + '）'
          : ''),
    );
  }
  if (u.searchRequests != null) {
    parts.push('搜索 ' + u.searchRequests + ' 次（另计费）');
  }
  return parts.join(' · ');
}

export function AiScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [source] = useState(() => capturePage());
  const { messages, thread, busy, pendingNav, config } = useChat();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [svc, setSvc] = useState<AiService | null | undefined>(undefined);
  const [memCount, setMemCount] = useState(0);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [sheet, setSheet] = useState<
    'model' | 'effort' | 'search' | 'searchModels' | null
  >(null);
  const [searchQuestion, setSearchQuestion] = useState<string | null>(null);
  const [rebuild, setRebuild] = useState<Preview['rebuild']>(null);
  const [focusVersion, setFocusVersion] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setFocusVersion(v => v + 1);
    }, []),
  );
  const [actCount, setActCount] = useState(0);
  const [quick, setQuick] = useState<string[]>([]);
  const [est, setEst] = useState<{
    total: number;
    cached: number;
    note: string;
  } | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const scrollKey = useRef('');
  const followEnd = useRef(true);
  const userScrolling = useRef(false);
  const [atEnd, setAtEnd] = useState(true);
  const page = source ? source.get() : null;
  const pageName = page?.name ?? null;

  useEffect(() => {
    useChat.setState({ source });
    openLatest(core).catch(() => undefined);
  }, [core, source]);

  // 服务、记忆条数、最近操作、快捷问题、预估：打开时和每次回答后刷新
  const answerKey = messages.length + ':' + (busy ? 1 : 0);
  useEffect(() => {
    if (busy) {
      return;
    }
    let alive = true;
    (async () => {
      const prefs = await loadPrefs(core.db);
      const s = await activeService(core, prefs);
      const ps = await loadProviders(core.db);
      const cfg = await currentConfig(core);
      const mems = await aiRepo.memories(core.db);
      const acts = await repo.recentActivity(core.db, 20, core.sim.accountId);
      const p = await preview(
        core,
        source ? { route: source.route, ctx: source.get() } : null,
        '',
      );
      if (!alive) {
        return;
      }
      setSvc(s);
      setProviders(ps);
      setRebuild(p.rebuild);
      if (!config && cfg) {
        useChat.setState({ config: cfg });
      }
      setMemCount(mems.length);
      setActCount(Math.min(prefs.recentN, acts.length));
      setQuick(quickQuestions(acts, prefs.includePage ? page : null));
      setEst({ total: p.total, cached: p.cached, note: p.cacheNote });
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
    // page 每次渲染都重新算，只在回答前后刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, answerKey, source, config, thread?.id, focusVersion]);

  // navigate 工具：回答结束后关掉 AI 页，打开目标页面
  useEffect(() => {
    if (!pendingNav) {
      return;
    }
    useChat.setState({ pendingNav: null });
    nav.goBack();
    const { route, params } = pendingNav;
    if (TAB_ROUTES.has(route)) {
      nav.navigate('Tabs', { screen: route as 'Watch' });
    } else {
      (nav.navigate as (r: string, p?: object) => void)(route, params);
    }
  }, [pendingNav, nav]);

  const send = (q: string) => {
    const question = q.trim();
    if (!question || busy) {
      return;
    }
    setError(null);
    setText('');
    followEnd.current = true;
    userScrolling.current = false;
    setAtEnd(true);
    ask(core, {
      question,
      page: source ? { route: source.route, ctx: source.get() } : null,
    }).catch(e => setError(e instanceof Error ? e.message : String(e)));
  };

  const onLink = (href: string) => {
    const m = /^(lesson|stock):(.+)$/.exec(href);
    if (m?.[1] === 'lesson') {
      nav.navigate('Lesson', { id: m[2] });
    } else if (m?.[1] === 'stock') {
      nav.navigate('Stock', { code: m[2] });
    } else if (/^https?:\/\//i.test(href)) {
      Linking.openURL(href).catch(() => setError('无法打开这个来源链接'));
    }
  };

  const provider = providers.find(p => p.id === config?.providerId);
  const model = provider?.models.find(m => m.id === config?.model);
  const availability =
    provider && model
      ? searchAvailability(provider, model)
      : { ok: false, reason: '请先选择并配置模型' };
  const choose = async (p: AiProvider, m: ModelEntry) => {
    const forSearch = sheet === 'searchModels';
    const next = normaliseConfig(
      {
        providerId: p.id,
        model: m.id,
        effort: config?.effort ?? 'low',
        search: forSearch ? true : config?.search ?? false,
      },
      providers,
    );
    await selectConfig(core, next);
    setSheet(null);
    if (searchQuestion && forSearch) {
      const q = searchQuestion;
      setSearchQuestion(null);
      send(q);
    }
  };
  const toggleSearch = () => {
    if (!config || busy) {
      return;
    }
    if (!availability.ok) {
      setSheet('search');
      return;
    }
    selectConfig(core, { ...config, search: !config.search }).catch(e =>
      setError(String(e)),
    );
  };
  const retrySearch = async (q: string) => {
    if (busy || !config) {
      return;
    }
    if (!availability.ok) {
      setSearchQuestion(q);
      setSheet('search');
      return;
    }
    await selectConfig(core, { ...config, search: true });
    send(q);
  };

  const messageService = (m: StoredMessage) => {
    if (m.ui?.config) {
      return resolvedService(providers, m.ui.config);
    }
    const historicalProvider = providers.find(
      candidate =>
        m.ui?.service?.startsWith(candidate.name + ' · ') &&
        candidate.models.some(entry => entry.id === m.raw?.model),
    );
    const historicalModel = historicalProvider?.models.find(
      x => x.id === m.raw?.model,
    );
    return historicalProvider && historicalModel
      ? resolvedService(
          [
            {
              ...historicalProvider,
              models: [{ ...historicalModel, enabled: true }],
            },
          ],
          {
            providerId: historicalProvider.id,
            model: historicalModel.id,
            effort: 'low',
            search: false,
          },
        )
      : m.id === -1
      ? svc ?? null
      : null;
  };
  const live = useMemo(() => messages.filter(m => !m.compacted), [messages]);
  const tail = live[live.length - 1];
  const scrollVersion = [
    thread?.id,
    live.length,
    tail?.id,
    tail?.parts.reduce((n, p) => n + (p.t === 'text' ? p.text.length : 0), 0),
    !!busy,
  ].join(':');
  const qTokens = estimateTokens(text);

  return (
    <KeyboardAvoidingView
      style={s.page}
      // Android 全面屏模式下 adjustResize 不会缩小页面，需按键盘遮挡高度主动避让。
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <NavBar
        title={thread?.title ?? 'AI 助手'}
        sub={
          svc
            ? '投资分析 · 当前页面随问随查'
            : svc === null
            ? '还没有配置服务'
            : ''
        }
        back
        right={
          <IconButton label="AI 菜单" onPress={() => setMenu(true)}>
            <Menu color={color.ink} size={22} />
          </IconButton>
        }
      />
      <Pressable
        style={s.ctxBar}
        onPress={() => nav.navigate('AiContext')}
        accessibilityRole="button"
      >
        <Text style={s.ctxText} numberOfLines={1}>
          {(pageName ? '页面：' + pageName : '没有页面上下文') +
            ' · 操作 ' +
            actCount +
            ' 条 · 记忆 ' +
            memCount +
            ' 条'}
        </Text>
        <Text style={s.ctxMore}>上下文 ›</Text>
      </Pressable>
      <ScrollView
        ref={scroll}
        style={s.list}
        contentContainerStyle={s.listPad}
        onContentSizeChange={() => {
          // 只跟随新消息和新增正文；展开查询、操作卡重排时保留阅读位置。
          if (scrollKey.current === scrollVersion) {
            return;
          }
          scrollKey.current = scrollVersion;
          if (followEnd.current) {
            userScrolling.current = false;
            scroll.current?.scrollToEnd({ animated: false });
          }
        }}
        onScroll={({ nativeEvent: e }) => {
          if (!userScrolling.current) {
            return;
          }
          const nearEnd =
            e.contentSize.height -
              e.contentOffset.y -
              e.layoutMeasurement.height <
            60;
          followEnd.current = nearEnd;
          setAtEnd(nearEnd);
        }}
        onScrollBeginDrag={() => {
          userScrolling.current = true;
        }}
        scrollEventThrottle={32}
        keyboardShouldPersistTaps="handled"
      >
        {svc === null ? (
          <View style={s.setup}>
            <View style={s.setupBtn}>
              <Button
                title="配置供应商与模型"
                tone="learn"
                onPress={() => nav.navigate('AiServices')}
              />
            </View>
          </View>
        ) : null}
        {thread?.compactedCount ? (
          <Text style={s.compacted}>
            {'较早的 ' + thread.compactedCount + ' 条消息已压缩成摘要'}
          </Text>
        ) : null}
        {live.map((m, i) => (
          <MessageView
            key={m.id}
            m={m}
            last={i === live.length - 1 || live[i + 1].role === 'user'}
            usage={
              !(
                busy && !live.slice(i + 1).some(next => next.role === 'user')
              ) &&
              m.role !== 'user' &&
              (i === live.length - 1 || live[i + 1].role === 'user')
                ? answerUsage(live, firstOfAnswer(live, i))
                : null
            }
            svc={messageService(m)}
            accountId={core.sim.accountId}
            onLink={onLink}
            onSearch={q => retrySearch(q).catch(e => setError(String(e)))}
            searchBusy={!!busy}
            onCard={(toolId, act) =>
              act === 'run'
                ? runCard(core, m.id, toolId)
                : cancelCard(core, m.id, toolId)
            }
            onMemory={(toolId, act) => memoryAction(core, m.id, toolId, act)}
            onNav={n =>
              (nav.navigate as (r: string, p?: object) => void)(
                TAB_ROUTES.has(n.route) ? 'Tabs' : n.route,
                TAB_ROUTES.has(n.route) ? { screen: n.route } : n.params,
              )
            }
          />
        ))}
        {busy ? (
          <View style={s.busy}>
            <ActivityIndicator color={color.learn} />
            <Text style={s.busyText}>{busy}</Text>
          </View>
        ) : null}
        {error ? <Text style={s.error}>{error}</Text> : null}
      </ScrollView>
      {!atEnd && live.length ? (
        <Pressable
          style={s.latest}
          accessibilityRole="button"
          accessibilityLabel="回到最新回复"
          onPress={() => {
            followEnd.current = true;
            userScrolling.current = false;
            setAtEnd(true);
            scroll.current?.scrollToEnd({ animated: true });
          }}
        >
          <Text style={s.toolSummaryText}>回到最新回复</Text>
          <ChevronDown size={14} color={color.learn} />
        </Pressable>
      ) : null}
      <View style={[s.bottom, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {rebuild && !busy ? (
          <View style={s.cacheWarning}>
            <Text style={s.cacheText}>
              {rebuild.reason +
                '：下次预计重建约 ' +
                fmtInt(rebuild.tokens) +
                ' tokens 的缓存'}
            </Text>
            <Pressable
              style={s.revert}
              onPress={() =>
                selectConfig(core, rebuild.previous).catch(e =>
                  setError(String(e)),
                )
              }
              accessibilityRole="button"
            >
              <Text style={s.revertText}>改回</Text>
            </Pressable>
          </View>
        ) : null}
        {svc?.capabilities?.tools === false ? (
          <Text style={s.notice}>
            当前模型无法读取 App 行情与持仓，只能聊天
          </Text>
        ) : svc?.capabilities?.tools === null ? (
          <Text style={s.notice}>工具能力未知，可在供应商里标注</Text>
        ) : null}
        {quick.length && !busy ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.quick}
            keyboardShouldPersistTaps="handled"
          >
            {quick.map(q => (
              <Pressable
                key={q}
                style={s.chip}
                onPress={() => send(q)}
                accessibilityRole="button"
              >
                <Text style={s.chipText}>{q}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <View style={s.inputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={
              svc ? '问 AI，或让它替你操作 App' : '先配置供应商与模型'
            }
            placeholderTextColor={color.ink3}
            style={s.input}
            multiline
            editable={!!svc}
            accessibilityLabel="问 AI"
          />
          <View style={s.toolbar}>
            <Pressable
              style={[s.modelControl, s.control]}
              onPress={() => setSheet('model')}
              disabled={!!busy}
              accessibilityLabel="选择模型"
              accessibilityRole="button"
            >
              <Text style={s.controlText} numberOfLines={1}>
                {svc ? prettyModel(svc.model) : '选择模型'}
              </Text>
              <ChevronDown size={13} color={color.ink2} />
            </Pressable>
            <Pressable
              style={[
                s.control,
                config?.search && s.controlOn,
                !availability.ok && s.controlDashed,
              ]}
              onPress={toggleSearch}
              disabled={!!busy || !svc}
              accessibilityRole="button"
              accessibilityLabel="联网搜索"
              accessibilityState={{ selected: config?.search ?? false }}
            >
              <Globe
                size={15}
                color={config?.search ? color.learn : color.ink2}
              />
              <Text style={[s.controlText, config?.search && s.linkText]}>
                搜索
              </Text>
            </Pressable>
            <Pressable
              style={s.control}
              onPress={() => setSheet('effort')}
              disabled={!!busy || !svc}
              accessibilityRole="button"
              accessibilityLabel="思考强度"
            >
              <Brain size={15} color={color.ink2} />
              <Text style={s.controlText}>
                {config && config.effort !== 'off'
                  ? '思考·' + EFFORT_NAME[config.effort]
                  : '思考'}
              </Text>
            </Pressable>
            <Pressable
              style={[
                s.send,
                (!svc || (!text.trim() && !busy)) && s.sendDisabled,
              ]}
              onPress={busy ? stop : () => send(text)}
              disabled={!busy && (!text.trim() || !svc)}
              accessibilityRole="button"
              accessibilityLabel={busy ? '停止' : '发送'}
            >
              {busy ? (
                <Square size={17} color="#FFFFFF" fill="#FFFFFF" />
              ) : (
                <ArrowUp size={22} color="#FFFFFF" />
              )}
            </Pressable>
          </View>
        </View>
        {est && svc && !busy ? (
          <Text style={[s.est, num]} numberOfLines={2}>
            {'这次约 ' +
              fmtInt(est.total + qTokens) +
              ' tokens，预计 ' +
              fmtInt(est.cached) +
              ' 可读缓存'}
          </Text>
        ) : null}
      </View>
      <AiMenu
        visible={menu}
        onClose={() => setMenu(false)}
        go={r => {
          setMenu(false);
          if (r === 'new') {
            followEnd.current = true;
            userScrolling.current = false;
            setAtEnd(true);
            newThread();
          } else {
            nav.navigate(r);
          }
        }}
      />
      <ModelPicker
        visible={sheet === 'model' || sheet === 'searchModels'}
        searchOnly={sheet === 'searchModels'}
        providers={providers}
        config={config}
        onClose={() => {
          setSheet(null);
          setSearchQuestion(null);
        }}
        onSelect={(p, m) => choose(p, m).catch(e => setError(String(e)))}
        onManage={() => {
          setSheet(null);
          nav.navigate('AiServices');
        }}
      />
      <EffortPicker
        visible={sheet === 'effort'}
        caps={svc?.capabilities ?? null}
        config={config}
        onClose={() => setSheet(null)}
        onSelect={effort => {
          if (config) {
            selectConfig(core, { ...config, effort })
              .then(() => setSheet(null))
              .catch(e => setError(String(e)));
          }
        }}
        onManage={() => {
          setSheet(null);
          nav.navigate('AiService', { id: provider?.id });
        }}
      />
      <SearchUnavailable
        visible={sheet === 'search'}
        reason={availability.reason}
        onClose={() => {
          setSheet(null);
          setSearchQuestion(null);
        }}
        onChoose={() => setSheet('searchModels')}
      />
    </KeyboardAvoidingView>
  );
}

/** 第 i 条所在的回答从哪条开始（提问之后的第一条）。 */
function firstOfAnswer(msgs: StoredMessage[], i: number): number {
  let k = i;
  while (k > 0 && msgs[k - 1].role !== 'user') {
    k--;
  }
  return k;
}

function MessageView({
  m,
  usage,
  svc,
  accountId,
  onLink,
  onCard,
  onMemory,
  onNav,
  onSearch,
  searchBusy,
}: {
  m: StoredMessage;
  last: boolean;
  usage: Usage | null;
  svc: AiService | null;
  accountId: number;
  onLink: (href: string) => void;
  onCard: (toolId: string, act: 'run' | 'cancel') => void;
  onMemory: (toolId: string, act: 'confirm' | 'decline' | 'undo') => void;
  onNav: (n: NonNullable<ToolUi['nav']>) => void;
  onSearch: (q: string) => void;
  searchBusy: boolean;
}) {
  const [showQueries, setShowQueries] = useState(false);
  const [showThinking, setShowThinking] = useState(false),
    [showSearch, setShowSearch] = useState(false);
  if (m.role === 'user') {
    const ui = m.ui ?? {};
    return (
      <View>
        {ui.divider ? (
          <View style={s.divider}>
            <View style={s.divLine} />
            <Text style={s.divText}>{ui.divider}</Text>
            <View style={s.divLine} />
          </View>
        ) : null}
        <View style={s.userWrap}>
          <View style={s.userBubble}>
            <Text style={s.userText} selectable>
              {ui.question}
            </Text>
          </View>
          <Text style={s.attach}>
            {'附带：' +
              (ui.page ?? '没有页面') +
              ' · ' +
              (ui.actions ?? 0) +
              ' 条操作'}
          </Text>
        </View>
      </View>
    );
  }
  if (m.role === 'tool') {
    const tools = m.ui?.tools ?? [];
    const isQuery = (t: ToolUi) => !t.card && !t.memory && !t.nav && !t.error;
    const queries = tools.filter(isQuery);
    return (
      <View style={s.aiBlock}>
        {queries.length ? (
          <Pressable
            style={s.toolSummary}
            accessibilityRole="button"
            accessibilityLabel="查询详情"
            accessibilityState={{ expanded: showQueries }}
            onPress={() => setShowQueries(v => !v)}
          >
            <Check size={15} color={color.learn} />
            <Text style={s.toolSummaryText}>
              {'已查询 ' + queries.length + ' 项数据'}
            </Text>
            {showQueries ? (
              <ChevronUp size={15} color={color.ink2} />
            ) : (
              <ChevronDown size={15} color={color.ink2} />
            )}
          </Pressable>
        ) : null}
        {tools
          .filter(t => showQueries || !isQuery(t))
          .map(t => (
            <View key={t.id}>
              {t.card ? (
                <CardView
                  card={t.card}
                  expired={t.card.accountId !== accountId}
                  onRun={() => onCard(t.id, 'run')}
                  onCancel={() => onCard(t.id, 'cancel')}
                  onLesson={id => onLink('lesson:' + id)}
                />
              ) : t.memory ? (
                <MemoryView mm={t.memory} onAct={a => onMemory(t.id, a)} />
              ) : t.nav ? (
                <Pressable
                  onPress={() => onNav(t.nav!)}
                  accessibilityRole="button"
                >
                  <Text style={s.tool}>{'↗ ' + t.label}</Text>
                </Pressable>
              ) : (
                <View style={s.toolLine}>
                  {t.error ? (
                    <X size={15} color={color.up} />
                  ) : (
                    <Check size={15} color={color.learn} />
                  )}
                  <Text style={[s.tool, s.toolLabel, t.error && s.toolBad]}>
                    {t.label}
                  </Text>
                </View>
              )}
            </View>
          ))}
        {usage ? (
          <Text style={[s.usage, num]}>
            {usageText(
              usage,
              m.ui?.price !== undefined ? { price: m.ui.price } : svc,
            )}
          </Text>
        ) : null}
      </View>
    );
  }
  const text = m.parts.map(p => (p.t === 'text' ? p.text : '')).join('\n');
  if (
    !text &&
    !m.ui?.thinking &&
    !m.ui?.search &&
    !m.ui?.notice &&
    !m.ui?.error &&
    !usage
  ) {
    return null;
  }
  return (
    <View style={s.aiBlock}>
      {m.ui?.config ? (
        <Text style={s.answerHead}>
          {prettyModel(m.ui.config.model) +
            ' · 思考' +
            EFFORT_NAME[m.ui.config.effort] +
            (m.ui.config.search ? ' · 搜索' : '')}
        </Text>
      ) : null}
      {m.ui?.thinking ? (
        <>
          <Pressable
            style={s.toolSummary}
            onPress={() => setShowThinking(v => !v)}
            accessibilityRole="button"
            accessibilityLabel="思考过程"
            accessibilityState={{ expanded: showThinking }}
          >
            <Brain size={15} color={color.ink2} />
            <Text style={s.toolSummaryText}>
              {m.id === -1 ? '正在思考' : '思考摘要'}
            </Text>
            <ChevronDown size={14} color={color.ink2} />
          </Pressable>
          {showThinking ? (
            <Text style={s.thinking} selectable>
              {m.ui.thinking}
            </Text>
          ) : null}
        </>
      ) : null}
      {m.ui?.search ? (
        <>
          <Pressable
            style={s.toolSummary}
            onPress={() => setShowSearch(v => !v)}
            accessibilityRole="button"
            accessibilityLabel="搜索详情"
            accessibilityState={{ expanded: showSearch }}
          >
            <Globe size={15} color={color.learn} />
            <Text style={s.toolSummaryText}>
              {(m.ui.search.queries.length
                ? '搜索 ' + m.ui.search.queries.length + ' 个查询 · '
                : '') +
                m.ui.search.sources.length +
                ' 个网页'}
            </Text>
            <ChevronDown size={14} color={color.ink2} />
          </Pressable>
          {showSearch ? (
            <View>
              <Text style={s.thinking}>
                {m.ui.search.queries.length
                  ? m.ui.search.queries.map(q => '搜索：' + q).join('\n')
                  : '供应商未返回搜索词'}
              </Text>
              {m.ui.search.sources.map((src, i) => (
                <Pressable
                  key={src.url}
                  style={s.source}
                  onPress={() => onLink(src.url)}
                  accessibilityRole="link"
                >
                  <Text style={s.linkText}>{i + 1 + '. ' + src.title}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
      {text ? (
        <Markdown
          text={citedText(text, m.ui?.search)}
          onLink={href => {
            const match = /^source:(\d+)$/.exec(href);
            const src = match ? m.ui?.search?.sources[Number(match[1])] : null;
            onLink(src?.url ?? href);
          }}
        />
      ) : null}
      {text && m.ui?.search?.sources.length ? (
        <View style={s.sources}>
          <Text style={s.sourceTitle}>来源</Text>
          {m.ui.search.sources.map((src, i) => (
            <Pressable
              key={src.url}
              onPress={() => onLink(src.url)}
              style={s.source}
              accessibilityRole="link"
            >
              <Text style={s.sourceText}>
                {'[' + (i + 1) + '] ' + src.title}
              </Text>
              <Text style={s.sourceUrl} numberOfLines={1}>
                {src.url.replace(/^https?:\/\//, '')}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {m.ui?.searchOffer ? (
        <Pressable
          style={s.searchOffer}
          disabled={searchBusy}
          onPress={() => onSearch(m.ui!.searchOffer!)}
          accessibilityRole="button"
        >
          <Globe size={15} color={color.learn} />
          <Text style={s.linkText}>开启搜索并重问</Text>
        </Pressable>
      ) : null}
      {m.ui?.notice ? <Text style={s.notice}>{m.ui.notice}</Text> : null}
      {m.ui?.error ? <Text style={s.error}>{m.ui.error}</Text> : null}
      {usage ? (
        <Text style={[s.usage, num]}>
          {usageText(
            usage,
            m.ui?.price !== undefined ? { price: m.ui.price } : svc,
          )}
        </Text>
      ) : null}
    </View>
  );
}

const CARD_STATUS: Record<ActionCard['status'], string> = {
  pending: '',
  done: '已执行',
  failed: '执行失败',
  canceled: '已取消',
  expired: '已失效',
};

function CardView({
  card,
  expired,
  onRun,
  onCancel,
  onLesson,
}: {
  card: ActionCard;
  expired: boolean;
  onRun: () => void;
  onCancel: () => void;
  onLesson: (id: string) => void;
}) {
  const pending = card.status === 'pending' && !expired;
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>
        {'操作卡 #' + card.no + ' · ' + card.title}
      </Text>
      {card.rows.map(r => (
        <View key={r.k} style={s.cardRow}>
          <Text style={s.cardK}>{r.k}</Text>
          <Text style={[s.cardV, num]}>{r.v}</Text>
        </View>
      ))}
      <View style={s.cardCheck}>
        <CheckBar ok={card.check.ok} text={'预校验：' + card.check.text} />
      </View>
      {card.check.lesson ? (
        <Text style={s.cardLink} onPress={() => onLesson(card.check.lesson!)}>
          看规则课 ›
        </Text>
      ) : null}
      {card.note ? <Text style={s.cardNote}>{card.note}</Text> : null}
      {pending ? (
        <View style={s.cardBtns}>
          <View style={s.grow}>
            <Button title="取消" onPress={onCancel} />
          </View>
          <View style={s.grow}>
            <Button
              title="执行"
              tone={
                card.tool === 'place_order' && card.title.startsWith('卖出')
                  ? 'sell'
                  : 'buy'
              }
              disabled={!card.check.ok}
              onPress={onRun}
            />
          </View>
        </View>
      ) : (
        <Text
          style={[
            s.cardResult,
            card.status === 'done'
              ? s.ok
              : card.status === 'failed'
              ? s.bad
              : null,
          ]}
        >
          {expired && card.status === 'pending'
            ? '已失效：账户已经重置'
            : CARD_STATUS[card.status] +
              (card.result ? ' → ' + card.result : '')}
        </Text>
      )}
    </View>
  );
}

function MemoryView({
  mm,
  onAct,
}: {
  mm: MemoryChange;
  onAct: (a: 'confirm' | 'decline' | 'undo') => void;
}) {
  const what =
    (mm.op === 'add' ? '' : '忘记 ') +
    '[' +
    MEMORY_KIND_NAME[mm.kind] +
    '] ' +
    mm.text;
  const head =
    mm.status === 'pending'
      ? mm.op === 'add'
        ? '要记住吗？'
        : '要忘记吗？'
      : mm.status === 'done'
      ? mm.op === 'add'
        ? '已记住：'
        : '已忘记：'
      : mm.status === 'undone'
      ? '已撤销：'
      : '没有记：';
  return (
    <View style={s.mem}>
      <Text style={s.memText}>{'🧠 ' + head + what}</Text>
      {mm.status === 'pending' ? (
        <View style={s.memBtns}>
          <Button small title="不用" onPress={() => onAct('decline')} />
          <Button
            small
            tone="learn"
            title={mm.op === 'add' ? '记住' : '忘记'}
            onPress={() => onAct('confirm')}
          />
        </View>
      ) : mm.status === 'done' ? (
        <Text style={s.memUndo} onPress={() => onAct('undo')}>
          撤销
        </Text>
      ) : null}
    </View>
  );
}

type MenuKey = 'new' | 'AiThreads' | 'AiMemory' | 'AiServices' | 'AiContext';

const MENU: [MenuKey, string, string][] = [
  ['new', '新对话', '别的对话不会自动带进来；AI 可以按需检索'],
  ['AiThreads', '对话列表', '切换、删除对话'],
  ['AiMemory', 'AI 记忆', '记忆模式；按类别查看、修改、删除'],
  ['AiServices', '供应商与模型', '连接、Key、模型能力与价格'],
  ['AiContext', '发给 AI 的上下文', '每部分原文、token 和缓存断点'],
];

function AiMenu({
  visible,
  onClose,
  go,
}: {
  visible: boolean;
  onClose: () => void;
  go: (r: MenuKey) => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={s.mask} onPress={onClose}>
        <View style={s.menu}>
          {MENU.map(([r, t, sub]) => (
            <Pressable
              key={r}
              style={({ pressed }) => [
                s.menuItem,
                pressed && { backgroundColor: color.press },
              ]}
              onPress={() => go(r)}
              accessibilityRole="button"
            >
              <Text style={s.menuTitle}>{t}</Text>
              <Text style={s.menuSub}>{sub}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  ctxBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PAD,
    paddingVertical: 7,
    backgroundColor: color.learnBg,
  },
  ctxText: { flex: 1, fontSize: 12, color: '#0B5552' },
  ctxMore: { fontSize: 12, color: color.learn, marginLeft: 8 },
  list: { flex: 1 },
  listPad: { padding: 10, paddingBottom: 20 },
  setup: { marginBottom: 10 },
  setupBtn: { marginTop: 10 },
  compacted: {
    textAlign: 'center',
    fontSize: 12,
    color: color.ink3,
    marginVertical: 6,
  },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 10 },
  divLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.ink3,
  },
  divText: {
    fontSize: 12,
    color: color.ink2,
    marginHorizontal: 8,
    flexShrink: 1,
    textAlign: 'center',
  },
  userWrap: { alignItems: 'flex-end', marginVertical: 6 },
  userBubble: {
    maxWidth: '85%',
    backgroundColor: '#26313C',
    borderRadius: 12,
    borderBottomRightRadius: 3,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  userText: { color: '#FFFFFF', fontSize: 15, lineHeight: 22 },
  attach: { fontSize: 11, color: color.ink3, marginTop: 3 },
  aiBlock: {
    backgroundColor: color.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    marginVertical: 4,
  },
  tool: { fontSize: 13, lineHeight: 20, color: color.ink2, marginBottom: 4 },
  toolLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  toolLabel: { flex: 1 },
  toolSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 48,
  },
  toolSummaryText: { fontSize: 12, lineHeight: 18, color: color.ink2 },
  latest: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 4,
    padding: 12,
  },
  toolBad: { color: color.up },
  usage: {
    fontSize: 11,
    lineHeight: 16,
    color: color.ink3,
    marginTop: 4,
    marginBottom: 2,
  },
  notice: { fontSize: 12, color: color.warnInk, marginBottom: 4 },
  error: { fontSize: 13, lineHeight: 19, color: color.up, marginVertical: 4 },
  busy: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 8 },
  busyText: { fontSize: 13, color: color.ink2 },
  card: {
    borderWidth: 1,
    borderColor: color.learnLine,
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: color.ink,
    marginBottom: 6,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    gap: 10,
  },
  cardK: { fontSize: 13, color: color.ink2 },
  cardV: { flexShrink: 1, fontSize: 13, color: color.ink, textAlign: 'right' },
  cardCheck: { marginHorizontal: -10 },
  cardLink: { fontSize: 13, color: color.learn, marginTop: 6 },
  cardNote: { fontSize: 12, lineHeight: 17, color: color.ink3, marginTop: 6 },
  cardBtns: { flexDirection: 'row', gap: 10, marginTop: 10 },
  grow: { flex: 1 },
  cardResult: { fontSize: 13, lineHeight: 19, color: color.ink2, marginTop: 8 },
  ok: { color: color.down },
  bad: { color: color.up },
  mem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.learnBg,
    borderRadius: 6,
    padding: 8,
    marginVertical: 4,
    gap: 8,
  },
  memText: { flex: 1, fontSize: 13, lineHeight: 19, color: '#0B5552' },
  memBtns: { flexDirection: 'row', gap: 6 },
  memUndo: { fontSize: 13, color: color.learn, paddingHorizontal: 4 },
  bottom: {
    backgroundColor: color.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    paddingHorizontal: 10,
    paddingTop: 6,
  },
  quick: { gap: 8, paddingBottom: 6 },
  chip: {
    borderWidth: 1,
    borderColor: color.learnLine,
    borderRadius: 14,
    paddingHorizontal: 10,
    height: 28,
    justifyContent: 'center',
  },
  chipText: { fontSize: 13, color: color.learn },
  inputRow: {
    borderWidth: 1,
    borderColor: '#DCE2E5',
    borderRadius: 16,
    padding: 6,
    backgroundColor: '#FFFFFF',
  },
  input: {
    minHeight: 48,
    maxHeight: 96,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    color: color.ink,
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  control: {
    minHeight: 48,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 10,
  },
  modelControl: { flex: 1, justifyContent: 'flex-start', minWidth: 40 },
  controlText: { fontSize: 12, color: color.ink2, flexShrink: 1 },
  controlOn: { backgroundColor: color.learnBg },
  controlDashed: {
    borderWidth: 1,
    borderColor: '#B7C0C5',
    borderStyle: 'dashed',
  },
  linkText: { fontSize: 12, color: color.learn },
  send: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.learn,
  },
  sendDisabled: { backgroundColor: '#B6C8C7' },
  cacheWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: color.warnBg,
    borderRadius: 10,
    paddingLeft: 10,
    marginBottom: 6,
  },
  cacheText: { fontSize: 11, lineHeight: 17, color: color.warnInk, flex: 1 },
  revert: {
    minHeight: 48,
    minWidth: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  revertText: { fontSize: 12, fontWeight: '600', color: color.warnInk },
  answerHead: {
    fontSize: 11,
    color: color.ink2,
    marginBottom: 6,
    fontWeight: '500',
  },
  thinking: {
    fontSize: 12,
    lineHeight: 19,
    color: color.ink2,
    backgroundColor: color.bg,
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  sources: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    marginTop: 8,
    paddingTop: 10,
  },
  sourceTitle: { fontSize: 11, color: color.ink2, fontWeight: '600' },
  source: { minHeight: 48, justifyContent: 'center', paddingVertical: 7 },
  sourceText: { fontSize: 12, color: color.learn, lineHeight: 18 },
  sourceUrl: { fontSize: 10, color: color.ink2, lineHeight: 16 },
  searchOffer: {
    minHeight: 48,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: color.learnBg,
    marginTop: 8,
  },
  est: { fontSize: 11, color: color.ink3, marginTop: 4 },
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'flex-end' },
  menu: {
    marginTop: 56,
    marginRight: 8,
    width: 260,
    backgroundColor: color.card,
    borderRadius: 10,
    paddingVertical: 4,
    elevation: 8,
  },
  menuItem: { paddingHorizontal: 14, paddingVertical: 10 },
  menuTitle: { fontSize: 15, color: color.ink },
  menuSub: { fontSize: 12, color: color.ink3, marginTop: 2 },
});
