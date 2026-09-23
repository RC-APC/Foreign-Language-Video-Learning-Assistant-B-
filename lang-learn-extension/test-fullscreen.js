// 集成烟测（可选）：用 jsdom 真跑 content.js，验证「全屏浮窗」链路。
// 依赖：npm i jsdom（其他 test-*.js 都不需要依赖，这个需要）
// 用法：node test-fullscreen.js
//
// 背景：HTML 全屏下浏览器只绘制 document.fullscreenElement 及其后代，
// 挂在 body 上的面板会被整棵子树裁掉。所以进全屏要把面板改挂到全屏容器里。
// 这里覆盖三种场景：
//   A) 全屏对象是普通容器（B 站 / YouTube 的实际情况）→ 直接改挂
//   B) 退出全屏 → 搬回 body 原来的位置
//   C) 全屏对象是 <video> 本身（子元素不渲染）→ 先换容器重请求全屏，成功后再改挂
const fsNode = require('fs');
const { JSDOM } = require('jsdom');

const html = `<!doctype html><html><body>
<div id="vwrap"><video id="v"></video></div>
<div id="fsbox"></div>
<script>window.__INITIAL_STATE__ = { bvid: 'BV1TEST00001', videoData: { cid: 999, p: 1 } };</script>
</body></html>`;
const dom = new JSDOM(html, { url: 'https://www.bilibili.com/video/BV1TEST00001', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
const doc = window.document;
window.Element.prototype.scrollIntoView = function () {};

// ---- chrome 桩 ----
const store = {};
window.chrome = {
  storage: {
    sync: { get: (keys, cb) => cb({ enabled: true }), set: () => {} },
    local: {
      get: (d, cb) => cb(typeof d === 'string' ? {} : Object.assign({}, d, store)),
      set: (o) => Object.assign(store, o)
    },
    onChanged: { addListener: () => {} }
  },
  runtime: {
    lastError: null,
    sendMessage: (msg, cb) => { if (cb) cb({}); },
    onMessage: { addListener: () => {} }
  }
};
window.fetch = async () => ({ json: async () => ({}) });

// ---- 全屏 API 桩：手工切换 document.fullscreenElement 并派发事件 ----
let fsEl = null;
Object.defineProperty(doc, 'fullscreenElement', { get: () => fsEl, configurable: true });
Object.defineProperty(doc, 'webkitFullscreenElement', { get: () => fsEl, configurable: true });
function gotoFullscreen(el) {
  fsEl = el;
  doc.dispatchEvent(new window.Event('fullscreenchange'));
}
function exitFullscreen() {
  fsEl = null;
  doc.dispatchEvent(new window.Event('fullscreenchange'));
}
// requestFullscreen / exitFullscreen 桩，用于场景 C 的"换容器重请求"
const calls = { request: [], exit: 0 };
window.Element.prototype.requestFullscreen = function () {
  calls.request.push(this);
  return Promise.resolve();
};
doc.exitFullscreen = function () {
  calls.exit++;
  fsEl = null;
  return Promise.resolve();
};

const code = fsNode.readFileSync(__dirname + '/content.js', 'utf8');   // 跑真实的 content.js
window.eval(code);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(900);
  const panel = doc.getElementById('ll-panel');
  const fsbox = doc.getElementById('fsbox');
  const video = doc.getElementById('v');
  const homeParent = panel.parentNode;

  console.log('面板已创建            :', !!panel);
  console.log('初始挂载点            :', homeParent && (homeParent.tagName + (homeParent.id ? '#' + homeParent.id : '')));

  // ---- 场景 A：全屏对象是普通容器 ----
  const before = { win: panel.classList.contains('ll-windowed'), parent: panel.parentNode };
  gotoFullscreen(fsbox);
  await sleep(60);
  const a1 = panel.parentNode === fsbox;
  const a2 = panel.classList.contains('ll-in-fs');
  const a3 = panel.classList.contains('ll-windowed');
  const a4 = panel.classList.contains('ll-collapsed') === false;
  console.log('A1) 面板已搬进全屏容器 :', a1);
  console.log('A2) 打上 ll-in-fs 标记 :', a2);
  console.log('A3) 自动切成浮窗模式   :', a3, '(进入前 isWindowed=' + before.win + ')');
  console.log('A4) 自动展开           :', a4);

  // ---- 场景 B：退出全屏要还原 ----
  exitFullscreen();
  await sleep(60);
  const b1 = panel.parentNode === homeParent;
  const b2 = !panel.classList.contains('ll-in-fs');
  const b3 = panel.classList.contains('ll-windowed') === before.win;
  console.log('B1) 退出后搬回原挂载点 :', b1);
  console.log('B2) 清除 ll-in-fs      :', b2);
  console.log('B3) 还原原窗口化状态   :', b3);

  // ---- 场景 C：全屏对象是 <video> 本身（子元素不渲染）----
  gotoFullscreen(video);
  await sleep(60);
  const c1 = panel.parentNode !== video;                 // 绝不能塞进 video（不渲染）
  const c2 = calls.exit === 0 && calls.request.length === 1;   // 不能先 exit（会把全屏弄掉）
  // 注意：此时 video 的直接父元素是 #vwrap（模拟播放器的 video 包裹层）
  const c3 = calls.request[0] === video.parentElement && calls.request[0] && calls.request[0].id === 'vwrap';
  console.log('C1) 没有塞进 <video>   :', c1);
  console.log('C2) 触发了换容器重请求 :', c2);
  console.log('C3) 目标确实是上层容器 :', c3, '(目标=' + (calls.request[0] && calls.request[0].id) + ', exit 调用 ' + calls.exit + ' 次)');

  // 重请求成功后，全屏元素变成容器 → 这时才真正改挂
  gotoFullscreen(fsbox);
  await sleep(60);
  const c4 = panel.parentNode === fsbox && panel.classList.contains('ll-in-fs');
  console.log('C4) 换容器后成功挂载   :', c4);

  const all = a1 && a2 && a3 && a4 && b1 && b2 && b3 && c1 && c2 && c3 && c4;
  console.log('结果:', all ? 'PASS ✅' : 'FAIL ❌');
  process.exit(all ? 0 : 1);
})();
