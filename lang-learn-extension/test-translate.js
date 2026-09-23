// 验证「AI 中文译文轨道」的核心逻辑：
//  后台：Google gtx 批量解析 / 条数对不上时退化为逐条 / MyMemory 回退
//  前台：中文轨道判定、主轨道与对照轨道的挑选、虚拟轨道取译文正文
// 逻辑与 background.js / content.js 保持一致（不加载浏览器 API，用桩替代）

// ---------- 后台逻辑副本 ----------
function chunkByBudget(idxs, texts, budget, maxLines) {
  const groups = [];
  let cur = [], curLen = 0;
  for (const i of idxs) {
    const t = texts[i] || '';
    if (cur.length && (curLen + t.length > budget || cur.length >= maxLines)) {
      groups.push(cur); cur = []; curLen = 0;
    }
    cur.push(i); curLen += t.length + 1;
  }
  if (cur.length) groups.push(cur);
  return groups;
}
function gtxExtract(j) {
  let out = '';
  const segs = (Array.isArray(j) && Array.isArray(j[0])) ? j[0] : [];
  for (const s of segs) if (Array.isArray(s) && typeof s[0] === 'string') out += s[0];
  return String(out).replace(/\r/g, '');
}
function guessSrcLang(text) {
  const s = String(text || '');
  if (/[\u3040-\u30ff]/.test(s)) return 'ja';
  if (/[\uac00-\ud7af]/.test(s)) return 'ko';
  if (/[\u0400-\u04ff]/.test(s)) return 'ru';
  if (/[\u0600-\u06ff]/.test(s)) return 'ar';
  if (/[\u0e00-\u0e7f]/.test(s)) return 'th';
  if (/[\u00c0-\u00ff]/.test(s)) return 'fr';
  if (/[\u4e00-\u9fff]/.test(s)) return 'zh';
  return 'en';
}

// ---------- fetch 桩 ----------
// ok | merge（批量并成一行，逼出逐条退化）| googleFail（Google 挂了，走 MyMemory 回退）| none（Google 返回空）
let mode = 'ok';
const calls = [];
global.fetch = async (url) => {
  calls.push(url);
  const isMm = url.indexOf('mymemory') >= 0;
  const q = decodeURIComponent((url.match(/[?&]q=([^&]*)/) || [])[1] || '');
  if (isMm) {
    return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'MM:' + q } }) };
  }
  if (mode === 'googleFail') return { ok: false, status: 429 };
  if (mode === 'none') return { ok: true, json: async () => [[]] };
  const lines = q.split('\n');
  if (mode === 'merge') {
    // Google 把换行吃掉了：整段并成一行 → 条数对不上 → 应退化为逐条请求
    return { ok: true, json: async () => [[[lines.map((s) => 'G:' + s).join(' '), q, null, null, 10]], null, 'zh-CN'] };
  }
  if (mode === 'trailing') {
    // Google 每个片段后面都补了换行（末尾多一个）→ 应能容错、仍走批量
    return {
      ok: true,
      json: async () => [lines.map((s) => ['G:' + s + '\n', s, null, null, 10]), null, 'zh-CN']
    };
  }
  // 常规：一个片段里带换行
  return {
    ok: true,
    json: async () => [[[lines.map((s) => 'G:' + s).join('\n'), q, null, null, 10]], null, 'zh-CN']
  };
};

async function gtxRequest(text, tl, sl) {
  const url = 'https://translate.googleapis.com/translate_a/t?client=gtx&sl=' + encodeURIComponent(sl || 'auto') +
    '&tl=' + encodeURIComponent(tl) + '&dt=t&q=' + encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const t = gtxExtract(j);
  if (!t) throw new Error('返回空译文');
  return t;
}
async function gtxGroup(texts, tl, sl) {
  try {
    const joined = texts.join('\n');
    const out = (await gtxRequest(joined, tl, sl)).replace(/^\n+/, '').replace(/\n+$/, '');
    const parts = out.split('\n');
    if (parts.length === texts.length) return { results: parts.map((s) => s.trim()), engine: 'google', batched: true };
  } catch (e) { /* 落到逐条 */ }
  const results = [];
  for (const t of texts) {
    try { results.push((await gtxRequest(t, tl, sl)).trim()); } catch (e) { results.push(''); }
  }
  return { results: results, engine: 'google', batched: false };
}
async function mmRequest(text, tl, sl) {
  const src = (sl && sl !== 'auto') ? sl : guessSrcLang(text);
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(String(text).slice(0, 480)) +
    '&langpair=' + encodeURIComponent(src + '|' + tl);
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const txt = j && j.responseData && j.responseData.translatedText;
  if (!txt) throw new Error('MyMemory 返回空');
  return String(txt).trim();
}

