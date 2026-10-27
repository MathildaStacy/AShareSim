/**
 * AI 回答的简单排版（M4 界面清单「AI 的回答（加粗、列表、表格的简单排版）」）：段落、标题、列表、表格、
 * 代码块、加粗、行内代码、链接。链接里 lesson:fee 打开规则课，stock:sh600036 打开个股（§系统提示）。
 */

export type MdInline =
  | { t: 'text'; text: string }
  | { t: 'bold'; text: string }
  | { t: 'code'; text: string }
  | { t: 'link'; text: string; href: string };

export type MdBlock =
  | { t: 'p'; inl: MdInline[] }
  | { t: 'h'; level: number; inl: MdInline[] }
  | { t: 'quote'; inl: MdInline[] }
  | { t: 'li'; marker: string; depth: number; inl: MdInline[] }
  | { t: 'table'; rows: MdInline[][][] }
  | { t: 'code'; text: string }
  | { t: 'hr' };

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) {
      out.push({ t: 'text', text: text.slice(last, m.index) });
    }
    if (m[1] != null) {
      out.push({ t: 'bold', text: m[1] });
    } else if (m[2] != null) {
      out.push({ t: 'code', text: m[2] });
    } else {
      out.push({ t: 'link', text: m[3], href: m[4] });
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) {
    out.push({ t: 'text', text: text.slice(last) });
  }
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(c => parseInline(c.trim()));

export function parseMarkdown(text: string): MdBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      out.push({ t: 'p', inl: parseInline(para.join('\n')) });
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) {
        code.push(lines[i]);
      }
      out.push({ t: 'code', text: code.join('\n') });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      out.push({ t: 'h', level: h[1].length, inl: parseInline(h[2]) });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flush();
      const quote: string[] = [];
      for (; i < lines.length && /^\s*>\s?/.test(lines[i]); i++) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
      }
      i--;
      out.push({ t: 'quote', inl: parseInline(quote.join('\n')) });
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flush();
      out.push({ t: 'hr' });
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      out.push({
        t: 'li',
        marker: /\d/.test(li[2]) ? li[2].replace(')', '.') : '•',
        depth: Math.min(2, Math.floor(li[1].replace(/\t/g, '  ').length / 2)),
        inl: parseInline(li[3]),
      });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush();
      const rows: MdInline[][][] = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) {
        // 跳过表头下面的分隔行 |---|:--:|
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) {
          rows.push(cells(lines[i]));
        }
      }
      i--;
      out.push({ t: 'table', rows });
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}
