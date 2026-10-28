import {
  numberTokens,
  splitMissing,
  traceNumbers,
} from '../../src/ai/provenance';

const QUOTE = {
  label: '读取 招商银行 实时行情',
  text: '招商银行 sh600036 现价 39.47 元，昨收 38.80，涨跌 +0.67（+1.73%），成交额 18.52 亿元，市盈率 6.21，日期 2026-10-26',
};

describe('数字溯源', () => {
  test('跳过序号、小整数、计数和链接地址；保留价格、比例、日期', () => {
    const t = numberTokens(
      '1. 看 3 个原因：[招商银行](stock:sh600036) 现价 39.47 元，近 20 日涨 5.2%，2026-10-26 收盘。共 120 只候选，跑赢沪深300 和中证1000',
    ).map(x => x.text);
    expect(t).toEqual(['39.47', '5.2', '2026-10-26']);
  });

  test('四舍五入、正负号、万 / 亿换算和「约」都算有来源', () => {
    const p = traceNumbers(
      '招商银行现价 39.5 元，涨了 1.7%，跌幅不是 -1.73%。成交额约 18.5 亿元，市盈率 6.2 倍，约 40 元。',
      [QUOTE],
    );
    expect(p.missing.map(m => m.text)).toEqual([]);
    expect(p.refs.find(r => r.text === '39.5')!.source).toBe(QUOTE.label);
  });

  test('由回答里提到的数字算出的允许；凭空的数字标出来', () => {
    const p = traceNumbers(
      '从昨收 38.80 到现价 39.47，两个价格加起来 78.27。目标价 45.00 元，空间 14.0%，比现价高 5.53 元。',
      [QUOTE],
    );
    expect(p.derived).toBeGreaterThanOrEqual(1);
    const status = Object.fromEntries(p.refs.map(r => [r.text, r.status]));
    expect(status['78.27']).toBe('derived');
    expect(status['5.53']).toBe('none');
    expect(status['45.00']).toBe('none');
    // 14.0% 由 45 和 39.47 算出，但 45 本身没来源，所以也找不到
    expect(status['14.0']).toBe('none');
  });

  test('日期按原文或补零后匹配；切分文字给界面标虚线', () => {
    const p = traceNumbers('2026-10-26 的公告，和 2026-10-30 的会议', [QUOTE]);
    expect(p.refs.map(r => r.status)).toEqual(['source', 'none']);
    expect(splitMissing('目标价 45.00 元', new Set(['45.00']))).toEqual([
      { text: '目标价 ', missing: false },
      { text: '45.00', missing: true },
      { text: ' 元', missing: false },
    ]);
  });

  test('上千个 K 线数字时不会两两凑出任意数', () => {
    const csv = Array.from({ length: 300 }, (_, i) =>
      [10 + i * 0.013, 10.1 + i * 0.011, 9.9 + i * 0.017]
        .map(x => x.toFixed(2))
        .join(','),
    ).join('\n');
    const p = traceNumbers('预计还能涨 7.77 元', [
      { label: 'K 线', text: csv },
    ]);
    expect(p.missing.map(m => m.text)).toEqual(['7.77']);
  });
});
