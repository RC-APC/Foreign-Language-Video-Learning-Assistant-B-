(function () {
  'use strict';

  let panel = null;
  let settings = { enabled: true, autoPause: false, dictSource: 'api', eudicAction: 'lp-dict' };
  let observedEl = null;
  let observer = null;
  let tickTimer = null;

  // 逐行字幕（API 拉取，自带精确时间轴）
  let cues = [];          // { index, from, to, text }
  let cues2 = [];         // 对照（双语）轨道的当前字幕
  let liveKey = '';       // 实时字幕已渲染的 key：同一个 key 不重写 DOM，避免每帧把弹出的释义冲掉
  let pendingPauseAt = null;
  let lastAutoPauseTo = null;
  let activeRecorder = null;
  let videoWired = false;

  // API 字幕相关
  let bvid = null, cid = null;
  let subtitleTracks = [];   // { lan, lan_doc, url }
  let selectedTrack = -1;
  let selectedTrack2 = -1;   // 对照（双语）轨道
  let dataReady = false;
  let loadFailed = false;
  let usingDomFallback = false;
  let wbiCache = null;
  let playParams = null;     // 实际传给字幕 API 的参数（{bvid,cid} 或 {ep_id}）
  let lastApiCode = null;    // 字幕 API 返回的 code，供诊断
  let lastApiRaw = null;     // 字幕 API 原始响应缓存，供诊断
  let lastYtRaw = null;      // YouTube 字幕正文抓取结果（格式/预览/错误），供诊断
  let pendingYtBody = null;  // 主世界截获的播放器字幕正文（{url,body}），待轨道就绪后应用
  let lastSelectError = null; // 字幕正文下载错误，供诊断
  let isBangumi = false;     // 是否为影视/番剧类型（需传 ep_id）
  let dictSource = 'api';      // 点词查词来源：api=在线词典 / eudic=本地欧路词典
  let eudicAction = 'lp-dict'; // 唤起欧路词典的窗口类型：lp-dict 迷你 / cap-dict 取词小窗 / dict 主窗口
  let eudicScheme = 'eudic';   // 词典应用协议：eudic 欧路 / eudic-fr 法语助手 / eudic-de 德语助手 / eudic-es 西语助手

  // 站点适配：bilibili / youtube / unsupported
  let currentSite = 'bilibili';
  let ytLastVideoId = null;     // 已加载字幕的 YouTube 视频 id，避免 SPA 重复拉取
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function detectSite() {
    const h = (location.hostname || '').toLowerCase();
    if (h.endsWith('bilibili.com') || h.endsWith('b23.tv')) return 'bilibili';
    if (h.endsWith('youtube.com') || h.endsWith('youtu.be')) return 'youtube';
    return 'unsupported';
  }

  function log() { console.log('[LangLearn]', ...arguments); }

  function getSettings() {
    return new Promise((resolve) => {
      // 关键：无论回调里发生什么都必须 resolve()，否则 init() 会永久挂起 → 面板不出现。
      try {
        chrome.storage.sync.get(['enabled', 'autoPause', 'dictSource', 'eudicAction'], (r) => {
          try {
            settings.enabled = r.enabled !== false;
            settings.autoPause = !!r.autoPause;
            settings.dictSource = r.dictSource || 'api';
            settings.eudicAction = r.eudicAction || 'lp-dict';
            dictSource = settings.dictSource;
            eudicAction = settings.eudicAction;
          } catch (e) { log('应用设置出错（用默认值继续）', e); }
          resolve();
        });
      } catch (e) { log('storage 读取异常（用默认值继续）', e); resolve(); }
    });
  }

  // 注：设置的即时生效统一由 init() 里的 syncSettings() 处理（onChanged + 轮询兜底）。

  function getVideo() { return document.querySelector('video'); }

  // ---------- MD5（用于 wbi 签名） ----------
  function md5hex(s) {
    function add(x, y) { const l = (x & 0xffff) + (y & 0xffff); const m = (x >> 16) + (y >> 16) + (l >> 16); return (m << 16) | (l & 0xffff); }
    function rol(n, c) { return (n << c) | (n >>> (32 - c)); }
    function cmn(q, a, b, x, s, t) { a = add(add(a, q), add(x, t)); return add(rol(a >>> 0, s), b); }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
    function utf8(str) {
      const out = [];
      for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c < 128) out.push(c);
        else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
        else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
      }
      return out;
    }
    const bytes = utf8(s);
    const len = bytes.length;
    const words = [];
    for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
    words[len >> 2] |= 0x80 << ((len % 4) * 8);
    words[(((len + 8) >> 6) << 4) + 14] = len * 8;
    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (let i = 0; i < words.length; i += 16) {
      const oa = a, ob = b, oc = c, od = d;
      const X = words.slice(i, i + 16);
      a = ff(a, b, c, d, X[0], 7, -680876936); d = ff(d, a, b, c, X[1], 12, -389564586); c = ff(c, d, a, b, X[2], 17, 606105819); b = ff(b, c, d, a, X[3], 22, -1044525330);
      a = ff(a, b, c, d, X[4], 7, -176418897); d = ff(d, a, b, c, X[5], 12, 1200080426); c = ff(c, d, a, b, X[6], 17, -1473231341); b = ff(b, c, d, a, X[7], 22, -45705983);
      a = ff(a, b, c, d, X[8], 7, 1770035416); d = ff(d, a, b, c, X[9], 12, -1958414417); c = ff(c, d, a, b, X[10], 17, -42063); b = ff(b, c, d, a, X[11], 22, -1990404162);
      a = ff(a, b, c, d, X[12], 7, 1804603682); d = ff(d, a, b, c, X[13], 12, -40341101); c = ff(c, d, a, b, X[14], 17, -1502002290); b = ff(b, c, d, a, X[15], 22, 1236535329);
      a = gg(a, b, c, d, X[1], 5, -165796510); d = gg(d, a, b, c, X[6], 9, -1069501632); c = gg(c, d, a, b, X[11], 14, 643717713); b = gg(b, c, d, a, X[0], 20, -373897302);
      a = gg(a, b, c, d, X[5], 5, -701558691); d = gg(d, a, b, c, X[10], 9, 38016083); c = gg(c, d, a, b, X[15], 14, -660478335); b = gg(b, c, d, a, X[4], 20, -405537848);
      a = gg(a, b, c, d, X[9], 5, 568446438); d = gg(d, a, b, c, X[14], 9, -1019803690); c = gg(c, d, a, b, X[3], 14, -187363961); b = gg(b, c, d, a, X[8], 20, 1163531501);
      a = gg(a, b, c, d, X[13], 5, -1444681467); d = gg(d, a, b, c, X[2], 9, -51403784); c = gg(c, d, a, b, X[7], 14, 1735328473); b = gg(b, c, d, a, X[12], 20, -1926607734);
      a = hh(a, b, c, d, X[5], 4, -378558); d = hh(d, a, b, c, X[8], 11, -2022574463); c = hh(c, d, a, b, X[11], 16, 1839030562); b = hh(b, c, d, a, X[14], 23, -35309556);
      a = hh(a, b, c, d, X[1], 4, -1530992060); d = hh(d, a, b, c, X[4], 11, 1272893353); c = hh(c, d, a, b, X[7], 16, -155497632); b = hh(b, c, d, a, X[10], 23, -1094730640);
      a = hh(a, b, c, d, X[13], 4, 681279174); d = hh(d, a, b, c, X[0], 11, -358537222); c = hh(c, d, a, b, X[3], 16, -722521979); b = hh(b, c, d, a, X[6], 23, 76029189);
      a = hh(a, b, c, d, X[9], 4, -640364487); d = hh(d, a, b, c, X[12], 11, -421815835); c = hh(c, d, a, b, X[15], 16, 530742520); b = hh(b, c, d, a, X[2], 23, -995338651);
      a = ii(a, b, c, d, X[0], 6, -198630844); d = ii(d, a, b, c, X[7], 10, 1126891415); c = ii(c, d, a, b, X[14], 15, -1416354905); b = ii(b, c, d, a, X[5], 21, -57434055);
      a = ii(a, b, c, d, X[12], 6, 1700485571); d = ii(d, a, b, c, X[3], 10, -1894986606); c = ii(c, d, a, b, X[10], 15, -1051523); b = ii(b, c, d, a, X[1], 21, -2054922799);
      a = ii(a, b, c, d, X[8], 6, 1873313359); d = ii(d, a, b, c, X[15], 10, -30611744); c = ii(c, d, a, b, X[6], 15, -1560198380); b = ii(b, c, d, a, X[13], 21, 1309151649);
      a = ii(a, b, c, d, X[4], 6, -145523070); d = ii(d, a, b, c, X[11], 10, -1120210379); c = ii(c, d, a, b, X[2], 15, 718787259); b = ii(b, c, d, a, X[9], 21, -343485551);
      a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
    }
    function hex(n) { let str = ''; for (let i = 0; i < 4; i++) { const v = (n >>> (i * 8)) & 0xff; str += ('0' + v.toString(16)).slice(-2); } return str; }
    return hex(a) + hex(b) + hex(c) + hex(d);
  }

  const MIXIN_KEY_ENC_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
  function getMixinKey(orig) { let s = ''; for (const i of MIXIN_KEY_ENC_TAB) s += orig[i]; return s.slice(0, 32); }

  async function getWbiKeys() {
    if (wbiCache) return wbiCache;
    const r = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' });
    const j = await r.json();
    const img = j.data.wbi_img.img_url.split('/').pop().split('.')[0];
    const sub = j.data.wbi_img.sub_url.split('/').pop().split('.')[0];
    wbiCache = img + sub;
    return wbiCache;
  }

  // 从页面 HTML 嵌入 JSON 提取 bvid+cid（影视/番剧页没有 __INITIAL_STATE__，但 HTML 里有 arc / episode_info）
  function extractFromHtml() {
    try {
      const html = document.documentElement.innerHTML || '';
      // 优先：arc 块（普通视频与 OGV 影视都有 "arc":{"biz_type":...,"cid":...,"bvid":"..."}）
      const arcM = html.match(/"arc":\{[^}]*\}/);
      if (arcM) {
        const bv = arcM[0].match(/"bvid":"(BV[0-9A-Za-z]+)"/);
        const cid = arcM[0].match(/"cid":(\d+)/);
        if (bv && cid) return { bvid: bv[1], cid: cid[1], via: 'arc' };
      }
      // 兜底：episode_info（OGV 影视）
      const epiM = html.match(/"episode_info":\{[^}]*\}/);
      if (epiM) {
        const bv = epiM[0].match(/"bvid":"(BV[0-9A-Za-z]+)"/);
        const cid = epiM[0].match(/"cid":(\d+)/);
        if (bv && cid) return { bvid: bv[1], cid: cid[1], via: 'episode_info' };
        const ep = epiM[0].match(/"ep_id":(\d+)/);
        if (cid && ep) return { bvid: null, cid: cid[1], ep_id: ep[1], via: 'episode_info' };
      }
      // 再兜底：任意 "bvid":"BV..." 配最近 "cid":
      const bvAll = html.match(/"bvid":"(BV[0-9A-Za-z]+)"/);
      const cidAll = html.match(/"cid":(\d+)/);
      if (bvAll && cidAll) return { bvid: bvAll[1], cid: cidAll[1], via: 'loose' };
    } catch (e) { /* noop */ }
    return { bvid: null, cid: null, via: null };
  }

  // 解析播放参数：统一用 bvid+cid（影视/番剧与普通视频都适用；ep_id 在 player wbi v2 会 -400，不可用）
  function getPlayParams() {
    try {
      const s = window.__INITIAL_STATE__ || {};
      if (s.bvid && s.videoData && s.videoData.cid) return { bvid: s.bvid, cid: s.videoData.cid, via: '__INITIAL_STATE__' };
      if (s.bvid) {
        const cid = s.cid || (s.videoData && s.videoData.cid) || null;
        if (cid) return { bvid: s.bvid, cid: cid, via: '__INITIAL_STATE__' };
        return { bvid: s.bvid, cid: null, via: '__INITIAL_STATE__' };
      }
    } catch (e) { /* noop */ }
    const h = extractFromHtml();
    if (h.bvid && h.cid) return { bvid: h.bvid, cid: h.cid, via: h.via };
    if (h.bvid) return { bvid: h.bvid, cid: null, via: h.via };
    if (h.cid && h.ep_id) return { bvid: null, cid: h.cid, ep_id: h.ep_id, via: h.via };
    // URL 兜底（仅普通视频 bvid）
    const m = location.href.match(/[?&]bvid=(BV\w+)/) || location.href.match(/\/video\/(BV\w+)/);
    if (m) return { bvid: m[1], cid: null, via: 'url' };
    return null;
  }

  // 带重试地解析播放参数（OGV 页面 HTML 嵌入 JSON 可能比 DOMContentLoaded 稍晚出现）
  async function resolvePlayParamsWithRetry() {
    for (let i = 0; i < 6; i++) {
      const info = getPlayParams();
      if (info && info.bvid && info.cid) return info;
      if (info && info.bvid && !info.cid) return info; // 有 bvid 无 cid，交给 resolveCid
      await new Promise((r) => setTimeout(r, 1000));
    }
    return getPlayParams();
  }

  // 取 cid。⚠️ 分 P 陷阱：view 接口的 data.cid 是【第一 P】的 cid，
  // 多 P 视频在 P2 播放时若用它，会拉到 P1 的字幕甚至拉不到 → 必须按 page 取 pages[page-1].cid。
  async function resolveCid(bv, page) {
    const r = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bv, { credentials: 'include' });
    const j = await r.json();
    const d = j.data || {};
    if (page && page > 1 && Array.isArray(d.pages) && d.pages[page - 1] && d.pages[page - 1].cid) {
      return d.pages[page - 1].cid;
    }
    return d.cid || null;
  }

  // 当前分 P 序号（B 站切分 P 是 SPA，不刷新页面，所以要在运行时读，不能只靠初始加载）
  function getCurrentPage() {
    try {
      const s = window.__INITIAL_STATE__;
      if (s && s.videoData && s.videoData.p) return Number(s.videoData.p) || 1;
    } catch (e) { /* noop */ }
    try {
      const m = String(location.search).match(/[?&]p=(\d+)/);
      if (m) return Number(m[1]) || 1;
    } catch (e) { /* noop */ }
    return 1;
  }

  async function fetchSubtitleList(params) {
    const mixinKey = await getWbiKeys();
    const wts = Math.floor(Date.now() / 1000);
    const all = Object.assign({ wts: wts }, params);
    const keys = Object.keys(all).sort();
    let query = '';
    for (const k of keys) query += (query ? '&' : '') + encodeURIComponent(k) + '=' + encodeURIComponent(all[k]);
    const w_rid = md5hex(query + getMixinKey(mixinKey));
    const url = 'https://api.bilibili.com/x/player/wbi/v2?' + query + '&w_rid=' + w_rid;
    log('fetchSubtitleList', url.replace(/w_rid=[^&]+/, 'w_rid=***'));
    const r = await fetch(url, { credentials: 'include' });
    const j = await r.json();
    lastApiCode = j.code;
    // 缓存原始响应，供诊断 dump（定位「code=0 但列表空」的真实结构）
    try {
      lastApiRaw = {
        code: j.code,
        dataKeys: Object.keys(j.data || {}),
        subtitleKeys: (j.data && j.data.subtitle) ? Object.keys(j.data.subtitle) : null,
        subtitleJson: (j.data && j.data.subtitle) ? JSON.stringify(j.data.subtitle).slice(0, 1800) : null,
        needLoginSubtitle: (j.data && j.data.need_login_subtitle) || false,
        loginMid: (j.data && j.data.login_mid) || 0,
        asrLanguage: (j.data && j.data.asr_language) || null,
        ocrLanguage: (j.data && j.data.ocr_language) || null,
        raw: JSON.stringify(j).slice(0, 3500)
      };
    } catch (e) { /* noop */ }
    if (j.code !== 0) throw new Error('player api code ' + j.code);
    const subs = (j.data && j.data.subtitle && j.data.subtitle.subtitles) || [];
    log('subtitle count =', subs.length, 'code =', j.code, 'dataKeys =', lastApiRaw.dataKeys);
    return subs;
  }

  async function fetchSubtitleData(track) {
    if (track && track._fmt === 'yt') return fetchYtData(track.url);
    // B 站字幕正文在 aisubtitle.hdslb.com / subtitle.bilibili.com 等跨域 CDN，
    // URL 已带 auth_key 鉴权，无需 cookie；带 credentials 反而会因 CORS 被拦。
    let u = (track && track.url) ? track.url : track;
    if (typeof u !== 'string') u = '';
    if (u.startsWith('//')) u = 'https:' + u;
    const r = await fetch(u, { credentials: 'omit', mode: 'cors' });
    const j = await r.json();
    return j.body || [];
  }

  // ---------- YouTube 字幕正文解析（兼容 XML / VTT / JSON3 三种格式） ----------
  // captionTracks[].baseUrl 直接 fetch 返回的格式取决于 URL 里的 fmt 参数：
  // 老代码只按 B 站格式 r.json() 后读 .body，而 YouTube 实际常回 json3（{events}），
  // 于是 .body 为 undefined → 空数组、且不报错，诊断里表现为「轨道有、字幕 0 行」。这里统一多格式解析。
  function ytUrlWithFmt(url, fmt) {
    if (!fmt) return url;
    let u = url.replace(/[?&]fmt=[^&]*/g, '');
    u += (u.indexOf('?') >= 0 ? '&' : '?') + 'fmt=' + fmt;
    return u;
  }
  function detectYtFmt(text) {
    const t = (text || '').trim();
    if (!t) return 'empty';
    if (t[0] === '{') return 'json3';
    if (/^WEBVTT/i.test(t) || t.indexOf('-->') >= 0) return 'vtt';
    if (t.indexOf('<text') >= 0) return 'xml';
    return 'other:' + t.slice(0, 24);
  }
  function parseVtt(text) {
    const cues = [];
    const blocks = text.replace(/\r/g, '').split(/\n\n+/);
    for (const block of blocks) {
      const lines = block.split('\n').filter((l) => l.trim());
      if (!lines.length) continue;
      let tsLine = -1;
      for (let i = 0; i < lines.length; i++) if (lines[i].indexOf('-->') >= 0) { tsLine = i; break; }
      if (tsLine < 0) continue;
      const m = lines[tsLine].match(/(\d+):(\d+):(\d+)[.,](\d+)\s*-->\s*(\d+):(\d+):(\d+)[.,](\d+)/);
      if (!m) continue;
      const toSec = (h, mi, s, ms) => (+h * 3600 + +mi * 60 + +s + +ms / 1000);
      const from = toSec(m[1], m[2], m[3], m[4]);
      const to = toSec(m[5], m[6], m[7], m[8]);
      const txt = lines.slice(tsLine + 1).join(' ').replace(/\s+/g, ' ').trim();
      if (!txt) continue;
      cues.push({ index: cues.length, from: from, to: to, text: txt });
    }
    return cues;
  }
  function parseYtTextPayload(text) {
    const t = (text || '').trim();
    if (!t) return { cues: [], fmt: 'empty' };
    // JSON3（YouTube 默认常返回此格式）：{ events:[{ tStartMs, dDurationMs, segs:[{utf8}] }] }
    if (t[0] === '{') {
      try {
        const j = JSON.parse(t);
        const events = j.events || [];
        const cues = [];
        for (const ev of events) {
          const segs = ev.segs || [];
          const txt = segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
          if (!txt) continue;
          const start = (Number(ev.tStartMs) || 0) / 1000;
          const dur = (Number(ev.dDurationMs) || 0) / 1000;
          cues.push({ index: cues.length, from: start, to: start + dur, text: txt });
        }
        return { cues: cues, fmt: 'json3' };
      } catch (e) { /* 落到后续格式 */ }
    }
    // WebVTT
    if (/^WEBVTT/i.test(t) || t.indexOf('-->') >= 0) {
      return { cues: parseVtt(t), fmt: 'vtt' };
    }
    // XML（legacy <text start=".." dur="..">；<font> 由 textContent 自动剥离）
    try {
      const doc = new DOMParser().parseFromString(t, 'text/xml');
      const texts = doc.getElementsByTagName('text');
      if (texts && texts.length) {
        const cues = [];
        for (let i = 0; i < texts.length; i++) {
          const te = texts[i];
          const start = parseFloat(te.getAttribute('start')) || 0;
          const dur = parseFloat(te.getAttribute('dur')) || 0;
          const txt = (te.textContent || '').replace(/\s+/g, ' ').trim();
          if (!txt) continue;
          cues.push({ index: cues.length, from: start, to: start + dur, text: txt });
        }
        return { cues: cues, fmt: 'xml' };
      }
    } catch (e) { /* ignore */ }
    return { cues: [], fmt: 'unknown' };
  }
  async function fetchYtData(url) {
    // 依次尝试：原 URL（不强制 fmt）→ 强制 vtt / xml / json3，提升不同 YouTube 版本下的兼容率
    const fmts = ['', 'vtt', 'xml', 'json3'];
    const attempts = [];
    for (const f of fmts) {
      const u = ytUrlWithFmt(url, f);
      for (const cred of ['include', 'omit']) {
        try {
          const r = await fetch(u, { credentials: cred });
          if (!r.ok) { attempts.push((f || 'default') + '/' + cred + '=HTTP ' + r.status); continue; }
          const text = await r.text();
          const res = parseYtTextPayload(text);
          if (res.cues.length) {
            lastYtRaw = { ok: true, fmt: res.fmt, len: text.length, preview: text.slice(0, 160) };
            return res.cues;
          }
          attempts.push((f || 'default') + '/' + cred + '=200/' + text.length + 'B/' + detectYtFmt(text));
        } catch (e) {
          attempts.push((f || 'default') + '/' + cred + '=' + e.message);
        }
      }
    }
    // 全部落空：记录每次尝试（便于判断是空正文还是 403/网络错误）
    lastYtRaw = { ok: false, note: attempts.join(' | '), attempts: attempts };
    return [];
  }

  // ---------- 面板 ----------
  function buildPanel() {
    if (document.getElementById('ll-panel')) return;
    panel = document.createElement('div');
    panel.id = 'll-panel';
    panel.innerHTML = `
      <div id="ll-bar">
        <span class="ll-title">📚 外语学习</span>
        <button id="ll-vocab-btn" class="ll-btn" title="查看/管理生词本">生词(0)</button>
        <button id="ll-pause" class="ll-btn" title="开启后每行字幕自动暂停">暂停：关</button>
        <button id="ll-pop" class="ll-btn" title="窗口化（拖动标题栏可移动面板）">▢</button>
        <button id="ll-min" class="ll-btn" title="最小化面板（收成小条）">－</button>
      </div>
      <div id="ll-subbar">
        <span class="ll-sub-label">字幕轨道</span>
        <select id="ll-track"><option value="-1">加载中…</option></select>
        <select id="ll-track2" title="对照轨道（双语同时显示，窗口化浮窗里叠两行）"><option value="-1">对照：无</option></select>
        <button id="ll-reload" class="ll-btn" title="重新获取字幕列表">⟳</button>
      </div>
      <div id="ll-vocab" style="display:none;"></div>
      <div id="ll-review" style="display:none;"></div>
      <div id="ll-list"></div>
      <div id="ll-live"></div>
      <div id="ll-status"></div>
      <div id="ll-hint">点 ▶ 跟读该行 · 点单词查释义 · 双击单词存生词 · 点 ⬇ 下载该行音频</div>
      <div id="ll-toast"></div>`;
    document.body.appendChild(panel);

    document.getElementById('ll-min').onclick = () => {
      // 真正的「最小化」：整块面板收成右上角一条小标题胶囊，再点展开。
      const collapsed = panel.classList.toggle('ll-collapsed');
      const btn = document.getElementById('ll-min');
      btn.textContent = collapsed ? '＋' : '－';
      btn.title = collapsed ? '展开面板' : '最小化面板（收成小条）';
    };
    document.getElementById('ll-pause').onclick = (e) => {
      settings.autoPause = !settings.autoPause;
      chrome.storage.sync.set({ autoPause: settings.autoPause });
      e.target.textContent = '暂停：' + (settings.autoPause ? '开' : '关');
    };
    if (settings.autoPause) document.getElementById('ll-pause').textContent = '暂停：开';
    document.getElementById('ll-reload').onclick = () => { loadSubtitles(); };
    document.getElementById('ll-track').onchange = (e) => {
      const idx = Number(e.target.value);
      if (idx >= 0) selectTrack(idx);
    };
    document.getElementById('ll-track2').onchange = (e) => {
      selectTrack2(Number(e.target.value));
    };
    document.getElementById('ll-vocab-btn').onclick = toggleVocab;

    // 窗口化浮窗里那一行实时字幕也支持点词查释义 / 双击存生词（与列表同一套逻辑）
    const liveRow = document.getElementById('ll-live');
    if (liveRow) {
      liveRow.addEventListener('click', (e) => {
        const span = e.target.closest ? e.target.closest('.ll-word') : null;
        if (span && span.dataset.word) handleWordTap(span);
      });
      liveRow.addEventListener('dblclick', (e) => {
        const span = e.target.closest ? e.target.closest('.ll-word') : null;
        if (!span || !span.dataset.word) return;
        e.preventDefault();
        handleWordSave(span);
      });
    }

    // 「窗口化」：脱离右侧固定，转为可拖动浮窗；再点恢复钉在右侧。
    const popBtn = document.getElementById('ll-pop');
    popBtn.onclick = () => {
      const on = panel.classList.toggle('ll-windowed');
      if (on) {
        const r = panel.getBoundingClientRect();
        panel.style.left = Math.round(r.left) + 'px';
        panel.style.top = Math.round(r.top) + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        popBtn.textContent = '📌';
        popBtn.title = '恢复固定到右侧';
      } else {
        panel.classList.remove('ll-windowed');
        panel.style.left = '';
        panel.style.top = '';
        panel.style.right = '';
        panel.style.bottom = '';
        popBtn.textContent = '▢';
        popBtn.title = '窗口化（拖动标题栏可移动面板）';
      }
    };
    // 标题栏拖拽（仅窗口化态生效；点按钮不触发拖拽）。同时支持鼠标与触屏。
    let dragState = null;
    const onDragMove = (e) => {
      if (!dragState) return;
      const r = panel.getBoundingClientRect();
      let x = Math.max(0, Math.min(e.clientX - dragState.dx, window.innerWidth - r.width));
      let y = Math.max(0, Math.min(e.clientY - dragState.dy, window.innerHeight - r.height));
      panel.style.left = Math.round(x) + 'px';
      panel.style.top = Math.round(y) + 'px';
    };
    const onDragTouchMove = (e) => {
      if (!dragState) return;
      e.preventDefault();
      const r = panel.getBoundingClientRect();
      const t = e.touches[0];
      let x = Math.max(0, Math.min(t.clientX - dragState.dx, window.innerWidth - r.width));
      let y = Math.max(0, Math.min(t.clientY - dragState.dy, window.innerHeight - r.height));
      panel.style.left = Math.round(x) + 'px';
      panel.style.top = Math.round(y) + 'px';
    };
    const onDragEnd = () => {
      dragState = null;
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
      document.removeEventListener('touchmove', onDragTouchMove);
      document.removeEventListener('touchend', onDragEnd);
    };
    const onBarDragStart = (e) => {
      if (!panel.classList.contains('ll-windowed')) return;
      if (e.target.closest('button')) return; // 点按钮不拖拽
      e.preventDefault();
      const pt = (e.touches && e.touches[0]) ? e.touches[0] : e;
      const r = panel.getBoundingClientRect();
      dragState = { dx: pt.clientX - r.left, dy: pt.clientY - r.top };
      if (e.touches) {
        document.addEventListener('touchmove', onDragTouchMove, { passive: false });
        document.addEventListener('touchend', onDragEnd);
      } else {
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);
      }
    };
    const barEl = panel.querySelector('#ll-bar');
    barEl.addEventListener('mousedown', onBarDragStart);
    barEl.addEventListener('touchstart', onBarDragStart, { passive: false });
    // 折叠成小条后，点标题也能展开（免去必须精准点到「＋」按钮）
    const titleEl = panel.querySelector('#ll-bar .ll-title');
    if (titleEl) titleEl.onclick = () => {
      if (panel.classList.contains('ll-collapsed')) {
        panel.classList.remove('ll-collapsed');
        const btn = document.getElementById('ll-min');
        if (btn) { btn.textContent = '－'; btn.title = '最小化面板（收成小条）'; }
      }
    };

    const list = document.getElementById('ll-list');
    list.addEventListener('click', onListClick);
    list.addEventListener('dblclick', onListDblClick);
    setStatus(currentSite === 'youtube' ? '正在检测 YouTube 字幕轨道…' : '正在从 B 站字幕 API 拉取字幕轨道…');
    log('panel built');
  }

  function setStatus(msg) {
    const s = document.getElementById('ll-status');
    if (s) s.textContent = msg || '';
  }

  function populateTrackSelect() {
    const sel = document.getElementById('ll-track');
    const sel2 = document.getElementById('ll-track2');
    if (!sel) return;
    sel.innerHTML = '';
    if (sel2) sel2.innerHTML = '<option value="-1">对照：无</option>';
    if (!subtitleTracks.length) {
      const o = document.createElement('option');
      o.value = '-1'; o.textContent = '（无可选 CC 轨道）';
      sel.appendChild(o);
      return;
    }
    subtitleTracks.forEach((t, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = t.lan_doc + '（' + t.lan + '）';
      sel.appendChild(o);
      if (sel2) {
        const o2 = document.createElement('option');
        o2.value = String(i);
        o2.textContent = t.lan_doc + '（' + t.lan + '）';
        sel2.appendChild(o2);
      }
    });
  }

  // ---------- 字幕列表渲染 ----------
  function renderList() {
    const list = document.getElementById('ll-list');
    if (!list) return;
    // 渲染全部字幕行（不再 slice(-80)，否则长视频前段字幕不显示）
    const view = cues;
    list.innerHTML = '';
    if (!view.length) {
      // 明确占位：空列表时不要「什么都不显示」，否则无法区分「没拉到字幕」还是「面板坏了」
      const ph = document.createElement('div');
      ph.className = 'll-empty';
      ph.textContent = '字幕列表为空。可点上方「诊断」把报告发我，能快速定位原因。';
      list.appendChild(ph);
      return;
    }
    view.forEach((cue) => {
      const row = document.createElement('div');
      row.className = 'll-cue';
      row.dataset.idx = cue.index;

      const play = document.createElement('button');
      play.className = 'll-play';
      play.textContent = '▶';
      play.title = '跟读这一行';

      const text = document.createElement('div');
      text.className = 'll-text';
      wrapWords(text, cue.text);

      const dl = document.createElement('button');
      dl.className = 'll-dl';
      dl.textContent = '⬇';
      dl.title = '下载这一行音频（webm）';

      row.appendChild(play);
      row.appendChild(text);
      row.appendChild(dl);
      list.appendChild(row);
    });
    updateHighlight();
  }

  function wrapWords(container, text) {
    const tokens = text.split(/(\s+)/);
    tokens.forEach((t) => {
      if (t === '' || /^\s+$/.test(t)) { container.appendChild(document.createTextNode(t)); return; }
      const span = document.createElement('span');
      span.className = 'll-word';
      span.textContent = t;
      const clean = t.replace(/[^\p{L}'’]/gu, '');
      if (clean) span.dataset.word = clean;
      else span.classList.add('ll-punct');
      container.appendChild(span);
    });
  }

  function currentCursorCue() {
    const v = getVideo();
    const t = v ? v.currentTime : 0;
    let cur = null;
    for (const c of cues) {
      if (c.from <= t) cur = c;
      else break;
    }
    return cur;
  }

  function updateHighlight() {
    const cur = currentCursorCue();
    if (!cur) return;
    const list = document.getElementById('ll-list');
    if (!list) return;
    const rows = list.querySelectorAll('.ll-cue');
    rows.forEach((r) => {
      const isCur = Number(r.dataset.idx) === cur.index;
      r.classList.toggle('ll-cur', isCur);
      if (isCur) r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function cursorCueFrom(arr) {
    const v = getVideo();
    const t = v ? v.currentTime : 0;
    let cur = null;
    for (const c of arr) {
      if (c.from <= t) cur = c;
      else break;
    }
    return cur;
  }
  // 实时字幕：窗口化浮窗里它就是唯一的内容行，所以渲染成「逐词可点」——点词查释义、双击存生词。
  // liveKey 去重：只有当前行真的换了才重建 DOM；否则每帧重写会把用户刚点出来的释义弹层和
  // :hover 状态一起冲掉（这正是「浮窗里点词看不到释义」的根因）。
  function updateLive() {
    const liveEl = document.getElementById('ll-live');
    if (!liveEl) return;
    if (!cues.length && !cues2.length) {
      if (liveKey === 'empty') return;
      liveKey = 'empty';
      liveEl.textContent = '实时字幕：（尚未加载字幕）';
      liveEl.classList.remove('ll-live-on');
      return;
    }
    const cur = currentCursorCue();
    const cur2 = cues2.length ? cursorCueFrom(cues2) : null;
    if (!cur && !cur2) {
      if (liveKey === 'none') return;
      liveKey = 'none';
      liveEl.textContent = '实时字幕：（当前无字幕行）';
      liveEl.classList.remove('ll-live-on');
      return;
    }
    const key = (cur ? 'm' + cur.index : '-') + '|' + (cues2.length ? 's' + (cur2 ? cur2.index : 'x') : '-');
    if (key === liveKey) return;   // 同一行：不重写，保住用户正在看的释义弹层
    liveKey = key;

    const frag = document.createDocumentFragment();
    if (cur) {
      const main = document.createElement('span');
      main.className = 'll-live-main';
      wrapWords(main, cur.text.slice(0, 200));
      frag.appendChild(main);
    }
    if (cur2) {
      const sub = document.createElement('span');
      sub.className = 'll-live-sub';
      wrapWords(sub, cur2.text.slice(0, 200));
      frag.appendChild(sub);
    }
    try { liveEl.replaceChildren(frag); }
    catch (err) { liveEl.textContent = ''; liveEl.appendChild(frag); }
    liveEl.classList.add('ll-live-on');
  }

  // ---------- 交互 ----------
  // 点词查释义：字幕列表与窗口化浮窗共用（浮窗那行字也是逐词 span，所以同一套入口）。
  function handleWordTap(span) {
    if (!span) return;
    const w = span.dataset ? span.dataset.word : '';
    if (!w) return;
    if (dictSource === 'eudic') {
      // 本地欧路词典模式：用官方 URL Scheme 唤起欧路查词（不走慢速网络 API）。
      // 注：程序化“选中文本”不会触发欧路的划词/悬停取词（那需要真实鼠标事件），
      // 所以这里直接调 eudic:// 协议，让欧路自己弹出释义。
      openEudic(w);
    } else {
      showDictLoading(span, w);
      lookupAndShow(span, w);
    }
  }

  // 双击存生词：同样列表/浮窗共用。
  function handleWordSave(span) {
    if (!span || !span.dataset || !span.dataset.word) return false;
    const word = span.dataset.word;
    chrome.storage.local.get({ vocab: [] }, (r) => {
      let list = r.vocab || [];
      if (!list.find((v) => v.word.toLowerCase() === word.toLowerCase())) {
        const now = Date.now();
        list = [{ word: word, addedAt: now, box: 1, due: now, note: '' }, ...list].slice(0, 200);
        chrome.storage.local.set({ vocab: list });
        span.classList.add('ll-saved');
        setTimeout(() => span.classList.remove('ll-saved'), 900);
        showToast('✓ 已存入生词本：' + word);
      } else {
        showToast('已在生词本：' + word);
      }
      const btn = document.getElementById('ll-vocab-btn');
      if (btn) btn.textContent = '生词(' + list.length + ')';
    });
    return true;
  }

  function onListClick(e) {
    const row = e.target.closest('.ll-cue');
    if (!row) return;
    const cue = cues.find((c) => c.index === Number(row.dataset.idx));
    if (!cue) return;

    if (e.target.closest('.ll-dl')) { downloadAudio(cue); return; }
    if (e.target.closest('.ll-play')) { shadow(cue); return; }
    if (e.target.closest('.ll-word')) { handleWordTap(e.target); return; }
    shadow(cue);
  }

  function onListDblClick(e) {
    const span = e.target.closest('.ll-word');
    if (!span || !span.dataset.word) return;
    e.preventDefault();
    handleWordSave(span);
  }

  function showToast(msg, ms) {
    const t = document.getElementById('ll-toast');
    if (!t) return;
    t.textContent = msg;
    // 用 class 控制显隐（而非内联 display）：窗口化浮窗下 CSS 需要把 toast 改成静态排在字幕行下方，
    // 内联样式优先级太高会把那条规则压掉。
    t.classList.add('ll-toast-on');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.remove('ll-toast-on'), ms || 1600);
  }

  function toggleVocab() {
    const box = document.getElementById('ll-vocab');
    if (!box) return;
    if (box.style.display === 'none') { renderVocabInline(); box.style.display = 'block'; }
    else box.style.display = 'none';
  }

  function renderVocabInline() {
    const box = document.getElementById('ll-vocab');
    if (!box) return;
    chrome.storage.local.get({ vocab: [] }, (r) => {
      const list = (r.vocab || []).map((v) => ({ box: 1, due: 0, note: '', ...v }));
      const btn = document.getElementById('ll-vocab-btn');
      if (btn) btn.textContent = '生词(' + list.length + ')';
      const dueCount = list.filter((v) => (v.due || 0) <= Date.now()).length;
      if (!list.length) {
        box.innerHTML = '<div class="ll-vocab-empty">还没有保存单词。在字幕里双击单词即可加入。</div>';
        return;
      }
      const header = '<div class="ll-vocab-head">' +
        '<span>共 ' + list.length + ' 词 · 待复习 ' + dueCount + '</span>' +
        '<span class="ll-vocab-tools">' +
        '<button id="ll-export-btn" class="ll-vocab-tool" title="导出为本地 JSON 文件">导出</button>' +
        '<button id="ll-import-btn" class="ll-vocab-tool" title="从本地 JSON 文件导入">导入</button>' +
        '<button id="ll-review-btn" class="ll-vocab-review" title="记忆曲线复习">复习(' + dueCount + ')</button>' +
        '</span></div>';
      const items = list.map((v) => {
        const w = escapeHtml(v.word);
        const note = v.note ? escapeHtml(v.note) : '';
        const noteHtml = note
          ? '<div class="ll-vocab-note">' + note + '</div>'
          : '<div class="ll-vocab-note ll-vocab-note-empty">（无注释，点 📝 添加）</div>';
        return '<div class="ll-vocab-item" data-w="' + w + '">' +
          '<div class="ll-vocab-main">' +
            '<span class="ll-vocab-word">' + w + '</span>' +
            '<span class="ll-vocab-btns">' +
              '<button class="ll-vocab-lookup" data-w="' + w + '" title="联网查释义并显示">🔍</button>' +
              '<button class="ll-vocab-edit" data-w="' + w + '" title="修改单词（改成词典里的原形，如 written→write）">✎</button>' +
              '<button class="ll-vocab-note-btn" data-w="' + w + '" title="编辑注释">📝</button>' +
              '<button class="ll-vocab-del" data-w="' + w + '" title="删除">×</button>' +
            '</span>' +
          '</div>' +
          '<div class="ll-vocab-def ll-vocab-def-loading" data-w="' + w + '">释义加载中…</div>' +
          noteHtml +
          '<textarea class="ll-vocab-note-edit" data-w="' + w + '" style="display:none;" placeholder="给这个词加个注释…">' + note + '</textarea>' +
          '<button class="ll-vocab-note-save" data-w="' + w + '" style="display:none;">保存注释</button>' +
        '</div>';
      }).join('');
      box.innerHTML = header + items;
      fillVocabDefs(box, list.map((v) => v.word));

      const rb = document.getElementById('ll-review-btn');
      if (rb) rb.onclick = () => startReview();
      const eb = document.getElementById('ll-export-btn');
      if (eb) eb.onclick = () => exportVocab();
      const ib = document.getElementById('ll-import-btn');
      if (ib) ib.onclick = () => importVocab();

      box.querySelectorAll('.ll-vocab-del').forEach((b) => {
        b.onclick = () => {
          const w = b.dataset.w;
          chrome.storage.local.get({ vocab: [] }, (rr) => {
            const l = (rr.vocab || []).filter((x) => x.word !== w);
            chrome.storage.local.set({ vocab: l }, () => renderVocabInline());
          });
        };
      });
      box.querySelectorAll('.ll-vocab-note-btn').forEach((b) => {
        b.onclick = () => {
          const w = b.dataset.w;
          const item = Array.from(box.querySelectorAll('.ll-vocab-item')).find((it) => it.dataset.w === w);
          if (!item) return;
          const ta = item.querySelector('.ll-vocab-note-edit');
          const save = item.querySelector('.ll-vocab-note-save');
          const noteDiv = item.querySelector('.ll-vocab-note');
          const open = !ta.style.display || ta.style.display === 'none';
          ta.style.display = open ? 'block' : 'none';
          if (save) save.style.display = open ? 'inline-block' : 'none';
          if (noteDiv) noteDiv.style.display = open ? 'none' : '';
          if (open) ta.focus();
        };
      });
      box.querySelectorAll('.ll-vocab-note-save').forEach((b) => {
        b.onclick = () => {
          const w = b.dataset.w;
          const item = Array.from(box.querySelectorAll('.ll-vocab-item')).find((it) => it.dataset.w === w);
          const ta = item && item.querySelector('.ll-vocab-note-edit');
          if (!ta) return;
          const note = ta.value;
          chrome.storage.local.get({ vocab: [] }, (rr) => {
            const l = (rr.vocab || []).map((x) => (x.word === w ? { ...x, note } : x));
            chrome.storage.local.set({ vocab: l }, () => {
              showToast('✓ 已保存注释：' + w);
              renderVocabInline();
            });
          });
        };
      });
      // ✎ 改词：把生词改成词典里的原形（written → write），方便对上释义
      box.querySelectorAll('.ll-vocab-edit').forEach((b) => {
        b.onclick = () => {
          const w = b.dataset.w;
          const next = prompt('修改单词（改成词典中的原形即可对上释义）：', w);
          if (next === null) return;
          const nw = next.trim();
          if (!nw || nw === w) return;
          chrome.storage.local.get({ vocab: [] }, (rr) => {
            const l = (rr.vocab || []).map((x) => (x.word === w ? { ...x, word: nw } : x));
            chrome.storage.local.set({ vocab: l }, () => {
              showToast('✓ 已改为：' + nw);
              renderVocabInline();
            });
          });
        };
      });
      // 🔍 联网查该词（结果只用于显示，不改动生词本）
      box.querySelectorAll('.ll-vocab-lookup').forEach((b) => {
        b.onclick = () => {
          const w = b.dataset.w;
          const item = Array.from(box.querySelectorAll('.ll-vocab-item')).find((it) => it.dataset.w === w);
          const el = item && item.querySelector('.ll-vocab-def');
          if (el) { el.textContent = '联网查词中…'; el.className = 'll-vocab-def'; }
          chrome.runtime.sendMessage({ type: 'lookup', word: w }, (resp) => {
            if (!el) return;
            if (resp && resp.ok && resp.meanings && resp.meanings.length) {
              el.className = 'll-vocab-def ll-vocab-def-hit';
              el.textContent = resp.meanings.slice(0, 2).map((m) => (m.pos ? '【' + m.pos + '】' : '') + m.def).join('；') +
                (resp.source ? '　（' + resp.source + '）' : '');
            } else {
              el.textContent = (resp && resp.error) ? ('⚠️ ' + resp.error) : '（未查到释义）';
            }
          });
        };
      });
    });
  }

  // 主动把本地词库释义填到列表（纯本地读取，离线、无网络请求）
  function fillVocabDefs(box, words) {
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      box.querySelectorAll('.ll-vocab-def').forEach((el) => { el.textContent = '（无法读取本地词库）'; });
      return;
    }
    chrome.runtime.sendMessage({ type: 'dictLookupBatch', words: words }, (resp) => {
      if (!resp || !resp.ok) {
        box.querySelectorAll('.ll-vocab-def').forEach((el) => { el.textContent = '（本地词库不可用，可点 🔍 联网查）'; });
        return;
      }
      const map = resp.map || {};
      box.querySelectorAll('.ll-vocab-def').forEach((el) => {
        const w = el.dataset.w;
        const hit = map[w];
        if (hit) {
          el.className = 'll-vocab-def ll-vocab-def-hit';
          el.textContent = (hit.pos ? '【' + hit.pos + '】' : '') + hit.def +
            (hit.matched && hit.matched !== w ? '　（' + w + ' → ' + hit.matched + '）' : '');
        } else {
          el.className = 'll-vocab-def ll-vocab-def-miss';
          el.textContent = resp.dictSize ? '本地词库未收录（可点 🔍 联网查，或 ✎ 改成原形）' : '本地词库为空（可在独立生词本页导入词典）';
        }
      });
    });
  }

  // 导出/导入本地 JSON（让生词本真正归属于用户，可备份、可迁移到 Kiwi/手机）
  function exportVocab() {
    chrome.storage.local.get({ vocab: [] }, (r) => {
      const list = r.vocab || [];
      const data = JSON.stringify({ type: 'll-vocab', version: 1, exportedAt: Date.now(), words: list }, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const d = new Date();
      const pad = (n) => (n < 10 ? '0' + n : '' + n);
      a.href = url;
      a.download = 'vocab-export-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
      showToast('✓ 已导出 ' + list.length + ' 个生词到本地文件');
    });
  }

  function importVocab() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          const incoming = Array.isArray(parsed) ? parsed : (parsed.words || []);
          if (!Array.isArray(incoming)) throw new Error('文件格式不正确');
          chrome.storage.local.get({ vocab: [] }, (r) => {
            const byWord = {};
            (r.vocab || []).forEach((v) => { byWord[v.word.toLowerCase()] = v; });
            let added = 0, noted = 0;
            incoming.forEach((v) => {
              if (!v || !v.word) return;
              const key = v.word.toLowerCase();
              if (!byWord[key]) {
                byWord[key] = { word: v.word, addedAt: v.addedAt || Date.now(), box: v.box || 1, due: v.due || Date.now(), note: v.note || '' };
                added++;
              } else if (!byWord[key].note && v.note) {
                byWord[key].note = v.note; noted++;
              }
            });
            chrome.storage.local.set({ vocab: Object.values(byWord) }, () => {
              renderVocabInline();
              showToast('✓ 导入完成：新增 ' + added + ' 词' + (noted ? '，补充 ' + noted + ' 条注释' : ''));
            });
          });
        } catch (e) {
          showToast('✗ 导入失败：' + e.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // ---------- 记忆曲线复习（Leitner 间隔重复） ----------
  function reviewInterval(box) {
    const min = 60 * 1000;
    return [10 * min, 60 * min, 24 * 60 * min, 3 * 24 * 60 * min, 7 * 24 * 60 * min][Math.min(box, 5) - 1];
  }

  // 把查词结果渲染到指定元素，失败给出清晰原因
  function showDefResult(defId, resp) {
    const el = document.getElementById(defId);
    if (!el) return;
    if (resp && resp.ok && resp.meanings && resp.meanings.length) {
      const src = resp.source ? '　来源：' + resp.source : '';
      el.textContent = (resp.phonetics && resp.phonetics[0] ? '/' + resp.phonetics[0] + '/ ' : '') +
        resp.meanings.slice(0, 3).map((m) => (m.pos ? '【' + m.pos + '】' : '') + m.def).join('；') + src;
    } else if (resp && resp.error) {
      el.textContent = '⚠️ ' + resp.error + '（可点「✎ 存本地释义」手动补充）';
    } else {
      el.textContent = '（词典未收录该词，可点「✎ 存本地释义」手动补充）';
    }
  }

  // 给某词补/改本地释义（userDict）
  function addLocalDef(word) {
    chrome.storage.local.get({ userDict: {} }, (r) => {
      const dict = r.userDict || {};
      const key = word.toLowerCase();
      const existing = dict[key] ? dict[key].def : '';
      const def = prompt('为「' + word + '」输入/修改本地释义：', existing);
      if (def === null) return;
      const pos = prompt('词性（可选，如 n. / v.）：', dict[key] ? (dict[key].pos || '') : '');
      if (!def.trim()) return;
      dict[key] = { def: def.trim(), pos: (pos || '').trim() };
      chrome.storage.local.set({ userDict: dict }, () => {
        showToast('已保存到本地词库：' + word);
        chrome.runtime.sendMessage({ type: 'lookup', word: word }, (resp) => showDefResult('ll-rev-def', resp));
      });
    });
  }

  function startReview() {
    const reviewBox = document.getElementById('ll-review');
    const vocabBox = document.getElementById('ll-vocab');
    if (!reviewBox) return;
    chrome.storage.local.get({ vocab: [] }, (r) => {
      const all = (r.vocab || []).map((v) => ({ box: 1, due: 0, note: '', ...v }));
      const due = all.filter((v) => (v.due || 0) <= Date.now());
      if (!due.length) {
        reviewBox.style.display = 'flex';
        reviewBox.className = 'll-review-done';
        reviewBox.innerHTML = '<div class="ll-rev-word">🎉 今天没有待复习的词</div>' +
          '<button class="ll-rev-next" onclick="document.getElementById(\'ll-review\').style.display=\'none\'">关闭</button>';
        if (vocabBox) vocabBox.style.display = 'none';
        return;
      }
      // 把待复习的词打乱
      const queue = due.slice();
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
      let idx = 0;
      const showCard = () => {
        if (idx >= queue.length) {
          reviewBox.className = 'll-review-done';
          reviewBox.innerHTML = '<div class="ll-rev-word">✅ 本轮复习完成（' + queue.length + ' 词）</div>' +
            '<button class="ll-rev-next" onclick="document.getElementById(\'ll-review\').style.display=\'none\';' +
            'document.getElementById(\'ll-vocab\')&&(document.getElementById(\'ll-vocab\').style.display=\'block\')">关闭</button>';
          return;
        }
        const item = queue[idx];
        reviewBox.style.display = 'flex';
        reviewBox.className = '';
        reviewBox.innerHTML =
          '<div class="ll-rev-progress">复习进度 ' + (idx + 1) + '/' + queue.length + '</div>' +
          '<div class="ll-rev-word">' + escapeHtml(item.word) + '</div>' +
          '<div class="ll-rev-reveal" id="ll-rev-reveal" style="display:none;">' +
            '<div class="ll-rev-def" id="ll-rev-def"></div>' +
            (item.note ? '<div class="ll-rev-note">📝 ' + escapeHtml(item.note) + '</div>' : '') +
            '<button class="ll-rev-addlocal" id="ll-rev-addlocal" style="display:none;margin-top:4px;">✎ 存本地释义</button>' +
          '</div>' +
          '<div class="ll-rev-actions" id="ll-rev-actions">' +
            '<button class="ll-rev-no" id="ll-rev-no">✗ 不记得</button>' +
            '<button class="ll-rev-yes" id="ll-rev-yes">✓ 记得</button></div>' +
          '<button class="ll-rev-next" id="ll-rev-next" style="display:none;">下一个 →</button>';
        const reveal = document.getElementById('ll-rev-reveal');
        const defEl = document.getElementById('ll-rev-def');
        const actions = document.getElementById('ll-rev-actions');
        const nextBtn = document.getElementById('ll-rev-next');
        const addLocalBtn = document.getElementById('ll-rev-addlocal');
        const grade = (remembered) => {
          // 揭晓：释义 + 当时填的注释，作为反馈/核对
          reveal.style.display = 'block';
          actions.style.display = 'none';
          nextBtn.style.display = 'inline-block';
          if (addLocalBtn) { addLocalBtn.style.display = 'inline-block'; addLocalBtn.onclick = () => addLocalDef(item.word); }
          const meansEnglish = /^[A-Za-z]/.test(item.word);
          if (meansEnglish) {
            chrome.runtime.sendMessage({ type: 'lookup', word: item.word }, (resp) => {
              showDefResult('ll-rev-def', resp);
            });
          } else {
            defEl.textContent = '（目标语种生词，请自行回忆拼写与含义，或点「✎ 存本地释义」补充）';
          }
          // 记忆曲线更新（写回原数组，不在此立即翻页）
          const now = Date.now();
          item.box = remembered ? Math.min((item.box || 1) + 1, 5) : 1;
          item.due = now + reviewInterval(item.box);
          const orig = all.find((x) => x.word === item.word);
          if (orig) { orig.box = item.box; orig.due = item.due; }
          chrome.storage.local.set({ vocab: all }, () => {});
        };
        document.getElementById('ll-rev-yes').onclick = () => grade(true);
        document.getElementById('ll-rev-no').onclick = () => grade(false);
        nextBtn.onclick = () => { idx++; showCard(); };
      };
      showCard();
    });
  }

  function shadow(cue) {
    const v = getVideo();
    if (!v) return;
    // 「暂停：开」→ 本句放完自动暂停；「暂停：关」→ 从该句起连续播放（不打断）
    pendingPauseAt = settings.autoPause ? cue.to : null;
    lastAutoPauseTo = null;
    v.currentTime = cue.from;
    v.play();
  }

  function downloadAudio(cue) {
    if (activeRecorder) { showToast('请等待上一段录音完成。'); return; }
    if (!chrome.tabCapture) {
      showToast('当前浏览器不支持片段录音，已改为 ▶ 跳到该行跟读。');
      shadow(cue);
      return;
    }
    const v = getVideo();
    if (!v) return;
    const dur = Math.max(0.8, cue.to - cue.from);
    setStatus('正在录制该行音频（' + dur.toFixed(1) + 's）…');
    chrome.tabCapture.capture({ audio: true, video: false }, (stream) => {
      if (!stream) {
        showToast('无法开始录音：浏览器未授权标签页音频捕获。可用 ▶ 跟读。');
        return;
      }
      try {
        const rec = new MediaRecorder(stream);
        const chunks = [];
        rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
        rec.onstop = () => {
          activeRecorder = null;
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          if (!blob.size) {
            showToast('录制为空：标签页音频未被捕获（浏览器/系统限制）。');
            setStatus('该行音频录制为空。可在 Chrome/Edge 下重试，或改用 ▶ 跟读。');
            return;
          }
          saveBlob(blob, 'line_' + cue.index + '.webm');
          setStatus('已保存该行音频：line_' + cue.index + '.webm（在下载目录）');
        };
        activeRecorder = rec;
        rec.start();
        pendingPauseAt = cue.from + dur;
        v.currentTime = cue.from;
        v.play();
        setTimeout(() => {
          if (rec.state !== 'inactive') rec.stop();
          if (!v.paused) v.pause();
        }, dur * 1000 + 400);
      } catch (err) {
        showToast('录音失败：' + err);
        activeRecorder = null;
        stream.getTracks().forEach((t) => t.stop());
      }
    });
  }

  // 用 chrome.downloads 保存（比 anchor 点击更稳，且不依赖用户手势）；无 downloads 时回退到 anchor
  function saveBlob(blob, filename) {
    if (chrome.downloads && chrome.downloads.download) {
      const reader = new FileReader();
      reader.onload = () => {
        chrome.downloads.download({ url: reader.result, filename: filename, saveAs: false }, () => {
          if (chrome.runtime.lastError) anchorDownload(reader.result, filename);
        });
      };
      reader.readAsDataURL(blob);
    } else {
      const url = URL.createObjectURL(blob);
      anchorDownload(url, filename);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  }

  function anchorDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- 查词弹窗 ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function showDictLoading(span, word) {
    removePopup();
    const pop = document.createElement('div');
    pop.id = 'll-popup';
    pop.innerHTML = `<div class="ll-pop-word">${escapeHtml(word)} <span class="ll-load">查询中…</span></div>`;
    positionPopup(pop, span);
  }

  function lookupAndShow(span, word) {
    chrome.runtime.sendMessage({ type: 'lookup', word: word }, (resp) => {
      removePopup();
      const pop = document.createElement('div');
      pop.id = 'll-popup';
      if (!resp || !resp.ok) {
        pop.innerHTML = `<div class="ll-pop-word">${escapeHtml(word)}</div>` +
          `<div class="ll-pop-def">未找到释义。内置词库主要收录英文；其它语种请在设置中配置「整句翻译」。</div>`;
      } else {
        const ph = (resp.phonetics && resp.phonetics.length) ? '/' + resp.phonetics[0] + '/' : '';
        const defs = (resp.meanings || []).map((m) =>
          `<div class="ll-pos">${escapeHtml(m.pos || '')}</div><div class="ll-def">${escapeHtml(m.def)}</div>`
        ).join('');
        pop.innerHTML = `<div class="ll-pop-word">${escapeHtml(resp.word)} <span class="ll-ph">${ph}</span></div>` +
          defs + `<div class="ll-pop-tip">双击单词可存入生词本</div>`;
      }
      positionPopup(pop, span);
      setTimeout(() => document.addEventListener('click', outsideClose, { once: true }), 0);
    });
  }

  // 本地欧路词典模式：通过官方 URL Scheme 唤起欧路词典查词（不走任何网络请求）。
  // 官方文档（Win/Mac URL Scheme）：
  //   eudic://lp-dict/<word>   迷你查词窗口（推荐，轻量、不抢主窗口）
  //   eudic://cap-dict/<word>  鼠标取词小窗口
  //   eudic://dict/<word>      词典主窗口
  // Windows 需欧路词典 >= 14.0.0。首次唤起浏览器会弹「要打开 欧路词典 吗？」，
  // 勾选「始终允许」后不再询问。法语/德语/西语助手对应协议为 eudic-fr/de/es。
  function openEudic(word) {
    const w = String(word || '').trim();
    if (!w) return;
    const url = eudicScheme + '://' + eudicAction + '/' + encodeURIComponent(w);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { try { a.remove(); } catch (e) {} }, 0);
    } catch (e) {
      try { window.location.href = url; } catch (e2) {}
    }
    // 兜底：同时把单词写入剪贴板；万一协议未注册，也能手动粘到欧路查。
    try { navigator.clipboard.writeText(w).catch(function () {}); } catch (e) {}
  }

  function positionPopup(pop, anchor) {
    const r = anchor.getBoundingClientRect();
    pop.style.position = 'fixed';
    let top = r.bottom + 6;
    let left = r.left;
    pop.style.visibility = 'hidden';
    document.body.appendChild(pop);
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (top + ph > window.innerHeight - 8) top = r.top - ph - 6;
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = Math.max(8, top) + 'px';
    pop.style.visibility = 'visible';
  }

  function removePopup() {
    const p = document.getElementById('ll-popup');
    if (p) p.remove();
  }

  function outsideClose(e) {
    if (e.target.closest && e.target.closest('#ll-popup')) return;
    if (e.target.closest && e.target.closest('.ll-word')) return;
    removePopup();
  }

  // ---------- 字幕加载（站点分发） ----------
  async function loadSubtitles() {
    if (usingDomFallback) return;
    if (currentSite === 'youtube') return loadYoutubeSubtitles();
    if (currentSite === 'bilibili') return loadBiliSubtitles();
    setStatus('当前站点（' + location.hostname + '）暂不支持自动字幕；生词本与复习功能仍可用。');
  }

  // ---------- YouTube 适配器 ----------
  // 从页面 <script> 提取 ytInitialPlayerResponse（括号配对解析，避开脆弱正则）。
  // content script 与页面同源，fetch youtube.com 的 timedtext 不受 CORS 限制。
  function extractBraceBlock(str, ob) {
    let depth = 0, inStr = false, esc = false;
    for (let i = ob; i < str.length; i++) {
      const c = str[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return str.slice(ob, i + 1); }
    }
    return null;
  }
  // 当前 URL 里的 YouTube 视频 id（/watch?v= 或 /shorts/<id>）
  function ytUrlVideoId() {
    try {
      const s = location.pathname.match(/\/shorts\/([\w-]{6,})/);
      if (s) return s[1];
      const m = location.search.match(/[?&]v=([\w-]{6,})/);
      if (m) return m[1];
    } catch (e) { /* noop */ }
    return null;
  }
  function getYtPlayerResponseFromDom() {
    // ① 首选：播放器实时接口（切视频后立即是【新视频】的响应，不会读到 DOM 里的旧脚本）
    try {
      const mp = document.getElementById('movie_player');
      if (mp && typeof mp.getPlayerResponse === 'function') {
        const pr = mp.getPlayerResponse();
        if (pr && pr.videoDetails && pr.videoDetails.videoId) return pr;
      }
    } catch (e) { /* 回退到脚本解析 */ }
    // ② 回退：从页面内嵌 <script> 里解析 ytInitialPlayerResponse
    const scripts = Array.from(document.querySelectorAll('script'));
    for (const s of scripts) {
      const txt = s.textContent || '';
      const idx = txt.indexOf('ytInitialPlayerResponse');
      if (idx < 0) continue;
      const eq = txt.indexOf('=', idx);
      if (eq < 0) continue;
      const ob = txt.indexOf('{', eq);
      if (ob < 0) continue;
      const block = extractBraceBlock(txt, ob);
      if (block) {
        try { return JSON.parse(block); } catch (e) { /* 试下一个 script */ }
      }
    }
    return null;
  }
  function parseYtTracks(pr) {
    const list = pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer &&
      pr.captions.playerCaptionsTracklistRenderer.captionTracks;
    if (!list || !list.length) return [];
    return list.map((t) => ({
      lan: t.languageCode || '',
      lan_doc: (t.name && t.name.simpleText) || t.languageCode || '',
      url: t.baseUrl,
      _fmt: 'yt'
    }));
  }
  // 统一入口：无论轨道来自「DOM/全局变量解析」还是「主世界桥接消息」，都走这里
  function applyYtTracks(vid, tracks) {
    if (currentSite !== 'youtube') return;
    if (!vid || !Array.isArray(tracks)) return;
    if (vid === ytLastVideoId) return;   // 同一视频不重复加载
    ytLastVideoId = vid;
    if (!tracks.length) {
      setStatus('该 YouTube 视频没有可用 CC 字幕轨道（可能是仅硬字幕，或无字幕）。');
      return;
    }
    subtitleTracks = tracks.map((t) => ({ lan: t.lan, lan_doc: t.lan_doc, url: t.url, _fmt: 'yt' }));
    if (typeof populateTrackSelect === 'function') populateTrackSelect();
    // 自动优先选非中文轨道（学外语），否则选第一条
    let preferred = subtitleTracks.findIndex((t) => !/ch|zh|cn|中文|简体|繁体/i.test(t.lan + t.lan_doc));
    if (preferred < 0) preferred = 0;
    const sel = document.getElementById('ll-track');
    if (sel) sel.value = String(preferred);
    selectTrack(preferred);
    // 若主世界已截获到播放器下载的字幕正文，轨道就绪后立即应用（无需再等网络请求）
    if (!cues.length && pendingYtBody) applyYtBody(pendingYtBody);
  }
  function handleYtPR(pr) {
    const vid = pr && pr.videoDetails && pr.videoDetails.videoId;
    applyYtTracks(vid, parseYtTracks(pr));
  }

  // 从 URL 里取 lang（用于把截获到的字幕对上正确的轨道）
  function langFromYtUrl(u) {
    const m = String(u || '').match(/[?&]lang=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
  // 应用主世界截获的【播放器字幕正文】（方案 B，绕过 baseUrl 的 pot 校验）
  function applyYtBody(d) {
    if (currentSite !== 'youtube' || !d || !d.body) return;
    const parsed = parseYtTextPayload(d.body);
    if (!parsed.cues.length) {
      lastYtRaw = { ok: false, note: '截获到的正文字段无法解析（len=' + d.body.length + '，detected=' + detectYtFmt(d.body) + '）' };
      return;
    }
    // 把截获的语言对上轨道：命中则同步选中项
    const capLan = langFromYtUrl(d.url).toLowerCase();
    if (capLan && subtitleTracks.length) {
      const idx = subtitleTracks.findIndex((t) => t.lan && t.lan.toLowerCase().indexOf(capLan) === 0);
      if (idx >= 0 && idx !== selectedTrack) {
        selectedTrack = idx;
        const sel = document.getElementById('ll-track');
        if (sel) sel.value = String(idx);
      }
    }
    cues = parsed.cues;
    liveKey = '';   // 换轨道 / 换视频后强制重建实时字幕行
    dataReady = true; loadFailed = false;
    lastYtRaw = { ok: true, fmt: parsed.fmt + '(截获)', len: d.body.length, preview: d.body.slice(0, 160) };
    try { renderList(); } catch (e) { /* noop */ }
    const name = subtitleTracks[selectedTrack] ? subtitleTracks[selectedTrack].lan_doc : '字幕';
    setStatus('已截获播放器加载的「' + name + '」字幕，共 ' + cues.length + ' 行。播放后可点 ▶ 跟读。');
    // 同步尝试双语对照
    let secIdx = subtitleTracks.findIndex((t) => /ch|zh|cn|中文|简体|繁体/i.test(t.lan + t.lan_doc));
    if (secIdx >= 0 && secIdx !== selectedTrack) {
      const s2 = document.getElementById('ll-track2');
      if (s2 && s2.value === '-1') { s2.value = String(secIdx); try { selectTrack2(secIdx); } catch (e) { /* noop */ } }
    }
  }
  // 接收 yt-main.js（MAIN world）通过 postMessage 转发的轨道列表 / 字幕正文
  function onYtBridgeMessage(e) {
    try {
      if (e.source !== window) return;
      const d = e.data;
      if (!d) return;
      if (currentSite !== 'youtube') return;
      if (d.__llYtTracks === true) {
        log('收到主世界桥接轨道：', d.videoId, (d.tracks || []).length, '条');
        applyYtTracks(d.videoId, d.tracks);
        return;
      }
      if (d.__llYtSubtitleBody === true) {
        log('收到主世界截获的字幕正文：len=' + (d.body || '').length + ' url=' + String(d.url || '').slice(0, 120));
        pendingYtBody = d;
        // 已有字幕则不覆盖（例如 API 通路已成功）
        if (!cues.length) applyYtBody(d);
      }
    } catch (err) { /* noop */ }
  }
  async function loadYoutubeSubtitles() {
    setStatus('正在检测 YouTube 字幕轨道…（若久未出现，可刷新页面或点 ⟳）');
    let handled = false;
    const tryOnce = () => {
      if (handled) return true;
      const urlVid = ytUrlVideoId();
      const pr = getYtPlayerResponseFromDom();
      if (!pr) return false;
      const vid = pr.videoDetails && pr.videoDetails.videoId;
      if (!vid) return false;
      // 关键：响应里的 videoId 必须与当前 URL 一致，否则是 SPA 切换残留的旧响应 → 继续等
      if (urlVid && vid !== urlVid) return false;
      handled = true; handleYtPR(pr);
      return true;
    };
    if (tryOnce()) return;
    // 轮询最多 ~20s：覆盖 SPA 跳转后播放器响应晚注入、首屏未就绪等情况（否则需手动刷新才出轨道）
    const iv = setInterval(() => { if (tryOnce()) clearInterval(iv); }, 1000);
    setTimeout(() => {
      clearInterval(iv);
      if (!handled) setStatus('未能从 YouTube 页面读取到字幕信息（可能该视频无 CC 字幕，或页面尚未加载完，可点 ⟳ 重试）。');
    }, 20000);
  }

  // ---------- B 站字幕加载（原 loadSubtitles） ----------
  async function loadBiliSubtitles() {
    if (usingDomFallback) return;
    setStatus('正在从 B 站字幕 API 拉取字幕轨道…');
    try {
      const info = await resolvePlayParamsWithRetry();
      if (!info) {
        setStatus('未识别到 B 站视频。请确认当前是视频/番剧播放页，且页面已加载完成（可点 ⟳ 重试）。');
        return;
      }
      playParams = info;
      isBangumi = !!(info.via && (info.via === 'arc' || info.via === 'episode_info'));
      bvid = info.bvid || null;
      cid = info.cid || null;
      // 分 P 视频必须用【当前分 P】的 cid（见 resolveCid 注释）；P1 或无法判断时沿用已有 cid
      const page = getCurrentPage();
      if (info.bvid && (page > 1 || !cid)) {
        try {
          const pc = await resolveCid(info.bvid, page);
          if (pc) { if (page > 1 && pc !== cid) log('分 P cid 修正: ' + cid + ' -> ' + pc); cid = pc; }
        } catch (e) { log('resolveCid 失败（沿用已有 cid）', e); }
      }
      if (playParams) { playParams.cid = cid; playParams.page = page; } // 同步实际使用的 cid，避免诊断显示 stale 的 null
      if (!info.bvid && !info.cid) {
        setStatus('未能获取视频 bvid/cid，无法拉取字幕。');
        return;
      }
      const list = await fetchSubtitleList({ bvid: bvid, cid: cid });
      subtitleTracks = list.map((t) => ({ lan: t.lan, lan_doc: t.lan_doc || t.lan, url: t.subtitle_url }));
      populateTrackSelect();
      if (!subtitleTracks.length) {
        let tail = isBangumi
          ? '（影视页已用 bvid+cid 拉取，仍为空：该版本可能未提供可选 CC 轨道，或需更高权限）'
          : '——字幕很可能是 UP 主烧进画面的硬字幕（「中字」搬运常见），插件无法获取原文。请在播放器 CC 菜单确认确有可选轨道，或换一个带原文 CC 的视频。';
        if (lastApiRaw && lastApiRaw.needLoginSubtitle) {
          tail = '——该视频的 CC 字幕【必须登录 B 站】才会返回，请确认已登录后点上方 ⟳ 重试。';
        } else if (lastApiRaw && !lastApiRaw.loginMid) {
          tail += '（当前似乎未登录 B 站，字幕接口依赖登录态）';
        }
        setStatus('该视频没有可选 CC 字幕轨道' + tail + ' 已切换为「页面字幕监听」：列表会随播放逐行累积。');
        startDomFallback();
        return;
      }
      // 自动优先选非中文轨道（学外语），否则选第一条
      let preferred = subtitleTracks.findIndex((t) => !/ch|zh|cn|中文|简体|繁体/i.test(t.lan + t.lan_doc));
      if (preferred < 0) preferred = 0;
      const sel = document.getElementById('ll-track');
      if (sel) sel.value = String(preferred);
      await selectTrack(preferred);
    } catch (err) {
      setStatus('API 拉取失败：' + err.message + '（可能是未登录 / CORS）。已回退到页面字幕监听（对硬字幕无效）。');
      startDomFallback();
    }
  }

  async function selectTrack(idx) {
    if (idx < 0 || idx >= subtitleTracks.length) return;
    selectedTrack = idx;
    setStatus('正在下载「' + subtitleTracks[idx].lan_doc + '」字幕数据…');
    try {
      const body = await fetchSubtitleData(subtitleTracks[idx]);
      cues = body
        .map((b, i) => ({ index: i, from: Number(b.from) || 0, to: Number(b.to) || 0, text: (b.content || '').replace(/\s+/g, ' ').trim() }))
        .filter((c) => c.text);
      liveKey = '';
      dataReady = true; loadFailed = false;
      renderList();
      // 双语自动默认：优先把"中文"轨道设为对照轨道（与主轨道不同时），窗口化浮窗即可叠两行
      let secIdx = subtitleTracks.findIndex((t) => /ch|zh|cn|中文|简体|繁体/i.test(t.lan + t.lan_doc));
      if (secIdx >= 0 && secIdx !== selectedTrack) {
        const s2 = document.getElementById('ll-track2');
        if (s2 && s2.value === '-1') {
          s2.value = String(secIdx);
          await selectTrack2(secIdx);
        }
      }
      if (cues.length) {
        setStatus('已加载「' + subtitleTracks[idx].lan_doc + '」字幕，共 ' + cues.length + ' 行。播放后可点 ▶ 跟读。');
      } else if (currentSite === 'youtube') {
        // baseUrl 直接请求返回空（pot 校验）→ 用主世界截获的播放器字幕正文
        if (pendingYtBody) {
          applyYtBody(pendingYtBody);
        } else {
          setStatus('字幕轨道已识别，但正文请求为空（YouTube 对 timedtext 加了令牌校验）。正在等播放器加载字幕…请确认播放器已开启 CC（字幕按钮点亮），必要时点 ▶ 播放几秒。');
          try { window.postMessage({ __llYtRequestBody: true }, '*'); } catch (e) { /* noop */ }
        }
      }
    } catch (err) {
      lastSelectError = err.message;
      if (currentSite === 'youtube' && pendingYtBody) {
        applyYtBody(pendingYtBody);
      } else {
        setStatus('字幕数据下载失败：' + err.message);
      }
    }
  }

  // 对照（双语）轨道：与主轨道独立加载，窗口化浮窗里叠在下面一行显示
  async function selectTrack2(idx) {
    if (idx < 0 || idx >= subtitleTracks.length) {
      cues2 = []; liveKey = '';
      updateLive();
      return;
    }
    selectedTrack2 = idx;
    try {
      const body = await fetchSubtitleData(subtitleTracks[idx]);
      cues2 = body
        .map((b, i) => ({ index: i, from: Number(b.from) || 0, to: Number(b.to) || 0, text: (b.content || '').replace(/\s+/g, ' ').trim() }))
        .filter((c) => c.text);
      liveKey = '';
      updateLive();
    } catch (err) {
      lastSelectError = err.message;
    }
  }

  // ---------- DOM 兜底（仅当 API 失败时有用，对硬字幕仍无效） ----------
  function deepQueryAll(root, selector) {
    let res = [];
    try { res = Array.from(root.querySelectorAll(selector)); } catch (e) { /* noop */ }
    let nodes = [];
    try { nodes = Array.from(root.querySelectorAll('*')); } catch (e) { /* noop */ }
    for (const n of nodes) if (n.shadowRoot) res = res.concat(deepQueryAll(n.shadowRoot, selector));
    return res;
  }
  function readText(el) {
    let t = (el && el.textContent) ? el.textContent : '';
    if (el && el.shadowRoot && el.shadowRoot.textContent) t += ' ' + el.shadowRoot.textContent;
    return t.replace(/\s+/g, ' ').trim();
  }
  function findSubtitleContainer() {
    const specific = ['.bpx-player-subtitle', '.bpx-player-subtitle-text', '.bpx-player-subtitle-item', '.bilibili-player-video-subtitle', '.bilibili-player-subtitle-text'];
    for (const sel of specific) {
      const els = deepQueryAll(document, sel);
      if (els.length) { const withText = els.find((e) => readText(e)); return { el: withText || els[0], sel: sel }; }
    }
    const generic = deepQueryAll(document, '[class*="player-subtitle"]');
    const gText = generic.find((e) => readText(e));
    if (gText) return { el: gText, sel: '[class*=player-subtitle]' };
    // 兜底探针：扫描视口下半部「含英文、叶子级、长度适中」的元素（影视/番剧的官方字幕可能用非标准 class 直接渲染在 DOM）
    const probe = findVisibleSubtitleProbe();
    if (probe) return { el: probe, sel: 'probe:' + (probe.className || probe.tagName) };
    return null;
  }

  // 扫描视口下半部「含英文、子节点少、长度适中」的元素，返回最像字幕行的那个
  function findVisibleSubtitleProbe() {
    let best = null, bestScore = -1;
    const vh = window.innerHeight || 800;
    const all = Array.from(document.querySelectorAll('*'));
    for (const el of all) {
      if (el.id && el.id.indexOf('ll-') === 0) continue;
      const cls = (typeof el.className === 'string') ? el.className : '';
      if (/control|danmaku|bullet|button|input|progress|setting/i.test(cls)) continue;
      const txt = (el.textContent || '').trim();
      if (txt.length < 4 || txt.length > 220) continue;
      if (!/[A-Za-z]{3}/.test(txt)) continue;
      if (el.children.length > 4) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < vh * 0.5 || r.top < vh * 0.4) continue;
      const score = txt.length;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return best;
  }
  function attachObserver(el) {
    if (observedEl === el) return;
    if (observer) observer.disconnect();
    observedEl = el;
    observer = new MutationObserver(() => onSubtitleChange(el));
    const opts = { childList: true, characterData: true, subtree: true };
    observer.observe(el, opts);
    if (el.shadowRoot) observer.observe(el.shadowRoot, opts);
  }
  let lastText = '';
  function onSubtitleChange(el) {
    const v = getVideo();
    const now = v ? v.currentTime : 0;
    const text = readText(el);
    if (!text || text === lastText) return;
    lastText = text;
    const clean = text.replace(/\s+/g, ' ').trim();
    if (cues.length) cues[cues.length - 1].to = now;
    cues.push({ index: cues.length, from: now, to: now + 5, text: clean });
    if (cues.length > 120) cues.shift();
    renderList();
  }
  function startDomFallback() {
    usingDomFallback = true;
    const tryHook = () => {
      const found = findSubtitleContainer();
      if (found) { attachObserver(found.el); wireVideo(); }
      tickTimer = setTimeout(tryHook, 800);
    };
    tryHook();
  }

  function wireVideo() {
    const v = getVideo();
    if (!v) return;
    // 用元素自身标记，而不是全局布尔：切分 P 时 B 站可能换掉 video 元素，
    // 标记在元素上既能对新元素重挂，又不会对同一元素重复挂监听。
    if (v.__llWired) { videoWired = true; return; }
    v.__llWired = true;
    videoWired = true;
    v.addEventListener('timeupdate', () => {
      if (pendingPauseAt != null && v.currentTime >= pendingPauseAt) { v.pause(); pendingPauseAt = null; lastAutoPauseTo = null; }
      updateHighlight();
      updateLive();
      if (settings.autoPause && !v.paused && cues.length) {
        const cur = currentCursorCue();
        if (cur && cur.to !== lastAutoPauseTo) { pendingPauseAt = cur.to; lastAutoPauseTo = cur.to; }
      }
    });
  }

  // ---------- 调试诊断（供排错用） ----------
  function dumpInitialState() {
    const lines = [];
    try {
      const s = window.__INITIAL_STATE__ || {};
      const top = Object.keys(s).filter((k) => !Array.isArray(s[k]) || s[k].length < 50);
      lines.push('__INITIAL_STATE__ 顶层键: ' + (top.length ? top.join(', ') : '（空——影视/番剧页通常无此全局，属正常）'));
      if (s.videoData) lines.push('videoData.cid=' + s.videoData.cid + ' bvid=' + s.videoData.bvid);
      lines.push('顶层 bvid=' + s.bvid + ' aid=' + s.aid);
    } catch (e) {
      lines.push('无法读取 __INITIAL_STATE__: ' + e.message);
    }
    const h = extractFromHtml();
    lines.push('从页面 HTML 提取: bvid=' + h.bvid + ' cid=' + h.cid + ' via=' + h.via);
    return lines;
  }

  // 扫描页面所有「直接含可见短文本」的元素（含开放 Shadow DOM），返回 签名 -> 文本
  function snapshotTextMap() {
    const m = new Map();
    const walk = (root) => {
      let els;
      try { els = root.querySelectorAll('*'); } catch (e) { return; }
      for (const el of els) {
        const tag = el.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') continue;
        if (el.id && el.id.indexOf('ll-') === 0) continue;
        try {
          const own = Array.from(el.childNodes)
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
          if (own && own.length <= 140) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              const key = tag + '|' + String(el.className).slice(0, 50) + '|' +
                Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + ',' + Math.round(r.height);
              if (!m.has(key)) m.set(key, own);
            }
          }
        } catch (e) { /* noop */ }
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    return m;
  }

  // 匹配可能承载字幕文本的容器（类名/ID 关键字）
  function findSubtitleLikeNodes() {
    const kw = /(subtitle|caption|translat|danmaku|\basr\b|ai-?sub|听译|字幕|翻译|同传)/i;
    const out = [];
    const walk = (root) => {
      let els;
      try { els = root.querySelectorAll('*'); } catch (e) { return; }
      for (const el of els) {
        const cls = (typeof el.className === 'string') ? el.className : '';
        const sig = (el.id || '') + ' ' + cls;
        if (kw.test(sig)) {
          const r = el.getBoundingClientRect();
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
          if (r.width > 0 && r.height > 0) {
            out.push('<' + el.tagName.toLowerCase() + '> id="' + (el.id || '') + '" class="' + cls.slice(0, 46) +
              '" @y=' + Math.round(r.top) + ' text="' + t + '"');
          }
        }
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    return out.slice(0, 15);
  }

  // 前后两次快照 diff：找出随播放「变化 / 新出现」的文本 = 实时字幕层
  async function probeSubtitleLayer(lines) {
    lines.push('—— 字幕层探测（判断夸克/浏览器 AI 字幕是否进了页面 DOM） ——');
    const like = findSubtitleLikeNodes();
    lines.push('类名/ID 含 subtitle|caption|字幕|翻译 等的节点（前15）:');
    lines.push(like.length ? like.join('\n') : '（无——字号/类名不含字幕关键字）');
    const a = snapshotTextMap();
    await new Promise((r) => setTimeout(r, 1800));
    const b = snapshotTextMap();
    const changed = [];
    for (const [k, v] of b) { if (a.has(k) && a.get(k) !== v) changed.push('变化: "' + a.get(k).slice(0, 40) + '" ⇒ "' + v.slice(0, 40) + '"  [' + k.slice(0, 60) + ']'); }
    const appeared = [];
    for (const [k, v] of b) { if (!a.has(k)) appeared.push('新增: "' + v.slice(0, 50) + '"  [' + k.slice(0, 60) + ']'); }
    lines.push('【关键】1.8s 内文本发生变化的节点（这类最可能是实时字幕）: ' + changed.length + ' 个');
    lines.push(changed.slice(0, 20).join('\n') || '（无）');
    lines.push('1.8s 内新出现/消失的文本节点: ' + appeared.length + ' 个');
    lines.push(appeared.slice(0, 20).join('\n') || '（无）');
    lines.push('结论提示：若「文本变化」里出现视频台词 → 字幕在 DOM 内，可走页面字幕监听；');
    lines.push('YouTube 场景：出现 ytp-caption-segment 节点说明播放器 CC 正在渲染 → 扩展走「截获播放器字幕文件」通路即可拿到完整字幕。');
  }

  async function runDiag() {
    const lines = [];
    const v = getVideo();
    lines.push('video元素: ' + (v ? '有（当前 ' + Math.round(v.currentTime) + 's）' : '未找到！'));
    const srcLabel = currentSite === 'youtube' ? 'YouTube 字幕轨道' : (currentSite === 'bilibili' ? 'B 站字幕 API' : '不支持站点');
    lines.push('数据来源: ' + (usingDomFallback ? 'DOM 兜底（API 失败/无轨道）' : srcLabel));
    if (currentSite === 'youtube') {
      lines.push('YouTube videoId: ' + (ytLastVideoId || '（未识别）'));
      lines.push('播放页 URL: ' + location.pathname);
    } else {
      lines.push('类型: ' + (isBangumi ? '影视/番剧（OGV）' : '普通视频'));
      lines.push('提取方式(playParams.via): ' + (playParams ? playParams.via : '无'));
      lines.push('实际传给 API 的参数: ' + JSON.stringify(playParams));
      lines.push('字幕 API 返回 code: ' + lastApiCode);
      lines.push('bvid/cid: ' + bvid + ' / ' + cid);
    }
    lines.push('CC 轨道数: ' + subtitleTracks.length);
    subtitleTracks.forEach((t, i) => lines.push('  [' + i + '] ' + t.lan_doc + '（' + t.lan + '）' + (i === selectedTrack ? ' ←已选' : '')));
    lines.push('已加载字幕行数: ' + cues.length);
    if (lastSelectError) lines.push('字幕正文下载错误: ' + lastSelectError);
    if (currentSite !== 'youtube') {
      lines.push('—— 字幕 API 原始响应（定位“code=0 但列表空”） ——');
      if (lastApiRaw) {
        lines.push('data 顶层键: ' + (lastApiRaw.dataKeys || []).join(', '));
        lines.push('subtitle 对象键: ' + (lastApiRaw.subtitleKeys ? lastApiRaw.subtitleKeys.join(', ') : '（无 subtitle 字段）'));
        lines.push('subtitle JSON: ' + (lastApiRaw.subtitleJson || '（空）'));
        lines.push('登录态: login_mid=' + lastApiRaw.loginMid + ' , need_login_subtitle=' + lastApiRaw.needLoginSubtitle);
        lines.push('ASR/OCR 语言字段: asr_language=' + lastApiRaw.asrLanguage + ' , ocr_language=' + lastApiRaw.ocrLanguage);
      } else {
        lines.push('（无缓存：API 未成功调用，或请先点 ⟳ 重新拉取）');
      }
    }
    if (currentSite === 'youtube') {
      lines.push('—— YouTube 字幕正文抓取（定位"轨道有、字幕 0 行"） ——');
      lines.push('主世界截获的播放器字幕: ' + (pendingYtBody ? ('有（' + (pendingYtBody.body || '').length + ' 字节，url 含 lang=' + (langFromYtUrl(pendingYtBody.url) || '?') + '）') : '无——说明播放器尚未下载字幕文件（请确认播放器 CC 按钮已点亮，并播放几秒）'));
      if (lastYtRaw) {
        if (lastYtRaw.ok) {
          lines.push('接口直连结果: 成功，格式 ' + lastYtRaw.fmt + '，长度 ' + lastYtRaw.len + ' 字节');
          lines.push('正文前 160 字: ' + (lastYtRaw.preview || '（空）'));
        } else {
          lines.push('接口直连结果: 全部落空');
          if (lastYtRaw.attempts) {
            lines.push('各次尝试（fmt/凭据=结果）:');
            lastYtRaw.attempts.forEach((a) => lines.push('  ' + a));
          } else {
            lines.push('  失败原因: ' + (lastYtRaw.note || '未知'));
          }
        }
      } else {
        lines.push('接口直连结果: 尚未尝试（轨道可能未选中，或请先点 ⟳ 重新拉取）');
      }
    }
    lines.push('—— 当前页面"含英文"的候选字幕节点（前8） ——');
    const cand = [];
    const vh = window.innerHeight || 800;
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.id && el.id.indexOf('ll-') === 0) continue;
      const txt = (el.textContent || '').trim();
      if (txt.length < 4 || txt.length > 220) continue;
      if (!/[A-Za-z]{3}/.test(txt)) continue;
      if (el.children.length > 4) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < vh * 0.45) continue;
      cand.push('<' + el.tagName.toLowerCase() + '> class="' + String(el.className).slice(0, 38) +
        '" text="' + txt.slice(0, 60) + '" @y=' + Math.round(r.top));
      if (cand.length >= 8) break;
    }
    if (!cand.length) cand.push('（未发现含英文的候选节点——字幕可能不在 DOM 内，而是混进视频流）');
    lines.push(cand.join('\n'));
    lines.push('—— 页面结构快照 ——');
    lines.push.apply(lines, dumpInitialState());

    // 诊断结果覆盖列表区时，必须留一条回字幕列表的路（否则只能刷新页面）
    const render = () => {
      const list = document.getElementById('ll-list');
      if (!list) return;
      list.innerHTML =
        '<div id="ll-diag-toolbar">' +
          '<button id="ll-diag-back" class="ll-btn">← 返回字幕列表</button>' +
          '<button id="ll-diag-copy" class="ll-btn">复制报告</button>' +
        '</div>' +
        '<pre id="ll-diag-report"></pre>';
      const pre = document.getElementById('ll-diag-report');
      if (pre) pre.textContent = lines.join('\n');
      const back = document.getElementById('ll-diag-back');
      if (back) back.onclick = () => {
        renderList();
        setStatus('已返回字幕列表。');
      };
      const cp = document.getElementById('ll-diag-copy');
      if (cp) cp.onclick = () => {
        const text = lines.join('\n');
        const done = () => showToast('✓ 诊断报告已复制到剪贴板');
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
          } else fallbackCopy(text, done);
        } catch (e) { fallbackCopy(text, done); }
      };
    };
    render();
    setStatus('诊断中：正在探测页面字幕层（约 2 秒）…');
    try { await probeSubtitleLayer(lines); } catch (e) { lines.push('字幕层探测异常: ' + e.message); }
    render();
    const report = lines.join('\n');
    console.log('[LangLearn] 诊断报告\n' + report);
    setStatus('诊断完成：结果在列表区（点「← 返回字幕列表」回字幕；点「复制报告」可整段复制），截图或粘贴发我即可。');
  }

  // 剪贴板兜底（部分内核不给 navigator.clipboard）
  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (done) done();
    } catch (e) {
      showToast('复制失败，请手动选中报告文本');
    }
  }

  // 保留诊断按钮（用快捷键触发不方便，这里挂载到 bar 上通过 reload 旁加一个临时入口）
  function addDiagButtonOnce() {
    if (document.getElementById('ll-diag')) return;
    const bar = document.getElementById('ll-bar');
    if (!bar) return;
    const b = document.createElement('button');
    b.id = 'll-diag'; b.className = 'll-btn'; b.textContent = '诊断'; b.title = '诊断字幕检测情况';
    b.onclick = runDiag;
    bar.insertBefore(b, document.getElementById('ll-pause'));
  }

  // ---------- 启动 ----------
  // 把 storage 的设置套用到运行时状态 + 面板（供 onChanged 与轮询共用）
  function applySettings(r) {
    try {
      const prevDict = dictSource;
      settings.enabled = r.enabled !== false;
      settings.autoPause = !!r.autoPause;
      settings.dictSource = r.dictSource || 'api';
      settings.eudicAction = r.eudicAction || 'lp-dict';
      dictSource = settings.dictSource;
      eudicAction = settings.eudicAction;
      const btn = document.getElementById('ll-pause');
      if (btn) btn.textContent = '暂停：' + (settings.autoPause ? '开' : '关');
      // 切到「本地欧路词典」时提醒一次：点词将唤起欧路应用查词
      if (prevDict !== 'eudic' && dictSource === 'eudic') {
        showToast('已切换「本地欧路词典」：点词将唤起欧路查词（需已安装欧路词典；首次会询问是否允许打开）', 5000);
      }
    } catch (e) { log('applySettings 出错', e); }
  }

  function syncSettings() {
    chrome.storage.sync.get(['enabled', 'autoPause', 'dictSource', 'eudicAction'], (r) => {
      if (chrome.runtime.lastError) return;
      applySettings(r);
    });
  }

  // B 站切分 P / 切视频是 SPA（不刷新页面）：URL 变了要重新解析 bvid+cid 并重拉字幕，
  // 否则会一直沿用旧分 P 的 cid → 字幕对不上或列表为空。
  function resetForNewVideo() {
    try { if (observer) { observer.disconnect(); observer = null; } } catch (e) {}
    observedEl = null; lastText = '';
    cues = []; cues2 = []; subtitleTracks = []; selectedTrack = -1; selectedTrack2 = -1; liveKey = '';
    dataReady = false; loadFailed = false; usingDomFallback = false;
    pendingPauseAt = null; lastAutoPauseTo = null;
    playParams = null; bvid = null; cid = null; isBangumi = false; ytLastVideoId = null;
    lastApiCode = null; lastApiRaw = null; lastSelectError = null; lastYtRaw = null; pendingYtBody = null;
    videoWired = false;
    try { populateTrackSelect(); } catch (e) {}
    try { renderList(); } catch (e) {}
    try { updateLive(); } catch (e) {}
    try { wireVideo(); } catch (e) {}
    if (currentSite === 'youtube') {
      try { window.postMessage({ __llYtRequest: true }, '*'); } catch (e) {}
      try { window.postMessage({ __llYtRequestBody: true }, '*'); } catch (e) {}
    }
    try { loadSubtitles(); } catch (e) { log('loadSubtitles 失败', e); }
  }

  function watchSpaNav() {
    let lastHref = '';
    try { lastHref = location.href; } catch (e) { /* noop */ }
    setInterval(() => {
      let href = '';
      try { href = location.href; } catch (e) { return; }
      if (href === lastHref) return;
      lastHref = href;
      try {
        if (currentSite === 'unsupported') return;
        if (currentSite === 'bilibili' && !/(\/video\/|\/bangumi\/)/.test(location.pathname)) return;
        if (currentSite === 'youtube' && !/(\/watch|\/shorts)/.test(location.pathname)) return;
        log('检测到 SPA 跳转，重新解析字幕：', href);
        resetForNewVideo();
      } catch (e) { log('SPA 跳转处理失败', e); }
    }, 1500);
  }

  async function init() {
    // 每一步都独立 try/catch：任何一处出错都不能阻止面板出现
    try { await getSettings(); } catch (e) { log('getSettings 失败', e); }
    try { currentSite = detectSite(); } catch (e) { log('detectSite 失败', e); }
    if (!settings.enabled) { log('disabled'); return; }
    try { buildPanel(); } catch (e) { log('buildPanel 失败', e); }
    try { addDiagButtonOnce(); } catch (e) { log('addDiagButton 失败', e); }
    // 接收 yt-main.js（MAIN world）桥接的 YouTube 轨道（面板就绪后再注册，避免 DOM 未就绪）
    if (currentSite === 'youtube') {
      try { window.addEventListener('message', onYtBridgeMessage, false); } catch (e) {}
      try { window.postMessage({ __llYtRequest: true }, '*'); } catch (e) {}
      try { window.postMessage({ __llYtRequestBody: true }, '*'); } catch (e) {}
    }
    try { wireVideo(); } catch (e) { log('wireVideo 失败', e); }
    try { loadSubtitles(); } catch (e) { log('loadSubtitles 失败', e); }
    // 设置即时生效：onChanged（标准内核触发）+ 每 2s 轮询兜底
    // （夸克等部分内核不触发 storage.onChanged，需轮询才能"改完立即生效、免刷新"）
    try { chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync') syncSettings(); }); } catch (e) {}
    try { setInterval(syncSettings, 2000); } catch (e) {}
    try { watchSpaNav(); } catch (e) { log('watchSpaNav 失败', e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
