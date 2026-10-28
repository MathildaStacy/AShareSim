/** 可连续阅读的 AI 正文。表格共用列宽，宽表与代码只横向滚动自身。 */
import { createContext, useContext, useMemo } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { parseMarkdown, type MdInline } from '../../ai/markdown';
import { splitMissing } from '../../ai/provenance';
import { aiColor as c } from '../aiTheme';
import { color, num } from '../theme';

/** 找不到来源的数字加虚线（Android 不支持虚线样式时显示成下划线，颜色区分）。 */
const Missing = createContext<Set<string> | undefined>(undefined);

function Plain({ text }: { text: string }) {
  const missing = useContext(Missing);
  if (!missing) {
    return <>{text}</>;
  }
  return (
    <>
      {splitMissing(text, missing).map((x, i) =>
        x.missing ? (
          <Text
            key={i}
            style={s.missing}
            accessibilityLabel={x.text + '，找不到来源'}
          >
            {x.text}
          </Text>
        ) : (
          x.text
        ),
      )}
    </>
  );
}

function Inline({
  inl,
  onLink,
}: {
  inl: MdInline[];
  onLink: (href: string) => void;
}) {
  return (
    <>
      {inl.map((x, i) =>
        x.t === 'bold' ? (
          <Text key={i} style={s.bold}>
            <Plain text={x.text} />
          </Text>
        ) : x.t === 'code' ? (
          <Text key={i} style={s.icode}>
            {x.text}
          </Text>
        ) : x.t === 'link' ? (
          <Text
            key={i}
            style={[s.link, x.href.startsWith('source:') && s.citation]}
            onPress={() => onLink(x.href)}
            accessibilityRole="link"
            accessibilityLabel={
              x.href.startsWith('source:') ? '来源 ' + x.text : undefined
            }
          >
            {x.href.startsWith('source:') ? '[' + x.text + ']' : x.text}
          </Text>
        ) : (
          <Text key={i}>
            <Plain text={x.text} />
          </Text>
        ),
      )}
    </>
  );
}

