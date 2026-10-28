/**
 * 数字溯源（AI_ASSISTANT §13.9）：回答里的数字（价格、金额、比例、日期）和本轮的工具结果、提问附带的上下文做匹配。
 * - 有来源：工具结果里有这个数（按回答的小数位四舍五入后相等；带「万 / 亿」时按倍数换算；带「约」时允许 3% 误差）；
 * - 算出来的：两个来源数字的差、和、涨跌幅（a ÷ b − 1）、倍数（a ÷ b）；
 * - 找不到来源：界面上用虚线标出来。
 * 不检查：列表序号、链接地址、证券代码以外的小整数（≤ 31 且不带单位，多半是「3 个原因」「第 2 步」）、计数（「5 只」「3 条」）。
 * 纯函数，界面渲染和回归评测共用。
 */

import type { StoredMessage } from './types';

export interface Source {
  label: string;
  text: string;
}

export type NumberStatus = 'source' | 'derived' | 'none';

export interface NumberRef {
  /** 回答里的原文（「39.50 元」里的「39.50」）。 */
  text: string;
  start: number;
  end: number;
  status: NumberStatus;
  /** 来源工具的标签；算出来的写「由 A、B 算出」。 */
  source?: string;
}

export interface Provenance {
  refs: NumberRef[];
  sourced: number;
  derived: number;
  missing: NumberRef[];
}

const DATE =
  /\d{4}-\d{1,2}-\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}:\d{2}(?::\d{2})?/y;
const NUM = /[-+−]?\d+(?:,\d{3})*(?:\.\d+)?/y;
const UNIT = /^\s?(%|％|‱|万|亿|元|倍|股|份|手|厘|分)/;
const COUNT =
  /^\s?(个|只|条|次|种|步|项|位|名|根|周|年|月|天|日|期|轮|张|笔|篇|页|行|档|类|课|轮)/;
const APPROX = /(约|大约|近|接近|超过|不到|左右|大概)\s?$/;

const toNum = (s: string) => Number(s.replace(/,/g, '').replace('−', '-'));
const decimalsOf = (s: string) => {
  const m = /\.(\d+)$/.exec(s.replace(/,/g, ''));
  return m ? m[1].length : 0;
};

/** 名字里带数字的指数（沪深300、中证1000、科创50 等），不是数据。 */
const INDEX_NAMES =
  /(上证|沪深|中证|深证|创业板|科创|北证|国证|中证A|恒生|标普|纳斯达克)\s?\d{2,4}/g;

/** 把链接地址、网址、指数名换成等长空格，位置不变。 */
function blank(text: string): string {
  return text
    .replace(/\]\(([^)\s]+)\)/g, m => ']' + ' '.repeat(m.length - 1))
    .replace(/https?:\/\/\S+/g, m => ' '.repeat(m.length))
    .replace(INDEX_NAMES, m => ' '.repeat(m.length));
}

interface Token {
  text: string;
  start: number;
  end: number;
  kind: 'date' | 'num';
  value: number;
  decimals: number;
  unit: string;
  approx: boolean;
}

/** 正文里要检查的数字。 */
export function numberTokens(text: string): Token[] {
  const src = blank(text);
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (!/[\d+\-−]/.test(ch) || (i > 0 && /[A-Za-z0-9_.]/.test(src[i - 1]))) {
      i++;
      continue;
    }
    DATE.lastIndex = i;
    const d = DATE.exec(src);
    if (d) {
      out.push({
        text: d[0],
        start: i,
        end: i + d[0].length,
        kind: 'date',
        value: 0,
        decimals: 0,
        unit: '',
        approx: false,
      });
      i += d[0].length;
      continue;
    }
    NUM.lastIndex = i;
    const m = NUM.exec(src);
    if (!m || !/\d/.test(m[0])) {
      i++;
      continue;
    }
    const end = i + m[0].length;
    if (/[A-Za-z_]/.test(src[end] ?? '')) {
      i = end;
      continue;
    }
    const rest = src.slice(end, end + 3);
    const unit = UNIT.exec(rest)?.[1] ?? '';
    const lineStart = src.lastIndexOf('\n', i - 1) + 1;
    const before = src.slice(lineStart, i);
    const isMarker = /^\s*$/.test(before) && /^[.)、]/.test(src[end] ?? '');
    const value = toNum(m[0]);
    const decimals = decimalsOf(m[0]);
    const small = !unit && decimals === 0 && Math.abs(value) <= 31;
    const counted = !unit && decimals === 0 && COUNT.test(rest);
    if (!isMarker && !small && !counted) {
      out.push({
        text: m[0],
        start: i,
        end,
        kind: 'num',
        value,
        decimals,
        unit,
        approx: APPROX.test(src.slice(Math.max(0, i - 4), i)),
      });
    }
    i = end;
  }
  return out;
}

