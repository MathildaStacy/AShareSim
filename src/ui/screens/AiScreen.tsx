/**
 * AI 对话（PRODUCT_DESIGN §6.5、M4 界面清单）：上下文条、消息（你的问题、分隔线、回答、用到的工具、操作卡、
 * 记忆变更、用量和费用）、快捷问题、输入框（预计 token 和走缓存的部分）。
 * AI 页自己不登记页面上下文：打开时记下来源页面，每次提问重新计算它的上下文。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Check, ChevronDown, ChevronUp, Menu, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
} from '../../ai/chat';
import { capturePage } from '../../ai/context';
import { costOf, estimateTokens, fmtUsd } from '../../ai/prompt';
import { quickQuestions } from '../../ai/quick';
import { loadPrefs } from '../../ai/services';
import {
  MEMORY_KIND_NAME,
  type ActionCard,
  type AiService,
  type MemoryChange,
  type StoredMessage,
  type ToolUi,
  type Usage,
} from '../../ai/types';
import * as aiRepo from '../../data/aiRepo';
import * as repo from '../../data/repos';
import { CheckBar } from '../components/form';
import { Markdown } from '../components/Markdown';
import { Button, IconButton, NavBar, Note } from '../components/ui';
import { useCore } from '../hooks';
import type { RootStackParamList } from '../navigation/types';
import { color, num, PAD } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const TAB_ROUTES = new Set(['Watch', 'Market', 'Trade', 'Learn', 'Me']);

const fmtInt = (n: number) => n.toLocaleString('zh-CN');

/** 一次回答的用量：「输入 1,200 · 缓存读 8,300 · 写 400 · 输出 350 tokens · 约 $0.004（不用缓存 $0.012）」。 */
export function usageText(u: Usage, svc: AiService | null): string {
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
  return parts.join(' · ');
}

export function AiScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [source] = useState(() => capturePage());
  const { messages, thread, busy, pendingNav } = useChat();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [svc, setSvc] = useState<AiService | null | undefined>(undefined);
  const [memCount, setMemCount] = useState(0);
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
  }, [core, answerKey, source]);

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
    }
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
            ? svc.name + ' · ' + svc.model
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
            <Note>
              AI 助手直连你自己配置的服务（Anthropic Messages 或 OpenAI
              Responses，官方或中转都行），API Key 只存在本机 Android
              Keystore。先添加一个服务。
            </Note>
            <View style={s.setupBtn}>
              <Button
                title="去配置 AI 服务"
                tone="learn"
                onPress={() => nav.navigate('AiService', {})}
              />
            </View>
          </View>
        ) : null}
        {thread?.compactedCount ? (
          <Text style={s.compacted}>
            {'较早的 ' + thread.compactedCount + ' 条消息已压缩成摘要'}
          </Text>
        ) : null}
        {!live.length && svc ? (
          <Text style={s.hello}>
            可以问这个页面上的任何东西：「这是什么意思」「这只股票现在值得买吗」「我的持仓该怎么调整」。我会先给出投资建议，再说明判断依据和风险。也可以让我替你操作
            App，例如「帮我打开沪深300ETF 的买入页，价格 4.85，100
            份」；会改数据的操作要你点「执行」才生效。
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
            svc={svc ?? null}
            accountId={core.sim.accountId}
            onLink={onLink}
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
            placeholder={svc ? '问 AI，或让它替你操作 App' : '先配置 AI 服务'}
            placeholderTextColor={color.ink3}
            style={s.input}
            multiline
            editable={!!svc}
            accessibilityLabel="问 AI"
          />
          {busy ? (
            <Button small title="停止" onPress={stop} />
          ) : (
            <Button
              small
              title="发送"
              tone="learn"
              disabled={!text.trim() || !svc}
              onPress={() => send(text)}
            />
          )}
        </View>
        {est && svc && !busy ? (
          <Text style={[s.est, num]} numberOfLines={2}>
            {'这次约 ' +
              fmtInt(est.total + qTokens) +
              ' tokens，预计 ' +
              fmtInt(est.cached) +
              ' 走缓存 · ' +
              est.note}
          </Text>
        ) : null}
        <Text style={s.adviceHint}>
          AI 提供投资建议与分析，模拟交易需你确认
        </Text>
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
}) {
  const [showQueries, setShowQueries] = useState(false);
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
          <Text style={[s.usage, num]}>{usageText(usage, svc)}</Text>
        ) : null}
      </View>
    );
  }
  const text = m.parts
    .map(p => (p.t === 'text' ? p.text : ''))
    .join('\n')
    .trim();
  if (!text && !m.ui?.notice && !m.ui?.error && !usage) {
    return null;
  }
  return (
    <View style={s.aiBlock}>
      {text ? <Markdown text={text} onLink={onLink} /> : null}
      {m.ui?.notice ? <Text style={s.notice}>{m.ui.notice}</Text> : null}
      {m.ui?.error ? <Text style={s.error}>{m.ui.error}</Text> : null}
      {usage ? (
        <Text style={[s.usage, num]}>{usageText(usage, svc)}</Text>
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
      <Text style={s.cardFoot}>
        AI 生成的操作，你点「执行」才生效；会记进操作日志（AI 代操作）
      </Text>
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
  ['AiServices', 'AI 服务', 'Base URL、API Key、模型、价格'],
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
  hello: { fontSize: 13, lineHeight: 20, color: color.ink2, padding: 6 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 10 },
  divLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.ink3,
  },
  divText: { fontSize: 12, color: color.ink3, marginHorizontal: 8 },
  userWrap: { alignItems: 'flex-end', marginVertical: 6 },
  userBubble: {
    maxWidth: '85%',
    backgroundColor: color.learn,
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
  cardFoot: { fontSize: 11, color: color.ink3, marginTop: 6 },
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
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    color: color.ink,
  },
  est: { fontSize: 11, color: color.ink3, marginTop: 4 },
  adviceHint: { fontSize: 11, color: color.ink2, marginTop: 2 },
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
