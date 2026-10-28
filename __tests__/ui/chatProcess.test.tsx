import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  ChatProcess,
  conversationTurns,
  publicSummary,
  processEvidence,
} from '../../src/ui/components/ChatProcess';
import type { StoredMessage } from '../../src/ai/types';

const message = (
  id: number,
  fields: Partial<StoredMessage> = {},
): StoredMessage => ({
  id,
  threadId: 1,
  role: 'assistant',
  parts: [],
  raw: null,
  ui: null,
  compacted: false,
  createdAt: '',
  ...fields,
});
const search = {
  queries: ['公告'],
  sources: [{ title: '来源', url: 'https://example.com' }],
  citations: [],
  calls: 1,
};
let tree: ReactTestRenderer;
afterEach(async () => {
  await act(async () => tree?.unmount());
});
const content = () =>
  JSON.stringify(tree.toJSON(), (k, v) => (k === 'props' ? {} : v));
const toggle = () =>
  tree.root.findAll(
    n => n.props.accessibilityLabel === '处理过程' && n.props.onPress,
  )[0];

test('整轮聚合去重累积搜索快照；工具数量不冒充有效数据数量', async () => {
  const messages = [
    message(1, { ui: { search } }),
    message(2, {
      role: 'tool',
      ui: {
        tools: [
          { id: 'empty', name: 'get_rule', label: '规则查询' },
          { id: 'bad', name: 'get_quote', label: '行情失败', error: true },
        ],
      },
      parts: [
        {
          t: 'result',
          id: 'empty',
          name: 'get_rule',
          output: '没有找到相关规则',
        },
      ],
    }),
    message(3, { ui: { search, thinking: '内部推理 / 调试规则' } }),
  ];
  expect(processEvidence(messages).sources).toHaveLength(1);
  expect(processEvidence(messages).queries).toHaveLength(1);
  await act(async () => {
    tree = create(
      <ChatProcess messages={messages} busy={null} onLink={jest.fn()} />,
    );
  });
  expect(content()).toContain('工具记录 2 项');
  expect(content()).toContain('来源 1 个');
  expect(content()).not.toContain('已查询');
  expect(tree.root.findAllByProps({ testID: 'process-details' })).toHaveLength(
    0,
  );
  await act(async () => toggle().props.onPress());
  expect(content()).toContain('规则查询');
  expect(content()).toContain('行情失败');
  expect(content()).not.toContain('内部推理');
  expect(content()).not.toContain('已返回数据');
  await act(async () => toggle().props.onPress());
  expect(tree.root.findAllByProps({ testID: 'process-details' })).toHaveLength(
    0,
  );
});

test('主动展开跨流式更新及落库保持；未展开的回答结束后只有摘要', async () => {
  const question = message(1, { role: 'user', ui: { question: '问题' } });
  const render = (messages: StoredMessage[], busy: string | null) => (
    <>
      {conversationTurns(messages).map(turn => (
        <ChatProcess
          key={turn.key}
          messages={turn.answer}
          busy={busy}
          onLink={jest.fn()}
        />
      ))}
    </>
  );
  await act(async () => {
    tree = create(render([question], '正在调用工具'));
  });
  expect(content()).toContain('进行中');
  await act(async () => toggle().props.onPress());
  await act(async () =>
    tree.update(
      render([question, message(-1, { ui: { search } })], '正在回答'),
    ),
  );
  expect(toggle().props.accessibilityState.expanded).toBe(true);
  await act(async () =>
    tree.update(render([question, message(4, { ui: { search } })], null)),
  );
  expect(toggle().props.accessibilityState.expanded).toBe(true);
  expect(content()).not.toContain('进行中');
  await act(async () => toggle().props.onPress());
  expect(tree.root.findAllByProps({ testID: 'process-details' })).toHaveLength(
    0,
  );
});

test('没有公开摘要来源时隐藏推理；仅渲染明确的 summary_text Markdown', async () => {
  for (const protocol of ['anthropic', 'chat', 'openai'] as const) {
    const raw = {
      protocol,
      model: 'fixture',
      items: [
        { type: 'thinking', thinking: '私有规则' },
        { type: 'reasoning', content: [{ text: '内部调试' }] },
      ],
    };
    expect(
      publicSummary(message(1, { raw, ui: { thinking: '**不能显示**' } })),
    ).toBe('');
  }
  const safe = message(2, {
    raw: {
      protocol: 'openai',
      model: 'fixture',
      items: [
        {
          type: 'reasoning',
          summary: [
            { type: 'summary_text', text: '**已核对**公开来源。' },
            { type: 'text', text: '不明字段' },
          ],
        },
      ],
    },
  });
  await act(async () => {
    tree = create(
      <ChatProcess messages={[safe]} busy={null} onLink={jest.fn()} />,
    );
  });
  await act(async () => toggle().props.onPress());
  expect(content()).toContain('已核对');
  expect(content()).not.toContain('**');
  expect(content()).not.toContain('不明字段');
});
