/**
 * 邮箱通知配置教程
 *
 * 这是一个纯说明页面，不读写任何状态，方便你（或以后接手的人）
 * 照着一步步配置。所有关键信息都写在页面上，不用去翻代码。
 */
import React, { useState } from 'react';
import {
  Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '../lib/theme';
import { Glass, GroupTitle, Icon } from '../components/ui';

/* ------------------------------------------------------------------ 小组件 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <Text style={styles.p}>{children}</Text>;
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
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
      <Text style={styles.warnText}>{children}</Text>
    </View>
  );
}

/** 可折叠的通道说明 */
function Collapsible({
  title, badge, children, defaultOpen = false,
}: {
  title: string; badge?: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.cardHead} onPress={() => setOpen((v) => !v)}>
        <Text style={styles.cardTitle}>{title}</Text>
        {badge ? <Text style={styles.badge}>{badge}</Text> : null}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.info} />
      </TouchableOpacity>
      {open ? <View style={styles.cardBody}>{children}</View> : null}
    </View>
  );
}

function Link({ url, label }: { url: string; label: string }) {
  return (
    <TouchableOpacity onPress={() => { void Linking.openURL(url); }}>
      <Text style={styles.link}>{label} ›</Text>
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ 页面 */

export default function EmailHelpScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 64 }]}
    >
      <Stack.Screen options={{ title: '邮箱通知怎么配' }} />

      <Section title="先搞清楚一件事">
        <P>
          这个 App 装在手机上，<Text style={styles.b}>不能直接连 QQ 邮箱发信</Text>。
          因为发邮件需要原始网络套接字（socket），而手机 App 的运行环境不提供；
          能直连的第三方库都已经很久没人维护，硬加会把打包搞坏。
        </P>
        <P>
          所以走「HTTP 发送通道」。下面三条路任选一条，
          <Text style={styles.b}>推荐第 2 条（Brevo）</Text>，因为它不需要你有服务器。
        </P>
      </Section>

      {/* ------------------------------------------------ 授权码 */}
      <Section title="QQ 邮箱的「授权码」怎么拿">
        <P>
          你记得的那个「密钥」就是授权码。它<Text style={styles.b}>不是</Text>你的 QQ 登录密码，
          是专门给第三方程序用的 16 位串。
        </P>
        <Step n={1}>电脑浏览器打开 QQ 邮箱网页版，登录。</Step>
        <Step n={2}>点顶部 <Text style={styles.b}>设置</Text> → <Text style={styles.b}>账号</Text>。</Step>
        <Step n={3}>
          找到「POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务」那一栏。
        </Step>
        <Step n={4}>
          把 <Text style={styles.b}>IMAP/SMTP服务</Text> 打开（会让你用手机发条短信验证）。
        </Step>
        <Step n={5}>
          验证完会弹出一个 <Text style={styles.b}>16 位授权码</Text>，形如
          {' '}<Text style={styles.b}>abcdefghijklmnop</Text>。复制保存好。
        </Step>
        <Warn>
          ⚠️ 授权码只显示一次，关掉就看不到了，但可以重新生成一个。
          千万不要填 QQ 登录密码 —— 那样一定失败。
        </Warn>
        <Code>服务器：smtp.qq.com{'\n'}端口：465（SSL）{'\n'}账号：你的QQ号@qq.com{'\n'}密码：上面那串 16 位授权码</Code>
      </Section>

      {/* ------------------------------------------------ 通道 1 */}
      <Section title="选择发送通道">
        <Collapsible title="通道 1：自建中转（想让 QQ 邮箱当发件人）" badge="需要服务器">
          <P>
            App 把邮件内容 POST 到你的中转接口，由那个程序用 QQ 的 SMTP + 授权码真正发信。
          </P>
          <P>仓库里已经附了一个现成的中转脚本：</P>
          <Code>tools/qq-mail-relay/server.js</Code>
          <P>用它需要的步骤：</P>
          <Step n={1}>
            找一台能一直开着的机器（云服务器 / 家里的电脑 / 树莓派）。
          </Step>
          <Step n={2}>
            照 <Text style={styles.b}>tools/qq-mail-relay/README.md</Text> 里的说明启动它，
            填入你的 QQ 邮箱和授权码。
          </Step>
          <Step n={3}>
            回到这个 App：设置 → 邮箱通知 → 发送通道选「自建中转」，
            把中转地址填进去，例如 <Text style={styles.b}>http://你的IP:3000/send</Text>。
          </Step>
          <Step n={4}>点「发送测试邮件」验证。</Step>
          <Warn>
            ⚠️ 手机要能访问到这台机器。同一 WiFi 下用局域网 IP 就行；
            想在外面也能用，就得有公网地址。
          </Warn>
        </Collapsible>

        <Collapsible title="通道 2：Brevo（推荐，不用服务器）" badge="最简单" defaultOpen>
          <P>
            Brevo 提供免费的邮件发送接口，纯 HTTP 调用，不需要你有服务器。
            免费额度 300 封/天，对监控通知完全够用。
          </P>
          <P>步骤：</P>
          <Step n={1}>
            注册：<Link url="https://www.brevo.com" label="brevo.com" />
          </Step>
          <Step n={2}>
            进入后台 → <Text style={styles.b}>Senders & IP</Text> → 添加你<Text style={styles.b}>自己的 QQ 邮箱</Text>为发件人，
            然后去 QQ 邮箱点确认链接完成验证。
          </Step>
          <Step n={3}>
            进入 <Text style={styles.b}>SMTP & API</Text> → <Text style={styles.b}>API Keys</Text> →
            新建一个 Key，复制。
          </Step>
          <Step n={4}>
            回到 App：发送通道选 <Text style={styles.b}>Brevo</Text>，
            填 API Key 和发件人邮箱（就是你刚验证的那个 QQ 邮箱）。
          </Step>
          <Step n={5}>点「发送测试邮件」验证。</Step>
          <Warn>
            ⚠️ 必须先在 Brevo 后台验证发件人邮箱，否则会报错。
            Brevo Code 会发到你的 QQ 邮箱，点里面的链接即可。
          </Warn>
        </Collapsible>

        <Collapsible title="通道 3：Resend（也不用服务器）" badge="备选">
          <P>
            和 Brevo 类似，纯 HTTP。免费额度 100 封/天。
            <Text style={styles.b}>未验证域名时只能用它的默认发件人</Text>，
            且只能发给注册时用的那个邮箱 —— 对本 App 来说够用。
          </P>
          <Step n={1}>
            注册：<Link url="https://resend.com" label="resend.com" />
          </Step>
          <Step n={2}>
            进入 <Text style={styles.b}>API Keys</Text> → 新建，复制（形如 re_xxx）。
          </Step>
          <Step n={3}>
            回到 App：发送通道选 <Text style={styles.b}>Resend</Text>，填 API Key。
            发件人留空即可（会用它的默认发件人）。
          </Step>
          <Step n={4}>收件邮箱填你注册 Resend 用的那个邮箱，然后点测试。</Step>
        </Collapsible>
      </Section>

      {/* ------------------------------------------------ 常见错误 */}
      <Section title="常见错误对照">
        <View style={styles.errItem}>
          <Text style={styles.errTitle}>没有收到邮件</Text>
          <Text style={styles.errBody}>
            先看 QQ 邮箱的「垃圾邮件」文件夹。然后在 App 里点一次
            「发送测试邮件」，它会直接告诉你失败原因。
          </Text>
        </View>
        <View style={styles.errItem}>
          <Text style={styles.errTitle}>535 / 认证失败</Text>
          <Text style={styles.errBody}>
            中转脚本里填错密码了 —— 要填授权码，不是 QQ 密码。
          </Text>
        </View>
        <View style={styles.errItem}>
          <Text style={styles.errTitle}>请求超时</Text>
          <Text style={styles.errBody}>
            中转地址手机访问不到（不在同一网络 / 防火墙拦了 / 地址写错）。
          </Text>
        </View>
        <View style={styles.errItem}>
          <Text style={styles.errTitle}>Resend 报 403</Text>
          <Text style={styles.errBody}>
            没验证域名时只能发给注册邮箱，换别的收件人会失败。
          </Text>
        </View>
      </Section>

      {/* ------------------------------------------------ 安全 */}
      <Section title="关于安全">
        <P>
          API Key 和授权码保存在<Text style={styles.b}>你手机本地的应用数据</Text>里（AsyncStorage），
          不会上传到任何地方。但它是明文存的，手机被别人拿到就可能看到。
        </P>
        <P>
          建议：给这些服务单独建 Key，不要用主账号的关键凭证；
          怀疑泄露时去服务商后台删掉重建即可。
        </P>
      </Section>
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ 样式 */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },

  section: { marginBottom: spacing.xl },
  sectionTitle: {
    fontSize: 15, fontWeight: '700', color: colors.text,
    marginBottom: spacing.sm,
  },
  p: { fontSize: 13, lineHeight: 21, color: colors.textDim, marginBottom: spacing.sm },
  b: { fontWeight: '700', color: colors.text },

  step: { flexDirection: 'row', marginBottom: spacing.sm, alignItems: 'flex-start' },
  stepNum: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.primaryDim,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm, marginTop: 2,
  },
  stepNumText: { fontSize: 11, fontWeight: '700', color: colors.primary },
  stepText: { flex: 1, fontSize: 13, lineHeight: 21, color: colors.textDim },

  code: {
    backgroundColor: '#1F2430', borderRadius: radius.sm,
    padding: spacing.md, marginTop: spacing.sm,
  },
  codeText: { fontSize: 12, lineHeight: 19, color: '#B8E0C8', fontFamily: 'monospace' },

  warn: {
    backgroundColor: colors.warnDim, borderRadius: radius.sm,
    padding: spacing.md, marginTop: spacing.sm,
  },
  warnText: { fontSize: 12, lineHeight: 19, color: colors.warn },

  card: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    marginBottom: spacing.sm, overflow: 'hidden',
  },
  cardHead: {
    flexDirection: 'row', alignItems: 'center',
    padding: spacing.md,
  },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  badge: {
    fontSize: 10, fontWeight: '700', color: colors.primary,
    backgroundColor: colors.primaryDim, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4, overflow: 'hidden', marginRight: spacing.sm,
  },
  chev: { fontSize: 12, color: colors.info, fontWeight: '600' },
  cardBody: {
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    paddingTop: spacing.md,
  },

  link: { fontSize: 13, color: colors.info, fontWeight: '600', marginBottom: spacing.sm },

  errItem: {
    backgroundColor: colors.card, borderRadius: radius.sm,
    padding: spacing.md, marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  errTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 2 },
  errBody: { fontSize: 12, lineHeight: 19, color: colors.textDim },
});
