/**
 * 查询：当日委托 / 当日成交 / 历史委托 / 交割单（可导出 CSV）。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AppCore } from '../../app/boot';
import { exportText } from '../../app/exportFile';
import { syncLearn } from '../../app/learn';
import * as repo from '../../data/repos';
import { isLive } from '../../engine/account';
import { ruleOf } from '../../engine/securities';
import { formatSec } from '../../engine/session';
import type { LedgerEntry } from '../../engine/types';
import { formatFen, formatPrice } from '../../engine/units';
import { beijingIso } from '../../market/clock';
import { feeSummary } from '../../sim/feeForm';
import { ledgerCsv, ledgerFileName } from '../../sim/ledgerCsv';
import { ConfirmDialog } from '../components/Dialog';
import { FillRow, OrderRow } from '../components/tradeRows';
import {
  AiFab,
  Button,
  Empty,
  NavBar,
  Segmented,
} from '../components/ui';
import { fmtQty, fmtSignedFen, trendOf } from '../format';
import {
  useAiContext,
  useCore,
  useLive,
  useQuoteCodes,
  useViewLog,
} from '../hooks';
import type {
  OrdersTab,
  RootScreenProps,
  RootStackParamList,
} from '../navigation/types';
import { color, num, PAD, trendColor } from '../theme';
import { toast } from '../toast';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const TABS: [OrdersTab, string][] = [
  ['today', '当日委托'],
  ['fills', '当日成交'],
  ['hist', '历史委托'],
  ['ledger', '交割单'],
];

const TAB_NAME = Object.fromEntries(TABS) as Record<OrdersTab, string>;

export function OrdersScreen({ route }: RootScreenProps<'Orders'>) {
  const core = useCore();
  const nav = useNavigation<Nav>();
  useLive();
  const [tab, setTab] = useState<OrdersTab>(route.params?.tab ?? 'today');
  const [note, setNote] = useState<LedgerEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const st = core.sim.engine.state;
  const today = st.date;
  const nameOf = (c: string | null) =>
    c ? core.sim.security(c)?.name ?? c.slice(2) : '';
  const decOf = (c: string) => {
    const sec = core.sim.security(c);
    return sec ? ruleOf(sec).decimals : 2;
  };

  const todayOrders = st.orders.filter(o => o.date === today || isLive(o));
  const histOrders = st.orders.filter(o => !(o.date === today || isLive(o)));
  const todayFills = st.fills.filter(f => f.date === today);
  const ledger = st.ledger;
  const feeState = feeSummary(st.fee);

  useQuoteCodes([...new Set(todayOrders.filter(isLive).map(o => o.code))]);
  useViewLog('orders:' + tab, '查看 查询 · ' + TAB_NAME[tab]);
  // 看过交割单是路线图阶段 0「集合竞价买 ETF」的最后一步：浏览记下之后检查一次
  useEffect(() => {
    if (tab !== 'ledger') {
      return;
    }
    const timer = setTimeout(() => {
      syncLearn(core).catch(() => undefined);
    }, 800);
    return () => clearTimeout(timer);
  }, [core, tab]);
  useAiContext('Orders:' + tab, () => {
    const lines: string[] = [];
    if (tab === 'today' || tab === 'hist') {
      const list = tab === 'today' ? todayOrders : histOrders;
      lines.push(
        (tab === 'today' ? '当日委托 ' : '历史委托 ') + list.length + ' 笔',
      );
      for (const o of list.slice(0, 8)) {
        lines.push(
          o.no +
            ' ' +
            (o.date === today ? '' : o.date + ' ') +
            formatSec(o.t) +
            ' ' +
            (o.side === 'B' ? '买入 ' : '卖出 ') +
            nameOf(o.code) +
            ' ' +
            (o.price != null && o.kind !== 'after'
              ? formatPrice(o.price, decOf(o.code))
              : o.kind === 'after'
              ? '收盘价'
              : '市价') +
            ' × ' +
            fmtQty(o.qty) +
            '，成交 ' +
            fmtQty(o.filled) +
            '，' +
            o.status +
            (o.reason || o.note ? '（' + (o.reason || o.note) + '）' : ''),
        );
      }
    } else if (tab === 'fills') {
      lines.push('当日成交 ' + todayFills.length + ' 笔');
      for (const f of todayFills.slice(0, 8)) {
        lines.push(
          formatSec(f.t) +
            ' ' +
            (f.side === 'B' ? '买入 ' : '卖出 ') +
            nameOf(f.code) +
            ' ' +
            formatPrice(f.price, decOf(f.code)) +
            ' × ' +
            fmtQty(f.qty) +
            '，金额 ' +
            formatFen(f.amount) +
            ' 元，费用 ' +
            formatFen(f.fee.total) +
            ' 元；依据：' +
            f.basis.text,
        );
      }
    } else {
      lines.push('交割单 ' + ledger.length + ' 条；' + feeState);
      for (const l of ledger.slice(0, 5)) {
        lines.push(
          l.date +
            ' ' +
            l.biz +
            (l.code ? ' ' + nameOf(l.code) : '') +
            (l.qty ? ' ' + fmtQty(l.qty) : '') +
            (l.price ? ' @' + formatPrice(l.price, decOf(l.code!)) : '') +
            '，佣金 ' +
            formatFen(l.fee.commission) +
            '，印花税 ' +
            formatFen(l.fee.stamp) +
            '，过户费 ' +
            formatFen(l.fee.transfer) +
            (l.divTax ? '，红利税 ' + formatFen(l.divTax) : '') +
            '，发生金额 ' +
            fmtSignedFen(l.net) +
            '，余额 ' +
            formatFen(l.balance),
        );
      }
    }
    return {
      name: '查询 · ' + TAB_NAME[tab],
      lines,
      tip:
        tab === 'ledger'
          ? '交割单是每笔资金变动的明细：成交金额、各项费用、发生金额和之后的资金余额，和券商交割单的列一致。'
          : '委托状态：未报（券商暂存）、已报、部成、已成、已撤、部撤、废单（交易所拒收）。',
    };
  });

  const doExport = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await exportLedger(core, st.ledger, ledgerFileName(st.date));
    } finally {
      setBusy(false);
    }
  };

  const tapLedger = (l: LedgerEntry) => {
    const f = l.fillNo ? st.fills.find(x => x.no === l.fillNo) : undefined;
    if (f) {
      nav.navigate('FillDetail', { id: f.id });
    } else {
      setNote(l);
    }
  };

  let body;
  if (tab === 'today' || tab === 'hist') {
    const list = tab === 'today' ? todayOrders : histOrders;
    body = list.length ? (
      list.map(o => (
        <OrderRow
          key={o.id}
          order={o}
          today={today}
          onPress={() => nav.navigate('OrderDetail', { id: o.id })}
        />
      ))
    ) : (
      <Empty text={tab === 'today' ? '今天还没有委托。' : '没有历史委托。'} />
    );
  } else if (tab === 'fills') {
    body = todayFills.length ? (
      todayFills.map(f => (
        <FillRow
          key={f.id}
          fill={f}
          today={today}
          onPress={() => nav.navigate('FillDetail', { id: f.id })}
        />
      ))
    ) : (
      <Empty text="今天还没有成交。" />
    );
  } else {
    body = (
      <>
        <View style={s.bar}>
          <Text style={s.barText}>
            共 {ledger.length} 条 · 左右滑动看全部列
          </Text>
          <Button
            title={busy ? '导出中…' : '导出 CSV'}
            small
            onPress={doExport}
            disabled={busy || !ledger.length}
          />
        </View>

        {ledger.length ? (
          <LedgerTable
            rows={ledger}
            regs={st.fee.regsSeparate}
            nameOf={nameOf}
            decOf={decOf}
            onPress={tapLedger}
          />
        ) : (
          <Empty text="还没有交割单。入金和每笔成交都会生成一条。" />
        )}
      </>
    );
  }

  return (
    <View style={s.page}>
      <NavBar title="查询" back />
      <Segmented items={TABS} value={tab} onChange={setTab} />
      <ScrollView contentContainerStyle={s.pad}>{body}</ScrollView>
      <ConfirmDialog
        visible={note != null}
        title={note?.biz ?? ''}
        rows={
          note
            ? [
                { k: '日期', v: note.date + ' ' + formatSec(note.t) },
                ...(note.code ? [{ k: '证券', v: nameOf(note.code) }] : []),
                {
                  k: '发生金额',
                  v: fmtSignedFen(note.net),
                  color: trendColor[trendOf(note.net)],
                },
                { k: '资金余额', v: formatFen(note.balance) },
                ...(note.note ? [{ k: '说明', v: note.note }] : []),
              ]
            : []
        }
        okTitle="知道了"
        okTone="plain"
        onOk={() => setNote(null)}
        onCancel={() => setNote(null)}
        cancelTitle="关闭"
      />
      <AiFab />
    </View>
  );
}

/** 导出交割单 CSV（打开系统分享面板）并记操作日志；当前账户和历史账户共用。 */
export async function exportLedger(
  core: AppCore,
  ledger: LedgerEntry[],
  name: string,
): Promise<void> {
  try {
    const csv = ledgerCsv(ledger, {
      nameOf: c => core.sim.security(c)?.name ?? c,
      decimalsOf: c => (core.sim.security(c)?.board === 'etf' ? 3 : 2),
    });
    await exportText(name, csv, 'text/csv');
    toast.show('已打开分享面板：' + name);
    await repo.logActivity(core.db, {
      accountId: core.sim.accountId,
      tradeDate: core.sim.engine.state.date,
      ts: beijingIso(),
      kind: 'export',
      text: '导出 ' + name + '（' + ledger.length + ' 条）',
      ref: null,
    });
  } catch (e) {
    toast.show(e instanceof Error ? e.message : String(e), 'bad');
  }
}

