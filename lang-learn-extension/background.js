'use strict';

async function fetchWithTimeout(url, ms, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const opt = Object.assign({ signal: ctrl.signal }, options || {});
    return await fetch(url, opt);
  } finally {
    clearTimeout(timer);
  }
}

// 源1：dictionaryapi.dev（免费、释义全，但国内/手机网络偶尔被拦）
async function lookupDictionaryApi(word) {
  const url = 'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word.toLowerCase());
  try {
    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) return null;
    const data = await res.json();
    const phonetics = [];
    const meanings = [];
    for (const entry of data) {
      if (entry.phonetic) phonetics.push(entry.phonetic);
      for (const m of entry.meanings || []) {
        for (const d of m.definitions || []) {
          meanings.push({ pos: m.partOfSpeech, def: d.definition });
        }
      }
    }
    if (!meanings.length) return null;
    return { ok: true, source: 'dictionaryapi.dev', word, phonetics: [...new Set(phonetics)], meanings: meanings.slice(0, 6) };
  } catch (e) {
    return null;
  }
}

// 源2：Wiktionary REST（维基词典，国内通常可达，作为兜底）
async function lookupWiktionary(word) {
  const url = 'https://en.wiktionary.org/api/rest_v1/page/definition/' + encodeURIComponent(word.toLowerCase());
  try {
    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) return null;
    const data = await res.json();
    const meanings = [];
    for (const d of data.definitions || []) {
      for (const def of d.definitions || []) {
        meanings.push({ pos: d.partOfSpeech, def: def.definition });
      }
    }
    if (!meanings.length) return null;
    return { ok: true, source: 'wiktionary', word, phonetics: [], meanings: meanings.slice(0, 6) };
  } catch (e) {
    return null;
  }
}

// ---------- 字幕翻译服务（免费、无需 Key） ----------
// 引擎 A：Google 免费端点 translate_a/t（client=gtx，免鉴权；国内网络可能需要代理）
// 引擎 B：MyMemory（api.mymemory.translated.net，免 Key，国内通常可达，质量一般、有每日额度）
// 两者都无需用户配置；engine='auto' 时 Google 失败自动回退 MyMemory。
const GTX_HOSTS = ['https://translate.googleapis.com', 'https://translate.google.com'];
const MM_HOST = 'https://api.mymemory.translated.net';

// 按字符预算把多行打包（Google 一次请求别太长，否则易 413 / 429）
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

// gtx 返回：[ [[译文片段,原文片段,...], ...], null, "zh-CN", ... ]，长文本会被切成多个片段
function gtxExtract(j) {
  let out = '';
  const segs = (Array.isArray(j) && Array.isArray(j[0])) ? j[0] : [];
  for (const s of segs) if (Array.isArray(s) && typeof s[0] === 'string') out += s[0];
  return String(out).replace(/\r/g, '');
}

