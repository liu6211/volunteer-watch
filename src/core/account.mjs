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

/**
 * 账号下的其它功能页。
 * 路径和页面结构都是实测出来的；「修改资料 / 修改密码」这类编辑功能不做。
 */
export const ACCOUNT_FEATURES = [
  {
    key: 'card', title: '志愿者证', path: '/app/user/card.php', kind: 'card',
    desc: '电子志愿者证（可下载卡片图片）', icon: 'card-outline',
  },
  {
    key: 'cert', title: '时间证明下载', path: '/app/user/cert.php', kind: 'pdf',
    desc: '生成并下载志愿服务时间证明 PDF', icon: 'document-text-outline',
  },
  {
    key: 'plan', title: '我的排班', path: '/app/user/plan.php', kind: 'table',
    desc: '已安排的志愿服务岗位', icon: 'calendar-outline',
  },
  {
    key: 'train', title: '我的培训', path: '/app/user/train.php?type=checko', kind: 'table',
    desc: '参加过的培训与学时', icon: 'school-outline',
  },
  {
    key: 'honour', title: '我的表彰', path: '/app/user/honour.php', kind: 'table',
    desc: '获得的表彰与奖励', icon: 'ribbon-outline',
  },
  {
    key: 'help', title: '我的求证', path: '/app/user/help.php', kind: 'table',
    desc: '发起的求助与求证', icon: 'help-circle-outline',
  },
  {
    key: 'comment', title: '我的评论', path: '/app/user/comment.php', kind: 'table',
    desc: '发表过的评价与评论', icon: 'chatbubble-outline',
  },
];

/** 按 key 取功能定义 */
export function featureByKey(key) {
  return ACCOUNT_FEATURES.find((f) => f.key === key) || null;
}

/* ------------------------------------------------------------ 会话 */

/** @returns {{cookie: string, seid: string, cookieMode?: 'platform'|'manual'}} */
export function createSession() {
  return { cookie: '', seid: '', cookieMode: 'platform' };
}

