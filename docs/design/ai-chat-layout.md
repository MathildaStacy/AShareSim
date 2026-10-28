# AI 对话阅读排版

当前规格：`codex/release-agent-ui-preview`，基于 v0.9.0，记录于 2026-10-28。范围为 Android AI 对话、Markdown 与聊天内选择器；模式为 Read，兼顾提问和确认操作。

视觉依据为用户指定的 [任务书](agent-ui-reference-prompt.md)、[对话参考](references/agent-conversation.png) 与 [展开参考](references/agent-expanded.png)。截图中的文字只作为视觉示例。完整方向合约、安装信息与验证矩阵见 [Agent UI 体验分支](agent-ui-preview.md)；当前 token 与可复用规则见根目录 `DESIGN.md`。

## Direction contract

**THESIS**：让对话按真实顺序连续阅读。局部工具阶段与后续说明穿插，助手正文直接落在页面，确认操作保持可见。

**OWN-WORLD**：近白底 `#FAFAF9`、深灰正文 `#242423`、浅灰提问 `#EFEFEE`、白色细边详情与统一输入容器；系统中文字体，正文 16/25，标题 21/30、18/27、16/25，600 字重。普通过程用灰色，失败用小型红色轮廓图标。其他交易页面保留既有视觉系统。

**STORY**：读清判断、理由及其局部工具过程，按需查看已有输入输出、公开摘要、来源和用量；模型能力、停止、重试与写操作确认沿用真实产品语义。

**FIRST VIEWPORT**：56dp 顶栏加安全区，一行来源页面/预计输入信息；16dp 页边距，右对齐自然收缩提问，连续正文与局部过程。底部为紧凑两层输入区，草稿与模型名称左缘一致；联网、思考为轻量控件，32dp 发送圆面位于 48dp 触控区。宽度小于 360dp 或字体倍率大于 1.2 时工具栏换行。

**FORM**：用户固定参考的 code-led Android 原生适配；seed: none (user-pinned)。不搬入桌面侧栏，也不新增无来源的任务、进度或状态数据。

**FINISH**：unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 当前行为

- `conversationFlow` 仅依据独立 `StoredMessage` 的先后顺序建立边界，连续证据归为当前局部过程。正文、错误、提示和操作控件形成可见边界；缺少阶段顺序的单消息聚合数据保持局部一组，不伪造时间顺序。
- 工具 id、检索词、来源 URL 和明确公开摘要去重，累计工具采用最新状态；操作卡、提案、记忆和导航控件在主流中只出现一次。输入和输出来自已有 call/result parts，私有 reasoning 不作公开摘要。
- 当前过程展开为 12dp 圆角、12dp 内边距的白色细边容器；代码输入使用一个 8dp 圆角内层，输出在下方。错误摘要和待确认操作不藏进折叠区。父级提问 id 与局部布局 key 保持流式落库时的展开状态。
- 输入草稿 36–132dp，超过后内部滚动；键盘下输入和发送保持可见。上滑或展开过程暂停跟随，末尾约 60dp 为回到底部按钮阈值。展开不触发跳到底部，停止保留已收到正文。
- Markdown 保留标题、列表、加粗、引用、链接、数值表格及代码语义。表格和代码局部横向滚动，助手无外层卡片。来源与整轮末尾的一次用量按需展开。

## 当前验收

[原生 finish review](../../.impeccable/review/agent-finish-review.md) 的 disposition 为 **ship**。八张必需截图覆盖正常手机、局部过程折叠/展开、长正文与表格、键盘、320dp 窄屏和 1.3 倍字体、模型选择及空会话。`npm run check` 通过 45 套件、549 项测试，TypeScript/lint 0 错误；正式入口 arm64 Release 已安装为独立体验包。

原生证据来自模拟器，样例与正式入口隔离；物理设备、完整 TalkBack、iOS/平板和真实供应商调用未验证。完整截图位置和生产包核对记录见 [体验分支验证](agent-ui-preview.md#验证)。

## 历史记录

2026-10-27 的 Claude Desktop 阅读排版与后续 composer 修正属于前序版本。用户对首版输入区的否定撤销了当时首轮 ship；修正后以 `.impeccable/review/composer-review.md` 记录了新一轮复核，当时检查为 400 项测试。该历史通过不替代当前 Agent UI 体验分支的规格和复核。

v0.8.0 的整轮过程归并与 428 项测试记录保留在 [聊天详情历史验证](chat-detail-ui-validation.md#历史记录v080-聊天详情优化)；当前体验分支已改为上述局部过程顺序。
