# 主流模型 API 格式与思考开关

> 记录日期：2026-11-03
> 用途：给 Serpent 的连接测试、资产分析和搜索规划对照各厂商当前文档，避免把一种协议的字段写进另一种协议。
> 来源约束：只把厂商官方文档中的写法记为事实。聚合站转述单独标出，不作为实现依据。
> 范围：Anthropic Messages、OpenAI Chat Completions、OpenAI Responses、Gemini `generateContent`、百炼 DashScope 原生，以及在这些协议上提供兼容端点的 DeepSeek、百炼、Kimi、智谱、MiniMax、xAI、Mistral。

## 记录规则

同一厂商往往同时提供多条协议。字段名不能跨协议复用。

| 协议 | 思考开关的文档字段 | 不能拿来冒充的字段 |
| --- | --- | --- |
| Anthropic Messages | `thinking.type`，力度常用 `output_config.effort` | `reasoning_effort`、`enable_thinking`、`thinkingBudget` |
| OpenAI Chat Completions | 官方是 `reasoning_effort`；部分兼容商另收 `thinking.type` 或 `enable_thinking` | 官方请求体没有 `thinking.type` |
| OpenAI Responses | `reasoning.effort` | `thinking.type`、`reasoning_effort` |
| Gemini | `generationConfig.thinkingConfig` 的 `thinkingBudget` 或 `thinkingLevel` | `thinking.type` |
| DashScope 原生 | `enable_thinking` | `thinking.type` |

`thinking.type` 的取值也不是全局枚举。官方 Claude 另有 `adaptive`、`enabled`、`between_tools`。DeepSeek 只保证 `enabled` / `disabled`，并把 `adaptive` 当成 `enabled`。

## 官方协议

### Anthropic Messages

- Base URL：`https://api.anthropic.com`。请求 `POST /v1/messages`。鉴权头 `x-api-key`，并带 `anthropic-version`。
- 结构化输出的官方机制是 tool use，不是 `response_format`。
- 思考配置以模型为准。2026-11-03 的 [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) 与 [Troubleshooting thinking](https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting)：
  - Claude Opus 4.5、Sonnet 4.5、Haiku 4.5、Opus 4.6、Sonnet 4.6、Opus 4.7、Opus 4.8：不传 `thinking` 时思考关闭。`disabled` 被接受。
  - Claude Sonnet 5：默认思考。`disabled` 关闭思考。`enabled` 返回 400。
  - Claude Opus 5、Haiku 5.5：默认思考。`disabled` 只在 effort 为 high 及以下时合法，与 `xhigh` 或 `max` 组合返回 400。
  - Claude Sonnet 5.5：拒绝 `disabled`。关闭前置思考要发送 `thinking.type` 为 `between_tools`。
  - Claude Fable 5、Fable 5.1、Mythos 5、Mythos 5.1、Opus 5.5、Mythos Preview：思考不能关闭。`disabled` 返回 400。

### OpenAI Chat Completions 与 Responses

- Chat：`https://api.openai.com/v1`，`POST /chat/completions`。Responses：同一 host，`POST /responses`。鉴权 `Authorization: Bearer`。
- Chat 的推理强度是顶层 `reasoning_effort`。Responses 是 `reasoning.effort`。文档列出的取值包括 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`，并写明不是每个模型都接受全部取值。GPT-6 Astra 拒绝 `none`。GPT-6.1 Sol 拒绝 `none` 和 `minimal`，默认 `medium`。[Reasoning models](https://developers.openai.com/api/docs/guides/reasoning)
- 结构化输出：Chat 用 `response_format`，首选 `json_schema`。Responses 用 `text.format`，不是 `response_format`。
- 自 GPT-5.4 起，Chat Completions 在 `reasoning_effort` 不是 `none` 时不支持函数调用。Responses 仍支持。[Migrate to the Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- 官方 Chat 与 Responses 请求体都没有 `thinking.type`。

### Gemini generateContent

- `POST /v1beta/models/{model}:generateContent`。鉴权可以是 `x-goog-api-key` 或查询参数 `key`。
- 结构化输出是 `generationConfig.responseMimeType = application/json` 加 `responseSchema`。
- 思考不使用 `thinking.type`。2.5 系列用 `thinkingBudget`：Flash 设为 `0` 可关闭，Pro 不能关闭，`-1` 为动态。3 与 4 系列用 `thinkingLevel`；`thinkingBudget` 与 `thinkingLevel` 同时出现返回 400。Gemini 4 单独发送已废弃的 `thinkingBudget` 会被映射并给出警告。[Gemini thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking)

### 百炼 DashScope、OpenAI 兼容与 Anthropic 兼容

三条路径的字段不同，来源均为 2026-11-03 的百炼文档。

- 原生：`enable_thinking`。混合思考模型可以设为 `false`。仅思考模型不能关闭。非流式调用思考模型时，不把 `enable_thinking` 设为 `false` 会返回「must be set to false for non-streaming calls」。`enable_thinking: true` 时不支持 JSON mode。[深度思考](https://help.aliyun.com/zh/model-studio/deep-thinking)、[错误码](https://help.aliyun.com/zh/model-studio/error-code)
- OpenAI 兼容：北京业务空间为 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。千问仍用 `enable_thinking`，它不是 OpenAI 标准字段。
- Anthropic 兼容：`https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/apps/anthropic`，请求 `POST /v1/messages`。思考字段是 `thinking.type`，取值为 `enabled` 或 `disabled`。省略时由模型默认决定。文档示例对千问使用 `thinking: { type: "disabled" }`。`kimi-k2.7-code` 与 `MiniMax-M2.5` 被标为无法关闭思考；`glm-5.3`、`kimi-k3` 在深度思考页被标为仅思考模型。[Anthropic 兼容 Messages](https://help.aliyun.com/zh/model-studio/anthropic-api-messages)

## 兼容端点上的厂商差异

### DeepSeek

官方同时给出三种格式。[首次调用](https://api-docs.deepseek.com/)、[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)、[Anthropic API](https://api-docs.deepseek.com/guides/anthropic_api)

| 协议 | Base URL | 关闭思考 | 力度 |
| --- | --- | --- | --- |
| Chat Completions | `https://api.deepseek.com` | `thinking.type = disabled` | `reasoning_effort` |
| Anthropic Messages | `https://api.deepseek.com/anthropic` | 同上；`adaptive` 视为 `enabled`；`budget_tokens` 被忽略 | `output_config.effort` |
| Responses | `https://api.deepseek.com` | `reasoning.effort = none` | `reasoning.effort` |

