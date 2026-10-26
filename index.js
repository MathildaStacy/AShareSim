/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { trackerTask } from './src/app/boot';

AppRegistry.registerComponent(appName, () => App);
// 后台跟踪挂单（android/.../tracker/TrackerService.kt）
AppRegistry.registerHeadlessTask('AShareSimTracker', () => trackerTask);
