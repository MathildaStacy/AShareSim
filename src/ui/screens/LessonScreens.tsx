/**
 * 规则课（M3，PRODUCT_DESIGN §6.4）：12 课列表和详情。每课一屏讲解 + 小测 + 「去实践」。
 * 下单页被拦下时弹窗里的「看规则课」、个股页规则卡下面的「相关规则课」都跳到这里。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronRight } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { answerQuiz, redoLesson, useLearn } from '../../app/learn';
import { LESSONS, lessonById } from '../../learn/lessons';
import { answerOf, lessonCheckId, lessonStatus } from '../../learn/progress';
import type { Inline, Lesson, LessonBlock } from '../../learn/types';
import { AiFab, Button, NavBar, Note, SectionTitle } from '../components/ui';
import { useAiContext, useCore, useViewLog } from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { color, num, PAD } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** 「去实践」和阶段工具的路由是数据里写的字符串，这里统一跳转。 */
export function goRoute(
  nav: Nav,
  route: string,
  params?: Record<string, unknown>,
): void {
  (nav.navigate as (r: string, p?: object) => void)(route, params);
}

/** 去掉 **加粗** 标记（页面上下文用）。 */
export const plain = (t: Inline) => t.replace(/\*\*/g, '');

/** 一段带 **加粗** 的文字。 */
export function RichText({ text, style }: { text: Inline; style?: object }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <Text style={style}>
      {parts.map((p, i) =>
        i % 2 ? (
          <Text key={i} style={s.bold}>
            {p}
          </Text>
        ) : (
          p
        ),
      )}
    </Text>
  );
}

