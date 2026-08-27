# 2026-08-26 大型资源库性能架构阶段 C.1 开发日志：BrowseSession 稳定快照

关联架构：[`0032-library-performance-architecture.md`](../implementation/0032-library-performance-architecture.md)  关联工单：`Serpent-3kfe`、`Serpent-9e1d8d`

## 目标与根因

原有大范围浏览在每一个分页请求中重新执行 COUNT、过滤和排序。对本地盘这会把
一次拖动放大成很多 SQL；对 NAS 则会重复付冷索引页的网络往返。与此同时，后台
缩略图、artifact 写入也会推进原先过宽的全库 change sequence，导致 Renderer 刚拿到
分页就被判 stale，反复重试反而制造更多负载。

本阶段把一次导航定义为 Worker 所有的稳定有序 asset-id 快照。摘要页、几何块、全量
选择 ID 都引用同一快照；快照同时携带 library generation、窄 browse change sequence
和查询 fingerprint。媒体 job 或 artifact 状态变化不会再无条件使浏览快照失效。

## 实现与四列追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 相同 BrowseSession 的分页复用稳定顺序，不重复 COUNT/全范围排序 | `src/worker/browse-session-store.ts`；`src/worker/library-service.ts` 的 `createBrowseSession` / `readBrowseSessionPage` | `tests/worker/browse-session.test.ts`；`tests/unit/browse-session-store.test.ts` | macOS arm64 Worker 定向 105 项通过；真实 NAS、Windows、packaged 未验证 |
| 由 library generation 与窄 browse change sequence 组成 stale fence | `src/worker/library-service.ts` v45 `browse_change_sequence` 触发器；`getBrowseChangeSequence`；browse protocol | `tests/worker/browse-session.test.ts`；`tests/worker/migration-discipline.test.ts`；`tests/worker/migration-checksum-snapshot.test.ts` | v45 迁移/旧库可写回归通过；跨实例 NAS 实测未验证 |
| 页面、几何、assetIds 使用同一快照 | `src/shared/protocol/requests.ts`、`responses.ts`、`library-api.ts`；`src/preload/index.ts`；`src/renderer/use-browse-pagination.ts` | `tests/unit/protocol.test.ts`；`tests/worker/browse-session.test.ts`；`tests/e2e/asset-pagination.test.ts` | 当前 macOS Electron 分页/组织旅程通过；Windows、packaged、Computer Use 未执行 |

## 设计细节

- `BrowseSessionStore` 只保存有界的有序 ID 快照，不把完整 `AssetSummary` 常驻
  Renderer。Worker 端是 LRU，关闭库或 generation 变化时局部清理。
- v45 的 browse sequence 只由会影响可见浏览结果的表推进；`jobs`、artifact 状态等
  后台变化不再让当前浏览页全部失效。真正的资产、目录、标签、合集和忽略规则变更
  仍会使 session stale，由下一次导航建立新快照。
- `searchAssets` 的 `sessionAssetIds` 分页读取只获取当前页摘要；`readBrowseSessionGeometry`
  读取同一序列上的轻量 width/height/artifact 几何；select-all 直接取同一 ID 快照。
- 首次加载先交付画布主请求，导航侧栏和 smart collection 通过后续 summary hydration，
  避免侧栏 COUNT 抢占首屏。

## 验证记录

- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/virtual-browse-session.test.ts tests/unit/protocol.test.ts tests/worker/browse-session.test.ts`：3 files / 105 tests passed。
- `node scripts/run-e2e.mjs tests/e2e/asset-pagination.test.ts tests/e2e/organization-search-trash.test.ts tests/e2e/browsing-preferences.test.ts`：真实 Electron 10 passed。
- `npm run test:library-availability`：9 files / 203 tests passed（当前工作树独立复跑）。
- `npm run typecheck`、受影响文件 ESLint、`git diff --check`：通过。
- 大库滚动基准证明了页请求已不再连续 stale：当前 geometry 运行的单页 issue→resolve 为约 13–121ms；但可见缩略图冷尾仍未达 500ms，不能把 C.1 写成整体验收通过。

## 未完成

C.1 的稳定快照与窄失效链路已具备自动化证据，但 20k/100k、真实 NAS、Windows、
packaged 和人工滚动验收仍未完成。完整大库门禁继续由 `Serpent-sa65` 维护，不能用
历史 warm 运行替代当前 HEAD 的冷运行。
