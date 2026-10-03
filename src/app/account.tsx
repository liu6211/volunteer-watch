/**
 * 志愿云账号数据页：我的项目 / 我的团体 / 服务时长
 *
 * 三个列表共用一套玻璃卡片风格，顶部用分段控件切换。
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  fetchMyProjects, fetchMyOrgs, fetchMyHours, ACCOUNT_FEATURES, cancelApplication,
  fetchJobOptions, changeJob, applyHour, submitScore, leaveOrg,
} from '../core/account.mjs';
import { SEARCH_HOST } from '../core/search.mjs';
import { useStore } from '../lib/store';
import { colors, radius as R, spacing, themedStyles } from '../lib/theme';
import { Backdrop, Glass, GlassButton, Icon, Tap, type IconName } from '../components/ui';
import { alertSiteFallback, openSite, SITE_PATHS } from '../lib/siteFallback';

type Panel =
  | { kind: '' }
  | { kind: 'job'; oppId: string; name: string; loading: boolean; jobs: { id: string; name: string }[]; picked: string }
  | { kind: 'hour'; oppId: string; name: string; hour: string; memo: string }
  | { kind: 'score'; oppId: string; name: string; scoreId: string; s1: number; s2: number; s3: number; content: string };

type Tab = 'projects' | 'orgs' | 'hours' | 'more';

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'projects', label: '我的项目', icon: 'albums-outline' },
  { key: 'orgs', label: '我的团体', icon: 'people-outline' },
  { key: 'hours', label: '服务时长', icon: 'time-outline' },
  { key: 'more', label: '更多', icon: 'grid-outline' },
];

interface Data {
  projects: { items: any[] } | null;
  orgs: { items: any[] } | null;
  hours: { items: any[]; total: number | null; effective: number | null } | null;
}

export default function AccountScreen() {
  const { state, accountSession, logoutAccount, markAccountSynced, verifyAccount, autoLogin } = useStore();
  const insets = useSafeAreaInsets();

  const account = state.account;
  const [tab, setTab] = useState<Tab>('projects');
  const [data, setData] = useState<Data>({ projects: null, orgs: null, hours: null });
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  /** 正在取消报名的报名记录编号 */
  const [canceling, setCanceling] = useState('');
  /** 正在退出团体的团体编号 */
  const [leaving, setLeaving] = useState('');
  /** 更换岗位 / 申请时长 / 评价 的内联表单 */
  const [panel, setPanel] = useState<Panel>({ kind: '' });
  const [panelBusy, setPanelBusy] = useState(false);

  const load = useCallback(
    async (which: Tab, isRefresh = false) => {
      if (!account) return;
      if (isRefresh) setRefreshing(true); else setLoading(true);
      setError('');
      try {
        const session = accountSession();
        if (which === 'projects') {
          const r = await fetchMyProjects(session, SEARCH_HOST);
          setData((d) => ({ ...d, projects: r }));
        } else if (which === 'orgs') {
          const r = await fetchMyOrgs(session, SEARCH_HOST);
          setData((d) => ({ ...d, orgs: r }));
        } else {
          const r = await fetchMyHours(session, SEARCH_HOST);
          setData((d) => ({ ...d, hours: r }));
        }
        setExpired(false);
        void markAccountSynced();
      } catch (e) {
        const msg = (e as Error).message;
        setError(msg);
        if (/过期|登录/.test(msg)) setExpired(true);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [account, accountSession, markAccountSynced]
  );

  // 进页面时校验一次会话，再拉当前分页的数据
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!account) return;
      const ok = await verifyAccount();
      if (!alive) return;
      if (!ok) {
        // 会话过期：先试着用保存的凭据自动登录一次，成功就无感恢复
        const auto = await autoLogin().catch(() => ({ ok: false, message: '自动登录失败' }));
        if (!alive) return;
        if (!auto.ok) {
          setExpired(true);
          const m = auto as { needCaptcha?: boolean; message?: string };
          setError(
            m.needCaptcha
              ? '登录已过期，而且这次需要验证码，请手动登录'
              : (m.message || '登录已过期，请重新登录')
          );
          return;
        }
      }
      void load('projects');
    })();
    return () => { alive = false; };
    // 只在登录用户变化时执行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.loginAt]);

  /**
   * 退出团体 / 删除申请（站点里叫 del_org_vol）。
   * status: 2 = 已加入→脱离；1 = 申请中→删除
   */
  const onLeaveOrg = (item: { name: string; orgId: string; status: string; actions: { fn: string; args: string[] }[] }) => {
    const act = item.actions.find((a) => a.fn === 'del_org_vol');
    const status = act?.args[1] || (item.status.includes('已加入') ? '2' : '1');
    const isLeave = status === '2';

    Alert.alert(
      isLeave ? '脱离团体' : '删除申请',
      isLeave
        ? `确定退出「${item.name}」吗？\n\n退出后不再属于该团体，需要重新申请加入。`
        : `确定删除对「${item.name}」的加入申请吗？`,
      [
        { text: '再想想', style: 'cancel' },
        {
          text: isLeave ? '确定脱离' : '确定删除',
          style: 'destructive',
          onPress: async () => {
            setLeaving(item.orgId);
            try {
              await autoLogin().catch(() => undefined);
              const r = await leaveOrg(accountSession(), SEARCH_HOST, item.orgId, status);
              if (r.ok) {
                Alert.alert('已处理', r.message);
              } else {
                alertSiteFallback('没成功', r.message, SITE_PATHS.myOrgs);
              }
              if (r.ok) await load('orgs');
            } catch (e) {
              Alert.alert('出错', (e as Error).message);
            } finally {
              setLeaving('');
            }
          },
        },
      ]
    );
  };

  /**
   * 三个写操作（更换岗位 / 申请时长 / 评价）统一提交：
   * 先自动重登（会话只有 30 分钟），提交后重新拉列表。
   */
  const runPanel = async (fn: () => Promise<{ ok: boolean; message: string }>) => {
    setPanelBusy(true);
    try {
      await autoLogin().catch(() => undefined);
      const r = await fn();
      if (r.ok) {
        Alert.alert('成功', r.message);
      } else {
        alertSiteFallback('没成功', r.message, SITE_PATHS.myProjects);
      }
      if (r.ok) {
        setPanel({ kind: '' });
        await load('projects');
      }
    } catch (e) {
      Alert.alert('出错', (e as Error).message);
    } finally {
      setPanelBusy(false);
    }
  };

  /** 打开「更换岗位」：先查该项目的可选岗位 */
  const openJobPanel = async (item: { oppId: string; name: string }) => {
    setPanel({ kind: 'job', oppId: item.oppId, name: item.name, loading: true, jobs: [], picked: '' });
    try {
      await autoLogin().catch(() => undefined);
      const r = await fetchJobOptions(accountSession(), SEARCH_HOST, item.oppId);
      setPanel({ kind: 'job', oppId: item.oppId, name: r.oppName || item.name, loading: false, jobs: r.jobs, picked: '' });
    } catch (e) {
      setPanel({ kind: '' });
      Alert.alert('读取岗位失败', (e as Error).message);
    }
  };

  const onSwitch = (t: Tab) => {
    setTab(t);
    const has = t === 'projects' ? data.projects : t === 'orgs' ? data.orgs : data.hours;
    if (!has) void load(t);
  };

  /**
   * 取消报名（站点里叫「删除」，只在报名后未录用前出现）。
   * 写操作 → 二次确认；结束后重新拉列表，用真实结果说话。
   */
  const onCancelApply = (item: { name: string; oppId: string; actions: { fn: string; args: string[] }[] }) => {
    const act = item.actions.find((a) => a.fn === 'del_opp_vol');
    if (!act) return;
    const status = act.args[1] || '1';   // 1=删除 2=拒绝 3=脱离

    Alert.alert(
      '取消报名',
      `确定取消「${item.name}」的报名吗？\n\n取消后需要重新报名。`,
      [
        { text: '再想想', style: 'cancel' },
        {
          text: '确定取消',
          style: 'destructive',
          onPress: async () => {
            setCanceling(item.oppId);
            try {
              await autoLogin().catch(() => undefined);
              const r = await cancelApplication(accountSession(), SEARCH_HOST, item.oppId, status);
              if (r.ok) {
                Alert.alert('已取消', r.message);
              } else {
                alertSiteFallback('取消失败', r.message, SITE_PATHS.myProjects);
              }
              if (r.ok) await load('projects');
            } catch (e) {
              Alert.alert('取消出错', (e as Error).message);
            } finally {
              setCanceling('');
            }
          },
        },
      ]
    );
  };

  /* ------------------------------------------------ 未登录 */

  if (!account) {
    return (
      <View style={styles.screen}>
        <Backdrop />
        <View style={[styles.center, { paddingTop: insets.top + 70 }]}>
          <Glass corner={R.lg} style={styles.emptyCard}>
            <Icon name="person-circle-outline" size={34} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>还没有登录</Text>
            <Text style={styles.emptyText}>
              登录志愿云账号后，就能在这里查看我的项目、我的团体和服务时长
            </Text>
            <GlassButton
              label="去登录"
              icon="log-in-outline"
              variant="primary"
              onPress={() => router.push('/login')}
              style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
            />
          </Glass>
        </View>
      </View>
    );
  }

  /* ------------------------------------------------ 已登录 */

  const current = tab === 'projects' ? data.projects
    : tab === 'orgs' ? data.orgs
      : tab === 'hours' ? data.hours
        : null;
  const items: any[] = current?.items ?? [];

  return (
    <View style={styles.screen}>
      <Backdrop />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 70, paddingBottom: spacing.xxl },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { void load(tab, true); }}
            tintColor={colors.primary}
          />
        }
      >
        {/* 账号信息 */}
        <Glass corner={R.md} style={styles.userCard}>
          <View style={styles.userRow}>
            <View style={styles.avatar}>
              <Icon name="person" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.userName}>{account.username}</Text>
              <Text style={styles.userMeta}>
                {expired ? '登录已过期' : `已登录 · ${account.loginAt.slice(0, 10)}`}
              </Text>
            </View>
            <Tap onPress={() => { void logoutAccount(); }}>
              <View style={styles.logoutBtn}>
                <Text style={styles.logoutText}>退出</Text>
              </View>
            </Tap>
          </View>
        </Glass>

        {expired ? (
          <Glass corner={R.md} style={styles.errorCard}>
            <View style={styles.errorRow}>
              <Icon name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{error || '登录已过期，请重新登录'}</Text>
            </View>
            <GlassButton
              label="重新登录"
              icon="log-in-outline"
              variant="glass"
              onPress={() => router.push('/login')}
              style={{ marginTop: spacing.md }}
            />
          </Glass>
        ) : null}

        {/* 分段切换 */}
        <View style={styles.segments}>
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <Tap key={t.key} onPress={() => onSwitch(t.key)} style={{ flex: 1 }}>
                <View style={[styles.segment, active && styles.segmentActive]}>
                  <Icon
                    name={t.icon}
                    size={15}
                    color={active ? colors.textOnAccent : colors.textDim}
                  />
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {t.label}
                  </Text>
                </View>
              </Tap>
            );
          })}
        </View>

        {/* 时长汇总：横向三格，紧凑不空旷。
            注意 Glass 内部有独立的 padding 容器，不会继承 flexDirection，
            所以必须 padded={false} 再自己套一层 row。 */}
        {tab === 'hours' && data.hours ? (
          <Glass corner={R.md} padded={false} style={styles.sumCard}>
            <View style={styles.sumRow}>
              <View style={styles.sumItem}>
                <Text style={styles.sumValue}>{data.hours.effective ?? 0}</Text>
                <Text style={styles.sumLabel}>已生效</Text>
              </View>
              <View style={styles.sumDivider} />
              <View style={styles.sumItem}>
                <Text style={styles.sumValue}>{data.hours.total ?? 0}</Text>
                <Text style={styles.sumLabel}>累计</Text>
              </View>
              <View style={styles.sumDivider} />
              <View style={styles.sumItem}>
                <Text style={styles.sumValue}>{data.hours.items.length}</Text>
                <Text style={styles.sumLabel}>条记录</Text>
              </View>
            </View>
          </Glass>
        ) : null}

        {/* 更多：志愿者证 / 时间证明下载 / 排班 / 培训 / 表彰 / 求证 / 评论 */}
        {tab === 'more' ? (
          <>
            {ACCOUNT_FEATURES.map((f) => (
              <Tap
                key={f.key}
                onPress={() => router.push(`/account-page?key=${f.key}`)}
              >
                <Glass corner={R.md} style={styles.featureCard}>
                  <View style={styles.featureRow}>
                    <View style={styles.featureIcon}>
                      <Icon name={f.icon as IconName} size={17} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.featureTitle}>{f.title}</Text>
                      <Text style={styles.featureDesc}>{f.desc}</Text>
                    </View>
                    <Icon name="chevron-forward" size={16} color={colors.textFaint} />
                  </View>
                </Glass>
              </Tap>
            ))}

          </>
        ) : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>正在读取…</Text>
          </View>
        ) : null}

        {!loading && !expired && tab !== 'more' && items.length === 0 ? (
          <Glass corner={R.lg} style={styles.emptyCard}>
            <Icon name="file-tray-outline" size={26} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>这里还是空的</Text>
            <Text style={styles.emptyText}>没有查到记录</Text>
          </Glass>
        ) : null}

        {/* 列表 */}
        {items.map((it, i) => (
          <Glass key={i} corner={R.md} style={styles.itemCard}>
            {tab === 'projects' ? (
              <>
                <Text style={styles.itemTitle}>{it.name}</Text>
                <View style={styles.badges}>
                  <Badge text={it.status} tone="primary" />
                  {it.post ? <Badge text={`岗位 ${it.post}`} tone="dim" /> : null}
                  {it.hours ? <Badge text={`${it.hours} 小时`} tone="dim" /> : null}
                </View>
                <Text style={styles.itemMeta}>
                  {it.org}
                  {it.joinedAt ? ` · 加入于 ${it.joinedAt}` : ''}
                </Text>

                {/* ---- 可用操作（站点上有哪个就显示哪个）---- */}
                <View style={styles.actRow}>
                  {it.actions?.some((a: { fn: string }) => a.fn === 'del_opp_vol') ? (
                    <Tap onPress={() => openSite(SITE_PATHS.myProjects)}>
                      <View style={styles.actBtnDanger}>
                        <Icon name="close-circle-outline" size={14} color={colors.danger} />
                        <Text style={styles.actBtnDangerText}>
                          {canceling === it.oppId ? '正在取消…' : '取消报名'}
                        </Text>
                      </View>
                    </Tap>
                  ) : null}

                  {it.actions?.some((a: { fn: string }) => a.fn === 'change_group_div') ? (
                    <Tap onPress={() => openSite(SITE_PATHS.myProjects)}>
                      <View style={styles.actBtn}>
                        <Icon name="swap-horizontal-outline" size={14} color={colors.primary} />
                        <Text style={styles.actBtnText}>更换岗位</Text>
                      </View>
                    </Tap>
                  ) : null}

                  {it.actions?.some((a: { fn: string }) => a.fn === 'show_apply_hour') ? (
                    <>
                      <Tap onPress={() => openSite(SITE_PATHS.myProjects)}>
                        <View style={styles.actBtn}>
                          <Icon name="time-outline" size={14} color={colors.primary} />
                          <Text style={styles.actBtnText}>申请时长</Text>
                        </View>
                      </Tap>
                      <Tap onPress={() => openSite(SITE_PATHS.myProjects)}>
                        <View style={styles.actBtn}>
                          <Icon name="star-outline" size={14} color={colors.primary} />
                          <Text style={styles.actBtnText}>评价</Text>
                        </View>
                      </Tap>
                    </>
                  ) : null}
                </View>

                {/* ---- 内联表单 ---- */}
                {panel.kind !== '' && panel.oppId === it.oppId ? (
                  <View style={styles.panel}>
                    <Text style={styles.panelTitle}>
                      {panel.kind === 'job' ? '更换岗位' : panel.kind === 'hour' ? '申请服务时长' : '评价项目'}
                    </Text>

                    {panel.kind === 'job' ? (
                      panel.loading ? (
                        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
                      ) : panel.jobs.length === 0 ? (
                        <Text style={styles.panelHint}>没有可选岗位</Text>
                      ) : (
                        <View style={styles.chips}>
                          {panel.jobs.map((j) => (
                            <Tap key={j.id} onPress={() => setPanel({ ...panel, picked: j.id })}>
                              <View style={[styles.chip, panel.picked === j.id && styles.chipActive]}>
                                <Text style={[styles.chipText, panel.picked === j.id && styles.chipTextActive]}>
                                  {j.name}
                                </Text>
                              </View>
                            </Tap>
                          ))}
                        </View>
                      )
                    ) : null}

                    {panel.kind === 'hour' ? (
                      <>
                        <View style={styles.pField}>
                          <Text style={styles.pLabel}>时长（小时）</Text>
                          <TextInput
                            style={styles.pInput}
                            value={panel.hour}
                            onChangeText={(v) => setPanel({ ...panel, hour: v })}
                            placeholder="例如 3 或 3.5"
                            placeholderTextColor={colors.textFaint}
                            keyboardType="decimal-pad"
                          />
                        </View>
                        <View style={styles.pField}>
                          <Text style={styles.pLabel}>备注</Text>
                          <TextInput
                            style={styles.pInput}
                            value={panel.memo}
                            onChangeText={(v) => setPanel({ ...panel, memo: v })}
                            placeholder="例如 10月6日上午在万达广场做秩序维护"
                            placeholderTextColor={colors.textFaint}
                          />
                        </View>
                      </>
                    ) : null}

                    {panel.kind === 'score' ? (
                      <>
                        {([
                          ['对项目开展培训的满意度', 's1'],
                          ['与志愿团体合作的满意度', 's2'],
                          ['项目执行与计划的符合度', 's3'],
                        ] as const).map(([label, key]) => (
                          <View key={key} style={styles.starRow}>
                            <Text style={styles.pLabel}>{label}</Text>
                            <View style={styles.stars}>
                              {[1, 2, 3, 4, 5].map((n) => (
                                <Tap key={n} onPress={() => setPanel({ ...panel, [key]: n } as Panel)}>
                                  <Icon
                                    name={panel[key] >= n ? 'star' : 'star-outline'}
                                    size={17}
                                    color={panel[key] >= n ? colors.warn : colors.textFaint}
                                  />
                                </Tap>
                              ))}
                            </View>
                          </View>
                        ))}
                        <View style={styles.pField}>
                          <Text style={styles.pLabel}>评价内容</Text>
                          <TextInput
                            style={styles.pInput}
                            value={panel.content}
                            onChangeText={(v) => setPanel({ ...panel, content: v })}
                            placeholder="说说感受（可留空）"
                            placeholderTextColor={colors.textFaint}
                          />
                        </View>
                      </>
                    ) : null}

                    <View style={styles.panelBtns}>
                      <GlassButton
                        label={panelBusy ? '提交中…' : '提交'}
                        loading={panelBusy}
                        variant="primary"
                        onPress={() => {
                          if (panel.kind === 'job') {
                            void runPanel(() => changeJob(accountSession(), SEARCH_HOST, panel.oppId, panel.picked));
                          } else if (panel.kind === 'hour') {
                            void runPanel(() => applyHour(accountSession(), SEARCH_HOST, panel.oppId, panel.hour, panel.memo));
                          } else if (panel.kind === 'score') {
                            void runPanel(() => submitScore(
                              accountSession(), SEARCH_HOST, panel.oppId, panel.scoreId,
                              [panel.s1, panel.s2, panel.s3], panel.content
                            ));
                          }
                        }}
                        style={{ flex: 1 }}
                      />
                      <GlassButton
                        label="取消"
                        variant="glass"
                        onPress={() => setPanel({ kind: '' })}
                        style={{ flex: 1 }}
                      />
                    </View>
                  </View>
                ) : null}
              </>
            ) : null}

            {tab === 'orgs' ? (
              <>
                <Text style={styles.itemTitle}>{it.name}</Text>
                <View style={styles.badges}>
                  <Badge text={it.status} tone={it.status.includes('已加入') ? 'primary' : 'warn'} />
                  {it.area ? <Badge text={it.area} tone="dim" /> : null}
                </View>
                <Text style={styles.itemMeta}>
                  {it.contact}
                  {it.joinedAt ? ` · 加入于 ${it.joinedAt}` : ''}
                </Text>

                {/* 脱离团体 / 删除加入申请（站点上 del_org_vol 出现时才显示） */}
                {it.actions?.some((a: { fn: string }) => a.fn === 'del_org_vol') ? (
                  <View style={styles.actRow}>
                    <Tap onPress={() => openSite(SITE_PATHS.myOrgs)}>
                      <View style={styles.actBtnDanger}>
                        <Icon name="exit-outline" size={14} color={colors.danger} />
                        <Text style={styles.actBtnDangerText}>
                          {leaving === it.orgId
                            ? '处理中…'
                            : (it.status.includes('已加入') ? '脱离团体' : '删除申请')}
                        </Text>
                      </View>
                    </Tap>
                  </View>
                ) : null}
              </>
            ) : null}

            {tab === 'hours' ? (
              <>
                <View style={styles.hoursHead}>
                  <Text style={styles.hoursValue}>{it.hours}</Text>
                  <Text style={styles.hoursUnit}>小时</Text>
                  <View style={{ flex: 1 }} />
                  <Badge
                    text={it.status}
                    tone={it.status.includes('已生效') ? 'primary' : 'warn'}
                  />
                </View>
                <Text style={styles.itemTitle}>{it.project}</Text>
                <Text style={styles.itemMeta}>
                  {it.org}
                  {it.addedBy ? ` · ${it.addedBy}` : ''}
                  {it.date ? ` · ${it.date}` : ''}
                </Text>
                {it.note ? <Text style={styles.note}>备注：{it.note}</Text> : null}
              </>
            ) : null}
          </Glass>
        ))}

        {/* 说明文字放最底下 */}
        <Text style={styles.moreHint}>
          修改资料、修改密码等编辑功能没有做，需要的请到网站操作
        </Text>
      </ScrollView>
    </View>
  );
}

