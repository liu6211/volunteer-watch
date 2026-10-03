/**
 * SMTP 客户端测试
 *
 * 做法：本地起一个真的 SMTP 服务器（node:net），用 node:net 当 socket 注入，
 * 跑完整的 连接 → EHLO → AUTH LOGIN → MAIL FROM → RCPT TO → DATA → QUIT 流程。
 * 这样才能证明协议实现是对的，而不是「代码不报错」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';

import {
  sendMail, buildMessage, encodeHeader, b64, SmtpClient, QQ_SMTP,
} from '../src/core/smtp.mjs';

/** 起一个最小的 SMTP 服务器，记录收到的内容 */
async function startFakeSmtp({ failAuth = false, greeting = '220 fake ESMTP' } = {}) {
  const log = { user: '', pass: '', from: '', to: '', data: '', quit: false, ehlo: '' };

  const server = net.createServer((sock) => {
    sock.write(greeting + '\r\n');
    let buf = '';
    let state = 'cmd';
    let inData = false;

    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            sock.write('250 OK queued\r\n');
          } else {
            log.data += line + '\n';
          }
          continue;
        }

        const up = line.toUpperCase();
        if (up.startsWith('EHLO')) {
          log.ehlo = line;
          sock.write('250-fake greets you\r\n250-AUTH LOGIN PLAIN\r\n250 OK\r\n');
        } else if (up === 'AUTH LOGIN') {
          state = 'user';
          sock.write('334 VXNlcm5hbWU6\r\n');
        } else if (state === 'user') {
          log.user = Buffer.from(line, 'base64').toString('utf8');
          state = 'pass';
          sock.write('334 UGFzc3dvcmQ6\r\n');
        } else if (state === 'pass') {
          log.pass = Buffer.from(line, 'base64').toString('utf8');
          state = 'cmd';
          sock.write(failAuth ? '535 认证失败\r\n' : '235 认证成功\r\n');
        } else if (up.startsWith('MAIL FROM')) {
          log.from = line;
          sock.write('250 OK\r\n');
        } else if (up.startsWith('RCPT TO')) {
          log.to = line;
          sock.write('250 OK\r\n');
        } else if (up === 'DATA') {
          inData = true;
          sock.write('354 开始输入\r\n');
        } else if (up === 'QUIT') {
          log.quit = true;
          sock.write('221 Bye\r\n');
          sock.end();
        } else {
          sock.write('250 OK\r\n');
        }
      }
    });
    sock.on('error', () => { /* 忽略 */ });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;

  const connect = ({ port: p }) =>
    new Promise((resolve, reject) => {
      const s = net.connect({ host: '127.0.0.1', port: p || port }, () => resolve(s));
      s.once('error', reject);
    });

  return { port, log, connect, close: () => server.close() };
}

/* ------------------------------------------------------------ 编码 */

test('b64: 能正确编码中文', () => {
  assert.equal(b64('hello'), 'aGVsbG8=');
  assert.equal(Buffer.from(b64('志愿'), 'base64').toString('utf8'), '志愿');
});

test('encodeHeader: 纯 ASCII 不动，中文转 MIME 编码', () => {
  assert.equal(encodeHeader('New projects'), 'New projects');
  const e = encodeHeader('发现新项目');
  assert.match(e, /^=\?UTF-8\?B\?/);
  const raw = e.replace(/^=\?UTF-8\?B\?/, '').replace(/\?=$/, '');
  assert.equal(Buffer.from(raw, 'base64').toString('utf8'), '发现新项目');
});