function Table({
  rows,
  onLink,
}: {
  rows: MdInline[][][];
  onLink: (href: string) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const count = Math.max(0, ...rows.map(row => row.length));
  const available = Math.min(720, width - 32);
  const widths = Array.from({ length: count }, (_, i) => {
    const longest = Math.max(
      ...rows.map(row => (row[i] ?? []).map(x => x.text).join('').length),
    );
    return count <= 2
      ? available / Math.max(1, count)
      : Math.min(
          220 * fontScale,
          Math.max(112 * fontScale, longest * 8 * fontScale + 24),
        );
  });
  return (
    <ScrollView
      horizontal
      style={s.tableWrap}
      showsHorizontalScrollIndicator
      nestedScrollEnabled
      accessibilityLabel="表格，可横向滚动"
    >
      <View style={s.table}>
        {rows.map((row, r) => (
          <View
            key={r}
            style={[s.tr, r === 0 && s.th, r === rows.length - 1 && s.lastRow]}
          >
            {widths.map((cellWidth, col) => (
              <View key={col} style={[s.cell, { width: cellWidth }]}>
                <Text
                  selectable
                  style={[
                    s.td,
                    num,
                    r === 0 && s.bold,
                    r > 0 &&
                      /^[-+−]?[\d.,%¥￥元万元亿]+$/.test(
                        (row[col] ?? [])
                          .map(x => x.text)
                          .join('')
                          .trim(),
                      ) &&
                      s.numeric,
                  ]}
                >
                  <Inline inl={row[col] ?? []} onLink={onLink} />
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export function Markdown({
  text,
  onLink,
  secondary = false,
  missing,
}: {
  text: string;
  secondary?: boolean;
  onLink: (href: string) => void;
  /** 找不到来源的数字（数字溯源，§13.9），加虚线。 */
  missing?: Set<string>;
}) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <Missing.Provider value={missing}>
      <View>
        {blocks.map((b, i) => {
          switch (b.t) {
            case 'h':
              return (
                <Text
                  key={i}
                  selectable
                  accessibilityRole="header"
                  style={[
                    s.h,
                    b.level === 1 ? s.h1 : b.level === 2 ? s.h2 : s.h3,
                    i === 0 && s.firstHeading,
                    secondary && s.secondary,
                  ]}
                >
                  <Inline inl={b.inl} onLink={onLink} />
                </Text>
              );
            case 'li':
              return (
                <View
                  key={i}
                  style={[
                    s.li,
                    { paddingLeft: b.depth * 16 },
                    blocks[i + 1]?.t !== 'li' && s.listEnd,
                  ]}
                >
                  <Text
                    style={[
                      s.marker,
                      num,
                      { minWidth: Math.max(26, b.marker.length * 9) },
                    ]}
                  >
                    {b.marker}
                  </Text>
                  <Text selectable style={[s.liText, secondary && s.secondary]}>
                    <Inline inl={b.inl} onLink={onLink} />
                  </Text>
                </View>
              );
            case 'table':
              return <Table key={i} rows={b.rows} onLink={onLink} />;
            case 'code':
              return (
                <ScrollView
                  key={i}
                  horizontal
                  style={s.codeWrap}
                  nestedScrollEnabled
                  showsHorizontalScrollIndicator
                  accessibilityLabel="代码，可横向滚动"
                >
                  <Text selectable style={s.code}>
                    {b.text}
                  </Text>
                </ScrollView>
              );
            case 'quote':
              return (
                <View key={i} style={s.quote}>
                  <Text
                    selectable
                    style={[s.quoteText, secondary && s.secondary]}
                  >
                    <Inline inl={b.inl} onLink={onLink} />
                  </Text>
                </View>
              );
            case 'hr':
              return <View key={i} style={s.hr} />;
            default:
              return (
                <Text
                  key={i}
                  selectable
                  style={[s.p, secondary && s.secondary]}
                >
                  <Inline inl={b.inl} onLink={onLink} />
                </Text>
              );
          }
        })}
      </View>
    </Missing.Provider>
  );
}

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const s = StyleSheet.create({
  missing: {
    color: color.warnInk,
    textDecorationLine: 'underline',
    textDecorationStyle: 'dashed',
    textDecorationColor: color.warnInk,
  },
  secondary: {
    fontSize: 13,
    lineHeight: 20,
    color: c.secondary,
    marginBottom: 8,
  },
  p: { fontSize: 16, lineHeight: 25, color: c.ink, marginBottom: 12 },
  h: { fontWeight: '600', color: c.ink, marginTop: 20, marginBottom: 8 },
  h1: { fontSize: 21, lineHeight: 30 },
  h2: { fontSize: 18, lineHeight: 27 },
  h3: { fontSize: 16, lineHeight: 25 },
  firstHeading: { marginTop: 0 },
  bold: { fontWeight: '600' },
  icode: {
    fontFamily: mono,
    fontSize: 13,
    backgroundColor: c.soft,
    color: c.code,
  },
  link: { color: c.ink, textDecorationLine: 'underline' },
  citation: { fontSize: 12, color: c.secondary, textDecorationLine: 'none' },
  li: { flexDirection: 'row', marginBottom: 5 },
  marker: {
    paddingRight: 6,
    flexShrink: 0,
    fontSize: 16,
    lineHeight: 25,
    color: c.secondary,
  },
  liText: { flex: 1, fontSize: 16, lineHeight: 25, color: c.ink },
  listEnd: { marginBottom: 16 },
  tableWrap: { marginVertical: 6, marginBottom: 20, borderRadius: 12 },
  table: {
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 12,
    overflow: 'hidden',
  },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  lastRow: { borderBottomWidth: 0 },
  th: { backgroundColor: c.soft },
  cell: { paddingHorizontal: 12, paddingVertical: 11 },
  numeric: { textAlign: 'right' },
  td: { fontSize: 14, lineHeight: 22, color: c.ink },
  codeWrap: { backgroundColor: c.soft, borderRadius: 12, marginBottom: 18 },
  code: {
    fontFamily: mono,
    fontSize: 13,
    lineHeight: 20,
    color: c.ink,
    padding: 14,
  },
  quote: {
    borderLeftWidth: 1,
    borderLeftColor: c.line,
    paddingLeft: 14,
    marginVertical: 4,
    marginBottom: 18,
  },
  quoteText: { fontSize: 16, lineHeight: 25, color: c.secondary },
  hr: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: c.line,
    marginVertical: 20,
  },
});
