/**
 * 极简 SMTP 客户端（只为「给自己发提醒邮件」这一件事）
 *
 * 为什么需要它：
 *   React Native 没有原始 TCP 能力，而发邮件必须走 SMTP。
 *   所以要用 react-native-tcp-socket 这类原生模块提供 socket，
 *   本文件只负责 SMTP 协议本身，socket 由外部注入 —— 好处是
 *   在 Node 里可以用 node:net / node:tls 注入，从而真正测到协议逻辑。
 *
 * 支持：
 *   - 隐式 TLS（QQ 邮箱 465 端口，连上就是 TLS）
 *   - AUTH LOGIN（用户名 + 授权码）
 *   - 中文主题/正文（MIME 编码 + base64 正文）
 *
 * 注意：QQ 邮箱用的是「授权码」而不是登录密码。
 */

const CRLF = '\r\n';

/** 把一行文本按 base64 编码（用于 AUTH LOGIN / 正文） */
export function b64(text) {
  const bytes = utf8Bytes(text);
  const B = globalThis.Buffer;
  if (B) return B.from(bytes).toString('base64');
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
}

function utf8Bytes(s) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const out = [];
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return Uint8Array.from(out);
}

/** 中文主题要用 MIME 的 B 编码，否则收件方会看到乱码 */
export function encodeHeader(text) {
  if (!/[\u0080-\uffff]/.test(text)) return text;
  return `=?UTF-8?B?${b64(text)}?=`;
}

/** 按 76 字符换行（base64 正文的规范要求） */
export function wrap76(s) {
  return s.replace(/(.{76})/g, `$1${CRLF}`).replace(new RegExp(`${CRLF}$`), '');
}

/** 拼一封纯文本邮件 */
export function buildMessage({ from, to, subject, text, date = new Date() }) {
  return [
    `From: ${encodeHeader(from)}`,
    `To: ${encodeHeader(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(text)),
    '',
  ].join(CRLF);
}

/**
 * SMTP 会话。socket 是一个已连接的双工通道：
 *   write(str)  /  on('data'|'error'|'close', cb)  /  end()
 */
export class SmtpClient {
  constructor(socket, timeoutMs = 20000) {
    this.sock = socket;
    this.timeout = timeoutMs;
    this.buf = '';
    this.lines = [];
    this.waiters = [];
    this.closed = false;
    this.error = null;

    socket.on('data', (d) => {
      this.buf += typeof d === 'string' ? d : utf8BytesToString(d);
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, '');
        this.buf = this.buf.slice(i + 1);
        this.lines.push(line);
        const w = this.waiters.shift();
        if (w) w();
      }
    });
    socket.on('error', (e) => { this.error = e; this.#wake(); });
    socket.on('close', () => { this.closed = true; this.#wake(); });
  }

  #wake() {
    while (this.waiters.length) this.waiters.shift()();
  }

  /** 等一行（带超时） */
  async readLine() {
    if (this.lines.length) return this.lines.shift();
    if (this.error) throw new Error(`连接出错：${this.error.message || this.error}`);
    if (this.closed) throw new Error('连接被服务器关闭');

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`SMTP 超时（${Math.round(this.timeout / 1000)} 秒无响应）`));
      }, this.timeout);
      this.waiters.push(() => { clearTimeout(timer); resolve(); });
    });
    return this.readLine();
  }

  async write(line) {
    this.sock.write(line + CRLF);
  }

  /** 读一条响应（含多行 250-xxx 形式），返回 { code, text } */
  async readReply() {
    const first = await this.readLine();
    const code = first.slice(0, 3);
    const texts = [first.slice(4)];
    // 形如 "250-..." 表示后面还有
    while (first.length > 3 && first[3] === '-') {
      const next = await this.readLine();
      texts.push(next.slice(4));
      if (next.slice(0, 3) === code && next[3] !== '-') break;
    }
    return { code, text: texts.join(' ').trim() };
  }

  /** 期待某个状态码，否则抛错 */
  async expect(...codes) {
    const r = await this.readReply();
    if (!codes.includes(r.code)) {
      throw new Error(`SMTP 返回 ${r.code}：${r.text}`);
    }
    return r;
  }
}

function utf8BytesToString(bytes) {
  if (typeof TextDecoder !== 'undefined') {
    try { return new TextDecoder('utf-8').decode(bytes); } catch { /* 继续 */ }
  }
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/**
 * 发一封邮件。
 *
 * @param {{
 *   connect: (opts:{host:string,port:number,tls:boolean}) => Promise<any>,
 *   host: string, port?: number,
 *   user: string, pass: string,
 *   from: string, to: string,
 *   subject: string, text: string,
 *   timeoutMs?: number,
 * }} opts
 */
export async function sendMail(opts) {
  const {
    connect, host, port = 465, user, pass, from, to, subject, text, timeoutMs = 20000,
  } = opts;

  if (!connect) throw new Error('缺少 socket 实现（手机上需要 react-native-tcp-socket）');
  if (!user || !pass) throw new Error('请先填写邮箱和授权码');
  if (!to) throw new Error('请填写收件邮箱');

  const socket = await connect({ host, port, tls: true });
  const c = new SmtpClient(socket, timeoutMs);

  try {
    await c.expect('220');
    await c.write(`EHLO ${host}`);
    await c.expect('250');

    // AUTH LOGIN
    await c.write('AUTH LOGIN');
    await c.expect('334');
    await c.write(b64(user));
    await c.expect('334');
    await c.write(b64(pass));
    // 235 成功；有的服务器返回 503（已认证）也算通
    await c.expect('235', '503');

    await c.write(`MAIL FROM:<${from || user}>`);
    await c.expect('250');

    await c.write(`RCPT TO:<${to}>`);
    await c.expect('250', '251');

    await c.write('DATA');
    await c.expect('354');

    const message = buildMessage({ from: from || user, to, subject, text });
    // 正文里可能出现以 . 开头的行，需要按 SMTP 规则转义成 ..
    const safe = message.replace(/^\./gm, '..');
    await c.write(safe);
    await c.write('.');

    await c.expect('250');

    // QUIT 之后要等服务器的告别响应再断开，
    // 否则可能在服务器处理完之前就把连接销毁了
    await c.write('QUIT');
    try {
      await c.expect('221');
    } catch {
      // 有的服务器直接关连接，拿不到 221 也算正常
    }
    return { ok: true };
  } finally {
    try { socket.end && socket.end(); } catch { /* 忽略 */ }
    try { socket.destroy && socket.destroy(); } catch { /* 忽略 */ }
  }
}

/** QQ 邮箱的 SMTP 参数（实测文档口径：465 走隐式 TLS） */
export const QQ_SMTP = { host: 'smtp.qq.com', port: 465, tls: true };
