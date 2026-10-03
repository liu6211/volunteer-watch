/**
 * 设置页 —— 液态玻璃风格
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '../../lib/store';
import { colors, radius as R, spacing } from '../../lib/theme';
import { themedStyles } from '../../lib/theme';
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
import { countShiftReminders, cancelShiftReminders } from '../../lib/reminders';
import {
  Backdrop, Badge, Divider, Glass, GlassButton, GroupTitle, Icon, Tap, type IconName,
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
  const { state, updateSettings, resetAll, bg, refreshBgStatus, logoutAccount } = useStore();

  /** 退出登录（二次确认，避免误点） */
  const onLogoutPress = () => {
    Alert.alert('退出登录', '退出后将看不到「我的项目」等数据，随时可以再登回来。', [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: () => { void logoutAccount(); } },
    ]);
  };
  const s = state.settings;
  const insets = useSafeAreaInsets();

  const [perm, setPerm] = useState<boolean | null>(null);

  /* ------------------------------------------------ 排班提醒 */
  const [reminderCount, setReminderCount] = useState<number | null>(null);

  const refreshReminderCount = useCallback(async () => {
    try {
      setReminderCount(await countShiftReminders());
    } catch {
      setReminderCount(null);
    }
  }, []);

  // 用 Promise.resolve().then 延后到下一个微任务：
  // 直接在 effect 里调用会触发「synchronously setState」告警（本项目统一这样写）
  useEffect(() => {
    void Promise.resolve().then(() => refreshReminderCount());
  }, [refreshReminderCount, s.shiftReminderEnabled]);

  /**
   * 重新排一遍提醒。
   * 排班的正文要现拉，这里不重复请求站点，只清空并提示去排班页刷新 ——
   * 排班页每次进入都会自动重排，所以那里才是权威入口。
   */
  const onReschedule = () => {
    Alert.alert(
      '重新安排提醒',
      '提醒会在你打开「排班」页时按最新排班自动重排。\n\n要现在清空所有已排的提醒吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清空并重排',
          onPress: async () => {
            await cancelShiftReminders();
            await refreshReminderCount();
            Alert.alert('已清空', '打开「排班」页即会按最新排班重新安排。');
          },
        },
      ]
    );
  };

  /* 文本框用本地 state，失焦时才写回设置，避免每敲一个字就存一次 */
  const [emailTo, setEmailTo] = useState(s.emailTo);
  const [mailUser, setMailUser] = useState(s.emailUser);
  const [mailPass, setMailPass] = useState(s.emailPass);

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
    if (bg.lastError) return `注册失败：${bg.lastError}`;
    if (bg.registered) {
      /*
       * 说明真实情况，别让用户以为「到点就一定会响」。
       * iOS / Android 都由系统按省电策略择机执行，不保证准点。
       *
       * 这里显示【绝对时间】而不是「X 分钟前」：
       * 算相对时间要在渲染里调 Date.now()，会被 React 判为渲染中调用非纯函数。
       */
      if (bg.lastRunAt) {
        const d = new Date(bg.lastRunAt);
        const pad = (n: number) => String(n).padStart(2, '0');
        const when = `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        return `已注册 · 上次后台检查：${when}`;
      }
      return '已注册，但还没跑过（系统择机执行，可能较久）';
    }
    if (bg.availability === 'restricted') {
      return Platform.OS === 'web' ? '网页版不支持' : '系统限制了后台任务';
    }
    if (bg.availability === 'unknown') return '状态未知（系统没给出明确答复）';
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
      <View style={styles.screen}>
        <Backdrop />
      <ScrollView
            contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 56, paddingBottom: 170 },
      ]}
    >
      <Text style={styles.pageTitle}>设置</Text>

      {/* ------------------------------------------------ 账号（最上方） */}
      <GroupTitle>志愿云账号</GroupTitle>
      <Glass corner={R.lg} padded={false}>
        {state.account ? (
          <>
            <Row
              icon="person-circle-outline"
              title={state.account.username}
              subtitle={`已登录 · ${new Date(state.account.loginAt).toLocaleDateString()}`}
              onPress={() => router.push('/account')}
              right={<Badge text="我的数据" tone="primary" />}
            />
            <Divider inset={64} />
            <Row
              icon="albums-outline"
              title="我的项目 / 我的团体 / 服务时长"
              subtitle="点这里查看"
              onPress={() => router.push('/account')}
            />
            <Divider inset={64} />
            <Row
              icon="log-out-outline"
              title="退出登录"
              subtitle="只清除本机保存的登录状态"
              onPress={onLogoutPress}
            />
          </>
        ) : (
          <Row
            icon="log-in-outline"
            title="未登录"
            subtitle="登录后可查看我的项目、我的团体、服务时长"
            onPress={() => router.push('/login')}
            right={<Badge text="去登录" tone="primary" />}
          />
        )}
      </Glass>

      {/* ------------------------------------------------ 外观 */}
      <GroupTitle>外观</GroupTitle>
      <Glass corner={R.lg} padded={false}>
        <Row
          icon="contrast-outline"
          title="界面主题"
          subtitle={
            s.themeMode === 'system'
              ? '跟随系统（系统切深色，这里也变）'
              : s.themeMode === 'dark'
                ? '始终深色'
                : '始终浅色'
          }
          right={
            <Icon
              name={s.themeMode === 'dark' ? 'moon' : s.themeMode === 'light' ? 'sunny' : 'phone-portrait-outline'}
              size={18}
              color={colors.primary}
            />
          }
        />
        <View style={styles.chips}>
          {(['system', 'light', 'dark'] as const).map((m) => (
            <Tap key={m} onPress={() => { void updateSettings({ themeMode: m }); }}>
              <View style={[styles.chip, s.themeMode === m && styles.chipActive]}>
                <Text style={[styles.chipText, s.themeMode === m && styles.chipTextActive]}>
                  {m === 'system' ? '跟随系统' : m === 'light' ? '浅色' : '深色'}
                </Text>
              </View>
            </Tap>
          ))}
        </View>
      </Glass>

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

      {/* ------------------------------------------------ 排班提醒 */}
      <GroupTitle>排班提醒</GroupTitle>
      <Glass corner={R.lg} padded={false}>
        <Row
          icon="alarm-outline"
          title="服务提醒"
          subtitle="按「我的排班」的开始日期自动定时提醒（App 关掉也会响）"
          right={
            <Switch
              value={s.shiftReminderEnabled}
              onValueChange={(v) => { void updateSettings({ shiftReminderEnabled: v }); }}
              trackColor={{ true: colors.primary, false: colors.track }}
            />
          }
        />
        <Divider inset={64} />
        <Row
          icon="calendar-outline"
          title="提前多久提醒"
          subtitle={s.shiftReminderDaysAhead > 0
            ? `服务前 ${s.shiftReminderDaysAhead} 天的晚上 20:00`
            : '当天提醒'}
          right={
            <View style={styles.opts}>
              {[0, 1, 2, 3].map((d) => (
                <Tap key={d} onPress={() => { void updateSettings({ shiftReminderDaysAhead: d }); }}>
                  <View style={[styles.opt, s.shiftReminderDaysAhead === d && styles.optOn]}>
                    <Text style={[styles.optText, s.shiftReminderDaysAhead === d && styles.optTextOn]}>
                      {d === 0 ? '当天' : `${d} 天`}
                    </Text>
                  </View>
                </Tap>
              ))}
            </View>
          }
        />
        {s.shiftReminderDaysAhead === 0 ? (
          <>
            <Divider inset={64} />
            <Row
              icon="time-outline"
              title="当天几点提醒"
              subtitle={`当天 ${s.shiftReminderHour}:00 提醒（排班带具体时间时改为开始前 1 小时）`}
              right={
                <View style={styles.opts}>
                  {[6, 7, 8, 9].map((h) => (
                    <Tap key={h} onPress={() => { void updateSettings({ shiftReminderHour: h }); }}>
                      <View style={[styles.opt, s.shiftReminderHour === h && styles.optOn]}>
                        <Text style={[styles.optText, s.shiftReminderHour === h && styles.optTextOn]}>
                          {h}点
                        </Text>
                      </View>
                    </Tap>
                  ))}
                </View>
              }
            />
          </>
        ) : null}
        <Divider inset={64} />
        <Row
          icon="notifications-circle-outline"
          title="已排的提醒"
          subtitle="点这里按当前排班重新排一遍"
          onPress={() => { void onReschedule(); }}
          right={<Badge text={reminderCount === null ? '…' : `${reminderCount} 条`} tone="neutral" />}
        />
      </Glass>

      {/* ------------------------------------------------ iOS 实时活动 */}
      {Platform.OS === 'ios' ? (
        <>
          <GroupTitle>iOS 实时活动</GroupTitle>
          <Glass corner={R.lg} padded={false}>
            <Row
              icon="phone-portrait-outline"
              title="上岛（灵动岛 / 锁屏倒计时）"
              subtitle="服务期间在锁屏和灵动岛显示剩余时间。iOS 独占，Expo Go 里不生效"
              right={
                <Switch
                  value={s.liveActivityEnabled}
                  onValueChange={(v) => { void updateSettings({ liveActivityEnabled: v }); }}
                  trackColor={{ true: colors.primary, false: colors.track }}
                />
              }
            />
            <Divider inset={64} />
            <Text style={styles.hint}>
              实时活动用官方 expo-widgets 实现（无需原生代码）。
              它只在 iOS 生效，且【Expo Go 里一定不行】——
              必须用 development build 或正式包，重新安装后才看得到。
              关掉这个开关不影响服务提醒，提醒走的是普通通知。
            </Text>
          </Glass>
        </>
      ) : null}

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

        {/* 发信邮箱（自己的 QQ 邮箱） */}
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>发信邮箱</Text>
          <TextInput
            style={styles.input}
            value={mailUser}
            onChangeText={setMailUser}
            onBlur={() => {
              const v = mailUser.trim();
              void updateSettings({ emailUser: v, emailProvider: v ? 'smtp' : 'none' });
            }}
            placeholder="you@qq.com"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Text style={styles.fieldHint}>
            用你自己的邮箱发信，不需要任何服务器
          </Text>
        </View>

        {/* 授权码 */}
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>邮箱授权码</Text>
          <TextInput
            style={styles.input}
            value={mailPass}
            onChangeText={setMailPass}
            onBlur={() => { void updateSettings({ emailPass: mailPass.trim() }); }}
            placeholder="16 位授权码（不是 QQ 密码）"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            secureTextEntry
          />
          <Text style={styles.fieldHint}>
            QQ 邮箱 → 设置 → 账号 → 开启 SMTP 服务，会得到授权码
          </Text>
        </View>

        {/* 收件邮箱 */}
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>收件邮箱</Text>
          <TextInput
            style={styles.input}
            value={emailTo}
            onChangeText={setEmailTo}
            onBlur={() => { void updateSettings({ emailTo: emailTo.trim() }); }}
            placeholder="不填就发给自己"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>

        {/* Expo Go 里发不了，这里明确说清楚免得用户白折腾 */}
        {!mailCheck.ok && /Expo Go/.test(mailCheck.reason || '') ? (
          <View style={styles.mailWarn}>
            <Icon name="information-circle-outline" size={15} color={colors.warn} />
            <Text style={styles.mailWarnText}>
              发邮件需要 socket 能力，Expo Go 里没有。{'\n'}
              配置会保存下来，装上正式版 App 后自动生效。
            </Text>
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

      <Row
        icon="book-outline"
        title="邮箱通知怎么配"
        subtitle="授权码获取步骤、常见报错排查"
        onPress={() => router.push('/help-email')}
      />

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
 </View>
     );
}

const styles = themedStyles(() => StyleSheet.create({
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
    backgroundColor: colors.field,
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
  mailWarn: {
    flexDirection: 'row', gap: 6, marginHorizontal: spacing.lg,
    marginTop: spacing.md, padding: spacing.md,
    backgroundColor: colors.warnDim, borderRadius: R.sm,
  },
  mailWarnText: { flex: 1, fontSize: 11.5, color: colors.warn, lineHeight: 17 },
  mailResult: { fontSize: 11.5, color: colors.textDim, lineHeight: 17 },

  footer: {
    fontSize: 11, color: colors.textFaint, lineHeight: 18,
    marginTop: spacing.lg, paddingHorizontal: spacing.xs,
  },

  /* 排班提醒的“提前几天 / 几点”选择器 */
  opts: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  opt: {
    paddingHorizontal: spacing.md, paddingVertical: 5,
    borderRadius: R.pill, backgroundColor: colors.field,
    borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.glassBorder,
  },
  optOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  optText: { fontSize: 11.5, fontWeight: '700', color: colors.textDim },
  optTextOn: { color: colors.textOnAccent },

  /* 分组内的说明文字 */
  hint: {
    fontSize: 11.5, color: colors.textFaint, lineHeight: 18,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
}));
