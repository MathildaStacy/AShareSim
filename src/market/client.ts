/**
 * 行情请求，超时 8 秒；记录当天的请求次数和流量，
 * 「我的」页和后台通知里显示，耗电耗流量你看得到。
 */
import { beijingNow } from './clock';
import {
  bonusUrl,
  financeUrl,
  parseBonus,
  parseFinance,
  parseProfile,
  profileUrl,
  type CompanyProfile,
  type CorporateActionRow,
  type FinancePeriod,
} from './eastmoney';
import { parseSinaEtfRank, sinaEtfRankUrl } from './sina';
import {
  minuteKlineUrl,
  parseKline,
  parseMinute,
  parseMinuteDays,
  parseMinuteKline,
  parseQuotes,
  parseRank,
  parseSearch,
  parseTicks,
  parseTickTimeline,
  rankUrl,
  tickPageUrl,
  tickTimelineUrl,
  type KBar,
  type KlinePeriod,
  type MinuteDay,
  type MinuteKPeriod,
  type Quote,
  type RankBoard,
  type RankItem,
  type RankSort,
  type SearchHit,
  type Tick,
} from './tencent';

export type FetchText = (url: string, timeoutMs: number) => Promise<string>;

/** 默认实现：XMLHttpRequest，超时由 xhr.timeout 负责，超时会真正断开连接（后台长时间跑不会积压请求）。 */
export const defaultFetchText: FetchText = (url, timeoutMs) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.timeout = timeoutMs;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText);
      } else {
        reject(new Error('行情接口返回 ' + xhr.status));
      }
    };
    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.ontimeout = () => reject(new Error('行情接口超时'));
    xhr.send();
  });

/** UTF-8 字节数（估算流量用，不含 HTTP 头）。 */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      n += 1;
    } else if (c < 0x800) {
      n += 2;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else {
      n += 3;
    }
  }
  return n;
}

/** 每次请求大约多出来的 HTTP 头和 TLS 开销（字节），估算流量时加上。 */
const OVERHEAD_BYTES = 600;

export interface Traffic {
  date: string;
  requests: number;
  bytes: number;
}

/** 一次请求最多带多少只代码（腾讯接口 URL 太长会被拒）。 */
const QUOTE_CHUNK = 60;

export class MarketClient {
  traffic: Traffic = { date: '', requests: 0, bytes: 0 };

  constructor(
    private fetchText: FetchText = defaultFetchText,
    private timeoutMs = 8000,
  ) {}

  private async get(url: string): Promise<string> {
    const text = await this.fetchText(url, this.timeoutMs);
    const today = beijingNow().date;
    if (this.traffic.date !== today) {
      this.traffic = { date: today, requests: 0, bytes: 0 };
    }
    this.traffic.requests++;
    this.traffic.bytes += utf8Bytes(text) + OVERHEAD_BYTES;
    return text;
  }

  async quotes(codes: string[]): Promise<Quote[]> {
    const uniq = [...new Set(codes)];
    const out: Quote[] = [];
    for (let i = 0; i < uniq.length; i += QUOTE_CHUNK) {
      const chunk = uniq.slice(i, i + QUOTE_CHUNK);
      out.push(
        ...parseQuotes(
          await this.get('https://qt.gtimg.cn/utf8/q=' + chunk.join(',')),
        ),
      );
    }
    return out;
  }

  async minute(code: string, type: string): Promise<MinuteDay | null> {
    const text = await this.get(
      'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=' + code,
    );
    return parseMinute(JSON.parse(text), code, type);
  }

  /** 最近 5 个交易日的分时（含当天），带前收盘价。 */
  async minuteDays(code: string, type: string): Promise<MinuteDay[]> {
    const text = await this.get(
      'https://web.ifzq.gtimg.cn/appstock/app/day/query?code=' + code,
    );
    return parseMinuteDays(JSON.parse(text), code, type);
  }

  /** K 线。adjust：qfq 前复权（看图用）/ '' 不复权（存本地库用）。 */
  async kline(
    code: string,
    type: string,
    period: KlinePeriod,
    count: number,
    adjust: 'qfq' | '' = 'qfq',
  ): Promise<KBar[]> {
    const text = await this.get(
      `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},${period},,,${count},${adjust}`,
    );
    return parseKline(JSON.parse(text), code, period, type);
  }

  /**
   * 某段日期的日 K（一次最多 2,000 根；数据练习取 2015 年至今要分两段取）。
   * start / end 是 YYYY-MM-DD，end 为空表示到最新。
   */
  async klineRange(
    code: string,
    type: string,
    start: string,
    end: string,
    adjust: 'qfq' | '' = 'qfq',
  ): Promise<KBar[]> {
    const text = await this.get(
      `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,${start},${end},2000,${adjust}`,
    );
    return parseKline(JSON.parse(text), code, 'day', type);
  }

  /** 分钟 K 线（15 / 30 / 60 分钟，不复权）。 */
  async minuteKline(
    code: string,
    type: string,
    period: MinuteKPeriod,
    count: number,
  ): Promise<KBar[]> {
    const text = await this.get(minuteKlineUrl(code, period, count));
    return parseMinuteKline(JSON.parse(text), code, period, type);
  }

  async search(q: string): Promise<SearchHit[]> {
    const text = await this.get(
      'https://smartbox.gtimg.cn/s3/?v=2&t=all&c=1&q=' + encodeURIComponent(q),
    );
    return parseSearch(text);
  }

  /** 沪深 A / 创业板 / 科创板排行（腾讯）。北交所在解析时去掉，所以多要几只。 */
  async rank(
    board: RankBoard,
    sort: RankSort,
    count: number,
  ): Promise<RankItem[]> {
    const text = await this.get(rankUrl(board, sort, count + 5));
    return parseRank(JSON.parse(text)).slice(0, count);
  }

  /** ETF 排行（新浪，见 sina.ts）。 */
  async etfRank(sort: RankSort, count: number): Promise<RankItem[]> {
    const text = await this.get(sinaEtfRankUrl(sort, count));
    return parseSinaEtfRank(JSON.parse(text));
  }

  /**
   * 最近的成交明细（分笔），从早到晚，最多 count 行：先查页数，再取最后一页，不够再往前取一页。
   * 当天还没有成交时返回空。
   */
  async ticks(
    code: string,
    count: number,
  ): Promise<{ date: string; ticks: Tick[] }> {
    const tl = parseTickTimeline(await this.get(tickTimelineUrl(code)));
    if (!tl || tl.pages === 0) {
      return { date: tl?.date ?? '', ticks: [] };
    }
    let ticks = parseTicks(
      await this.get(tickPageUrl(code, tl.pages - 1)),
    ).ticks;
    if (ticks.length < count && tl.pages > 1) {
      ticks = [
        ...parseTicks(await this.get(tickPageUrl(code, tl.pages - 2))).ticks,
        ...ticks,
      ];
    }
    return { date: tl.date, ticks: ticks.slice(-count) };
  }

  async corporateActions(code: string): Promise<CorporateActionRow[]> {
    const text = await this.get(bonusUrl(code.slice(2)));
    return parseBonus(JSON.parse(text), code);
  }

  /** F10 公司简况（东方财富）；ETF、指数没有，返回 null。 */
  async companyProfile(code: string): Promise<CompanyProfile | null> {
    return parseProfile(JSON.parse(await this.get(profileUrl(code))));
  }

  /** 最近几期主要财务指标（东方财富），从新到旧。 */
  async financials(code: string, periods: number): Promise<FinancePeriod[]> {
    return parseFinance(JSON.parse(await this.get(financeUrl(code, periods))));
  }
}
