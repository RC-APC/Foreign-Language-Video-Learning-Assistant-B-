'use strict';

const $ = (id) => document.getElementById(id);

function toggleEudicHint() {
  const box = $('eudicBox');
  if (box) box.classList.toggle('show', $('dictSource').value === 'eudic');
}

// 各家的 OpenAI 兼容地址与推荐模型。模型名会随平台更新而变，
// 这里只做"帮你填个默认值"，真正以各家控制台显示的为准（所以配了测试连接按钮）。
const LLM_PRESETS = {
  deepseek: { base: 'https://api.deepseek.com', model: 'deepseek-flash', note: 'DeepSeek 不免费但极便宜：输入 $0.15 / 百万 tokens，充 10 元能用很久。Key 在 platform.deepseek.com 创建。' },
  siliconflow: { base: 'https://api.siliconflow.cn/v1', model: 'tencent/Hunyuan-MT-7B', note: '硅基流动：tencent/Hunyuan-MT-7B 是腾讯的翻译专用模型，目前输入输出免费（免费名单会变，以 siliconflow.cn/pricing 为准）。需实名注册。' },
  siliconflow2: { base: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct', note: '硅基流动其他模型：控制台挑一个付费模型名填进去即可，注册送额度。' },
  zhipu: { base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', note: '智谱开放平台：glm-4-flash 系列长期免费，新用户另有免费 tokens。 Key 在 open.bigmodel.cn 控制台领。' },
  moonshot: { base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', note: 'Moonshot / Kimi：platform.moonshot.cn 创建 Key。' },
  qwen: { base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', note: '阿里云百炼：用「OpenAI 兼容模式」的这个地址，Key 在 bailian.console.aliyun.com 创建。' },
  volc: { base: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-lite-4k', note: '火山方舟：控制台创建「推理接入点」后，模型名填接入点 ID（形如 ep-xxxx）。' },
  openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', note: 'OpenAI：国内网络通常需代理。' },
  groq: { base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', note: 'Groq：有免费额度，国内网络通常需代理。' },
  ollama: { base: 'http://localhost:11434/v1', model: 'qwen2.5:7b', note: '本地 Ollama：先 ollama pull qwen2.5:7b 并 ollama serve，完全离线不花钱，但速度取决于本机。' },
  custom: { base: '', model: '', note: '自定义或中转站：照着 OpenAI 兼容格式填 Base URL + 模型名 + Key。' }
};

function applyPreset(key, fillNote) {
  const p = LLM_PRESETS[key];
  if (!p) return;
  if (p.base) $('llmBase').value = p.base;
  if (p.model) $('llmModel').value = p.model;
  if (fillNote && p.note) showLlmResult('info', p.note);
  toggleLlmBox();
}

function toggleLlmBox() {
  const on = $('llmOn').checked;
  $('llmBox').classList.toggle('show', on);
  if (on && !$('llmBase').value && !$('llmModel').value) applyPreset($('llmPreset').value, false);
}

function showLlmResult(kind, text) {
  const el = $('llmResult');
  if (!el) return;
  el.classList.add('show');
  el.classList.toggle('ok', kind === 'ok');
  el.innerHTML = text;
}

function hostPermissionOf(baseUrl) {
  let b = String(baseUrl || '').trim();
  if (!b) return null;
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b;
  try {
    const u = new URL(b);
    return u.origin + '/*';
  } catch (e) { return null; }
}

// 自定义域名需要 host 权限，否则后台 fetch 会被内核直接拦掉（连错误都看不到）
function ensurePermission(baseUrl) {
  return new Promise((resolve) => {
    const origin = hostPermissionOf(baseUrl);
    if (!origin) { resolve(true); return; }
    try {
      chrome.permissions.contains({ origins: [origin] }, (has) => {
        if (has) { resolve(true); return; }
        chrome.permissions.request({ origins: [origin] }, (granted) => {
          resolve(!!granted);
        });
      });
    } catch (e) { resolve(false); }
  });
}

function loadSettings() {
  chrome.storage.sync.get(['enabled', 'autoPause', 'dictSource', 'eudicAction', 'autoTranslate', 'trEngine', 'translateTarget', 'panelOpacity', 'textOpacity'], (r) => {
    $('enabled').checked = r.enabled !== false;
    $('autoPause').checked = !!r.autoPause;
    $('dictSource').value = r.dictSource || 'api';
    $('eudicAction').value = r.eudicAction || 'lp-dict';
    $('autoTranslate').checked = r.autoTranslate !== false;
    $('trEngine').value = r.trEngine || 'auto';
    $('translateTarget').value = r.translateTarget || 'zh-CN';
    const op = (typeof r.panelOpacity === 'number' && r.panelOpacity > 0) ? Math.round(r.panelOpacity * 100) : 85;
    $('panelOpacity').value = op;
    $('opVal').textContent = op + '%';
    const tx = (typeof r.textOpacity === 'number' && r.textOpacity >= 0) ? Math.round(r.textOpacity * 100) : 100;
    $('textOpacity').value = tx;
    $('txVal').textContent = tx + '%';
    toggleEudicHint();
  });
  // API Key 只存本地，不进 sync（不上传到浏览器账号）
  chrome.storage.local.get({ llm: {} }, (r) => {
    const c = r.llm || {};
    $('llmOn').checked = !!c.on;
    if (c.baseUrl) $('llmBase').value = c.baseUrl;
    if (c.model) $('llmModel').value = c.model;
    if (c.apiKey) $('llmKey').value = c.apiKey;
    if (c.preset) $('llmPreset').value = c.preset;
    toggleLlmBox();
  });
}

function saveSettings() {
  chrome.storage.sync.set({
    enabled: $('enabled').checked,
    autoPause: $('autoPause').checked,
    dictSource: $('dictSource').value,
    eudicAction: $('eudicAction').value,
    autoTranslate: $('autoTranslate').checked,
    trEngine: $('trEngine').value,
    translateTarget: $('translateTarget').value,
    panelOpacity: (parseInt($('panelOpacity').value, 10) || 85) / 100,
    textOpacity: (parseInt($('textOpacity').value, 10) || 100) / 100
  });
  chrome.storage.local.set({
    llm: {
      on: $('llmOn').checked,
      baseUrl: $('llmBase').value.trim(),
      model: $('llmModel').value.trim(),
      apiKey: $('llmKey').value.trim(),
      preset: $('llmPreset').value
    }
  });
}

function testLlm() {
  const baseUrl = $('llmBase').value.trim();
  const model = $('llmModel').value.trim();
  const apiKey = $('llmKey').value.trim();
  const btn = $('llmTest');
  if (!baseUrl || !model || !apiKey) {
    showLlmResult('err', '❌ 还差东西：API 地址 / 模型名 / Key 三项都要填。');
    return;
  }
  btn.disabled = true;
  btn.textContent = '测试中…';
  showLlmResult('info', '正在请求…（若首次用这个域名，会弹一次授权请求，选「允许」）');
  ensurePermission(baseUrl).then((ok) => {
    if (!ok) {
      btn.disabled = false; btn.textContent = '测试连接';
      showLlmResult('err', '❌ 域名未授权，浏览器会拦掉请求。重试点「测试连接」并在弹窗里选「允许」。');
      return;
    }
    chrome.runtime.sendMessage(
      { type: 'testLlm', baseUrl: baseUrl, model: model, apiKey: apiKey, tl: $('translateTarget').value },
      (res) => {
        btn.disabled = false; btn.textContent = '测试连接';
        if (!res || chrome.runtime.lastError) {
          showLlmResult('err', '❌ 后台无响应：' + ((chrome.runtime && chrome.runtime.lastError && chrome.runtime.lastError.message) || '未知'));
          return;
        }
        if (res.ok) {
          showLlmResult('ok', '✅ 通了！「Good morning, everyone.」→ 「' + escapeHtml(res.text) + '」');
        } else {
          showLlmResult('err', '❌ ' + escapeHtml(res.error || '失败') + '<br>对照：401/403=Key 错；404=地址或模型名错；429=限流/额度用尽。');
        }
      }
    );
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
  ['enabled', 'autoPause', 'dictSource', 'eudicAction', 'autoTranslate', 'trEngine', 'translateTarget',
    'llmOn', 'llmPreset', 'llmBase', 'llmModel', 'llmKey'].forEach((id) => {
    $(id).addEventListener('change', saveSettings);
    $(id).addEventListener('input', saveSettings);
  });
  // 透明度滑块：实时更新百分比标签（saveSettings 已经把数值写进 storage，面板会随之变化）
  $('panelOpacity').addEventListener('input', () => {
    $('opVal').textContent = $('panelOpacity').value + '%';
    saveSettings();
  });
  $('panelOpacity').addEventListener('change', saveSettings);
  $('textOpacity').addEventListener('input', () => {
    $('txVal').textContent = $('textOpacity').value + '%';
    saveSettings();
  });
  $('textOpacity').addEventListener('change', saveSettings);
  $('dictSource').addEventListener('change', toggleEudicHint);
  $('llmOn').addEventListener('change', () => {
    toggleLlmBox();
    if ($('llmOn').checked) {
      $('trEngine').value = 'llm';   // 开了大模型就默认用它，省得还要再选一次
    } else if ($('trEngine').value === 'llm') {
      $('trEngine').value = 'auto';  // 关掉后别停在"仅大模型"，否则会直接报"未配置"
    }
    saveSettings();
  });
  $('llmPreset').addEventListener('change', () => applyPreset($('llmPreset').value, true));
  $('llmTest').addEventListener('click', testLlm);
  $('clearVocab').addEventListener('click', () => {
    if (confirm('确定清空生词本？')) {
      chrome.storage.local.set({ vocab: [] });
      renderVocab();
    }
  });
});
