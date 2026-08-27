# 2026-08-26 大型资源库性能架构阶段 A 开发日志

关联架构：[`0032-library-performance-architecture.md`](../implementation/0032-library-performance-architecture.md)

范围：阶段 A「统一指标与所有权」以及开库对账中违反 §7 文件系统/事务边界的首个真实热区。阶段 B 查看器状态机、阶段 C 浏览会话、阶段 D 媒体 artifact 策略和阶段 E watcher/文件操作仍未开始。

## 真实红灯与根因

先用仓库混合媒体夹具做冷对账，而不是把局部单测结果当作性能证据。首次 10,000 资产冷运行的结果是：

- `refresh.managed-assets` 的 compare loop 约 26.5 s；
- reconciliation 总耗时 32.0 s；
- Worker event-loop lag P95 286.9 ms、最大 549.7 ms；
- viewer resolve P95 2.6 ms，但受 Worker 长段影响，测试 gate 未通过。

插桩显示，`refreshManagedAssets` 在 SQLite transaction 内对每个 mtime 变化的源文件执行同步 SHA-1 全文件读取。夹具生成器写入的 revision 时间戳与源文件 mtime 不同，因此冷启动几乎所有资产都会进入该路径。它同时违反 0032 §7 的「hash 不得在事务内执行」和交互优先目标。

修复后再次测量时又发现尾部的同步 `quick_check(1)` 造成约 1.04 s 的单次 event-loop 峰值。该检查保留完整性语义，但改为当前 library generation 所有的延后维护定时器；打开对账 promise 和查看器首波不再等待它。随后又把同一 fingerprint preflight 边界扩展到 watcher/显式 refresh，避免非开库调用重新把 hash 放回事务。最后把让步点下沉到单文件 fingerprint 的分块内部；FileHandle 读取命中 OS cache 时也会按约 6 ms 调用 reconciliation yield，避免一个超大源文件连续占用 Worker 微任务队列。

## 实现与追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| Main 统一附加 lane、library generation、interaction generation 和 deadline | `src/shared/performance-contract.ts:3-239`、`src/main/library-request-broker.ts:14-89`、`src/main/worker-client.ts` | `tests/unit/interactive-scheduler.test.ts:14-85`、protocol/worker-client 定向回归 | macOS arm64 Worker/协议代码已测；Renderer/Main/Worker 真实窗口、Windows、packaged 未验证 |
| Worker 只在 handler 入口前丢弃过期 generation；mutation 不与其他工作同时进入 service | `src/worker/interactive-scheduler.ts:56-227`、`src/worker/index.ts:4260-4395` | `tests/unit/interactive-scheduler.test.ts:88-227` | 调度器单测通过；真实 Electron 混合负载未验证 |
| lifecycle 关闭/删除取消旧队列和可取消后台 owner；旧 reconciliation 不得触碰新 open handle | `src/worker/library-generation.ts`、`src/worker/index.ts:4270-4395`、`src/worker/library-service.ts:35000-35080` | `tests/worker/reconciliation-performance.test.ts:100-127`、`npm run test:library-availability` | macOS Worker lifecycle 通过；SMB/NAS、Windows、崩溃后真实进程重启未验证 |
| 文件枚举和 fingerprint 在 SQLite commit 事务外完成，且不把完整源文件读入内存 | `src/worker/library-service.ts:34986-35118`、`src/worker/library-service.ts:35521-36000` | `tests/worker/reconciliation-performance.test.ts:129-185` | 32 文件 portable-copy 回归证明 hash 期间无 SQL；10k 混合冷基准通过 |
| 完整 quick_check 不阻塞 reconciliation/viewer promise，关闭和换 generation 时定时器清理 | `src/worker/library-service.ts:35174-35218`、`src/worker/library-service.ts:23270-23338`、`src/worker/library-service.ts:38645-38663` | `tests/worker/reconciliation-performance.test.ts:100-127`、library availability 全套 | macOS arm64 通过；延后检查实际定时器在 Windows/NAS 未验证 |

四列中没有平台/人工证据的项只记为「未验证」，不把自动化通过写成人类验收通过。

## 基准结果

测试库为仓库混合 profile 的 **10,000 资产代理基线**；没有把它写成 20k。最终命令（`<fixture-path>` 是本地临时目录，不进入仓库）：

```bash
npm run test:perf:large-library -- <fixture-path>
```

最终 10k 冷运行结果（运行前将 10,000 个源文件的 mtime 统一移到未来时间，强制走冷 fingerprint 路径；先等待文件系统事件稳定 10 秒）：

