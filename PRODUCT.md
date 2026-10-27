# AShareSim

<!-- impeccable:product-schema 1 -->

## Platform

android

## Stack

现有 React Native / TypeScript App，SQLite 本地存储；先交付 Android，iOS 后补。

## Users

个人使用；通过真实 A 股行情、规则和税费进行模拟交易，学习交易和个人量化。

## Product Purpose

帮助用户理解交易与费用、记录模拟操作，并通过可追溯数据获得 AI 分析和明确的投资建议。

## Capabilities and Constraints

- 入金和交易为模拟，不连接真实券商。AI 的写操作仍需用户确认。
- AI 直连用户配置的供应商，Key 保存在设备安全存储，不写入页面上下文、日志和记忆。
- 供应商与模型分开管理；模型、思考和搜索随会话保存，新会话沿用最近选择。
- 能力和引用必须来自明确标注或实际接口结果；原型中的模型列表、回答和耗时都是演示数据。
- 历史记录与已有服务配置必须平滑迁移。

## Brand Commitments

沿用 AShareSim 的中文术语和现有浅色界面。AI 改版按用户明确选定的 docs/design/ai-redesign.html 布局与交互落地。

## Evidence on Hand

- docs/PRODUCT_DESIGN.md、docs/AI_ASSISTANT.md：现有产品与协议约束。
- docs/design/ai-redesign.html：用户选定的交互原型及说明。
- src/ui/、src/ai/：现有原生实现。

## Product Principles

- 建议先给判断与依据，数据可追溯。
- 模型能力明确呈现，未知能力允许标注。
- 搜索由用户按会话控制，不自动改变请求或费用。
- 流式阅读、键盘避让和已收到的正文不能因改版而退化。

- 页面只常驻展示数据、操作和当前状态；删除泛泛免责声明、重复提醒与实现细节。成本、收益等补充公式按需展开，操作校验、资金冻结和确认信息保留。
