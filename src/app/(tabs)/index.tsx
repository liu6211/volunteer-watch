/**
 * 团体列表页 —— 应用主界面
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Switch,
  Text, TouchableOpacity, View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { useStore, displayName, siteLabel } from '../../lib/store';
import { colors, radius, spacing, timeAgo } from '../../lib/theme';
import type { WatchItem } from '../../lib/types';

export default function TeamsScreen() {
  const { ready, state, checking, lastRunMessage, checkAll, setWatchEnabled, removeWatch } = useStore();

  // 从添加页返回时刷新一下（状态本身是全局的，这里主要为了重新渲染）
  const [, setTick] = useState(0);
  useFocusEffect(useCallback(() => { setTick((t) => t + 1); }, []));

  const watches = state.watches;
  /** 最近一次检查时间 = 所有监控项里最新的那个 */
  const lastCheckedAt = watches
    .map((w) => w.lastCheckedAt)
    .filter((t): t is string => !!t)
    .sort()
    .pop();

  const onDelete = (w: WatchItem) => {
    Alert.alert(
      '删除监控',
      `确定不再监控「${displayName(w)}」吗？已有的通知记录会保留。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: () => { void removeWatch(w.id); } },
      ]
    );
  };

  const renderItem = ({ item }: { item: WatchItem }) => {
    const latest = item.projects[0];
    return (
      <TouchableOpacity
        style={[styles.card, !item.enabled && styles.cardDisabled]}
        activeOpacity={0.7}
        onPress={() => router.push(`/team/${item.id}`)}
        onLongPress={() => onDelete(item)}
      >
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, paddingRight: spacing.sm }}>
            <Text style={styles.cardTitle} numberOfLines={1}>{displayName(item)}</Text>
            <Text style={styles.cardSub} numberOfLines={1}>
              {siteLabel(item.host)} · {item.projects.length} 个项目
              {item.alias ? ` · ${item.name}` : ''}
            </Text>
          </View>
          <Switch
            value={item.enabled}
            onValueChange={(v) => { void setWatchEnabled(item.id, v); }}
            trackColor={{ true: colors.primary, false: '#CFD4DA' }}
          />
        </View>

        {latest ? (
          <View style={styles.latestBox}>
            <Text style={styles.latestLabel}>最新项目</Text>
            <Text style={styles.latestName} numberOfLines={2}>{latest.name}</Text>
            <Text style={styles.latestDate}>
              {latest.date || '日期未知'}{latest.status ? ` · ${latest.status}` : ''}
            </Text>
          </View>
        ) : null}

        <View style={styles.cardFooter}>
          <Text style={styles.footerText} numberOfLines={1}>
            {item.lastResult || '尚未检查'}
          </Text>
          <Text style={styles.footerTime}>{timeAgo(item.lastCheckedAt)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const empty = (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>📋</Text>
      <Text style={styles.emptyTitle}>还没有监控任何团体</Text>
      <Text style={styles.emptyText}>
        点下面的按钮，把志愿云团体页的链接粘进来即可。{'\n'}
        例如：https://gz.zhiyuanyun.com/app/org/view.php?id=xxx
      </Text>
    </View>
  );

  return (
    <View style={styles.screen}>
      {/* 状态条：让「检查了没有、结果如何」一眼可见 */}
      <View style={[styles.statusBar, checking && styles.statusBarBusy]}>
        {checking ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text style={styles.statusIcon}>{lastRunMessage ? '✅' : 'ℹ️'}</Text>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.statusText, checking && { color: colors.primary }]}>
            {checking ? '正在检查…' : lastRunMessage || '还没检查过，下拉或点下方按钮'}
          </Text>
          {!checking && lastCheckedAt ? (
            <Text style={styles.statusTime}>上次检查：{timeAgo(lastCheckedAt)}</Text>
          ) : null}
        </View>
      </View>

      <FlatList
        data={watches}
        keyExtractor={(w) => w.id}
        renderItem={renderItem}
        contentContainerStyle={watches.length === 0 ? styles.listEmpty : styles.list}
        ListEmptyComponent={ready ? empty : null}
        /* iOS 上内容不满一屏时，默认不可回弹，下拉刷新的动画就出不来 */
        alwaysBounceVertical
        refreshControl={
          <RefreshControl
            refreshing={checking}
            onRefresh={() => { void checkAll(); }}
            tintColor={colors.primary}
            colors={[colors.primary]}
            title={checking ? '正在检查…' : '下拉即可检查'}
            titleColor={colors.textDim}
          />
        }
      />

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary]}
          onPress={() => { void checkAll(); }}
          disabled={checking || watches.length === 0}
        >
          {checking ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={styles.btnSecondaryText}>立即检查</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary]}
          onPress={() => router.push('/(tabs)/add')}
        >
          <Text style={styles.btnPrimaryText}>+ 添加团体</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  statusBarBusy: { backgroundColor: colors.primaryDim },
  statusIcon: { fontSize: 14 },
  statusText: { fontSize: 13, fontWeight: '600', color: colors.text },
  statusTime: { fontSize: 11, color: colors.textDim, marginTop: 2 },
  list: { padding: spacing.lg, paddingBottom: spacing.xl },
  listEmpty: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardDisabled: { opacity: 0.55 },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  cardSub: { fontSize: 12, color: colors.textDim, marginTop: 2 },
  latestBox: {
    marginTop: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  latestLabel: { fontSize: 11, color: colors.textFaint, marginBottom: 2 },
  latestName: { fontSize: 14, color: colors.text, fontWeight: '600' },
  latestDate: { fontSize: 11, color: colors.textDim, marginTop: 3 },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  footerText: { flex: 1, fontSize: 11, color: colors.textDim, paddingRight: spacing.sm },
  footerTime: { fontSize: 11, color: colors.textFaint },
  empty: { alignItems: 'center' },
  emptyEmoji: { fontSize: 44, marginBottom: spacing.md },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  emptyText: { fontSize: 13, color: colors.textDim, textAlign: 'center', lineHeight: 20 },
  actions: {
    flexDirection: 'row',
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  btn: {
    flex: 1,
    height: 46,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnSecondary: { backgroundColor: colors.primaryDim },
  btnSecondaryText: { color: colors.primary, fontSize: 15, fontWeight: '700' },
});
