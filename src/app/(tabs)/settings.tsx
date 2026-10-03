/**
 * 设置页 —— 液态玻璃风格
 */
import React, { useState } from 'react';
import {
  Alert, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '../../lib/store';
import { colors, radius as R, spacing } from '../../lib/theme';
import {
  requestNotificationPermission, hasNotificationPermission, dismissAll,
  presentLocalNotification,
} from '../../lib/notifications';
import { getBackgroundStatus, MIN_INTERVAL_MINUTES } from '../../lib/backgroundTask';
import type { BackgroundStatus } from '../../lib/backgroundTask';
import {
  PROVIDER_LABELS, mailConfigFromSettings, validateMailConfig, sendTestMail,
} from '../../lib/email';
import * as Device from 'expo-device';
import {
  Badge, Divider, Glass, GlassButton, GroupTitle, Icon, Tap, type IconName,
} from '../../components/ui';

/** 可选检查间隔 */
const INTERVALS = [
  { label: '15 分钟', value: 15 },
  { label: '30 分钟', value: 30 },
  { label: '1 小时', value: 60 },
  { label: '3 小时', value: 180 },
  { label: '6 小时', value: 360 },
  { label: '12 小时', value: 720 },
];

/** 一行设置项 */
function Row({
  icon, title, subtitle, right, onPress, tone = 'normal',
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  tone?: 'normal' | 'danger';
}) {
  const content = (
    <View style={styles.row}>
      <View style={[styles.iconWrap, tone === 'danger' && styles.iconWrapDanger]}>
        <Icon
          name={icon}
          size={16}
          color={tone === 'danger' ? colors.danger : colors.primary}
        />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, tone === 'danger' && { color: colors.danger }]}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
  if (!onPress) return content;
  return <Tap onPress={onPress}>{content}</Tap>;
}

