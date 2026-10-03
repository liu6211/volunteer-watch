/**
 * 团体详情页 —— 液态玻璃风格
 *
 * 导航安全：正常从列表点进来时头部有系统返回键；
 * 如果是通过链接直接打开（栈里没有上一页），则显示一个「返回列表」按钮，
 * 保证任何情况下都不会「卡在这一页出不去」。
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Linking, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore, displayName } from '../../lib/store';
import { colors, radius as R, spacing, timeAgo, statusColor } from '../../lib/theme';
import { themedStyles } from '../../lib/theme';
import type { OppItem } from '../../lib/types';
import { fetchOppsPage } from '../../core/parser.mjs';
import { Backdrop, Badge, Divider, Glass, GlassButton, Icon, Tap } from '../../components/ui';

export default function TeamDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, checking, checkOneWatch, removeWatch, renameWatch } = useStore();
  const insets = useSafeAreaInsets();

  // 路由参数就是监控项的主键（host~id）
  const watch = useMemo(() => state.watches.find((w) => w.key === id), [state.watches, id]);

  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState('');

  /* ------------------------------------------------ 翻页浏览 */
  /**
   * 站点每页 20 个。第 1 页用已抓到的本地数据（秒开），
   * 之后按页去站点取 —— 照站点自己的分页方式，不一次性全拉。
   */
  const [page, setPage] = useState(1);
  const [pageItems, setPageItems] = useState<OppItem[]>([]);
  const [hasNext, setHasNext] = useState(true);
  const [paging, setPaging] = useState(false);
  const [pageError, setPageError] = useState('');

  /** 注意：hook 要在下面的提前 return 之前，否则会违反 hooks 规则 */
  const loadPage = useCallback(
    async (target: number) => {
      if (target < 1) return;
      setPageError('');
      if (target === 1) {
        // 第 1 页直接用本地已抓到的，不用再请求
        setPage(1);
        return;
      }
      setPaging(true);
      try {
        const orgId = watch?.orgId || '';
        if (!orgId) throw new Error('这个团体还没有编号，先点「立即检查」');
        const r = await fetchOppsPage(watch!.host, orgId, target);
        setPageItems(r.items);
        setHasNext(r.hasNext);
        setPage(target);
      } catch (e) {
        setPageError((e as Error).message);
      } finally {
        setPaging(false);
      }
    },
    [watch]
  );

  /** 当前这一页要显示什么 */
  const listData = page === 1 ? (watch?.projects ?? []) : pageItems;

  /** 栈里没有上一页时（直接打开链接），需要自己给一个出口 */
  const canGoBack = router.canGoBack();

  if (!watch) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 64 }]}>
        <Glass corner={R.xl} style={styles.missingCard}>
          <Icon name="alert-circle-outline" size={30} color={colors.warn} />
          <Text style={styles.missingText}>这个团体已经不在监控列表里了</Text>
          <GlassButton
            label="返回列表"
            icon="arrow-back"
            variant="glass"
            onPress={() => router.replace('/(tabs)')}
            style={{ alignSelf: 'stretch', marginTop: spacing.lg }}
          />
        </Glass>
      </View>
    );
  }

  const startRename = () => {
    setAlias(watch.alias ?? '');
    setEditing(true);
  };

  const commitRename = async () => {
    await renameWatch(watch.key, alias.trim());
    setEditing(false);
  };

  const onDelete = () => {
    Alert.alert('删除监控', `不再监控「${displayName(watch)}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await removeWatch(watch.key);
          if (router.canGoBack()) router.back();
          else router.replace('/(tabs)');
        },
      },
    ]);
  };

  const renderProject = ({ item, index }: { item: OppItem; index: number }) => {
    const sc = statusColor(item.status);
    // 项目链接形如 /app/opp/view.php?id=xxxx，取出 id 进 App 内的详情页
    const oppId = (String(item.url).match(/[?&]id=([^&\s]+)/) || [, ''])[1];
    return (
      <Tap
        onPress={() => {
          if (oppId) {
            router.push(`/project/${encodeURIComponent(oppId)}?host=${watch.host}`);
          } else {
            void Linking.openURL(item.url);
          }
        }}
        style={styles.projWrap}
      >
        <Glass corner={R.md} style={styles.proj}>
          <View style={styles.projRow}>
            <View style={styles.projIndex}>
              <Text style={styles.projIndexText}>{index + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.projName}>{item.name}</Text>
              <View style={styles.projMeta}>
                <Icon name="calendar-outline" size={11} color={colors.textFaint} />
                <Text style={styles.projDate}>{item.date || '日期未知'}</Text>
                {item.status ? (
                  <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
                    <Text style={[styles.statusPillText, { color: sc.fg }]}>{item.status}</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <Icon name="chevron-forward" size={14} color={colors.textFaint} />
          </View>
        </Glass>
      </Tap>
    );
  };

  return (
    <View style={styles.screen}>
      <Backdrop />
      <Stack.Screen options={{ title: displayName(watch) }} />

      <FlatList
        data={listData}
        keyExtractor={(p, i) => `${p.name}-${p.date}-${i}`}
        renderItem={renderProject}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top + 64, paddingBottom: spacing.xxl },
        ]}
        ListHeaderComponent={
          <View>
            {/* 直接打开链接时的保底出口 */}
            {!canGoBack ? (
              <GlassButton
                label="返回列表"
                icon="arrow-back"
                variant="glass"
                onPress={() => router.replace('/(tabs)')}
                style={{ marginBottom: spacing.md }}
              />
            ) : null}

            <Glass corner={R.lg}>
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
                  <Tap onPress={() => { void commitRename(); }}>
                    <View style={styles.smallBtn}><Text style={styles.smallBtnText}>保存</Text></View>
                  </Tap>
                  <Tap onPress={() => setEditing(false)}>
                    <View style={[styles.smallBtn, styles.smallBtnGhost]}>
                      <Text style={[styles.smallBtnText, { color: colors.textDim }]}>取消</Text>
                    </View>
                  </Tap>
                </View>
              ) : (
                <Tap onPress={startRename}>
                  <View>
                    <View style={styles.titleRow}>
                      <Text style={styles.title}>{displayName(watch)}</Text>
                      <Icon name="create-outline" size={16} color={colors.textFaint} />
                    </View>
                    {watch.alias ? <Text style={styles.subtitle}>{watch.name}</Text> : null}
                    <Text style={styles.tapHint}>点标题可改备注名</Text>
                  </View>
                </Tap>
              )}

              <View style={styles.metaGrid}>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>项目总数</Text>
                  <Text style={styles.metaValue}>{watch.projects.length}</Text>
                </View>
                <View style={styles.metaSep} />
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>上次检查</Text>
                  <Text style={styles.metaValue}>{timeAgo(watch.lastCheckedAt)}</Text>
                </View>
              </View>

              <Tap onPress={() => { void Linking.openURL(watch.url); }}>
                <View style={styles.urlBox}>
                  <View style={styles.urlRow}>
                    <Icon name="link-outline" size={13} color={colors.info} />
                    <Text style={styles.urlText} numberOfLines={2}>{watch.url}</Text>
                  </View>
                  <View style={styles.urlRow}>
                    <Text style={styles.urlHint}>在浏览器中打开</Text>
                    <Icon name="open-outline" size={12} color={colors.info} />
                  </View>
                </View>
              </Tap>

              {watch.lastResult ? (
                <View style={styles.lastResultRow}>
                  <Icon
                    name={watch.lastResult.startsWith('检查失败') ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                    size={13}
                    color={watch.lastResult.startsWith('检查失败') ? colors.warn : colors.textFaint}
                  />
                  <Text style={styles.lastResult}>{watch.lastResult}</Text>
                </View>
              ) : null}
            </Glass>

            <View style={styles.actions}>
              <GlassButton
                label={checking ? '检查中…' : '立即检查'}
                icon={checking ? undefined : 'refresh'}
                loading={checking}
                variant="primary"
                onPress={() => { void checkOneWatch(watch.key); }}
                style={{ flex: 1 }}
              />
              <GlassButton
                label="删除"
                icon="trash-outline"
                variant="danger"
                onPress={onDelete}
                style={{ width: 110 }}
              />
            </View>

            <View style={styles.listTitleRow}>
              <Icon name="list-outline" size={15} color={colors.textDim} />
              <Text style={styles.listTitle}>
                {page === 1 ? '最新 20 个（第 1 页）' : `第 ${page} 页`}
              </Text>
              <Badge text={String(listData.length)} tone="neutral" />
            </View>

            {/* 翻页：照站点自己的分页方式，每页 20 个 */}
            <View style={styles.pager}>
              <GlassButton
                label="上一页" icon="chevron-back" variant="glass"
                disabled={page <= 1 || paging}
                onPress={() => { void loadPage(page - 1); }}
                style={{ flex: 1 }}
              />
              <View style={styles.pageNo}>
                <Text style={styles.pageNoText}>{page}</Text>
              </View>
              <GlassButton
                label="下一页" icon="chevron-forward" variant="glass"
                disabled={!hasNext || paging}
                onPress={() => { void loadPage(page + 1); }}
                style={{ flex: 1 }}
              />
            </View>

            {paging ? (
              <View style={styles.pagingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.pagingText}>正在读取第 {page + 1} 页…</Text>
              </View>
            ) : null}

            {pageError ? (
              <View style={styles.pagingRow}>
                <Icon name="alert-circle" size={14} color={colors.danger} />
                <Text style={styles.pageErrText}>{pageError}</Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Glass corner={R.lg} style={styles.emptyCard}>
            <Icon name="file-tray-outline" size={26} color={colors.textFaint} />
            <Text style={styles.emptyList}>还没有抓到项目，点「立即检查」试试</Text>
          </Glass>
        }
        alwaysBounceVertical
      />
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, backgroundColor: 'transparent', padding: spacing.lg },
  missingCard: { alignItems: 'center', paddingVertical: spacing.xl },
  missingText: { fontSize: 14, color: colors.textDim, marginTop: spacing.md },

  listContent: { paddingHorizontal: spacing.lg },

  renameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  renameInput: {
    flex: 1,
    backgroundColor: colors.field,
    borderRadius: R.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.text,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.glassBorder,
  },
  smallBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: R.pill,
  },
  smallBtnGhost: { backgroundColor: colors.field },
  smallBtnText: { color: colors.textOnAccent, fontSize: 12.5, fontWeight: '700' },

  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: 19, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 12, color: colors.textDim, marginTop: 3 },
  tapHint: { fontSize: 11, color: colors.textFaint, marginTop: 5 },

  metaGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    backgroundColor: colors.field,
    borderRadius: R.sm,
    padding: spacing.md,
  },
  metaItem: { flex: 1 },
  metaSep: { width: StyleSheet.hairlineWidth, height: 30, backgroundColor: colors.glassDivider },
  metaLabel: { fontSize: 10.5, color: colors.textFaint },
  metaValue: { fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 2 },

  urlBox: {
    marginTop: spacing.md,
    backgroundColor: colors.infoDim,
    borderRadius: R.sm,
    padding: spacing.md,
    gap: 4,
  },
  urlRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  urlText: { flex: 1, fontSize: 11, color: colors.info },
  urlHint: { fontSize: 11, color: colors.info, fontWeight: '700' },

  lastResultRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.md },
  lastResult: { flex: 1, fontSize: 11.5, color: colors.textDim },

  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },

  pager: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.md, marginBottom: spacing.sm,
  },
  pageNo: {
    minWidth: 52, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: R.pill, backgroundColor: colors.primary,
  },
  pageNoText: { fontSize: 14, fontWeight: '800', color: colors.textOnAccent },
  pagingRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.xs,
  },
  pagingText: { fontSize: 12, color: colors.textDim },
  pageErrText: { flex: 1, fontSize: 12, color: colors.danger },

  listTitleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: spacing.xl, marginBottom: spacing.sm,
  },
  listTitle: { fontSize: 13, fontWeight: '700', color: colors.textDim },

  projWrap: { marginBottom: spacing.sm, borderRadius: R.md },
  proj: { padding: spacing.md },
  projRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  projIndex: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.field,
    alignItems: 'center', justifyContent: 'center',
  },
  projIndexText: { fontSize: 11, color: colors.textDim, fontWeight: '800' },
  projName: { fontSize: 13.5, color: colors.text, fontWeight: '700', lineHeight: 19 },
  projMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  projDate: { fontSize: 11, color: colors.textDim },
  statusPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  statusPillText: { fontSize: 10, fontWeight: '800' },

  emptyCard: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  emptyList: { fontSize: 12.5, color: colors.textDim },
}));
