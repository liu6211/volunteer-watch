/**
 * 志愿云「团体搜索」
 *
 * 实测结论（2026-10）：
 *   搜索接口 = /app/org/list.php?name=<关键词>   ← 参数名是 name，不是 keyword
 *   结果列表 = <ul class="list1"> 下若干 <li class="clearfix">
 *     每条的标题链接形如 <p class="ptitle"><a href="/app/org/view.php?id=XXX" title="名称">名称</a></p>
 *
 * ⚠️ 关于 id 的重要发现：
 *   列表页给出的 id 每次请求都会变（服务端加密），但【旧 id 仍然能正常解析】。
 *   更关键的是，团体页里的 org_join(6385777) 那个【数字编号也能直接当 id 用】：
 *       /app/org/view.php?id=6385777  →  正确打开该团体
 *   数字编号是数据库主键，长期稳定。所以 App 里统一用数字 id 作为监控项的 id，
 *   搜索时先拿列表链接定位，再解析出数字 id 存下来。
 */

import { detectCharset, decodeHtml } from './parser.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 默认（也是唯一）的搜索站点。
 *
 * 需求明确：只在贵州站里搜，不要扩展到其它省份。
 * 各省分站是独立站点，数据不互通，所以固定用 gz。
 */
export const SEARCH_HOST = 'gz.zhiyuanyun.com';

/**
 * @typedef {Object} OrgSearchItem
 * @property {string} linkId   列表页给出的加密 id（用于本次打开团体页）
 * @property {string} name     团体名称
 * @property {number|null} members 团体人数，取不到为 null
 * @property {string} url      该团的完整链接（用 linkId）
 */

/**
 * 贵州站下属的「团体属地」筛选（数据来自站点搜索表单的真实参数）
 * 需求：只在贵州站里搜，不扩展到其它省份。
 */
export const GUIZHOU_AREAS = [
  { code: '0', label: '全部' },
  { code: '8152', label: '贵阳市' },
  { code: '8275', label: '遵义市' },
  { code: '8163', label: '六盘水市' },
  { code: '8290', label: '安顺市' },
  { code: '8306', label: '铜仁市' },
  { code: '8297', label: '毕节市' },
  { code: '8326', label: '黔东南' },
  { code: '8343', label: '黔南' },
  { code: '8317', label: '黔西南' },
];

/**
 * 拼搜索请求地址
 * 站点真实表单字段：团体名称 = name，团体属地 = area
 * @param {string} host 站点域名
 * @param {string} keyword 关键词（可为空，此时只按属地筛）
 * @param {{ page?: number, area?: string }} [opts]
 */
export function searchUrl(host, keyword, opts = {}) {
  const base = `https://${host}/app/org/list.php`;
  const params = new URLSearchParams();
  params.set('name', String(keyword ?? '').trim());
  const area = opts.area ?? '0';
  if (area && area !== '0') {
    params.set('area', area);
    params.set('area2', '0');
  }
  const page = opts.page ?? 1;
  if (page > 1) params.set('p', String(page));
  return `${base}?${params.toString()}`;
}

/** 解码 HTML 实体 */
function decodeEntities(s) {
  if (!s) return '';
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; }
    })
    .replace(/&#(\d+);/g, (_, d) => {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ''; }
    })
    .replace(/&([a-z]+);/gi, (m, n) => (n in named ? named[n] : m));
}

