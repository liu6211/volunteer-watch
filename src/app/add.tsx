/**
 * 添加团体页（独立页面，不是标签页）
 *
 * 放在根级路由而不是 (tabs) 里，这样它天生带返回按钮，
 * 添加完跳详情后返回也能正常回到列表，不会「卡住」。
 */
import React, { useMemo, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '../lib/store';
import { colors, radius as R, spacing } from '../lib/theme';
import { themedStyles } from '../lib/theme';
import { Backdrop, Glass, GlassButton, Icon, Tap } from '../components/ui';

/** 示例链接：只留实测可用的那个 */
const EXAMPLES = [
  {
    label: '都匀三中青年志愿者服务队（贵州站）',
    url: 'https://gz.zhiyuanyun.com/app/org/view.php?id=Vl6t7DSgAHI3O',
  },
];

export default function AddTeamScreen() {
  const { addWatchFromUrl } = useStore();
  const insets = useSafeAreaInsets();

  // 支持从别处带一个预填链接进来
  const params = useLocalSearchParams<{ url?: string }>();
  const [url, setUrl] = useState(params.url ?? '');
  const [alias, setAlias] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /** 边输入边给出解析提示 */
  const preview = useMemo(() => {
    const raw = url.trim();
    if (!raw) return null;
    if (!/^https?:\/\//i.test(raw) && !raw.includes('/') && !raw.includes('.')) {
      return { ok: true, text: `按团体 id 识别：${raw}（默认站点 gz.zhiyuanyun.com）` };
    }
    try {
      const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      const id = u.searchParams.get('id');
      if (!id) return { ok: false, text: '这个链接里没有 ?id= 参数' };
      return { ok: true, text: `站点 ${u.hostname} · 团体 id ${id}` };
    } catch {
      return { ok: false, text: '链接格式不对' };
    }
  }, [url]);

  const onSubmit = async () => {
    setError('');
    const raw = url.trim();
    if (!raw) {
      setError('请先填写团体链接');
      return;
    }
    setBusy(true);
    try {
      const res = await addWatchFromUrl(raw, alias.trim() || undefined);
      setUrl('');
      setAlias('');
      // replace：把「添加页」换成「详情页」，
      // 这样返回键会回到列表，而不会退回空的添加表单
      router.replace(`/team/${res.key}`);

      // 首次抓取失败要明确提示，否则用户以为加成功了却什么都没监控到
      if (res.firstResult?.startsWith('检查失败')) {
        setTimeout(() => {
          Alert.alert(
            '抓取失败',
            `${res.firstResult}\n\n团体已加入列表，但可能是链接不对或该站点上没有这个团体。\n可以稍后重试，或长按卡片删除。`
          );
        }, 350);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
      <View style={styles.screen}>
        <Backdrop />
      <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 64 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Glass corner={R.lg}>
          <View style={styles.labelRow}>
            <Icon name="link-outline" size={15} color={colors.textDim} />
            <Text style={styles.label}>团体链接</Text>
          </View>
          <Text style={styles.hint}>
            打开志愿云某个团体的主页，把浏览器地址栏的整条链接复制过来。
            要用「团体页」的链接（地址里带 org/view.php?id=）。
          </Text>

          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder="https://gz.zhiyuanyun.com/app/org/view.php?id=..."
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />

          {preview ? (
            <View style={styles.previewRow}>
              <Icon
                name={preview.ok ? 'checkmark-circle' : 'close-circle'}
                size={14}
                color={preview.ok ? colors.primary : colors.danger}
              />
              <Text
                style={[styles.previewText, { color: preview.ok ? colors.primary : colors.danger }]}
              >
                {preview.text}
              </Text>
            </View>
          ) : null}

          <View style={[styles.labelRow, { marginTop: spacing.xl }]}>
            <Icon name="pricetag-outline" size={15} color={colors.textDim} />
            <Text style={styles.label}>备注名（可选）</Text>
          </View>
          <Text style={styles.hint}>填了就用它显示，方便区分多个团体。</Text>
          <TextInput
            style={styles.input}
            value={alias}
            onChangeText={setAlias}
            placeholder="例如：都匀三中"
            placeholderTextColor={colors.textFaint}
          />

          {error ? (
            <View style={styles.errorBox}>
              <Icon name="alert-circle" size={15} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </Glass>

        <GlassButton
          label={busy ? '正在抓取…' : '添加并立即抓取'}
          icon={busy ? undefined : 'cloud-download-outline'}
          loading={busy}
          variant="primary"
          onPress={() => { void onSubmit(); }}
          style={styles.submit}
        />

        {/* 示例 */}
        <View style={styles.labelRow}>
          <Icon name="bulb-outline" size={15} color={colors.textDim} />
          <Text style={styles.label}>示例链接</Text>
        </View>
        {EXAMPLES.map((ex) => (
          <Tap
            key={ex.url}
            onPress={() => { setUrl(ex.url); setError(''); }}
            style={styles.exampleWrap}
          >
            <Glass corner={R.md} style={styles.example}>
              <View style={styles.exampleRow}>
                <Icon name="document-text-outline" size={15} color={colors.info} />
                <Text style={styles.exampleLabel} numberOfLines={1}>{ex.label}</Text>
                <Icon name="chevron-forward" size={15} color={colors.textFaint} />
              </View>
              <Text style={styles.exampleUrl} numberOfLines={2}>{ex.url}</Text>
            </Glass>
          </Tap>
        ))}

        <Glass corner={R.md} style={styles.note}>
          <View style={styles.noteRow}>
            <Icon name="information-circle-outline" size={16} color={colors.warn} />
            <Text style={styles.noteText}>
              第一次添加时会自动把当前已有的项目全部记为「已知」，之后只有真正新出现的
              项目才会通知你，不会一装上就刷一堆。
            </Text>
          </View>
        </Glass>
      </ScrollView>
    </KeyboardAvoidingView>
 </View>
     );
}

const styles = themedStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },

  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs },
  label: { fontSize: 14, fontWeight: '800', color: colors.text },
  hint: { fontSize: 12, color: colors.textDim, lineHeight: 18, marginBottom: spacing.md },

  input: {
    backgroundColor: colors.field,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.glassBorder,
    borderRadius: R.sm,
    padding: spacing.md,
    fontSize: 14,
    color: colors.text,
    minHeight: 48,
  },

  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.sm },
  previewText: { fontSize: 12, flex: 1 },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.lg,
    backgroundColor: colors.dangerDim,
    borderRadius: R.sm,
    padding: spacing.md,
  },
  errorText: { color: colors.danger, fontSize: 13, flex: 1 },

  submit: { marginTop: spacing.lg },

  exampleWrap: { marginBottom: spacing.sm, borderRadius: R.md },
  example: { padding: spacing.md },
  exampleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  exampleLabel: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.text },
  exampleUrl: { fontSize: 11, color: colors.info, marginTop: 4, lineHeight: 16 },

  note: { marginTop: spacing.xl },
  noteRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  noteText: { flex: 1, fontSize: 12, color: colors.textDim, lineHeight: 19 },
}));
