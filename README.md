# AShareSim · A 股模拟交易与量化入门

用真实行情、按 A 股真实规则和真实税费做模拟交易的手机 App（先做 Android，iOS 后补）。
除了「入金是模拟的」之外，交易时间、集合竞价、T+1、涨跌停、价格笼子、交易单位、佣金 / 印花税 / 过户费 / 红利税都按交易所和券商的现行规则执行。

两个目标：

1. 练习炒股：了解 A 股市场、交易规则和每一笔费用是怎么来的。
2. 为个人量化打基础：对应 [量化学习路线](docs/research/quant-roadmap.html) 的阶段 0–3（规则、Python、统计、数据库），并提前做阶段 7（按真实规则记录模拟执行）。

## 当前状态

产品设计阶段（2026-10-26），还没有 App 代码。

| 文档 | 内容 |
| --- | --- |
| [docs/PRODUCT_DESIGN.md](docs/PRODUCT_DESIGN.md) | 产品目标、范围、信息架构、功能清单、AI 接入、技术栈、里程碑 |
| [docs/TRADING_RULES.md](docs/TRADING_RULES.md) | 交易规则与费用的规格说明（撮合引擎和费用引擎按它实现） |
| [docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md) | AI 助手：页面上下文、最近操作、对话摘要和长期记忆，以及两种协议的请求结构 |
| [docs/design/prototype.html](docs/design/prototype.html) | 可交互原型，用浏览器直接打开（源文件在 [docs/design/prototype/](docs/design/prototype/)） |
| [docs/research/quant-roadmap.html](docs/research/quant-roadmap.html) | 量化学习路线（产品目标的出处） |

## 技术栈（计划）

沿用 NovelCreationPartner 的组合：React Native 0.87 + TypeScript、react-navigation 7、zustand、op-sqlite（本地行情库和账户账本）、react-native-svg（K 线 / 分时图）、react-native-keychain（AI Key）。
本地优先，没有后端：行情直接请求腾讯行情接口，AI 直接用你自己的 Base URL + API Key，支持 OpenAI Responses 和 Anthropic Messages 两种协议。

## 免责声明

本项目只用于学习和模拟，不构成任何投资建议，不连接任何真实券商账户，也不能下真实订单。
规则和费率以交易所、中国结算和你所在券商的最新公告为准。

## License

GPL-3.0-only
