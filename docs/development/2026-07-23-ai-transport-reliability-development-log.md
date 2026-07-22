# AI 传输、并发与可靠性配置

> 状态：implementation-complete / verification-in-progress  
> 开始时间：2026-07-23  
> 最后更新：2026-07-23

## 目标与边界

本增量把 AI 分析的默认并发上限改为 16，并把它实现为跨资源库、跨协议共享的实际
in-flight 请求上限；同时新增百炼 DashScope 原生多模态协议、持久化的超时/重试控制，
以及 Responses 结构化输出兼容回退。

“纯 txt”不表示无约束自然语言：所有 adapter 都要求模型内容只返回一个 JSON 对象，
再由既有 Zod 领域校验处理。网络外层仍是各厂商规定的 HTTP JSON。视频继续只发送
既有联系表或海报等有界衍生图，不会直接上传原始视频。

本增量**没有**实现多 profile、endpoint 健康探测/自动选择、熔断、自动 failover、
预算或请求级可观测性；它们需要独立 profile 领域模型，不能伪装成只有界面的开关。
完整调研与下一阶段配置矩阵见
[AI 传输、输出与高可用配置调研](../research/ai-analysis-transport-and-reliability-2026-07-23.md)。

## 实现决定

- `dashscope_native` 使用 workspace `/api/v1/services/aigc/multimodal-generation/generation`；
  若用户在原生格式中粘贴同一 workspace 的 `/compatible-mode/v1`，会自动规范到 `/api/v1`。
  OpenAI Responses 仍使用 compatible-mode `/responses`，两者不混用。
- 原生 DashScope 请求指定 `response_format: { type: "json_object" }`；OpenAI Responses
  对不接受 `text.format` 的兼容服务仅重试一次为 JSON 文本提示，结果仍受同一 schema 校验。
- `ProviderConcurrencyLimiter` 变为全局 FIFO semaphore。持久化上限范围为 1–32，默认 16；
  调低上限只约束尚未开始的请求，绝不终止运行中的分析。
- 非流式单次请求由可取消的 timeout signal 限制；网络、限流和 timeout 才会有界重试。
  重试使用指数退避及对称随机抖动，降低多任务同步重试对上游的冲击。
- semaphore 的排队等待只受用户取消控制，**不**消耗「单次请求超时」；timeout 在真正获得
  全局槽位、即将发起上游请求时才开始，避免满载时产生尚未出网的假 timeout/retry 风暴。
- 兼容 Responses 对明确的 `text.format` 不支持错误只协商一次并按 endpoint 缓存；普通 HTTP 400
  不会重发。首批并行任务共享这个协商中的结果，避免默认 16 并发时重复发送 16 次已知不兼容的
  结构化探测。兼容 relay 的 Chat/DashScope 风格返回包络仍会进入同一 JSON/schema 校验。
- `running` 是已 claim 的数据库 job，不能证明网络并发。工作区进度条额外显示全局 semaphore
  的真实 in-flight、上限和等待槽位；保存并发设置会即时下发到运行中 Worker。
- 无法形成可验证模型 JSON 的 HTTP 200 包络、空输出和 schema 输出不合格是可恢复错误，会使用
  已配置的有界尝试次数；认证、权限、额度和 HTTP 400 参数错误仍然终止，避免盲重试。
- Main 等待 Worker 批次时按任务波次与单次请求 timeout 计算下限，避免低并发/长 timeout
  被 Main 的固定等待错误判为失败。

