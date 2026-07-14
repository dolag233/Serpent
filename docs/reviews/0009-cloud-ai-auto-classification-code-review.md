# 切片 0009 代码审查：云端 AI 自动分类（BYOK）

> 状态：Spec 未通过 / 可靠性修复待最终复审
> 日期：2026-07-13

## 审查范围

- 规格：`docs/implementation/0009-cloud-ai-auto-classification-vertical-slice.md`
- 原始固定范围：`git diff 8dc2470...cdc2247`
- 复审：2026-07-13 当前未提交 working tree
- 本文只基于静态实现与 mock 自动化证据；未访问真实供应商、未执行 Windows QA。

## Standards 轴

| Finding | 原始/中间状态 | 当前 working tree | 状态 |
| --- | --- | --- | --- |
| 队列不消费或只消费一批 | job 能入队，但没有可靠的持续 consumer；超过首批或重入时可滞留 | Main scheduler 满批自排空，并对 requeued job 做封顶指数退避 | 已修复，待集成复审 |
| 暂停/取消不终止上传 | 数据库状态改变后，活动供应商请求仍可能继续，迟到结果可写库 | 活动 job 注册 AbortController；pause/cancel/shutdown abort；写入事务检查 running guard | 已修复，自动化覆盖 |
| 重试与错误语义 | 供应商错误曾映射为导入类错误或只保存泛化失败 | 认证/权限/额度/限流/网络/超时/无效响应有独立安全原因；临时失败最多两次重试 | 已修复，mock 覆盖 |
| 错误可观测性 | 队列失败缺少可追踪的持久诊断 | Renderer 原因已细分；持久日志保留去敏分类、供应商 kind、HTTP 状态、系统错误码和 cause，同时遮蔽凭据 | 已修复，单元覆盖 |
| API Key 持久化 | BYOK 需避免 Renderer 回读和明文落盘 | `safeStorage` 密文落盘，Renderer 只见 `hasKey`；未发现 Key 写数据库/日志 | 自动化/静态通过 |
| 供应商 schema | OpenAI strict schema / Gemini property ordering 曾不符合实际接口要求 | strict required+nullable 与数组式 property ordering 已修正 | mock 契约通过；真实 API 未验证 |
| 单文件巨型服务类 | AI schema、队列、导入导出等继续集中在 `library-service.ts` | 本轮只抽出 scheduler/error mapping/abort registry，领域服务仍高度耦合 | 开放的可维护性风险 |

## Spec 轴

| 规格项 | 证据 | 结论 |
| --- | --- | --- |
| 三供应商 BYOK、结构化结果与统一错误 | 三个 adapter 与 mock contract tests | 部分通过；没有真实供应商证据 |
| API Key 安全存储且不回 Renderer | Main safeStorage、配置响应 `hasKey`、安全测试 | 主线通过 |
| Worker 内解密并缓存 Key | 正式分析由 Main 解密并通过私有 command 传给 Worker；`ai.configure` 不缓存 | **规格偏差，待架构决定** |
| 自动入队和崩溃恢复 | 托管/链接导入 hook、open 时 running→queued、图片/视频前置条件 | 自动化主线通过 |
| 队列消费、自排空、重试退避 | `AiQueueScheduler`、claim/fail/complete、runtime tests | 通过阶段复审 |
| 暂停/取消后不继续 HTTP、不写结果 | AbortSignal + job state/transaction guard | 通过自动化；真实长请求人工 QA 未执行 |
| 默认同供应商并发 2 | 当前 process loop 顺序 await 每个 job | **未实现** |
| 进度事件与完整队列 UI | Preload/WorkerClient 有订阅类型，但 Main/Renderer 没有完整发布消费和队列面板 | **未实现** |
| 按资产/文件夹/全库操作与清空 AI 内容 | Worker/协议存在；Renderer 只有单资产直接分析和设置界面 | 后端部分通过，用户主线不完整 |
| 图片发送缩略图，视频发送 poster + contact sheet | 视频符合；图片读取源文件并 base64 | **图片路径偏离规格** |
| AI 不覆盖人工层、重新分析原子替换 | 独立表、事务替换、FTS 重同步测试 | 通过自动化 |
| macOS 打包/真实供应商与 Windows | 无证据 | **未验证** |

## 审查结论

队列可靠性、取消安全与去敏错误日志的高风险缺陷已经在 working tree 中得到实质修复，但规格完成度仍不足：完整队列 UI/事件闭环、并发 2、图片缩略图输入、正式密钥边界决策、真实供应商和跨平台 QA 均未完成。

因此 Standards 可进入最终复审，Spec 仍为 **未通过**；切片保持 **部分实现 / fixing**。