test('buildMessage: 头部齐全，正文是 base64，中文可还原', () => {
  const msg = buildMessage({
    from: 'a@qq.com', to: 'b@qq.com', subject: '新项目提醒', text: '都匀三中 有新项目',
  });
  assert.match(msg, /From: a@qq\.com/);
  assert.match(msg, /To: b@qq\.com/);
  assert.match(msg, /Subject: =\?UTF-8\?B\?/);
  assert.match(msg, /MIME-Version: 1\.0/);
  assert.match(msg, /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(msg, /Content-Transfer-Encoding: base64/);

  const body = msg.split('\r\n\r\n')[1].replace(/[\r\n]/g, '');
  assert.equal(Buffer.from(body, 'base64').toString('utf8'), '都匀三中 有新项目');
});

/* ------------------------------------------------------------ 协议 */

test('sendMail: 完整流程走通，服务器收到正确内容', async () => {
  const s = await startFakeSmtp();
  try {
    const r = await sendMail({
      connect: s.connect,
      host: 'smtp.example.com',
      port: s.port,
      user: 'me@qq.com',
      pass: 'abcd1234abcd1234',
      from: 'me@qq.com',
      to: 'me@qq.com',
      subject: '志愿项目提醒',
      text: '都匀三中 有 2 个新项目',
    });

    assert.equal(r.ok, true);
    assert.equal(s.log.user, 'me@qq.com', '用户名应以 base64 发出并正确解出');
    assert.equal(s.log.pass, 'abcd1234abcd1234', '授权码应正确送达');
    assert.match(s.log.from, /MAIL FROM:<me@qq\.com>/);
    assert.match(s.log.to, /RCPT TO:<me@qq\.com>/);
    assert.equal(s.log.quit, true, '结束时要发 QUIT');
    assert.match(s.log.ehlo, /^EHLO /);

    // 正文里的 base64 正文应能还原成原文
    const m = s.log.data.match(/Content-Transfer-Encoding: base64\n\n([\s\S]*?)\n$/);
    assert.ok(m, '应有 base64 正文段');
    const decoded = Buffer.from(m[1].replace(/\n/g, ''), 'base64').toString('utf8');
    assert.equal(decoded, '都匀三中 有 2 个新项目');
  } finally {
    s.close();
  }
});

test('sendMail: 认证失败时抛出可读错误', async () => {
  const s = await startFakeSmtp({ failAuth: true });
  try {
    await assert.rejects(
      () => sendMail({
        connect: s.connect, host: 'h', port: s.port,
        user: 'u@qq.com', pass: 'wrong', from: 'u@qq.com', to: 'u@qq.com',
        subject: 's', text: 't',
      }),
      /535|认证/
    );
  } finally {
    s.close();
  }
});

test('sendMail: 缺邮箱或授权码时给出明确提示', async () => {
  await assert.rejects(
    () => sendMail({ connect: async () => { throw new Error('不该连'); }, host: 'h', user: '', pass: '', to: 'x@y.com', subject: 's', text: 't' }),
    /邮箱和授权码/
  );
  await assert.rejects(
    () => sendMail({ connect: async () => { throw new Error('不该连'); }, host: 'h', user: 'u', pass: 'p', to: '', subject: 's', text: 't' }),
    /收件邮箱/
  );
});

test('sendMail: 没注入 socket 实现时提示需要正式版', async () => {
  await assert.rejects(
    () => sendMail({ host: 'h', user: 'u', pass: 'p', to: 'a@b.com', subject: 's', text: 't' }),
    /socket/
  );
});

test('sendMail: 以点开头的正文行会被正确转义（SMTP 规则）', async () => {
  const s = await startFakeSmtp();
  try {
    await sendMail({
      connect: s.connect, host: 'h', port: s.port,
      user: 'u@qq.com', pass: 'p', from: 'u@qq.com', to: 'u@qq.com',
      subject: 's', text: '.leading dot line',
    });
    // 正文经过 base64，所以线上不会真的出现行首的点；
    // 但要确保没有因为转义把内容弄坏
    const m = s.log.data.match(/Content-Transfer-Encoding: base64\n\n([\s\S]*?)\n$/);
    const decoded = Buffer.from(m[1].replace(/\n/g, ''), 'base64').toString('utf8');
    assert.equal(decoded, '.leading dot line');
  } finally {
    s.close();
  }
});

test('SmtpClient: 多行响应能被正确读完', async () => {
  const server = net.createServer((sock) => {
    sock.write('250-first\r\n250-second\r\n250 done\r\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;

  const sock = await new Promise((res) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => res(s));
  });
  const c = new SmtpClient(sock, 3000);
  const r = await c.readReply();
  assert.equal(r.code, '250');
  assert.match(r.text, /first/);
  assert.match(r.text, /done/);
  sock.destroy();
  server.close();
});

test('QQ_SMTP: 参数是 465 隐式 TLS', () => {
  assert.equal(QQ_SMTP.host, 'smtp.qq.com');
  assert.equal(QQ_SMTP.port, 465);
  assert.equal(QQ_SMTP.tls, true);
});