## 四列可追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 默认 16、可设并发、跨 provider/资源库全局限制 | `src/shared/ai-concurrency.ts`；`src/worker/ai/provider-concurrency-limiter.ts`；`src/worker/index.ts`；`src/renderer/AiConfigDialog.tsx` | `tests/unit/ai-concurrency.test.ts`；`tests/unit/ai-provider-runtime.test.ts`；`tests/unit/protocol.test.ts` | 待人类：JOBS-005 |
| 百炼原生 DashScope，兼容 URL 正确分流 | `src/shared/ai-endpoints.ts`；`src/worker/ai/dashscope-adapter.ts`；`src/worker/index.ts` | `tests/unit/ai-endpoints.test.ts`；`tests/unit/ai-protocol.test.ts`；`tests/unit/ai-search-planner.test.ts` | 待人类：AICFG-013；真实 key/media 旅程未执行 |
| Responses 的 JSON 文本兼容回退 | `src/worker/ai/openai-adapter.ts` | `tests/worker/ai-analysis.test.ts` | 真实兼容服务回退路径未执行 |
| 持久化 timeout、尝试次数、退避/抖动 | `src/shared/ai-reliability.ts`；`src/main/ai-queue-scheduler.ts`；`src/main/index.ts`；`src/main/worker-client.ts`；`src/worker/index.ts`；`src/worker/ai/limited-request.ts`；`src/renderer/AiReliabilitySettingsFields.tsx` | `tests/unit/ai-reliability.test.ts`；`tests/unit/ai-provider-runtime.test.ts`；`tests/unit/ai-queue-runtime.test.ts`；`tests/unit/worker-client.test.ts` | 待人类：AICFG-014；真实网络故障旅程未执行 |
| 开始分析不重复弹 notice，固定进度条保留 | `src/renderer/App.tsx` | 当前无定向 UI 自动化 | 待人类：JOBS-008 |
| 真实请求并发可观察，运行时更新并发上限 | `src/worker/ai/provider-concurrency-limiter.ts`；`src/worker/index.ts`；`src/renderer/App.tsx` | `tests/unit/ai-provider-runtime.test.ts`；`tests/unit/protocol.test.ts` | 待人类：JOBS-005 |
| 兼容 Responses 输出/格式协商和坏 JSON 的有界恢复 | `src/worker/ai/openai-adapter.ts`；`src/worker/ai/dashscope-adapter.ts`；`src/worker/ai/error-mapping.ts` | `tests/worker/ai-analysis.test.ts`；`tests/unit/ai-protocol.test.ts` | 待真实兼容 relay 验证 |

## 验证记录

- `npm run typecheck`：通过（`tsc --noEmit && tsc -p tsconfig.extension.json`）。
- `npm run test:unit`：通过，163 files、1322 passed、1 skipped。
- `node scripts/run-vitest-with-electron.mjs tests/worker/ai-analysis.test.ts`：通过，25 passed。
- 关键矩阵（全局并发、实时更新、排队不计入请求 timeout、原生/兼容端点、Responses 首批协商、
  429/额度/认证/权限/5xx/网络、HTTP 200 坏包络/JSON/schema 不合格、退避抖动）连续运行 3 次：
  每轮 7 个 unit files、87 passed，及 Worker adapter 25 passed，三轮一致。
- 新增/修改的 `openai-adapter.ts`、`limited-request.ts` 及相应测试通过定向 ESLint；全仓 lint
  的既有 10 error / 1 warning 仍单独保留在下一条，不归因于本增量。
- 两位独立复审先后发现并确认修复：排队计入请求 timeout、首批 Responses 协商重复探测/阻塞槽位、
  400 body 读取异常遗留协商状态，以及该读取阶段的 timeout 误分类；最终复审无 P1/P2。
- `npm run test`：**未通过**；AI 相关单测通过，但 11 个既有 Worker schema-migration 断言仍期望旧的 `user_version`（例如
  `tests/worker/linked-folders.test.ts:61` 期望 16，当前迁移实际为 17）。单文件串行复现相同差异，不能把它记为本轮并发竞态。
- `npm run lint`：**未通过**；无本轮新增诊断，仓库仍有 10 个既有 error / 1 个 warning，涉及 `App.tsx`、
  `AiConfigDialog.tsx`、`AppSettingsDialog.tsx`、`ScopeBreadcrumbs.tsx`、`library-service.ts` 等。
- `npm run test:e2e`（后台、隔离 userData）：**未通过**（65 项中 59 项失败）。大部分旅程在创建库前被旧定位器阻断：
  `getByLabel("名称")` 同时匹配创建库输入和排序按钮的 `aria-label="排序: 名称, 升序"`；另有偏好测试对 range input 使用
  `fill()`。这些与 AI 传输无调用交集，未为本轮改动跨范围修复。
- `git diff --check`：通过（最终审查修复前后均无空白错误）。

尚未把未运行的 packaged、Windows、真实百炼端点或 Computer Use 检查写成通过；这些证据缺失时，以上人类验收项保持“待人类验收”。

## 真实历史错误审计（只读）

在用户现有资源库的历史 AI jobs 中，失败 27 项：`AI_INVALID_RESPONSE` 22（约 81%），
`AI_NETWORK` 5（约 19%）。22 项格式失败均只尝试 1 次；网络失败则已按旧策略尝试 3 次。
这不是新代码运行后的成功率证据，而是本轮兼容包络解析和“仅模型输出不合格时有界重试”
的优先级依据。没有读取或记录 API Key、原始资产或模型输出。

## 已知工作项

- `.beads/issues.jsonl` 与本地 Dolt beads 数据库存在双向分叉：JSONL-only `Serpent-1xmk`，
  Dolt-only `Serpent-qrlu`。`bd` 拒绝自动导出，修复需要可能重建/导入状态的命令；本回合
  不会未经授权执行。`Serpent-qrlu` 和 `Serpent-8tec` 的关闭与 `bd dolt push` 因此暂缓。
