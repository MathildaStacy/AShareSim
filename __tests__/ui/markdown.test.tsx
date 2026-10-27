import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import { Markdown } from '../../src/ui/components/Markdown';

const sample =
  '# 投资判断\n\n**先核实**再决定仓位。\n\n### 判断依据\n\n1. 盈利\n   - 公告\n\n| 项目 | 建议 | 理由 |\n|---|---|---|\n| 一只名称非常长的证券 | 持有观察 | 比较财报中的经营现金流 |\n| ETF | 暂不追买 | 等待估值回归 |\n\n> 先控制集中度。\n> 再评估调整。\n\n```python\ntarget_weight = 0.10\n```\n\n[来源](source:0)';
let tree: ReactTestRenderer;
afterEach(async () => {
  await act(async () => tree?.unmount());
});
const text = () =>
  JSON.stringify(tree.toJSON(), (k, v) => (k === 'props' ? {} : v));

test('长回答保留分级标题、嵌套列表、引用、代码与可点击来源，表格列在各行对齐', async () => {
  const onLink = jest.fn();
  await act(async () => {
    tree = create(<Markdown text={sample} onLink={onLink} />);
  });
  expect(
    tree.root
      .findAllByType(Text)
      .filter(n => n.props.accessibilityRole === 'header'),
  ).toHaveLength(2);
  for (const t of [
    '投资判断',
    '公告',
    '一只名称非常长的证券',
    '比较财报中的经营现金流',
    'target_weight = 0.10',
    '再评估调整',
  ])
    expect(text()).toContain(t);
  const table = tree.root
    .findAllByType(ScrollView)
    .find(n => n.props.accessibilityLabel === '表格，可横向滚动')!;
  const rows = table.findAll(
    n =>
      n.type === View &&
      StyleSheet.flatten(n.props.style)?.flexDirection === 'row',
  );
  expect(rows).toHaveLength(3);
  const widths = rows.map(row =>
    row
      .findAll(
        n =>
          n.type === View &&
          typeof StyleSheet.flatten(n.props.style)?.width === 'number',
      )
      .map(n => StyleSheet.flatten(n.props.style).width),
  );
  expect(widths[0]).toHaveLength(3);
  expect(widths[1]).toEqual(widths[0]);
  expect(widths[2]).toEqual(widths[0]);
  expect(
    tree.root.findAllByType(ScrollView).filter(n => n.props.horizontal),
  ).toHaveLength(2);
  const citation = tree.root
    .findAllByType(Text)
    .find(n => n.props.accessibilityLabel === '来源 来源')!;
  await act(async () => citation.props.onPress());
  expect(onLink).toHaveBeenCalledWith('source:0');
});

test('流式增量形成新段落和表格时，已收到的中文和代码仍保留', async () => {
  await act(async () => {
    tree = create(
      <Markdown
        text={'## 判断\n\n先确认公告。\n\n| 项目 |'}
        onLink={jest.fn()}
      />,
    );
  });
  expect(text()).toContain('先确认公告');
  await act(async () =>
    tree.update(
      <Markdown
        text={
          '## 判断\n\n先确认公告。\n\n| 项目 | 建议 |\n|---|---|\n| 盈利 | 持有观察 |\n\n```\n完整代码\n```'
        }
        onLink={jest.fn()}
      />,
    ),
  );
  for (const t of ['先确认公告', '持有观察', '完整代码'])
    expect(text()).toContain(t);
  expect(
    tree.root
      .findAllByType(ScrollView)
      .some(n => n.props.accessibilityLabel === '表格，可横向滚动'),
  ).toBe(true);
});
