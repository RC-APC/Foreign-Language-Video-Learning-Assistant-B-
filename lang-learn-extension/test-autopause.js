// 回归测试：自动暂停「开了但不暂停」
//
// 背景（真实故障）：打开「暂停：开」后视频从不自动停。
// 根因有两层：
//   1) 老实现把自动暂停写在 timeupdate 回调里，而 YouTube 的 video 元素是 JS 动态建立的、
//      还可能被 SPA 换掉 —— 初始化时 video 不存在就 wireVideo() 直接 return，事件永远不挂，
//      自动暂停（以及高亮/实时行）一起静默失效。
//   2) 老实现每帧都用「当前行的 to」重设目标；YouTube 自动生成字幕常把同一句拆成多条、
//      to 逐条往后延伸，于是目标一直被往前推、永远追不上 → 看起来就是"从不暂停"。
//
// 做法：**抽取 content.js 里真实的 autoPauseTick() / currentCursorCue() 源码**来跑
// （不是复制一份算法），闭包变量替换成注入的状态对象，改动实现会立刻让这个测试变红。
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

// 闭包里的可变状态 → st.xxx（保证逻辑是真的，状态隔离是自己拼的）
// ⚠️ 新增闭包变量（比如后来的 pendingPauseCue）时必须同时补上这里的替换规则，
// 否则抽取出来的源码里会留下未声明的自由变量 → 'use strict' 下访问即 ReferenceError，
// 而 node --check 是抓不到的（自由变量本身语法合法）。
function toClosure(src) {
  return src
    .replace(/\bpendingPauseCue\b/g, 'st.pendingPauseCue')
    .replace(/\bpendingPauseAt\b/g, 'st.pendingPauseAt')
    .replace(/\blastAutoPauseTo\b/g, 'st.lastAutoPauseTo')
    .replace(/\bstickyPauseCue\b/g, 'st.stickyPauseCue')
    .replace(/\bseekGuardUntil\b/g, 'st.seekGuardUntil')
    .replace(/\bautoPauseInfo\b/g, 'st.autoPauseInfo')
    .replace(/\bactiveRecorder\b/g, 'st.activeRecorder');
}
const toClosure2 = toClosure;

const combined = toClosure(extractFn(contentJs, 'currentCursorCue')) + '\n' +
  toClosure2(extractFn(contentJs, 'autoPauseTick')) + '\n' +
  // 自动暂停的"这一句实际播到哪"：把暂停点从 cue.to 收紧到下一句起点
  extractFn(contentJs, 'normCueText') + '\n' +
  extractFn(contentJs, 'isCueContinuation') + '\n' +
  extractFn(contentJs, 'effectiveCueEnd');
// 自保：产物里不该再有任何未替换的闭包变量（前端"漏加替换规则"的坑就抓在编译前）。
// 用负向后顾排除已经替换好的 `st.xxx`（`.` 本身是词边界，光用 \b 会把 st.xxx 也认成未替换）。
['pendingPauseAt', 'pendingPauseCue', 'lastAutoPauseTo', 'stickyPauseCue', 'seekGuardUntil', 'autoPauseInfo', 'activeRecorder']
  .forEach((v) => {
    if (new RegExp('(?<!st\\.)\\b' + v + '\\b').test(combined)) {
      console.error('✗ 闭包变量未替换：' + v + '（请在 toClosure 里补规则）');
      process.exit(1);
    }
  });
console.log('  ✓ 闭包变量替换自检通过（7/7）');
const factory = new Function('getVideo', 'cues', 'settings', 'st',
  combined + '\nreturn { tick: autoPauseTick, cur: currentCursorCue, end: effectiveCueEnd };');

function makeWorld(cues, opts) {
  opts = opts || {};
  const st = {
    pendingPauseAt: null, pendingPauseCue: null, lastAutoPauseTo: null, stickyPauseCue: null,
    seekGuardUntil: 0, autoPauseInfo: null, activeRecorder: null
  };
  const v = { currentTime: 0, paused: false, pauseCount: 0 };
  v.pause = () => { v.paused = true; v.pauseCount++; };
  v.play = () => { v.paused = false; };
  const settings = { autoPause: opts.autoPause !== false };
  const api = factory(() => v, cues, settings, st);
  return { v: v, st: st, settings: settings, tick: api.tick, cur: api.cur, end: api.end };
}

let pass = 0, fail = 0;
function eq(label, got, want) {
  if (got === want) { pass++; console.log('  ✓ ' + label + ' → ' + JSON.stringify(got)); }
  else { fail++; console.log('  ✗ ' + label + '：期望 ' + JSON.stringify(want) + '，实得 ' + JSON.stringify(got)); }
}
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (detail ? '：' + detail : '')); }
}

