# 2026-09-13 PERF2-01：读版本 / 提交回执协议与基线入口

> 工单：`Serpent-41426d`（`Serpent-e9a66b` 首项）  
> 规格：[交互性能第二阶段设计](../implementation/2026-09-13-interactive-performance-design.md) §3、4.3、10  
> 分支：`codex/performance-20260913`  
> 本单不实现读进程隔离、两阶段 BrowseSession、NAS 快照优化或文件夹局部投影。

## 1. 范围

向后兼容地补齐 `consumerId` / `catalogSequence` / `snapshotGeneration` / `minCatalogSequence` 与有界 `mutationReceipt`，并把计时相位（`input-ack` / `persist` / `ui-converge`）、broker 往返关联、可见图片解码分母写成可复用入口。Scheduler 仍不打断已开始的操作；本单用同步自旋 barrier 证明这一点，而不是只 `setTimeout`。

## 2. 实现

| 改动 | 位置 |
| --- | --- |
| 读版本、回执、计时相位、分位数与解码分母 | `src/shared/performance-contract.ts` |
| Main envelope 默认 `window:default`，generation 键含 consumerId | `src/main/library-request-broker.ts`、`src/main/worker-client.ts` |
| Worker latest-wins 键含 consumerId | `src/worker/interactive-scheduler.ts`、`src/worker/index.ts` |
| browse 响应带 `catalogSequence`；page/geometry/ids 在 `minCatalogSequence` 不足时 `browse.session.stale` / `catalog-sequence` | `src/worker/index.ts`、`src/shared/protocol/responses.ts` |
| `folder.create` 返回有界 `mutationReceipt` | `src/worker/bounded-write-command.ts`、preload / `library-api` |
| 20k 合集切换 persist 报告 p50/p95/max | `tests/worker/collection-switch-performance.test.ts` |
| 可选 SMB persist 基线（`SERPENT_PERF_SMB_ROOT`，缺省跳过；不打印挂载路径） | `tests/worker/perf2-01-smb-baseline.test.ts` |

## 3. 四列证据

| 需求 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 旧 envelope 可解析；非法 `minCatalogSequence` 失败；回执实体上限 256 | `performance-contract.ts`、`responses.ts` | `tests/unit/performance-v2-protocol.test.ts` | Windows 单测通过 |
| 窗口 consumer 互不取消 latest-wins | broker + scheduler `latestKey` | `performance-v2-protocol` / `interactive-scheduler` | Windows 单测通过 |
| 同步阻塞的已开始 mutation 不能被 browse 抢占 | `interactive-scheduler.ts` `nextRunnableIndex` | `interactive-scheduler`：`while (Date.now())` 自旋后再 `await`，browse 在 mutation 结束前 `browseStarted === false` | 当前代码能力为红：同线程无法打断已开始的同步工作。这是后续 PERF2-03 隔离读执行器的前提，不是本单要修的性能 |
| browse `catalogSequence` 与 stale `catalog-sequence` | Worker browse handlers | protocol 解析；`tests/worker/browse-session.test.ts` 既有 stale 路径 | 完整 Worker 消息未另测 `minCatalogSequence` 准入 |
| `folder.create` 回执 | `bounded-write-command.ts` | `tests/worker/bounded-write-command.test.ts` | Windows Electron worker 通过 |
| 20k 元数据合集切换 persist | 既有 20k SQL 夹具 | `collection-switch-performance`，见 §4 | 仅 Worker SQL persist，不是 UI 首屏或图片解码 |
| 真实 SMB persist | 可选基线测试 | `perf2-01-smb-baseline`，见 §4 | 已跑；挂载路径与库位置未写入仓库。临时目录计数 0 |
| 输入确认 / UI 收敛 / 可见图片全解码 / 20k 混合媒体夹具 / packaged / macOS | 未接线到 Renderer 绘制 | 未执行 | 未执行 |

## 4. 当次命令与结果

```
npx vitest run tests/unit/performance-v2-protocol.test.ts tests/unit/interactive-scheduler.test.ts tests/worker/bounded-write-command.test.ts
→ 3 files, 29 passed

npm run typecheck
→ exit 0

npx eslint <本单改动的 ts 文件>
→ exit 0

npm run test:library-availability
→ 9 files, 211 passed | 1 skipped（102.61s）

node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/browse-session.test.ts tests/worker/bounded-write-command.test.ts
→ passed

node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/collection-switch-performance.test.ts --disableConsoleIntercept
→ 1 passed（8.64s）
[collection-switch-performance] persist / 20000 assets / 5 samples:
  all p50 7.4 p95 8.1 max 8.1
  folder p50 8.2 p95 8.6 max 8.6
  direct p50 1.7 p95 1.8 max 1.8
  recursive p50 49.7 p95 50.2 max 50.2
  recursiveLayout p50 83.4 p95 88.7 max 88.7
recursive p50 < 500ms 断言通过。这是本机 SQLite persist，不能当成文件夹切换 500ms 产品预算已满足。

SERPENT_PERF_SMB_ROOT 指向本机已挂载 SMB 根（路径不记录）时：
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/perf2-01-smb-baseline.test.ts --disableConsoleIntercept
→ 1 passed
[perf2-01-smb] persist: createLibrary 1013.7ms；folderCreate p50 20.3 p95 22.5 max 22.5；searchAssets 4.1ms；liveAssetCount 0
清理后匹配本单前缀的临时目录计数为 0。
```

未设置 `SERPENT_PERF_SMB_ROOT` 时该文件 `describe.skip`，记未执行。

## 5. 明确未做

- 只读 UtilityProcess、两阶段 session、NAS 快照发布、创建后局部投影（PERF2-02 起）。
- Renderer 输入确认 / 绘制相位计时；跨进程只提供 `correlateBrokerRoundTrip` 与 envelope `sentAtEpochMs`。
- 真实 Electron 画布解码分母测量；`visibleImageDecodeCoverage` 只定义口径。
- 20k 混合可解码媒体夹具与 large-library Electron 滚动基准本轮未跑。
- packaged、macOS、Computer Use 未执行。
- 未关闭历史用户工单（`Serpent-3kfe` / `Serpent-sa65` 等）。

## 6. 下游接口

- 请求 envelope 可选：`consumerId`、`catalogSequence`、`snapshotGeneration`、`minCatalogSequence`。
- browse page/geometry/ids：版本不足 → `browse.session.stale` `reason: 'catalog-sequence'`。
- `folder.created.mutationReceipt.committedCatalogSequence` 来自 browse change sequence；`changes.folders` / `affectedFolderIds` 有界。
- 计时报告用 `summarizeTimingSamples`；解码覆盖用 `visibleImageDecodeCoverage`（分母是应显示图片数，不是已挂载 img）。
- 默认 consumer：`window:default`。
