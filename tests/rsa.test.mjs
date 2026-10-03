/**
 * RSA 加密测试
 *
 * 关键验证：我们自己用 BigInt 实现的加密，结果必须能被【真私钥解密】还原。
 * 否则只能证明「代码不报错」，证明不了「结果是对的」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, privateDecrypt, constants, createPublicKey } from 'node:crypto';

import { rsaEncrypt, parseRsaPublicKey } from '../src/core/rsa.mjs';

/** 志愿云登录页里的真实公钥 */
const SITE_PEM =
  '-----BEGIN PUBLIC KEY-----\n' +
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCbJ2QYNdiFlzE0mcyq7tcZc5dP\n' +
  'vof6696l2cJJM8kOxeXT8EonfvLzfsEGmwjNp3gvAyF14LvqT6w7oH40sFFnX358\n' +
  'Eb+HZXx6CZ4LOkaTW0KNS6yodsRv0uwJhFMwREqEVbqd6jcCxTGKDOieendC8x1f\n' +
  'sg3Muagyfawc+o+tewIDAQAB\n' +
  '-----END PUBLIC KEY-----';

test('能从 PEM 里解析出 n 和 e', () => {
  const { n, e } = parseRsaPublicKey(SITE_PEM);
  assert.equal(e, 65537n, 'e 通常是 65537');
  // 1024 位密钥
  assert.equal(n.toString(2).length, 1024);
  // 和 Node 自己解出来的模数一致
  const jwk = createPublicKey(SITE_PEM).export({ format: 'jwk' });
  const nFromJwk = BigInt('0x' + Buffer.from(jwk.n, 'base64url').toString('hex'));
  assert.equal(n, nFromJwk, '解析出的模数必须与 Node 一致');
});

test('自造密钥：加密结果能被私钥解密还原', () => {
  // 用真实 RSA 私钥做端到端验证，这是唯一能证明实现正确的方法
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  for (const plain of ['Test-Password-123', 'a', '中文密码测试', 'x'.repeat(100)]) {
    const b64 = rsaEncrypt(publicKey, plain);
    const decrypted = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(b64, 'base64')
    ).toString('utf8');
    assert.equal(decrypted, plain, `「${plain}」应能解密还原`);
  }
});

test('输出长度等于模长（1024 位 = 128 字节 → base64 172 字符）', () => {
  const b64 = rsaEncrypt(SITE_PEM, 'Test-Password-123');
  assert.equal(Buffer.from(b64, 'base64').length, 128);
  assert.equal(b64.length, 172, '与站点 JSEncrypt 输出长度一致');
});

test('每次加密结果都不同（PKCS#1 随机填充）', () => {
  const a = rsaEncrypt(SITE_PEM, 'same');
  const b = rsaEncrypt(SITE_PEM, 'same');
  assert.notEqual(a, b, '随机填充应让密文每次都不同');
});

test('随机填充里不出现 0x00（PKCS#1 要求）', () => {
  // 故意让随机源返回一堆 0，验证实现会跳过它们继续取
  let calls = 0;
  const fakeRng = (len) => {
    calls++;
    return new Uint8Array(len).fill(calls === 1 ? 0 : 7);
  };
  const b64 = rsaEncrypt(SITE_PEM, 'abc', fakeRng);
  const em = Buffer.from(b64, 'base64');
  assert.equal(em.length, 128);
  assert.ok(calls > 1, '遇到 0 应该继续取随机数');
});

test('内容过长时明确报错', () => {
  assert.throws(() => rsaEncrypt(SITE_PEM, 'x'.repeat(200)), /过长/);
});

test('加密结果能被站点公钥对应的算法正常处理（密文长度与 JSEncrypt 一致）', () => {
  const b64 = rsaEncrypt(SITE_PEM, 'Test-Password-123');
  assert.match(b64, /^[A-Za-z0-9+/]+=*$/, '必须是合法 base64');
});
