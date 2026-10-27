/** 只呈现供应商实际返回的思考摘要、检索过程与来源；加密推理不能当作可见正文。 */
import type { ModelProgress, Protocol, SearchTrace } from './types';

export const emptySearch = (): SearchTrace => ({
  queries: [],
  sources: [],
  citations: [],
});
export function combineSearch(
  a?: SearchTrace,
  b?: SearchTrace,
): SearchTrace | undefined {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  const out: SearchTrace = {
    queries: [...new Set([...a.queries, ...b.queries])],
    sources: [...a.sources],
    citations: [...a.citations],
    calls: (a.calls ?? 0) + (b.calls ?? 0),
  };
  const map = b.sources.map(s => {
    let i = out.sources.findIndex(x => x.url === s.url);
    if (i < 0) {
      i = out.sources.length;
      out.sources.push(s);
    }
    return i;
  });
  out.citations.push(
    ...b.citations.map(c => ({ ...c, source: map[c.source] })),
  );
  return out;
}

export function evidenceOf(protocol: Protocol, json: any): ModelProgress {
  const search = emptySearch();
  let thinking = '';
  let offset = 0;
  const query = (q: any) => {
    if (typeof q === 'string' && q && !search.queries.includes(q)) {
      search.queries.push(q);
    }
  };
  const source = (s: any): number => {
    const url = s?.url ?? s?.link ?? s?.href;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return -1;
    }
    let i = search.sources.findIndex(x => x.url === url);
    if (i < 0) {
      i = search.sources.length;
      search.sources.push({
        url,
        title: String(s.title ?? s.name ?? url),
        ...(typeof s.snippet === 'string' ? { snippet: s.snippet } : {}),
      });
    }
    return i;
  };
  const annotations = (a: any[], text: string) => {
    for (const entry of a ?? []) {
      const v = entry.url_citation ?? entry;
      const i = source(v);
      if (i >= 0) {
        search.citations.push({
          source: i,
          end:
            offset +
            (typeof v.end_index === 'number'
              ? Math.max(0, Math.min(text.length, v.end_index))
              : text.length),
        });
      }
    }
  };
  if (protocol === 'anthropic') {
    for (const b of json?.content ?? []) {
      if (b.type === 'thinking' && typeof b.thinking === 'string') {
        thinking += b.thinking;
      }
      if (b.type === 'server_tool_use' && b.name === 'web_search') {
        query(b.input?.query);
        search.calls = (search.calls ?? 0) + 1;
      }
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        b.content.forEach(source);
      }
      if (b.type === 'text') {
        const text = String(b.text ?? '');
        annotations(b.citations, text);
        offset += text.length + 1;
      }
    }
    const calls = json?.usage?.server_tool_use?.web_search_requests;
    if (typeof calls === 'number') {
      search.calls = calls;
    }
  } else if (protocol === 'openai') {
    for (const item of json?.output ?? []) {
      if (item.type === 'reasoning') {
        thinking += (item.summary ?? [])
          .map((s: any) => (s.type === 'summary_text' ? s.text : ''))
          .join('\n');
      }
      if (item.type === 'web_search_call') {
        search.calls = (search.calls ?? 0) + 1;
        query(item.action?.query);
        (item.action?.queries ?? []).forEach(query);
        (item.action?.sources ?? []).forEach(source);
      }
      if (item.type === 'message') {
        for (const c of item.content ?? []) {
          if (c.type === 'output_text') {
            const text = String(c.text ?? '');
            annotations(c.annotations, text);
            offset += text.length;
          }
        }
        offset++;
      }
    }
  } else {
    const m = json?.choices?.[0]?.message ?? {};
    thinking =
      typeof m.reasoning_content === 'string'
        ? m.reasoning_content
        : typeof m.reasoning === 'string'
        ? m.reasoning
        : '';
    const text = typeof m.content === 'string' ? m.content : '';
    annotations(m.annotations ?? [], text);
    for (const results of [
      json?.web_search,
      m.web_search,
      json?.search_results,
      m.search_results,
      json?.search_info?.search_results,
      json?.search_info?.results,
    ]) {
      if (Array.isArray(results)) {
        for (const r of results) {
          source(r);
          query(r.search_query ?? r.query);
        }
      }
    }
    query(json?.search_info?.search_query);
    if (search.sources.length) {
      search.calls =
        typeof json?.usage?.web_search_requests === 'number'
          ? json.usage.web_search_requests
          : undefined;
    }
  }
  return {
    ...(thinking ? { thinking } : {}),
    ...(search.calls || search.sources.length || search.queries.length
      ? { search }
      : {}),
  };
}

export function citedText(text: string, search?: SearchTrace): string {
  if (!search?.sources.length) {
    return text;
  }
  if (search.citations.length) {
    const positions = [
      ...new Map(
        search.citations
          .filter(c => search.sources[c.source])
          .map(c => [c.end + ':' + c.source, c]),
      ).values(),
    ].sort((a, b) => b.end - a.end || b.source - a.source);
    for (const c of positions) {
      let at = Math.min(text.length, Math.max(0, c.end));
      // 部分接口的区间包含段落末尾换行，引用应贴在句尾，避免变成下一段的孤立数字。
      while (at > 0 && /\s/.test(text[at - 1])) {
        at--;
      }
      text =
        text.slice(0, at) +
        '[' +
        (c.source + 1) +
        '](source:' +
        c.source +
        ')' +
        text.slice(at);
    }
    return text.replace(/cite[^]*/g, '');
  }
  text = text.replace(/\[\d+\]\((https?:\/\/[^\s)]+)\)/g, (match, url) => {
    const index = search.sources.findIndex(s => s.url === url);
    return index < 0 ? match : '[' + (index + 1) + '](source:' + index + ')';
  });
  return text.replace(/\[(?:\^)?(\d+)(?:\^)?\](?!\()/g, (match, n) =>
    search.sources[Number(n) - 1]
      ? '[' + n + '](source:' + (Number(n) - 1) + ')'
      : match,
  );
}
