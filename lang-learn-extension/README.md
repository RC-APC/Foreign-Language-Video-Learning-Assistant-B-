# 外语视频学习助手（浏览器插件 · v0.7.6）

在 Bilibili 观看外语视频（多语种电视剧等）时辅助外语学习：右侧可点字幕列表 + 逐行跟读 + 逐行音频下载 + 点词查词 + 生词本 + 记忆曲线复习。

## 核心改动（v0.7.6）：修复「面板完全不出现」+ 分 P cid / SPA 切换 / 空列表占位
- **🔴 修复面板完全不出现的严重回归**：v0.7.5 里新增的 `eudicAction` 变量**声明漏写**（编辑未落盘），却在 `getSettings()` 里被赋值。脚本是 `'use strict'`，给未声明变量赋值会抛 `ReferenceError` → 回调里的 `resolve()` 永不执行 → `await getSettings()` 永久挂起 → 后面的 `buildPanel()` 一行都不跑，**整个面板消失**。已补回声明。
- **加固**：`getSettings()` 无论发生什么都 `resolve()`；`init()` 里每一步独立 `try/catch`；`applySettings()` 整体 `try/catch`。今后任何单点异常都不会再让面板静默消失。
- **分 P cid 修正**：`resolveCid` 原来取 `view.data.cid`，那是**第一 P** 的 cid。多 P 视频在 P2/P3 播放时会拉到 P1 的字幕或拉不到 → 改为按当前分 P 取 `pages[p-1].cid`（新增 `getCurrentPage()`，优先读 `__INITIAL_STATE__.videoData.p`，其次 URL `?p=`）。
- **SPA 切分 P 重解析**：B 站切分 P / 切视频**不刷新页面**，扩展原会一直沿用旧 cid。新增 `watchSpaNav()`（1.5s 轮询 `location.href`）+ `resetForNewVideo()`：URL 变化且属 video/bangumi 页时，清空 cue/轨道并重新解析 bvid+cid、重拉字幕。
- **video 监听去重**：`wireVideo()` 改用元素自身标记 `v.__llWired`，切 P 换 video 元素时能重挂、同一元素不会重复挂。
- **空列表显式占位**：`renderList()` 在无字幕时显示「字幕列表为空…可点诊断」，不再是一片空白（便于区分「没拉到字幕」和「面板坏了」）。
- **0 轨道提示更准**：接口返回 `need_login_subtitle: true` 时明确提示「**该视频的 CC 必须登录 B 站才返回**」（这个视频 `BV1vLYm65E5t` P2 正是这种情况）。
- **调试工具**：新增 `tools/smoke_content.js`——用 `vm` + DOM/chrome stub **真实执行** content.js，捕获 `node --check` 抓不到的「严格模式下未声明变量赋值 → 异步静默挂起」。已用最小复现样例验证该工具确实能报错。

## 核心改动（v0.7.5）：欧路查词改走官方 URL Scheme（修「点词没反应」）
- **根因**：v0.7.4 用「程序化选中文本」指望触发欧路取词——但欧路的「划词/悬停取词」依赖**真实鼠标事件**（鼠标 hook / 悬停），脚本用 `window.getSelection()` 设的选区不产生鼠标事件，欧路收不到；而且 Chrome/夸克里网页文本由内核自绘，纯**悬停取词通常也失效**。所以点词"没反应"是必然。
- **改法**：改用欧路**官方 URL Scheme 显式唤起**，点词即开欧路的查词窗口（支持日语等任意语种，只要装了对应词库）：
  - `eudic://lp-dict/<词>` 迷你查词窗口（默认，轻量不抢主窗口）
  - `eudic://cap-dict/<词>` 鼠标取词小窗口
  - `eudic://dict/<词>` 词典主窗口
  - 法语/德语/西语助手对应协议为 `eudic-fr/de/es://`
- **popup 新增「唤起窗口类型」下拉**；首次唤起浏览器会问「要打开 欧路词典 吗？」→ 勾选**始终允许**后即秒开。
- 前置条件：Windows 欧路词典 ≥ 14.0.0（当前 26.x 均可）。未注册协议时单词会自动进剪贴板，可手动粘贴查。
- 兜底：单词同时写入剪贴板，避免协议未生效时无路可走。
- 来源：欧路官方《Win/Mac URL Scheme》 https://eudic.yuque.com/org-wiki-eudic-fxu2ea/kqx0pu/f297969df94d062d7fc40b980785fec6

