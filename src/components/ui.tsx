/**
 * 液态玻璃 UI 组件库
 *
 * 统一封装，避免每个页面各写一套模糊/阴影参数：
 *   Backdrop    —— 页面背景（淡渐变）
 *   Glass       —— 玻璃面板
 *   Tap         —— 可点区域（安卓带水波纹）
 *   GlassButton —— 胶囊按钮
 *   Divider     —— 玻璃分隔线
 *   Badge       —— 小标签
 *   Icon        —— 扁平矢量图标（Ionicons）
 */
import React from 'react';
import {
  ActivityIndicator, Platform, Pressable, StyleSheet, Text, View,
  type ViewStyle, type StyleProp,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  bgGradient, buttonShadow, colors, glassShadow, radius as R, spacing,
} from '../lib/theme';
import { themedStyles } from '../lib/theme';

/* ------------------------------------------------------------------ 图标 */

export type IconName = keyof typeof Ionicons.glyphMap;

export function Icon({
  name, size = 20, color = colors.text,
}: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}

/* ------------------------------------------------------------------ 背景 */

/** 页面背景：一层很淡的多色渐变，给玻璃面板提供可感知的底色 */
export function Backdrop() {
  return (
    <LinearGradient
      colors={bgGradient()}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
}

/* ------------------------------------------------------------------ 玻璃 */

export function Glass({
  children, style, corner = R.lg, intensity = 48, padded = true, strong = false,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  corner?: number;
  intensity?: number;
  padded?: boolean;
  strong?: boolean;
}) {
  const android = Platform.OS === 'android';
  return (
    <View style={[{ borderRadius: corner, overflow: 'hidden' }, glassShadow(), style]}>
      <BlurView
        intensity={intensity}
        // 深浅色各用一套系统材质
        tint={Platform.OS === 'ios' ? colors.blurTint : 'light'}
        // 安卓 12 以下会自动退化成半透明，所以下面垫了底色
        blurMethod={android ? 'dimezisBlurViewSdk31Plus' : undefined}
        style={[
          StyleSheet.absoluteFill,
          android ? { backgroundColor: strong ? colors.glassStrong : colors.glass } : null,
        ]}
      />
      {/* 高光描边 */}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, {
          borderRadius: corner,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.glassBorder,
        }]}
      />
      <View style={padded ? { padding: spacing.lg } : undefined}>{children}</View>
    </View>
  );
}

export function Divider({ inset = spacing.lg }: { inset?: number }) {
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

/* ------------------------------------------------------------------ 可点 */

/** 可点区域：iOS 用透明度反馈，安卓用水波纹 */
export function Tap({
  children, onPress, onLongPress, style, disabled, accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      android_ripple={Platform.OS === 'android' ? { color: 'rgba(30,122,76,0.14)' } : undefined}
      style={({ pressed }) => [
        style,
        pressed && Platform.OS === 'ios' ? { opacity: 0.62 } : null,
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ 按钮 */

export function GlassButton({
  label, onPress, icon, variant = 'primary', disabled, loading, style,
}: {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  variant?: 'primary' | 'glass' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';

  const bg = isPrimary ? colors.primary : isDanger ? colors.dangerDim : colors.glass;
  const fg = isPrimary ? colors.textOnAccent : isDanger ? colors.danger : colors.text;

  return (
    <Tap onPress={onPress} disabled={disabled || loading} style={style}>
      <View
        style={[
          styles.button,
          { backgroundColor: bg },
          isPrimary ? buttonShadow() : glassShadow(),
          !isPrimary && !isDanger ? { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.glassBorder } : null,
          disabled ? { opacity: 0.5 } : null,
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={fg} />
        ) : (
          <View style={styles.buttonInner}>
            {icon ? <Icon name={icon} size={17} color={fg} /> : null}
            <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
          </View>
        )}
      </View>
    </Tap>
  );
}

/* ------------------------------------------------------------------ 标签 */

export function Badge({
  text, tone = 'neutral',
}: { text: string; tone?: 'neutral' | 'primary' | 'warn' | 'info' | 'danger' }) {
  const map = {
    neutral: { bg: 'rgba(120,130,150,0.16)', fg: colors.textDim },
    primary: { bg: colors.primaryDim, fg: colors.primary },
    warn: { bg: colors.warnDim, fg: colors.warn },
    info: { bg: colors.infoDim, fg: colors.info },
    danger: { bg: colors.dangerDim, fg: colors.danger },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: map.bg }]}>
      <Text style={[styles.badgeText, { color: map.fg }]}>{text}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ 其它 */

/** 分组标题 */
export function GroupTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.groupTitle}>{children}</Text>;
}

const styles = themedStyles(() => StyleSheet.create({
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.glassDivider,
  },

  button: {
    height: 50,
    borderRadius: R.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  buttonText: { fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },

  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: R.sm,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },

  groupTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textDim,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
    marginLeft: spacing.xs,
    letterSpacing: 0.4,
  },
}));
