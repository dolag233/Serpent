# 切片 0009 开发日志：云端 AI 自动分类（BYOK）

> 状态：部分实现 / fixing
> 开始：依据 2026-07-13 提交与 working tree 事后重建
> 最后更新：2026-07-13
> 记录来源：**流程偏差**——实现先于本文完成；本文由规格、源码、测试与本轮修复记录重建，不是同步维护的开发日志。

## 参考范围

- 规格：`docs/implementation/0009-cloud-ai-auto-classification-vertical-slice.md`
- 原始独立审查范围：`8dc2470...cdc2247`
- 可靠性复审范围：2026-07-13 当前未提交 working tree
- 依赖：切片 0004 的人工/AI 元信息分层，切片 0005 的 FTS 同步，切片 0006 的视频 poster/contact sheet。

## 已实现主线

- schema v8 新增 `ai_content`，schema v10 扩展 `jobs` 的 `ai.image.analysis` / `ai.video.analysis` kind；AI 标签继续使用独立的 `ai_asset_tags`，不覆盖人工标签关系。
- OpenAI、Gemini、Anthropic 三个适配器通过统一请求/结果接口处理图片或视频多图输入、结构化输出与供应商错误分类；OpenAI strict JSON schema 和 Gemini `propertyOrdering` 已按各自契约修正。
- 重新分析在单一事务中替换已启用的 AI 字段和 AI 标签。即使新响应省略字段或返回空标签，旧 AI 值也不会残留；人工 `AssetMetadata` 与 `human_asset_tags` 不被删除。
- Main 用 Electron `safeStorage` 加密 API Key 并把密文保存到用户数据目录；配置响应只返回 `hasKey`，Renderer 不接收已存 Key。免责声明、自动分析开关、字段开关和 BYOK 设置 UI 已存在。
- 托管文件导入与链接文件夹导入均可按配置自动入队；视频仅在 poster 与 contact sheet 均 ready 时入队。Worker 打开资源库时把中断的 running job 恢复为 queued。
- 支持 enqueue、pause、resume、cancel、retry、clear AI content 与 job 状态查询的协议/服务层；直接单资产分析入口也已接通。

## 2026-07-13 队列可靠性修复

- Main 新增 `AiQueueScheduler`：每批最多 20 项，满批后继续自排空；可重试项按 1 秒起步、30 秒封顶的指数退避重新触发，避免只处理首批或紧循环轰击供应商。
- Worker 为 running job 注册 `AbortController`，三个供应商适配器都接收并向 `fetch` 传递 `AbortSignal`。暂停、取消和 Worker shutdown 会中止匹配的活动请求。
- AI 结果事务新增 `guardJobId`：写入前必须确认 job 仍为 running；请求完成后还会再次检查 signal/job 状态，防止暂停或取消后的迟到响应写回 AI 内容。
- 可重试失败只把安全错误码持久化到 job；网络、超时和限流最多尝试三次（首次 + 两次重试），认证、权限、额度、无效响应直接失败。用户可见原因细分为 `AI_AUTH`、`AI_PERMISSION`、`AI_QUOTA`、`AI_RATE_LIMIT`、`AI_NETWORK`、`AI_TIMEOUT`、`AI_INVALID_RESPONSE`。
- Worker `onDiagnostic` 将去敏诊断写到 stderr，由 Main 持久应用日志接收；日志保留安全分类、供应商错误类型、HTTP 状态与系统错误码，同时遮蔽 API Key、Bearer、URL 查询凭据、base64 资产内容和原始响应体。

## 密钥边界与规格偏差

- 磁盘上仍只有 `safeStorage` 密文；Main 在发起分析时解密，并通过受 Zod 校验的私有 Main→Worker command 传递明文 Key。该明文不会返回 Renderer，也不写数据库或日志。
- 这与规格中“Worker 通过 `ai.configure` 解密并只在 Worker 内存缓存”的描述不同：当前 `ai.configure` 仅确认配置，测试连接在 Worker 解密临时密文，而正式分析由 Main 解密。是否接受此边界需要架构复审；未复审前不能宣称完全符合规格。

## 阶段验证记录

- 2026-07-13 最终执行：unit **139/139**、Worker **408/408**、Electron E2E **10/10**；lint/typecheck 通过。
- package、ASAR/native verify 与 packaged startup/import E2E **1/1** 通过。
- 所有供应商调用均由 mock `fetch` 验证；没有使用真实 API Key 或真实供应商端点。

## 未完成范围

- Renderer 未提供完整队列面板、计数进度、暂停/继续/取消/重试/按范围分析/清空入口；Preload/WorkerClient 虽定义 AI 事件订阅，Main 与 Renderer 尚未完成事件发布/消费闭环。
- 当前 queue batch 在单个 Worker 内顺序消费，尚未实现规格要求的“同供应商默认最大并发 2”调度。
- 没有 macOS 打包后真实供应商冒烟、费用/限流实测、长任务暂停/取消人工 QA，也没有 Windows 验证。
- 图片正式分析读取原文件字节，而规格描述发送缩略图；大图请求体、格式兼容与成本上限需要补齐决策和测试。
- 模型清单、第三方 API 版本与真实结构化输出兼容性只由 mock 契约证明，不能推断线上可用。

切片保持 **部分实现 / fixing**，不得标记 accepted。
