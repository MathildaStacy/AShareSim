/** AI 回答的排版：段落、标题、列表、表格、代码块；lesson: / stock: 链接可以点。 */
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { parseMarkdown, type MdInline } from '../../ai/markdown';
import { color, num } from '../theme';

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
            {x.text}
          </Text>
        ) : x.t === 'code' ? (
          <Text key={i} style={s.icode}>
            {x.text}
          </Text>
        ) : x.t === 'link' ? (
          <Text
            key={i}
            style={s.link}
            onPress={() => onLink(x.href)}
            accessibilityRole="link"
          >
            {x.text}
          </Text>
        ) : (
          <Text key={i}>{x.text}</Text>
        ),
      )}
    </>
  );
}

export function Markdown({
  text,
  onLink,
}: {
  text: string;
  onLink: (href: string) => void;
}) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <View>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'h':
            return (
              <Text key={i} style={[s.p, s.h]}>
                <Inline inl={b.inl} onLink={onLink} />
              </Text>
            );
          case 'li':
            return (
              <View key={i} style={[s.li, { paddingLeft: 4 + b.depth * 14 }]}>
                <Text style={[s.marker, num]} numberOfLines={1}>
                  {b.marker}
                </Text>
                <Text style={[s.p, s.liText]}>
                  <Inline inl={b.inl} onLink={onLink} />
                </Text>
              </View>
            );
          case 'table':
            return (
              <ScrollView
                key={i}
                horizontal
                style={s.tableWrap}
                showsHorizontalScrollIndicator={false}
              >
                <View style={s.table}>
                  {b.rows.map((row, r) => (
                    <View key={r} style={[s.tr, r === 0 && s.th]}>
                      {row.map((cell, c) => (
                        <Text key={c} style={[s.td, num, r === 0 && s.bold]}>
                          <Inline inl={cell} onLink={onLink} />
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            );
          case 'code':
            return (
              <Text key={i} style={s.code}>
                {b.text}
              </Text>
            );
          case 'hr':
            return <View key={i} style={s.hr} />;
          default:
            return (
              <Text key={i} style={s.p}>
                <Inline inl={b.inl} onLink={onLink} />
              </Text>
            );
        }
      })}
    </View>
  );
}

const s = StyleSheet.create({
  p: { fontSize: 15, lineHeight: 23, color: color.ink, marginBottom: 6 },
  h: { fontWeight: '600', fontSize: 16, marginTop: 4 },
  bold: { fontWeight: '600' },
  icode: {
    fontFamily: 'monospace',
    fontSize: 13,
    backgroundColor: color.bg,
  },
  link: { color: color.learn, textDecorationLine: 'underline' },
  li: { flexDirection: 'row' },
  marker: {
    minWidth: 24,
    paddingRight: 4,
    flexShrink: 0,
    fontSize: 15,
    lineHeight: 23,
    color: color.ink2,
  },
  liText: { flex: 1 },
  tableWrap: { marginBottom: 8 },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    borderRadius: 4,
  },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  th: { backgroundColor: color.bg },
  td: {
    minWidth: 64,
    maxWidth: 180,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 13,
    lineHeight: 18,
    color: color.ink,
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 17,
    color: color.ink2,
    backgroundColor: color.bg,
    padding: 8,
    borderRadius: 4,
    marginBottom: 8,
  },
  hr: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.line,
    marginVertical: 8,
  },
});
