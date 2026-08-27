# AI 提供商与结构化输出兼容性调研

> 调研日期：2026-08-28
> 目的：为 Serpent 的 AI 资产分析明确 OpenAI 兼容端点、本地模型和原生提供商的兼容边界。
> 来源约束：只采用提供商或项目官方文档；“建议”与“官方事实”分开记录。

## 结论

Serpent 不应为每一个本地模型单独写适配器。对 OpenAI 兼容端点，推荐按请求能力协商：

`json_schema → json_object → 普通文本 JSON`

每次收到结果后仍必须经过 Serpent 自己的 Zod schema 校验；请求端的结构化输出只是提高可靠性的提示和约束，不是信任边界。该策略覆盖 LM Studio + Qwen、Ollama 的 OpenAI 兼容接口、vLLM，以及大多数只实现 OpenAI Chat Completions 的中转服务。OpenAI 的官方 API 参考也把 `json_schema` 标为首选、`json_object` 作为较旧的兼容形式。[OpenAI Chat Completions API reference](https://platform.openai.com/docs/api-reference/chat/object?lang=ruby)

LM Studio 官方文档明确说明其 `/v1/chat/completions` 支持 JSON Schema；但并非所有模型都支持结构化输出，尤其是参数量较小的模型。因此 Qwen 是否支持还取决于实际加载的模型和服务版本，不能只按“Qwen”品牌判断。[LM Studio structured output](https://beta.lmstudio.ai/docs/developer/openai-compat/structured-output)

Serpent 的 OpenAI-family adapter 已实现上述协商，并且只在服务端明确拒绝 `response_format`/schema envelope 时降级；普通的 400（错误模型、权限、输入或额度）不重试，避免掩盖真正错误。

## 官方能力事实

### OpenAI 兼容端点

- OpenAI Chat Completions 推荐 `response_format.type = json_schema`；较旧实现可使用 `json_object`。Schema 请求不是结果校验的替代品，客户端仍需校验返回内容。[OpenAI Chat Completions API reference](https://platform.openai.com/docs/api-reference/chat/object?lang=ruby)
- OpenAI Responses 使用 `text.format`，同样以 `json_schema` 为首选、`json_object` 为兼容选项。[OpenAI Responses API reference](https://platform.openai.com/docs/api-reference/responses-streaming/response/web_search_call?lang=curl)
- LM Studio 暴露 OpenAI-compatible API，并在 Chat Completions 上接受 JSON Schema；官方同时警告模型能力有差异。[LM Studio structured output](https://beta.lmstudio.ai/docs/developer/openai-compat/structured-output)
- Ollama 官方将 structured outputs 作为能力，并说明可通过 JSON Schema 约束响应；其 OpenAI 兼容层应按实际部署版本做能力探测。[Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
- vLLM 官方提供 guided/structured outputs，并支持 JSON Schema；不同 backend/model 组合仍可能有实现限制。[vLLM structured outputs](https://docs.vllm.ai/en/latest/features/structured_outputs/)

### 原生提供商

- Gemini 官方支持按 JSON Schema 返回结构化 JSON，并要求应用验证结果。[Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output?lang=rest)
- Anthropic 官方把 tool use 作为结构化输入/输出的主要机制；原生 Anthropic adapter 不应伪装成 OpenAI `response_format`。[Anthropic tool use](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use)
- DashScope/Qwen 原生多模态接口已有独立 adapter；它和 Qwen 通过 LM Studio/Ollama/vLLM 暴露的 OpenAI-compatible 接口是两条不同路径，应分别保留。

## 对 Serpent 的实现边界

1. OpenAI-compatible 配置保留 `baseUrl` 和 wire format，先发严格 JSON Schema；遇到明确的 envelope 不兼容才尝试 `json_object`，再退到普通文本 JSON。
2. 只把“格式不支持/必须使用另一种格式”的响应判为可降级。未知模型、无效 API key、输入过大、额度不足和一般 HTTP 400/422 不应被吞掉或重复发送。
3. 三种模式都复用同一套 prompt 和结果解析；最终必须经过 `aiStructuredOutputSchema`/`parseAiAnalysisResultFromModelText`，拒绝缺字段、越界评分和额外字段。
4. 需要给用户可理解的配置提示：本地端点地址、模型名、模型是否支持视觉输入、是否支持 structured output 是独立能力；“接口能连通”不等于“能分析图片”。
5. 不宣称“支持所有模型提供商”。当前方案覆盖主流原生提供商和遵循 OpenAI Chat/Responses 约定的服务，但厂商私有字段、视觉输入格式、低参数模型能力和中转层错误文案仍需要真实端点验证。

## 下一步

- 用 LM Studio + 一个支持视觉的 Qwen 模型完成真实连接、图片分析和失败降级验收。
- 用 Ollama 与 vLLM 各跑一条 Chat Completions 兼容路径，记录服务版本、模型名、首个可用模式和最终 Zod 校验结果。
- 把真实端点矩阵放入发布前 QA；单元测试只能证明请求协商和错误分类，不能替代本地模型或 Windows/macOS packaged 证据。
