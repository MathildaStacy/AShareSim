/**
 * M6 回放交易页：沙盒账户在回放时钟上交易（docs/M6_REPLAY.md）。
 * 上面是时钟（暂停 / 倍速 / 跳到下一时段），中间是行情、分时和五档（点价格填入），下面是下单、委托、成交、账户。
 * 下单走引擎同一套校验；你的操作带着回放时间存下来，重开页面时从头重算。结束后揭晓日期（盲测）和结果。
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { holdingOf, isLive } from '../../engine/account';
import { ruleOf, type Security } from '../../engine/securities';
import { CLOSE, formatSec, PHASES, phaseAt, T } from '../../engine/session';
import { KIND_NAME, type EngineEvent } from '../../engine/types';
import { formatFen, formatPrice } from '../../engine/units';
import { needsProtect } from '../../engine/validate';
import {
  displayCode,
  displayDate,
  displayName,
  loadPractice,
  nextStop,
  PracticeSession,
} from '../../replay/practice';
import { toastOf } from '../../sim/describe';
import {
  defaultPrice,
  defaultProtect,
  estimate,
  isMarketKind,
  kindOptions,
  maxBuy,
  parsePrice,
  priceText,
  quickQty,
  sendText,
  stepPrice,
  stepQty,
  toRequest,
  type OrderForm,
} from '../../sim/orderForm';
import { BOARD_NAME } from '../../sim/ruleCard';
import { MinuteChart } from '../charts/Charts';
import { minuteSeries } from '../charts/chartMath';
import { CheckBar } from '../components/form';
import {
  Button,
  Empty,
  NavBar,
  Note,
  SectionTitle,
  Segmented,
} from '../components/ui';
import { fmtPct, fmtQty, fmtSignedFen, trendOf } from '../format';
import { useAiContext, useCore, useViewLog } from '../hooks';
import type { RootScreenProps } from '../navigation/types';
import { color, num, PAD, trendColor } from '../theme';
import { toast } from '../toast';

type Speed = 0 | 1 | 10 | 60;
const SPEEDS: [string, string][] = [
  ['0', '暂停'],
  ['1', '1×'],
  ['10', '10×'],
  ['60', '60×'],
];
const TICK_MS = 500;
const CN = '一二三四五';

type Form = Omit<OrderForm, 'code'>;
const EMPTY_FORM: Form = {
  side: 'B',
  kind: 'limit',
  price: '',
  qty: '',
  protect: '',
};

/** 回放里能下的委托类型：没有盘后固定价格（快照里没有盘后成交量）。 */
const replayKinds = (sec: Security) =>
  kindOptions(sec).filter(k => k.kind !== 'after');

