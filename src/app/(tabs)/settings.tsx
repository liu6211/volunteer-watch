/**
 * 设置页
 */
import React, { useState } from 'react';
import {
  Alert, Platform, ScrollView, StyleSheet, Switch, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';

import { useStore } from '../../lib/store';
import { colors, radius, spacing } from '../../lib/theme';
import {
  requestNotificationPermission, hasNotificationPermission, dismissAll,
  presentLocalNotification,
} from '../../lib/notifications';
import { getBackgroundStatus, MIN_INTERVAL_MINUTES } from '../../lib/backgroundTask';
import type { BackgroundStatus } from '../../lib/backgroundTask';
import { isMailConfigured } from '../../lib/email';
import * as Device from 'expo-device';

/** 可选检查间隔 */
const INTERVALS = [
  { label: '15 分钟', value: 15 },
  { label: '30 分钟', value: 30 },
  { label: '1 小时', value: 60 },
  { label: '3 小时', value: 180 },
  { label: '6 小时', value: 360 },
  { label: '12 小时', value: 720 },
];

export default function SettingsScreen() {
  const { state, updateSettings, resetAll, bg, refreshBgStatus } = useStore();
  const s = state.settings;

  const [perm, setPerm] = useState<boolean | null>(null);
  const [emailTo, setEmailTo] = useState(s.emailTo);

  React.useEffect(() => {
    void (async () => {
      setPerm(await hasNotificationPermission());
      await refreshBgStatus();
    })();
  }, [refreshBgStatus]);

  const bgStatusText = (): string => {
    if (!s.backgroundCheckEnabled) return '已关闭';
    if (bg.availability === 'restricted') {
      return Platform.OS === 'web'
        ? '网页版不支持后台检查'
        : '系统限制，后台检查不可用';
    }
    if (bg.registered) return '已开启（由系统择机执行）';
    if (bg.availability === 'unknown') return '状态未知';
    return '未注册';
  };

  const onAskPermission = async () => {
    const ok = await requestNotificationPermission();
    setPerm(ok);
    Alert.alert(
      ok ? '通知权限已开启' : '没有拿到通知权限',
      ok
        ? '发现新项目时会弹通知提醒你。'
        : '请到手机的「设置 → 应用 → 志愿项目监控 → 通知」里手动打开。'
    );
  };

  /** 立刻弹一条测试通知，用来确认通知通路是否正常 */
  const onTestNotification = async () => {
    const ok = await requestNotificationPermission();
    setPerm(ok);
    if (!ok) {
      Alert.alert('没有通知权限', '请先授权通知，否则收不到提醒。');
      return;
    }
    await presentLocalNotification(
      '测试通知 ✅',
      '如果你看到这条，说明通知功能正常，发现新项目时也会这样提醒你。',
      { test: true }
    );
  };

  const onReset = () => {
    Alert.alert(
      '清空所有数据',
      '会删除监控列表、通知记录和全部设置，且无法恢复。确定吗？',
      [
        { text: '取消', style: 'cancel' },
        { text: '确定清空', style: 'destructive', onPress: () => { void resetAll(); } },
      ]
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* ------------------------------------------------ 通知 */}
      <Text style={styles.groupTitle}>通知</Text>
      <View style={styles.group}>
        <Row
          title="新项目通知"
          subtitle="发现新项目时弹手机通知"
          right={
            <Switch
              value={s.notificationsEnabled}
              onValueChange={(v) => { void updateSettings({ notificationsEnabled: v }); }}
              trackColor={{ true: colors.primary, false: '#CFD4DA' }}
            />
          }
        />
        <Divider />
        <TouchableOpacity style={styles.row} onPress={() => { void onAskPermission(); }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>通知权限</Text>
            <Text style={styles.rowSub}>
              {perm === null ? '检测中…' : perm ? '已授权' : '未授权，点这里申请'}
            </Text>
          </View>
          <Text style={[styles.badge, perm ? styles.badgeOk : styles.badgeWarn]}>
            {perm ? '正常' : '去开启'}
          </Text>
        </TouchableOpacity>
        <Divider />
        <TouchableOpacity style={styles.row} onPress={() => { void onTestNotification(); }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>发送测试通知</Text>
            <Text style={styles.rowSub}>立刻弹一条，用来确认通知能不能正常收到</Text>
          </View>
          <Text style={[styles.badge, styles.badgeOk]}>测试</Text>
        </TouchableOpacity>
        <Divider />
        <TouchableOpacity style={styles.row} onPress={() => { void dismissAll(); }}>
          <Text style={styles.rowTitle}>清掉系统通知栏里的旧提醒</Text>
        </TouchableOpacity>
      </View>

      {/* ------------------------------------------------ 后台检查 */}
      <Text style={styles.groupTitle}>后台检查</Text>
      <View style={styles.group}>
        <Row
          title="自动检查"
          subtitle="App 在后台时也定时抓取（不打开也能发现）"
          right={
            <Switch
              value={s.backgroundCheckEnabled}
              onValueChange={(v) => { void updateSettings({ backgroundCheckEnabled: v }); }}
              trackColor={{ true: colors.primary, false: '#CFD4DA' }}
            />
          }
        />
        <Divider />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>检查间隔</Text>
            <Text style={styles.rowSub}>系统只会把它当作「最短间隔」，实际可能更晚</Text>
          </View>
        </View>
        <View style={styles.chips}>
          {INTERVALS.map((it) => (
            <TouchableOpacity
              key={it.value}
              style={[styles.chip, s.intervalMinutes === it.value && styles.chipActive]}
              onPress={() => { void updateSettings({ intervalMinutes: it.value }); }}
            >
              <Text style={[
                styles.chipText,
                s.intervalMinutes === it.value && styles.chipTextActive,
              ]}>
                {it.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Divider />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>后台任务状态</Text>
            <Text style={styles.rowSub}>{bgStatusText()}</Text>
          </View>
        </View>
      </View>

      {/* ------------------------------------------------ 邮箱 */}
      <Text style={styles.groupTitle}>邮箱通知（预留接口）</Text>
      <View style={styles.group}>
        <Row
          title="发现新项目时发邮件"
          subtitle={
            isMailConfigured()
              ? '已配置邮件服务'
              : '尚未配置邮件服务，见 src/lib/email.ts'
          }
          right={
            <Switch
              value={s.emailEnabled}
              onValueChange={(v) => { void updateSettings({ emailEnabled: v }); }}
              trackColor={{ true: colors.primary, false: '#CFD4DA' }}
            />
          }
        />
        <Divider />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>收件邮箱</Text>
            <TextInput
              style={styles.input}
              value={emailTo}
              onChangeText={setEmailTo}
              onBlur={() => { void updateSettings({ emailTo: emailTo.trim() }); }}
              placeholder="you@example.com"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Text style={styles.rowSub}>
              接口已留在代码里，填好 SMTP / 邮件服务商信息后即可生效。
            </Text>
          </View>
        </View>
      </View>

      {/* ------------------------------------------------ 关于 */}
      <Text style={styles.groupTitle}>关于</Text>
      <View style={styles.group}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>运行平台</Text>
            <Text style={styles.rowSub}>
              {Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : Platform.OS}
              {' · '}
              {Device.isDevice ? '真机' : '模拟器/预览环境'}
            </Text>
          </View>
        </View>
        <Divider />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>检查方式</Text>
            <Text style={styles.rowSub}>
              直接抓取团体页 HTML 里「发起的项目」表格（页面里本来就带着数据，
              不需要登录，也不需要模拟点击）
            </Text>
          </View>
        </View>
        <Divider />
        <TouchableOpacity style={styles.row} onPress={onReset}>
          <Text style={[styles.rowTitle, { color: colors.danger }]}>清空所有数据</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>
        {Platform.OS === 'ios'
          ? 'iOS 说明：系统限制后台执行，自动检查只在系统允许的时机发生，可能间隔较久；App 被上滑关掉后不再检查。打开 App 时一定会检查一次。'
          : `Android 说明：后台检查最短间隔 ${MIN_INTERVAL_MINUTES} 分钟，系统会按省电策略择机执行。`}
      </Text>
    </ScrollView>
  );
}

function Row({ title, subtitle, right }: {
  title: string; subtitle?: string; right?: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, paddingRight: spacing.sm }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

const Divider = () => <View style={styles.divider} />;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  groupTitle: {
    fontSize: 12, fontWeight: '700', color: colors.textDim,
    marginBottom: spacing.sm, marginTop: spacing.lg, marginLeft: spacing.xs,
  },
  group: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 54,
  },
  rowTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textDim, marginTop: 3, lineHeight: 18 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: spacing.lg,
  },
  badge: {
    fontSize: 12, fontWeight: '700',
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.sm, overflow: 'hidden',
  },
  badgeOk: { color: colors.primary, backgroundColor: colors.primaryDim },
  badgeWarn: { color: colors.warn, backgroundColor: colors.warnDim },
  chips: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.sm, backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.textDim, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  input: {
    marginTop: spacing.sm,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 13,
    color: colors.text,
  },
  footer: {
    fontSize: 11, color: colors.textFaint, lineHeight: 18,
    marginTop: spacing.lg, paddingHorizontal: spacing.xs,
  },
});
