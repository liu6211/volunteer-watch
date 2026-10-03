/**
 * 项目详情页
 *
 * 从监控列表里点某个项目进来，显示项目信息（对应站点 view.php 页面），
 * 登录后可以一键报名。
 *
 * 报名是**写操作**，所以必须二次确认，绝不自动提交。
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchProject, joinProject } from '../../core/project.mjs';
import type { OppDetail } from '../../core/project.mjs';
import { useStore } from '../../lib/store';
import { colors, radius as R, spacing, themedStyles } from '../../lib/theme';
import { Backdrop, Glass, GlassButton, Icon, Tap } from '../../components/ui';

export default function ProjectDetailScreen() {
  const { id, host } = useLocalSearchParams<{ id?: string; host?: string }>();
  const { state, accountSession } = useStore();
  const insets = useSafeAreaInsets();

  const site = String(host || 'gz.zhiyuanyun.com');
  const urlId = String(id || '');

  const [data, setData] = useState<OppDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState('');
  const [result, setResult] = useState('');

  const load = useCallback(async () => {
    if (!urlId) { setError('缺少项目编号'); setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      setData(await fetchProject(site, urlId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [site, urlId]);

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => { if (alive) void load(); });
    return () => { alive = false; };
  }, [load]);

  /** 一键报名：先弹确认，再提交 */
  const onJoin = (jobId: string, postTitle: string) => {
    if (!state.account) {
      Alert.alert('还没登录', '报名需要先登录志愿云账号。', [
        { text: '取消', style: 'cancel' },
        { text: '去登录', onPress: () => router.push('/login') },
      ]);
      return;
    }

    Alert.alert(
      '确认报名',
      `确定报名「${data?.title || '该项目'}」的岗位「${postTitle}」吗？\n\n` +
      '提交后会在你的志愿云账号里产生报名记录。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认报名',
          onPress: async () => {
            setJoining(jobId);
            setResult('');
            try {
              const r = await joinProject(accountSession(), site, data?.oppId || '', jobId);
              setResult(r.message);
              Alert.alert(r.ok ? '报名成功' : '报名未成功', r.message);
              if (r.ok) void load();
            } catch (e) {
              setResult((e as Error).message);
              Alert.alert('报名出错', (e as Error).message);
            } finally {
              setJoining('');
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.screen}>
        <Backdrop />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>正在读取项目…</Text>
        </View>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.screen}>
        <Backdrop />
        <View style={[styles.center, { paddingHorizontal: spacing.lg }]}>
          <Glass corner={R.md} style={styles.errorCard}>
            <View style={styles.errorRow}>
              <Icon name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{error || '没有取到项目信息'}</Text>
            </View>
            <GlassButton
              label="重试" icon="refresh" variant="glass"
              onPress={() => { void load(); }}
              style={{ marginTop: spacing.md }}
            />
          </Glass>
        </View>
      </View>
    );
  }

  const info: [string, string][] = [
    ['项目地点', data.info.place],
    ['服务类别', data.info.category],
    ['服务对象', data.info.target],
    ['招募日期', [data.info.recruitStart, data.info.recruitEnd].filter(Boolean).join(' 至 ')],
    ['项目日期', data.info.projectDate],
    ['发布日期', data.info.publishedAt],
    ['服务时间', data.info.serviceTime],
    ['志愿者保障', data.info.guarantee],
  ].filter(([, v]) => !!v) as [string, string][];

  return (
    <View style={styles.screen}>
      <Backdrop />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 70, paddingBottom: spacing.xxl },
        ]}
      >
        <Text style={styles.title}>{data.title}</Text>
        {data.oppId ? (
          <Text style={styles.subtitle}>项目编号 {data.oppId}</Text>
        ) : null}

        {/* 基本信息 */}
        {info.length > 0 ? (
          <Glass corner={R.lg} style={styles.card}>
            {info.map(([k, v], i) => (
              <View key={k} style={[styles.infoRow, i > 0 && styles.infoRowGap]}>
                <Text style={styles.infoLabel}>{k}</Text>
                <Text style={styles.infoValue}>{v}</Text>
              </View>
            ))}
          </Glass>
        ) : null}

        {/* 岗位 + 报名 */}
        {data.posts.map((p) => (
          <Glass key={p.index} corner={R.lg} style={styles.card}>
            <View style={styles.postHead}>
              <Text style={styles.postTitle}>岗位{p.index}：{p.title}</Text>
              <View style={styles.postCounts}>
                {p.plan !== null ? <Text style={styles.postCount}>计划 {p.plan}</Text> : null}
                {p.joined !== null ? (
                  <Text style={[
                    styles.postCount,
                    p.plan !== null && p.joined >= p.plan ? styles.postFull : null,
                  ]}>
                    已招募 {p.joined}
                  </Text>
                ) : null}
              </View>
            </View>

            {p.desc ? (
              <View style={styles.postField}>
                <Text style={styles.postLabel}>岗位描述</Text>
                <Text style={styles.postValue}>{p.desc}</Text>
              </View>
            ) : null}
            {p.condition ? (
              <View style={styles.postField}>
                <Text style={styles.postLabel}>岗位条件</Text>
                <Text style={styles.postValue}>{p.condition}</Text>
              </View>
            ) : null}

            {p.jobId ? (
              <GlassButton
                label={joining === p.jobId ? '正在提交…' : '一键报名'}
                icon={joining === p.jobId ? undefined : 'checkmark-circle-outline'}
                loading={joining === p.jobId}
                variant="primary"
                onPress={() => onJoin(p.jobId, p.title)}
                style={{ marginTop: spacing.md }}
              />
            ) : (
              <Text style={styles.noJob}>这个岗位暂时不能报名</Text>
            )}
          </Glass>
        ))}

        {result ? (
          <Glass corner={R.md} style={styles.resultCard}>
            <Icon
              name={/成功|已加入/.test(result) ? 'checkmark-circle' : 'alert-circle'}
              size={16}
              color={/成功|已加入/.test(result) ? colors.primary : colors.warn}
            />
            <Text style={styles.resultText}>{result}</Text>
          </Glass>
        ) : null}

        {/* 项目详情正文 */}
        {data.detail ? (
          <Glass corner={R.lg} style={styles.card}>
            <Text style={styles.sectionTitle}>项目详情</Text>
            <Text style={styles.detail}>{data.detail}</Text>
          </Glass>
        ) : null}

        {/* 已报名名单 */}
        {data.joiners.length > 0 ? (
          <Glass corner={R.lg} style={styles.card}>
            <Text style={styles.sectionTitle}>最新报名（{data.joiners.length} 人）</Text>
            {data.joiners.slice(0, 20).map((j, i) => (
              <View key={i} style={styles.joinerRow}>
                <Text style={styles.joinerName}>{j.name}</Text>
                <Text style={styles.joinerMeta}>{j.post} · {j.date}</Text>
              </View>
            ))}
          </Glass>
        ) : null}

        <Tap onPress={() => { void load(); }}>
          <View style={styles.refresh}>
            <Icon name="refresh" size={14} color={colors.textFaint} />
            <Text style={styles.refreshText}>刷新</Text>
          </View>
        </Tap>
      </ScrollView>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  loadingText: { fontSize: 12, color: colors.textDim },

  title: { fontSize: 20, fontWeight: '800', color: colors.text, lineHeight: 28 },
  subtitle: { fontSize: 11.5, color: colors.textFaint, marginTop: 4, marginBottom: spacing.md },

  card: { marginBottom: spacing.md },

  infoRow: { flexDirection: 'row', gap: spacing.md },
  infoRowGap: { marginTop: spacing.md },
  infoLabel: { width: 76, fontSize: 12.5, color: colors.textDim },
  infoValue: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 19 },

  postHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  postTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.text },
  postCounts: { flexDirection: 'row', gap: spacing.sm },
  postCount: { fontSize: 11.5, color: colors.primary, fontWeight: '700' },
  postFull: { color: colors.warn },

  postField: { marginTop: spacing.md },
  postLabel: { fontSize: 11.5, color: colors.textFaint },
  postValue: { fontSize: 13, color: colors.text, marginTop: 3, lineHeight: 19 },

  noJob: { fontSize: 11.5, color: colors.textFaint, marginTop: spacing.md },

  resultCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  resultText: { flex: 1, fontSize: 12.5, color: colors.text, lineHeight: 19 },

  sectionTitle: { fontSize: 13.5, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  detail: { fontSize: 12.5, color: colors.text, lineHeight: 21 },

  joinerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.glassDivider,
  },
  joinerName: { width: 90, fontSize: 12.5, color: colors.text, fontWeight: '600' },
  joinerMeta: { flex: 1, fontSize: 11.5, color: colors.textDim },

  errorCard: {},
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  errorText: { flex: 1, fontSize: 12.5, color: colors.danger, lineHeight: 18 },

  refresh: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: spacing.xl,
  },
  refreshText: { fontSize: 11.5, color: colors.textFaint },
}));
