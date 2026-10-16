/* 视频嗅探 · 扩展后台
 *
 * 这里做网页脚本做不到的事：带上 host 权限之后，扩展的 fetch 不受页面 CORS 限制，
 * 所以可以自己去请求 m3u8、去读 Content-Range 拿到真实文件大小。
 * 嗅探本身仍然由 content.js 完成（DOM + PerformanceObserver），因为后台看不到页面的网络。
 */

const api = typeof browser !== 'undefined' ? browser : chrome;

/* ============================ 工具 ============================ */

function log() {
  try { console.log.apply(console, ['[VSD]'].concat([].slice.call(arguments))); } catch (e) {}
}

function absUrl(u, base) { try { return new URL(u, base).href; } catch (e) { return u; } }

function parseHeaders(h) {
  const out = {};
  if (!h) return out;
  if (typeof h === 'string') {
    h.split(/\r?\n/).forEach((line) => {
      const i = line.indexOf(':');
      if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    });
    return out;
  }
  try { h.forEach((v, k) => { out[String(k).toLowerCase()] = v; }); } catch (e) {}
  return out;
}

function fmtDur(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return (h > 0 ? h + ':' + pad(m) : '' + m) + ':' + pad(sec);
}

function bytesToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

/* ============================ 播放列表解析 ============================ */

function parseAttrs(s) {
  const out = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(s))) {
    let v = m[2];
    if (v.charAt(0) === '"') v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function parseRange(s) {
  const m = /^(\d+)(?:@(\d+))?$/.exec(String(s == null ? '' : s).trim());
  if (!m) return null;
  return { length: parseInt(m[1], 10), offset: m[2] != null ? parseInt(m[2], 10) : null };
}

function parsePlaylist(text, baseUrl) {
  const out = {
    isMaster: false, variants: [], segments: [], duration: 0,
    map: null, encrypted: false, sampleAes: false
  };
  if (!text) return out;

  const lines = String(text).split(/\r?\n/);
  let pending = null, curKey = null, curMap = null, lastDur = 0, pendingRange = null;
  const rangeCursor = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.charAt(0) === '#') {
      if (line.indexOf('#EXT-X-STREAM-INF') === 0) {
        out.isMaster = true;
        const a = parseAttrs(line.slice(line.indexOf(':') + 1));
        pending = {
          bandwidth: parseInt(a.BANDWIDTH || a['AVERAGE-BANDWIDTH'] || '0', 10) || 0,
          resolution: a.RESOLUTION || '', url: ''
        };
      } else if (line.indexOf('#EXTINF') === 0) {
        const mm = /#EXTINF:\s*([\d.]+)/.exec(line);
        lastDur = mm ? parseFloat(mm[1]) : 0;
        out.duration += lastDur;
      } else if (line.indexOf('#EXT-X-BYTERANGE') === 0) {
        pendingRange = parseRange(line.slice(line.indexOf(':') + 1));
      } else if (line.indexOf('#EXT-X-KEY') === 0) {
        const ka = parseAttrs(line.slice(line.indexOf(':') + 1));
        if (ka.METHOD && ka.METHOD !== 'NONE') {
          curKey = { method: ka.METHOD, uri: ka.URI ? absUrl(ka.URI, baseUrl) : null, iv: ka.IV || null };
          if (/SAMPLE-AES/.test(ka.METHOD)) out.sampleAes = true;
        } else curKey = null;
      } else if (line.indexOf('#EXT-X-MAP') === 0) {
        const ma = parseAttrs(line.slice(line.indexOf(':') + 1));
        if (ma.URI) {
          const mUri = absUrl(ma.URI, baseUrl);
          const mRange = parseRange(ma.BYTERANGE);
          if (mRange) {
            if (mRange.offset == null) mRange.offset = rangeCursor[mUri] || 0;
            rangeCursor[mUri] = mRange.offset + mRange.length;
          }
          curMap = { uri: mUri, key: curKey, range: mRange };
          out.map = curMap;
        }
      }
    } else {
      const u = absUrl(line, baseUrl);
      if (pending) { pending.url = u; out.variants.push(pending); pending = null; }
      else {
        const rng = pendingRange;
        pendingRange = null;
        if (rng) {
          if (rng.offset == null) rng.offset = rangeCursor[u] || 0;
          rangeCursor[u] = rng.offset + rng.length;
        }
        out.segments.push({ url: u, duration: lastDur, key: curKey, map: curMap, range: rng });
        if (curKey) out.encrypted = true;
      }
    }
  }
  return out;
}

