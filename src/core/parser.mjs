/**
 * 志愿云团体页解析器
 *
 * 关键发现（实测得出，不是猜测）：
 *   团体页 https://gz.zhiyuanyun.com/app/org/view.php?id=XXX 中，
 *   「发起的项目」标签页 (id="tabs2") 的内容实际上【已经在 HTML 里】，
 *   放在 <div id="con2" style="display:none"> 内，只是默认隐藏。
 *   所以不需要 WebView、不需要模拟点击、不需要额外的 AJAX 请求，
 *   直接抓 HTML 解析即可。
 *
 * 实测样本：都匀三中青年志愿者服务队，一次抓到 20 个项目。
 *
 * ⚠️ 两个实测踩到的坑，务必保留对应处理：
 *   1. 项目链接里的 id 是【会话级加密】的，每次请求都不同，
 *      不能用来去重（详见 fingerprint.mjs）。
 *   2. 团体 id 无效时，站点【不会报错】，而是返回一个通用的
 *      登录 / 注册页（标题「志愿贵州」），项目数为 0。
 *      必须主动识别这种页面，否则会误判为「该团体没有项目」。
 */
import { fingerprintOf, toCounts, findNewByCounts } from './fingerprint.mjs';

// 方便 App 侧统一从 parser.mjs 引入
export { fingerprintOf, toCounts, findNewByCounts, pruneCounts } from './fingerprint.mjs';

/** 请求头：伪装成普通浏览器，避免被拦 */
const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

/**
 * @typedef {Object} OppItem
 * @property {string} id        项目链接里的 id（注意：每次请求都会变，仅用于打开链接）
 * @property {string} fingerprint 去重指纹（名称+日期+状态），稳定可用
 * @property {string} name      项目名称
 * @property {string} date      发布日期，如 2026-10-01
 * @property {string} status    项目状态，如 运行中 / 自动结项
 * @property {string} url       项目详情链接
 */

/**
 * @typedef {Object} OrgSnapshot
 * @property {string} orgId      团体数字编号（org_join 里的那个），如 6385777
 * @property {string} orgName    团体名称
 * @property {OppItem[]} projects  所有项目
 * @property {string[]} projectIds  项目链接 id（不稳定，仅供调试）
 * @property {Record<string, number>} counts 指纹计数表（用于下次比较）
 * @property {string} fetchedAt  抓取时间 ISO 字符串
 */

/**
 * 从 HTTP 响应头或 HTML meta 判断字符集
 * @param {string|null} contentType
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function detectCharset(contentType, bytes) {
  let cs = '';
  const m = (contentType || '').match(/charset\s*=\s*["']?\s*([\w-]+)/i);
  if (m) cs = m[1];

  if (!cs) {
    // 只看前 4KB，避免大页面浪费
    const head = asciiHead(bytes, 4096);
    const m2 = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i);
    if (m2) cs = m2[1];
  }

  cs = (cs || 'utf-8').toLowerCase();
  if (cs === 'gbk' || cs === 'gb2312' || cs === 'gb18030' || cs === 'gb-2312') {
    return 'gb18030'; // gb18030 是 gbk/gb2312 的超集
  }
  return 'utf-8';
}

/**
 * 把字节当成 ASCII 读成字符串（只看标签用的）。
 *
 * ⚠️ 不能用 `new TextDecoder('latin1')`：
 * 手机上的 Hermes 引擎只支持 utf-8/gb18030 等少数编码，
 * 遇到 'latin1' 会直接抛 "Unknown encoding: latin1" 把整条链路打断。
 * 这里手动按字节拼，任何环境都能跑；非 ASCII 字节变成乱码也无所谓，
 * 因为我们只是用它去找 `charset=` 这种纯 ASCII 标记。
 *
 * @param {Uint8Array} bytes
 * @param {number} n 最多读多少字节
 */