## 核心改动（v0.7.4）：欧路取词去掉点后弹窗 + 设置切换免刷新即时生效
- **欧路词典模式不再弹提示**：改为点词时静默选中该词（供欧路「划词」触发），不弹 toast；由欧路自身的「屏幕取词」弹释义。
- **切换来源时提醒**：popup 里选「本地欧路词典」后，下拉框下方常驻显示提示（请先打开欧路词典应用并开启屏幕取词/划词）；页面内同步弹一次 toast 提醒。
- **设置切换即时生效（免刷新）**：`init()` 统一用 `syncSettings()` 套用设置——`chrome.storage.onChanged`（标准内核）+ **每 2 秒轮询兜底**。此前夸克等部分内核不触发 `storage.onChanged`，导致改「词典来源/自动暂停」后要刷新页面才生效；轮询后改完立即生效。

## 核心改动（v0.7.3）：诊断修正（cid 显示 + 登录态/ASR 字段）
- **修正诊断「实际传给 API 的参数」显示 stale 的 `cid:null`**：`loadSubtitles` 先用 URL 兜底参数（无 cid）赋值 `playParams`，再 `resolveCid` 补出 cid 用于真实请求；但诊断打印的是补 cid 之前的 `playParams`，看起来像"传了 cid=null"。现在补 cid 后同步回 `playParams.cid`，显示即为实际使用的参数。（功能本就正确，仅显示误导。）
- **诊断新增「登录态」与「ASR/OCR 语言字段」**：打印 `login_mid` / `need_login_subtitle` / `asr_language` / `ocr_language`，便于区分「未登录导致空」还是「视频确无 CC」。
- **0 轨道提示增强**：附加登录态提醒；「中字」搬运（UP 主烧进画面）明确说明插件无法获取原文。

## 核心改动（v0.7.2）：移除失效的「翻译成目标语言」+ 诊断新增「字幕层探测」
- **移除「翻译成目标语言」**：该开关依赖 Microsoft Translator Key，未配置时点开即自动关回，属无效 UI。已删除面板上的这一行、popup 里的「整句翻译」配置区、后台 `translateBatch`/`translateText` 及全部相关死代码与样式；同时移除 `microsofttranslator` 主机权限。整句翻译能力不再保留（双击存词、点词查词、跟读、音频下载、复习均不受影响）。
- **诊断按钮新增「字幕层探测」**：扫描页面所有含可见短文本的元素（不限语种，含开放 Shadow DOM），并用前后 1.8 秒两次快照 diff 找出**随播放变化的文本节点**，同时列出类名/ID 含 `subtitle|caption|字幕|翻译` 等的容器。→ 用于判断「夸克/浏览器的 AI 实时字幕」是否被注入到网页 DOM：进了 DOM 才可能被抓取，否则在浏览器私有层无法读取。

## 核心改动（v0.7）：存词反馈 / 字幕翻译 / 音频下载修复 / 9 分钟截断 / 复习
- **双击存词「没反应」修复**：之前双击只做了一次无样式的 class 闪烁、且生词本藏在扩展弹窗里看不见。现在双击会弹出 **「✓ 已存入生词本：word」toast 提示**，并新增面板内 **「生词(N)」按钮**可直接查看/删除生词（无需离开页面）。
- **整条字幕翻译（解决「日语视频没日语 CC 只能看中文」）**：面板新增「译」开关 + 目标语言选择（日/英/韩/法/德/西）。开启后把当前字幕整条批量翻译成目标外语（用 popup 里已预留的 Microsoft Translator Key，1 次请求翻译全部行），显示翻译文本、原文以小字附在下方。→ 没有日语 CC 时，选「目标语=日语」即可把中文字幕转成日语阅读文本。
- **音频下载修复**：原实现用 `a.click()` 直接下载 blob，在异步回调里经常被浏览器拦截而"下载失败"。改用 `chrome.downloads.download`（更稳、不依赖用户手势），并在录制 0 字节时给出明确提示；无 `downloads` 权限时回退 anchor 下载。已加 `downloads` 权限。
- **字幕列表只显示最后 80 行导致「9 分钟才开始有字幕」**：`renderList` 原来 `cues.slice(-80)` 只渲染末尾 80 行，长视频前半段字幕不进 DOM。改为**渲染全部字幕行**，靠滚动 + 高亮定位当前行。
- **记忆曲线复习（针对性复习）**：生词本每项带 `box(1-5)` 与 `due` 时间戳；点「生词」面板里的「复习(N)」进入 Leitner 间隔重复卡片：显示单词→点「显示释义」→「✓记得 / ✗不记得」调整复习间隔（10 分钟 / 1 小时 / 1 天 / 3 天 / 7 天）。英文词会拉取内置释义，其它语种提示自行回忆。

