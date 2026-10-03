/**
 * 团体搜索页
 *
 * 布局按需求：上面搜索框，下面搜索历史，再下面是结果。
 * 站点：默认贵州站，可切换（各省分站是独立站点）。
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, FlatList, Keyboard, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { searchOrgs } from '../core/search.mjs';
import type { OrgSearchItem } from '../core/search.mjs';
import { useStore } from '../lib/store';
import { colors, radius as R, spacing, themedStyles } from '../lib/theme';
import { Backdrop, Glass, GlassButton, Icon, Tap } from '../components/ui';

/** 常用分站（各省分站是独立站点，数据不互通） */
const SITES: { host: string; label: string }[] = [
  { host: 'gz.zhiyuanyun.com', label: '贵州' },
  { host: 'www.zhiyuanyun.com', label: '总站' },
  { host: 'gd.zhiyuanyun.com', label: '广东' },
  { host: 'sc.zhiyuanyun.com', label: '四川' },
  { host: 'hn.zhiyuanyun.com', label: '湖南' },
  { host: 'js.zhiyuanyun.com', label: '江苏' },
  { host: 'zj.zhiyuanyun.com', label: '浙江' },
  { host: 'sd.zhiyuanyun.com', label: '山东' },
];

export default function SearchScreen() {
  const {
    state, addWatchFromSearchResult,
    recordSearch, removeSearchHistoryItem, clearSearchHistoryAll,
  } = useStore();
  const insets = useSafeAreaInsets();

  const [host, setHost] = useState('gz.zhiyuanyun.com');
  const [keyword, setKeyword] = useState('');
  const [query, setQuery] = useState('');       // 已提交的关键词
  const [items, setItems] = useState<OrgSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [addingId, setAddingId] = useState('');
  const [siteOpen, setSiteOpen] = useState(false);

  const history = state.searchHistory ?? [];

  /** 已监控的团体 key 集合，用于把结果标成「已添加」 */
  const watchedKeys = new Set(state.watches.map((w) => `${w.host}~${w.id}`));

  const doSearch = useCallback(
    async (kw: string, targetHost = host) => {
      const q = kw.trim();
      if (!q) return;
      Keyboard.dismiss();
      setKeyword(q);
      setQuery(q);
      setLoading(true);
      setError('');
      setSearched(true);
      try {
        const r = await searchOrgs(targetHost, q);
        setItems(r.items);
        if (r.items.length > 0) await recordSearch(q);
      } catch (e) {
        setItems([]);
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [host, recordSearch]
  );

  const onAdd = async (it: OrgSearchItem) => {
    setAddingId(it.linkId);
    setError('');
    try {
      const res = await addWatchFromSearchResult(host, it.linkId, it.name);
      router.replace(`/team/${res.key}`);
      if (res.firstResult?.startsWith('检查失败')) {
        // 详情页会显示失败原因，这里不再弹窗打断
        console.warn('[search] 添加后首次抓取失败：', res.firstResult);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAddingId('');
    }
  };

  const renderItem = ({ item }: { item: OrgSearchItem }) => {
    const adding = addingId === item.linkId;
    return (
      <Glass corner={R.md} style={styles.resultCard}>
        <View style={styles.resultRow}>
          <View style={styles.resultIcon}>
            <Icon name="people-outline" size={17} color={colors.primary} />
          </View>
          <View style={styles.resultText}>
            <Text style={styles.resultName} numberOfLines={2}>{item.name}</Text>
            <Text style={styles.resultMeta}>
              {item.members !== null ? `团体人数 ${item.members}` : '团体'}
            </Text>
          </View>
          {adding ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Tap onPress={() => { void onAdd(item); }}>
              <View style={styles.addBtn}>
                <Icon name="add" size={15} color={colors.textOnAccent} />
                <Text style={styles.addBtnText}>监控</Text>
              </View>
            </Tap>
          )}
        </View>
      </Glass>
    );
  };

  return (
    <View style={styles.screen}>
      <Backdrop />
      <FlatList
        data={items}
        keyExtractor={(it) => it.linkId}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.list, { paddingTop: insets.top + 70, paddingBottom: spacing.xxl }]}
        ListHeaderComponent={
          <View>
            {/* 搜索框 */}
            <Glass corner={R.lg}>
              <View style={styles.searchRow}>
                <Icon name="search-outline" size={17} color={colors.textFaint} />
                <TextInput
                  style={styles.input}
                  value={keyword}
                  onChangeText={setKeyword}
                  onSubmitEditing={() => { void doSearch(keyword); }}
                  placeholder="输入团体名称，例如：都匀三中"
                  placeholderTextColor={colors.textFaint}
                  returnKeyType="search"
                  autoFocus
                />
                {keyword ? (
                  <Tap onPress={() => setKeyword('')}>
                    <Icon name="close-circle" size={17} color={colors.textFaint} />
                  </Tap>
                ) : null}
              </View>

              {/* 站点选择 */}
              <Tap onPress={() => setSiteOpen((v) => !v)}>
                <View style={styles.siteRow}>
                  <Icon name="location-outline" size={15} color={colors.textDim} />
                  <Text style={styles.siteLabel}>
                    搜索范围：{SITES.find((s) => s.host === host)?.label ?? host}
                  </Text>
                  <Icon name={siteOpen ? 'chevron-up' : 'chevron-down'} size={15} color={colors.textFaint} />
                </View>
              </Tap>
              {siteOpen ? (
                <View style={styles.chips}>
                  {SITES.map((s) => (
                    <Tap
                      key={s.host}
                      onPress={() => { setSiteOpen(false); setHost(s.host); void doSearch(query || keyword, s.host); }}
                    >
                      <View style={[styles.chip, host === s.host && styles.chipActive]}>
                        <Text style={[styles.chipText, host === s.host && styles.chipTextActive]}>
                          {s.label}
                        </Text>
                      </View>
                    </Tap>
                  ))}
                </View>
              ) : null}

              <GlassButton
                label={loading ? '搜索中…' : '搜索'}
                icon={loading ? undefined : 'search'}
                loading={loading}
                variant="primary"
                onPress={() => { void doSearch(keyword); }}
                style={{ marginTop: spacing.md }}
              />
            </Glass>

            {/* 搜索历史 */}
            {history.length > 0 ? (
              <View style={styles.historyWrap}>
                <View style={styles.historyHead}>
                  <Icon name="time-outline" size={14} color={colors.textDim} />
                  <Text style={styles.historyTitle}>搜索历史</Text>
                  <Tap onPress={() => { void clearSearchHistoryAll(); }}>
                    <Text style={styles.historyClear}>清空</Text>
                  </Tap>
                </View>
                <View style={styles.chips}>
                  {history.map((h) => (
                    <Tap key={h} onPress={() => { void doSearch(h); }} onLongPress={() => { void removeSearchHistoryItem(h); }}>
                      <View style={styles.historyChip}>
                        <Text style={styles.historyChipText}>{h}</Text>
                      </View>
                    </Tap>
                  ))}
                </View>
                <Text style={styles.historyHint}>点一下重新搜索，长按删除这条</Text>
              </View>
            ) : null}

            {error ? (
              <Glass corner={R.md} style={styles.errorCard}>
                <View style={styles.errorRow}>
                  <Icon name="alert-circle" size={16} color={colors.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              </Glass>
            ) : null}

            {searched && !loading && items.length > 0 ? (
              <Text style={styles.resultCount}>找到 {items.length} 个团体</Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          searched && !loading && !error ? (
            <Glass corner={R.lg} style={styles.emptyCard}>
              <Icon name="search-outline" size={26} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>没搜到这个团体</Text>
              <Text style={styles.emptyText}>
                换个关键词试试；各省分站数据不互通，也可以切换「搜索范围」
              </Text>
            </Glass>
          ) : null
        }
      />
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  list: { paddingHorizontal: spacing.lg },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.field,
    borderRadius: R.sm,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.glassBorder,
  },
  input: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: spacing.md },

  siteRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: spacing.md, paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.glassDivider,
  },
  siteLabel: { flex: 1, fontSize: 12.5, color: colors.textDim, fontWeight: '600' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: R.pill,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.glassBorder,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.textDim },
  chipTextActive: { color: colors.textOnAccent },

  historyWrap: { marginTop: spacing.lg },
  historyHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyTitle: { flex: 1, fontSize: 12.5, fontWeight: '700', color: colors.textDim },
  historyClear: { fontSize: 12, color: colors.danger, fontWeight: '700' },
  historyChip: {
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: R.pill,
    backgroundColor: colors.primaryDim,
  },
  historyChipText: { fontSize: 12, color: colors.primary, fontWeight: '700' },
  historyHint: { fontSize: 10.5, color: colors.textFaint, marginTop: spacing.sm, marginLeft: 2 },

  errorCard: { marginTop: spacing.lg },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  errorText: { flex: 1, fontSize: 12.5, color: colors.danger, lineHeight: 18 },

  resultCount: { fontSize: 12, color: colors.textDim, marginTop: spacing.lg, marginBottom: spacing.sm },

  resultCard: { marginBottom: spacing.sm },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  resultIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.primaryDim,
    alignItems: 'center', justifyContent: 'center',
  },
  resultText: { flex: 1 },
  resultName: { fontSize: 14, fontWeight: '700', color: colors.text, lineHeight: 19 },
  resultMeta: { fontSize: 11, color: colors.textFaint, marginTop: 3 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: R.pill,
  },
  addBtnText: { fontSize: 12, color: colors.textOnAccent, fontWeight: '800' },

  emptyCard: { alignItems: 'center', marginTop: spacing.xl, gap: spacing.sm },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  emptyText: { fontSize: 12, color: colors.textDim, textAlign: 'center', lineHeight: 18 },
}));
