/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createNavigationContainerRef,
  NavigationContainer,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { FlatList, SectionList } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useApp, type AppCore } from '../../src/app/boot';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import { T } from '../../src/engine';
import type { MarketClient } from '../../src/market/client';
import { parseQuotes, type RankItem } from '../../src/market/tencent';
import { DEFAULT_REFRESH, type Refresher } from '../../src/sim/refresher';
import { Simulator } from '../../src/sim/simulator';
import { Segmented } from '../../src/ui/components/ui';
import { QuoteRow } from '../../src/ui/components/QuoteRow';
import { MarketScreen } from '../../src/ui/screens/MarketScreen';
import { WatchScreen } from '../../src/ui/screens/WatchScreen';
import { rankQuote } from '../../src/ui/quoteView';
import { useWatch } from '../../src/ui/watchStore';
import type { RootStackParamList } from '../../src/ui/navigation/types';

jest.mock('../../src/data/drivers/opSqlite', () => ({
  openDeviceDb: jest.fn(),
}));
jest.mock('../../src/app/tracker', () => ({ nativeTracker: () => null }));
const Stack = createNativeStackNavigator<RootStackParamList>();
const EmptyScreen = () => null;
const quote = () =>
  parseQuotes(
    readFileSync(
      join(__dirname, '../market/fixtures/qt-2026-10-26-1452.txt'),
      'utf8',
    ),
  ).find(q => q.snapshot.code === 'sh600036')!;
const row = (code: string, last: number): RankItem => ({
  code,
  name: code === 'sh600036' ? '招商银行' : '平安银行',
  type: 'GP-A',
  last,
  change: 10,
  pct: 1,
  volume: 100,
  amount: 10000,
});
const visible = (codes: string[]) => ({
  viewableItems: codes.map(code => ({ item: { code }, isViewable: true })),
  changed: [],
});
let tree: ReactTestRenderer.ReactTestRenderer;
let core: AppCore;
let setExtraCodes: jest.Mock;
let rank: jest.Mock;
let unsubscribe: () => void;
const nav = createNavigationContainerRef<RootStackParamList>();
const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(100_000);
  const db = openMemoryDb();
  await migrate(db);
  rank = jest.fn(async () => [row('sh600036', 10000), row('sz000001', 20000)]);
  const client = { rank, etfRank: rank } as unknown as MarketClient;
  const sim = await Simulator.open(db, client, () => ({
    date: '2026-10-26',
    t: T(14, 53),
  }));
  setExtraCodes = jest.fn();
  core = {
    db,
    sim,
    client,
    refresher: {
      settings: { ...DEFAULT_REFRESH },
      setExtraCodes,
    } as unknown as Refresher,
  };
  useApp.setState({
    core,
    tick: 0,
    version: 0,
    status: {
      window: 'session',
      foreground: true,
      tracking: false,
      lastOk: null,
      lastError: null,
      failures: 0,
      requestsToday: 0,
      bytesToday: 0,
    },
  });
  unsubscribe = sim.subscribeQuotes(() =>
    useApp.setState(s => ({ tick: s.tick + 1 })),
  );
});
afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  unsubscribe();
  jest.useRealTimers();
});
async function render(component: typeof MarketScreen) {
  await act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 400, height: 800 },
          insets: { top: 0, bottom: 0, left: 0, right: 0 },
        }}
      >
        <NavigationContainer ref={nav}>
          <Stack.Navigator
            screenOptions={{ headerShown: false, animation: 'none' }}
          >
            <Stack.Screen name="Tabs" component={component} />
            <Stack.Screen name="Stock" component={EmptyScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>,
    );
  });
  await advance(0);
}
const select = async (seg: string) => {
  await act(async () => {
    tree.root.findByType(Segmented).props.onChange(seg);
  });
  await advance(0);
};

