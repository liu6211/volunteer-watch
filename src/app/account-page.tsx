/**
 * 账号功能详情页（通用）
 *
 * 一个页面覆盖「更多」里的所有功能：
 *   table → 拉页面、通用解析表格，渲染成卡片
 *   card  → 志愿者证：带会话把卡片图片下到缓存再显示
 *   pdf   → 时间证明：带会话下载 PDF，然后调系统分享
 *
 * 所有请求都带着登录会话，所以没登录/会话过期时要引导去登录。
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import {
  fetchGenericPage, fetchCard, certUrl, featureByKey,
} from '../core/account.mjs';
import { SEARCH_HOST } from '../core/search.mjs';
import { useStore } from '../lib/store';
import { colors, radius as R, spacing, themedStyles } from '../lib/theme';
import { Backdrop, Glass, GlassButton, Icon, Tap } from '../components/ui';

type Table = { headers: string[]; rows: string[][] };

export default function AccountPageScreen() {
  const { key } = useLocalSearchParams<{ key?: string }>();
  const feature = featureByKey(String(key || ''));
  const { state, accountSession } = useStore();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [table, setTable] = useState<Table | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');

  /** 带会话下载一个文件到缓存，返回本地 uri */
  const downloadToCache = useCallback(
    async (url: string, filename: string) => {
      const session = accountSession();
      const dest = new File(Paths.cache, filename);
      const file = await File.downloadFileAsync(url, dest, {
        // 必须带 Cookie，卡片图片和时间证明都是登录后才给的
        headers: session.cookie ? { Cookie: session.cookie } : {},
        idempotent: true,
      });
      return file.uri;
    },
    [accountSession]
  );

  const load = useCallback(async () => {
    if (!feature) { setError('未知的功能'); setLoading(false); return; }
    if (!state.account) { setExpired(true); setLoading(false); return; }

    setLoading(true);
    setError('');
    setSaved('');
    try {
      const session = accountSession();

      if (feature.kind === 'table') {
        const t = await fetchGenericPage(session, SEARCH_HOST, feature.path);
        setTable(t);
      } else if (feature.kind === 'card') {
        const { images: urls } = await fetchCard(session, SEARCH_HOST);
        // 图片需要登录才能拿，先下到本地缓存再显示
        const locals: string[] = [];
        for (let i = 0; i < urls.length; i++) {
          const ext = /\.jpe?g$/i.test(urls[i]) ? 'jpg' : 'png';
          try {
            locals.push(await downloadToCache(urls[i], `vw-card-${i}.${ext}`));
          } catch {
            // 单张失败不影响其它
          }
        }
        setImages(locals);
        if (locals.length === 0) setError('没有取到志愿者证图片');
      }
      // kind === 'pdf' 不在这里加载，等用户点下载
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      if (/过期|登录/.test(msg)) setExpired(true);
    } finally {
      setLoading(false);
    }
  }, [feature, state.account, accountSession, downloadToCache]);

  useEffect(() => {
    // 延到下一个微任务再执行：load() 一上来就会 setLoading(true)，
    // 在 effect 里同步 setState 会触发级联渲染（React 新规则会报错）
    let alive = true;
    void Promise.resolve().then(() => { if (alive) void load(); });
    return () => { alive = false; };
  }, [load]);

  /** 下载时间证明 PDF 并调系统分享 */
  const downloadCert = async () => {
    setBusy(true);
    setError('');
    try {
      const uri = await downloadToCache(certUrl(SEARCH_HOST), '志愿服务时间证明.pdf');
      setSaved('已下载，正在打开分享…');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: '志愿服务时间证明',
          UTI: 'com.adobe.pdf',
        });
      } else {
        setSaved(`已保存到：${uri}`);
      }
    } catch (e) {
      setError(`下载失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!feature) {
    return (
      <View style={styles.screen}>
        <Backdrop />
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>未知的功能</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Backdrop />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 70, paddingBottom: spacing.xxl },
        ]}
      >
        <View style={styles.head}>
          <Text style={styles.title}>{feature.title}</Text>
          <Text style={styles.subtitle}>{feature.desc}</Text>
        </View>

        {expired ? (
          <Glass corner={R.md} style={styles.errorCard}>
            <View style={styles.errorRow}>
              <Icon name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{error || '请先登录志愿云账号'}</Text>
            </View>
            <GlassButton
              label="去登录"
              icon="log-in-outline"
              variant="primary"
              onPress={() => router.push('/login')}
              style={{ marginTop: spacing.md }}
            />
          </Glass>
        ) : null}

        {!expired && error ? (
          <Glass corner={R.md} style={styles.errorCard}>
            <View style={styles.errorRow}>
              <Icon name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
            <GlassButton
              label="重试"
              icon="refresh"
              variant="glass"
              onPress={() => { void load(); }}
              style={{ marginTop: spacing.md }}
            />
          </Glass>
        ) : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>正在读取…</Text>
          </View>
        ) : null}

        {/* --------------------------------------------- 时间证明 */}
        {feature.kind === 'pdf' && !expired ? (
          <Glass corner={R.lg} style={styles.pdfCard}>
            <Icon name="document-text-outline" size={30} color={colors.primary} />
            <Text style={styles.pdfTitle}>志愿服务时间证明</Text>
            <Text style={styles.pdfDesc}>
              点下面的按钮会从志愿云生成 PDF 并下载到手机，{'\n'}
              然后自动弹出系统分享，可以存到文件、发微信等。
            </Text>
            <GlassButton
              label={busy ? '正在下载…' : '下载时间证明 PDF'}
              icon={busy ? undefined : 'download-outline'}
              loading={busy}
              variant="primary"
              onPress={() => { void downloadCert(); }}
              style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
            />
            {saved ? <Text style={styles.savedText}>{saved}</Text> : null}
          </Glass>
        ) : null}

        {/* --------------------------------------------- 志愿者证 */}
        {feature.kind === 'card' && images.length > 0 ? (
          <>
            {images.map((uri, i) => (
              <Glass key={i} corner={R.md} padded={false} style={styles.imageCard}>
                <Image source={{ uri }} style={styles.cardImage} resizeMode="contain" />
              </Glass>
            ))}
            <Text style={styles.imageHint}>
              长按图片可保存到相册（部分机型需要截屏）
            </Text>
          </>
        ) : null}

        {/* --------------------------------------------- 通用表格 */}
        {feature.kind === 'table' && table ? (
          table.rows.length === 0 ? (
            <Glass corner={R.lg} style={styles.emptyCard}>
              <Icon name="file-tray-outline" size={26} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>这里还是空的</Text>
              <Text style={styles.emptyText}>没有查到记录</Text>
            </Glass>
          ) : (
            table.rows.map((cells, i) => (
              <Glass key={i} corner={R.md} style={styles.rowCard}>
                {cells.map((cell, j) => (
                  <View key={j} style={styles.cellRow}>
                    <Text style={styles.cellLabel}>
                      {table.headers[j] || `字段${j + 1}`}
                    </Text>
                    <Text style={styles.cellValue}>{cell || '—'}</Text>
                  </View>
                ))}
              </Glass>
            ))
          )
        ) : null}

        {!loading ? (
          <Tap onPress={() => { void load(); }}>
            <View style={styles.refresh}>
              <Icon name="refresh" size={14} color={colors.textFaint} />
              <Text style={styles.refreshText}>刷新</Text>
            </View>
          </Tap>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  head: { marginBottom: spacing.lg },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 12.5, color: colors.textDim, marginTop: 5 },

  loading: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  loadingText: { fontSize: 12, color: colors.textDim },

  errorCard: { marginBottom: spacing.md },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  errorText: { flex: 1, fontSize: 12.5, color: colors.danger, lineHeight: 18 },

  pdfCard: { alignItems: 'center', gap: spacing.sm },
  pdfTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: spacing.sm },
  pdfDesc: { fontSize: 12, color: colors.textDim, textAlign: 'center', lineHeight: 19 },
  savedText: { fontSize: 11, color: colors.primary, marginTop: spacing.md, textAlign: 'center' },

  imageCard: { marginBottom: spacing.md, overflow: 'hidden' },
  cardImage: { width: '100%', height: 220 },
  imageHint: { fontSize: 10.5, color: colors.textFaint, textAlign: 'center' },

  rowCard: { marginBottom: spacing.sm, gap: spacing.sm },
  cellRow: { flexDirection: 'row', gap: spacing.md },
  cellLabel: { width: 84, fontSize: 11.5, color: colors.textFaint },
  cellValue: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 18 },

  emptyCard: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  emptyText: { fontSize: 12, color: colors.textDim },

  refresh: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: spacing.xl,
  },
  refreshText: { fontSize: 11.5, color: colors.textFaint },
}));
