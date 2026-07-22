# AI 分析传输、输出与高可用配置调研

> 调研日期：2026-07-23  
> 问题：为 Serpent 的图片/视频 AI 分析选择可靠的百炼传输协议与输出契约；并以 CC Switch 的开源配置面为对照，界定应实现的稳定性、高可用和可观测性设置。  
> 来源约束：仅使用阿里云 Model Studio 官方文档、CC Switch 官方开源仓库，以及当前 Serpent 源码。本文不记录或引用任何 API Key。

## 结论

1. **不要把“纯 txt”理解为自由文本协议。** 模型服务的请求仍必须使用 HTTP + JSON；可选择的是模型内容输出。Serpent 应使用“一段 JSON 字符串”作为输出内容契约，而不是让模型写无约束散文后再做本地 NLP。这样才能可靠地写入 `description`、`tags`、`rating` 三个独立字段。
2. **百炼原生 DashScope 多模态 API 应成为首选 transport**，新增 `dashscope_native`，而非以 OpenAI/Anthropic 格式为主。它原生提供 `text` 与 `json_object` 输出模式；Serpent 当前仍只发送图片或由视频生成的有界联系表/海报衍生图，不直接上传原视频。[DashScope 多模态 API](https://help.aliyun.com/en/model-studio/qwen-api-via-dashscope)
3. 用户给出的 workspace `.../compatible-mode/v1` 域名可用于 OpenAI-compatible Responses；但 Responses 官方文档明确说**不支持视频或音频输入**。它不应成为 Serpent 全媒体分析的默认路径；可保留为“兼容模式、仅图片”的高级 fallback。[Responses API：输入限制](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-responses)
4. 高可用不等于把并发开到最大。采用**全局并发上限（默认 16）+ 每个 profile 可选上限 + 有界重试/超时 + 熔断 + 有序 failover + 可审计请求记录**。当前 Serpent 已有全局 1–32 的持久化并发归一化、默认 16 和一个跨资源库共享 semaphore；后续工作应把它接到 profile 健康与 failover 体系，而不是再造第二个并发池。[当前并发契约](../../src/shared/ai-concurrency.ts)

## 百炼协议能力与选择

### OpenAI-compatible Responses：可用，但不适合当默认媒体通道

Model Studio 官方给出了 workspace 专属北京域名下 `POST /compatible-mode/v1/responses` 的调用方式，并建议使用新 workspace 域名以获得更高性能和稳定性；旧的 `/api/v2/...` 路径将废弃。[Create a response](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-responses)

Responses 可接受纯文本或消息数组，图片可作为 `input_image`；返回的 `output` 中含 `output_text`，SDK 也提供 `output_text` 便利字段。其限制是该 API **目前不支持视频或音频输入**，官方要求这两类输入改用 Chat Completions 或 DashScope API。[Create a response：input/response 形状与限制](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-responses)

因此，Responses 可以作为“测试连接、文本 AI 搜索计划、纯图片兼容 profile”的实现选项，却不能承担 Serpent 的图片和视频统一分析主路径。

### OpenAI-compatible Chat：能处理媒体，但不是用户要求的首选

同一 compatible-mode 服务的 Chat Completions 支持图片、音频、视频帧与视频文件等内容形状，官方示例也覆盖 Qwen-VL 视频输入。[OpenAI-compatible Chat](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions)

这仍是 OpenAI Chat wire format；若目标是避免通过 OpenAI/Anthropic 格式接入，不应把它设为默认。它只应是明确配置的兼容 profile（例如第三方中转仅支持该格式时）。

### 原生 DashScope 多模态：推荐的默认 transport

官方原生端点为 workspace 域名下的 `POST /api/v1/services/aigc/multimodal-generation/generation`。它直接接受多模态 `messages`，图片可以是 URL、Base64 Data URL 或本地文件；视频可以是帧数组或视频文件，并有 `fps`、像素和总像素控制，适合把吞吐与成本控制放在 Serpent 内。[DashScope 多模态 API](https://help.aliyun.com/en/model-studio/qwen-api-via-dashscope)

原生 API 的 `parameters.response_format` 支持：

- `{"type":"text"}`：默认自然语言文本；
- `{"type":"json_object"}`：标准 JSON 字符串。

使用 `json_object` 时，prompt 必须明确要求 JSON，否则 API 会报错。[DashScope 多模态 API：`response_format`](https://help.aliyun.com/en/model-studio/qwen-api-via-dashscope)

官方视觉模型页也把“从视觉输入得到有效 JSON”列为结构化输出能力，且列明适用的 Qwen3/Qwen-VL 非思考模式模型。[Visual understanding](https://help.aliyun.com/en/model-studio/vision-model/)

## “纯 txt”应如何落地

| 方案 | 对标签/描述/评分的结果 | 结论 |
| --- | --- | --- |
| 自由自然语言 txt，再由本地规则猜字段 | 字段缺失、语言混杂、数字评分与标签边界不稳定；需要另一个解析器，失败原因也不可归因 | 不采用 |
| txt 载荷中的一个 JSON 对象（`json_object`） | 人类可读、所有厂商都可按文本返回；本地可用 Zod/运行时 schema 验证、拒绝整条坏结果 | **采用** |
| 严格 `json_schema` / tool call 作为唯一成功路径 | 比普通 JSON mode 更依赖供应商兼容性；不是百炼原生文档为视觉结构化输出承诺的通用基线 | 不作为唯一路径 |

因此 `dashscope_native` 的分析请求应显式要求“只返回一个 JSON 对象”，带 `response_format: { type: 'json_object' }`，并把返回的**字符串**交给既有 `parseAiAnalysisResultFromModelText` 与领域校验。网络返回的外层仍是 HTTP JSON，这不是可以或应该去掉的 OpenAI/Anthropic“格式”。

当前 Serpent 的系统提示词本来就要求 `description`、`tags`、`rating` 的 JSON 形状，OpenAI adapter 也已经以 `json_object` 优先、兼容服务 400 时退到文本 JSON；结论是应**复用领域解析与验证层**，替换首选 vendor adapter，而非把结果层改成自由文本。[当前提示词/字段约束](../../src/shared/ai-analysis-settings.ts) / [当前 OpenAI fallback](../../src/worker/ai/openai-adapter.ts)

## CC Switch 对照：应对标的配置面

CC Switch 将 provider 的协议格式作为显式 `apiFormat`：原生 Anthropic Messages、OpenAI Chat Completions、OpenAI Responses；对不匹配的上游，local routing 会做 request/response（含 SSE、reasoning、tool calls）转换。直接支持 Responses 的上游无需转换。[Provider API Format](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/en/2-providers/2.1-add.md) / [Responses 与 Chat 路由](https://github.com/farion1231/cc-switch/blob/main/docs/guides/codex-deepseek-routing-guide-en.md)

Serpent 不需要复制其“为五个 coding CLI 转协议”的代理本身，但应完整吸收**与本地 AI 分析相关**的配置维度：

| CC Switch 配置面 | Serpent AI 分析对应设置 | 处理原则 |
| --- | --- | --- |
| Provider 名称、备注、网站、图标、启用/当前选择 | 分析 profile 名称、说明、启用、默认 profile | 应有；profile 是 failover 单元，不是仅一组全局 key |
| API key、base URL、完整 endpoint 模式、API format、模型 | 凭据（安全存储）、原生/兼容 transport、base URL/可选完整 endpoint、模型与能力标记 | 应有；首选 `dashscope_native`，兼容格式为显式 fallback |
| 多 endpoint、测速、自动选最低延迟 | 一个 profile 可有有序 endpoint；手动“测试连接/视觉样本探测”；可选自动选健康且低延迟的 endpoint | 应有；测速不能取代真实多模态探测 |
| 自动发现 OpenAI `/v1/models` | 模型手填、官方预设；仅对明确的 compatible profile 启用模型发现 | 应有但不可强依赖，原生 DashScope 不应假定 `/v1/models` |
| 自定义 User-Agent、Header/Body JSON overrides | 高级“额外 header / 参数” | 应有，但白名单/JSON schema 校验、脱敏日志；不得允许覆盖认证、模型输入或内部限流字段 |
| 请求日志、首字节/总耗时、HTTP 状态、token、费用/预算 | 每 job attempt 的 profile、endpoint、模型、排队/运行时长、重试、结果、request ID、token/费用（若上游提供）与日/月限额 | 应有；是定位稳定性与成本问题的前提 |
| 自动 failover、优先队列、健康状态 | 有序 profile failover 与健康看板 | 应有；认证/权限错误不切换，429/5xx/超时/网络错误按策略切换 |
| 重试、流式首字节/静默/非流式超时、熔断阈值/半开恢复/错误率/最小样本 | 每 profile 可继承全局的 retry/timeout/circuit-breaker 策略 | 应有；Serpent 默认非流式任务，可隐藏流式专用项直到启用 streaming |

CC Switch 的开源 UI/实现可直接作为这些设置存在性和边界的依据：它暴露多端点测速与自动选择、在代理接管后应用的 header/body overrides，以及重试、三类 timeout 与熔断参数。[EndpointSpeedTest](https://github.com/farion1231/cc-switch/blob/main/src/components/providers/forms/EndpointSpeedTest.tsx) / [Request overrides](https://github.com/farion1231/cc-switch/blob/main/src/components/providers/forms/LocalProxyRequestOverridesField.tsx) / [Auto-failover settings](https://github.com/farion1231/cc-switch/blob/main/src/components/proxy/AutoFailoverConfigPanel.tsx) / [Circuit breaker](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/proxy/circuit_breaker.rs)

**不应机械复制的 CC Switch 项目：** Codex/Claude/Gemini 专属的 model mapping、CLI 接管、MCP/Skills/Prompts 同步、代理监听端口和 coding-session 历史，均不属于 Serpent 资产分析的配置域。对标应是“同等可控性与故障可见性”，而非暴露无业务意义的开关。

## 建议的 Serpent 配置与运行时契约

### Profile（可多份，按优先级 failover）

- transport：`dashscope_native`、`openai_responses`、`openai_chat`、`anthropic`、`gemini_native`；默认新建推荐 `dashscope_native`。
- 凭据、base URL、可选完整 endpoint、模型；原生百炼 profile 还暴露图像/视频采样 `fps`、单帧与总像素上限。
- enabled、priority、每 profile 并发上限（可选；实际有效值为 `min(globalLimit, profileLimit)`）、额外安全 header/参数、模型能力（图片/视频/JSON mode）。
- 探测按钮：最小文字请求用于认证/连通性；“验证媒体能力”使用无用户隐私的固定小图/视频 fixture。保存配置前不把用户资产传去测试。

### 全局可靠性与性能

- `maxConcurrentAnalyses`：**默认 16**，持久化并限制为合理正整数；当前已有全局默认 16、范围 1–32 的实现。调小只影响尚未开始的工作，不能中止已有任务。[当前 limiter](../../src/worker/ai/provider-concurrency-limiter.ts)
- 任务超时、首次响应超时（若以后提供 streaming）、idle 超时、最大重试次数、指数退避/抖动、是否启用自动 failover。
- 熔断：连续失败阈值、错误率阈值、最小样本、open 持续时间、half-open 成功阈值；CC Switch 的实现还限制 half-open 只放一条探测请求，避免恢复时的并发雪崩。[CC Switch circuit breaker](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/proxy/circuit_breaker.rs)
- 限额：日/月预算、分析量或 token 上限；到达限额时暂停队列并明确告知，不把配额错误误报为“模型解析失败”。

### 严格的写入与重试语义

- 每次分析形成一个可追踪 attempt；只在校验后的完整 JSON 结果到达时原子写入 AI 内容层。
- `401/403` 是 profile 配置问题，停止该 profile 且不作盲重试；`429`、可恢复 `5xx`、网络与 timeout 才进入有界退避/下一个健康 profile；`invalid_response` 应记录原始响应的脱敏摘要并按次数熔断，不能污染资产元数据。
- 用户取消、资源库关闭、资产已删除、手动编辑过 AI 内容时必须取消或丢弃过期结果；failover/retry 不得覆盖较新的人工内容。

## 实施前需明确的产品决策

1. 是否允许“高级 body override”覆盖视觉模型的 `fps` / 像素参数；建议允许受限白名单，不允许任意覆盖 prompt、JSON mode、认证和并发上限。
2. failover 是同一百炼账号的多个 endpoint/模型，还是可配置多个独立供应商 profile；建议两者均支持，但默认只启用用户明确保存且探测通过的 profile。
3. 默认 16 是全局**最大 in-flight 请求数**，不是每个 provider 16；多 profile 同时存在时仍保持全局上限，避免把上游限流与本机内存压力放大。
4. 测试密钥必须仅进入系统安全存储或现有加密配置，不进入源码、测试 fixture、日志、开发记录或 git 提交。阿里云示例也以环境变量取 key，避免在生产代码中硬编码。[Model Studio structured output example](https://help.aliyun.com/en/model-studio/qwen-structured-output)

## 最终判断

Serpent 应把“纯文本”落实为**原生 DashScope 多模态传输上的 JSON 文本输出**：协议不依赖 OpenAI/Anthropic，领域结果保持强校验；图片与视频的有界衍生图走同一条主链路。OpenAI Responses 可以保留为兼容 adapter，但因官方视频/音频限制，不能是默认分析通道。

当前增量已交付 `dashscope_native` adapter、默认 16 的全局限流与有界 retry/timeout；下一阶段的重点是 profile/endpoint 健康模型、profile 级限流、circuit/failover、预算与脱敏可观测性。它们共同决定稳定性、高可用性和性能，而不是单独增加更多并发。
