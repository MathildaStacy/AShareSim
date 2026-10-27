# AI 助手：上下文与记忆

> 版本 0.4 · 2026-10-27 · 配套：[产品设计 §6.5](PRODUCT_DESIGN.md) · [AI 助手新版交互原型](design/ai-redesign.html)

目标：AI 随时知道你在哪个页面、页面上有什么、你最近做了什么，并且记得你说过的话。你不用每次解释「我说的是哪笔单子」。

回答方式：以资深投资理财分析师的视角，基于工具查询的数据独立判断。投资问题先给出明确建议和优先选择，再解释关键理由、投资期限、适用条件、主要风险和改变判断的信号；可以推荐具体股票或 ETF、进出价格区间和仓位。缺少关键数据时说明缺口和假设，不编造数字，不承诺收益。不再禁止荐股，也不要求每次回答附免责声明。聊天页不再重复显示免责或固定尾注。

## 1. 每次请求带什么

按发送顺序排列。不变的内容放在前面，这样能命中提示词缓存；每次都变的内容放在最后一条用户消息里。缓存怎么打见 §6。

| # | 内容 | 大小（约） | 变化频率 | 放在哪 | 缓存 |
| --- | --- | --- | --- | --- | --- |
| 1 | 工具定义 + 固定系统提示 | 1.5k tokens | 随版本变 | tools、system 第 1 块 / instructions 开头 | 断点 1，所有对话共用 |
| 2 | 记忆快照（上限 50 条）+ 当前对话摘要 | ≤ 1.5k | 换对话、压缩时 | system 第 2 块 / instructions 末尾 | 断点 2 |
| 3 | 历史消息（每条提问连同当时附带的页面和操作原样保留） | 视对话 | 只追加 | messages / input | 自动断点 |
| 4 | 当前页面 `<page_context>` | 100–300 | 每次 | 最后一条用户消息 | 下一轮变成前缀 |
| 5 | 最近操作 `<recent_actions>` | 100–400 | 每次 | 最后一条用户消息 | 同上 |
| 6 | 你的问题 | — | 每次 | 最后一条用户消息 | 同上 |

数据（行情、K 线、财务、持仓、委托、成交、费率）不预先塞进去，由模型按需调用只读工具读取。第 5、6 项只是「你在看什么、做了什么」的线索，具体数字以工具结果为准。

用户可以在「AI → 上下文条 → 发给 AI 的上下文」页看到上面每一项的原文、token 数和实际请求结构，并且可以关掉页面上下文、调整最近操作条数（0 / 5 / 10 / 20）。

## 2. 页面上下文

每个页面实现一个函数，返回用户此刻在这个页面上看到的东西：

```ts
type PageContext = {
  name: string;     // 「买入 · 沪深300ETF」「查询 · 当日委托」
  lines: string[];  // 页面上看得到的关键数据，一行一条，带单位
  tip?: string;     // 用户问「解释这个页面」时的要点
};
interface Screen { aiContext?(params): PageContext }
```

规则：

- 只写用户在屏幕上看得到的东西，不写内部状态。
- 表单页带上输入值和**校验结果**。例如买入页填了 150 份 ETF，会写「表单校验不通过：申报单位。买入必须是 100 份的整数倍」。
- 涉及费用的页面带上费率状态，包括「还没有用真实交割单校准」。
- 不写 API Key、不写其他对话的内容。
- 页面没实现 `aiContext` 时，退回到页面标题。

打开 AI 时，记下来源页面（路由名 + 参数），每次提问时**重新计算**它的上下文，所以行情和表单都是最新值。从 AI 跳到别的页面再打开 AI，当前对话会插入一条「你现在在：xxx」分隔线，模型和你都能看出话题换了地方。

V1 必须实现的页面：个股、买入 / 卖出 / 撤单、持仓、当日委托 / 成交 / 交割单、委托详情、成交详情、银证转账、费率、交割单校准、规则课、费用计算器、账户分析、阶段页。

