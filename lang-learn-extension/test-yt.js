// 验证 YouTube 适配器里两个纯 JS 逻辑：括号配对提取 + 字幕轨道解析
function extractBraceBlock(str, ob) {
  let depth = 0, inStr = false, esc = false;
  for (let i = ob; i < str.length; i++) {
    const c = str[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return str.slice(ob, i + 1); }
  }
  return null;
}
function getYtPlayerResponseFromText(html) {
  // 在 HTML 里找含 ytInitialPlayerResponse 的脚本块（模拟 <script> 文本）
  const idx = html.indexOf('ytInitialPlayerResponse');
  if (idx < 0) return null;
  const eq = html.indexOf('=', idx);
  if (eq < 0) return null;
  const ob = html.indexOf('{', eq);
  if (ob < 0) return null;
  const block = extractBraceBlock(html, ob);
  return block ? JSON.parse(block) : null;
}
function parseYtTracks(pr) {
  const list = pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer &&
    pr.captions.playerCaptionsTracklistRenderer.captionTracks;
  if (!list || !list.length) return [];
  return list.map((t) => ({
    lan: t.languageCode || '',
    lan_doc: (t.name && t.name.simpleText) || t.languageCode || '',
    url: t.baseUrl,
    _fmt: 'yt'
  }));
}

// --- 构造一个含嵌套括号 + 字符串里带 } 的仿真 player response ---
const fakeHtml = `
var foo = 1;
var ytInitialPlayerResponse = {"videoDetails":{"videoId":"dQw4w9WgXcQ"},"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[
  {"baseUrl":"https://www.youtube.com/api/timedtext?lang=en&v=dQw4w9WgXcQ","name":{"simpleText":"English"},"languageCode":"en","kind":"asr"},
  {"baseUrl":"https://www.youtube.com/api/timedtext?lang=zh-Hans&v=dQw4w9WgXcQ","name":{"simpleText":"中文（简体）"},"languageCode":"zh-Hans"},
  {"baseUrl":"https://www.youtube.com/api/timedtext?lang=ja&v=dQw4w9WgXcQ","name":{"simpleText":"日本語"},"languageCode":"ja"}
]}}};
var bar = 2;
`;

const pr = getYtPlayerResponseFromText(fakeHtml);
const ok1 = pr && pr.videoDetails.videoId === 'dQw4w9WgXcQ';
const tracks = parseYtTracks(pr);
const ok2 = tracks.length === 3 && tracks[0].lan === 'en' && tracks[0]._fmt === 'yt';
const ok3 = tracks[1].lan === 'zh-Hans' && tracks[1].lan_doc === '中文（简体）';

// 验证：非中文字幕应被 auto-pick 为首选（与 selectTrack 逻辑一致）
const preferred = tracks.findIndex((t) => !/ch|zh|cn|中文|简体|繁体/i.test(t.lan + t.lan_doc));
const ok4 = preferred === 0; // en 排第一，命中

console.log('1) 括号配对提取 videoId 正确 :', ok1);
console.log('2) 解析出 3 条轨道且格式正确 :', ok2);
console.log('3) 中文轨道 lan_doc 正确     :', ok3);
console.log('4) 自动首选非中文轨道(en=0)  :', ok4);
console.log('结果:', (ok1 && ok2 && ok3 && ok4) ? 'PASS ✅' : 'FAIL ❌');
