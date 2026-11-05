# AI 请求体策略方案

日期：2026-11-03。状态：已实现，等待重启 Serpent 后用当前档案复测。

依据：`docs/internal/research/2026-11-03-mainstream-model-api-formats.md`。该文件记录厂商文档与当前发送点的差异；本方案只决定 Serpent 如何组请求，不改档案、凭据或分析行为设置。

## 1. 结论

五种线协议继续由用户档案里的 `apiFormat` 决定。思考、温度和输出上限按「协议 + 已知主机 + 已记录的模型前缀」选择，分析、连接测试和搜索规划共用同一份纯函数。

未知主机不猜测厂商，也不发送该协议文档之外的字段。已知且文档要求关闭思考的主机直接发送对应字段。文档写明拒绝关闭的型号省略该字段，保留模型自己的默认思考。

不引入 LiteLLM、OpenRouter 或其它网关。它们能把调用方的一个参数翻译成上游字段，但不能让拒绝 `thinking.type = disabled` 的模型接受这个值，也不能在不改变结构化输出方式的前提下消掉 DeepSeek「强制工具时必须关闭思考」的限制。把同一张能力表放进现有适配器，避免再增加本机进程、密钥转发和自定义 Base URL 的绕行。

当前 `AnthropicVendorAdapter` 对所有 Anthropic 请求写入 `thinking: { type: "disabled" }`。这修了 DeepSeek 的具名工具 400，同时让文档拒绝 `disabled` 的模型新产生 400。实施本方案时删掉这处无条件字段，改由策略函数决定写或不写。

## 2. 不采用的做法

- 不按模型名猜测线协议。`apiFormat` 仍是唯一的协议来源。
- 不把 `thinking.type` 写进 OpenAI 官方、Gemini、DashScope 原生请求。这三家的文档字段分别是 `reasoning_effort` 或 `reasoning.effort`、`thinkingConfig`、`enable_thinking`。
- 不给全部 OpenAI 模型发送 `reasoning_effort: none` 或 `reasoning.effort: none`。GPT-6 Astra 拒绝 `none`。
- 不给全部 Gemini 模型发送 `thinkingBudget: 0`。Gemini 2.5 Pro 不能关闭；Gemini 3/4 与 `thinkingLevel` 同时出现会 400。
- 第一期不增加档案级「思考开/关」开关。用户可见行为保持现有档案字段。
- 不根据一次失败自动改写 `apiFormat` 或 Base URL。地址提示与新建档案自动成为当前档案已经落地，不属于本方案。

## 3. 策略模块

新增 `src/shared/ai-request-policy.ts`。输入是 `apiFormat`、`baseUrl`、`model`、用途 `probe | analyze | search`。输出是各协议请求体里允许增减的那几项，不负责拼消息、工具或 schema。

主机判断只看 URL 的 hostname，路径仍交给 `src/shared/ai-endpoints.ts`。`https://api.deepseek.com/anthropic` 与 `https://api.deepseek.com` 是同一主机上的两种协议。空 Base URL 视为该 `apiFormat` 的官方默认主机。

模型前缀只在该主机的官方文档把约束绑定到模型族时使用。前缀表与主机表放在同一模块，并在注释里指向调研文档的对应小节。不从模型名推断主机。

四个适配器与 `planAiSearch` 的 `providerRequest` 都调用这个模块。搜索规划不得再手写一套与分析相反的 Anthropic 字段。

## 4. 各协议的固定规则

### Anthropic Messages

结构化输出继续用现有具名工具：分析是 `serpent_classify_asset`，搜索是 `serpent_prepare_search`。连接测试不带工具。

| 条件 | `thinking` | 探测 `max_tokens` | 温度 |
| --- | --- | --- | --- |
| 主机 `api.deepseek.com` | `{ type: "disabled" }` | 16 | 探测 0，分析 0.2，搜索 0 |
| 百炼 Anthropic 主机，且模型前缀不在拒绝表 | `{ type: "disabled" }` | 16 | 同上 |
| 百炼 Anthropic 主机，模型前缀在拒绝表 | 省略 | 256 | 省略温度 |
| `api.moonshot.ai`，`kimi-k2.7-code`、`kimi-k3`、`kimi-k3.1` | 省略 | 256 | 省略温度 |
| `api.moonshot.ai`，`kimi-k2.5`、`kimi-k2.6` | `{ type: "disabled" }` | 16 | 0.6。这两个型号只接受思考时 1.0、非思考时 0.6 |
| `api.moonshot.ai` 上未列入上两行的型号 | 省略 | 256 | 保持现有温度。不猜测关闭思考 |
| `api.minimax.io` | 省略。M3.1-Flash 拒绝 `disabled` 与 `effort: none` | 256 | 保持现有温度 |
| `api.anthropic.com` 与其它未登记主机 | 省略 | 256 | 保持现有温度 |

