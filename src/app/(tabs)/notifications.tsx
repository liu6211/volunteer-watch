/**
 * 通知记录页
 */
import React from 'react';
import {
  FlatList, StyleSheet, Text, TouchableOpacity, View, Linking,
} from 'react-native';

import { useStore } from '../../lib/store';
import { colors, radius, spacing, formatTime } from '../../lib/theme';
import type { StoredNotification } from '../../lib/types';

export default function NotificationsScreen() {
  const {
    state, markAllNotificationsRead, clearAllNotifications,
  } = useStore();

  const list = state.notifications;
  const unread = list.filter((n) => !n.read).length;

  React.useEffect(() => {
    // 进入页面即标记已读（延时一点，避免渲染期间立刻改状态闪烁）
    if (unread > 0) {
      const t = setTimeout(() => { void markAllNotificationsRead(); }, 800);
      return () => clearTimeout(t);
    }
  }, [unread, markAllNotificationsRead]);

  const onClear = () => {
    void clearAllNotifications();
  };

  const renderItem = ({ item }: { item: StoredNotification }) => {
    const oppUrl = `https://gz.zhiyuanyun.com/app/opp/view.php?id=${item.oppIds[0] ?? ''}`;
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          {!item.read ? <View style={styles.dot} /> : null}
          <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        </View>
        <Text style={styles.body} numberOfLines={2}>{item.body}</Text>
        <View style={styles.cardBottom}>
          <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
          {item.oppIds.length > 0 ? (
            <TouchableOpacity onPress={() => { void Linking.openURL(oppUrl); }}>
              <Text style={styles.link}>查看项目 ›</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      {list.length > 0 ? (
        <View style={styles.bar}>
          <Text style={styles.barText}>共 {list.length} 条记录</Text>
          <TouchableOpacity onPress={onClear}>
            <Text style={styles.barAction}>清空</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <FlatList
        data={list}
        keyExtractor={(n) => n.id}
        renderItem={renderItem}
        contentContainerStyle={list.length === 0 ? styles.emptyWrap : styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🔔</Text>
            <Text style={styles.emptyTitle}>还没有通知</Text>
            <Text style={styles.emptyText}>
              当监控的团体发布了新项目，这里会出现记录，{'\n'}同时你的手机会收到通知。
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  barText: { fontSize: 13, color: colors.textDim },
  barAction: { fontSize: 13, color: colors.danger, fontWeight: '600' },
  list: { padding: spacing.lg },
  emptyWrap: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.danger, marginTop: 6, marginRight: spacing.sm,
  },
  title: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  body: { fontSize: 13, color: colors.textDim, marginTop: spacing.sm, lineHeight: 19 },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  time: { fontSize: 11, color: colors.textFaint },
  link: { fontSize: 13, color: colors.info, fontWeight: '600' },
  empty: { alignItems: 'center' },
  emptyEmoji: { fontSize: 44, marginBottom: spacing.md },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  emptyText: { fontSize: 13, color: colors.textDim, textAlign: 'center', lineHeight: 20 },
});
