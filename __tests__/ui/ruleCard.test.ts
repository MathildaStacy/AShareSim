/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classify, isSTName, T, type Security } from '../../src/engine';
import { DEFAULT_FEE_PROFILE } from '../../src/engine/fees';
import { parseQuotes } from '../../src/market/tencent';
import { limitPct, nowRule, ruleCard } from '../../src/sim/ruleCard';

/** 2026-10-26 14:52:47 的真实快照（连续竞价）。 */
const quotes = parseQuotes(
  readFileSync(
    join(__dirname, '..', 'market', 'fixtures', 'qt-2026-10-26-1452.txt'),
    'utf8',
  ),
);
const q = (code: string) => quotes.find(x => x.snapshot.code === code)!;
const secOf = (code: string): Security => {
  const { info } = q(code);
  return {
    code,
    name: info.name,
    ...classify(code, info.type)!,
    st: isSTName(info.name),
  };
};
const noHolding = { held: 0, sellable: 0, todayBuy: 0, frozenSell: 0 };
const card = (code: string, t = T(14, 52, 47), extra = {}) =>
  Object.fromEntries(
    ruleCard({
      sec: secOf(code),
      snap: q(code).snapshot,
      t,
      isTradingDay: true,
      holding: noHolding,
      fee: DEFAULT_FEE_PROFILE,
      ...extra,
    }).map(r => [r.k, r]),
  );

describe('本股规则卡', () => {
  test('招商银行：主板 ±10%，连续竞价时给出价格笼子的具体范围（卖一 42.31、买一 42.30）', () => {
    const c = card('sh600036');
    expect(c['板块'].v).toBe('沪市主板，涨跌幅 ±10%');
    expect(c['今日价格区间'].v).toBe('跌停 37.59 ～ 涨停 45.95');
    expect(c['申报单位'].v).toContain('买入 100 股（1 手）的整数倍');
    expect(c['最小价位'].v).toBe('0.01 元');
    // 42.31 × 1.02 = 43.1562 → 43.15；42.30 × 0.98 = 41.454 → 向上取到 41.46
    expect(c['价格笼子'].v).toBe(
      '现在买入价 ≤ 43.15（基准 42.31），卖出价 ≥ 41.46（基准 42.30）。超出的是废单',
    );
    expect(c['现在']).toEqual({
      k: '现在',
      v: '连续竞价（9:30–11:30、13:00–14:57）：委托直接报交易所；可以撤单',
      ok: true,
    });
    expect(c['可卖']).toEqual({
      k: '可卖',
      v: '没有持仓，不能卖出',
      ok: false,
    });
    expect(c['交易费用'].v).toContain(
      '佣金万 2.5、最低 5 元（默认费率，还没用真实交割单校准）',
    );
  });

  test('科创板：2% 没有 10 个价位的兜底；买入 200 股起、1 股递增', () => {
    const c = card('sh688981');
    expect(c['板块'].v).toBe('沪市科创板，涨跌幅 ±20%');
    // 102.13 × 1.02 = 104.1726 → 104.17；102.05 × 0.98 = 100.009 → 100.01
    expect(c['价格笼子'].v).toContain('买入价 ≤ 104.17');
    expect(c['价格笼子'].v).toContain('卖出价 ≥ 100.01');
    expect(c['申报单位'].v).toBe(
      '买入至少 200 股，超过部分 1 股递增；卖出不足 200 股时一次卖完',
    );
  });

  test('低价股：基准价 ± 10 个价位比 2% 宽，按 10 个价位（ST易购 1.10）', () => {
    const c = card('sz002024');
    expect(c['板块'].v).toBe(
      '深市主板·风险警示（ST），涨跌幅 ±10%（2026-07-06 起主板 ST 由 ±5% 调为 ±10%）',
    );
    expect(c['价格笼子'].v).toContain('买入价 ≤ 1.20');
    expect(c['价格笼子'].v).toContain('卖出价 ≥ 0.99');
  });

  test('创业板 ETF：涨跌幅以接口的涨跌停价为准（±20%），没有价格笼子，T+0 品种按 T+1', () => {
    const c = card('sz159915');
    expect(c['板块'].v).toContain('深市ETF，涨跌幅 ±20%');
    expect(c['今日价格区间'].v).toBe('跌停 2.162 ～ 涨停 3.242');
    expect(c['价格笼子'].v).toBe('ETF 不适用价格笼子，只受涨跌幅限制');
    expect(c['单笔上限'].v).toBe('100 万份，限价市价一样');
    expect(c['T+1'].v).toContain('实盘是 T+0');
    expect(c['交易费用'].v).toContain('佣金万 0.5');
    expect(c['交易费用'].v).toContain('ETF 免印花税');
  });

  test('不在连续竞价时只说明规则，不给范围', () => {
    const c = card('sh600036', T(9, 22));
    expect(c['价格笼子'].v).toMatch(/^只在连续竞价阶段生效/);
    expect(c['现在'].ok).toBe(false);
  });

  test('可卖数量和原因：T+1 和卖单冻结', () => {
    const c = card('sh600036', T(10, 0), {
      holding: { held: 1500, sellable: 700, todayBuy: 500, frozenSell: 300 },
    });
    expect(c['可卖']).toEqual({
      k: '可卖',
      v: '持有 1500 股，可卖 700 股：今日买入 500 股下一交易日才能卖（T+1）；已有卖单冻结 300 股',
      ok: true,
    });
  });

  test('涨跌幅：没有行情时按板块默认值', () => {
    expect(limitPct(secOf('sz300750'), null)).toBe(20);
    expect(limitPct(secOf('sz300750'), q('sz300750').snapshot)).toBe(20);
  });
});

describe('现在能不能下单、撤单', () => {
  test.each([
    ['9:00', T(9, 0), '盘前：委托由券商暂存，9:15 报送交易所；可以撤单', true],
    [
      '9:17',
      T(9, 17),
      '开盘集合竞价（9:15–9:20）：委托进入开盘集合竞价；可以撤单',
      true,
    ],
    [
      '9:22',
      T(9, 22),
      '开盘集合竞价（9:20–9:25）：委托进入开盘集合竞价；已报交易所的委托不能撤单（券商暂存的可以撤）',
      false,
    ],
    [
      '9:27',
      T(9, 27),
      '等待开盘（9:25–9:30）：委托由券商暂存，9:30 报送交易所；已报交易所的委托不能撤单（券商暂存的可以撤）',
      false,
    ],
    [
      '12:00',
      T(12, 0),
      '午间休市（11:30–13:00）：委托由券商暂存，13:00 报送交易所；可以撤单',
      true,
    ],
    [
      '14:58',
      T(14, 58),
      '收盘集合竞价（14:57–15:00）：只接受限价单，进入收盘集合竞价；已报交易所的委托不能撤单（券商暂存的可以撤）',
      false,
    ],
    [
      '15:10',
      T(15, 10),
      '盘后固定价格交易（15:05–15:30）：普通委托算下一交易日的预埋单；盘后固定价格交易 15:30 前还能申报；可以撤单',
      true,
    ],
    ['20:00', T(20, 0), '已收盘：普通委托算下一交易日的预埋单；可以撤单', true],
  ])('%s', (_label, t, text, canCancel) => {
    expect(nowRule(t, true)).toEqual({ text, canCancel });
  });

  test('非交易日：预埋单', () => {
    expect(nowRule(T(10, 0), false).text).toContain('下一交易日 9:15 报送');
  });
});