function Block({ b }: { b: LessonBlock }) {
  switch (b.t) {
    case 'p':
      return <RichText text={b.text} style={s.p} />;
    case 'h':
      return <Text style={s.h}>{b.text}</Text>;
    case 'list':
      return (
        <View style={s.list}>
          {b.items.map((it, i) => (
            <View key={i} style={s.li}>
              <Text style={s.dot}>•</Text>
              <RichText text={it} style={s.liText} />
            </View>
          ))}
        </View>
      );
    case 'table':
      return (
        <View style={s.table}>
          {b.rows.map((r, i) => (
            <View key={i} style={[s.tr, i === 0 && s.th]}>
              {r.map((c, j) => (
                <Text
                  key={j}
                  style={[s.td, num, i === 0 && s.thText, j === 0 && s.td0]}
                >
                  {c}
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
    case 'eg':
      return (
        <View style={s.eg}>
          <RichText text={b.text} style={s.egText} />
        </View>
      );
    case 'warn':
      return (
        <View style={[s.eg, s.warn]}>
          <RichText text={b.text} style={[s.egText, s.warnText]} />
        </View>
      );
  }
}

// ---------- 规则课列表 ----------

export function LessonsScreen() {
  const nav = useNavigation<Nav>();
  const { checks, answers } = useLearn();
  const passed = LESSONS.filter(l => checks[lessonCheckId(l.id)]).length;
  useViewLog('lessons', '查看 规则课');
  useAiContext('Lessons', () => ({
    name: '学习 · 规则课',
    lines: [
      '共 ' + LESSONS.length + ' 课，已通过 ' + passed + ' 课',
      ...LESSONS.map((l, i) => {
        const st = lessonStatus(l, answers);
        return (
          i +
          1 +
          '. ' +
          l.title +
          '：' +
          (checks[lessonCheckId(l.id)] ? '已通过' : '未通过') +
          '，小测本轮答对 ' +
          st.correct +
          ' / ' +
          st.total
        );
      }),
    ],
    tip: '每课的小测全部答对算通过，可以重做，通过不会被取消。',
  }));
  return (
    <View style={s.page}>
      <NavBar
        title="规则课"
        sub={'已通过 ' + passed + ' / ' + LESSONS.length}
        back
      />
      <ScrollView contentContainerStyle={s.pad}>
        <Note tone="learn" style={s.note}>
          每课一屏讲解、几道小测和「去实践」。数字和交易所规则、App
          的撮合和费用引擎一致。
        </Note>
        <View style={s.card}>
          {LESSONS.map((l, i) => {
            const st = lessonStatus(l, answers);
            const ok = !!checks[lessonCheckId(l.id)];
            return (
              <Pressable
                key={l.id}
                onPress={() => nav.navigate('Lesson', { id: l.id })}
                style={({ pressed }) => [s.row, pressed && s.pressed]}
                accessibilityRole="button"
                accessibilityLabel={l.title}
              >
                <View style={[s.no, ok && s.noOk]}>
                  <Text style={[s.noText, ok && s.noTextOk]}>
                    {ok ? '✓' : i + 1}
                  </Text>
                </View>
                <View style={s.grow}>
                  <Text style={s.rowT}>{l.title}</Text>
                  <Text style={s.rowSub} numberOfLines={2}>
                    {l.summary}
                  </Text>
                  <Text style={[s.rowMeta, ok && { color: color.learn }]}>
                    {ok
                      ? '已通过'
                      : st.answered
                      ? '小测 ' + st.correct + ' / ' + st.total + ' 答对'
                      : '小测 ' + st.total + ' 题'}
                  </Text>
                </View>
                <ChevronRight color={color.ink3} size={20} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <AiFab />
    </View>
  );
}

// ---------- 规则课详情 ----------

/** 页面上下文：讲解要点和每道题的作答。 */
export function lessonContextLines(
  l: Lesson,
  answers: ReturnType<typeof useLearn.getState>['answers'],
  passed: boolean,
): string[] {
  return [
    '课：' + l.title + '（' + (passed ? '已通过' : '未通过') + '）',
    '要点：' + l.summary,
    '讲解：' +
      l.blocks
        .filter(b => b.t === 'h')
        .map(b => (b.t === 'h' ? b.text : ''))
        .join('；'),
    ...l.quiz.map((q, i) => {
      const a = answerOf(answers, l.id, i);
      return (
        '小测 ' +
        (i + 1) +
        '「' +
        q.q +
        '」：' +
        (a
          ? '选了「' +
            q.options[a.choice] +
            '」，' +
            (a.correct
              ? '答对'
              : '答错，正确答案「' + q.options[q.answer] + '」')
          : '未答')
      );
    }),
    '对应规则：TRADING_RULES.md ' + l.spec,
  ];
}

export function LessonScreen({ route }: RootScreenProps<'Lesson'>) {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const { checks, answers } = useLearn();
  const l = lessonById(route.params.id) ?? LESSONS[0];
  const idx = LESSONS.indexOf(l);
  const passed = !!checks[lessonCheckId(l.id)];
  const st = lessonStatus(l, answers);
  useViewLog('lesson:' + l.id, '查看 规则课「' + l.title + '」');
  useAiContext('Lesson:' + l.id, () => ({
    name: '规则课 · ' + l.title,
    lines: lessonContextLines(l, answers, passed),
    tip: '用户可能会问讲解里的概念或某道题为什么选这个；回答时引用这一课和 TRADING_RULES 对应小节。',
  }));
  const go = (i: number) => nav.replace('Lesson', { id: LESSONS[i].id });
  return (
    <View style={s.page}>
      <NavBar
        title={l.title}
        sub={
          '第 ' +
          (idx + 1) +
          ' / ' +
          LESSONS.length +
          ' 课' +
          (passed ? ' · 已通过' : '')
        }
        back
      />
      <ScrollView contentContainerStyle={s.pad}>
        <View style={[s.card, s.body]}>
          {l.blocks.map((b, i) => (
            <Block key={i} b={b} />
          ))}
        </View>
        <SectionTitle
          title="小测"
          right={
            passed
              ? '已通过'
              : st.answered
              ? '本轮答对 ' + st.correct + ' / ' + st.total
              : '全部答对算通过'
          }
        />
        <View style={s.card}>
          {l.quiz.map((q, qi) => {
            const a = answerOf(answers, l.id, qi);
            return (
              <View key={qi} style={s.quiz}>
                <Text style={s.q}>
                  {qi + 1}. {q.q}
                </Text>
                {q.options.map((o, oi) => {
                  const chosen = a?.choice === oi;
                  const right = a != null && oi === q.answer;
                  return (
                    <Pressable
                      key={oi}
                      disabled={a != null}
                      onPress={() =>
                        answerQuiz(core, l.id, qi, oi).catch(() => undefined)
                      }
                      style={[
                        s.opt,
                        right && s.optRight,
                        chosen && !a.correct && s.optWrong,
                      ]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: chosen }}
                      accessibilityLabel={o}
                    >
                      <Text style={s.optText}>
                        {right ? '✓ ' : chosen ? '✕ ' : ''}
                        {o}
                      </Text>
                    </Pressable>
                  );
                })}
                {a ? (
                  <Text
                    style={[
                      s.explain,
                      { color: a.correct ? color.learn : color.up },
                    ]}
                  >
                    {a.correct ? '答对了。' : '不对。'}
                    <Text style={s.explainBody}>{q.explain}</Text>
                  </Text>
                ) : null}
              </View>
            );
          })}
          {st.answered ? (
            <View style={s.btnRow}>
              <Button
                title="重做"
                small
                onPress={() => redoLesson(core, l.id).catch(() => undefined)}
              />
              {passed ? (
                <Text style={s.passed}>✓ 已通过，重做不会取消</Text>
              ) : null}
            </View>
          ) : null}
        </View>
        {l.practice?.length ? (
          <>
            <SectionTitle title="去实践" />
            <View style={[s.card, s.practice]}>
              {l.practice.map(p => (
                <Button
                  key={p.label}
                  title={p.label}
                  tone="learn"
                  small
                  onPress={() => goRoute(nav, p.route, p.params)}
                />
              ))}
            </View>
          </>
        ) : null}
        <View style={s.nav2}>
          <Button
            title="‹ 上一课"
            small
            disabled={idx === 0}
            onPress={() => go(idx - 1)}
          />
          <Button
            title="下一课 ›"
            small
            disabled={idx === LESSONS.length - 1}
            onPress={() => go(idx + 1)}
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
  body: { paddingHorizontal: PAD, paddingVertical: 12 },
  bold: { fontWeight: '700', color: color.ink },
  p: { fontSize: 15, lineHeight: 24, color: color.ink, marginVertical: 5 },
  h: {
    fontSize: 16,
    fontWeight: '600',
    color: color.ink,
    marginTop: 12,
    marginBottom: 2,
  },
  list: { marginVertical: 4 },
  li: { flexDirection: 'row', marginVertical: 2 },
  dot: { width: 14, fontSize: 15, lineHeight: 23, color: color.learn },
  liText: { flex: 1, fontSize: 15, lineHeight: 23, color: color.ink },
  table: {
    marginVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    borderRadius: 4,
    overflow: 'hidden',
  },
  tr: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  th: { backgroundColor: color.learnBg, borderTopWidth: 0 },
  td: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    color: color.ink,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  td0: { flex: 1.15 },
  thText: { fontWeight: '600', color: '#0B5552' },
  eg: {
    backgroundColor: color.bg,
    borderRadius: 6,
    padding: 10,
    marginVertical: 6,
  },
  egText: { fontSize: 14, lineHeight: 22, color: color.ink2 },
  warn: { backgroundColor: color.warnBg },
  warnText: { color: color.warnInk },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PAD,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  pressed: { backgroundColor: color.press },
  grow: { flex: 1 },
  no: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.learnLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noOk: { backgroundColor: color.learn, borderColor: color.learn },
  noText: { fontSize: 13, color: color.learn, fontWeight: '600' },
  noTextOk: { color: '#FFFFFF' },
  rowT: { fontSize: 15, color: color.ink, fontWeight: '500' },
  rowSub: { fontSize: 12, lineHeight: 17, color: color.ink3, marginTop: 2 },
  rowMeta: { fontSize: 11, color: color.ink3, marginTop: 3 },
  quiz: {
    paddingHorizontal: PAD,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
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
  optText: { fontSize: 14, lineHeight: 20, color: color.ink },
  explain: { fontSize: 13, lineHeight: 20, marginTop: 8, fontWeight: '600' },
  explainBody: { fontWeight: '400', color: color.ink2 },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
  },
  passed: { fontSize: 13, color: color.learn },
  practice: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  nav2: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
  },
});
