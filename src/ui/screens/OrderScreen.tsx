/**
 * 下单页（同花顺布局）：顶部分段 买入 / 卖出 / 撤单 / 持仓。
 * 买卖：左边证券、委托类型、价格、数量、可买可卖、仓位快捷键，右边五档（点价格填入）；下方预估金额和费用、
 * 实时校验结果（引擎同一套校验）、报送时间。提交 → 委托确认弹窗 → 引擎下单，结果由引擎事件弹提示。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { holdingOf, isLive } from '../../engine/account';
import type { OrderCheck } from '../../engine/engine';
import {
  classify,
  isSTName,
  ruleOf,
  type Security,
} from '../../engine/securities';
import { phaseAt } from '../../engine/session';
import {
  KIND_NAME,
  type Order,
  type OrderKind,
  type Snapshot,
} from '../../engine/types';
import { formatFen, formatPrice, rateToWan } from '../../engine/units';
import { needsProtect } from '../../engine/validate';
import {
  cageHint,
  cancelState,
  defaultPrice,
  defaultProtect,
  estimate,
  holdingNotes,
  isMarketKind,
  kindOptions,
  maxBuy,
  parsePrice,
  parseQty,
  priceText,
  quickQty,
  sendText,
  stepPrice,
  stepQty,
  toRequest,
  type OrderForm,
} from '../../sim/orderForm';
import { feeLabel, feeNote } from '../../sim/feeForm';
import { BOARD_NAME } from '../../sim/ruleCard';
import { ConfirmDialog, type DialogRow } from '../components/Dialog';
import { OrderRow, PositionList } from '../components/tradeRows';
import {
  AiFab,
  Button,
  Empty,
  NavBar,
  Note,
  Segmented,
  Tags,
} from '../components/ui';
import { fmtQty, tagsOf, trendOf, unitOf } from '../format';
import {
  useAiContext,
  useCore,
  useLive,
  useQuoteCodes,
  useViewLog,
} from '../hooks';
import type {
  OrderSide,
  RootScreenProps,
  RootStackParamList,
} from '../navigation/types';
import { color, num, PAD, trendColor } from '../theme';
import { useWatch } from '../watchStore';
import { PhaseBar } from './WatchScreen';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const SIDES: [OrderSide, string][] = [
  ['B', '买入'],
  ['S', '卖出'],
  ['C', '撤单'],
  ['P', '持仓'],
];

const CN = '一二三四五';

/** 行情到之前 Simulator 还不认识这只证券，用代码推出板块（和个股页一样）。 */
function securityOf(
  code: string,
  name: string,
  known: Security | null,
): Security | null {
  if (known) {
    return known;
  }
  const c = classify(code);
  return c ? { code, name, ...c, st: isSTName(name) } : null;
}

/** 校验结果写成一句话（页面和 AI 上下文共用）。 */
function checkText(c: OrderCheck | null): string {
  if (!c) {
    return '还没选证券';
  }
  if (c.ok) {
    return '校验通过';
  }
  return c.level === 'block'
    ? '不能提交（' + c.rule + '）：' + c.msg
    : '提交后会成为废单（' + c.rule + '）：' + c.msg;
}

