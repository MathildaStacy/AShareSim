/**
 * 资讯工具（AI_ASSISTANT §13.2）：东方财富的公告、公告正文、研报、新闻。
 * 每条都带发布日期和链接；都支持 as_of，只返回这天及以前发布的内容（复盘、回放时不用到「当时还不知道的消息」）。
 * 外部文本包在 <external> 里（§13.3）。
 */
import type { AppCore } from '../../app/boot';
import { beijingNow } from '../../market/clock';
import { ANN_TYPES, annPageUrl, researchPageUrl } from '../../market/emNews';
import { external } from '../external';
import type { Resolved } from './read';

/** as_of：YYYY-MM-DD，不给时是今天（北京时间）。 */
export function asOfOf(v: unknown): string {
  if (v == null || v === '') {
    return beijingNow().date;
  }
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error('as_of 要写成 YYYY-MM-DD，例如 2026-03-31');
  }
  const d = new Date(s + 'T00:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new Error('as_of 不是有效的日期');
  }
  return s;
}

const range = (dates: string[]) => {
  const ds = dates.filter(Boolean).sort();
  return ds.length
    ? ds[0] === ds[ds.length - 1]
      ? ds[0]
      : ds[0] + '~' + ds[ds.length - 1]
    : '';
};

export async function announcementsText(
  core: AppCore,
  r: Resolved,
  n: number,
  type: string,
  asOf: string,
): Promise<string> {
  const t = ANN_TYPES[type] ? type : 'all';
  const { total, items } = await core.client.announcements(r.code, n, t, asOf);
  const head =
    r.name +
    '（' +
    r.code +
    '）' +
    (t === 'all' ? '' : ANN_TYPES[t].label) +
    '公告，截至 ' +
    asOf +
    ' 共 ' +
    total +
    ' 条';
  if (!items.length) {
    return head + '。ETF、指数没有公告；也可能这段时间没有这类公告。';
  }
  return [
    head +
      '，最近 ' +
      items.length +
      ' 条（日期 [分类] 标题 | art_code | 链接）：',
    external(
      { source: '东方财富·公告列表', date: range(items.map(i => i.date)) },
      items
        .map(
          i =>
            i.date +
            ' [' +
            i.category +
            '] ' +
            i.title +
            ' | ' +
            i.artCode +
            ' | ' +
            annPageUrl(r.code.slice(2), i.artCode),
        )
        .join('\n'),
    ),
    '读正文用 read_announcement(art_code)。',
  ].join('\n');
}

/** 一页最多给模型多少字（接口每页约 5,000 字，压缩空白后通常更少）。 */
export const ANN_PAGE_CHARS = 6000;

export async function announcementBody(
  core: AppCore,
  artCode: string,
  page: number,
  asOf: string | null,
): Promise<{ output: string; title: string }> {
  if (!/^[A-Z]{2}\d{10,}$/.test(artCode)) {
    throw new Error(
      'art_code 不对（应该像 AN202610231830844845），先用 get_announcements 查',
    );
  }
  const a = await core.client.announcementText(artCode, page);
  if (!a.title && !a.text && !a.pdf) {
    throw new Error('没有找到公告 ' + artCode);
  }
  if (asOf && !a.date) {
    throw new Error('公告缺少发布日期，无法按 as_of 核验');
  }
  if (asOf && a.date && a.date > asOf) {
    return {
      title: '超出截止日期的公告',
      output:
        '这条公告发布于 ' +
        a.date +
        '，晚于 as_of（' +
        asOf +
        '），按要求不读取。',
    };
  }
  if (!a.pages || !a.text) {
    return {
      title: a.title,
      output: external(
        { source: '东方财富·公告', date: a.date },
        '「' +
          a.title +
          '」（' +
          a.date +
          '）没有文本版（年报、半年报全文这类大文件只有 PDF）：' +
          a.pdf +
          '。可以改读它的摘要公告，或用 get_financials 查主要财务指标。',
      ),
    };
  }
  if (page > a.pages) {
    throw new Error('这条公告只有 ' + a.pages + ' 页');
  }
  const cut = a.text.length > ANN_PAGE_CHARS;
  return {
    title: a.title,
    output: [
      '公告 ' +
        artCode +
        '，' +
        a.date +
        '，第 ' +
        page +
        '/' +
        a.pages +
        ' 页',
      external(
        { source: '东方财富·公告正文', date: a.date, url: a.pdf },
        '标题：' +
          a.title +
          '\n' +
          (cut ? a.text.slice(0, ANN_PAGE_CHARS) + '\n…（本页截断）' : a.text),
      ),
      page < a.pages
        ? '还有 ' +
          (a.pages - page) +
          ' 页，用 page=' +
          (page + 1) +
          ' 继续读。'
        : '已读完。',
    ].join('\n'),
  };
}

const fx = (v: number | null) => (v == null ? '—' : v.toFixed(2));

export async function researchText(
  core: AppCore,
  r: Resolved,
  n: number,
  asOf: string,
): Promise<string> {
  const { total, year, items } = await core.client.research(r.code, n, asOf);
  if (!items.length) {
    return (
      r.name +
      '（' +
      r.code +
      '）截至 ' +
      asOf +
      ' 的近 2 年没有个股研报（ETF、指数没有）。'
    );
  }
  const ys = [year, year + 1, year + 2].map(y => y + 'E').join('/');
  return [
    r.name +
      ' 个股研报，截至 ' +
      asOf +
      ' 近 2 年共 ' +
      total +
      ' 篇，最近 ' +
      items.length +
      ' 篇。EPS（元）和 PE 是机构对 ' +
      ys +
      ' 的预测，没有覆盖的年份是「—」。',
    external(
      { source: '东方财富·研报', date: range(items.map(i => i.date)) },
      items
        .map(
          i =>
            i.date +
            ' ' +
            i.org +
            ' 评级 ' +
            (i.rating || '—') +
            (i.emRating && i.emRating !== i.rating
              ? '（归一：' + i.emRating + '）'
              : '') +
            ' 《' +
            i.title +
            '》 EPS ' +
            i.eps.map(fx).join('/') +
            ' PE ' +
            i.pe.map(fx).join('/') +
            ' | ' +
            researchPageUrl(i.infoCode),
        )
        .join('\n'),
    ),
  ].join('\n');
}

export async function newsText(
  core: AppCore,
  keyword: string,
  n: number,
  asOf: string | null,
): Promise<string> {
  // 截止日期在本地过滤：多取一些
  const { items } = await core.client.news(keyword, asOf ? 50 : n);
  const kept = (
    asOf
      ? items.filter(
          i => /^\d{4}-\d{2}-\d{2}/.test(i.time) && i.time.slice(0, 10) <= asOf,
        )
      : items
  )
    .sort((a, b) => b.time.localeCompare(a.time))
    .slice(0, n);
  if (!kept.length) {
    return (
      '东方财富新闻里没有找到「' +
      keyword +
      '」' +
      (asOf ? '在 ' + asOf + ' 及以前' : '') +
      '的相关新闻。'
    );
  }
  return [
    '「' +
      keyword +
      '」相关新闻 ' +
      kept.length +
      ' 条（按时间从新到旧；搜索按相关度召回，不保证全）：',
    external(
      {
        source: '东方财富·新闻搜索',
        date: range(kept.map(i => i.time.slice(0, 10))),
      },
      kept
        .map(
          i =>
            i.time +
            ' ' +
            i.media +
            '《' +
            i.title +
            '》' +
            (i.summary ? i.summary.slice(0, 160) : '') +
            ' | ' +
            i.url,
        )
        .join('\n'),
    ),
  ].join('\n');
}