export function ReplayRunScreen({ route }: RootScreenProps<'ReplayRun'>) {
  const { id } = route.params;
  const core = useCore();
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setRev] = useState(0);
  const bump = () => setRev(v => v + 1);
  const [speed, setSpeed] = useState<Speed>(0);
  const [code, setCode] = useState('');
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [priceTouched, setPriceTouched] = useState(false);
  const carry = useRef(0);
  const ticks = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const rec = await loadPractice(core.db, id);
      if (!rec) {
        throw new Error('找不到这次回放');
      }
      const s = await PracticeSession.open(core.db, rec, core.sim.calendar);
      if (alive) {
        setSession(s);
        setCode(s.codes[0] ?? Object.keys(rec.seed.secs)[0] ?? '');
      }
    })().catch(
      e => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [core, id]);

  const record = session?.record ?? null;
  const secOf = useCallback(
    (c: string): Security | null => {
      const sec = session?.security(c) ?? null;
      return sec && record ? { ...sec, name: displayName(record, c) } : sec;
    },
    [session, record],
  );

  const announce = useCallback(
    (events: EngineEvent[]) => {
      for (const e of events) {
        const t = toastOf(e, secOf);
        if (t) {
          toast.show('回放 · ' + t.text, t.tone);
        }
      }
    },
    [secOf],
  );

  const save = useCallback(() => {
    session?.save(core.db).catch(() => undefined);
  }, [session, core.db]);

  // 离开页面时停下并保存时钟
  useFocusEffect(
    useCallback(
      () => () => {
        setSpeed(0);
        save();
      },
      [save],
    ),
  );

  // 回放时钟：每 500 毫秒走 speed × 0.5 秒（攒够 1 秒才推进），到 15:00 自动暂停
  useEffect(() => {
    if (!session || !speed || session.finished) {
      return;
    }
    const timer = setInterval(() => {
      carry.current += (speed * TICK_MS) / 1000;
      const n = Math.floor(carry.current);
      if (!n) {
        return;
      }
      carry.current -= n;
      const before = session.now.t;
      announce(session.step(n));
      if (before < CLOSE && session.now.t >= CLOSE) {
        setSpeed(0);
        toast.show('回放 · 收盘了：可以结束并查看结果', 'learn');
      }
      if (++ticks.current % 20 === 0) {
        save();
      }
      bump();
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [session, speed, announce, save]);

  const sec = code ? secOf(code) : null;
  const snap = session && code ? session.quote(code) : null;
  const d = sec ? ruleOf(sec).decimals : 2;

  // 换证券 / 方向时按对手价填价格（之后不覆盖输入）
  useEffect(() => {
    if (priceTouched || form.price) {
      return;
    }
    const p = defaultPrice(form.side, snap);
    if (p != null) {
      setForm(f => ({ ...f, price: priceText(p, d) }));
    }
  }, [code, form.side, snap, priceTouched, form.price, d]);
  useEffect(() => {
    if (sec && isMarketKind(form.kind) && needsProtect(sec) && !form.protect) {
      const p = defaultProtect(sec, form.side, snap);
      if (p != null) {
        setForm(f => ({ ...f, protect: priceText(p, d) }));
      }
    }
  }, [sec, form.kind, form.side, form.protect, snap, d]);

  const name = record && code ? displayName(record, code) : '';
  useViewLog('ReplayRun:' + id, '回放练习 #' + id);
  useAiContext('ReplayRun', () => {
    if (!session || !record) {
      return { name: '回放练习', lines: ['正在准备'] };
    }
    const st = session.engine.state;
    const blindNow = record.config.blind && !session.finished;
    return {
      name: '回放练习 #' + id,
      lines: [
        '这是回放练习的沙盒账户，不影响真实账户',
        blindNow
          ? '盲测中：日期已隐藏' +
            (record.config.hideNames ? '，证券名称也已隐藏' : '') +
            '，不要推测或透露日期和证券'
          : '回放日期 ' + record.date,
        '回放时间 ' +
          formatSec(session.now.t) +
          '（' +
          PHASES[phaseAt(session.now.t)].name +
          '）' +
          (session.finished ? '，已结束' : ''),
        ...(snap && sec
          ? [
              name +
                ' 最新 ' +
                formatPrice(snap.last ?? snap.prevClose, d) +
                '，昨收 ' +
                formatPrice(snap.prevClose, d) +
                '，卖一 ' +
                (snap.asks[0] ? formatPrice(snap.asks[0][0], d) : '--') +
                ' / 买一 ' +
                (snap.bids[0] ? formatPrice(snap.bids[0][0], d) : '--'),
            ]
          : []),
        '可用 ' +
          formatFen(st.cash - st.frozen) +
          ' 元，总资产约 ' +
          formatFen(session.equity()) +
          ' 元',
        '未完成委托 ' +
          st.orders.filter(isLive).length +
          ' 笔，今天成交 ' +
          st.fills.filter(f => f.date === record.date).length +
          ' 笔',
      ],
      tip: '回放按本地录下的快照撮合，规则和费用和实时模拟一样；没录到快照的时段不会成交。',
    };
  });

  if (!session || !record) {
    return (
      <View style={s.page}>
        <NavBar title="回放练习" back />
        <Empty text={error ?? '正在读取快照并重算…'} />
      </View>
    );
  }

  // ---------- 派生数据 ----------
  const st = session.engine.state;
  const now = session.now;
  const phase = phaseAt(now.t);
  const done = session.finished;
  const fee = st.fee;
  const req = sec ? toRequest({ ...form, code }, sec) : null;
  const check = req && !done ? session.check(req) : null;
  const est = req && sec ? estimate(req, sec, snap, fee) : null;
  const avail = st.cash - st.frozen;
  const canBuy =
    sec && est && form.side === 'B'
      ? maxBuy(sec, est.freezePrice, avail, fee)
      : 0;
  const h = code ? holdingOf(st, code) : null;
  const unit = sec?.board === 'etf' ? '份' : '股';
  const stop = nextStop(now.t);
  const start = session.startEquity();
  const equity = session.equity();
  const orders = st.orders.filter(o => o.date === record.date || isLive(o));
  const fills = st.fills.filter(f => f.date === record.date);
  const held = [...new Set(st.lots.map(l => l.code))];
  const last = snap ? snap.last ?? snap.prevClose : null;
  const chg = snap && last != null ? last - snap.prevClose : null;
  const pts = code ? session.points(code) : [];
  const series = snap ? minuteSeries(pts, snap.prevClose, true) : null;
  // 第一个快照晚于开盘时，它的累计量包含之前没录到的所有成交，不画成一根量柱
  if (series && pts.length && pts[0].t > T(9, 31) && series.volume.length) {
    series.volume[0] = 0;
  }
  const set = (patch: Partial<Form>) => setForm(f => ({ ...f, ...patch }));
  const pick = (c: string) => {
    setCode(c);
    setPriceTouched(false);
    setForm(f => ({ ...EMPTY_FORM, side: f.side }));
  };

  const run = (fn: () => EngineEvent[]) => {
    announce(fn());
    save();
    bump();
  };
  const submit = () => {
    if (!req) {
      return;
    }
    const r = session.place(req);
    if (!r.ok) {
      toast.show('回放 · 不能提交（' + r.rule + '）：' + r.msg, 'warn');
      return;
    }
    announce(r.events);
    setForm(f => ({ ...f, qty: '' }));
    save();
    bump();
  };
  const finish = () => {
    setSpeed(0);
    session.finish();
    save();
    bump();
  };

  return (
    <View style={s.page}>
      <NavBar
        title={'回放练习' + (record.config.blind && !done ? ' · 盲测' : '')}
        sub={displayDate(record)}
        back
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[s.pad, { paddingBottom: insets.bottom + 32 }]}
      >
        {/* 时钟 */}
        <View style={s.clock}>
          <View style={s.clockTop}>
            <Text
              style={[s.clockTime, num]}
              accessibilityLabel={'回放时间 ' + formatSec(now.t)}
            >
              {formatSec(now.t)}
            </Text>
            <Text style={s.clockPhase}>
              {done ? '已结束' : PHASES[phase].name}
            </Text>
          </View>
          {!done ? (
            <>
              <Segmented
                items={SPEEDS}
                value={String(speed)}
                onChange={v => setSpeed(Number(v) as Speed)}
              />
              <View style={s.clockBtns}>
                {stop ? (
                  <Button
                    small
                    tone="ghost"
                    title={'跳到 ' + stop.label}
                    onPress={() => run(() => session.runTo(stop.t))}
                  />
                ) : null}
                <Button
                  small
                  tone="ghost"
                  title="+1 分钟"
                  onPress={() => run(() => session.step(60))}
                />
                <Button
                  small
                  tone="learn"
                  title={now.t >= CLOSE ? '结束并看结果' : '快进到收盘并结束'}
                  onPress={finish}
                />
              </View>
            </>
          ) : null}
          {code && session.gapAt(code) ? (
            <Text style={s.gapText}>
              {formatSec(snap!.t)} 以后没录到这只证券的快照：这段时间不会成交
            </Text>
          ) : null}
        </View>

        {done && record.result ? <ResultCard session={session} /> : null}

        {/* 证券 */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.chips}
        >
          {[...new Set([...session.codes, ...held])].map(c => {
            const q = session.quote(c);
            const p = q ? (q.last ?? q.prevClose) - q.prevClose : null;
            return (
              <Pressable
                key={c}
                onPress={() => pick(c)}
                style={[s.chip, c === code && s.chipOn]}
                accessibilityRole="button"
                accessibilityLabel={'选择 ' + displayName(record, c)}
              >
                <Text
                  style={[s.chipName, c === code && s.chipNameOn]}
                  numberOfLines={1}
                >
                  {displayName(record, c)}
                </Text>
                <Text
                  style={[s.chipPct, num, { color: trendColor[trendOf(p)] }]}
                >
                  {q && p != null ? fmtPct((p / q.prevClose) * 100) : '--'}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* 行情 */}
        {sec ? (
          <View style={s.card}>
            <View style={s.quoteHead}>
              <View style={s.flex}>
                <Text style={s.qName} numberOfLines={1}>
                  {name}{' '}
                  <Text style={[s.qCode, num]}>
                    {displayCode(record, code).replace(/^(sh|sz)/, '')}
                  </Text>
                </Text>
                <Text style={s.qBoard}>
                  {(sec.exchange === 'SH' ? '沪市' : '深市') +
                    BOARD_NAME[sec.board] +
                    (sec.st ? ' · ST' : '')}
                </Text>
              </View>
              <View style={s.qRight}>
                <Text
                  style={[s.qLast, num, { color: trendColor[trendOf(chg)] }]}
                >
                  {last != null ? formatPrice(last, d) : '--'}
                </Text>
                <Text
                  style={[s.qChg, num, { color: trendColor[trendOf(chg)] }]}
                >
                  {snap && chg != null
                    ? (chg > 0 ? '+' : '') +
                      formatPrice(chg, d) +
                      '  ' +
                      fmtPct((chg / snap.prevClose) * 100)
                    : '还没到第一个快照'}
                </Text>
              </View>
            </View>
            <MinuteChart
              series={series}
              prevClose={snap?.prevClose ?? null}
              decimals={d}
              emptyText="9:30 以后显示分时"
            />
            {snap ? (
              <View style={s.book}>
                {[...snap.asks.slice(0, 5)].reverse().map((l, i, arr) => (
                  <BookRow
                    key={'a' + i}
                    label={'卖' + CN[arr.length - 1 - i]}
                    price={formatPrice(l[0], d)}
                    qty={fmtQty(l[1])}
                    onPress={() => {
                      setPriceTouched(true);
                      set({ price: priceText(l[0], d) });
                    }}
                  />
                ))}
                <View style={s.bookLine} />
                {snap.bids.slice(0, 5).map((l, i) => (
                  <BookRow
                    key={'b' + i}
                    label={'买' + CN[i]}
                    price={formatPrice(l[0], d)}
                    qty={fmtQty(l[1])}
                    onPress={() => {
                      setPriceTouched(true);
                      set({ price: priceText(l[0], d) });
                    }}
                  />
                ))}
                <Text style={[s.bookFoot, num]}>
                  快照 {formatSec(snap.t)} · 涨停{' '}
                  {snap.up != null ? formatPrice(snap.up, d) : '--'} · 跌停{' '}
                  {snap.down != null ? formatPrice(snap.down, d) : '--'}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* 下单 */}
        {sec && !done ? (
          <View style={s.card}>
            <View style={s.formPad}>
              <Segmented
                items={[
                  ['B', '买入'],
                  ['S', '卖出'],
                ]}
                value={form.side}
                onChange={v => {
                  setPriceTouched(false);
                  setForm({ ...EMPTY_FORM, side: v as 'B' | 'S' });
                }}
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.kinds}
              >
                {replayKinds(sec).map(k => (
                  <Pressable
                    key={k.kind}
                    onPress={() => set({ kind: k.kind, protect: '' })}
                    style={[s.kind, form.kind === k.kind && s.kindOn]}
                    accessibilityRole="button"
                    accessibilityLabel={KIND_NAME[k.kind]}
                  >
                    <Text
                      style={[s.kindText, form.kind === k.kind && s.kindTextOn]}
                    >
                      {KIND_NAME[k.kind]}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              {form.kind === 'limit' ? (
                <Stepper
                  label="价格"
                  value={form.price}
                  onChange={v => {
                    setPriceTouched(true);
                    set({ price: v });
                  }}
                  onStep={dir =>
                    set({
                      price: priceText(
                        stepPrice(parsePrice(form.price, d), dir, sec, snap),
                        d,
                      ),
                    })
                  }
                />
              ) : needsProtect(sec) ? (
                <Stepper
                  label="保护限价"
                  value={form.protect}
                  onChange={v => set({ protect: v })}
                  onStep={dir =>
                    set({
                      protect: priceText(
                        stepPrice(parsePrice(form.protect, d), dir, sec, snap),
                        d,
                      ),
                    })
                  }
                />
              ) : null}
              <Stepper
                label={'数量（' + unit + '）'}
                value={form.qty}
                onChange={v => set({ qty: v })}
                onStep={dir => {
                  const q = stepQty(Number(form.qty) || 0, dir, sec, form.side);
                  set({ qty: q ? String(q) : '' });
                }}
              />
              <View style={s.quick}>
                {([1, 2, 3, 4] as const).map(div => (
                  <Button
                    key={div}
                    small
                    tone="ghost"
                    title={div === 1 ? '全部' : '1/' + div}
                    onPress={() => {
                      const q = quickQty(
                        div,
                        form.side,
                        sec,
                        canBuy,
                        h?.sellable ?? 0,
                      );
                      set({ qty: q ? String(q) : '' });
                    }}
                  />
                ))}
              </View>
              <Text style={[s.hint, num]}>
                {form.side === 'B'
                  ? '可用 ' +
                    formatFen(avail) +
                    ' 元，最多买 ' +
                    fmtQty(canBuy) +
                    ' ' +
                    unit
                  : '可卖 ' +
                    fmtQty(h?.sellable ?? 0) +
                    ' ' +
                    unit +
                    '（持有 ' +
                    fmtQty(h?.held ?? 0) +
                    '）'}
                {est && est.qty > 0 && est.price != null
                  ? '\n金额约 ' +
                    formatFen(est.amount) +
                    ' 元，预估费用 ' +
                    formatFen(est.fee.total) +
                    ' 元'
                  : ''}
              </Text>
              {check ? (
                <CheckBar
                  ok={check.ok}
                  text={
                    check.ok
                      ? '校验通过 · ' + sendText(check.route, phase, true)
                      : (check.level === 'block'
                          ? '不能提交（'
                          : '提交后会成为废单（') +
                        check.rule +
                        '）：' +
                        check.msg
                  }
                />
              ) : null}
              <Button
                title={form.side === 'B' ? '提交买入' : '提交卖出'}
                tone={form.side === 'B' ? 'buy' : 'sell'}
                disabled={!check || (!check.ok && check.level === 'block')}
                onPress={submit}
              />
            </View>
          </View>
        ) : null}

        {/* 账户 */}
        <SectionTitle
          title="回放账户"
          right={
            record.config.start === 'account' ? '真实账户起步' : '现金起步'
          }
        />
        <View style={s.card}>
          <Line k="总资产" v={formatFen(equity) + ' 元'} />
          <Line
            k="盈亏"
            v={fmtSignedFen(equity - start) + ' 元'}
            c={trendColor[trendOf(equity - start)]}
          />
          <Line k="可用" v={formatFen(avail) + ' 元'} />
          {held.map(c => {
            const hh = holdingOf(st, c);
            return (
              <Line
                key={c}
                k={displayName(record, c)}
                v={
                  fmtQty(hh.held) +
                  ' ' +
                  unit +
                  (hh.todayBuy
                    ? '（今天买入 ' + fmtQty(hh.todayBuy) + '，明天才能卖）'
                    : '')
                }
              />
            );
          })}
        </View>

        <SectionTitle
          title="委托"
          right={orders.length ? orders.length + ' 笔' : undefined}
        />
        <View style={s.card}>
          {orders.length ? (
            orders.map(o => {
              const od = secOf(o.code);
              const dd = od ? ruleOf(od).decimals : 2;
              return (
                <View key={o.id} style={s.oRow}>
                  <View style={s.flex}>
                    <Text style={s.oHead} numberOfLines={1}>
                      <Text
                        style={{
                          color: o.side === 'B' ? color.up : color.sell,
                        }}
                      >
                        {o.side === 'B' ? '买 ' : '卖 '}
                      </Text>
                      {displayName(record, o.code)} ·{' '}
                      {o.price != null ? formatPrice(o.price, dd) : '市价'} ×{' '}
                      {fmtQty(o.qty)}
                    </Text>
                    <Text style={[s.oSub, num]} numberOfLines={2}>
                      {formatSec(o.t)} {KIND_NAME[o.kind]} · {o.status}
                      {o.filled ? ' · 成交 ' + fmtQty(o.filled) : ''}
                      {o.reason || o.note ? ' · ' + (o.reason || o.note) : ''}
                    </Text>
                  </View>
                  {isLive(o) && !done ? (
                    <Button
                      small
                      tone="ghost"
                      title="撤单"
                      onPress={() => {
                        const r = session.cancel(o.id);
                        if (!r.ok) {
                          toast.show('回放 · ' + r.msg, 'warn');
                        }
                        run(() => r.events);
                      }}
                    />
                  ) : null}
                </View>
              );
            })
          ) : (
            <Empty text="还没有委托" />
          )}
        </View>

        <SectionTitle
          title="成交"
          right={fills.length ? fills.length + ' 笔' : undefined}
        />
        <View style={s.card}>
          {fills.length ? (
            fills.map(f => {
              const fd = secOf(f.code);
              return (
                <View key={f.id} style={s.oRow}>
                  <View style={s.flex}>
                    <Text style={s.oHead}>
                      <Text
                        style={{
                          color: f.side === 'B' ? color.up : color.sell,
                        }}
                      >
                        {f.side === 'B' ? '买 ' : '卖 '}
                      </Text>
                      {displayName(record, f.code)} ·{' '}
                      {formatPrice(f.price, fd ? ruleOf(fd).decimals : 2)} ×{' '}
                      {fmtQty(f.qty)} · 费用 {formatFen(f.fee.total)}
                    </Text>
                    <Text style={s.oSub}>{f.basis.text}</Text>
                  </View>
                </View>
              );
            })
          ) : (
            <Empty text="还没有成交" />
          )}
        </View>
        <Note style={s.gapNote}>
          沙盒账户，不影响真实账户。快照只在 App
          开着时录，没录到的时段不会成交；盘后固定价格交易没有数据，不能下。
        </Note>
      </ScrollView>
    </View>
  );
}

function BookRow({
  label,
  price,
  qty,
  onPress,
}: {
  label: string;
  price: string;
  qty: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.bRow, pressed && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label + ' ' + price}
    >
      <Text style={s.bLabel}>{label}</Text>
      <Text style={[s.bPrice, num]}>{price}</Text>
      <Text style={[s.bQty, num]}>{qty}</Text>
    </Pressable>
  );
}

function Stepper({
  label,
  value,
  onChange,
  onStep,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onStep: (dir: 1 | -1) => void;
}) {
  return (
    <View style={s.step}>
      <Text style={s.stepLabel}>{label}</Text>
      <Pressable
        onPress={() => onStep(-1)}
        style={s.stepBtn}
        accessibilityRole="button"
        accessibilityLabel={label + ' 减'}
      >
        <Text style={s.stepBtnText}>−</Text>
      </Pressable>
      <TextInput
        style={[s.stepInput, num]}
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        accessibilityLabel={label}
      />
      <Pressable
        onPress={() => onStep(1)}
        style={s.stepBtn}
        accessibilityRole="button"
        accessibilityLabel={label + ' 加'}
      >
        <Text style={s.stepBtnText}>+</Text>
      </Pressable>
    </View>
  );
}

function Line({ k, v, c }: { k: string; v: string; c?: string }) {
  return (
    <View style={s.line}>
      <Text style={s.lineK} numberOfLines={1}>
        {k}
      </Text>
      <Text style={[s.lineV, num, c ? { color: c } : null]}>{v}</Text>
    </View>
  );
}

/** 结束后：揭晓日期和证券，列出盈亏、费用、成交，以及每只证券当天最后的价格。 */
function ResultCard({ session }: { session: PracticeSession }) {
  const r = session.record;
  const res = r.result!;
  return (
    <View style={[s.card, s.result]}>
      <Text style={s.resultTitle}>
        {r.config.blind ? '揭晓：' : ''}
        {displayDate(r)}
      </Text>
      <Text style={[s.resultPnl, num, { color: trendColor[trendOf(res.pnl)] }]}>
        {fmtSignedFen(res.pnl)} 元
      </Text>
      <Text style={[s.hint, num]}>
        起点 {formatFen(res.startEquity)} 元 → 收盘 {formatFen(res.endEquity)}{' '}
        元；委托 {res.orders} 笔，成交 {res.fills} 笔，费用合计{' '}
        {formatFen(res.fees)} 元
      </Text>
      {Object.entries(res.closes).map(([c, p]) => {
        const sec = session.security(c);
        return (
          <Line
            key={c}
            k={(sec?.name ?? c) + ' ' + c.slice(2)}
            v={'收于 ' + formatPrice(p, sec ? ruleOf(sec).decimals : 2)}
          />
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { padding: PAD, gap: 10 },
  flex: { flex: 1 },
  pressed: { backgroundColor: color.press },
  card: { backgroundColor: color.card, borderRadius: 10, overflow: 'hidden' },
  clock: {
    backgroundColor: color.card,
    borderRadius: 10,
    padding: 14,
    gap: 10,
  },
  clockTop: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  clockTime: { fontSize: 30, fontWeight: '600', color: color.ink },
  clockPhase: { fontSize: 14, color: color.learn, fontWeight: '500' },
  clockBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gapText: { fontSize: 12, color: color.warnInk, lineHeight: 17 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: {
    backgroundColor: color.card,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 84,
    borderWidth: 1,
    borderColor: color.line,
  },
  chipOn: { borderColor: color.learn, backgroundColor: color.learnBg },
  chipName: { fontSize: 13, color: color.ink, maxWidth: 120 },
  chipNameOn: { color: color.learn, fontWeight: '600' },
  chipPct: { fontSize: 12, marginTop: 2 },
  quoteHead: { flexDirection: 'row', padding: 14, paddingBottom: 6, gap: 10 },
  qName: { fontSize: 17, fontWeight: '600', color: color.ink },
  qCode: { fontSize: 13, color: color.ink3, fontWeight: '400' },
  qBoard: { fontSize: 12, color: color.ink3, marginTop: 2 },
  qRight: { alignItems: 'flex-end' },
  qLast: { fontSize: 22, fontWeight: '600' },
  qChg: { fontSize: 12 },
  book: { paddingHorizontal: 14, paddingBottom: 12 },
  bookLine: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.line,
    marginVertical: 4,
  },
  bRow: { flexDirection: 'row', alignItems: 'center', minHeight: 30 },
  bLabel: { width: 44, fontSize: 13, color: color.ink2 },
  bPrice: { flex: 1, fontSize: 14, color: color.ink },
  bQty: { fontSize: 13, color: color.ink2 },
  bookFoot: { fontSize: 11, color: color.ink3, marginTop: 6 },
  formPad: { padding: 14, gap: 10 },
  kinds: { gap: 6 },
  kind: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: color.line,
  },
  kindOn: { borderColor: color.sell, backgroundColor: '#EAF1FD' },
  kindText: { fontSize: 12, color: color.ink2 },
  kindTextOn: { color: color.sell, fontWeight: '600' },
  step: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepLabel: { width: 82, fontSize: 13, color: color.ink2 },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: color.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { fontSize: 20, color: color.ink },
  stepInput: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    paddingHorizontal: 10,
    fontSize: 16,
    color: color.ink,
    textAlign: 'center',
  },
  quick: { flexDirection: 'row', gap: 8 },
  hint: { fontSize: 12, color: color.ink2, lineHeight: 18 },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  lineK: { fontSize: 13, color: color.ink2, flexShrink: 1 },
  lineV: { fontSize: 13, color: color.ink, flexShrink: 1, textAlign: 'right' },
  oRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  oHead: { fontSize: 14, color: color.ink },
  oSub: { fontSize: 12, color: color.ink3, marginTop: 3, lineHeight: 17 },
  result: { padding: 14, gap: 6 },
  resultTitle: { fontSize: 15, fontWeight: '600', color: color.ink },
  resultPnl: { fontSize: 26, fontWeight: '600' },
  gapNote: { marginTop: 4 },
});
