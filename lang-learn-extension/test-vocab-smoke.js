// vocab.js 冒烟测试：用最小 DOM/chrome 桩真实执行一遍，
// 专抓"编辑报 success 但运行时 ReferenceError/TypeError 导致整页静默挂起"。
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'vocab.js'), 'utf8');
const VOCAB = [
  { word: 'created', note: '创造', box: 1, due: 0, addedAt: 1 },
  { word: 'studies', note: '', box: 2, due: 0, addedAt: 1 },
  { word: 'unknownwordzzz', note: '', box: 1, due: 0, addedAt: 1 }
];
const USER_DICT = { create: { def: '创造,创作', pos: 'v.' }, study: { def: '学习,研究', pos: 'n./v.' } };

// ---- 极简 DOM 桩 ----
function makeEl(id) {
  const el = {
    id,
    _html: '',
    style: {},
    className: '',
    textContent: '',
    value: '',
    dataset: {},
    classList: { add() {}, remove() {}, contains: () => false },
    children: [],
    click() {},
    focus() {},
    select() {},
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { return c; },
    insertBefore(c) { return c; },
    addEventListener() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0 }),
    querySelector: () => null,
    // 桩：能按 innerHTML 里的 class="def" data-w="..." 还原出释义占位元素，
    // 否则 fillDefs 会因为"没有元素"提前 return，测不到后面的批量查询
    querySelectorAll: (sel) => {
      if (sel === '.def') {
        const out = [];
        const re = /class="def" data-w="([^"]*)"/g;
        let m;
        while ((m = re.exec(el._html))) {
          const e2 = makeEl('def');
          e2.dataset = { w: m[1] };
          e2.className = 'def';
          out.push(e2);
        }
        return out;
      }
      return [];
    },
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; }
  };
  return el;
}
const els = {};
const document = {
  getElementById: (id) => (els[id] = els[id] || makeEl(id)),
  createElement: (t) => makeEl(t),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: makeEl('body'),
  execCommand: () => true,
  addEventListener() {}
};

const sent = [];
const ctx = {
  console,
  document,
  navigator: { clipboard: { writeText: (t) => { sent.push(['clipboard', t]); return Promise.resolve(); } } },
  location: { href: 'chrome-extension://x/vocab.html' },
  alert: (m) => sent.push(['alert', m]),
  confirm: () => true,
  prompt: () => null,
  setTimeout,
  clearTimeout,
  Blob: function () {},
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  FileReader: function () {},
  chrome: {
    storage: {
      local: {
        // 注意顺序：真实数据必须放在 spread 之后，否则被默认值（空数组/空对象）覆盖
        get: (def, cb) => cb({ ...def, vocab: VOCAB, userDict: USER_DICT }),
        set: (o, cb) => { cb && cb(); }
      }
    },
    runtime: {
      sendMessage: (msg, cb) => {
        sent.push(['sendMessage', msg]);
        if (msg.type === 'dictLookupBatch') {
          const map = {};
          (msg.words || []).forEach((w) => {
            const hit = USER_DICT[w.toLowerCase()];
            if (hit) map[w] = { key: w.toLowerCase(), def: hit.def, pos: hit.pos, matched: w.toLowerCase() };
          });
          cb && cb({ ok: true, map, dictSize: Object.keys(USER_DICT).length });
        } else if (msg.type === 'lookup') {
          cb && cb({ ok: true, source: '本地词库', meanings: [{ pos: '', def: '（测试释义）' }] });
        } else cb && cb({ ok: false });
      },
      lastError: null
    }
  }
};
ctx.window = ctx;
ctx.globalThis = ctx;

let crashed = null;
process.on('uncaughtException', (e) => { crashed = e; });

try {
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
} catch (e) {
  crashed = e;
}

const listEl = els['list'];
const html = listEl ? listEl.innerHTML : '';
const batchCall = sent.find((s) => s[0] === 'sendMessage' && s[1] && s[1].type === 'dictLookupBatch');

const ok1 = !crashed;
const ok2 = /data-w="created"/.test(html) && /class="def"/.test(html);
const ok3 = !!batchCall && batchCall[1].words.join(',') === 'created,studies,unknownwordzzz';
const ok4 = /data-act="edit"/.test(html) && /data-act="lookup"/.test(html);
// IIFE 内的函数不暴露到全局，用"渲染是否真的发生"来证明 init 跑通
const statEl = els['stat'];
const ok5 = !!statEl && /共 3 词/.test(statEl.textContent || '');

console.log('1) 真实执行无未捕获异常   :', ok1, crashed ? ('→ ' + crashed.message) : '');
console.log('2) 列表含释义占位 .def    :', ok2);
console.log('3) 请求了本地词库批量查询 :', ok3, batchCall ? JSON.stringify(batchCall[1].words) : '（未发出）');
console.log('4) 含「改词/联网查」按钮  :', ok4);
console.log('5) 渲染真的执行了(共 3 词) :', ok5, statEl ? JSON.stringify(statEl.textContent) : '');
const all = ok1 && ok2 && ok3 && ok4 && ok5;
console.log('结果:', all ? 'PASS ✅' : 'FAIL ❌');
if (!all) process.exitCode = 1;
