/**
 * 团体详情页
 * 展示这个团体抓到的项目列表，并提供单个检查 / 重命名 / 删除
 */
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Linking, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';

import { useStore, displayName } from '../../lib/store';
import { colors, radius, spacing, timeAgo, statusColor } from '../../lib/theme';
import type { OppItem } from '../../lib/types';

export default function TeamDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, checking, checkOneWatch, removeWatch, renameWatch } = useStore();

  const watch = useMemo(
    () => state.watches.find((w) => w.id === id),
    [state.watches, id]
  );

  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState('');

  if (!watch) {
    return (
      <View style={styles.center}>
        <Text style={styles.missing}>这个团体已经不在监控列表里了</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.link}>返回</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const startRename = () => {
    setAlias(watch.alias ?? '');
    setEditing(true);
  };

  const commitRename = async () => {
    await renameWatch(watch.id, alias.trim());
    setEditing(false);
  };

  const onDelete = () => {
    Alert.alert('删除监控', `不再监控「${displayName(watch)}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await removeWatch(watch.id);
          router.back();
        },
      },
    ]);
  };

  const renderProject = ({ item, index }: { item: OppItem; index: number }) => {
    const sc = statusColor(item.status);
    return (
      <TouchableOpacity
        style={styles.projRow}
        onPress={() => { void Linking.openURL(item.url); }}
      >
        <Text style={styles.projIndex}>{index + 1}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.projName}>{item.name}</Text>
          <View style={styles.projMeta}>
            <Text style={styles.projDate}>{item.date || '日期未知'}</Text>
            {item.status ? (
              <Text style={[styles.projStatus, { color: sc.fg, backgroundColor: sc.bg }]}>
                {item.status}
              </Text>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: displayName(watch) }} />

      <FlatList
        data={watch.projects}
        keyExtractor={(p) => p.id}
        renderItem={renderProject}
        ListHeaderComponent={
          <View>
            {/* 概要卡片 */}
            <View style={styles.card}>
              {editing ? (
                <View style={styles.renameRow}>
                  <TextInput
                    style={styles.renameInput}
                    value={alias}
                    onChangeText={setAlias}
                    placeholder="备注名"
                    placeholderTextColor={colors.textFaint}
                    autoFocus
                  />
                  <TouchableOpacity style={styles.smallBtn} onPress={() => { void commitRename(); }}>
                    <Text style={styles.smallBtnText}>保存</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.smallBtn, styles.smallBtnGhost]}
                    onPress={() => setEditing(false)}
                  >
                    <Text style={[styles.smallBtnText, { color: colors.textDim }]}>取消</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity onPress={startRename}>
                  <Text style={styles.title}>{displayName(watch)}</Text>
                  {watch.alias ? <Text style={styles.subtitle}>{watch.name}</Text> : null}
                  <Text style={styles.tapHint}>点这里改备注名</Text>
                </TouchableOpacity>
              )}

              <View style={styles.metaGrid}>
                <Meta label="项目总数" value={String(watch.projects.length)} />
                <Meta label="上次检查" value={timeAgo(watch.lastCheckedAt)} />
              </View>

              <TouchableOpacity
                style={styles.urlBox}
                onPress={() => { void Linking.openURL(watch.url); }}
              >
                <Text style={styles.urlText} numberOfLines={2}>{watch.url}</Text>
                <Text style={styles.urlHint}>在浏览器中打开 ›</Text>
              </TouchableOpacity>

              {watch.lastResult ? (
                <Text style={styles.lastResult}>{watch.lastResult}</Text>
              ) : null}
            </View>

            {/* 操作按钮 */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionPrimary]}
                onPress={() => { void checkOneWatch(watch.id); }}
                disabled={checking}
              >
                {checking ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.actionPrimaryText}>立即检查</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionDanger]}
                onPress={onDelete}
              >
                <Text style={styles.actionDangerText}>删除</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.listTitle}>
              已抓到的项目（{watch.projects.length}）
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.emptyList}>
            还没有抓到项目。点「立即检查」试试。
          </Text>
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaItem}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  missing: { fontSize: 15, color: colors.textDim, marginBottom: spacing.md },
  link: { fontSize: 15, color: colors.info, fontWeight: '600' },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 12, color: colors.textDim, marginTop: 3 },
  tapHint: { fontSize: 11, color: colors.textFaint, marginTop: 4 },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  renameInput: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.text,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  smallBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  smallBtnGhost: { backgroundColor: colors.bg },
  smallBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  metaGrid: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  metaItem: { flex: 1 },
  metaLabel: { fontSize: 11, color: colors.textFaint },
  metaValue: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 2 },

  urlBox: {
    marginTop: spacing.md,
    backgroundColor: colors.infoDim,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  urlText: { fontSize: 11, color: colors.info },
  urlHint: { fontSize: 11, color: colors.info, fontWeight: '700', marginTop: 4 },
  lastResult: { fontSize: 12, color: colors.textDim, marginTop: spacing.md },

  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  actionBtn: {
    flex: 1, height: 46, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  actionPrimary: { backgroundColor: colors.primary },
  actionPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  actionDanger: { backgroundColor: colors.dangerDim, maxWidth: 100 },
  actionDangerText: { color: colors.danger, fontSize: 15, fontWeight: '700' },

  listTitle: {
    fontSize: 13, fontWeight: '700', color: colors.textDim,
    marginTop: spacing.xl, marginBottom: spacing.sm,
  },
  projRow: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  projIndex: {
    width: 22, fontSize: 12, color: colors.textFaint, fontWeight: '700', marginTop: 2,
  },
  projName: { fontSize: 14, color: colors.text, fontWeight: '600', lineHeight: 20 },
  projMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6 },
  projDate: { fontSize: 11, color: colors.textDim },
  projStatus: {
    fontSize: 10, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4, overflow: 'hidden',
  },
  emptyList: {
    fontSize: 13, color: colors.textDim, textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});
