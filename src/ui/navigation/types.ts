import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OrderKind } from '../../engine/types';

export type TabParamList = {
  Watch: undefined;
  Market: undefined;
  Trade: undefined;
  Learn: undefined;
  Me: undefined;
};

/** 下单页的 4 个分段：买入 / 卖出 / 撤单 / 持仓。 */
export type OrderSide = 'B' | 'S' | 'C' | 'P';

export type OrdersTab = 'today' | 'fills' | 'hist' | 'ledger';

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  /** name / type 是从列表带过来的，行情到之前先显示。 */
  Stock: { code: string; name?: string; type?: string };
  /** pick：从下单页进来选证券，选中后带着代码回到下单页。 */
  Search: { pick?: { side: 'B' | 'S'; kind?: OrderKind } } | undefined;
  WatchEdit: undefined;
  Debug: undefined;
  /**
   * price 是点五档带过来的价格（厘）；kind 默认限价，「盘后交易」入口传 after。
   * qty：AI 的 navigate 把表单填好时带的数量（只填好，不提交）。
   */
  Order: {
    side: OrderSide;
    code?: string;
    name?: string;
    price?: number;
    kind?: OrderKind;
    qty?: number;
  };
  Positions: undefined;
  Position: { code: string };
  Orders: { tab?: OrdersTab } | undefined;
  OrderDetail: { id: number };
  FillDetail: { id: number };
  /** 银证转账：in 银行转证券（默认），out 证券转银行；amount（分）是 AI 填好的金额。 */
  Transfer: { dir?: 'in' | 'out'; amount?: number } | undefined;
  Flows: undefined;
  Fees: undefined;
  Calibrate: undefined;
  Settings: undefined;
  PowerGuide: undefined;
  Accounts: undefined;
  ArchivedAccount: { id: number };
  // M3 学习
  Stage: { no: number };
  Lessons: undefined;
  Lesson: { id: string };
  /** code：从个股页、费率设置带过来的证券；price（厘）、qty 是 AI 填好的。 */
  FeeCalc: { code?: string; price?: number; qty?: number } | undefined;
  Auction: undefined;
  Analysis: undefined;
  DataLab: undefined;
  /** M5 才做的功能，先放说明页。 */
  Coming: { key: 'datacenter' | 'exec' };
  // M4 AI
  Ai: undefined;
  AiThreads: undefined;
  AiMemory: undefined;
  AiServices: undefined;
  /** 没有 id 是添加服务。 */
  AiService: { id?: string } | undefined;
  AiContext: undefined;
};

export type RootScreenProps<K extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, K>;