interface Pool {
  /** 排好序的来源数字和它们的来源。 */
  vals: number[];
  labels: string[];
  texts: string[];
}

function poolOf(sources: Source[]): Pool {
  const pairs: [number, string][] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    for (const m of s.text.matchAll(/[-+−]?\d+(?:,\d{3})*(?:\.\d+)?/g)) {
      const v = toNum(m[0]);
      const key = v + '|' + s.label;
      if (!Number.isFinite(v) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      pairs.push([v, s.label]);
    }
  }
  pairs.sort((a, b) => a[0] - b[0]);
  return {
    vals: pairs.map(p => p[0]),
    labels: pairs.map(p => p[1]),
    texts: sources.map(s => s.text),
  };
}

/** 有没有落在 [lo, hi] 里的来源数字；返回下标。 */
function findIn(p: Pool, lo: number, hi: number): number {
  let a = 0;
  let b = p.vals.length;
  while (a < b) {
    const mid = Math.floor((a + b) / 2);
    if (p.vals[mid] < lo) {
      a = mid + 1;
    } else {
      b = mid;
    }
  }
  return a < p.vals.length && p.vals[a] <= hi ? a : -1;
}

/** 回答的数字对应的取值范围（考虑四舍五入和「约」）。 */
function range(t: Token, scale = 1): [number, number] {
  const half = 0.5 * Math.pow(10, -t.decimals);
  const v = Math.abs(t.value);
  let lo = (v - half) * scale;
  let hi = (v + half) * scale;
  if (t.approx) {
    lo = Math.min(lo, v * scale * 0.97);
    hi = Math.max(hi, v * scale * 1.03);
  }
  return [lo, hi];
}

function direct(p: Pool, t: Token): string | null {
  const scales =
    t.unit === '万'
      ? [1e4, 1, 1e4 * 100]
      : t.unit === '亿'
      ? [1e8, 1, 1e4, 1e8 * 100]
      : t.unit === '%' || t.unit === '％'
      ? [1, 0.01]
      : t.unit === '元'
      ? [1, 100, 1000]
      : [1];
  for (const sc of scales) {
    const [lo, hi] = range(t, sc);
    for (const [a, b] of [
      [lo, hi],
      [-hi, -lo],
    ]) {
      const k = findIn(p, a, b);
      if (k >= 0) {
        return p.labels[k];
      }
    }
  }
  return null;
}

/**
 * 由两个来源数字算出来：差、和、涨跌幅、倍数。其中一个必须是回答里已经有来源的数字（「从 39.5 涨到 41.2，涨了 4.3%」），
 * 否则 K 线这类上千个数字两两组合，几乎什么数都能凑出来；来源数字不超过 200 个时才两两都试。
 */
function derived(p: Pool, t: Token, anchors: number[]): string | null {
  const [lo, hi] = range(t);
  const pct = t.unit === '%' || t.unit === '％';
  const bases =
    p.vals.length <= 200
      ? p.vals.map((v, j) => ({ v, j }))
      : anchors.map(v => ({ v, j: findIn(p, v, v) })).filter(x => x.j >= 0);
  for (const { v: b, j } of bases) {
    if (b === 0) {
      continue;
    }
    const tries: [number, number][] = pct
      ? [
          // (a / b − 1) × 100 = ±v
          [b * (1 + lo / 100), b * (1 + hi / 100)],
          [b * (1 - hi / 100), b * (1 - lo / 100)],
          // a / b × 100 = v（占比）
          [(b * lo) / 100, (b * hi) / 100],
          // (b / a − 1) × 100 = ±v
          [b / (1 + hi / 100), b / (1 + lo / 100)],
          [b / (1 - lo / 100), b / (1 - hi / 100)],
        ]
      : [
          [b + lo, b + hi],
          [b - hi, b - lo],
          [lo - b, hi - b],
          // a × b = v（成交额 = 价格 × 数量）、a ÷ b = v（倍数）
          [lo / b, hi / b],
          [b * lo, b * hi],
        ];
    for (const [x, y] of tries) {
      const [a1, a2] = x < y ? [x, y] : [y, x];
      const k = findIn(p, a1, a2);
      if (k >= 0 && p.vals[k] !== b) {
        return '由「' + p.labels[k] + '」和「' + p.labels[j] + '」算出';
      }
    }
  }
  return null;
}

