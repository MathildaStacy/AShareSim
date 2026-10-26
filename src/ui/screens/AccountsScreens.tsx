/**
 * 历史账户、历史账户详情、重置账户（M2 第 4 步，PRODUCT_DESIGN §6.3、§10）。
 * 重置时旧账户原样归档（只读，可以查看、导出交割单），新账户从 0 元开始，沿用费率设置和入金上限。
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AppCore } from '../../app/boot';
import * as repo from '../../data/repos';
import { isLive, positions } from '../../engine/account';
import type { AccountState } from '../../engine/types';
import { formatFen } from '../../engine/units';
import { feeSummary } from '../../sim/feeForm';
import { ledgerFileName } from '../../sim/ledgerCsv';
import { ConfirmDialog } from '../components/Dialog';
import { KV } from '../components/form';
import { OrderRow } from '../components/tradeRows';
import {
  AiFab,
  Button,
  Empty,
  NavBar,
  Note,
  SectionTitle,
} from '../components/ui';
import { fmtQty } from '../format';
import { useAiContext, useCore, useLive, useViewLog } from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { color, num, PAD } from '../theme';
import { toast } from '../toast';
import { exportLedger, LedgerTable } from './OrdersScreen';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** 一个账户的摘要（归档账户没有行情，持仓按股数和摊薄成本列）。 */
function brief(st: AccountState) {
  const codes = [...new Set(st.lots.map(l => l.code))];
  return {
    codes,
    fills: st.fills.length,
    live: st.orders.filter(isLive).length,
  };
}

// ---------- 重置账户 ----------

/** 重置确认弹窗：说明归档什么、保留什么；确认后从 0 元开始。 */
export function ResetDialog({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: (reset: boolean) => void;
}) {
  const core = useCore();
  const [busy, setBusy] = useState(false);
  const st = core.sim.engine.state;
  const b = brief(st);
  const ok = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await core.sim.resetAccount();
      core.refresher.kick();
      toast.show('已重置：旧账户已归档，新账户从 0 元开始');
      onClose(true);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), 'bad');
      onClose(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog
      visible={visible}
      title="重置模拟账户"
      rows={[
        { k: '现金', v: formatFen(st.cash) },
        { k: '持仓', v: b.codes.length + ' 只' },
        { k: '成交', v: b.fills + ' 笔' },
        { k: '未完成委托', v: b.live + ' 笔' },
      ]}
      okTitle={busy ? '重置中…' : '归档并重置'}
      okTone="plain"
      onOk={ok}
      onCancel={() => onClose(false)}
    >
      <Text style={s.dialogText}>
        当前账户的资金、持仓、委托、交割单和操作日志原样归档，可以在「历史账户」里查看、导出交割单，不会删除。
        {b.live
          ? '还没完成的 ' + b.live + ' 笔委托随旧账户归档，不再撮合。'
          : ''}
        {'\n'}新账户从 0
        元开始，需要重新银证转账；费率设置、入金上限、设置、自选、快照、AI
        对话和记忆都保留。
      </Text>
    </ConfirmDialog>
  );
}

// ---------- 历史账户 ----------

function useAccounts(core: AppCore) {
  const [rows, setRows] = useState<repo.AccountRow[] | null>(null);
  const load = useCallback(() => {
    repo
      .allAccounts(core.db)
      .then(setRows)
      .catch(() => setRows([]));
  }, [core]);
  useFocusEffect(load);
  return { rows, load };
}