async function gtxRequest(text, tl, sl) {
  let lastErr = null;
  for (const host of GTX_HOSTS) {
    try {
      const url = host + '/translate_a/t?client=gtx&sl=' + encodeURIComponent(sl || 'auto') +
        '&tl=' + encodeURIComponent(tl) + '&dt=t&q=' + encodeURIComponent(text);
      const res = await fetchWithTimeout(url, 15000);
      if (!res.ok) { lastErr = new Error('HTTP ' + res.status); continue; }
      const j = await res.json();
      const t = gtxExtract(j);
      if (t) return t;
      lastErr = new Error('返回空译文');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Google 翻译不可用');
}

// 一次请求里塞多行：用换行拼接，返回后按换行切回。
// 风险：Google 偶尔会合并/增删换行 → 这里核对条数，对不上就整组退化为逐条请求（保证不错行）。
async function gtxGroup(texts, tl, sl) {
  try {
    const joined = texts.join('\n');
    // Google 有时会在最后一个片段后面补一个换行，先抹掉再按行切，
    // 否则条数永远对不上、白白退化成逐条请求。
    const out = (await gtxRequest(joined, tl, sl)).replace(/^\n+/, '').replace(/\n+$/, '');
    const parts = out.split('\n');
    if (parts.length === texts.length) {
      return { results: parts.map((s) => s.trim()), engine: 'google', batched: true };
    }
  } catch (e) { /* 落到逐条 */ }
  const results = [];
  for (const t of texts) {
    try { results.push((await gtxRequest(t, tl, sl)).trim()); }
    catch (e) { results.push(''); }
  }
  return { results: results, engine: 'google', batched: false };
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

async function mmRequest(text, tl, sl) {
  const src = (sl && sl !== 'auto') ? sl : guessSrcLang(text);
  const url = MM_HOST + '/get?q=' + encodeURIComponent(String(text).slice(0, 480)) +
    '&langpair=' + encodeURIComponent(src + '|' + tl);
  const res = await fetchWithTimeout(url, 15000);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const txt = j && j.responseData && j.responseData.translatedText;
  if (!txt) throw new Error((j && j.responseDetails) || 'MyMemory 返回空');
  return String(txt).trim();
}

// 并发跑一批任务（limit 控制并发，避免打爆免费额度被 429）
async function pool(tasks, limit) {
  const out = new Array(tasks.length);
  let p = 0;
  const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
    for (;;) {
      const i = p++;
      if (i >= tasks.length) return;
      try { out[i] = await tasks[i](); } catch (e) { out[i] = ''; }
    }
  });
  await Promise.all(workers);
  return out;
}

// 翻译一批字幕行。texts 为原文本数组，返回 { ok, engine, results: [] }
// 引擎链：auto = 大模型（已配置时）→ Google → MyMemory；llm / google / mymemory 为指定单一引擎。
// 关键：后一个引擎**只补前引擎没译出来的行**，不会覆盖已有译文——
// 大模型限流译了一半时，剩下的自动由免费接口补上，整条轨道不会缺行。
async function translateBatch(texts, sl, tl, engine, cfg) {
  const arr = Array.isArray(texts) ? texts : [];
  const idxs = [];
  arr.forEach((t, i) => { if (t && String(t).trim()) idxs.push(i); });
  const results = new Array(arr.length).fill('');
  if (!idxs.length) return { ok: true, engine: 'none', results: results };
  const notes = [];
  const fill = (r) => {
    let hit = 0;
    idxs.forEach((idx, k) => {
      const v = String((r && r[k]) || '').trim();
      if (v && !results[idx]) { results[idx] = v; }
      if (results[idx]) hit++;
    });
    return hit;
  };
  const llmCfg = cfg || (await getLlmConfig());

  // ① 大模型优先：译文质量最好，整句语境与专有名词一致性远好于机翻
  if (engine === 'llm' && !llmReady(llmCfg)) {
    // 明确报错，不要静默降级到机翻——否则用户会以为"大模型怎么译得这么差"
    return { ok: false, error: '还没填大模型配置（API 地址 / 模型名 / Key 缺一项）', results: results };
  }
  if ((engine === 'llm' || engine === 'auto') && llmReady(llmCfg)) {
    let llmErr = null;
    try {
      const groups = chunkByBudget(idxs, arr, 1200, 25);
      const res = await pool(groups.map((g) => async () => llmTranslateBatch(g.map((i) => arr[i]), sl, tl, llmCfg)), 2);
      let hit = 0;
      groups.forEach((g, gi) => {
        const r = (res[gi] && res[gi].results) || [];
        g.forEach((idx, k) => {
          const v = String(r[k] || '').trim();
          if (v) { results[idx] = v; }
          if (results[idx]) hit++;
        });
      });
      if (hit === idxs.length) return { ok: true, engine: 'llm:' + llmCfg.model, results: results };
      if (hit > 0) notes.push('大模型译出 ' + hit + '/' + idxs.length + ' 行');
      else llmErr = '大模型返回全空';
    } catch (e) {
      llmErr = String((e && e.message) || e);
    }
    if (engine === 'llm') {
      return { ok: results.some((s) => s), engine: 'llm:' + llmCfg.model, results: results, error: llmErr || null };
    }
    if (llmErr) notes.push('大模型：' + llmErr);
  }

  // ② Google 免费端点
  if (engine === 'google' || engine === 'auto') {
    let googleErr = null;
    try {
      const rest = idxs.filter((i) => !results[i]);
      const groups = rest.length ? chunkByBudget(rest, arr, 700, 15) : [];
      const res = await pool(groups.map((g) => async () => gtxGroup(g.map((i) => arr[i]), tl, sl)), 3);
      const merged = [];
      groups.forEach((g, gi) => { const r = (res[gi] && res[gi].results) || []; g.forEach((idx, k) => { merged[idx] = r[k] || ''; }); });
      // 按原始 idxs 顺序喂给 fill
      const ordered = idxs.map((i) => merged[i] || '');
      const hit = fill(ordered);
      if (hit === idxs.length) return { ok: true, engine: 'google', results: results, note: notes.join('；') || null };
      if (!hit) googleErr = 'Google 翻译返回全空（可能被限流或网络不可达）';
    } catch (e) {
      googleErr = String((e && e.message) || e);
    }
    if (engine === 'google') {
      return { ok: results.some((s) => s), engine: 'google', results: results, error: googleErr || null };
    }
    if (googleErr) notes.push('Google：' + googleErr);
  }

  // ③ MyMemory 兜底（逐条，额度有限）
  try {
    const rest = idxs.filter((i) => !results[i]);
    const res = await pool(rest.map((i) => async () => mmRequest(arr[i], tl, sl)), 4);
    const merged = [];
    rest.forEach((idx, k) => { merged[idx] = res[k] || ''; });
    const ordered = idxs.map((i) => merged[i] || '');
    const hit = fill(ordered);
    if (hit) {
      return { ok: true, engine: 'mymemory', results: results, note: notes.join('；') || null };
    }
    return { ok: false, error: notes.join('；') || 'MyMemory 也未返回结果（可能已用完当日免费额度）', results: results };
  } catch (e) {
    return { ok: false, error: notes.join('；') || String((e && e.message) || e), results: results };
  }
}

// ---------- 大模型翻译引擎（OpenAI 兼容接口，用户自填） ----------
// 任何 OpenAI 兼容端点都能用：DeepSeek / 硅基流动 / 智谱 GLM / Moonshot / 阿里云百炼 /
// OpenAI / Groq / OpenRouter / 本地 Ollama。配置存在 chrome.storage.local（不同步到账号）。
function getLlmConfig() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get({ llm: {} }, (r) => resolve((r && r.llm) || {}));
    } catch (e) { resolve({}); }
  });
}
function llmReady(cfg) {
  return !!(cfg && cfg.apiKey && cfg.baseUrl && cfg.model);
}
// 各厂商 base_url 写法不统一（有的要 /v1 有的不要），这里生成候选路径逐个试，
// 成功后记住这个路径（存 cfg._pathHint），后续请求不再试错。
function llmEndpointCandidates(baseUrl) {
  const b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!b) return [];
  if (/\/chat\/completions$/.test(b)) return [b];
  const withScheme = /^https?:\/\//i.test(b) ? b : 'https://' + b;
  const out = [withScheme + '/chat/completions'];
  if (!/\/v\d+$/.test(withScheme)) out.push(withScheme + '/v1/chat/completions');
  return out;
}
function langName(code) {
  const m = {
    'zh': '简体中文', 'zh-cn': '简体中文', 'zh-tw': '繁体中文', 'zh-hans': '简体中文', 'zh-hant': '繁体中文',
    'en': '英语', 'ja': '日语', 'ko': '韩语', 'fr': '法语', 'de': '德语', 'es': '西班牙语',
    'ru': '俄语', 'pt': '葡萄牙语', 'it': '意大利语', 'ar': '阿拉伯语', 'th': '泰语'
  };
  return m[String(code || '').toLowerCase()] || '';
}
// 一批行 → 编号 prompt。要求模型按 [序号] 逐行输出，便于严格对齐（模型偶尔合并/拆行也不怕）。
function buildLlmMessages(texts, sl, tl) {
  const src = langName(sl), dst = langName(tl) || '简体中文';
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
// 解析带序号的输出；同时容许模型写成 "1." / "1、" / 无序号纯行 等情况。
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
      if (idx >= 0 && idx < n) {
        res[idx] = m[2].trim();
        cur = idx;
        continue;
      }
    }
    if (cur >= 0) res[cur] = (res[cur] ? res[cur] + ' ' : '') + line;   // 上一行的续行
  }
  for (const s of res) if (s) hit++;
  return { results: res, hit: hit };
}
async function llmChatOnce(url, cfg, messages, maxTokens) {
  const res = await fetchWithTimeout(url, 60000, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
    body: JSON.stringify({ model: cfg.model, messages: messages, temperature: 0.2, max_tokens: maxTokens })
  });
  const txt = await res.text();
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try {
      const j = JSON.parse(txt);
      msg += ' ' + ((j.error && (j.error.message || j.error.code || j.error.type)) || j.message || '');
    } catch (e) { msg += ' ' + txt.slice(0, 120); }
    throw new Error(msg.trim());
  }
  let j = null;
  try { j = JSON.parse(txt); } catch (e) { throw new Error('返回不是 JSON：' + txt.slice(0, 100)); }
  const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (content == null) throw new Error('返回里没有 choices[0].message.content');
  return String(content);
}
// 调一次大模型（自动试候选 URL）
async function llmChat(cfg, messages, maxTokens) {
  let lastErr = null;
  const urls = llmEndpointCandidates(cfg.baseUrl);
  for (const u of urls) {
    try { return await llmChatOnce(u, cfg, messages, maxTokens); }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('大模型接口不可用');
}
// 一批字幕行走大模型。命中率不足时整批降级为逐条请求（保证不错行）
async function llmTranslateBatch(texts, sl, tl, cfg) {
  const n = texts.length;
  const results = new Array(n).fill('');
  if (!n) return { results: results, engine: 'llm' };
  const chars = texts.reduce((s, t) => s + String(t).length, 0);
  try {
    const out = await llmChat(cfg, buildLlmMessages(texts, sl, tl), Math.ceil(chars * 1.2) + 400);
    const p = parseNumberedLines(out, n);
    if (p.hit >= Math.ceil(n * 0.8)) return { results: p.results, engine: 'llm', batched: true };
  } catch (e) { /* 落到逐条 */ }
  for (let i = 0; i < n; i++) {
    try {
      const out = await llmChat(cfg, buildLlmMessages([texts[i]], sl, tl), Math.ceil(String(texts[i]).length * 1.5) + 200);
      const p = parseNumberedLines(out, 1);
      // 模型可能把 "[1] 你好" 整个回回来，或干脆不带序号；两种情况都要拿到干净译文
      const raw = String(out || '').trim()
        .replace(/^\[?1\]?\s*[).、:：.\-]?\s*/, '')
        .replace(/^```[a-zA-Z]*\n?|```$/g, '')
        .trim();
      results[i] = (p.results[0] || raw);
    } catch (e) { results[i] = ''; }
  }
  return { results: results, engine: 'llm', batched: false };
}

