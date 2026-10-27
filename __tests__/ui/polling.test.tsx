import { Text } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { usePolling, type Polled } from '../../src/ui/hooks';

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useFocusEffect: (callback: () => void) =>
      React.useEffect(callback, [callback]),
  };
});
jest.mock('../../src/data/drivers/opSqlite', () => ({
  openDeviceDb: jest.fn(),
}));
jest.mock('../../src/app/tracker', () => ({ nativeTracker: () => null }));

test('换周期第一帧就屏蔽旧数据，失败也不会带回旧周期；迟到请求不能覆盖当前结果', async () => {
  const rendered: { period: string; value: Polled<string> }[] = [];
  const requests: {
    period: string;
    resolve: (value: string) => void;
    reject: (err: Error) => void;
  }[] = [];
  function Screen({ period }: { period: string }) {
    const value = usePolling(
      () =>
        new Promise<string>((resolve, reject) => {
          requests.push({ period, resolve, reject });
        }),
      [period],
      null,
    );
    rendered.push({ period, value });
    return <Text>{value.data ?? value.error ?? '加载中'}</Text>;
  }
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(<Screen period="m60" />);
  });
  await act(async () => {
    requests[0].resolve('2026-10-27 15:00');
  });
  expect(rendered.at(-1)!.value.data).toBe('2026-10-27 15:00');
  await act(async () => {
    tree.update(<Screen period="week" />);
  });
  expect(
    rendered.filter(r => r.period === 'week').every(r => r.value.data === null),
  ).toBe(true);
  await act(async () => {
    requests[1].reject(new Error('网络错误'));
  });
  expect(rendered.at(-1)!.value).toMatchObject({
    data: null,
    error: '网络错误',
    loading: false,
    at: null,
  });
  await act(async () => {
    tree.update(<Screen period="day" />);
  });
  await act(async () => {
    tree.update(<Screen period="m15" />);
  });
  await act(async () => {
    requests[3].resolve('分钟 K');
  });
  await act(async () => {
    requests[2].resolve('迟到的日 K');
  });
  expect(rendered.at(-1)!.value.data).toBe('分钟 K');
  expect(
    rendered
      .filter(r => r.period === 'm15')
      .every(r => r.value.data !== '迟到的日 K'),
  ).toBe(true);
  await act(async () => {
    tree.unmount();
  });
});