export function AccountsScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  useLive();
  const [reset, setReset] = useState(false);
  const { rows, load } = useAccounts(core);
  const curId = core.sim.accountId;
  // 当前账户用引擎里的最新状态（库里最多晚 15 秒）
  const list = (rows ?? []).map(r =>
    r.id === curId ? { ...r, state: core.sim.engine.state } : r,
  );
  const archived = list.filter(r => r.archivedAt);

  useViewLog('accounts', '查看 历史账户');
  useAiContext('Accounts', () => ({
    name: '历史账户',
    lines: [
      '共 ' + list.length + ' 个账户，已归档 ' + archived.length + ' 个',
      ...list.map(r => {
        const b = brief(r.state);
        return (
          r.name +
          (r.archivedAt
            ? '（已归档 ' + r.archivedAt.slice(0, 10) + '）'
            : '（当前）') +
          '：开户 ' +
          r.createdAt.slice(0, 10) +
          '，累计净入金 ' +
          formatFen(r.state.depositTotal) +
          ' 元，现金 ' +
          formatFen(r.state.cash) +
          ' 元，持仓 ' +
          b.codes.length +
          ' 只，成交 ' +
          b.fills +
          ' 笔'
        );
      }),
    ],
    tip: '重置账户不会删除旧账户：它原样归档、只读，可以查看和导出交割单。',
  }));

  return (
    <View style={s.page}>
      <NavBar title="历史账户" back />
      <ScrollView contentContainerStyle={s.pad}>
        {rows == null ? (
          <Empty text="读取中…" />
        ) : (
          <View style={s.card}>
            {list.map(r => {
              const b = brief(r.state);
              const cur = r.id === curId;
              return (
                <Pressable
                  key={r.id}
                  onPress={
                    cur
                      ? () => nav.navigate('Tabs', { screen: 'Trade' })
                      : () => nav.navigate('ArchivedAccount', { id: r.id })
                  }
                  style={({ pressed }) => [s.acc, pressed && s.pressed]}
                  accessibilityRole="button"
                >
                  <View style={s.grow}>
                    <Text style={s.accName}>
                      {r.name}
                      <Text style={cur ? s.tagCur : s.tagOld}>
                        {cur ? '  当前' : '  已归档'}
                      </Text>
                    </Text>
                    <Text style={[s.accSub, num]}>
                      开户 {r.createdAt.slice(0, 10)}
                      {r.archivedAt
                        ? ' · 归档 ' + r.archivedAt.slice(0, 10)
                        : ''}
                    </Text>
                    <Text style={[s.accSub, num]}>
                      净入金 {formatFen(r.state.depositTotal)} · 现金{' '}
                      {formatFen(r.state.cash)} · 持仓 {b.codes.length} 只 ·
                      成交 {b.fills} 笔
                    </Text>
                  </View>
                  <ChevronRight color={color.ink3} size={20} />
                </Pressable>
              );
            })}
          </View>
        )}
        <Note style={s.note}>
          重置账户：当前账户归档（只读，可以查看和导出交割单），新账户从 0
          元开始，费率设置和入金上限沿用。
        </Note>
        <View style={s.btns}>
          <Button title="重置账户" onPress={() => setReset(true)} />
        </View>
      </ScrollView>
      <ResetDialog
        visible={reset}
        onClose={done => {
          setReset(false);
          if (done) {
            load();
          }
        }}
      />
      <AiFab />
    </View>
  );
}

// ---------- 历史账户详情 ----------