## 3. 最近操作

本机的操作日志，表 `activity_log`：

| 字段 | 说明 |
| --- | --- |
| `id`, `trade_date`, `ts` | 交易日和时间 |
| `kind` | `view` 浏览 / `order` 委托 / `reject` 被拦截或废单 / `cancel` 撤单 / `fill` 成交 / `transfer` 转账 / `setting` 设置 / `learn` 学习 / `export` 导出 / `system` 清算、扣税 / `ai` AI 代操作（操作卡执行结果，M4） |
| `text` | 一句人话，例如「委托卖出 招商银行 1,000股 @40.34 → 废单：超出价格笼子」 |
| `ref` | 关联对象：`order_id` / `fill_id` / `lesson_id` / 校验失败的规则 |

- 记录点在引擎和 UI 两层：引擎记委托、成交、撤单、清算、扣税；UI 记浏览、提交前被拦截、小测、校准、设置修改、导出。
- 连续停留在同一个页面只记一次浏览。
- 委托记录排在它引起的成交前面（同一时刻下单即成交时）。
- 保留最近 500 条或 90 天；可以在上下文页一键清空。
- 每次请求带最近 N 条（默认 10）；更早的由模型调用 `get_activity(n, kinds)` 查询。
- 快捷问题跟着最后一条非浏览操作变：废单 →「刚才那笔为什么是废单？」，被拦截 →「刚才为什么下不了单？」，成交 →「解释刚才这笔成交」，小测答错 →「我刚才那道题错在哪？」。

## 4. 对话和摘要

表 `ai_thread`（`id`, `title`, `summary`, `compacted_count`, `last_page`, `created_at`, `updated_at`）和 `ai_message`（`thread_id`, `role`, `content`, `tool_calls`, `context_note`, `created_at`）。

- 每个对话单独保存，标题取第一个问题。
- 一个对话超过 20 条消息（可选 10 / 20 / 40）时触发压缩：用同一个模型、单独一次请求，把较早的消息总结成摘要（保留结论、用户的决定、待办；不保留行情数字），只留最近 8 条原文。摘要追加到 `summary`，界面上显示「较早的 N 条消息已压缩成摘要」。
- 别的对话**不会**自动带进来。用户问「我们上次聊了什么」时，模型调用 `search_conversations(query)`，在所有对话的标题、摘要和消息文字里检索（`LIKE`；个人使用的数据量很小，不用 FTS5，2026-10-27），返回匹配的对话和摘要。
- 删除对话不会删除从它产生的记忆。

## 5. 长期记忆

表 `ai_memory`（`id`, `kind`, `text`, `source_thread_id`, `created_at`, `updated_at`）。

| 类别 | 例子 |
| --- | --- |
| 背景 | Java / Go 后端工程师，正在学 Python |
| 偏好 | 宽基 ETF 做底仓，个股只用小仓位练习 |
| 计划 | 每月约 5000 元定投；每周一集合竞价调仓 |
| 约定 | 五粮液那笔是练习仓，止损规则还没定 |

- **写入**：模型认为某句话值得长期记住时调用 `remember(text, kind)`。三种模式：自动记住（默认，回答下方显示「已记住：… 撤销」）、先问我（显示「要记住吗？记住 / 不用」）、关闭。
- **不记**：持仓、成交、费率、行情这类 App 里有最新值的数据。例如用户说「我的佣金是万 1 免五」，AI 不存记忆，而是提示「改费率设置」或「用交割单校准」，因为费率是设置项，下单、交割单和 AI 必须用同一个数。
- **使用**：全部记忆都带上，不做检索。50 条约 1k tokens，超过 50 条时提示用户合并。
- **快照**：记忆在 system 里，一改就会让整个对话的缓存失效。所以每个对话第一次发送时拍一个记忆快照，整个对话都用它；对话中途新增或修改的记忆，从下一个对话或下一次压缩开始进入 system。本对话里模型通过 `remember` 的工具结果已经知道新记忆，不影响回答。
- **冲突**：新说法和旧记忆矛盾时，模型先 `forget(id)` 再 `remember`，界面显示两条变更。
- **管理**：「AI → ☰ → AI 记忆」按类别列出，每条显示来源对话和日期，可改、可删、可手动添加。