test('排行榜只订阅可见行，快报价独立改价且不重排，名单保持 10 秒刷新', async () => {
  await render(MarketScreen);
  await select('aStock');
  expect(rank).toHaveBeenCalledTimes(3);
  const list = () => tree.root.findByType(SectionList);
  await act(async () =>
    list().props.onViewableItemsChanged(visible(['sh600036'])),
  );
  expect(setExtraCodes).toHaveBeenLastCalledWith(['sh600036']);
  const before = list().props.sections.map((s: { data: RankItem[] }) =>
    s.data.map(r => r.code),
  );
  const q = quote();
  q.snapshot.last = 12345;
  q.info.pct = 4.56;
  await act(async () => {
    await core.sim.ingest([q]);
  });
  expect(
    tree.root.findAllByType(QuoteRow).find(r => r.props.code === 'sh600036')
      ?.props,
  ).toMatchObject({ last: 12345, pct: 4.56 });
  expect(
    list().props.sections.map((s: { data: RankItem[] }) =>
      s.data.map(r => r.code),
    ),
  ).toEqual(before);
  const tick = useApp.getState().tick;
  await act(async () => {
    await core.sim.ingest([JSON.parse(JSON.stringify(q))]);
  });
  expect(useApp.getState().tick).toBe(tick);
  await advance(9999);
  expect(rank).toHaveBeenCalledTimes(3);
  await advance(1);
  expect(rank).toHaveBeenCalledTimes(6);
  expect(
    tree.root.findAllByType(QuoteRow).find(r => r.props.code === 'sh600036')
      ?.props.last,
  ).toBe(12345);
  await act(async () =>
    list().props.onViewableItemsChanged(visible(['sz000001'])),
  );
  expect(setExtraCodes).toHaveBeenLastCalledWith(['sz000001']);
  // 新板块和旧板块复用代码时，旧列表迟到的可见性事件不能覆盖新订阅。
  const staleCallback = list().props.onViewableItemsChanged;
  await select('etf');
  await act(async () =>
    list().props.onViewableItemsChanged(visible(['sh510300'])),
  );
  await act(async () => staleCallback(visible(['sh600036'])));
  expect(setExtraCodes).toHaveBeenLastCalledWith(['sh510300']);
  await act(async () => {
    nav.navigate('Stock', { code: 'sh510300' });
  });
  await advance(500);
  expect(setExtraCodes).toHaveBeenLastCalledWith([]);
});

test('自选滚动只更新可见股票订阅，离开页面撤销快速刷新', async () => {
  useWatch.setState({
    loaded: true,
    codes: ['sh600036', 'sz000001', 'sh600519'],
  });
  await render(WatchScreen);
  const list = tree.root.findByType(FlatList);
  await act(async () =>
    list.props.onViewableItemsChanged(visible(['sh600036'])),
  );
  expect(setExtraCodes.mock.lastCall![0]).toEqual(
    expect.arrayContaining(['sh600036', 'sh000001', 'sz399001', 'sz399006']),
  );
  expect(setExtraCodes.mock.lastCall![0]).not.toContain('sh600519');
  await act(async () =>
    list.props.onViewableItemsChanged(visible(['sz000001'])),
  );
  expect(setExtraCodes.mock.lastCall![0]).toContain('sz000001');
  expect(setExtraCodes.mock.lastCall![0]).not.toContain('sh600036');
  await act(async () => {
    nav.navigate('Stock', { code: 'sz000001' });
  });
  await advance(500);
  expect(setExtraCodes).toHaveBeenLastCalledWith([]);
});

test('排行榜不会被进入页面前的旧报价覆盖；本次接入有效报价后更新价格/成交额', async () => {
  await core.sim.ingest([quote()]);
  const rankRow = row('sh600036', 10000);
  expect(rankQuote(core.sim, rankRow, 100001)).toEqual(rankRow);
  await advance(2);
  await core.sim.ingest([quote()]); // 重复报价仍证明本次页面已确认该水位
  const merged = rankQuote(core.sim, rankRow, 100001);
  expect(merged.last).toBe(quote().snapshot.last);
  expect(merged.amount).toBe(quote().snapshot.amount);
  expect(merged.name).toBe(rankRow.name);
});
