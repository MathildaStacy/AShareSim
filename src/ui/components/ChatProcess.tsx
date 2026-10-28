/** 一轮回答的辅助过程。只消费已有消息，不改变请求或工具执行。 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import type { StoredMessage, SearchSource, ToolUi } from '../../ai/types';
import { aiColor as c } from '../aiTheme';
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
    tools.length ? `工具记录 ${tools.length} 项` : '',
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
        <Text style={s.label}>处理过程{counts ? ' · ' + counts : ''}</Text>
        <Text style={s.action}>{expanded ? '收起' : '展开'}</Text>
        {expanded ? (
          <ChevronUp size={16} color={c.secondary} />
        ) : (
          <ChevronDown size={16} color={c.secondary} />
        )}
      </Pressable>
      {busy ? (
        <View style={s.current} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={c.accent} />
          <Text style={s.label}>{'进行中 · ' + busy}</Text>
        </View>
      ) : null}
      {expanded ? (
        <View style={s.details} testID="process-details">
          {groups.map((group, index) => (
            <View key={group.id} style={s.group}>
              <Text style={s.label}>{`步骤 ${index + 1}`}</Text>
              <View style={s.indent}>
                {group.tools.map(tool => (
                  <Text key={tool.id} selectable style={s.label}>
                    {toolStatus(tool) + ' · ' + tool.label}
                  </Text>
                ))}
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
                  <Text style={s.label}>接口未提供检索词</Text>
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
                  <Text style={s.label}>接口未提供来源</Text>
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
  process: { marginBottom: 8 },
  toggle: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 13, lineHeight: 20, color: c.secondary, flexShrink: 1 },
  action: {
    fontSize: 13,
    lineHeight: 20,
    color: c.secondary,
    marginLeft: 'auto',
  },
  current: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
  },
  details: { paddingTop: 8, paddingBottom: 8, gap: 16 },
  group: { gap: 8 },
  indent: { paddingLeft: 16, gap: 8 },
  source: { minHeight: 48, justifyContent: 'center', gap: 4 },
  link: { textDecorationLine: 'underline' },
});
