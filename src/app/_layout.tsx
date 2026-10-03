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
import { Platform, View } from 'react-native';

import { StoreProvider } from '../lib/store';
import { Backdrop } from '../components/ui';
import { applyScheme, colors, useScheme } from '../lib/theme';

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

  const scheme = useScheme();
  // 把当前色板同步给 theme.ts（组件代码里直接读 colors 的地方都靠它）。
  // 这是幂等的模块级赋值，放在渲染里是为了让子树同一轮就拿到新色板。
  applyScheme(scheme);

  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        {/*
          key={scheme}：切换深浅色时整棵 UI 重新挂载。
          样式对象是通过 getter 惰性重建的，必须让组件重新渲染才能生效。
          StoreProvider 在外层，所以监控数据不会丢。
        */}
        <View key={scheme} style={{ flex: 1 }}>
          {/* 全局渐变背景：所有页面都是透明的，玻璃面板靠它出效果 */}
          <Backdrop />
          <Stack
            screenOptions={{
              headerShown: false,
              // 头部也是玻璃材质，压住内容时更好看
              headerTransparent: true,
              headerBlurEffect: colors.blurTint,
              headerTintColor: colors.primary,
              headerTitleStyle: { fontSize: 16, fontWeight: '700', color: colors.text },
              headerBackTitle: '返回',
              contentStyle: { backgroundColor: 'transparent' },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="team/[id]"
              options={{ headerShown: true, title: '团体详情' }}
            />
            <Stack.Screen
              name="add"
              options={{ headerShown: true, title: '添加团体' }}
            />
            <Stack.Screen
              name="help-email"
              options={{ headerShown: true, title: '邮箱通知怎么配' }}
            />
          </Stack>
        </View>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