export function asciiHead(bytes, n = 4096) {
  const end = Math.min(n, bytes.length);
  let out = '';
  for (let i = 0; i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/**
 * 按检测到的字符集解码字节
 * @param {Uint8Array} bytes
 * @param {string} charset
 */
export function decodeHtml(bytes, charset) {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    // 运行环境不支持该编码时退回 utf-8，并替换非法字节，避免整个崩溃
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

/**
 * 解码常见 HTML 实体
 * @param {string} s
 */
export function decodeEntities(s) {
  if (!s) return '';
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ldquo: '“', rdquo: '”', mdash: '—', hellip: '…',
  };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (n in named ? named[n] : m));
}

/** @param {number} cp */
function safeFromCodePoint(cp) {
  try {
    return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
  } catch {
    return '';
  }
}

/** 去掉标签、压缩空白、解码实体 */
function textOf(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/**
 * 判断这个页面是不是「团体页」。
 *
 * 实测：团体 id 无效时站点返回通用登录/注册页，不报错。
 * 这种页面里没有 org_join(...) 调用，也没有项目表格，
 * 但会出现大量登录/注册链接。
 * @param {string} html
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateOrgPage(html) {
  const source = String(html ?? '');

  // 明确的不存在提示（主站会对错误 id 这样返回）
  if (/团体不存在|organization does not exist|该团体已解散/.test(source)) {
    return { ok: false, reason: '团体不存在' };
  }

  const hasJoin = /org_join\(\s*\d+/.test(source);
  const hasTabs = /id="tabs2"/.test(source) || /发起的项目/.test(source);
  const hasProjects = /\/app\/opp\/view\.php\?/.test(source);

  // 正常团体页：有「我要加入」按钮，或有标签栏
  if (hasJoin || hasTabs) return { ok: true };

  // 未登录的通用页特征：出现「亲，请登录」或「志愿者注册」等入口
  const hasLoginPrompt = /亲，请登录|志愿者注册|志愿团体注册/.test(source);
  const loginLinks = (source.match(/\/app\/user\/login\.php/g) || []).length;
  const registerLinks = (source.match(/\/app\/user\/register\.php/g) || []).length;

  if (!hasProjects && (hasLoginPrompt || loginLinks >= 2 || registerLinks >= 2)) {
    return {
      ok: false,
      reason: '打开的是登录 / 注册页，说明这个团体链接无效（或该团体已不存在）',
    };
  }

  if (!hasProjects) {
    return { ok: false, reason: '页面里没有团体信息，可能链接不对' };
  }

  return { ok: true };
}

/**
 * 解析团体页 HTML
 * @param {string} html
 * @param {{ host?: string }} [opts]
 * @returns {OrgSnapshot}
 */
export function parseOrgPage(html, opts = {}) {
  const host = opts.host || 'gz.zhiyuanyun.com';
  const source = String(html ?? '');

  const check = validateOrgPage(source);
  if (!check.ok) {
    throw new Error(check.reason || '页面无法识别');
  }

  const orgName = parseOrgName(source);
  const orgId = parseOrgId(source);
  const projects = parseProjects(source, host);

  if (!orgName && projects.length === 0) {
    throw new Error('页面里没有解析到团体信息，可能是链接错误或站点改版了');
  }

  return {
    orgId,
    orgName,
    projects,
    projectIds: projects.map((p) => p.id),
    counts: toCounts(projects),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 团体名称：页面正文里的 <h2>【6385777】都匀三中青年志愿者服务队</h2>
 * @param {string} html
 */
export function parseOrgName(html) {
  // 优先取正文 h2（比 <title> 可靠，因为无效页的 title 是「志愿贵州」）
  const h2s = [...String(html).matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
  for (const m of h2s) {
    const raw = textOf(m[1]);
    if (!raw) continue;
    // 【6385777】都匀三中青年志愿者服务队
    const bracket = raw.match(/】\s*(\S[\s\S]*)$/);
    if (bracket) {
      const name = bracket[1].trim();
      if (name && !/^志愿/.test(name)) return name;
    }
  }

  const t = String(html).match(/<title>([\s\S]*?)<\/title>/i);
  if (t) {
    const name = textOf(t[1]).replace(/\s*[-—|]\s*志愿[\u4e00-\u9fa5]*\s*$/, '').trim();
    if (name && !/^志愿云|^领先全国|^志愿中国$|^志愿[\u4e00-\u9fa5]+$/.test(name)) {
      return name;
    }
  }
  return '';
}

/**
 * 团体数字编号：页面上有 org_join(6385777,0) 这类调用。
 * 注意这与 URL 里 ?id= 的值【不同】，后者是加密串。
 * @param {string} html
 */
export function parseOrgId(html) {
  const s = String(html);

  /*
   * ⚠️ 优先取标题里的【数字】：
   *   <h1 class="l">【32702119】&nbsp;都匀三中</h1>
   * 这个才是团体编号，也正是 get_opps 接口要的参数。
   *
   * 不能优先用 org_join(数字)：那是加入团体用的另一个编号，
   * 拿错就会让「发起的项目」接口返回空表。
   */
  const title = s.match(/<h[12][^>]*>[\s\S]{0,80}?【\s*(\d{4,})\s*】/);
  if (title) return title[1];

  const m = s.match(/org_join\(\s*(\d{4,})/);
  return m ? m[1] : '';
}

/**
 * 解析「发起的项目」表格
 *
 * 表格形如：
 *   <div id="opps"><table class="table1">
 *     <tr><th>项目名称</th><th width="120">发布日期</th><th width="100">项目状态</th></tr>
 *     <tr><td><a href="/app/opp/view.php?id=XXX" target="_blank">名称</a></td>
 *         <td>2026-10-01</td><td><font color="green">运行中</font></td></tr>
 * @param {string} html
 * @param {string} host
 * @returns {OppItem[]}
 */
export function parseProjects(html, host = 'gz.zhiyuanyun.com') {
  const source = String(html);

  // 先定位 con2 区块（没有就退回全文，兼容改版）
  let scope = source;
  const con2 = source.indexOf('id="con2"');
  if (con2 >= 0) {
    const tblEnd = source.indexOf('</table>', con2);
    scope = tblEnd > 0 ? source.slice(con2, tblEnd + 8) : source.slice(con2);
  }

  /** @type {OppItem[]} */
  const items = [];

  const rowRe =
    /<a\b[^>]*href\s*=\s*["']([^"']*\/app\/opp\/view\.php\?[^"']*?)["'][^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;

  for (const m of scope.matchAll(rowRe)) {
    const href = m[1];
    const name = textOf(m[2]);
    const date = textOf(m[3]);
    const status = textOf(m[4]);
    if (!name) continue;

    items.push({
      id: extractLinkId(href),
      fingerprint: fingerprintOf({ name, date, status }),
      name,
      date,
      status,
      url: absoluteUrl(href, host),
    });
  }

  // 兼容：表格结构变化时，至少把链接捞出来
  if (items.length === 0) {
    const linkRe = /<a\b[^>]*href\s*=\s*["']([^"']*\/app\/opp\/view\.php\?[^"']*?)["'][^>]*>([\s\S]*?)<\/a>/gi;
    for (const m of scope.matchAll(linkRe)) {
      const name = textOf(m[2]);
      if (!name) continue;
      items.push({
        id: extractLinkId(m[1]),
        fingerprint: fingerprintOf({ name, date: '', status: '' }),
        name,
        date: '',
        status: '',
        url: absoluteUrl(m[1], host),
      });
    }
  }

  return items;
}

/** 从链接里取出 id */
function extractLinkId(href) {
  const m = String(href).match(/[?&]id=([^&"']+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

/** 相对链接转绝对 */
function absoluteUrl(href, host) {
  if (/^https?:\/\//i.test(href)) return href;
  return `https://${host}${href.startsWith('/') ? '' : '/'}${href}`;
}

/**
 * 抓取并解析一个团体页
 * @param {string} url
 * @param {{ host?: string, timeoutMs?: number, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<OrgSnapshot>}
 */
/**
 * 抓「发起的项目」的某一页。
 *
 * ⚠️ 团体页里的项目列表是【AJAX 加载】的（con2 区块初始为空），
 * 所以只抓页面本身永远拿不到项目，更拿不到第 2 页以后。
 * 站点自己的调用是：
 *   get_opps(type, id, p) → /app/api/view.php?m=get_opps&type=&id=&p=
 * 实测【type=2 + 数字团体编号】才返回「发起的项目」，每页 20 条。
 *
 * @returns {Promise<{items: OppItem[], hasNext: boolean}>}
 */
export async function fetchOppsPage(host, orgId, page, opts = {}) {  const doFetch = opts.fetchImpl || fetch;
  // 注意：parser.mjs 里没有 origin() 辅助函数，这里直接拼，
  // 之前误用 origin(host) 导致每页都抛 ReferenceError 被吞掉。
  const base = host.startsWith('http') ? host : `https://${host}`;
  const url = `${base}/app/api/view.php?m=get_opps&type=2&id=${encodeURIComponent(orgId)}&p=${page}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 20000);
  try {
    const res = await doFetch(url, {
      headers: { ...DEFAULT_HEADERS, 'X-Requested-With': 'XMLHttpRequest' },
      signal: ac.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const buf = new Uint8Array(await res.arrayBuffer());
    const charset = detectCharset(res.headers.get('content-type'), buf);
    const html = decodeHtml(buf, charset);

    const items = parseProjects(html, host);

    // 分页控件里出现的最大页码；没有控件就按「满 20 条」推断可能还有下一页
    const pages = [...html.matchAll(/[?&]p=(\d+)/g)].map((m) => Number(m[1]));
    const maxPage = pages.length ? Math.max(...pages) : page;
    const hasNext = maxPage > page || items.length >= 20;

    return { items, hasNext };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 抓一个团体的完整快照。
 *
 * 先取团体页拿到名称/编号，再【逐页】拉「发起的项目」——
 * 站点每页只有 20 条，只取第一页会漏掉大量项目。
 */
export async function fetchOrgSnapshot(url, opts = {}) {
  const host = opts.host || (() => {
    try { return new URL(url).hostname; } catch { return 'gz.zhiyuanyun.com'; }
  })();
  const timeoutMs = opts.timeoutMs ?? 20000;
  const doFetch = opts.fetchImpl || fetch;
  /*
   * 默认【只抓第 1 页】。
   *
   * 站点列表按发布日期倒序，新项目一定出现在最前面，所以监控第 1 页就够；
   * 一次把几百个项目全拉下来没必要（用户明确要求按页来）。
   * 需要更多页时传 opts.maxPages，或用 fetchOppsPage 逐页取。
   */
  const maxPages = Math.max(1, Math.min(50, Number(opts.maxPages) || 1));

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  let page;
  try {
    const res = await doFetch(url, { headers: DEFAULT_HEADERS, signal: ac.signal, redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`请求失败：HTTP ${res.status}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const charset = detectCharset(res.headers.get('content-type'), buf);
    const html = decodeHtml(buf, charset);

    page = parseOrgPage(html, { host });
  } finally {
    clearTimeout(timer);
  }

  const orgId = page.orgId;
  if (!orgId) return page;

  /*
   * 逐页补全。
   *
   * ⚠️ 不能「这一页没有新增就停止」：团体页本身往往已经嵌了第 1 页的
   * 20 个项目，于是抓第 1 页时新增为 0，会立刻 break、永远拿不到第 2 页。
   * 所以只在【没有下一页】或【连续两页都无新增】时才停。
   */
  const seen = new Set(page.projects.map((p) => p.fingerprint));
  const all = [...page.projects];
  let emptyStreak = 0;
  /** 抓页过程中的错误（只记录，不影响整体判定） */
  const pageErrors = [];

  for (let p = 1; p <= maxPages; p++) {
    let r;
    try {
      r = await fetchOppsPage(host, orgId, p, { ...opts, timeoutMs });
    } catch (e) {
      /*
       * 某一页失败就停下，已拿到的照常用（不要把整次检查判为失败）。
       * 但错误要记下来 —— 之前这里直接 break 把 ReferenceError 吞了，
       * 结果「只抓到 20 个」查了很久。
       */
      pageErrors.push(`第 ${p} 页: ${(e && e.message) || e}`);
      break;
    }
    if (!r.items.length) break;

    let added = 0;
    for (const it of r.items) {
      if (seen.has(it.fingerprint)) continue;
      seen.add(it.fingerprint);
      all.push(it);
      added++;
    }

    emptyStreak = added === 0 ? emptyStreak + 1 : 0;
    // 没有下一页，或连续两页都是重复内容 → 收工
    if (!r.hasNext || emptyStreak >= 2) break;
  }

  return {
    ...page,
    projects: all,
    projectIds: all.map((p) => p.id),
    counts: toCounts(all),
    pageErrors,
  };
}

/* ------------------------------------------------ 兼容旧 API 的差集函数 */

/**
 * 找出新项目（新版：基于指纹计数）
 *
 * @param {{ name?: string, date?: string, status?: string }[]} current 本次抓到的项目
 * @param {Record<string, number>} seenCounts 上次的指纹计数表
 * @returns {{ item: any, reason: 'new-id' | 'new-date' }[]}
 */
export function findNewProjects(current, seenCounts) {
  const hits = findNewByCounts(current, seenCounts || {});
  return hits.map((h) => ({
    item: h.item,
    // 语义保持：not-in-baseline ≈ 全新的项目；new-count ≈ 同名的又办了一次
    reason: /** @type {'new-id' | 'new-date'} */ (
      h.reason === 'new-count' ? 'new-date' : 'new-id'
    ),
  }));
}

/**
 * 宽松解析日期：支持 2026-10-01 / 2026/10/01 / 2026年10月1日
 * @param {string} s
 * @returns {number} 毫秒时间戳，失败返回 NaN
 */
export function parseLooseDate(s) {
  if (!s) return NaN;
  const t = String(s).trim();
  let m = t.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return new Date(Number(y), Number(mo) - 1, Number(d)).getTime();
  }
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  }
  const d = Date.parse(t);
  return Number.isFinite(d) ? d : NaN;
}

/**
 * 生成通知文案
 * @param {string} orgName
 * @param {OppItem[]} items
 * @returns {{ title: string, body: string }}
 */
export function buildNotificationText(orgName, items) {
  const list = items || [];
  if (list.length === 1) {
    const it = list[0];
    return {
      title: `新志愿项目：${it.name}`.slice(0, 60),
      body: `${orgName}${it.date ? ` · ${it.date}` : ''}${it.status ? ` · ${it.status}` : ''}`,
    };
  }
  const names = list.slice(0, 3).map((i) => i.name).join('、');
  return {
    title: `${orgName} 有 ${list.length} 个新项目`,
    body: list.length > 3 ? `${names} 等 ${list.length} 个` : names,
  };
}
