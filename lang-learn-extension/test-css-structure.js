/**
 * CSS 结构体检
 * ------------------------------------------------------------
 * 起因：改「逗号分隔的多选择器组」时，只替换了组里最后一行
 *       （`#a,\n#b,\n#c { display:none !important }` 只换了 `#c {...}` 那行），
 *       前面的 `#b,` 就成了悬挂逗号，把 `#a,#b` 一起并进了新规则的声明块
 *       —— 结果「该隐藏的元素全变成 display:block」，而且剥掉注释后语法完全合法，
 *       node --check / JSON.parse / 浏览器控制台都不报错，肉眼极难发现。
 *
 * 本脚本检查四类结构性事故：
 *   1. 花括号配平
 *   2. 注释夹在选择器列表内部（上面那类事故的直接指纹）
 *   3. 空选择器段（`,{` / `,,` / 以逗号结尾的选择器组）
 *   4. 选择器组首尾有空白/换行导致的 ` ,` 之类
 *
 * 用法：node test-css-structure.js [content.css 路径]
 */
const fs = require('fs');
const path = require('path');

function audit(css) {
  const issues = [];
  let i = 0, depth = 0, buf = '', line = 1;
  let inComment = false, quote = null;
  let commentStartLine = 0;

  while (i < css.length) {
    const c = css[i], n = css[i + 1];
    if (c === '\n') line++;

    if (inComment) {
      if (c === '*' && n === '/') {
        inComment = false; i += 2; continue;
      }
      i++; continue;
    }
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }
    if (c === '/' && n === '*') {
      // 关键判据：注释出现在「正在累积的选择器串」中间 → 注释污染了选择器列表
      if (depth === 0 && buf.trim()) {
        issues.push({ type: '注释夹在选择器列表内', line: line, ctx: buf.trim().slice(-60) });
      }
      inComment = true; commentStartLine = line; i += 2; continue;
    }
    if (c === '"' || c === "'") { quote = c; i++; continue; }
    if (c === '{') {
      const sel = buf.replace(/\s+/g, ' ').trim();
      if (depth === 0) {
        if (!sel) issues.push({ type: '空规则（没有选择器就出现 {）', line: line });
        const parts = sel.split(',').map((s) => s.trim());
        if (parts.some((p) => p === '')) {
          issues.push({ type: '选择器组里有空段（悬挂逗号）', line: line, ctx: sel.slice(0, 80) });
        }
      }
      depth++; buf = ''; i++; continue;
    }
    if (c === '}') {
      depth--; buf = ''; i++; continue;
    }
    if (depth === 0) buf += c;
    i++;
  }

  if (depth !== 0) issues.push({ type: '花括号不配平（depth=' + depth + '）', line: css.split('\n').length });
  if (inComment) issues.push({ type: '注释未闭合', line: commentStartLine });

  // 统计规则数，用于确认文件被完整解析
  const ruleCount = (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/\{/g) || []).length;
  return { issues, ruleCount };
}

// ---------- 自测：确保体检器真的能抓到那类事故 ----------
const BAD = `
#p.x #a,
#p.x #b,
/* 注释夹在选择器列表里 —— 就是这次的事故形态 */
#p.x #c.on {
  display: block;
  position: static;
}
`;
const GOOD = `
#p.x #a,
#p.x #b,
#p.x #c {
  display: none !important;
}
#p.x #c.on {
  display: block;
}
`;
const badRes = audit(BAD);
const goodRes = audit(GOOD);
const selfOk = badRes.issues.length > 0 && goodRes.issues.length === 0;
console.log('体检器自测: ' + (selfOk ? 'PASS ✅' : 'FAIL ❌') +
  '  (坏样本报 ' + badRes.issues.length + ' 项，好样本报 ' + goodRes.issues.length + ' 项)');
badRes.issues.forEach((it) => console.log('    坏样本命中 → ' + it.type));

const target = process.argv[2] || path.join(__dirname, 'content.css');
const css = fs.readFileSync(target, 'utf8');
const res = audit(css);
console.log('\n文件: ' + path.basename(target) + '（解析到 ' + res.ruleCount + ' 条规则）');
if (!res.issues.length) {
  console.log('结构检查: 0 项问题 ✅');
} else {
  console.log('结构检查: ' + res.issues.length + ' 项问题 ❌');
  res.issues.forEach((it) => console.log('  L' + it.line + '  ' + it.type + (it.ctx ? '   … ' + it.ctx : '')));
}
process.exit(selfOk && !res.issues.length ? 0 : 1);
