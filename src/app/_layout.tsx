/**
 * 根布局
 * - 挂载 StoreProvider（全局状态）
 * - 定义 Stack 导航：底部标签页 + 团体详情页
 */
import React, { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Platform } from 'react-native';

import { StoreProvider } from '../lib/store';

/**
 * 点击通知时跳转到通知页。
 *
 * ⚠️ 只在原生平台注册：web 上 expo-notifications 的
 * getLastNotificationResponse 等方法不存在，调用会直接抛
 * "is not available on web" 把整个 App 打崩。
 */
function useNotificationObserver() {
  useEffect(() => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;

    function redirect(notification: Notifications.Notification) {
      const orgId = notification.request.content.data?.orgId;
      if (typeof orgId === 'string') {
        router.push('/(tabs)/notifications');
      }
    }

    try {
      const last = Notifications.getLastNotificationResponse();
      if (last?.notification) redirect(last.notification);
    } catch (e) {
      console.warn('[layout] 读取上次通知失败', e);
    }

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      redirect(response.notification);
    });
    return () => sub.remove();
  }, []);
}

export default function RootLayout() {
  useNotificationObserver();

  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="team/[id]"
            options={{
              headerShown: true,
              title: '团体详情',
              headerBackTitle: '返回',
            }}
          />
        </Stack>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
