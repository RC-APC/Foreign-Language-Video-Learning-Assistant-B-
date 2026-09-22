// 在 Node 里用 vm 跑 yt-main.js（MAIN world 桥接脚本），验证：
//   1) 正常情况会 postMessage 出【最小化轨道列表】
//   2) 响应里的 videoId 与 URL 的 v 不一致（SPA 残留）时不发
//   3) 收到 {__llYtRequest:true} 时会强制重发（握手）
//   4) 轨道名支持 simpleText 与 runs[0].text 两种形态
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'yt-main.js'), 'utf8');

// 构造一次隔离运行环境
function run(opts) {
  const messages = [];
  const listeners = {};
  const pendingIntervals = [];
  const fakePR = opts.pr;
  const ctx = {
    location: { pathname: opts.pathname, search: opts.search },
    document: {
      getElementById: (id) => (id === 'movie_player'
        ? { getPlayerResponse: () => fakePR }
        : null)
    },
    // setInterval 只登记不立即回调（与真实浏览器一致：先返回 id，再回调），
    // 否则会撞上脚本里 const iv = setInterval(...) 的 TDZ。
    setInterval: (fn) => { pendingIntervals.push(fn); return 1; },
    clearInterval: () => {},
    // setTimeout 同步执行，用于触发脚本结尾的 setTimeout(send, 0)
    setTimeout: (fn) => { fn(); return 1; },
    console
  };
  // ---- fetch / XHR 桩：用于验证「截获播放器字幕正文」通路 ----
  const fetchCalls = [];
  const makeRes = (text) => ({
    ok: true, status: 200,
    clone: () => ({ text: () => Promise.resolve(text) }),
    text: () => Promise.resolve(text)
  });
  ctx.window = {
    __llYtBridgeInstalled: false,
    postMessage: (m) => messages.push(m),
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    fetch: function (url, init) { fetchCalls.push({ url, init }); return Promise.resolve(makeRes(opts.fetchBody || '')); }
  };
  // 简易 XHR 桩（支持 load 事件）
  const xhrListeners = [];
  ctx.window.XMLHttpRequest = function () {
    this._ls = {};
    this.responseText = opts.xhrBody || '';
  };
  ctx.window.XMLHttpRequest.prototype.open = function (m, u) { this._url = u; };
  ctx.window.XMLHttpRequest.prototype.send = function () {};
  ctx.window.XMLHttpRequest.prototype.addEventListener = function (ev, fn) {
    (this._ls[ev] = this._ls[ev] || []).push(fn);
    xhrListeners.push({ xhr: this, ev, fn });
  };
  ctx.window.XMLHttpRequest.prototype.fire = function (ev) {
    (this._ls[ev] || []).forEach((f) => f.call(this));
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return { messages, listeners, ctx, fetchCalls, xhrListeners, XHR: ctx.window.XMLHttpRequest };
}

function makePR(videoId) {
  return {
    videoDetails: { videoId: videoId },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&v=' + videoId, name: { simpleText: 'English (UK)' }, languageCode: 'en-GB' },
          { baseUrl: 'https://www.youtube.com/api/timedtext?lang=zh-Hans&v=' + videoId, name: { runs: [{ text: '中文（简体）' }] }, languageCode: 'zh-Hans' }
        ]
      }
    }
  };
}

// 1) 正常
const r1 = run({ pathname: '/watch', search: '?v=dQw4w9WgXcQ', pr: makePR('dQw4w9WgXcQ') });
const m1 = r1.messages.find((m) => m && m.__llYtTracks);
const ok1 = !!m1 && m1.videoId === 'dQw4w9WgXcQ' && m1.tracks.length === 2;

// 2) videoId 不匹配（URL 是新视频，响应是旧视频）
const r2 = run({ pathname: '/watch', search: '?v=NEWvideo1234', pr: makePR('OLDevideo9999') });
const ok2 = !r2.messages.some((m) => m && m.__llYtTracks);

// 3) 握手：请求后强制重发
const r3 = run({ pathname: '/watch', search: '?v=dQw4w9WgXcQ', pr: makePR('dQw4w9WgXcQ') });
const before = r3.messages.filter((m) => m && m.__llYtTracks).length;
const h = r3.listeners['message'][0];
h({ source: r3.ctx.window, data: { __llYtRequest: true } });
const after = r3.messages.filter((m) => m && m.__llYtTracks).length;
const ok3 = after === before + 1;

// 4) runs[0].text 形态的轨道名
const ok4 = !!m1 && m1.tracks[1].lan_doc === '中文（简体）' && m1.tracks[0].lan_doc === 'English (UK)';