// ---------- 点词查词用大模型：带语境，返回「词性 / 释义 / 说明 / 例句」 ----------
// 面向学习者母语（tl）为译文语言。比在线词典好的地方：能结合字幕语境给出准确义项，
// 且任意语种都可用（dictionaryapi.dev 主要只有英文）。
async function llmDefineWord(word, context, tl, cfg) {
  const dst = langName(tl) || '简体中文';
  const sys = '你是一位面向语言学习者的双语词典助手。用户的母语是' + dst + '。' +
    '请解释给定的单词，严格按下面四行输出（不要任何多余内容、不要代码块、不要编号）：\n' +
    '词性：<英文缩写，如 n. / v. / adj. / adv. / phr. >\n' +
    '释义：<' + dst + '给出 1-2 个最常用含义，用逗号分隔>\n' +
    '说明：<用' + dst + '写一句简短用法说明>\n' +
    '例句：<包含该词的原文句子（无可省略这一行）> → <' + dst + '翻译>';
  const user = '单词：' + word + (context ? '\n语境：' + context : '');
  const out = await llmChat(cfg, [
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], 400);
  return parseLlmDef(out, word);
}
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
// 容错解析：模型可能严格按四行、可能写成 "1." 序号、可能裹 ``` 代码块、也可能自由发挥。
// 能拆出四要素就结构化渲染，否则把整段原文当释义兜底显示。
function parseLlmDef(out, word) {
  const raw = String(out || '').replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '').trim();
  const grab = (label) => {
    const m = raw.match(new RegExp('^\\s*(?:\\d+[).、:：]?\\s*)?' + label + '[：:]\\s*(.*)$', 'm'));
    return m ? m[1].trim() : '';
  };
  const pos = grab('词性');
  const def = grab('释义');
  const note = grab('说明');
  const ex = grab('例句');
  const html = (pos || def || note || ex)
    ? '<div class="ll-pos">' + escHtml(pos) + '</div>' +
      '<div class="ll-def">' + escHtml(def) + '</div>' +
      (note ? '<div class="ll-def-note">💡 ' + escHtml(note) + '</div>' : '') +
      (ex ? '<div class="ll-def-ex">“' + escHtml(ex) + '”</div>' : '')
    : '<div class="ll-def">' + escHtml(raw) + '</div>';
  return { ok: true, word: word, pos: pos, def: def, note: note, ex: ex, html: html, text: def || raw };
}