function Badge({ text, tone }: { text: string; tone: 'primary' | 'warn' | 'dim' }) {
  const map = {
    primary: { fg: colors.primary, bg: colors.primaryDim },
    warn: { fg: colors.warn, bg: colors.warnDim },
    dim: { fg: colors.textDim, bg: colors.subtle },
  } as const;
  const c = map[tone];
  return (
    <View style={[badgeStyles.badge, { backgroundColor: c.bg }]}>
      <Text style={[badgeStyles.text, { color: c.fg }]}>{text}</Text>
    </View>
  );
}

const badgeStyles = themedStyles(() => StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.md, paddingVertical: 3,
    borderRadius: R.pill,
  },
  text: { fontSize: 11, fontWeight: '700' },
}));

const styles = themedStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: spacing.lg },
  center: { flex: 1, paddingHorizontal: spacing.lg, justifyContent: 'center' },

  userCard: { marginBottom: spacing.md },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.primaryDim,
    alignItems: 'center', justifyContent: 'center',
  },
  userName: { fontSize: 15, fontWeight: '800', color: colors.text },
  userMeta: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
  logoutBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: R.pill, backgroundColor: colors.subtle,
  },
  logoutText: { fontSize: 12, color: colors.danger, fontWeight: '700' },

  errorCard: { marginBottom: spacing.md },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  errorText: { flex: 1, fontSize: 12.5, color: colors.danger, lineHeight: 18 },

  segments: {
    flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md,
  },
  segment: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: spacing.md, borderRadius: R.md,
    backgroundColor: colors.field,
    borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.glassBorder,
  },
  segmentActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentText: { fontSize: 12.5, fontWeight: '700', color: colors.textDim },
  segmentTextActive: { color: colors.textOnAccent },

  sumCard: { marginBottom: spacing.md },
  sumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  sumItem: { flex: 1, alignItems: 'center' },
  sumValue: { fontSize: 24, fontWeight: '800', color: colors.primary },
  sumLabel: { fontSize: 11, color: colors.textDim, marginTop: 2 },
  sumDivider: { width: StyleSheet.hairlineWidth, height: 34, backgroundColor: colors.glassDivider },

  loading: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  loadingText: { fontSize: 12, color: colors.textDim },

  itemCard: { marginBottom: spacing.sm },

  actRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  actBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: R.pill, backgroundColor: colors.primaryDim,
  },
  actBtnText: { fontSize: 12, fontWeight: '700', color: colors.primary },

  panel: {
    marginTop: spacing.md, paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.glassDivider,
  },
  panelTitle: { fontSize: 13.5, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  panelHint: { fontSize: 12, color: colors.textFaint, marginTop: spacing.sm },
  panelBtns: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },

  pField: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.field, borderRadius: R.sm,
    paddingHorizontal: spacing.md, marginTop: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.glassBorder,
  },
  pLabel: { width: 76, fontSize: 11.5, color: colors.textFaint },
  pInput: { flex: 1, fontSize: 13, color: colors.text, paddingVertical: spacing.md },

  starRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md },
  stars: { flexDirection: 'row', gap: 6, flex: 1 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: R.pill,
    backgroundColor: colors.field,
    borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.glassBorder,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.textDim },
  chipTextActive: { color: colors.textOnAccent },
  actBtnDanger: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: R.pill, backgroundColor: colors.dangerDim,
  },
  actBtnDangerText: { fontSize: 12, fontWeight: '700', color: colors.danger },
  actHint: { flex: 1, fontSize: 10.5, color: colors.textFaint },

  featureCard: { marginBottom: spacing.sm },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  featureIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.primaryDim,
    alignItems: 'center', justifyContent: 'center',
  },
  featureTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  featureDesc: { fontSize: 11.5, color: colors.textDim, marginTop: 3 },
  moreHint: {
    fontSize: 10.5, color: colors.textFaint, textAlign: 'center',
    marginTop: spacing.lg, lineHeight: 16,
  },
  itemTitle: { fontSize: 14, fontWeight: '700', color: colors.text, lineHeight: 19 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  itemMeta: { fontSize: 11.5, color: colors.textDim, marginTop: spacing.sm, lineHeight: 17 },
  note: { fontSize: 11, color: colors.textFaint, marginTop: 4, lineHeight: 16 },

  hoursHead: { flexDirection: 'row', alignItems: 'baseline', marginBottom: spacing.sm },
  hoursValue: { fontSize: 22, fontWeight: '800', color: colors.primary },
  hoursUnit: { fontSize: 11, color: colors.textDim, marginLeft: 3 },

  emptyCard: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  emptyText: { fontSize: 12, color: colors.textDim, textAlign: 'center', lineHeight: 18 },
}));
