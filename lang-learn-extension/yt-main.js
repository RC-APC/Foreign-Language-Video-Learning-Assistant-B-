// ============================================================================
// yt-main.js —— 运行在 MAIN world（页面主世界，见 manifest content_scripts 的 "world": "MAIN"）
//
// 为什么需要它：
//   YouTube 切换视频是 SPA，不会再重新注入 ytInitialPlayerResponse 脚本标签；
//   新视频的播放器响应只存在于播放器 JS 对象的 getPlayerResponse() 里。
//   而 content script（隔离世界）读不到页面 JS 对象，也读不到 DOM 里那份【旧】数据。
//   → 表现就是「必须刷新页面，字幕轨道才出来」。
//
// 本脚本在主世界取到当前视频的播放器响应，只把【最小化的字幕轨道列表】
// 通过 window.postMessage 转发给 content.js（隔离世界）。
// ============================================================================
(function () {
  if (window.__llYtBridgeInstalled) return;
  window.__llYtBridgeInstalled = true;

  let lastSent = '';

  function urlVid() {
    try {
      const s = location.pathname.match(/\/shorts\/([\w-]{6,})/);
      if (s) return s[1];
      const m = location.search.match(/[?&]v=([\w-]{6,})/);
      if (m) return m[1];
    } catch (e) { /* noop */ }
    return null;
  }

  function getPR() {
    // ① 播放器实时接口（切视频后立即是【新视频】的响应）
    try {
      const mp = document.getElementById('movie_player');
      if (mp && typeof mp.getPlayerResponse === 'function') {
        const pr = mp.getPlayerResponse();
        if (pr && pr.videoDetails && pr.videoDetails.videoId) return pr;
      }
    } catch (e) { /* noop */ }
    // ② 页面全局变量（首屏直出）
    try {
      if (window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.videoDetails) {
        return window.ytInitialPlayerResponse;
      }
    } catch (e) { /* noop */ }
    return null;
  }

  function send(force) {
    const pr = getPR();
    if (!pr) return false;
    const vid = pr.videoDetails && pr.videoDetails.videoId;
    if (!vid) return false;
    // 必须与 URL 里的 v 一致，否则是 SPA 切换残留 → 继续等
    const uv = urlVid();
    if (uv && vid !== uv) return false;

    const tl = pr.captions && pr.captions.playerCaptionsTracklistRenderer;
    const list = (tl && tl.captionTracks) || [];
    const tracks = list.map(function (t) {
      let name = '';
      if (t.name) {
        if (t.name.simpleText) name = t.name.simpleText;
        else if (t.name.runs && t.name.runs[0] && t.name.runs[0].text) name = t.name.runs[0].text;
      }
      return {
        lan: t.languageCode || '',
        lan_doc: name || t.languageCode || '',
        url: t.baseUrl || ''
      };
    });

    const key = vid + '|' + tracks.map(function (t) { return t.lan; }).join(',');
    if (key === lastSent && !force) return true;   // 同视频同轨道，不重复发
    lastSent = key;
    try {
      window.postMessage({ __llYtTracks: true, videoId: vid, tracks: tracks }, '*');
    } catch (e) { /* noop */ }
    return true;
  }

  // 多事件触发：YouTube 的 SPA 路由事件 + 播放器事件
  ['yt-navigate-finish', 'yt-page-data-updated', 'yt-player-updated', 'yt-navigate-start'].forEach(function (ev) {
    try { window.addEventListener(ev, function () { setTimeout(send, 300); }, true); } catch (e) { /* noop */ }
  });

  // ==========================================================================
  // 方案 B：直接截获【播放器自己下载的字幕正文】
  //
  // 为什么需要：YouTube 现在给 /api/timedtext 加了 pot（proof-of-origin）令牌校验，
  // 我们从 ytInitialPlayerResponse 拿到的 baseUrl 缺少该令牌 / 签名已过期，
  // 直接 fetch 会返回 HTTP 200 但【正文为空】——诊断表现为「fmt=xx → 0 行（detected=empty）」。
  // 而播放器自己（开启 CC 时）请求用的是带令牌的完整 URL，且正文就在响应里。
  // 所以这里 hook fetch / XHR，把字幕响应体原样转发给扩展。
  // ==========================================================================
  let lastBody = null;

  function isTimedtext(u) {
    const s = String(u || '');
    return s.indexOf('/api/timedtext') >= 0 || /[?&]lang=[^&]*&.*v=/.test(s) && s.indexOf('timedtext') >= 0;
  }
  function pushBody(url, text) {
    if (!text || !text.length) return;
    lastBody = { url: String(url || ''), body: text };
    try { window.postMessage({ __llYtSubtitleBody: true, url: lastBody.url, body: text }, '*'); } catch (e) { /* noop */ }
  }

  // --- hook window.fetch ---
  try {
    const origFetch = window.fetch;
    if (typeof origFetch === 'function' && !origFetch.__llHooked) {
      const wrapped = function (input, init) {
        const url = (typeof input === 'string') ? input : (input && input.url) || '';
        const p = origFetch.apply(this, arguments);
        if (isTimedtext(url)) {
          try {
            p.then(function (res) {
              try {
                if (res && typeof res.clone === 'function') {
                  res.clone().text().then(function (t) { pushBody(url, t); }, function () { /* noop */ });
                }
              } catch (e) { /* noop */ }
            }, function () { /* noop */ });
          } catch (e) { /* noop */ }
        }
        return p;
      };
      wrapped.__llHooked = true;
      window.fetch = wrapped;
    }
  } catch (e) { /* noop */ }

  // --- hook XMLHttpRequest ---
  try {
    const XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype && !XHR.prototype.__llHooked) {
      const origOpen = XHR.prototype.open;
      const origSend = XHR.prototype.send;
      XHR.prototype.open = function (method, url) {
        try { this.__llUrl = url; } catch (e) { /* noop */ }
        return origOpen.apply(this, arguments);
      };
      XHR.prototype.send = function () {
        try {
          const self = this;
          if (isTimedtext(this.__llUrl)) {
            this.addEventListener('load', function () {
              try { pushBody(self.__llUrl, self.responseText); } catch (e) { /* noop */ }
            });
          }
        } catch (e) { /* noop */ }
        return origSend.apply(this, arguments);
      };
      XHR.prototype.__llHooked = true;
    }
  } catch (e) { /* noop */ }

  // 握手：隔离世界若在面板就绪后才注册监听，会错过早先发出的消息 → 允许它主动请求重发
  try {
    window.addEventListener('message', function (e) {
      if (e.source !== window) return;
      const d = e.data;
      if (!d) return;
      if (d.__llYtRequest === true) { try { send(true); } catch (err) { /* noop */ } }
      if (d.__llYtRequestBody === true && lastBody) {
        try { window.postMessage({ __llYtSubtitleBody: true, url: lastBody.url, body: lastBody.body }, '*'); } catch (err) { /* noop */ }
      }
    }, false);
  } catch (e) { /* noop */ }

  // 轮询兜底：最多 ~40s（每 700ms 一次），成功后停止
  let n = 0;
  const iv = setInterval(function () {
    n++;
    let ok = false;
    try { ok = send(); } catch (e) { /* noop */ }
    if (ok || n > 60) clearInterval(iv);
  }, 700);

  try { setTimeout(send, 0); } catch (e) { /* noop */ }
})();
