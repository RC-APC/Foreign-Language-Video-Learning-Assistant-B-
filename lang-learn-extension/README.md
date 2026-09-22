# Language Learning Video Assistant · Browser Extension

> Turn **Bilibili / YouTube** videos into study material: a clickable subtitle list, shadowing, word lookup, vocabulary notebook, spaced-repetition review, and an offline dictionary.
> All data stays in your browser (`chrome.storage.local`) — **no login, no account, nothing uploaded**.

**Version v0.7.25** · MV3 · Chrome / Edge / Quark / Kiwi · MIT License

[**English**](#-english) · [**中文**](#-中文)

---

# 🇬🇧 English

## What it does

The hard part of learning from foreign-language videos isn't *seeing* subtitles — it's turning them into studyable material. This extension splits the CC track into a per-sentence list and wires up a full loop: **shadow → look up → save → review**.

### Subtitles
- **Sentence-by-sentence subtitle list** on the right, with the current line auto-highlighted and auto-scrolled.
- **Multi-track selection** — lists all CC tracks (English / 中文 / 日本語 …) and auto-selects a **non-Chinese track** by default (learn from the original).
- **Dual subtitles** — show a primary track plus a secondary track simultaneously (e.g. English original + Chinese translation).
- **Click a line to shadow (▶)** — jumps to that line and plays it. Whether it **auto-pauses at the end of the line follows the "Pause" toggle**: off = keep playing continuously, on = stop after that one line.
- **Live subtitle row** — shows the current line, and every word in it is **clickable**.
- **Download the line's audio (⬇)** — captures a few seconds of tab audio via `tabCapture` into `line_N.webm`.

### Lookup & dictionaries
- **Click a word to look it up, double-click to save it** — works on both the subtitle list and the floating window's live row, sharing one code path.
- Dictionary source is configurable:
  - **Local dictionary (highest priority by default)** — returns instantly and **fully offline** when the word is in an imported dictionary;
  - **Online** — `dictionaryapi.dev`, falling back to Wiktionary;
  - **Eudic (local app)** — opens the native Eudic app via the `eudic://` URL scheme (supports Japanese and many other languages).
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

```bash
node test-parse.js
node test-lemma.js
# ...
```

## Version highlights (selected)

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
- Network requests happen only for: word lookup (dictionaryapi.dev / Wiktionary) and subtitle fetching (Bilibili / YouTube).
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
- **点击跟读（▶）**：跳转到该句开头播放；**点句是否自动暂停，跟随「暂停」开关**——开关关着就连续播放、开着就放完这一句停下。
- **实时字幕行**：显示当前时间点对应的字幕，**逐词可点**。
- **下载该句音频（⬇）**：用 `tabCapture` 录下那几秒标签页音频，存为 `line_N.webm`。

### 查词与词典
- **点单词查释义，双击存生词**——字幕列表和浮窗那行字都能点，共用同一套逻辑。
- 查词来源可在设置里切换：
  - **本地词库（默认最高优先级）**：导入的整本词典命中即返回，**离线、零延迟**；
  - **在线词典**：`dictionaryapi.dev` → Wiktionary 兜底；
  - **本地欧路词典**：通过 `eudic://` 官方 URL Scheme 唤起本机欧路查词（支持日语等任意语种）。
- **本地词库可直接导入词典文件**：支持牛津 / CSDN 等下载的纯文本 TXT 词典（每行一个单词、下接 `n./v./a./ad./abbr.` 等词性释义行），也支持 `单词<TAB或空格或冒号>释义` 及 JSON；**自动识别 GBK / UTF-8 编码**，支持「导入前清空」整本替换与一键清空。

### 生词本与复习
- 生词条目带**注释**、`box(1–5)` 与 `due` 时间戳。
- **列表里直接显示释义**（来自本地词库，纯本地读取），不必进复习才看得到。
- **词形还原**：存进去的往往是 `created` / `written` / `studies` / `biggest` 这类变形，查库时自动还原到原形再匹配（不规则表 + 规则词缀 + 辅音双写），命中会标注来源。
- 未收录时可一键 `🔍 联网查` 或 `✎ 改词`（把变形改成词典原形）。
- **记忆曲线复习（Leitner 间隔重复）**：点「记得 / 不记得」后揭晓释义 + 当时填的注释，并调整下次复习间隔（10 分钟 / 1 小时 / 1 天 / 3 天 / 7 天）。
- **独立生词本页面**（`vocab.html`）：不打开视频也能用，可作为书签直接访问。支持**导出 / 导入 JSON 备份**。

### 界面
- **窗口化浮窗（▢）**：面板收成一个小窗，只显示当前字幕一行（可双语两行），**可拖动（鼠标 + 触屏）**、**可逐词点查**——适合放视频角落里极简跟读。
- **最小化（－）**：整个面板收成标题小条。
- **诊断面板**：一键导出页面结构 / 字幕来源 / 抓取详情，出问题时点一下「复制报告」即可反馈定位。

## 支持的网站

| 网站 | 状态 | 说明 |
|---|---|---|
| **Bilibili** | ✅ 完整支持 | 走 B 站字幕 API（`x/player/wbi/v2`，需登录态），普通视频 / 影视番剧均可 |
| **YouTube** | ✅ 完整支持 | 主世界脚本提取 `captionTracks`；正文兼容 **JSON3 / WebVTT / XML** 三种格式；SPA 切视频自动重解析 |

> 前提：视频**必须有可选的 CC 字幕轨道**。UP 主/作者烧进画面的**硬字幕**、以及浏览器自带的 **AI 实时听译字幕**（渲染在内核私有层，不在网页 DOM 内）都无法读取。

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

- **学外语先看原文**：面板会自动选非中文轨道；想要"原文 + 中文对照"，在「对照」下拉里选中文轨，然后窗口化，浮窗里就会叠两行。
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

## 目录结构

```
lang-learn-extension/
├── manifest.json          # MV3 清单（含 YouTube MAIN world 脚本注册）
├── content.js             # 页面主逻辑：字幕拉取/解析、列表、跟读、查词、生词、复习、浮窗、诊断
├── content.css            # 面板 / 浮窗 / 弹层样式
├── yt-main.js             # YouTube 主世界脚本：读播放器响应、截获字幕请求，postMessage 转发
├── background.js          # Service Worker：查词转发、词形还原、批量本地词库查询
├── popup.html/js/css      # 工具栏弹窗：开关、查词来源、生词快速查看
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

```bash
node test-parse.js
node test-lemma.js
# ...
```

## 主要版本历程（节选）

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
- 网络请求仅发生在：查词（dictionaryapi.dev / Wiktionary）、拉取视频字幕（B 站 / YouTube）。
- 无统计、无追踪、无账号体系。

## 许可

本项目采用 [MIT 许可证](LICENSE) 开源。
