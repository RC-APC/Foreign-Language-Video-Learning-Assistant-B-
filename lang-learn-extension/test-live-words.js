/**
 * 实时字幕行「逐词可点」测试
 * ------------------------------------------------------------
 * 需求：窗口化浮窗里那一行字幕要能点词查释义（与字幕列表同一套能力）。
 * 关键点有两个，都得测：
 *   1. #ll-live 里要渲染出 span.ll-word（带 dataset.word），否则点不到词；
 *   2. 同一行要「不重建 DOM」——updateLive 挂在 timeupdate 上（每 ~250ms 一次），
 *      若每帧重写，用户刚点出来的释义弹层和 :hover 立刻被冲掉（这就是报障的根因）。
 *
 * 做法：不 mock updateLive 的行为，而是从 content.js **抽出真实函数源码**（按缩进配对切片），
 * 配一个记录型 DOM 桩执行 —— 测的是线上代码，不是复制品。
 *
 * 用法：node test-live-words.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const FILE = path.join(__dirname, 'content.js');
const src = fs.readFileSync(FILE, 'utf8');

// 按「函数起始行 → 之后第一行恰好为同缩进 '}'」切片（函数体内层缩进更深，不会误判）
function sliceFn(source, name) {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l.includes('function ' + name + '('));
  if (start < 0) throw new Error('未找到函数: ' + name);
  const indent = lines[start].match(/^\s*/)[0];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === indent + '}') return lines.slice(start, i + 1).join('\n');
  }
  throw new Error('未找到函数结尾: ' + name);
}

const fnWrapWords = sliceFn(src, 'wrapWords');
const fnUpdateLive = sliceFn(src, 'updateLive');

// ---------- 记录型 DOM 桩 ----------
function makeNode(tag) {
  const n = {
    tagName: tag,
    className: '',
    dataset: {},
    children: [],
    _text: '',
    _replaces: 0,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
      contains(c) { return this._s.has(c); }
    },
    appendChild(c) { this.children.push(c); return c; },
    get textContent() {
      return this._text + this.children.map((c) => c.textContent || '').join('');
    },
    set textContent(v) { this._text = String(v); this.children = []; },
    replaceChildren(frag) {
      this._replaces++;
      this.children = frag ? frag.children.slice() : [];
      this._text = '';
    }
  };
  return n;
}

function makeText(t) {
  return { nodeType: 3, isText: true, _v: String(t), get textContent() { return this._v; }, children: [] };
}

const liveEl = makeNode('div');
const documentStub = {
  getElementById: (id) => (id === 'll-live' ? liveEl : null),
  createElement: (t) => makeNode(t),
  createTextNode: (t) => makeText(t),
  createDocumentFragment: () => makeNode('#fragment')
};

const sandbox = { console, document: documentStub, Promise, Math, Date, JSON, RegExp };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

vm.runInContext('var cues = []; var cues2 = []; var liveKey = "";', sandbox);
vm.runInContext(`
  function cursorCueFrom(arr) {
    var cur = null;
    for (var i = 0; i < arr.length; i++) { if (arr[i].from <= __now) cur = arr[i]; else break; }
    return cur;
  }
  function currentCursorCue() { return cursorCueFrom(cues); }
`, sandbox);
vm.runInContext(fnWrapWords, sandbox);
vm.runInContext(fnUpdateLive, sandbox);

// 用一个中间全局传值，避免往 vm 里注入字面量字符串时出错
vm.runInContext('var __now = 0; var __c1 = []; var __c2 = [];', sandbox);
function setCues(c1, c2) { vm.runInContext('__c1 = ' + JSON.stringify(c1) + '; __c2 = ' + JSON.stringify(c2 || []) + ';', sandbox); }

function run() { vm.runInContext('updateLive();', sandbox); }

function wordsIn(node) {
  const out = [];
  (function walk(n) {
    if (!n || !n.children) return;
    n.children.forEach((c) => {
      if (c.className === 'll-word') out.push(c.dataset.word || '');
      walk(c);
    });
  })(node);
  return out;
}
function find(node, cls) {
  if (!node || !node.children) return null;
  for (const c of node.children) {
    if (c.className === cls) return c;
    const d = find(c, cls);
    if (d) return d;
  }
  return null;
}

