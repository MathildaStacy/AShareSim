import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type TabParamList = {
  Watch: undefined;
  Market: undefined;
  Trade: undefined;
  Learn: undefined;
  Me: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  /** name / type 是从列表带过来的，行情到之前先显示。 */
  Stock: { code: string; name?: string; type?: string };
  Search: undefined;
  WatchEdit: undefined;
  Debug: undefined;
  Ai: undefined;
};

export type RootScreenProps<K extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, K>;
