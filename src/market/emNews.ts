/**
 * 东方财富资讯：公告列表、公告正文、研报、新闻（AI 的资讯工具，M4.1，AI_ASSISTANT §13.2）。
 * 都是非官方网页接口，2026-10-27 用招商银行（600036）核对过格式，测试里有快照；
 * 格式变了解析不出来时抛出明确的错误，不让模型去猜。
 *
 * - 公告列表 `np-anotice-stock…/api/security/ann`：`f_node` 是大类（见 ANN_TYPES），`end_time` 截止日期。
 *   ETF、指数没有公告（返回 0 条）。
 * - 公告正文 `np-cnotice-stock…/api/content/ann`：纯文本按接口分页，每页约 5,000 字，`page_size` 是总页数；
 *   年报、半年报全文这类大文件没有文本（`page_size` 0），只能给 PDF 链接。
 * - 研报 `reportapi…/report/list`：按发布日期筛，带机构评级和今年 / 明年 / 后年的 EPS、PE 预测。
 * - 新闻 `search-api-web…/search/jsonp`（类型 cmsArticleWebOld）：按相关度排，没有日期参数，
 *   截止日期在本地过滤。
 */

export const ANN_TYPES: Record<string, { node: number; label: string }> = {
  all: { node: 0, label: '全部' },
  report: { node: 1, label: '财务报告' },
  financing: { node: 2, label: '融资公告' },
  risk: { node: 3, label: '风险提示' },
  info: { node: 4, label: '信息变更' },
  major: { node: 5, label: '重大事项' },
  restructure: { node: 6, label: '资产重组' },
  holding: { node: 7, label: '持股变动' },
};

export function annListUrl(
  code6: string,
  n: number,
  type = 'all',
  asOf?: string,
): string {
  return (
    'https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=' +
    n +
    '&page_index=1&ann_type=A&client_source=web&stock_list=' +
    code6 +
    '&f_node=' +
    (ANN_TYPES[type]?.node ?? 0) +
    '&s_node=0' +
    (asOf ? '&end_time=' + asOf : '')
  );
}

export const annContentUrl = (artCode: string, page: number) =>
  'https://np-cnotice-stock.eastmoney.com/api/content/ann?art_code=' +
  encodeURIComponent(artCode) +
  '&client_source=web&page_index=' +
  page;

/** 公告详情页（给人看的链接）。 */
export const annPageUrl = (code6: string, artCode: string) =>
  'https://data.eastmoney.com/notices/detail/' +
  code6 +
  '/' +
  artCode +
  '.html';

export function researchUrl(code6: string, n: number, asOf: string): string {
  // 默认看最近 2 年
  const begin = String(Number(asOf.slice(0, 4)) - 2) + asOf.slice(4);
  return (
    'https://reportapi.eastmoney.com/report/list?industryCode=*&pageSize=' +
    n +
    '&industry=*&rating=*&ratingChange=*&beginTime=' +
    begin +
    '&endTime=' +
    asOf +
    '&pageNo=1&fields=&qType=0&orgCode=&code=' +
    code6 +
    '&rcode='
  );
}

export const researchPageUrl = (infoCode: string) =>
  'https://data.eastmoney.com/report/info/' + infoCode + '.html';

export function newsUrl(keyword: string, n: number): string {
  const param = {
    uid: '',
    keyword,
    type: ['cmsArticleWebOld'],
    client: 'web',
    clientType: 'web',
    clientVersion: 'curr',
    param: {
      cmsArticleWebOld: {
        searchScope: 'default',
        sort: 'default',
        pageIndex: 1,
        pageSize: n,
        preTag: '',
        postTag: '',
      },
    },
  };
  return (
    'https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=' +
    encodeURIComponent(JSON.stringify(param))
  );
}

// ---------- 解析 ----------

export class FeedFormatError extends Error {}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const requiredText = (v: unknown, field: string): string => {
  const value = str(v);
  if (!value) {
    throw new FeedFormatError('资讯接口缺少有效字段：' + field);
  }
  return value;
};
const day = (v: unknown, field: string): string => {
  const s = requiredText(v, field);
  const value = /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
  const d = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new FeedFormatError('资讯接口日期格式异常：' + field);
  }
  return value;
};
const integer = (v: unknown, field: string, min = 0): number => {
  const value =
    typeof v === 'number' ? v : /^\d+$/.test(str(v)) ? Number(v) : NaN;
  if (!Number.isSafeInteger(value) || value < min) {
    throw new FeedFormatError('资讯接口数字格式异常：' + field);
  }
  return value;
};
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : str(v) ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export interface Announcement {
  artCode: string;
  title: string;
  /** 公告日期（YYYY-MM-DD）。 */
  date: string;
  category: string;
}

