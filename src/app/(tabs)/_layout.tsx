/**
 * 底部标签导航 —— 悬浮胶囊玻璃样式
 *
 * 说明：expo-router 的 tabBar 回调参数类型来自它内置的导航实现，
 * 这里只用到 index / routes / descriptors / navigation 四样东西，
 * 所以自己声明一个最小结构，避免依赖内部类型路径。
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass, Icon, Tap, type IconName } from '../../components/ui';
import { colors, radius as R, spacing } from '../../lib/theme';

/** 每个标签对应一个扁平图标（选中/未选中两态） */
const TAB_META: Record<string, { label: string; on: IconName; off: IconName }> = {
  index: { label: '团体', on: 'people', off: 'people-outline' },
  notifications: { label: '通知', on: 'notifications', off: 'notifications-outline' },
  settings: { label: '设置', on: 'settings', off: 'settings-outline' },
};

interface MinTabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  descriptors: Record<string, { options: Record<string, unknown> }>;
  navigation: {
    navigate: (name: string) => void;
    emit: (event: { type: string; target: string; canPreventDefault?: boolean }) => {
      defaultPrevented: boolean;
    };
  };
}

function GlassTabBar({ state, descriptors, navigation }: MinTabBarProps) {
  const insets = useSafeAreaInsets();
  void descriptors;

  return (
    <View
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
      pointerEvents="box-none"
    >
      <Glass corner={R.pill} padded={false} intensity={62} style={styles.bar}>
        <View style={styles.row}>
          {state.routes.map((route, index) => {
            const meta = TAB_META[route.name];
            if (!meta) return null; // 不在表里的路由不显示

            const focused = state.index === index;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            return (
              <Tap
                key={route.key}
                onPress={onPress}
                accessibilityLabel={meta.label}
                style={styles.item}
              >
                <View style={[styles.itemInner, focused && styles.itemInnerActive]}>
                  <Icon
                    name={focused ? meta.on : meta.off}
                    size={21}
                    color={focused ? colors.primary : colors.textFaint}
                  />
                  <Text
                    style={[
                      styles.label,
                      { color: focused ? colors.primary : colors.textFaint },
                      focused && styles.labelActive,
                    ]}
                  >
                    {meta.label}
                  </Text>
                </View>
              </Tap>
            );
          })}
        </View>
      </Glass>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <GlassTabBar {...(props as unknown as MinTabBarProps)} />}
      screenOptions={{
        headerShown: false,
        // 自绘 tabBar，隐藏默认的
        tabBarStyle: { display: 'none' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '团体' }} />
      <Tabs.Screen name="notifications" options={{ title: '通知' }} />
      <Tabs.Screen name="settings" options={{ title: '设置' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // 悬浮在内容之上，左右留白
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: 'transparent',
  },
  bar: { width: '100%' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  item: { flex: 1, borderRadius: R.pill, overflow: 'hidden' },
  itemInner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: R.pill,
    gap: 3,
  },
  itemInnerActive: { backgroundColor: colors.primaryDim },
  label: { fontSize: 11, fontWeight: '600' },
  labelActive: { fontWeight: '700' },
});
