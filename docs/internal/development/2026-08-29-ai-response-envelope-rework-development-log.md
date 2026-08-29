# AI 响应 envelope 与结构化输出协商修复开发日志

> 日期：2026-08-29
> 关联工单：`Serpent-84f95d`
> 状态：自动化验证通过；真实 LM Studio/Qwen 端点待人工复验

## 本轮问题

用户提供的 Serpent 运行日志显示，AI 分析在生成前被 OpenAI-compatible 服务拒绝：

- HTTP `400`
- provider code：`invalid_parameter_error`
- provider param：`response_format.json_schema.schema`
- provider message：`Format error ... None is not of type 'object', 'boolean'`

这不是模型返回内容解析失败，而是服务端对 `json_schema` 请求 envelope 做类型校验时失败。原有兼容判定只识别“unsupported / must be”等格式不支持措辞，漏掉了这类明确指向 schema 路径的 validation error，因此没有继续发送纯文本请求。

## 修复内容

- 将 OpenAI Chat / Responses 的请求格式构造、响应 envelope 归一化、错误分类拆开处理。
- JSON Schema 的可空字段改用 `anyOf`，避免部分本地后端拒绝 JSON Schema `type` 数组。
- 对明确指向 `response_format.json_schema.schema` 且包含类型校验失败的 400/422，安全降级到不带 `response_format` 的纯文本 JSON 请求。
- 保留 refusal、tool call、reasoning-only、empty、incomplete、failed 等响应状态，避免把它们混成普通成功文本或无条件重试。
- 只有响应 envelope 和 Serpent 领域 schema 均校验成功时才缓存格式能力；provider 错误保留脱敏的 code/type/param/message 供诊断日志使用。

## 验证记录

按真实日志错误体新增回归用例。修复前该用例失败，错误体被当作普通 HTTP 400；修复后：

- `npx vitest run --config vitest.config.ts tests/unit/ai-protocol.test.ts -t "schema envelope"`：1/1 通过。
- `npx vitest run --config vitest.config.ts tests/unit/ai-protocol.test.ts`：69/69 通过。
- `npx vitest run --config vitest.config.ts tests/worker/ai-analysis.test.ts`：28/28 通过。
- `npm run test:unit`：2998/2998 通过，1 个文件跳过、3 个测试跳过。
- `npm run typecheck`：通过。
- 改动文件 `eslint`：通过。
- `npm run lint`：未通过；仅命中本轮未改动的既有 `src/renderer/App.tsx:520` `react-hooks/set-state-in-effect` 错误，AI 改动文件没有 lint 错误。

## 未验证边界

- 尚未重新连接真实 LM Studio/Qwen 端点复验“首次结构化请求失败 → 纯文本请求成功”的完整用户旅程。
- Windows、Responses 真实服务端和不同本地模型/backend 组合仍未执行平台/端点验收。
- 因此本工单保持开放，等待用户对实际 AI 分析结果进行复验。
