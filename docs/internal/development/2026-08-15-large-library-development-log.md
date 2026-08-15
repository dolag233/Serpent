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
- `npm run test:unit` 通过（341 files / 2576 tests / 1 skipped）。完整 `npm run test` 在媒体/回收站套件报告失败：`palette-artifact.test.ts` 3、`real-media-bundle.test.ts` 1、`video-exr.test.ts` 2、`folder-delete.test.ts` 1；随后长时间无新输出而中止，不能记为全量通过。上述失败未涉及本次大型库读路径/Renderer 变更，仍需独立修复或复验。
