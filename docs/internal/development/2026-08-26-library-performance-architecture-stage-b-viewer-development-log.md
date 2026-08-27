# 2026-08-26 大型资源库性能架构阶段 B 开发日志：查看器 session 与 artifact path

关联架构：[`0032-library-performance-architecture.md`](../implementation/0032-library-performance-architecture.md)

本次继续阶段 B，先完成查看器 session/cancel，再完成 Main artifact path LRU 的 generation fence。阶段 C 浏览会话、阶段 D artifact admission/policy 和阶段 E watcher/文件操作仍未开始。

## 根因

查看器原来把多个异步生命周期分散在组件内：preview IPC 用一个递增序号，视频代理回退另有 guard，PDF loading/render effect 各自维护 `cancelled` 标志，轮询又由独立 timer 管理。它们只能阻止一部分旧结果写状态，不能共同拥有一个 `assetId + revisionId` 的 session；revision 在同一组件实例内变化时也没有统一地清空旧 `resolution`。这使快速切换、关闭或源 revision 变化时存在旧图、旧 PDF 页或旧代理状态回写新 surface 的风险。

Main 的 artifact path 缓存也只是裸 `Map + library epoch`。LRU 逻辑、批次回写 fence 和逐 artifact 删除散落在 `index.ts`，无法单独验证；批次等待期间发生 close/reopen 时，旧完成结果只能依靠调用方记住 epoch，且原始 key 删除容易与 usage 语义重复。

## 实现与追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 一个查看器 session 绑定 library、asset、revision，并统一拥有 request/task/timer 取消 | `src/renderer/viewer/viewer-session-controller.ts`、`src/renderer/AssetPreviewModal.tsx` | `tests/unit/viewer-session-controller.test.ts` 5 tests | macOS arm64 真实 Electron PDF/HTML/媒体路径已执行；Windows、SMB/NAS、packaged、Computer Use 未验证 |
| preview 结果必须通过 session + latest request fence；快速关闭不得回写旧 surface | `AssetPreviewModal.tsx` 的 `resolvePreview`、`requestClose`、proxy fallback | controller request/task 单测；`media-preview.test.ts` 真实媒体解码 | 6 个查看器 Electron E2E 通过；快速切换/关闭的人工视觉仍待验收 |
| PDF Range、loading task、页面 render 在 session abort 时停止，且保留 placeholder/原位替换语义 | `src/renderer/PdfViewerSurface.tsx` | `tests/e2e/document-preview.test.ts` | PDF/HTML E2E 4 passed；单独 zoom 测试在修正“等待新 bitmap”后通过；真实 NAS 首次/二次打开未验证 |
| Main artifact path 使用有界 LRU，generation 变化禁止旧 entry/旧批次回写 | `src/main/artifact-path-cache.ts`、`src/main/index.ts` 的 `resolveArtifactPathBatched` | `tests/unit/artifact-path-cache.test.ts` 4 tests | Main/Worker 真实路径通过查看器 E2E 间接执行；artifact path 缓存 hit/miss 生产诊断尚未补齐 |
| 单 artifact 可精确失效，不影响其他 usage/库；缓存失效不绕过授权 | `ArtifactPathCache.invalidateArtifact`、serpent protocol 读失败路径 | `tests/unit/artifact-path-cache.test.ts` | 协议不把绝对路径交给 Renderer；Windows/NAS 权限和断线场景未验证 |

没有把自动化通过写成人类验收通过；平台/人工列仍保留未验证项。

## 验证记录

- `npm run typecheck`：通过。
- `npm run test:library-availability`：通过，9 files / 199 tests passed；覆盖本次 Main artifact path/Lifecycle 相关改动后的资源库打开、迁移、恢复、写入和关闭重开底线。
- `npx vitest run --config vitest.config.ts tests/unit/artifact-path-cache.test.ts tests/unit/viewer-session-controller.test.ts tests/unit/source-path-cache.test.ts`：3 files / 11 tests passed。
- 改动文件 ESLint（`artifact-path-cache.ts`、`index.ts`、查看器文件、两个新测试、PDF E2E）：通过。
- `git diff --check`：通过。
- `node scripts/run-e2e.mjs tests/e2e/document-preview.test.ts tests/e2e/media-preview.test.ts`：6 passed、1 skipped。覆盖 PDF 首页/多页、HTML iframe、PDF zoom/pan、图片真实解码、视频代理失败诊断；跳过项是完整进程重启后的历史视频修复路径。
- 首次同命令运行中 PDF zoom 的即时分辨率断言出现 0.8（目标 0.95），根因是现有 progressive zoom 在新 canvas 完成前保留旧 canvas；没有放宽清晰度门槛，改为等待实际 canvas bitmap 达标（3 秒），重跑 zoom 单测通过，随后完整 document/media 套件 6 passed、1 skipped。
- 本轮没有重新宣称 20k/100k、Windows、SMB/NAS 或 packaged 性能通过；阶段 A 的 10k/20k 限制继续以阶段 A 日志为准。

## 下一步

阶段 B 的 session owner 和 artifact path generation fence 已落地，但尚未标记阶段 B 完成。下一步继续实现 §10 的 artifact policy/admission：按 role/revision/generator key 去重，原生可播视频不预生成 proxy，非视觉资产不进入 palette，并为同 key single-flight、ready/failed cache 和 generator-version invalidation 建立真实 Worker 基准与测试。