/** 把响应的 Set-Cookie 合并进会话 */
function absorbCookies(session, res) {
  const collected = [];

  try {
    if (typeof res.headers.getSetCookie === 'function') {
      collected.push(...res.headers.getSetCookie());
    }
  } catch { /* 部分平台没有这个方法 */ }

  try {
    const single = res.headers.get('set-cookie');
    if (single) collected.push(single);
  } catch { /* 忽略 */ }

  // 有些平台 get('set-cookie') 拿不到，只能遍历找出所有 header
  if (collected.length === 0 && typeof res.headers.forEach === 'function') {
    try {
      res.headers.forEach((value, key) => {
        if (String(key).toLowerCase() === 'set-cookie') collected.push(value);
      });
    } catch { /* 忽略 */ }
  }

  if (collected.length === 0) return;

  const jar = new Map();
  for (const part of session.cookie.split('; ').filter(Boolean)) {
    const i = part.indexOf('=');
    if (i > 0) jar.set(part.slice(0, i), part.slice(i + 1));
  }
  for (const c of collected) {
    // 一个 header 里可能塞了多个 cookie，按逗号拆（排除 Expires 里的逗号）
    for (const one of String(c).split(/,(?=[^;=]+=)/)) {
      const pair = one.split(';')[0];
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  session.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** 单次请求超时（毫秒）。没有它的话网络一卡，登录按钮会一直转圈 */
const REQUEST_TIMEOUT_MS = 25000;

/**
 * 请求。会按会话的 cookieMode 决定「要不要自己带 Cookie 头」。
 *
 * 为什么要分两种模式（实测结论）：
 *   服务器会校验 Cookie 与 seid 必须属于同一个会话，
 *   不匹配就回「授权失败，请按Ctrl+F5键刷新网页试试！」。
 *   而 iOS 的 NSURLSession 有自己的 Cookie 仓库：
 *     手动设的 Cookie 头可能被它仓库里的旧会话覆盖，
 *     于是变成「Cookie 是旧的、seid 是新的」→ 必然授权失败。
 *   所以先让运行环境自己管（platform），不行再退回自己带（manual）。
 */
async function req(session, url, opts = {}) {
  const doFetch = opts.fetchImpl || fetch;
  const mode = opts.cookieMode || session.cookieMode || 'manual';
  const headers = {
    'User-Agent': UA,
    'Accept-Language': 'zh-CN,zh;q=0.9',
    ...(mode === 'manual' && session.cookie ? { Cookie: session.cookie } : {}),
    ...(opts.headers || {}),
  };
  const { fetchImpl: _ignored, timeoutMs = REQUEST_TIMEOUT_MS, cookieMode: _m, ...rest } = opts;
  void _ignored; void _m;

  /*
   * 手动模式必须用 credentials:'omit'。
   * 否则 iOS 的 NSURLSession 会把【自己仓库里的】Cookie 也带上，
   * 结果请求头里同时出现新旧两个 PHPSESSID，
   * 服务器取到旧的那个 → Cookie 与 seid 不匹配 → 「授权失败」。
   * omit 让它一个都别带，完全由我们控制。
   */
  const credentials = mode === 'manual' ? 'omit' : 'include';

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      credentials,
      ...rest,
      headers,
      redirect: 'follow',
      signal: ac.signal,
    });
    absorbCookies(session, res);
    return res;
  } catch (e) {
    if ((e && e.name === 'AbortError') || /aborted|timeout/i.test(String(e && e.message))) {
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒无响应），请检查网络后重试`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
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
 * 走一次完整的登录流程（自建会话 → 取 seid → 提交）
 * @param {'platform'|'manual'} cookieMode
 */
async function loginOnce(host, username, password, captcha, cookieMode, fetchImpl) {
  const base = origin(host);
  const session = createSession();
  session.cookieMode = cookieMode;

  // 1. 建会话 + 取 seid
  const page = await req(session, `${base}/app/user/login.php`, { fetchImpl, cookieMode });
  const html = await page.text();
  const m = html.match(/id="seid"\s+value="([^"]*)"/);
  session.seid = m ? m[1] : '';

  const diag =
    `会话Cookie=${session.cookie ? '已获取' : '未获取'}` +
    ` / seid=${session.seid ? '已获取' : '未获取'}` +
    ` / 登录页=${html.length}字节 / 模式=${cookieMode}`;

  // 2. 密码加密（站点用 JSEncrypt 做同样的事）
  const encPass = rsaEncrypt(SITE_PUBKEY, password);

  // 3. 提交。
  //    字段名和顺序都对齐浏览器：站点用 C.form.get_form('#ulogin') 取值，
  //    而它是拿 input 的 id 当键、按 DOM 顺序遍历的。
  //    ⚠️ uyzm（验证码框）在页面上一直存在（只是隐藏），
  //    所以浏览器即使没有验证码也会提交一个空串 —— 这里必须照做。
  const body = new URLSearchParams();
  body.set('seid', session.seid);
  body.set('uname', username);
  body.set('upass', encPass);
  body.set('referer', '/app/user/home.php');
  body.set('uyzm', captcha || '');

  const res = await req(session, `${base}/app/user/login.php?m=login`, {
    method: 'POST',
    fetchImpl,
    cookieMode,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${base}/app/user/login.php`,
    },
    body: body.toString(),
  });

  const text = await res.text();
  let obj = null;
  try {
    obj = JSON.parse(text);
  } catch {
    const mm = text.match(/\{[\s\S]*\}/);
    if (mm) {
      try { obj = JSON.parse(mm[0]); } catch { /* 还是不行 */ }
    }
  }

  if (!obj) {
    const looksLikeLoginPage = /id="seid"|id="ulogin"|登录志愿/.test(text);
    const snippet = text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);

    return {
      ok: false,
      session,
      diag,
      retryable: false,
      raw: text.slice(0, 600),
      status: res.status,
      message: looksLikeLoginPage
        ? `服务器把请求当成了普通页面访问（返回的是登录页），说明会话没有建立。\n${diag}`
        : `服务器返回的不是登录结果（HTTP ${res.status}）。\n返回内容：${snippet || '(空)'}\n${diag}`,
    };
  }

  const code = String(obj.code);
  const msg = String(obj.msg || '');
  const show = obj.show
    ? String(obj.show).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    : '';

  if (code === '0') {
    return { ok: true, session, diag, message: msg || '登录成功' };
  }

  /*
   * ⚠️ code 非 0 有三种情况，必须分开：
   *   1. 需要验证码 —— 提示里会出现「验证码」
   *   2. 账号或密码不对 —— 普通错误，照实告诉用户
   *   3. 授权失败（Cookie 与 seid 不匹配）—— 换个 Cookie 模式重试
   * 早期版本把前两种混为一谈，导致密码输错时不提示、反而弹验证码框。
   */
  const haystack = `${msg} ${show}`;
  const needsCaptcha = /验证码/.test(haystack);
  const authMismatch = /授权失败|访问超时/.test(haystack);

  return {
    ok: false,
    session,
    diag,
    needCaptcha: needsCaptcha,
    retryable: authMismatch && cookieMode === 'platform',
    message: needsCaptcha
      ? (show || msg || '需要登录验证码')
      : authMismatch
        // 站点原话是「请按Ctrl+F5刷新网页」——手机上没有这个键，翻译成人话
        ? '登录被服务器拒绝了（会话校验没通过），正在自动重试…'
        : (msg || show || '登录失败'),
  };
}

