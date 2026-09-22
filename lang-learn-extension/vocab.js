// 独立生词本页面：不依赖视频页，可直接从书签栏/扩展选项打开
(function () {
  'use strict';

  const REVIEW_BASE = [0, 1, 2, 4, 7, 15]; // 记忆曲线（天），box 1..5
  function reviewInterval(box) {
    const i = Math.max(1, Math.min(box || 1, REVIEW_BASE.length - 1));
    return REVIEW_BASE[i] * 24 * 3600 * 1000;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const $ = (id) => document.getElementById(id);
  let vocab = [];

  function load(cb) {
    chrome.storage.local.get({ vocab: [] }, (r) => {
      vocab = (r.vocab || []).map((v) => ({ box: 1, due: 0, note: '', addedAt: Date.now(), ...v }));
      if (cb) cb();
    });
  }
  function save(cb) {
    chrome.storage.local.set({ vocab: vocab }, () => { if (cb) cb(); });
  }

  function render() {
    const list = $('list');
    const due = vocab.filter((v) => (v.due || 0) <= Date.now()).length;
    $('stat').textContent = '共 ' + vocab.length + ' 词 · 待复习 ' + due;
    if (!vocab.length) {
      list.innerHTML = '<div class="empty-tip">还没有生词。在 B 站视频里双击字幕单词即可加入。</div>';
      return;
    }
    list.innerHTML = vocab.map((v, i) =>
      '<div class="item" data-i="' + i + '">' +
        '<div class="item-head">' +
          '<span class="word">' + escapeHtml(v.word) + '</span>' +
          '<span class="meta">box ' + (v.box || 1) + '</span>' +
        '</div>' +
        '<div class="def" data-w="' + escapeHtml(v.word) + '">释义加载中…</div>' +
        (v.note
          ? '<div class="note">' + escapeHtml(v.note) + '</div>'
          : '<div class="note empty">（无注释，点「注释」添加）</div>') +
        '<div class="item-actions">' +
          '<button class="ghost" data-act="lookup" data-i="' + i + '">🔍 联网查</button>' +
          '<button class="ghost" data-act="edit" data-i="' + i + '">✎ 改词</button>' +
          '<button class="ghost" data-act="note" data-i="' + i + '">注释</button>' +
          '<button class="danger" data-act="del" data-i="' + i + '">删除</button>' +
        '</div>' +
      '</div>'
    ).join('');

    list.querySelectorAll('button[data-act]').forEach((b) => {
      b.onclick = () => {
        const i = +b.dataset.i;
        const act = b.dataset.act;
        if (act === 'del') {
          if (confirm('删除「' + vocab[i].word + '」？')) {
            vocab.splice(i, 1); save(render);
          }
        } else if (act === 'note') {
          editNote(i);
        } else if (act === 'edit') {
          editWord(i);
        } else if (act === 'lookup') {
          lookupInList(i);
        }
      };
    });
    fillDefs();
  }

  // 主动显示释义：先读本地词库（离线、无请求），未收录的项再按需由用户点「🔍 联网查」
  function fillDefs() {
    const list = $('list');
    if (!list) return;
    const els = Array.from(list.querySelectorAll('.def'));
    if (!els.length) return;
    const words = els.map((el) => el.dataset.w);
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      els.forEach((el) => { el.textContent = '（无法读取本地词库）'; });
      return;
    }
    chrome.runtime.sendMessage({ type: 'dictLookupBatch', words: words }, (resp) => {
      if (!resp || !resp.ok) {
        els.forEach((el) => { el.textContent = '（本地词库不可用，可点「🔍 联网查」）'; });
        return;
      }
      const map = resp.map || {};
      els.forEach((el) => {
        const w = el.dataset.w;
        const hit = map[w];
        if (hit) {
          el.className = 'def hit';
          el.textContent = (hit.pos ? '【' + hit.pos + '】' : '') + hit.def +
            (hit.matched && hit.matched !== w ? '　（' + w + ' → ' + hit.matched + '，已按原形匹配）' : '');
        } else {
          el.className = 'def miss';
          el.textContent = resp.dictSize
            ? '本地词库未收录——点「🔍 联网查」，或点「✎ 改词」改成词典里的原形'
            : '本地词库为空——请先在下方「📖 本地词库」导入词典';
        }
      });
    });
  }

  // 联网查该词，结果只展示（不改生词本）
  function lookupInList(i) {
    const v = vocab[i];
    const list = $('list');
    // 按索引取（.def 与 vocab 同序），避免把带引号的单词拼进属性选择器
    const defs = list ? list.querySelectorAll('.def') : [];
    const el = defs[i];
    if (el) { el.className = 'def'; el.textContent = '联网查词中…'; }
    chrome.runtime.sendMessage({ type: 'lookup', word: v.word }, (resp) => {
      if (!el) return;
      if (resp && resp.ok && resp.meanings && resp.meanings.length) {
        el.className = 'def hit';
        el.textContent = resp.meanings.slice(0, 3).map((m) => (m.pos ? '【' + m.pos + '】' : '') + m.def).join('；') +
          (resp.source ? '　（' + resp.source + '）' : '');
      } else {
        el.className = 'def miss';
        el.textContent = (resp && resp.error) ? ('⚠️ ' + resp.error) : '（未查到释义）';
      }
    });
  }

  // 改词：把变形改成词典里的原形（written → write），便于对上释义
  function editWord(i) {
    const v = vocab[i];
    const next = prompt('修改单词（改成词典中的原形即可对上释义）：', v.word);
    if (next === null) return;
    const nw = next.trim();
    if (!nw || nw === v.word) return;
    const dup = vocab.find((x) => x !== v && x.word.toLowerCase() === nw.toLowerCase());
    if (dup) { alert('生词本里已经有「' + dup.word + '」了。'); return; }
    v.word = nw;
    save(render);
  }

  function editNote(i) {
    const v = vocab[i];
    const list = $('list');
    const el = list.querySelector('.item[data-i="' + i + '"]');
    if (!el) return;
    if (el.querySelector('textarea')) { el.querySelector('textarea').focus(); return; }
    const box = document.createElement('div');
    box.innerHTML =
      '<textarea class="note-edit" placeholder="写点什么帮助记忆…">' + escapeHtml(v.note || '') + '</textarea>' +
      '<div class="item-actions"><button class="ghost" data-save>保存注释</button>' +
      '<button class="ghost" data-cancel>取消</button></div>';
    el.appendChild(box);
    const ta = box.querySelector('textarea');
    ta.focus();
    box.querySelector('[data-save]').onclick = () => {
      v.note = ta.value.trim(); save(render);
    };
    box.querySelector('[data-cancel]').onclick = () => render();
  }

  // 把查词结果渲染到指定元素，并给出清晰的失败原因
  function showDefResult(defId, resp) {
    const el = $(defId);
    if (!el) return;
    if (resp && resp.ok && resp.meanings && resp.meanings.length) {
      const src = resp.source ? '　来源：' + resp.source : '';
      el.textContent = (resp.phonetics && resp.phonetics[0] ? '/' + resp.phonetics[0] + '/ ' : '') +
        resp.meanings.slice(0, 3).map((m) => (m.pos ? '【' + m.pos + '】' : '') + m.def).join('；') + src;
    } else if (resp && resp.error) {
      el.textContent = '⚠️ ' + resp.error + '（可点「✎ 存本地释义」手动补充）';
    } else {
      el.textContent = '（词典未收录该词，可点「✎ 存本地释义」手动补充）';
    }
  }

  // 给某词补/改本地释义
  function addLocalDef(word) {
    chrome.storage.local.get({ userDict: {} }, (r) => {
      const dict = r.userDict || {};
      const key = word.toLowerCase();
      const existing = dict[key] ? dict[key].def : '';
      const def = prompt('为「' + word + '」输入/修改本地释义：', existing);
      if (def === null) return;
      const pos = prompt('词性（可选，如 n. / v.）：', dict[key] ? (dict[key].pos || '') : '');
      if (!def.trim()) return;
      dict[key] = { def: def.trim(), pos: (pos || '').trim() };
      chrome.storage.local.set({ userDict: dict }, () => {
        alert('已保存到本地词库：' + word);
        renderDict();
        // 刷新当前卡片释义（现在会命中本地词库）
        chrome.runtime.sendMessage({ type: 'lookup', word: word }, (resp) => showDefResult('rev-def', resp));
      });
    });
  }

  // ---- 复习 ----
  let queue = [], idx = 0;
  function startReview() {
    const due = vocab.filter((v) => (v.due || 0) <= Date.now());
    if (!due.length) {
      $('review').classList.add('show');
      $('rev-progress').textContent = '';
      $('rev-word').className = 'rev-done';
      $('rev-word').textContent = '🎉 今天没有待复习的词';
      $('rev-reveal').style.display = 'none';
      $('rev-actions').style.display = 'none';
      $('rev-next').style.display = 'inline-block';
      $('rev-next').textContent = '关闭';
      $('rev-next').onclick = closeReview;
      return;
    }
    queue = due.slice();
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    idx = 0;
    $('review').classList.add('show');
    showCard();
  }
  function closeReview() {
    $('review').classList.remove('show');
    render();
  }
  function showCard() {
    if (idx >= queue.length) {
      $('rev-word').className = 'rev-done';
      $('rev-word').textContent = '✅ 本轮复习完成（' + queue.length + ' 词）';
      $('rev-progress').textContent = '';
      $('rev-reveal').style.display = 'none';
      $('rev-actions').style.display = 'none';
      $('rev-next').style.display = 'inline-block';
      $('rev-next').textContent = '关闭';
      $('rev-next').onclick = closeReview;
      return;
    }
    const item = queue[idx];
    $('rev-word').className = 'rev-word';
    $('rev-word').textContent = item.word;
    $('rev-progress').textContent = '复习进度 ' + (idx + 1) + '/' + queue.length;
    $('rev-reveal').style.display = 'none';
    $('rev-def').textContent = '';
    $('rev-note').textContent = '';
    $('rev-actions').style.display = 'flex';
    $('rev-next').style.display = 'none';

    const grade = (remembered) => {
      // 揭晓：释义 + 当时填的注释
      $('rev-reveal').style.display = 'flex';
      $('rev-actions').style.display = 'none';
      $('rev-next').style.display = 'inline-block';
      $('rev-next').textContent = '下一个 →';
      $('rev-next').onclick = () => { idx++; showCard(); };
      if (item.note) { $('rev-note').style.display = 'block'; $('rev-note').textContent = '📝 ' + item.note; }
      else $('rev-note').style.display = 'none';

      // 随时可补本地释义
      $('rev-addlocal').style.display = 'inline-block';
      $('rev-addlocal').onclick = () => addLocalDef(item.word);

      const meansEnglish = /^[A-Za-z]/.test(item.word);
      if (meansEnglish) {
        chrome.runtime.sendMessage({ type: 'lookup', word: item.word }, (resp) => {
          showDefResult('rev-def', resp);
        });
      } else {
        $('rev-def').textContent = '（目标语种生词，请自行回忆拼写与含义，或点「✎ 存本地释义」补充）';
      }

      const now = Date.now();
      item.box = remembered ? Math.min((item.box || 1) + 1, 5) : 1;
      item.due = now + reviewInterval(item.box);
      const orig = vocab.find((x) => x.word === item.word);
      if (orig) { orig.box = item.box; orig.due = item.due; }
      save();
    };
    $('rev-yes').onclick = () => grade(true);
    $('rev-no').onclick = () => grade(false);
  }

  // ---- 本地词库（离线释义）管理 ----
  let userDict = {};
  function loadDict(cb) {
    chrome.storage.local.get({ userDict: {} }, (r) => { userDict = r.userDict || {}; if (cb) cb(); });
  }
  function renderDict() {
    const list = $('dict-list');
    if (!list) return;
    const keys = Object.keys(userDict);
    if (!keys.length) {
      list.innerHTML = '<div class="empty-tip">本地词库为空。网络词典拉不到的单词，可在这里手动补充释义（复习时也能一键补）。</div>';
      return;
    }
    list.innerHTML = keys.map((k) =>
      '<div class="item">' +
        '<div class="item-head"><span class="word">' + escapeHtml(k) + '</span>' +
        (userDict[k].pos ? '<span class="meta">' + escapeHtml(userDict[k].pos) + '</span>' : '') + '</div>' +
        '<div class="note">' + escapeHtml(userDict[k].def) + '</div>' +
        '<div class="item-actions"><button class="danger" data-del="' + escapeHtml(k) + '">删除</button></div>' +
      '</div>'
    ).join('');
    list.querySelectorAll('button[data-del]').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.del;
        if (confirm('删除本地词库词条「' + k + '」？')) {
          delete userDict[k];
          chrome.storage.local.set({ userDict: userDict }, renderDict);
        }
      };
    });
  }

  // ---- 导出 / 导入 ----
  function exportVocab() {
    const data = JSON.stringify({ app: 'lang-learn-extension', version: 1, exportedAt: Date.now(), vocab: vocab }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    a.href = url;
    a.download = 'vocab-export-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  function importVocab(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        const incoming = Array.isArray(obj) ? obj : (obj.vocab || []);
        const map = {};
        vocab.forEach((v) => { map[v.word] = v; });
        let added = 0, noted = 0;
        incoming.forEach((v) => {
          if (!v || !v.word) return;
          if (map[v.word]) {
            if (!map[v.word].note && v.note) { map[v.word].note = v.note; noted++; }
          } else {
            map[v.word] = { word: v.word, note: v.note || '', box: v.box || 1, due: v.due || 0, addedAt: v.addedAt || Date.now() };
            added++;
          }
        });
        vocab = Object.values(map);
        save(() => { render(); alert('导入完成：新增 ' + added + ' 词，补全注释 ' + noted + ' 条'); });
      } catch (e) {
        alert('导入失败：文件格式不正确');
      }
    };
    reader.readAsText(file);
  }

  // ---- 本地词库：词典格式批量导入 ----
  // 解析单行纯文本词典，返回 {word, pos, def} 或 null
  function splitDef(word, rest) {
    if (!word) return null;
    let pos = '', def = (rest || '').replace(/<br\s*\/?>/gi, '；').replace(/<[^>]+>/g, ' ').trim();
    if (!def) return null;
    // 剥离开头音标  /.../  或  [...]  或  /.../
    const strip = def.match(/^(?:\/[^/]+\/|\[[^\]]*\])\s*/);
    if (strip) def = def.slice(strip[0].length).trim();
    // 提取开头词性：n. v. a. ad. adj. adv. vt. vi. prep. pron. conj. int. art. num. abbr. aux. det. excl. phr. 等
    // 支持组合词性前缀（如 "n.&ad."、"prep.&ad."）——词典里常见，须整体剥除
    const POS = /^(n|v|a|ad|adj|adv|vt|vi|prep|pron|conj|int|art|num|abbr|aux|det|excl|phr|sb|sth|esp|usu|pl|sing|inf|pref|suf|comb)\b\.?(?:\s*&\s*(?:n|v|a|ad|adj|adv|vt|vi|prep|pron|conj|int|art|num|abbr|aux|det|excl|phr|sb|sth|esp|usu|pl|sing|inf|pref|suf|comb)\b\.?)*\s*/i;
    const pm = def.match(POS);
    if (pm) {
      pos = def.slice(0, pm[0].length).replace(/\.$/, '').trim();
      def = def.slice(pm[0].length).replace(/^[:：]\s*/, '').trim();
    }
    if (!def) return null;
    return { word: word.trim(), pos: pos, def: def };
  }
  function parseDictLine(line) {
    line = (line || '').trim();
    if (!line) return null;
    // 1) TAB 分隔（最可靠）
    if (line.indexOf('\t') >= 0) {
      const parts = line.split('\t');
      return splitDef(parts[0], parts.slice(1).join(' '));
    }
    // 2) 冒号分隔（中/英），且冒号在行首较近、前面是单词
    const cAt = Math.max(line.indexOf('：'), line.indexOf(':'));
    if (cAt > 0 && cAt < 40 && /^[A-Za-z0-9_\- ]+$/.test(line.slice(0, cAt))) {
      return splitDef(line.slice(0, cAt), line.slice(cAt + 1));
    }
    // 3) 空格分隔：第一段非空白作单词
    const m = line.match(/^(\S+)\s+([\s\S]+)$/);
    if (m) return splitDef(m[1], m[2]);
    return null;
  }

  // 按文件字节自动识别编码：UTF-8(BOM) / UTF-16 / UTF-8 / GBK(默认回退)
  function decodeText(buf) {
    const bytes = new Uint8Array(buf);
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(buf);
    }
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return new TextDecoder('utf-16le').decode(buf);
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return new TextDecoder('utf-16be').decode(buf);
    }
    const utf8 = new TextDecoder('utf-8').decode(buf);
    if (utf8.indexOf('�') === -1) return utf8; // 无乱码 → 当作 UTF-8
    try { return new TextDecoder('gbk').decode(buf); } catch (e) { return utf8; }
  }

  // 通用「单词 + 词性释义行」词典（牛津/CSDN 下载的 TXT、欧路/有道导出均适用）：
  // 每行一个单词标题行，下接若干「词性. 释义」行（可能含 <br>）
  function parsePlainDict(text) {
    // 词性 token 表（含 adv）；组合词性形如 "n.&ad."、"prep.&ad."，须整体识别为词性前缀
    const POS_ONE = '(a|ad|adj|adv|n|v|vt|vi|prep|conj|pron|int|art|num|abbr|aux|det|excl|phr|pl|sing|inf|pref|suf|comb)';
    const POS = new RegExp('^(?!(?:a\\.m\\.|p\\.m\\.|am|pm)(?=\\s|$))' + POS_ONE + '\\.(?:\\s*&\\s*' + POS_ONE + '\\.)*\\s*', 'i');
    // 用于剥除行首词性链（释义延续行里也可能带，如 "prep.&ad. 或者"）
    const POS_CHAIN = new RegExp('^' + POS_ONE + '\\.(?:\\s*&\\s*' + POS_ONE + '\\.)*\\s*', 'i');
    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const cleanBr = (s) => s
      .replace(/<br\s*\/?>/gi, '；')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/；\s*；+/g, '；')   // <br> 转换产生的叠加分隔符
      .replace(/[；\s]+$/g, '')    // 行尾残留分隔符
      .trim();
    // 判断一行（非词性行）是否是真正的「单词标题行」：
    // 必须以英文字母开头，只含字母/空格/连字符/./等；带中文、括号引用 (=...)、引号、逗号的行都是释义延续
    const isHeadword = (w) => {
      if (!/^[A-Za-z][A-Za-z\-'.\/ ]*$/.test(w)) return false;
      if (/[()（）=，,；;""\"]/.test(w)) return false; // 交叉引用/中文标点 → 不是标题
      return w.length <= 40;
    };
    const entries = [];
    let cur = null;
    for (const line of lines) {
      const m = line.match(POS);
      if (m) {
        // 词性释义行：归属到当前单词；若前面没有单词标题行（脏数据）则跳过
        if (!cur) continue;
        const rest = cleanBr(line.slice(m[0].length).replace(/^[:：]\s*/, '').trim());
        if (rest) cur.defs.push(rest);
      } else {
        let w = cleanBr(line);
        if (!w) continue;
        // 防御：标题行本身是纯词性标签（如 "n."）说明格式异常，跳过避免产生脏词条
        if (/^(a|ad|adj|n|v|vt|vi|prep|conj|pron|int|art|num|abbr|aux|det|excl|phr)\.$/i.test(w)) continue;
        // 剥掉标题行尾部的音标（如 "nail /neil/"、"nail [neil]"）
        const ph = w.match(/\s*(\/[^/]+\/|\[[^\]]*\])$/);
        if (ph) w = w.slice(0, ph.index).trim();
        if (isHeadword(w)) {
          // 真正的单词标题行 → 开新词条
          cur = { word: w, defs: [] };
          entries.push(cur);
        } else if (cur) {
          // 释义延续行：(=同义词) 交叉引用、中文注释、a.m. 下的「上午」等 → 归入当前词条
          // 顺带剥掉行首可能残留的词性链（含 "n.&ad." 这类组合词性），避免 "&ad." 漏进释义
          cur.defs.push(cleanBr(w.replace(POS_CHAIN, '')));
        }
        // 既非标题行、前面也没有词条（脏数据）→ 跳过
      }
    }
    return entries
      .filter((e) => e.defs.length)
      .map((e) => ({ word: e.word, pos: '', def: e.defs.join('； ') }));
  }

  function importDictFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result; // ArrayBuffer
      const text = decodeText(buf);
      let entries = [];
      let json = null;
      try { json = JSON.parse(text); } catch (e) { json = null; }
      if (json && typeof json === 'object') {
        // JSON 词典：{word:{def,pos}} 或 [{word,def,pos}] 或 生词导出 {vocab:[...]}
        if (Array.isArray(json)) {
          json.forEach((e) => {
            if (e && e.word) entries.push({ word: e.word, pos: e.pos || '', def: e.def || (e.meanings && e.meanings[0] && e.meanings[0].def) || '' });
          });
        } else if (json.vocab) {
          (json.vocab || []).forEach((e) => { if (e && e.word) entries.push({ word: e.word, pos: '', def: e.note || '' }); });
        } else {
          Object.keys(json).forEach((k) => {
            const v = json[k];
            if (typeof v === 'string') entries.push({ word: k, pos: '', def: v });
            else if (v && v.def) entries.push({ word: k, pos: v.pos || '', def: v.def });
          });
        }
      } else {
        // 按行结构统计判定格式（不能只看是否含 TAB：个别行混入 TAB 会污染整份文件）
        const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        const posRe = /^(?!(a\.m\.|p\.m\.|am|pm))(a|ad|adj|n|v|vt|vi|prep|conj|pron|int|art|num|abbr|aux|det|excl|phr|pl|sing|inf|pref|suf|comb)\.(\s|$)/i;
        let posCount = 0, loneCount = 0;
        lines.forEach((l) => {
          if (posRe.test(l)) posCount++;
          else if (!/\s/.test(l)) loneCount++; // 孤立单词行（标题行）
        });
        // 词性行占多数、且存在大量孤立标题行 → 「单词标题 + 词性释义行」词典（牛津/欧路/有道导出）
        if (posCount >= 10 && posCount > lines.length * 0.25 && loneCount > posCount * 0.3) {
          entries = parsePlainDict(text);
        } else {
          // 否则按「每行一条」解析（TAB 分隔 / 冒号 / 空格分隔）
          lines.forEach((line) => {
            const e = parseDictLine(line);
            if (e && e.def) entries.push(e);
          });
        }
      }
      if (!entries.length) { alert('没有解析出任何词条，请检查文件格式。'); return; }
      if (entries.length > 20000) {
        if (!confirm('该词典含 ' + entries.length + ' 条，导入后可能占用较多本地空间，确定继续？')) return;
      }
      const replace = $('dict-replace') && $('dict-replace').checked;
      chrome.storage.local.get({ userDict: {} }, (r) => {
        const dict = replace ? {} : (r.userDict || {});
        let added = 0, updated = 0;
        entries.forEach((e) => {
          const key = e.word.toLowerCase();
          if (!key || !e.def) return;
          if (dict[key]) {
            if (!dict[key].pos && e.pos) { dict[key].pos = e.pos; updated++; }
            if (!dict[key].def) { dict[key].def = e.def; updated++; }
          } else {
            dict[key] = { def: e.def, pos: e.pos || '' };
            added++;
          }
        });
        chrome.storage.local.set({ userDict: dict }, () => {
          userDict = dict;
          if (replace) $('dict-replace').checked = false;
          renderDict();
          const total = Object.keys(dict).length;
          alert('词典导入完成：' + (replace ? '已整本替换，' : '') + '新增 ' + added + ' 条，补充 ' + updated + ' 条，本地词库现共 ' + total + ' 条释义。');
        });
      });
    };
    reader.readAsArrayBuffer(file);
  }

  // 一键清空本地词库
  function clearDict() {
    if (!confirm('确定清空整个本地词库？此操作不可撤销（建议先点「导出备份」留底）。')) return;
    chrome.storage.local.set({ userDict: {} }, () => {
      userDict = {};
      renderDict();
      alert('已清空本地词库。');
    });
  }

  // ---- 绑定 ----
  $('btn-review').onclick = startReview;
  $('btn-export').onclick = exportVocab;
  $('btn-import').onclick = () => $('file-import').click();
  $('file-import').onchange = (e) => { if (e.target.files[0]) importVocab(e.target.files[0]); };
  $('btn-dict').onclick = () => {
    const d = $('dict');
    if (d.style.display === 'none') { d.style.display = 'block'; renderDict(); }
    else d.style.display = 'none';
  };
  $('dict-add').onclick = () => {
    const w = $('dict-word').value.trim();
    const def = $('dict-def').value.trim();
    const pos = $('dict-pos').value.trim();
    if (!w || !def) { alert('单词和释义都要填'); return; }
    userDict[w.toLowerCase()] = { def: def, pos: pos };
    chrome.storage.local.set({ userDict: userDict }, () => {
      $('dict-word').value = ''; $('dict-def').value = ''; $('dict-pos').value = '';
      renderDict();
    });
  };
  $('btn-dict-import').onclick = () => $('file-dict').click();
  $('file-dict').onchange = (e) => { if (e.target.files[0]) importDictFile(e.target.files[0]); };
  $('btn-dict-clear').onclick = clearDict;

  load(() => { render(); loadDict(renderDict); });
})();
