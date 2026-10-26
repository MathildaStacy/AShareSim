/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

// 本地库是原生模块，测试里不启动，只检查界面能渲染
jest.mock('../src/app/boot', () => {
  const { create } = require('zustand');
  return {
    boot: () => new Promise(() => {}),
    useApp: create(() => ({
      core: null,
      error: null,
      status: null,
      version: 0,
      lastEvents: [],
    })),
  };
});

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