## 6. 缓存与成本

AI 是按 token 付费的，而这个 App 每次提问都要重发系统提示、工具定义、记忆和整段历史。缓存命中的部分只按很低的价格计费，所以请求结构的头号目标是**让前缀尽可能稳定**。

### 6.1 原则

缓存是前缀匹配：从请求开头起，到第一个不同的字节为止的部分才能复用，之后的全部重算。由此有这些规则：

| 规则 | 做法 |
| --- | --- |
| 不变的在前，变的在后 | 工具 → 固定系统提示 → 记忆快照和摘要 → 历史 → 本轮的页面、操作、问题 |
| system 里不放任何会变的东西 | 时间、行情、交易时段、页面都放进最后一条用户消息；system 里没有日期 |
| 同一段配置的工具列表稳定 | 23 个 App 工具按名字排序；模型不支持工具时不发送。用户开启搜索才加入对应供应商的搜索工具或参数，配置未变时不动态增减。记忆关闭时 `remember` 仍在，调用后返回「记忆已关闭」 |
| 历史只追加、不改写 | 每条提问连同当时附带的页面和操作原样存下来，下次照原样发送；不删旧消息里的页面上下文，也不清理旧工具结果 |
| 记忆用快照 | 见 §5，中途新增的记忆不改 system |
| 模型、思考、搜索按对话保存 | 随时可改；新对话沿用最近选择。改变配置后、发送前显示黄色缓存重建估算与「改回」，发送后插入分隔线；App 不按问题自动切换或开搜索 |
| 压缩复用前缀 | 生成摘要的那次请求，保留 App 工具定义、system 和历史，在末尾追加「请总结」，用 tool_choice 禁止调用；后台摘要不启用搜索，因此搜索开启时工具前缀可能变化。压缩后历史被改写，缓存重建一次，正好顺便刷新记忆快照 |
| 序列化确定 | JSON 按固定键序输出，工具 schema 固定，避免同样内容出现不同字节 |

### 6.2 Anthropic Messages

- 打 3 个断点（上限 4 个）：
  1. system 第 1 块（固定系统提示）：`cache_control: {type: "ephemeral"}`。tools 排在 system 前面，这个断点把工具和系统提示一起缓存，所有对话共用。
  2. system 第 2 块（记忆快照 + 对话摘要）：同上。一个对话里不变。
  3. 请求顶层 `cache_control: {type: "ephemeral"}`（自动缓存）：断点落在最后一块，随着对话增长自动后移。这一轮的提问写进缓存，下一轮就是读。
- TTL 用默认 5 分钟：写入 1.25 倍价格，读取约 0.1 倍（Claude Sonnet 5.5 和 Opus 5.5 是每百万 0.20 美元）。连续提问时每次读取都会刷新计时，所以一直是热的。1 小时 TTL 写入要 2 倍价格，个人使用的提问间隔多数在 5 分钟内，不划算，不开。
- 不做预热（`max_tokens: 0`）：打开 AI 页时不一定会提问，预热就是白付一次写入。
- 最小可缓存长度：当前模型（Opus 5.5、Sonnet 5.5、Haiku 5.5）是 512 tokens，断点 1 的 1.5k tokens 够了。旧模型更高（例如 Haiku 4.5 是 4096），不够长时服务端静默不缓存，不报错。
- 验证：每次响应记录 `usage.input_tokens`（未缓存）、`cache_creation_input_tokens`（写）、`cache_read_input_tokens`（读）。同一对话第二次提问的读取应该覆盖之前的全部内容；如果读取是 0，说明前缀被改了，按「两次请求逐字节对比」排查。

