# 查看器打开延迟：源请求与忽略资产（2026-08-23）

## 范围

本次针对 `Serpent-29125f`，重点核对「赛博配料表」中的：

- `GDC-2026-Slides-Summary.md`
- `Game Career Seminar Tracing the Roots Exploring the Skill System Design of Shooting Games.pdf`
- `光线追踪vs光栅化.mp4`

用户补充说明：该资源库数据库有 8,863 条记录，但忽略目录后实际可见资产约 1,235 条。本记录不把数据库总量当作用户视图规模。

## 证据与定位

- 三个目标资产当前均为 linked 资产，源文件可读；PDF 已有 ready thumbnail，MP4 已有 ready video poster/metadata/palette，打开时不应等待这些派生物。
- 历史日志 `serpent-20260823T134137.log` 记录过 Worker 请求超时及随后迟到响应，且同一查看器会为 PDF/视频发起多个 `serpent://source` 请求。
- 媒体插件调度在无适用 provider 时曾先递归请求 `asset.list`，即使资源库只有 1,235 个可见资产也会把查看器打开变成一次全量物化；当前全局 Image Upscaler 没有媒体 provider。
- 开库后台索引预热与派生文件对账原先仍包含被忽略资产，可能在 SMB 上与查看器 Worker 请求争用 I/O。

## 本次实现

- `PluginProviderScheduler` 先筛选适用 provider；没有 provider 时直接回退，不再递归枚举资产。
- Worker 在媒体预览、文本读取和源路径请求到达时记录交互活动，并中断视口外的旧视觉解码任务，让双击请求优先获得调度机会。
- `serpent://source` 在 Main 进程按 `libraryId + assetId + revisionId` 缓存并合并源路径查询；路径不离开 Main，源文件变化、读取失败或资源库关闭时失效。
- 开库后台对账、索引预热和 ready 派生文件核对都跳过忽略资产，避免把隐藏目录重新带入源文件 stat 和派生物扫描。
- 通过 `SERPENT_VIEWER_TIMING_LOG=1` 可记录 preview Worker 往返和 source lookup/stream-ready 耗时；现有 `SERPENT_WORKER_CMD_LOG=1` 继续提供 Worker wait/run 分解。

## 验证

当次执行结果：

- `npm run typecheck`：通过。
- `npx vitest run tests/unit/plugin-provider-scheduler.test.ts tests/unit/source-path-cache.test.ts`：15 tests 通过。
- `npx vitest run tests/worker/media-ignore-scheduling.test.ts`：4 tests 通过，确认忽略目录不会在开库对账中触发源文件 stat。
- `npm run test:library-availability`：9 个文件，198 tests 通过，1 个跳过。

尚未在用户的 Windows/NAS 环境完成双击三文件的人工计时，因此工单保持进行中；下一步应使用门控日志对比首次打开、第二次打开及后台任务运行时的各阶段耗时。
