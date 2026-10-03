/**
 * 邮箱通知 —— 发送通道实现
 * ============================================================
 * ⚠️ 先说清楚一个硬限制：
 * React Native 的 JS 层**没有原始 TCP socket**，所以没法直接连 QQ 邮箱的
 * SMTP 服务器（smtp.qq.com:465）。要直连必须引入原生模块，而现有的几个
 * RN SMTP 库（react-native-smtp-tcp、@dfmanosalva/react-native-smtp-mailer 等）
 * 在 npm 上都已标记废弃，贸然引入会破坏构建。
 *
 * 因此本模块走「HTTP 发送通道」，共三种，任选其一：
 *
 *   1. relay  —— 自己的中转接口（想把 QQ 邮箱当发件人就走这条）
 *                接口收到 { to, subject, text }，由它用 SMTP + 授权码发信。
 *                仓库里附了现成脚本：tools/qq-mail-relay/
 *
 *   2. resend —— Resend（https://resend.com）纯 HTTP 直发，无需服务器。
 *
 *   3. brevo  —— Brevo（https://brevo.com）纯 HTTP 直发，无需服务器。
 *                可把 QQ 邮箱验证为发件人，免费额度 300 封/天。
 *
 * 三种都不需要原生代码，改完即生效（Expo Go 里也能用）。
 */
import { Platform } from 'react-native';
import type { EmailProvider } from './types';

/** 发送配置（从 App 设置里取） */
export interface MailConfig {
  provider: EmailProvider;
  /** relay 模式：中转接口地址 */
  relayUrl: string;
  /** resend / brevo 模式：API Key */
  apiKey: string;
  /** 发件人地址（brevo 必须是验证过的邮箱；resend 留空用其默认发件人） */
  from: string;
}

/** 一封邮件 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** 发送结果 */
export interface MailResult {
  ok: boolean;
  /** 失败原因（可直接显示给用户） */
  reason?: string;
}

/** 各通道接口地址 */
export const PROVIDER_ENDPOINTS = {
  resend: 'https://api.resend.com/emails',
  brevo: 'https://api.brevo.com/v3/smtp/email',
} as const;

/** 从 App 设置里取出邮件配置 */
export function mailConfigFromSettings(s: {
  emailProvider: EmailProvider;
  emailRelayUrl: string;
  emailApiKey: string;
  emailFrom: string;
}): MailConfig {
  return {
    provider: s.emailProvider,
    relayUrl: s.emailRelayUrl.trim(),
    apiKey: s.emailApiKey.trim(),
    from: s.emailFrom.trim(),
  };
}

/** QQ 邮箱 SMTP 参数（给中转脚本用；App 本身不直连） */
export const QQ_SMTP_INFO = {
  host: 'smtp.qq.com',
  port: 465,
  secure: true,
  /** 填的是「授权码」，不是 QQ 登录密码 */
  authNote: '密码位置填 QQ 邮箱设置里生成的 16 位授权码',
} as const;

/** 通道说明，设置页与教程页共用 */
export const PROVIDER_LABELS: Record<EmailProvider, { name: string; hint: string }> = {
  none: { name: '未配置', hint: '还没选择发送通道' },
  relay: { name: '自建中转（可让 QQ 邮箱直发）', hint: '需部署 tools/qq-mail-relay' },
  resend: { name: 'Resend', hint: '纯 HTTP，无需服务器，Key 形如 re_xxx' },
  brevo: { name: 'Brevo', hint: '纯 HTTP，可把 QQ 邮箱验证为发件人' },
};

/**
 * 校验配置是否完整
 * @returns ok=false 时 reason 说明缺什么
 */
export function validateMailConfig(cfg: MailConfig): MailResult {
  if (!cfg || cfg.provider === 'none') {
    return { ok: false, reason: '还没有选择发送通道' };
  }
  if (cfg.provider === 'relay') {
    if (!cfg.relayUrl) return { ok: false, reason: '还没有填写中转接口地址' };
    if (!/^https?:\/\//i.test(cfg.relayUrl)) {
      return { ok: false, reason: '中转接口地址要以 http:// 或 https:// 开头' };
    }
    return { ok: true };
  }
  if (cfg.provider === 'resend' || cfg.provider === 'brevo') {
    if (!cfg.apiKey) return { ok: false, reason: '还没有填写 API Key' };
    if (cfg.provider === 'brevo' && !cfg.from) {
      return { ok: false, reason: 'Brevo 必须填「发件人邮箱」（需已在后台验证）' };
    }
    return { ok: true };
  }
  return { ok: false, reason: '发送通道配置不完整' };
}

