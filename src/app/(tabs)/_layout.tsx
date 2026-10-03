/**
 * 底部标签导航 —— 悬浮胶囊玻璃 + 滑动镜头
 *
 * 说明：
 *   - expo-router 的 tabBar 回调参数类型来自它内置的导航实现，
 *     这里只用到 state / descriptors / navigation，自己声明最小结构，
 *     避免依赖内部类型路径。
 *   - 选中项有一个会滑动的「镜头」：位移用 spring 动画，
 *     镜头内部是更强的模糊 + 高光描边，模拟液态玻璃的凸透镜观感。
 *     （真正的折射/放大需要 GPU 着色器，纯 RN 做不到，这里是近似。）
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';

import { Glass, Icon, Tap, type IconName } from '../../components/ui';
import { colors, radius as R, spacing, themedStyles } from '../../lib/theme';

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

  const routes = state.routes.filter((r) => TAB_META[r.name]);

  const [rowW, setRowW] = useState(0);
  const itemW = rowW > 0 ? rowW / routes.length : 0;

  /** 镜头位置用「第几个标签」表示，再乘以单项宽度得到像素位移 */
  // 用 useState 的惰性初始化持有这个动画值：
  // 渲染期间读 useRef(...).current 会触发 React 新规则报错
  const [pos] = useState(() => new Animated.Value(state.index));

  useEffect(() => {
    Animated.spring(pos, {
      toValue: state.index,
      useNativeDriver: true,
      damping: 20,
      stiffness: 190,
      mass: 0.75,
    }).start();
  }, [state.index, pos]);

  const lensTranslate = itemW > 0 ? Animated.multiply(pos, itemW) : 0;

  return (
    <View
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
      pointerEvents="box-none"
    >
      <Glass corner={R.pill} padded={false} intensity={62} style={styles.bar}>
        <View style={styles.row} onLayout={(e) => setRowW(e.nativeEvent.layout.width)}>
          {/* 滑动镜头：垫在图标下面 */}
          {itemW > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[styles.lens, { width: itemW, transform: [{ translateX: lensTranslate }] }]}
            >
              <BlurView
                intensity={85}
                tint={Platform.OS === 'ios' ? colors.blurTint : 'light'}
                blurMethod={Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : undefined}
                style={[
                  StyleSheet.absoluteFill,
                  Platform.OS === 'android'
                    ? { backgroundColor: colors.glassStrong }
                    : null,
                ]}
              />
              {/* 高光描边 + 顶部亮边，做出凸透镜的边沿 */}
              <View pointerEvents="none" style={styles.lensRim} />
              <View pointerEvents="none" style={styles.lensGloss} />
            </Animated.View>
          ) : null}

          {routes.map((route) => {
            const meta = TAB_META[route.name];
            const realIndex = state.routes.findIndex((r) => r.key === route.key);
            const focused = state.index === realIndex;

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
                <View style={styles.itemInner}>
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
        // ⚠️ 必须让场景容器透明，否则导航器自带的浅灰底色会盖住全局渐变背景，
        //    深色模式下就变成「深色文字 + 浅灰背景」，整页看不清
        sceneStyle: { backgroundColor: 'transparent' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '团体' }} />
      <Tabs.Screen name="notifications" options={{ title: '通知' }} />
      <Tabs.Screen name="settings" options={{ title: '设置' }} />
    </Tabs>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  wrap: {
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

  /** 滑动镜头：比单项略窄一点，看起来像嵌在胶囊里 */
  lens: {
    position: 'absolute',
    top: spacing.sm,
    bottom: spacing.sm,
    left: spacing.xs,
    borderRadius: R.pill,
    overflow: 'hidden',
  },
  lensRim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: R.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.glassBorder,
  },
  lensGloss: {
    position: 'absolute',
    left: '18%',
    right: '18%',
    top: 3,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },

  item: { flex: 1, borderRadius: R.pill, overflow: 'hidden' },
  itemInner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    gap: 3,
  },
  label: { fontSize: 11, fontWeight: '600' },
  labelActive: { fontWeight: '700' },
}));