/** 去标签 + 解码实体 + 压空白 */
function textOf(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/**
 * 解析搜索结果页
 * @param {string} html
 * @param {string} host
 * @returns {{ items: OrgSearchItem[], total: number|null, totalPages: number|null }}
 */
export function parseOrgList(html, host = 'gz.zhiyuanyun.com') {
  const source = String(html ?? '');

  // 只处理列表容器，避免把页面其它地方的链接也捞进来
  const ulIdx = source.indexOf('class="list1');
  const scope = ulIdx >= 0 ? source.slice(ulIdx) : source;

  /** @type {OrgSearchItem[]} */
  const items = [];
  const seen = new Set();

  // 按 <li> 切块
  const blocks = scope.split(/<li\b[^>]*>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/li>/i)[0];
    if (!block) continue;

    // 优先取标题链接（p.title），退化到第一条 org/view 链接
    let m = block.match(
      /<p[^>]*class\s*=\s*["'][^"']*ptitle[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href\s*=\s*["']([^"']*\/app\/org\/view\.php\?id=([^"'&\s]+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i
    );
    if (!m) {
      m = block.match(
        /<a\b[^>]*href\s*=\s*["']([^"']*\/app\/org\/view\.php\?id=([^"'&\s]+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i
      );
    }
    if (!m) continue;

    const href = m[1];
    const linkId = decodeURIComponent(m[2]);
    let name = textOf(m[3]);

    // 名称可能只在 title 属性里（图片链接那种）
    if (!name) {
      const t = block.match(/title\s*=\s*["']([^"']+)["']/i);
      name = t ? decodeEntities(t[1]).trim() : '';
    }
    if (!linkId || !name || seen.has(linkId)) continue;
    seen.add(linkId);

    const mem = block.match(/团体人数[：:]\s*(\d+)/);
    items.push({
      linkId,
      name,
      members: mem ? Number(mem[1]) : null,
      url: /^https?:\/\//i.test(href)
        ? href
        : `https://${host}${href.startsWith('/') ? '' : '/'}${href}`,
    });
  }

  // 「 1 页 / 2 记录」
  let total = null;
  let totalPages = null;
  const tm = source.match(/(\d+)\s*页\s*\/\s*(\d+)\s*记录/);
  if (tm) {
    totalPages = Number(tm[1]);
    total = Number(tm[2]);
  }

  return { items, total, totalPages };
}

/**
 * 抓取并解析搜索
 * @param {string} host
 * @param {string} keyword
 * @param {{ page?: number, timeoutMs?: number, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ items: OrgSearchItem[], total: number|null, totalPages: number|null }>}
 */
export async function searchOrgs(host, keyword, opts = {}) {
  const kw = String(keyword ?? '').trim();
  const area = opts.area ?? '0';
  // 关键词和属地至少给一个，否则等于把全站拉出来
  if (!kw && area === '0') throw new Error('请输入要搜索的团体名称，或先选一个属地');

  const url = searchUrl(host, kw, { page: opts.page ?? 1, area });
  const timeoutMs = opts.timeoutMs ?? 20000;
  const doFetch = opts.fetchImpl || fetch;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: ac.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`搜索请求失败：HTTP ${res.status}`);

    const buf = new Uint8Array(await res.arrayBuffer());
    // 复用 parser 里的编码识别与解码：那里已经避开了 Hermes 不支持的 latin1
    const charset = detectCharset(res.headers.get('content-type'), buf);
    const html = decodeHtml(buf, charset);

    return parseOrgList(html, host);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把「搜索结果的链接 id」转换成稳定的「数字团号链接」
 *
 * 做法：先按 linkId 打开团体页，从页面里的 org_join(6385777) 取出数字编号，
 * 再用数字编号拼出长期可用的链接。取不到就退回原链接。
 *
 * @param {string} host
 * @param {string} linkId
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ stableId: string|null, url: string, name?: string }>}
 */
export async function resolveStableOrgId(host, linkId, opts = {}) {
  const linkUrl = `https://${host}/app/org/view.php?id=${encodeURIComponent(linkId)}`;
  const timeoutMs = opts.timeoutMs ?? 20000;
  const doFetch = opts.fetchImpl || fetch;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await doFetch(linkUrl, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: ac.signal,
      redirect: 'follow',
    });
    const html = new TextDecoder('utf-8', { fatal: false }).decode(
      new Uint8Array(await res.arrayBuffer())
    );
    const m = html.match(/org_join\(\s*(\d+)/);
    if (m) {
      return {
        stableId: m[1],
        url: `https://${host}/app/org/view.php?id=${m[1]}`,
      };
    }
  } catch {
    // 解析失败就退回原链接，不阻断添加流程
  } finally {
    clearTimeout(timer);
  }
  return { stableId: null, url: linkUrl };
}