| 指标 | 结果 | gate |
| --- | ---: | --- |
| reconciliation 总耗时 | 21,124.2 ms | 后台总耗时，不作为首屏阻塞门禁 |
| event-loop lag P95 / max | 1.2 / 55.7 ms | `<25 / <150`，本次通过 |
| viewer resolve P50 / P95 / max | 0.4 / 0.6 / 11.8 ms | P95 `<250`，通过 |
| live assets | 10,000 | 与打开前一致 |
| viewer samples | 836 | `>=3`，通过 |

对比修复前的冷红灯：reconciliation 32,042.8 ms、event-loop P95 286.9 ms、viewer P95 2.6 ms；最终总耗时下降约 34%，更重要的是不可让出的 event-loop 长段消失。修复后 stage 日志中单批 `compare-loop` 约亚毫秒到 1.5 ms 级，hash 总成本被移到可让出的异步阶段；把 open backup/quick_check 也移到空闲维护后，插桩复测的 event-loop max 为 49.8 ms，最终等待文件系统事件稳定后的复测为 55.7 ms。

为检查波动而不是只保留最好的一次：同一 10k 夹具在重新触发 mtime 变化后连续复测，首次紧接着大批量 `touch` 的运行出现一次 165.3 ms max、因此测试失败；随后带插桩运行 49.8 ms、无插桩运行 44.2 ms 和 118.5 ms 均通过。加入 hash 分块内部 yield 后，紧接着 `touch` 的复测又出现一次 155.5 ms max 红灯；等待文件系统事件稳定 10 秒后的最终复测为 55.7 ms 并通过。两次单次尖峰都保留在记录中，不能据此宣称跨平台或稳定性已经证明。

仓库要求的 **20,000 资产混合基线尚未执行**：本机磁盘在生成过程中不足，生成器报告 `ENOSPC`，预计该 profile 需要约 19 GB 以上临时空间；早期还发现仓库 bundled ffmpeg 不支持 `lavfi`，10k 复测使用了本机支持 `lavfi` 的 ffmpeg。不能用 10k 结果替代 20k、Windows、SMB/NAS 或 packaged 证据。

## 验证记录

- `npm run typecheck`：通过。
- `npx eslint src/worker/library-service.ts tests/worker/reconciliation-performance.test.ts`：通过；仅有 Babel 对超大源文件的 deoptimise 提示。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/reconciliation-performance.test.ts --disableConsoleIntercept`：5 tests passed；1,200 文件 event-loop P95 约 13 ms、最大约 17 ms。
- `node scripts/run-vitest-with-electron.mjs run tests/worker/database-recovery.test.ts tests/worker/reconciliation-performance.test.ts`：2 files / 15 tests passed；覆盖延后 backup 的节流语义和关闭取消。
- `npm run test:perf:large-library -- <fixture-path>`：最终等待文件系统事件稳定后的 1 file / 2 tests passed；重复运行中有 1 次 max 165.3 ms 红灯，详见上面的波动记录，不能写成所有重跑均通过。
- `npm run test:library-availability`：9 files / 199 tests passed。
- `npm run test:worker`：83 files passed、13 skipped；1,206 tests passed、20 skipped。
- `node scripts/run-e2e.mjs tests/e2e/asset-ingestion.test.ts tests/e2e/linked-folders.test.ts tests/e2e/context-menu.test.ts`：16 tests 中 11 通过、5 失败。5 个失败都在调用 `getByRole('button', { name: '主菜单' })` 时超时；当前 macOS Renderer 按现有 `AppSettingsEntry` 路径暴露「设置」而不是「主菜单」，且本轮没有 Renderer 改动。该结果记录为既有 E2E 选择器/平台不匹配，不能作为阶段 A 的绿色 Electron 验收证据。
- `npm run test:unit`：382 files passed、1 skipped；4 tests failed，均为当前机器/HEAD 环境门禁：bundled ffmpeg 不支持 `lavfi`、macOS `/private` 临时路径别名断言，以及测试构造的 7-byte native module 被 `verify-package` 正确拒绝；不是本轮性能代码失败，不能写成全量通过。
- 测试临时夹具、日志和数据库已删除；没有删除用户数据。

## 未完成与下一步

阶段 A 的 Worker/Main 请求所有权、generation 取消、lane admission、诊断 span 和对账事务边界已落地，但本阶段不标记整个 0032 完成。下一顺序应进入阶段 B：先收敛查看器 session/cancel、placeholder/source 升级和 Main artifact path LRU 的 generation/revision 失效，再用真实解码 Electron E2E 验证。Windows、真实 NAS/SMB、packaged 和 Computer Use 仍必须独立取证。
