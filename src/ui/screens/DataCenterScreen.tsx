import { useState } from 'react';
import {
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { exportText } from '../../app/exportFile';
import {
  inventory,
  updateBars,
  quality,
  stockDay,
  crossCheck,
  type CrossCheck,
  type StockDay,
} from '../../portfolio/datacenter';
import { normalizeCode } from '../../portfolio/targets';
import type { KBar } from '../../market/tencent';
import { NavBar } from '../components/ui';
import { PortfolioButton as Button } from '../components/PortfolioControls';
import { useAiContext, useCore, usePolling, useViewLog } from '../hooks';
import { color } from '../theme';
import { PortfolioField } from './PortfolioScreens';

export function DataCenterScreen() {
  const core = useCore(),
    insets = useSafeAreaInsets();
  const [code, setCode] = useState('sh510300'),
    [date, setDate] = useState(core.sim.now().date),
    [rev, setRev] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState(''),
    [issues, setIssues] = useState<string[] | null>(null),
    [day, setDay] = useState<StockDay | null | undefined>(),
    [check, setCheck] = useState<CrossCheck | null>(null);
  const stats = usePolling(() => inventory(core.db), [rev], null);
  const run = async (fn: () => Promise<void>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      await fn();
      setRev(v => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const bars = async (c: string) =>
    core.db.all<KBar>(
      'SELECT date,open,close,high,low,volume FROM kline_day WHERE code=? ORDER BY date',
      [c],
    );
  const selectCode = (v: string) => {
    setCode(v);
    setCheck(null);
    setIssues(null);
    setDay(undefined);
  };
  useViewLog('DataCenter', '数据中心');
  useAiContext('DataCenter', () => ({
    name: '数据中心',
    lines: [
      `证券 ${code}，查询日期 ${date}`,
      message,
      ...(issues ?? []),
      ...(check
        ? [
            `腾讯 ${check.tencentDate} / 新浪 ${check.sinaDate}：${
              check.differences.join('；') || '一致'
            }`,
          ]
        : []),
    ],
  }));
  return (
    <KeyboardAvoidingView style={s.page} behavior="height">
      <NavBar title="数据中心" back />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
      >
        <Text style={s.title}>让每次调仓有据可查</Text>
        <Text style={s.body}>
          检查本地记录、补齐日线，再核对行情和当日证券状态。
        </Text>
        {stats.error || error ? (
          <Text accessibilityRole="alert" style={s.error}>
            {error ?? stats.error}
          </Text>
        ) : null}
        {message ? <Text style={s.message}>{message}</Text> : null}
        <View style={s.panel}>
          <PortfolioField label="证券代码" value={code} onChange={selectCode} />
          <Button
            title={busy ? '处理中…' : '增量更新日线'}
            tone="sell"
            loading={busy}
            disabled={busy}
            onPress={() =>
              run(async () => {
                const c = normalizeCode(code);
                await core.sim.ingest(await core.client.quotes([c]));
                const sec = core.sim.security(c);
                if (!sec) {
                  throw new Error('请选择支持的股票或 ETF');
                }
                const count = await updateBars(
                  core.db,
                  core.client,
                  c,
                  sec.type,
                  core.sim.now().date,
                );
                setMessage(`已更新 ${count} 行不复权日线（含重叠日期校正）`);
              })
            }
          />
          <Text style={s.sub}>
            首次取最近 1,000 根；后续从本地最后日期前 7
            天开始更新，当日日线盘中会变化。
          </Text>
          <Button
            title="检查本地数据质量"
            loading={busy}
            disabled={busy}
            onPress={() =>
              run(async () => {
                const b = await bars(normalizeCode(code));
                if (!b.length) {
                  throw new Error('本地没有该证券日线，请先更新');
                }
                setIssues(quality(b, core.sim.calendar));
                setMessage(`已检查 ${b.length} 行日线`);
              })
            }
          />
          {issues ? (
            issues.length ? (
              <View>
                <Text style={s.h2}>待核对 {issues.length} 项</Text>
                {issues.slice(0, 40).map((x, i) => (
                  <Text key={i} style={s.warning}>
                    {x}
                  </Text>
                ))}
                {issues.length > 40 ? (
                  <Text style={s.sub}>
                    其余 {issues.length - 40} 项包含在导出结果中。
                  </Text>
                ) : null}
                <Button
                  title="导出检查结果"
                  onPress={() =>
                    run(async () => {
                      await exportText(
                        '数据质量检查.txt',
                        issues.join('\n'),
                        'text/plain',
                      );
                    })
                  }
                />
              </View>
            ) : (
              <Text style={s.message}>
                OHLC、成交量、重复日期与区间交易日检查通过。
              </Text>
            )
          ) : null}
        </View>
        <Text style={s.h2}>腾讯 / 新浪交叉核对</Text>
        <Text style={s.body}>
          比较最新价、前收、开盘和成交量。时间相差超过 10 秒时单列为“不可比”。
        </Text>
        <Button
          title="核对两家行情"
          loading={busy}
          disabled={busy}
          onPress={() =>
            run(async () => {
              setCheck(
                await crossCheck(core.db, core.client, normalizeCode(code)),
              );
            })
          }
        />
        {check ? (
          <View style={s.panel}>
            <Text style={s.label}>
              {check.code} ·{' '}
              {check.comparable
                ? check.differences.length
                  ? '发现差异'
                  : '字段一致'
                : '报价不可比'}
            </Text>
            <Text style={s.body}>
              腾讯 {(check.tencentPrice ?? 0) / 1000} · {check.tencentDate}{' '}
              {new Date(check.tencentTime * 1000).toISOString().slice(11, 19)}
            </Text>
            <Text style={s.body}>
              新浪 {check.sinaPrice / 1000} · {check.sinaDate} {check.sinaTime}
            </Text>
            {check.differences.map(d => (
              <Text key={d} style={s.warning}>
                {d}
              </Text>
            ))}
            <Text style={s.sub}>核对记录已保存在本地。</Text>
          </View>
        ) : null}
        <Text style={s.h2}>某日证券状态</Text>
        <PortfolioField
          label="日期 YYYY-MM-DD"
          value={date}
          onChange={v => {
            setDate(v);
            setDay(undefined);
          }}
        />
        <Button
          title="查询该日状态"
          loading={busy}
          disabled={busy}
          onPress={() =>
            run(async () => {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                throw new Error('日期格式应为 YYYY-MM-DD');
              }
              setDay(await stockDay(core.db, normalizeCode(code), date));
            })
          }
        />
        {day === null ? (
          <Text style={s.warning}>
            该日没有保存证券状态，不能据此判定是否停牌或属于股票池。状态从安装
            M5 后观察到的行情开始记录。
          </Text>
        ) : day ? (
          <View style={s.panel}>
            <Text style={s.label}>
              {day.name} · {day.date}
            </Text>
            <Text style={s.body}>
              主板且非 ST：{day.mainPool ? '是' : '否'} · 停牌：
              {day.suspended ? '是' : '否'}
            </Text>
            <Text style={s.body}>
              开盘涨停：{day.openUp == null ? '未知' : day.openUp ? '是' : '否'}{' '}
              · 开盘跌停：
              {day.openDown == null ? '未知' : day.openDown ? '是' : '否'}
            </Text>
            <Text style={s.sub}>
              上市满一年：待人工核对。状态观察于 {day.observedAt}。
            </Text>
            <Button
              title="导出该日状态 JSON"
              onPress={() =>
                run(async () => {
                  await exportText(
                    `证券状态-${day.code}-${day.date}.json`,
                    JSON.stringify(day, null, 2),
                    'application/json',
                  );
                })
              }
            />
          </View>
        ) : null}
        <Text style={s.h2}>本地数据</Text>
        {stats.loading ? (
          <Text style={s.sub}>正在读取…</Text>
        ) : (
          stats.data?.map(t => (
            <View key={t.table} style={s.tableRow}>
              <View style={s.grow}>
                <Text style={s.label}>{t.name}</Text>
                <Text style={s.sub}>{t.at ?? '尚无记录'}</Text>
              </View>
              <Text style={s.body}>{t.rows.toLocaleString()} 条</Text>
            </View>
          ))
        )}
        <Text style={s.sub}>
          历史状态按当时观察值保存，不用今天的名称和 ST
          标记倒推过去。日历未确认的年份需人工核对。
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  content: { padding: 16, gap: 14 },
  title: { fontSize: 24, lineHeight: 33, fontWeight: '600', color: color.ink },
  h2: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600',
    color: color.ink,
    marginTop: 12,
  },
  label: { fontSize: 15, lineHeight: 23, fontWeight: '600', color: color.ink },
  body: { fontSize: 15, lineHeight: 24, color: color.ink },
  sub: { fontSize: 13, lineHeight: 20, color: color.ink2 },
  panel: {
    padding: 16,
    gap: 14,
    backgroundColor: color.card,
    borderRadius: 12,
  },
  tableRow: {
    padding: 16,
    backgroundColor: color.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  grow: { flex: 1 },
  warning: { fontSize: 14, lineHeight: 22, color: color.warnInk },
  error: {
    fontSize: 14,
    lineHeight: 22,
    padding: 12,
    color: color.warnInk,
    backgroundColor: color.warnBg,
  },
  message: { fontSize: 14, lineHeight: 22, color: color.learn },
});
