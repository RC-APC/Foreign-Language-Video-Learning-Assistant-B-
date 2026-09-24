# LingoReel 隐私说明 / Privacy Policy

> 最后更新：2026-09-24
> 适用产品：LingoReel（浏览器扩展，Chrome / Edge / Quark / Kiwi）

## 中文

本扩展（LingoReel，视频外语跟读助手）**不收集、不上传、不出售任何用户个人数据**。

1. **本地存储**
   你的设置（面板透明度、目标语言、翻译引擎与 API 密钥、自动暂停开关等）和生词本数据（单词、例句、注释、跟读评分记录、导入的本地词库）全部保存在你自己的浏览器本地（`chrome.storage`），开发者服务器不存储其中任何内容。

2. **第三方请求**
   仅当你**主动触发**查词或翻译时，本扩展会把相关字幕文本发送到**你自行配置**的服务：
   - 在线词典（如 dictionaryapi.dev、en.wiktionary.org）；
   - 翻译服务（如 translate.googleapis.com、api.mymemory.translated.net）；
   - 你填写了 API 密钥的大模型服务（如 DeepSeek、SiliconFlow、智谱 BigModel、Kimi、通义千问、火山方舟、OpenAI、Groq 等）；
   - `localhost` / `127.0.0.1` 仅用于你自建的本地模型（如 Ollama）。
   这些数据**不经过开发者**，仅用于完成你请求的功能，不用于广告、分析或任何商业目的。

3. **数据共享**
   除为完成上述功能所必需的外，我们不与任何第三方共享你的数据。

4. **权限说明**
   - `storage` / `unlimitedStorage`：仅用于在本机保存上述设置与生词本。
   - 视频站点主机权限（bilibili.com、youtube.com、youtu.be）：仅用于在对应页面注入字幕学习面板、读取 CC 字幕、控制播放（跟读回放、自动暂停）。
   - 词典 / 翻译 / 大模型 API 主机权限：仅在用户配置并主动使用时才发起请求。

5. **联系**
   如有隐私问题，请联系：ruancong95@163.com

---

## English

This extension (LingoReel, a video language-shadowing assistant) **does not collect, upload, or sell any personal data**.

1. **Local storage**
   Your settings (panel opacity, target language, translation engine and API keys, auto-pause toggle, etc.) and vocabulary data (words, example sentences, notes, shadowing scores, imported local dictionaries) are stored locally in your own browser (`chrome.storage`). The developer's servers store none of this data.

2. **Third-party requests**
   Subtitle text is sent only to services **you configure**, and only when you **actively trigger** a lookup or translation:
   - online dictionaries (e.g. dictionaryapi.dev, en.wiktionary.org);
   - translation services (e.g. translate.googleapis.com, api.mymemory.translated.net);
   - LLM providers whose API key you supply (e.g. DeepSeek, SiliconFlow, Zhipu BigModel, Kimi, DashScope, Volcengine, OpenAI, Groq, etc.);
   - `localhost` / `127.0.0.1` is used only for self-hosted local models (e.g. Ollama).
   This data **never passes through the developer** and is not used for advertising or analytics.

3. **Data sharing**
   We do not share your data with any third party except as required to perform the functionality you request.

4. **Contact**
   Privacy questions: ruancong95@163.com
