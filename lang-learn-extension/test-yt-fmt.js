// 验证 YouTube 字幕正文三种格式（JSON3 / WebVTT / XML）都能解析成统一的 cues
// 逻辑与 content.js 中 parseYtTextPayload / parseVtt / detectYtFmt / ytUrlWithFmt 保持一致

function ytUrlWithFmt(url, fmt) {
  if (!fmt) return url;
  let u = url.replace(/[?&]fmt=[^&]*/g, '');
  u += (u.indexOf('?') >= 0 ? '&' : '?') + 'fmt=' + fmt;
  return u;
}
function detectYtFmt(text) {
  const t = (text || '').trim();
  if (!t) return 'empty';
  if (t[0] === '{') return 'json3';
  if (/^WEBVTT/i.test(t) || t.indexOf('-->') >= 0) return 'vtt';
  if (t.indexOf('<text') >= 0) return 'xml';
  return 'other:' + t.slice(0, 24);
}
function parseVtt(text) {
  const cues = [];
  const blocks = text.replace(/\r/g, '').split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    let tsLine = -1;
    for (let i = 0; i < lines.length; i++) if (lines[i].indexOf('-->') >= 0) { tsLine = i; break; }
    if (tsLine < 0) continue;
    const m = lines[tsLine].match(/(\d+):(\d+):(\d+)[.,](\d+)\s*-->\s*(\d+):(\d+):(\d+)[.,](\d+)/);
    if (!m) continue;
    const toSec = (h, mi, s, ms) => (+h * 3600 + +mi * 60 + +s + +ms / 1000);
    const from = toSec(m[1], m[2], m[3], m[4]);
    const to = toSec(m[5], m[6], m[7], m[8]);
    const txt = lines.slice(tsLine + 1).join(' ').replace(/\s+/g, ' ').trim();
    if (!txt) continue;
    cues.push({ index: cues.length, from: from, to: to, text: txt });
  }
  return cues;
}
function parseYtTextPayload(text) {
  const t = (text || '').trim();
  if (!t) return { cues: [], fmt: 'empty' };
  if (t[0] === '{') {
    try {
      const j = JSON.parse(t);
      const events = j.events || [];
      const cues = [];
      for (const ev of events) {
        const segs = ev.segs || [];
        const txt = segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
        if (!txt) continue;
        const start = (Number(ev.tStartMs) || 0) / 1000;
        const dur = (Number(ev.dDurationMs) || 0) / 1000;
        cues.push({ index: cues.length, from: start, to: start + dur, text: txt });
      }
      return { cues: cues, fmt: 'json3' };
    } catch (e) { /* 落到后续格式 */ }
  }
  if (/^WEBVTT/i.test(t) || t.indexOf('-->') >= 0) {
    return { cues: parseVtt(t), fmt: 'vtt' };
  }
  try {
    const doc = new DOMParser().parseFromString(t, 'text/xml');
    const texts = doc.getElementsByTagName('text');
    if (texts && texts.length) {
      const cues = [];
      for (let i = 0; i < texts.length; i++) {
        const te = texts[i];
        const start = parseFloat(te.getAttribute('start')) || 0;
        const dur = parseFloat(te.getAttribute('dur')) || 0;
        const txt = (te.textContent || '').replace(/\s+/g, ' ').trim();
        if (!txt) continue;
        cues.push({ index: cues.length, from: start, to: start + dur, text: txt });
      }
      return { cues: cues, fmt: 'xml' };
    }
  } catch (e) { /* ignore */ }
  return { cues: [], fmt: 'unknown' };
}

