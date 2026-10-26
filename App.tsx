/**
 * AShareSim：底部 5 个 Tab 的正式界面。本地库打开之前显示启动页；全局提示（Toast）盖在最上层。
 * M2 第 1 步的调试页挪到了「我的 → 调试页」。
 */
import { NavigationContainer } from '@react-navigation/native';
import { useEffect } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { boot, useApp } from './src/app/boot';
import { cleanupExports } from './src/app/exportFile';
import { ToastHost } from './src/ui/components/ToastHost';
import { RootStack } from './src/ui/navigation/RootStack';
import { prefs } from './src/ui/prefs';
import { color } from './src/ui/theme';

function App() {
  const core = useApp(s => s.core);
  const error = useApp(s => s.error);
  useEffect(() => {
    boot().catch(() => undefined);
    cleanupExports().catch(() => undefined);
  }, []);
  useEffect(() => {
    if (core) {
      prefs.load(core).catch(() => undefined);
    }
  }, [core]);
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      {core ? (
        <NavigationContainer>
          <RootStack />
        </NavigationContainer>
      ) : (
        <View style={styles.splash}>
          <Text style={styles.title}>AShareSim</Text>
          <Text style={error ? styles.err : styles.sub}>
            {error ? '启动失败：' + error : '正在打开本地库…'}
          </Text>
        </View>
      )}
      <ToastHost />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.bg,
  },
  title: { fontSize: 22, fontWeight: '600', color: color.ink },
  sub: { marginTop: 8, color: color.ink2 },
  err: { marginTop: 8, color: color.up, paddingHorizontal: 24 },
});

export default App;