// 5) /shorts/<id> 形态
const r5 = run({ pathname: '/shorts/SHORTid12345', search: '', pr: makePR('SHORTid12345') });
const m5 = r5.messages.find((m) => m && m.__llYtTracks);
const ok5 = !!m5 && m5.videoId === 'SHORTid12345';

console.log('--- 首次桥接消息 ---');
console.log(JSON.stringify(m1, null, 2));
console.log('\n1) 正常发出最小化轨道(2条)      :', ok1);
console.log('2) videoId 不匹配时不发         :', ok2);
console.log('3) __llYtRequest 强制重发       :', ok3, '(' + before + ' → ' + after + ')');
console.log('4) 轨道名兼容 simpleText/runs   :', ok4);
console.log('5) /shorts/<id> 也能识别        :', ok5);

// ---- 6) 截获播放器字幕正文（fetch 通路） ----
const SRT_JSON3 = JSON.stringify({ events: [
  { tStartMs: 0, dDurationMs: 1200, segs: [{ utf8: 'Yes, and people should ' }, { utf8: 'remember' }] },
  { tStartMs: 1200, dDurationMs: 900, segs: [{ utf8: 'that they can get a free worksheet' }] }
] });
(async () => {
  const r6 = run({ pathname: '/watch', search: '?v=dQw4w9WgXcQ', pr: makePR('dQw4w9WgXcQ'), fetchBody: SRT_JSON3 });

  // 模拟播放器自己拉字幕文件
  await r6.ctx.window.fetch('https://www.youtube.com/api/timedtext?lang=en-GB&v=dQw4w9WgXcQ&fmt=json3', { credentials: 'include' });
  await new Promise((res) => setTimeout(res, 0)); // 等 microtask（clone().text()）

  const bodyMsg = r6.messages.find((m) => m && m.__llYtSubtitleBody);
  const ok6 = !!bodyMsg && bodyMsg.body === SRT_JSON3 && /lang=en-GB/.test(bodyMsg.url);

  // ---- 7) 非字幕请求不误截 ----
  const r7 = run({ pathname: '/watch', search: '?v=dQw4w9WgXcQ', pr: makePR('dQw4w9WgXcQ'), fetchBody: '{"x":1}' });
  await r7.ctx.window.fetch('https://www.youtube.com/youtubei/v1/player', { credentials: 'include' });
  await new Promise((res) => setTimeout(res, 0));
  const ok7 = !r7.messages.some((m) => m && m.__llYtSubtitleBody);

  // ---- 8) XHR 通路也能截获 ----
  const r8 = run({ pathname: '/watch', search: '?v=dQw4w9WgXcQ', pr: makePR('dQw4w9WgXcQ'), xhrBody: SRT_JSON3 });
  const xhr = new r8.XHR();
  xhr.open('GET', 'https://www.youtube.com/api/timedtext?lang=en-GB&v=dQw4w9WgXcQ');
  xhr.send();
  xhr.fire('load');
  const ok8 = r8.messages.some((m) => m && m.__llYtSubtitleBody && m.body === SRT_JSON3);

  // ---- 9) __llYtRequestBody 重放缓存正文 ----
  // r6 已缓存过正文；发请求应再收到一条
  const before9 = r6.messages.filter((m) => m && m.__llYtSubtitleBody).length;
  const h = r6.listeners['message'][0];
  h({ source: r6.ctx.window, data: { __llYtRequestBody: true } });
  const after9 = r6.messages.filter((m) => m && m.__llYtSubtitleBody).length;
  const ok9 = after9 === before9 + 1;

  // ---- 10) 截获的空正文不转发 ----
  const r10 = run({ pathname: '/watch', search: '?v=dQw4w9WgXcQ', pr: makePR('dQw4w9WgXcQ'), fetchBody: '' });
  await r10.ctx.window.fetch('https://www.youtube.com/api/timedtext?lang=en-GB&v=dQw4w9WgXcQ');
  await new Promise((res) => setTimeout(res, 0));
  const ok10 = !r10.messages.some((m) => m && m.__llYtSubtitleBody);

  console.log('\n6) fetch 截获字幕正文(含 lang)  :', ok6);
  console.log('7) 非字幕请求不误截             :', ok7);
  console.log('8) XHR 通路截获字幕正文         :', ok8);
  console.log('9) __llYtRequestBody 重放缓存   :', ok9, '(' + before9 + ' → ' + after9 + ')');
  console.log('10) 空正文不转发                :', ok10);
  const all = ok1 && ok2 && ok3 && ok4 && ok5 && ok6 && ok7 && ok8 && ok9 && ok10;
  console.log('结果:', all ? 'PASS ✅ (10/10)' : 'FAIL ❌');
  if (!all) process.exitCode = 1;
})();
