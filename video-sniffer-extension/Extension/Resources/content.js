/* 视频嗅探 · 页面脚本
 *
 * 只负责两件事：从页面里把视频地址捞出来 + 在右下角画一个列表。
 * 所有网络请求（探测大小、读 m3u8、取文件）都交给后台做，那里不受 CORS 限制。
 */

(function () {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;
  const IS_TOP = (() => { try { return window.top === window.self; } catch (e) { return false; } })();

  const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|flv|f4v|avi|3gp|m2ts|mts|m3u8|mpd|mp3|m4a|aac|flac|wav|ogg|opus)(\?|#|$)/i;
  const seen = new Set();

  /* ---------------- 嗅探 ---------------- */

  function report(url, meta) {
    if (!url || typeof url !== 'string') return;
    if (url.indexOf('blob:') === 0 || url.indexOf('data:') === 0) return;
    let abs;
    try { abs = new URL(url, location.href).href; } catch (e) { return; }
    if (!/^https?:/i.test(abs)) return;
    if (!VIDEO_EXT.test(abs) && !(meta && meta.force)) return;
    if (seen.has(abs)) return;
    seen.add(abs);

    try {
      api.runtime.sendMessage({
        type: 'vsd-found',
        url: abs,
        name: (meta && meta.name) || '',
        duration: (meta && meta.duration) || 0
      }, () => { void api.runtime.lastError; });
    } catch (e) {}
  }

  // 1) 资源时序：XHR / fetch / video 加载过的地址都会出现，扩展隔离世界里同样可读
  const perfSeen = new Set();
  function scanPerf() {
    try {
      performance.getEntriesByType('resource').forEach((e) => {
        if (!e.name || perfSeen.has(e.name)) return;
        perfSeen.add(e.name);
        const t = e.initiatorType;
        if (t === 'img' || t === 'css' || t === 'script' || t === 'link' || t === 'beacon') return;
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
  setInterval(scanPerf, 3000);

  // 2) DOM 里的 <video>/<audio>：能拿到标题和时长
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
      const nodes = (root || document).querySelectorAll
        ? (root || document).querySelectorAll('video,audio,source')
        : [];
      nodes.forEach((el) => {
        if (el.tagName === 'SOURCE') {
          if (el.src) report(el.src, {});
          return;
        }
        const src = el.currentSrc || el.src || (el.querySelector && (el.querySelector('source[src]') || {}).src);
        if (!src) return;
        report(src, {
          name: titleOf(el),
          duration: (isFinite(el.duration) && el.duration > 0) ? el.duration : 0,
          force: true
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
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    }
  } catch (e) {}

  ['loadedmetadata', 'durationchange', 'playing'].forEach((ev) => {
    document.addEventListener(ev, (e) => {
      const el = e.target;
      if (!el || (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO')) return;
      scanMedia(el);
    }, true);
  });

  /* ---------------- 界面（只在顶层框架里画） ---------------- */

  if (!IS_TOP) return;

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
.hd{display:flex;align-items:center;padding:14px 10px 10px 16px;border-bottom:1px solid var(--line)}
.hd-t{flex:1;font-weight:600;font-size:16px}
.hd-t b{color:var(--accent)}
.ib{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:19px;color:var(--fg2)}
.list{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:0 14px;min-height:120px}
.row{display:flex;align-items:center;gap:10px;padding:14px 0;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}
.info{flex:1;min-width:0}
.nm{font-size:15px;font-weight:500;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all}
.mt{margin-top:6px;font-size:13px;color:var(--fg2);display:flex;flex-wrap:wrap;gap:10px}
.btns{display:flex;flex-direction:column;gap:6px}
.b{height:34px;padding:0 12px;border-radius:9px;font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:center;background:var(--bg2);color:var(--fg)}
.b.pri{background:var(--accent);color:#fff}
.empty{padding:40px 16px;text-align:center;color:var(--fg2);font-size:14px;line-height:1.8;white-space:pre-line}
.ft{padding:12px 16px 14px;border-top:1px solid var(--line);color:var(--fg2);font-size:12px;text-align:center}
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
  <div class="hd"><div class="hd-t">找到 <b id="cnt">0</b> 个视频</div><button class="ib" id="close">✕</button></div>
  <div class="list" id="list"></div>
  <div class="ft">扩展负责跨域读取原始地址；复制直链可交给下载器 App</div>
</div>
<div class="toast" id="toast" style="display:none"><span id="toast-t"></span></div>
`;

  let ui = null, items = [];

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
      toast: root.getElementById('toast'), toastT: root.getElementById('toast-t')
    };
    ui.fab.addEventListener('click', toggle);
    root.getElementById('close').addEventListener('click', close);
    ui.mask.addEventListener('click', close);
    render();
  }

  function toast(msg) {
    if (!ui) return;
    ui.toastT.textContent = msg;
    ui.toast.style.display = 'flex';
    setTimeout(() => { ui.toast.style.display = 'none'; }, 2200);
  }

  function open() { mount(); if (!ui) return; ui.sheet.classList.add('on'); ui.mask.classList.add('on'); }
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

  function render() {
    if (!ui) return;
    const n = items.length;
    ui.badge.textContent = n > 99 ? '99+' : String(n);
    ui.badge.className = 'badge' + (n ? '' : ' hide');
    ui.cnt.textContent = String(n);
    ui.list.textContent = '';

    if (!n) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = '还没找到视频。\n先播放一下视频，再点这个按钮。';
      ui.list.appendChild(d);
      return;
    }

    items.forEach((it) => {
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
      if (it.duration) parts.push(fmtDur(it.duration));
      parts.push(it.size ? (it.sizeMode === 'estimate' ? '≈' : '') + fmtSize(it.size) : '大小未知');
      if (it.kind === 'hls') parts.push('分片流');
      else if (it.kind === 'audio') parts.push('音频');
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

      const bCopy = document.createElement('button');
      bCopy.className = 'b pri';
      bCopy.textContent = '复制链接';
      bCopy.addEventListener('click', (e) => { e.stopPropagation(); copy(it.url); });

      const bDl = document.createElement('button');
      bDl.className = 'b';
      bDl.textContent = '下载';
      bDl.addEventListener('click', (e) => { e.stopPropagation(); download(it); });

      btns.appendChild(bCopy);
      btns.appendChild(bDl);

      row.appendChild(info);
      row.appendChild(btns);
      ui.list.appendChild(row);
    });
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

  function download(it) {
    if (it.kind === 'hls') {
      toast('分片流需要合并，第一版请先用「复制链接」交给下载器 App');
      return;
    }
    toast('正在取文件…');
    api.runtime.sendMessage({ type: 'vsd-fetch', url: it.url }, (resp) => {
      void api.runtime.lastError;
      if (!resp || !resp.ok) { toast('取文件失败：' + ((resp && resp.error) || '未知错误')); return; }
      try {
        const bin = atob(resp.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (it.name || 'video').replace(/[\\/:*?"<>|]/g, '_');
        a.style.cssText = 'position:fixed;left:-9999px';
        (document.body || document.documentElement).appendChild(a);
        a.click();
        toast('已交给 Safari 下载，去「文件」里看');
        setTimeout(() => { try { a.remove(); URL.revokeObjectURL(url); } catch (e) {} }, 60000);
      } catch (e) { toast('写入失败：' + e.message); }
    });
  }

  api.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'vsd-update') {
      items = msg.items || [];
      mount();
      render();
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
      if (resp && resp.ok) { items = resp.items || []; render(); }
    });
  } catch (e) {}
})();