// ---------- 用例 1：普通轨道（一句一条，首尾相接） ----------
console.log('— 普通字幕轨：播到句尾就停 —');
{
  const cues = [
    { index: 0, from: 0, to: 3, text: 'a' },
    { index: 1, from: 3, to: 6, text: 'b' },
    { index: 2, from: 6, to: 9, text: 'c' }
  ];
  const w = makeWorld(cues);
  w.v.currentTime = 1.0; w.tick();
  eq('播放中自动武装到本句句尾', w.st.pendingPauseAt, 3);
  w.v.currentTime = 2.9; w.tick();
  eq('未到句尾不停', w.v.pauseCount, 0);
  w.v.currentTime = 3.0; w.tick();
  eq('到句尾暂停一次', w.v.pauseCount, 1);
  eq('暂停后目标清空', w.st.pendingPauseAt, null);
  eq('并锁住"刚停的那一句"', w.st.stickyPauseCue && w.st.stickyPauseCue.index, 0);
  // 用户继续播放：应重新武装到下一句句尾，而不是立刻又暂停
  w.v.play(); w.v.currentTime = 3.0; w.tick();
  eq('续播时武装下一句句尾', w.st.pendingPauseAt, 6);
  eq('续播不会立刻暂停', w.v.pauseCount, 1);
}

// ---------- 用例 2：滚动式字幕（同一句拆多条、to 逐条往后推）★ 核心回归 ----------
console.log('— 滚动式字幕轨（YouTube 自动生成常见）：目标不能被一直往前推 —');
{
  // 每条 to = from + 5，from 随词推进 → 老的"每帧重设目标"会把目标永远推到 5s 之外
  const cues = [];
  for (let i = 0; i < 40; i++) cues.push({ index: i, from: i * 0.1, to: i * 0.1 + 5, text: 'w' + i });
  const w = makeWorld(cues);
  let paused = 0;
  for (let k = 0; k <= 60; k++) {          // t 从 0 走到 6.0s，每 0.1s 一次 tick
    w.v.currentTime = k * 0.1;
    w.tick();
    if (w.st.autoPauseInfo) { paused++; w.st.autoPauseInfo = null; w.v.play(); }
  }
  ok('滚动的 to 不会让目标无限后移（最终确实停下来了）', paused >= 1, '暂停 ' + paused + ' 次，目标 ' + w.st.pendingPauseAt);
}
{
  // 同一句的三条子事件 to 完全一样（另一种常见编码）：应停在句子末尾
  const cues = [
    { index: 0, from: 0, to: 5, text: 'There is' },
    { index: 1, from: 1, to: 5, text: 'There is a wide' },
    { index: 2, from: 2, to: 5, text: 'There is a wide variety of known pollutants.' }
  ];
  const w = makeWorld(cues);
  w.v.currentTime = 0.5; w.tick();
  eq('武装到句子真正的结束时间', w.st.pendingPauseAt, 5);
  w.v.currentTime = 4.8; w.tick();
  eq('句中不停', w.v.pauseCount, 0);
  w.v.currentTime = 5.0; w.tick();
  eq('句尾停住', w.v.pauseCount, 1);
}

// ---------- 用例 2c：to 越界到下一句里 ★ 「点一句、读两句才停」 ----------
console.log('— 结束点越界（ASR 分段与人耳句子不一致）→ 收紧到下一句起点 —');
{
  const cues = [
    { index: 0, from: 0, to: 8, text: 'First sentence.' },      // to 越界：一直标到 8s
    { index: 1, from: 3.0, to: 8, text: 'Second sentence.' }    // 但下一句 3.0s 就开口了
  ];
  const w = makeWorld(cues);
  eq('越界的 to 被收紧到下一句起点', w.end(cues[0], cues), 3);
  const w2 = makeWorld(cues);
  w2.v.currentTime = 0.5; w2.tick();
  eq('武装的是收紧后的结束点', w2.st.pendingPauseAt, 3);
  w2.v.currentTime = 2.0; w2.tick();
  eq('本句播完之前不停', w2.v.pauseCount, 0);
  w2.v.currentTime = 3.0; w2.tick();
  eq('到收紧后的结束点就停（不再读下一句）', w2.v.pauseCount, 1);
  // 收紧后暂停点不再等于任何一行的 to → 必须仍能锁住"刚听完的那一句"
  eq('暂停后锁住的仍是第 0 行', w2.st.stickyPauseCue && w2.st.stickyPauseCue.index, 0);
}
{
  // 反向：同句累积事件（后一条包含前一条）不能被当成"下一句"而提前截断
  const cues = [
    { index: 0, from: 0, to: 5, text: 'There is' },
    { index: 1, from: 1, to: 5, text: 'There is a wide variety' }
  ];
  const w = makeWorld(cues);
  eq('同句累积事件不截断（仍播到 5s）', w.end(cues[0], cues), 5);
}
{
  // 普通 CC（一句一条、首尾相接）：收紧后完全不变，行为与老版本一致
  const cues = [
    { index: 0, from: 0, to: 3, text: 'alpha beta' },
    { index: 1, from: 3, to: 6, text: 'gamma delta' }
  ];
  const w = makeWorld(cues);
  eq('普通轨道不受影响', w.end(cues[0], cues), 3);
}

