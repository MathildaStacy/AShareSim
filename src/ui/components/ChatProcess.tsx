/** 一轮回答的辅助过程。只消费已有消息，不改变请求或工具执行。 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ChevronDown, ChevronRight, CircleAlert } from 'lucide-react-native';
import type { StoredMessage, SearchSource, ToolUi } from '../../ai/types';
import { aiColor as c } from '../aiTheme';
import { color } from '../theme';
import { Markdown } from './Markdown';

export function conversationTurns(messages: StoredMessage[]) {
  const turns: {
    key: string;
    question?: StoredMessage;
    answer: StoredMessage[];
  }[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      turns.push({
        key: `${message.threadId}:${message.id}`,
        question: message,
        answer: [],
      });
    } else {
      if (!turns.length) {
        turns.push({ key: `${message.threadId}:history`, answer: [] });
      }
      turns[turns.length - 1].answer.push(message);
    }
  }
  return turns;
}

/** thinking 混有多种协议的原始推理；只允许明确的公开 summary_text。 */
export function publicSummary(message: StoredMessage): string {
  if (message.raw?.protocol !== 'openai') {
    return '';
  }
  return message.raw.items
    .flatMap(item => {
      if (
        !item ||
        typeof item !== 'object' ||
        !('type' in item) ||
        item.type !== 'reasoning' ||
        !('summary' in item) ||
        !Array.isArray(item.summary)
      ) {
        return [];
      }
      return item.summary.flatMap(part =>
        part?.type === 'summary_text' && typeof part.text === 'string'
          ? [part.text]
          : [],
      );
    })
    .join('\n\n');
}

export function processEvidence(messages: StoredMessage[]) {
  const queries = new Set<string>();
  const sources = new Map<string, SearchSource>();
  for (const m of messages) {
    // search 在流式帧和后续轮次中可能是累积快照，不能把长度逐条相加。
    m.ui?.search?.queries.forEach(q => queries.add(q));
    m.ui?.search?.sources.forEach(source => sources.set(source.url, source));
  }
  const groups: { id: number; tools: ToolUi[]; summary: string }[] = [];
  for (const message of messages) {
    const summary = publicSummary(message);
    const tools = message.ui?.tools ?? [];
    const previous = groups[groups.length - 1];
    // 同一轮的摘要及紧随的工具结果共用一组，避免每条协议消息都变成一个模块。
    if (
      message.role === 'tool' &&
      tools.length &&
      previous &&
      !previous.tools.length
    ) {
      previous.tools = tools;
    } else if (summary || tools.length) {
      groups.push({ id: message.id, tools, summary });
    }
  }
  const tools = groups.flatMap(g => g.tools);
  return {
    groups,
    tools,
    queries: [...queries],
    sources: [...sources.values()],
  };
}

type FlowBlock =
  | { kind: 'process'; key: string; messages: StoredMessage[] }
  | { kind: 'message'; key: string; message: StoredMessage };