export function ArchivedAccountScreen({
  route,
}: RootScreenProps<'ArchivedAccount'>) {
  const { id } = route.params;
  const core = useCore();
  const [acc, setAcc] = useState<repo.AccountRow | null | undefined>(undefined);
  const [log, setLog] = useState<repo.Activity[]>([]);
  const [busy, setBusy] = useState(false);
  useFocusEffect(
    useCallback(() => {
      repo
        .accountById(core.db, id)
        .then(setAcc)
        .catch(() => setAcc(null));
      repo
        .activityOf(core.db, id, 50)
        .then(setLog)
        .catch(() => undefined);
    }, [core, id]),
  );
  const st = acc?.state;
  const nameOf = (c: string | null) =>
    c ? core.sim.security(c)?.name ?? c.slice(2) : '';
  const decOf = (c: string) =>
    core.sim.security(c)?.board === 'etf' ? (3 as const) : (2 as const);
  // 归档账户没有行情，市值按成本列（价格传 null → 0），只看股数和成本
  const pos = st ? positions(st, () => null) : [];

  useViewLog('archived:' + id, acc ? '查看 历史账户 ' + acc.name : null);
  useAiContext('ArchivedAccount:' + id, () => {
    if (!acc || !st) {
      return { name: '历史账户详情', lines: ['找不到这个账户'] };
    }
    return {
      name: '历史账户 · ' + acc.name,
      lines: [
        acc.name +
          '，开户 ' +
          acc.createdAt.slice(0, 10) +
          '，归档 ' +
          (acc.archivedAt ?? '').slice(0, 10) +
          '，只读',
        '归档时现金 ' +
          formatFen(st.cash) +
          ' 元，累计净入金 ' +
          formatFen(st.depositTotal) +
          ' 元，持仓 ' +
          pos.length +
          ' 只',
        ...pos.map(
          p =>
            '持仓 ' +
            nameOf(p.code) +
            ' ' +
            fmtQty(p.qty) +
            '，摊薄成本 ' +
            formatFen(p.dilutedCost) +
            ' 元',
        ),
        '交割单 ' + st.ledger.length + ' 条，委托 ' + st.orders.length + ' 笔',
        ...st.ledger
          .slice(0, 5)
          .map(
            l =>
              l.date +
              ' ' +
              l.biz +
              (l.code ? ' ' + nameOf(l.code) : '') +
              ' 发生金额 ' +
              formatFen(l.net) +
              '，余额 ' +
              formatFen(l.balance),
          ),
        '费率：' + feeSummary(st.fee),
      ],
    };
  });

  if (acc === undefined) {
    return (
      <View style={s.page}>
        <NavBar title="历史账户" back />
        <Empty text="读取中…" />
      </View>
    );
  }
  if (!acc || !st) {
    return (
      <View style={s.page}>
        <NavBar title="历史账户" back />
        <Empty text="找不到这个账户。" />
      </View>
    );
  }

  const doExport = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await exportLedger(core, st.ledger, ledgerFileName(st.date, acc.name));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.page}>
      <NavBar
        title={acc.name}
        sub={'已归档 ' + (acc.archivedAt ?? '').slice(0, 10) + ' · 只读'}
        back
      />
      <ScrollView contentContainerStyle={s.pad}>
        <View style={s.card}>
          <SectionTitle title="归档时的资金" />
          <KV k="现金" v={formatFen(st.cash)} />
          <KV k="累计净入金" v={formatFen(st.depositTotal)} />
          <KV
            k="开户 / 归档"
            v={
              acc.createdAt.slice(0, 10) +
              ' / ' +
              (acc.archivedAt ?? '').slice(0, 10)
            }
          />
          <KV k="费率" v={feeSummary(st.fee)} />
        </View>
        <SectionTitle title="归档时的持仓" right="没有行情，按成本列" />
        {pos.length ? (
          <View style={s.card}>
            {pos.map(p => (
              <KV
                key={p.code}
                k={nameOf(p.code)}
                v={fmtQty(p.qty)}
                sub={
                  '摊薄成本 ' +
                  formatFen(p.dilutedCost) +
                  ' · 买入均价成本 ' +
                  formatFen(p.averageCost)
                }
              />
            ))}
          </View>
        ) : (
          <Empty text="归档时没有持仓。" />
        )}
        <View style={s.bar}>
          <Text style={s.barText}>
            交割单 {st.ledger.length} 条 · 左右滑动看全部列
          </Text>
          <Button
            title={busy ? '导出中…' : '导出 CSV'}
            small
            onPress={doExport}
            disabled={busy || !st.ledger.length}
          />
        </View>
        {st.ledger.length ? (
          <LedgerTable
            rows={st.ledger}
            regs={st.fee.regsSeparate}
            nameOf={nameOf}
            decOf={decOf}
            onPress={() => undefined}
          />
        ) : (
          <Empty text="没有交割单。" />
        )}
        <SectionTitle title="委托" right={st.orders.length + ' 笔'} />
        {st.orders.length ? (
          st.orders
            .slice(0, 50)
            .map(o => <OrderRow key={o.id} order={o} today="" />)
        ) : (
          <Empty text="没有委托。" />
        )}
        <SectionTitle title="操作日志" right={'最近 ' + log.length + ' 条'} />
        <View style={s.card}>
          {log.map(a => (
            <Text key={a.id} style={[s.log, num]}>
              {a.ts.slice(0, 16).replace('T', ' ')} [{a.kind}] {a.text}
            </Text>
          ))}
          {!log.length ? <Empty text="没有操作日志。" /> : null}
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
  note: { marginHorizontal: 10, marginTop: 8 },
  grow: { flex: 1 },
  pressed: { backgroundColor: color.press },
  btns: { paddingHorizontal: 10, marginTop: 10 },
  acc: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PAD,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  accName: { fontSize: 15, color: color.ink },
  tagCur: { fontSize: 12, color: color.up },
  tagOld: { fontSize: 12, color: color.ink3 },
  accSub: { fontSize: 12, color: color.ink3, marginTop: 2 },
  dialogText: {
    fontSize: 13,
    lineHeight: 20,
    color: color.ink2,
    marginTop: 10,
  },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: color.card,
    marginTop: 8,
    paddingHorizontal: PAD,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  barText: { fontSize: 12, color: color.ink3 },
  log: {
    fontSize: 12,
    lineHeight: 18,
    color: color.ink2,
    paddingHorizontal: PAD,
    paddingVertical: 3,
  },
});
