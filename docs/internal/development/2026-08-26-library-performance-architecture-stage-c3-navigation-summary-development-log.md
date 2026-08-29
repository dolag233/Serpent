# 2026-08-26 大型资源库性能架构阶段 C.3 开发日志：导航摘要与集合会话

关联架构：[`0032-library-performance-architecture.md`](../implementation/0032-library-performance-architecture.md)  关联工单：`Serpent-3kfe`、`Serpent-6355d7`

## 根因

侧栏文件夹、链接文件夹、合集、smart collection、回收站和计数原本容易与画布首屏
共享一次重查询。合集切换还可能重新构建递归 membership；在大库或 NAS 上，侧栏
先完成会让用户感觉整个主窗口没有响应。

本阶段将导航数据收敛为 `LibraryNavigationSummary`，按 broad browse change sequence、
可见性选项和回收站状态做 Worker 端缓存。画布首屏先走 BrowseSession，侧栏随后
hydration；smart collection 和普通 collection 复用同一 session/ID 快照。

本轮性能收口还处理了两个实际阻塞点：导航摘要的递归合集/文件夹统计使用窄 `COUNT(*)`
查询，不再为侧栏计数构造首屏资产和 artifact 元数据；Worker 在摘要各同步阶段之间使用
timer checkpoint，让 UtilityProcess 的消息 poll 阶段先处理已经到达的浏览分页请求。Renderer
在首屏 paint 后等待画布保持 1 秒无滚动才启动侧栏 hydration，并在新导航代际开始前丢弃旧的
hydration，避免用户刚开始拖动滚动条时被侧栏工作抢占。

## 实现与四列追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 文件夹/链接文件夹/合集/smart collection/trash 一次摘要返回 | `src/shared/library-navigation.ts`；`src/worker/library-service.ts` navigation summary cache | `tests/worker/browse-session.test.ts`；`tests/worker/large-library-performance.test.ts` | macOS Worker 合成大库路径通过；真实 NAS/Windows 未验证 |
| 侧栏不抢在画布前执行 | `src/renderer/App.tsx` progressive browse/session hydration | `tests/e2e/asset-pagination.test.ts`、`organization-search-trash.test.ts` | 当前 macOS Electron 10 项相关旅程通过；Computer Use/packaged 未执行 |
| 合集/智能合集首屏复用稳定排序和 session | `App.tsx` smart collection session wiring；`src/shared/library-api.ts` browse session API | `tests/worker/browse-session.test.ts`；`tests/e2e/asset-pagination.test.ts` | Worker/真实 Electron 定向证据通过；大规模人工切换未执行 |

## 验证记录

- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/browse-session.test.ts tests/worker/large-library-performance.test.ts`：当前定向路径通过（完整大库 fixture 的外部空间/媒体条件仍按单独基准记录）。
- `node scripts/run-e2e.mjs tests/e2e/asset-pagination.test.ts tests/e2e/organization-search-trash.test.ts tests/e2e/browsing-preferences.test.ts`：10 passed。
- `npm run test:library-availability`：9 files / 203 tests passed。
- 当前 HEAD 的真实 Electron 20,000 资产滚动门禁（本地 APFS fixture，第四档卡片，10 个随机跳转）：
  使用 `SERPENT_LARGE_LIBRARY_E2E_REUSE_LIBRARY=<20k-local-library>`
  `SERPENT_LARGE_LIBRARY_E2E_MIN_ASSETS=20000 npm run test:e2e:large-library-benchmark -- <20k-fixture>`，
  以独立 `SERPENT_LARGE_LIBRARY_E2E_USER_DATA_PATH` 重复两次均为 10/10：第一次 P50 162.3 ms、
  P95/Max 315.9 ms，第二次 P50 156.6 ms、P95/Max 308.4 ms；20 个样本均 `longTaskCount=0`，
  分页请求最大相对解决时间分别为 260.7 ms 和 283.8 ms。该结果证明当前本地 20k 组合路径已
  达到 500 ms 目标，不能外推为 Windows、NAS/SMB、packaged 或人工视觉验收。
- 没有把 Worker 合成耗时或当前 Electron 定向通过写成 20k/100k、NAS/SMB 或 Windows 验收通过。

## 未完成

C.3 的数据形状、缓存、渐进接线和本地 20k 组合基准已完成；完整阶段仍依赖真实合集/
智能合集人工路径、100k、网络盘、Windows、packaged 和 Computer Use 证据。`Serpent-3kfe`
继续保持 in_progress。

## 基准口径更正（2026-08-26）

本日志前面的 20k 两次 10/10 使用了旧版图片分母，只统计已有 `<img>` 的卡片，遗漏了
尚未挂载图片元素但仍属于可见图片的卡片；该结果撤回，不作为 500ms 门禁通过。修正后的
默认严格模式一次跳转为 0/1，first-wave 十次跳转为 9/10（P50 167.1ms、P95/Max
555.9ms），只有 4/10 在观察窗口内完成全部图片。导航摘要/分页本身的定向证据仍有效，
但不能用旧 benchmark 数字替代媒体尾延迟验收；`Serpent-3kfe` 继续保持 `in_progress`。
