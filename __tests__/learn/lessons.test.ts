/**
 * 规则课内容的结构检查，以及讲解和小测里的数字用引擎同一套函数核对（规则改了、课没改时这里会失败）。
 */
import {
  cageRange,
  calcFee,
  computeLimits,
  DEFAULT_FEE_PROFILE,
  divTaxRate,
  T,
  type Security,
  type Snapshot,
} from '../../src/engine';
import { LESSON_IDS, LESSONS, lessonById } from '../../src/learn/lessons';
import type { Lesson } from '../../src/learn/types';

/** RootStackParamList 里的路由，加上 M3 新增的 FeeCalc、Auction。 */
const ROUTES = [
  'Tabs',
  'Stock',
  'Search',
  'Order',
  'Positions',
  'Position',
  'Orders',
  'OrderDetail',
  'FillDetail',
  'Transfer',
  'Flows',
  'Fees',
  'Calibrate',
  'Settings',
  'FeeCalc',
  'Auction',
];

const lesson = (id: string): Lesson => lessonById(id)!;
/** 小测正确选项的文字。 */
const answerOf = (id: string, qi: number) => {
  const q = lesson(id).quiz[qi];
  return q.options[q.answer];
};
const allText = (l: Lesson) =>
  l.blocks
    .map(b =>
      b.t === 'list'
        ? b.items.join('\n')
        : b.t === 'table'
        ? b.rows.flat().join('\n')
        : b.text,
    )
    .join('\n');

const yuan = (fen: number) => (fen / 100).toFixed(2);
const px = (li: number) => (li / 1000).toFixed(2);

function sec(code: string, board: Security['board']): Security {
  return {
    code,
    name: code,
    exchange: code.startsWith('sh') ? 'SH' : 'SZ',
    board,
    st: false,
  };
}

function book(code: string, bid1: number, ask1: number): Snapshot {
  return {
    code,
    date: '2026-10-27',
    t: T(10, 0),
    prevClose: ask1,
    open: ask1,
    last: ask1,
    high: ask1,
    low: ask1,
    volume: 0,
    amount: 0,
    bids: [[bid1, 1000]],
    asks: [[ask1, 1000]],
    up: null,
    down: null,
  };
}

describe('规则课的结构', () => {
  test('12 课，id 和顺序固定，不重复', () => {
    expect(LESSON_IDS).toEqual([
      'time',
      't1',
      'limit',
      'cage',
      'unit',
      'fee',
      'div',
      'exright',
      'st',
      'ipo',
      'boards',
      'kinds',
    ]);
    expect(new Set(LESSON_IDS).size).toBe(12);
    expect(lessonById('nope')).toBeUndefined();
  });

  test('引擎校验返回的 lesson 字段都能找到对应的课', () => {
    for (const id of ['time', 'kinds', 'unit', 't1', 'cage', 'limit', 'st']) {
      expect(lessonById(id)).toBeDefined();
    }
  });

  test.each(LESSONS.map(l => [l.id, l] as const))(
    '%s：标题、摘要、讲解、1–3 道小测、去实践的路由',
    (_id, l) => {
      expect(l.title).not.toBe('');
      expect(l.summary).not.toBe('');
      expect(l.spec).toMatch(/^§/);
      expect(l.blocks.length).toBeGreaterThan(0);
      expect(l.quiz.length).toBeGreaterThanOrEqual(1);
      expect(l.quiz.length).toBeLessThanOrEqual(3);
      for (const q of l.quiz) {
        expect(q.options.length).toBeGreaterThanOrEqual(2);
        expect(Number.isInteger(q.answer)).toBe(true);
        expect(q.answer).toBeGreaterThanOrEqual(0);
        expect(q.answer).toBeLessThan(q.options.length);
        expect(new Set(q.options).size).toBe(q.options.length);
        expect(q.explain).not.toBe('');
      }
      for (const p of l.practice ?? []) {
        expect(ROUTES).toContain(p.route);
      }
      for (const b of l.blocks) {
        if (b.t === 'table') {
          const w = b.rows[0].length;
          expect(b.rows.every(r => r.length === w)).toBe(true);
        }
      }
      // 加粗标记成对出现
      const stars = (allText(l).match(/\*\*/g) ?? []).length;
      expect(stars % 2).toBe(0);
    },
  );

  test('讲解里没有原型的「示例账户」', () => {
    for (const l of LESSONS) {
      expect(allText(l)).not.toContain('示例账户');
    }
  });
});

