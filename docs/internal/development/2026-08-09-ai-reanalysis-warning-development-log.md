# AI 重复分析与失败提示分级开发记录

日期：2026-08-09  
工单：`Serpent-bjys`

## 根因

`ai.enqueue-analysis` 原本同时服务自动扫描和手动「AI 分析」。它会跳过已有
`ai_content` 的资产；当手动操作的全部资产都被跳过时，Main 因没有返回 job ID
把这次合法的幂等操作转换成 `AI_ANALYSIS_FAILED`，Renderer 又按错误/阻塞错误提示。

## 修改

- 手动单资产/批量分析传入 `forceExisting`，允许重新排队并替换旧的 AI 结果；
  自动分析和“未分析项”扫描不传该参数，仍然去重跳过已有结果。
- `assets.analyze-queued` 允许 `jobIds: []`，因此全量跳过是成功响应；界面显示“已
  跳过（已有分析结果）”，不再显示失败。
- 分析启动、队列完成和单项失败都改用 warning toast；失败原因通过已有错误码本地化
  显示，兜底文案也包含简短原因。

## 定向验证

- `npm run typecheck`：通过。
- `npx vitest run --config vitest.config.ts tests/unit/protocol.test.ts tests/unit/ai-analyze-progress.test.ts`：83 项通过。
- `tests/worker/ai-completion.test.ts` 已补充“已有结果默认跳过、手动 forceExisting 可重新入队”覆盖；首次运行被打包流程留下的 better-sqlite3 ABI 148 阻断，执行 `npm rebuild better-sqlite3` 对齐当前 Node ABI 137 后，47 项 Worker 测试通过。

## 待人类验收

在配置好 AI 的资源库中：

1. 对已有 AI 描述/标签/评分的资产再次执行「AI 分析」，应重新入队并完成，不出现失败提示。
2. 对已有结果的资产执行“AI 分析未分析项”或等待自动分析，不应重复创建任务；若被跳过，提示应为 warning 且说明“已有分析结果”。
3. 制造一次真实 AI 网络/权限/输入失败，提示应为 warning，并包含简短原因，不弹阻塞错误对话框。
