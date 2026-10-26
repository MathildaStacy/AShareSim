/**
 * M2 第 1 步的调试页：确认数据层、行情刷新、补撮合和后台跟踪在手机上能跑。
 * 第 2 步换成底部 5 个 Tab 的正式界面。
 */
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { boot, useApp } from './src/app/boot';
import { batterySettings } from './src/app/tracker';
import * as repo from './src/data/repos';
import { available, summary } from './src/engine/account';
import { ruleOf } from './src/engine/securities';
import { formatFen, formatPrice } from './src/engine/units';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <Debug />
    </SafeAreaProvider>
  );
}

const WINDOW_NAME = {
  pre: '盘前',
  session: '交易时段',
  lunch: '午间休市',
  closed: '休市',
};

function Debug() {
  const insets = useSafeAreaInsets();
  const { core, error, status, version } = useApp();
  const [code, setCode] = useState('sh600036');
  const [msg, setMsg] = useState('');
  const [log, setLog] = useState<repo.Activity[]>([]);
  const [watch, setWatch] = useState<string[]>([]);
  const [battery, setBattery] = useState<boolean | null>(null);
  const [stats, setStats] = useState({ rows: 0, days: 0, codes: 0 });

  useEffect(() => {
    boot().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!core) {
      return;
    }
    repo.recentActivity(core.db, 10).then(setLog);
    repo.watchlist(core.db).then(setWatch);
    repo.snapshotStats(core.db).then(setStats);
    batterySettings.isIgnoring().then(setBattery);
  }, [core, version, status]);

  if (error) {
    return <Text style={[styles.pad, styles.err]}>启动失败：{error}</Text>;
  }
  if (!core) {
    return <Text style={styles.pad}>正在打开本地库…</Text>;
  }
  const { sim, refresher, db } = core;
  const state = sim.engine.state;
  const sum = summary(state, c => sim.engine.lastPrice(c));

  const run = async (fn: () => Promise<string>) => {
    try {
      setMsg(await fn());
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const addWatch = () =>
    run(async () => {
      await repo.addWatch(db, code.trim(), new Date().toISOString());
      const list = await repo.watchlist(db);
      sim.setWatchlist(list);
      refresher.kick();
      return '已加入自选：' + code;
    });

  const deposit = () =>
    run(async () => {
      const r = await sim.deposit(10_000_000);
      return r.ok ? '已转入 100,000.00 元' : r.msg;
    });

  const buyAtBid = () =>
    run(async () => {
      const snap = sim.engine.snapshot(code.trim());
      // 收盘后腾讯不给盘口，用最新价
      const price = snap?.bids[0]?.[0] ?? snap?.last;
      if (!snap || price == null) {
        return '还没有这只的行情（先加自选，等刷新）';
      }
      const sec = sim.security(code.trim())!;
      const r = await sim.placeOrder({
        code: sec.code,
        side: 'B',
        kind: 'limit',
        price,
        qty: ruleOf(sec).buyMin,
      });
      refresher.kick();
      return r.ok
        ? '已委托：' + r.order.note
        : '下不了单（' + r.rule + '）：' + r.msg;
    });

  return (
    <ScrollView
      contentContainerStyle={[styles.pad, { paddingTop: insets.top + 8 }]}
    >
      <Text style={styles.h1}>AShareSim · M2 调试页</Text>

      <Text style={styles.h2}>刷新</Text>
      <Text>
        {status
          ? `${WINDOW_NAME[status.window]} · ${
              status.foreground ? '前台' : '后台'
            } · 后台跟踪${status.tracking ? '开' : '关'}`
          : '…'}
      </Text>
      <Text>
        今日请求 {status?.requestsToday ?? 0} 次 · 约{' '}
        {((status?.bytesToday ?? 0) / 1024 / 1024).toFixed(2)} MB
        {status?.lastError ? ' · 出错：' + status.lastError : ''}
      </Text>
      <Text>
        快照 {stats.rows} 条（{stats.codes} 只，{stats.days} 天） · 电池优化
        {battery == null ? '…' : battery ? '已关闭' : '未关闭'}
      </Text>
      <View style={styles.row}>
        <Btn title="关闭电池优化" onPress={batterySettings.request} />
        <Btn
          title="App 设置（省电策略）"
          onPress={batterySettings.openAppSettings}
        />
      </View>

      <Text style={styles.h2}>账户（{state.date}）</Text>
      <Text>
        总资产 {formatFen(sum.total)} · 可用 {formatFen(available(state))} ·
        市值 {formatFen(sum.marketValue)}
      </Text>
      <View style={styles.row}>
        <TextInput
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          style={styles.input}
        />
        <Btn title="加自选" onPress={addWatch} />
        <Btn title="转入 10 万" onPress={deposit} />
        <Btn title="按买一价买最小单位" onPress={buyAtBid} />
      </View>
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}

      <Text style={styles.h2}>自选</Text>
      {watch.map(c => {
        const s = sim.engine.snapshot(c);
        const sec = sim.security(c);
        const info = sim.info(c);
        const d = sec ? ruleOf(sec).decimals : 2;
        return (
          <Text key={c} style={styles.mono}>
            {(info?.name ?? c).padEnd(6, '　')}{' '}
            {s?.last != null ? formatPrice(s.last, d) : '--'}{' '}
            {info?.pct != null ? info.pct.toFixed(2) + '%' : ''}{' '}
            {s
              ? `${String(Math.floor(s.t / 3600)).padStart(2, '0')}:${String(
                  Math.floor((s.t % 3600) / 60),
                ).padStart(2, '0')}:${String(s.t % 60).padStart(2, '0')}`
              : ''}
          </Text>
        );
      })}

      <Text style={styles.h2}>委托</Text>
      {state.orders
        .slice(-5)
        .reverse()
        .map(o => (
          <Text key={o.id} style={styles.small}>
            {o.no} {o.side === 'B' ? '买' : '卖'} {o.code} {o.qty} · {o.status}{' '}
            · {o.note || o.reason}
          </Text>
        ))}

      <Text style={styles.h2}>最近操作</Text>
      {log.map(a => (
        <Text key={a.id} style={styles.small}>
          {a.ts.slice(11, 19)} [{a.kind}] {a.text}
        </Text>
      ))}
    </ScrollView>
  );
}

function Btn({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.btn}>
      <Text style={styles.btnText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16 },
  h1: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  h2: { fontSize: 16, fontWeight: '600', marginTop: 16, marginBottom: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 8,
    minWidth: 110,
  },
  btn: {
    backgroundColor: '#e93030',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  btnText: { color: '#fff' },
  msg: { marginTop: 8, color: '#333' },
  err: { color: '#c00' },
  mono: { fontVariant: ['tabular-nums'], fontSize: 15 },
  small: { fontSize: 12, color: '#444', marginBottom: 2 },
});

export default App;
