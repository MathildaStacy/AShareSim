/**
 * 底部 5 个 Tab（自选 / 行情 / 交易 / 学习 / 我的）+ 压栈页面。页面自己画导航栏（NavBar），
 * 原生栈负责返回手势和 Android 返回键。
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  ArrowLeftRight,
  ChartCandlestick,
  GraduationCap,
  Star,
  UserRound,
} from 'lucide-react-native';
import {
  AccountsScreen,
  ArchivedAccountScreen,
} from '../screens/AccountsScreens';
import { AiMcpScreen, AiMcpServerScreen } from '../screens/AiMcpScreens';
import { AiScreen } from '../screens/AiScreen';
import {
  AiContextScreen,
  AiMemoryScreen,
  AiServiceScreen,
  AiServicesScreen,
  AiThreadsScreen,
} from '../screens/AiScreens';
import { DebugScreen } from '../screens/DebugScreen';
import { FillDetailScreen, OrderDetailScreen } from '../screens/DetailScreens';
import { CalibrateScreen, FeesScreen } from '../screens/FeeScreens';
import { FlowsScreen, TransferScreen } from '../screens/FundsScreens';
import { MarketScreen } from '../screens/MarketScreen';
import { OrderScreen } from '../screens/OrderScreen';
import { OrdersScreen } from '../screens/OrdersScreen';
import { PositionScreen, PositionsScreen } from '../screens/PositionsScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { PowerGuideScreen, SettingsScreen } from '../screens/SettingsScreens';
import { StockScreen } from '../screens/StockScreen';
import { AnalysisScreen } from '../screens/AnalysisScreen';
import { AuctionScreen } from '../screens/AuctionScreen';
import { DataLabScreen } from '../screens/DataLabScreen';
import { FeeCalcScreen } from '../screens/FeeCalcScreen';
import {
  ComingScreen,
  LearnScreen,
  StageScreen,
} from '../screens/LearnScreens';
import { LessonScreen, LessonsScreen } from '../screens/LessonScreens';
import { MeScreen, TradeScreen } from '../screens/TabScreens';
import { WatchEditScreen } from '../screens/WatchEditScreen';
import { WatchScreen } from '../screens/WatchScreen';
import { color } from '../theme';
import type { RootStackParamList, TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const ICON = { size: 22, strokeWidth: 1.75 };
type IconProps = { color: string };
const WatchIcon = ({ color: c }: IconProps) => <Star color={c} {...ICON} />;
const MarketIcon = ({ color: c }: IconProps) => (
  <ChartCandlestick color={c} {...ICON} />
);
const TradeIcon = ({ color: c }: IconProps) => (
  <ArrowLeftRight color={c} {...ICON} />
);
const LearnIcon = ({ color: c }: IconProps) => (
  <GraduationCap color={c} {...ICON} />
);
const MeIcon = ({ color: c }: IconProps) => <UserRound color={c} {...ICON} />;

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.up,
        tabBarInactiveTintColor: color.ink3,
        tabBarStyle: {
          backgroundColor: color.card,
          borderTopColor: color.line,
        },
        tabBarLabelStyle: { fontSize: 11 },
        sceneStyle: { backgroundColor: color.bg },
      }}
    >
      <Tab.Screen
        name="Watch"
        component={WatchScreen}
        options={{ title: '自选', tabBarIcon: WatchIcon }}
      />
      <Tab.Screen
        name="Market"
        component={MarketScreen}
        options={{ title: '行情', tabBarIcon: MarketIcon }}
      />
      <Tab.Screen
        name="Trade"
        component={TradeScreen}
        options={{ title: '交易', tabBarIcon: TradeIcon }}
      />
      <Tab.Screen
        name="Learn"
        component={LearnScreen}
        options={{
          title: '学习',
          tabBarIcon: LearnIcon,
          tabBarActiveTintColor: color.learn,
        }}
      />
      <Tab.Screen
        name="Me"
        component={MeScreen}
        options={{ title: '我的', tabBarIcon: MeIcon }}
      />
    </Tab.Navigator>
  );
}

export function RootStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        statusBarStyle: 'dark',
        contentStyle: { backgroundColor: color.bg },
      }}
    >
      <Stack.Screen name="Tabs" component={Tabs} />
      <Stack.Screen name="Stock" component={StockScreen} />
      <Stack.Screen
        name="Search"
        component={SearchScreen}
        options={{ animation: 'fade' }}
      />
      <Stack.Screen name="WatchEdit" component={WatchEditScreen} />
      <Stack.Screen name="Debug" component={DebugScreen} />
      <Stack.Screen name="Order" component={OrderScreen} />
      <Stack.Screen name="Positions" component={PositionsScreen} />
      <Stack.Screen name="Position" component={PositionScreen} />
      <Stack.Screen name="Orders" component={OrdersScreen} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
      <Stack.Screen name="FillDetail" component={FillDetailScreen} />
      <Stack.Screen name="Transfer" component={TransferScreen} />
      <Stack.Screen name="Flows" component={FlowsScreen} />
      <Stack.Screen name="Fees" component={FeesScreen} />
      <Stack.Screen name="Calibrate" component={CalibrateScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="PowerGuide" component={PowerGuideScreen} />
      <Stack.Screen name="Accounts" component={AccountsScreen} />
      <Stack.Screen name="ArchivedAccount" component={ArchivedAccountScreen} />
      <Stack.Screen name="Stage" component={StageScreen} />
      <Stack.Screen name="Lessons" component={LessonsScreen} />
      <Stack.Screen name="Lesson" component={LessonScreen} />
      <Stack.Screen name="FeeCalc" component={FeeCalcScreen} />
      <Stack.Screen name="Auction" component={AuctionScreen} />
      <Stack.Screen name="Analysis" component={AnalysisScreen} />
      <Stack.Screen name="DataLab" component={DataLabScreen} />
      <Stack.Screen name="Coming" component={ComingScreen} />
      <Stack.Screen
        name="Ai"
        component={AiScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
      <Stack.Screen name="AiThreads" component={AiThreadsScreen} />
      <Stack.Screen name="AiMemory" component={AiMemoryScreen} />
      <Stack.Screen name="AiServices" component={AiServicesScreen} />
      <Stack.Screen name="AiService" component={AiServiceScreen} />
      <Stack.Screen name="AiMcp" component={AiMcpScreen} />
      <Stack.Screen name="AiMcpServer" component={AiMcpServerScreen} />
      <Stack.Screen name="AiContext" component={AiContextScreen} />
    </Stack.Navigator>
  );
}