describe('课里的数字和引擎一致', () => {
  const P = DEFAULT_FEE_PROFILE;
  const main = { board: 'main' as const };
  const etf = { board: 'etf' as const };

  test('交易费用：卖出 1 万元 10.10、买入 2,000 元佣金 5.00、卖出 2 万元 15.20', () => {
    const sell1w = calcFee(main, 'S', 1_000_000, P);
    expect(yuan(sell1w.total)).toBe('10.10');
    expect(allText(lesson('fee'))).toContain('合计 10.10 元');
    expect(yuan(calcFee(main, 'B', 200_000, P).commission)).toBe('5.00');
    expect(answerOf('fee', 2)).toBe('5.00 元');
    expect(yuan(calcFee(main, 'S', 2_000_000, P).total) + ' 元').toBe(
      answerOf('fee', 0),
    );
    // 2 万元正好是最低 5 元的分界
    expect(calcFee(main, 'B', 2_000_000, P).commission).toBe(500);
    // ETF 卖出不收印花税
    expect(calcFee(etf, 'S', 1_000_000, P).stamp).toBe(0);
    expect(answerOf('fee', 1)).toBe('不要');
  });

  test('涨跌停：前收 11.20 → 12.32 / 10.08；ST 1.10 → 1.21；创业板 25.37 → 跌停 20.30', () => {
    const a = computeLimits(11_200, 10, 10);
    expect([px(a.up), px(a.down)]).toEqual(['12.32', '10.08']);
    expect(allText(lesson('limit'))).toContain('12.32');
    expect(px(computeLimits(1_100, 10, 10).up)).toBe(answerOf('limit', 0));
    expect(px(computeLimits(25_370, 20, 10).down)).toBe(answerOf('limit', 1));
  });

  test('价格笼子：卖一 10.00 → 10.20，卖一 3.00 → 3.10，买一 9.99 → 9.80，卖一 4.00 → 4.10，科创板 100 → 102', () => {
    const m = sec('sz000001', 'main');
    const maxBuy = (s: Security, ask1: number) =>
      px(cageRange(s, 'B', book(s.code, ask1 - 10, ask1))!.max!);
    expect(maxBuy(m, 10_000)).toBe('10.20');
    expect(maxBuy(m, 3_000)).toBe('3.10');
    expect(px(cageRange(m, 'S', book(m.code, 9_990, 10_000))!.min!)).toBe(
      '9.80',
    );
    expect(maxBuy(m, 4_000)).toBe(answerOf('cage', 0));
    expect(maxBuy(sec('sz300750', 'cyb'), 3_000)).toBe('3.10');
    expect(maxBuy(sec('sh688981', 'kcb'), 100_000)).toBe(answerOf('cage', 1));
    // ETF 不适用价格笼子
    expect(
      cageRange(sec('sh510300', 'etf'), 'B', book('sh510300', 999, 1000)),
    ).toBeNull();
    const text = allText(lesson('cage'));
    for (const v of ['10.20', '3.10', '9.80']) {
      expect(text).toContain(v);
    }
  });

  test('红利税：2 月 1 日买入，5 月 10 日卖 10%，次年 2 月 1 日还是 10%、2 月 2 日免税，3 月 1 日买 3 月 20 日卖 20%', () => {
    expect(divTaxRate('2026-02-01', '2026-05-10').pct).toBe(10);
    expect(divTaxRate('2026-02-01', '2027-02-01').pct).toBe(10);
    expect(divTaxRate('2026-02-01', '2027-02-02').pct).toBe(0);
    expect(answerOf('div', 0)).toBe('0 元');
    expect(divTaxRate('2026-03-01', '2026-03-20').pct).toBe(20);
    expect(answerOf('div', 1)).toBe('100 元');
  });

  test('除权除息：20.00 − 0.50 = 19.50；(20.00 − 0.50) ÷ 1.5 = 13.00；15.00 ÷ 1.5 = 10.00', () => {
    expect(answerOf('exright', 0)).toBe((20 - 0.5).toFixed(2));
    expect(allText(lesson('exright'))).toContain(((20 - 0.5) / 1.5).toFixed(2));
    expect(answerOf('exright', 1)).toBe((15 / 1.5).toFixed(2));
  });
});
