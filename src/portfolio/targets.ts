import type { TargetFile } from './types';

/** v1：权重为 0–1 的小数（CSV 也接受 %），股数为非负整数。目标是整个账户，未列出的持仓目标为 0。 */
export const TARGET_CSV =
  'version,1\ncode,weight\nsh510300,30%\nsz159915,20%\n';
export function normalizeCode(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (/^(sh|sz)\d{6}$/.test(s)) {
    return s;
  }
  if (/^[056123]\d{5}$/.test(s)) {
    return (/^[56]/.test(s) ? 'sh' : 'sz') + s;
  }
  throw new Error('证券代码无效：' + raw);
}
export function parseTargets(text: string): TargetFile {
  const raw = text.replace(/^\uFEFF/, '').trim();
  let obj: unknown;
  if (raw.startsWith('{')) {
    try {
      obj = JSON.parse(raw);
    } catch {
      throw new Error('JSON 格式有误');
    }
  } else {
    const lines = raw
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);
    if (lines.shift()?.replace(/\s/g, '') !== 'version,1') {
      throw new Error('CSV 首行需为 version,1');
    }
    const header = lines.shift()?.replace(/\s/g, '');
    const mode =
      header === 'code,weight' || header === '代码,目标权重'
        ? 'weight'
        : header === 'code,shares' || header === '代码,目标股数'
        ? 'shares'
        : null;
    if (!mode) {
      throw new Error('表头需为 code,weight 或 code,shares');
    }
    obj = {
      version: 1,
      mode,
      targets: lines.map((l, i) => {
        const cells = l.split(',').map(c => c.trim().replace(/^"(.*)"$/, '$1'));
        if (cells.length !== 2 || !cells[1]) {
          throw new Error(`第 ${i + 3} 行需要代码和数值`);
        }
        const percent = cells[1].endsWith('%');
        if (percent && mode !== 'weight') {
          throw new Error('股数不能用百分比');
        }
        return {
          code: cells[0],
          value:
            Number(percent ? cells[1].slice(0, -1) : cells[1]) /
            (percent ? 100 : 1),
        };
      }),
    };
  }
  if (!obj || typeof obj !== 'object') {
    throw new Error('需要目标组合对象');
  }
  const f = obj as TargetFile;
  if (
    f.version !== 1 ||
    !['weight', 'shares'].includes(f.mode) ||
    !Array.isArray(f.targets) ||
    !f.targets.length
  ) {
    throw new Error('需要 version:1、mode:weight/shares 和非空 targets 数组');
  }
  const seen = new Set<string>();
  const targets = f.targets.map((r, i) => {
    if (
      !r ||
      typeof r.code !== 'string' ||
      typeof r.value !== 'number' ||
      !Number.isFinite(r.value) ||
      r.value < 0 ||
      (f.mode === 'shares' && !Number.isSafeInteger(r.value)) ||
      (f.mode === 'weight' && r.value > 1)
    ) {
      throw new Error(`第 ${i + 1} 项无效：权重为 0–1，股数为非负整数`);
    }
    const code = normalizeCode(r.code);
    if (seen.has(code)) {
      throw new Error('代码重复：' + code);
    }
    seen.add(code);
    return { code, value: r.value };
  });
  if (
    f.mode === 'weight' &&
    targets.reduce((n, r) => n + r.value, 0) > 1 + 1e-9
  ) {
    throw new Error('目标权重合计不能超过 100%');
  }
  return { version: 1, mode: f.mode, targets };
}