百炼 Anthropic 主机是 `*.maas.aliyuncs.com`。拒绝表前缀：`kimi-k2.7-code`、`kimi-k3`、`glm-5.3`、`minimax-`。千问与百炼上的 DeepSeek 不在拒绝表内，按文档示例发送 `disabled`。

省略 `thinking` 时探测上限用 256，避免默认开启的思考把 16 个 token 用完后没有可解析文本。已显式关闭思考的探测仍用 16。

`api.z.ai` 以及第三方汇总中的智谱 Anthropic 地址不进入已知主机表。GLM-5.3 拒绝 `disabled` 只在请求已经落到百炼，且模型前缀命中时生效。未核验的智谱国内 Anthropic 路径按未知主机处理：省略 `thinking`。

### OpenAI Chat Completions

| 条件 | 额外字段 | 探测输出上限 | 温度 |
| --- | --- | --- | --- |
| 主机 `api.deepseek.com` | `thinking: { type: "disabled" }`。这是 DeepSeek Chat 文档字段，不是官方 OpenAI 字段 | `max_tokens: 16` | 探测 0，分析 0.2，搜索 0 |
| 官方 `api.openai.com`，模型前缀 `o1`、`o3`、`o4`、`gpt-5`、`gpt-6` | 不发送 `thinking`，不发送 `reasoning_effort` | `max_completion_tokens: 256`，不发送 `max_tokens` | 省略 |
| 官方主机上的其它模型，以及未登记的兼容地址 | 不发送 `thinking`，不发送 `reasoning_effort` | 保持 `max_tokens: 16` | 保持现有温度 |

分析与搜索的结构化输出保持现有协商：Chat 为 `json_schema`，失败再降级。本方案不把分析改成函数调用。官方文档写明，自 GPT-5.4 起 Chat Completions 在 `reasoning_effort` 不是 `none` 时不支持函数调用；当前两条路径都不依赖该组合。

### OpenAI Responses

| 条件 | 额外字段 | 探测 | 温度 |
| --- | --- | --- | --- |
| 主机 `api.deepseek.com` | `reasoning: { effort: "none" }` | `max_output_tokens: 16` | 保持现有温度 |
| 官方 `api.openai.com` 的推理族前缀，与 Chat 表相同 | 不发送 `reasoning` | `max_output_tokens: 256` | 省略 |
| 其它主机 | 不发送 `reasoning` | 保持 `max_output_tokens: 16` | 保持现有温度 |

结构化字段继续用 `text.format`，不改成 Chat 的 `response_format`。

### Gemini generateContent

不发送 `thinking.type`，第一期也不发送 `thinkingConfig`。`thinkingBudget: 0` 会让 2.5 Pro 失败，Gemini 3/4 又使用另一套 `thinkingLevel`。

- 分析补上 `maxOutputTokens: 4096`，避免默认思考占满未声明的输出。
- 探测从 `maxOutputTokens: 16` 改为 256。
- 温度保持现有值。

关闭 Flash 思考留到有模型前缀与 `thinkingBudget` / `thinkingLevel` 的对应表之后，不放进第一期。

### DashScope 原生

不发送 `thinking.type`。分析与搜索是非流式 JSON mode，请求体增加 `enable_thinking: false`。百炼规定非流式思考模型必须显式关闭；`enable_thinking: true` 时 JSON mode 不被支持，因此第一条请求不能同时打开思考和 `response_format`。

连接测试不使用 JSON mode，同样发送 `enable_thinking: false`，温度保持 0。

百炼 OpenAI 兼容路径如果被用户选成 `openai_chat`，千问需要的是 `enable_thinking` 而不是 `thinking.type`。该字段只在主机为 `*.maas.aliyuncs.com` 或 `dashscope.aliyuncs.com` 时写入 Chat 请求；DeepSeek 主机仍按上一节写 `thinking.type`。两条规则不能叠在同一请求上。

## 5. 一次重试

策略先按上表组第一次请求。只有 HTTP 400 或 422，且响应正文包含下表中的原文子串时，才改一次字段并重试。重试仍失败则把错误交给现有映射，不再循环。

子串只收录调研文档或官方错误码里已经出现的句子，以及以后从 `providerMessage` 抄下来的原文。不预写「可能是这个意思」的句子。

| 已记录子串 | 出现在 | 第二次请求 |
| --- | --- | --- |
| `must be set to false for non-streaming calls` | DashScope 或百炼 Chat | 已由第一次请求发送 `enable_thinking: false` 覆盖。若仍出现，不再重试 |
| `restricted to True` | 同上，模型不允许关闭思考 | 去掉 `response_format`，改 `enable_thinking: true`。JSON 改由提示词约束，解析失败按现有无效响应处理 |
| `requires adaptive thinking` | MiniMax | 去掉 `thinking` 与 `effort: none`。已知 MiniMax 主机的第一次请求已经省略，此条用于未登记地址误加了关闭字段的情况 |