/* ============================ 每个标签页一份列表 ============================ */

const MAX_ITEMS = 200;
const tabs = new Map();   // tabId -> Map<url, item>

function bucket(tabId) {
  if (!tabs.has(tabId)) tabs.set(tabId, new Map());
  return tabs.get(tabId);
}

function snapshot(tabId) {
  const arr = [];
  bucket(tabId).forEach((it) => {
    arr.push({
      url: it.url, kind: it.kind, name: it.name, t: it.t,
      duration: it.duration || 0, size: it.size || 0, sizeMode: it.sizeMode || null,
      segments: it.segments || 0, encrypted: !!it.encrypted, error: it.error || null,
      probing: !!it.probing
    });
  });
  arr.sort((a, b) => (b.t - a.t));
  return arr;
}

function pushToTab(tabId) {
  try {
    api.tabs.sendMessage(tabId, { type: 'vsd-update', items: snapshot(tabId) }, () => {
      // 页面可能还没注入 content script，忽略错误
      void api.runtime.lastError;
    });
  } catch (e) {}
}

const VIDEO_EXT = { mp4: 1, m4v: 1, mov: 1, webm: 1, mkv: 1, flv: 1, avi: 1, '3gp': 1, m2ts: 1, mts: 1 };
const AUDIO_EXT = { mp3: 1, m4a: 1, aac: 1, flac: 1, wav: 1, ogg: 1, opus: 1 };

function classify(url) {
  let ext = '';
  try { const m = /\.([a-z0-9]{2,5})$/.exec(new URL(url).pathname.toLowerCase()); if (m) ext = m[1]; } catch (e) {}
  if (ext === 'm3u8') return { kind: 'hls', ext };
  if (ext === 'mpd') return { kind: 'dash', ext };
  if (VIDEO_EXT[ext]) return { kind: 'video', ext };
  if (AUDIO_EXT[ext]) return { kind: 'audio', ext };
  const m2 = /\.(m3u8|mp4|m4v|webm|mov|flv|mkv|mp3|m4a|aac)(?:[^a-z0-9]|$)/i.exec(url);
  if (m2) {
    const e2 = m2[1].toLowerCase();
    return { kind: e2 === 'm3u8' ? 'hls' : (VIDEO_EXT[e2] ? 'video' : 'audio'), ext: e2 };
  }
  return null;
}

const GENERIC = /^(index|playlist|master|hls|media|video|vod|out|stream|manifest|chunk|file|main|v|\d+)$/i;

function autoName(url) {
  let bn = '';
  try { bn = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || ''); } catch (e) {}
  const stem = bn.replace(/\.[a-z0-9]{2,5}$/i, '');
  if (stem && stem.length > 2 && !GENERIC.test(stem)) return bn;
  return 'media-' + Math.random().toString(36).slice(2, 6);
}

function onFound(tabId, raw, meta) {
  const abs = absUrl(raw, meta && meta.pageUrl ? meta.pageUrl : undefined);
  if (!/^https?:/i.test(abs)) return;
  const cls = classify(abs);
  if (!cls) return;

  const map = bucket(tabId);
  let it = map.get(abs);
  if (!it) {
    if (map.size >= MAX_ITEMS) return;
    it = {
      url: abs, kind: cls.kind, ext: cls.ext,
      name: (meta && meta.name) || autoName(abs),
      t: Date.now(), duration: 0, size: 0, sizeMode: null,
      probing: false, probed: false
    };
    map.set(abs, it);
    probe(tabId, it);
  } else {
    if (meta && meta.name && it.name.indexOf('media-') === 0) it.name = meta.name;
    if (meta && meta.duration > 0 && !it.duration) it.duration = meta.duration;
  }
  pushToTab(tabId);
}

/* ============================ 探测（跨域） ============================ */

async function probe(tabId, it) {
  it.probing = true;
  pushToTab(tabId);
  try {
    if (it.kind === 'hls') await probeHls(it);
    else await probeSize(it);
  } catch (e) {
    it.error = (e && e.message) || String(e);
    log('探测失败', it.url, it.error);
  }
  it.probing = false;
  it.probed = true;
  pushToTab(tabId);
}

async function probeSize(it) {
  const res = await fetch(it.url, { headers: { Range: 'bytes=0-0' } });
  const h = parseHeaders(res.headers);
  try { if (res.body && res.body.cancel) res.body.cancel(); } catch (e) {}
  const m = /\/(\d+)\s*$/.exec(h['content-range'] || '');
  if (m) { it.size = parseInt(m[1], 10); it.sizeMode = 'exact'; }
  else if (res.status === 200 && h['content-length']) {
    const cl = parseInt(h['content-length'], 10);
    if (cl > 2) { it.size = cl; it.sizeMode = 'exact'; }
  }
}

