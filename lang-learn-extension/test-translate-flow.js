// 集成烟测（可选）：用 jsdom 真跑 content.js，验证「AI 中文译文轨道」整条链路。
// 依赖：npm i jsdom（其他 test-*.js 都不需要依赖，这个需要）
// 用法：
//   node test-translate-flow.js          只有英文 CC → 应自动生成中文译文轨道并挂到对照位
//   node test-translate-flow.js has-zh   本来就有中文轨道 → 不该生成、不该浪费翻译调用
// 验证：轨道加载 → 自动翻译 → 生成虚拟中文轨道 → 自动挂到对照轨道（实时字幕原文+译文两行）
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = `<!doctype html><html><body><video></video>
<script>window.__INITIAL_STATE__ = { bvid: 'BV1TEST00001', videoData: { cid: 999, p: 1 } };</script>
</body></html>`;
const dom = new JSDOM(html, { url: 'https://www.bilibili.com/video/BV1TEST00001', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

window.Element.prototype.scrollIntoView = function () {};   // jsdom 不实现，桩掉

// ---- chrome 桩 ----
const store = {};
window.chrome = {
  storage: {
    sync: { get: (keys, cb) => cb({ enabled: true }) },
    local: {
      get: (d, cb) => cb(typeof d === 'string' ? {} : Object.assign({}, d, store)),
      set: (o) => Object.assign(store, o)
    },
    onChanged: { addListener: () => {} }
  },
  runtime: {
    lastError: null,
    // 后台翻译服务（这里直接返回假译文，不走网络）
    sendMessage: (msg, cb) => {
      if (msg.type === 'translateBatch') {
        window.__translateCalls++;
        // 场景 llm：模拟后台走大模型引擎返回（引擎名带模型后缀）
        if (SCENARIO === 'llm') {
          cb({ ok: true, engine: 'llm:deepseek-flash', results: msg.texts.map((t) => '【大模型】' + t) });
        } else {
          cb({ ok: true, engine: 'google', results: msg.texts.map((t) => '【译】' + t) });
        }
      } else cb({});
    },
    onMessage: { addListener: () => {} }
  }
};

// ---- fetch 桩：B 站字幕 API ----
const SUB_LINES = 12;
const body = [];
for (let i = 0; i < SUB_LINES; i++) {
  body.push({ from: i * 2, to: i * 2 + 1.8, content: 'This is subtitle line number ' + i + '.' });
}
// 场景 B（--has-zh）：本来就有中文轨道 → 不该触发翻译
const SCENARIO = process.argv[2] || 'only-en';
window.__translateCalls = 0;

window.fetch = async (url) => {
  if (String(url).indexOf('/x/web-interface/nav') >= 0) {
    return { json: async () => ({ code: 0, data: { wbi_img: { img_url: 'https://i/aaa.png', sub_url: 'https://i/bbb.png' } } }) };
  }
  if (String(url).indexOf('/x/player/wbi/v2') >= 0) {
    const subs = [{ lan: 'en-US', lan_doc: '英语（美国）', subtitle_url: 'https://aisub/1.json' }];
    if (SCENARIO === 'has-zh') subs.push({ lan: 'zh-CN', lan_doc: '中文（简体）', subtitle_url: 'https://aisub/2.json' });
    return { json: async () => ({ code: 0, data: { subtitle: { subtitles: subs } } }) };
  }
  if (String(url).indexOf('aisub/1.json') >= 0) return { json: async () => ({ body: body }) };
  if (String(url).indexOf('aisub/2.json') >= 0) {
    // 真·中文轨道：内容确实为中文
    return { json: async () => ({ body: body.map((b, i) => ({ from: b.from, to: b.to, content: '这是第 ' + i + ' 行中文字幕。' })) }) };
  }
  return { json: async () => ({}) };
};

// ---- 把 content.js 注入页面上下文 ----
const code = fs.readFileSync(__dirname + '/content.js', 'utf8');   // 跑真实的 content.js，不做逻辑副本
window.eval(code);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(1500);
  const doc = window.document;
  const panel = doc.getElementById('ll-panel');
  const trackSel = doc.getElementById('ll-track');
  const track2Sel = doc.getElementById('ll-track2');
  const status = doc.getElementById('ll-status');
  const listRows = doc.querySelectorAll('#ll-list .ll-cue');
  const opts = Array.from(trackSel.options).map((o) => o.textContent);
  const opts2 = Array.from(track2Sel.options).map((o) => o.textContent);
  const trBtn = doc.getElementById('ll-tr');
  const liveEl = doc.getElementById('ll-live');

  // 让时间轴走到第 3 行，看实时字幕是否原文+译文两行
  const v = doc.querySelector('video');
  Object.defineProperty(v, 'currentTime', { value: 5, writable: true });
  v.dispatchEvent(new window.Event('timeupdate'));

  console.log('面板已创建          :', !!panel);
  console.log('主轨道下拉          :', opts.join(' | '));
  console.log('对照轨道下拉        :', opts2.join(' | '));
  console.log('对照轨道选中值      :', track2Sel.value);
  console.log('列表渲染行数        :', listRows.length, '(应为 ' + SUB_LINES + ')');
  console.log('状态栏              :', status && status.textContent);
  console.log('译中文按钮          :', trBtn && trBtn.textContent);
  console.log('实时字幕 行数/长度  :', liveEl ? liveEl.children.length + ' / ' + liveEl.innerHTML.length : '-');
  console.log('实时字幕 原文行     :', liveEl && liveEl.children[0] && liveEl.children[0].textContent);
  console.log('实时字幕 译文行     :', liveEl && liveEl.children[1] && liveEl.children[1].textContent);
  console.log('译文缓存已写入      :', Object.keys(store).filter((k) => k === 'llTrCache').length > 0);

  const PRE = SCENARIO === 'llm' ? /^【大模型】/ : /^【译】/;
  const ok1 = !!panel && listRows.length === SUB_LINES;
  const ok2 = opts.some((o) => o.indexOf('中文（AI 翻译）') >= 0);
  const ok3 = track2Sel.value !== '-1';
  const ok4 = /已生成/.test(status.textContent);
  const liveMain = (liveEl.children[0] || {}).textContent || '';
  const liveSub = (liveEl.children[1] || {}).textContent || '';
  const ok5 = liveEl.children.length === 2 && PRE.test(liveSub) &&
    liveSub.indexOf('line number 2') > 0 && liveMain.indexOf('line number 2') > 0;
  const ok6 = Object.keys(store).indexOf('llTrCache') >= 0;
  console.log('---');
  console.log('1) 列表按原文渲染        :', ok1);
  console.log('2) 下拉里出现中文译文轨道:', ok2);
  console.log('3) 自动挂到对照轨道      :', ok3);
  console.log('4) 状态栏提示已生成      :', ok4);
  console.log('5) 实时字幕原文+译文两行 :', ok5);
  console.log('6) 译文已缓存            :', ok6);
  let all = ok1 && ok2 && ok3 && ok4 && ok5 && ok6;

  if (SCENARIO === 'only-en') {
    // 场景 C：把主轨道切到「中文（AI 翻译）」→ 列表应变成中文，且整句不该被当成单词
    const zhIdx = opts.findIndex((o) => o.indexOf('AI 翻译') >= 0);   // 含"对照：无"占位，故用 name 定位
    trackSel.value = String(zhIdx);
    trackSel.dispatchEvent(new window.Event('change'));
    await sleep(400);
    const rows2 = Array.from(doc.querySelectorAll('#ll-list .ll-cue'));
    const firstZh = rows2.length ? rows2[0].querySelector('.ll-text').textContent : '';
    const badWord = Array.from(doc.querySelectorAll('#ll-list .ll-word'))
      .some((s) => (s.dataset.word || '').length > 24 && !/[A-Za-z]/.test(s.dataset.word || ''));
    console.log('C1) 切到译文轨道后首行   :', firstZh.slice(0, 40));
    console.log('C2) 列表变为中文译文     :', rows2.length === SUB_LINES && firstZh.indexOf('【译】') === 0);
    console.log('C3) 中文整句不被当单词   :', !badWord);
    all = all && rows2.length === SUB_LINES && firstZh.indexOf('【译】') === 0 && !badWord;
  }
  if (SCENARIO === 'llm') {
    // 场景 llm：后台走大模型返回时，状态栏应显示实际用到的模型名，而不是笼统标签
    const named = status.textContent.indexOf('llm:deepseek-flash') > 0;
    console.log('D1) 状态栏显示真实引擎名  :', named);
    all = all && named;
  }
  if (SCENARIO === 'has-zh') {
    const noVirtual = !opts.some((o) => o.indexOf('AI 翻译') >= 0);
    const noCall = window.__translateCalls === 0;
    // 下拉第一项是「对照：无」占位，所以 value=N 对应 options[N+1]
    const realZhAsRef = track2Sel.value !== '-1' &&
      opts2[Number(track2Sel.value) + 1].indexOf('中文（简体）') >= 0 &&
      liveSub.indexOf('这是第 2 行中文字幕') >= 0;
    console.log('7) 已有中文轨道不生成译文  :', noVirtual);
    console.log('8) 不浪费翻译调用(0 次)   :', noCall, '(实际 ' + window.__translateCalls + ' 次)');
    console.log('9) 对照轨道直接用真中文轨  :', !!realZhAsRef);
    all = noVirtual && noCall && realZhAsRef;
  }
  console.log('结果:', all ? 'PASS ✅' : 'FAIL ❌');
  process.exit(all ? 0 : 1);
})();
