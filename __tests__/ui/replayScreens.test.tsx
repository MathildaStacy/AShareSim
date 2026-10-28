/// <reference types="node" />
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { currentPageContext } from '../../src/ai/context';
import { useApp, type AppCore } from '../../src/app/boot';
import type { Refresher } from '../../src/sim/refresher';
import { createPractice } from '../../src/replay/practice';
import type { RootStackParamList } from '../../src/ui/navigation/types';
import { ReplayRunScreen } from '../../src/ui/screens/ReplayRunScreen';
import {
  ReplayNewScreen,
  ReplayScreen,
  ReplayVerifyScreen,
} from '../../src/ui/screens/ReplayScreens';
import { liveDay } from '../replay/helpers/liveDay';

jest.mock('../../src/data/drivers/opSqlite', () => ({
  openDeviceDb: jest.fn(),
}));
jest.mock('../../src/app/tracker', () => ({
  nativeTracker: () => null,
  batterySettings: {},
}));

const Stack = createNativeStackNavigator<RootStackParamList>();

async function setup() {
  const { db, sim } = await liveDay();
  const refresher = { setExtraCodes() {}, kick() {} } as unknown as Refresher;
  const core = { db, client: {}, sim, refresher } as unknown as AppCore;
  useApp.setState({ core, version: 1 });
  return core;
}

async function render<K extends keyof RootStackParamList>(
  name: K,
  component: React.ComponentType<any>,
  params?: RootStackParamList[K],
) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 400, height: 800 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen
              name={name}
              component={component}
              initialParams={params as never}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>,
    );
  });
  await act(async () => {
    await new Promise(r => setTimeout(r, 50));
  });
  const text = () => JSON.stringify(tree.toJSON());
  const press = async (label: string) => {
    const [btn] = tree.root.findAll(
      n =>
        typeof n.props.onPress === 'function' &&
        (n.props.accessibilityLabel === label ||
          (n.props.accessibilityRole === 'button' &&
            n.findAll(c => c.props.children === label).length > 0)),
    );
    if (!btn) {
      throw new Error('找不到按钮：' + label);
    }
    await act(async () => {
      await btn.props.onPress();
    });
  };
  return {
    text,
    press,
    unmount: async () => {
      await act(async () => tree.unmount());
    },
  };
}

describe('M6 回放页面', () => {
  test('首页列出可回放的日期、可核对的交易日，页面上下文说明是沙盒', async () => {
    await setup();
    const v = await render('Replay', ReplayScreen);
    expect(v.text()).toContain('2026-10-26');
    expect(v.text()).toContain('核对实时模拟');
    expect(v.text()).toContain('盲测回放');
    expect(currentPageContext()?.ctx.lines.join('\n')).toContain(
      '可以回放的日期 1 天',
    );
    await v.unmount();
  });

  test('新建回放：默认选中录到快照的证券，可以切到盲测', async () => {
    await setup();
    const v = await render('ReplayNew', ReplayNewScreen, {
      date: '2026-10-26',
      blind: true,
    });
    expect(v.text()).toContain('日期已隐藏');
    expect(v.text()).toContain('（名称已隐藏）');
    expect(v.text()).toContain('开始回放');
    expect(currentPageContext()?.ctx.lines.join('\n')).not.toContain(
      '2026-10-26',
    );
    await v.unmount();
  });

  test('回放交易：时钟、行情、跳到下一时段、下单、结束后揭晓', async () => {
    const core = await setup();
    const rec = await createPractice(core.db, core.sim, {
      date: '2026-10-26',
      codes: ['sh600036'],
      start: 'cash',
      cash: 10_000_000,
      blind: true,
      hideNames: false,
    });
    const v = await render('ReplayRun', ReplayRunScreen, { id: rec.id });
    expect(v.text()).toContain('09:10:00');
    expect(v.text()).toContain('日期已隐藏');
    expect(currentPageContext()?.ctx.lines.join('\n')).toContain('盲测中');
    await v.press('跳到 9:15 开盘集合竞价');
    await v.press('跳到 9:25 开盘价揭晓');
    await v.press('跳到 9:30 连续竞价');
    await v.press('+1 分钟');
    expect(v.text()).toContain('09:31:00');
    expect(v.text()).toContain('招商银行');
    expect(v.text()).toContain('卖一');
    await v.press('1/4');
    await v.press('提交买入');
    expect(v.text()).toContain('已成');
    expect(v.text()).toContain('主动成交');
    await v.press('快进到收盘并结束');
    expect(v.text()).toContain('揭晓');
    expect(v.text()).toContain('2026-10-26 周一');
    await v.unmount();
  });

  test('核对页显示逐笔一致', async () => {
    await setup();
    const v = await render('ReplayVerify', ReplayVerifyScreen, {
      date: '2026-10-26',
    });
    expect(v.text()).toContain('逐笔一致');
    expect(v.text()).toContain('和下一个起点一致');
    await v.unmount();
  });
});
