/** 只提取实际返回的公开正文；思考、工具参数和加密字段不是回答。 */
import type { StoredMessage } from './types';

export const EMPTY_ANSWER_ERROR =
  '这条回复没有可显示的正文，请重试；若仍为空，请检查供应商协议或切换模型。';

export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(part => {
      if (part?.type === 'text' || part?.type === 'output_text') {
        return typeof part.text === 'string' ? part.text : '';
      }
      return part?.type === 'refusal' && typeof part.refusal === 'string'
        ? part.refusal
        : '';
    })
    .join('');
}

/** 中转服务的字符串 / text 块转换成可重放的 Responses 正文，保留其他原始字段。 */
export function normalizeResponseItem(item: any): any {
  if (item?.type !== 'message') return item;
  const content =
    typeof item.content === 'string'
      ? [{ type: 'output_text', text: item.content }]
      : Array.isArray(item.content)
      ? item.content.map((p: any) =>
          p?.type === 'text' ? { ...p, type: 'output_text' } : p,
        )
      : [];
  return { ...item, content };
}

/** 读旧记录时从尚存的 raw 恢复正文，不改写数据库，也不恢复或执行工具调用。 */
export function restoreAssistantText(message: StoredMessage): StoredMessage {
  if (
    message.role !== 'assistant' ||
    message.parts.some(
      p =>
        p.t === 'call' ||
        (p.t === 'text' && typeof p.text === 'string' && p.text.trim()),
    )
  )
    return message;
  const raw = message.raw;
  let text = message.parts
    .filter(p => p.t === 'text')
    .map(p => contentText(p.t === 'text' ? p.text : ''))
    .filter(Boolean)
    .join('\n');
  if (!text.trim() && Array.isArray(raw?.items)) {
    text =
      raw.protocol === 'anthropic'
        ? contentText(raw.items)
        : raw.items
            .filter(
              (item: any) =>
                raw.protocol === 'chat' || item?.type === 'message',
            )
            .map((item: any) => contentText(item?.content))
            .filter(Boolean)
            .join('\n');
  }
  if (text.trim()) {
    return {
      ...message,
      parts: [
        ...message.parts.filter(p => p.t !== 'text'),
        { t: 'text', text },
      ],
      raw:
        raw?.protocol === 'openai'
          ? { ...raw, items: raw.items.map(normalizeResponseItem) }
          : raw,
    };
  }
  return message.ui?.usage && !message.ui.error
    ? { ...message, ui: { ...message.ui, error: EMPTY_ANSWER_ERROR } }
    : message;
}
