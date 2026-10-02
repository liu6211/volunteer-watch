/**
 * 项目指纹与差集计算
 *
 * ⚠️ 为什么不用项目 id 去重（踩过的坑）：
 * 实测发现志愿云对项目链接里的 id 做了「会话级加密」——
 *   同一个项目，两次请求拿到的 id 完全不同：
 *     第一次  /app/opp/view.php?id=3zCRrcYEqNnOt
 *     第二次  /app/opp/view.php?id=8kp0qtXjsa66i
 *   但项目名称序列完全一致，响应头显示 PHPSESSID 每次都变。
 * 所以 id 不能作为去重依据，否则每次检查都会误报「20 个新项目」。
 *
 * 改用「名称 + 发布日期 + 状态」组成指纹，并用【多重集合计数】比较：
 * 同一个指纹可能出现多次（例如同名活动连办几天、日期也相同），
 * 因此要看的是「这个指纹的条数有没有变多」，而不是「有没有出现过」。
 */

/**
 * 计算一个项目的指纹
 * @param {{ name?: string, date?: string, status?: string }} item 项目
 * @returns {string}
 */
export function fingerprintOf(item) {
  const name = String(item?.name ?? '').replace(/\s+/g, ' ').trim();
  const date = String(item?.date ?? '').trim();
  const status = String(item?.status ?? '').trim();
  return `${name}\u0001${date}\u0001${status}`;
}

/**
 * 把项目列表转成「指纹 -> 条数」的计数表
 * @param {{ name?: string, date?: string, status?: string }[]} items
 * @returns {Record<string, number>}
 */
export function toCounts(items) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const it of items || []) {
    const fp = fingerprintOf(it);
    if (!fp) continue;
    counts[fp] = (counts[fp] || 0) + 1;
  }
  return counts;
}

/**
 * 找出相对上次计数表新增的项目
 *
 * @param {{ name?: string, date?: string, status?: string }[]} current 本次抓到的项目
 * @param {Record<string, number>} seenCounts 上次的「指纹 -> 条数」
 * @returns {{ item: any, reason: 'new-count' | 'not-in-baseline' }[]}
 */
export function findNewByCounts(current, seenCounts) {
  const list = current || [];
  const baseline = seenCounts || {};

  // 首次运行：全部视为「登记」，不通知，避免一装上就刷一堆
  if (Object.keys(baseline).length === 0) return [];

  /** @type {Record<string, number>} 本次已消耗的配额：指纹 -> 已见条数 */
  const used = {};
  const hits = [];

  for (const item of list) {
    const fp = fingerprintOf(item);
    const known = baseline[fp] || 0;
    const already = used[fp] || 0;
    used[fp] = already + 1;

    // 这个条数在基线里已经存在，不算新增
    if (already < known) continue;

    hits.push({ item, reason: known > 0 ? 'new-count' : 'not-in-baseline' });
  }

  return hits;
}

/**
 * 重建基线：只保留当前列表里还存在的指纹。
 *
 * 项目会被下架，如果基线一直累积，同指纹项目就永远无法再次通知。
 * 所以每次检查后都用当前列表重建基线。
 *
 * @param {Record<string, number>} counts 旧计数表（不使用，保留参数以便将来扩展）
 * @param {{ name?: string, date?: string, status?: string }[]} current 本次项目列表
 * @returns {Record<string, number>}
 */
export function pruneCounts(counts, current) {
  void counts;
  return toCounts(current);
}