/** Only ordered messages establish a boundary; aggregated fields remain local. */
export function conversationFlow(
  messages: StoredMessage[],
  running = false,
): FlowBlock[] {
  const blocks: FlowBlock[] = [];
  const seenTools = new Set<string>();
  const seenQueries = new Set<string>();
  const seenSources = new Set<string>();
  const seenSummaries = new Set<string>();
  let seenSearch = false;
  const latestTools = new Map(
    messages.flatMap(m => (m.ui?.tools ?? []).map(t => [t.id, t] as const)),
  );
  const calls = messages.flatMap(m => m.parts.filter(p => p.t === 'call'));
  for (const [index, message] of messages.entries()) {
    const tools = (message.ui?.tools ?? [])
      .filter(t => {
        if (seenTools.has(t.id)) return false;
        seenTools.add(t.id);
        return true;
      })
      .map(t => latestTools.get(t.id)!);
    const originalSearch = message.ui?.search;
    const queries = (originalSearch?.queries ?? []).filter(q => {
      if (seenQueries.has(q)) return false;
      seenQueries.add(q);
      return true;
    });
    const sources = (originalSearch?.sources ?? []).filter(source => {
      if (seenSources.has(source.url)) return false;
      seenSources.add(source.url);
      return true;
    });
    const summary = publicSummary(message);
    const hasSummary = !!summary && !seenSummaries.has(summary);
    if (summary) seenSummaries.add(summary);
    const hasSearch =
      !!originalSearch &&
      (queries.length > 0 || sources.length > 0 || !seenSearch);
    if (originalSearch) seenSearch = true;
    const hasEvidence = tools.length > 0 || hasSummary || hasSearch;
    if (
      hasEvidence ||
      (running && index === messages.length - 1 && blocks.length === 0)
    ) {
      const record = {
        ...message,
        raw: hasSummary ? message.raw : null,
        parts: [
          ...calls.filter(p => tools.some(t => t.id === p.id)),
          ...message.parts.filter(p => p.t === 'result'),
        ],
        ui: {
          ...message.ui,
          tools,
          search:
            hasSearch && originalSearch
              ? { ...originalSearch, queries, sources }
              : undefined,
        },
      };
      const previous = blocks[blocks.length - 1];
      if (previous?.kind === 'process') previous.messages.push(record);
      else
        blocks.push({
          kind: 'process',
          key: `process:${blocks.length}`,
          messages: [record],
        });
    }
    const hasBody =
      message.parts.some(p => p.t === 'text' && p.text.trim()) ||
      message.ui?.notice ||
      message.ui?.error ||
      message.ui?.searchOffer;
    const hasActions = tools.some(
      t => t.card || t.memory || t.nav || t.proposal,
    );
    if (hasBody || hasActions || index === messages.length - 1) {
      blocks.push({
        kind: 'message',
        key: `message:${blocks.length}`,
        message: {
          ...message,
          ui: message.ui ? { ...message.ui, tools } : null,
        },
      });
    }
  }
  if (running && !blocks.some(b => b.kind === 'process')) {
    blocks.push({
      kind: 'process',
      key: `process:${blocks.length}`,
      messages: [],
    });
  }
  return blocks;
}

function toolStatus(tool: ToolUi): string {
  if (tool.error) {
    return '执行异常';
  } // 此标记也用于未执行，不能一律当作执行失败。
  if (tool.card) {
    return {
      pending: '待确认',
      done: '已执行',
      failed: '失败',
      canceled: '已取消',
      expired: '已失效',
    }[tool.card.status];
  }
  if (tool.memory) {
    return {
      pending: '待确认',
      done: '已完成',
      undone: '已撤销',
      declined: '已拒绝',
    }[tool.memory.status];
  }
  return tool.nav ? '导航记录' : '调用已结束';
}