// ---------- 词形还原：被动式 / 复数 / 时态 / 比较级 → 原形 ----------
// 生词本里常出现 "created" / "studies" / "written" 这类变形，直接按原样查本地词库会漏。
// 这里生成一批"可能的原形"候选，按顺序去词库里碰（精确匹配永远最先）。
const IRREGULAR = {
  was: 'be', were: 'be', been: 'be', am: 'be', is: 'be', are: 'be',
  had: 'have', has: 'have', did: 'do', does: 'do', done: 'do', went: 'go', gone: 'go',
  got: 'get', gotten: 'get, make', made: 'make', took: 'take', taken: 'take', came: 'come',
  saw: 'see', seen: 'see', knew: 'know', known: 'know', thought: 'think', gave: 'give', given: 'give',
  found: 'find', told: 'tell', became: 'become', shown: 'show', left: 'leave', felt: 'feel',
  brought: 'bring', began: 'begin', begun: 'begin', kept: 'keep', held: 'hold', wrote: 'write',
  written: 'write', stood: 'stand', heard: 'hear', meant: 'mean', met: 'meet', ran: 'run',
  paid: 'pay', sat: 'sit', spoke: 'speak', spoken: 'speak', led: 'lead', grew: 'grow', grown: 'grow',
  lost: 'lose', fell: 'fall', fallen: 'fall', sent: 'send', built: 'build', understood: 'understand',
  drew: 'draw', drawn: 'draw', broke: 'break', broken: 'break', spent: 'spend', rose: 'rise',
  risen: 'rise', drove: 'drive', driven: 'drive', bought: 'buy', wore: 'wear', worn: 'wear',
  chose: 'choose', chosen: 'choose', ate: 'eat', eaten: 'eat', drank: 'drink', drunk: 'drink',
  sang: 'sing', sung: 'sing', swam: 'swim', swum: 'swim', flew: 'fly', flown: 'fly',
  threw: 'throw', thrown: 'throw', caught: 'catch', taught: 'teach', fought: 'fight',
  sought: 'seek', sold: 'sell', slept: 'sleep', won: 'win', forgot: 'forget', forgotten: 'forget',
  forgave: 'forgive', forgiven: 'forgive', hid: 'hide', hidden: 'hide', rode: 'ride', ridden: 'ride',
  shook: 'shake', shaken: 'shake', stole: 'steal', stolen: 'steal', woke: 'wake', woken: 'wake',
  froze: 'freeze', frozen: 'freeze', bit: 'bite', bitten: 'bite', blew: 'blow', blown: 'blow',
  rang: 'ring', rung: 'ring', shot: 'shoot', sank: 'sink', sunk: 'sink', slid: 'slide',
  stuck: 'stick', struck: 'strike', swept: 'sweep', tore: 'tear', torn: 'tear', wound: 'wind',
  arose: 'arise', arisen: 'arise', bore: 'bear', borne: 'bear', beaten: 'beat', bent: 'bend',
  bound: 'bind', bled: 'bleed', bred: 'breed', clung: 'cling', crept: 'creep', dealt: 'deal',
  dug: 'dig', fed: 'feed', fled: 'flee', flung: 'fling', ground: 'grind', hung: 'hang',
  knelt: 'kneel', laid: 'lay', leant: 'lean', leapt: 'leap', lent: 'lend', mistook: 'mistake',
  mistaken: 'mistake', overcame: 'overcome', overtook: 'overtake', overtaken: 'overtake',
  said: 'say', shone: 'shine', shrank: 'shrink', shrunk: 'shrink', spun: 'spin', spat: 'spit',
  spilt: 'spill', spoilt: 'spoil', stank: 'stink', stunk: 'stink', strove: 'strive',
  swore: 'swear', sworn: 'swear', swelled: 'swell', swollen: 'swell', swung: 'swing',
  threw_up: 'throw up', underwent: 'undergo', undergone: 'undergo', wove: 'weave', woven: 'weave',
  wept: 'weep', withdrew: 'withdraw', withdrawn: 'withdraw', better: 'good', best: 'good',
  worse: 'bad', worst: 'bad', more: 'much', most: 'much', less: 'little', least: 'little',
  // 不规则复数（规则 -s/-es 推不出来的）
  children: 'child', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth',
  geese: 'goose', mice: 'mouse', lice: 'louse', oxen: 'ox', people: 'person',
  criteria: 'criterion', phenomena: 'phenomenon', data: 'datum', media: 'medium',
  analyses: 'analysis', theses: 'thesis', crises: 'crisis', diagnoses: 'diagnosis',
  indices: 'index', matrices: 'matrix', vertices: 'vertex', appendices: 'appendix',
  alumni: 'alumnus', cacti: 'cactus', fungi: 'fungus', nuclei: 'nucleus',
  radii: 'radius', stimuli: 'stimulus', syllabi: 'syllabus', bacteria: 'bacterium',
  curricula: 'curriculum', formulae: 'formula', vertebrae: 'vertebra'
};

