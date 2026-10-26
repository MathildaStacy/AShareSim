/**
 * 设置、后台跟踪与省电（M2 第 4 步，PRODUCT_DESIGN §6.3）。每项修改都记操作日志（kind setting）。
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Check } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useApp } from '../../app/boot';
import { updateRefreshSettings } from '../../app/settings';
import { batterySettings, notificationPermission } from '../../app/tracker';
import * as repo from '../../data/repos';
import { formatFen } from '../../engine/units';
import { yuanText } from '../../sim/feeForm';
import type { RefreshSettings } from '../../sim/refresher';
import {
  BACKGROUND_MODE_NAME,
  BACKGROUND_MODE_OPTIONS,
  BACKGROUND_MS_OPTIONS,
  checkDepositCap,
  keepName,
  msName,
  SNAPSHOT_KEEP_OPTIONS,
} from '../../sim/settings';
import { ChoiceRow, FieldRow, KV } from '../components/form';
import { AiFab, Button, NavBar, Note, SectionTitle } from '../components/ui';
import { useAiContext, useCore, useLive, useViewLog } from '../hooks';
import type { RootStackParamList } from '../navigation/types';
import { COST_BASIS_NAME, prefs, usePrefs, type CostBasis } from '../prefs';
import { color, PAD } from '../theme';
import { toast } from '../toast';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const COST_OPTIONS: [CostBasis, string][] = [
  ['diluted', COST_BASIS_NAME.diluted],
  ['average', COST_BASIS_NAME.average],
];

// ---------- 设置 ----------

export function SettingsScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  useLive();
  const sim = core.sim;
  const st = sim.engine.state;
  const basis = usePrefs(p => p.costBasis);
  const [rs, setRs] = useState<RefreshSettings>(core.refresher.settings);
  const [capText, setCapText] = useState(yuanText(st.depositCap));
  const [stats, setStats] = useState({ rows: 0, days: 0, codes: 0 });
  useEffect(() => {
    repo
      .snapshotStats(core.db)
      .then(setStats)
      .catch(() => undefined);
  }, [core, rs.snapshotKeepDays]);
  const cap = checkDepositCap(capText, st.depositTotal);
  const capDirty = cap.ok && cap.fen !== st.depositCap;

  useViewLog('settings', '查看 设置');
  useAiContext('Settings', () => ({
    name: '设置',
    lines: [
      '持仓成本口径：' +
        COST_BASIS_NAME[basis] +
        '（可选：摊薄成本 / 买入均价）',
      '快照保留：' +
        keepName(rs.snapshotKeepDays) +
        '（可选：20 个交易日 / 60 个交易日 / 永久），本地快照 ' +
        stats.rows +
        ' 条（' +
        stats.days +
        ' 天，' +
        stats.codes +
        ' 只）',
      '后台跟踪：' +
        BACKGROUND_MODE_NAME[rs.backgroundMode] +
        '（可选：有委托时自动 / 交易时段全程 / 关闭），后台刷新间隔 ' +
        msName(rs.backgroundMs) +
        '（可选：3 / 5 / 10 / 30 秒），前台固定 3 秒',
      '累计净入金上限 ' +
        formatFen(st.depositCap) +
        ' 元，已转入 ' +
        formatFen(st.depositTotal) +
        ' 元；输入框 ' +
        capText +
        ' 元，' +
        (cap.ok
          ? capDirty
            ? '校验通过，还没保存'
            : '和当前一样'
          : '校验不通过：' + cap.msg),
    ],
  }));

  const applyRs = async (patch: Partial<RefreshSettings>) => {
    const d = await updateRefreshSettings(core, patch);
    setRs(core.refresher.settings);
    if (d.length) {
      toast.show('已保存：' + d.join('，'));
    }
  };

  const saveCap = async () => {
    if (!cap.ok) {
      return;
    }
    await sim.setDepositCap(cap.fen);
    toast.show('累计净入金上限改为 ' + formatFen(cap.fen) + ' 元');
  };

  return (
    <View style={s.page}>
      <NavBar title="设置" back />
      <ScrollView
        contentContainerStyle={s.pad}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.card}>
          <SectionTitle title="持仓" />
          <ChoiceRow
            label="持仓列表的成本口径"
            sub="摊薄成本：卖出盈利、分红会让它下降（同花顺、东方财富默认）。买入均价：只看买入花了多少，卖出不改变它。持仓详情两个都显示"
            items={COST_OPTIONS}
            value={basis}
            onChange={v => {
              prefs.setCostBasis(core, v).catch(() => undefined);
            }}
          />
        </View>
        <View style={s.card}>
          <SectionTitle title="行情快照" />
          <ChoiceRow
            label="快照保留"
            sub={
              '自选、持仓、有委托的证券每 3 秒存一个快照，以后回放用。按有快照的日期数算。现在 ' +
              stats.rows.toLocaleString('zh-CN') +
              ' 条（' +
              stats.days +
              ' 天，' +
              stats.codes +
              ' 只）'
            }
            items={SNAPSHOT_KEEP_OPTIONS}
            value={rs.snapshotKeepDays}
            onChange={v => applyRs({ snapshotKeepDays: v })}
          />
        </View>
        <View style={s.card}>
          <SectionTitle title="后台跟踪" />
          <ChoiceRow
            label="后台跟踪"
            sub="有委托时自动：交易日 9:00–15:30 有今天能成交的委托时开前台服务，只刷新这几只。交易时段全程：完整录快照，流量和电量多一些。关闭：回到 App 时用分时数据补撮合，只按成交价穿过委托价成交（更保守）"
            items={BACKGROUND_MODE_OPTIONS}
            value={rs.backgroundMode}
            onChange={v => applyRs({ backgroundMode: v })}
          />
          <ChoiceRow
            label="后台刷新间隔"
            sub="只影响后台跟踪；前台固定 3 秒"
            items={BACKGROUND_MS_OPTIONS}
            value={rs.backgroundMs}
            onChange={v => applyRs({ backgroundMs: v })}
          />
          <Pressable
            onPress={() => nav.navigate('PowerGuide')}
            style={({ pressed }) => [s.linkRow, pressed && s.pressed]}
            accessibilityRole="button"
          >
            <Text style={s.link}>后台跟踪与省电设置引导（HyperOS）›</Text>
          </Pressable>
        </View>
        <View style={s.card}>
          <SectionTitle title="模拟入金" />
          <FieldRow
            label="累计净入金上限"
            sub={
              '净入金 = 转入 − 转出，现在 ' +
              formatFen(st.depositTotal) +
              ' 元。范围 1 万–1,000 万元'
            }
            value={capText}
            onChangeText={setCapText}
            unit="元"
            error={cap.ok ? null : cap.msg}
          />
          <View style={s.btnRow}>
            <Button
              title="保存上限"
              small
              tone="buy"
              disabled={!capDirty}
              onPress={saveCap}
            />
          </View>
        </View>
        <Note style={s.note}>
          费率在「费率设置」里改；重置账户在「历史账户」里。设置的每次修改都会记进操作日志，AI
          能看到你最近改了什么。
        </Note>
      </ScrollView>
      <AiFab />
    </View>
  );
}

// ---------- 后台跟踪与省电 ----------

type ManualStep = 'saver' | 'autostart' | 'lock';

const MANUAL: Record<ManualStep, string> = {
  saver: '省电策略设为无限制',
  autostart: '自启动已打开',
  lock: '最近任务里已锁定',
};

export function usePowerChecks() {
  const [battery, setBattery] = useState<boolean | null>(null);
  const [notify, setNotify] = useState<boolean | null>(null);
  const refresh = useCallback(() => {
    batterySettings
      .isIgnoring()
      .then(setBattery)
      .catch(() => setBattery(false));
    notificationPermission
      .granted()
      .then(setNotify)
      .catch(() => setNotify(false));
  }, []);
  // 从系统设置回来时重新检测
  useFocusEffect(
    useCallback(() => {
      refresh();
      const sub = AppState.addEventListener('change', a => {
        if (a === 'active') {
          refresh();
        }
      });
      return () => sub.remove();
    }, [refresh]),
  );
  return { battery, notify, refresh };
}

export function PowerGuideScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const status = useApp(st => st.status);
  const { battery, notify, refresh } = usePowerChecks();
  const [manual, setManual] = useState<Record<ManualStep, boolean>>({
    saver: false,
    autostart: false,
    lock: false,
  });
  useEffect(() => {
    repo
      .getSetting(core.db, 'powerGuide', manual)
      .then(setManual)
      .catch(() => undefined);
    // 只在打开时读一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core]);
  const mode = core.refresher.settings.backgroundMode;
  const yn = (v: boolean | null, yes: string, no: string) =>
    v == null ? '检测中' : v ? yes : no;

  const toggle = async (k: ManualStep) => {
    const next = { ...manual, [k]: !manual[k] };
    setManual(next);
    await repo.setSetting(core.db, 'powerGuide', next);
    await core.sim.logSetting(
      '省电设置引导：' + MANUAL[k] + (next[k] ? ' ✓' : ' 取消勾选'),
      { setting: 'powerGuide' },
    );
  };

  useViewLog('powerGuide', '查看 后台跟踪与省电');
  useAiContext('PowerGuide', () => ({
    name: '后台跟踪与省电',
    lines: [
      '后台跟踪模式：' +
        BACKGROUND_MODE_NAME[mode] +
        '，现在' +
        (status?.tracking ? '正在跟踪' : '没在跟踪'),
      '① 系统电池优化：' + yn(battery, '已关闭（不限制）', '没关闭'),
      '② 省电策略无限制：' + (manual.saver ? '已勾选' : '未勾选'),
      '③ 自启动：' + (manual.autostart ? '已勾选' : '未勾选'),
      '④ 最近任务锁定：' + (manual.lock ? '已勾选' : '未勾选'),
      '⑤ 通知权限：' + yn(notify, '已允许', '没允许'),
    ],
    tip: 'HyperOS 杀后台很激进。②–④ 系统不让 App 读取，只能你自己设好后勾选。没设好也不会出错：回到 App 时用分时数据补撮合，只是只能按成交价穿过委托价成交，更保守。',
  }));

  const step = (
    no: string,
    title: string,
    sub: string,
    done: boolean | null,
    action?: { title: string; onPress: () => void },
    manualKey?: ManualStep,
  ) => (
    <View style={s.step}>
      <View style={s.stepTop}>
        <View style={[s.dot, done ? s.dotDone : null]}>
          {done ? (
            <Check color="#FFFFFF" size={14} strokeWidth={3} />
          ) : (
            <Text style={s.dotText}>{no}</Text>
          )}
        </View>
        <View style={s.grow}>
          <Text style={s.stepTitle}>{title}</Text>
          <Text style={s.stepSub}>{sub}</Text>
        </View>
      </View>
      <View style={s.stepBtns}>
        {action ? (
          <Button title={action.title} small onPress={action.onPress} />
        ) : null}
        {manualKey ? (
          <Button
            title={manual[manualKey] ? '已设置 ✓' : '我已设置'}
            small
            tone={manual[manualKey] ? 'plain' : 'ghost'}
            onPress={() => toggle(manualKey)}
          />
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={s.page}>
      <NavBar title="后台跟踪与省电" back />
      <ScrollView contentContainerStyle={s.pad}>
        <Note tone="learn" style={s.note}>
          挂单没成交时，App 在后台每几秒看一次行情，按真实的排队规则撮合。小米
          HyperOS 杀后台很激进，不设置的话 App
          一退到后台就会被停。被停了也不会出错：下次打开时用分时数据补撮合，但只能按「成交价穿过委托价」成交，排队成交补不出来，结果更保守。
        </Note>
        <View style={s.card}>
          <SectionTitle title="现在的状态" />
          <KV
            k="后台跟踪"
            v={BACKGROUND_MODE_NAME[mode]}
            sub={status?.tracking ? '正在跟踪' : '没在跟踪'}
          />
          <KV
            k="系统电池优化"
            v={yn(battery, '已关闭', '没关闭')}
            c={battery ? color.down : battery === false ? color.up : undefined}
          />
          <KV
            k="通知权限"
            v={yn(notify, '已允许', '没允许')}
            c={notify ? color.down : notify === false ? color.up : undefined}
          />
          {mode === 'off' ? (
            <Pressable
              onPress={() => nav.navigate('Settings')}
              style={({ pressed }) => [s.linkRow, pressed && s.pressed]}
            >
              <Text style={s.link}>后台跟踪已关闭，去设置打开 ›</Text>
            </Pressable>
          ) : null}
        </View>
        <SectionTitle title="设置步骤" right="②–④ 要你自己勾选" />
        <View style={s.card}>
          {step(
            '1',
            '关闭电池优化',
            '点按钮会弹出系统对话框，选「允许」。App 能检测到结果。',
            battery,
            { title: '关闭电池优化', onPress: () => batterySettings.request() },
          )}
          {step(
            '2',
            '省电策略：无限制',
            '应用信息 → 省电策略 → 无限制。HyperOS 默认是「智能限制」，会停掉后台服务。',
            manual.saver,
            {
              title: '打开应用信息',
              onPress: () => batterySettings.openAppSettings(),
            },
            'saver',
          )}
          {step(
            '3',
            '自启动：打开',
            '应用信息 → 自启动。被系统清理后，前台服务能自己恢复。',
            manual.autostart,
            {
              title: '打开应用信息',
              onPress: () => batterySettings.openAppSettings(),
            },
            'autostart',
          )}
          {step(
            '4',
            '最近任务里锁定 App',
            '从屏幕底部上滑停住打开最近任务，按住 AShareSim 的卡片（或下拉）选「锁定」，一键清理时就不会被关掉。',
            manual.lock,
            undefined,
            'lock',
          )}
          {step(
            '5',
            '允许通知',
            '后台跟踪的通知显示今日流量和「停止跟踪」按钮。不允许也能跟踪，只是看不到通知。',
            notify,
            {
              title: '允许通知',
              onPress: () => {
                notificationPermission
                  .request()
                  .then(refresh)
                  .catch(() => undefined);
              },
            },
          )}
        </View>
        <Note style={s.note}>
          后台跟踪只在交易日
          9:00–15:30、有今天能成交的委托时开（「交易时段全程」模式一直开），默认
          5
          秒刷新一次，只请求这几只证券。觉得费电、费流量，可以在通知上点「停止跟踪」（当天不再自动开），或在设置里关掉。
        </Note>
      </ScrollView>
      <AiFab />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { paddingBottom: 90 },
  card: { backgroundColor: color.card, marginTop: 8 },
  note: { marginHorizontal: 10, marginTop: 8 },
  grow: { flex: 1 },
  pressed: { backgroundColor: color.press },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: PAD,
    paddingVertical: 10,
  },
  linkRow: { paddingHorizontal: PAD, paddingVertical: 12 },
  link: { fontSize: 14, color: color.sell },
  step: {
    paddingHorizontal: PAD,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  stepTop: { flexDirection: 'row', gap: 10 },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: color.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  dotDone: { backgroundColor: color.down },
  dotText: { fontSize: 12, color: color.ink2, fontWeight: '600' },
  stepTitle: { fontSize: 15, color: color.ink },
  stepSub: { fontSize: 12, lineHeight: 18, color: color.ink3, marginTop: 2 },
  stepBtns: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    marginLeft: 32,
  },
});
