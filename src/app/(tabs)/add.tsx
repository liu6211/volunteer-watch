/**
 * 添加团体页
 */
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { router } from 'expo-router';

import { useStore } from '../../lib/store';
import { colors, radius, spacing } from '../../lib/theme';

/** 示例链接，方便用户直接抄 */
const EXAMPLES = [
  {
    label: '都匀三中青年志愿者服务队（贵州）',
    url: 'https://gz.zhiyuanyun.com/app/org/view.php?id=Vl6t7DSgAHI3O',
  },
];

export default function AddTeamScreen() {
  const { addWatchFromUrl } = useStore();
  const [url, setUrl] = useState('');
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
      // 添加后直接进详情页，能马上看到抓到的项目
      router.replace(`/team/${res.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>团体链接</Text>
        <Text style={styles.hint}>
          打开志愿云某个团体的主页，把浏览器地址栏的整条链接复制过来。
          注意用「团体页」的链接（地址里带 org/view.php?id=）。
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
          <Text style={[styles.preview, { color: preview.ok ? colors.primary : colors.danger }]}>
            {preview.ok ? '✓ ' : '✕ '}{preview.text}
          </Text>
        ) : null}

        <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>备注名（可选）</Text>
        <Text style={styles.hint}>填了就用它显示，方便自己区分多个团体。</Text>
        <TextInput
          style={styles.input}
          value={alias}
          onChangeText={setAlias}
          placeholder="例如：都匀三中"
          placeholderTextColor={colors.textFaint}
        />

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.submit, busy && styles.submitDisabled]}
          onPress={() => { void onSubmit(); }}
          disabled={busy}
        >
          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.submitText}>正在抓取团体信息…</Text>
            </View>
          ) : (
            <Text style={styles.submitText}>添加并立即抓取</Text>
          )}
        </TouchableOpacity>

        <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>示例</Text>
        {EXAMPLES.map((ex) => (
          <TouchableOpacity
            key={ex.url}
            style={styles.example}
            onPress={() => { setUrl(ex.url); setError(''); }}
          >
            <Text style={styles.exampleLabel}>{ex.label}</Text>
            <Text style={styles.exampleUrl} numberOfLines={2}>{ex.url}</Text>
          </TouchableOpacity>
        ))}

        <Text style={styles.note}>
          提示：第一次添加时会自动把当前已有的项目全部记为「已知」，
          之后只有真正新出现的项目才会通知你，不会一装上就刷一堆。
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  hint: { fontSize: 12, color: colors.textDim, lineHeight: 18, marginBottom: spacing.md },
  input: {
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 14,
    color: colors.text,
    minHeight: 48,
  },
  preview: { fontSize: 12, marginTop: spacing.sm },
  errorBox: {
    marginTop: spacing.lg,
    backgroundColor: colors.dangerDim,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  errorText: { color: colors.danger, fontSize: 13 },
  submit: {
    marginTop: spacing.xl,
    backgroundColor: colors.primary,
    height: 50,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitDisabled: { opacity: 0.7 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  example: {
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  exampleLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  exampleUrl: { fontSize: 11, color: colors.info, marginTop: 3 },
  note: {
    fontSize: 12,
    color: colors.textDim,
    lineHeight: 19,
    marginTop: spacing.xl,
    backgroundColor: colors.warnDim,
    padding: spacing.md,
    borderRadius: radius.sm,
  },
});
