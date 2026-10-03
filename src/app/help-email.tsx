/**
 * 邮箱通知配置教程
 *
 * 现在只有一种方式：用你自己的邮箱账号直接发信（SMTP + 授权码）。
 * 不再需要服务器、也不需要第三方邮件服务。
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QQ_SMTP_INFO } from '../lib/email';
import { colors, radius as R, spacing, themedStyles } from '../lib/theme';
import { Backdrop, Glass, Icon } from '../components/ui';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Glass corner={R.lg}>{children}</Glass>
    </View>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <Text style={styles.p}>{children}</Text>;
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNo}><Text style={styles.stepNoText}>{n}</Text></View>
      <Text style={styles.stepText}>{children}</Text>
    </View>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.code}>
      <Text style={styles.codeText}>{children}</Text>
    </View>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.warn}>
      <Icon name="alert-circle-outline" size={15} color={colors.warn} />
      <Text style={styles.warnText}>{children}</Text>
    </View>
  );
}

export default function HelpEmailScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <Backdrop />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 70, paddingBottom: spacing.xxl },
        ]}
      >
        <Text style={styles.title}>邮箱通知怎么配</Text>
        <Text style={styles.subtitle}>
          用你自己的邮箱给自己发提醒，不需要服务器
        </Text>

        <Section title="它是怎么发的">
          <P>
            App 直接用你的邮箱账号，通过 {QQ_SMTP_INFO.host}（端口 {QQ_SMTP_INFO.port}，加密）
            把邮件发出去 —— 就像电脑上的邮件客户端那样。
          </P>
          <P>
            所以<Text style={styles.b}>不需要买服务器，也不用注册第三方服务</Text>。
            只差一样东西：邮箱授权码。
          </P>
        </Section>

        <Section title="第一步：拿到 QQ 邮箱授权码">
          <P>
            <Text style={styles.b}>授权码不是你的 QQ 密码</Text>，
            而是一串 16 位字母，专门给程序发信用。拿到它只能发邮件，不能登录你的邮箱。
          </P>
          {QQ_SMTP_INFO.steps.map((s, i) => (
            <Step key={i} n={i + 1}>{s}</Step>
          ))}
          <Warn>
            授权码在页面上只显示一次，记得先复制下来。忘了就重新生成一个，旧的会失效。
          </Warn>
        </Section>

        <Section title="第二步：填到 App 里">
          <P>回到「设置 → 邮箱通知」，填三个地方：</P>
          <Code>{'发信邮箱　　you@qq.com\n邮箱授权码　刚才那串 16 位\n收件邮箱　　不填就发给自己'}</Code>
          <P>然后点「发送测试邮件」。收到了就说明配好了。</P>
        </Section>

        <Section title="发不出去怎么查">
          <View style={styles.errRow}>
            <Text style={styles.errTitle}>535 认证失败</Text>
            <Text style={styles.errText}>
              授权码填错了。注意是 16 位授权码而不是 QQ 登录密码，
              也要确认邮箱里已经开启「SMTP 服务」。
            </Text>
          </View>
          <View style={styles.errRow}>
            <Text style={styles.errTitle}>连接超时</Text>
            <Text style={styles.errText}>
              多半是网络问题。换个网络（比如切到流量）再试。
              部分公司网络或校园网会封发信端口。
            </Text>
          </View>
          <View style={styles.errRow}>
            <Text style={styles.errTitle}>提示不支持发邮件</Text>
            <Text style={styles.errText}>
              说明你现在用的是 Expo Go。装上正式版 App 就能发了。
            </Text>
          </View>
          <View style={styles.errRow}>
            <Text style={styles.errTitle}>收不到邮件</Text>
            <Text style={styles.errText}>
              先看垃圾邮件箱。QQ 邮箱有时会把程序发的信判成垃圾邮件，
              标记为「非垃圾邮件」以后就正常了。
            </Text>
          </View>
        </Section>
      </ScrollView>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: spacing.lg },

  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 12.5, color: colors.textDim, marginTop: 5, marginBottom: spacing.md },

  section: { marginTop: spacing.lg },
  sectionTitle: {
    fontSize: 12.5, fontWeight: '800', color: colors.textDim,
    marginBottom: spacing.sm, marginLeft: spacing.xs,
  },

  p: { fontSize: 12.5, color: colors.text, lineHeight: 20, marginBottom: spacing.sm },
  b: { fontWeight: '800', color: colors.primary },

  step: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  stepNo: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.primaryDim,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNoText: { fontSize: 11, fontWeight: '800', color: colors.primary },
  stepText: { flex: 1, fontSize: 12.5, color: colors.text, lineHeight: 19 },

  code: {
    backgroundColor: colors.field,
    borderRadius: R.sm,
    padding: spacing.md,
    marginVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.glassBorder,
  },
  codeText: { fontSize: 12, color: colors.text, lineHeight: 20 },

  warn: {
    flexDirection: 'row', gap: 6, marginTop: spacing.sm,
    backgroundColor: colors.warnDim, borderRadius: R.sm, padding: spacing.md,
  },
  warnText: { flex: 1, fontSize: 11.5, color: colors.warn, lineHeight: 18 },

  errRow: { marginBottom: spacing.md },
  errTitle: { fontSize: 12.5, fontWeight: '800', color: colors.danger },
  errText: { fontSize: 12, color: colors.textDim, lineHeight: 19, marginTop: 3 },
}));