// ---------- 用例 ----------
const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '   ' + extra : ''));
}

console.log('抽取到的函数行数: wrapWords=' + fnWrapWords.split('\n').length + ', updateLive=' + fnUpdateLive.split('\n').length + '\n');

const C1 = [
  { index: 0, from: 0, to: 4, text: "I'm excellent, thank you." },
  { index: 1, from: 4, to: 8, text: 'Good. Neil, have you ever had a bad job?' }
];
const C2 = [
  { index: 0, from: 0, to: 4, text: '我很好，谢谢。' },
  { index: 1, from: 4, to: 8, text: '尼尔，你做过糟糕的工作吗？' }
];

// 1) 单语：渲染出逐词 span，且 dataset.word 剥掉标点但保留撇号
setCues(C1, []);
sandbox.cues = C1; sandbox.cues2 = [];
vm.runInContext('__now = 1; cues = __c1; cues2 = __c2;', sandbox);
run();
const main1 = find(liveEl, 'll-live-main');
const w1 = wordsIn(main1);
check('渲染出主字幕行 .ll-live-main', !!main1);
check('单词被切成 4 个可点 span', w1.length === 4, JSON.stringify(w1));
check("dataset.word 剥标点保留撇号", w1[0] === "I'm" && w1[1] === 'excellent' && w1[3] === 'you', JSON.stringify(w1));
check('加了 ll-live-on 高亮类', liveEl.classList.contains('ll-live-on'));

// 2) 同一行重复调用（模拟 timeupdate 每 250ms 一次）→ 不得重建 DOM
const replacesAfterFirst = liveEl._replaces;
for (let i = 0; i < 8; i++) run();
check('同一行重复刷新不重建 DOM（保住点击后的释义弹层）', liveEl._replaces === replacesAfterFirst,
  'replaceChildren 次数 ' + replacesAfterFirst + ' → ' + liveEl._replaces);
check('span 元素身份保持不变（未被换掉）', wordsIn(liveEl)[0] === w1[0]);

// 3) 行切换 → 必须重建，且内容随之更新
vm.runInContext('__now = 5;', sandbox);
run();
const w2 = wordsIn(liveEl);
check('切到下一行后重建并更新文本', liveEl._replaces === replacesAfterFirst + 1 && w2[1] === 'Neil');
check('新行仍是逐词可点', w2.length > 6, JSON.stringify(w2));

// 4) 双语：对照轨道也渲染成可点 span
setCues(C1, C2);
sandbox.cues = C1; sandbox.cues2 = C2; liveKeyReset();
vm.runInContext('__now = 1; cues = __c1; cues2 = __c2;', sandbox);
run();
const mainB = find(liveEl, 'll-live-main');
const sub = find(liveEl, 'll-live-sub');
check('双语：主行 .ll-live-main 仍在', !!mainB);
check('双语：对照行 .ll-live-sub 存在', !!sub);
// 英文按空格切词；中文等无空格语言整句即一个 span（与列表行为一致，不做分词）
check('双语：主行逐词可点', wordsIn(mainB).length === 4, JSON.stringify(wordsIn(mainB)));
check('双语：对照行也是可点 span', wordsIn(sub).length >= 1, JSON.stringify(wordsIn(sub)));

function liveKeyReset() { vm.runInContext('liveKey = "";', sandbox); }

// 5) 无字幕 / 当前无字幕行：给提示文案，且没有可点词
liveKeyReset();
sandbox.cues = []; sandbox.cues2 = []; vm.runInContext('cues = []; cues2 = [];', sandbox);
run();
check('无字幕时显示提示文案', /尚未加载字幕/.test(liveEl.textContent) && wordsIn(liveEl).length === 0);

liveKeyReset();
sandbox.cues = C1; sandbox.cues2 = []; vm.runInContext('cues = __c1; cues2 = [];', sandbox);
vm.runInContext('__now = -5;', sandbox);   // 时间在首条字幕之前
run();
check('当前时间无对应字幕行时给出提示', /当前无字幕行/.test(liveEl.textContent));

const failed = results.filter((r) => !r.ok);
console.log('\n结果: ' + (results.length - failed.length) + '/' + results.length + ' PASS ' + (failed.length ? '❌' : '✅'));
process.exit(failed.length ? 1 : 0);