export function traceNumbers(answer: string, sources: Source[]): Provenance {
  const p = poolOf(sources);
  const tokens = numberTokens(answer);
  // 先找直接有来源的，作为「算出来」的操作数
  const hits = tokens.map(t => (t.kind === 'num' ? direct(p, t) : null));
  const anchors = tokens
    .filter((t, i) => hits[i] && t.kind === 'num')
    .flatMap(t => {
      const k = findIn(p, ...range(t));
      return k >= 0 ? [p.vals[k]] : [];
    });
  const refs: NumberRef[] = tokens.map((t, i) => {
    if (t.kind === 'date') {
      const norm = t.text
        .replace(/年|月/g, '-')
        .replace('日', '')
        .replace(/-(\d)(?=-|$)/g, '-0$1');
      const s = sources.find(
        x => x.text.includes(t.text) || x.text.includes(norm),
      );
      return {
        text: t.text,
        start: t.start,
        end: t.end,
        status: s ? 'source' : 'none',
        source: s?.label,
      };
    }
    const d = hits[i];
    if (d) {
      return {
        text: t.text,
        start: t.start,
        end: t.end,
        status: 'source',
        source: d,
      };
    }
    const x = derived(p, t, anchors);
    return x
      ? {
          text: t.text,
          start: t.start,
          end: t.end,
          status: 'derived',
          source: x,
        }
      : { text: t.text, start: t.start, end: t.end, status: 'none' };
  });
  return {
    refs,
    sourced: refs.filter(r => r.status === 'source').length,
    derived: refs.filter(r => r.status === 'derived').length,
    missing: refs.filter(r => r.status === 'none'),
  };
}

/** 把一段文字按「找不到来源的数字」切开，界面给这些数字加虚线。 */
export function splitMissing(
  text: string,
  missing: Set<string>,
): { text: string; missing: boolean }[] {
  if (!missing.size) {
    return [{ text, missing: false }];
  }
  const out: { text: string; missing: boolean }[] = [];
  let last = 0;
  for (const t of numberTokens(text)) {
    if (!missing.has(t.text)) {
      continue;
    }
    if (t.start > last) {
      out.push({ text: text.slice(last, t.start), missing: false });
    }
    out.push({ text: t.text, missing: true });
    last = t.end;
  }
  if (last < text.length) {
    out.push({ text: text.slice(last), missing: false });
  }
  return out;
}

/** 一轮问答的来源：提问附带的上下文（页面、最近操作、简报数据）和这一轮每个工具的结果。 */
export function turnSources(
  question: StoredMessage | null,
  answer: StoredMessage[],
): Source[] {
  const out: Source[] = [];
  if (question) {
    out.push({
      label: '提问附带的上下文',
      text: question.parts.map(p => (p.t === 'text' ? p.text : '')).join('\n'),
    });
  }
  for (const m of answer) {
    if (m.role !== 'tool') {
      continue;
    }
    for (const p of m.parts) {
      if (p.t === 'result') {
        out.push({
          label: m.ui?.tools?.find(t => t.id === p.id)?.label ?? p.name,
          text: p.output,
        });
      }
    }
  }
  return out;
}

/** 这一轮最后的回答正文。 */
export const answerText = (answer: StoredMessage[]): string => {
  const last = [...answer].reverse().find(m => m.role === 'assistant');
  return last
    ? last.parts.map(p => (p.t === 'text' ? p.text : '')).join('\n')
    : '';
};
