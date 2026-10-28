import { TradingCalendar } from '../../src/engine/calendar';
import { T } from '../../src/engine/session';
import {
  dueBriefings,
  flowPrompt,
  BUILTIN_FLOWS,
  invalidFlow,
} from '../../src/ai/flows';

const cal = new TradingCalendar();

describe('简报', () => {
  test('交易日开盘前是盘前简报，开盘后提示补一份，15:30 后是盘后简报', () => {
    expect(dueBriefings({ date: '2026-10-26', t: T(8, 50) }, cal, {})).toEqual([
      { kind: 'pre', key: '2026-10-26', missed: false },
    ]);
    expect(dueBriefings({ date: '2026-10-26', t: T(10, 0) }, cal, {})).toEqual([
      { kind: 'pre', key: '2026-10-26', missed: true },
    ]);
    expect(
      dueBriefings({ date: '2026-10-26', t: T(16, 0) }, cal, {
        pre: '2026-10-26',
      }),
    ).toEqual([{ kind: 'post', key: '2026-10-26', missed: false }]);
    expect(
      dueBriefings({ date: '2026-10-26', t: T(16, 0) }, cal, {
        post: '2026-10-26',
      }),
    ).toEqual([]);
  });
  test('周五收盘后到周日是周报（按周一记），周末没有盘前盘后', () => {
    expect(
      dueBriefings({ date: '2026-10-30', t: T(16, 0) }, cal, {
        post: '2026-10-30',
      }),
    ).toEqual([{ kind: 'week', key: '2026-10-26', missed: false }]);
    expect(dueBriefings({ date: '2026-11-01', t: T(10, 0) }, cal, {})).toEqual([
      { kind: 'week', key: '2026-10-26', missed: false },
    ]);
    expect(
      dueBriefings({ date: '2026-11-01', t: T(10, 0) }, cal, {
        week: '2026-10-26',
      }),
    ).toEqual([]);
  });
});

test('预设流程的模板：步骤和输出模板都在，自定义流程要有名称、步骤、模板', () => {
  const f = BUILTIN_FLOWS[0];
  const t = flowPrompt(f, '招商银行');
  expect(t).toContain('对象：招商银行');
  expect(t).toContain('1. get_quote');
  expect(t).toContain('## 结论');
  expect(
    invalidFlow(
      { ...f, id: 'x', name: '个股体检', builtin: false },
      BUILTIN_FLOWS,
    ),
  ).toMatch('同名');
  expect(
    invalidFlow({ ...f, id: 'x', name: '新的', steps: [] }, BUILTIN_FLOWS),
  ).toMatch('步骤');
});