export function OrderScreen({ route }: RootScreenProps<'Order'>) {
  const p = route.params;
  const core = useCore();
  const nav = useNavigation<Nav>();
  useLive();
  const sim = core.sim;
  const state = sim.engine.state;
  const watchCodes = useWatch(st => st.codes);
  const [side, setSide] = useState<OrderSide>(p.side);
  const heldFirst = sim.heldCodes()[0];
  const fallbackCode =
    p.code ??
    (side === 'S' ? heldFirst : undefined) ??
    watchCodes.find(c => classify(c)) ??
    'sh510300';
  const [form, setForm] = useState<OrderForm>(() => ({
    code: fallbackCode,
    side: p.side === 'S' ? 'S' : 'B',
    kind: p.kind ?? 'limit',
    price: '',
    qty: '',
    protect: '',
  }));
  const [priceTouched, setPriceTouched] = useState(p.price != null);
  const [showFee, setShowFee] = useState(false);
  const [kindOpen, setKindOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | 'submit' | 'blocked'>(null);
  const [blocked, setBlocked] = useState<{
    rule: string;
    msg: string;
    lesson?: string;
  } | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);

  // 从个股页、搜索、五档进来时换证券 / 方向 / 价格：表单重来
  useEffect(() => {
    setSide(p.side);
    setForm(f => ({
      code: p.code ?? f.code,
      side: p.side === 'S' ? 'S' : p.side === 'B' ? 'B' : f.side,
      kind: p.kind ?? (p.code && p.code !== f.code ? 'limit' : f.kind),
      price: '',
      qty: p.code && p.code !== f.code ? '' : f.qty,
      protect: '',
    }));
    setPriceTouched(p.price != null);
  }, [p.side, p.code, p.price, p.kind]);

  const code = form.code;
  const q = sim.quote(code);
  const snap: Snapshot | null = q?.snapshot ?? null;
  const name = q?.info.name ?? sim.security(code)?.name ?? p.name ?? code;
  const sec = securityOf(code, name, sim.security(code));
  const d = sec ? ruleOf(sec).decimals : 2;
  useQuoteCodes([code]);

  // 价格默认值：点五档带来的价格优先；否则买入取卖一、卖出取买一（行情到了再填）
  useEffect(() => {
    if (priceTouched) {
      if (p.price != null) {
        setForm(f => ({ ...f, price: priceText(p.price, d) }));
      }
      return;
    }
    const dp = defaultPrice(form.side, snap);
    if (dp != null) {
      setForm(f => (f.price ? f : { ...f, price: priceText(dp, d) }));
    }
    // 只在换证券 / 方向、行情第一次到的时候填，之后不覆盖用户输入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, form.side, snap != null, priceTouched, p.price, d]);
  useEffect(() => {
    if (sec && isMarketKind(form.kind) && needsProtect(sec) && !form.protect) {
      const dp = defaultProtect(sec, form.side, snap);
      if (dp != null) {
        setForm(f => ({ ...f, protect: priceText(dp, d) }));
      }
    }
  }, [sec, form.kind, form.side, form.protect, snap, d]);

  const tradeSide = side === 'S' ? 'S' : 'B';
  const set = (patch: Partial<OrderForm>) => setForm(f => ({ ...f, ...patch }));
  const switchSide = (k: OrderSide) => {
    // 再点一次当前分段不清空表单
    if (k === side) {
      return;
    }
    setSide(k);
    if (k === 'B' || k === 'S') {
      setPriceTouched(false);
      setForm(f => ({ ...f, side: k, price: '', qty: '', protect: '' }));
    }
  };

  // ---------- 派生数据 ----------
  const now = sim.now();
  const isTradingDay = sim.calendar.isTradingDay(now.date);
  const phase = isTradingDay ? phaseAt(now.t) : 'closed';
  const fee = state.fee;
  const h = holdingOf(state, code);
  const unit = unitOf(code, sec?.board === 'etf' ? 'ETF' : undefined);
  const req = sec ? toRequest({ ...form, side: tradeSide }, sec) : null;
  const check = req ? sim.checkOrder(req) : null;
  const est = req && sec ? estimate(req, sec, snap, fee) : null;
  const avail = state.cash - state.frozen;
  const canBuy =
    sec && est && tradeSide === 'B'
      ? maxBuy(sec, est.freezePrice, avail, fee)
      : 0;
  const cage =
    sec && form.kind === 'limit'
      ? cageHint(sec, tradeSide, snap, phase, isTradingDay)
      : null;
  const priceLi = sec ? parsePrice(form.price, d) : null;
  const outOfCage =
    cage != null &&
    priceLi != null &&
    (tradeSide === 'B' ? priceLi > cage.bound : priceLi < cage.bound);
  const route2 = check?.route ?? 'nextDay';
  const sendNote = sendText(route2, phase, isTradingDay);
  const etf = sec?.board === 'etf';
  const rate = etf ? fee.etfRate : fee.stockRate;
  const minFen = etf ? fee.etfMinFen : fee.stockMinFen;
  const kinds = sec ? kindOptions(sec) : [];
  const kindLabel =
    kinds.find(k => k.kind === form.kind)?.label ?? KIND_NAME[form.kind];
  const live = state.orders.filter(isLive);

  useViewLog(
    'order:' + side + ':' + code,
    side === 'C'
      ? '查看 撤单'
      : side === 'P'
      ? '查看 持仓（下单页）'
      : '打开 ' + (side === 'B' ? '买入 ' : '卖出 ') + name,
  );

  // ---------- AI 页面上下文：表单内容和校验结果 ----------
  useAiContext('Order', () => {
    if (side === 'C') {
      return {
        name: '撤单',
        lines: live.length
          ? live.map(o => {
              const c = cancelState(o.status, phase, isTradingDay);
              const sname = sim.security(o.code)?.name ?? o.code;
              return (
                (o.side === 'B' ? '买入 ' : '卖出 ') +
                sname +
                ' ' +
                fmtQty(o.qty) +
                '，' +
                o.status +
                '，' +
                (c.ok ? '现在能撤' : '现在不能撤：' + c.why)
              );
            })
          : ['没有可撤的委托'],
        tip: '券商暂存（未报）的委托随时能撤；已报交易所的，9:20–9:25、9:25–9:30、14:57–15:00 不能撤。',
      };
    }
    if (side === 'P') {
      return {
        name: '下单 · 持仓',
        lines: ['持仓 ' + sim.heldCodes().length + ' 只，点一行切到卖出'],
      };
    }
    const lines = [
      '方向 ' +
        (tradeSide === 'B' ? '买入' : '卖出') +
        '，证券 ' +
        name +
        '（' +
        code.slice(2) +
        (sec
          ? '，' +
            (sec.exchange === 'SH' ? '沪市' : '深市') +
            BOARD_NAME[sec.board] +
            (sec.st ? '·ST' : '')
          : '') +
        '）',
      '委托类型 ' +
        KIND_NAME[form.kind] +
        (form.kind === 'limit'
          ? '，价格 ' + (form.price || '（没填）') + ' 元'
          : form.kind === 'after'
          ? '，按当日收盘价'
          : '，市价' +
            (sec && needsProtect(sec)
              ? '，保护限价 ' + (form.protect || '（没填）') + ' 元'
              : '')) +
        '，数量 ' +
        (form.qty || '（没填）') +
        ' ' +
        unit,
    ];
    if (est && est.qty > 0 && est.price != null) {
      lines.push(
        '金额约 ' +
          formatFen(est.amount) +
          ' 元，预估费用 ' +
          formatFen(est.fee.total) +
          ' 元（佣金 ' +
          formatFen(est.fee.commission) +
          '、印花税 ' +
          formatFen(est.fee.stamp) +
          '、过户费 ' +
          formatFen(est.fee.transfer) +
          '）' +
          (tradeSide === 'B' ? '，冻结 ' + formatFen(est.freeze) + ' 元' : ''),
      );
    }
    lines.push('费率：' + feeLabel(fee, sec?.board ?? 'main'));
    lines.push(
      tradeSide === 'B'
        ? '可买 ' +
            fmtQty(canBuy) +
            ' ' +
            unit +
            '，可用资金 ' +
            formatFen(avail) +
            ' 元'
        : '可卖 ' +
            fmtQty(h.sellable) +
            ' ' +
            unit +
            '（持有 ' +
            fmtQty(h.held) +
            '）' +
            (holdingNotes(h, unit).length
              ? '：' + holdingNotes(h, unit).join('；')
              : ''),
    );
    if (snap) {
      lines.push(
        '盘口 卖一 ' +
          (snap.asks[0] ? formatPrice(snap.asks[0][0], d) : '--') +
          ' / 买一 ' +
          (snap.bids[0] ? formatPrice(snap.bids[0][0], d) : '--') +
          '，最新 ' +
          (snap.last != null ? formatPrice(snap.last, d) : '--') +
          '，涨停 ' +
          (snap.up != null ? formatPrice(snap.up, d) : '--') +
          ' / 跌停 ' +
          (snap.down != null ? formatPrice(snap.down, d) : '--'),
      );
    }
    if (cage) {
      lines.push(cage.text + (outOfCage ? '（现在的价格超出了）' : ''));
    }
    lines.push(
      '表单' +
        (check?.ok
          ? '校验通过'
          : check?.ok === false && check.level === 'block'
          ? '校验不通过：' + check.rule + '。' + check.msg
          : check
          ? '能提交但会成为废单：' + check.rule + '。' + check.msg
          : '：还没选证券'),
    );
    lines.push('提交后：' + sendNote);
    return {
      name: (tradeSide === 'B' ? '买入' : '卖出') + ' · ' + name,
      lines,
      tip: '下单页：左边填委托，右边是五档盘口（点价格填入）。下方的预估费用按当前费率算；校验和真正下单用同一套规则，被拦下时写明是哪条规则。',
    };
  });

  // ---------- 操作 ----------
  const onSubmit = async () => {
    if (!req || !check) {
      return;
    }
    if (!check.ok && check.level === 'block') {
      // 走一遍引擎下单：被拦下的委托不生成记录，但会记进操作日志（AI 能回答「刚才为什么下不了单」）
      const r = await sim.placeOrder(req);
      if (!r.ok) {
        setBlocked({ rule: r.rule, msg: r.msg, lesson: r.lesson });
        setConfirm('blocked');
      }
      return;
    }
    setConfirm('submit');
  };
  const doPlace = async () => {
    setConfirm(null);
    if (!req) {
      return;
    }
    const r = await sim.placeOrder(req);
    if (!r.ok) {
      setBlocked({ rule: r.rule, msg: r.msg, lesson: r.lesson });
      setConfirm('blocked');
      return;
    }
    set({ qty: '' });
    core.refresher.kick();
  };
  const doCancel = async (o: Order) => {
    setCancelling(null);
    const r = await sim.cancelOrder(o.id);
    if (!r.ok) {
      setBlocked({ rule: '现在不能撤单', msg: r.msg, lesson: r.lesson });
      setConfirm('blocked');
    }
  };
  const cancelMany = async (f: (o: Order) => boolean) => {
    const targets = live.filter(
      o => f(o) && cancelState(o.status, phase, isTradingDay).ok,
    );
    for (const o of targets) {
      await sim.cancelOrder(o.id);
    }
    const left = live.filter(f).length - targets.length;
    if (left > 0) {
      setBlocked({
        rule: '部分委托现在不能撤',
        msg:
          left +
          ' 笔已报交易所的委托现在不能撤：' +
          cancelState('已报', phase, isTradingDay).why +
          '。',
      });
      setConfirm('blocked');
    }
  };

  const confirmRows: DialogRow[] =
    sec && req && est
      ? [
          {
            k: '操作',
            v: tradeSide === 'B' ? '买入' : '卖出',
            color: tradeSide === 'B' ? color.up : color.sell,
          },
          { k: '证券', v: name + ' ' + code.slice(2) },
          { k: '委托类型', v: KIND_NAME[form.kind] },
          {
            k: '价格',
            v:
              form.kind === 'limit'
                ? formatPrice(req.price ?? 0, d)
                : form.kind === 'after'
                ? '当日收盘价'
                : '市价' +
                  (req.protect != null
                    ? '（保护限价 ' + formatPrice(req.protect, d) + '）'
                    : ''),
          },
          { k: '数量', v: fmtQty(req.qty) + ' ' + unit },
          { k: '预估金额', v: formatFen(est.amount) },
          { k: '预估费用', v: formatFen(est.fee.total) },
          ...(tradeSide === 'B'
            ? [{ k: '冻结资金', v: formatFen(est.freeze) }]
            : []),
        ]
      : [];

  // ---------- 界面 ----------
  const title =
    side === 'C'
      ? '撤单'
      : side === 'P'
      ? '持仓'
      : form.kind === 'after'
      ? '盘后固定价格 · ' + (tradeSide === 'B' ? '买入' : '卖出')
      : tradeSide === 'B'
      ? '买入'
      : '卖出';

  const body =
    side === 'C' ? (
      <>
        <View style={s.cancelBar}>
          <Button small title="全撤" onPress={() => cancelMany(() => true)} />
          <Button
            small
            title="撤买"
            onPress={() => cancelMany(o => o.side === 'B')}
          />
          <Button
            small
            title="撤卖"
            onPress={() => cancelMany(o => o.side === 'S')}
          />
        </View>
        {live.length ? (
          live.map(o => {
            const c = cancelState(o.status, phase, isTradingDay);
            return (
              <View key={o.id}>
                <OrderRow
                  order={o}
                  today={state.date}
                  onPress={() => nav.navigate('OrderDetail', { id: o.id })}
                  right={
                    <Button
                      small
                      title="撤单"
                      disabled={!c.ok}
                      onPress={() => setCancelling(o)}
                    />
                  }
                />
                {!c.ok ? <Text style={s.cantCancel}>{c.why}</Text> : null}
              </View>
            );
          })
        ) : (
          <Empty text="没有可撤的委托" />
        )}
        <Note style={s.note}>
          券商暂存（未报）的委托随时能撤。已报交易所的委托，9:20–9:25
          开盘集合竞价后段、9:25–9:30 和 14:57–15:00
          收盘集合竞价时交易所不接受撤单。
        </Note>
      </>
    ) : side === 'P' ? (
      <PositionList
        empty="还没有持仓。"
        onPress={pp => {
          switchSide('S');
          set({ code: pp.code, side: 'S', price: '', qty: '' });
        }}
      />
    ) : (
      <>
        <View style={s.ticket}>
          <View style={s.form}>
            <Pressable
              style={s.fld}
              onPress={() =>
                nav.navigate('Search', {
                  pick: { side: tradeSide, kind: form.kind },
                })
              }
              accessibilityRole="button"
              accessibilityLabel="选择证券"
            >
              <View style={s.secLine}>
                <Text style={s.secName} numberOfLines={1}>
                  {name}
                </Text>
                <Tags
                  tags={tagsOf(
                    code,
                    name,
                    sec?.board === 'etf' ? 'ETF' : undefined,
                  )}
                />
              </View>
              <Text style={[s.secCode, num]}>{code.slice(2)}</Text>
              <ChevronRight color={color.ink3} size={18} />
            </Pressable>
            <Pressable
              style={s.fld}
              onPress={() => setKindOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="委托类型"
            >
              <Text style={s.kindText} numberOfLines={1}>
                {kindLabel}
              </Text>
              <ChevronDown color={color.ink3} size={18} />
            </Pressable>
            {form.kind === 'limit' ? (
              <>
                <Stepper
                  value={form.price}
                  placeholder="价格"
                  keyboard="decimal-pad"
                  onChange={v => {
                    setPriceTouched(true);
                    set({ price: v });
                  }}
                  onStep={dir => {
                    if (!sec) {
                      return;
                    }
                    setPriceTouched(true);
                    const nx = stepPrice(priceLi, dir, sec, snap);
                    set({ price: priceText(nx, d) });
                  }}
                  label="价格"
                />
                <View style={s.hint}>
                  <Text
                    style={[s.hintText, num]}
                    onPress={() => {
                      if (snap?.down != null) {
                        setPriceTouched(true);
                        set({ price: priceText(snap.down, d) });
                      }
                    }}
                  >
                    跌停{' '}
                    <Text style={{ color: color.down }}>
                      {snap?.down != null ? formatPrice(snap.down, d) : '--'}
                    </Text>
                  </Text>
                  <Text
                    style={[s.hintText, num]}
                    onPress={() => {
                      if (snap?.up != null) {
                        setPriceTouched(true);
                        set({ price: priceText(snap.up, d) });
                      }
                    }}
                  >
                    涨停{' '}
                    <Text style={{ color: color.up }}>
                      {snap?.up != null ? formatPrice(snap.up, d) : '--'}
                    </Text>
                  </Text>
                </View>
                {cage ? (
                  <Text style={[s.cage, num, outOfCage && s.cageBad]}>
                    {cage.text}
                    {outOfCage ? ' · 超出范围' : ''}
                  </Text>
                ) : null}
              </>
            ) : isMarketKind(form.kind) && sec && needsProtect(sec) ? (
              <>
                <Stepper
                  value={form.protect}
                  placeholder="保护限价"
                  keyboard="decimal-pad"
                  onChange={v => set({ protect: v })}
                  onStep={dir => {
                    const nx = stepPrice(
                      parsePrice(form.protect, d),
                      dir,
                      sec,
                      snap,
                    );
                    set({ protect: priceText(nx, d) });
                  }}
                  label="保护限价"
                />
                <Text style={s.cage}>
                  保护限价：
                  {tradeSide === 'B' ? '成交价不高于它' : '成交价不低于它'}
                  ，默认按{tradeSide === 'B' ? '卖一 × 102%' : '买一 × 98%'}
                </Text>
              </>
            ) : (
              <Text style={s.marketNote}>
                {form.kind === 'after'
                  ? '按当日收盘价成交，15:05–15:30 撮合'
                  : '市价：按对手盘成交' +
                    (tradeSide === 'B' ? '，按涨停价冻结资金' : '')}
              </Text>
            )}
            <Stepper
              value={form.qty}
              placeholder={(tradeSide === 'B' ? '买入' : '卖出') + '数量'}
              keyboard="number-pad"
              onChange={v => set({ qty: v })}
              onStep={dir => {
                if (sec) {
                  const nx = stepQty(parseQty(form.qty), dir, sec, tradeSide);
                  set({ qty: nx ? String(nx) : '' });
                }
              }}
              label="数量"
            />
            <Text style={[s.can, num]}>
              {tradeSide === 'B' ? (
                <>
                  可买 <Text style={s.canB}>{fmtQty(canBuy)}</Text> {unit}
                </>
              ) : (
                <>
                  可卖 <Text style={s.canB}>{fmtQty(h.sellable)}</Text> {unit}
                  {h.todayBuy ? (
                    <Text style={{ color: color.warn }}>
                      {' '}
                      · T+1 冻结 {fmtQty(h.todayBuy)}
                    </Text>
                  ) : null}
                </>
              )}
            </Text>
            <View style={s.quick}>
              {([1, 2, 3, 4] as const).map(div => (
                <Pressable
                  key={div}
                  style={({ pressed }) => [s.qBtn, pressed && s.pressed]}
                  onPress={() => {
                    if (sec) {
                      const nx = quickQty(
                        div,
                        tradeSide,
                        sec,
                        canBuy,
                        h.sellable,
                      );
                      set({ qty: nx ? String(nx) : '' });
                    }
                  }}
                  accessibilityRole="button"
                >
                  <Text style={s.qText}>{div === 1 ? '全仓' : '1/' + div}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <BookPanel
            snap={snap}
            d={d}
            onPick={price => {
              setPriceTouched(true);
              set({ kind: 'limit', price: priceText(price, d) });
            }}
          />
        </View>

        <View style={s.bottom}>
          <Pressable
            style={s.feeLine}
            onPress={() => setShowFee(v => !v)}
            accessibilityRole="button"
          >
            <Text style={[s.feeText, num]}>
              金额{' '}
              <Text style={s.feeB}>{est ? formatFen(est.amount) : '--'}</Text>
            </Text>
            <Text style={[s.feeText, num]}>
              费用约{' '}
              <Text style={s.feeB}>
                {est ? formatFen(est.fee.total) : '--'}
              </Text>{' '}
              {showFee ? '▴' : '▾'}
            </Text>
          </Pressable>
          {showFee && est ? (
            <View style={s.feeBox}>
              <FeeItem
                k={
                  '佣金（万 ' +
                  rateToWan(rate) +
                  '，最低 ' +
                  minFen / 100 +
                  ' 元）'
                }
                v={formatFen(est.fee.commission)}
              />
              <FeeItem
                k={
                  '印花税（' +
                  (etf
                    ? 'ETF 免征'
                    : tradeSide === 'B'
                    ? '买入不收'
                    : '0.05%') +
                  '）'
                }
                v={formatFen(est.fee.stamp)}
              />
              <FeeItem
                k={'过户费（' + (etf ? 'ETF 免收' : '0.001%，双向') + '）'}
                v={formatFen(est.fee.transfer)}
              />
              {fee.regsSeparate ? (
                <>
                  <FeeItem k="经手费" v={formatFen(est.fee.handling)} />
                  <FeeItem k="证管费" v={formatFen(est.fee.reg)} />
                </>
              ) : (
                <FeeItem k="经手费、证管费" v="含在佣金里" />
              )}
              {tradeSide === 'B' ? (
                <FeeItem k="冻结资金（含费用）" v={formatFen(est.freeze)} />
              ) : null}
              <Text style={s.feeNote}>
                {feeNote(fee, sec?.board ?? 'main')}
                {tradeSide === 'S' && !etf
                  ? '持有期间分过红的，卖出后下一交易日补扣股息红利税。'
                  : ''}
                <Text
                  style={s.feeLink}
                  onPress={() => nav.navigate('Fees')}
                  accessibilityRole="link"
                >
                  {' 费率设置 ›'}
                </Text>
              </Text>
            </View>
          ) : null}
          <View
            style={[
              s.check,
              check?.ok
                ? s.checkOk
                : check?.ok === false && check.level === 'reject'
                ? s.checkWarn
                : s.checkBad,
            ]}
          >
            <Text style={s.checkText}>
              {check?.ok
                ? '✓ '
                : check?.ok === false && check.level === 'reject'
                ? '⚠ '
                : '✕ '}
              {checkText(check)}
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [
              s.submit,
              { backgroundColor: tradeSide === 'B' ? color.up : color.sell },
              pressed && { opacity: 0.85 },
            ]}
            onPress={onSubmit}
            accessibilityRole="button"
          >
            <Text style={s.submitText}>
              {tradeSide === 'B' ? '买入' : '卖出'}
            </Text>
          </Pressable>
          <Text style={s.send}>{sendNote}</Text>
        </View>
        <Text style={s.secH}>
          {tradeSide === 'B' ? '持仓' : '可卖持仓'}（点一行切换证券）
        </Text>
        <PositionList
          empty="还没有持仓。"
          onPress={pp => {
            setPriceTouched(false);
            set({ code: pp.code, price: '', qty: '', protect: '' });
          }}
        />
      </>
    );

  return (
    <View style={s.page}>
      <NavBar title={title} back />
      <Segmented items={SIDES} value={side} onChange={switchSide} />
      <PhaseBar />
      <ScrollView
        contentContainerStyle={s.pad}
        keyboardShouldPersistTaps="handled"
      >
        {body}
      </ScrollView>
      <AiFab />

      <Modal
        visible={kindOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setKindOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={s.mask} onPress={() => setKindOpen(false)}>
          <View style={s.sheet}>
            <Text style={s.sheetH}>
              委托类型 · {sec ? (sec.exchange === 'SH' ? '沪市' : '深市') : ''}
            </Text>
            {kinds.map(k => (
              <Pressable
                key={k.kind}
                style={({ pressed }) => [s.sheetRow, pressed && s.pressed]}
                onPress={() => {
                  setKindOpen(false);
                  set({ kind: k.kind as OrderKind, protect: '' });
                }}
                accessibilityRole="button"
              >
                <Text style={[s.sheetText, k.kind === form.kind && s.sheetOn]}>
                  {k.label}
                </Text>
              </Pressable>
            ))}
            <Text style={s.sheetNote}>
              市价委托只能在连续竞价时段（9:30–11:30、13:00–14:57）用，ST
              股票只能限价。
              {sec?.exchange === 'SH'
                ? '沪市市价委托要填保护限价（能接受的最高买价 / 最低卖价）。'
                : '深市市价买入按涨停价冻结资金。'}
            </Text>
          </View>
        </Pressable>
      </Modal>

      <ConfirmDialog
        visible={confirm === 'submit'}
        title="委托确认"
        rows={confirmRows}
        okTitle={
          check && !check.ok
            ? '仍然提交'
            : '确认' + (tradeSide === 'B' ? '买入' : '卖出')
        }
        okTone={tradeSide === 'B' ? 'buy' : 'sell'}
        onOk={doPlace}
        onCancel={() => setConfirm(null)}
      >
        <Note style={s.dlgNote}>{sendNote}</Note>
        {check && !check.ok ? (
          <Note tone="warn" style={s.dlgNote}>
            {'这笔委托会被交易所拒收，成为废单（' +
              check.rule +
              '）：' +
              check.msg}
          </Note>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        visible={confirm === 'blocked'}
        title={blocked ? blocked.rule : ''}
        rows={[]}
        okTitle="知道了"
        okTone="plain"
        onOk={() => setConfirm(null)}
        onCancel={() => setConfirm(null)}
        cancelTitle="关闭"
      >
        <Text style={s.blockedText}>{blocked?.msg}</Text>
        {blocked?.lesson ? (
          <Note tone="learn" style={s.dlgNote}>
            相关规则课在 M3 上线（学习 → 规则课）。
          </Note>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        visible={cancelling != null}
        title="撤单确认"
        rows={
          cancelling
            ? [
                {
                  k: '证券',
                  v: sim.security(cancelling.code)?.name ?? cancelling.code,
                },
                { k: '方向', v: cancelling.side === 'B' ? '买入' : '卖出' },
                {
                  k: '委托',
                  v:
                    (cancelling.price != null
                      ? formatPrice(
                          cancelling.price,
                          sim.security(cancelling.code)
                            ? ruleOf(sim.security(cancelling.code)!).decimals
                            : 2,
                        )
                      : '市价') +
                    ' × ' +
                    fmtQty(cancelling.qty),
                },
                { k: '已成交', v: fmtQty(cancelling.filled) },
                { k: '状态', v: cancelling.status },
              ]
            : []
        }
        okTitle="确认撤单"
        okTone="plain"
        onOk={() => cancelling && doCancel(cancelling)}
        onCancel={() => setCancelling(null)}
      />
    </View>
  );
}

function Stepper({
  value,
  placeholder,
  keyboard,
  onChange,
  onStep,
  label,
}: {
  value: string;
  placeholder: string;
  keyboard: 'decimal-pad' | 'number-pad';
  onChange: (v: string) => void;
  onStep: (dir: 1 | -1) => void;
  label: string;
}) {
  return (
    <View style={s.stepper}>
      <Pressable
        style={({ pressed }) => [s.stepBtn, pressed && s.pressed]}
        onPress={() => onStep(-1)}
        accessibilityLabel={'减' + label}
        hitSlop={4}
      >
        <Text style={s.stepText}>−</Text>
      </Pressable>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={color.ink3}
        keyboardType={keyboard}
        style={[s.input, num]}
        accessibilityLabel={label}
        selectTextOnFocus
      />
      <Pressable
        style={({ pressed }) => [s.stepBtn, pressed && s.pressed]}
        onPress={() => onStep(1)}
        accessibilityLabel={'加' + label}
        hitSlop={4}
      >
        <Text style={s.stepText}>＋</Text>
      </Pressable>
    </View>
  );
}

/** 右边的五档：点价格填入（委托类型切回限价）。数量单位是手。 */
function BookPanel({
  snap,
  d,
  onPick,
}: {
  snap: Snapshot | null;
  d: number;
  onPick: (price: number) => void;
}) {
  const pc = snap?.prevClose ?? null;
  const c3 = (p: number) =>
    pc == null ? color.ink : trendColor[trendOf(p - pc)];
  const row = (label: string, lv: [number, number] | undefined) => (
    <Pressable
      key={label}
      style={({ pressed }) => [s.bRow, pressed && s.pressed]}
      onPress={() => lv && onPick(lv[0])}
      disabled={!lv}
      accessibilityLabel={
        label + (lv ? ' ' + formatPrice(lv[0], d as 2 | 3) : '')
      }
    >
      <Text style={s.bK}>{label}</Text>
      <Text style={[s.bP, num, { color: lv ? c3(lv[0]) : color.ink3 }]}>
        {lv ? formatPrice(lv[0], d as 2 | 3) : '--'}
      </Text>
      <Text style={[s.bQ, num]}>{lv ? Math.round(lv[1] / 100) : ''}</Text>
    </Pressable>
  );
  return (
    <View style={s.book}>
      {[4, 3, 2, 1, 0].map(i => row('卖' + CN[i], snap?.asks[i]))}
      <View style={s.bMid}>
        <Text style={[s.bMidText, num]}>
          最新{' '}
          <Text
            style={{ color: snap?.last != null ? c3(snap.last) : color.ink3 }}
          >
            {snap?.last != null ? formatPrice(snap.last, d as 2 | 3) : '--'}
          </Text>
        </Text>
      </View>
      {[0, 1, 2, 3, 4].map(i => row('买' + CN[i], snap?.bids[i]))}
      <Text style={s.bUnit}>单位：手 · 点价格填入</Text>
    </View>
  );
}

function FeeItem({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.feeItem}>
      <Text style={s.feeK}>{k}</Text>
      <Text style={[s.feeV, num]}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { paddingBottom: 90 },
  pressed: { backgroundColor: color.press },
  note: { margin: 10 },
  ticket: {
    flexDirection: 'row',
    backgroundColor: color.card,
    paddingLeft: 10,
    paddingRight: 4,
    paddingTop: 8,
  },
  form: { flex: 1.25, gap: 6, paddingRight: 8 },
  fld: {
    height: 40,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 4,
  },
  secLine: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  secName: { fontSize: 15, fontWeight: '600', color: color.ink, flexShrink: 1 },
  secCode: { fontSize: 12, color: color.ink3 },
  kindText: { flex: 1, fontSize: 13, color: color.ink },
  stepper: {
    height: 40,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 20, color: color.ink2 },
  input: {
    flex: 1,
    height: 38,
    padding: 0,
    textAlign: 'center',
    fontSize: 16,
    color: color.ink,
  },
  hint: { flexDirection: 'row', justifyContent: 'space-between' },
  hintText: { fontSize: 12, color: color.ink3, paddingVertical: 2 },
  cage: { fontSize: 11, color: color.ink2 },
  cageBad: { color: color.up, fontWeight: '600' },
  marketNote: {
    fontSize: 12,
    color: color.ink2,
    textAlign: 'center',
    paddingVertical: 10,
  },
  can: { fontSize: 12, color: color.ink2 },
  canB: { color: color.ink, fontWeight: '600' },
  quick: { flexDirection: 'row', gap: 6 },
  qBtn: {
    flex: 1,
    height: 30,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qText: { fontSize: 13, color: color.ink },
  book: { flex: 1, paddingBottom: 6 },
  bRow: { flexDirection: 'row', alignItems: 'center', height: 25 },
  bK: { width: 30, fontSize: 12, color: color.ink3 },
  bP: { flex: 1, fontSize: 13, textAlign: 'right' },
  bQ: { width: 46, fontSize: 12, textAlign: 'right', color: color.ink2 },
  bMid: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    paddingVertical: 3,
    marginVertical: 2,
  },
  bMidText: { fontSize: 12, color: color.ink2 },
  bUnit: { fontSize: 10, color: color.ink3, marginTop: 2 },
  bottom: {
    backgroundColor: color.card,
    paddingHorizontal: 10,
    paddingBottom: 10,
    paddingTop: 6,
    gap: 6,
  },
  feeLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  feeText: { fontSize: 13, color: color.ink2 },
  feeB: { color: color.ink, fontWeight: '600' },
  feeBox: {
    backgroundColor: color.bg,
    borderRadius: 4,
    padding: 8,
    gap: 2,
  },
  feeItem: { flexDirection: 'row', justifyContent: 'space-between' },
  feeK: { fontSize: 12, color: color.ink2 },
  feeV: { fontSize: 12, color: color.ink },
  feeNote: { fontSize: 11, lineHeight: 16, color: color.ink3, marginTop: 4 },
  feeLink: { color: color.sell },
  check: { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 6 },
  checkOk: { backgroundColor: color.downBg },
  checkWarn: { backgroundColor: color.warnBg },
  checkBad: { backgroundColor: color.upBg },
  checkText: { fontSize: 12, lineHeight: 17, color: color.ink },
  submit: {
    height: 44,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  send: { fontSize: 11, lineHeight: 16, color: color.ink3 },
  secH: {
    fontSize: 13,
    fontWeight: '600',
    color: color.ink,
    paddingHorizontal: PAD,
    paddingTop: 12,
    paddingBottom: 6,
  },
  cancelBar: {
    flexDirection: 'row',
    gap: 8,
    padding: 8,
    paddingHorizontal: PAD,
    backgroundColor: color.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  cantCancel: {
    fontSize: 11,
    color: color.warnInk,
    backgroundColor: color.warnBg,
    paddingHorizontal: PAD,
    paddingVertical: 3,
  },
  mask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: color.card,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingBottom: 24,
  },
  sheetH: {
    fontSize: 15,
    fontWeight: '600',
    color: color.ink,
    padding: PAD,
  },
  sheetRow: {
    paddingHorizontal: PAD,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  sheetText: { fontSize: 15, color: color.ink },
  sheetOn: { color: color.up, fontWeight: '600' },
  sheetNote: {
    fontSize: 12,
    lineHeight: 18,
    color: color.ink3,
    paddingHorizontal: PAD,
    paddingTop: 8,
  },
  dlgNote: { marginTop: 10 },
  blockedText: {
    fontSize: 14,
    lineHeight: 21,
    color: color.ink,
    marginTop: 10,
  },
});