export function ChatProcess({
  messages,
  busy,
  onLink,
  onInteract,
}: {
  onInteract?: () => void;
  messages: StoredMessage[];
  busy: string | null;
  onLink: (href: string) => void;
}) {
  // 以提问 id 为父级 key；流式临时消息落库不会重置用户的展开选择。
  const [expanded, setExpanded] = useState(false);
  const evidence = processEvidence(messages);
  const { groups, tools, queries, sources } = evidence;
  const hasSearch = messages.some(m => m.ui?.search);
  const errors = tools.filter(
    t => t.error || t.card?.status === 'failed',
  ).length;
  const counts = [
    tools.length ? `已调用 ${tools.length} 个工具` : '',
    errors ? `异常 ${errors} 项` : '',
    !sources.length && queries.length ? `检索词 ${queries.length} 个` : '',
    sources.length ? `来源 ${sources.length} 个` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  if (!busy && !groups.length && !hasSearch) {
    return null;
  }
  return (
    <View style={s.process}>
      <Pressable
        style={s.toggle}
        accessibilityRole="button"
        accessibilityLabel="处理过程"
        accessibilityState={{ expanded }}
        accessibilityHint={counts || '查看处理记录'}
        onPress={() => {
          onInteract?.();
          setExpanded(v => !v);
        }}
      >
        {busy ? <ActivityIndicator size={13} color={c.secondary} /> : null}
        <Text style={s.label}>{counts || (busy ? busy : '处理摘要')}</Text>
        {expanded ? (
          <ChevronDown size={14} color={c.secondary} />
        ) : (
          <ChevronRight size={14} color={c.secondary} />
        )}
      </Pressable>
      {busy && counts ? (
        <Text style={s.current} accessibilityLiveRegion="polite">
          {busy}
        </Text>
      ) : null}
      {tools
        .filter(t => t.error || t.card?.status === 'failed')
        .map(t => (
          <View key={t.id} style={s.errorRow}>
            <CircleAlert size={14} color={color.up} />
            <Text style={s.label}>{t.label + ' · 执行异常'}</Text>
          </View>
        ))}
      {expanded ? (
        <View style={s.details} testID="process-details">
          {groups.map(group => (
            <View key={group.id} style={s.group}>
              <View style={s.indent}>
                {group.tools.map(tool => {
                  const parts = messages.flatMap(m => m.parts);
                  const input = parts.find(
                    p => p.t === 'call' && p.id === tool.id,
                  );
                  const output = parts.find(
                    p => p.t === 'result' && p.id === tool.id,
                  );
                  return (
                    <View key={tool.id} style={s.toolDetail}>
                      <Text selectable style={s.label}>
                        {tool.label}
                      </Text>
                      <Text style={s.label}>{toolStatus(tool)}</Text>
                      {input?.t === 'call' ? (
                        <View style={s.inputCode}>
                          <ScrollView
                            horizontal
                            nestedScrollEnabled
                            accessibilityLabel="工具输入，可横向滚动"
                          >
                            <Text selectable style={s.code}>
                              {input.args}
                            </Text>
                          </ScrollView>
                        </View>
                      ) : null}
                      {output?.t === 'result' ? (
                        <Text selectable style={s.output}>
                          {output.output}
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
                {group.summary ? (
                  <View>
                    <Text style={s.label}>处理摘要</Text>
                    <Markdown text={group.summary} onLink={onLink} secondary />
                  </View>
                ) : null}
              </View>
            </View>
          ))}
          {hasSearch ? (
            <View style={s.group}>
              <Text
                style={s.label}
              >{`联网检索 · 检索词 ${queries.length} 个 · 来源 ${sources.length} 个`}</Text>
              <View style={s.indent}>
                {queries.length ? (
                  queries.map(q => (
                    <Text key={q} selectable style={s.label}>
                      {'检索词：' + q}
                    </Text>
                  ))
                ) : (
                  <Text style={s.label}>此处无新增检索词</Text>
                )}
                {sources.length ? (
                  sources.map(source => (
                    <Pressable
                      key={source.url}
                      style={s.source}
                      onPress={() => onLink(source.url)}
                      accessibilityRole="link"
                      accessibilityLabel={'打开来源：' + source.title}
                    >
                      <Text style={[s.label, s.link]}>{source.title}</Text>
                      <Text style={s.label}>{source.url}</Text>
                    </Pressable>
                  ))
                ) : (
                  <Text style={s.label}>此处无新增来源</Text>
                )}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  process: { marginBottom: 0 },
  toggle: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  label: { fontSize: 13, lineHeight: 20, color: c.secondary, flexShrink: 1 },
  current: {
    fontSize: 13,
    lineHeight: 20,
    color: c.secondary,
    paddingBottom: 8,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  details: {
    backgroundColor: c.paper,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  group: { gap: 8 },
  indent: { gap: 8 },
  toolDetail: { gap: 8 },
  inputCode: {
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 8,
    overflow: 'hidden',
  },
  code: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    lineHeight: 20,
    color: c.ink,
    padding: 8,
  },
  output: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    lineHeight: 20,
    color: c.secondary,
  },
  source: { minHeight: 48, justifyContent: 'center', gap: 4 },
  link: { textDecorationLine: 'underline' },
});
