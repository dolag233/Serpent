# 2026-08-15 大型资源库性能与稳定性收口

关联工单：`Serpent-q3pg`、`Serpent-wq5h`、`Serpent-xtto`、`Serpent-xv0j`、`Serpent-6q9x`、`Serpent-a6zl`、`Serpent-h00q`。`Serpent-x710`（删除后画布刷新卡顿）明确不在本次范围内。

## 变更与四列证据

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 10,000 资产可重复测试库 | `tests/worker/large-library-fixture.ts`、`scripts/generate-large-library.mjs` | `npm run large-library:generate -- --output /tmp/serpent-large-library --assets 10000 --reset`；重复生成幂等；`npm run test:perf:large-library -- /tmp/serpent-large-library` 通过 | macOS Worker 基线已执行；真实媒体视觉和 Windows 未执行 |
| 浏览/搜索/Inspector 基线 | `tests/worker/large-library-performance.test.ts` | 启动、文件夹切换、固定词搜索、Inspector 读取均有 5 秒 sanity gate；删除刷新故意不测 | 不能据此宣称达到产品目标预算；`Serpent-x710` 未执行 |
| 导航减少重复侧栏 IPC、文件夹递归计数降阶 | `src/renderer/App.tsx`、`src/worker/library-service.ts` | `tests/worker/organization.test.ts`；导入/重命名 Electron E2E；`tests/e2e/library-recent.test.ts` 切库解码用例 | macOS 开发态 Electron 通过；Computer Use、packaged、Windows 未执行 |
| 切库不复用旧库预览与 Inspector 状态 | `src/renderer/use-asset-card-hover-preview.ts`、`src/renderer/asset-card-hover-preview.ts`、`src/renderer/App.tsx`、`src/renderer/InspectorPanel.tsx` | `asset-card-hover-preview`、`renderer-library-lifecycle-sync`、Inspector progressive summary 单测；切库后图片 `naturalWidth > 0` E2E 通过 | 真实视觉检查未执行，保留“待人类验收” |
| Inspector 先展示轻字段，重元数据渐进补齐 | `src/renderer/inspector-progressive-summary.ts`、`src/renderer/InspectorPanel.tsx` | progressive summary 单测；`organization-metadata-persistence` Inspector 切换 E2E 通过 | 3 秒体感问题的真实大库计时未执行 |
| 查看器占位图无探针重复解码，原图完成后再切层 | `src/renderer/zoomable-preview-image.tsx`、`src/renderer/styles.css` | `viewer-mip-upgrade`/preview policy 单测；`media-preview` 解码 E2E 通过；相关 locator 已同步到可见层 | Computer Use、packaged、Windows 未执行 |

## 关键回归与修复

`Serpent-xfnu` 的 Worker latest-search 协调最初按资源库整体去重，会误取消同一次 `loadContent` 并行发出的当前页、全库计数和回收站计数请求，表现为导入成功但画布显示 0 项。现改为按“范围/筛选/排序/分页等搜索语义 lane”去重，排除 query 文本；并补充并行 lane 单测。`asset-rename` E2E 和切库预览 E2E 均已复验通过。

## 未执行与保留条件

- 当前环境没有 Computer Use，不能把真实 UI 视觉检查写成通过。
- 没有 Windows runner；Windows 快捷键工单 `Serpent-g8u9` 保持原有未验证状态，本日志不代替 Windows 验收。
- 没有修改或验证 `Serpent-x710` 的删除后刷新时间路径。
- 基线提交 `2ab4c553` 后复现的 7 个 Worker 失败已分流：`enqueuePaletteJob` 的“仍有缩略图任务”查询会把当前正在运行的缩略图也算进去，导致 palette 不入队，连带造成 real-media 重启残留 10 个 palette 队列任务和 OIIO 修复任务计数错误；已移除该自阻塞判断。固定 4 并发断言已改为逻辑 CPU - 3（当前环境 8 线程因此为 5），并补上 CPU-derived wave 的释放逻辑。macOS `/var` 软链接路径比较改用 `realpath`；取消中的缩略图测试只断言 thumbnail 不落盘，保留预期的 `extracted_metadata`。
- 另修复发现的真实缓存安全/生命周期问题：artifact path cache 命中时重新执行根目录、普通文件、符号链接和 containment 校验；永久删除本地资产后立即清空该库的路径缓存，避免变更序列轮询下一 tick 前继续提供已删除资产。并移除同样会把当前 `running` 任务算入队列的 EXIF author backfill 门控，补充队列路径集成测试。最终 `npm run test:worker` 通过（62 files / 1044 tests / 12 skipped，0 failed）；定向 `palette-artifact` 6、`real-media-bundle` 1、`video-exr` 46、`folder-delete` 17、`thumbnails` 53 均通过。`npm run test:unit` 及完整 `npm run test` 未在本次修复后重跑；Computer Use、packaged、Windows 仍未执行。
