/**
 * 邮箱通知 —— 用你自己的邮箱账号直接发信
 * ============================================================
 * 实现方式：SMTP + QQ 邮箱授权码（smtp.qq.com:465，隐式 TLS）
 *
 * ⚠️ 两个必须知道的事实：
 *
 *   1. React Native 自身【没有原始 TCP 能力】，
 *      发邮件要靠 react-native-tcp-socket 这个原生模块。
 *      它不在 Expo Go 里，所以：
 *        · Expo Go 中本功能不可用（会给出明确提示，不会崩）
 *        · 装正式版 App 后可用
 *
 *   2. QQ 邮箱要填的是【授权码】，不是登录密码。
 *      在 QQ 邮箱「设置 → 账号 → POP3/SMTP服务」里生成，
 *      是一串 16 位字母。
 */
import type { EmailProvider } from './types';
import { isSmtpSupported, sendMailViaSmtp } from './smtp';

/** 发送配置（从 App 设置里取） */
export interface MailConfig {
  provider: EmailProvider;
  /** 发信邮箱 */
  user: string;
  /** 授权码 */
  pass: string;
}

/** 一封邮件 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailResult {
  ok: boolean;
  reason?: string;
}

/** 从 App 设置里取发送配置 */
export function mailConfigFromSettings(s: {
  emailProvider?: EmailProvider;
  emailUser?: string;
  emailPass?: string;
}): MailConfig {
  return {
    provider: s.emailProvider ?? 'none',
    user: (s.emailUser ?? '').trim(),
    pass: (s.emailPass ?? '').trim(),
  };
}

/** 设置页展示用的说明文案 */
export const PROVIDER_LABELS: Record<EmailProvider, { name: string; hint: string }> = {
  none: { name: '未配置', hint: '填写下面的邮箱信息后开启' },
  smtp: { name: '自己的邮箱直发', hint: '用 QQ 邮箱授权码直接发信，不需要任何服务器' },
};

/** 检查配置是否齐了 */
export function validateMailConfig(cfg: MailConfig): MailResult {
  if (!cfg.user) return { ok: false, reason: '还没填发信邮箱' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.user)) {
    return { ok: false, reason: '发信邮箱格式不对' };
  }
  if (!cfg.pass) return { ok: false, reason: '还没填邮箱授权码' };
  if (cfg.pass.length < 8) return { ok: false, reason: '授权码看起来太短了，QQ 邮箱是 16 位' };

  const st = isSmtpSupported();
  if (!st) {
    return {
      ok: false,
      reason: '当前是 Expo Go，没有 socket 能力；装上正式版 App 才能发信',
    };
  }
  return { ok: true };
}

/** 发一封邮件 */
export async function sendMail(cfg: MailConfig, msg: MailMessage): Promise<MailResult> {
  const check = validateMailConfig(cfg);
  if (!check.ok) return check;

  try {
    await sendMailViaSmtp(
      { user: cfg.user, pass: cfg.pass },
      msg.to || cfg.user,
      msg.subject,
      msg.text
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** 有新项目时的提醒邮件 */
export async function sendNewProjectsMail(
  cfg: MailConfig,
  orgName: string,
  projects: { name: string; status?: string; date?: string }[],
  to: string
): Promise<MailResult> {
  const lines = projects.length
    ? projects.map((p, i) =>
        `${i + 1}. ${p.name}${p.status ? `（${p.status}）` : ''}${p.date ? ` ${p.date}` : ''}`)
    : ['（没有详情）'];

  const subject = `【志愿项目提醒】${orgName} 有 ${projects.length} 个新项目`;
  const text = [
    `你监控的团体「${orgName}」发现 ${projects.length} 个新项目：`,
    '',
    ...lines,
    '',
    '—— 来自「志愿项目监控」App',
  ].join('\n');

  return sendMail(cfg, { to, subject, text });
}

/** 设置页用来验证配置是否真的能发信 */
export async function sendTestMail(cfg: MailConfig, to?: string): Promise<MailResult> {
  const now = new Date().toLocaleString('zh-CN');
  return sendMail(cfg, {
    to: (to || '').trim() || cfg.user,
    subject: '【志愿项目监控】测试邮件',
    text: [
      '收到这封邮件说明邮箱提醒已经配置成功。',
      '',
      `发送时间：${now}`,
      `发信邮箱：${cfg.user}`,
      '',
      '以后监控到新项目时会自动给你发邮件。',
    ].join('\n'),
  });
}

/** QQ 邮箱授权码的获取步骤（设置页/hint 用） */
export const QQ_SMTP_INFO = {
  host: 'smtp.qq.com',
  port: 465,
  steps: [
    '打开 QQ 邮箱网页版 → 设置 → 账号',
    '找到「POP3/IMAP/SMTP 服务」，开启「SMTP 服务」',
    '按提示发短信验证，会得到一串 16 位授权码',
    '把授权码填到 App 里（不是 QQ 登录密码）',
  ],
};
