# 2026-08-16 浏览窗口化（Serpent-87pd）

## 产品口径（用户确认）

- 分页可以，但必须无感：拖动滚动条时不能卡在已加载页，看起来像已经到底。
- 页大小改为 **100**（300 太慢；滑到另一区域会被前面那一页堵住）。
- 画布槽位按 COUNT 排，滚动条反映全范围。
- 按滚动位置取窗口，不要 sentinel 从 0→100→200 依次追加。
- 切文件夹立刻清旧画布；文件夹互切不要全库 COUNT。

## 实现

- `BROWSE_PAGE_SIZE = 100`；`mergeBrowseWindow` 把首屏扩成 `total` 个槽，未取到的是 `__pending:` 占位卡。
- 滚动 50ms 防抖后用 `scrollTop / maxScroll` 映射到槽位 index，`browsePageOffsetsForRange` **目的页排第一**。
- 新的可见范围请求会中止上一档邻居页循环；Worker 丢弃的空窗（`items: []`, `total: 0`）不得写成已填充，也不得把 COUNT 收成 0。
- 画布尾部 sentinel 只填**最后一窗**，避免跳到库尾时回头加载第 0 页。
- `beginPage` 独占画布；`loadContent` / `applySearchResult` 不再 `setAssets(第一页)`，否则滚动条会塌成 100 项。
- 文件夹互切跳过全库/根/回收站 COUNT。Worker `browse-window` lane 不含 scope/offset，排队中的旧窗口在 `setImmediate` 后丢弃。SQLite 本身是同步的，正在执行的 100 条查询仍会跑完。

## 验证

```
npx vitest run --config vitest.config.ts tests/unit/browse-window-slots.test.ts tests/unit/browse-pagination.test.ts tests/unit/search-request-coordinator.test.ts tests/unit/import-library-chooser.test.ts tests/unit/library-lifecycle-sync.test.ts tests/unit/create-dialog-eagle-open.test.ts tests/unit/worker-client.test.ts tests/unit/protocol.test.ts
```

8 files, 130 passed。

```
npx tsc --noEmit
```

通过。

```
npm run test:library-availability
```

9 files, 188 passed / 1 skipped（39.32s）。Electron 分页 E2E 与绘画资源库真机滚动待用户。

## 人类验收（2026-08-16）

用户确认 **不通过**：占位符卡片更心烦；滑动一下会触发，重新排列也会触发，体验比旧分页更差。`Serpent-87pd` 已关单。后继硬门槛见 `Serpent-sa65`：1 万库、第四档、滚动条随机跳到新预览位置须 0.5 秒内完成预览解码，禁止再用空占位卡撑滚动条。