type Col = { t: string; w: number; left?: boolean };

export function LedgerTable({
  rows,
  regs,
  nameOf,
  decOf,
  onPress,
}: {
  rows: LedgerEntry[];
  regs: boolean;
  nameOf: (c: string | null) => string;
  decOf: (c: string) => 2 | 3;
  onPress: (l: LedgerEntry) => void;
}) {
  const cols: Col[] = [
    { t: '日期', w: 52, left: true },
    { t: '业务', w: 84, left: true },
    { t: '证券', w: 84, left: true },
    { t: '成交价', w: 64 },
    { t: '数量', w: 64 },
    { t: '成交金额', w: 92 },
    { t: '佣金', w: 56 },
    { t: '印花税', w: 56 },
    { t: '过户费', w: 56 },
    ...(regs
      ? [
          { t: '经手费', w: 56 },
          { t: '证管费', w: 56 },
        ]
      : []),
    { t: '红利税', w: 56 },
    { t: '发生金额', w: 100 },
    { t: '资金余额', w: 100 },
  ];
  const cell = (v: string, i: number, c?: string) => (
    <Text
      key={i}
      style={[
        s.td,
        num,
        { width: cols[i].w },
        cols[i].left ? s.left : s.right,
        c ? { color: c } : null,
      ]}
      numberOfLines={1}
    >
      {v}
    </Text>
  );
  return (
    <ScrollView horizontal style={s.table}>
      <View>
        <View style={[s.tr, s.th]}>
          {cols.map(c => (
            <Text
              key={c.t}
              style={[s.thText, { width: c.w }, c.left ? s.left : s.right]}
            >
              {c.t}
            </Text>
          ))}
        </View>
        {rows.map(l => {
          const d = l.code ? decOf(l.code) : 2;
          const vals: string[] = [
            l.date.slice(5),
            l.biz,
            nameOf(l.code),
            l.price ? formatPrice(l.price, d) : '',
            l.qty ? fmtQty(l.qty) : '',
            l.amount && l.code ? formatFen(l.amount) : '',
            formatFen(l.fee.commission),
            formatFen(l.fee.stamp),
            formatFen(l.fee.transfer),
            ...(regs ? [formatFen(l.fee.handling), formatFen(l.fee.reg)] : []),
            formatFen(l.divTax),
            fmtSignedFen(l.net),
            formatFen(l.balance),
          ];
          const netIdx = vals.length - 2;
          return (
            <Pressable
              key={l.id}
              onPress={() => onPress(l)}
              style={({ pressed }) => [s.tr, pressed && s.pressed]}
              accessibilityRole="button"
            >
              {vals.map((v, i) =>
                cell(
                  v,
                  i,
                  i === netIdx ? trendColor[trendOf(l.net)] : undefined,
                ),
              )}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { paddingBottom: 90 },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: color.card,
    paddingHorizontal: PAD,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  barText: { fontSize: 12, color: color.ink3 },
  table: { backgroundColor: color.card },
  tr: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  th: { paddingVertical: 6 },
  thText: { fontSize: 11, color: color.ink3 },
  td: { fontSize: 12, color: color.ink },
  pressed: { backgroundColor: color.press },
  left: { textAlign: 'left' },
  right: { textAlign: 'right' },
});
