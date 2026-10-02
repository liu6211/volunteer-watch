/**
 * 志愿云团体页链接解析工具
 *
 * 支持的输入格式（用户怎么方便怎么填）：
 *   https://gz.zhiyuanyun.com/app/org/view.php?id=Vl6t7DSgAHI3O
 *   https://www.zhiyuanyun.com/app/org/view.php?id=Vl6t7DSgAHI3O
 *   gz.zhiyuanyun.com/app/org/view.php?id=Vl6t7DSgAHI3O
 *   /app/org/view.php?id=Vl6t7DSgAHI3O
 *   Vl6t7DSgAHI3O                       （裸 id）
 *   6385777                             （团队编号，无法直接定位，需完整链接）
 */

/** 默认站点，用户没写域名时用它 */
export const DEFAULT_HOST = 'gz.zhiyuanyun.com';

/** 站点根路径上的所有子域（省级分站） */
export const KNOWN_SUBDOMAINS = [
  'www', 'gz', 'tj', 'he', 'sx', 'nm', 'ln', 'jl', 'hl', 'sh', 'js', 'zj',
  'ah', 'fj', 'jx', 'sd', 'ha', 'hb', 'hn', 'gd', 'gx', 'hi', 'cq', 'sc',
  'yn', 'xz', 'sn', 'gs', 'qh', 'nx', 'xj', 'bt', 'npo',
];

/** 团体 id 的形态：通常是 13~15 位、大小写字母数字混合 */
const ID_RE = /^[A-Za-z0-9=]{8,32}$/;

/**
 * @typedef {Object} OrgTarget
 * @property {string} id       团体 id，如 Vl6t7DSgAHI3O
 * @property {string} host     站点域名，如 gz.zhiyuanyun.com
 * @property {string} url      规范化后的完整链接
 */

/**
 * 把用户输入的各种形式统一成 { id, host, url }
 * @param {string} input
 * @returns {OrgTarget}
 * @throws {Error} 无法识别时抛出带中文说明的错误
 */
export function normalizeOrgInput(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('请填写团体链接或团体 id');

  // 1) 裸 id
  if (ID_RE.test(raw) && !raw.includes('/') && !raw.includes('.')) {
    return { id: raw, host: DEFAULT_HOST, url: orgViewUrl(DEFAULT_HOST, raw) };
  }

  // 2) 补全协议，方便用 URL 解析
  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = 'https://' + candidate.replace(/^\/+/, '');
  }

  let u;
  try {
    u = new URL(candidate);
  } catch {
    throw new Error(`无法识别的链接：${raw}`);
  }

  const host = u.hostname.toLowerCase();
  if (!/(^|\.)zhiyuanyun\.com$/i.test(host)) {
    throw new Error(`域名看起来不是志愿云站点：${host}`);
  }

  // 3) 从查询串里取 id
  let id = u.searchParams.get('id') || '';

  // 4) 也支持 /app/org/12345 这种路径形式
  if (!id) {
    const m = u.pathname.match(/\/org\/(?:view\/)?([A-Za-z0-9=]{8,32})\b/);
    if (m) id = m[1];
  }

  if (!id) {
    throw new Error('链接里没有找到团体 id（缺少 ?id=... 参数）');
  }
  if (!ID_RE.test(id)) {
    throw new Error(`团体 id 格式可疑：${id}`);
  }

  return { id, host, url: orgViewUrl(host, id) };
}

/**
 * 拼出团体主页链接
 * @param {string} host
 * @param {string} id
 */
export function orgViewUrl(host, id) {
  return `https://${host}/app/org/view.php?id=${encodeURIComponent(id)}`;
}

/**
 * 拼出项目详情链接
 * @param {string} host
 * @param {string} oppId
 */
export function oppViewUrl(host, oppId) {
  return `https://${host}/app/opp/view.php?id=${encodeURIComponent(oppId)}`;
}

/**
 * 给用户看的站点识别名，例如 gz.zhiyuanyun.com -> 志愿贵州
 * @param {string} host
 */
export function siteLabel(host) {
  const sub = host.replace(/\.zhiyuanyun\.com$/i, '').toLowerCase();
  /** @type {Record<string,string>} */
  const map = {
    gz: '志愿贵州', www: '志愿中国', bj: '志愿北京', tj: '志愿天津',
    he: '志愿河北', sx: '志愿山西', nm: '志愿内蒙古', ln: '志愿辽宁',
    jl: '志愿吉林', hl: '志愿黑龙江', sh: '志愿上海', js: '志愿江苏',
    zj: '志愿浙江', ah: '志愿安徽', fj: '志愿福建', jx: '志愿江西',
    sd: '志愿山东', ha: '志愿河南', hb: '志愿湖北', hn: '志愿湖南',
    gd: '志愿广东', gx: '志愿广西', hi: '志愿海南', cq: '志愿重庆',
    sc: '志愿四川', yn: '志愿云南', xz: '志愿西藏', sn: '志愿陕西',
    gs: '志愿甘肃', qh: '志愿青海', nx: '志愿宁夏', xj: '志愿新疆',
    bt: '志愿兵团', npo: '志愿组织',
  };
  return map[sub] || host;
}
