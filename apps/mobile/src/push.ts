import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api, type Connection } from './connection';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export interface PushStatus {
  state: 'registered' | 'denied' | 'unsupported' | 'no-project' | 'error';
  detail: string;
}

/**
 * Register this phone for approval pushes. Needs a real device, notification permission and an
 * EAS project id (set by `eas init`). Android also needs FCM credentials on the EAS project; see docs/MOBILE.md.
 */
export async function registerForPush(connection: Connection, deviceName: string): Promise<PushStatus> {
  if (!Device.isDevice) return { state: 'unsupported', detail: 'Push needs a physical device.' };
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('approvals', {
      name: 'Approvals', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 250, 250, 250], lightColor: '#F5C542',
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const status = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!status.granted) return { state: 'denied', detail: 'Notification permission was not granted.' };
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return { state: 'no-project', detail: 'This build has no EAS project id, so Expo cannot issue a push token. Approvals still arrive live while the app is open.' };
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await api(connection, '/api/devices', { method: 'POST', body: JSON.stringify({ name: deviceName, expoPushToken: token }) });
    return { state: 'registered', detail: `Registered ${token.slice(0, 24)}…` };
  } catch (error) {
    return { state: 'error', detail: (error as Error).message };
  }
}