思考默认开启，默认力度 `high`。非思考模式温度范围是 `[0, 2]`；思考模式温度固定为 `1`。Anthropic 路径上，`tool_choice` 指定具体工具属于强制客户端工具，思考开启时返回 400，必须先 `thinking.type = disabled`。

### Kimi

[API Overview](https://platform.kimi.ai/docs/api/overview)、[Thinking Models](https://platform.kimi.ai/docs/guide/use-thinking-models)、[Model Parameter Reference](https://platform.kimi.ai/docs/api/models-overview)

| 协议 | Base URL |
| --- | --- |
| Chat Completions | `https://api.moonshot.ai/v1` |
| Responses | `https://api.moonshot.ai/v1` |
| Anthropic Messages | `https://api.moonshot.ai/anthropic` |

- `kimi-k2.6`：`thinking.type` 默认 `enabled`，接受 `disabled`。
- `kimi-k2.7-code`：只接受 `enabled`，且 preserved thinking 不能关。发送 `disabled` 报错。
- `kimi-k3`、`kimi-k3.1-pro`：始终推理。强度用顶层 `reasoning_effort`（`low` / `high` / `max`，默认 `max`），不是 `thinking.type`。
- `kimi-k2.6` 与 `kimi-k2.5` 在思考模式把温度固定为 `1.0`，非思考模式固定为 `0.6`。其他温度值返回错误。

### 智谱 GLM

[Z.AI Deep Thinking](https://docs.z.ai/guides/capabilities/thinking) 写的是 Chat 请求体中的 `thinking.type`。

- `enabled` 为动态或强制思考，依型号而定。
- `disabled` 在可切换型号上关闭思考。
- GLM-5.3 与 GLM-5.3-FLASH 明确拒绝 `thinking.type = disabled`。
- `reasoning_effort` 从 GLM-5.2 起提供。GLM-5.3 只接受 `max`、`high`、`low`。

国际站与国内站的 host 以各自控制台文档为准。本次没有把第三方汇总里的国内 Anthropic 路径记成已核验事实。

### MiniMax

[Model Invocation](https://platform.minimax.io/docs/guides/text-generation)

| 协议 | Base URL | 力度字段 |
| --- | --- | --- |
| Anthropic Messages | `https://api.minimax.io/anthropic` | `output_config.effort` |
| Chat Completions | `https://api.minimax.io/v1` | `reasoning_effort` |
| Responses | OpenAI Responses 形态 | `reasoning.effort` |

MiniMax-M3.1-Flash 默认思考且不能关闭。发送 `thinking: { type: "disabled" }` 或 `effort: "none"` 返回 400，错误文案包含 `requires adaptive thinking`。Anthropic 是其推荐协议。

### xAI Grok 与 Mistral

- Grok 4.5、4.6、4.7 使用 Chat Completions 的 `reasoning_effort`。未传时默认 `high`。文档写明推理不能关闭。`presencePenalty`、`frequencyPenalty`、`stop` 与推理模型同用会报错。[xAI Reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning)
- Mistral Chat Completions 使用 `reasoning_effort`。Small 4 与 Medium 3.5 接受 `none` 与 `high`；`none` 表示少思考并省略思考块。Large 4 接受 `low`、`medium`、`high`。[Mistral Reasoning](https://docs.mistral.ai/studio/conversations/reasoning)

这两家的官方协议都没有 `thinking.type`。

## 当前发送点

资产分析与连接测试在 `src/worker/ai/` 的四个适配器。搜索规划在 `src/main/ai-search-planner.ts`，五条协议各有一份请求体。

| 发送点 | 协议 | 当前固定字段 |
| --- | --- | --- |
| `AnthropicVendorAdapter.analyze` | Messages | `max_tokens: 4096`，`temperature: 0.2`，具名 `tool_choice`，`thinking.type: disabled` |
| `AnthropicVendorAdapter.probeConnection` | Messages | `max_tokens: 16`，`temperature: 0`，无工具，`thinking.type: disabled` |
| `OpenAIVendorAdapter` Chat 分析 | Chat | `temperature: 0.2`，`response_format` 协商；无 `max_tokens`，无推理字段 |
| `OpenAIVendorAdapter` Chat 探测 | Chat | `max_tokens: 16`，`temperature: 0` |
| `OpenAIVendorAdapter` Responses 分析 | Responses | `temperature: 0.2`，`text.format` 协商；无 `reasoning` |
| `OpenAIVendorAdapter` Responses 探测 | Responses | `max_output_tokens: 16`，`temperature: 0` |
| `GeminiVendorAdapter.analyze` | generateContent | `temperature: 0.2`，JSON schema；无 `thinkingConfig`，无输出上限 |
| `GeminiVendorAdapter.probeConnection` | generateContent | `temperature: 0`，`maxOutputTokens: 16`；无 `thinkingConfig` |
| `DashScopeVendorAdapter.analyze` | 原生多模态 | 非流式，`response_format: json_object`，`temperature: 0.2`；无 `enable_thinking` |
| `planAiSearch` Anthropic 分支 | Messages | `max_tokens: 1024`，`temperature: 0`，具名 `tool_choice`；无 `thinking` |
| `planAiSearch` 其余分支 | Chat / Responses / Gemini / DashScope | 与对应分析路径相同的结构化字段和温度，无思考字段 |

## 对照结果

下列各项是当前请求体和上面的文档规则不一致的地方。未在官方文档中写成错误的行为不记为缺陷。

1. Anthropic 分析与连接测试把 `thinking.type: disabled` 发给所有模型。DeepSeek 在具名 `tool_choice` 下需要它。Claude 4.5–4.8、可关闭思考的千问、`kimi-k2.6` 也接受它。Claude Fable 5 系列、Mythos 5 系列、Opus 5.5、Mythos Preview、Sonnet 5.5，以及 GLM-5.3、MiniMax-M3.1-Flash、`kimi-k2.7-code` 的文档写明该值返回 400。这些型号在加上该字段之前可以按各自默认思考调用。

2. 搜索规划的 Anthropic 请求仍强制具名工具，却不发送 `thinking.type: disabled`。按 DeepSeek 的 Anthropic 文档，这条请求在默认思考开启时返回 400。它和分析路径现在的规则相反。

3. OpenAI Chat 探测固定 `max_tokens: 16` 和 `temperature: 0`，分析固定 `temperature: 0.2`。DeepSeek 的 Chat 格式默认思考，思考 token 计入输出上限，温度在思考模式下固定为 1。16 个 token 的探测可能在答案出现前耗尽，或因温度被拒绝。新的 OpenAI 推理模型使用 `max_completion_tokens` 与 `reasoning_effort`，官方 Chat 请求体不接受 `thinking.type`。当前适配器既没有按模型切换这两个官方字段，也没有为 DeepSeek 这类兼容商补上 `thinking.type`。

4. OpenAI Responses 分析与探测携带 `temperature`，不携带 `reasoning.effort`。官方推理模型的默认力度由模型决定。GPT-6 Astra 拒绝 `none`，因此不能用一个全局的「关闭推理」值覆盖全部 OpenAI 模型。

5. Gemini 分析不设置思考预算，也不设置 `maxOutputTokens`。2.5 Pro 与 Gemini 3 默认会思考，思考 token 与回答共享输出。连接测试把可见输出上限设为 16，思考模型可能把预算用完后没有可解析文本。关闭方式是 `thinkingBudget: 0` 或降低 `thinkingLevel`，不是 `thinking.type`。2.5 Pro 文档写明不能关闭。

6. DashScope 原生分析是非流式 JSON mode，且不传 `enable_thinking`。百炼错误码规定：非流式调用思考模型必须显式 `enable_thinking: false`；该值为 `true` 时 JSON mode 不被支持。所选模型若是思考模型，当前请求体同时踩中这两条。原生路径不能改成发送 `thinking.type`。
