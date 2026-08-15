# 2026-07-28：应用诊断日志与 AI 失败原因

## 目标

让 Main、Worker、媒体任务和 AI 分析共享一条可追溯的诊断链路：完整日志写入 `app.getPath("logs")/serpent.log`，用户可以在后台任务窗口或「设置 → 常规」查看近期诊断，并能区分安全的用户提示与开发调试细节。

## 实现

- `AppLogger` 继续使用结构化 JSONL 持久化；Worker 的结构化 stderr 会被 Main 解析为独立的 `scope`、`context` 和嵌套 `error/cause`，因此 AI 失败会保留错误码、供应商类别、HTTP 状态和原因链。
- 日志写入层统一脱敏 API Key、Bearer Token、查询参数凭据；应用内读取接口额外隐藏本机绝对路径。磁盘文件仍保留完整路径，便于开发定位。
- 新增 Main-owned `read-app-log` IPC，Renderer 只收到最近 500 条脱敏记录和固定文件名，不接触绝对路径。
- 「后台媒体任务」和「设置 → 常规」均提供「查看诊断日志」入口；支持刷新、显示日志文件、技术详情展开和 Escape 关闭。
- AI 连接测试失败也会写入 `ai.connection.test` 诊断，不再只返回 UI 摘要。

## 证据

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npx vitest run tests/unit/app-logger.test.ts tests/unit/dialog-escape-stack.test.ts`：13 tests passed。
- `node scripts/run-e2e.mjs tests/e2e/media-preview.test.ts`：2 passed、1 skipped；媒体失败场景验证了应用内诊断窗口包含 `worker.media-job.failed` 和 `FFMPEG_REQUIRED`，且不展示临时目录路径。跳过项是已有的历史视频预览修复场景。

## 人类验收

新增清单条目 `JOBS-011`，等待产品负责人确认入口位置、文案和实际 AI 失败信息是否足够清晰。