export function parseAnnList(json: unknown): {
  total: number;
  items: Announcement[];
} {
  const d = (json as any)?.data;
  if (!d || !Array.isArray(d.list)) {
    throw new FeedFormatError('公告列表接口返回的格式变了（没有 data.list）');
  }
  return {
    total: typeof d.total_hits === 'number' ? d.total_hits : d.list.length,
    items: d.list.map((x: any) => ({
      artCode: requiredText(x?.art_code, 'art_code'),
      // 标题前面带「招商银行:」，去掉
      title: requiredText(x?.title_ch || x?.title, 'title').replace(
        /^[^:：]{1,12}[:：]/,
        '',
      ),
      date: day(x?.notice_date, 'notice_date'),
      category: str(x?.columns?.[0]?.column_name),
    })),
  };
}

export interface AnnouncementText {
  title: string;
  date: string;
  /** 本页正文（空白已压缩）；大文件没有文本时是空串。 */
  text: string;
  /** 总页数；0 = 没有文本，只有 PDF。 */
  pages: number;
  pdf: string;
}

export function parseAnnContent(json: unknown): AnnouncementText {
  const d = (json as any)?.data;
  if (!d || typeof d !== 'object') {
    throw new FeedFormatError('公告正文接口返回的格式变了（没有 data）');
  }
  const pages = integer(d.page_size, 'page_size');
  if (str(d.notice_content) && pages === 0) {
    throw new FeedFormatError('公告正文存在但页数为 0，无法确认分页');
  }
  return {
    title: requiredText(d.notice_title, 'notice_title').replace(
      /^[^:：]{1,12}[:：]/,
      '',
    ),
    date: day(d.notice_date, 'notice_date'),
    text: compactText(
      typeof d.notice_content === 'string' ? d.notice_content : '',
    ),
    pages,
    pdf: str(d.attach_url_web || d.attach_url),
  };
}

/** PDF 转出来的文字有大量对齐用的空格：行内连续空白压成一个，空行压成一个换行。 */
export function compactText(s: string): string {
  return s
    .replace(/\r/g, '')
    .replace(/[ \t　 ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export interface ResearchReport {
  infoCode: string;
  title: string;
  org: string;
  date: string;
  /** 机构原始评级（「优于大市」）和东方财富归一后的评级（「增持」）。 */
  rating: string;
  emRating: string;
  researcher: string;
  /** year、year+1、year+2 的 EPS（元）和 PE 预测，见 parseResearch。 */
  eps: (number | null)[];
  pe: (number | null)[];
}

/**
 * 研报列表。EPS / PE 预测的三列是相对接口的 `currentYear`（查询时的年份）算的，不是发布年份：
 * 2024 年的研报只在它覆盖到 currentYear 时才有「今年」那一列（2026-10-27 核对）。
 */
export function parseResearch(json: unknown): {
  total: number;
  /** EPS / PE 第一列对应的年份。 */
  year: number;
  items: ResearchReport[];
} {
  const j = json as any;
  if (!j || !Array.isArray(j.data)) {
    throw new FeedFormatError('研报接口返回的格式变了（没有 data）');
  }
  return {
    total: typeof j.hits === 'number' ? j.hits : j.data.length,
    year:
      j.data.length || j.currentYear != null
        ? integer(j.currentYear, 'currentYear', 1000)
        : 0,
    items: j.data.map((x: any) => ({
      infoCode: requiredText(x?.infoCode, 'infoCode'),
      title: requiredText(x?.title, 'title'),
      org: str(x.orgSName || x.orgName),
      date: day(x?.publishDate, 'publishDate'),
      rating: str(x.sRatingName),
      emRating: str(x.emRatingName),
      researcher: str(x.researcher),
      eps: [
        num(x.predictThisYearEps),
        num(x.predictNextYearEps),
        num(x.predictNextTwoYearEps),
      ],
      pe: [
        num(x.predictThisYearPe),
        num(x.predictNextYearPe),
        num(x.predictNextTwoYearPe),
      ],
    })),
  };
}

export interface NewsItem {
  title: string;
  summary: string;
  media: string;
  /** YYYY-MM-DD HH:MM。 */
  time: string;
  url: string;
}

/** 新闻搜索返回 JSONP：`cb({...})`。 */
export function parseNews(text: string): { total: number; items: NewsItem[] } {
  const m = /^[^(]*\(([\s\S]*)\)\s*;?\s*$/.exec(text.trim());
  let j: any;
  try {
    j = JSON.parse(m ? m[1] : text);
  } catch {
    throw new FeedFormatError('新闻接口返回的不是 JSON');
  }
  const list = j?.result?.cmsArticleWebOld;
  if (!Array.isArray(list)) {
    if (j?.code === 0 && j?.result == null) {
      return { total: 0, items: [] };
    }
    throw new FeedFormatError('新闻接口返回的格式变了（' + str(j?.msg) + '）');
  }
  const plain = (s: unknown) => str(s).replace(/<\/?em>/g, '');
  return {
    total: typeof j.hitsTotal === 'number' ? j.hitsTotal : list.length,
    items: list.map((x: any) => ({
      title: plain(requiredText(x?.title, 'title')),
      summary: plain(x.content).replace(/\s+/g, ' '),
      media: str(x.mediaName),
      time: day(x?.date, 'date') + str(x.date).slice(10, 16),
      url: requiredText(x?.url, 'url').replace(/^http:\/\//, 'https://'),
    })),
  };
}
