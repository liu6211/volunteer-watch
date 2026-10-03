/**
 * 我的排班（底部导航栏直接进入）
 *
 * 和「更多 → 我的排班」是同一份数据，只是放到了一级入口。
 * 需要登录志愿云账号。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchGenericPage } from '../../core/account.mjs';
import { SEARCH_HOST } from '../../core/search.mjs';
import { useStore } from '../../lib/store';
import { colors, radius as R, spacing, themedStyles } from '../../lib/theme';
import { Backdrop, Glass, GlassButton, Icon, Tap } from '../../components/ui';
import { parseShifts, scheduleShiftReminders, cancelShiftReminders } from '../../lib/reminders';
import {
  shouldUseLiveActivity, startShiftActivity, endShiftActivity,
  hasRunningActivity, isLiveActivityAvailable,
} from '../../lib/liveActivity';

export default function PlanScreen() {
  const { state, accountSession, autoLogin, updateSettings } = useStore();
  const insets = useSafeAreaInsets();

  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  /** 提醒排布结果，显示在页面上让用户看得见 */
  const [reminderNote, setReminderNote] = useState('');
  /** 上岛状态提示 */
  const [liveNote, setLiveNote] = useState('');
  const [liveBusy, setLiveBusy] = useState(false);

  /** 排班列表（页面渲染与上岛都用它） */
  const shifts = useMemo(() => parseShifts(headers, rows), [headers, rows]);

  /**
   * 当前时间。
   * 不能在渲染期直接调 Date.now()（React Compiler 会报「渲染期调用非纯函数」），
   * 所以放进 effect 里取一次，shifts 变化时刷新。
   */
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    void Promise.resolve().then(() => setNowMs(Date.now()));
  }, [shifts]);

  /** 挑一条最该计时的排班：进行中的优先，否则最近一条未来的 */
  const targetShift = useMemo(() => {
    if (shifts.length === 0) return null;
    if (!nowMs) return shifts[0];
    const running = shifts.find(
      (s) => s.startAt.getTime() <= nowMs && (s.endAt ? s.endAt.getTime() > nowMs : true)
    );
    if (running) return running;
    return shifts
      .filter((s) => s.startAt.getTime() > nowMs)
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0] ?? shifts[0];
  }, [shifts, nowMs]);

  /**
   * 上岛：把当前排班的倒计时显示到锁屏 / 灵动岛。
   * 设置里关掉 liveActivityEnabled 时不做任何事（只走普通提醒）。
   */
  const onToggleLive = async () => {
    setLiveBusy(true);
    try {
      if (hasRunningActivity()) {
        await endShiftActivity();
        setLiveNote('已结束锁屏倒计时');
        return;
      }
      if (!targetShift) {
        setLiveNote('当前没有可计时的排班');
        return;
      }
      const r = await startShiftActivity(targetShift);
      setLiveNote(r.message);
    } catch (e) {
      setLiveNote(`上岛出错：${(e as Error).message}`);
    } finally {
      setLiveBusy(false);
    }
  };

  /** 拉到排班后顺手把提醒重排一遍（幂等：先清后建） */
  const syncReminders = useCallback(
    async (hdrs: string[], body: string[][], settings = state.settings) => {
      const shifts = parseShifts(hdrs, body);
      if (shifts.length === 0) {
        await cancelShiftReminders();
        setReminderNote(settings.shiftReminderEnabled ? '当前没有排班，已清掉旧提醒' : '');
        return;
      }
      try {
        const r = await scheduleShiftReminders(shifts, settings);
        setReminderNote(
          settings.shiftReminderEnabled
            ? `已为 ${shifts.length} 条排班安排 ${r.scheduled} 条提醒`
            : `检测到 ${shifts.length} 条排班（提醒未开启）`
        );
      } catch (e) {
        setReminderNote(`提醒安排失败：${(e as Error).message}`);
      }
    },
    [state.settings]
  );

  const load = useCallback(async () => {
    if (!state.account) return;
    setLoading(true);
    setError('');
    try {
      /*
       * 先主动重新登录一次。
       *
       * 志愿云的会话只有 30 分钟（PHPSESSID Max-Age=1800），
       * 过期后请求会被踢回登录页，fetchGenericPage 会抛「登录已过期」。
       * 别的页面（项目详情、搜索、账号页）都会先 autoLogin，
       * 只有排班页原来漏了 —— 结果放置半小时后再进来只会看到报错，
       * 点「重试」也还是失败，必须手动去登录页。
       */
      await autoLogin().catch(() => undefined);

      const t = await fetchGenericPage(accountSession(), SEARCH_HOST, '/app/user/plan.php');
      setHeaders(t.headers);
      setRows(t.rows);
      // 拿到排班就顺手重排提醒（幂等，先清后建）
      await syncReminders(t.headers, t.rows);
    } catch (e) {
      const msg = (e as Error).message;
      // 万一重登之后还是过期，再补一次，仍然不行就如实报错
      if (/过期|请登录|登录/.test(msg)) {
        const re = await autoLogin().catch(() => ({ ok: false }));
        if (re?.ok) {
          try {
            const t = await fetchGenericPage(accountSession(), SEARCH_HOST, '/app/user/plan.php');
            setHeaders(t.headers);
            setRows(t.rows);
            await syncReminders(t.headers, t.rows);
            return;
          } catch (e2) {
            setError((e2 as Error).message);
            return;
          }
        }
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [state.account, accountSession, autoLogin, syncReminders]);

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => { if (alive) void load(); });
    return () => { alive = false; };
  }, [load]);

  /* 未登录 */
  if (!state.account) {
    return (
      <View style={styles.screen}>
        <Backdrop />
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 56, paddingBottom: spacing.xxl },
          ]}
        >
          <Text style={styles.title}>我的排班</Text>
          <Glass corner={R.lg} style={styles.emptyCard}>
            <Icon name="calendar-outline" size={30} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>还没登录</Text>
            <Text style={styles.emptyText}>
              登录志愿云账号后，这里会显示你已经排好的服务岗位
            </Text>
            <GlassButton
              label="去登录"
              icon="log-in-outline"
              variant="primary"
              onPress={() => router.push('/login')}
              style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
            />
          </Glass>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Backdrop />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 56, paddingBottom: spacing.xxl },
        ]}
      >
        <Text style={styles.title}>我的排班</Text>

        {/* 提醒排布结果 —— 让用户看得见「到底排了几条提醒」 */}
        {reminderNote ? (
          <Glass corner={R.md} style={styles.noteCard}>
            <View style={styles.noteRow}>
              <Icon name="notifications-outline" size={15} color={colors.primary} />
              <Text style={styles.noteText}>{reminderNote}</Text>
            </View>
          </Glass>
        ) : null}

        {/* 上岛：把服务倒计时显示到锁屏 / 灵动岛 */}
        {state.settings.liveActivityEnabled ? (
          <Glass corner={R.md} style={styles.noteCard}>
            <View style={styles.noteRow}>
              <Icon name="phone-portrait-outline" size={15} color={colors.primary} />
              <Text style={styles.noteText}>
                {liveNote || '实时活动已就绪'}
              </Text>
            </View>
            {targetShift ? (
              <GlassButton
                label={hasRunningActivity() ? '结束锁屏倒计时' : `上岛计时：${targetShift.title}`}
                icon="timer-outline"
                variant="primary"
                loading={liveBusy}
                onPress={() => { void onToggleLive(); }}
                style={{ marginTop: spacing.md }}
              />
            ) : null}
          </Glass>
        ) : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>正在读取…</Text>
          </View>
        ) : null}

        {!loading && error ? (
          <Glass corner={R.md} style={styles.errorCard}>
            <View style={styles.errorRow}>
              <Icon name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
            <GlassButton
              label="重试" icon="refresh" variant="glass"
              onPress={() => { void load(); }}
              style={{ marginTop: spacing.md }}
            />
          </Glass>
        ) : null}

        {!loading && !error && rows.length === 0 ? (
          <Glass corner={R.lg} style={styles.emptyCard}>
            <Icon name="calendar-outline" size={30} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>暂时没有排班</Text>
            <Text style={styles.emptyText}>
              被团体安排岗位后，这里会显示开始/结束日期和排班内容
            </Text>
          </Glass>
        ) : null}

        {rows.map((cells, i) => (
          <Glass key={i} corner={R.md} style={styles.rowCard}>
            {cells.map((cell, j) => (
              <View key={j} style={styles.cellRow}>
                <Text style={styles.cellLabel}>{headers[j] || `字段${j + 1}`}</Text>
                <Text style={styles.cellValue}>{cell || '—'}</Text>
              </View>
            ))}
          </Glass>
        ))}

        {!loading ? (
          <Tap onPress={() => { void load(); }}>
            <View style={styles.refresh}>
              <Icon name="refresh" size={14} color={colors.textFaint} />
              <Text style={styles.refreshText}>刷新</Text>
            </View>
          </Tap>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: spacing.lg },

  title: { fontSize: 26, fontWeight: '800', color: colors.text, marginBottom: spacing.lg },

  loading: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  loadingText: { fontSize: 12, color: colors.textDim },

  errorCard: { marginBottom: spacing.md },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  errorText: { flex: 1, fontSize: 12.5, color: colors.danger, lineHeight: 18 },

  noteCard: { marginBottom: spacing.md },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  noteText: { flex: 1, fontSize: 12, color: colors.textDim, lineHeight: 17 },
  rowCard: { marginBottom: spacing.sm, gap: spacing.sm },
  cellRow: { flexDirection: 'row', gap: spacing.md },
  cellLabel: { width: 76, fontSize: 11.5, color: colors.textFaint },
  cellValue: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 18 },

  emptyCard: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  emptyText: { fontSize: 12, color: colors.textDim, textAlign: 'center', lineHeight: 18 },

  refresh: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: spacing.xl,
  },
  refreshText: { fontSize: 11.5, color: colors.textFaint },
}));