function lemmaCandidates(word) {
  const w = String(word || '').toLowerCase().trim();
  const out = [];
  const push = (x) => { if (x && x !== w && out.indexOf(x) < 0) out.push(x); };
  // 0) 精确匹配放最前（由调用方先试 w）
  // 1) 不规则表
  if (IRREGULAR[w]) String(IRREGULAR[w]).split(',').forEach((s) => push(s.trim()));
  // 2) 规则变形（辅音双写还原是易漏点：stopped→stop、biggest→big、running→run）
  const DBL = /([b-df-hj-np-tv-z])\1$/;
  if (/iest$/.test(w)) push(w.slice(0, -4) + 'y');                 // happiest → happy
  if (/ier$/.test(w)) push(w.slice(0, -3) + 'y');                  // happier → happy
  if (/ies$/.test(w)) push(w.slice(0, -3) + 'y');                  // studies → study
  if (/ied$/.test(w)) push(w.slice(0, -3) + 'y');                  // tried → try
  if (/es$/.test(w)) push(w.slice(0, -2));                         // boxes → box
  if (/s$/.test(w) && !/ss$/.test(w)) push(w.slice(0, -1));        // cats → cat
  if (/ed$/.test(w)) {
    const stem = w.slice(0, -2);
    push(stem);                                                    // walked → walk
    push(w.slice(0, -1));                                          // liked → like
    if (DBL.test(stem)) push(stem.slice(0, -1));                   // stopped → stop
  }
  if (/ing$/.test(w)) {
    const stem = w.slice(0, -3);
    push(stem);                                                    // walking → walk
    push(stem + 'e');                                              // making → make
    if (DBL.test(stem)) push(stem.slice(0, -1));                   // running → run
  }
  if (/er$/.test(w)) {
    const stem = w.slice(0, -2);
    push(stem);                                                    // worker → work
    push(w.slice(0, -1));                                          // nicer → nice
    if (DBL.test(stem)) push(stem.slice(0, -1));                   // bigger → big
  }
  if (/est$/.test(w)) {
    const stem = w.slice(0, -3);
    push(stem);                                                    // longest → long
    push(w.slice(0, -2));                                          // nicest → nice
    if (DBL.test(stem)) push(stem.slice(0, -1));                   // biggest → big
  }
  if (/ly$/.test(w)) push(w.slice(0, -2));                          // quickly → quick
  return out;
}

