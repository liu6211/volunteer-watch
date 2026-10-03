/**
 * 志愿项目：详情解析 + 一键报名
 *
 * 全部机制实测自站点（2026-10）：
 *   详情页   GET  /app/opp/view.php?id=<数字项目编号>   ← 公开页面，不需要登录
 *   报名接口 POST /app/api/view.php?m=opp_join
 *            参数 { opp_id, job_id }（免审密码/问题为空时）
 *            返回 JSON { msg }，msg 就是结果提示
 *
 * 站点自己的流程（login.js 里的 opp_join）：
 *   第一次点击只是弹出「关于报名志愿服务项目的提示」让你阅读，
 *   读完再点才真正提交。App 里用一次确认弹窗代替。
 */

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/*
 * ⚠️ 为什么不用原生 URLSearchParams：
 * React Native 里的 polyfill 对「用对象初始化」支持不完整，
 * new QS({a:1}) 在手机上会得到空串 —— 参数全丢，
 * 于是所有「需要发数据」的按钮都会失败（报「请选择岗位」之类），
 * 而 Node 里完全正常，本地测不出来。所以自己实现一个。
 */
class QS {
  constructor(init) {
    this._p = [];
    if (typeof init === 'string') {
      for (const kv of init.replace(/^\?/, '').split('&')) {
        if (!kv) continue;
        const i = kv.indexOf('=');
        const k = i < 0 ? kv : kv.slice(0, i);
        const v = i < 0 ? '' : kv.slice(i + 1);
        this._p.push([decodeURIComponent(k), decodeURIComponent(v)]);
      }
    } else if (init && typeof init === 'object') {
      for (const k of Object.keys(init)) {
        if (init[k] === undefined || init[k] === null) continue;
        this._p.push([k, String(init[k])]);
      }
    }
  }
  set(k, v) {
    this._p = this._p.filter(([a]) => a !== k);
    this._p.push([String(k), String(v)]);
  }
  append(k, v) { this._p.push([String(k), String(v)]); }
  get(k) {
    const f = this._p.find(([a]) => a === k);
    return f ? f[1] : null;
  }
  has(k) { return this._p.some(([a]) => a === k); }
  toString() {
    return this._p
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
      .join('&');
  }
}

const REQUEST_TIMEOUT_MS = 25000;

/** @typedef {{ index:number, title:string, plan:number|null, joined:number|null, jobId:string, desc:string, condition:string }} OppPost */

/**
 * 取某个标签后面的值。
 *
 * ⚠️ 必须在【纯文本】上匹配，不能在 HTML 上匹配：
 * 站点把标签和值放在不同单元格里（<td>项目地点：</td><td>都匀三中</td>），
 * 直接对 HTML 用「标签后面到第一个 < 为止」会把值截成空字符串。
 */
function field(plainText, label) {
  const re = new RegExp(`${label}\\s*[：:]\\s*([^\\n]{0,60})`, 'i');
  const m = String(plainText).match(re);
  return m ? m[1].replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim() : '';
}

