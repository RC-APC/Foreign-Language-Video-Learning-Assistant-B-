// 验证 v0.7.17 parsePlainDict 修复：用真实词典文件跑一遍，检查是否还有错位/脏词条
'use strict';
const fs = require('fs');

const FILE = 'D:/新药申请/英语词典.txt';

// ---- 与 vocab.js 保持一致的新逻辑 ----
function parsePlainDict(text) {
  const POS_ONE = '(a|ad|adj|adv|n|v|vt|vi|prep|conj|pron|int|art|num|abbr|aux|det|excl|phr|pl|sing|inf|pref|suf|comb)';
  const POS = new RegExp('^(?!(?:a\\.m\\.|p\\.m\\.|am|pm)(?=\\s|$))' + POS_ONE + '\\.(?:\\s*&\\s*' + POS_ONE + '\\.)*\\s*', 'i');
  const POS_CHAIN = new RegExp('^' + POS_ONE + '\\.(?:\\s*&\\s*' + POS_ONE + '\\.)*\\s*', 'i');
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const cleanBr = (s) => s
    .replace(/<br\s*\/?>/gi, '；')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/；\s*；+/g, '；')
    .replace(/[；\s]+$/g, '')
    .trim();
  const isHeadword = (w) => {
    if (!/^[A-Za-z][A-Za-z\-'.\/ ]*$/.test(w)) return false;
    if (/[()（）=，,；;""\"]/.test(w)) return false;
    return w.length <= 40;
  };
  const entries = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(POS);
    if (m) {
      if (!cur) continue;
      const rest = cleanBr(line.slice(m[0].length).replace(/^[:：]\s*/, '').trim());
      if (rest) cur.defs.push(rest);
    } else {
      let w = cleanBr(line);
      if (!w) continue;
      if (/^(a|ad|adj|adv|n|v|vt|vi|prep|conj|pron|int|art|num|abbr|aux|det|excl|phr)\.$/i.test(w)) continue;
      const ph = w.match(/\s*(\/[^/]+\/|\[[^\]]*\])$/);
      if (ph) w = w.slice(0, ph.index).trim();
      if (isHeadword(w)) {
        cur = { word: w, defs: [] };
        entries.push(cur);
      } else if (cur) {
        cur.defs.push(cleanBr(w.replace(POS_CHAIN, '')));
      }
    }
  }
  return entries
    .filter((e) => e.defs.length)
    .map((e) => ({ word: e.word, pos: '', def: e.defs.join('； ') }));
}

// ---- 主流程 ----
const buf = fs.readFileSync(FILE);
let text;
if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) text = buf.toString('utf8');
else {
  text = buf.toString('utf8');
  if (text.includes('\uFFFD')) text = new TextDecoder('gbk').decode(buf);
}

const entries = parsePlainDict(text);
console.log('总词条数:', entries.length);

// 脏词条检测：单词列不该再出现中文、括号、引号、=、分号
const bad = entries.filter((e) => /[\u4e00-\u9fff()（）=；;""]|<br/i.test(e.word));
console.log('单词列含中文/括号/引号的脏词条:', bad.length);
if (bad.length) console.log('样例:', bad.slice(0, 5));

const brDef = entries.filter((e) => /<br/i.test(e.def));
console.log('释义含 <br> 残留:', brDef.length);

// 组合词性前缀残留检测（如 "&ad." / "&a." 漏进释义）
const ampDef = entries.filter((e) => /&\s*(?:a|ad|adj|adv|n|v|vt|vi|prep|conj|pron|int|art|num|abbr|aux|det|excl|phr)\./i.test(e.def));
console.log('释义含 "&词性." 残留:', ampDef.length);
if (ampDef.length) console.log('样例:', ampDef.slice(0, 5));

// 关键词抽查（之前错位的词）
for (const w of ['thumbtack', 'highjack', 'automobile', 'high school', 'or', 'nand', 'nor']) {
  const hit = entries.find((e) => e.word.toLowerCase() === w);
  console.log('-', w, '=>', hit ? hit.def.slice(0, 60) : '(未收录)');
}

// 错位检测：词条释义不应该以下一个词条的英文单词开头（旧 bug 的特征）
let shifted = 0;
const wordSet = new Set(entries.map((e) => e.word.toLowerCase()));
for (const e of entries) {
  const first = e.def.split('；')[0].trim();
  if (/^[a-z][a-z\- ]{2,20}$/.test(first) && wordSet.has(first.toLowerCase())) shifted++;
}
console.log('疑似错位词条（释义=下一词条单词）:', shifted);
