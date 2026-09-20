# 2026-09-20 AI 失败阻塞窗多余分割线与限流误写

> 工单：`Serpent-c7d64e`  
> 状态：实现完成，待人类验收  
> 分支：`dev`

## 现象

用户没有测僵尸句柄修复（`Serpent-1cf203`），却弹出「AI 分析失败」阻塞窗：标题下多一条空分割线，正文写「多次重试后仍无法连接 AI 供应商（已失败 23 项）」。

这不是上一轮的 SQLite 句柄已关。同一次应用日志里，该波分析失败全部是 `AI_RATE_LIMIT`（HTTP 429）。Worker 按连接类错误自动重试耗尽后，Renderer 打开 `Serpent-kdnm` 的 Retry/Abort 窗。默认并发上限是 16，短时间打满供应商配额就会走到这条路径。

## 根因

1. **样式**：`AiConnectionFailureDialog` 把正文放进 `DialogShell` 的 `description`（header 自带底边框），把按钮放进 content 里的 `.dialog-actions`（自带顶边框）。两条线叠在一起，中间还隔着 DialogShell content 的内边距，看起来像多了一条无效分割线。其它阻塞提示走的是 `FatalAlertDialog`（`create-dialog` + `dialog-heading` + `dialog-body-copy` + `dialog-actions`），只有按钮上方一条线。
2. **文案**：连接类闸门把 `AI_RATE_LIMIT` 和 `AI_NETWORK` 放在同一组，但正文只有「无法连接供应商」一种说法。限流被说成断网。

## 修复

- 对话框复用 `FatalAlertDialog`，不再套 `DialogShell`。
- 闸门记下这一波的主导错误码；正文按限流 / 认证 / 超时 / 连不上分开写。限流说明可稍后重试、终止剩余任务，或在设置里降低并发上限。

未改默认并发上限，也未改 429 后的自动重试次数。那些是设置项与队列策略，不是这次窗体错误的原因。

## 命令

| 命令 | 结果 |
| --- | --- |
| `npx vitest run --config vitest.config.ts tests/unit/ai-connection-failure.test.ts tests/unit/ai-connection-failure-dialog.test.ts` | 2 files / 11 passed |

未跑 `verify:mainline` / packaged / Computer Use。

## 验收

清单 `JOBS-006-UI`。原 `JOBS-006` 记为人类验收不通过。
