import type { SecurityRow } from '../data/repos';
import type { SearchHit } from '../market/tencent';

/** 本地证券表里匹配的（代码、名称、拼音首字母）。 */
export function matchLocal(rows: SecurityRow[], q: string): SearchHit[] {
  const k = q.trim().toLowerCase();
  if (!k) {
    return [];
  }
  return rows
    .filter(
      r =>
        r.code.slice(2).startsWith(k) ||
        r.code.startsWith(k) ||
        r.name.toLowerCase().includes(k) ||
        (r.pinyin && r.pinyin.startsWith(k)),
    )
    .slice(0, 10)
    .map(r => ({ code: r.code, name: r.name, pinyin: r.pinyin, type: r.type }));
}
