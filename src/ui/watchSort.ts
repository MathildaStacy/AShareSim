/** 自选列表排序：默认按拖动的顺序；点表头在「降序 → 升序 → 默认」之间切换。 */
export type SortKey = 'price' | 'pct';
export interface WatchSort {
  key: SortKey | null;
  dir: 'desc' | 'asc';
}

export const DEFAULT_SORT: WatchSort = { key: null, dir: 'desc' };

export function nextSort(cur: WatchSort, key: SortKey): WatchSort {
  if (cur.key !== key) {
    return { key, dir: 'desc' };
  }
  return cur.dir === 'desc' ? { key, dir: 'asc' } : DEFAULT_SORT;
}

/** 没有行情的排在最后，保持原顺序。 */
export function sortCodes(
  codes: string[],
  sort: WatchSort,
  valueOf: (code: string, key: SortKey) => number | null,
): string[] {
  if (!sort.key) {
    return codes;
  }
  const key = sort.key;
  const sign = sort.dir === 'desc' ? -1 : 1;
  return codes
    .map((code, i) => ({ code, i, v: valueOf(code, key) }))
    .sort((a, b) => {
      if (a.v == null || b.v == null) {
        return a.v == null && b.v == null ? a.i - b.i : a.v == null ? 1 : -1;
      }
      return a.v === b.v ? a.i - b.i : sign * (a.v - b.v);
    })
    .map(x => x.code);
}

/** 把 from 位置的代码移到 to 位置（拖动排序）。 */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) {
    return list;
  }
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, x);
  return out;
}
