'use strict';

async function lookupWord(word) {
  const url = 'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word.toLowerCase());
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, notFound: true, word };
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
    return { ok: true, word, phonetics: [...new Set(phonetics)], meanings: meanings.slice(0, 6) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'lookup') {
    lookupWord(msg.word)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // 异步响应
  }
});
