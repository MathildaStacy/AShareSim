/**
 * 集合竞价演示（M3，PRODUCT_DESIGN §6.4）：一只前收 10.00 的股票攒了一些买卖单，看开盘价怎么按
 * 「成交量最大 → 未成交量最小 → 沪市中间价 / 深市最接近前收」产生。定价规则在 src/learn/auction.ts。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { answerAuctionQuiz, logLearn, useLearn } from '../../app/learn';
import type { Li } from '../../engine/units';
import {
  auctionPrice,
  DEMO_ORDERS,
  DEMO_PREV,
  type AuctionOrder,
  type AuctionRule,
} from '../../learn/auction';
import { AUCTION_DEMO_ID } from '../../learn/progress';
import { parsePrice, parseQty } from '../../sim/orderForm';
import { ChoiceRow, FieldRow } from '../components/form';
import { AiFab, Button, NavBar, Note, SectionTitle } from '../components/ui';
import { useAiContext, useCore, useViewLog } from '../hooks';
import type { RootStackParamList } from '../navigation/types';
import { color, num, PAD } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const y = (li: Li) => (li / 1000).toFixed(2);

/** 小测：取一笔出价高于开盘价的买单，问成交价。 */
function quizOf(orders: AuctionOrder[], open: Li | null) {
  if (open == null) {
    return null;
  }
  const bid = orders
    .filter(o => o.side === 'B' && o.price > open)
    .sort((a, b) => b.price - a.price)[0];
  if (!bid) {
    return null;
  }
  const avg = Math.round((bid.price + open) / 20) * 10;
  const options = [...new Set([bid.price, open, avg])];
  return {
    q:
      '你出价 ' +
      y(bid.price) +
      ' 买入，开盘价 ' +
      y(open) +
      '，成交价是多少？',
    options,
    answer: open,
  };
}

