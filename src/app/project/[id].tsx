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
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchProject, joinProject } from '../../core/project.mjs';
import type { OppDetail } from '../../core/project.mjs';
import { fetchOppTab, OPP_TABS, postComment } from '../../core/account.mjs';
import { useStore } from '../../lib/store';
import { colors, radius as R, spacing, themedStyles } from '../../lib/theme';
import { Backdrop, Glass, GlassButton, Icon, Tap } from '../../components/ui';

export default function ProjectDetailScreen() {
  const { id, host } = useLocalSearchParams<{ id?: string; host?: string }>();
  const { state, accountSession, autoLogin } = useStore();
  const insets = useSafeAreaInsets();

  const site = String(host || 'gz.zhiyuanyun.com');
  const urlId = String(id || '');

  const [data, setData] = useState<OppDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState('');
  const [result, setResult] = useState('');

  /** 讨论区 / 项目动态 / 时长公示 */
  const [extraTab, setExtraTab] = useState<'' | 'comment' | 'track' | 'hour'>('');
  const [extraLines, setExtraLines] = useState<string[]>([]);
  const [extraItems, setExtraItems] = useState<{ author: string; time: string; content: string }[]>([]);
  const [extraLoading, setExtraLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);

  /** 发布评论（讨论区） */
  const onPostComment = async () => {
    if (!state.account) {
      Alert.alert('还没登录', '发布评论需要先登录志愿云账号。', [
        { text: '取消', style: 'cancel' },
        { text: '去登录', onPress: () => router.push('/login') },
      ]);
      return;
    }
    setCommentBusy(true);
    try {
      await autoLogin().catch(() => undefined);
      const r = await postComment(accountSession(), site, {
        commentType: '1',
        sourceId: urlId,
        content: commentText,
      });
      Alert.alert(r.ok ? '已发布' : '发布失败', r.message);
      if (r.ok) {
        setCommentText('');
        await openExtra('comment');
        await openExtra('comment');   // 再点一次展开并刷新列表
      }
    } catch (e) {
      Alert.alert('出错', (e as Error).message);
    } finally {
      setCommentBusy(false);
    }
  };

  const openExtra = async (tab: 'comment' | 'track' | 'hour') => {
    if (extraTab === tab) { setExtraTab(''); return; }
    setExtraTab(tab);
    setExtraLoading(true);
    setExtraLines([]);
    setExtraItems([]);
    try {
      const r = await fetchOppTab(accountSession(), site, tab, urlId, 1);
      setExtraItems(r.items);
      setExtraLines(r.lines);
    } catch (e) {
      setExtraLines([`读取失败：${(e as Error).message}`]);
    } finally {
      setExtraLoading(false);
    }
  };

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
  const onJoin = (jobId: string, postTitle: string, full = false) => {
    if (!state.account) {
      Alert.alert('还没登录', '报名需要先登录志愿云账号。', [
        { text: '取消', style: 'cancel' },
        { text: '去登录', onPress: () => router.push('/login') },
      ]);
      return;
    }

    Alert.alert(
      full ? '名额已满，仍要报名？' : '确认报名',
      `确定报名「${data?.title || '该项目'}」的岗位「${postTitle}」吗？\n\n` +
      (full ? '这个岗位计划招募人数已经满了，报名后可能不会被录用。\n\n' : '') +
      '提交后会在你的志愿云账号里产生报名记录。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: full ? '仍然报名' : '确认报名',
          style: full ? 'destructive' : 'default',
          onPress: async () => {
            setJoining(jobId);
            setResult('');
            try {
              /*
               * 报名前【先主动重新登录一次】。
               * 站点会话只有 30 分钟，等报错再补救已经晚一步；
               * 有保存的凭据时先刷新会话，报名成功率会高很多。
               */
              await autoLogin().catch(() => undefined);

              let r = await joinProject(accountSession(), site, data?.oppId || '', jobId);

              /*
               * 志愿云的会话很短（PHPSESSID 只有 30 分钟）。
               * 会话过期时报名接口会回「访问超时，请按Ctrl+F5…」——
               * 手机上没有 Ctrl+F5，正确做法是用保存的凭据自动重登再试一次。
               */
              if (!r.ok && /访问超时|超时|请登录|重新登录|会话/.test(r.message)) {
                const re = await autoLogin().catch(() => ({ ok: false, message: '' }));
                if (re.ok) {
                  r = await joinProject(accountSession(), site, data?.oppId || '', jobId);
                  if (r.ok) {
                    setResult(`（登录已过期，自动重新登录后）${r.message}`);
                    Alert.alert('报名成功', r.message);
                    void load();
                    return;
                  }
                }
                setResult('登录状态已过期，请到「设置」重新登录后再报名');
                Alert.alert('需要重新登录', '你的志愿云登录状态已过期，请重新登录后再报名。');
                return;
              }

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
              (() => {
                /*
                 * 计划人数 ≤ 已招募人数 → 名额已经满了（或超额）。
                 * 这时候仍然允许报名，但按钮改成橙色的「谨慎报名」并加一句说明，
                 * 避免用户以为一点就能录上。
                 */
                const full = p.plan !== null && p.joined !== null && p.joined >= p.plan;
                return (
                  <>
                    <GlassButton
                      label={
                        joining === p.jobId
                          ? '正在提交…'
                          : full ? '谨慎报名（名额已满）' : '一键报名'
                      }
                      icon={joining === p.jobId ? undefined : full ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                      loading={joining === p.jobId}
                      variant={full ? 'warn' : 'primary'}
                      onPress={() => onJoin(p.jobId, p.title, full)}
                      style={{ marginTop: spacing.md }}
                    />
                    {full ? (
                      <Text style={styles.fullHint}>
                        计划招 {p.plan} 人，已有 {p.joined} 人报名，可能不会被录用
                      </Text>
                    ) : null}
                  </>
                );
              })()
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

        {/* ---- 讨论区 / 项目动态 / 时长公示 ---- */}
        <View style={styles.extraTabs}>
          {(['comment', 'track', 'hour'] as const).map((t) => (
            <Tap key={t} onPress={() => { void openExtra(t); }} style={{ flex: 1 }}>
              <View style={[styles.extraTab, extraTab === t && styles.extraTabOn]}>
                <Text style={[styles.extraTabText, extraTab === t && styles.extraTabTextOn]}>
                  {OPP_TABS[t].label}
                </Text>
              </View>
            </Tap>
          ))}
        </View>

        {extraTab ? (
          <>
            {/* 讨论区可以发评论 */}
            {extraTab === 'comment' ? (
              <Glass corner={R.md} style={styles.card}>
                <TextInput
                  style={styles.cmtInput}
                  value={commentText}
                  onChangeText={setCommentText}
                  placeholder="说点什么…（需要登录）"
                  placeholderTextColor={colors.textFaint}
                  multiline
                />
                <GlassButton
                  label={commentBusy ? '发布中…' : '发布评论'}
                  icon={commentBusy ? undefined : 'send-outline'}
                  loading={commentBusy}
                  variant="primary"
                  onPress={() => { void onPostComment(); }}
                  style={{ marginTop: spacing.md }}
                />
              </Glass>
            ) : null}

            {extraLoading ? (
              <Glass corner={R.lg} style={styles.card}>
                <ActivityIndicator color={colors.primary} />
              </Glass>
            ) : extraItems.length === 0 ? (
              <Glass corner={R.lg} style={styles.card}>
                <Text style={styles.extraEmpty}>
                  {extraTab === 'track' ? '这个项目还没有发布动态' : '暂时没有内容'}
                </Text>
              </Glass>
            ) : (
              /* 每条一张卡片：谁 / 什么时候 / 说了什么，不再糊成一段 */
              extraItems.map((item, i) => (
                <Glass key={i} corner={R.md} style={styles.cmtCard}>
                  <View style={styles.cmtHead}>
                    <View style={styles.cmtAvatar}>
                      <Icon name="person" size={13} color={colors.primary} />
                    </View>
                    <Text style={styles.cmtAuthor}>{item.author || '匿名志愿者'}</Text>
                    {item.time ? <Text style={styles.cmtTime}>{item.time}</Text> : null}
                  </View>
                  <Text style={styles.cmtBody}>{item.content}</Text>
                </Glass>
              ))
            )}
          </>
        ) : null}
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
  fullHint: { fontSize: 11, color: colors.warn, marginTop: spacing.sm, lineHeight: 16 },

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

  /* 讨论区 / 项目动态 / 时长公示 */
  extraTabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  extraTab: {
    alignItems: 'center', paddingVertical: spacing.md, borderRadius: R.md,
    backgroundColor: colors.field,
    borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.glassBorder,
  },
  extraTabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  extraTabText: { fontSize: 12.5, fontWeight: '700', color: colors.textDim },
  extraTabTextOn: { color: colors.textOnAccent },
  extraLine: { fontSize: 12.5, color: colors.text, lineHeight: 20, marginBottom: 4 },
  extraEmpty: {
    fontSize: 12.5, color: colors.textFaint,
    textAlign: 'center', paddingVertical: spacing.lg,
  },

  /* 评论 / 动态条目 */
  cmtCard: { marginBottom: spacing.sm },
  cmtHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  cmtAvatar: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.primaryDim,
    alignItems: 'center', justifyContent: 'center',
  },
  cmtAuthor: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  cmtTime: { flex: 1, fontSize: 10.5, color: colors.textFaint, textAlign: 'right' },
  cmtBody: { fontSize: 12.5, color: colors.text, lineHeight: 20 },
  cmtInput: {
    minHeight: 72, fontSize: 12.5, color: colors.text, lineHeight: 19,
    backgroundColor: colors.field, borderRadius: R.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.glassBorder,
    textAlignVertical: 'top',
  },
}));