### 6.3 OpenAI Responses

- 缓存由服务端自动做，不需要打断点。
- 发送 `prompt_cache_key`：每台设备生成一个固定值（例如 `asharesim-<安装 ID>`），让同一前缀的请求路由到同一台缓存机器。个人使用远低于每个 key 约 15 次 / 分钟的建议上限。
- GPT-5.6 起默认 `prompt_cache_options: {mode: "implicit", ttl: "30m"}`，App 不发送，用默认值。更早的模型对非 ZDR 组织默认 `prompt_cache_retention: "24h"`，也不发送。
- 计费：GPT-5.6 起缓存读 0.1 倍、30 分钟写入 1.25 倍；更早的模型只有缓存读折扣，没有写入加价。
- 验证：`usage.input_tokens_details.cached_tokens`（读），GPT-5.6 起还有 `cache_write_tokens`（写）。

### 6.4 兼容服务

很多中转服务和国产模型的兼容接口不一定认识 `cache_control`、`prompt_cache_key` 这类字段。每个服务有「缓存参数：自动 / 关闭」设置：

- 「测试连接」时带上缓存字段发一次；服务返回「未知字段」类 400 时，自动改成关闭，并告诉用户。思考字段（`thinking` / `output_config` / `reasoning`）同理：服务不认时仅在允许关闭的模型上降为不发送；强制思考的模型不自动关闭，返回具体接口错误。
- Anthropic 协议的鉴权头可选 `x-api-key`（官方）或 `Authorization: Bearer`（不少中转服务要这个）。
- 正式请求遇到同样的 400 时去掉缓存字段重发一次，并记住这个服务。
- 响应里没有缓存相关的 usage 字段时，界面显示「该服务没有报告缓存数据」，不估算。

### 6.5 用户能看到什么

- 每条回答下方：缓存读 / 写 / 输出 token，以及按模型价格估算的费用和「不用缓存要多少」。价格在模型设置里填（美元 / 百万 tokens，选填）。
- 输入框下方：这次大约多少 tokens，预计多少走缓存；缓存是冷的时候说明原因。
- 上下文页：每部分属于哪个断点，本对话累计的命中率和节省比例，哪些操作会让缓存失效（换服务或模型、改思考强度、压缩、超过 5 分钟没提问），哪些不会（换页面、开关页面上下文、调操作条数、新增记忆）。
- 原型里的模拟（Claude Sonnet 5.5 价格）：第一次提问因为要写缓存，比不用缓存略贵；从第二次开始每次只写新增的几百 tokens，4 轮对话累计省约 40%，对话越长省得越多。

### 6.6 缓存之外的省钱手段

- **工具结果要紧凑**：K 线、财务数据用紧凑的 CSV 风格文本返回，不用逐字段的 JSON；默认 60 根 K 线，需要更多时模型再要。这一项通常比缓存省得还多。
- **思考强度默认低**：讲解和问答用 `low`，复盘和账户分析这类需要推理的才建议 `medium`。按服务设置，不按问题切换（切换会让缓存失效）。
- **最近操作条数**：默认 10 条，大约 250 tokens；不需要时调成 5 或关掉。
- **压缩阈值**：20 条消息压缩一次。阈值越低单次请求越短，但压缩越频繁，缓存重建也越频繁，20 是折中。
- 模型选择由你决定，App 不自动降级到更便宜的模型。

## 7. 请求结构

三种协议都用**无状态**请求：App 自己保存历史和摘要，每次发送完整上下文。好处是三种协议走同一套逻辑、压缩策略由 App 控制，也不需要服务端保存对话（Responses 设 `store: false`）。

Anthropic Messages：