export default function SettingsScreen() {
  const { state, updateSettings, resetAll, bg, refreshBgStatus } = useStore();
  const s = state.settings;
  const insets = useSafeAreaInsets();

  const [perm, setPerm] = useState<boolean | null>(null);

  /* 文本框用本地 state，失焦时才写回设置，避免每敲一个字就存一次 */
  const [emailTo, setEmailTo] = useState(s.emailTo);
  const [relayUrl, setRelayUrl] = useState(s.emailRelayUrl);
  const [apiKey, setApiKey] = useState(s.emailApiKey);
  const [fromEmail, setFromEmail] = useState(s.emailFrom);

  const [sendingMail, setSendingMail] = useState(false);
  const [mailResultText, setMailResultText] = useState('点这里发一封，立刻知道配置对不对');

  const mailCheck = validateMailConfig(mailConfigFromSettings(s));

  React.useEffect(() => {
    void (async () => {
      setPerm(await hasNotificationPermission());
      await refreshBgStatus();
    })();
  }, [refreshBgStatus]);

  const bgStatusText = (): string => {
    if (!s.backgroundCheckEnabled) return '已关闭';
    if (bg.availability === 'restricted') {
      return Platform.OS === 'web' ? '网页版不支持' : '需装正式版本的包（Expo Go 不支持）';
    }
    if (bg.registered) return '已开启，由系统择机执行';
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

  const onTestNotification = async () => {
    const ok = await requestNotificationPermission();
    setPerm(ok);
    if (!ok) {
      Alert.alert('没有通知权限', '请先授权通知，否则收不到提醒。');
      return;
    }
    await presentLocalNotification(
      '测试通知',
      '如果你看到这条，说明通知功能正常，发现新项目时也会这样提醒你。',
      { test: true }
    );
  };

  const onSendTestMail = async () => {
    const cfg = mailConfigFromSettings(s);
    const check = validateMailConfig(cfg);
    if (!check.ok) {
      setMailResultText(`失败：${check.reason}`);
      return;
    }
    if (!s.emailTo.trim()) {
      setMailResultText('失败：还没填收件邮箱');
      return;
    }
    setSendingMail(true);
    setMailResultText('正在发送…');
    try {
      const r = await sendTestMail(cfg, s.emailTo.trim());
      setMailResultText(
        r.ok ? '已发出，去收件箱看看（也看下垃圾邮件）' : `失败：${r.reason}`
      );
    } catch (e) {
      setMailResultText(`失败：${(e as Error).message}`);
    } finally {
      setSendingMail(false);
    }
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
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 56, paddingBottom: 170 },
      ]}
    >
      <Text style={styles.pageTitle}>设置</Text>

      {/* ------------------------------------------------ 通知 */}
      <GroupTitle>通知</GroupTitle>
      <Glass corner={R.lg} padded={false}>
        <Row
          icon="notifications-outline"
          title="新项目通知"
          subtitle="发现新项目时弹手机通知"
          right={
            <Switch
              value={s.notificationsEnabled}
              onValueChange={(v) => { void updateSettings({ notificationsEnabled: v }); }}
              trackColor={{ true: colors.primary, false: colors.track }}
            />
          }
        />
        <Divider inset={64} />
        <Row
          icon="shield-checkmark-outline"
          title="通知权限"
          subtitle={perm === null ? '检测中…' : perm ? '已授权' : '未授权，点这里申请'}
          onPress={() => { void onAskPermission(); }}
          right={<Badge text={perm ? '正常' : '去开启'} tone={perm ? 'primary' : 'warn'} />}
        />
        <Divider inset={64} />
        <Row
          icon="paper-plane-outline"
          title="发送测试通知"
          subtitle="立刻弹一条，确认通知能不能收到"
          onPress={() => { void onTestNotification(); }}
          right={<Badge text="测试" tone="primary" />}
        />
        <Divider inset={64} />
        <Row
          icon="close-circle-outline"
          title="清掉通知栏里的旧提醒"
          onPress={() => { void dismissAll(); }}
        />
      </Glass>

      {/* ------------------------------------------------ 自动检查 */}
      <GroupTitle>自动检查</GroupTitle>
      <Glass corner={R.lg} padded={false}>
        <Row
          icon="sync-outline"
          title="自动检查"
          subtitle="打开 App 时按间隔自动抓取"
          right={
            <Switch
              value={s.backgroundCheckEnabled}
              onValueChange={(v) => { void updateSettings({ backgroundCheckEnabled: v }); }}
              trackColor={{ true: colors.primary, false: colors.track }}
            />
          }
        />
        <Divider inset={64} />
        <View style={styles.row}>
          <View style={styles.iconWrap}>
            <Icon name="time-outline" size={16} color={colors.primary} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>检查间隔</Text>
            <Text style={styles.rowSub}>打开时按此间隔检查；切回前台也会立刻查一次</Text>
          </View>
        </View>
        <View style={styles.chips}>
          {INTERVALS.map((it) => (
            <Tap
              key={it.value}
              onPress={() => { void updateSettings({ intervalMinutes: it.value }); }}
            >
              <View style={[styles.chip, s.intervalMinutes === it.value && styles.chipActive]}>
                <Text style={[
                  styles.chipText,
                  s.intervalMinutes === it.value && styles.chipTextActive,
                ]}>
                  {it.label}
                </Text>
              </View>
            </Tap>
          ))}
        </View>
        <Divider inset={64} />
        <Row
          icon="moon-outline"
          title="关掉 App 后的后台检查"
          subtitle={bgStatusText()}
        />
      </Glass>

      {/* ------------------------------------------------ 邮箱通知 */}
      <GroupTitle>邮箱通知</GroupTitle>
      <Glass corner={R.lg} padded={false}>
        <Row
          icon="book-outline"
          title="配置教程"
          subtitle="QQ 授权码怎么拿、三种发送方式怎么选"
          onPress={() => router.push('/help-email')}
          right={<Icon name="chevron-forward" size={16} color={colors.textFaint} />}
        />
        <Divider inset={64} />
        <Row
          icon="mail-outline"
          title="发现新项目时发邮件"
          subtitle={mailCheck.ok ? `已配置：${PROVIDER_LABELS[s.emailProvider].name}` : mailCheck.reason}
          right={
            <Switch
              value={s.emailEnabled}
              onValueChange={(v) => { void updateSettings({ emailEnabled: v }); }}
              trackColor={{ true: colors.primary, false: colors.track }}
            />
          }
        />
        <Divider inset={64} />
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>收件邮箱</Text>
          <TextInput
            style={styles.input}
            value={emailTo}
            onChangeText={setEmailTo}
            onBlur={() => { void updateSettings({ emailTo: emailTo.trim() }); }}
            placeholder="180957824@qq.com"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>发送通道</Text>
          <Text style={styles.fieldHint}>
            {s.emailProvider === 'none'
              ? '先选一个，再看教程对应章节'
              : PROVIDER_LABELS[s.emailProvider].hint}
          </Text>
        </View>
        <View style={styles.chips}>
          {(['brevo', 'resend', 'relay'] as const).map((p) => (
            <Tap key={p} onPress={() => { void updateSettings({ emailProvider: p }); }}>
              <View style={[styles.chip, s.emailProvider === p && styles.chipActive]}>
                <Text style={[
                  styles.chipText,
                  s.emailProvider === p && styles.chipTextActive,
                ]}>
                  {p === 'brevo' ? 'Brevo' : p === 'resend' ? 'Resend' : '自建中转'}
                </Text>
              </View>
            </Tap>
          ))}
        </View>

        {s.emailProvider === 'relay' ? (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>中转接口地址</Text>
            <TextInput
              style={styles.input}
              value={relayUrl}
              onChangeText={setRelayUrl}
              onBlur={() => { void updateSettings({ emailRelayUrl: relayUrl.trim() }); }}
              placeholder="http://192.168.0.100:3000/"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
            />
            <Text style={styles.fieldHint}>仓库里附了现成脚本：tools/qq-mail-relay</Text>
          </View>
        ) : null}

        {s.emailProvider === 'brevo' || s.emailProvider === 'resend' ? (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>API Key</Text>
            <TextInput
              style={styles.input}
              value={apiKey}
              onChangeText={setApiKey}
              onBlur={() => { void updateSettings({ emailApiKey: apiKey.trim() }); }}
              placeholder={s.emailProvider === 'resend' ? 're_xxxxxxxx' : 'xkeysib-xxxxxxxx'}
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              secureTextEntry
            />
          </View>
        ) : null}

        {s.emailProvider === 'brevo' ? (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>发件人邮箱（需已验证）</Text>
            <TextInput
              style={styles.input}
              value={fromEmail}
              onChangeText={setFromEmail}
              onBlur={() => { void updateSettings({ emailFrom: fromEmail.trim() }); }}
              placeholder="180957824@qq.com"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Text style={styles.fieldHint}>要在 Brevo 后台把它验证为发件人，否则发不出去</Text>
          </View>
        ) : null}

        <View style={styles.testWrap}>
          <GlassButton
            label={sendingMail ? '正在发送…' : '发送测试邮件'}
            icon={sendingMail ? undefined : 'send-outline'}
            loading={sendingMail}
            variant="glass"
            onPress={() => { void onSendTestMail(); }}
          />
          <Text style={styles.mailResult}>{mailResultText}</Text>
        </View>
      </Glass>

      {/* ------------------------------------------------ 关于 */}
      <GroupTitle>关于</GroupTitle>
      <Glass corner={R.lg} padded={false}>
        <Row
          icon="phone-portrait-outline"
          title="运行平台"
          subtitle={`${Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : Platform.OS} · ${Device.isDevice ? '真机' : '预览环境'}`}
        />
        <Divider inset={64} />
        <Row
          icon="code-slash-outline"
          title="检查方式"
          subtitle="直接读团体页 HTML 里「发起的项目」表格，不需要登录，也不用模拟点击"
        />
        <Divider inset={64} />
        <Row
          icon="trash-outline"
          title="清空所有数据"
          subtitle="删除监控列表、通知记录和设置"
          tone="danger"
          onPress={onReset}
        />
      </Glass>

      <Text style={styles.footer}>
        {Platform.OS === 'ios'
          ? `iOS 说明：系统限制后台执行，自动检查只在系统允许的时机发生；App 被上滑关掉后不再检查。打开 App 时一定会检查。`
          : `Android 说明：后台检查最短间隔 ${MIN_INTERVAL_MINUTES} 分钟，系统会按省电策略择机执行。`}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: spacing.lg },
  pageTitle: {
    fontSize: 26, fontWeight: '800', color: colors.text,
    letterSpacing: 0.2, marginBottom: spacing.sm,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 58,
    gap: spacing.md,
  },
  iconWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.primaryDim,
    alignItems: 'center', justifyContent: 'center',
  },
  iconWrapDanger: { backgroundColor: colors.dangerDim },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  rowSub: { fontSize: 11.5, color: colors.textDim, marginTop: 3, lineHeight: 17 },

  chips: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: R.pill,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.glassBorder,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.textDim, fontWeight: '700' },
  chipTextActive: { color: colors.textOnAccent },

  fieldRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  fieldHint: { fontSize: 11, color: colors.textFaint, lineHeight: 16 },
  input: {
    backgroundColor: colors.field,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.glassBorder,
    borderRadius: R.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 13,
    color: colors.text,
  },

  testWrap: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  mailResult: { fontSize: 11.5, color: colors.textDim, lineHeight: 17 },

  footer: {
    fontSize: 11, color: colors.textFaint, lineHeight: 18,
    marginTop: spacing.lg, paddingHorizontal: spacing.xs,
  },
});
