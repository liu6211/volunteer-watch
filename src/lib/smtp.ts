/**
 * 手机上发邮件：把 SMTP 协议层和原生 socket 接起来。
 *
 * ⚠️ 重要限制（必须让用户知道）：
 *   React Native 自身没有原始 TCP 能力，发邮件要靠 react-native-tcp-socket
 *   这个【原生模块】。Expo Go 里不含它，所以：
 *     - Expo Go 中本功能不可用（会给出明确提示，不会崩）
 *     - 打包成正式 App 后可用
 *
 * 因此这里用「延迟 require + try/catch」，绝不在模块顶层 import，
 * 否则 Expo Go 一启动就会因为找不到原生模块而崩溃。
 */
import { sendMail as sendMailCore, QQ_SMTP } from '../core/smtp.mjs';

/** 当前环境是否可能支持发邮件（Expo Go 里为 false） */
export function isSmtpSupported(): boolean {
  try {
    // 只做存在性探测，不建立连接
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-tcp-socket');
    const Tcp = mod?.default || mod;
    return !!(Tcp && typeof Tcp.connect === 'function');
  } catch {
    return false;
  }
}

/** 用 react-native-tcp-socket 建立连接（TLS 由它的 tls 选项处理） */
async function rnConnect({ host, port, tls }: { host: string; port: number; tls: boolean }) {
  let mod: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('react-native-tcp-socket');
  } catch {
    throw new Error(
      '当前环境不支持直接发邮件（Expo Go 没有 socket 能力）。\n' +
      '装上正式版 App 后即可使用。'
    );
  }
  type Sock = {
    on: (e: string, cb: (x?: unknown) => void) => void;
    write: (s: string) => void;
    end: () => void;
    destroy: () => void;
  };
  const Tcp = ((mod as { default?: unknown })?.default || mod) as {
    connect?: (opts: unknown, cb: () => void) => Sock;
    connectTLS?: (opts: unknown, cb?: () => void) => Sock;
  };

  if (!Tcp || (typeof Tcp.connectTLS !== 'function' && typeof Tcp.connect !== 'function')) {
    throw new Error('当前环境不支持直接发邮件（缺少 socket 模块），请安装正式版 App。');
  }

  /*
   * ⚠️ 必须用 connectTLS，不能用 connect({tls:true})。
   * 这个库把 TLS 做成了独立入口；用 connect 传 tls:true 时
   * TLS 握手不会真正建立，现象就是「连接一直超时」——这正是之前的 bug。
   * 回调是 secureConnect 事件，即握手完成才 resolve。
   */
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('连接邮箱服务器超时（可能是网络或端口被封）')),
      20000
    );
    const done = (sock: Sock) => { clearTimeout(timer); resolve(sock); };
    const fail = (e: unknown) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); };

    let sock: Sock;
    try {
      if (tls && typeof Tcp.connectTLS === 'function') {
        sock = Tcp.connectTLS({ host, port }, () => done(sock));
      } else {
        sock = Tcp.connect!({ host, port }, () => done(sock));
      }
    } catch (e) {
      fail(e);
      return;
    }
    sock.on('error', fail);
  });
}

export interface SmtpCredentials {
  /** 发信邮箱，例如 you@qq.com */
  user: string;
  /** 邮箱授权码（不是登录密码） */
  pass: string;
}

/**
 * 发一封提醒邮件
 */
export async function sendMailViaSmtp(
  cred: SmtpCredentials,
  to: string,
  subject: string,
  text: string
): Promise<void> {
  await sendMailCore({
    connect: rnConnect,
    host: QQ_SMTP.host,
    port: QQ_SMTP.port,
    user: cred.user,
    pass: cred.pass,
    from: cred.user,
    to: to || cred.user,
    subject,
    text,
  });
}

export { QQ_SMTP };
