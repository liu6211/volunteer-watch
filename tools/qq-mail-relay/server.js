/**
 * QQ 邮箱中转服务
 * ============================================================
 * 手机 App 没法直接连 QQ 的 SMTP，所以由这个小服务代发。
 *
 * App 发过来的请求：
 *   POST /
 *   { "to": "收件人", "subject": "标题", "text": "正文", "from": "可选" }
 *
 * 启动：
 *   1. cd tools/qq-mail-relay
 *   2. npm install
 *   3. 设好环境变量后 node server.js
 *      见 README.md
 */
'use strict';

const http = require('http');
const nodemailer = require('nodemailer');

/* ------------------------------------------------------------------ 配置 */

const PORT = Number(process.env.PORT || 3000);

/** 发信用的 QQ 邮箱，例如 180957824@qq.com */
const QQ_USER = process.env.QQ_USER || '';

/** QQ 邮箱的 16 位授权码（不是登录密码！） */
const QQ_AUTH_CODE = process.env.QQ_AUTH_CODE || '';

/** 发件人显示地址，默认与 QQ_USER 相同 */
const QQ_FROM = process.env.QQ_FROM || QQ_USER;

/**
 * 可选的简单鉴权。设了之后 App 端也要用同样的值
 * （当前 App 未强制要求，作为可选的加固手段）
 */
const RELAY_TOKEN = process.env.RELAY_TOKEN || '';

/** 每次请求最多允许发给几个收件人，防止被当成开放中继 */
const MAX_RECIPIENTS = 5;

if (!QQ_USER || !QQ_AUTH_CODE) {
  console.error('❌ 缺少环境变量：需要 QQ_USER 和 QQ_AUTH_CODE');
  console.error('   例：QQ_USER=你@qq.com QQ_AUTH_CODE=十六位授权码 node server.js');
  process.exit(1);
}

/* ------------------------------------------------------------------ 发信 */

const transporter = nodemailer.createTransport({
  host: 'smtp.qq.com',
  port: 465,
  secure: true,
  auth: { user: QQ_USER, pass: QQ_AUTH_CODE },
});

/** 启动时先验证一次 SMTP 登录，避免带着错误配置跑 */
if (process.env.SKIP_VERIFY === '1') {
  console.log('⚠️  已跳过 SMTP 登录校验（SKIP_VERIFY=1，仅用于本地测试接口）');
} else {
  transporter.verify((err) => {
    if (err) {
      console.error('❌ QQ 邮箱登录失败：', err.message);
      console.error('   最常见原因：填的是 QQ 登录密码而不是授权码；或没开启 IMAP/SMTP 服务');
      process.exit(1);
    }
    console.log('✅ QQ 邮箱 SMTP 登录成功，可以发信了');
  });
}

/* ------------------------------------------------------------------ 工具 */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limitBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 很宽松的邮箱格式校验，只为拦住明显错误 */
function looksLikeEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

/* ------------------------------------------------------------------ 服务 */

const server = http.createServer(async (req, res) => {
  // 健康检查，方便你确认服务活着
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    return sendJson(res, 200, { ok: true, service: 'qq-mail-relay', from: QQ_FROM });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: '只支持 POST' });
  }

  // 可选鉴权
  if (RELAY_TOKEN) {
    const got = req.headers['x-relay-token'];
    if (got !== RELAY_TOKEN) {
      return sendJson(res, 401, { ok: false, error: '鉴权失败（x-relay-token 不匹配）' });
    }
  }

  let payload;
  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw || '{}');
  } catch (e) {
    return sendJson(res, 400, { ok: false, error: `请求体不是合法 JSON：${e.message}` });
  }

  const { to, subject, text } = payload;
  const from = payload.from || QQ_FROM;

  if (!looksLikeEmail(to)) {
    return sendJson(res, 400, { ok: false, error: `收件邮箱不合法：${to}` });
  }

  const recipients = String(to)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (recipients.length > MAX_RECIPIENTS) {
    return sendJson(res, 400, { ok: false, error: `收件人过多（上限 ${MAX_RECIPIENTS}）` });
  }

  const mail = {
    from: `"志愿项目监控" <${from}>`,
    to: recipients.join(', '),
    subject: subject || '（没有标题）',
    text: text || '',
  };

  console.log(`[send] -> ${mail.to} | ${mail.subject}`);

  try {
    const info = await transporter.sendMail(mail);
    console.log(`[ok]   ${info.messageId}`);
    return sendJson(res, 200, { ok: true, messageId: info.messageId });
  } catch (e) {
    console.error('[fail]', e.message);
    return sendJson(res, 502, { ok: false, error: `发信失败：${e.message}` });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('========================================');
  console.log('  QQ 邮箱中转服务已启动');
  console.log('========================================');
  console.log(`  监听端口 : ${PORT}`);
  console.log(`  发件邮箱 : ${QQ_FROM}`);
  console.log(`  鉴权     : ${RELAY_TOKEN ? '已开启' : '未开启（可选）'}`);
  console.log('');
  console.log('  App 里要填的地址（按你用哪台机器访问选一个）：');
  const os = require('os');
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) {
        console.log(`    http://${ni.address}:${PORT}/`);
      }
    }
  }
  console.log('');
});
