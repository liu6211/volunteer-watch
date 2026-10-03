/**
 * RSA 公钥加密（PKCS#1 v1.5），用 BigInt 手写，零依赖。
 *
 * 为什么不用现成库：
 *   志愿云登录时密码要用页面里的 RSA 公钥加密后再提交。
 *   浏览器上站点用的是 JSEncrypt，但那个库依赖 window/navigator，
 *   在 React Native 里不一定跑得起来；而且我们只需要「用公钥加密」这一件事，
 *   用 BigInt 做模幂运算就够（Hermes 支持 BigInt），不必引入依赖。
 *
 * 实现遵循 PKCS#1 v1.5 的 RSAES 方案：
 *   EM = 0x00 || 0x02 || PS || 0x00 || M        (PS 为随机非零字节)
 *   C  = EM^e mod n
 */

/* ------------------------------------------------------------ DER 解析 */

/** 极简 DER 读取器，只够读 SubjectPublicKeyInfo */
function readDer(bytes) {
  let i = 0;
  const readLen = () => {
    let n = bytes[i++];
    if (n < 0x80) return n;
    const count = n & 0x7f;
    n = 0;
    for (let k = 0; k < count; k++) n = (n << 8) | bytes[i++];
    return n;
  };
  const readTlv = () => {
    const tag = bytes[i++];
    const len = readLen();
    const val = bytes.slice(i, i + len);
    i += len;
    return { tag, val };
  };
  return { readTlv, atEnd: () => i >= bytes.length };
}

/** 从 PEM 里取出模数 n 和指数 e */
export function parseRsaPublicKey(pem) {
  const b64 = String(pem)
    .replace(/-----[^-]+-----/g, '')
    .replace(/\s+/g, '');
  if (!b64) throw new Error('公钥为空');

  // Node 用 Buffer，手机上没有 Buffer（会走 atob 分支）
  const B = globalThis.Buffer;
  const bytes = B
    ? Uint8Array.from(B.from(b64, 'base64'))
    : Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  const { readTlv } = readDer(bytes);
  const spki = readTlv();              // SubjectPublicKeyInfo
  const reader = readDer(spki.val);
  const alg = reader.readTlv();        // AlgorithmIdentifier
  void alg;
  const bitStr = reader.readTlv();     // BIT STRING
  // BIT STRING 首字节是未用位数，跳过
  const inner = readDer(bitStr.val.slice(1));
  const seq = inner.readTlv();         // RSAPublicKey
  const rk = readDer(seq.val);
  const nBytes = rk.readTlv().val;     // INTEGER modulus
  const eBytes = rk.readTlv().val;     // INTEGER exponent

  const toBig = (b) => {
    let v = 0n;
    for (const x of b) v = (v << 8n) | BigInt(x);
    return v;
  };
  return { n: toBig(nBytes), e: toBig(eBytes) };
}

/* ------------------------------------------------------------ 模幂 */

function modPow(base, exp, mod) {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function bytesToBig(bytes) {
  let v = 0n;
  for (const x of bytes) v = (v << 8n) | BigInt(x);
  return v;
}

function bigToBytes(v, len) {
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
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

function toBase64(bytes) {
  const B = globalThis.Buffer;
  if (B) return B.from(bytes).toString('base64');
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** 取随机字节：优先用平台加密随机数，退化时才用 Math.random */
export function randomBytes(len) {
  const g = globalThis;
  if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
    const a = new Uint8Array(len);
    g.crypto.getRandomValues(a);
    return a;
  }
  const a = new Uint8Array(len);
  for (let i = 0; i < len; i++) a[i] = Math.floor(Math.random() * 256);
  return a;
}

/**
 * 用 RSA 公钥加密文本，返回 base64（与 JSEncrypt 行为一致）
 * @param {string} pem  PEM 格式公钥
 * @param {string} text 明文
 * @param {(len:number)=>Uint8Array} [rng] 自定义随机源（测试用）
 */
export function rsaEncrypt(pem, text, rng = randomBytes) {
  const { n, e } = parseRsaPublicKey(pem);
  const k = Math.ceil(n.toString(2).length / 8); // 模长（字节）
  const msg = utf8Bytes(text);

  if (msg.length > k - 11) {
    throw new Error(`待加密内容过长（${msg.length} > ${k - 11}）`);
  }

  // PS：k - msg.length - 3 个非零随机字节
  const psLen = k - msg.length - 3;
  const ps = new Uint8Array(psLen);
  let filled = 0;
  while (filled < psLen) {
    for (const b of rng(psLen - filled)) {
      if (b !== 0 && filled < psLen) ps[filled++] = b;
    }
  }

  const em = new Uint8Array(k);
  em[0] = 0x00;
  em[1] = 0x02;
  em.set(ps, 2);
  em[2 + psLen] = 0x00;
  em.set(msg, 3 + psLen);

  const c = modPow(bytesToBig(em), e, n);
  return toBase64(bigToBytes(c, k));
}