// ---------- 大模型引擎逻辑副本 ----------
function llmReady(cfg) {
  return !!(cfg && cfg.apiKey && cfg.baseUrl && cfg.model);
}
function llmEndpointCandidates(baseUrl) {
  const b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!b) return [];
  if (/\/chat\/completions$/.test(b)) return [b];
  const withScheme = /^https?:\/\//i.test(b) ? b : 'https://' + b;
  const out = [withScheme + '/chat/completions'];
  if (!/\/v\d+$/.test(withScheme)) out.push(withScheme + '/v1/chat/completions');
  return out;
}
function buildLlmMessages(texts, sl, tl) {
  const NAMES = { 'zh': '简体中文', 'zh-cn': '简体中文', 'zh-tw': '繁体中文', 'en': '英语', 'ja': '日语' };
  const src = NAMES[String(sl || '').toLowerCase()] || '';
  const dst = NAMES[String(tl || '').toLowerCase()] || '简体中文';
  const head = '你是专业的影视字幕翻译引擎。把下面这段字幕逐行翻译成' + dst + '。' +
    '严格遵守：\n1) 输出行数必须与输入行数完全相同（共 ' + texts.length + ' 行），一行也不能合并、拆分或省略；\n' +
    '2) 每行格式固定为 [序号] 译文，序号照抄输入行的序号；\n' +
    '3) 只输出译文行，不要任何解释、标题或空行；\n' +
    '4) 口语化、简洁，符合字幕阅读习惯，专有名词用通行译法。';
  const body = texts.map((t, i) => '[' + (i + 1) + '] ' + t).join('\n');
  return [
    { role: 'system', content: head },
    { role: 'user', content: (src ? '源语言：' + src + '\n\n' : '') + body }
  ];
}
function parseNumberedLines(out, n) {
  const res = new Array(n).fill('');
  const text = String(out || '').replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '').trim();
  const re = /^\[?(\d{1,4})\]?\s*[).、:：.\-]?\s*([\s\S]*)$/;
  let cur = -1;
  let hit = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(re);
    if (m) {
      const idx = Number(m[1]) - 1;
      if (idx >= 0 && idx < n) { res[idx] = m[2].trim(); cur = idx; continue; }
    }
    if (cur >= 0) res[cur] = (res[cur] ? res[cur] + ' ' : '') + line;
  }
  for (const s of res) if (s) hit++;
  return { results: res, hit: hit };
}
// 引擎接力时的"补位"规则：后一个引擎只填空位，不覆盖已有译文
function fillGaps(results, idxs, incoming) {
  let hit = 0;
  idxs.forEach((idx, k) => {
    const v = String((incoming && incoming[k]) || '').trim();
    if (v && !results[idx]) results[idx] = v;
    if (results[idx]) hit++;
  });
  return hit;
}

// ---------- 前台逻辑副本 ----------
function isChineseTrack(t) {
  return /ch|zh|cn|中文|简体|繁体/i.test(String((t && (t.lan + ' ' + t.lan_doc)) || ''));
}
function pickMainTrack(subtitleTracks) {
  let i = subtitleTracks.findIndex((t) => !t._virtual && !isChineseTrack(t));
  if (i < 0) i = subtitleTracks.findIndex((t) => !t._virtual);
  if (i < 0) i = 0;
  return i;
}
function pickChineseTrack(subtitleTracks, selectedTrack) {
  let i = subtitleTracks.findIndex((t) => !t._virtual && isChineseTrack(t));
  if (i >= 0 && i !== selectedTrack) return i;
  i = subtitleTracks.findIndex((t) => t._virtual && t._src === selectedTrack);
  return i;
}
// 虚拟轨道取正文（对应 fetchSubtitleData 的 _virtual 分支）
function fetchVirtualBody(trStore, track) {
  const rec = trStore[track._src];
  return (rec && rec.cues ? rec.cues : []).map((c) => ({ from: c.from, to: c.to, content: c.text }));
}

