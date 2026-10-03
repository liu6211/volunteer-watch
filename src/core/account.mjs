/**
 * 志愿云账号：登录 + 读取「我的项目 / 我的团体 / 服务时长」
 *
 * 全部机制都是实测出来的（2026-10），不是猜的：
 *
 *   1. 建会话   GET  /app/user/login.php                → 拿 PHPSESSID 和表单里的 seid
 *   2. 查验证码 GET  /app/user/uname.php?m=uname&uname=..&seid=..
 *               （注意：这个接口用 POST 会被拦，回「访问超时」；必须用 GET）
 *   3. 登录     POST /app/user/login.php?m=login
 *               密码必须先用页面里的 RSA 公钥加密（PKCS#1 v1.5 + base64）
 *               成功返回 {"code":0,"msg":"登录成功","referer":"..."}
 *   4. 取数据   /app/opp/opp.my.php   我的项目
 *               /app/org/org.my.php   我的团体
 *               /app/user/hour.php    服务时长
 *
 * 关于验证码：只有被判定为「暴力登录」时才会要。
 * 实测直接登录成功、未触发验证码；触发时接口会给一段说明，
 * 需要用户去微信公众号取「登录验证码」再回填。
 */

import { rsaEncrypt } from './rsa.mjs';

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** 登录页里的 RSA 公钥（站点换密钥时只需更新这里） */
export const SITE_PUBKEY =
  '-----BEGIN PUBLIC KEY-----\n' +
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCbJ2QYNdiFlzE0mcyq7tcZc5dP\n' +
  'vof6696l2cJJM8kOxeXT8EonfvLzfsEGmwjNp3gvAyF14LvqT6w7oH40sFFnX358\n' +
  'Eb+HZXx6CZ4LOkaTW0KNS6yodsRv0uwJhFMwREqEVbqd6jcCxTGKDOieendC8x1f\n' +
  'sg3Muagyfawc+o+tewIDAQAB\n' +
  '-----END PUBLIC KEY-----';

/** 账号页地址 */
export const ACCOUNT_PATHS = {
  projects: '/app/opp/opp.my.php',
  orgs: '/app/org/org.my.php',
  hours: '/app/user/hour.php',
};

/* ------------------------------------------------------------ 会话 */

/** @returns {{cookie: string, seid: string}} */
export function createSession() {
  return { cookie: '', seid: '' };
}

