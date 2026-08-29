# Serpent AI API 请求输出格式与实际响应 envelope 调研

- 日期：2026-08-28
- 关联：Serpent-84f95d
- 范围：只研究请求格式、成功响应、错误 envelope、降级判定与测试矩阵；本文件不修改生产代码。
- 证据口径：规范性事实优先引用供应商官方 API 文档或官方 SDK/服务端源码；官方 issue 只作为“已观察到的实现行为”，不当作兼容规范。推断和建议单独标记。
- 仓库对照：[既有结构化输出调研](2026-08-28-ai-provider-structured-output-compatibility.md)、[当前 OpenAI adapter](../../../src/worker/ai/openai-adapter.ts)、[Anthropic adapter](../../../src/worker/ai/anthropic-adapter.ts)、[Gemini adapter](../../../src/worker/ai/gemini-adapter.ts)、[DashScope adapter](../../../src/worker/ai/dashscope-adapter.ts)。

## 结论摘要（推断）

1. `response_format`、`text.format`、原生 `format`、工具 `input_schema` 和 Gemini `responseSchema` 不是同一个抽象。它们的成功响应也不是一个 envelope：Chat Completions 以 `choices[0].message` 为中心，Responses 以有序的 `output[]` item 为中心，Anthropic 以 `content[]` block 为中心，Gemini 以 `candidates[].content.parts[]` 为中心，DashScope 还包在 `output.choices[]` 之内。
2. “收到 400”不足以证明“输出格式不支持”；400 可能代表请求字段、模型、图片、认证范围或提示词错误。可安全降级的信号应是结构化的参数/错误代码，或预先配置的能力档案与一次小型探测的成功验证，不应是对任意错误文本做正则猜测。
3. “收到 200”也不足以证明格式已生效。官方兼容服务 issue 已记录过格式被忽略、`message.content` 为空而 JSON 出现在 reasoning 字段等情况。因此，格式协商必须验证响应内容是否真的能通过 JSON 解析和领域 schema，而不能只缓存 HTTP 成功。
4. 当前实现的主要风险不是“没有 fallback”，而是把“格式协商失败”“模型拒答/工具调用”“合法但没有文本”“响应 envelope 不认识”“JSON 不符合领域 schema”混成同一个 `invalid_response` 路径；这会导致该重试时不重试、该停止时重复请求，或把原本可读取的结果判成失败。

## 1. 输出格式类型与 envelope 总表（事实）

| API / 路径 | 请求中的结构化输出字段与官方类型 | 成功结果的主 envelope | 结果内容的官方位置 |
| --- | --- | --- | --- |
| OpenAI Chat Completions | `response_format.type`: `text`、`json_object`、`json_schema`；JSON Schema 形态带 `json_schema` | `choices[]` → `message` | `message.content`；也可能是 `message.refusal` 或 `message.tool_calls` |
| OpenAI Responses | `text.format.type`: `text`、`json_object`、`json_schema` | `status` + 有序 `output[]` | 便利字段 `output_text`；规范内容在 `output[]` 的 message/content item |
| LM Studio OpenAI-compatible | 官方 structured-output 文档明确展示 Chat 的 `response_format.type: json_schema`；其兼容 API 另提供 Chat/Responses/视觉输入 | OpenAI 风格 Chat 或 Responses envelope，取决于路径、版本、模型/后端 | Chat 通常 `choices[0].message.content`；Responses 采用 `output[]`。实际兼容度需按模型探测 |
| Ollama OpenAI compatibility | `/v1/chat/completions` 文档列出 `response_format`；原生 `/api/chat` 使用 `format: "json"` 或 JSON Schema；`/v1/responses` 是部分兼容，文档未把 `text.format` 列为支持字段 | Chat 通常 `choices[]`；Responses 使用 `status`、`output[]` 等部分 OpenAI envelope | Chat `choices[0].message.content`；原生 `/api/chat` 为 `message.content` |
| vLLM OpenAI-compatible | Chat 文档支持 OpenAI 风格 `response_format`；服务端还提供 `structured_outputs` 的 `choice`、`regex`、`json`、`grammar`、`structural_tag`；Responses 源码映射 `json_object`/`json_schema` | Chat `choices[]`；Responses `output[]` | Chat `message.content`、`tool_calls`、`refusal`、vLLM 的 `reasoning`；Responses 为 output item |
| Anthropic Messages（项目原生 adapter） | 没有 OpenAI `response_format`；项目用 `tools[].input_schema` + 强制 `tool_choice` | 顶层 Message + `content[]` blocks | `tool_use.input` 对象，或 `text` block |
| Gemini `generateContent`（项目原生 adapter） | `generationConfig.responseMimeType: application/json` + `responseSchema` | `candidates[]` → `content.parts[]` | 通常 `parts[].text`；也可能是 `functionCall`、安全过滤/无 candidate |
| DashScope/Qwen 原生 multimodal（项目原生 adapter） | `parameters.result_format: message` + `parameters.response_format.type`；结构化输出文档列出 `json_object` 与受支持模型的 `json_schema` | 顶层状态字段 + `output.choices[]` | `output.choices[0].message.content`；可为 string 或多模态 array；工具调用在 `tool_calls` |

