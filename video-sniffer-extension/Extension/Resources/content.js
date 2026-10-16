/* 视频嗅探 · 页面脚本
 *
 * 只做两件事：
 *   1) 从页面里把 视频 / 图片 / 音频 地址捞出来（DOM + 资源时序）
 *   2) 在顶层框架右下角画一个带分类的列表
 *
 * 所有网络请求（大小、时长、下载）都交给后台，那里不受 CORS 限制。
 */

(function () {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;
  const IS_TOP = (() => { try { return window.top === window.self; } catch (e) { return false; } })();

  const EXT_CAT = {
    mp4: 'video', m4v: 'video', mov: 'video', webm: 'video', mkv: 'video', flv: 'video',
    f4v: 'video', avi: 'video', wmv: 'video', '3gp': 'video', '3g2': 'video', ogv: 'video',
    mpg: 'video', mpeg: 'video', rmvb: 'video', m2ts: 'video', mts: 'video', ts: 'video', m4s: 'video',
    m3u8: 'video', mpd: 'video',
    jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', bmp: 'image',
    heic: 'image', heif: 'image', avif: 'image', svg: 'image', ico: 'image', tif: 'image', tiff: 'image',
    mp3: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio', wav: 'audio',
    ogg: 'audio', oga: 'audio', opus: 'audio', wma: 'audio', ape: 'audio'
  };

  const seen = new Set();

  function extOf(url) {
    try {
      const m = /\.([a-z0-9]{1,6})$/.exec(new URL(url).pathname.toLowerCase());
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  /* ---------------- 上报 ---------------- */

  function report(url, meta) {
    if (!url || typeof url !== 'string') return;
    if (url.indexOf('blob:') === 0 || url.indexOf('data:') === 0) return;

    let abs;
    try { abs = new URL(url, location.href).href; } catch (e) { return; }
    if (!/^https?:/i.test(abs)) return;

    const ext = extOf(abs);
    const cat = EXT_CAT[ext];
    // DOM 里的 <video>/<audio> 即使没扩展名也收（force）
    if (!cat && !(meta && meta.force && meta.mediaCat)) return;
    if (seen.has(abs)) return;
    seen.add(abs);

    try {
      api.runtime.sendMessage({
        type: 'vsd-found',
        url: abs,
        cat: cat || meta.mediaCat,
        name: (meta && meta.name) || '',
        duration: (meta && meta.duration) || 0
      }, () => { void api.runtime.lastError; });
    } catch (e) {}
  }

  /* ---------------- 时长 / 分辨率探测 ----------------
   * 媒体元素加载不受 CORS 限制，所以在页面里塞一个隐藏 <video> 读元数据。
   * 关键：同一个地址只能有一个探测在飞，否则重复建元素会把页面网络拖死。
   * 这一段必须在 `if (!IS_TOP) return` 之前，iframe 里也要能响应。
   */
  const metaCache = new Map();     // url -> {duration,width,height}
  const metaPending = new Map();   // url -> [resolve]
  const PROBE_CONCURRENCY = 3;
  let probing = 0;
  const probeQueue = [];

  function sendMeta(url, meta) {
    try {
      api.runtime.sendMessage({
        type: 'vsd-media-meta', url: url,
        duration: meta.duration || 0, width: meta.width || 0, height: meta.height || 0
      }, () => { void api.runtime.lastError; });
    } catch (e) {}
  }

  function startProbe(url) {
    let v;
    try { v = document.createElement('video'); } catch (e) { finishProbe(url, null); return; }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const meta = {
        duration: (isFinite(v.duration) && v.duration > 0) ? v.duration : 0,
        width: v.videoWidth || 0,
        height: v.videoHeight || 0
      };
      try { v.removeAttribute('src'); v.load(); v.remove(); } catch (e) {}
      finishProbe(url, (meta.duration || meta.height) ? meta : null);
    };

    v.preload = 'metadata';
    v.muted = true;
    v.setAttribute('playsinline', '');
    v.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    v.addEventListener('loadedmetadata', finish);
    v.addEventListener('error', finish);
    setTimeout(finish, 5000);

    try {
      v.src = url;
      (document.body || document.documentElement).appendChild(v);
      v.load();
    } catch (e) { finish(); }
  }

  function finishProbe(url, meta) {
    if (meta) metaCache.set(url, meta);
    const waiters = metaPending.get(url) || [];
    metaPending.delete(url);
    if (meta) sendMeta(url, meta);
    waiters.forEach((fn) => fn(meta));
    probing--;
    pumpProbes();
  }

  function pumpProbes() {
    while (probing < PROBE_CONCURRENCY && probeQueue.length) {
      const url = probeQueue.shift();
      if (metaCache.has(url)) { const m = metaCache.get(url); sendMeta(url, m); continue; }
      if (metaPending.has(url)) continue;
      metaPending.set(url, []);
      probing++;
      startProbe(url);
    }
  }

  function requestMeta(url) {
    if (!url) return;
    if (metaCache.has(url)) { sendMeta(url, metaCache.get(url)); return; }
    if (metaPending.has(url)) return;         // 已经在探测，去重
    metaPending.set(url, []);
    probeQueue.push(url);
    pumpProbes();
  }

  /* ---------------- 嗅探 ---------------- */

  // 1) 资源时序：video / img / xhr / fetch 加载过的地址都会出现
  const perfSeen = new Set();
  function scanPerf() {
    try {
      performance.getEntriesByType('resource').forEach((e) => {
        if (!e.name || perfSeen.has(e.name)) return;
        perfSeen.add(e.name);
        const t = e.initiatorType;
        if (t === 'css' || t === 'script' || t === 'link' || t === 'beacon') return;
        report(e.name, {});
      });
    } catch (e) {}
  }
  scanPerf();
  try {
    new PerformanceObserver((list) => {
      list.getEntries().forEach((e) => {
        if (!e.name || perfSeen.has(e.name)) return;
        perfSeen.add(e.name);
        report(e.name, {});
      });
    }).observe({ type: 'resource', buffered: true });
  } catch (e) {}
  setInterval(scanPerf, 2500);

  // 2) DOM 里的 <video> / <audio>
  function titleOf(el) {
    const keys = ['title', 'aria-label', 'data-title', 'data-name'];
    for (const k of keys) {
      const v = el.getAttribute && el.getAttribute(k);
      if (v && v.trim().length > 1) return v.trim();
    }
    return '';
  }

  function scanMedia(root) {
    try {
      const scope = root && root.querySelectorAll ? root : document;
      const nodes = scope.querySelectorAll('video,audio,source');
      nodes.forEach((el) => {
        const isSource = el.tagName === 'SOURCE';
        if (isSource && !el.src) return;
        const src = isSource ? el.src
          : (el.currentSrc || el.src || (el.querySelector && (el.querySelector('source[src]') || {}).src));
        if (!src) return;
        const mediaCat = (el.tagName === 'AUDIO' || (el.parentElement && el.parentElement.tagName === 'AUDIO')) ? 'audio' : 'video';
        report(src, {
          force: true,
          mediaCat: mediaCat,
          name: isSource ? '' : titleOf(el),
          duration: (!isSource && isFinite(el.duration) && el.duration > 0) ? el.duration : 0
        });
      });
    } catch (e) {}
  }
  scanMedia(document);

  try {
    const mo = new MutationObserver((muts) => {
      muts.forEach((m) => {
        if (m.type === 'attributes') { scanMedia(m.target.parentNode || document); return; }
        m.addedNodes.forEach((n) => { if (n.nodeType === 1) scanMedia(n); });
      });
    });
    if (document.documentElement) {
      mo.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['src']
      });
    }
  } catch (e) {}

  ['loadedmetadata', 'durationchange', 'playing'].forEach((ev) => {
    document.addEventListener(ev, (e) => {
      const el = e.target;
      if (!el || (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO')) return;
      scanMedia(el.parentNode || document);
    }, true);
  });

  // 后台要求探测时长（iframe 里也要应答，所以放在顶层判断之前）
  api.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'vsd-probe-media' && msg.url) requestMeta(msg.url);
    return false;
  });

  /* ---------------- 界面（只画在顶层框架） ---------------- */

  if (!IS_TOP) return;

  const CATS = [
    { key: 'video', label: '视频' },
    { key: 'image', label: '图片' },
    { key: 'audio', label: '音频' }
  ];

  const CSS = `
*,*::before,*::after{box-sizing:border-box}
:host{--bg:#fff;--bg2:#f2f3f5;--fg:#111;--fg2:#6b7280;--line:#e5e7eb;--accent:#1a6dff;--shadow:0 10px 30px rgba(0,0,0,.18)}
@media (prefers-color-scheme:dark){:host{--bg:#1c1c1e;--bg2:#2c2c2e;--fg:#f2f2f7;--fg2:#9ba1a6;--line:#38383a;--shadow:0 10px 30px rgba(0,0,0,.5)}}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
.wrap{position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;font:15px/1.45 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:var(--fg);-webkit-text-size-adjust:100%}
.fab{position:fixed;right:14px;bottom:calc(16px + env(safe-area-inset-bottom,0px));width:54px;height:54px;border-radius:50%;background:linear-gradient(180deg,#3b82f6,#1a6dff);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow);pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;z-index:2147483646}
.fab:active{transform:scale(.94)}
.badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;background:#ff3b30;color:#fff;font-size:12px;font-weight:600;line-height:20px;text-align:center;padding:0 5px}
.badge.hide{display:none}
.mask{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.35);opacity:0;transition:opacity .25s;pointer-events:none;z-index:2147483645}
.mask.on{opacity:1;pointer-events:auto}
.sheet{position:fixed;left:0;right:0;bottom:0;max-height:78vh;background:var(--bg);border-radius:18px 18px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.25);transform:translateY(110%);transition:transform .28s cubic-bezier(.2,.8,.2,1);display:flex;flex-direction:column;pointer-events:auto;z-index:2147483647;padding-bottom:env(safe-area-inset-bottom,0px)}
.sheet.on{transform:translateY(0)}
.hd{display:flex;align-items:center;padding:14px 10px 8px 16px}
.hd-t{flex:1;font-weight:600;font-size:16px}
.hd-t b{color:var(--accent)}
.ib{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:19px;color:var(--fg2)}
.ib:active{background:var(--bg2)}
.tabs{display:flex;gap:8px;padding:0 14px 10px;overflow-x:auto;border-bottom:1px solid var(--line);-webkit-overflow-scrolling:touch}
.tab{flex:0 0 auto;padding:7px 15px;border-radius:999px;background:var(--bg2);color:var(--fg2);font-size:14px;white-space:nowrap}
.tab.on{background:var(--accent);color:#fff;font-weight:600}
.list{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:0 14px;min-height:120px}
.row{display:flex;align-items:center;gap:10px;padding:13px 0;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}
.info{flex:1;min-width:0}
.nm{font-size:15px;font-weight:500;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all}
.mt{margin-top:6px;font-size:13px;color:var(--fg2);display:flex;flex-wrap:wrap;gap:10px}
.btns{display:flex;flex-direction:column;gap:6px;flex:0 0 auto}
.b{height:34px;padding:0 12px;border-radius:9px;font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:center;background:var(--bg2);color:var(--fg)}
.b.pri{background:var(--accent);color:#fff}
.empty{padding:40px 16px;text-align:center;color:var(--fg2);font-size:14px;line-height:1.8;white-space:pre-line}
.ft{padding:11px 16px 13px;border-top:1px solid var(--line);color:var(--fg2);font-size:12px;text-align:center}
.toast{position:fixed;left:0;right:0;bottom:calc(86px + env(safe-area-inset-bottom,0px));display:flex;justify-content:center;pointer-events:none;z-index:2147483647}
.toast span{max-width:86%;background:rgba(0,0,0,.86);color:#fff;font-size:14px;padding:10px 16px;border-radius:12px;word-break:break-all}
`;

  const TPL = `
<div class="fab" id="fab">
  <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>
  <span class="badge hide" id="badge">0</span>
</div>
<div class="mask" id="mask"></div>
<div class="sheet" id="sheet">
  <div class="hd"><div class="hd-t">找到 <b id="cnt">0</b> 个资源</div><button class="ib" id="close">✕</button></div>
  <div class="tabs" id="tabs"></div>
  <div class="list" id="list"></div>
  <div class="ft">点「下载」会跳转到 App；也可以复制链接交给别的下载器</div>
</div>
<div class="toast" id="toast" style="display:none"><span id="toast-t"></span></div>
`;

  let ui = null;
  let items = [];
  let filter = 'video';

  function mount() {
    if (ui || !document.documentElement) return;
    const host = document.createElement('div');
    host.setAttribute('style', 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647');
    let root;
    try { root = host.attachShadow({ mode: 'open' }); } catch (e) { root = host; }

    const st = document.createElement('style');
    st.textContent = CSS;
    root.appendChild(st);

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = TPL;
    root.appendChild(wrap);
    (document.body || document.documentElement).appendChild(host);

    ui = {
      fab: root.getElementById('fab'), badge: root.getElementById('badge'),
      mask: root.getElementById('mask'), sheet: root.getElementById('sheet'),
      list: root.getElementById('list'), cnt: root.getElementById('cnt'),
      tabs: root.getElementById('tabs'),
      toast: root.getElementById('toast'), toastT: root.getElementById('toast-t')
    };

    // 分类按钮
    CATS.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'tab' + (c.key === filter ? ' on' : '');
      b.setAttribute('data-cat', c.key);
      b.textContent = c.label;
      b.addEventListener('click', () => {
        filter = c.key;
        Array.prototype.forEach.call(ui.tabs.children, (t) => {
          t.className = 'tab' + (t.getAttribute('data-cat') === filter ? ' on' : '');
        });
        render(true);
      });
      ui.tabs.appendChild(b);
    });

    ui.fab.addEventListener('click', toggle);
    root.getElementById('close').addEventListener('click', close);
    ui.mask.addEventListener('click', close);

    render(true);
  }

  function toast(msg) {
    if (!ui) return;
    ui.toastT.textContent = msg;
    ui.toast.style.display = 'flex';
    setTimeout(() => { ui.toast.style.display = 'none'; }, 2200);
  }

  function open() { mount(); if (!ui) return; ui.sheet.classList.add('on'); ui.mask.classList.add('on'); render(true); }
  function close() { if (ui) { ui.sheet.classList.remove('on'); ui.mask.classList.remove('on'); } }
  function toggle() { if (ui && ui.sheet.classList.contains('on')) close(); else open(); }

  function fmtSize(b) {
    if (!b) return '大小未知';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0, n = b;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i > 0 && n < 100 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
  }
  function fmtDur(s) {
    s = Math.max(0, Math.round(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return (h > 0 ? h + ':' + pad(m) : '' + m) + ':' + pad(sec);
  }
  function catOf(it) { return it.cat || 'video'; }
  function catCount(cat) { return items.filter((i) => catOf(i) === cat).length; }

  function render(force) {
    if (!ui) return;

    const n = items.length;
    ui.badge.textContent = n > 99 ? '99+' : String(n);
    ui.badge.className = 'badge' + (n ? '' : ' hide');

    // 每个分类上显示数量
    Array.prototype.forEach.call(ui.tabs.children, (t) => {
      const k = t.getAttribute('data-cat');
      const c = catCount(k);
      const label = (CATS.filter((x) => x.key === k)[0] || {}).label || k;
      t.textContent = c ? label + ' ' + c : label;
    });

    // 面板没打开就不重建 DOM（这是之前卡顿的主因）
    if (!force && !ui.sheet.classList.contains('on')) return;

    const arr = items.filter((i) => catOf(i) === filter);
    ui.cnt.textContent = String(n);
    ui.list.textContent = '';

    if (!arr.length) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = n
        ? '这个分类下暂时没有资源。\n可以切到别的分类看看。'
        : '还没找到资源。\n先播放视频 / 滚动页面加载图片，再点这个按钮。';
      ui.list.appendChild(d);
      return;
    }

    const frag = document.createDocumentFragment();
    arr.forEach((it) => frag.appendChild(rowEl(it)));
    ui.list.appendChild(frag);
  }

  function rowEl(it) {
    const row = document.createElement('div');
    row.className = 'row';

    const info = document.createElement('div');
    info.className = 'info';
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = it.name || it.url;

    const mt = document.createElement('div');
    mt.className = 'mt';
    const parts = [];
    const cat = catOf(it);

    if (cat === 'video' || cat === 'audio') {
      parts.push(it.duration ? fmtDur(it.duration) : '时长未知');
    }
    parts.push(it.size ? (it.sizeMode === 'estimate' ? '≈' : '') + fmtSize(it.size) : '大小未知');
    if (it.width && it.height) parts.push(it.width + '×' + it.height);
    if (it.kind === 'hls') parts.push('分片流');
    else if (it.ext) parts.push(it.ext.toUpperCase());
    if (it.probing) parts.push('读取中…');

    parts.forEach((p) => {
      const s = document.createElement('span');
      s.textContent = p;
      mt.appendChild(s);
    });

    info.appendChild(nm);
    info.appendChild(mt);

    const btns = document.createElement('div');
    btns.className = 'btns';

    const bDl = document.createElement('button');
    bDl.className = 'b pri';
    bDl.textContent = '下载';
    bDl.addEventListener('click', (e) => { e.stopPropagation(); openInApp(it); });

    const bCopy = document.createElement('button');
    bCopy.className = 'b';
    bCopy.textContent = '复制链接';
    bCopy.addEventListener('click', (e) => { e.stopPropagation(); copy(it.url); });

    btns.appendChild(bDl);
    btns.appendChild(bCopy);

    row.appendChild(info);
    row.appendChild(btns);
    return row;
  }

  function copy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
      (document.body || document.documentElement).appendChild(ta);
      ta.focus(); ta.select();
      if (ta.setSelectionRange) ta.setSelectionRange(0, 999999);
      const ok = document.execCommand('copy');
      ta.remove();
      toast(ok ? '链接已复制' : '复制失败，请长按选择');
    } catch (e) { toast('复制失败'); }
  }

  function openInApp(it) {
    const q = 'url=' + encodeURIComponent(it.url)
      + '&name=' + encodeURIComponent(it.name || '')
      + '&kind=' + encodeURIComponent(catOf(it))
      + '&page=' + encodeURIComponent(location.href);
    const link = 'videosniffer://add?' + q;
    if (link.length > 7000) { toast('地址太长，请用「复制链接」'); return; }
    try {
      const a = document.createElement('a');
      a.href = link;
      a.style.cssText = 'position:fixed;left:-9999px';
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(() => { try { a.remove(); } catch (e) {} }, 1000);
      toast('已发送到「视频嗅探」App');
    } catch (e) { toast('唤起 App 失败，请用「复制链接」'); }
  }

  api.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'vsd-update') {
      items = msg.items || [];
      mount();
      render(false);
    }
    return false;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }

  try {
    api.runtime.sendMessage({ type: 'vsd-list' }, (resp) => {
      void api.runtime.lastError;
      if (resp && resp.ok) { items = resp.items || []; render(false); }
    });
  } catch (e) {}
})();