DeepSeek「具名工具与默认思考冲突」没有在调研中留下可复制的错误原文。该主机由第 4 节直接发送 `disabled`，不靠重试猜文案。Anthropic 适配器已经把正文截断进 `providerMessage`。第一次在未知主机上拿到新的 400 原文后，先追加到词表和调研文档，再允许第二次请求改字段。

OpenAI、Gemini、DashScope 的错误映射在实施时与 Anthropic 对齐：400/422 的响应正文进入 `providerMessage`，最长 240 字符，并走现有脱敏。没有正文就不能匹配重试词表。

## 6. 发送点

| 位置 | 改动 |
| --- | --- |
| `src/worker/ai/anthropic-adapter.ts` | 删除两处无条件 `thinking`。分析、探测按策略合并字段。探测上限随策略变化 |
| `src/worker/ai/openai-adapter.ts` | Chat 与 Responses 的分析、探测按策略合并字段。官方推理族探测改用 `max_completion_tokens` |
| `src/worker/ai/gemini-adapter.ts` | 分析增加 `maxOutputTokens: 4096`；探测改为 256。不增加 `thinkingConfig` |
| `src/worker/ai/dashscope-adapter.ts` | 分析增加 `enable_thinking: false`。探测同样关闭。命中「restricted to True」时按第 5 节重试一次 |
| `src/main/ai-search-planner.ts` | 五个分支改为调用同一策略。Anthropic 搜索在 DeepSeek 主机上带 `thinking.type: disabled`，与分析一致 |

档案保存、活动档案、Base URL 提示和连接超时不在本次修改范围内。

## 7. 测试

策略模块用表驱动单测，不访问网络。每行是主机、模型、协议、用途，断言字段存在、省略或取值。至少覆盖：

- DeepSeek Anthropic：分析、探测、搜索都带 `thinking.type: disabled`，探测 `max_tokens` 为 16。
- `api.anthropic.com` 与未知 Anthropic 主机：三个用途都省略 `thinking`，探测 `max_tokens` 为 256。
- 百炼 Anthropic：`qwen3-vl-plus` 发送 `disabled`；`kimi-k2.7-code`、`glm-5.3`、`minimax-m2.5` 省略。
- Moonshot：`kimi-k2.6` 发送 `disabled` 且温度为 0.6；`kimi-k3` 省略 `thinking` 和温度。
- MiniMax Anthropic：省略 `thinking`。
- 官方 OpenAI 推理族：不出现 `thinking` 与 `reasoning_effort: none`；Chat 探测只有 `max_completion_tokens`。
- DeepSeek Chat：有 `thinking.type: disabled` 且仍用 `max_tokens`。DeepSeek Responses：`reasoning.effort` 为 `none`。
- 未登记的 OpenAI 兼容主机：不出现 `thinking` 与 `reasoning`。
- Gemini：无 `thinkingConfig`；分析上限 4096，探测上限 256。
- DashScope：分析请求同时有 `enable_thinking: false` 与 `json_object`。
- 重试：正文不含词表时不发第二次；含 `restricted to True` 时第二次去掉 JSON mode 并打开思考；含 `requires adaptive thinking` 时第二次去掉关闭字段。

适配器测试只断言它们把策略结果放进请求体，不复制整张主机表。搜索规划的 Anthropic 用例与分析用例使用同一组 DeepSeek 输入，两份 body 的 `thinking` 必须一致。

## 8. 分期

1. 加入策略模块和上表单测。此时适配器行为不变。
2. 把四个适配器和 `planAiSearch` 接到策略模块，并删掉 Anthropic 的无条件 `thinking`。补齐非 Anthropic 适配器的 `providerMessage`。
3. 接上第 5 节的一次重试，并补重试单测。

第 1 步可以单独合并。第 2 步之后，现有 DeepSeek Anthropic 档案 `dpsk` 仍会在强制工具时关闭思考；官方 Claude 与未知 Anthropic 代理恢复为不发送 `thinking`。运行中的 Electron 不会热加载 worker 与 main 的请求体变更，这两步的验证需要重启 Serpent。

## 9. 不在本方案内

- 用外部网关统一字段名。
- 为不能关闭思考的模型伪造结构化工具结果。这些模型继续走各自协议已有的 JSON schema 或提示词约束；Anthropic 上若省略 `thinking` 后具名工具仍返回 400，保留该错误，等 `providerMessage` 出现后再追加词表。
- Gemini 按型号关闭思考。
- 档案级思考开关、自动改写 Base URL、调整 15 秒连接测试超时。
