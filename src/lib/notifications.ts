/**
 * 本地通知封装（expo-notifications）
 *
 * 说明：这里只做「本地通知」——App 自己发现新项目时弹出提醒。
 * 不涉及远程推送（那需要服务器 + APNs），保持零服务器依赖。
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** Android 通知渠道 id */
const CHANNEL_ID = 'volunteer-watch';

/**
 * 通知功能只在原生平台可用。
 * web 上 expo-notifications 的部分方法根本不存在（调用会抛
 * "is not available on web"），所以所有入口都要先过这个判断。
 */
export const NOTIFICATIONS_SUPPORTED = Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * 设置前台收到通知时的展示行为。
 * 必须在模块加载时（组件外）调用一次。
 */
export function configureNotificationHandler(): void {
  if (!NOTIFICATIONS_SUPPORTED) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch (e) {
    console.warn('[notify] 设置通知处理器失败', e);
  }
}

/** 创建 Android 通知渠道（Android 13+ 必须先建渠道才会弹权限申请） */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: '志愿项目更新',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2E7D32',
    });
  } catch (e) {
    console.warn('[notify] 创建通知渠道失败', e);
  }
}

/**
 * 申请通知权限
 * @returns 是否已获得权限
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!NOTIFICATIONS_SUPPORTED) return false;
  try {
    await ensureAndroidChannel();

    const existing = await Notifications.getPermissionsAsync();
    // iOS 上要同时看 ios.status，provisional 也算可用
    if (existing.granted) return true;
    if (Platform.OS === 'ios') {
      const iosStatus = existing.ios?.status;
      if (
        iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL ||
        iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED
      ) {
        return true;
      }
    }

    const req = await Notifications.requestPermissionsAsync();
    if (req.granted) return true;
    if (Platform.OS === 'ios') {
      const iosStatus = req.ios?.status;
      if (
        iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL ||
        iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED
      ) {
        return true;
      }
    }
    return false;
  } catch (e) {
    console.warn('[notify] 申请权限失败', e);
    return false;
  }
}

/** 查询当前是否有通知权限（不弹窗） */
export async function hasNotificationPermission(): Promise<boolean> {
  if (!NOTIFICATIONS_SUPPORTED) return false;
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted) return true;
    if (Platform.OS === 'ios') {
      const s = p.ios?.status;
      return (
        s === Notifications.IosAuthorizationStatus.PROVISIONAL ||
        s === Notifications.IosAuthorizationStatus.AUTHORIZED
      );
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 立刻弹一条本地通知
 * @param title 标题
 * @param body  正文
 * @param data  附加数据（点击通知时可用于跳转）
 */
export async function presentLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (!NOTIFICATIONS_SUPPORTED) {
    console.log('[notify/web] 跳过通知:', title, body);
    return;
  }
  try {
    await ensureAndroidChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        data: data ?? {},
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
      // trigger 为 null 表示立即发送
      trigger: null,
    });
  } catch (e) {
    console.warn('[notify] 发送通知失败', e);
  }
}

/** 一口气发多条通知（每条独立） */
export async function presentMany(
  items: { title: string; body: string; data?: Record<string, unknown> }[]
): Promise<void> {
  for (const it of items) {
    await presentLocalNotification(it.title, it.body, it.data);
  }
}

/** 清掉系统通知栏里本 App 的通知 */
export async function dismissAll(): Promise<void> {
  if (!NOTIFICATIONS_SUPPORTED) return;
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch (e) {
    console.warn('[notify] 清除通知失败', e);
  }
}
