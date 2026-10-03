/**
 * 登录志愿云账号
 *
 * 说明：
 *   - 密码只在内存里用于本次加密提交，【不会存到手机上】
 *   - 站点平时不需要验证码；被判定为「暴力登录」时才会要，
 *     而且要去微信公众号取码。所以验证码输入框平时是隐藏的，
 *     只有在登录失败且服务器明确要求时才出现。
 */
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '../lib/store';
import { colors, radius as R, spacing, themedStyles } from '../lib/theme';
import { Backdrop, Glass, GlassButton, Icon, Tap } from '../components/ui';

export default function LoginScreen() {
  const { state, loginAccount, savedUsername, hasSavedCredentials } = useStore();
  const insets = useSafeAreaInsets();

  const [username, setUsername] = useState(state.account?.username ?? '');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [needCaptcha, setNeedCaptcha] = useState(false);
  const [captchaHint, setCaptchaHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [diag, setDiag] = useState('');
  const [remember, setRemember] = useState(true);
  const [hasSaved, setHasSaved] = useState(false);

  // 预填上次的用户名，并默认勾上「记住密码」
  useEffect(() => {
    let alive = true;
    (async () => {
      const [name, saved] = await Promise.all([savedUsername(), hasSavedCredentials()]);
      if (!alive) return;
      if (name) setUsername((cur) => cur || name);
      setHasSaved(saved);
    })();
    return () => { alive = false; };
  }, [savedUsername, hasSavedCredentials]);

  const submit = async () => {
    setBusy(true);
    setError('');
    setDiag('');
    try {
      const res = await loginAccount(username, password, captcha || undefined, remember);
      if (res.ok) {
        setPassword('');
        router.replace('/account');
        return;
      }
      if (res.needCaptcha) {
        // 需要验证码：这是提示，不是错误，用引导性文案
        setNeedCaptcha(true);
        setCaptchaHint(res.message);
        setError('');
      } else {
        // 账号密码不对等普通失败：必须明确告诉用户
        setError(res.message || '登录失败');
        if (res.diag) setDiag(res.diag);
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
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 70, paddingBottom: spacing.xxl },
          ]}
        >
          <Text style={styles.title}>登录志愿云</Text>
          <Text style={styles.subtitle}>
            登录后可以查看「我的项目」「我的团体」「服务时长」
          </Text>

          <Glass corner={R.lg} style={styles.card}>
            <Text style={styles.label}>用户名</Text>
            <View style={styles.field}>
              <Icon name="person-outline" size={17} color={colors.textFaint} />
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder="用户名 / 志愿者编号 / 身份证号"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <Text style={[styles.label, { marginTop: spacing.lg }]}>密码</Text>
            <View style={styles.field}>
              <Icon name="lock-closed-outline" size={17} color={colors.textFaint} />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="登录密码"
                placeholderTextColor={colors.textFaint}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={() => { void submit(); }}
              />
            </View>

            {needCaptcha ? (
              <>
                <Text style={[styles.label, { marginTop: spacing.lg }]}>登录验证码</Text>
                <View style={styles.field}>
                  <Icon name="shield-outline" size={17} color={colors.warn} />
                  <TextInput
                    style={styles.input}
                    value={captcha}
                    onChangeText={setCaptcha}
                    placeholder="请输入验证码"
                    placeholderTextColor={colors.textFaint}
                    keyboardType="number-pad"
                  />
                </View>
                {captchaHint ? (
                  <View style={styles.hintBox}>
                    <Icon name="information-circle-outline" size={15} color={colors.warn} />
                    <Text style={styles.hintText}>{captchaHint}</Text>
                  </View>
                ) : null}
              </>
            ) : null}

            {/* 记住密码：网站本身每次都要重登，靠这个自动登录 */}
            <View style={styles.rememberRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rememberTitle}>记住密码（自动登录）</Text>
                <Text style={styles.rememberHint}>
                  密码存在手机的系统加密存储里（iOS 钥匙串），不会明文保存
                </Text>
              </View>
              <Switch
                value={remember}
                onValueChange={setRemember}
                trackColor={{ true: colors.primary, false: colors.track }}
              />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Icon name="alert-circle" size={16} color={colors.danger} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.errorText}>{error}</Text>
                  {diag ? <Text style={styles.diagText}>{diag}</Text> : null}
                </View>
              </View>
            ) : null}

            <GlassButton
              label={busy ? '登录中…' : '登 录'}
              icon={busy ? undefined : 'log-in-outline'}
              loading={busy}
              variant="primary"
              onPress={() => { void submit(); }}
              style={{ marginTop: spacing.xl }}
            />

            <View style={styles.safeRow}>
              <Icon name="shield-checkmark-outline" size={13} color={colors.textFaint} />
              <Text style={styles.safeText}>
                密码只在本次登录时用于加密提交，不会保存到手机
              </Text>
            </View>
          </Glass>

          {needCaptcha ? (
            <Glass corner={R.md} style={styles.helpCard}>
              <Text style={styles.helpTitle}>验证码怎么拿？</Text>
              <Text style={styles.helpText}>
                站点为避免暴力登录会要验证码：{'\n'}
                1. 微信关注「志愿云」相关公众号{'\n'}
                2. 回复：登录验证码{'\n'}
                3. 点它给的链接，把码填到上面
              </Text>
            </Glass>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: spacing.lg },

  title: { fontSize: 26, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 12.5, color: colors.textDim, marginTop: 6, marginBottom: spacing.lg },

  card: { marginTop: spacing.sm },
  label: { fontSize: 12, fontWeight: '700', color: colors.textDim, marginBottom: spacing.sm },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.field,
    borderRadius: R.sm,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.glassBorder,
  },
  input: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: spacing.md },

  hintBox: {
    flexDirection: 'row', gap: 6, marginTop: spacing.md,
    backgroundColor: colors.warnDim, borderRadius: R.sm, padding: spacing.md,
  },
  hintText: { flex: 1, fontSize: 12, color: colors.warn, lineHeight: 18 },

  rememberRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginTop: spacing.xl,
  },
  rememberTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  rememberHint: { fontSize: 10.5, color: colors.textFaint, marginTop: 3, lineHeight: 15 },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg,
    backgroundColor: colors.dangerDim, borderRadius: R.sm, padding: spacing.md,
  },
  errorText: { flex: 1, fontSize: 12.5, color: colors.danger, lineHeight: 18 },
  diagText: { fontSize: 10.5, color: colors.textFaint, marginTop: 6, lineHeight: 15 },

  safeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, marginTop: spacing.lg,
  },
  safeText: { fontSize: 10.5, color: colors.textFaint },

  helpCard: { marginTop: spacing.lg },
  helpTitle: { fontSize: 13.5, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  helpText: { fontSize: 12, color: colors.textDim, lineHeight: 19 },
}));
