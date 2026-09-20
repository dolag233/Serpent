# 2026-09-20 AI 分析进度条一直停在 0

> 工单：`Serpent-f01d8e`  
> 状态：实现完成，待人类验收  
> 分支：`dev`

## 现象

AI 分析相关弹窗通过后，用户反馈工作区顶部进度条永远是 0。分析其实在跑，结束时横幅才消失或弹出失败窗。

## 根因

横幅的 `done/total` 只来自 `getAiJobStatus({ jobIds })`，也就是 Worker 的 `ai.status`。`ai.status` 和整批 `ai.process-queue` 同属 `background-secondary`：队列还在跑时，状态查询进不了 Worker。

与此同时 Worker 已经在每项任务变化时发出 `ai.progress`。Renderer 只用这些事件更新队列计数，然后**再去打被堵住的 status**。所以分析全程横幅停在开始时的 `0/N`。

这不是计算函数把 running 算成 0 的显示问题。开始为 `0/N` 仍是产品口径；问题是完成一项之后数字也不动。

## 修复

- `ai.progress` 带上本秒变更的 job 状态；节流器合并同一秒内的多项，而不是只留最后一条。
- 横幅按这些事件更新当前批次，不再在每条进度事件上打 `ai.status`。
- 若某次事件还没有本批次的 job 明细，才退回用计数差估算。

## 命令

| 命令 | 结果 |
| --- | --- |
| `npx vitest run --config vitest.config.ts tests/unit/ai-analyze-progress.test.ts tests/unit/ai-provider-runtime.test.ts tests/unit/protocol.test.ts` | 3 files / 137 passed |

未跑 `verify:mainline` / packaged / Computer Use。

## 验收

清单 `JOBS-004-LIVE`。原 `JOBS-004` 记为人类验收不通过。
