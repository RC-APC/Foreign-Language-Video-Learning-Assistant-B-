# Language Learning Video Assistant · Browser Extension

> Turn **Bilibili / YouTube** videos into study material: a clickable subtitle list, shadowing, word lookup, vocabulary notebook, spaced-repetition review, and an offline dictionary.
> All data stays in your browser (`chrome.storage.local`) — **no login, no account, nothing uploaded**.

**Version v0.7.36** · MV3 · Chrome / Edge / Quark / Kiwi · MIT License

[**English**](#-english) · [**中文**](#-中文)

---

# 🇬🇧 English

## What it does

The hard part of learning from foreign-language videos isn't *seeing* subtitles — it's turning them into studyable material. This extension splits the CC track into a per-sentence list and wires up a full loop: **shadow → look up → save → review**.

### Subtitles
- **Sentence-by-sentence subtitle list** on the right, with the current line auto-highlighted and auto-scrolled.
- **Multi-track selection** — lists all CC tracks (English / 中文 / 日本語 …) and auto-selects a **non-Chinese track** by default (learn from the original).
- **Dual subtitles** — show a primary track plus a secondary track simultaneously (e.g. English original + Chinese translation).
- **Click a line to shadow (▶)** — jumps to that line and plays it. Whether it **auto-pauses at the end of the line follows the "Pause" toggle**: off = keep playing continuously, on = stop after that one line. ASR caption segmentation often disagrees with what your ear calls "one sentence" (`to` bleeding into the next line, or one sentence split into rolling events), so the stop point is **clamped to where the next line actually starts** — one click plays one line, not two.
- **AI translation track (new)** — when a video has only an original-language CC track and no track in your **native language**, the whole track is translated into your native language and added as a **new "（AI 翻译）" track**. It shows up in the dropdown like a native track: selectable as the primary track, and auto-assigned as the secondary (dual-subtitle) track. The **"译中文"** button (label follows your native language) triggers it manually and stops a run in progress.
- **Three interchangeable translation engines** — **LLM API** (DeepSeek / SiliconFlow / Zhipu GLM / Moonshot / Qwen / OpenAI…, best quality, bring your own key) → **free Google endpoint** → **MyMemory** (usually reachable from mainland China). Default "auto" relays through them in order: if the LLM gets rate-limited halfway, the free engines fill the remaining lines so the track never has gaps. See the Chinese section「大模型翻译接口怎么填」for how to fill in base URL / model / key.
- **Progressive translation (translated lines appear as they arrive)** — a 200+ line video no longer sits blank for a minute. Lines are translated in **batches (the first batch is only 8 lines, so results show up almost immediately; 20 lines after that)**, and **after every batch the partial result is written into the translation track and re-rendered**, so Chinese lines keep flowing into the floating window. The status bar shows "N/M lines · K on screen", and hitting **Stop** keeps whatever has already been translated. Results are only **cached when essentially complete** (a half-translated cache would otherwise be hit forever and never finish).
- **Live subtitle row** — shows the current line, and every word in it is **clickable**.
- **Shadowing score (🎤)** — click 🎤 to record your read-aloud of that line through the **microphone** (mic audio only, not the tab), click ■ to stop. The browser's **speech recognition** transcribes what you said and we score **word-level similarity** against the original line (green ≥80 / amber ≥60 / red <60), with **replay your take / the original** and re-record. Available both on list rows and on the floating window's live row (hide it with the 🎤 toggle in the title bar).

### Lookup & dictionaries
- **Click a word to look it up, double-click to save it** — works on both the subtitle list and the floating window's live row, sharing one code path.
- Dictionary source is configurable:
  - **Local dictionary (highest priority by default)** — returns instantly and **fully offline** when the word is in an imported dictionary;
  - **Online** — `dictionaryapi.dev`, falling back to Wiktionary;
  - **Eudic (local app)** — opens the native Eudic app via the `eudic://` URL scheme (supports Japanese and many other languages);
  - **LLM (best)** — asks your configured LLM (with the sentence as context) for part-of-speech / meaning / usage / example, and **auto-fills the translation into the saved-word note on double-click**.
- **Import dictionary files directly** — plain-text dictionaries (one word per line, followed by `n./v./a./ad./abbr.`-prefixed definitions), plus `word<TAB|space|colon>definition` and JSON. **GBK / UTF-8 auto-detection**, "clear before import" to replace the whole book, and one-click clear.

### Vocabulary notebook & review
- Entries carry a **note**, a `box` (1–5) and a `due` timestamp.
- **Definitions are shown right in the list** (read from the local dictionary, offline) — no need to enter review mode just to see them.
- **Lemmatization** — saved words are often inflected (`created` / `written` / `studies` / `biggest`); lookup restores the base form (irregular table + suffix rules + consonant doubling) and labels the source when it hits.
- If a word isn't found: `🔍 Look up online` or `✎ Edit word` (turn an inflection into its base form).
- **Spaced repetition (Leitner)** — after "Remember / Forgot", the definition **and your note** are revealed, and the next interval is adjusted (10 min / 1 h / 1 d / 3 d / 7 d).
- **Standalone notebook page** (`vocab.html`) — usable without opening a video; bookmarkable. Supports **export / import JSON backup**.

### Interface
- **Floating window (▢)** — collapses the panel to a small window showing only the current subtitle line (or two, for dual subtitles). It's **draggable (mouse + touch)** and **word-clickable** — great for minimal shadowing in the corner.
- **Works in real fullscreen** — entering fullscreen temporarily re-parents the panel into the fullscreen element (otherwise the browser paints nothing outside it), auto-switches it to floating mode, and puts it back where it was when you exit.
- **Minimize (–)** — collapses the whole panel into a title bar.
- **Diagnostics** — dumps page structure / subtitle source / fetch details; hit **"Copy report"** to paste into a bug report.

## Supported sites

| Site | Status | Notes |
|---|---|---|
| **Bilibili** | ✅ Full support | Uses the Bilibili subtitle API (`x/player/wbi/v2`, requires login). Works for regular videos and bangumi/drama. |
| **YouTube** | ✅ Full support | A MAIN-world script extracts `captionTracks`; body parsing supports **JSON3 / WebVTT / XML**; SPA video switches are re-parsed automatically. |

> Requirement: the video must have a **selectable CC track**. Hard-burned subtitles and browser-built-in **AI live captions** (rendered in the kernel's private layer, outside the page DOM) cannot be read.

## Install (load unpacked, no build step)

1. Open the extensions page:
   - Chrome / Edge / Quark: type `chrome://extensions` (`edge://extensions` for Edge)
   - Kiwi Browser (Android): menu → Extensions
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this directory (the folder containing `manifest.json`).
4. Open a video **with CC subtitles**:
   - Bilibili: `/video/` or `/bangumi/play/` — **sign in to Bilibili** (the subtitle API needs login)
   - YouTube: any video with CC
5. The panel appears on the right, lists tracks and loads the original text; play to shadow / look up / save / review.
6. **After editing code**: click the extension's **Refresh** icon, then reload the video page (otherwise the page still runs the old script).

> ⚠️ After changing the **MAIN-world script registration** in `manifest.json`, you **must refresh the extension** — MAIN-world scripts are not hot-reloaded.

## Tips

- **Learn from the original**: the panel auto-selects a non-Chinese track. For "original + Chinese", pick the Chinese track in the "Compare" dropdown, then switch to the floating window — it stacks two lines.
- **Continuous listening**: turn the "Pause" toggle **off** — clicking a line plays continuously from there. Turn it on to stop after one line.
- **A word won't resolve**: it's probably an inflection (`written` / `studies`). Use `✎ Edit word`, or rely on automatic lemmatization. If *nothing* resolves, check whether the dictionary imported successfully (notebook page → 📖 Local dictionary).
- **Standalone notebook**: bookmark `chrome-extension://<extension-id>/vocab.html` to review anytime without a video.

## Known limitations

- **Hard-burned subtitles**: if the video only has burned-in subtitles and no selectable CC track, the original text is unreachable (diagnostics will show "CC tracks: 0").
- **Browser AI live captions** (e.g. Quark) render in a private UI layer, not in the page DOM, so they can't be read.
- **Bilibili subtitles require login**; without it the API may return empty.
- **Downloaded audio is webm/opus**, not mp3 — playable anywhere; convert if you need mp3.
- **Binary dictionaries** (Eudic MDX / StarDict) can't be parsed inside the extension — convert to plain text first.
- **Space-less languages like Japanese**: a whole sentence becomes one clickable unit (and online dictionaries are weak for Japanese — use a local Eudic dictionary).

## Project layout

```
lang-learn-extension/
├── manifest.json          # MV3 manifest (incl. YouTube MAIN-world script)
├── content.js             # Core: subtitle fetching/parsing, list, shadowing, lookup, vocab, review, floating window, diagnostics
├── content.css            # Panel / floating window / popup styles
├── yt-main.js             # YouTube MAIN-world script: read player response, intercept subtitle requests, postMessage to the extension
├── background.js          # Service worker: lookup proxy, lemmatization, batch local-dictionary queries
├── popup.html/js/css      # Toolbar popup: toggles, dictionary source, quick vocab view
├── vocab.html / vocab.js  # Standalone notebook: review, import/export, local dictionary management
├── test-*.js              # Node tests (see below)
├── LICENSE                # MIT License
└── README.md
```

## Tests

Self-contained Node tests (no dependencies):

| Test | Covers |
|---|---|
| `test-parse.js` | Dictionary parsing (GBK decoding, POS segmentation, misalignment, `<br>` cleanup) |
| `test-lemma.js` | Lemmatization (irregular table, suffix rules, consonant doubling, irregular plurals) |
| `test-live-words.js` | Floating-window live row word-clickability + no per-frame DOM rebuild |
| `test-vocab-smoke.js` | Standalone notebook init & render |
| `test-yt.js` | YouTube response brace-matching extraction, track parsing |
| `test-yt-fmt.js` | YouTube subtitle body parsing for JSON3 / VTT / XML |
| `test-yt-bridge.js` | MAIN-world bridge: track forwarding, videoId validation, handshake resend, request interception |
| `test-css-structure.js` | CSS structural audit (brace balance, dangling commas, empty rules) |
| `test-sticky-cue.js` | Cue boundary: while paused on `prev.to == next.from` the just-heard line stays locked (▶ and 🎤 must target the same line) |
| `test-autopause.js` | Auto-pause state machine: arms once, pauses at line end, survives "rolling" ASR captions whose `to` keeps extending, refuses expired targets, seek guard, and clamps the stop point to the next line's start ("one line plays two sentences") |
| `test-progressive-tr.js` | Progressive translation: batch schedule (small first batch, gapless coverage), partial-text → partial track, per-batch screen update contract, no caching of half-done results |
| `test-pron-score.js` | Shadowing score: word-level F1 similarity, edit-distance ≤1 tolerance, colour thresholds |
| `test-translate.js` | AI track: batch chunking, gtx parsing, fallback to per-line when counts mismatch, MyMemory fallback, virtual-track selection & body retrieval, LLM endpoint normalization |
| `test-translate-flow.js` | (needs `npm i jsdom`) end-to-end run of `content.js`: auto-translate → build translated track → assign as secondary → switch primary track |

```bash
node test-parse.js
node test-lemma.js
node test-translate.js
node test-autopause.js
node test-progressive-tr.js
node test-sticky-cue.js
node test-live-words.js
# end-to-end (optional dependency)
npm i jsdom && node test-translate-flow.js && node test-translate-flow.js has-zh
```

## Version highlights (selected)

- **v0.7.36** **Stop at the right line, and translated lines stream in.** ① *"One line plays two sentences"*: ASR caption segmentation doesn't match what your ear hears — a cue's `to` often extends into the next sentence (or the same sentence is split into overlapping rolling events). The auto-pause stop point is now **clamped to where the next distinct line starts** (`effectiveCueEnd`), so replaying one line stops at that line; ordinary CC (where `next.from == cur.to`) is mathematically unchanged. Because the clamp can land the pause between two cues' `to` values, the "just-heard line is locked" state now uses the row recorded when the target was armed instead of a ±0.05s lookup. ② *Progressive translation*: translation is now chunked (first batch **8 lines**, then 20), and **every batch is written to the translation track and re-rendered immediately**, so Chinese appears in the floating window within seconds instead of after the whole 200+ line job; the status bar shows lines done / on screen, Stop keeps the partial result, and only a nearly-complete result is cached. Also removed the dead `tabCapture` / `downloads` audio-download code and its permissions, and the diagnostic report now shows the clamped play-end per line plus progressive-translation progress.
- **v0.7.35** **Auto-pause actually pauses now.** Two root causes, both fixed: ① auto-pause lived inside the `timeupdate` callback, but YouTube builds its `<video>` element with JS (and swaps it on SPA navigation) — if the element didn't exist when the content script booted, the listener was never attached and auto-pause, highlighting and the live line all failed silently; there's now a 1s self-healing re-attach plus a dedicated 150ms timer that drives auto-pause independently of `timeupdate`. ② The target was re-armed from "the current line's end" on every tick, but YouTube's auto-generated captions often split one sentence into several events whose `to` keeps extending — so the target kept sliding forward and was never reached (measured: target at 8.9s while playback sat at 6.0s → never paused). The target is now armed **once** and never pushed later. Also: a 0.9s guard after a programmatic seek prevents "press ▶ and it pauses instantly", and the diagnostic report now shows whether video events are attached, the auto-pause state/target/last pause, and subtitle-timeline overlap stats.
- **v0.7.34** **Fixes & polish** — the 🎤 button now reliably sits at the **end of the subtitle line** (the text item used `flex-basis: auto`, whose max-content width pushed the button onto a new row; now `flex-basis: 0`). The **"Back to subtitle list"** button is now readable (it reused a white-on-transparent style meant for the dark title bar, so it was white-on-white and effectively invisible). With auto-pause on, the live line **no longer jumps to the next cue while paused** (caption boundaries are shared, so at `t == prev.to` the cursor used to slide forward — now the line you just heard is locked until you play or seek, which is what made ▶ play one line while 🎤 targeted the next). The small-window shadowing buttons are now **hideable** via the 🎤 toggle in the title bar (choice is remembered).
- **v0.7.33** **Inline 🎤 button + shadowing in the small window** — the record button now sits at the **end of the subtitle line** (right after the last word, no longer on its own row). The **windowed/floating mode** also gets a ▶ play + 🎤 record pair under the live line, so you can do read-aloud scoring without the list. Live updates freeze while recording so the result panel isn't wiped mid-take.
- **v0.7.32** **Instant scoring** — dropped the slow LLM-only scoring; only the local word-level similarity score remains (speech recognition + word matching, score appears the moment you stop). The bottom hint no longer mentions the removed download button, and the diagnostic message now points at the **"Back to subtitle list" button at the top and bottom of the report** (both are always visible) instead of the confusing "←".
- **v0.7.31** **Sentence shadowing + AI pronunciation scoring** — the per-line ⬇ download button is replaced by a 🎤 record button. Click to record your read-aloud of the line (mic only, no tab audio), click ■ to stop; the browser speech API transcribes your speech, we compute a word-level similarity score, and if an LLM is configured it returns a 0–100 score plus Chinese tips. Replay your take or the original, and re-record. Solves the "can't download audio" issue on some browsers.
- **v0.7.30** **Split floating-window opacity into two independent controls** — *background* opacity and *text* opacity are now separate, so dimming the background no longer washes out the subtitle text. The notebook's **"online lookup" now also routes through the LLM** (when configured), falling back to the online dictionary, instead of always using online translation.
- **v0.7.28** Added **fullscreen support**: entering HTML fullscreen re-parents the panel into the fullscreen element (otherwise nothing outside it gets painted), auto-switches to floating mode, and restores everything on exit.
- **v0.7.27** Added an **LLM translation engine** (any OpenAI-compatible endpoint) with a **Test connection** button, preset providers, and relay fallback to free engines so a partial LLM result still yields a complete track.
- **v0.7.26** Added the **AI Chinese track**: auto-translates the whole CC track into a selectable virtual track, assigns it as the dual-subtitle track, with the manual **"译中文"** button and per-video caching.
- **v0.7.25** Fixed the floating window breaking (a CSS dangling comma merged the hidden-selector group into a new rule); added the CSS structure audit script.
- **v0.7.24** Floating-window live row is now **word-clickable** (click to look up, double-click to save), with a content key to prevent per-frame rebuilds.
- **v0.7.23** Click-to-shadow now **honors the Pause toggle**; diagnostics can **go back** and copy the report; the notebook **shows local-dictionary definitions proactively** + lemmatization (`created → create`) + edit-word / online-lookup.
- **v0.7.22** YouTube subtitles now go through a **MAIN-world interception of the player's own request**, bypassing timedtext's `pot` token check.
- **v0.7.21** Fixed YouTube "tracks but 0 lines"; added the MAIN-world bridge `yt-main.js`, fixing "must refresh on SPA video switch".
- **v0.7.19** Refactored to **site dispatch + adapters**; added YouTube support.
- **v0.7.18** Touch dragging; simultaneous dual subtitles.
- **v0.7.16 ~ v0.7.17** Local dictionary import fixes (GBK garbage, misalignment, compound POS prefixes like `n.&ad.`).
- **v0.7.13** Multi-source lookup (dictionaryapi.dev → Wiktionary → local dictionary).
- **v0.7.7 ~ v0.7.10** Minimize / floating-window modes.
- **v0.6.1** CORS fix (subtitle body switched to `credentials:'omit'`).
- **v0.3** Switched from DOM watching to the Bilibili subtitle API.

## Privacy

- All settings, vocabulary and local dictionaries live in your browser — **nothing is uploaded**.
- Network requests happen only for: word lookup (dictionaryapi.dev / Wiktionary), subtitle fetching (Bilibili / YouTube), and **translation when you turn on the AI Chinese track** (Google / MyMemory, or the LLM endpoint you configured yourself).
- The LLM API key is stored locally and never synced to your browser account.
- No analytics, no tracking, no accounts.

## License

Released under the [MIT License](LICENSE).

---

# 🇨🇳 中文

## 它能做什么

看外语视频最难的不是"看不到字幕"，而是**把字幕变成能学的材料**。这个扩展把视频里的 CC 字幕拆成逐句列表，接上「跟读 → 查词 → 存生词 → 复习」一条完整的学习闭环。

### 字幕层
- 右侧**逐句字幕列表**，播放时当前行自动高亮、自动滚动定位。
- **多轨道选择**：列出视频所有 CC 轨道（如 English / 中文 / 日本語），自动优先选**非中文原文轨道**（学外语就该看原文）。
- **双语叠显**：主轨道 + 对照轨道同时显示，可单独指定第二条轨道（如"英文原文 + 中文对照"）。
- **AI 译文轨道**：CC 只有原文、没有「母语」轨道时，自动把整条字幕翻译成**你的母语**，**生成一条新的「（AI 翻译）」轨道**——它跟原生轨道一样出现在下拉里，可选为主轨道（列表全母语），默认自动挂到「对照」位（窗口化浮窗里原文下方叠一行母语译文）。按钮文案「译中文」也会跟随母语变化。也可点面板上的 **「译中文」** 手动触发 / 中途停止。
- **翻译引擎三选一**：**大模型 API**（DeepSeek / 硅基流动 / 智谱 / Kimi / 通义 / OpenAI…，质量最好）→ **Google 免费端点** → **MyMemory**（国内通常可达）。默认「自动」按这个顺序接力：大模型限流只译出一半时，剩下的自动由免费接口补上，轨道不会缺行。
- **译文边翻边上屏（渐进式）**：200 多行的长视频不再"点完等一分多钟什么都看不到"——插件按块翻译（**首块只有 8 行**，几乎立刻出结果；之后每块 20 行），**每译完一块就把已有译文写进译文轨道并刷新**，窗口化浮窗里中文一行行往外冒。状态栏实时显示「已翻 N/M 行 · 已上屏 K 行」，中途点「停止」会保留已经翻好的部分。只有**基本翻全**时才会把结果写进缓存（否则半截结果会被缓存、下次永远补不齐）。
- **点击跟读（▶）**：跳转到该句开头播放；**点句是否自动暂停，跟随「暂停」开关**——开关关着就连续播放、开着就放完这一句停下。ASR 字幕的分段常与"人耳听到的句子"不一致（`to` 越界到下一句、或同句被拆成多条滚动事件），插件会把停止点**收紧到下一句真正开始的地方**，所以是"点一句、停一句"，不会读两句才停。
- **实时字幕行**：显示当前时间点对应的字幕，**逐词可点**。
- **跟读录音打分（🎤）**：点 🎤 用麦克风录下你跟读这一句（**只录人声，不录视频声**），点 ■ 停止；浏览器语音识别把你的话转成文字，先给**逐词相似度**基础分（绿≥80 / 橙≥60 / 红<60），可回放「我的录音 / 原句」再读一遍。列表行和窗口化小窗的实时行都能用（小窗里的按钮可用标题栏 🎤 开关隐藏）。

### 查词与词典
- **点单词查释义，双击存生词**——字幕列表和浮窗那行字都能点，共用同一套逻辑。
- 查词来源可在设置里切换：
  - **本地词库（默认最高优先级）**：导入的整本词典命中即返回，**离线、零延迟**；
  - **在线词典**：`dictionaryapi.dev` → Wiktionary 兜底；
  - **本地欧路词典**：通过 `eudic://` 官方 URL Scheme 唤起本机欧路查词（支持日语等任意语种）；
  - **大模型 AI 翻译（质量最好）**：把单词连同**所在句子语境**一起问你配置的大模型，返回「词性 / 释义 / 说明 / 例句」结构化卡片；**双击存生词时自动把译文写进注释**。
- **本地词库可直接导入词典文件**：支持牛津 / CSDN 等下载的纯文本 TXT 词典（每行一个单词、下接 `n./v./a./ad./abbr.` 等词性释义行），也支持 `单词<TAB或空格或冒号>释义` 及 JSON；**自动识别 GBK / UTF-8 编码**，支持「导入前清空」整本替换与一键清空。

### 生词本与复习
- 生词条目带**注释**、`box(1–5)` 与 `due` 时间戳。
- **列表里直接显示释义**（来自本地词库，纯本地读取），不必进复习才看得到。
- **词形还原**：存进去的往往是 `created` / `written` / `studies` / `biggest` 这类变形，查库时自动还原到原形再匹配（不规则表 + 规则词缀 + 辅音双写），命中会标注来源。
- 未收录时可一键 `🔍 联网查` 或 `✎ 改词`（把变形改成词典原形）。
- **记忆曲线复习（Leitner 间隔重复）**：点「记得 / 不记得」后揭晓释义 + 当时填的注释，并调整下次复习间隔（10 分钟 / 1 小时 / 1 天 / 3 天 / 7 天）。
- **独立生词本页面**（`vocab.html`）：不打开视频也能用，可作为书签直接访问。支持**导出 / 导入 JSON 备份**。

### 界面
- **母语 / 界面语言**：设置里的「母语 / 译文语言」下拉决定字幕翻译成什么语言，**面板界面文字也跟随母语**（内置中文 / English / 日本語 / 한국어 四套；其它母语界面仍显示中文，译文语言本身不受限）。
- **窗口化浮窗（▢）**：面板收成一个小窗，只显示当前字幕一行（可双语两行），**可拖动（鼠标 + 触屏）**、**可逐词点查**——适合放视频角落里极简跟读。
- **全屏浮窗透明度可调（背景 / 文字分开）**：设置 →「浮窗与外观」里有**两个独立滑块**——「浮窗背景透明度」和「浮窗文字透明度」。调暗背景不会再把字幕文字一起调糊，二者互不影响；侧边固定面板始终不透明。
- **全屏也能浮窗**：进真正全屏时，面板会被临时挂载到全屏元素里（全屏下浏览器只绘制全屏元素及其后代，挂在 body 上的会被整棵裁掉），并自动切成浮窗模式；退出全屏再搬回原处、还原原来的窗口化状态。
- **最小化（－）**：整个面板收成标题小条。
- **诊断面板**：一键导出页面结构 / 字幕来源 / 抓取详情，出问题时点一下「复制报告」即可反馈定位。

## 支持的网站

| 网站 | 状态 | 说明 |
|---|---|---|
| **Bilibili** | ✅ 完整支持 | 走 B 站字幕 API（`x/player/wbi/v2`，需登录态），普通视频 / 影视番剧均可 |
| **YouTube** | ✅ 完整支持 | 主世界脚本提取 `captionTracks`；正文兼容 **JSON3 / WebVTT / XML** 三种格式；SPA 切视频自动重解析 |
| 翻译引擎 | ✅ 免 Key / 可选填 Key | 默认走 Google 免费端点（`translate_a/t`，`client=gtx`）→ MyMemory，**均不需 API Key**；也可选填任意 OpenAI 兼容的大模型接口提升译文质量 | |

> 前提：视频**必须有可选的 CC 字幕轨道**。UP 主/作者烧进画面的**硬字幕**、以及浏览器自带的 **AI 实时听译字幕**（渲染在内核私有层，不在网页 DOM 内）都无法读取。

### 大模型翻译接口怎么填（可选）

默认那套免费方案能跑，但**机翻质量一般**；想让译文像人翻的，就在插件设置 →「AI 中文字幕」里勾上**用大模型 API 翻译**，填三样东西：

| 字段 | 填什么 | 举例 |
|---|---|---|
| **Base URL** | 厂商给的 OpenAI 兼容地址 | `https://api.deepseek.com` |
| **模型名** | 控制台里的模型 ID，**照抄** | `deepseek-flash` |
| **API Key** | 平台创建的密钥（`sk-` 开头那串） | `sk-xxxxxxxx` |

填完一定点一下 **「测试连接」**——它会真翻一句 `Good morning, everyone.` 并把结果显示出来。常见报错对照：**401/403 = Key 错**，**404 = 地址或模型名错**，**429 = 限流/额度用尽**。

各家的推荐值（**模型名随时会变，以各家控制台为准**）：

| 平台 | Base URL | 模型 | 费用 |
|---|---|---|---|
| **DeepSeek** | `https://api.deepseek.com` | `deepseek-flash` | 不免费但极便宜：输入约 $0.15 / 百万 tokens，输出约 $0.6。充 10 元能用很久 |
| **硅基流动** | `https://api.siliconflow.cn/v1` | **免费填** `tencent/Hunyuan-MT-7B` | 这个是腾讯的**翻译专用模型**，当前输入输出免费（需实名；免费名单会调整，看 siliconflow.cn/pricing） |
| **智谱 GLM** | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` | Flash 系列长期免费，新用户另有免费 tokens |
| Moonshot / Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` | 付费，有赠送额度 |
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | 新人有免费额度 |
| 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3` | 填**接入点 ID**（`ep-xxx`） | 部分模型有免费额度 |
| OpenAI / Groq | `https://api.openai.com/v1` · `https://api.groq.com/openai/v1` | `gpt-4o-mini` · `llama-3.3-70b-versatile` | 国内通常需代理 |
| 本地 Ollama | `http://localhost:11434/v1` | `qwen2.5:7b` | 完全离线免费，速度看本机 |

> ⚠️ **DeepSeek 特别注意**：老教程里的 `deepseek-chat` / `deepseek-reasoner` **已于 2026-07-24 停用**，现在官方模型名是 **`deepseek-flash`**（V4.1 Flash）。照着旧教程填会直接报错。
>
> API Key 只存在本机（`chrome.storage.local`），**不会**同步到浏览器账号，也不参与任何上传。

## 安装（本地加载，无需打包发布）

1. 打开扩展管理页：
   - Chrome / Edge / 夸克：地址栏输入 `chrome://extensions`（Edge 用 `edge://extensions`）
   - Kiwi Browser（安卓）：菜单 → 扩展
2. 右上角打开 **「开发者模式」**。
3. 点 **「加载已解压的扩展程序」**，选择本目录（含 `manifest.json` 的那一层）。
4. 打开一个**带 CC 字幕**的视频：
   - Bilibili：`/video/` 或 `/bangumi/play/`，**需登录 B 站账号**（字幕 API 依赖登录态）
   - YouTube：任意带 CC 的视频
5. 右侧出现面板，顶部自动列出字幕轨道并加载原文；播放后可跟读 / 查词 / 存词 / 复习。
6. **改完代码后**：回扩展管理页点插件的 **「刷新」** 图标，再重载视频页（否则页面里跑的还是旧脚本）。

> ⚠️ 更新过 `manifest.json` 里的 **MAIN world 脚本注册**后，**必须刷新扩展**才会生效——主世界脚本不是热加载的。

## 使用 tips

- **全屏看视频**：按视频的全屏按钮（或双击视频）进真正全屏后，面板会自动切成浮窗叠在画面上，拖标题栏可挪位置；退出全屏会自动还原成原来的样子和位置。B 站的「网页全屏」不用特殊处理，浮窗照样在。
- **学外语先看原文**：面板会自动选非中文轨道；想要"原文 + 中文对照"，在「对照」下拉里选中文轨，然后窗口化，浮窗里就会叠两行。
- **只有英文 CC、没有中文字幕**：字幕加载完会自动翻译成一条「中文（AI 翻译）」轨道并挂到对照位，状态栏会显示进度（`正在翻译成中文… 120/300 行`）；想手动来就点「译中文」，翻译中点它可停止。译文按视频缓存，重看不会重复翻译。
- **翻译失败 / 太慢**：Google 端点在国内通常需要代理；若状态栏提示失败，到插件设置 → AI 中文字幕 → 把引擎改成 **MyMemory**（免 Key，国内通常可达，质量一般）。想要好译文就填个大模型接口（见上文），推荐先用硅基流动的免费翻译模型 `tencent/Hunyuan-MT-7B` 试。
- **换了引擎想重翻**：译文按「视频 + 轨道 + 目标语言 + 引擎」缓存，所以换引擎后在面板点一次「译中文」即可用新引擎重翻；同一个配置下重复点会直接读缓存。
- **想连续听**：把「暂停」开关关掉，点某句就是从该句起连续播放；打开开关才是"放完一句停"。
- **词典导入后查不到词**：多半是生词存的是变形（`written`/`studies`），点 `✎ 改词` 改成原形，或依赖自动词形还原；若整本词典都没释义，检查是否导入成功（生词本页 → 📖 本地词库）。
- **独立生词本**：把 `chrome-extension://<扩展ID>/vocab.html` 存成书签，随时复习，不用开视频。

## 已知限制

- **硬字幕抓不到**：视频只有烧进画面的字幕、没有可选 CC 轨道时，任何方式都拿不到原文（诊断会显示「CC 轨道数: 0」）。
- **浏览器 AI 实时字幕抓不到**：夸克等浏览器的 AI 听译渲染在私有 UI 层、不在网页 DOM 内，扩展无从读取。
- **B 站字幕依赖登录态**：未登录可能返回空或报错。
- **音频下载是 webm/opus**：非 mp3，任意播放器可播，需要 mp3 可自行转码。
- **二进制词典不支持**：欧路 MDX / StarDict 等二进制格式无法在扩展内解析，需先转成纯文本。
- **日语等无空格语言**：整句会是一个可点单元（在线词典的日语支持也较弱，可走欧路本地词库）。
- **免费翻译接口有额度**：Google 端点随时可能限流（429），MyMemory 匿名额度约每日数千字符；长视频可能只翻译出一部分，隔一会再点「译中文」可继续。译文是机器翻译，别当标准答案。
- **超长视频只译前 1500 行**：再长会让免费接口直接限流到全线失败，宁可先给前半段。
- **自定义大模型域名要授权一次**：DeepSeek / 硅基流动 / 智谱 / Kimi / 通义 / 火山 / OpenAI / Groq 已内置在 `host_permissions` 里，**直接用不用授权**；填了列表外的中转站域名时，点「测试连接」会弹一次授权请求，允许后后台才能发出去（否则连错误都看不到，会被内核直接拦掉）。
- **扩展是自签的本地加载版**：没有上架商店，每次更新要到扩展管理页走「开发者模式 → 加载已解压的扩展程序 / 刷新」。
- **极少数网站全屏对象是 `<video>` 自己**：这种情况下任何 DOM 都画不上去（`<video>` 的子元素一律不渲染），扩展会尝试把全屏对象换成上层容器；若浏览器以「无用户手势」为由拒绝，就维持现状——浮窗不会显示，但你的全屏不会被打断。B 站 / YouTube 全屏的都是播放器容器，不受影响。

## 目录结构

```
lang-learn-extension/
├── manifest.json          # MV3 清单（含 YouTube MAIN world 脚本注册）
├── content.js             # 页面主逻辑：字幕拉取/解析、列表、跟读、查词、生词、复习、浮窗、诊断
├── content.css            # 面板 / 浮窗 / 弹层样式
├── yt-main.js             # YouTube 主世界脚本：读播放器响应、截获字幕请求，postMessage 转发
├── background.js          # Service Worker：查词转发、词形还原、批量本地词库查询、字幕整批翻译
├── popup.html/js/css      # 工具栏弹窗：开关、查词来源、AI 中文字幕设置、生词快速查看
├── vocab.html / vocab.js  # 独立生词本页：复习、导出导入、本地词库管理
├── test-*.js              # Node 测试（见下）
├── LICENSE                # MIT 许可证
└── README.md
```

## 测试

仓库自带一套 Node 测试（无需依赖，直接跑），覆盖最容易出错的几处逻辑：

| 测试 | 覆盖内容 |
|---|---|
| `test-parse.js` | 词典文件解析（GBK 解码、词性分段、错位、`<br>` 清洗） |
| `test-lemma.js` | 词形还原（不规则表、规则词缀、辅音双写、不规则复数） |
| `test-live-words.js` | 浮窗实时字幕逐词可点 + 防每帧重建 DOM |
| `test-vocab-smoke.js` | 独立生词本页初始化与渲染 |
| `test-yt.js` | YouTube 响应括号配对提取、轨道解析 |
| `test-yt-fmt.js` | YouTube 字幕正文三格式（JSON3 / VTT / XML）解析 |
| `test-yt-bridge.js` | 主世界桥接：轨道转发、videoId 校验、握手重发、请求截获 |
| `test-css-structure.js` | CSS 结构体检（括号配平、悬挂逗号、空规则） |
| `test-sticky-cue.js` | 句边界锁行：暂停在「上一句 to == 下一句 from」上时，刚听完的那句保持锁定（▶ 与 🎤 必须指向同一句） |
| `test-autopause.js` | 自动暂停状态机：目标只武装一次、播到句尾停住、能扛住"滚动式 ASR 字幕（to 一直往后延伸）"、拒绝过期目标、seek 保护期、并把停止点收紧到下一句起点（修「点一句读两句才停」） |
| `test-progressive-tr.js` | 渐进式翻译：分块调度（首块小、不重不漏）、半截译文只上屏已译行、逐块上屏的流式契约、半截结果不写缓存 |
| `test-pron-score.js` | 跟读打分：逐词 F1 相似度、编辑距离 ≤1 容错、颜色分级阈值 |
| `test-translate.js` | AI 译文轨道：批量分组、gtx 解析、条数不符降级逐条、MyMemory 回退、虚拟轨道挑选与取正文 |
| `test-translate-flow.js` | （需 `npm i jsdom`）端到端跑 `content.js`：自动翻译 → 生成译文轨道 → 挂对照位 → 切主轨道 |
| `test-fullscreen.js` | （需 `npm i jsdom`）全屏浮窗：进全屏改挂到全屏容器、自动切浮窗、退出还原；`<video>` 全屏的换容器补救 |

```bash
node test-parse.js
node test-lemma.js
node test-translate.js
node test-autopause.js
node test-progressive-tr.js
node test-sticky-cue.js
node test-live-words.js
# 端到端（可选依赖）
npm i jsdom && node test-translate-flow.js && node test-translate-flow.js has-zh && node test-fullscreen.js
```

## 主要版本历程（节选）

- **v0.7.36** **停在正确的一行 + 译文边翻边上屏。** ①「点一句、读两句才停」：ASR 字幕的分段和人耳听到的句子并不一致——某行的 `to` 常常越界到下一句里（也可能是同一句被拆成多条互相重叠的滚动事件）。现在自动暂停的停止点会**收紧到"下一句真正开始的地方"**（`effectiveCueEnd`），复读一行就停在这一行；普通 CC（下一行 `from == 本行 to`）算法上完全不变。「刚听完的那一行要锁住」也改成直接用武装目标时记下的那一行——因为收紧后暂停点可能落在两条 cue 的 `to` 之间，按时间反查会失手。②**渐进式翻译**：翻译改成**分块**（首块只 **8 行**，之后每块 20 行），**每译完一块立刻写进译文轨道并刷新**，中文几秒内就开始在浮窗里往外冒，不用等 200 多行全部译完；状态栏显示「已翻 N/M · 已上屏 K」，中途点「停止」保留已翻部分，且**只在基本翻全时才写缓存**。另外删掉了已废弃的 `tabCapture` / `downloads` 单句音频下载代码及其权限；诊断报告新增「每行的实播结束点」与「渐进式翻译进度」。
- **v0.7.35** **自动暂停真的会暂停了。** 两个根因一起修：① 自动暂停原来写在 `timeupdate` 回调里，而 YouTube 的 `<video>` 是 JS 动态建立的（SPA 换视频还会换元素）——内容脚本启动时元素还不存在的话，监听就永远没挂上，自动暂停连同高亮、实时行一起静默失效；现在加了 1s 自愈重挂，并用一个独立的 150ms 时钟驱动自动暂停，不再依赖 `timeupdate`。② 原来每帧都用「当前行的 to」重设目标，而 YouTube 自动生成字幕常把同一句拆成多条、`to` 逐条往后延伸，目标于是被一直往前推、永远追不上（实测：时间才走到 6.0s，目标已被推到 8.9s → 从不暂停）；现在目标**只武装一次**，播放过程中绝不再往后推。另外：程序化跳转后有 0.9s 保护期，避免"一按 ▶ 就立刻暂停"；诊断报告新增「video 事件是否挂上 / 自动暂停状态·当前目标·上次暂停于 / 字幕时间轴重叠统计」三项体检。
- **v0.7.34** **三处修好**：① 🎤 稳定贴在**字幕行末尾**（文字项原来是 `flex-basis: auto`，它的 max-content 宽度会把按钮挤到下一行，改成 `flex-basis: 0`）；② 诊断页的「返回字幕列表」按钮**能看见了**（它复用了给深色标题栏写的白字半透明白底样式，落在浅色区就白字白底）；③ 开着自动暂停时，**停住后实时行不再滑到下一句**（字幕首尾相接，`t` 恰好等于上一句的 to 时会取到下一句——也就是"点播放是这句、点录音变下一句"的原因；现在会把刚听完的那一句锁住，播放或拖进度条后解锁）。小窗里的跟读按钮也**可以隐藏**了：标题栏的 🎤 开关，选择会被记住。
- **v0.7.33** **录音键回到段尾 + 小窗也能跟读**：🎤 按钮不再另起一行，改为贴在**该行字幕末尾右侧**（跟着最后一行文字）。**窗口化小窗模式**下实时字幕行下方也补了 ▶ 播放 + 🎤 录音按钮，列表被隐藏时照样能做跟读打分；录音期间冻结实时行刷新，避免结果面板被冲掉。
- **v0.7.32** **跟读打分秒出**：移除较慢的大模型单独打分，只保留本地逐词相似度（语音识别 + 逐词比对，停止录音立即出分）。底部提示文字不再提及已移除的下载按钮；诊断完成的提示改为明确指向报告**顶部/底部的「返回字幕列表」按钮**（各放一个，滚到哪都能看到），不再用容易误解的「←」。
- **v0.7.31** **整句跟读 + AI 发音打分**：把每行的「⬇ 下载该行音频」按钮**换成 🎤 录音识别按钮**。点 🎤 用麦克风录下你跟读的那一句（只录人声，不录视频声），点 ■ 停止；浏览器语音识别把你说的转成文字，先做逐词相似度打分，若已配置大模型再返回 0–100 分 + 中文改进建议。可回放「我的录音 / 原句」、再读一次。绕开了部分浏览器「无法下载音频」的限制。
- **v0.7.30** 浮窗透明度**拆分为两个独立滑块**：「背景透明度」与「文字透明度」分开调，调暗背景不再连累字幕文字变糊；生词本「🔍 联网查」**在没有释义时也会走大模型**（已配置大模型 API 时优先，命中不到再退回在线词典），不再只走在线翻译。
- **v0.7.28** 新增**全屏浮窗**：进 HTML 全屏时把面板临时挂到全屏元素里（否则会被整棵子树裁掉看不见），自动切浮窗模式，退出全屏自动还原挂载点与原来的窗口化状态。
- **v0.7.27** 新增**大模型翻译引擎**（任意 OpenAI 兼容接口）：预设厂商 + 一键**测试连接** + 地址 `/v1` 容错；多引擎接力——大模型只译出一部分时，剩余行由免费接口自动补齐，轨道不缺行。
- **v0.7.26** 新增 **AI 中文译文轨道**：无中文 CC 时自动翻译整条字幕，生成可选的「中文（AI 翻译）」虚拟轨道并挂到对照位；「译中文」按钮可手动触发/停止；译文按视频缓存。
- **v0.7.25** 修复窗口化浮窗失效（CSS 悬挂逗号把隐藏组并进新规则）；新增 CSS 结构体检脚本。
- **v0.7.24** 窗口化浮窗字幕行改为**逐词可点**（点词查词 / 双击存词），并加 key 去重防止每帧重建。
- **v0.7.23** 点句跟读**尊重暂停开关**；诊断面板可**返回**并支持复制报告；生词本**主动显示本地词库释义** + 词形还原（`created → create`）+ 改词 / 联网查。
- **v0.7.22** YouTube 字幕改走**主世界截获播放器自己的请求**，绕过 timedtext 的 `pot` 令牌校验。
- **v0.7.21** 修复 YouTube「有轨道、0 行」；新增 MAIN world 桥接脚本 `yt-main.js`，解决 SPA 切视频必须刷新才生效。
- **v0.7.19** 架构升级为**站点分发 + 适配器**，新增 YouTube 支持。
- **v0.7.18** 触屏拖拽；双语字幕同时显示。
- **v0.7.16 ~ v0.7.17** 本地词典导入修复（GBK 乱码、错位、组合词性前缀 `n.&ad.`）。
- **v0.7.13** 多源查词（dictionaryapi.dev → Wiktionary → 本地词库）。
- **v0.7.7 ~ v0.7.10** 最小化 / 窗口化浮窗。
- **v0.6.1** 跨域 CORS 修复（字幕正文改 `credentials:'omit'`）。
- **v0.3** 从 DOM 监听改为走 B 站字幕 API。

## 隐私

- 所有设置、生词、本地词典均存于浏览器本地，**不上传任何服务器**。
- 网络请求仅发生在：查词（dictionaryapi.dev / Wiktionary）、拉取视频字幕（B 站 / YouTube）、以及开启翻译时的整批字幕翻译（Google / MyMemory）。翻译只发送字幕文本，不发送任何身份信息。关闭「AI 中文字幕」开关后不再发起翻译请求。
- 无统计、无追踪、无账号体系。

## 许可

本项目采用 [MIT 许可证](LICENSE) 开源。
