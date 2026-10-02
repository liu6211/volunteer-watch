/**
 * 邮箱通知接口 —— 预留接口，默认不生效
 * ============================================================
 * 需求里要求「留一个邮箱通知的接口，在代码里留着」。
 * 这里就是一个完整可用的骨架：默认 enabled=false，什么都不做。
 * 你以后想启用，只需要两步：
 *
 *   1. 在下面的 SMTP_CONFIG 里填入你的邮箱 SMTP 信息；
 *   2. 在设置页把「邮箱通知」开关打开。
 *
 * 注意：React Native 里没有内置 SMTP 客户端，直接连 SMTP 服务器需要
 * 原生模块。这里给了两种落地方案（都在 TODO 里注明）：
 *   A. 用后端中转（推荐）：把请求发到你自己的服务器，由服务器发邮件。
 *   B. 用邮件服务商的 HTTP API（如 Resend / SendGrid / 阿里云邮件推送），
 *      直接 fetch 调用，无需原生模块。
 * 当前实现按方案 A 预留了 request 结构，sendMail 里是空实现。
 */

/** 邮件服务配置（留空表示未配置） */
export const SMTP_CONFIG = {
  /** 方案 A：你自己的中转接口地址，例如 https://your-server.com/api/send-mail */
  relayEndpoint: '',
  /** 方案 B：邮件服务商 API Key，例如 Resend 的 re_xxx */
  apiKey: '',
  /** 发件人邮箱 */
  from: '',
  /** 服务商 API 地址（方案 B），例如 https://api.resend.com/emails */
  apiEndpoint: '',
};

/** 一封邮件的内容 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** 发送结果 */
export interface MailResult {
  ok: boolean;
  /** 未发送/失败的原因，便于在界面上提示用户 */
  reason?: string;
}

/**
 * 判断邮箱通知是否已经配置好
 */
export function isMailConfigured(): boolean {
  const hasRelay = !!SMTP_CONFIG.relayEndpoint;
  const hasApi = !!SMTP_CONFIG.apiKey && !!SMTP_CONFIG.apiEndpoint && !!SMTP_CONFIG.from;
  return hasRelay || hasApi;
}

/**
 * 发送邮件 —— 预留实现
 *
 * 当前：如果没配置，直接返回 { ok:false, reason:'未配置' }，不抛异常。
 * 以后接入时，把下面 TODO 处替换成实际请求即可。
 *
 * @param msg 邮件内容
 */
export async function sendMail(msg: MailMessage): Promise<MailResult> {
  if (!msg?.to) {
    return { ok: false, reason: '没有填写收件邮箱' };
  }
  if (!isMailConfigured()) {
    // 未配置时静默跳过，不打扰用户
    return { ok: false, reason: '未配置邮件服务（见 src/lib/email.ts）' };
  }

  // ---- 方案 A：走自己的中转接口 ----
  if (SMTP_CONFIG.relayEndpoint) {
    try {
      const res = await fetch(SMTP_CONFIG.relayEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          from: SMTP_CONFIG.from || undefined,
        }),
      });
      if (!res.ok) return { ok: false, reason: `中转接口返回 HTTP ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: `请求中转接口失败：${(e as Error).message}` };
    }
  }

  // ---- 方案 B：走邮件服务商 HTTP API（以 Resend 为例） ----
  // TODO: 换成你要用的服务商；不同服务商字段名略有差异。
  try {
    const res = await fetch(SMTP_CONFIG.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SMTP_CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        from: SMTP_CONFIG.from,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, reason: `邮件 API 返回 HTTP ${res.status} ${t.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `请求邮件 API 失败：${(e as Error).message}` };
  }
}

/**
 * 把「发现新项目」这件事组织成一封邮件并发出
 * @param orgName 团体名
 * @param items   新项目列表
 * @param to      收件人
 */
export async function sendNewProjectsMail(
  orgName: string,
  items: { name: string; date: string; status: string; url: string }[],
  to: string
): Promise<MailResult> {
  const lines = items.map(
    (it, i) => `${i + 1}. ${it.name}${it.date ? `（${it.date}）` : ''}${it.status ? ` [${it.status}]` : ''}\n   ${it.url}`
  );
  return sendMail({
    to,
    subject: `【志愿项目提醒】${orgName} 有 ${items.length} 个新项目`,
    text: `${orgName} 发现 ${items.length} 个新志愿项目：\n\n${lines.join('\n\n')}\n\n—— 来自「志愿项目监控」App`,
  });
}