```jsonc
POST {base}/v1/messages
anthropic-version: 2023-06-01
{
  "model": "…",
  "max_tokens": 16000,
  "stream": true,
  "thinking": { "type": "adaptive" },
  "output_config": { "effort": "low" },            // 按服务固定
  "cache_control": { "type": "ephemeral" },        // 自动断点：对话末尾
  "tools": [ { "name": "get_quote", "description": "…", "input_schema": { … } }, … ],  // 按名字排序
  "system": [
    { "type": "text", "text": "<固定系统提示>",
      "cache_control": { "type": "ephemeral" } },  // 断点 1：tools + 系统提示
    { "type": "text", "text": "<memory>…</memory>\n<conversation_summary>…</conversation_summary>",
      "cache_control": { "type": "ephemeral" } }   // 断点 2：记忆快照 + 摘要
  ],
  "messages": [
    …最近 8 条…,
    { "role": "user", "content": [
      { "type": "text", "text": "<page_context>…</page_context>\n<recent_actions>…</recent_actions>" },
      { "type": "text", "text": "刚才那笔为什么是废单？" } ] }
  ]
}
```

工具调用：响应里的 `tool_use` 块 → App 执行 → 下一轮用户消息带 `tool_result`。

OpenAI Responses：

```jsonc
POST {base}/v1/responses
{
  "model": "…",
  "store": false,
  "stream": true,
  "prompt_cache_key": "asharesim-<安装 ID>",
  "reasoning": { "effort": "low" },                // 按服务固定
  "instructions": "<固定系统提示>\n<memory>…</memory>\n<conversation_summary>…</conversation_summary>",
  "tools": [ { "type": "function", "name": "get_quote", "description": "…", "parameters": { … } }, … ],
  "input": [
    …最近 8 条…,
    { "role": "user", "content": [
      { "type": "input_text", "text": "<page_context>…</page_context>\n<recent_actions>…</recent_actions>" },
      { "type": "input_text", "text": "刚才那笔为什么是废单？" } ] }
  ]
}
```

工具调用：输出里的 `function_call`（带 `call_id`）→ App 执行 → 把 `{ "type": "function_call_output", "call_id", "output" }` 追加到 `input` 再请求。

三种协议都设工具调用轮数上限（默认 6 轮）。正式回答使用 `stream: true`，通过 React Native XHR 的 progress 事件接收 SSE，正文边收到边显示，按约 40ms 的间隔更新界面；完整结束后再一次性保存正文、原始响应和最终用量。只在完整结束后执行工具调用，工具参数分片不会提前执行。停止、超时或断线时保留已收到的正文和错误说明，未完成的工具参数及推理块不进入后续请求；服务忽略流式参数而返回普通 JSON 时仍可正常显示。测试连接和后台摘要继续使用普通 JSON 请求。Chat Completions 根据 delta 拼接正文、公开 reasoning_content、工具参数与末尾 usage；必须收到 finish_reason 才视为完整响应。

查询过程默认折叠成「已查询 N 项数据」，可展开查看每个来源；操作卡、记忆变更和查询错误直接显示。没有正文的工具调用不再占一个空白回答块。停留在底部时跟随新文字，向上翻阅时停止自动滚动，可点「回到最新回复」继续跟随。最终 Markdown、引用链接、操作结果和用量信息全部保留。

Responses 带 `include: ["reasoning.encrypted_content"]`，把推理内容原样传回（`store: false` 时必须这样做，否则工具调用之后模型丢了推理）；Messages 的 thinking 块及签名也原样传回。换了供应商、协议或模型时，旧消息只发文字和工具调用，不发推理签名、加密块等专有内容；不支持工具的目标接口使用可读文字保留旧工具调用和结果。同一个问题里的多轮工具调用也是只追加，每一轮都读上一轮的缓存。

## 8. 工具

工具列表固定（23 个，按名字排序），任何设置下都不增减。工具结果用紧凑文本（K 线是 CSV 风格），数字带单位。

读取（直接执行）：

