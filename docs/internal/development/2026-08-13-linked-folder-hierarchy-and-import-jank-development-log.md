# 链接文件夹层级与大批量导入卡顿

## 工单与范围

- `Serpent-a9vh`（P0）：链接文件夹按磁盘层级显示子文件夹
- `Serpent-7216`：导入后不再显示操作提示文案
- `Serpent-yti0`（P1）：大批量导入后 UI 卡顿，派生任务看起来未并行
- `Serpent-vjuf`（P1）：缩略图失败时回退显示原图
- `Serpent-l1oi`（P1）：瀑布流宽高比使用源分辨率元信息

当前状态：LINK-006/007、PERF-001、CANVAS-036 人类通过。Windows 打开后残留小框选已开单
`Serpent-er9g` / SELECT-016，未修。Computer Use、packaged 未执行。

## 根因

链接资产只记录导入根 `linked_folder_id` 与 `relative_file_path`。浏览与侧栏把链接根当成扁平节点，子目录资产全部堆在根上。

缩略图、色板、OIIO 成功会发 `asset.changed`；`revision_artifacts` 写入还会触发 `library.changed`。Renderer 对这两类事件做全量 `searchAssets` + 重绘网格。大批量导入后每张缩略图都打断画布。任务管理器里其他 Electron 进程空闲符合「单一 Library Worker + 有界异步并发」架构，不是多进程空转。

瀑布流在缺少 `width`/`height` 时用 `col * 0.72`（接近 4:3）。图片宽高原先主要等缩略图 artifact。失败卡片只显示占位和「缩略图失败」，即使 `serpent://source` 可以解码。

## 实现

- 虚拟子目录 id：`lfv:{rootId}/{relativePath}`，无新表、无破坏性迁移。
- `listLinkedFolders` / `listFolderBrowseEntries` / `searchAssets` / `listAssets` 按路径前缀区分当前层与递归。
- 侧栏去掉 `nav.linkedFolderHint`；链接树可展开。
- 导入与 refresh 用 header 探测写入 `extracted_metadata` 宽高。
- 缩略图/色板/OIIO 不再发 `asset.changed`；`library.changed` 不再全量重载网格。卡片由 `onThumbnailEvent` 就地更新。
- 图片缩略图失败时卡片使用默认文件图标，不回退原图、不显示黄色警告角标。
- 打开/排空后继续入队缺失缩略图（每波 500，priority 50）；有未完成缩略图时不入队色卡。
- 2026-08-14：窗口化使框选只能命中已挂载的约 50 张卡，曾撤回全量挂载；随后 Renderer
  工作集约 3.8GB、界面再次卡死。现恢复窗口化，框选改为命中已发布的全量布局几何。
- 缩略图并发改为 `logicalCpus - 3`（预留 2 个给系统、1 个给当前 Serpent 线程），
  不再写死 8 路 / 每波 16。高峰仍跳过 EXIF 与宽高回填。
- 导入同步 header 探测上限 64；其余由 `backfillMissingImageDimensions` 后台回填并发送 `asset.dimensions.ready`。

## 2026-08-14 绘画资源库只读证据

`E:\Resources\Serpent\绘画资源库\.serpent\library.db`：

- assets 7180（全部 linked；根层 4940，嵌套 2240）
- thumbnail ready 190 / failed 5；extracted_metadata 带 width 5
- jobs queued/running 0；extract_palette succeeded 190
- 扩展名以 `.jpg` 6346、`.png` 834 为主

## 验证记录

已执行：

```text
npx vitest run --config vitest.config.ts tests/unit/linked-folder-tree.test.ts tests/unit/unified-directory-nav.test.ts tests/unit/folder-card-selection.test.ts tests/unit/folder-breadcrumb-trail.test.ts tests/unit/asset-card-hover-preview.test.ts
npx vitest run --config vitest.config.ts tests/unit/media-concurrency.test.ts tests/unit/canvas-asset-layout.test.ts tests/unit/viewport-window.test.ts tests/unit/masonry-preview-frame.test.ts tests/unit/justified-slot-style.test.ts tests/unit/marquee-geometry.test.ts tests/unit/marquee-selection.test.ts
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/linked-folders.test.ts
```

结果：单测 5 files passed；窗口化/并发定向 7 files / 39 passed；Worker `tests/worker/linked-folders.test.ts` 17 passed (4.88s)。本机直接 `vitest` 跑 Worker 会因 better-sqlite3 Node ABI 不匹配失败，需走 Electron 脚本。

Computer Use、packaged、Windows 未执行。
