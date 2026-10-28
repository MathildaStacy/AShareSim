# M5 设计系统核对

日期：2026-10-28。结论：本次 Android 组合与调仓、数据中心扩展沿用适用的交易界面系统；没有新增或替换全局视觉体系。

## 范围与依据

这是 `impeccable` document 的范围核对记录。用户确认的主线为每周按策略调仓、完成后复盘；表面模式为 Operate，方向见 `m5-portfolio.md`。核对了 `PRODUCT.md`、`DESIGN.md`、`.impeccable/design.json`、`src/ui/theme.ts`、共享 `ui.tsx`、`PortfolioControls.tsx`、`PortfolioScreens.tsx` 和 `DataCenterScreen.tsx`，并读取收尾评审及验证记录。

`DESIGN.md` 的名称与 Overview 明确限定为 **AI Conversation**，Local Palette Rule 仅覆盖 AI 阅读面与聊天选择器。其暖白、炭色操作和对话排版不构成交易页的全局替换。schemaVersion 2 的 sidecar 同样记录 AI 组件及预览，不能据此要求 M5 使用暖色对话样式。M5 的适用视觉依据是既有交易主题与共享原生组件；本次保留两份系统文件。

## 比较结果

| 项目 | 实现与证据 | 判断 |
| --- | --- | --- |
| 表面与颜色 | 两个页面直接引用 `color.bg`、`color.card`、`color.ink`、`color.ink2`，对应冷灰底、白色内容区与交易文字层级；警告使用 `warnInk/warnBg`，复盘和成功提示使用 `learn`。 | 延续交易主题，未引入 AI 暖色。 |
| 状态与操作 | 买卖、未完成、不可比、未知均有文字；卖出和操作沿用 `sell`，复盘操作沿用 `learn`。执行结果、费用和数量以原生文本呈现。 | 继续已有语义色与明确状态表达；颜色不承担唯一解释。 |
| 字体与数字 | 原生中文默认字体；页面标题 24/33、分节 18/26、正文 15/24、辅助文字 13/20。组合指标复用 `num` 的 tabular-nums，行内交易数据随正文排版。 | 局部任务层级与既有原生界面一致；未新设字体系统。 |
| 布局与形状 | 内容边距 16dp，白色区域、细分隔线、6dp 控件圆角；首页和弹层使用局部 12dp 圆角。数据及步骤可换行，纵向滚动保留底部安全区。 | 既有交易布局的任务扩展，未添加装饰材质、阴影系统或图表。 |
| 控件 | `PortfolioButton` 与 `PortfolioSegments` 使用既有主题，最小高度 48dp、分段间距 8dp；提供按压透明度、加载指示、disabled/busy/selected 语义。字段有标签和 48dp 最小高度。 | UI UX Pro Max 与 Emil 的本地可用性补充；没有改写共享按钮规范。 |
| 确认与键盘 | 确认弹层最大高度 85%，清单内部滚动，按钮位于清单之外；系统返回可关闭。输入页使用 Android height 键盘避让。减少动态效果通过系统 API 将淡入改为无动画。 | 符合本次手机操作场景；动态偏好的实现核对不等同于录像验证。 |
| 周任务顺序 | 首页先显示本周与下一步；draft 先预检；executing 先成交/剩余状态和委托入口，静态预检后置；复盘后生成报告。 | 符合已确认的任务方向，唯一 P2 执行首屏问题已关闭。 |
| 素材 | 目标界面使用原生组件及既有图标，没有新增 shipping raster。 | 无需新增素材来源记录。 |

局部控件使用 48dp 最小高度，而既有共享 `Button` 仍为 40dp、small 为 32dp。这是明确局限于 M5 的适配，不把共享控件的既有尺寸重新定义为本次系统变更，也未对其他页面进行顺带整改。

## 原生证据与验证边界

`m5-finish-review.md` 最终 disposition 为 **ship**：首轮唯一 P2“执行页先给实时执行状态”已定向复核为 resolved。评审打开了标准手机和 375dp / 1.3 倍字号的执行首屏，以及首页、预检、键盘、报告、确认、数据质量和双源核对截图。准确文件名、尺寸与流程见 `m5-validation.md`；截图位于本地 gitignored 的 `.impeccable/review/m5/`。本记录引用该原生评审，不以 web detector 结果替代手机证据，也不声称重新运行了视觉评审。

验证记录载明 39 个测试套件 / 495 项测试、TypeScript、ESLint 与 Android debug 构建通过；现有 AI 测试有两条 lint warning。窄屏系统深色测试仍显示应用既有浅色主题，不代表独立深色设计。iOS、平板、真机后台、完整 TalkBack 遍历、减少动态效果开关录像及连续四周实际执行不在本次已验证结论内。

## 文档状态

本次没有取得已核实的 `CONTEXT_STALE` 或其他既有系统漂移证据。AI 文档与交易页面的不同是显式范围划分，不作为漂移处理。本记录只新增本文件；`DESIGN.md`、`.impeccable/design.json`、共享主题及源代码均不由本次文档核对修改。M5 的页面策略保留在表面 brief，不提升为全局视觉规则。
