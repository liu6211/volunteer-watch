/**
 * 底部标签导航
 */
import React from 'react';
import { Text } from 'react-native';
import { Tabs } from 'expo-router';

import { colors } from '../../lib/theme';

/** 用 emoji 当图标，省掉字体依赖 */
function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTitleStyle: { fontSize: 17, fontWeight: '700', color: colors.text },
        headerShadowVisible: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '监控的团体',
          tabBarLabel: '团体',
          tabBarIcon: ({ focused }) => <TabIcon emoji="👥" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: '通知记录',
          tabBarLabel: '通知',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🔔" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '设置',
          tabBarLabel: '设置',
          tabBarIcon: ({ focused }) => <TabIcon emoji="⚙️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: '添加团体',
          href: null, // 不出现在标签栏里，通过「添加」按钮进入
        }}
      />
    </Tabs>
  );
}