export function AuctionScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const done = !!useLearn(st => st.checks[AUCTION_DEMO_ID]);
  const [orders, setOrders] = useState<AuctionOrder[]>(DEMO_ORDERS);
  const [rule, setRule] = useState<AuctionRule>('SH');
  const [side, setSide] = useState<'B' | 'S'>('B');
  const [price, setPrice] = useState('10.00');
  const [qty, setQty] = useState('300');
  const [pick, setPick] = useState<Li | null>(null);
  const res = auctionPrice(orders, DEMO_PREV, rule);
  const quiz = quizOf(orders, res.price);
  const px = parsePrice(price, 2);
  const q = parseQty(qty);
  const priceErr =
    px == null || px <= 0
      ? '价格最多 2 位小数'
      : px < 9_000 || px > 11_000
      ? '主板涨跌幅 ±10%：只能在 9.00 到 11.00 之间'
      : null;
  const qtyErr = q == null || q <= 0 ? '填正整数（手）' : null;

  useViewLog('auction', '查看 集合竞价演示');
  useAiContext('Auction', () => ({
    name: '学习 · 集合竞价演示',
    lines: [
      '前收盘 ' + y(DEMO_PREV) + '，规则：' + (rule === 'SH' ? '沪市' : '深市'),
      '买单：' +
        orders
          .filter(o => o.side === 'B')
          .map(o => y(o.price) + ' × ' + o.qty + ' 手')
          .join('，'),
      '卖单：' +
        orders
          .filter(o => o.side === 'S')
          .map(o => y(o.price) + ' × ' + o.qty + ' 手')
          .join('，'),
      ...res.rows.map(
        r =>
          y(r.price) +
          '：累计买 ' +
          r.buyCum +
          '，累计卖 ' +
          r.sellCum +
          '，可成交 ' +
          r.volume +
          '，未成交 ' +
          r.imbalance +
          (r.valid ? '' : '（不满足成交条件）'),
      ),
      res.price != null
        ? '开盘价 ' + y(res.price) + '，成交 ' + res.volume + ' 手'
        : '没有开盘价',
      '理由：' + res.steps.join('；'),
      '加单表单：' +
        (side === 'B' ? '买' : '卖') +
        ' ' +
        price +
        ' × ' +
        qty +
        ' 手' +
        (priceErr || qtyErr ? '（' + (priceErr ?? qtyErr) + '）' : ''),
      quiz
        ? '小测「' +
          quiz.q +
          '」：' +
          (pick == null
            ? '未答'
            : '选了 ' +
              y(pick) +
              '，' +
              (pick === quiz.answer ? '答对' : '答错'))
        : '小测：现在没有出价高于开盘价的买单',
      '演示' + (done ? '已完成' : '未完成'),
    ],
    tip: '集合竞价只产生一个价格，所有能成交的单都按它成交。出价高于开盘价的买单按开盘价成交，不按委托价。',
  }));

  const add = () => {
    if (priceErr || qtyErr || px == null || q == null) {
      return;
    }
    const id = Math.max(0, ...orders.map(o => o.id)) + 1;
    setOrders([...orders, { id, side, price: px, qty: q }]);
    setPick(null);
    logLearn(
      core,
      '集合竞价演示加一笔' +
        (side === 'B' ? '买单' : '卖单') +
        ' ' +
        y(px) +
        ' × ' +
        q +
        ' 手',
      { demo: 'auction' },
    ).catch(() => undefined);
  };
  const answer = (v: Li) => {
    if (!quiz || pick != null) {
      return;
    }
    setPick(v);
    answerAuctionQuiz(core, quiz.q, y(v), v === quiz.answer).catch(
      () => undefined,
    );
  };

  return (
    <View style={s.page}>
      <NavBar title="集合竞价演示" sub={done ? '已完成' : '前收 10.00'} back />
      <ScrollView
        contentContainerStyle={s.pad}
        keyboardShouldPersistTaps="handled"
      >
        <Note tone="learn" style={s.note}>
          9:15–9:25 的买卖单先攒着不成交。9:25
          交易所找一个价格，让能成交的量最多，所有能成交的单都按这个价成交，它就是开盘价。
        </Note>
        <View style={s.card}>
          <ChoiceRow
            label="定价规则"
            sub="前两步沪深一样；平手时沪市取中间价，深市取最接近前收盘价的"
            items={[
              ['SH', '沪市'],
              ['SZ', '深市'],
            ]}
            value={rule}
            onChange={setRule}
          />
        </View>
        <View style={s.card}>
          <View style={[s.tr, s.th]}>
            {['价格', '累计买', '累计卖', '可成交', '未成交'].map(h => (
              <Text key={h} style={[s.td, s.thText]}>
                {h}
              </Text>
            ))}
          </View>
          {res.rows.map(r => {
            const on = r.price === res.price;
            return (
              <View key={r.price} style={[s.tr, on && s.on]}>
                <Text style={[s.td, num, on && s.onText]}>{y(r.price)}</Text>
                <Text style={[s.td, num]}>{r.buyCum}</Text>
                <Text style={[s.td, num]}>{r.sellCum}</Text>
                <Text style={[s.td, num, on && s.onText, !r.valid && s.dim]}>
                  {r.volume}
                </Text>
                <Text style={[s.td, num]}>{r.imbalance}</Text>
              </View>
            );
          })}
          <Text style={s.small}>
            累计买 = 出价 ≥
            这个价的买单之和（愿意出更高价的当然也愿意按这个价买）；累计卖 =
            要价 ≤
            这个价的卖单之和。单位：手。可成交是灰色的价位不满足「高于它的买单、低于它的卖单都能成交」，不能当开盘价。
          </Text>
        </View>
        <View style={[s.card, s.result]}>
          <Text style={s.resultT}>
            {res.price != null
              ? '开盘价 ' + y(res.price) + ' · 成交 ' + res.volume + ' 手'
              : '没有开盘价'}
          </Text>
          {res.steps.map((t, i) => (
            <Text key={i} style={s.step}>
              {i + 1}. {t}
            </Text>
          ))}
        </View>
        <SectionTitle title="委托" right="点 × 删除" />
        <View style={s.card}>
          {orders.map(o => (
            <View key={o.id} style={s.order}>
              <Text
                style={[
                  s.oSide,
                  { color: o.side === 'B' ? color.up : color.sell },
                ]}
              >
                {o.side === 'B' ? '买' : '卖'}
              </Text>
              <Text style={[s.oText, num]}>
                {y(o.price)} × {o.qty} 手
              </Text>
              <Pressable
                onPress={() => {
                  setOrders(orders.filter(x => x.id !== o.id));
                  setPick(null);
                }}
                hitSlop={8}
                accessibilityLabel={'删除 ' + y(o.price)}
              >
                <Text style={s.del}>×</Text>
              </Pressable>
            </View>
          ))}
          <ChoiceRow
            label="加一笔"
            items={[
              ['B', '买'],
              ['S', '卖'],
            ]}
            value={side}
            onChange={setSide}
          />
          <FieldRow
            label="价格"
            value={price}
            onChangeText={setPrice}
            unit="元"
            error={priceErr}
          />
          <FieldRow
            label="数量"
            value={qty}
            onChangeText={setQty}
            unit="手"
            keyboardType="number-pad"
            error={qtyErr}
          />
          <View style={s.btns}>
            <Button
              title="加入"
              tone="learn"
              small
              onPress={add}
              disabled={!!(priceErr || qtyErr)}
            />
            <Button
              title="重置"
              small
              onPress={() => {
                setOrders(DEMO_ORDERS);
                setPick(null);
              }}
            />
          </View>
        </View>
        {quiz ? (
          <>
            <SectionTitle title="小测" right={done ? '已完成' : '答对算完成'} />
            <View style={[s.card, s.quiz]}>
              <Text style={s.q}>{quiz.q}</Text>
              {quiz.options.map(v => {
                const chosen = pick === v;
                const right = pick != null && v === quiz.answer;
                return (
                  <Pressable
                    key={v}
                    onPress={() => answer(v)}
                    disabled={pick != null}
                    style={[
                      s.opt,
                      right && s.optRight,
                      chosen && !right && s.optWrong,
                    ]}
                    accessibilityRole="radio"
                    accessibilityLabel={y(v)}
                  >
                    <Text style={[s.optText, num]}>
                      {right ? '✓ ' : chosen ? '✕ ' : ''}
                      {y(v)}
                    </Text>
                  </Pressable>
                );
              })}
              {pick != null ? (
                <Text style={s.explain}>
                  {pick === quiz.answer ? '答对了。' : '不对。'}
                  集合竞价只产生一个价格，所有成交都按开盘价 {y(quiz.answer)}
                  。你愿意出更高的价，说明按开盘价你当然也愿意买。
                </Text>
              ) : null}
              {pick != null ? (
                <View style={s.btns}>
                  <Button
                    title="再来一题"
                    small
                    onPress={() => setPick(null)}
                  />
                </View>
              ) : null}
            </View>
          </>
        ) : null}
        <View style={s.btns}>
          <Button
            title="规则课：交易时间与集合竞价"
            tone="learn"
            small
            onPress={() => nav.navigate('Lesson', { id: 'time' })}
          />
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
  note: { margin: 10, marginBottom: 2 },
  tr: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  th: { backgroundColor: color.learnBg },
  td: {
    flex: 1,
    fontSize: 13,
    color: color.ink,
    textAlign: 'right',
    paddingVertical: 7,
  },
  thText: { fontSize: 12, color: '#0B5552', fontWeight: '600' },
  on: { backgroundColor: color.warnBg },
  onText: { fontWeight: '700', color: color.warnInk },
  dim: { color: color.ink3 },
  small: {
    fontSize: 11.5,
    lineHeight: 17,
    color: color.ink3,
    paddingHorizontal: PAD,
    paddingVertical: 8,
  },
  result: { padding: PAD },
  resultT: {
    fontSize: 17,
    fontWeight: '600',
    color: color.ink,
    marginBottom: 6,
  },
  step: { fontSize: 13, lineHeight: 20, color: color.ink2 },
  order: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PAD,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  oSide: { width: 24, fontSize: 14, fontWeight: '600' },
  oText: { flex: 1, fontSize: 14, color: color.ink },
  del: { fontSize: 20, color: color.ink3, paddingHorizontal: 6 },
  btns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  quiz: { padding: PAD },
  q: { fontSize: 15, lineHeight: 22, color: color.ink, fontWeight: '500' },
  opt: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optRight: { borderColor: color.learn, backgroundColor: color.learnBg },
  optWrong: { borderColor: color.up, backgroundColor: color.upBg },
  optText: { fontSize: 14, color: color.ink },
  explain: { fontSize: 13, lineHeight: 20, color: color.ink2, marginTop: 8 },
});