// 在本地词库里查一个词（精确 → 词形还原候选）。命中返回 {key, def, pos, matched}
function dictLookup(userDict, word) {
  const dict = userDict || {};
  const w = String(word || '').toLowerCase().trim();
  if (!w) return null;
  if (dict[w] && dict[w].def) return { key: w, def: dict[w].def, pos: dict[w].pos || '', matched: w };
  for (const c of lemmaCandidates(w)) {
    if (dict[c] && dict[c].def) return { key: c, def: dict[c].def, pos: dict[c].pos || '', matched: c };
  }
  return null;
}

async function lookupWord(word) {
  const w = String(word || '').toLowerCase();
  if (!w) return { ok: false, notFound: true, word, error: '单词为空' };
  // 本地词库优先：用户导入的整本词典 / 手动补的释义，命中即返回（离线、无延迟）
  // 同时做词形还原：created → create、written → write、studies → study
  try {
    const store = await chrome.storage.local.get({ userDict: {} });
    const hit = dictLookup(store.userDict, w);
    if (hit) {
      const tail = hit.matched && hit.matched !== w ? '（' + w + ' → ' + hit.matched + '）' : '';
      return {
        ok: true, source: '本地词库' + tail, word,
        phonetics: [], meanings: [{ pos: hit.pos || '', def: hit.def }]
      };
    }
  } catch (e) { /* ignore */ }
  // 本地词库未收录 → 再查在线源
  let r = await lookupDictionaryApi(w);
  if (r) return r;
  r = await lookupWiktionary(w);
  if (r) return r;
  return { ok: false, notFound: true, word, error: '所有词典源均未收录该词：本地词库没有、在线词典也拉不到。可点「✎ 存本地释义」手动补充。' };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'lookup') {
    lookupWord(msg.word)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // 异步响应
  }
  // 点词用大模型查释义（需要用户在设置里配好大模型 API）。带语境句，译文语言 = tl。
  if (msg.type === 'dictLlm') {
    (async () => {
      const cfg = await getLlmConfig();
      if (!llmReady(cfg)) {
        sendResponse({ ok: false, error: '未配置大模型：请到插件设置打开「用大模型 API 翻译」并填好地址 / 模型 / Key' });
        return;
      }
      try {
        const r = await llmDefineWord(String(msg.word || '').trim(), msg.context || '', msg.tl || 'zh-CN', cfg);
        sendResponse(r);
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true;
  }
  // 纯本地词库查询（不走网络）：用于生词本列表「主动显示释义」
  if (msg.type === 'dictLookupBatch') {
    chrome.storage.local.get({ userDict: {} }, (r) => {
      const dict = r.userDict || {};
      const out = {};
      (msg.words || []).forEach((w) => {
        const hit = dictLookup(dict, w);
        if (hit) out[w] = hit;
      });
      sendResponse({ ok: true, map: out, dictSize: Object.keys(dict).length });
    });
    return true;
  }
  // 字幕整批翻译（免费引擎，无需 Key）。走后台是为了避开页面 CORS 限制。
  if (msg.type === 'translateBatch') {
    translateBatch(msg.texts || [], msg.sl || '', msg.tl || 'zh-CN', msg.engine || 'auto')
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  // 大模型接口连通性测试：翻一句短句，验证 base_url / model / key 三件套是否对得上
  if (msg.type === 'testLlm') {
    (async () => {
      const cfg = { apiKey: msg.apiKey, baseUrl: msg.baseUrl, model: msg.model };
      const miss = ['apiKey', 'baseUrl', 'model'].filter((k) => !cfg[k]);
      if (miss.length) { sendResponse({ ok: false, error: '还没填：' + miss.join(' / ') }); return; }
      try {
        const out = await llmTranslateBatch(['Good morning, everyone.'], 'en', msg.tl || 'zh-CN', cfg);
        const t = String((out.results && out.results[0]) || '').trim();
        if (!t) { sendResponse({ ok: false, error: '接口通了但没返回译文，请检查模型名是否正确' }); return; }
        sendResponse({ ok: true, text: t, model: cfg.model, endpoint: llmEndpointCandidates(cfg.baseUrl)[0] });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true;
  }
  if (msg.type === 'dictLookupOne') {
    chrome.storage.local.get({ userDict: {} }, (r) => {
      sendResponse({ ok: true, hit: dictLookup(r.userDict || {}, msg.word) });
    });
    return true;
  }
});