// ---------- 用例 3：目标已过期时不武装（防止一按 ▶ 立刻暂停） ----------
console.log('— 防止"一按播放就立刻暂停" —');
{
  const cues = [{ index: 0, from: 0, to: 3, text: 'a' }];
  const w = makeWorld(cues);
  w.v.currentTime = 10;    // 已经在所有字幕之后
  w.tick();
  eq('位置已过句尾 → 不武装', w.st.pendingPauseAt, null);
  eq('也不会暂停', w.v.pauseCount, 0);
}
{
  const cues = [{ index: 0, from: 0, to: 3, text: 'a' }, { index: 1, from: 3, to: 6, text: 'b' }];
  const w = makeWorld(cues);
  w.st.seekGuardUntil = Date.now() + 900;   // shadow() 刚发出 seek，currentTime 还是旧值
  w.v.currentTime = 5.9;                     // 旧值已越过目标
  w.st.pendingPauseAt = 3;
  w.tick();
  eq('seek 保护期内不判定到达', w.v.pauseCount, 0);
}

// ---------- 用例 4：开关 / 录音期间 ----------
console.log('— 开关与录音 —');
{
  const cues = [{ index: 0, from: 0, to: 3, text: 'a' }];
  let w = makeWorld(cues, { autoPause: false });
  w.v.currentTime = 1; w.tick(); w.v.currentTime = 3.5; w.tick();
  eq('「暂停：关」时不武装也不停', w.v.pauseCount + '/' + w.st.pendingPauseAt, '0/null');
  w = makeWorld(cues);
  w.st.activeRecorder = {};                  // 录音中不打断
  w.v.currentTime = 1; w.tick(); w.v.currentTime = 3.5; w.tick();
  eq('录音期间不自动暂停', w.v.pauseCount, 0);
}

// ---------- 用例 5：源码级断言，防改坏 ----------
console.log('— 状态机（源码级断言） —');
function has(label, hay, needle) {
  if (hay.indexOf(needle) >= 0) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '：源码里找不到 ' + JSON.stringify(needle)); }
}
has('目标只武装一次，且拒绝"已经过期"的目标', contentJs, 'if (cur && end > v.currentTime + 0.05) { pendingPauseAt = end; pendingPauseCue = cur; lastAutoPauseTo = end; }');
has('自动暂停的目标用 effectiveCueEnd 收紧过（不然会读两句才停）', contentJs, 'const end = cur ? effectiveCueEnd(cur) : 0;');
has('点句复读也用收紧后的结束点', contentJs, 'pendingPauseAt = settings.autoPause ? effectiveCueEnd(cue) : null;');
has('暂停时优先用武装时记下的那一行做锁定（收紧后按时间反查会失手）', contentJs, 'stickyPauseCue = (wasCue && cues[wasCue.index] === wasCue) ? wasCue');
ok('旧的"每帧按当前行 to 重设目标"已移除（这就是不暂停的根因）',
  contentJs.indexOf('cur.to !== lastAutoPauseTo') < 0, '源码里仍有该行');
has('自动暂停有独立兜底时钟（不依赖 timeupdate）', contentJs, 'setInterval(autoPauseTick, 150)');
has('timeupdate 也会驱动自动暂停（响应更快）', contentJs, 'autoPauseTick();');
has('video 元素定时自愈重挂', contentJs, 'setInterval(ensureVideoWired, 1000)');
has('元素变了或未挂上就重挂', contentJs, 'if (v !== wiredEl || !videoWired)');
has('shadow() 后有 seek 保护期', contentJs, 'seekGuardUntil = Date.now() + 900;');
has('seek 落地解除保护期', contentJs, 'seekGuardUntil = 0;');
has('诊断里能看到自动暂停状态', contentJs, "'自动暂停: '");
has('诊断里能看到事件是否挂上', contentJs, "'video 事件已挂: '");
has('诊断里能看到字幕时间轴重叠情况', contentJs, '字幕时间轴: 共 ');

console.log('\n通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
