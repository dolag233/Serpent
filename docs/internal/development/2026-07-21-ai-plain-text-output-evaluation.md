# AI 输出：纯文本 / 宽松 JSON vs 严格 structured schema

> 工单：`Serpent-0s4i`（评估）+ 连接修复 `Serpent-p4c6`  
> 日期：2026-07-21  
> 对照：CC Switch `meta.apiFormat` / 中转站兼容性；Anthropic 已有 text fallback（`Serpent-iokf`）

## 结论（可实施）

**推荐：不要依赖「严格 json_schema / tool_use 必达」作为唯一路径。**  
领域侧仍写入结构化字段（description / tags / rating），但**传输层优先「模型返回一段可解析的 JSON 文本」**：

| 层级 | 做法 |
| --- | --- |
| OpenAI Chat / Responses | `response_format: json_object`（若 400 再降级为无 format 的纯文本）；prompt 要求只输出一个 JSON 对象；解析时剥 ``` 围栏 |
| Anthropic | 保留 tool_use；已有纯文本 JSON fallback（保持） |
| Gemini | 可继续 `responseMimeType: application/json`；解析同样走宽松路径；自定义端点同时带 `x-goog-api-key` |

**不推荐**把输出改成「完全自由散文再 NLP 抽字段」——错误率与本地化成本更高，且与现有 AI 内容层模型不匹配。

「单纯返回 txt」若指 **txt 里嵌 JSON**，与上表一致，应做；若指 **无结构自然语言**，MVP 不做。

## 利弊

**严格 json_schema / tool_use**

- 利：字段形状有供应商侧约束，理想官方端点更稳  
- 弊：大量中转不支持 → HTTP 400 / `AI_INVALID_RESPONSE`；与「只有 Anthropic 能连」类反馈叠加（分析路径死、误判为连接差）

**宽松 JSON 文本**

- 利：中转兼容面大；与 Anthropic text fallback 统一心智；实现成本低  
- 弊：偶发多话、缺字段 → 需容错 coerce（已有 tags 字符串拆分等）；极少情况需重试

## 与连接问题的关系

连接（probe）本身不发 schema；非 Anthropic「连不上」更常见根因是 **Base URL 拼接**（host-only 缺 `/v1`、与 Claude 中转 URL 混用）。见 `joinAiApiUrl` / `ensureOpenAiCompatibleRoot`（对齐 CC Switch `build_url` 去重 `/v1/v1`）。

输出格式放宽主要降低 **分析成功后解析失败**，并减少中转对 `json_schema` 的 400。

## 本回合已落地

- URL 规范化（`ai-endpoints.ts`）  
- OpenAI 改 `json_object` + 400 降级纯文本 + `parseAiAnalysisResultFromModelText`  
- Gemini 增加 `x-goog-api-key` 头  

后续可选：Gemini 在 schema 400 时同样降级；UI 提示「Claude 中转 URL 不能直接当 OpenAI Base」。
