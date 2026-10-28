import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, CheckCircle2, Circle } from 'lucide-react-native';
import { exportText, importText } from '../../app/exportFile';
import { isLive } from '../../engine/account';
import { addDays } from '../../engine/calendar';
import { formatFen } from '../../engine/units';
import { riskOf, riskText } from '../../engine/risk';
import { formatSec } from '../../engine/session';
import { PortfolioService } from '../../portfolio/service';
import * as portfolio from '../../portfolio/repo';
import { reportCsv } from '../../portfolio/report';
import {
  normalizeCode,
  parseTargets,
  TARGET_CSV,
} from '../../portfolio/targets';
import {
  DEFAULT_STRATEGY,
  type Plan,
  type Rebalance,
  type StrategyInput,
  type TargetFile,
} from '../../portfolio/types';
import { AiFab, NavBar } from '../components/ui';
import {
  PortfolioButton as Button,
  PortfolioSegments as Segmented,
  useReducedMotion,
} from '../components/PortfolioControls';
import {
  useAiContext,
  useCore,
  useLive,
  usePolling,
  useQuoteCodes,
  useViewLog,
} from '../hooks';
import type { RootScreenProps } from '../navigation/types';
import { color, num } from '../theme';

const money = (n: number | null) =>
  n == null ? '未计算' : formatFen(n) + ' 元';
const price = (n: number | null) => (n == null ? '—' : (n / 1000).toFixed(3));
const pct = (n: number) => (n * 100).toFixed(2) + '%';
const STATUS = { draft: '待确认', executing: '执行中', reported: '已复盘' };

