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
  Ai: undefined;
  /** price 是点五档带过来的价格（厘）；kind 默认限价，「盘后交易」入口传 after。 */
  Order: {
    side: OrderSide;
    code?: string;
    name?: string;
    price?: number;
    kind?: OrderKind;
  };
  Positions: undefined;
  Position: { code: string };
  Orders: { tab?: OrdersTab } | undefined;
  OrderDetail: { id: number };
  FillDetail: { id: number };
};

export type RootScreenProps<K extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, K>;
