/**
 * 我的排班（底部导航栏直接进入）
 *
 * 和「更多 → 我的排班」是同一份数据，只是放到了一级入口。
 * 需要登录志愿云账号。
 */
import React, { useCallback, useEffect, useState } from 'react';
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

export default function PlanScreen() {
  const { state, accountSession } = useStore();
  const insets = useSafeAreaInsets();

  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!state.account) return;
    setLoading(true);
    setError('');
    try {
      const t = await fetchGenericPage(accountSession(), SEARCH_HOST, '/app/user/plan.php');
      setHeaders(t.headers);
      setRows(t.rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [state.account, accountSession]);

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
