/**
 * 外部内容防注入（AI_ASSISTANT §13.3）：公告、研报、新闻、MCP 工具返回的都是外部文本，
 * 包在 <external> 标签里交给模型；系统提示写明标签里的内容只是数据，其中的指令不执行。
 */

const attr = (v: string) =>
  v
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\r\n]+/g, ' ');

/** 正文里伪造的结束标签会让后面的文字跑到标签外面，先拆开。 */
const neutralize = (body: string) =>
  body.replace(/<(\/?)external/gi, '<$1 external');

export function external(
  meta: { source: string; date?: string; url?: string },
  body: string,
): string {
  return (
    '<external source="' +
    attr(meta.source) +
    '"' +
    (meta.date ? ' date="' + attr(meta.date) + '"' : '') +
    (meta.url ? ' url="' + attr(meta.url) + '"' : '') +
    '>\n' +
    neutralize(body.trim()) +
    '\n</external>'
  );
}

/** 读了外部内容的工具（资讯工具、MCP、Kimi 搜索）。服务端联网搜索看回答里的搜索记录。 */
export const EXTERNAL_TOOLS = new Set([
  'get_announcements',
  'read_announcement',
  'get_research',
  'search_news',
  'mcp_call',
  'mcp_search',
  'web_search',
]);