/** 把响应的 Set-Cookie 合并进会话 */
function absorbCookies(session, res) {
  let raw = null;
  try {
    // RN 上可能返回单个字符串；标准实现允许返回数组
    raw = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : res.headers.get('set-cookie');
  } catch {
    raw = null;
  }
  if (!raw) return;

  const list = Array.isArray(raw) ? raw : String(raw).split(/,(?=[^;=]+=)/);
  const jar = new Map();
  for (const part of session.cookie.split('; ').filter(Boolean)) {
    const i = part.indexOf('=');
    if (i > 0) jar.set(part.slice(0, i), part.slice(i + 1));
  }
  for (const c of list) {
    const pair = String(c).split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  session.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function req(session, url, opts = {}) {
  const doFetch = opts.fetchImpl || fetch;
  const headers = {
    'User-Agent': UA,
    'Accept-Language': 'zh-CN,zh;q=0.9',
    ...(session.cookie ? { Cookie: session.cookie } : {}),
    ...(opts.headers || {}),
  };
  const { fetchImpl: _ignored, ...rest } = opts;
  void _ignored;
  const res = await doFetch(url, { ...rest, headers, redirect: 'follow' });
  absorbCookies(session, res);
  return res;
}

const origin = (host) => `https://${host}`;

/* ------------------------------------------------------------ 登录 */

/**
 * 查这个用户名是否需要验证码
 * @param {{cookie:string,seid:string}} session
 * @param {string} host
 * @param {string} username
 * @param {{fetchImpl?: typeof fetch}} [opts] 便于测试注入
 * @returns {Promise<{needCaptcha: boolean, message: string}>}
 */
export async function checkNeedCaptcha(session, host, username, opts = {}) {
  const url =
    `${origin(host)}/app/user/uname.php?m=uname` +
    `&uname=${encodeURIComponent(username)}&seid=${encodeURIComponent(session.seid || '')}`;
  // 实测：必须 GET，POST 会被拦成「访问超时」
  const res = await req(session, url, { method: 'GET', fetchImpl: opts.fetchImpl });
  const text = await res.text();
  let obj = null;
  try { obj = JSON.parse(text); } catch { /* 非 JSON */ }

  const message = obj && obj.show
    ? String(obj.show).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
  return { needCaptcha: obj ? String(obj.code) === '1' : false, message };
}

/**
 * 登录
 * @returns {Promise<{ok: boolean, needCaptcha?: boolean, message: string}>}
 */
export async function login(session, host, username, password, captcha) {
  const base = origin(host);

  // 1. 建会话 + 取 seid
  const page = await req(session, `${base}/app/user/login.php`);
  const html = await page.text();
  const m = html.match(/id="seid"\s+value="([^"]*)"/);
  session.seid = m ? m[1] : '';

  // 2. 密码加密（站点用 JSEncrypt 做同样的事）
  const encPass = rsaEncrypt(SITE_PUBKEY, password);

  // 3. 提交
  const body = new URLSearchParams({
    seid: session.seid,
    uname: username,
    upass: encPass,
    referer: '/app/user/home.php',
  });
  if (captcha) body.set('uyzm', captcha);

  const res = await req(session, `${base}/app/user/login.php?m=login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${base}/app/user/login.php`,
    },
    body: body.toString(),
  });

  const text = await res.text();
  let obj = null;
  try { obj = JSON.parse(text); } catch { /* ignore */ }

  if (!obj) {
    return { ok: false, message: `服务器返回了无法识别的内容（HTTP ${res.status}）` };
  }

  const code = String(obj.code);
  const msg = obj.msg || '';

  if (code === '0') return { ok: true, message: msg || '登录成功' };

  // code=1 且带回一段说明 → 需要验证码
  const desc = obj.show
    ? String(obj.show).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    : msg;
  return { ok: false, needCaptcha: true, message: desc || '需要登录验证码' };
}

/** 退出登录（尽力而为，失败也不影响本地清会话） */
export async function logout(session, host) {
  try {
    await req(session, `${origin(host)}/app/user/login.php?m=logout`);
  } catch {
    // 忽略
  }
  session.cookie = '';
  session.seid = '';
}

/* ------------------------------------------------------------ 解析工具 */

function textOf(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 把某个 class 的表格切成一行行 */
function tableRows(html, className = 'table1') {
  // ⚠️ 必须先去掉 HTML 注释：
  // 「服务时长」页里把已经失效的旧记录用 <!-- --> 注释掉了，
  // 不去掉就会被当成有效记录，把总时长算多。
  const clean = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '');

  const idx = clean.indexOf(className);
  if (idx < 0) return [];
  const start = clean.lastIndexOf('<table', idx);
  const end = clean.indexOf('</table>', start);
  const table = clean.slice(start, end < 0 ? undefined : end);

  const rows = [];
  for (const tr of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    // 表头行（含 <th>）跳过
    if (/<th\b/i.test(tr[1])) continue;
    const tds = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (tds.length >= 2) rows.push(tds);
  }
  return rows;
}

