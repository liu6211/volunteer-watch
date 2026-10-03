/**
 * 团体列表页 —— 应用主界面
 * 液态玻璃风格：渐变背景 + 玻璃卡片 + 扁平图标
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet,
  Switch, Text, View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore, displayName, siteLabel } from '../../lib/store';
import { colors, radius as R, spacing, timeAgo, glassShadow } from '../../lib/theme';
import { themedStyles } from '../../lib/theme';
import type { WatchItem } from '../../lib/types';
import { Glass, GlassButton, Icon, Tap } from '../../components/ui';

export default function TeamsScreen() {
  const { ready, state, checking, lastRunMessage, checkAll, setWatchEnabled, removeWatch } =
    useStore();

  const insets = useSafeAreaInsets();

  // 从详情页返回时刷新一下
  const [, setTick] = useState(0);
  useFocusEffect(useCallback(() => { setTick((t) => t + 1); }, []));

  const watches = state.watches;

  /** 最近一次检查时间 = 所有监控项里最新的那个 */
  const lastCheckedAt = watches
    .map((w) => w.lastCheckedAt)
    .filter((t): t is string => !!t)
    .sort()
    .pop();

  /**
   * 顶部状态文案。
   * lastRunMessage 只存在内存里，App 一重载就没了；lastResult 是持久化的。
   * 内存为空时回退到「最近检查过的那个团体」的结果，
   * 否则会出现「卡片有结果，顶部却说从未检查过」的矛盾。
   */
  const mostRecentResult = watches
    .filter((w) => w.lastCheckedAt && w.lastResult)
    .sort((a, b) => (a.lastCheckedAt! < b.lastCheckedAt! ? 1 : -1))[0]?.lastResult;

  const statusText = checking
    ? '正在检查…'
    : lastRunMessage || mostRecentResult || '还没检查过，点下方按钮检查';

  const intervalLabel = (m: number) => (m % 60 === 0 ? `${m / 60} 小时` : `${m} 分钟`);

  const autoCheckHint =
    state.settings.backgroundCheckEnabled && watches.some((w) => w.enabled)
      ? ` · 每 ${intervalLabel(state.settings.intervalMinutes)}自动检查`
      : ' · 自动检查已关闭';

  const onDelete = (w: WatchItem) => {
    Alert.alert(
      '删除监控',
      `确定不再监控「${displayName(w)}」吗？已有的通知记录会保留。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: () => { void removeWatch(w.key); } },
      ]
    );
  };

  const renderItem = ({ item }: { item: WatchItem }) => {
    const latest = item.projects[0];
    return (
      <Tap
        onPress={() => router.push(`/team/${item.key}`)}
        onLongPress={() => onDelete(item)}
        style={styles.cardWrap}
      >
        <Glass corner={R.lg} style={item.enabled ? undefined : styles.cardOff}>
          <View style={styles.cardHead}>
            <View style={styles.cardHeadText}>
              <Text style={styles.cardTitle} numberOfLines={1}>{displayName(item)}</Text>
              <View style={styles.metaRow}>
                <Icon name="pricetag-outline" size={12} color={colors.textFaint} />
                <Text style={styles.cardSub} numberOfLines={1}>
                  {siteLabel(item.host)} · {item.projects.length} 个项目
                </Text>
              </View>
            </View>
            <Switch
              value={item.enabled}
              onValueChange={(v) => { void setWatchEnabled(item.key, v); }}
              trackColor={{ true: colors.primary, false: colors.track }}
            />
          </View>

          {latest ? (
            <View style={styles.latestBox}>
              <View style={styles.latestHead}>
                <Icon name="sparkles-outline" size={12} color={colors.primary} />
                <Text style={styles.latestLabel}>最新项目</Text>
              </View>
              <Text style={styles.latestName} numberOfLines={2}>{latest.name}</Text>
              <Text style={styles.latestDate}>
                {latest.date || '日期未知'}{latest.status ? ` · ${latest.status}` : ''}
              </Text>
            </View>
          ) : null}

          <View style={styles.cardFoot}>
            <Icon
              name={item.lastResult?.startsWith('检查失败') ? 'alert-circle-outline' : 'checkmark-circle-outline'}
              size={13}
              color={item.lastResult?.startsWith('检查失败') ? colors.warn : colors.textFaint}
            />
            <Text style={styles.footText} numberOfLines={1}>
              {item.lastResult || '尚未检查'}
            </Text>
            <Text style={styles.footTime}>{timeAgo(item.lastCheckedAt)}</Text>
          </View>
        </Glass>
      </Tap>
    );
  };

  const empty = (
    <Glass corner={R.xl} style={styles.emptyCard}>
      <View style={styles.emptyIcon}>
        <Icon name="albums-outline" size={30} color={colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>还没有监控任何团体</Text>
      <Text style={styles.emptyText}>
        点下面的按钮，把志愿云团体页的链接粘进来即可
      </Text>
      <Text style={styles.emptyHint}>
        gz.zhiyuanyun.com/app/org/view.php?id=…
      </Text>
    </Glass>
  );

  return (
    <View style={styles.screen}>
      <FlatList
        data={watches}
        keyExtractor={(w) => w.key}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.list,
          { paddingTop: insets.top + 56, paddingBottom: spacing.xl },
        ]}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.pageTitle}>监控的团体</Text>
            <Glass corner={R.md} style={styles.statusCard} intensity={40}>
              <View style={styles.statusRow}>
                {checking ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Icon
                    name={(lastRunMessage || mostRecentResult) ? 'checkmark-circle' : 'information-circle'}
                    size={18}
                    color={(lastRunMessage || mostRecentResult) ? colors.primary : colors.info}
                  />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.statusText}>{statusText}</Text>
                  {!checking ? (
                    <Text style={styles.statusTime}>
                      {lastCheckedAt ? `上次检查：${timeAgo(lastCheckedAt)}` : '还没有检查记录'}
                      {autoCheckHint}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Glass>
          </View>
        }
        ListEmptyComponent={ready ? empty : null}
        alwaysBounceVertical
        refreshControl={
          <RefreshControl
            refreshing={checking}
            onRefresh={() => { void checkAll(); }}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressViewOffset={insets.top + 40}
          />
        }
      />

      {/* 底部操作条：走正常文档流，自动贴在标签栏正上方，
          比绝对定位更稳（不会因为不同机型安全区算出奇怪的位置） */}
      <View style={styles.actions}>
        <GlassButton
          label={checking ? '' : '立即检查'}
          icon={checking ? undefined : 'refresh'}
          loading={checking}
          variant="glass"
          onPress={() => { void checkAll(); }}
          disabled={watches.length === 0}
          style={styles.actionBtn}
        />
        <GlassButton
          label="添加团体"
          icon="add"
          variant="primary"
          onPress={() => router.push('/add')}
          style={styles.actionBtn}
        />
      </View>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },

  list: { paddingHorizontal: spacing.lg },

  header: { marginBottom: spacing.md },
  pageTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.md,
    letterSpacing: 0.2,
  },
  statusCard: { width: '100%' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusText: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  statusTime: { fontSize: 11.5, color: colors.textDim, marginTop: 3 },

  cardWrap: { marginBottom: spacing.md, borderRadius: R.lg },
  cardOff: { opacity: 0.55 },
  cardHead: { flexDirection: 'row', alignItems: 'center' },
  cardHeadText: { flex: 1, paddingRight: spacing.sm },
  cardTitle: { fontSize: 16.5, fontWeight: '800', color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  cardSub: { fontSize: 11.5, color: colors.textDim },

  latestBox: {
    marginTop: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderRadius: R.sm,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  latestHead: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 },
  latestLabel: { fontSize: 10.5, color: colors.textFaint, fontWeight: '600' },
  latestName: { fontSize: 14, color: colors.text, fontWeight: '700', lineHeight: 20 },
  latestDate: { fontSize: 11, color: colors.textDim, marginTop: 4 },

  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: spacing.md,
  },
  footText: { flex: 1, fontSize: 11, color: colors.textDim },
  footTime: { fontSize: 11, color: colors.textFaint },

  emptyCard: { alignItems: 'center', marginTop: spacing.xl },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.primaryDim,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  emptyText: { fontSize: 13, color: colors.textDim, textAlign: 'center', lineHeight: 20 },
  emptyHint: {
    fontSize: 11, color: colors.info, marginTop: spacing.md,
    backgroundColor: colors.infoDim, paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: R.sm, overflow: 'hidden',
  },

  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  actionBtn: { flex: 1 },
}));