// ---------- 断言 ----------
(async () => {
  // 1) 分组：既不超过字符预算，也不超过行数上限，且不漏行
  const texts = new Array(40).fill(0).map((_, i) => 'line ' + i + ' ' + 'x'.repeat(60));
  const idxs = texts.map((_, i) => i);
  const groups = chunkByBudget(idxs, texts, 700, 15);
  const g1 = groups.every((g) => g.length <= 15);
  const g2 = groups.every((g) => g.reduce((s, i) => s + texts[i].length + 1, 0) <= 770);
  const g3 = groups.reduce((s, g) => s + g.length, 0) === 40;

  // 2) gtx 多片段拼接 + 异常输入
  const e1 = gtxExtract([[['你好', 'Hello', null, null, 10], ['世界', 'world', null, null, 10]], null, 'zh-CN']) === '你好世界';
  const e2 = gtxExtract(null) === '' && gtxExtract([[]]) === '';

  // 3) 批量成功（条数一致 → 走批量）
  mode = 'ok';
  const r1 = await gtxGroup(['Hello', 'How are you', 'Thanks'], 'zh-CN', 'en');
  const b1 = r1.batched === true && r1.results.length === 3 && r1.results[0] === 'G:Hello' && r1.results[2] === 'G:Thanks';

  // 3b) 片段末尾带换行 → 容错后仍走批量
  mode = 'trailing';
  const r1b = await gtxGroup(['Hello', 'How are you', 'Thanks'], 'zh-CN', 'en');
  const b1b = r1b.batched === true && r1b.results[1] === 'G:How are you' && r1b.results[2] === 'G:Thanks';

  // 4) 批量条数对不上（Google 吃掉换行）→ 退化为逐条，且结果逐条正确（不错行）
  mode = 'merge';
  const r2 = await gtxGroup(['Hello', 'How are you', 'Thanks'], 'zh-CN', 'en');
  const b2 = r2.batched === false && r2.results.length === 3 &&
    r2.results[0] === 'G:Hello' && r2.results[1] === 'G:How are you' && r2.results[2] === 'G:Thanks';

  // 5) Google 挂掉后走 MyMemory 回退 + 源语种猜测
  mode = 'googleFail';
  let gFail = false;
  try { await gtxRequest('Hello', 'zh-CN', 'en'); } catch (e) { gFail = /429/.test(e.message); }
  const mm = await mmRequest('Hello', 'zh-CN', 'en');
  const b3 = gFail && mm === 'MM:Hello';
  const b4 = guessSrcLang('こんにちは') === 'ja' && guessSrcLang('привет') === 'ru' && guessSrcLang('hello') === 'en';

  // 6) 前台：只有外文轨道时，主轨道选外文、尚无对照轨道
  const tracks = [{ lan: 'en', lan_doc: 'English' }, { lan: 'ja', lan_doc: '日语' }];
  const c1 = pickMainTrack(tracks) === 0 && pickChineseTrack(tracks, 0) === -1;
  // 生成译文轨道后：对照轨道 = 该主轨道的译文轨道
  tracks.push({ lan: 'zh-CN', lan_doc: '中文（AI 翻译）', _virtual: true, _src: 0 });
  const c2 = pickChineseTrack(tracks, 0) === 2;
  // 切到日语主轨道（0→1）时，不该误挂 0 号轨道的译文
  const c3 = pickChineseTrack(tracks, 1) === -1;
  // 真中文轨道存在时优先真轨道
  tracks.push({ lan: 'zh-Hans', lan_doc: '中文（简体）' });
  const c4 = pickChineseTrack(tracks, 0) === 3;
  // 只剩虚拟轨道时，主轨道仍能正常返回
  const zhOnly = [{ lan: 'zh-CN', lan_doc: '中文（AI 翻译）', _virtual: true, _src: 0 }];
  const c5 = pickMainTrack(zhOnly) === 0;

  // 7) 虚拟轨道正文：时间轴照搬原文，content 换成译文
  const trStore = { 0: { cues: [{ index: 0, from: 0, to: 1.2, text: '你好' }, { index: 1, from: 1.2, to: 2.4, text: '你好吗' }] } };
  const body = fetchVirtualBody(trStore, { _virtual: true, _src: 0 });
  const d1 = body.length === 2 && body[0].content === '你好' && body[1].from === 1.2 && body[1].to === 2.4;
  const d2 = fetchVirtualBody({}, { _virtual: true, _src: 9 }).length === 0;

  // 8) 各家 base_url 写法 → 候选接口地址（DeepSeek 官方已不带 /v1，硅基要 /v1）
  const u1 = llmEndpointCandidates('https://api.deepseek.com');
  const u2 = llmEndpointCandidates('https://api.siliconflow.cn/v1');
  const u3 = llmEndpointCandidates('https://x.cn/v1/');
  const u4 = llmEndpointCandidates('https://x.cn/v1/chat/completions');
  const u5 = llmEndpointCandidates('my.proxy.com');
  const L1 = JSON.stringify(u1) === JSON.stringify(['https://api.deepseek.com/chat/completions', 'https://api.deepseek.com/v1/chat/completions']) &&
    JSON.stringify(u2) === JSON.stringify(['https://api.siliconflow.cn/v1/chat/completions']) &&
    JSON.stringify(u3) === JSON.stringify(['https://x.cn/v1/chat/completions']) &&
    JSON.stringify(u4) === JSON.stringify(['https://x.cn/v1/chat/completions']) &&
    JSON.stringify(u5) === JSON.stringify(['https://my.proxy.com/chat/completions', 'https://my.proxy.com/v1/chat/completions']);
  const L0 = !llmReady({}) && !llmReady({ baseUrl: 'x', model: 'y' }) && llmReady({ apiKey: 'k', baseUrl: 'x', model: 'y' });

  // 9) 大模型输出解析：[序号] 标准格式
  const p1 = parseNumberedLines('[1] 大家好\n[2] 你好吗\n[3] 谢谢', 3);
  const L2 = p1.hit === 3 && p1.results[0] === '大家好' && p1.results[2] === '谢谢';
  // 模型写成 "1." / "2、" 也要认
  const p2 = parseNumberedLines('1. 大家好\n2、你好吗\n3: 谢谢', 3);
  const L3 = p2.hit === 3 && p2.results[1] === '你好吗';
  // 外面套了 markdown 代码块要剥掉
  const p3 = parseNumberedLines('```text\n[1] 大家好\n[2] 你好吗\n```', 2);
  const L4 = p3.hit === 2 && p3.results[0] === '大家好';
  // 缺第 2 行 → hit=2 未达 80%，触发整批降级（保证不错行）
  const p4 = parseNumberedLines('[1] 大家好\n[3] 谢谢', 3);
  const L5 = p4.hit === 2 && p4.results[1] === '' && Math.ceil(3 * 0.8) === 3 && p4.hit < 3;
  // 超长译文被换行拆开 → 续行要并回同一行
  const p5 = parseNumberedLines('[1] 这是一句很长的\n译文被换行拆了\n[2] 第二行', 2);
  const L6 = p5.results[0] === '这是一句很长的 译文被换行拆了' && p5.results[1] === '第二行';
  // prompt：行数一致 + 编号从 1 开始 + 目标语言写进指令
  const msg = buildLlmMessages(['Hello', 'Thanks'], 'en', 'zh-CN');
  const L7 = /共 2 行/.test(msg[0].content) && /\[1\] Hello\n\[2\] Thanks$/.test(msg[1].content) && /简体中文/.test(msg[0].content);

  // 10) 引擎接力：大模型译出一半 → 免费接口只补空位，不覆盖已有译文
  const relay = ['A1', '', 'A3', ''];
  const hitR = fillGaps(relay, [0, 1, 2, 3], ['B1', 'B2', 'B3', 'B4']);
  const L8 = hitR === 4 && relay[0] === 'A1' && relay[1] === 'B2' && relay[2] === 'A3' && relay[3] === 'B4';

  // ---------- 点词大模型释义解析（parseLlmDef 容错） ----------
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function langName(code) {
    const m = { 'zh': '简体中文', 'zh-cn': '简体中文', 'en': '英语', 'ja': '日语', 'ko': '韩语' };
    return m[String(code || '').toLowerCase()] || '';
  }
  // 与 background.js 同步：严格四行 / 序号 / 代码块 / 自由发挥 都能解析
  function parseLlmDef(out, word) {
    const raw = String(out || '').replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '').trim();
    const grab = (label) => {
      const m = raw.match(new RegExp('^\\s*(?:\\d+[).、:：]?\\s*)?' + label + '[：:]\\s*(.*)$', 'm'));
      return m ? m[1].trim() : '';
    };
    const pos = grab('词性'), def = grab('释义'), note = grab('说明'), ex = grab('例句');
    const html = (pos || def || note || ex)
      ? '<div class="ll-pos">' + escHtml(pos) + '</div><div class="ll-def">' + escHtml(def) + '</div>' +
        (note ? '<div class="ll-def-note">💡 ' + escHtml(note) + '</div>' : '') +
        (ex ? '<div class="ll-def-ex">“' + escHtml(ex) + '”</div>' : '')
      : '<div class="ll-def">' + escHtml(raw) + '</div>';
    return { ok: true, word: word, pos: pos, def: def, note: note, ex: ex, html: html, text: def || raw };
  }
  // 严格四行
  const d1par = parseLlmDef('词性：n.\n释义：猫\n说明：一种常见宠物\n例句：I have a cat. → 我有一只猫。', 'cat');
  const M1 = d1par.pos === 'n.' && d1par.def === '猫' && d1par.note === '一种常见宠物' && /我有一只猫/.test(d1par.ex) && d1par.html.indexOf('ll-pos') >= 0;
  // 模型写成 "1." 序号 + 裹 ``` 代码块 → 仍要拆出
  const d2par = parseLlmDef('```\n1. 词性：v.\n2. 释义：跑\n3. 说明：用脚快速移动\n```', 'run');
  const M2 = d2par.pos === 'v.' && d2par.def === '跑' && d2par.note === '用脚快速移动';
  // 自由发挥（无四要素）→ 整段兜底当释义，不报错
  const d3par = parseLlmDef('“cat” 是猫的意思，家养宠物。', 'cat');
  const M3 = d3par.def === '' && d3par.html.indexOf('ll-def') >= 0 && /猫/.test(d3par.html);

  console.log('--- AI 中文译文轨道 自检 ---');
  console.log('1) 批量分组(预算/行数/不漏行) :', g1 && g2 && g3);
  console.log('2) gtx 解析(多片段/异常输入)  :', e1 && e2);
  console.log('3) 批量翻译(条数一致→批量)    :', b1);
  console.log('3b) 末尾多余换行容错(仍批量)  :', b1b);
  console.log('4) 条数不符→逐条退化且不错行  :', b2);
  console.log('5) MyMemory 回退 + 语种猜测   :', b3 && b4);
  console.log('6) 主/对照轨道挑选(含虚拟轨道):', c1 && c2 && c3 && c4 && c5);
  console.log('7) 虚拟轨道正文(时间轴+译文)  :', d1 && d2);
  console.log('8) 大模型地址容错(带不带 /v1) :', L1 && L0);
  console.log('9) 大模型输出解析(序号/脏格式):', L2 && L3 && L4 && L5 && L6 && L7);
  console.log('10) 多引擎接力只补空位        :', L8);
  console.log('11) 点词释义解析(严格四行)     :', M1);
  console.log('12) 点词释义解析(序号+代码块)  :', M2);
  console.log('13) 点词释义解析(自由发挥兜底) :', M3);
  const all = g1 && g2 && g3 && e1 && e2 && b1 && b1b && b2 && b3 && b4 && c1 && c2 && c3 && c4 && c5 &&
    d1 && d2 && L0 && L1 && L2 && L3 && L4 && L5 && L6 && L7 && L8 && M1 && M2 && M3;
  console.log('结果:', all ? 'PASS ✅' : 'FAIL ❌');
  process.exit(all ? 0 : 1);
})();
