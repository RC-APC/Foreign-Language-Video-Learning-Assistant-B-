// 回归测试：自动暂停 / 点句复读时"停住的那一行"不能被下一句顶掉
//
// 背景：CC 字幕通常首尾相接（上一句 to === 下一句 from）。停在这一边界上时，
// 老实现「取最后一条 from<=t」会取到还没播的下一句 → 小窗里 ▶ 播的是这句、
// 🎤 却指着下一句，跟读完全对不上。
//
// 做法：**从 content.js 里抽取真实的 currentCursorCue() 源码**来跑（不是复制一份算法），
// 再对状态机那几行做源码级断言。改坏实现时这个测试会红。
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const contentJs = fs.readFileSync(path.join(DIR, 'content.js'), 'utf8');
const contentCss = fs.readFileSync(path.join(DIR, 'content.css'), 'utf8');

// ---------- 抽取真实的 currentCursorCue 函数体 ----------
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

const src = extractFn(contentJs, 'currentCursorCue');
// 把闭包里的变量（getVideo / cues / stickyPauseCue）变成参数注入
const make = new Function('getVideo', 'cues', 'stickyPauseCue', src + '\nreturn currentCursorCue;');

const A = { index: 0, from: 10, to: 12, text: 'There is a wide variety of known pollutants.' };
const B = { index: 1, from: 12, to: 14, text: 'The first are primary pollutants.' };
const CUES = [A, B];

function run(t, paused, sticky) {
  const v = { currentTime: t, paused: paused };
  const fn = make(() => v, CUES, sticky);
  const c = fn();
  return c ? c.index : null;
}

let pass = 0, fail = 0;
function eq(label, got, want) {
  if (got === want) { pass++; console.log('  ✓ ' + label + ' → ' + got); }
  else { fail++; console.log('  ✗ ' + label + '：期望 ' + want + '，实得 ' + got); }
}

console.log('— currentCursorCue() 边界行为 —');
// 1. 核心修复：停在这一句的 to（=== 下一句的 from）上，锁住的那一句优先
eq('暂停在边界 t=12.0，锁定 A', run(12.0, true, A), 0);
// 2. 没锁（老行为/连续播放语境）：会滑到下一句 B —— 记录该行为，说明锁定的必要性
eq('暂停在边界 t=12.0，未锁定 → 下一句', run(12.0, true, null), 1);
// 3. 播放中：锁定必须失效，实时行要跟随播放位置
eq('播放中 t=12.0，锁定 A → 仍跟随时间轴', run(12.0, false, A), 1);
// 4. 锁定窗口内（暂停 + 略过 to）：仍算这一句
eq('暂停在 t=12.5，锁定 A 窗口内', run(12.5, true, A), 0);
// 5. 远离锁定句：让位给时间轴
eq('暂停在 t=20，锁定 A 已过期', run(20, true, A), 1);
// 6. 锁定对象被换掉（切轨道后旧对象失效）→ 必须按时间轴重新取
const stale = { index: 0, from: 99, to: 101, text: 'stale' };
eq('锁定的是已失效对象 → 按时间轴取', run(12.0, true, stale), 1);

console.log('— 状态机（源码级断言，防改坏） —');
function has(label, hay, needle) {
  if (hay.indexOf(needle) >= 0) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '：源码里找不到 ' + JSON.stringify(needle)); }
}
has('暂停时把「刚停的那一句」重新锁上', contentJs, 'stickyPauseCue = cues.find((c) => Math.abs(c.to - at) < 0.05)');
has('恢复播放时解除锁定', contentJs, 'if (!v.paused) stickyPauseCue = null;');
has('拖动进度条时解除锁定', contentJs, "v.addEventListener('seeked', () => { stickyPauseCue = null; })");
has('点句复读会锁住该句', contentJs, 'stickyPauseCue = settings.autoPause ? cue : null;');
has('换字幕时丢弃失效的锁定对象', contentJs, 'stickyPauseCue = null;   // 字幕换了，旧的"锁住行"对象作废');

console.log('— 录音键布局（必须留在段尾，不另起一行） —');
has('文字项 flex-basis 为 0（否则长句会把按钮挤到下一行）', contentCss, 'flex: 1 1 0%;');
has('按钮对齐到文字末行', contentCss, 'align-items: flex-end;');

console.log('— 小窗跟读按钮可隐藏 —');
has('小窗开关按钮只在窗口化态显示', contentCss, '#ll-panel.ll-windowed #ll-shadow');
has('隐藏态按钮变暗', contentCss, '#ll-shadow.ll-off');
has('实时行的跟读按钮受开关控制', contentJs, "panel.classList.contains('ll-windowed') && liveShadowTools)");
has('开关写回 storage', contentJs, 'chrome.storage.sync.set({ liveShadow: liveShadowTools })');

console.log('— 诊断返回按钮必须看得见（白字白底是历史 bug） —');
has('诊断工具条按钮覆盖成浅底深字', contentCss, 'color: #1f2329;');
has('诊断工具条按钮有独立背景', contentCss, 'background: #e9ecef;');

console.log('\n通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
