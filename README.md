# AShareSim · A 股模拟交易与量化入门

用真实行情、按 A 股真实规则和真实税费做模拟交易的手机 App（先做 Android，iOS 后补）。
除了「入金是模拟的」之外，交易时间、集合竞价、T+1、涨跌停、价格笼子、交易单位、佣金 / 印花税 / 过户费 / 红利税都按交易所和券商的现行规则执行。

两个目标：

1. 练习炒股：了解 A 股市场、交易规则和每一笔费用是怎么来的。
2. 为个人量化打基础：对应 [量化学习路线](docs/research/quant-roadmap.html) 的阶段 0–3（规则、Python、统计、数据库），并提前做阶段 7（按真实规则记录模拟执行）。

## 当前状态

- M0 设计：完成（产品设计、规则规格、AI 设计、可交互原型）。
- M1 引擎：完成。规则、费用、撮合、清算引擎和测试（`src/engine/`，说明见 [docs/ENGINE.md](docs/ENGINE.md)），用官方算例和真实行情数据验收。
- M2 行情 + 交易：进行中。
  - 第 1 步（数据层、腾讯行情适配、补撮合、后台跟踪）完成。
  - 第 2 步（行情界面）完成：底部 5 个 Tab；自选（排序、拖动排序）、搜索、行情（8 个指数和 4 个板块的排行）、个股详情（分时 / 日 K / 周 K、五档盘口、成交明细、本股规则卡、F10 简况）。界面代码在 `src/ui/`，调试页挪到「我的 → 调试页」。
  - 第 3 步（交易界面）完成：交易 Tab（账户概览、功能格、持仓）；下单页（同花顺布局：左边表单、右边五档点价，限价 / 沪深各自的市价类型 / 盘后固定价格，仓位快捷键，实时预估费用，提交前用引擎同一套规则校验，委托确认弹窗）、撤单、持仓和持仓详情（摊薄成本和买入均价两个口径）、当日委托 / 当日成交 / 历史委托 / 交割单（导出 CSV）、委托详情、成交详情（成交依据和费用算式）；个股页底部买入 / 卖出，点五档价格带进下单页；成交、废单、撤单等引擎事件弹提示。每个页面都有 AI 页面上下文，下单页带表单内容和校验结果。
  - 第 4 步（资金和设置）完成：银证转账（模拟入金，累计净入金上限；交易日 9:00–16:00，新账户第一笔入金不限时间；卖出的钱 T+1 才可取）、资金流水（从交割单派生，汇总和待发生的红利 / 红利税）、费率设置（股票 / ETF 佣金率和最低佣金、免五、规费另收、合并计佣；改费率只对之后的委托生效）、交割单校准（逐项比对、反推佣金率和是否免五、一键套用）、设置（成本口径、快照保留、后台跟踪模式和间隔、入金上限）、后台跟踪与省电引导（HyperOS）、历史账户和重置账户（旧账户归档、可导出）。交易 Tab 和「我的」的入口都换成了真页面，每个页面都有 AI 页面上下文，设置的修改记进操作日志。
  - 下一步：M2 验收（连续 5 个交易日真实使用），然后 M3 学习模块。

## 开发

```bash
nvm use            # Node 24
npm install
npm run check      # eslint + tsc + jest
npm test -- __tests__/engine   # 只跑引擎测试
npm run android    # 需要 Android SDK；iOS 后补
```

| 文档 | 内容 |
| --- | --- |
| [docs/PRODUCT_DESIGN.md](docs/PRODUCT_DESIGN.md) | 产品目标、范围、信息架构、功能清单、AI 接入、技术栈、里程碑 |
| [docs/TRADING_RULES.md](docs/TRADING_RULES.md) | 交易规则与费用的规格说明（撮合引擎和费用引擎按它实现） |
| [docs/ENGINE.md](docs/ENGINE.md) | 交易引擎：模块、单位、撮合和清算的实现说明，以及和规格的差别 |
| [docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md) | AI 助手：页面上下文、最近操作、对话摘要和长期记忆，以及两种协议的请求结构 |
| [docs/design/prototype.html](docs/design/prototype.html) | 可交互原型，用浏览器直接打开（源文件在 [docs/design/prototype/](docs/design/prototype/)） |
| [docs/research/quant-roadmap.html](docs/research/quant-roadmap.html) | 量化学习路线（产品目标的出处） |

## 技术栈

沿用 NovelCreationPartner 的组合：React Native 0.87 + TypeScript、react-navigation 7、zustand、op-sqlite（本地行情库和账户账本）、react-native-svg（K 线 / 分时图）、lucide 图标；M4 加 react-native-keychain（AI Key）。
本地优先，没有后端：行情直接请求腾讯行情接口（ETF 排行用新浪，分红送配用东方财富），AI 直接用你自己的 Base URL + API Key，支持 OpenAI Responses 和 Anthropic Messages 两种协议。

## 免责声明

本项目只用于学习和模拟，不构成任何投资建议，不连接任何真实券商账户，也不能下真实订单。
规则和费率以交易所、中国结算和你所在券商的最新公告为准。

## License

GPL-3.0-only