/** 从一段 html 里第一个 /app/xxx/view.php?id=... 取链接和文字 */
function firstLink(html) {
  const m = String(html).match(
    /<a\b[^>]*href\s*=\s*["']([^"']*\/app\/(?:opp|org)\/view\.php\?id=[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
  );
  if (!m) return { url: '', text: '' };
  return { url: m[1], text: textOf(m[2]) };
}

/* ------------------------------------------------------------ 我的项目 */

/**
 * @returns {{items: Array<{name,url,org,joinedAt,status,post,hours}>}}
 */
export function parseMyProjects(html) {
  const items = [];
  for (const tds of tableRows(html)) {
    const link = firstLink(tds[0]);
    if (!link.text) continue;
    const orgM = tds[0].match(/项目团体[：:]\s*([^<\s][^<]*)/);
    items.push({
      name: link.text,
      url: link.url,
      org: orgM ? orgM[1].trim() : '',
      joinedAt: textOf(tds[1] || ''),
      status: textOf(tds[2] || ''),
      post: textOf(tds[3] || ''),
      hours: textOf(tds[4] || ''),
    });
  }
  return { items };
}

/* ------------------------------------------------------------ 我的团体 */

export function parseMyOrgs(html) {
  const items = [];
  for (const tds of tableRows(html)) {
    const link = firstLink(tds[0]);
    if (!link.text) continue;
    const areaM = tds[0].match(/区域[：:]\s*([^\s<]+)/);
    items.push({
      name: link.text,
      url: link.url,
      area: areaM ? areaM[1] : '',
      contact: textOf(tds[1] || ''),
      joinedAt: textOf(tds[2] || ''),
      status: textOf(tds[3] || ''),
    });
  }
  return { items };
}

/* ------------------------------------------------------------ 服务时长 */

export function parseMyHours(html) {
  const items = [];
  let total = null;
  let effective = null;

  for (const tds of tableRows(html)) {
    const hoursM = String(tds[0] || '').match(/([\d.]+)\s*小时/);
    if (!hoursM) continue;
    const noteM = textOf(tds[0]).match(/【([^】]*)】/);

    /*
     * 状态列形如：<font>未生效</font><br><font>个人申请</font>
     * 两个值在同一格里，直接取整格文本会把它们粘在一起，
     * 所以按 <font> 拆开，再按关键词分辨哪个是添加方式。
     */
    const fonts = [...String(tds[1] || '').matchAll(/<font[^>]*>([\s\S]*?)<\/font>/gi)]
      .map((m) => textOf(m[1]))
      .filter(Boolean);
    const addedBy = fonts.find((t) => /个人申请|团体录入|系统录入|导入/.test(t)) || '';
    const status = fonts.find((t) => t !== addedBy) || textOf(tds[1] || '');

    // 「服务项目/服务团体」里有两个链接，第一个项目、第二个团体
    const links = [...String(tds[2] || '').matchAll(
      /<a\b[^>]*href\s*=\s*["']([^"']*\/app\/(?:opp|org)\/view\.php\?id=[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
    )].map((m) => ({ url: m[1], text: textOf(m[2]) }));

    const value = Number(hoursM[1]);

    items.push({
      hours: value,
      note: noteM ? noteM[1].trim() : '',
      status,
      addedBy,
      project: links[0] ? links[0].text : '',
      projectUrl: links[0] ? links[0].url : '',
      org: links[1] ? links[1].text : '',
      date: textOf(tds[3] || ''),
    });

    total = (total ?? 0) + value;
    if (status.includes('已生效')) effective = (effective ?? 0) + value;
  }

  // 页面顶部若有「累计服务时长」优先用它
  const t = String(html).match(/累计[^<]*?([\d.]+)\s*小时/);
  if (t) total = Number(t[1]);

  return { items, total, effective };
}

/* ------------------------------------------------------------ 抓取 */

async function fetchPage(session, host, path) {
  const res = await req(session, origin(host) + path);
  const html = await res.text();
  const needLogin = /亲，请登录|请先登录|用户登录|登录志愿/.test(html) && !/退出/.test(html);
  return { html, needLogin };
}

/** 验证会话是否还有效 */
export async function checkSession(session, host) {
  try {
    const { html, needLogin } = await fetchPage(session, host, '/app/user/home.php');
    return { ok: !needLogin && html.length > 2000 };
  } catch {
    return { ok: false };
  }
}

export async function fetchMyProjects(session, host) {
  const { html, needLogin } = await fetchPage(session, host, ACCOUNT_PATHS.projects);
  if (needLogin) throw new Error('登录已过期，请重新登录');
  return parseMyProjects(html);
}

export async function fetchMyOrgs(session, host) {
  const { html, needLogin } = await fetchPage(session, host, ACCOUNT_PATHS.orgs);
  if (needLogin) throw new Error('登录已过期，请重新登录');
  return parseMyOrgs(html);
}

export async function fetchMyHours(session, host) {
  const { html, needLogin } = await fetchPage(session, host, ACCOUNT_PATHS.hours);
  if (needLogin) throw new Error('登录已过期，请重新登录');
  return parseMyHours(html);
}
