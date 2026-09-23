// 集成烟测（可选）：用 jsdom 真跑 content.js，验证「点词走大模型 + 双击存生词带译文注释」。
// 依赖：npm i jsdom
// 用法：node test-llm-dict.js
// 验证：dictSource=llm 时，点单词 → 弹出大模型释义卡片；双击 → 生词本里该词 note 带译文。
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = `<!doctype html><html><body><video></video>
<script>window.__INITIAL_STATE__ = { bvid: 'BV1TEST00001', videoData: { cid: 999, p: 1 } };</script>
</body></html>`;
const dom = new JSDOM(html, { url: 'https://www.bilibili.com/video/BV1TEST00001', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};

const store = {};
window.chrome = {
  storage: {
    sync: { get: (keys, cb) => cb({ enabled: true, dictSource: 'llm', translateTarget: 'zh-CN', autoTranslate: true, trEngine: 'auto', autoPause: false, eudicAction: 'lp-dict', panelOpacity: 0.85 }) },
    local: {
      get: (d, cb) => cb(typeof d === 'string' ? {} : Object.assign({}, d, store)),
      set: (o) => Object.assign(store, o)
    },
    onChanged: { addListener: () => {} }
  },
  runtime: {
    lastError: null,
    sendMessage: (msg, cb) => {
      if (msg.type === 'translateBatch') {
        cb({ ok: true, engine: 'google', results: msg.texts.map((t) => '【译】' + t) });
      } else if (msg.type === 'dictLlm') {
        // 大模型点词：返回结构化释义卡片
        const w = msg.word;
        cb({
          ok: true, word: w, pos: 'n.', def: '猫（' + w + '）',
          html: '<div class="ll-pos">n.</div><div class="ll-def">猫（' + escapeHtml(w) + '）</div>',
          text: '猫（' + w + '）'
        });
      } else cb({});
    },
    onMessage: { addListener: () => {} }
  }
};
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const SUB_LINES = 6;
const body = [];
for (let i = 0; i < SUB_LINES; i++) body.push({ from: i * 2, to: i * 2 + 1.8, content: 'This is subtitle line number ' + i + '.' });
window.fetch = async (url) => {
  if (String(url).indexOf('/x/web-interface/nav') >= 0) {
    return { json: async () => ({ code: 0, data: { wbi_img: { img_url: 'https://i/aaa.png', sub_url: 'https://i/bbb.png' } } }) };
  }
  if (String(url).indexOf('/x/player/wbi/v2') >= 0) {
    const subs = [{ lan: 'en-US', lan_doc: '英语（美国）', subtitle_url: 'https://aisub/1.json' }];
    return { json: async () => ({ code: 0, data: { subtitle: { subtitles: subs } } }) };
  }
  if (String(url).indexOf('aisub/1.json') >= 0) return { json: async () => ({ body: body }) };
  return { json: async () => ({}) };
};

const code = fs.readFileSync(__dirname + '/content.js', 'utf8');
window.eval(code);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(1200);
  const doc = window.document;
  const list = doc.getElementById('ll-list');
  const rows = doc.querySelectorAll('#ll-list .ll-cue');
  // 取第一个有单词 span 的行里的某个单词（比如 "subtitle"）
  const wordSpan = doc.querySelector('#ll-list .ll-word');
  const word = wordSpan.dataset.word;

  console.log('列表渲染行数        :', rows.length, '(应为 ' + SUB_LINES + ')');
  console.log('首个单词 span       :', word);

  // 1) 点词 → 应弹出大模型释义卡片（含 .ll-def）
  wordSpan.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(50);
  const pop = doc.getElementById('ll-popup');
  const ok1 = !!pop && pop.querySelector('.ll-def') != null && /猫/.test(pop.innerHTML);
  console.log('1) 点词弹出大模型卡片 :', ok1, '(', pop ? pop.innerHTML.slice(0, 80) : '无 popup', ')');

  // 2) 双击该单词 → 生词本里应出现该词，且 note 带译文
  wordSpan.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await sleep(120);
  const vocab = (store.vocab || []);
  const hit = vocab.find((v) => v.word.toLowerCase() === word.toLowerCase());
  const ok2 = !!hit;
  const ok3 = !!hit && typeof hit.note === 'string' && /猫/.test(hit.note);
  console.log('2) 双击存入生词本     :', ok2, '(', hit ? hit.word : '未存', ')');
  console.log('3) 注释带大模型译文   :', ok3, '(note=', hit ? JSON.stringify(hit.note) : '-', ')');

  const all = ok1 && ok2 && ok3;
  console.log('结果:', all ? 'PASS ✅' : 'FAIL ❌');
  process.exit(all ? 0 : 1);
})();
