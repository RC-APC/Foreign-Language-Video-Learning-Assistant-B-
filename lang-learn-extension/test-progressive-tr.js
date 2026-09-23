// 回归测试：翻译**渐进式上屏**（边翻边看，不用等 200 多句全部翻完）
//
// 背景（真实诉求）：233 行字幕用大模型翻译要 1 分多钟，中间界面完全不动，
// 用户体验是"点了没反应"。现在改成：每译完一块就把已有译文写进「中文（AI 翻译）」
// 轨道并刷新，第一屏几秒内就出来，之后逐步补齐。
//
// 做法分两层：
//  ① 功能层：抽取 content.js 里真实的 planTrBatches() 跑分块调度（首块必须小、
//     覆盖必须不重不漏），并抽取 buildTranslatedCues() 验证空译文行不产生 cue。
//  ② 契约层：源码级断言"循环里每块都调了 commitTranslation"，防止有人把
//     渐进式改回"全部译完才 updateTranslatedTrack"。
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const contentJs = fs.readFileSync(path.join(DIR, 'content.js'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('没找到函数 ' + name);
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('函数 ' + name + ' 花括号不配平');
}

let pass = 0, fail = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ✓ ' + label + ' → ' + g); }
  else { fail++; console.log('  ✗ ' + label + '：期望 ' + w + '，实得 ' + g); }
}
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (detail ? '：' + detail : '')); }
}
function has(label, hay, needle) {
  if (hay.indexOf(needle) >= 0) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '：源码里找不到 ' + JSON.stringify(needle)); }
}

// ---------- ① 功能层：分块调度 ----------
console.log('— planTrBatches()：首块小、不重不漏 —');
const planSrc = extractFn(contentJs, 'planTrBatches');
const planTrBatches = new Function(planSrc + '\nreturn planTrBatches;')();

{
  const p = planTrBatches(233);
  eq('首个批次只有 8 行（首屏尽快出来）', p[0], { start: 0, end: 8 });
  eq('第二批次 20 行', p[1], { start: 8, end: 28 });
  eq('批次数量 = 1 + ceil((233-8)/20)', p.length, 1 + Math.ceil((233 - 8) / 20));
  let covered = 0, contiguous = true;
  p.forEach((b, i) => {
    covered += b.end - b.start;
    if (i > 0 && b.start !== p[i - 1].end) contiguous = false;
    if (b.end <= b.start) contiguous = false;
  });
  ok('无缝覆盖全部行', contiguous && covered === 233, '覆盖 ' + covered + ' 行，连续=' + contiguous);
  eq('末批收在总数上（不越界）', p[p.length - 1].end, 233);
}
eq('不足首块大小时只有一批（8 行以内）', planTrBatches(5), [{ start: 0, end: 5 }]);
eq('正好一块（8 行）', planTrBatches(8), [{ start: 0, end: 8 }]);
eq('空字幕不产生批次', planTrBatches(0), []);

console.log('— buildTranslatedCues()：翻到一半时只有已译行上屏 —');
const buildSrc = extractFn(contentJs, 'buildTranslatedCues');
const makeBuild = new Function('cues', buildSrc + '\nreturn buildTranslatedCues;');
{
  const cues = [
    { index: 0, from: 0, to: 2, text: 'one' },
    { index: 1, from: 2, to: 4, text: 'two' },
    { index: 2, from: 4, to: 6, text: 'three' }
  ];
  const build = makeBuild(cues);
  // 只译完第 0、2 行（典型的"翻到一半"）
  const partial = build(['一', '', '三']);
  eq('只上屏已译好的行', partial.map((c) => c.index), [0, 2]);
  eq('时间轴照抄原轨（双语才能对齐）', partial[0].from + '/' + partial[1].to, '0/6');
  eq('空白译文不算（返回空数组）', build(['', '  ', '']), []);
  const all = build(['一', '二', '三']);
  eq('全译完时 3 行齐了', all.length, 3);
  // 用户中途把主轨道切成 AI 译文轨道后，全局 cues 会变成译文本身；
  // 此时必须仍以"翻译开始时的源轨道快照"为基准，否则时间轴/行号全乱。
  const drifted = [
    { index: 0, from: 0, to: 2, text: '一' },
    { index: 1, from: 2, to: 4, text: '二' }
  ];
  const base = [
    { index: 0, from: 0, to: 2, text: 'one' },
    { index: 1, from: 2, to: 4, text: 'two' },
    { index: 2, from: 4, to: 6, text: 'three' }
  ];
  const anchored = build(['一', '', '三'], base);
  eq('以源轨道快照为基准（不随被替换的 cues 漂移）', anchored.map((c) => c.index + '@' + c.to), ['0@2', '2@6']);
  const w2 = makeBuild(drifted);
  eq('不传快照时才回退到当前 cues', w2(['一', '二', '三']).length, 2);
}

// ---------- ② 契约层：循环里必须逐块上屏 ----------
console.log('— 流式契约（源码级断言） —');
has('用 planTrBatches 规划批次', contentJs, 'const plan = planTrBatches(work.length);');
has('循环按批次切片（不再用一次性大块）', contentJs, 'const slice = work.slice(plan[bi].start, plan[bi].end);');
has('每块译完立刻 commitTranslation 上屏', contentJs, 'const n = await commitTranslation(srcIdx, key, out, !attached, srcCues);');
has('第一块负责建/挂虚拟轨道，之后只刷正文', contentJs, 'if (n) { attached = true; trProgress.ready = n; }');
has('状态栏显示进度与已上屏行数', contentJs, "' 行 · 已上屏 ' + trProgress.ready + ' 行");
has('只有"当前确实用着这条虚拟轨道"才刷对照轨（不覆盖用户自选）', contentJs, 'if (selectedTrack2 === vIdx) await selectTrack2(vIdx);');
has('诊断里能看到渐进式翻译进度', contentJs, "'渐进式翻译: 已完成 '");
has('虚拟轨道正文来自 trStore（主轨道被选为译文轨道时也要刷新）', contentJs, 'if (selectedTrack === vIdx) {');
// 半截译文不能被写进缓存，否则下次直接命中半截、永远补不齐
has('只在基本翻全时才写缓存', contentJs, 'if (!trAbort && hitCount >= work.length * 0.98) putTrCache(key, translateTarget, out);');
ok('不再无条件 putTrCache（旧写法会把半截译文永久缓存）',
  contentJs.indexOf('\n    putTrCache(key, translateTarget, out);') < 0, '仍有无条件缓存调用');
has('缓存命中要求行数完全一致', contentJs, 'cached.texts.length === src.length');

console.log('\n通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
