import { View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  ChatProcess,
  conversationTurns,
  conversationFlow,
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
    n => n.props?.accessibilityLabel === '处理过程' && n.props.onPress,
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
  expect(content()).toContain('已调用 2 个工具');
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
  expect(content()).toContain('正在调用工具');
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
  expect(content()).not.toContain('正在回答');
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

test('过程按独立消息顺序穿插，正文阻断合并；聚合正文不被伪造分段', () => {
  const tool = (id: number, name: string) =>
    message(id, {
      role: 'tool',
      ui: { tools: [{ id: name, name, label: name }] },
    });
  const body = (id: number, text: string) =>
    message(id, { parts: [{ t: 'text', text }] });
  const flow = conversationFlow([
    tool(2, 'a'),
    tool(3, 'b'),
    body(4, '第一段'),
    tool(5, 'c'),
    body(6, '第二段\n\n最终段'),
  ]);
  expect(flow.map(b => b.kind)).toEqual([
    'process',
    'message',
    'process',
    'message',
  ]);
  expect(
    flow
      .filter(b => b.kind === 'process')
      .map(b => processEvidence(b.messages).tools.map(t => t.id)),
  ).toEqual([['a', 'b'], ['c']]);
  expect(
    flow.filter(b => b.kind === 'message').map(b => b.message.parts),
  ).toEqual([
    [{ t: 'text', text: '第一段' }],
    [{ t: 'text', text: '第二段\n\n最终段' }],
  ]);
});

test('累计工具与搜索只计新增记录，保留卡片一次及最新状态，不跨正文移动新来源', () => {
  const memory = {
    id: 1,
    op: 'add' as const,
    kind: 'preference' as const,
    text: '测试',
    status: 'pending' as const,
  };
  const tool = { id: 'same', name: 'remember', label: '记忆确认', memory };
  const messages = [
    message(2, { role: 'tool', ui: { tools: [tool], search } }),
    message(3, { parts: [{ t: 'text', text: '说明' }], ui: { search } }),
    message(4, {
      role: 'tool',
      ui: {
        tools: [{ ...tool, memory: { ...memory, status: 'done' } }],
        search: {
          ...search,
          sources: [
            ...search.sources,
            { title: '新来源', url: 'https://example.org' },
          ],
        },
      },
    }),
  ];
  const flow = conversationFlow(messages);
  const processes = flow.filter(b => b.kind === 'process');
  expect(
    processes.flatMap(b => processEvidence(b.messages).tools),
  ).toHaveLength(1);
  expect(processEvidence(processes[0].messages).tools[0].memory?.status).toBe(
    'done',
  );
  expect(
    processes.flatMap(b => processEvidence(b.messages).sources),
  ).toHaveLength(2);
  expect(processEvidence(processes[1].messages).sources[0].title).toBe(
    '新来源',
  );
  expect(
    flow
      .filter(b => b.kind === 'message')
      .flatMap(b => b.message.ui?.tools ?? []),
  ).toHaveLength(1);
});

test('局部过程展开互不影响，临时消息落库及追加下一阶段保留原展开选择', async () => {
  const tool = message(2, {
    role: 'tool',
    ui: { tools: [{ id: 'a', name: 'get_rule', label: '规则' }] },
  });
  const draw = (id: number, extra = false) => (
    <>
      {conversationFlow([
        tool,
        message(id, { parts: [{ t: 'text', text: '阶段说明' }] }),
        ...(extra
          ? [
              message(5, {
                role: 'tool',
                ui: { tools: [{ id: 'b', name: 'get_quote', label: '报价' }] },
              }),
            ]
          : []),
      ]).map(block =>
        block.kind === 'process' ? (
          <ChatProcess
            key={block.key}
            messages={block.messages}
            busy={null}
            onLink={jest.fn()}
          />
        ) : (
          <View key={block.key} />
        ),
      )}
    </>
  );
  await act(async () => {
    tree = create(draw(-1));
  });
  await act(async () => toggle().props.onPress());
  await act(async () => tree.update(draw(4, true)));
  const toggles = tree.root.findAll(
    n => n.props?.accessibilityLabel === '处理过程' && n.props.onPress,
  );
  expect(toggles.map(n => n.props.accessibilityState.expanded)).toEqual([
    true,
    false,
  ]);
});

test('展开工具详情只显示实际输入输出，不制造命令或缺失的字段', async () => {
  const messages = [
    message(2, {
      role: 'tool',
      parts: [
        { t: 'call', id: 'a', name: 'get_rule', args: '{"rule":"T+1"}' },
        { t: 'result', id: 'a', name: 'get_rule', output: '次一交易日可卖出' },
      ],
      ui: {
        tools: [
          { id: 'a', name: 'get_rule', label: '规则查询' },
          { id: 'b', name: 'get_quote', label: '历史摘要' },
        ],
      },
    }),
  ];
  await act(async () => {
    tree = create(
      <ChatProcess messages={messages} busy={null} onLink={jest.fn()} />,
    );
  });
  await act(async () => toggle().props.onPress());
  expect(content()).toContain('T+1');
  expect(content()).toContain('次一交易日可卖出');
  expect(content()).toContain('历史摘要');
  expect(content()).not.toContain('Bash');
});
