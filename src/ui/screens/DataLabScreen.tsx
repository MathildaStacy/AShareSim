/**
 * 数据练习与导出（M3，PRODUCT_DESIGN §6.4，路线图阶段 1）：下载 CSV 在电脑上用 pandas 练习，
 * 再和 App 用同一份数据算出的「标准答案」对照。答案算法在 src/learn/datalab.ts。
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { logLearn } from '../../app/learn';
import { exportText } from '../../app/exportFile';
import * as repo from '../../data/repos';
import { formatFen } from '../../engine/units';
import type { KBar } from '../../market/tencent';
import { beijingIso, beijingNow } from '../../market/clock';
import {
  barsCsv,
  HINTS,
  longCsv,
  monthlyFees,
  rank20,
  seriesStats,
  stockSet,
  type DayBar,
  type SeriesStats,
} from '../../learn/datalab';
import { ledgerCsv, ledgerFileName } from '../../sim/ledgerCsv';
import { AiFab, Button, NavBar, SectionTitle } from '../components/ui';
import { useAiContext, useCore, usePolling, useViewLog } from '../hooks';
import { color, num, PAD } from '../theme';
import { toast } from '../toast';
import { BENCH } from './AnalysisScreen';

const toDay = (b: KBar): DayBar => ({
  date: b.date,
  open: b.open / 1000,
  close: b.close / 1000,
  high: b.high / 1000,
  low: b.low / 1000,
  volume: b.volume,
});

const pct = (v: number | null) =>
  v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%';

type Show = 'h1' | 'a1' | 'h2' | 'a2' | 'h3' | 'a3';

function Code({ lines }: { lines: string[] }) {
  return (
    <View style={s.code}>
      <Text style={s.codeText}>{lines.join('\n')}</Text>
    </View>
  );
}

function StatsTable({ name, st }: { name: string; st: SeriesStats }) {
  return (
    <View style={s.tbl}>
      <Text style={s.tblH}>
        {name}（{st.first} → {st.last}，{st.n} 行）
      </Text>
      {st.years.map(y => (
        <View key={y.year} style={s.tr}>
          <Text style={s.tdK}>
            {y.year}
            {y.partialStart ? '（' + y.partialStart.slice(5) + ' 起）' : ''}
            {y.toDate ? ' 至今' : ''}
          </Text>
          <Text
            style={[s.tdV, num, { color: y.ret >= 0 ? color.up : color.down }]}
          >
            {pct(y.ret)}
          </Text>
        </View>
      ))}
      <View style={s.tr}>
        <Text style={s.tdK}>年化波动率（日收益标准差 × √252）</Text>
        <Text style={[s.tdV, num]}>{(st.vol * 100).toFixed(2)}%</Text>
      </View>
      <View style={s.tr}>
        <Text style={s.tdK}>
          最大回撤 {st.mddFrom} → {st.mddTo}
        </Text>
        <Text style={[s.tdV, num, { color: color.down }]}>{pct(st.mdd)}</Text>
      </View>
      <View style={s.tr}>
        <Text style={s.tdK}>最近 250 个交易日滚动收益</Text>
        <Text style={[s.tdV, num]}>{pct(st.roll250)}</Text>
      </View>
    </View>
  );
}

export function DataLabScreen() {
  const core = useCore();
  const [show, setShow] = useState<Partial<Record<Show, boolean>>>({});
  const [stocks, setStocks] = useState<Record<string, DayBar[]> | null>(null);
  const [loadingStocks, setLoadingStocks] = useState(false);
  const today = beijingNow().date;
  const ledger = core.sim.engine.state.ledger;
  const nameOf = (c: string) => core.sim.security(c)?.name ?? c;

  // 两个指数 2015 年至今，一次最多 2,000 根，分两段取
  const idx = usePolling(
    async () => {
      const out: Record<string, DayBar[]> = {};
      for (const c of Object.keys(BENCH)) {
        const a = await core.client.klineRange(
          c,
          '',
          '2015-01-01',
          '2019-12-31',
          '',
        );
        const b = await core.client.klineRange(c, '', '2020-01-01', '', '');
        // 两段按日期拼起来（去重，防止边界那天重复）
        const byDate = new Map([...a, ...b].map(k => [k.date, k]));
        out[c] = [...byDate.values()]
          .sort((x, y) => (x.date < y.date ? -1 : 1))
          .map(toDay);
      }
      return out;
    },
    [],
    null,
  );
  const stats = idx.data
    ? Object.fromEntries(
        Object.entries(idx.data).map(([c, b]) => [c, seriesStats(b, today)]),
      )
    : {};
  const fees = monthlyFees(ledger);
  const ranking = stocks ? rank20(stocks) : null;

  const loadStocks = async () => {
    setLoadingStocks(true);
    try {
      const set = stockSet(core.sim.heldCodes(), await repo.watchlist(core.db));
      const out: Record<string, DayBar[]> = {};
      for (const c of set) {
        const type =
          core.sim.security(c)?.type ??
          (c.startsWith('sh688') ? 'GP-A-KCB' : 'GP-A');
        out[c] = (await core.client.kline(c, type, 'day', 300, 'qfq')).map(
          toDay,
        );
      }
      setStocks(out);
    } catch (e) {
      toast.show(
        '取数据失败：' + (e instanceof Error ? e.message : String(e)),
        'bad',
      );
    } finally {
      setLoadingStocks(false);
    }
  };

  const doExport = async (name: string, csv: string, rows: number) => {
    try {
      await exportText(name, csv, 'text/csv');
      toast.show('已打开分享面板：' + name);
      await repo.logActivity(core.db, {
        accountId: core.sim.accountId,
        tradeDate: core.sim.engine.state.date,
        ts: beijingIso(),
        kind: 'export',
        text: '导出 ' + name + '（' + rows + ' 行，数据练习）',
        ref: null,
      });
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), 'bad');
    }
  };
  const toggle = (k: Show) => {
    setShow(v => ({ ...v, [k]: !v[k] }));
    if (!show[k] && k.startsWith('a')) {
      logLearn(core, '数据练习：查看练习 ' + k.slice(1) + ' 的答案', {
        datalab: k,
      }).catch(() => undefined);
    }
  };

  useViewLog('datalab', '查看 数据练习与导出');
  useAiContext('DataLab', () => ({
    name: '学习 · 数据练习与导出',
    lines: [
      ...Object.entries(BENCH).map(([c, n]) => {
        const st = stats[c];
        return st
          ? n + ' 日线 ' + st.n + ' 行（' + st.first + ' → ' + st.last + '）'
          : n + ' 日线 ' + (idx.loading ? '加载中' : '没取到');
      }),
      stocks
        ? '股票长表 ' +
          Object.keys(stocks).length +
          ' 只，' +
          Object.values(stocks).reduce((t, b) => t + b.length, 0) +
          ' 行（前复权，最近 300 个交易日）'
        : '股票长表还没加载',
      '交割单 ' + ledger.length + ' 条',
      '展开了：' +
        (Object.entries(show)
          .filter(([, v]) => v)
          .map(([k]) =>
            k[0] === 'h' ? '练习 ' + k[1] + ' 提示' : '练习 ' + k[1] + ' 答案',
          )
          .join('、') || '无'),
      ...(show.a1
        ? Object.entries(BENCH).flatMap(([c, n]) => {
            const st = stats[c];
            return st
              ? [
                  n +
                    ' 每年收益：' +
                    st.years.map(y => y.year + ' ' + pct(y.ret)).join('，') +
                    '；年化波动率 ' +
                    (st.vol * 100).toFixed(2) +
                    '%；最大回撤 ' +
                    pct(st.mdd) +
                    '（' +
                    st.mddFrom +
                    ' → ' +
                    st.mddTo +
                    '）；最近 250 日 ' +
                    pct(st.roll250),
                ]
              : [];
          })
        : []),
      ...(show.a2
        ? fees.map(
            f =>
              f.month +
              ' 费用 ' +
              formatFen(f.total) +
              ' 元（' +
              f.trades +
              ' 笔，佣金 ' +
              formatFen(f.commission) +
              '，印花税 ' +
              formatFen(f.stamp) +
              '）',
          )
        : []),
      ...(show.a3 && ranking
        ? [
            ranking.date +
              ' 20 日收益排名前 10：' +
              ranking.rows
                .slice(0, 10)
                .map(r => r.rank + '. ' + nameOf(r.code) + ' ' + pct(r.ret20))
                .join('，'),
          ]
        : []),
    ],
    tip: '练习在电脑上用 pandas 做，答案用和 CSV 完全相同的数据算，结果应该一模一样。',
  }));

  return (
    <View style={s.page}>
      <NavBar title="数据练习" sub="阶段 1" back />
      <ScrollView contentContainerStyle={s.pad}>
        <SectionTitle title="数据集" />
        <View style={s.card}>
          {Object.entries(BENCH).map(([c, n]) => {
            const b = idx.data?.[c];
            return (
              <View key={c} style={s.ds}>
                <View style={s.grow}>
                  <Text style={s.dsT}>{n} 指数日线</Text>
                  <Text style={s.dsSub}>
                    {b?.length
                      ? b.length +
                        ' 行 · ' +
                        b[0].date +
                        ' → ' +
                        b[b.length - 1].date +
                        ' · 点位'
                      : idx.loading
                      ? '加载中…'
                      : idx.error ?? '没取到'}
                  </Text>
                </View>
                <Button
                  title="导出"
                  small
                  disabled={!b?.length}
                  onPress={() =>
                    b && doExport(n + '_日线.csv', barsCsv(b), b.length)
                  }
                />
              </View>
            );
          })}
          <View style={s.ds}>
            <View style={s.grow}>
              <Text style={s.dsT}>30 只股票前复权日线（长表）</Text>
              <Text style={s.dsSub}>
                {stocks
                  ? Object.keys(stocks).length +
                    ' 只 · 每只最近 300 个交易日 · date, code, name, open, close, high, low, volume'
                  : '25 只大盘股 + 你的持仓和自选，要请求 30 次，点「加载」再取'}
              </Text>
            </View>
            {stocks ? (
              <Button
                title="导出"
                small
                onPress={() =>
                  doExport(
                    'stocks_qfq_day.csv',
                    longCsv(stocks, nameOf),
                    Object.values(stocks).reduce((t, b) => t + b.length, 0),
                  )
                }
              />
            ) : (
              <Button
                title={loadingStocks ? '加载中' : '加载'}
                small
                disabled={loadingStocks}
                onPress={loadStocks}
              />
            )}
          </View>
          <View style={s.ds}>
            <View style={s.grow}>
              <Text style={s.dsT}>我的交割单</Text>
              <Text style={s.dsSub}>{ledger.length} 条</Text>
            </View>
            <Button
              title="导出"
              small
              disabled={!ledger.length}
              onPress={() =>
                doExport(
                  ledgerFileName(core.sim.engine.state.date),
                  ledgerCsv(ledger, {
                    nameOf,
                    decimalsOf: c =>
                      core.sim.security(c)?.board === 'etf' ? 3 : 2,
                  }),
                  ledger.length,
                )
              }
            />
          </View>
        </View>
        <SectionTitle title="练习 1：指数的收益和风险" />
        <View style={s.card}>
          <Text style={s.desc}>
            用沪深300、中证800
            日线算每年收益率、年化波动率、最大回撤（起止日期）、最近 250
            个交易日滚动收益，并画净值曲线。
          </Text>
          <View style={s.btns}>
            <Button
              title={show.h1 ? '收起提示' : '看提示'}
              small
              onPress={() => toggle('h1')}
            />
            <Button
              title={show.a1 ? '收起答案' : '对答案'}
              tone="learn"
              small
              onPress={() => toggle('a1')}
            />
          </View>
          {show.h1 ? <Code lines={HINTS.ex1} /> : null}
          {show.a1
            ? Object.entries(BENCH).map(([c, n]) =>
                stats[c] ? (
                  <StatsTable key={c} name={n} st={stats[c]!} />
                ) : null,
              )
            : null}
          {show.a1 ? (
            <Text style={s.small}>
              每年收益 = 当年最后一个收盘价 ÷ 上一年最后一个收盘价 −
              1；数据第一年没有上一年，用第一天的开盘价。
            </Text>
          ) : null}
        </View>
        <SectionTitle title="练习 2：交割单按月汇总费用" />
        <View style={s.card}>
          <Text style={s.desc}>
            把你的交割单 CSV 读进 pandas，只保留买卖，按月汇总各项费用。
          </Text>
          <View style={s.btns}>
            <Button
              title={show.h2 ? '收起提示' : '看提示'}
              small
              onPress={() => toggle('h2')}
            />
            <Button
              title={show.a2 ? '收起答案' : '对答案'}
              tone="learn"
              small
              onPress={() => toggle('a2')}
            />
          </View>
          {show.h2 ? <Code lines={HINTS.ex2} /> : null}
          {show.a2 ? (
            fees.length ? (
              <View style={s.tbl}>
                <View style={s.tr}>
                  {['月份', '笔数', '佣金', '印花税', '过户费', '合计'].map(
                    h => (
                      <Text key={h} style={[s.td, s.th]}>
                        {h}
                      </Text>
                    ),
                  )}
                </View>
                {fees.map(f => (
                  <View key={f.month} style={s.tr}>
                    <Text style={[s.td, num]}>{f.month}</Text>
                    <Text style={[s.td, num]}>{f.trades}</Text>
                    <Text style={[s.td, num]}>{formatFen(f.commission)}</Text>
                    <Text style={[s.td, num]}>{formatFen(f.stamp)}</Text>
                    <Text style={[s.td, num]}>{formatFen(f.transfer)}</Text>
                    <Text style={[s.td, num]}>{formatFen(f.total)}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={s.small}>还没有买卖记录。</Text>
            )
          ) : null}
        </View>
        <SectionTitle title="练习 3：截面排名（通关标准）" />
        <View style={s.card}>
          <Text style={s.desc}>
            不写 for 循环，10 行左右算出每只股票过去 20 日收益在当天的排名（1 =
            涨得最多）。用股票长表。
          </Text>
          <View style={s.btns}>
            <Button
              title={show.h3 ? '收起提示' : '看提示'}
              small
              onPress={() => toggle('h3')}
            />
            <Button
              title={show.a3 ? '收起答案' : '对答案'}
              tone="learn"
              small
              disabled={!stocks}
              onPress={() => toggle('a3')}
            />
          </View>
          {!stocks ? <Text style={s.small}>先在上面加载股票长表。</Text> : null}
          {show.h3 ? <Code lines={HINTS.ex3} /> : null}
          {show.a3 && ranking ? (
            <View style={s.tbl}>
              <Text style={s.tblH}>{ranking.date}（最新一天）</Text>
              {ranking.rows.map(r => (
                <View key={r.code} style={s.tr}>
                  <Text style={[s.tdN, num]}>{r.rank}</Text>
                  <Text style={s.tdK}>
                    {nameOf(r.code)} {r.code.slice(2)}
                  </Text>
                  <Text
                    style={[
                      s.tdV,
                      num,
                      { color: r.ret20 >= 0 ? color.up : color.down },
                    ]}
                  >
                    {pct(r.ret20)}
                  </Text>
                </View>
              ))}
              <Text style={s.small}>
                用前复权收盘价；交易时段里今天的「收盘价」是最新价。最新一天停牌的股票不参与排名。
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <AiFab />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { paddingBottom: 90 },
  card: { backgroundColor: color.card, marginTop: 8 },
  grow: { flex: 1 },
  ds: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: PAD,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  dsT: { fontSize: 15, color: color.ink },
  dsSub: { fontSize: 11.5, lineHeight: 16, color: color.ink3, marginTop: 2 },
  desc: {
    fontSize: 13,
    lineHeight: 20,
    color: color.ink2,
    paddingHorizontal: PAD,
    paddingTop: 10,
  },
  btns: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: PAD,
    paddingVertical: 10,
  },
  code: {
    marginHorizontal: PAD,
    marginBottom: 10,
    backgroundColor: color.press,
    borderRadius: 6,
    padding: 8,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 11.5,
    lineHeight: 17,
    color: color.ink,
  },
  tbl: { paddingHorizontal: PAD, paddingBottom: 10 },
  tblH: {
    fontSize: 14,
    fontWeight: '600',
    color: color.ink,
    marginVertical: 6,
  },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  td: { flex: 1, fontSize: 12, color: color.ink, textAlign: 'right' },
  th: { color: color.ink3 },
  tdK: { flex: 1, fontSize: 13, color: color.ink2 },
  tdN: { width: 34, fontSize: 13, color: color.ink3 },
  tdV: { fontSize: 13, color: color.ink, fontWeight: '500' },
  small: {
    fontSize: 11.5,
    lineHeight: 17,
    color: color.ink3,
    paddingHorizontal: PAD,
    paddingBottom: 10,
  },
});