async function probeHls(it) {
  const res = await fetch(it.url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  const pl = parsePlaylist(text, it.url);

  it.encrypted = !!(pl.encrypted && !pl.sampleAes);

  if (pl.isMaster && pl.variants.length) {
    const best = pl.variants.slice().sort((a, b) => b.bandwidth - a.bandwidth)[0];
    it.segments = 0;
    try {
      const r2 = await fetch(best.url);
      const p2 = parsePlaylist(await r2.text(), best.url);
      if (p2.duration) it.duration = p2.duration;
      it.segments = p2.segments.length;
      if (best.bandwidth && p2.duration) {
        it.size = Math.round((p2.duration * best.bandwidth) / 8);
        it.sizeMode = 'estimate';
      }
    } catch (e) {}
    return;
  }

  if (pl.duration) it.duration = pl.duration;
  it.segments = pl.segments.length;

  // 全部是 BYTERANGE 时可以精确算出总大小
  if (pl.segments.length && pl.segments.every((s) => !!s.range)) {
    let total = 0;
    pl.segments.forEach((s) => { total += s.range.length; });
    if (pl.map && pl.map.range) total += pl.map.range.length;
    it.size = total;
    it.sizeMode = 'exact';
    return;
  }

  // 否则取首尾两个分片估算
  if (!it.size && pl.segments.length) {
    const picks = [0, pl.segments.length - 1].filter((v, i, a) => pl.segments[v] && a.indexOf(v) === i);
    let sum = 0, n = 0;
    for (const idx of picks) {
      try {
        const r = await fetch(pl.segments[idx].url, { headers: { Range: 'bytes=0-0' } });
        const h = parseHeaders(r.headers);
        const m = /\/(\d+)\s*$/.exec(h['content-range'] || '');
        if (m) { sum += parseInt(m[1], 10) / pl.segments.length; n++; }
        try { if (r.body && r.body.cancel) r.body.cancel(); } catch (e) {}
      } catch (e) {}
    }
    if (n === 0) {
      // 拿不到 Content-Range 就整体下第一个分片量一下
      try {
        const r = await fetch(pl.segments[0].url);
        const buf = await r.arrayBuffer();
        it.size = Math.round((buf.byteLength / pl.segments.length) * pl.segments.length);
        it.sizeMode = 'estimate';
      } catch (e) {}
    }
  }
}

/* ============================ 下载（尽力而为） ============================ */

const MAX_FETCH_BYTES = 120 * 1024 * 1024;

async function fetchBytes(url, headers) {
  const res = await fetch(url, { headers: headers || {} });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const len = parseInt(res.headers.get('content-length') || '0', 10);
  if (len && len > MAX_FETCH_BYTES) throw new Error('文件太大（' + Math.round(len / 1048576) + ' MB），超过扩展内存上限');
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_FETCH_BYTES) throw new Error('文件太大，超过扩展内存上限');
  return buf;
}

/* ============================ 消息 ============================ */

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = msg && msg.tabId != null ? msg.tabId : (sender.tab ? sender.tab.id : null);

  if (!msg || !msg.type) { sendResponse({ ok: false }); return false; }

  if (msg.type === 'vsd-found') {
    if (tabId != null) onFound(tabId, msg.url, msg);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'vsd-list') {
    sendResponse({ ok: true, items: tabId == null ? [] : snapshot(tabId) });
    return false;
  }

  if (msg.type === 'vsd-native') {
    api.runtime.sendNativeMessage('application.id', { ping: true }, (resp) => {
      void api.runtime.lastError;
      sendResponse({ ok: true, resp: resp || null });
    });
    return true;
  }

  if (msg.type === 'vsd-fetch') {
    fetchBytes(msg.url, msg.headers)
      .then((buf) => sendResponse({ ok: true, base64: bytesToBase64(buf), bytes: buf.byteLength }))
      .catch((e) => sendResponse({ ok: false, error: (e && e.message) || String(e) }));
    return true;
  }

  sendResponse({ ok: false, error: 'unknown message' });
  return false;
});

api.tabs.onRemoved.addListener((id) => { tabs.delete(id); });
api.tabs.onUpdated.addListener((id, info) => {
  if (info.status === 'loading' && info.url) tabs.delete(id);
});

log('后台已启动');
