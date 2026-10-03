/**
 * 通知记录页 —— 液态玻璃风格
 */
import React from 'react';
import { FlatList, Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '../../lib/store';
import { colors, radius as R, spacing, formatTime } from '../../lib/theme';
import { themedStyles } from '../../lib/theme';
import type { StoredNotification } from '../../lib/types';
import { Glass, Icon, Tap } from '../../components/ui';

export default function NotificationsScreen() {
  const { state, markAllNotificationsRead, clearAllNotifications } = useStore();
  const insets = useSafeAreaInsets();

  const list = state.notifications;
  const unread = list.filter((n) => !n.read).length;

  React.useEffect(() => {
    // 进入页面即标记已读（延时一点，避免渲染期间立刻改状态闪烁）
    if (unread > 0) {
      const t = setTimeout(() => { void markAllNotificationsRead(); }, 800);
      return () => clearTimeout(t);
    }
  }, [unread, markAllNotificationsRead]);

  const renderItem = ({ item }: { item: StoredNotification }) => {
    const oppUrl = `https://gz.zhiyuanyun.com/app/opp/view.php?id=${item.oppIds[0] ?? ''}`;
    return (
      <Glass corner={R.lg} style={styles.card}>
        <View style={styles.cardTop}>
          <View style={[styles.dot, !item.read && styles.dotUnread]} />
          <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        </View>
        <Text style={styles.body} numberOfLines={2}>{item.body}</Text>
        <View style={styles.cardBottom}>
          <View style={styles.timeRow}>
            <Icon name="time-outline" size={12} color={colors.textFaint} />
            <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
          </View>
          {item.oppIds.length > 0 ? (
            <Tap onPress={() => { void Linking.openURL(oppUrl); }}>
              <View style={styles.linkRow}>
                <Text style={styles.link}>查看项目</Text>
                <Icon name="open-outline" size={13} color={colors.info} />
              </View>
            </Tap>
          ) : null}
        </View>
      </Glass>
    );
  };

  return (
    <View style={styles.screen}>
      <FlatList
        data={list}
        keyExtractor={(n) => n.id}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.list,
          { paddingTop: insets.top + 56, paddingBottom: 170 },
        ]}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text style={styles.pageTitle}>通知记录</Text>
              {list.length > 0 ? (
                <Tap onPress={() => { void clearAllNotifications(); }}>
                  <View style={styles.clearBtn}>
                    <Icon name="trash-outline" size={14} color={colors.danger} />
                    <Text style={styles.clearText}>清空</Text>
                  </View>
                </Tap>
              ) : null}
            </View>
            {list.length > 0 ? (
              <Text style={styles.subTitle}>
                共 {list.length} 条{unread > 0 ? ` · ${unread} 条未读` : ''}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Glass corner={R.xl} style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Icon name="notifications-outline" size={30} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>还没有通知</Text>
            <Text style={styles.emptyText}>
              当监控的团体发布了新项目，这里会出现记录，同时手机会收到通知
            </Text>
          </Glass>
        }
        alwaysBounceVertical
      />
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  list: { paddingHorizontal: spacing.lg },

  header: { marginBottom: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pageTitle: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: 0.2 },
  subTitle: { fontSize: 12, color: colors.textDim, marginTop: 4 },

  clearBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.dangerDim,
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: R.pill,
  },
  clearText: { fontSize: 12, color: colors.danger, fontWeight: '700' },

  card: { marginBottom: spacing.md },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 6, backgroundColor: 'transparent' },
  dotUnread: { backgroundColor: colors.danger },
  title: { flex: 1, fontSize: 14.5, fontWeight: '800', color: colors.text, lineHeight: 20 },
  body: { fontSize: 12.5, color: colors.textDim, marginTop: spacing.sm, lineHeight: 19 },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  time: { fontSize: 11, color: colors.textFaint },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  link: { fontSize: 12.5, color: colors.info, fontWeight: '700' },

  emptyCard: { alignItems: 'center', marginTop: spacing.xl },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.primaryDim,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  emptyText: { fontSize: 13, color: colors.textDim, textAlign: 'center', lineHeight: 20 },
}));
