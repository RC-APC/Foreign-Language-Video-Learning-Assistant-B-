'use strict';

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
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
  if (msg.type === 'dictLookupOne') {
    chrome.storage.local.get({ userDict: {} }, (r) => {
      sendResponse({ ok: true, hit: dictLookup(r.userDict || {}, msg.word) });
    });
    return true;
  }
});