export function PortfolioField({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  numeric?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={color.ink2}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        multiline={multiline}
        style={[s.input, multiline && s.multiline]}
        textAlignVertical={multiline ? 'top' : 'center'}
        autoCapitalize="none"
      />
    </View>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.metric}>
      <Text style={s.sub}>{label}</Text>
      <Text style={[s.value, num]}>{value}</Text>
    </View>
  );
}
function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <Text accessibilityRole="alert" style={s.error}>
      {error}
    </Text>
  ) : null;
}
function useTask() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<void>) => {
    if (lock.current) {
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function PortfolioScreen({ navigation }: RootScreenProps<'Portfolio'>) {
  const core = useCore();
  useLive();
  const [rev, setRev] = useState(0),
    [skip, setSkip] = useState(false),
    [skipDate, setSkipDate] = useState(core.sim.now().date),
    [reason, setReason] = useState('');
  const task = useTask(),
    insets = useSafeAreaInsets();
  const data = usePolling(
    async () => ({
      strategies: await portfolio.strategies(core.db),
      runs: await portfolio.rebalances(core.db, core.sim.accountId),
      reports: await portfolio.reports(core.db, core.sim.accountId),
      skips: await core.db.all<{ week: string; reason: string }>(
        'SELECT week,reason FROM weekly_skip WHERE account_id=? ORDER BY week DESC',
        [core.sim.accountId],
      ),
    }),
    [core.sim.accountId, rev],
    3000,
  );
  const today = core.sim.now().date,
    week = portfolio.weekOf(today),
    runs = data.data?.runs ?? [],
    reports = data.data?.reports ?? [];
  const active =
    runs.find(r => r.status === 'executing') ??
    runs.find(r => r.status === 'draft');
  const n = portfolio.streak(
      reports.map(r => r.week),
      today,
    ),
    done = reports.some(r => r.week === week);
  useViewLog('Portfolio', '组合与调仓');
  useAiContext('Portfolio', () => ({
    name: '组合与调仓',
    lines: [
      `本周 ${week}，${done ? '已复盘' : '待复盘'}`,
      `连续 ${n} 周`,
      ...runs
        .slice(0, 5)
        .map(
          r => `${r.strategy.name} v${r.strategy.version} ${STATUS[r.status]}`,
        ),
    ],
  }));
  return (
    <View style={s.page}>
      <NavBar
        title="组合与调仓"
        back
        right={
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [s.navAction, pressed && s.pressed]}
            onPress={() => navigation.navigate('DataCenter')}
          >
            <Text style={s.link}>数据中心</Text>
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + 90 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.hero}>
          <Text style={s.title}>
            {active
              ? '继续这次调仓'
              : done
              ? '本周已完成复盘'
              : '准备本周的调仓'}
          </Text>
          <Text style={s.sub}>
            {week} — {addDays(week, 6)}
          </Text>
          <Text style={s.body}>
            {active
              ? `${active.strategy.name} · v${active.strategy.version} · ${
                  STATUS[active.status]
                }`
              : done
              ? '把执行偏差带进下一周的决策。'
              : '把目标组合变成可执行的委托，再用成交记录检验计划。'}
          </Text>
          <Button
            title={active ? '继续调仓' : '新建调仓计划'}
            tone="sell"
            style={s.action}
            disabled={data.loading}
            onPress={() =>
              navigation.navigate(
                'Rebalance',
                active ? { id: active.id } : undefined,
              )
            }
          />
          <View style={s.steps}>
            {['目标', '预检', '执行', '复盘'].map((v, i) => (
              <View style={s.step} key={v}>
                {done || (active?.status === 'executing' && i < 2) ? (
                  <CheckCircle2 size={16} color={color.learn} />
                ) : (
                  <Circle size={16} color={color.ink2} />
                )}
                <Text style={s.sub}>{v}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={s.streak}>
          <Text style={s.label}>已连续记录 {n} 周</Text>
          <Text style={s.sub}>阶段 7 目标：连续完成 12 周</Text>
        </View>
        <View style={s.heading}>
          <Pressable
            style={({ pressed }) => [s.navAction, pressed && s.pressed]}
            accessibilityRole="button"
            onPress={() => navigation.navigate('Proposals')}
          >
            <Text style={s.link}>AI 提案与记分卡 ›</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.navAction, pressed && s.pressed]}
            accessibilityRole="button"
            onPress={() => navigation.navigate('Settings')}
          >
            <Text style={s.link}>
              风险限额：{riskText(riskOf(core.sim.engine.state))} ›
            </Text>
          </Pressable>
        </View>
        <ErrorLine error={data.error ?? task.error} />
        <View style={s.heading}>
          <Text style={s.h2}>我的策略</Text>
          <Pressable
            style={({ pressed }) => [s.navAction, pressed && s.pressed]}
            accessibilityRole="button"
            onPress={() => navigation.navigate('Strategy')}
          >
            <Text style={s.link}>新建策略</Text>
          </Pressable>
        </View>
        {!data.loading && !data.data?.strategies.length ? (
          <Text style={s.empty}>
            先写下股票池、补单规则和交易纪律。每次修改都会保留一个新版本。
          </Text>
        ) : null}
        {data.data?.strategies.map(st => (
          <Pressable
            key={st.id}
            accessibilityRole="button"
            style={({ pressed }) => [s.listRow, pressed && s.pressed]}
            onPress={() => navigation.navigate('Strategy', { id: st.id })}
          >
            <View style={s.grow}>
              <Text style={s.label}>
                {st.name} <Text style={s.sub}>v{st.version}</Text>
              </Text>
              <Text style={s.sub}>{st.frequency}</Text>
            </View>
            <ChevronRight size={18} color={color.ink2} />
          </Pressable>
        ))}
        <Text style={s.h2}>调仓记录</Text>
        {!runs.length ? (
          <Text style={s.empty}>
            {data.loading ? '正在读取记录…' : '第一份执行报告会从这里开始。'}
          </Text>
        ) : (
          runs.map(r => (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              style={({ pressed }) => [s.listRow, pressed && s.pressed]}
              onPress={() => navigation.navigate('Rebalance', { id: r.id })}
            >
              <View style={s.grow}>
                <Text style={s.label}>{r.strategy.name}</Text>
                <Text style={s.sub}>
                  {r.executionDate} · v{r.strategy.version}
                </Text>
              </View>
              <Text style={[s.sub, r.status === 'reported' && s.success]}>
                {STATUS[r.status]}
              </Text>
              <ChevronRight size={18} color={color.ink2} />
            </Pressable>
          ))
        )}
        <Pressable
          style={({ pressed }) => [s.navAction, pressed && s.pressed]}
          accessibilityRole="button"
          onPress={() => setSkip(!skip)}
        >
          <Text style={s.link}>登记漏执行原因</Text>
        </Pressable>
        {skip ? (
          <View style={s.panel}>
            <PortfolioField
              label="该周日期"
              value={skipDate}
              onChange={setSkipDate}
            />
            <PortfolioField
              label="漏执行原因"
              value={reason}
              onChange={setReason}
              multiline
            />
            <Button
              title="保存原因"
              loading={task.busy}
              disabled={task.busy}
              onPress={() =>
                task.run(async () => {
                  await portfolio.saveSkip(
                    core.db,
                    core.sim.accountId,
                    skipDate,
                    today,
                    reason,
                  );
                  setSkip(false);
                  setRev(rev + 1);
                })
              }
            />
            <Text style={s.sub}>漏执行原因会保留，但不计入连续周数。</Text>
          </View>
        ) : null}
        {data.data?.skips.map(x => (
          <Text key={x.week} style={s.sub}>
            {x.week} · 漏执行：{x.reason}
          </Text>
        ))}
      </ScrollView>
      <AiFab />
    </View>
  );
}

export function StrategyScreen({
  route,
  navigation,
}: RootScreenProps<'Strategy'>) {
  const core = useCore(),
    task = useTask(),
    insets = useSafeAreaInsets();
  const [form, setForm] = useState<StrategyInput>({ ...DEFAULT_STRATEGY }),
    [max, setMax] = useState('30');
  const data = usePolling(
    async () => {
      const st = (await portfolio.strategies(core.db)).find(
        x => x.id === route.params?.id,
      );
      if (st) {
        setForm(st);
        setMax(String(st.maxWeight * 100));
      }
      return st ?? null;
    },
    [route.params?.id],
    null,
  );
  const change = (k: keyof StrategyInput, v: string) =>
    setForm({ ...form, [k]: v });
  useViewLog('Strategy', '策略设置');
  useAiContext('Strategy', () => ({
    name: '策略设置',
    lines: [form.name, form.pool, form.discipline],
  }));
  return (
    <KeyboardAvoidingView style={s.page} behavior="height">
      <NavBar title={route.params?.id ? '修改策略' : '新建策略'} back />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
      >
        <Text style={s.body}>先约定怎样执行，再看这一周的结果。</Text>
        <PortfolioField
          label="策略名称"
          value={form.name}
          onChange={v => change('name', v)}
        />
        <PortfolioField
          label="股票池"
          value={form.pool}
          onChange={v => change('pool', v)}
          multiline
        />
        <PortfolioField
          label="调仓频率"
          value={form.frequency}
          onChange={v => change('frequency', v)}
        />
        <PortfolioField
          label="基准代码"
          value={form.benchmark}
          onChange={v => change('benchmark', v)}
        />
        <PortfolioField
          label="单票上限（%）"
          value={max}
          onChange={setMax}
          numeric
        />
        <Text style={s.h2}>未成交处理</Text>
        <Segmented
          items={[
            ['once', '补报一次'],
            ['none', '不补报'],
          ]}
          value={form.retry}
          onChange={v => setForm({ ...form, retry: v })}
        />
        <Text style={s.body}>
          {form.retry === 'once'
            ? '9:30 后，未成交买单撤单后按卖一价补报一次；14:50 撤销剩余委托。'
            : '不补报；14:50 撤销剩余委托。'}
          只在行情跟踪运行时执行，错过当日窗口后不追单。
        </Text>
        <PortfolioField
          label="交易纪律"
          value={form.discipline}
          onChange={v => change('discipline', v)}
          multiline
        />
        <Text style={s.sub}>
          股票池、频率和纪律用于人工核对；单票上限与计划外交易会在报告中标记。
        </Text>
        <ErrorLine error={task.error ?? data.error} />
        <Button
          style={s.action}
          tone="sell"
          title={route.params?.id ? '保存为新版本' : '保存策略'}
          loading={task.busy}
          disabled={task.busy || data.loading}
          onPress={() =>
            task.run(async () => {
              await portfolio.saveStrategy(
                core.db,
                { ...form, maxWeight: Number(max) / 100 },
                route.params?.id,
              );
              navigation.goBack();
            })
          }
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function RebalanceScreen({
  route,
  navigation,
}: RootScreenProps<'Rebalance'>) {
  const core = useCore();
  useLive();
  const insets = useSafeAreaInsets(),
    task = useTask();
  const reducedMotion = useReducedMotion();
  const service = useMemo(
    () => new PortfolioService(core.db, core.sim, core.client),
    [core],
  );
  const [id, setId] = useState(route.params?.id),
    [revision, setRevision] = useState(0),
    [strategyId, setStrategyId] = useState<number>(),
    [mode, setMode] = useState<'manual' | 'file'>('manual'),
    [targetMode, setTargetMode] = useState<'weight' | 'shares'>('weight');
  const [manual, setManual] = useState([{ code: '', value: '' }]),
    [raw, setRaw] = useState(''),
    [plan, setPlan] = useState<Plan | null>(null),
    [targets, setTargets] = useState<TargetFile | null>(null),
    [confirm, setConfirm] = useState<
      'together' | 'sellFirst' | 'cancel' | null
    >(null),
    [note, setNote] = useState(''),
    [thesis, setThesis] = useState('');
  const loaded = usePolling(
    async () => ({
      strategies: await portfolio.strategies(core.db),
      run: id
        ? await portfolio.loadRebalance(core.db, id, core.sim.accountId)
        : null,
      report: id
        ? (await portfolio.reports(core.db, core.sim.accountId)).find(
            r => r.rebalanceId === id,
          )
        : null,
    }),
    [id, revision, core.sim.accountId],
    id ? 2000 : null,
  );
  const run = loaded.data?.run,
    report = loaded.data?.report,
    strategies = loaded.data?.strategies ?? [];
  const strategy = strategies.find(st => st.id === strategyId) ?? strategies[0];
  const current = run?.plan ?? plan;
  const codes = current?.rows.map(r => r.code) ?? [];
  useQuoteCodes(codes);
  const orders = core.sim.engine.state.orders.filter(o =>
    run?.orderIds.includes(o.id),
  );
  const executionRows = (current?.rows ?? [])
    .filter(row => row.request)
    .map(row => {
      const filled = orders
        .filter(o => o.code === row.code)
        .reduce((n, o) => n + o.filled, 0);
      return {
        ...row,
        filled,
        remaining: Math.max(0, row.request!.qty - filled),
      };
    });
  const pendingRetry = executionRows.some(
    row =>
      row.remaining > 0 &&
      row.request?.side === 'B' &&
      (run?.attempts[row.code] ?? 0) < 2 &&
      ((run?.attempts[row.code] ?? 0) === 0 || run?.strategy.retry === 'once'),
  );
  const scroll = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [run?.status, report?.rebalanceId]);
  useViewLog('Rebalance', '调仓计划');
  useAiContext('Rebalance', () => ({
    name: '调仓计划',
    lines: [
      run
        ? `${run.strategy.name} v${run.strategy.version} ${STATUS[run.status]}`
        : '录入目标',
      ...(current?.rows.map(
        r =>
          `${r.name} 当前 ${r.held} → 目标 ${r.targetQty}，${
            r.check && !r.check.ok ? r.check.msg : '预检通过'
          }`,
      ) ?? []),
    ],
  }));
  const preview = () =>
    task.run(async () => {
      const t =
        mode === 'file'
          ? parseTargets(raw)
          : parseTargets(
              JSON.stringify({
                version: 1,
                mode: targetMode,
                targets: manual.map(x => ({
                  code: normalizeCode(x.code),
                  value:
                    targetMode === 'weight'
                      ? Number(x.value) / 100
                      : Number(x.value),
                })),
              }),
            );
      if (manual.some(x => !x.value.trim()) && mode === 'manual') {
        throw new Error('请填写每个标的的目标数值');
      }
      if (!strategy) {
        throw new Error('请先创建策略');
      }
      const p = await service.preview(t);
      setTargets(t);
      setPlan(p);
    });
  const start = async (choice: 'together' | 'sellFirst') => {
    let r: Rebalance;
    if (run) {
      r = run;
    } else {
      if (!strategy || !targets || !plan) {
        throw new Error('请重新预检');
      }
      r = await service.draft(strategy, targets, plan, { thesis });
      setId(r.id);
    }
    await service.execute(r.id, choice);
    setRevision(v => v + 1);
  };
  const reset = () => {
    setId(undefined);
    setPlan(null);
    setTargets(null);
  };
  const hasBlock = current?.rows.some(r => r.check && !r.check.ok) ?? false;
  const canSell =
    current?.rows.some(r => r.request?.side === 'S' && r.check?.ok) &&
    !current?.rows.some(
      r =>
        r.check &&
        !r.check.ok &&
        !(r.request?.side === 'B' && r.check.rule === '可用资金'),
    );
  const editing = !run && !plan;
  return (
    <KeyboardAvoidingView style={s.page} behavior="height">
      <NavBar
        title={
          report
            ? '执行报告'
            : run?.status === 'executing'
            ? '调仓执行'
            : '调仓计划'
        }
        back
        sub={
          run ? `${run.strategy.name} · v${run.strategy.version}` : undefined
        }
      />
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + 80 },
        ]}
      >
        <ErrorLine error={task.error ?? loaded.error} />
        {loaded.loading ? <Text style={s.sub}>读取计划…</Text> : null}
        {editing ? (
          <>
            <Text style={s.title}>本周想持有什么？</Text>
            <Text style={s.body}>
              输入整个账户的目标组合。未列出的现有持仓会生成清仓计划，剩余权重保留现金。
            </Text>
            <Text style={s.h2}>执行策略</Text>
            {strategies.map(st => (
              <Pressable
                key={st.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: strategy?.id === st.id }}
                style={({ pressed }) => [
                  s.choice,
                  strategy?.id === st.id && s.choiceOn,
                  pressed && s.pressed,
                ]}
                onPress={() => setStrategyId(st.id)}
              >
                <Text style={s.label}>
                  {st.name} · v{st.version}
                </Text>
                <Text style={s.sub}>{st.frequency}</Text>
              </Pressable>
            ))}
            <Button
              title="新建策略"
              onPress={() => navigation.navigate('Strategy')}
            />
            <Text style={s.h2}>目标组合</Text>
            <Segmented
              items={[
                ['manual', '手动录入'],
                ['file', '导入文件 / 粘贴'],
              ]}
              value={mode}
              onChange={setMode}
            />
            {mode === 'manual' ? (
              <>
                <Segmented
                  items={[
                    ['weight', '目标权重 %'],
                    ['shares', '目标股数'],
                  ]}
                  value={targetMode}
                  onChange={setTargetMode}
                />
                {manual.map((row, i) => (
                  <View key={i} style={s.targetRow}>
                    <View style={s.grow}>
                      <PortfolioField
                        label={`证券代码 ${i + 1}`}
                        value={row.code}
                        placeholder="如 510300"
                        onChange={v =>
                          setManual(
                            manual.map((x, j) =>
                              i === j ? { ...x, code: v } : x,
                            ),
                          )
                        }
                      />
                    </View>
                    <View style={s.grow}>
                      <PortfolioField
                        label={targetMode === 'weight' ? '权重 %' : '股数'}
                        value={row.value}
                        numeric
                        onChange={v =>
                          setManual(
                            manual.map((x, j) =>
                              i === j ? { ...x, value: v } : x,
                            ),
                          )
                        }
                      />
                    </View>
                    {manual.length > 1 ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`删除标的 ${i + 1}`}
                        style={({ pressed }) => [
                          s.navAction,
                          pressed && s.pressed,
                        ]}
                        onPress={() =>
                          setManual(manual.filter((_, j) => j !== i))
                        }
                      >
                        <Text style={s.link}>删除</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                <Button
                  title="添加标的"
                  onPress={() =>
                    setManual([...manual, { code: '', value: '' }])
                  }
                />
              </>
            ) : (
              <>
                <Button
                  title="选择 CSV / JSON 文件"
                  onPress={() =>
                    task.run(async () => {
                      const text = await importText();
                      if (text != null) {
                        setRaw(text);
                      }
                    })
                  }
                />
                <PortfolioField
                  label="文件内容"
                  value={raw}
                  onChange={setRaw}
                  multiline
                  placeholder={TARGET_CSV}
                />
                <Text style={s.sub}>
                  CSV 首行 version,1，权重可写 30% 或 0.3；JSON 使用
                  version、mode、targets。
                </Text>
                <Button
                  title="导出 CSV 模板"
                  onPress={() =>
                    task.run(async () => {
                      await exportText(
                        'asharesim-targets-v1.csv',
                        TARGET_CSV,
                        'text/csv',
                      );
                    })
                  }
                />
              </>
            )}
            <Button
              style={s.action}
              title={task.busy ? '正在获取行情…' : '生成调仓预检'}
              tone="sell"
              loading={task.busy}
              disabled={task.busy || !strategies.length}
              onPress={preview}
            />
          </>
        ) : null}
        {current && !report ? (
          <>
            {run?.status === 'executing' ? (
              <>
                <Text style={s.title}>跟踪成交，再完成复盘</Text>
                <Text style={s.body}>
                  已完成 {executionRows.filter(r => r.remaining === 0).length}/
                  {executionRows.length} 个标的 · {orders.filter(isLive).length}{' '}
                  笔委托待完成
                </Text>
                <Text style={s.sub}>
                  {orders.some(isLive)
                    ? '等待成交，可点开委托查看详情；14:50 撤销剩余委托。'
                    : pendingRetry
                    ? '仍有买入目标待提交或补报。9:30 后按已确认规则处理，也可停止补单后复盘。'
                    : '委托已结束。写下复盘，生成本周执行报告。'}
                </Text>
                {executionRows.map(row => (
                  <Text key={row.code} style={s.body}>
                    {row.code} · 已成交 {row.filled}/{row.request!.qty} · 未完成{' '}
                    {row.remaining}
                  </Text>
                ))}
                <Text style={s.h2}>委托进度</Text>
                {orders.length ? (
                  orders.map(o => (
                    <Pressable
                      accessibilityRole="button"
                      key={o.id}
                      style={({ pressed }) => [s.listRow, pressed && s.pressed]}
                      onPress={() =>
                        navigation.navigate('OrderDetail', { id: o.id })
                      }
                    >
                      <View style={s.grow}>
                        <Text style={s.label}>
                          {o.code} · {o.side === 'B' ? '买入' : '卖出'} {o.qty}
                        </Text>
                        <Text style={s.sub}>
                          已成交 {o.filled} · {o.status} · {o.no}
                        </Text>
                      </View>
                      <ChevronRight size={18} color={color.ink2} />
                    </Pressable>
                  ))
                ) : (
                  <Text style={s.body}>
                    目标与持仓没有可执行差额。写下原因后完成本周复盘。
                  </Text>
                )}
                {run.notes.map((n, i) => (
                  <Text key={i} style={s.body}>
                    {n}
                  </Text>
                ))}
                <Button
                  title="撤销剩余委托并停止补单"
                  loading={task.busy}
                  disabled={task.busy}
                  onPress={() => setConfirm('cancel')}
                />
                <PortfolioField
                  label="本周复盘"
                  value={note}
                  onChange={setNote}
                  multiline
                  placeholder="为什么这样调仓？实际执行与预期哪里不同？"
                />
                <Text style={s.sub}>
                  生成报告后结束本次调仓，尚未提交的部分按放弃记录。
                </Text>
                <Button
                  title="生成执行报告 · 完成本周打卡"
                  tone="learn"
                  style={s.action}
                  loading={task.busy}
                  disabled={task.busy || orders.some(isLive) || !note.trim()}
                  onPress={() =>
                    task.run(async () => {
                      await service.finish(run.id, note);
                      setRevision(v => v + 1);
                    })
                  }
                />
              </>
            ) : null}
            <Text style={s.title}>
              {run?.status === 'executing'
                ? '预检记录'
                : '确认前，先看能否执行'}
            </Text>
            <View style={s.metrics}>
              <Metric label="预检可用资金" value={money(current.available)} />
              <Metric label="买入需冻结" value={money(current.buyNeed)} />
              <Metric
                label="整手权重偏离合计"
                value={pct(current.weightError)}
              />
            </View>
            <Text style={s.sub}>
              生成于 {current.date} {formatSec(current.t)} · 按已确认限价和数量提交
            </Text>
            {current.buyNeed > current.available ? (
              <View style={s.warning}>
                <Text style={s.warningText}>
                  资金缺口 {money(current.buyNeed - current.available)}
                  。可以降低目标权重留出现金缓冲，或先卖后买。卖单未成交前不会释放买入资金。
                </Text>
              </View>
            ) : null}
            <Text style={s.h2}>逐笔计划</Text>
            {current.rows.map(r => (
              <View key={r.code} style={s.planRow}>
                <View style={s.heading}>
                  <Text style={s.label}>
                    {r.name} <Text style={s.sub}>{r.code}</Text>
                  </Text>
                  <Text
                    style={[
                      s.label,
                      {
                        color: r.request?.side === 'S' ? color.sell : color.ink,
                      },
                    ]}
                  >
                    {r.request
                      ? `${r.request.side === 'B' ? '买入' : '卖出'} ${
                          r.request.qty
                        }`
                      : '无需交易'}
                  </Text>
                </View>
                <Text style={s.body}>
                  持仓 {r.held} → {r.targetQty} · 可卖 {r.sellable}
                </Text>
                <Text style={s.sub}>
                  决策价 {price(r.decisionPrice)} · 预估费用 {money(r.fee)} ·
                  权重误差 {pct(r.weightError)}
                </Text>
                {r.minExtra > 0 ? (
                  <Text style={s.warningText}>
                    最低佣金增加 {money(r.minExtra)}
                  </Text>
                ) : null}
                {r.check && !r.check.ok ? (
                  <Text style={s.error}>{r.check.msg}</Text>
                ) : r.request ? (
                  <Text style={s.success}>预检通过</Text>
                ) : null}
                {r.warnings.map(w => (
                  <Text style={s.warningText} key={w}>
                    {w}
                  </Text>
                ))}
              </View>
            ))}
            {!run || run.status === 'draft' ? (
              <>
                <Text style={s.body}>
                  确认后将按策略处理未成交委托；先卖后买在 9:30
                  后提交买单。14:50 撤销剩余委托。
                </Text>
                {!run ? (
                  <PortfolioField
                    label="这次调仓的理由（写进决策日志，可选）"
                    value={thesis}
                    onChange={setThesis}
                    multiline
                    placeholder="信号是什么？预期多久见效？"
                  />
                ) : null}
                <Button
                  title="批量确认"
                  tone="sell"
                  style={s.action}
                  loading={task.busy}
                  disabled={task.busy || hasBlock}
                  onPress={() => setConfirm('together')}
                />
                {canSell ? (
                  <Button
                    title="先卖后买"
                    style={s.action}
                    loading={task.busy}
                    disabled={task.busy}
                    onPress={() => setConfirm('sellFirst')}
                  />
                ) : null}
                <Button
                  title="修改目标 / 重新预检"
                  style={s.action}
                  onPress={() => {
                    if (run) {
                      setRaw(JSON.stringify(run.targets, null, 2));
                      setMode('file');
                      setStrategyId(run.strategy.id);
                    }
                    task.run(async () => {
                      if (run) {
                        await service.discardDraft(run.id);
                      }
                      reset();
                    });
                  }}
                />
              </>
            ) : null}
          </>
        ) : null}
        {report ? (
          <>
            <Text style={s.title}>这一周，计划与成交差在哪</Text>
            <Text style={s.sub}>
              {report.week} 周 · {report.strategy.name} v
              {report.strategy.version}
            </Text>
            <View style={s.metrics}>
              <Metric
                label="实现损失（含实际费用）"
                value={money(report.implementationShortfall)}
              />
              <Metric
                label="相对回测基线多损失"
                value={money(report.shortfall)}
              />
              <Metric
                label="基线费用（不设最低佣金）"
                value={money(report.idealFees)}
              />
              <Metric label="价格滑点" value={money(report.slippage)} />
              <Metric label="实际费用" value={money(report.fees)} />
              <Metric label="其中最低佣金增加" value={money(report.minExtra)} />
              <Metric
                label="未成交机会损失"
                value={money(report.opportunity)}
              />
              <Metric label="整手机会损失" value={money(report.rounding)} />
            </View>
            <Text style={s.sub}>
              正数表示较理想执行更差。基线为全部目标按决策价成交、按费率计费；未成交及整手差额按报告日价格计价，缺少报告日行情时不计算。
            </Text>
            {report.rows.map(r => (
              <View key={r.code} style={s.planRow}>
                <Text style={s.label}>
                  {r.name} · 成交 {r.filled}/{r.requested}
                </Text>
                <Text style={s.body}>
                  决策 {price(r.decisionPrice)} → 下单{' '}
                  {r.orderPrices.map(price).join(' / ') || '—'} → 均价{' '}
                  {price(r.averagePrice)}
                </Text>
                <Text style={s.sub}>
                  成交比例 {pct(r.fillRatio)} · 费用 {money(r.fees)} · 滑点{' '}
                  {money(r.slippage)}
                </Text>
                {r.reason ? (
                  <Text style={s.warningText}>{r.reason}</Text>
                ) : null}
                {r.fillIds.map(fid => (
                  <Pressable
                    accessibilityRole="button"
                    key={fid}
                    style={({ pressed }) => [s.navAction, pressed && s.pressed]}
                    onPress={() =>
                      navigation.navigate('FillDetail', { id: fid })
                    }
                  >
                    <Text style={s.link}>查看成交 #{fid} 与费用</Text>
                  </Pressable>
                ))}
                <Text style={s.sub}>
                  交割记录：{r.ledgerIds.join('、') || '无成交记录'}
                </Text>
              </View>
            ))}
            <Text style={s.h2}>纪律检查</Text>
            {report.violations.length ? (
              report.violations.map((v, i) => (
                <Text style={s.warningText} key={i}>
                  {v}
                </Text>
              ))
            ) : (
              <Text style={s.body}>
                未发现计划外委托、相反方向委托或计划单票超限。
              </Text>
            )}
            <Text style={s.h2}>本周复盘</Text>
            <Text style={s.body}>{report.note}</Text>
            <Button
              title="导出执行明细 CSV"
              style={s.action}
              onPress={() =>
                task.run(async () => {
                  await exportText(
                    `执行报告-${report.rebalanceId}.csv`,
                    reportCsv(report),
                    'text/csv',
                  );
                })
              }
            />
            <Button
              title="导出完整报告 JSON"
              style={s.action}
              onPress={() =>
                task.run(async () => {
                  await exportText(
                    `执行报告-${report.rebalanceId}.json`,
                    JSON.stringify(report, null, 2),
                    'application/json',
                  );
                })
              }
            />
            <Button
              title="查看交割单"
              style={s.action}
              onPress={() => navigation.navigate('Orders', { tab: 'ledger' })}
            />
          </>
        ) : null}
      </ScrollView>
      <Modal
        visible={confirm !== null}
        transparent
        animationType={reducedMotion ? 'none' : 'fade'}
        onRequestClose={() => setConfirm(null)}
      >
        <View style={s.mask}>
          <View style={s.dialog} accessibilityViewIsModal>
            <Text style={s.h2}>
              {confirm === 'cancel' ? '结束未完成委托' : '批量委托确认'}
            </Text>
            <ScrollView style={s.confirmScroll}>
              {confirm === 'cancel' ? (
                <Text style={s.body}>
                  撤销本次调仓的剩余委托，停止补报。已成交记录会保留。
                </Text>
              ) : (
                <>
                  <Text style={s.body}>
                    {confirm === 'sellFirst'
                      ? '先提交卖单，9:30 后以实有资金执行买单。'
                      : '按以下数量和价格提交全部委托。'}
                  </Text>
                  {current?.rows
                    .filter(r => r.request)
                    .map(r => (
                      <View key={r.code} style={s.confirmRow}>
                        <Text style={s.label}>
                          {r.name} · {r.request!.side === 'B' ? '买入' : '卖出'}{' '}
                          {r.request!.qty}
                        </Text>
                        <Text style={s.sub}>
                          限价 {price(r.decisionPrice)} ·{' '}
                          {r.check && !r.check.ok ? r.check.msg : '校验通过'}
                        </Text>
                      </View>
                    ))}
                  <Text style={s.body}>
                    {(run?.strategy ?? strategy)?.retry === 'once'
                      ? '授权 9:30 后未成交买单按卖一价补报一次。'
                      : '不自动补报。'}
                    14:50 撤销剩余委托。
                  </Text>
                </>
              )}
            </ScrollView>
            <Button
              title={task.busy ? '提交中…' : '确认执行'}
              tone="sell"
              style={s.action}
              loading={task.busy}
              disabled={task.busy}
              onPress={() => {
                const choice = confirm;
                setConfirm(null);
                task.run(async () => {
                  if (choice === 'cancel' && id) {
                    await service.cancelRemaining(id);
                    setRevision(v => v + 1);
                  } else if (choice === 'together' || choice === 'sellFirst') {
                    await start(choice);
                  }
                });
              }}
            />
            <Button
              title="返回检查"
              style={s.action}
              onPress={() => setConfirm(null)}
            />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  pressed: { opacity: 0.7 },
  page: { flex: 1, backgroundColor: color.bg },
  content: { padding: 16, gap: 12 },
  hero: { backgroundColor: color.card, padding: 20, borderRadius: 12, gap: 12 },
  title: { fontSize: 24, lineHeight: 33, fontWeight: '600', color: color.ink },
  h2: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600',
    color: color.ink,
    marginTop: 12,
  },
  label: { fontSize: 15, lineHeight: 23, fontWeight: '600', color: color.ink },
  sub: { fontSize: 13, lineHeight: 20, color: color.ink2 },
  body: { fontSize: 15, lineHeight: 24, color: color.ink },
  link: { fontSize: 14, color: color.sell },
  action: { minHeight: 48, marginTop: 8 },
  navAction: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 },
  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginTop: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  streak: { gap: 4, paddingVertical: 10 },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  listRow: {
    backgroundColor: color.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  grow: { flex: 1 },
  empty: {
    fontSize: 15,
    lineHeight: 24,
    color: color.ink2,
    paddingVertical: 16,
  },
  field: { gap: 8, marginVertical: 8 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: color.baseLine,
    borderRadius: 6,
    padding: 12,
    fontSize: 15,
    lineHeight: 23,
    color: color.ink,
    backgroundColor: color.card,
  },
  multiline: { minHeight: 120 },
  panel: { padding: 16, backgroundColor: color.card, gap: 10 },
  choice: {
    padding: 16,
    minHeight: 64,
    borderWidth: 1,
    borderColor: color.baseLine,
    borderRadius: 8,
    gap: 4,
  },
  choiceOn: { borderColor: color.sell, backgroundColor: color.card },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
    paddingVertical: 12,
  },
  metric: { minWidth: '42%', flexGrow: 1, gap: 6 },
  value: { fontSize: 20, lineHeight: 28, fontWeight: '600', color: color.ink },
  planRow: {
    padding: 16,
    backgroundColor: color.card,
    gap: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  error: {
    fontSize: 14,
    lineHeight: 22,
    color: color.warnInk,
    backgroundColor: color.warnBg,
    padding: 12,
  },
  success: { fontSize: 13, lineHeight: 20, color: color.learn },
  warning: { padding: 14, backgroundColor: color.warnBg, borderRadius: 8 },
  warningText: { fontSize: 13, lineHeight: 21, color: color.warnInk },
  mask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 20,
  },
  dialog: {
    maxHeight: '85%',
    padding: 20,
    backgroundColor: color.card,
    borderRadius: 12,
  },
  confirmScroll: { flexGrow: 0 },
  confirmRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
});
