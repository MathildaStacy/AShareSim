# 聊天详情页 UI 调整与验证

## 当前：Agent UI 体验分支

2026-10-28，`codex/release-agent-ui-preview` 基于 v0.9.0（`3a30371`）单独交付，不合入主分支。当前实现和方向合约见 [Agent UI 体验分支](agent-ui-preview.md) 与 [阅读排版](ai-chat-layout.md)。

本轮将整轮前置的过程汇总改为按独立消息顺序穿插的局部过程：累计工具、检索和来源去重，工具采用最新状态，确认控件在主消息流只保留一次；已有 call/result 输入输出在当前阶段展开。单消息聚合记录没有可证实顺序时保持局部一组。公开摘要仍只使用明确的 OpenAI `summary_text`，不展示混合 thinking/reasoning。

同时同步近白局部配色、16/25 正文、三级标题、56dp 顶栏、16dp 阅读边距、自然收缩提问和白色细边详情；窄屏/大字号工具栏换行。键盘、停止、上滑阅读、流式落库展开状态、来源和操作确认保留。

当前验证为 `npm run check`：45 套件、549 项测试通过，TypeScript 与 ESLint 0 错误，两项既有测试文件警告保留。原生矩阵包括正常约 426.7dp、320dp/1.3 倍字体、系统深色下的浅色 App、折叠/展开、长 Markdown、键盘与多行草稿、模型弹层和空会话；[最终复核](../../.impeccable/review/agent-finish-review.md) 为 **ship**。八张必需截图、生产包 source map 核对、APK 校验值和实际未验证项统一记录在 [当前验证矩阵](agent-ui-preview.md#验证)。

正式 `index.js` 的 arm64 Release 安装为 `com.asharesim.agentpreview`（AShareSim 体验版），与原 App 并存、配置和本地数据独立。验证样例不进入生产包，验证专用包已卸载，设备设置已恢复。本轮静态截图不作为真实供应商或流式网络验证；流式行为结论来自自动化测试。

## 历史记录：v0.8.0 聊天详情优化

以下为前序分支的验证原文，数字、包名、截图路径和整轮过程行为均属于当时版本；不能用来描述当前体验分支。

日期：2026-10-28。分支：`codex/feature/chat-detail-ui`，从本地 `main` 创建独立 worktree。原工作区的未提交改动没有带入。

### 修改范围

- `src/ui/components/ChatProcess.tsx`：按提问归并整轮处理过程；同轮摘要与工具结果缩进分组；折叠时卸载明细；用提问 id 保持流式更新和落库时的展开选择。搜索词按文本、来源按 URL 去重，避免累计快照重复计数。
- `src/ui/screens/AiScreen.tsx`：使用整轮过程组件，取消空助手消息的间距；操作卡、记忆确认、导航入口仍可直接操作。水平边距 16dp，模块与明细沿用现有间距体系。输入框最小 36dp、最大 132dp，补足触控范围；窄屏和大字号下工具栏换行。输入区参与正常 flex 布局，列表只加 16dp 阅读间距，不重复预留整个输入区高度；键盘出现时取消导航栏安全区的重复占位。返回底部按钮位于输入区右上方，距末尾小于 60dp 时隐藏；拖动历史及主动查看过程时暂停自动跟随。
- `src/ui/components/Markdown.tsx`：增加次要正文样式，用于公开处理摘要；沿用解析器，保留加粗、段落、链接、表格和代码语义。
- `src/ui/components/ui.tsx`：为既有 Button 增加可选样式与禁用语义，聊天页据此扩展操作按钮至至少 48dp；其他页面不改变默认尺寸。
- `__tests__/ui/chatProcess.test.tsx`：覆盖累计搜索去重、未知结果不冒充有效数据、折叠卸载、流式落库保留展开，以及公开摘要来源校验。
- `__tests__/ui/aiScreens.test.tsx`：更新文案断言，保留真实工具调用、操作卡执行、模型切换和来源交互回归；补充上滑阅读期间不自动滚动及过程状态保留验证。

没有修改模型请求、工具执行、数据库结构或回答内容；没有引入新依赖。

### 数据语义与限制

- 顶部原来的 `7.4k` 来自 `preview.total + estimateTokens(draft)`，是预计输入词元数。页面名来自打开 AI 页时捕获的来源页面，不代表一定已附带，因此标为“来源页面”。
- 用户消息的 `ui.page`、`ui.actions` 分别是当次附带的页面和最近操作记录数量。缺失字段不再冒充零条记录。
- 现有 `ui.thinking` 混合多个协议的原始推理与公开摘要，不作为展示来源。仅允许已存储 OpenAI Responses `raw.items[].summary[].type === 'summary_text'` 的内容；流式临时消息没有 raw、历史消息缺少出处、其他协议只有 thinking/reasoning 时隐藏摘要。没有新增请求或用客户端文字替换生成摘要。
- `ToolUi` 没有统一的有效数据/空结果标记；`error` 还用于取消、上限等未执行情况。普通记录显示“调用已结束”或“执行异常”及原有标签，不声称“已获取有效数据”。操作卡和记忆记录有明确类型化状态，因此显示待确认、已执行、失败、已取消、已撤销等真实状态。搜索词或来源缺失只写接口未提供，不能据此认定返回为空。
- 工具过程的数字表示工具记录条数、唯一检索词数、唯一来源数，均由当轮消息计算。

### 实际验证

- `npm run check`：TypeScript、ESLint、35 个测试套件、428 项测试通过。ESLint 保留原有 `__tests__/ai/stream.test.ts:317` 的 `consistent-this` 警告，修改文件没有新增警告。
- 使用 `.nvmrc` 指定的 Node 24.22.0 复核。worktree 已独立安装 lockfile 中的依赖，未修改 lockfile。
- 正式入口 `index.js` 的 Android arm64 Release 构建通过；包名仍为 `com.asharesim`，未安装覆盖原 App。核对产物 source map 与最终 UI 源码一致，未包含临时验证入口。
- Android 原生模拟器：arm64，1280×2856 / 480dpi；另验证 960×2142（320dp 宽）、1.3 倍字体和系统深色模式。仍使用项目既有浅色主题。
- 独立包 `com.asharesim.uireview` 使用临时本地样例及模拟流式接口进行验证，未访问外部模型或写入原 App 数据。确认折叠后答案提前出现，展开可见全部记录，公开摘要没有裸露 `**`，表格与代码可横向滚动，末段可滚到输入区上方，键盘不覆盖输入及发送控件。
- 上滑时保持位置、流式落库仍展开、仅跟随新增正文等行为同时通过集成测试验证。
- 原生截图保存在被 Git 忽略的 `log/ui-review/`：`final-collapsed.png`、`final-expanded.png`、`final-bottom.png`、`final-keyboard.png`、`narrow-font130-dark.png`、`narrow-bottom.png`、`narrow-keyboard.png`。

验证完成后已卸载独立测试包，并恢复模拟器原分辨率、1.0 倍字体和系统浅色设置。

未验证：物理设备、完整 TalkBack 遍历、iOS/平板、真实供应商在线调用。样例回答仅用于布局与交互验证，不是实际查询结果。
