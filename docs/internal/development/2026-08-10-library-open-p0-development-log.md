# 资源库无法打开 P0 修复开发日志

日期：2026-08-10  
工单：`Serpent-o2qe`

## 根因

`LibraryWorkerClient` 的通用 Worker 响应解析没有把带 `requestId` 的
`model-thumbnail.render-request` 事件识别为 Worker → Main 请求。模型目录中存在
无扩展名的 companion 文件时，`model-resolution.ts` 将其编码为 `extension: ""`；
这违反了 `model-thumbnail` IPC 协议的非空扩展名约束。Main 随后把这条事件当成
malformed response，主动终止 Worker。Worker 一旦退出，所有后续资源库请求都会变成
`Library Worker is unavailable`，表现为任何资源库都打不开、创建或导入也失败。

## 修复

- `src/worker/model-resolution.ts`：过滤无扩展名 companion，避免产生不符合协议的
  纹理/材质索引；相对路径仍保持 POSIX 规范化，适用于 Windows 资源库路径。
- `src/main/worker-client.ts`：对意外的 malformed model-thumbnail 请求记录可诊断日志，
  回传 typed `MODEL_LOAD_FAILED`，不再把单个缩略图请求错误升级为 Worker 进程故障。
- `tests/worker/model-pipeline.test.ts`：加入无扩展名 companion 回归场景。
- `tests/unit/worker-client.test.ts`：加入“malformed model render event 不杀 Worker”回归。

## 自动化证据

当次执行：

- `npx vitest run --config vitest.config.ts tests/worker/model-pipeline.test.ts tests/unit/worker-client.test.ts tests/unit/model-thumbnail-protocol.test.ts`：3 个文件、30/30 通过。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `git diff --check`：通过。
- `node scripts/run-e2e.mjs tests/e2e/library-lifecycle.test.ts tests/e2e/process-lifecycle.test.ts tests/e2e/model-thumbnail.test.ts`：资源库创建/关闭/重开与进程生命周期通过；完整结果为 4 passed、6 failed、1 skipped。失败包括重启后资产聚焦断言和 5 个模型缩略图解码超时，因此不能把该组 E2E 写成全绿；模型缩略图问题需另行定位。

## 真实开发实例验证

使用当前 `npm start` 实例和 Computer Use 操作 UI：

1. 打开资源库切换器，选择 `参考资源库`，界面显示当前库为参考资源库、状态为已打开、61 项资产。
2. 再选择 `meme资源库`，界面显示当前库为 meme资源库、状态为已打开、2731 项资产。
3. 2026-08-10 11:39 UTC 重启后的日志出现新的 `worker.spawn` / `worker.boot`，之后没有新的 `worker.protocol` 或 Worker 异常退出记录；此前的 `worker.model-thumbnail.invalid-request` 仅出现在修复前实例。

随后为排除 E2E 产物覆盖开发构建，又完整重启 `npm start`。最终窗口 URL 为
`http://localhost:5173/`；恢复 `meme资源库` 后显示 2731 项，切换到
`参考资源库` 后显示 61 项，再切回 meme 库仍显示 2731 项。该次重启对应
`worker.spawn`/`worker.boot` 为 11:50:16 UTC，之后未出现新的 `worker.protocol`
或 `worker.exit` 记录。

创建新库、文件夹导入和 Windows packaged 旅程未在本次真实 UI 验证中单独完成，工单保持开放，等待完整验收。

## Windows 评估

本修复不依赖 `path.sep`，companion 查询使用库内已规范化的 POSIX 相对路径；
Worker/Main 的消息字段和 failure response 也没有平台分支。代码级上未发现 Windows 专属回归，
但当前环境没有 Windows runner/实机，因此 Windows packaged、原生路径和进程生命周期仍为未验证，
不能据 macOS 证据宣称 Windows 通过。
