/**
 * 银证转账、资金流水（M2 第 4 步，PRODUCT_DESIGN §6.3）。
 * 银行转证券就是模拟入金，受累计净入金上限限制；证券转银行只能转可取资金。转账时间交易日 9:00–16:00（§10）。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { withdrawable } from '../../engine/account';
import {
  isFirstDeposit,
  transferWindowOpen,
  type TransferDir,
} from '../../engine/funds';
import { formatSec } from '../../engine/session';
import type { LedgerEntry } from '../../engine/types';
import { formatFen, formatPrice } from '../../engine/units';
import { parseYuan, yuanText } from '../../sim/feeForm';
import {
  filterFlows,
  FLOW_FILTERS,
  pendingFlows,
  summarizeFlows,
  type FlowFilter,
} from '../../sim/flows';
import { CheckBar, FieldRow, KV } from '../components/form';
import {
  AiFab,
  Button,
  Empty,
  NavBar,
  Note,
  SectionTitle,
  Segmented,
} from '../components/ui';
import { fmtQty, fmtSignedFen, trendOf } from '../format';
import { useAiContext, useCore, useLive, useViewLog } from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { color, num, PAD, trendColor } from '../theme';
import { toast } from '../toast';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const DIRS: [TransferDir, string][] = [
  ['in', '银行转证券'],
  ['out', '证券转银行'],
];

const BANK = '模拟银行卡（尾号 0000）';
const BROKER = '模拟证券账户';

const isTransfer = (l: LedgerEntry) =>
  l.biz === '银行转证券' || l.biz === '证券转银行';

// ---------- 银证转账 ----------

export function TransferScreen({ route }: RootScreenProps<'Transfer'>) {
  const core = useCore();
  const nav = useNavigation<Nav>();
  useLive();
  const sim = core.sim;
  const [dir, setDir] = useState<TransferDir>(route.params?.dir ?? 'in');
  const [text, setText] = useState(() =>
    route.params?.amount ? String(route.params.amount / 100) : '',
  );
  const [busy, setBusy] = useState(false);
  const st = sim.engine.state;
  const now = sim.now();
  const fen = parseYuan(text);
  const check = sim.checkTransfer(dir, fen ?? 0);
  const left = Math.max(0, st.depositCap - st.depositTotal);
  const w = withdrawable(st);
  const open = transferWindowOpen(sim.calendar, now);
  const first = isFirstDeposit(st);
  const todays = st.ledger.filter(l => isTransfer(l) && l.date === now.date);
  const notWithdrawable: string[] = [];
  if (st.todaySellNet > 0) {
    notWithdrawable.push(
      '今天卖出的 ' + formatFen(st.todaySellNet) + ' 元下一交易日才可取',
    );
  }
  if (st.frozen > 0) {
    notWithdrawable.push('买入委托冻结了 ' + formatFen(st.frozen) + ' 元');
  }
  const windowText =
    (open
      ? '现在在转账时间内（交易日 9:00–16:00，各券商略有不同）'
      : '现在不在转账时间（交易日 9:00–16:00，各券商略有不同）') +
    (!open && first && dir === 'in' ? '，新账户的第一笔入金不限时间' : '');
  const checkText = !text.trim()
    ? null
    : check.ok
    ? '可以' +
      (dir === 'in' ? '转入 ' : '转出 ') +
      formatFen(fen!) +
      ' 元' +
      (check.firstDeposit && !open ? '（新账户第一笔入金不限时间）' : '')
    : check.rule + '：' + check.msg;

  useViewLog('transfer', '查看 银证转账');
  useAiContext('Transfer', () => ({
    name: '银证转账 · ' + (dir === 'in' ? '银行转证券' : '证券转银行'),
    lines: [
      '方向：' + (dir === 'in' ? BANK + ' → ' + BROKER : BROKER + ' → ' + BANK),
      '输入金额：' + (text.trim() ? text.trim() + ' 元' : '（未填）'),
      !text.trim()
        ? '还没填金额'
        : check.ok
        ? '校验通过：' + checkText
        : '校验不通过：' + check.rule + '。' + check.msg,
      '累计净入金 ' +
        formatFen(st.depositTotal) +
        ' 元 / 上限 ' +
        formatFen(st.depositCap) +
        ' 元，还可转入 ' +
        formatFen(left) +
        ' 元',
      '可取资金 ' +
        formatFen(w) +
        ' 元' +
        (notWithdrawable.length
          ? '（' + notWithdrawable.join('，') + '）'
          : ''),
      windowText + '，现在 ' + now.date + ' ' + formatSec(now.t),
      '今天的转账 ' + todays.length + ' 笔',
    ],
    tip: '银行转证券就是模拟入金，这是 App 里唯一「模拟」的地方。卖出股票的钱当天可以再买，下一交易日才能转出（可取 T+1）。',
  }));

  const quick: [string, number][] =
    dir === 'in'
      ? [
          ['1 万', 1_000_000],
          ['5 万', 5_000_000],
          ['10 万', 10_000_000],
          ['全部', left],
        ]
      : [
          ['1 万', 1_000_000],
          ['5 万', 5_000_000],
          ['全部', w],
        ];

  const submit = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const r = await sim.transfer(dir, fen ?? 0);
      if (r.ok) {
        toast.show(
          (dir === 'in' ? '已转入 ' : '已转出 ') + formatFen(fen!) + ' 元',
          'up',
        );
        setText('');
      } else {
        toast.show(r.msg, 'bad');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.page}>
      <NavBar title="银证转账" back />
      <Segmented
        items={DIRS}
        value={dir}
        onChange={k => {
          setDir(k);
          setText('');
        }}
      />
      <ScrollView
        contentContainerStyle={s.pad}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.card}>
          <KV k="转出" v={dir === 'in' ? BANK : BROKER} />
          <KV k="转入" v={dir === 'in' ? BROKER : BANK} />
          {dir === 'in' ? (
            <>
              <KV
                k="累计净入金 / 上限"
                v={
                  formatFen(st.depositTotal) + ' / ' + formatFen(st.depositCap)
                }
              />
              <KV k="还可转入" v={formatFen(left)} />
            </>
          ) : (
            <KV
              k="可取资金"
              v={formatFen(w)}
              sub={notWithdrawable.join('；') || undefined}
            />
          )}
          <FieldRow
            label="转账金额"
            value={text}
            onChangeText={setText}
            unit="元"
            placeholder={dir === 'in' ? '例 100000' : '不超过可取资金'}
            wide
          />
          <View style={s.quick}>
            {quick.map(([l, v]) => (
              <Button
                key={l}
                title={l}
                small
                disabled={v <= 0}
                onPress={() => setText(yuanText(v))}
              />
            ))}
          </View>
        </View>
        {checkText ? <CheckBar ok={check.ok} text={checkText} /> : null}
        <View style={s.submit}>
          <Button
            title={busy ? '处理中…' : dir === 'in' ? '转入' : '转出'}
            tone={dir === 'in' ? 'buy' : 'sell'}
            disabled={busy || !check.ok}
            onPress={submit}
          />
        </View>
        <Note style={s.note}>
          这是 App 里唯一「模拟」的地方：钱是假的，其他一切按真实规则。
          {windowText}
          。想在下一交易日开盘就有钱买，要提前一个交易日转入。卖出股票的钱当天可以再买，下一交易日才能转出（可取
          T+1）。累计净入金上限可以在「我的 → 设置」里改。
        </Note>
        <SectionTitle
          title="今天的转账"
          right={
            <Pressable onPress={() => nav.navigate('Flows')} hitSlop={8}>
              <Text style={s.link}>资金流水 ›</Text>
            </Pressable>
          }
        />
        {todays.length ? (
          <View style={s.card}>
            {todays.map(l => (
              <FlowRow key={l.id} l={l} />
            ))}
          </View>
        ) : (
          <Empty text="今天还没有转账。" />
        )}
      </ScrollView>
      <AiFab />
    </View>
  );
}

// ---------- 资金流水 ----------

function FlowRow({ l, onPress }: { l: LedgerEntry; onPress?: () => void }) {
  const core = useCore();
  const sec = l.code ? core.sim.security(l.code) : null;
  const d = sec?.board === 'etf' ? 3 : 2;
  const trade = l.biz === '证券买入' || l.biz === '证券卖出';
  const sub = trade
    ? '成交 ' +
      formatPrice(l.price, d) +
      ' × ' +
      fmtQty(l.qty) +
      ' = ' +
      formatFen(l.amount) +
      ' · 费用 ' +
      formatFen(l.fee.total) +
      '（佣金 ' +
      formatFen(l.fee.commission) +
      (l.fee.stamp ? '，印花税 ' + formatFen(l.fee.stamp) : '') +
      (l.fee.transfer ? '，过户费 ' + formatFen(l.fee.transfer) : '') +
      (l.fee.handling + l.fee.reg
        ? '，规费 ' + formatFen(l.fee.handling + l.fee.reg)
        : '') +
      '）'
    : l.biz === '红股入账'
    ? fmtQty(l.qty) + ' 股 · ' + l.note
    : l.note;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [s.fRow, pressed && s.pressed]}
      accessibilityRole="button"
    >
      <View style={s.fTop}>
        <View style={s.grow}>
          <Text style={s.fBiz}>
            {l.biz}
            {sec ? <Text style={s.fName}> {sec.name}</Text> : null}
          </Text>
          <Text style={[s.fTime, num]}>
            {l.date} {formatSec(l.t)}
          </Text>
        </View>
        <View style={s.fRight}>
          <Text style={[s.fNet, num, { color: trendColor[trendOf(l.net)] }]}>
            {fmtSignedFen(l.net)}
          </Text>
          <Text style={[s.fTime, num]}>余额 {formatFen(l.balance)}</Text>
        </View>
      </View>
      {sub ? (
        <Text style={s.fSub} numberOfLines={3}>
          {sub}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function FlowsScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  useLive();
  const sim = core.sim;
  const st = sim.engine.state;
  const [filter, setFilter] = useState<FlowFilter>('all');
  const list = filterFlows(st.ledger, filter);
  const sum = summarizeFlows(st.ledger);
  const pending = pendingFlows(st, d => sim.calendar.next(d));
  const nameOf = (c: string) => sim.security(c)?.name ?? c.slice(2);
  const filterName = FLOW_FILTERS.find(f => f[0] === filter)![1];
  const regs = sum.fee.handling + sum.fee.reg;

  useViewLog('flows', '查看 资金流水');
  useAiContext('Flows', () => ({
    name: '资金流水 · ' + filterName,
    lines: [
      '筛选：' +
        filterName +
        '，' +
        list.length +
        ' 条（全部 ' +
        st.ledger.length +
        ' 条）',
      '转入 ' +
        formatFen(sum.transferIn) +
        ' 元，转出 ' +
        formatFen(sum.transferOut) +
        ' 元；买入成交 ' +
        formatFen(sum.buy) +
        ' 元，卖出成交 ' +
        formatFen(sum.sell) +
        ' 元',
      '费用合计 ' +
        formatFen(sum.fee.total) +
        ' 元：佣金 ' +
        formatFen(sum.fee.commission) +
        '，印花税 ' +
        formatFen(sum.fee.stamp) +
        '，过户费 ' +
        formatFen(sum.fee.transfer) +
        (regs ? '，规费 ' + formatFen(regs) : ''),
      '红利 ' +
        formatFen(sum.dividend) +
        ' 元，红利税 ' +
        formatFen(sum.divTax) +
        ' 元',
      ...(pending.length
        ? pending.map(
            p =>
              '待发生：' +
              p.when +
              ' ' +
              p.kind +
              ' ' +
              nameOf(p.code) +
              ' ' +
              fmtSignedFen(p.net) +
              ' 元',
          )
        : ['没有待发生的红利或红利税']),
      ...list
        .slice(0, 6)
        .map(
          l =>
            l.date +
            ' ' +
            formatSec(l.t) +
            ' ' +
            l.biz +
            (l.code ? ' ' + nameOf(l.code) : '') +
            ' ' +
            fmtSignedFen(l.net) +
            ' 元，余额 ' +
            formatFen(l.balance),
        ),
    ],
    tip: '资金流水从交割单派生，一条交割单一行，余额和交割单一致；费用写在买卖那一行里，不单独拆行。',
  }));

  const tap = (l: LedgerEntry) => {
    const f = l.fillNo ? st.fills.find(x => x.no === l.fillNo) : undefined;
    return f ? () => nav.navigate('FillDetail', { id: f.id }) : undefined;
  };

  return (
    <View style={s.page}>
      <NavBar title="资金流水" back />
      <Segmented items={FLOW_FILTERS} value={filter} onChange={setFilter} />
      <ScrollView contentContainerStyle={s.pad}>
        <View style={s.card}>
          <SectionTitle title="汇总" right="本账户全部" />
          <View style={s.grid}>
            <Cell k="转入" v={formatFen(sum.transferIn)} />
            <Cell k="转出" v={formatFen(sum.transferOut)} />
            <Cell k="买入成交" v={formatFen(sum.buy)} />
            <Cell k="卖出成交" v={formatFen(sum.sell)} />
            <Cell k="费用合计" v={formatFen(sum.fee.total)} />
            <Cell k="佣金" v={formatFen(sum.fee.commission)} />
            <Cell k="印花税" v={formatFen(sum.fee.stamp)} />
            <Cell k="过户费" v={formatFen(sum.fee.transfer)} />
            <Cell k="规费" v={regs ? formatFen(regs) : '含在佣金里'} />
            <Cell k="红利" v={formatFen(sum.dividend)} />
            <Cell k="红利税" v={formatFen(sum.divTax)} />
          </View>
        </View>
        {pending.length ? (
          <>
            <SectionTitle title="待发生" />
            <View style={s.card}>
              {pending.map((p, i) => (
                <KV
                  key={i}
                  k={p.when + ' ' + p.kind + ' ' + nameOf(p.code)}
                  v={fmtSignedFen(p.net)}
                  c={trendColor[trendOf(p.net)]}
                  sub={p.note}
                />
              ))}
            </View>
          </>
        ) : null}
        <SectionTitle
          title="流水"
          right={list.length + ' 条 · 买卖点开看成交详情'}
        />
        {list.length ? (
          <View style={s.card}>
            {list.map(l => (
              <FlowRow key={l.id} l={l} onPress={tap(l)} />
            ))}
          </View>
        ) : (
          <Empty
            text={
              st.ledger.length
                ? '这个分类下还没有流水。'
                : '还没有资金流水。先去银证转账转入模拟资金。'
            }
          />
        )}
        {!st.ledger.length ? (
          <View style={s.submit}>
            <Button
              title="去银证转账"
              tone="buy"
              onPress={() => nav.navigate('Transfer', { dir: 'in' })}
            />
          </View>
        ) : null}
      </ScrollView>
      <AiFab />
    </View>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.cell}>
      <Text style={s.cellK}>{k}</Text>
      <Text style={[s.cellV, num]}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { paddingBottom: 90 },
  card: { backgroundColor: color.card, marginTop: 8 },
  note: { margin: 10 },
  grow: { flex: 1 },
  pressed: { backgroundColor: color.press },
  quick: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: PAD,
    paddingVertical: 10,
  },
  submit: { paddingHorizontal: 10, marginTop: 10 },
  link: { fontSize: 13, color: color.sell },
  fRow: {
    paddingHorizontal: PAD,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  fTop: { flexDirection: 'row', gap: 10 },
  fBiz: { fontSize: 15, color: color.ink },
  fName: { fontSize: 13, color: color.ink2 },
  fTime: { fontSize: 12, color: color.ink3, marginTop: 2 },
  fRight: { alignItems: 'flex-end' },
  fNet: { fontSize: 15, fontWeight: '500' },
  fSub: { fontSize: 11, lineHeight: 16, color: color.ink3, marginTop: 4 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: PAD,
    paddingBottom: 10,
  },
  cell: { width: '33.33%', paddingVertical: 4 },
  cellK: { fontSize: 12, color: color.ink3 },
  cellV: { fontSize: 13, color: color.ink, marginTop: 1 },
});
