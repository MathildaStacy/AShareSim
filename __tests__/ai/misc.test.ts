/// <reference types="node" />
/**
 * M4 的小块逻辑：回答排版、快捷问题、服务表单校验、费用估算、东方财富 F10 解析（真实样本）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseInline, parseMarkdown } from '../../src/ai/markdown';
import { costOf, estimateTokens, nowLine } from '../../src/ai/prompt';
import { quickQuestions } from '../../src/ai/quick';
import { emptyForm, parseServiceForm } from '../../src/ai/services';
import { normalizeCode } from '../../src/ai/tools/read';
import { NAV_ROUTES, TOOL_DEFS } from '../../src/ai/tools/defs';
import type { Activity } from '../../src/data/repos';
import {
  parseFinance,
  parseProfile,
  profileUrl,
} from '../../src/market/eastmoney';

const fx = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, '../market/fixtures', name), 'utf8'));

test('工具列表固定 27 个，按名字排序，名字不重复', () => {
  const names = TOOL_DEFS.map(t => t.name);
  expect(names).toHaveLength(27);
  expect(names).toEqual([...names].sort());
  expect(new Set(names).size).toBe(27);
  expect(NAV_ROUTES.Ai).toBeUndefined(); // 不能从 AI 打开 AI 页
});

test('代码：6 位按首位推交易所，也认 .SH 后缀', () => {
  expect(normalizeCode('600036')).toBe('sh600036');
  expect(normalizeCode('510300')).toBe('sh510300');
  expect(normalizeCode('000001')).toBe('sz000001');
  expect(normalizeCode('159915')).toBe('sz159915');
  expect(normalizeCode('SZ300750')).toBe('sz300750');
  expect(normalizeCode('600519.sh')).toBe('sh600519');
  expect(normalizeCode('招商银行')).toBeNull();
});

describe('回答排版', () => {
  test('加粗、行内代码、规则课链接', () => {
    expect(
      parseInline('看 **T+1**，见 [规则课·T+1](lesson:t1) 和 `calcFee`'),
    ).toEqual([
      { t: 'text', text: '看 ' },
      { t: 'bold', text: 'T+1' },
      { t: 'text', text: '，见 ' },
      { t: 'link', text: '规则课·T+1', href: 'lesson:t1' },
      { t: 'text', text: ' 和 ' },
      { t: 'code', text: 'calcFee' },
    ]);
  });

  test('标题、列表、表格（跳过分隔行）、段落', () => {
    const b = parseMarkdown(
      '## 费用\n\n1. 佣金\n2. 印花税\n- 过户费\n\n| 项 | 金额 |\n|---|---:|\n| 佣金 | 5.00 |\n\n仅供学习，不构成投资建议',
    );
    expect(b.map(x => x.t)).toEqual(['h', 'li', 'li', 'li', 'table', 'p']);
    expect(b[1]).toMatchObject({ marker: '1.' });
    expect(b[3]).toMatchObject({ marker: '•' });
    const table = b[4] as Extract<(typeof b)[number], { t: 'table' }>;
    expect(table.rows).toHaveLength(2);
  });
});

test('快捷问题跟着最后一条非浏览操作和页面变', () => {
  const act = (kind: Activity['kind'], text: string): Activity => ({
    accountId: 1,
    tradeDate: '2026-10-27',
    ts: '2026-10-27T10:00:00',
    kind,
    text,
  });
  expect(
    quickQuestions(
      [
        act('view', '查看 自选'),
        act('reject', '委托买入 招商银行 → 废单：超出价格笼子'),
      ],
      { name: '个股 · 招商银行', lines: [] },
    ),
  ).toEqual([
    '刚才那笔为什么是废单？',
    '解释这个页面',
    '介绍一下这家公司',
    '最近走势怎么样？',
  ]);
  expect(
    quickQuestions(
      [act('learn', '规则课「T+1」第 1 题选「可以」，答错')],
      null,
    ),
  ).toEqual(['我刚才那道题错在哪？']);
});

describe('服务表单', () => {
  test('新服务必须填 Key；编辑时可以不填', () => {
    const f = {
      ...emptyForm('anthropic'),
      name: '中转',
      model: 'claude-sonnet-5-5',
    };
    const r = parseServiceForm(f, false);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.key).toContain('API Key');
    expect(parseServiceForm(f, true).ok).toBe(true);
  });

  test('价格 4 项都填才算，存成千分之一美元', () => {
    const f = {
      ...emptyForm('openai'),
      name: 'o',
      model: 'gpt-5.6',
      key: 'sk-x',
      priceInput: '3',
      priceCacheRead: '0.3',
      priceCacheWrite: '',
      priceOutput: '15',
    };
    expect(parseServiceForm(f, false).ok).toBe(false);
    const r = parseServiceForm({ ...f, priceCacheWrite: '3.75' }, false);
    expect(r.ok && r.service.price).toEqual({
      input: 3000,
      cacheRead: 300,
      cacheWrite: 3750,
      output: 15000,
    });
    // OpenAI 协议一律用 Bearer
    expect(r.ok && r.service.auth).toBe('bearer');
  });

  test('Base URL 要以 http(s) 开头，模型名不能有空格', () => {
    const r = parseServiceForm(
      {
        ...emptyForm(),
        name: 'x',
        baseUrl: 'relay.com',
        model: 'a b',
        key: 'k',
      },
      false,
    );
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(['baseUrl', 'model']);
  });
});

test('费用估算：Sonnet 价格下，缓存读 0.1 倍', () => {
  const p = { input: 3000, cacheRead: 300, cacheWrite: 3750, output: 15000 };
  const u = {
    input: 1000,
    cacheRead: 10000,
    cacheWrite: 0,
    output: 500,
    cacheReported: true,
  };
  // 1000×3 + 10000×0.3 + 500×15 = 13,500 美元 / 百万 → 0.0135 美元
  expect(costOf(u, p)).toBeCloseTo(0.0135, 6);
  // 不用缓存：11000×3 + 500×15 = 40,500 → 0.0405
  expect(costOf(u, p, false)).toBeCloseTo(0.0405, 6);
  expect(estimateTokens('abcdefg')).toBe(2);
  expect(estimateTokens('招商银行')).toBe(4);
});

test('<now> 带星期和时段', () => {
  expect(nowLine('2026-10-27', '09:22', true, '开盘集合竞价')).toBe(
    '<now>2026-10-27 周二 09:22（北京时间）· 交易日 · 开盘集合竞价</now>',
  );
  expect(nowLine('2026-10-31', '10:00', false, '')).toContain(
    '周六 10:00（北京时间）· 休市',
  );
});

describe('东方财富 F10（2026-10-27 贵州茅台真实样本）', () => {
  test('公司简况', () => {
    expect(profileUrl('sh600519')).toContain('SECUCODE%3D%22600519.SH%22');
    const p = parseProfile(fx('em-profile-sh600519.json'))!;
    expect(p.fullName).toBe('贵州茅台酒股份有限公司');
    expect(p.industry).toBe('制造业-酒、饮料和精制茶制造业');
    expect(p.listingDate).toBe('2001-08-27');
    expect(
      parseProfile({ result: null, success: false, message: '返回数据为空' }),
    ).toBeNull();
  });

  test('主要财务指标：从新到旧，金融企业没有毛利率时是 null', () => {
    const f = parseFinance(fx('em-fin-sh600519.json'));
    expect(f).toHaveLength(4);
    expect(f[0]).toMatchObject({ period: '2026中报', eps: 35.57, roe: 16.75 });
    expect(f[0].grossMargin).toBeCloseTo(89.56, 2);
    expect(
      parseFinance({
        result: { data: [{ REPORT_DATE_NAME: 'x', XSMLL: null }] },
      })[0].grossMargin,
    ).toBeNull();
  });
});

test('Markdown 保留标题层级及标题内强调，连续引用不混入普通段落', () => {
  const blocks = parseMarkdown(
    '# 判断\n\n### **理由**\n\n> 成本包含买入费用。\n> 盈亏尚未扣卖出费用。\n\n普通段落',
  );
  expect(blocks).toMatchObject([
    { t: 'h', level: 1 },
    { t: 'h', level: 3, inl: [{ t: 'bold', text: '理由' }] },
    {
      t: 'quote',
      inl: [{ t: 'text', text: '成本包含买入费用。\n盈亏尚未扣卖出费用。' }],
    },
    { t: 'p', inl: [{ t: 'text', text: '普通段落' }] },
  ]);
});