OpenAI 的官方结构化输出指南说明 Chat 使用 `response_format`，Responses 使用 `text.format`；同一指南还分别说明 Chat 的 refusal 与 Responses 的 refusal/incomplete 处理方式。[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

## 2. OpenAI Chat Completions

### 2.1 请求格式（事实）

- Chat Completions 的 `response_format` 支持 `text`、`json_object`、`json_schema` 三种类型；JSON Schema 类型的 schema 位于 `response_format.json_schema`，其中可含 `name`、`strict`、`schema`。[OpenAI Chat API reference](https://developers.openai.com/api/reference/resources/chat)
- `json_object` 是 JSON mode：它要求输出为有效 JSON，但不等于符合某个应用 schema；`json_schema` 才是 schema-constrained structured output。官方结构化输出指南明确区分两者。[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- 使用 JSON mode 时，官方文档要求提示词中明确让模型输出 JSON；否则可能得到错误或请求一直生成空白。该要求由 OpenAI 文档说明，兼容服务不一定复刻同一校验。[OpenAI JSON mode guidance](https://developers.openai.com/api/docs/guides/structured-outputs)
- 工具调用不是 `response_format` 的替代写法，但可以和 Chat 请求一起出现。工具定义在 `tools`，返回调用位于 assistant message 的 `tool_calls`。[OpenAI Chat API reference](https://developers.openai.com/api/reference/resources/chat)

### 2.2 成功响应形态（事实）

典型非流式 envelope 是 `choices[]`；每个 choice 含 `message`、`finish_reason` 等字段。官方 schema 将 assistant `message.content` 定义为可选的 string、content-part array 或 null，并定义了 `refusal`、`tool_calls` 与已弃用的 `function_call`。[OpenAI Chat API reference](https://developers.openai.com/api/reference/resources/chat)

因此，Serpent 的提取器至少要能区分下列形态：

| 形态 | 位置 | 解释 |
| --- | --- | --- |
| `string` | `choices[i].message.content` | 普通文本或 JSON 文本；JSON Schema/JSON mode 的结果在 Chat envelope 中仍是可解析的内容文本，而不是规范保证的 JavaScript 对象。[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) |
| `array` | `message.content` | 多个 content part；规范允许文本 part，也允许 refusal part。[OpenAI Chat API reference](https://developers.openai.com/api/reference/resources/chat) |
| `null` / 空文本 | `message.content` | 常见于 assistant 选择工具调用时；此时应先检查 `tool_calls`，不能把 null 直接当成“服务无响应”。[OpenAI Chat API reference](https://developers.openai.com/api/reference/resources/chat) |
| refusal string | `message.refusal`，或 content 中的 refusal part | 模型拒绝按给定 schema 生成；官方结构化输出示例要求先检查 refusal。[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) |
| tool call array | `message.tool_calls` | 工具调用参数通常在每个 tool call 的 function arguments 中，以 JSON 字符串表示；文本 content 可以为空。[OpenAI Chat API reference](https://developers.openai.com/api/reference/resources/chat) |
| 空 `choices` | 顶层 `choices` | 不能当作成功的分析结果。流式请求的最终 usage chunk 等特殊场景可能没有 choice；非流式分析应把它分类为缺失结果。[OpenAI Chat API reference](https://developers.openai.com/api/reference/resources/chat) |

`message.content` 的“object”不是 OpenAI Chat 的标准成功类型。若某个 relay 直接把 JSON object 放在 content 中，它是兼容扩展而不是 Chat schema 的可移植假设；应由明确的 provider profile 支持并直接做 schema 校验，不能让任意 object 穿过解析器。[OpenAI Chat API reference](https://developers.openai.com/api/reference/resources/chat)

### 2.3 错误与降级信号（事实）

- OpenAI SDK 的标准 API error 是 JSON `error` 对象，包含 `message`、`type`，并可能有 `param`、`code`；官方 Python SDK 将已解码 body 暴露为错误对象的结构化字段，而不是要求调用方解析自然语言。[OpenAI Python SDK exceptions](https://github.com/openai/openai-python/blob/main/src/openai/_exceptions.py)
- 官方错误码文档把 400 归为 bad request，401 为认证，403 为权限，429 为速率/额度，5xx 为服务端问题；422 也有专门的 Unprocessable Entity 类型。官方 SDK 按 HTTP status 映射异常类型。[OpenAI error codes](https://developers.openai.com/api/docs/guides/error-codes)、[OpenAI Python client status mapping](https://github.com/openai/openai-python/blob/main/src/openai/_client.py)
- 因此，400/422 只能表示请求未被接受，不能单独证明 `response_format` 不支持。只有当结构化 error 的 `param`/`code` 明确指向 `response_format`，或经过 provider-specific capability probe 验证，才适合降级到另一种输出模式。后一句是本调研的兼容性推断。
- 429、超时、连接失败、5xx 通常属于重试/退避类别；401、403、明显的 prompt/image validation 不应通过改输出格式来掩盖。OpenAI 文档明确给出了状态语义和重试相关说明。[OpenAI error codes](https://developers.openai.com/api/docs/guides/error-codes)

## 3. OpenAI Responses

### 3.1 请求格式（事实）

- Responses 的输出格式位于顶层 `text.format`，类型同样是 `text`、`json_object`、`json_schema`；JSON Schema 的字段直接和 `text.format` 同层，而不是 Chat 的 `json_schema` 再包一层。[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)、[OpenAI Python Responses types](https://github.com/openai/openai-python/tree/main/src/openai/types/responses)
- Responses 还允许工具调用；工具调用不是 message content 的文本，而是 `output[]` 中的 function/tool item。官方 OpenAI SDK 的 parser 将 output text、refusal、function tool call、reasoning 分开处理。[OpenAI Node Responses parser](https://github.com/openai/openai-node/blob/main/src/lib/ResponsesParser.ts)

### 3.2 成功响应形态（事实）

Responses 的主对象包含 `status`、`output[]`，并可有 `output_text` 便利字段；官方 Python 类型把 `output` 定义为多种 output item 的联合，而不是“第一个 item 一定是 assistant 文本”。[OpenAI Python Response type](https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response.py)

- 最方便的文本入口是 `output_text`。官方 Node SDK 的实现会遍历 `response.output` 中的 message item，再拼接其中 `type: "output_text"` 的 content part。[OpenAI Node Responses parser](https://github.com/openai/openai-node/blob/main/src/lib/ResponsesParser.ts)
- 规范路径是 `output[]` → `type: "message"` → `content[]` → `type: "output_text"` 的 `text`；Responses 的 message content 也可以是 `refusal` part。[OpenAI Python ResponseOutputMessage](https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response_output_message.py)
- `output[]` 还可能包含 reasoning、function call 以及其他工具 item。只有 function call 而没有 output text 时，`output_text` 可以是空字符串；这不是一个可供 Serpent 直接解析的分析结果，应该先返回 typed `tool_call`/`empty` 状态。[OpenAI Node Responses parser](https://github.com/openai/openai-node/blob/main/src/lib/ResponsesParser.ts)
- Responses 的“object”通常出现在 envelope 或 typed output item 中；结构化 JSON 结果在官方示例中仍通过 output text 读取后再解析，不应假设 `output_text` 是 object。[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- `status: incomplete` 时应检查 `incomplete_details.reason`；`status: failed` 时应检查响应的 `error`，而不是只看 HTTP status。[OpenAI Python Response type](https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response.py)、[OpenAI Python ResponseError](https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response_error.py)

### 3.3 错误与降级信号（事实）

Responses 有两层错误：HTTP 层的 API error，以及 HTTP 成功但响应 `status` 为 `failed`、带 `error:{code,message}` 的语义层失败。官方 Response 类型同时定义了 `status`、`error` 和 `incomplete_details`。[OpenAI Python Response type](https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response.py)、[OpenAI Python ResponseError](https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response_error.py)

这意味着：

- 收到 2xx 后必须先验证 `status`，再提取 `output_text`/`output[]`；不能把“JSON body 能 parse”当作成功。
- `failed`/`incomplete`/refusal/tool call 都不是 `response_format` 不支持的证据；它们应在 normalized result 中保持独立状态。
- 只有 HTTP error 的结构化参数信息明确指向 `text.format`，或能力探测明确失败，才可尝试降级。这是兼容架构推断。

## 4. LM Studio OpenAI-compatible（重点 Qwen/视觉模型）

### 4.1 官方规范性资料（事实）

- LM Studio 官方兼容 API 文档列出 `/v1/chat/completions`、`/v1/responses`、`/v1/completions`、`/v1/embeddings`，并说明可发送文本和图片输入。[LM Studio OpenAI compatibility](https://lmstudio.ai/docs/developer/openai-compat)
- LM Studio 的 structured-output 文档在 Chat Completions 上明确使用 OpenAI 形式的 `response_format:{type:"json_schema",json_schema:{name,strict,schema}}`，并说明生成 JSON 会以 string 形式出现在 `choices[0].message.content`，调用方要自行 parse。[LM Studio structured output](https://lmstudio.ai/docs/developer/openai-compat/structured-output)
- 同一文档说明 structured output 由模型/后端能力决定，小于 7B 的模型尤其不能默认支持；GGUF 和 MLX 使用不同的约束引擎。故“LM Studio 支持”不能简化为“每个 Qwen 模型都支持同一 type”。[LM Studio structured output](https://lmstudio.ai/docs/developer/openai-compat/structured-output)
- LM Studio 官方工具调用文档列出 Qwen2.5 等模型的工具使用示例，并明确模型支持会变化；工具调用与 JSON Schema 输出是两个能力维度。[LM Studio tool use](https://lmstudio.ai/docs/developer/openai-compat/tools)
- LM Studio 另有 Responses API 和流式事件文档，但 structured-output 页面给出的正式示例针对 Chat Completions；不能从 Chat 的 `json_schema` 示例推导所有 LM Studio Responses 后端都支持 `text.format`。[LM Studio Responses](https://lmstudio.ai/docs/developer/openai-compat/responses)

### 4.2 Qwen/视觉模型的实际风险（官方 issue 观察，非规范）

LM Studio 官方 bug tracker 的 Qwen 相关报告记录了一个重要的真实返回形态：请求可能 HTTP 200，但 `choices[0].message.content` 为空，JSON 出现在 `reasoning_content`，并伴随空的 `tool_calls`；报告还记录某路径对 `json_object` 返回 400，而提示只接受 `json_schema` 或 `text`。[LM Studio issue #1773](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1773)

该 issue 是官方实现观察，不是 LM Studio 的兼容规范。它至少说明三点：

- Qwen 的 thinking/reasoning 开关、chat template、模型大小和后端会改变结构化输出的实际行为。
- 视觉输入被接受不等于 JSON Schema 约束被执行；应分别测试文本-only、图片-only、文本+图片。
- `content === ""` 不能立即证明“没有分析结果”，但也不能擅自把 `reasoning_content` 当成最终答案；除非 provider profile 明确允许，reasoning 应作为诊断/待确认来源，而不是静默写入资产元数据。

最后两点是基于官方兼容文档和 issue 的工程推断；不能当作所有版本的固定行为。

### 4.2.1 本次补充核对的四条一手证据

下面均是 LM Studio 官方 bug tracker 的 issue body/复现记录；它们是版本、backend、模型组合下的观察，不是 LM Studio 对所有模型的兼容承诺。

| 官方 issue | 直接观察到的事实 | 对 Serpent 的含义 |
| --- | --- | --- |
| [#909](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/909) | LM Studio 0.3.23 的 structured-output 路径对 schema 中 `"type": ["string", "null"]` 报 `ValueError: 'type' must be a string`；issue 的复现 schema 同时说明问题出在部分 Outlines/MLX 路径。 | Serpent 当前 [OpenAI schema builder](../../../src/worker/ai/openai-response.ts) 对 nullable `description`/`rating` 使用 `anyOf`，避免把 `type` 数组发送给该类 LM Studio backend。旧版实现的 `type: ['string','null']` 对部分 JSON Schema 解释器虽合法，但对该 backend 不是可接受输入。 |
| [#1773](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1773) | Qwen3.5 reasoning 模型在 `/v1/chat/completions` + `response_format: json_schema` 下返回成功的 Chat envelope，但 `message.content` 是空字符串，JSON 落在 `message.reasoning_content`；同一报告还记录 `json_object` 返回 400，提示 `json_schema` 或 `text`。去掉 `response_format` 后，JSON 回到 `content`。 | “HTTP 200 + stop”不等于最终 content 可用；换成 text mode 可能恢复原先可用的结果，但不能把 reasoning 字段静默当最终答案。 |
| [#1971](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1971) | LM Studio 0.4.8+1、`qwen3.5-4b-mlx`、`enable_thinking:false` 的小 schema 复现同样现象：`content: ""`、`reasoning_content` 中是合法 JSON、`tool_calls: []`、`finish_reason: "stop"`；控制模型可把 JSON 返回到 `content`。 | 该问题不是只由 sampling 参数决定，至少受模型/backend/reasoning routing 组合影响；capability key 不能只有 endpoint/model 的粗粒度假设。 |
| [#189](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/189) | 官方 issue 记录 LM Studio proxy 对 `response_format.type: json_object` 返回 HTTP 400，错误为 `response_format.type` 必须是 `json_schema`（而 #1773 的同类报告明确写出 `json_schema` 或 `text`）。 | `json_object` 不是 LM Studio 所有版本/路径的安全中间 fallback；若 profile 没有验证它，应直接把能力记为 unknown/unsupported，而不是默认按 OpenAI 三档顺序发送。 |

这里要区分两个层次：#909 是 schema **内容形态**在 backend parser 中失败；#189/#1773 是 response_format **type/字段能力**差异；#1773/#1971 是请求被接受后 **结果路由**错误。三者不能由一个“格式拒绝”正则统一解释。这是基于上述 issue 的分类推断。

### 4.3 错误与降级信号（事实 + 推断）

LM Studio 官方公开文档描述了 OpenAI-compatible 请求/响应形态，但没有承诺一个跨版本、跨后端的完整错误 code 枚举或统一的 `response_format` capability endpoint。[LM Studio OpenAI compatibility](https://lmstudio.ai/docs/developer/openai-compat)

因此建议把下列内容记为能力探测结果，而不是错误文本分类：

- endpoint + model + backend + relevant generation settings；
- 请求 type 与 HTTP status；
- 若 body 是 JSON，读取其结构化 `error`/`code`/`param` 字段；
- 一个极小 schema 请求是否返回可 parse 且通过 schema 的结果。

如果只得到普通 400、HTML、纯文本或未标注字段，安全决策是“未知/不可降级”，而不是凭 `unsupported`、`must be` 等词语继续改写请求。这是本调研的兼容性推断。

## 5. Ollama OpenAI compatibility

### 5.1 两套 API 不要混用（事实）

- Ollama 的 OpenAI-compatible `/v1/chat/completions` 文档列出 Chat completions、streaming、JSON mode、vision、tools、reasoning control 等能力，并把 `response_format` 列为支持的请求字段。[Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
- Ollama 原生 `/api/chat` 使用 `format: "json"` 或 `format:<JSON Schema>`；原生 structured-output 文档也说明视觉模型可以使用同一 `format` 字段，返回结果要从 `message.content` 读取并再验证。[Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
- Ollama `/v1/responses` 是部分兼容接口，官方文档注明从 v0.13.3 起提供、非 stateful，并列出 streaming/tools/reasoning；该页面没有把 `text.format` 列入 Responses 支持字段，因此不能假定它与 OpenAI Responses structured outputs 等价。[Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)

对请求 type 的准确结论是：Chat-compatible 路径有 `response_format` 入口，原生路径的 schema type 是另一套 `format` 语义；官方 Ollama 文档没有把所有 OpenAI `response_format.type` 组合承诺为跨版本一致。`json_object`/JSON mode 应作为显式测试项，`json_schema` 应以版本和模型探测结果为准，而不能仅凭路径名称推断。

### 5.2 成功响应与非规范观察（事实）

- 官方最小 Chat 示例从 `chat_completion.choices[0].message.content` 读取结果；原生 `/api/chat` 也是 `message.content`。[Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)、[Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
- Ollama 官方服务端 middleware 将普通 Chat 结果转换成 OpenAI 风格 envelope，并将 SSE 结束标记写成 `data: [DONE]`；其源码还保留原生 response 的错误转换路径。[Ollama OpenAI middleware](https://github.com/ollama/ollama/blob/main/middleware/openai.go)
- 官方 Responses 源码定义了 `status`、`error`、`incomplete_details`、`output[]`，并包含 message/reasoning/function-call 类型，说明 Responses 路径不能只读一个字符串字段。[Ollama Responses source](https://github.com/ollama/ollama/blob/main/openai/responses.go)
- Ollama 官方 issue 曾记录某些 MLX/NVFP4 路径接受或忽略结构化输出约束，甚至对无效 `response_format.type` 返回 HTTP 200；这是版本/后端观察，不是规范，但足以证明必须校验 body。[Ollama issue #17933](https://github.com/ollama/ollama/issues/17933)

### 5.3 错误与安全降级（事实 + 推断）

Ollama 官方 middleware 会把可识别的原生状态错误包装成 OpenAI 风格 `error` 响应；源码同时保留原始 body 无法解码时的 fallback 路径。[Ollama OpenAI middleware](https://github.com/ollama/ollama/blob/main/middleware/openai.go)

因此：

- 若有结构化 `error.code`/`error.type` 且字段明确指向 `response_format`，可以把它分类为 `parameter_unsupported`。
- 只有 HTTP 400、空文本、或无效 JSON，不能单独触发 `json_schema → json_object → text`；这些也可能是模型、图片、模板、提示词或服务实现错误。
- 官方 issue 的“HTTP 200 忽略约束”意味着成功响应必须经过 JSON parse + domain schema 校验；若失败，应分类为 `content_invalid`/`constraint_not_enforced`，不要改写成“400 格式不支持”。后两条是工程推断。

## 6. vLLM OpenAI-compatible

### 6.1 请求格式（事实）

- vLLM 当前 structured-output 文档列出 `choice`、`regex`、`json`、`grammar`、`structural_tag` 等约束选项，并说明旧的 `guided_json` 等字段已弃用/移除；OpenAI API 示例使用 `response_format:{type:"json_schema",json_schema:{name,schema}}`。[vLLM structured outputs](https://docs.vllm.ai/en/latest/features/structured_outputs/)
- vLLM OpenAI-compatible server 同时提供 Chat 和 Responses API，但要求文本生成模型及适用的 chat template；输入 content 可以是字符串或 OpenAI 风格的对象数组，服务端做 best-effort 检测。[vLLM OpenAI-compatible server](https://docs.vllm.ai/en/latest/serving/openai_compatible_server/)
- vLLM 的 Responses protocol 源码明确把 `text.format.type == "json_object"` 转为 JSON mode，把 `json_schema` 转为 schema constraint；这证明 Responses 的格式字段与 Chat 的位置不同，但不证明任意模型都能执行约束。[vLLM Responses protocol](https://docs.vllm.ai/en/stable/api/vllm/entrypoints/openai/responses/protocol/)
- vLLM Chat response 类型定义了 `message.content: str | None`、`refusal`、`tool_calls` 和 vLLM-specific `reasoning`；服务端源码在工具调用/推理结果存在时可以把文本 content 留为 null。[vLLM Chat protocol](https://github.com/vllm-project/vllm/blob/main/vllm/entrypoints/openai/chat_completion/protocol.py)、[vLLM Chat serving](https://github.com/vllm-project/vllm/blob/main/vllm/entrypoints/openai/chat_completion/serving.py)

实际兼容配置需要区分两层：OpenAI 兼容字段 `response_format`，以及 vLLM 原生 `structured_outputs`/`extra_body`。二者同时发送时的优先级、模型支持和服务端版本应作为 provider profile 固定下来；不能把 vLLM-specific 选项当成所有 OpenAI relay 都能理解的字段。这是工程推断。

### 6.2 响应、错误与降级（事实 + 推断）

- Chat 成功 envelope 是 `choices[]`，其中 message 可以是文本、工具调用、拒答或 reasoning 相关字段；因此 `content: null` 是合法的“非文本主结果”信号。[vLLM Chat protocol](https://github.com/vllm-project/vllm/blob/main/vllm/entrypoints/openai/chat_completion/protocol.py)
- Responses 成功/失败以 response `status` 和 `output[]` 为中心，不能套用 Chat 的 `choices[0].message.content`。[vLLM Responses protocol](https://docs.vllm.ai/en/stable/api/vllm/entrypoints/openai/responses/protocol/)
- 请求校验/参数校验失败通常应保留 HTTP status 和结构化 server error；不要把所有 400 都降级。vLLM 官方协议源码对请求字段进行 typed validation，但部署层/版本可能把异常包装成不同的 OpenAI/FastAPI error envelope。[vLLM OpenAI-compatible server](https://docs.vllm.ai/en/latest/serving/openai_compatible_server/)、[vLLM Chat protocol](https://github.com/vllm-project/vllm/blob/main/vllm/entrypoints/openai/chat_completion/protocol.py)

安全信号是：结构化 validation error 明确命中 `response_format` 或 `structured_outputs` 字段；不安全信号是普通 400、content null、finish reason 为 length、tool call、reasoning-only 或 schema parse 失败。这是结合 vLLM typed protocol 与 OpenAI envelope 语义得出的工程推断。

## 7. 项目已有原生 adapter 的 envelope 差异

### 7.1 Anthropic Messages（事实）

- Anthropic Messages 没有 OpenAI `response_format`；结构化工具调用通过 `tools[].input_schema` 定义 JSON Schema，并可用 `tool_choice` 强制选择工具。[Anthropic tool use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
- 成功 response 是顶层 Message，主结果在 `content[]` typed blocks；tool-use block 的参数在 `input` 对象中，文本在 text block。官方工具调用文档和 Messages API 以 block 类型区分文本、工具调用等结果。[Anthropic Messages API](https://docs.anthropic.com/en/api/messages)、[Anthropic tool use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
- 错误不是 OpenAI 的 `{error:{message,type,param,code}}` 约定，而是顶层 `type:"error"`、`error:{type,message}`，并带 `request_id`；官方错误文档还列出 400/401/402/403/404/409/413/429/500/504/529 等 HTTP 语义。[Anthropic errors](https://docs.anthropic.com/en/api/errors)
- Anthropic streaming 即使先返回 HTTP 200，也可能在 SSE 中出现 error event；因此若未来使用流式，HTTP status 不能作为唯一成功信号。[Anthropic errors](https://docs.anthropic.com/en/api/errors)

当前项目 adapter 用强制 `tool_choice`，优先读取 `content[]` 中的 `tool_use.input`，找不到时才尝试 text JSON；这与 OpenAI Chat 的 `message.content` 不可互换。[项目 Anthropic adapter](../../../src/worker/ai/anthropic-adapter.ts)

### 7.2 Gemini `generateContent`（事实）

- Gemini 原生结构化输出使用 `generationConfig.responseMimeType` 和 `generationConfig.responseSchema`，不是 `response_format` 或 `text.format`。[Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- 成功返回 `candidates[]`；每个 candidate 有 `content.parts[]`，text 位于 part 的 `text`，工具调用则位于 function-call part；响应还包含 `finishReason`、safety ratings、usage 等元数据。[Gemini GenerateContent API](https://ai.google.dev/api/generate-content)、[Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- 如果 prompt 被安全策略阻断，API 可以没有 candidates，而在 `promptFeedback` 中给出 block reason；candidate 级安全/finish reason 也可能表示没有可用文本。[Gemini GenerateContent API](https://ai.google.dev/api/generate-content)
- Gemini HTTP/API 错误使用 Google API error 结构，而不是 OpenAI/Anthropic envelope；错误通常带 `error.code`、`error.message`、`error.status` 等字段。具体状态和字段应保留原始结构化值。[Google API errors](https://ai.google.dev/gemini-api/docs/troubleshooting)、[Gemini GenerateContent API](https://ai.google.dev/api/generate-content)

当前项目 adapter 只读取第一个 `parts[].text` 并 JSON.parse；这会漏掉 functionCall、无 candidate、safety block 和多 text part，应由 normalized envelope 先分类。[项目 Gemini adapter](../../../src/worker/ai/gemini-adapter.ts)

### 7.3 DashScope/Qwen 原生 multimodal（事实）

- DashScope 原生 message 响应包在顶层 `output`，其中是 `choices[]`，再到 `message.content`；官方示例在 `result_format: "message"` 下从 `output.choices[0].message.content` 读取文本。[DashScope text generation](https://help.aliyun.com/en/model-studio/text-generation)
- DashScope 结构化输出文档列出 JSON Object 和 JSON Schema 两种模式：`json_object` 保证有效 JSON 字符串但不保证业务 schema；`json_schema` 只对列出的受支持模型提供 schema 约束。JSON Object 还要求 prompt 中出现 JSON 关键词。[DashScope structured output](https://help.aliyun.com/en/model-studio/qwen-structured-output)
- 多模态模型的 `message.content` 可以是 string 或 content object array；官方 DashScope 响应资料还列出 `reasoning_content` 和 `tool_calls`。发生 function calling 时 content 可能为空，工具参数在 tool call 中。[DashScope web-search-agent response fields](https://help.aliyun.com/en/model-studio/web-search-agent-api-chat)、[DashScope structured output](https://help.aliyun.com/en/model-studio/qwen-structured-output)
- DashScope 顶层错误/状态字段与 OpenAI 不同，常见字段为 `status_code`、`request_id`、`code`、`message`；错误码文档还把 response_format 不明、thinking 与 JSON mode 冲突等列为独立错误。[DashScope error codes](https://help.aliyun.com/en/model-studio/error-code)

当前项目 adapter 固定 `result_format: "message"` 和 `parameters.response_format:{type:"json_object"}`，并从 `output.choices[0].message.content` 兼容 string/array；它不是 OpenAI Chat adapter 的 envelope。[项目 DashScope adapter](../../../src/worker/ai/dashscope-adapter.ts)

## 8. 为什么当前实现可能让原先能用的 AI 分析失败

### 8.1 当前实现事实

当前 [OpenAI adapter](../../../src/worker/ai/openai-adapter.ts) 的结构化输出协商顺序是 `json_schema → json_object → text`。非 text 模式只在 HTTP 400/422 且响应全文命中 `isStructuredOutputFormatRejection()` 的正则时继续；text 模式省略结构化字段、改靠 prompt 要求 JSON。当前正则的 `unsupported` 词组已不包含 `invalid`；这意味着诸如 `invalid response_format` 的 400 不会因为“invalid + format”被视为可降级，同时也确认当前实现没有把所有 invalid response 都当作格式拒绝。

当前 Chat 提取路径要求第一条 `choices[0].message.content` 是非空 string；当前 Responses 路径先取 `output_text`，再遍历部分 `output` message/text block，之后才兼容少数 Chat/DashScope 风格路径。两条路径都没有把 refusal、tool call、reasoning-only、incomplete/failed status 统一建模为不同结果。

当前实现事实来自仓库源码，不能替代供应商规范；上述行为与官方响应类型的差异可由 [OpenAI Chat reference](https://developers.openai.com/api/reference/resources/chat)、[OpenAI Responses types](https://github.com/openai/openai-python/tree/main/src/openai/types/responses)、[LM Studio issue #1773](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1773) 和 [Ollama issue #17933](https://github.com/ollama/ollama/issues/17933) 对照验证。

### 8.2 失败机制（推断）

1. **合法 refusal/tool call 被当成空响应。** Chat 的 `content` 可以 null，tool call 在 sibling 字段；Responses 可以只有 function_call/refusal/reasoning item。当前只找非空文本，因而会把协议合法的非文本结果标成可重试的 `invalid_response`。
2. **Qwen thinking 结果落在未识别字段。** LM Studio #1773/#1971 都报告 `message.content` 为空、JSON 位于 `reasoning_content`。当前 `#extractChatResult` 只接受非空 string `message.content`，因此会把这类 HTTP 成功响应判成空 completion；由于错误发生在 response 已被判定 `ok` 之后，协商循环不会回到下一模式。
3. **Serpent 的 nullable schema 可能在 LM Studio backend 入口就失败。** #909 报告的 `type` 数组错误与当前 schema 的 `['string','null']`/`['integer','null']` 形态相同。当前正则不会匹配 `ValueError: 'type' must be a string`，而且该错误未必是 HTTP 400/422；于是请求既可能不 fallback，也可能被映射为一般网络/无效响应。后半句是结合当前 status gate、正则和 issue 现象的推断。
4. **`json_object` 不是可靠的中间档。** #189/#1773 记录 LM Studio 某些路径拒绝 `json_object`，而当前顺序会在 schema 被判定拒绝后尝试它。若该 type 的失败正文命中正则，程序还会再耗费一次请求；若不命中，则直接失败。无论哪一种，默认三档顺序都没有表达“此 provider profile 只允许 schema/text”。
5. **200 但约束被忽略时没有协商入口。** Ollama 官方 issue 记录过格式被忽略并返回 200。当前实现只有收到带匹配错误文本的 400/422 才切换模式；2xx 后的 malformed/empty/schema-invalid 不会按“格式能力未知”进入有界 fallback。
6. **错误正文变化会阻断本应安全的 fallback。** provider 可能返回结构化 `error.code/param`、嵌套错误、纯文本、HTML、不同措辞或本地化 message。当前正则只认识有限英文词序；#909 的 backend exception 就是一个不含 `unsupported`/`must be`/`response_format` 的反例。
7. **反过来，宽正则也可能误降级。** 当前正则把 `schema`、`only`、`must be` 等宽词纳入匹配；虽然已移除 `invalid`，仍可能把普通模型限制或提示词校验误判为“只是不支持输出格式”，从而隐藏真正根因或额外消耗一次请求。
8. **Chat 与 Responses 的字段位置不同。** Chat 的 schema 放在 `response_format.json_schema`，Responses 的 schema 放在 `text.format`；成功内容也分别在 `choices[].message` 和 `output[]`。如果 relay 只部分实现其中一套，单纯切换字段而不切换 response normalizer 会继续失败。
9. **JSON text 与 direct object 被混淆。** 官方 OpenAI Chat/Responses structured output 的可移植读取入口是文本；本地 relay 可能直接返回 object，也可能把 JSON 放在 reasoning/tool arguments。固定先要 string 再正则/JSON.parse，会拒绝兼容扩展；直接接受任意 object，又会绕过领域 schema。
10. **native adapter 的错误分类被同样简化。** Anthropic、Gemini、DashScope 的 HTTP 状态映射主要按 status/body 文本分类；但三者的结构化错误字段和成功 envelope 不同。把它们套入 OpenAI 的 `choices/message/content` 假设，会放大失败。

## 9. 推荐兼容架构（推断/设计建议）

### 9.1 分离“请求能力协商”和“响应归一化”

建议每个 provider profile 显式声明：

```text
wire: openai_chat | openai_responses | lmstudio_chat | ollama_chat | ollama_native | vllm_chat | vllm_responses | anthropic | gemini | dashscope
requestModes: schema | json_object | text | tool_schema | native_json_schema
contentSources: typed ordered list of allowed paths
supportsVision: boolean/unknown
supportsTools: boolean/unknown
supportsReasoningField: boolean/unknown
```

请求 builder 只负责生成该 profile 的合法请求；response normalizer 只负责把已收到的 envelope 变成统一的 discriminated union。不要用一个“OpenAI-like”提取函数去猜所有 provider 的路径。

### 9.2 统一中间结果，但保留原始语义

建议 normalized result 至少有以下互斥 kind：

```text
text              { text, source }
json_value        { value, source }          // object/array，仍须 domain schema
tool_call         { name, arguments, source }
refusal           { text?, source }
reasoning_only    { text, source }
empty             { status?, finishReason?, source }
incomplete        { reason?, source }
provider_error    { httpStatus?, providerCode?, param?, retryAfter?, source }
```

归一化顺序应是：

1. 先读 HTTP status 和可识别的顶层 error/status 字段。
2. 按 wire/provider profile 读取 envelope，不跨协议猜路径。
3. 对 Chat：遍历 choice，识别 refusal、tool_calls、content string/array/null、finish reason；对 Responses：先检查 `status`，再处理 `output_text`/`output[]` item；对 native adapter 读取各自的 typed path。
4. `string` 做 JSON parse；`object/array` 只在该 profile 明确允许时直接送入 domain parser；所有结果都必须通过现有 Zod/domain schema。
5. `reasoning_content` 只在显式 profile + 可审计策略允许时作为候选来源，默认归类 reasoning-only，不静默当最终答案。

这样可以把“没有文本”与“没有结果”“拒答”“工具调用”“截断”“格式未生效”分别记录，也不会把 provider 私有错误内容直接展示给用户。

### 9.3 用结构化能力信号替代错误字符串猜测

推荐优先级：

1. 用户/供应商配置的明确 wire format 与 capability profile。
2. 官方 capability/model metadata（若该服务提供且能说明具体模型能力）。
3. 有界、幂等、最小化的 capability probe：请求固定小 schema，并验证 HTTP、envelope、JSON parse、domain schema 四层。
4. 仅当错误 envelope 的 code/param 明确命中格式字段时，才把失败记为 `parameter_unsupported` 并降级。
5. 对普通 400/422、HTML、未知纯文本、2xx 空响应、schema parse 失败，不从错误文案推断能力；分别记录 `request_invalid`、`content_missing`、`content_invalid` 或 `constraint_not_verified`。

`json_schema → json_object → text` 可以保留为某些 profile 的策略，但每一步必须有“为什么切换”的 typed reason，并设置最多一次/每 capability key 的边界；text fallback 之后仍要 JSON parse + domain validation。不要因为 401、403、429、图片无效、内容安全拒绝或模型不存在而尝试另一种 response format。

针对 LM Studio，应另外增加 schema 编译/探测层：

- 默认不要把 Serpent 的 nullable union schema 原样发送给所有 LM Studio backend；#909 证明 `type` 数组在至少一条 backend 路径会在 parser 入口失败。[LM Studio issue #909](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/909)
- 为 LM Studio profile 准备经过验证的 schema 变体（例如 scalar type + `anyOf`，或业务允许时把 nullable 字段改为可缺省字段）；这只是候选设计，必须对目标 backend/model 做 probe，并通过最终 Zod/domain schema 验证，不能因为 `anyOf` 看起来更标准就直接上线。
- 将 `json_object` 从通用 fallback 改成 profile capability；#189/#1773 的证据表明不能默认假定 LM Studio 接受它。[LM Studio issue #189](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/189)、[LM Studio issue #1773](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1773)
- 对 `content` 为空、`reasoning_content` 有 JSON 的 2xx 响应，先记录 `reasoning_only`/`constraint_not_verified`。只有在用户明确允许、请求幂等且该 profile 已验证 reasoning 路由语义时，才考虑把它作为候选 JSON；默认应发送不带 structured output 的一次重试或报告“格式约束未验证”，而不是静默采信思考字段。这是安全性推断。

### 9.4 缓存和重试边界

- capability cache key 至少包含 provider、wire、endpoint、model、后端/部署标识和相关 capability settings；缓存的是“已验证的 mode”，不是“HTTP 200”。
- 可重试：网络超时、连接失败、429、明确 transient 5xx；尊重 `Retry-After`（各官方错误文档对该语义有说明）。
- 不因格式重试：认证/权限、额度耗尽、无效模型、无效图片/输入、安全拒答、工具调用、incomplete length。
- 仅可降级：明确 `response_format`/`text.format`/`format`/`structured_outputs` 参数不支持，且 provider code/param 或已验证 probe 支持该结论。
- 2xx 但结果非法：默认一次“内容无效”处理；若业务确认分析请求幂等，可由策略层发起一次不带结构化字段的请求，但这属于重新请求，不得伪装成“已证明格式不支持”。

## 10. 测试矩阵（建议）

每个测试应保存脱敏的请求摘要、HTTP status、结构化错误字段、响应 kind/source 和 domain validation 结果；不保存 API key、完整图片路径或用户资产内容。除单元 fixture 外，至少对实际目标版本做后台集成测试。

### 10.1 请求/能力矩阵

| Provider/transport | `schema` | `json_object`/JSON mode | `text`/omit | vision | tools/reasoning |
| --- | ---: | ---: | ---: | ---: | ---: |
| OpenAI Chat | 必测 | 必测 | 必测 | 独立测 | refusal + tool_calls |
| OpenAI Responses | 必测（`text.format`） | 必测 | 必测 | 独立测 | output function_call/reasoning |
| LM Studio Chat + Qwen text | 必测 | 必测/若版本不宣称则记录 unsupported | 必测 | 不适用 | reasoning_content、tool_calls |
| LM Studio Chat + Qwen vision | 必测 | 必测 | 必测 | 文本+图片、图片损坏 | content 空、reasoning-only |
| Ollama `/v1/chat/completions` | 版本探测 | 必测 | 必测 | 必测 | tools/reasoning |
| Ollama `/api/chat` | `format` JSON Schema | `format:"json"` | omit | 必测 | 原生工具/思考字段 |
| Ollama `/v1/responses` | 不默认宣称 | 不默认宣称 | 必测 | 单独记录 | output/status/function call |
| vLLM Chat | OpenAI schema | JSON mode | omit | 取决于模型/服务 | tool_calls/reasoning |
| vLLM Responses | `text.format` | `text.format` | omit | 取决于模型 | output items |
| Anthropic Messages | tool `input_schema` | 不适用 | text fallback | vision 单测 | forced tool_use |
| Gemini | `responseSchema` | `responseMimeType` JSON | omit/普通 text | vision 单测 | functionCall/safety |
| DashScope native | `response_format.json_schema`（支持模型） | `response_format.json_object` | omit/text | Qwen-VL/Omni | reasoning/tool_calls |

### 10.2 成功响应 fixture 矩阵

至少覆盖：

1. Chat `content` 为 JSON string。
2. Chat `content` 为 text-part array。
3. Chat `content:null` + `tool_calls`。
4. Chat `refusal` sibling、refusal content part。
5. Responses `output_text`；只有 message/output_text part；多个 message/text part。
6. Responses 只有 refusal、function_call、reasoning、空 output；`status: incomplete` 与 `status: failed`。
7. LM Studio/Qwen `content:""` + `reasoning_content`；视觉请求返回正常 content；视觉请求返回 content array。
8. Ollama Chat string、原生 `/api/chat` string、Responses output/status；HTTP 200 但 JSON 未遵守 schema。
9. vLLM `content:null` + tool call/reasoning，以及 schema-constrained JSON string。
10. Anthropic `content:[text]`、`content:[tool_use]`、text + tool_use 混合、空/未知 block。
11. Gemini 多 parts、functionCall、无 candidates + promptFeedback、safety finish reason。
12. DashScope `output.choices[].message.content` 为 string、multimodal array、tool_calls + empty content、reasoning_content。
13. 非标准 direct object content：只在声明支持的 profile 中接受，并验证不通过 domain schema 时拒绝。

### 10.3 错误/降级矩阵

| 类别 | 示例 | 期望分类 | 是否切换输出格式 |
| --- | --- | --- | --- |
| 结构化参数不支持 | HTTP 400/422，error code/param 明确命中 `response_format`/`text.format`/`format` | `parameter_unsupported` | 可以，一次有界 fallback |
| 普通 bad request | HTTP 400，但指向 model/image/messages/schema 内容 | `request_invalid` | 否 |
| 认证/权限 | 401/403 或 provider 对应结构化 error | `auth`/`permission` | 否 |
| 额度/限流 | 429 + quota/rate code | `quota`/`rate_limit` | 否；按策略退避 |
| 服务暂时失败 | timeout/408/5xx/529/503 | `transient` | 不切换；按策略重试 |
| HTTP 2xx + refusal | Chat refusal、Responses refusal、native safety block | `refusal` | 否 |
| HTTP 2xx + tool call | `tool_calls`、Responses function_call、Anthropic tool_use、Gemini functionCall | `tool_call` | 否 |
| HTTP 2xx + incomplete | `status: incomplete`、finish reason length | `incomplete` | 否，除非业务明确重试 |
| HTTP 2xx + 空文本 | content empty/null 且没有可接受 tool/refusal | `content_missing` | 默认否；可按幂等策略一次重试并单独记 reason |
| HTTP 2xx + JSON 非法 | 约束被忽略、markdown、截断 JSON | `content_invalid`/`constraint_not_verified` | 不从此事实推出 unsupported |
| 非 JSON/HTML 错误 body | status 有但无结构化字段 | `unknown_provider_error` | 否 |

## 11. 未验证项与交付边界

- 本文基于官方文档、官方 SDK/服务端源码和官方 issue；没有在本次调研中调用真实 OpenAI、LM Studio、Ollama、vLLM、Anthropic、Gemini 或 DashScope endpoint。
- LM Studio、Ollama、vLLM 的实际支持会受版本、模型权重、chat template、推理后端、thinking 设置和 relay 配置影响；本文对官方 issue 的描述是观察证据，不是所有安装的保证。
- 没有因此修改生产代码、测试代码或其他文档；后续若实施架构调整，必须另起实现变更并同步更新相关测试与验收证据。