## 核心改动（v0.6.1）：跨域 CORS 修复——字幕正文终于能下载
- 实测哈利波特正版影视：`x/player/wbi/v2` 用 `bvid+cid` 登录态调用已返回 `code:0`，但 `data.subtitle.subtitles` 仍为空——与「播放器里确实看到英文 CC」矛盾。
- 诊断按钮升级：新增 **「字幕 API 原始响应 dump」**（data 顶层键 / subtitle 对象键 / subtitle JSON 全文）与 **「当前页面含英文字幕的候选节点」扫描**，一次定位字幕到底藏在 API 别处还是 DOM 非标准元素。
- DOM 兜底新增 `findVisibleSubtitleProbe()`：扫描视口下半部「含英文、子节点少、长度适中」的元素，自动挂钩影视/番剧可能用的非标准 class 字幕节点。

## 核心改动（v0.6.1）：跨域 CORS 修复——字幕正文终于能下载
- 实测一个有 CC 的普通视频（BV1Gf4y1y7wc，TED-Ed 类）：`x/player/wbi/v2` 返回 `code:0`、`CC 轨道数: 4`（含 English / English(US)）、English 已自动选中，但「已加载字幕行数: 0」——轨道拉到了，正文下载失败。
- 根因：`fetchSubtitleData` 对字幕正文 URL（`//aisubtitle.hdslb.com/...` 跨域 CDN）用了 `credentials:'include'`，带 cookie 跨域被浏览器 CORS 拦截。字幕 URL 已带 `auth_key` 鉴权，**无需 cookie**。
- 修复：`fetchSubtitleData` 改 `credentials:'omit'` + protocol-relative(`//`) 补 `https:` 前缀。
- Node 实测：直连该字幕 URL 无 cookie 成功，返回 `{ body:[{from,to,location,content} ×95] }`，解析完全吻合。→ 普通上传视频（带 CC）这条路已彻底打通。影视/番剧（哈利波特等）的 `subtitles=[]` 仍可能是混流硬字幕，需 ASR 兜底，待确认。

## 核心改动（v0.5）：影视/番剧用 `bvid+cid` 从页面 HTML 提取（修正 v0.4 的 ep_id 误判）
- v0.4 误以为「影视/番剧必须传 `ep_id`」，实测 `x/player/wbi/v2` 传 `ep_id` 直接返回 **`-400 请求错误`**；真正可用的是 **`bvid+cid`**（返回 `code:0`）。该影视视频 `arc` 块里同时带 `bvid=BV1UJ411N7if` 与 `cid=117138539`。
- 关键发现：**影视/番剧页根本没有 `window.__INITIAL_STATE__` 全局**（SPA 完全靠运行时注入），但 `bvid`/`cid` 完整藏在页面 HTML 的嵌入 JSON 里（`"arc":{...,"cid":117138539,"bvid":"BV1UJ411N7if"}` 与 `"episode_info":{...,"ep_id":281211}`）。
- 提取逻辑升级为 `getPlayParams()`：先试 `window.__INITIAL_STATE__`（普通视频）；失败则用 `extractFromHtml()` 从 `document.documentElement.innerHTML` 正则提取 `arc`/`episode_info` 块里的 `bvid+cid`；并带 6 秒重试（`resolvePlayParamsWithRetry`）以兼容 SPA 晚注入。
- `x/player/wbi/v2` 用 `bvid+cid` 调用，登录态下（浏览器已登录 B 站）返回 CC 字幕列表。无 cookie 时该影视返回 `subs:0`（Node 实测），故**必须用浏览器登录态**才能拿到字幕。
- 诊断按钮升级：显示「类型（影视/普通）」「提取方式 via」「实际参数」「API code」「HTML 提取到的 bvid/cid」，便于一次性定位。