| 工具 | 用途 |
| --- | --- |
| `get_quote(code)` | 实时快照、五档、涨跌停价、市值、PE / PB |
| `get_kline(code, period, n)` | 日 / 周 / 月 K（前复权）、15 / 30 / 60 分钟 K、分时；默认 60 根 |
| `get_company_profile(code)` | 公司简况、主营业务（东方财富 F10） |
| `get_financials(code, periods)` | 主要财务指标：营收、归母净利润、每股收益、ROE、毛利率（东方财富） |
| `get_positions()` | 账户概览（总资产、可用、可取、冻结）、持仓、可卖、两种成本 |
| `get_orders(scope)` | 当日 / 未完成 / 历史委托和状态 |
| `get_trades(from, to)` | 成交和交割单（含逐项费用） |
| `get_fee_profile()` | 当前费率、是否已用交割单校准 |
| `get_rule(topic \| code)` | 规则课内容和 TRADING_RULES 对应小节；给代码时返回这只证券的规则卡 |
| `get_learning()` | 路线图进度、规则课通过情况、自动项还差什么 |
| `get_activity(n, kinds)` | 比上下文更早的操作记录 |
| `search_conversations(query)` | 检索其他对话的标题、摘要和消息 |

记忆（按记忆模式执行，见 §5）：`remember(text, kind)`、`forget(id)`。

操作 App（2026-10-27 起，替换原来的「没有下单、撤单、转账、改设置的工具」）：

| 工具 | 怎么执行 |
| --- | --- |
| `navigate(route, params)` | 直接执行：这一轮回答结束后关掉 AI 页、打开目标页面，可以带参数把表单填好（下单页的方向、代码、价格、数量、类型；银证转账的方向和金额；费用计算器的代码、价格、数量） |
| `place_order(code, side, kind, price, qty, protect)` | 生成操作卡 |
| `cancel_order(order_id)` | 生成操作卡 |
| `transfer(direction, amount)` | 生成操作卡 |
| `set_watchlist(add, remove)` | 生成操作卡 |
| `set_fee_profile(…)` | 生成操作卡（改费率只对之后的委托生效，卡上写明） |
| `set_settings(…)` | 生成操作卡：成本口径、后台跟踪模式和间隔、快照保留、累计入金上限 |
| `set_learn_check(item_id, done)` | 生成操作卡：只能改手动项；小测和演示不能替你答 |
| `reset_account()` | 生成操作卡，卡上写明会归档什么、保留什么 |

操作卡流程：

1. 模型调用写工具 → App 用引擎同一套校验预检查，把操作卡插进这条回答 → 工具结果告诉模型「已生成操作卡 #n，等待用户确认；预校验：通过 / 不通过：……」。模型不会知道用户之后点了什么，所以回答里只能说「确认后会……」。
2. 你点「执行」→ App 执行并更新卡片状态，记操作日志（标「AI 代操作」）；执行结果在下一次提问时以 `<action_results>` 附在最后一条用户消息里，模型据此知道结果。卡片状态只存在消息的界面数据里，不改发给模型的历史，所以不影响缓存。
3. 点「取消」或者不点：什么都不发生。同一张卡只能执行一次；换了账户（重置）后旧卡失效。

规则：AI 可以独立提出买卖建议，但建议不等于操作授权。只在你明确要求操作（例如「帮我挂一笔 9:20 的沪深300ETF 买单，100 份，价格 4.85」）并给出或确认代码、方向、价格、数量等具体参数后，才生成操作卡或预填表单；没说清楚时先问。「能不能买」这类咨询不会被当成下单指令。

## 9. 隐私

- 上下文只发给你在「AI 服务」里配置的服务，不经过其他服务器。
- 操作日志、对话、摘要、记忆都存在本机 SQLite；API Key 存 Android Keystore / iOS Keychain。
- 页面上下文和最近操作都可以关掉；操作日志可以清空；对话和记忆可以逐条删除。
- 重置模拟账户时，操作日志随旧账户归档；对话和记忆保留（它们是关于你的，不是关于这个账户的），可以单独清空。

