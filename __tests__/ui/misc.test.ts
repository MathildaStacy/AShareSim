import { formatPageContext, formatRecentActions } from '../../src/ai/context';
import { ViewLogger } from '../../src/app/activity';
import type { Activity } from '../../src/data/repos';
import {
  decimalsOf,
  fmtAmount,
  fmtCap,
  fmtChange,
  fmtHands,
  fmtPct,
  fmtPrice,
  isIndex,
  tagsOf,
} from '../../src/ui/format';
import { matchLocal } from '../../src/ui/search';
import {
  DEFAULT_SORT,
  move,
  nextSort,
  sortCodes,
} from '../../src/ui/watchSort';

describe('自选排序', () => {
  const data: Record<string, { price: number | null; pct: number | null }> = {
    a: { price: 10_000, pct: 1.2 },
    b: { price: 5_000, pct: -3 },
    c: { price: null, pct: null }, // 还没有行情
    d: { price: 20_000, pct: 4.5 },
  };
  const codes = ['a', 'b', 'c', 'd'];
  const val = (c: string, k: 'price' | 'pct') => data[c][k];

  test('点同一列：降序 → 升序 → 默认（拖动的顺序）', () => {
    const s1 = nextSort(DEFAULT_SORT, 'pct');
    expect(s1).toEqual({ key: 'pct', dir: 'desc' });
    const s2 = nextSort(s1, 'pct');
    expect(s2).toEqual({ key: 'pct', dir: 'asc' });
    expect(nextSort(s2, 'pct')).toEqual(DEFAULT_SORT);
    expect(nextSort(s1, 'price')).toEqual({ key: 'price', dir: 'desc' });
  });

  test('没有行情的排最后', () => {
    expect(sortCodes(codes, DEFAULT_SORT, val)).toEqual(codes);
    expect(sortCodes(codes, { key: 'pct', dir: 'desc' }, val)).toEqual([
      'd',
      'a',
      'b',
      'c',
    ]);
    expect(sortCodes(codes, { key: 'price', dir: 'asc' }, val)).toEqual([
      'b',
      'a',
      'd',
      'c',
    ]);
  });

  test('拖动：把第 from 个移到第 to 个', () => {
    expect(move(codes, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(move(codes, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(move(codes, 1, 1)).toBe(codes);
  });
});

describe('浏览日志', () => {
  test('连续停留在同一页面只记一次，换了页面再回来要记', async () => {
    const out: string[] = [];
    const log = new ViewLogger(async a => {
      out.push(a.kind + ':' + a.text);
    });
    expect(await log.view('stock:sh600036', '查看 招商银行')).toBe(true);
    expect(await log.view('stock:sh600036', '查看 招商银行')).toBe(false);
    await log.setting('加入自选 招商银行');
    expect(await log.view('stock:sh600036', '查看 招商银行')).toBe(false);
    await log.view('watch', '查看 自选');
    await log.view('stock:sh600036', '查看 招商银行');
    expect(out).toEqual([
      'view:查看 招商银行',
      'setting:加入自选 招商银行',
      'view:查看 自选',
      'view:查看 招商银行',
    ]);
  });
});

describe('本地搜索', () => {
  const rows = [
    { code: 'sh600036', name: '招商银行', type: 'GP-A', pinyin: 'zsyh' },
    { code: 'sh510300', name: '沪深300ETF', type: 'ETF', pinyin: '' },
    { code: 'sz000001', name: '平安银行', type: 'GP-A', pinyin: 'payh' },
  ];
  test('代码前缀、名称、拼音首字母', () => {
    expect(matchLocal(rows, '6000').map(r => r.code)).toEqual(['sh600036']);
    expect(matchLocal(rows, '银行').map(r => r.code)).toEqual([
      'sh600036',
      'sz000001',
    ]);
    expect(matchLocal(rows, 'ZSYH').map(r => r.code)).toEqual(['sh600036']);
    expect(matchLocal(rows, 'etf').map(r => r.code)).toEqual(['sh510300']);
    expect(matchLocal(rows, '  ')).toEqual([]);
  });
});

describe('数字格式', () => {
  test('价格位数：股票 2 位、ETF 3 位、指数 2 位（sh000001 是上证指数，sz000001 是平安银行）', () => {
    expect(decimalsOf('sh600036')).toBe(2);
    expect(decimalsOf('sh510300')).toBe(3);
    expect(decimalsOf('sz159915', 'ETF')).toBe(3);
    expect(decimalsOf('sh000001', 'ZS')).toBe(2);
    expect(isIndex('sh000001')).toBe(true);
    expect(isIndex('sz000001')).toBe(false);
    expect(fmtPrice(4_173, 3)).toBe('4.173');
    expect(fmtPrice(null, 2)).toBe('--');
  });

  test('涨跌带符号；成交量用手、金额用亿 / 万', () => {
    expect(fmtChange(530, 2)).toBe('+0.53');
    expect(fmtChange(-6, 3)).toBe('-0.006');
    expect(fmtPct(1.27)).toBe('+1.27%');
    expect(fmtPct(0)).toBe('0.00%');
    expect(fmtHands(82_878_600)).toBe('82.88万手');
    expect(fmtHands(4_000)).toBe('40手');
    expect(fmtAmount(347_961_134_300)).toBe('34.80亿');
    expect(fmtAmount(4_390_000_000)).toBe('4390.0万');
    expect(fmtCap(18_700)).toBe('1.87万亿');
    expect(fmtCap(312)).toBe('312亿');
  });

  test('板块标签', () => {
    expect(tagsOf('sz002024', 'ST易购')).toEqual(['ST']);
    expect(tagsOf('sz300750', '宁德时代')).toEqual(['创']);
    expect(tagsOf('sh688981', '中芯国际')).toEqual(['科']);
    expect(tagsOf('sh510300', '沪深300ETF')).toEqual(['ETF']);
    expect(tagsOf('sh600036', '招商银行')).toEqual([]);
  });
});

describe('发给 AI 的页面上下文', () => {
  test('页面上下文和最近操作的文本格式（AI_ASSISTANT.md §1）', () => {
    expect(
      formatPageContext({
        name: '个股 · 招商银行',
        lines: ['最新 42.30', '规则卡 · 可卖：没有持仓'],
        tip: '价格笼子只在连续竞价时生效。',
      }),
    ).toBe(
      '<page_context>\n页面：个股 · 招商银行\n- 最新 42.30\n- 规则卡 · 可卖：没有持仓\n要点：价格笼子只在连续竞价时生效。\n</page_context>',
    );
    const acts: Activity[] = [
      {
        accountId: 1,
        tradeDate: '2026-10-26',
        ts: '2026-10-26T14:53:02+08:00',
        kind: 'setting',
        text: '加入自选 招商银行',
      },
      {
        accountId: 1,
        tradeDate: '2026-10-26',
        ts: '2026-10-26T14:52:10+08:00',
        kind: 'view',
        text: '查看 招商银行（600036）个股详情',
      },
    ];
    // recentActivity 是从新到旧，发送时改成从旧到新
    expect(formatRecentActions(acts)).toBe(
      '<recent_actions>\n10-26 14:52 [view] 查看 招商银行（600036）个股详情\n10-26 14:53 [setting] 加入自选 招商银行\n</recent_actions>',
    );
  });
});