## 核心改动（v0.3）：从「DOM 监听」改为「B 站字幕 API 拉取」
- v0.2 通过监听播放器 CC 字幕 DOM 来抓字幕，**但 B 站绝大多数外文电视剧搬运是 UP 主把字幕烧进画面的硬字幕（hardsub），播放器 DOM 里根本没有可选 CC 轨道**，所以一直为空。
- v0.3 改用 **B 站字幕 API**（`x/player/wbi/v2`，内置 wbi 签名 + 调用方登录态 cookie）直接拉取该视频的 CC 字幕列表与逐行数据。好处：
  - 拿到**逐行精确时间轴**（`from`/`to`），跟读与音频下载时间更准；
  - 能拿到**原文文本**（不只是中文），面板顶部「字幕轨道」下拉框可选语言（自动优先选非中文轨道，适合学外语）；
  - 不依赖播放器 DOM 结构，换 B 站播放器版本也不怕。

## 功能
- **字幕轨道选择**：顶部下拉框列出该视频所有 CC 字幕轨道（如 中文/English/日本語），自动优先选原文语言；没有可选轨道时提示「硬字幕，无法获取」。
- **右侧字幕列表**：按时间轴排列，播放时当前行高亮自动滚动。
- **点击跟读（▶）**：跳到该行开头播放、到行末自动暂停。
- **下载该行音频（⬇）**：用 `tabCapture` 录下那几秒标签页音频，存 `line_N.webm`（免 Key，由点击触发）。
- **点词查释义 / 双击存生词**：查词来源可在 popup 选「在线词典（Free Dictionary，英文）」或「本地欧路词典（选中文本，秒开，支持任意语种）」；生词本存本地。
- **自动暂停**：每行字幕自动暂停（study 模式）。
- **「实时字幕」行**：显示当前时间点对应的字幕文本。
- **「诊断」按钮**：把数据来源 / bvid / 轨道数 / 字幕行数写进列表区，并探测页面是否存在实时字幕层（判断夸克 AI 字幕是否在 DOM 内），便于排错。

## 支持的浏览器
Chromium 内核：`Google Chrome`、`Microsoft Edge`、`夸克浏览器（PC 版，地址栏输 chrome://extensions）`。

## 本地加载测试步骤（无需发布、无需打包）
1. 打开扩展管理页：`chrome://extensions` 或 `edge://extensions`（夸克输 `chrome://extensions`）。
2. 右上角开 **「开发者模式」**。
3. 点 **「加载已解压的扩展程序」**，选择本目录 `lang-learn-extension`。
4. 打开一个**带 CC 字幕**的 Bilibili 视频（`/video/` 或 `/bangumi/play/`），**需登录 B 站账号**（字幕 API 依赖登录态）。
5. 右侧出现面板，顶部自动列出字幕轨道并加载原文；播放后可跟读/下载/查词。
6. 改完代码回扩展页点插件 **「刷新」** 图标，再刷新视频页。

## 已知限制（重要）
- **硬字幕（内嵌）仍抓不到**：若视频只有 UP 主烧进画面的字幕、没有可选 CC 轨道，API 也拿不到原文。诊断会显示「CC 轨道数: 0」。解决：换一个带 CC 字幕的视频，或确认该视频确实上传了原文 CC 轨道。
- **夸克/浏览器的 AI 实时字幕抓不到（默认）**：夸克自带的「视频 CC 字幕」实际是夸克的 AI 实时听译（ASR），渲染在浏览器私有 UI 层、不在网页 DOM 内，扩展无从读取。仅当视频**本身有 B站 官方 CC** 时，扩展才能直接拿到。用「诊断 → 字幕层探测」可验证：若 1.8 秒内文本变化里出现台词，说明字幕进了 DOM（可抓）；否则需扩展自建 ASR（需自备语音识别 Key）。
- **需登录态**：字幕 API 依赖 B 站登录 cookie，未登录可能返回空或报错（此时会回退到 DOM 监听，对硬字幕仍无效）。
- **音频下载是 webm/opus**：非 mp3，但任意播放器可播；需 mp3 可后续加转码。
- `tabCapture` 录音由点击触发；个别浏览器/策略限制时 ⬇ 会提示并改为「跳到该行播放原声」。

## 目录结构
```
lang-learn-extension/
├── manifest.json      # MV3 清单（tabCapture + api.bilibili.com / hdslb 权限）
├── content.js         # 注入视频页：wbi 签名拉字幕、轨道选择、右侧列表、跟读/下载/查词
├── content.css        # 面板与弹窗样式
├── background.js      # Service Worker：词典请求转发（lookup）
├── popup.html/js/css  # 设置 + 生词本
└── README.md
```