/** 带超时的 fetch */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 20000
): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 平台信息，方便中转端识别来源 */
function userAgent(): string {
  return `VolunteerWatch/1.0 (${Platform.OS})`;
}

/**
 * 发送一封邮件
 * @param cfg 发送配置
 * @param msg 邮件内容
 */
export async function sendMail(cfg: MailConfig, msg: MailMessage): Promise<MailResult> {
  const check = validateMailConfig(cfg);
  if (!check.ok) return check;

  if (!msg?.to) return { ok: false, reason: '没有填写收件邮箱' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(msg.to)) {
    return { ok: false, reason: `收件邮箱格式不对：${msg.to}` };
  }

  try {
    if (cfg.provider === 'relay') return await sendViaRelay(cfg, msg);
    if (cfg.provider === 'resend') return await sendViaResend(cfg, msg);
    if (cfg.provider === 'brevo') return await sendViaBrevo(cfg, msg);
    return { ok: false, reason: `未知的发送通道：${cfg.provider}` };
  } catch (e) {
    const err = e as Error;
    const detail = err?.name === 'AbortError' ? '请求超时（20 秒）' : err?.message;
    return { ok: false, reason: `发送失败：${detail}` };
  }
}

/** 通道 1：自建中转。约定请求体 { to, subject, text, from? } */
async function sendViaRelay(cfg: MailConfig, msg: MailMessage): Promise<MailResult> {
  const res = await fetchWithTimeout(cfg.relayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent() },
    body: JSON.stringify({
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      from: cfg.from || undefined,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      reason: `中转接口返回 HTTP ${res.status}${body ? `：${body.slice(0, 140)}` : ''}`,
    };
  }
  return { ok: true };
}

/** 通道 2：Resend */
async function sendViaResend(cfg: MailConfig, msg: MailMessage): Promise<MailResult> {
  const res = await fetchWithTimeout(PROVIDER_ENDPOINTS.resend, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
      'User-Agent': userAgent(),
    },
    body: JSON.stringify({
      from: cfg.from || 'onboarding@resend.dev',
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      reason: `Resend 返回 HTTP ${res.status}${body ? `：${body.slice(0, 140)}` : ''}`,
    };
  }
  return { ok: true };
}

/** 通道 3：Brevo */
async function sendViaBrevo(cfg: MailConfig, msg: MailMessage): Promise<MailResult> {
  const res = await fetchWithTimeout(PROVIDER_ENDPOINTS.brevo, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': cfg.apiKey,
      'User-Agent': userAgent(),
    },
    body: JSON.stringify({
      sender: { email: cfg.from },
      to: [{ email: msg.to }],
      subject: msg.subject,
      textContent: msg.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      reason: `Brevo 返回 HTTP ${res.status}${body ? `：${body.slice(0, 140)}` : ''}`,
    };
  }
  return { ok: true };
}

/** 把「发现新项目」组织成一封邮件并发出 */
export async function sendNewProjectsMail(
  cfg: MailConfig,
  orgName: string,
  items: { name: string; date: string; status: string; url: string }[],
  to: string
): Promise<MailResult> {
  const lines = items.map(
    (it, i) =>
      `${i + 1}. ${it.name}${it.date ? `（${it.date}）` : ''}${
        it.status ? ` [${it.status}]` : ''
      }\n   ${it.url}`
  );
  return sendMail(cfg, {
    to,
    subject: `【志愿项目提醒】${orgName} 有 ${items.length} 个新项目`,
    text:
      `${orgName} 发现 ${items.length} 个新志愿项目：\n\n` +
      `${lines.join('\n\n')}\n\n` +
      '—— 来自「志愿项目监控」App',
  });
}

/** 发一封测试邮件，用于在设置页验证配置是否正确 */
export async function sendTestMail(cfg: MailConfig, to: string): Promise<MailResult> {
  return sendMail(cfg, {
    to,
    subject: '【志愿项目监控】测试邮件',
    text:
      '如果你收到这封邮件，说明邮箱通知配置成功。\n\n' +
      '以后发现新的志愿项目时，会自动往这个邮箱发一封提醒。\n\n' +
      '—— 来自「志愿项目监控」App',
  });
}