## 10. 实现说明（M4，2026-10-27）

代码在 `src/ai/`：`models.ts`（能力目录、供应商预设、配置归一化）、`catalog.ts`（真实模型目录分页）、`evidence.ts`（思考摘要、搜索记录与引用）、`search.ts`（Kimi 搜索 REST）、`protocol.ts`（三种协议的请求和响应，纯函数）、`stream.ts`（SSE 分帧、文字与工具参数增量、完整响应重建）、`http.ts`（fetch / XHR 传输、错误归类、Key 抹除）、`prompt.ts`（系统提示、记忆快照、每次附带的上下文、token 和费用估算）、`chat.ts`（流式提问循环、操作卡、记忆确认、压缩、上下文页预估、测试连接）、`tools/`（23 个工具）。表在 `src/data/migrations/0003_ai.ts`，`0004_ai_options.ts` 添加会话配置与上次发送配置。

- 消息按「一次请求一行」存：`user`（提问连同当时附带的上下文）、`assistant`（模型的一次响应，`raw` 里是原始内容含推理）、`tool`（这次响应全部工具调用的结果）。发送时原样转换，所以前缀逐字节不变；测试里有专门的「前缀稳定」用例。
- 操作卡预校验不通过时「执行」按钮不可点（例如可用资金不足、申报单位不对），卡上写明是哪条规则；条件变了让 AI 重新生成。执行时按当时的状态再校验一遍。
- 「先问我」模式下你点「记住 / 不用」、自动模式下你点「撤销」，结果也放进下一次提问的 `<action_results>`。
- 发送前的 token 数是本地按字数粗估（中文约 1 字 0.8 token），没有调用计数接口：中转服务不一定提供，而且每次输入都请求一次不划算。回答下方的用量是响应里的真实值。
- 预计走缓存：同一个供应商、模型、思考强度、搜索状态和连接配置，并且在估计 TTL 内（Anthropic 5 分钟、OpenAI 按 30 分钟估）时，按上一次请求的输入总量估；换了对话只算工具和系统提示。
- 请求超时 3 分钟（测试连接 1 分钟），可以随时「停止」；停止或出错时已经发出的工具调用也补上结果，保证下一次请求的历史合法。
- 对话页通过 `KeyboardAvoidingView` 避让键盘：Android 使用 `height`，iOS 使用 `padding`。Android 全面屏模式不能只依赖 `adjustResize`；键盘展开时缩小消息区，让多行输入框和发送按钮保持在键盘上方，收起后恢复页面高度。
- 回答里的 `[文字](lesson:fee)`、`[文字](stock:sh600036)` 可以点，打开规则课或个股页。

## 11. 原型和真实 App 的差别

- 原型的回答是本地模板，用来演示「用到了哪些上下文」，不联网。
- 原型的摘要用「问过的问题列表」代替模型生成的摘要。
- 原型的记忆识别是关键词规则（「我打算…」「记住…」）；真实 App 由模型判断并调用 `remember`。
- token 数是按字数粗估的，真实 App 发送前同样按字数估算，回答后显示服务报告的真实用量。
- 原型的缓存读写是按 Anthropic 的计费规则模拟的（5 分钟 TTL 用真实时间计）；真实 App 直接读响应里的 usage 字段。


## 12. 供应商、模型与对话选项（0.4）