/** 去标签，把页面变成纯文本（保留换行，便于按行取值） */
function textOf(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:td|th|div|p|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 解析项目详情页
 * @param {string} html
 * @param {string} host
 */
export function parseProject(html, host = 'gz.zhiyuanyun.com') {
  const src = String(html ?? '');

  const title = (src.match(/<title>([\s\S]*?)<\/title>/i) || [, ''])[1]
    .replace(/-志愿.*$/, '')
    .trim();

  // 整个页面转成纯文本，后面取值都在它上面做
  const plain = textOf(src);

  /* ---------------------------------------------------- 基本信息 */
  const info = {
    place: field(plain, '项目地点'),
    category: field(plain, '服务类别'),
    target: field(plain, '服务对象'),
    recruitStart: field(plain, '招募日期'),
    projectDate: field(plain, '项目日期'),
    publishedAt: field(plain, '发布日期'),
    serviceTime: field(plain, '服务时间'),
    guarantee: field(plain, '志愿者保障'),
  };

  // 招募日期形如「2026-10-01 至 2026-10-08」，拆成两段
  const range = info.recruitStart.split(/\s*至\s*/);

  /* ---------------------------------------------------- 岗位 */
  /** @type {OppPost[]} */
  const posts = [];
  // 站点用 opp_join(项目编号, 岗位编号, ...) 绑定按钮，编号最可靠
  const jobIds = [...src.matchAll(/opp_join\(\s*(\d+)\s*,\s*(\d+)/g)].map((m) => ({
    oppId: m[1], jobId: m[2],
  }));

  // 按「岗位N：」切段
  const parts = src.split(/岗位\s*(\d+)\s*[：:]/);
  for (let i = 1; i < parts.length; i += 2) {
    const idx = Number(parts[i]);
    const seg = parts[i + 1] || '';
    const titleM = seg.match(/^\s*([^<&]{1,40})/);
    const plan = seg.match(/计划招募[：:]\s*(\d+)/);
    const joined = seg.match(/已招募[：:]\s*(\d+)/);
    const jobId = seg.match(/岗位ID[：:]\s*([\s\S]{0,30}?)(?:<|$)/);
    const segPlain = textOf(seg);
    const desc = field(segPlain, '岗位描述');
    const cond = field(segPlain, '岗位条件');

    posts.push({
      index: idx,
      title: titleM ? titleM[1].replace(/\s+/g, ' ').trim() : '',
      plan: plan ? Number(plan[1]) : null,
      joined: joined ? Number(joined[1]) : null,
      jobId: jobId
        ? jobId[1].replace(/<[^>]*>/g, '').trim()
        : (jobIds[posts.length]?.jobId ?? ''),
      desc,
      condition: cond,
    });
  }

  // 岗位编号兜底：如果段解析没拿到 jobId，用 opp_join 里的
  posts.forEach((p, i) => {
    if (!p.jobId && jobIds[i]) p.jobId = jobIds[i].jobId;
  });

  /* ---------------------------------------------------- 报名按钮可用性 */
  // 按钮在页面上出现 = 当前可报名；不存在通常意味着已报名或没登录
  const canJoin = /opp_join\s*\(/.test(src);
  const joinedAlready = /已报名|已加入该项目|取消报名/.test(plain.slice(0, 4000));

  /* ---------------------------------------------------- 项目详情正文 */
  const detailIdx = src.indexOf('项目名称：');
  let detail = '';
  if (detailIdx >= 0) {
    detail = textOf(src.slice(detailIdx, detailIdx + 4000))
      .split(/\n{2,}/)[0]
      .slice(0, 1200);
  }

  /* ---------------------------------------------------- 已报名名单 */
  const names = [];
  const nameBlock = src.match(/姓名[\s\S]{0,40}?岗位[\s\S]{0,40}?报名日期([\s\S]{0,3000}?)<\/table>/i);
  if (nameBlock) {
    for (const tr of nameBlock[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const tds = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => textOf(m[1]));
      if (tds.length >= 3 && tds[0]) names.push({ name: tds[0], post: tds[1], date: tds[2] });
    }
  }

  /*
   * 取【数字项目编号】。
   *
   * ⚠️ 不能只依赖页面里的 opp_join(数字, 岗位) 调用：
   * 名额已满或不可报名的项目，页面上根本没有那个调用，
   * 于是 oppId 为空 —— 后续「讨论区/项目动态/时长公示」就会退回到
   * 加密链接 id，而服务器收到无效 id 时不报错、直接返回【全站最新评论】，
   * 表现出来就是「讨论区永远是那几条外地评论」。
   *
   * 实测页面上一定有隐藏域 <input id="opp_id" value="9713283">，
   * 从这里取最可靠。
   */
  const idFromHidden = (html.match(/id="opp_id"[^>]*value="(\d+)"/i) ||
                        html.match(/value="(\d+)"[^>]*id="opp_id"/i) || [])[1] || '';
  const oppId = idFromHidden || jobIds[0]?.oppId || '';

  return {
    title,
    oppId,
    info: { ...info, recruitStart: range[0] || info.recruitStart, recruitEnd: range[1] || info.recruitEnd },
    posts,
    canJoin,
    joinedAlready,
    detail,
    joiners: names,
    url: `https://${host}/app/opp/view.php?id=${oppId}`,
  };
}

/** 拉取并解析项目详情 */
export async function fetchProject(host, oppId, opts = {}) {
  const doFetch = opts.fetchImpl || fetch;
  const url = `https://${host}/app/opp/view.php?id=${encodeURIComponent(oppId)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const res = await doFetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: ac.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`打开项目页失败：HTTP ${res.status}`);
    const html = await res.text();
    return parseProject(html, host);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 报名（一键报名）
 *
 * @param {{cookie:string,seid:string,cookieMode?:string}} session 必须已登录
 * @param {string} host
 * @param {string} oppId  项目编号
 * @param {string} jobId  岗位编号
 * @param {{ oppPwd?: string, answer?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function joinProject(session, host, oppId, jobId, opts = {}) {
  if (!session || !session.cookie) {
    return { ok: false, message: '请先登录志愿云账号再报名' };
  }
  if (!oppId || !jobId) {
    return { ok: false, message: '缺少项目或岗位编号' };
  }

  const doFetch = opts.fetchImpl || fetch;
  const body = new QS({
    opp_id: String(oppId),
    job_id: String(jobId),
  });
  if (opts.oppPwd) body.set('opp_pwd', opts.oppPwd);
  if (opts.answer) body.set('answer', opts.answer);

  /*
   * 站点会拦掉 POST 并回「访问超时」，所以写操作必须用 GET、参数放 URL 上。
   * ⚠️ URL 一定要在上面几个 body.set 之后才拼，否则会漏掉参数。
   */
  const url = `https://${host}/app/api/view.php?m=opp_join&${body.toString()}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const res = await doFetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `https://${host}/app/opp/view.php?id=${oppId}`,
        ...(session.cookieMode === 'manual' || !session.cookieMode
          ? { Cookie: session.cookie }
          : {}),
      },
      credentials: session.cookieMode === 'platform' ? 'include' : 'omit',
      signal: ac.signal,
      redirect: 'follow',
    });

    const raw = await res.text();
    let obj = null;
    try { obj = JSON.parse(raw.replace(/^\uFEFF/, "").trim()); } catch { /* 非 JSON */ }

    if (!obj) {
      const txt = textOf(raw).slice(0, 120);
      if (/请登录|登录后/.test(txt)) return { ok: false, message: '登录已过期，请重新登录' };
      return { ok: false, message: `服务器返回了无法识别的内容：${txt || '(空)'}` };
    }

    const msg = String(obj.msg || '').trim();
    const code = String(obj.code ?? '');

    /*
     * 站点这个接口只回一段 msg，没有可靠的 code，只能看文案。
     * ⚠️ 判断顺序很重要：必须先判失败。
     * 「您已报名该项目，不能重复报名」里含「已报名」，
     * 若先判成功就会把失败当成成功 —— 报名是写操作，误报成功会让用户白等。
     * 判断不出来时按失败处理，绝不谎报成功。
     */
    const looksFailed =
      /不能|无法|失败|已满|重复|错误|未登录|请登录|不存在|已结束|已截止|未开始|无权限|已取消/.test(msg);
    const looksOk = /成功|已加入|报名完成/.test(msg);
    const ok = !looksFailed && (code === '0' || looksOk);

    return { ok, message: msg || (ok ? '报名成功' : '报名失败') };
  } catch (e) {
    if ((e && e.name === 'AbortError') || /aborted|timeout/i.test(String(e && e.message))) {
      throw new Error('报名请求超时，请检查网络后重试');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
