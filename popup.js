'use strict';

const $ = (id) => document.getElementById(id);

function toggleEudicHint() {
  const box = $('eudicBox');
  if (box) box.classList.toggle('show', $('dictSource').value === 'eudic');
}

function loadSettings() {
  chrome.storage.sync.get(['enabled', 'autoPause', 'dictSource', 'eudicAction'], (r) => {
    $('enabled').checked = r.enabled !== false;
    $('autoPause').checked = !!r.autoPause;
    $('dictSource').value = r.dictSource || 'api';
    $('eudicAction').value = r.eudicAction || 'lp-dict';
    toggleEudicHint();
  });
}

function saveSettings() {
  chrome.storage.sync.set({
    enabled: $('enabled').checked,
    autoPause: $('autoPause').checked,
    dictSource: $('dictSource').value,
    eudicAction: $('eudicAction').value
  });
}

function renderVocab() {
  chrome.storage.local.get({ vocab: [] }, (r) => {
    const list = r.vocab || [];
    const box = $('vocab');
    if (!list.length) {
      box.innerHTML = '<div class="empty">还没有保存单词。在视频字幕里双击单词即可加入。</div>';
      return;
    }
    box.innerHTML = list.map((v) => {
      const d = new Date(v.addedAt);
      const t = (d.getMonth() + 1) + '/' + d.getDate();
      return `<div class="item"><span class="w">${v.word}</span><span class="t">${t}</span></div>`;
    }).join('');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  renderVocab();
  ['enabled', 'autoPause', 'dictSource', 'eudicAction'].forEach((id) => {
    $(id).addEventListener('change', saveSettings);
    $(id).addEventListener('input', saveSettings);
  });
  $('dictSource').addEventListener('change', toggleEudicHint);
  $('clearVocab').addEventListener('click', () => {
    if (confirm('确定清空生词本？')) {
      chrome.storage.local.set({ vocab: [] });
      renderVocab();
    }
  });
});
