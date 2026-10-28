/**
 * AI 对话（PRODUCT_DESIGN §6.5、M4 界面清单）：上下文条、消息（你的问题、分隔线、回答、用到的工具、操作卡、
 * 记忆变更、用量和费用）、快捷问题、输入框（预计 token 和走缓存的部分）。
 * AI 页自己不登记页面上下文：打开时记下来源页面，每次提问重新计算它的上下文。
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ArrowUp,
  ArrowRight,
  ChevronLeft,
  SquarePen,
  Share2,
  Brain,
  ChevronDown,
  Globe,
  Menu,
  Plug,
  Square,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
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
import { loadMcpServers, mcpReady } from '../../ai/mcp';
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
import { ProposalCard } from '../components/ProposalCard';
import {
  answerText,
  traceNumbers,
  turnSources,
  type Provenance,
} from '../../ai/provenance';
import {
  BRIEF_NAME,
  briefingData,
  briefingQuestion,
  briefingTemplate,
  dueBriefings,
  loadBriefLog,
  markBriefing,
  type BriefDue,
} from '../../ai/flows';
import { ChatProcess, conversationTurns } from '../components/ChatProcess';
import { Button } from '../components/ui';
import { useCore } from '../hooks';
import type { RootStackParamList } from '../navigation/types';
import { color, num } from '../theme';
import { aiColor as c } from '../aiTheme';

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
    '输出 ' + fmtInt(u.output) + ' 词元',
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
  const [mcpOk, setMcpOk] = useState(false);
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
  const [briefs, setBriefs] = useState<BriefDue[]>([]);
  const [quick, setQuick] = useState<string[]>([]);
  const [est, setEst] = useState<{
    total: number;
    cached: number;
    note: string;
  } | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const scrollKey = useRef('');
  const viewport = useRef({ height: 0, offset: 0 });
  const followEnd = useRef(true);
  const userScrolling = useRef(false);
  const [atEnd, setAtEnd] = useState(true);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const { width, fontScale } = useWindowDimensions();
  const stackedControls = width < 360 || fontScale > 1.2;
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () =>
      setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () =>
      setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const bottomInset = keyboardVisible ? 8 : Math.max(insets.bottom, 8);
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
      const mcp = mcpReady(await loadMcpServers(core.db));
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
      setMcpOk(mcp);
      setRebuild(p.rebuild);
      if (!config && cfg) {
        useChat.setState({ config: cfg });
      }
      setBriefs(
        dueBriefings(
          core.sim.now(),
          core.sim.calendar,
          await loadBriefLog(core),
        ),
      );
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

  // 简报（§13.8）：你点了才发，一次请求，结果在新对话里
  const runBrief = async (d: BriefDue) => {
    if (busy) {
      return;
    }
    setError(null);
    const data = await briefingData(core, d.kind);
    await markBriefing(core, d);
    setBriefs(b => b.filter(x => x.kind !== d.kind));
    newThread();
    followEnd.current = true;
    await ask(core, {
      question: briefingQuestion(d),
      page: null,
      attach: {
        label: BRIEF_NAME[d.kind] + '数据',
        text: briefingTemplate(d.kind) + '\n' + data,
      },
    });
  };
  const skipBrief = (d: BriefDue) => {
    markBriefing(core, d).catch(() => undefined);
    setBriefs(b => b.filter(x => x.kind !== d.kind));
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
        mcp: config?.mcp ?? false,
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
  const toggleMcp = () => {
    if (!config || busy) {
      return;
    }
    selectConfig(core, { ...config, mcp: !config.mcp }).catch(e =>
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
  const turns = useMemo(() => conversationTurns(live), [live]);
  // 数字溯源（§13.9）：每轮最后的回答和这一轮的工具结果对一遍
  const traces = useMemo(
    () =>
      turns.map(t => {
        const answer = answerText(t.answer);
        return answer
          ? traceNumbers(answer, turnSources(t.question ?? null, t.answer))
          : null;
      }),
    [turns],
  );
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
      style={[s.page, { paddingLeft: insets.left, paddingRight: insets.right }]}
      // Android 全面屏模式下 adjustResize 不会缩小页面，需按键盘遮挡高度主动避让。
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[s.header, { paddingTop: insets.top }]}>
        <View style={s.headerRow}>
          <Pressable
            style={s.headerButton}
            accessibilityRole="button"
            accessibilityLabel="返回"
            onPress={() => nav.goBack()}
          >
            <ChevronLeft size={23} color={c.ink} />
          </Pressable>
          <Pressable
            style={s.headerTitle}
            onPress={() => nav.navigate('AiContext')}
            accessibilityRole="button"
            accessibilityLabel="查看上下文"
            accessibilityHint={
              '来源页面：' +
              (pageName ?? '无') +
              '，操作 ' +
              actCount +
              ' 条，记忆 ' +
              memCount +
              ' 条' +
              (est
                ? '，预计 ' +
                  fmtInt(est.total + qTokens) +
                  ' 词元，缓存 ' +
                  fmtInt(est.cached)
                : '')
            }
          >
            <Text style={s.headerName} numberOfLines={1}>
              {thread?.title ?? 'AI 助手'}
            </Text>
            <View style={s.headerMeta}>
              <Text style={s.ctxText}>
                {'来源页面：' +
                  (pageName ?? '无页面') +
                  (est && svc
                    ? ' · 预计输入 ' + fmtInt(est.total + qTokens) + ' 词元'
                    : '')}
              </Text>
              <ChevronDown size={12} color={c.secondary} />
            </View>
          </Pressable>
          <Pressable
            style={s.headerButton}
            accessibilityLabel="新对话"
            accessibilityRole="button"
            disabled={!!busy}
            accessibilityState={{ disabled: !!busy }}
            onPress={() => {
              if (!busy) {
                newThread();
                setText('');
                followEnd.current = true;
                userScrolling.current = false;
                setAtEnd(true);
              }
            }}
          >
            <SquarePen size={20} color={busy ? c.muted : c.ink} />
          </Pressable>
          <Pressable
            style={s.headerButton}
            accessibilityRole="button"
            accessibilityLabel="AI 菜单"
            onPress={() => setMenu(true)}
          >
            <Menu color={c.ink} size={21} />
          </Pressable>
        </View>
      </View>
      <ScrollView
        ref={scroll}
        style={s.list}
        contentContainerStyle={s.listPad}
        keyboardDismissMode="on-drag"
        onLayout={event => {
          viewport.current.height = event.nativeEvent.layout.height;
          if (followEnd.current) {
            requestAnimationFrame(() => {
              if (followEnd.current && !userScrolling.current) {
                scroll.current?.scrollToEnd({ animated: false });
              }
            });
          }
        }}
        onContentSizeChange={(_width, height) => {
          if (viewport.current.height > 0) {
            setAtEnd(
              height - viewport.current.offset - viewport.current.height < 60,
            );
          }
          // 只跟随新消息和新增正文；展开查询、操作卡重排时保留阅读位置。
          if (scrollKey.current === scrollVersion) {
            return;
          }
          scrollKey.current = scrollVersion;
          if (followEnd.current && !userScrolling.current) {
            scroll.current?.scrollToEnd({ animated: false });
          }
        }}
        onScroll={({ nativeEvent: e }) => {
          viewport.current = {
            height: e.layoutMeasurement.height,
            offset: e.contentOffset.y,
          };
          const nearEnd =
            e.contentSize.height -
              e.contentOffset.y -
              e.layoutMeasurement.height <
            60;
          if (userScrolling.current) {
            followEnd.current = nearEnd;
          }
          setAtEnd(nearEnd);
        }}
        onScrollBeginDrag={() => {
          userScrolling.current = true;
          followEnd.current = false;
        }}
        onScrollEndDrag={() => {
          userScrolling.current = false;
        }}
        onMomentumScrollBegin={() => {
          userScrolling.current = true;
        }}
        onMomentumScrollEnd={() => {
          userScrolling.current = false;
        }}
        scrollEventThrottle={32}
        keyboardShouldPersistTaps="handled"
      >
        {svc === null ? (
          <View style={s.setup}>
            <View style={s.setupBtn}>
              <Button
                style={s.actionButton}
                title="配置供应商与模型"
                tone="learn"
                onPress={() => nav.navigate('AiServices')}
              />
            </View>
          </View>
        ) : null}
        {svc && briefs.length && !busy ? (
          <View style={s.briefs}>
            {briefs.map(d => (
              <View key={d.kind} style={s.brief}>
                <Text style={s.briefText}>
                  {d.missed
                    ? '错过了今天的' + BRIEF_NAME[d.kind] + '，要不要补一份？'
                    : BRIEF_NAME[d.kind] +
                      '还没看（发一次请求，费用按当前模型算）'}
                </Text>
                <View style={s.briefBtns}>
                  <Pressable
                    style={s.briefBtn}
                    onPress={() => skipBrief(d)}
                    accessibilityRole="button"
                    accessibilityLabel={'不用' + BRIEF_NAME[d.kind]}
                  >
                    <Text style={s.briefSkip}>不用</Text>
                  </Pressable>
                  <Pressable
                    style={s.briefBtn}
                    onPress={() =>
                      runBrief(d).catch(e =>
                        setError(e instanceof Error ? e.message : String(e)),
                      )
                    }
                    accessibilityRole="button"
                  >
                    <Text style={s.briefGo}>
                      {d.missed ? '补一份' : '生成' + BRIEF_NAME[d.kind]}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}
        {!live.length && svc ? (
          <View style={s.emptyState}>
            <Text style={s.emptyTitle}>有什么想聊的？</Text>
            <View style={s.quick}>
              {quick.slice(0, 3).map(q => (
                <Pressable
                  key={q}
                  style={({ pressed }) => [
                    s.suggestion,
                    pressed && s.suggestionPressed,
                  ]}
                  onPress={() => send(q)}
                  accessibilityRole="button"
                >
                  <Text style={s.suggestionText}>{q}</Text>
                  <ArrowRight size={17} color={c.secondary} />
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        {thread?.compactedCount ? (
          <Text style={s.compacted}>
            {'较早的 ' + thread.compactedCount + ' 条消息已压缩成摘要'}
          </Text>
        ) : null}
        {turns.map((turn, turnIndex) => (
          <View key={turn.key} style={s.turn}>
            {(() => {
              const renderMessage = (m: StoredMessage) => (
                <MessageView
                  m={m}
                  usage={
                    m.role !== 'user' &&
                    m === turn.answer[turn.answer.length - 1] &&
                    !(busy && turnIndex === turns.length - 1)
                      ? answerUsage(turn.answer, 0)
                      : null
                  }
                  svc={messageService(m)}
                  trace={
                    m.role === 'assistant' &&
                    m ===
                      [...turn.answer]
                        .reverse()
                        .find(x => x.role === 'assistant') &&
                    !(busy && turnIndex === turns.length - 1)
                      ? traces[turnIndex]
                      : null
                  }
                  accountId={core.sim.accountId}
                  onLink={onLink}
                  onSearch={q => retrySearch(q).catch(e => setError(String(e)))}
                  searchBusy={!!busy}
                  onCard={(toolId, act) =>
                    act === 'run'
                      ? runCard(core, m.id, toolId)
                      : cancelCard(core, m.id, toolId)
                  }
                  onMemory={(toolId, act) =>
                    memoryAction(core, m.id, toolId, act)
                  }
                  onNav={n =>
                    (nav.navigate as (r: string, p?: object) => void)(
                      TAB_ROUTES.has(n.route) ? 'Tabs' : n.route,
                      TAB_ROUTES.has(n.route) ? { screen: n.route } : n.params,
                    )
                  }
                  onOpen={(route, params) =>
                    (nav.navigate as (r: string, p?: object) => void)(
                      route,
                      params,
                    )
                  }
                />
              );
              return (
                <>
                  {turn.question ? renderMessage(turn.question) : null}
                  <ChatProcess
                    messages={turn.answer}
                    onInteract={() => {
                      followEnd.current = false;
                    }}
                    busy={turnIndex === turns.length - 1 ? busy : null}
                    onLink={onLink}
                  />
                  {turn.answer.map((m, i) => (
                    <View key={i}>{renderMessage(m)}</View>
                  ))}
                </>
              );
            })()}
          </View>
        ))}
        {!turns.length && busy ? (
          <ChatProcess messages={[]} busy={busy} onLink={onLink} />
        ) : null}
        {error ? <Text style={s.error}>{error}</Text> : null}
      </ScrollView>
      <View style={[s.bottom, { paddingBottom: bottomInset }]}>
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
            <ChevronDown size={19} color={c.secondary} />
          </Pressable>
        ) : null}
        {rebuild && !busy ? (
          <View style={s.cacheWarning}>
            <Text style={s.cacheText}>
              {rebuild.reason +
                '：下次预计重建约 ' +
                fmtInt(rebuild.tokens) +
                ' 词元的缓存'}
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
        <View style={s.inputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={svc ? '给 AI 助手发消息' : '先配置供应商与模型'}
            placeholderTextColor={c.muted}
            style={s.input}
            multiline
            hitSlop={8}
            textAlignVertical="top"
            selectionColor={c.accent}
            editable={!!svc}
            accessibilityLabel="问 AI"
          />
          <View style={[s.toolbar, stackedControls && s.toolbarWrap]}>
            <Pressable
              style={[
                s.control,
                s.modelControl,
                stackedControls && s.modelFull,
              ]}
              onPress={() => setSheet('model')}
              disabled={!!busy}
              accessibilityLabel="选择模型"
              accessibilityState={{ disabled: !!busy }}
              accessibilityValue={{ text: svc?.model ?? '未选择' }}
              accessibilityRole="button"
            >
              <Text style={s.controlText} numberOfLines={1}>
                {svc ? prettyModel(svc.model) : '选择模型'}
              </Text>
              <ChevronDown size={13} color={color.ink2} />
            </Pressable>
            <Pressable
              style={s.control}
              onPress={toggleSearch}
              disabled={!!busy || !svc}
              accessibilityRole="button"
              accessibilityLabel="联网搜索"
              accessibilityState={{
                selected: config?.search ?? false,
                disabled: !!busy || !svc,
              }}
              accessibilityValue={{
                text: !availability.ok
                  ? '当前模型不可用'
                  : config?.search
                  ? '已开启'
                  : '已关闭',
              }}
            >
              <View
                style={[
                  s.controlSymbol,
                  !availability.ok && s.unavailableSymbol,
                ]}
              >
                <Globe
                  size={19}
                  color={config?.search ? c.accent : c.secondary}
                />
              </View>
              <Text style={s.controlText}>
                {config?.search ? '联网开' : '联网关'}
              </Text>
            </Pressable>
            {mcpOk || config?.mcp ? (
              <Pressable
                style={s.control}
                onPress={toggleMcp}
                disabled={!!busy || !svc || svc.capabilities?.tools === false}
                accessibilityRole="button"
                accessibilityLabel="外部工具"
                accessibilityState={{
                  selected: svc?.mcp ?? false,
                  disabled: !!busy || !svc || svc.capabilities?.tools === false,
                }}
                accessibilityValue={{
                  text:
                    svc?.capabilities?.tools === false
                      ? '当前模型不支持工具'
                      : svc?.mcp
                      ? '已开启'
                      : '已关闭',
                }}
              >
                <View style={s.controlSymbol}>
                  <Plug size={19} color={svc?.mcp ? c.accent : c.secondary} />
                </View>
                {svc?.mcp ? <View style={s.searchDot} /> : null}
              </Pressable>
            ) : null}
            <Pressable
              style={s.control}
              onPress={() => setSheet('effort')}
              disabled={!!busy || !svc}
              accessibilityRole="button"
              accessibilityLabel="思考强度"
              accessibilityState={{
                selected: !!config && config.effort !== 'off',
                disabled: !!busy || !svc,
              }}
              accessibilityValue={{
                text: config ? EFFORT_NAME[config.effort] : '未选择',
              }}
            >
              <Brain size={19} color={c.secondary} />
              <Text style={s.controlText}>
                {'思考' + (config ? EFFORT_NAME[config.effort] : '未选')}
              </Text>
            </Pressable>
            <Pressable
              style={[s.send, stackedControls && s.sendEnd]}
              onPress={busy ? stop : () => send(text)}
              disabled={!busy && (!text.trim() || !svc)}
              accessibilityRole="button"
              accessibilityLabel={busy ? '停止' : '发送'}
              accessibilityState={{ disabled: !busy && (!text.trim() || !svc) }}
            >
              <View
                style={[
                  s.sendDisc,
                  (!svc || (!text.trim() && !busy)) && s.sendDisabled,
                ]}
              >
                {busy ? (
                  <Square size={14} color="#FFFFFF" fill="#FFFFFF" />
                ) : (
                  <ArrowUp
                    size={20}
                    color={!svc || !text.trim() ? c.secondary : '#FFFFFF'}
                  />
                )}
              </View>
            </Pressable>
          </View>
        </View>
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

function MessageView({
  m,
  usage,
  svc,
  trace,
  accountId,
  onLink,
  onCard,
  onMemory,
  onNav,
  onOpen,
  onSearch,
  searchBusy,
}: {
  m: StoredMessage;
  usage: Usage | null;
  svc: AiService | null;
  /** 这一轮最后的回答：数字溯源结果。 */
  trace: Provenance | null;
  accountId: number;
  onLink: (href: string) => void;
  onCard: (toolId: string, act: 'run' | 'cancel') => void;
  onMemory: (toolId: string, act: 'confirm' | 'decline' | 'undo') => void;
  onNav: (n: NonNullable<ToolUi['nav']>) => void;
  onOpen: (route: string, params?: object) => void;
  onSearch: (q: string) => void;
  searchBusy: boolean;
}) {
  const [showSources, setShowSources] = useState(false);
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
          {ui.page !== undefined || ui.actions !== undefined ? (
            <Text style={s.attach}>
              {'已附带上下文：' +
                [
                  ui.page
                    ? '页面 ' + ui.page
                    : ui.page === null
                    ? '未附带页面'
                    : '',
                  ui.actions !== undefined
                    ? '最近操作记录 ' + ui.actions + ' 条'
                    : '',
                  ui.attach ?? '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }
  if (m.role === 'tool') {
    const tools = m.ui?.tools ?? [];
    const visibleTools = tools.filter(
      t => t.card || t.memory || t.nav || t.proposal,
    );
    if (!visibleTools.length && !usage) {
      return null;
    }
    return (
      <View style={s.toolBlock}>
        {visibleTools.map(t => (
          <View key={t.id}>
            {t.card ? (
              <CardView
                card={t.card}
                expired={t.card.accountId !== accountId}
                onRun={() => onCard(t.id, 'run')}
                onCancel={() => onCard(t.id, 'cancel')}
                onLesson={id => onLink('lesson:' + id)}
              />
            ) : t.proposal ? (
              <ProposalCard
                id={t.proposal.id}
                external={t.proposal.external}
                onOpen={onOpen}
              />
            ) : t.memory ? (
              <MemoryView mm={t.memory} onAct={a => onMemory(t.id, a)} />
            ) : t.nav ? (
              <Pressable
                style={s.navAction}
                onPress={() => onNav(t.nav!)}
                accessibilityRole="button"
              >
                <Text style={s.tool}>{'↗ ' + t.label}</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {usage ? <AnswerDetails m={m} usage={usage} svc={svc} text="" /> : null}
      </View>
    );
  }
  const text = m.parts.map(p => (p.t === 'text' ? p.text : '')).join('\n');
  if (!text && !m.ui?.notice && !m.ui?.error && !usage) {
    return null;
  }
  return (
    <View style={s.aiBlock}>
      {text ? (
        <Markdown
          text={citedText(text, m.ui?.search)}
          missing={
            trace?.missing.length
              ? new Set(trace.missing.map(x => x.text))
              : undefined
          }
          onLink={href => {
            const match = /^source:(\d+)$/.exec(href);
            const src = match ? m.ui?.search?.sources[Number(match[1])] : null;
            onLink(src?.url ?? href);
          }}
        />
      ) : null}
      {text && m.ui?.search?.sources.length ? (
        <View style={s.sources}>
          <Pressable
            style={s.toolSummary}
            onPress={() => setShowSources(v => !v)}
            accessibilityRole="button"
            accessibilityLabel="查看来源"
            accessibilityState={{ expanded: showSources }}
          >
            <Globe size={14} color={c.secondary} />
            <Text style={s.toolSummaryText}>
              {m.ui.search.sources.length + ' 个来源'}
            </Text>
            <ChevronDown size={13} color={c.secondary} />
          </Pressable>
          {showSources
            ? m.ui.search.sources.map((src, i) => (
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
              ))
            : null}
        </View>
      ) : null}
      {m.ui?.searchOffer ? (
        <Pressable
          style={s.searchOffer}
          disabled={searchBusy}
          onPress={() => onSearch(m.ui!.searchOffer!)}
          accessibilityRole="button"
        >
          <Globe size={14} color={c.secondary} />
          <Text style={s.linkText}>开启搜索并重问</Text>
        </Pressable>
      ) : null}
      {trace && trace.refs.length ? <TraceView trace={trace} /> : null}
      {m.ui?.notice ? <Text style={s.notice}>{m.ui.notice}</Text> : null}
      {m.ui?.error ? <Text style={s.error}>{m.ui.error}</Text> : null}
      {usage ? (
        <AnswerDetails m={m} usage={usage} svc={svc} text={text} />
      ) : null}
    </View>
  );
}

/** 「数字溯源：12 个有来源 · 1 个算出 · 1 个找不到来源」，点开看每个数字来自哪个工具。 */
function TraceView({ trace }: { trace: Provenance }) {
  const [open, setOpen] = useState(false);
  const miss = trace.missing.length;
  return (
    <View>
      <Pressable
        style={s.toolSummary}
        onPress={() => setOpen(v => !v)}
        accessibilityRole="button"
        accessibilityLabel="数字溯源"
        accessibilityState={{ expanded: open }}
      >
        <Text style={[s.traceText, miss ? s.traceMiss : null, num]}>
          {'数字溯源：' +
            trace.sourced +
            ' 个有来源' +
            (trace.derived ? ' · ' + trace.derived + ' 个算出' : '') +
            (miss ? ' · ' + miss + ' 个找不到来源（虚线）' : '')}
        </Text>
        <ChevronDown size={13} color={c.secondary} />
      </Pressable>
      {open
        ? trace.refs.map((r, i) => (
            <Text key={i} style={[s.traceRow, num]} selectable>
              {r.text +
                '  ' +
                (r.status === 'none'
                  ? '找不到来源：本轮工具结果里没有，也算不出来'
                  : r.source)}
            </Text>
          ))
        : null}
    </View>
  );
}

function AnswerDetails({
  m,
  usage,
  svc,
  text,
}: {
  m: StoredMessage;
  usage: Usage;
  svc: AiService | null;
  text: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const model = m.ui?.config?.model ?? m.raw?.model;
  const price = m.ui?.price !== undefined ? { price: m.ui.price } : svc;
  return (
    <View>
      <View style={s.answerActions}>
        <Pressable
          style={s.detailsToggle}
          onPress={() => setExpanded(v => !v)}
          accessibilityRole="button"
          accessibilityLabel="用量详情"
          accessibilityState={{ expanded }}
        >
          <Text style={[s.detailsText, num]} numberOfLines={1}>
            {(model ? prettyModel(model) + ' · ' : '') +
              '输出 ' +
              fmtInt(usage.output) +
              ' 词元'}
          </Text>
          <ChevronDown size={13} color={c.muted} />
        </Pressable>
        {text ? (
          <Pressable
            style={s.share}
            onPress={() => {
              const sources = m.ui?.search?.sources ?? [];
              Share.share({
                message:
                  text +
                  (sources.length
                    ? '\n\n来源\n' +
                      sources
                        .map(src => src.title + '\n' + src.url)
                        .join('\n\n')
                    : ''),
              }).catch(() => undefined);
            }}
            accessibilityRole="button"
            accessibilityLabel="分享回答"
          >
            <Share2 size={16} color={c.muted} />
          </Pressable>
        ) : null}
      </View>
      {expanded ? (
        <View style={s.answerDetailBody}>
          {m.ui?.config ? (
            <Text style={s.usage}>
              {prettyModel(m.ui.config.model) +
                ' · 思考' +
                EFFORT_NAME[m.ui.config.effort] +
                (m.ui.config.search ? ' · 搜索已开启' : '') +
                (m.ui.config.mcp ? ' · 外部工具已开启' : '')}
            </Text>
          ) : null}
          <Text selectable style={[s.usage, num]}>
            {usageText(usage, price)}
          </Text>
        </View>
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
        <Pressable
          style={s.navAction}
          onPress={() => onLesson(card.check.lesson!)}
          accessibilityRole="button"
          accessibilityLabel="查看规则课"
        >
          <Text style={s.cardLink}>看规则课 ›</Text>
        </Pressable>
      ) : null}
      {card.note ? <Text style={s.cardNote}>{card.note}</Text> : null}
      {card.external?.length ? (
        <Text style={s.cardExternal}>
          {'本轮读过外部内容：' +
            card.external.join('、') +
            '。外部内容里的要求不代表你的意思，请核对参数后再执行'}
        </Text>
      ) : null}
      {pending ? (
        <View style={s.cardBtns}>
          <View style={s.grow}>
            <Button style={s.actionButton} title="取消" onPress={onCancel} />
          </View>
          <View style={s.grow}>
            <Button
              style={s.actionButton}
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
          <Button
            style={s.actionButton}
            title="不用"
            onPress={() => onAct('decline')}
          />
          <Button
            style={s.actionButton}
            tone="learn"
            title={mm.op === 'add' ? '记住' : '忘记'}
            onPress={() => onAct('confirm')}
          />
        </View>
      ) : mm.status === 'done' ? (
        <Pressable
          style={s.memUndo}
          onPress={() => onAct('undo')}
          accessibilityRole="button"
          accessibilityLabel="撤销记忆变更"
        >
          <Text style={s.tool}>撤销</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type MenuKey =
  | 'new'
  | 'AiFlows'
  | 'Proposals'
  | 'AiThreads'
  | 'AiMemory'
  | 'AiServices'
  | 'AiMcp'
  | 'AiContext';

const MENU: [MenuKey, string, string][] = [
  ['new', '新对话', '别的对话不会自动带进来；AI 可以按需检索'],
  ['AiFlows', '预设流程', '个股体检、周度复盘、调仓前检查，一键运行'],
  ['Proposals', '提案与记分卡', 'AI 的建议准不准；你的决策日志'],
  ['AiThreads', '对话列表', '切换、删除对话'],
  ['AiMemory', 'AI 记忆', '记忆模式；按类别查看、修改、删除'],
  ['AiServices', '供应商与模型', '连接、Key、模型能力与价格'],
  ['AiMcp', '外部工具（MCP）', '接入 Tushare 等数据服务，对话里按需打开'],
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
  page: { flex: 1, backgroundColor: c.page },
  actionButton: {
    minHeight: 48,
    minWidth: 48,
    height: 'auto',
    paddingVertical: 12,
  },
  header: { paddingHorizontal: 6, backgroundColor: c.page },
  headerRow: { flexDirection: 'row', alignItems: 'center', minHeight: 62 },
  headerButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  headerName: { fontSize: 16, lineHeight: 23, color: c.ink, fontWeight: '500' },
  headerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  ctxText: { fontSize: 12, lineHeight: 18, color: c.secondary, flexShrink: 1 },
  list: { flex: 1 },
  listPad: {
    paddingHorizontal: 16,
    paddingTop: 16,
    // 输入区在正常 flex 布局内，列表高度已扣除它；只留阅读间距，避免重复占位。
    paddingBottom: 16,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
    flexGrow: 1,
  },
  setup: { flex: 1, justifyContent: 'center', paddingBottom: 48 },
  setupBtn: { marginTop: 10 },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 56,
    paddingTop: 24,
  },
  emptyTitle: {
    fontSize: 25,
    lineHeight: 36,
    fontWeight: '500',
    color: c.ink,
    marginBottom: 24,
  },
  quick: { gap: 8 },
  suggestion: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  suggestionPressed: { backgroundColor: c.soft },
  suggestionText: { flex: 1, fontSize: 15, lineHeight: 23, color: c.secondary },
  compacted: {
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
    color: c.muted,
    marginVertical: 12,
  },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  divLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: c.line,
  },
  divText: {
    fontSize: 12,
    color: c.secondary,
    marginHorizontal: 10,
    flexShrink: 1,
    textAlign: 'center',
  },
  turn: { marginBottom: 16 },
  userWrap: { alignItems: 'flex-end', marginTop: 8, marginBottom: 16 },
  userBubble: {
    maxWidth: '92%',
    backgroundColor: c.user,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  userText: { color: c.ink, fontSize: 16, lineHeight: 26 },
  attach: { fontSize: 11, lineHeight: 17, color: c.muted, marginTop: 6 },
  aiBlock: { padding: 0, marginBottom: 8 },
  toolBlock: { marginBottom: 8 },
  briefs: { gap: 8, marginBottom: 12 },
  brief: {
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingTop: 10,
    backgroundColor: c.paper,
  },
  briefText: { fontSize: 14, lineHeight: 21, color: c.ink },
  briefBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 4 },
  briefBtn: {
    minHeight: 44,
    minWidth: 48,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  briefSkip: { fontSize: 14, color: c.secondary },
  briefGo: { fontSize: 14, color: c.ink, fontWeight: '600' },
  traceText: {
    fontSize: 12,
    lineHeight: 18,
    color: c.secondary,
    flexShrink: 1,
  },
  traceMiss: { color: color.warnInk },
  traceRow: {
    fontSize: 12,
    lineHeight: 18,
    color: c.secondary,
    marginBottom: 2,
  },
  tool: { fontSize: 13, lineHeight: 21, color: c.secondary, marginBottom: 6 },
  toolSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    alignSelf: 'flex-start',
    paddingRight: 8,
  },
  toolSummaryText: {
    fontSize: 13,
    lineHeight: 20,
    color: c.secondary,
    flexShrink: 1,
  },
  latest: {
    position: 'absolute',
    right: 16,
    top: -56,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paper,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: c.line,
    zIndex: 2,
  },
  answerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 48,
    flexShrink: 1,
    paddingRight: 8,
  },
  detailsText: { fontSize: 12, lineHeight: 19, color: c.muted, flexShrink: 1 },
  share: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerDetailBody: {
    backgroundColor: c.soft,
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  usage: { fontSize: 12, lineHeight: 20, color: c.secondary },
  notice: {
    fontSize: 12,
    lineHeight: 19,
    color: color.warnInk,
    marginBottom: 6,
  },
  error: { fontSize: 14, lineHeight: 22, color: color.up, marginVertical: 8 },
  card: {
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 14,
    padding: 16,
    marginVertical: 10,
    backgroundColor: c.paper,
  },
  cardTitle: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    color: c.ink,
    marginBottom: 10,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    gap: 16,
  },
  cardK: { fontSize: 14, lineHeight: 22, color: c.secondary },
  cardV: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 22,
    color: c.ink,
    textAlign: 'right',
  },
  cardCheck: { marginHorizontal: -10 },
  cardLink: {
    fontSize: 14,
    color: c.ink,
    marginTop: 8,
    textDecorationLine: 'underline',
  },
  cardNote: { fontSize: 12, lineHeight: 20, color: c.secondary, marginTop: 8 },
  cardExternal: {
    fontSize: 12,
    lineHeight: 20,
    color: color.warnInk,
    backgroundColor: color.warnBg,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 8,
  },
  cardBtns: { flexDirection: 'row', gap: 12, marginTop: 12 },
  grow: { flex: 1 },
  cardResult: {
    fontSize: 14,
    lineHeight: 22,
    color: c.secondary,
    marginTop: 10,
  },
  ok: { color: color.down },
  bad: { color: color.up },
  mem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.soft,
    borderRadius: 12,
    padding: 12,
    marginVertical: 8,
    gap: 10,
  },
  memText: { flex: 1, fontSize: 13, lineHeight: 21, color: c.secondary },
  memBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  memUndo: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: {
    backgroundColor: c.page,
    paddingHorizontal: 12,
    paddingTop: 8,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  inputRow: {
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 18,
    padding: 4,
    backgroundColor: c.paper,
  },
  input: {
    minHeight: 36,
    maxHeight: 132,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 16,
    lineHeight: 24,
    color: c.ink,
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  toolbarWrap: { flexWrap: 'wrap' },
  modelFull: { flexBasis: '100%' },
  sendEnd: { marginLeft: 'auto' },
  navAction: { minHeight: 48, justifyContent: 'center' },
  control: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 12,
  },
  modelControl: {
    flex: 1,
    justifyContent: 'flex-start',
    minWidth: 48,
    paddingHorizontal: 10,
  },
  controlText: {
    fontSize: 12,
    lineHeight: 18,
    color: c.secondary,
    flexShrink: 1,
  },
  controlSymbol: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailableSymbol: {
    borderWidth: 1,
    borderColor: c.line,
    borderStyle: 'dashed',
    borderRadius: 14,
  },
  searchDot: {
    position: 'absolute',
    right: 10,
    top: 9,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.accent,
  },
  linkText: { fontSize: 13, lineHeight: 21, color: c.ink },
  send: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisc: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.action,
  },
  sendDisabled: { backgroundColor: c.disabled },
  cacheWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: color.warnBg,
    borderRadius: 12,
    paddingLeft: 12,
    marginBottom: 8,
  },
  cacheText: { fontSize: 12, lineHeight: 19, color: color.warnInk, flex: 1 },
  revert: {
    minHeight: 48,
    minWidth: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  revertText: { fontSize: 12, fontWeight: '600', color: color.warnInk },
  sources: { marginBottom: 4 },
  source: { minHeight: 48, justifyContent: 'center', paddingVertical: 8 },
  sourceText: {
    fontSize: 13,
    lineHeight: 21,
    color: c.ink,
    textDecorationLine: 'underline',
  },
  sourceUrl: { fontSize: 12, lineHeight: 19, color: c.secondary },
  searchOffer: {
    minHeight: 48,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: c.soft,
    marginVertical: 8,
  },
  mask: {
    flex: 1,
    backgroundColor: 'rgba(35,34,30,0.25)',
    alignItems: 'flex-end',
  },
  menu: {
    marginTop: 56,
    marginRight: 12,
    width: 270,
    backgroundColor: c.paper,
    borderRadius: 16,
    paddingVertical: 8,
    elevation: 8,
  },
  menuItem: { paddingHorizontal: 18, paddingVertical: 12, minHeight: 64 },
  menuTitle: { fontSize: 15, color: c.ink },
  menuSub: { fontSize: 12, lineHeight: 19, color: c.secondary, marginTop: 3 },
});
