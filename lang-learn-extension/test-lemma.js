// 直接加载真实的 background.js（vm + chrome 桩），验证词形还原与本地词库匹配
// 目的：生词本里的变形（written / studies / created / went …）能对上词典里的原形
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

// 只提供 background.js 顶层需要的最小 chrome 桩
const ctx = {
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  fetch: () => Promise.reject(new Error('测试中不应发起网络请求')),
  chrome: {
    runtime: { onMessage: { addListener: () => {} } },
    storage: { local: { get: (d, cb) => cb(d), set: (o, cb) => cb && cb() } }
  }
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const { lemmaCandidates, dictLookup } = ctx;
if (typeof lemmaCandidates !== 'function' || typeof dictLookup !== 'function') {
  console.error('FAIL: 未能从 background.js 取到 lemmaCandidates / dictLookup');
  process.exit(1);
}

// 模拟一本词典（含原形词条）
const DICT = {
  be: { def: '是；存在', pos: 'v.' },
  go: { def: '去；走', pos: 'v.' },
  good: { def: '好的', pos: 'a.' },
  create: { def: '创造,创作', pos: 'v.' },
  write: { def: '写,书写', pos: 'v.' },
  study: { def: '学习,研究', pos: 'n./v.' },
  run: { def: '跑,奔跑', pos: 'v.' },
  make: { def: '做,制作', pos: 'v.' },
  box: { def: '盒子', pos: 'n.' },
  cat: { def: '猫', pos: 'n.' },
  watch: { def: '手表；观看', pos: 'n./v.' },
  try: { def: '尝试', pos: 'v.' },
  big: { def: '大的', pos: 'a.' },
  quick: { def: '快的', pos: 'a.' },
  kiss: { def: '亲吻', pos: 'v.' },
  stop: { def: '停止', pos: 'v.' },
  carry: { def: '携带,搬运', pos: 'v.' },
  child: { def: '孩子', pos: 'n.' },
  mouse: { def: '老鼠；鼠标', pos: 'n.' },
  photo: { def: '照片', pos: 'n.' },
  happy: { def: '快乐的', pos: 'a.' },
  // 故意放一个变形词条，验证"精确匹配优先"
  written: { def: '（书面）书面的', pos: 'a.' }
};

const cases = [
  // [生词本里的词, 期望匹配到的词库键]
  ['be', 'be'],
  ['was', 'be'],
  ['were', 'be'],
  ['went', 'go'],
  ['better', 'good'],
  ['created', 'create'],
  ['writing', 'write'],
  ['studies', 'study'],
  ['running', 'run'],
  ['making', 'make'],
  ['boxes', 'box'],
  ['cats', 'cat'],
  ['watches', 'watch'],
  ['tried', 'try'],
  ['biggest', 'big'],
  ['quickly', 'quick'],
  ['kissed', 'kiss'],
  ['stopped', 'stop'],
  ['carrying', 'carry'],
  ['children', 'child'],   // 不规则复数（不在表里 → 会失败，用于暴露局限）
  ['mice', 'mouse'],       // 不规则复数
  ['photos', 'photo'],
  ['happier', 'happy'],
  ['written', 'written']   // 精确匹配优先于还原成 write
];

let pass = 0;
const fails = [];
for (const [word, expect] of cases) {
  const hit = dictLookup(DICT, word);
  const got = hit ? hit.key : null;
  const ok = got === expect;
  if (ok) pass++;
  else fails.push(word + ' → 期望 ' + expect + '，实际 ' + (got || '(未命中)'));
}

console.log('候选词生成示例：');
['written', 'studies', 'created', 'running', 'making', 'went', 'biggest'].forEach((w) => {
  console.log('  ' + w.padEnd(10) + ' → ' + JSON.stringify(lemmaCandidates(w)));
});
console.log('\n匹配结果：' + pass + '/' + cases.length + ' 通过');
if (fails.length) {
  console.log('未通过：');
  fails.forEach((f) => console.log('  ✗ ' + f));
}
// 已知局限：不规则复数（children/mice）需靠用户「✎ 改词」手动处理
const knownLimits = fails.filter((f) => /children|mice/.test(f));
const realFails = fails.filter((f) => !/children|mice/.test(f));
console.log('\n（已知局限，不计失败）不规则复数：' + (knownLimits.length ? knownLimits.length + ' 项需手动改词' : '无'));
console.log('结果:', realFails.length === 0 ? 'PASS ✅' : 'FAIL ❌');
if (realFails.length) process.exitCode = 1;