- `aiProviders` 保存供应商连接（协议、地址、鉴权、缓存参数、Key 末四位）及模型目录；完整 Key 仍只在 Keychain/Keystore。每个模型独立启用、覆盖能力和填写价格。
- 预设：Anthropic、OpenAI、DeepSeek、通义、Kimi、智谱、OpenRouter、自定义。目录通过真实 `GET /models` 获取，支持分页；错误不会覆盖已有配置。手动添加模型与能力标注会保留，模型不在目录中也不会被删除。
- `ai_thread.config` 保存当前选择；`last_config` 保存上次发送的选择。设置跟随对话，最近选择存入偏好供新对话沿用。未发送时可改回；历史原文不被重写。
- 旧 `aiServices` 一次性迁成供应商及已启用模型，沿用服务 id，因此 Key 无需迁移。旧对话首次打开时按原回复模型认领；旧版本没记录每轮强度，无法倒推，只能沿用匹配的最近选择或默认档。
- 未知能力不会自动视作支持。用户可标注工具、搜索、思考参数格式与档位、上下文长度；嵌入/重排等模型不供聊天选择。无工具模型会提示不能读取 App 的行情和持仓。
- 只展示模型可用的思考档位。Claude Opus 5.5、GPT-6.1 Sol 等不提供关闭；GLM 开关型显示两档；deepseek-reasoner 与 kimi-k2-thinking 只显示开启。真实能力以当前模型文档和中转实现为准，原型演示档位并非 API 规范。

### 12.1 搜索和思考适配

| 供应商 | 搜索 | 思考 |
| --- | --- | --- |
| Anthropic Messages | 原生 web_search server tool | 新模型 adaptive + output_config；旧模型 budget_tokens |
| OpenAI Responses | web_search，读取 action.sources 和 URL 注解 | reasoning.effort，公开 summary；加密内容仅用于重放 |
| DeepSeek Chat | 官方接口无联网搜索 | 新模型 thinking 开关与 reasoning_effort；旧 reasoner 固定思考 |
| 通义 Chat | enable_search；请求 include_tool_usage | enable_thinking；固定思考模型不发送开关 |
| Kimi Chat | 新 `/v1/tools/search_pro`，作为客户端函数工具执行并存储真实结果 | thinking 开关或固定思考；支持的模型才发送强度 |
| 智谱 Chat | web_search 工具，search_result 开启 | thinking 开关及按模型支持的强度 |
| OpenRouter Chat | web 插件 | reasoning 对象 |
| 自定义 Chat | 标注支持后发送 web_search_options；取决于中转实现 | 用户标注的推理强度或 thinking 开关格式 |

搜索关闭时不自动启用。新闻类问题回答后提供「开启搜索并重问」；当前接口不支持时，说明原因并列出可搜索的已启用模型。每次调用最多执行 6 轮 App / 客户端搜索工具，停止和异常仍保留已收到的文字。

回答依次显示模型与配置、可折叠思考、可折叠查询/网页、App 数据查询、正文、编号来源与实际用量。来源 URL 可点击。只有接口实际返回的信息才被展示，缓存和搜索费用不凭空推算。通义的 Chat 兼容接口不保证返回完整来源或计费次数；没有记录时会明确提示无法核验，不把“允许搜索”说成“已搜索”。搜索价格不包含在 token 价格估算里。

官方协议核对（2026-10-27）：[Claude 思考强度](https://platform.claude.com/docs/en/build-with-claude/effort)、[OpenAI 推理](https://developers.openai.com/api/docs/guides/reasoning)、[OpenAI 搜索](https://developers.openai.com/api/docs/guides/tools-web-search)、[DeepSeek 思考](https://api-docs.deepseek.com/guides/thinking_mode)、[通义思考](https://help.aliyun.com/zh/model-studio/deep-thinking)、[通义搜索](https://help.aliyun.com/zh/model-studio/web-search)、[Kimi 新搜索接口](https://platform.kimi.com/docs/guide/best-practices-for-web-search)、[GLM 思考](https://docs.bigmodel.cn/cn/guide/capabilities/thinking)、[GLM 搜索](https://docs.bigmodel.cn/cn/guide/tools/web-search)、[OpenRouter 搜索](https://openrouter.ai/docs/features/web-search)。