// ---- 最小 DOMParser 桩（支持 <text start= dur=>，并像浏览器一样解码 HTML 实体） ----
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
global.DOMParser = class {
  parseFromString(str) {
    const items = [];
    const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
    let m;
    while ((m = re.exec(str))) {
      const attrs = m[1];
      const inner = m[2];
      const g = (name) => {
        const a = attrs.match(new RegExp(name + '="([^"]*)"'));
        return a ? a[1] : null;
      };
      items.push({
        _start: g('start'),
        _dur: g('dur'),
        // 模拟浏览器 textContent：剥掉内部标签 + 解码实体
        textContent: decodeEntities(inner.replace(/<[^>]+>/g, '')),
        getAttribute(n) { return n === 'start' ? this._start : n === 'dur' ? this._dur : null; }
      });
    }
    return {
      getElementsByTagName: (tag) => (tag === 'text' ? items : [])
    };
  }
};

// ---- 三份仿真 payload ----
const json3 = JSON.stringify({
  wireMagic: 'pb3',
  events: [
    { tStartMs: 0, dDurationMs: 1200, segs: [{ utf8: 'Good. ' }, { utf8: 'Neil, have you ever had' }] },
    { tStartMs: 1200, dDurationMs: 900, segs: [{ utf8: 'a bad or difficult job?' }] },
    { tStartMs: 3000, dDurationMs: 100, segs: [{ utf8: '\n' }] }, // 纯换行 → 应被跳过
    { tStartMs: 4200, dDurationMs: 1500, segs: [{ utf8: "I'm excellent, thank you." }] }
  ]
});
const vtt = 'WEBVTT\n\n' +
  '00:00:00.000 --> 00:00:01.200\nGood. Neil, have you ever had\n\n' +
  '00:00:01.200 --> 00:00:02.100\na bad or difficult job?\n\n' +
  '00:00:04.200 --> 00:00:05.700\nI\'m excellent, thank you.\n';
const xml = '<transcript>' +
  '<text start="0" dur="1.2">Good. Neil, have you ever had</text>' +
  '<text start="1.2" dur="0.9">a bad or difficult job?</text>' +
  '<text start="4.2" dur="1.5"><font color="#fff">I&#39;m excellent, thank you.</font></text>' +
  '</transcript>';

const rj = parseYtTextPayload(json3);
const rv = parseYtTextPayload(vtt);
const rx = parseYtTextPayload(xml);

console.log('--- 格式探测 ---');
console.log('json3 →', detectYtFmt(json3), '| vtt →', detectYtFmt(vtt), '| xml →', detectYtFmt(xml));
console.log('\n--- JSON3 ---', rj.fmt, '行数', rj.cues.length);
console.log(JSON.stringify(rj.cues));
console.log('\n--- VTT ---', rv.fmt, '行数', rv.cues.length);
console.log(JSON.stringify(rv.cues));
console.log('\n--- XML ---', rx.fmt, '行数', rx.cues.length);
console.log(JSON.stringify(rx.cues));

// ---- 断言 ----
const okA = rj.fmt === 'json3' && rj.cues.length === 3 && rj.cues[0].text === 'Good. Neil, have you ever had' && rj.cues[0].from === 0 && rj.cues[0].to === 1.2;
const okB = rv.fmt === 'vtt' && rv.cues.length === 3 && rv.cues[2].text === "I'm excellent, thank you." && Math.abs(rv.cues[2].from - 4.2) < 1e-6;
const okC = rx.fmt === 'xml' && rx.cues.length === 3 && rx.cues[2].text === "I'm excellent, thank you.";
const okD = ytUrlWithFmt('https://x/api/timedtext?lang=en&v=abc', 'json3') === 'https://x/api/timedtext?lang=en&v=abc&fmt=json3';
const okE = ytUrlWithFmt('https://x/api/timedtext?v=abc&fmt=xml', 'vtt') === 'https://x/api/timedtext?v=abc&fmt=vtt';

console.log('\n1) JSON3 解析(3行/时间/文本)   :', okA);
console.log('2) VTT   解析(3行/时间/文本)   :', okB);
console.log('3) XML   解析(剥 font 标签)    :', okC);
console.log('4) ytUrlWithFmt 追加 fmt       :', okD);
console.log('5) ytUrlWithFmt 替换旧 fmt     :', okE);
console.log('结果:', (okA && okB && okC && okD && okE) ? 'PASS ✅' : 'FAIL ❌');
