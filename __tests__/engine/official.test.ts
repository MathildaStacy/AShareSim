/**
 * 外部标准答案：用官方公开的算例验收引擎，不靠自己出题自己答。
 *
 * 来源：上海市税务局《〈财政部 国家税务总局 证监会关于实施上市公司股息红利差别化个人所得税政策有关问题的通知〉有关问题的解答》
 * https://shanghai.chinatax.gov.cn/zcfw/zcjd/201211/t400944.html
 * 原文按 2012 年的财税〔2012〕85 号（派息时先按 25% 预扣）。现行的财税〔2015〕101 号改为：持股 1 年以内的派息时不扣税，
 * 卖出时按持股期限一次补扣；持股超过 1 年免税。下面的金额已按现行规定换算，持股期限的判定和原文完全一样。
 */
import { divTaxRate, T, yuanToLi, type Engine } from '../../src/engine';
import { makeEngine, snap } from './helpers/fixtures';

const at = (date: string, t: number) => ({ date, t });

function buyAt(e: Engine, date: string, qty: number) {
  e.onSnapshot(
    snap({
      code: 'sh600036',
      date,
      t: T(10, 0),
      prev: 10,
      last: 10,
      volume: 10_000_000,
      asks: [[10, 1_000_000]],
    }),
  );
  const r = e.placeOrder(at(date, T(10, 0, 1)), {
    code: 'sh600036',
    side: 'B',
    kind: 'limit',
    price: yuanToLi(10),
    qty,
  });
  if (!r.ok || r.order.status !== '已成') throw new Error('buy failed');
}

function sellAt(e: Engine, date: string, qty: number) {
  e.onSnapshot(
    snap({
      code: 'sh600036',
      date,
      t: T(10, 0),
      prev: 10,
      last: 10,
      volume: 10_000_000,
      bids: [[10, 1_000_000]],
    }),
  );
  const r = e.placeOrder(at(date, T(10, 0, 1)), {
    code: 'sh600036',
    side: 'S',
    kind: 'limit',
    price: yuanToLi(10),
    qty,
  });
  if (!r.ok || r.order.status !== '已成')
    throw new Error(r.ok ? r.order.reason : r.msg);
  return e.state.fills[0];
}

describe('官方算例：持股期限', () => {
  test('例 1：1 月 8 日买入，2 月 8 日卖出是 1 个月；2014 年 1 月 8 日卖出是 1 年', () => {
    expect(divTaxRate('2013-01-08', '2013-02-08').pct).toBe(20); // 1 个月以内（含 1 个月）
    expect(divTaxRate('2013-01-08', '2013-02-09').pct).toBe(10); // 1 个月以上
    expect(divTaxRate('2013-01-08', '2014-01-08').pct).toBe(10); // 1 年以内（含 1 年）
    expect(divTaxRate('2013-01-08', '2014-01-09').pct).toBe(0); // 1 年以上，免税
  });
  test('例 2：1 月 28 日至 31 日买入，2 月 28 日卖出都是 1 个月', () => {
    for (const d of ['2013-01-28', '2013-01-29', '2013-01-30', '2013-01-31']) {
      expect(divTaxRate(d, '2013-02-28').pct).toBe(20);
      expect(divTaxRate(d, '2013-03-01').pct).toBe(10);
    }
  });
});

describe('官方算例：先进先出和补税金额（按现行规定）', () => {
  test('例 3：卖出 13,000 股依次对应三批，持股期限分别是 1 年以上、1 个月到 1 年、1 个月以内', () => {
    const e = makeEngine('2012-05-14');
    e.deposit(at('2012-05-14', T(9, 0)), 40_000_000);
    buyAt(e, '2012-05-15', 8000);
    buyAt(e, '2013-04-03', 2000);
    buyAt(e, '2013-06-06', 5000);
    // 原文没有给分红，这里假设每股派 0.40 元（股权登记日 6 月 7 日），用来看每一批分别按什么税率补税
    e.setCorporateActions([
      {
        code: 'sh600036',
        recordDate: '2013-06-07',
        exDate: '2013-06-10',
        payDate: '2013-06-10',
        cashPerShareLi: 400,
        bonusPerShare: 0,
      },
    ]);
    const f = sellAt(e, '2013-06-11', 13000);
    // 8,000 股免税；2,000 股 × 0.40 × 10% = 80 元；3,000 股 × 0.40 × 20% = 240 元
    expect(f.divTaxPending).toBe(32_000);
    expect(f.divTaxNotes).toHaveLength(2);
    expect(e.holding('sh600036').held).toBe(2000);
  });

  test('例 4：5 月 24 日买入 10,000 股，每 10 股派 4 元，6 月 24 日（含）之前卖出补税 800 元', () => {
    const run = (sellDate: string) => {
      const e = makeEngine('2013-05-23');
      e.deposit(at('2013-05-23', T(9, 0)), 40_000_000);
      e.setCorporateActions([
        {
          code: 'sh600036',
          recordDate: '2013-06-18',
          exDate: '2013-06-19',
          payDate: '2013-06-19',
          cashPerShareLi: 400,
          bonusPerShare: 0,
        },
      ]);
      buyAt(e, '2013-05-24', 10000);
      return sellAt(e, sellDate, 10000).divTaxPending ?? 0;
    };
    expect(run('2013-06-24')).toBe(80_000); // 4,000 元 × 20%
    expect(run('2013-06-25')).toBe(40_000); // 4,000 元 × 50% × 20%
    expect(run('2014-05-23')).toBe(40_000); // 1 年以内（含 1 年）：5 月 24 日卖出也是；23 日是周五
    expect(run('2014-05-26')).toBe(0); // 1 年以上免税
  });
});
