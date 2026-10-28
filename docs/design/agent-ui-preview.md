# Agent UI 体验分支

分支：`codex/release-agent-ui-preview`。基线：`3a30371`（v0.9.0）。本分支独立发布，不合入主分支。

## Direction contract

**THESIS**：AI 对话按实际消息顺序连续阅读，工具过程属于其发生位置。正文不加外卡，用户确认操作保持可见。

**OWN-WORLD**：使用任务书固定的近白页面 `#FAFAF9`、深灰正文 `#242423`、浅灰用户气泡 `#EFEFEE`、白色细边详情和统一输入框；系统字体，正文 16/25，线性图标。

**STORY**：用户看到过程摘要与说明相互穿插，按需展开真实输入输出；检索来源、用量、确认、停止、重试保持真实语义。

**FIRST VIEWPORT**：56dp 顶栏、安全区、16dp 阅读边距、右对齐自然收缩提问、连续正文与局部折叠过程；底部为草稿加模型/联网/思考/发送的两层输入框，发送触控 48dp。

**FORM**：用户指定 `agent-ui-reference-prompt.md` 与两张参考图，code-led Android 原生实现。seed: none (user-pinned)。不引入桌面侧栏、装饰性任务和进度数据。

**FINISH**：unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 安装与发布

- Android 包名：`com.asharesim.agentpreview`；名称：`AShareSim 体验版`。
- 版本：`0.9.1-agent-ui.1`，versionCode 1；arm64-v8a Release，沿用仓库签名。
- 与正式包 `com.asharesim` 并存，使用独立账户库与模型配置；不会自动复制正式 App 的数据和 Key。
- 正式交付入口仍为 `index.js`；`log/agent-ui-review/` 内本地验证入口不会发布。
- 发布入口：[v0.9.1-agent-ui.1](https://github.com/MathildaStacy/AShareSim/releases/tag/v0.9.1-agent-ui.1)。GitHub 标签为 `v0.9.1-agent-ui.1`，发布类型为 Pre-release，明确 `latest=false`。
- 最终 APK SHA-256：`d73de657123d354b015c40c64e2a5fa6527140ac430cedf8e8191cccf0eb8f08`。

## 数据边界

`conversationFlow` 按独立 StoredMessage 顺序构造局部过程块。正文、操作卡、记忆确认和导航形成可见边界；无顺序信息的单消息聚合数据保持一个局部过程块。工具 id、检索词、来源 URL 和明确公开摘要去重；累计工具使用最新状态，确认控件只显示一次。调用参数来自已有 call parts，输出来自 result parts，不从私有 raw 协议或 reasoning 字段推测内容。

局部过程 key 来自轮内布局位置，父级仍使用提问 id；临时消息 id -1 转为数据库 id 不重置展开。主动展开暂停自动跟随；拖动时暂停，滚回末尾约 60dp 内或点“回到最新回复”可恢复跟随。后续 token 不抢占远离末尾的阅读位置。

## 已实现的视觉规格

- 局部 AI 配色来自 `src/ui/aiTheme.ts`：近白页面 `#FAFAF9`、正文 `#242423`、次要文字 `#666662`、辅助文字 `#767670`、细线 `#E2E2DE`、浅表面 `#F4F4F2`、提问气泡 `#EFEFEE`、白色详情/输入容器、深色发送。搜索选中和普通过程使用克制的灰色；失败图标仍为共享错误红。
- Markdown 正文 16/25；三级标题分别为 21/30、18/27、16/25，600 字重；段落间距 12dp，标题前 20dp、后 8dp。过程摘要与工具输入输出为 13/20；代码使用等宽字体。数值表格右对齐并保留等宽数字特性，宽表与代码只在自身横向滚动。
- 顶栏最小 56dp，图标触控 48dp；阅读列侧边距 16dp、外宽上限 760dp。提问自然收缩、右对齐，最大 90% 宽度、12dp 圆角、10×12dp 内边距。正文、过程和工具详情左缘一致。
- 局部过程折叠摘要的箭头紧随文字；展开为白色 1dp 细边、12dp 圆角与内边距。已有调用输入放入 8dp 圆角内层，结果置于其下；缺少原始输入输出时不伪造。错误摘要直接可见，操作卡、记忆和导航保留在主消息流。
- 输入框为白色统一容器、18dp 圆角、4dp 内边距；草稿 16/24，高度 36–132dp 后内部滚动。草稿与模型文本共享左缘，发送圆面 32dp、触控 48dp。窗口宽度小于 360dp 或字体倍率大于 1.2 时模型独占工具栏首行，其余控件换到下行，发送仍靠右。
- 输入区参与正常 flex 布局；列表末尾仅留 16dp 阅读间距。键盘出现时使用 8dp 底部间距，避免重复叠加导航安全区；未出现时使用至少 8dp 的系统底部安全区。

## 验证

2026-10-28 的当前证据：

- `npm run check` 通过：TypeScript、ESLint 0 错误，45 个测试套件、549 项测试通过。`__tests__/ai/chat.test.ts` 和 `__tests__/ai/stream.test.ts` 保留两项既有 ESLint 警告。
- 行为测试覆盖消息与过程顺序、累计记录去重、最新工具状态、操作卡只出现一次、流式临时消息落库保持展开、上滑阅读不抢滚动及整轮末尾用量。流式交互结论以自动化测试为依据。
- 正式 `index.js` 入口的 arm64 Release 已构建并安装。最终生产 bundle 的 source map 包含 `App.tsx`，不包含 `log/agent-ui-review` 入口，且四个变更 UI 源文件的 `sourcesContent` 与最终源码一致。
- 原生证据来自 arm64 Android 模拟器：正常 1280×2856 / 480dpi（约 426.7dp 宽）；窄屏 960×2142（320dp 宽）、字体 1.3、系统深色模式。App 沿用浅色主题；所有设备设置已恢复。
- 本地固定样例隔离在被忽略的 `log/agent-ui-review/`，不在正式 APK。仅用于原生布局验证，截图内容不代表真实行情或真实模型回答。验证专用包 `com.asharesim.agentuireview` 已卸载，正式体验版与原 App 保留。
- [最终复核](../../.impeccable/review/agent-finish-review.md) 对八张必需截图给出 **ship**，没有 material fixes。

| 原生截图 | 状态 |
| --- | --- |
| [agent-phone.png](../../.impeccable/review/agent-phone.png) | 两段正文与两个局部工具阶段、折叠态和错误摘要 |
| [agent-expanded.png](../../.impeccable/review/agent-expanded.png) | 当前工具展开，已有输入和输出 |
| [agent-bottom.png](../../.impeccable/review/agent-bottom.png) | 长 Markdown、表格、代码、末段、来源与一次用量 |
| [agent-narrow-font130.png](../../.impeccable/review/agent-narrow-font130.png) | 320dp、1.3 倍字体、系统深色下的浅色 App |
| [agent-narrow-keyboard.png](../../.impeccable/review/agent-narrow-keyboard.png) | 窄屏键盘与多行草稿 |
| [agent-keyboard.png](../../.impeccable/review/agent-keyboard.png) | 正常宽度键盘及完整发送控件 |
| [agent-model.png](../../.impeccable/review/agent-model.png) | 模型选择弹层 |
| [agent-empty.png](../../.impeccable/review/agent-empty.png) | 已配置的空会话与现有简报入口 |

另有 [agent-release-smoke.png](../../.impeccable/review/agent-release-smoke.png)，记录生产入口未配置供应商时的设置入口与禁用输入区。

未验证：物理设备、完整 TalkBack 遍历、iOS、平板、真实供应商在线调用。原生静态截图不证明动画、手势性能或真实流式网络表现。