/**
 * 登录
 *
 * 会先用「交给运行环境管 Cookie」的方式试一次；
 * 如果服务器回「授权失败」（Cookie 与 seid 不匹配），
 * 再用「自己带 Cookie 头」的方式重试一次。
 * 两种模式覆盖 iOS 与安卓在 Cookie 行为上的差异。
 *
 * @param {{cookie:string,seid:string,cookieMode?:string}} session
 * @param {string} host
 * @param {string} username
 * @param {string} password
 * @param {string} [captcha] 验证码（服务端要时才需要）
 * @param {{fetchImpl?: typeof fetch}} [opts] 便于测试注入
 * @returns {Promise<{ok: boolean, needCaptcha?: boolean, message: string}>}
 */
export async function login(session, host, username, password, captcha, opts = {}) {
  const first = await loginOnce(host, username, password, captcha, 'platform', opts.fetchImpl);

  if (first.ok || first.needCaptcha || !first.retryable) {
    Object.assign(session, first.session);
    const { session: _s, retryable: _r, ...rest } = first;
    void _s; void _r;
    return rest;
  }

  // 授权失败 → 换成手动带 Cookie 再试一次
  const second = await loginOnce(host, username, password, captcha, 'manual', opts.fetchImpl);
  Object.assign(session, second.session);
  const { session: _s2, retryable: _r2, ...rest2 } = second;
  void _s2; void _r2;

  if (!second.ok && !second.needCaptcha && /授权失败|访问超时|会话校验/.test(second.message)) {
    return {
      ...rest2,
      message:
        '登录被服务器拒绝了（会话校验一直没通过）。\n' +
        '这通常是网络环境（代理 / VPN）导致的，请切换网络后重试。\n' +
        second.diag,
    };
  }
  return rest2;
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

/* ------------------------------------------------------------ 通用表格 */

/**
 * 通用表格解析：把 <table class="table1"> 拆成「表头 + 每行单元格文本」。
 * 排班 / 培训 / 表彰 / 求证 / 评论 这些页面结构一致，用一套解析就够。
 */
export function parseGenericTable(html) {
  const clean = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const idx = clean.indexOf('class="table1');
  if (idx < 0) return { headers: [], rows: [] };

  const start = clean.lastIndexOf('<table', idx);
  const end = clean.indexOf('</table>', start);
  const table = clean.slice(start, end < 0 ? undefined : end);

  let headers = [];
  const rows = [];
  for (const tr of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const inner = tr[1];
    if (/<th\b/i.test(inner)) {
      headers = [...inner.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => textOf(m[1]));
      continue;
    }
    const cells = [...inner.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => textOf(m[1]));
    if (cells.length) rows.push(cells);
  }
  return { headers, rows };
}

/** 抓一个通用表格页 */
export async function fetchGenericPage(session, host, path) {
  const { html, needLogin } = await fetchPage(session, host, path);
  if (needLogin) throw new Error('登录已过期，请重新登录');
  return parseGenericTable(html);
}

/* ------------------------------------------------------------ 志愿者证 */

/**
 * 从志愿者证页面取出卡片图片地址。
 * 只保留属于用户自己的图片（/images/temp/ 和 /images/card/），
 * 过滤掉站点通用的客服二维码之类。
 */
export function parseCardImages(html, host) {
  const out = [];
  for (const m of String(html ?? '').matchAll(/<img\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const src = m[1];
    if (/wx_pic|xcx_pic|noimg_avatar|zyyzj_wx|zyy_xcx/.test(src)) continue;
    if (!/\/images\/(temp|card)\//i.test(src)) continue;
    out.push(/^https?:/i.test(src) ? src : `https://${host}${src.startsWith('/') ? '' : '/'}${src}`);
  }
  return [...new Set(out)];
}

/** 抓志愿者证页，返回图片地址列表 */
export async function fetchCard(session, host) {
  const { html, needLogin } = await fetchPage(session, host, '/app/user/card.php');
  if (needLogin) throw new Error('登录已过期，请重新登录');
  return { images: parseCardImages(html, host) };
}

/** 时间证明 PDF 的地址（该接口直接返回 PDF 文件流） */
export function certUrl(host) {
  return `${origin(host)}/app/user/cert.php`;
}

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
