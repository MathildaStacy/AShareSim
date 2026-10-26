import {
  bytesToBase64,
  safeFileName,
  setDocumentStore,
  exportText,
  utf8ToBase64,
} from '../../src/app/exportFile';
import { T } from '../../src/engine/session';
import type { LedgerEntry } from '../../src/engine/types';
import { ZERO_FEE } from '../../src/engine/fees';
import {
  csvField,
  fenCsv,
  LEDGER_CSV_HEADER,
  ledgerCsv,
  ledgerFileName,
} from '../../src/sim/ledgerCsv';
import { makeEngine, security, snap } from '../engine/helpers/fixtures';

const opts = {
  nameOf: (c: string) => security(c)?.name ?? c,
  decimalsOf: (c: string): 2 | 3 => (security(c)?.board === 'etf' ? 3 : 2),
};

/** 10-26 入金、买入招商银行 1000 股 @10.00，10-27 卖出 @10.10。 */
function tradedLedger(): LedgerEntry[] {
  const e = makeEngine('2026-10-26');
  e.deposit({ date: '2026-10-26', t: T(9, 0) }, 10_000_000);
  e.onSnapshot(
    snap({
      code: 'sh600036',
      t: T(10, 0),
      prev: 10,
      last: 10,
      volume: 1_000_000,
      bids: [[9.99, 5000]],
      asks: [[10, 5000]],
    }),
  );
  const b = e.placeOrder(
    { date: '2026-10-26', t: T(10, 0, 1) },
    { code: 'sh600036', side: 'B', kind: 'limit', price: 10_000, qty: 1000 },
  );
  if (!b.ok) throw new Error(b.msg);
  e.onSnapshot(
    snap({
      code: 'sh600036',
      date: '2026-10-27',
      t: T(10, 0),
      prev: 10,
      last: 10.1,
      volume: 1_000_000,
      bids: [[10.1, 5000]],
      asks: [[10.11, 5000]],
    }),
  );
  const s = e.placeOrder(
    { date: '2026-10-27', t: T(10, 0, 1) },
    { code: 'sh600036', side: 'S', kind: 'limit', price: 10_100, qty: 1000 },
  );
  if (!s.ok) throw new Error(s.msg);
  return e.state.ledger;
}

describe('交割单 CSV', () => {
  test('表头、顺序从早到晚、买卖各列逐项费用、转账行留空', () => {
    const ledger = tradedLedger();
    expect(ledger[0].biz).toBe('证券卖出'); // 引擎里新的在前
    const csv = ledgerCsv(ledger, opts);
    expect(csv.endsWith('\r\n')).toBe(true);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe(LEDGER_CSV_HEADER.join(','));
    expect(lines).toHaveLength(4);
    const [dep, buy, sell] = lines.slice(1).map(l => l.split(','));
    expect(dep.slice(0, 8)).toEqual([
      '2026-10-26',
      '09:00:00',
      '银行转证券',
      '',
      '',
      '',
      '',
      '',
    ]);
    expect(dep[14]).toBe('100000.00');
    expect(dep[15]).toBe('100000.00');
    expect(dep[18]).toBe('模拟入金');
    // 买入 10,000 元：佣金最低 5 元，过户费 0.10，印花税 0
    expect(buy.slice(0, 16)).toEqual([
      '2026-10-26',
      '10:00:01',
      '证券买入',
      '600036',
      '招商银行',
      '10.00',
      '1000',
      '10000.00',
      '5.00',
      '0.00',
      '0.10',
      '0.00',
      '0.00',
      '0.00',
      '-10005.10',
      '89994.90',
    ]);
    expect(buy[16]).toMatch(/^\d+$/);
    expect(buy[17]).toMatch(/^C\d+$/);
    // 卖出 10,100 元：佣金 5.00 + 印花税 5.05 + 过户费 0.10
    expect(sell.slice(2, 16)).toEqual([
      '证券卖出',
      '600036',
      '招商银行',
      '10.10',
      '1000',
      '10100.00',
      '5.00',
      '5.05',
      '0.10',
      '0.00',
      '0.00',
      '0.00',
      '10089.85',
      '100084.75',
    ]);
  });

  test('ETF 价格 3 位小数；含逗号和引号的字段加引号转义', () => {
    const entry: LedgerEntry = {
      id: 1,
      date: '2026-10-26',
      t: T(9, 25),
      biz: '证券买入',
      code: 'sh510300',
      price: 4_134,
      qty: 100,
      amount: 41_340,
      fee: { ...ZERO_FEE, commission: 500, total: 500 },
      divTax: 0,
      net: -41_840,
      balance: 100,
      orderNo: '101001',
      fillNo: 'C201002',
      note: '集合竞价,按 "开盘价" 成交\n第二行',
    };
    const line = ledgerCsv([entry], opts).split('\r\n')[1];
    expect(line).toBe(
      '2026-10-26,09:25:00,证券买入,510300,沪深300ETF华泰柏瑞,4.134,100,413.40,5.00,0.00,0.00,0.00,0.00,0.00,-418.40,1.00,101001,C201002,' +
        '"集合竞价,按 ""开盘价"" 成交\n第二行"',
    );
  });

  test('小工具', () => {
    expect(fenCsv(123456789)).toBe('1234567.89');
    expect(fenCsv(-5)).toBe('-0.05');
    expect(fenCsv(0)).toBe('0.00');
    expect(csvField('a')).toBe('a');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(ledgerFileName('2026-10-26')).toBe('交割单_2026-10-26.csv');
    expect(safeFileName('../a/b:c.csv')).toBe('_a_b_c.csv');
  });
});

describe('导出编码', () => {
  test('UTF-8 → base64 和 Node Buffer 一致（中文、BOM、补位、4 字节字符）', () => {
    for (const s of [
      '交割单,ABC',
      '\uFEFF交割单,ABC\r\n',
      'a',
      'ab',
      'abc',
      '😀',
    ]) {
      expect(utf8ToBase64(s)).toBe(Buffer.from(s, 'utf8').toString('base64'));
    }
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
  });

  test('CSV 加 BOM 交给原生模块；模块不可用时报错', async () => {
    const calls: [string, string, string][] = [];
    setDocumentStore({
      writeAndShare: async (n: string, b: string, m: string) => {
        calls.push([n, b, m]);
        return 'opened';
      },
      cleanupExports: async () => undefined,
    } as never);
    await expect(
      exportText('交割单_x.csv', '日期\r\n', 'text/csv'),
    ).resolves.toBe('opened');
    expect(calls[0][0]).toBe('交割单_x.csv');
    expect(Buffer.from(calls[0][1], 'base64').toString('utf8')).toBe(
      '\uFEFF日期\r\n',
    );
    expect(calls[0][2]).toBe('text/csv');
    setDocumentStore(null);
    await expect(exportText('a.txt', 'x', 'text/plain')).rejects.toThrow(
      '这台设备还不支持导出文件',
    );
    setDocumentStore(undefined);
  });
});
