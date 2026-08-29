# 2026-08-06 晚间验收批次修复

## 范围

用户验收反馈批次：

| 条目 | 结果 | 跟进 |
| --- | --- | --- |
| TITLE-001 / SETTINGS-004 / PLATFORM-001 / CANVAS-021 / NOTIFY-001 / NOTIFY-002 / MENU-014 / IMPORT-008 / IMPORT-009 / MODEL-001 / MODEL-002 / MODEL-003 | 人类验收通过 | MODEL-002 额外要求 HDRI 名称简化 |
| FILTER-001 | 不通过 | `Serpent-yc9n`：分类勾选联动 + UI 对齐 |
| IMPORT-007 | 不通过 | `Serpent-12ae`：同名冲突优先于内容重复 |
| MODEL-004 | 不通过 | `Serpent-osr0`：3D 非阻塞提示改普通 Info 栈 |
| PBR-001 | 保留待验 | 用户未原样要求，暂不关闭 |

## 实现

### FILTER-001 / Serpent-yc9n

- `dimension-filter-selection.ts`：新增 `formatGroupSelectionState` / `toggleFormatGroup`（全选 / 半选 / 清空分类）。
- `DimensionFilterBar.tsx`：各格式分组标题改为 checkbox（支持 indeterminate）；chip 行缩进对齐。
- `styles.css`：`.format-filter-group*` 规范化布局；格式弹层使用 `is-wide`。

### IMPORT-007 / Serpent-12ae

- `classifyImportEntryConflict`：目标路径已占用一律 `name-conflict`；内容重复仅在目标文件名空闲且内容哈希命中时返回。
- 更新 Worker / Electron 断言：同名同内容不再计为 `suspected-duplicate`。

### MODEL-004 / Serpent-osr0

- `ModelViewerSurface` 去掉底部常驻 Notice；经 `onInfoNotice` → `AssetPreviewModal` → `App.setNotice` 进入 workspace Info 栈。

### MODEL-002 名称 / Serpent-s09p

- `shared/hdri-presets.ts` 显示名改为：产品 / 室内 / 室外 / 自然（en: Product / Indoor / Outdoor / Nature）；预设 id 不变。

## 验证

- `npm run test:unit`：307 files / 2276 passed / 1 skipped（含 format group + HDRI）
- `npm run typecheck`：通过
- `npm run lint`：通过（viewer-surface hooks warning 已消）
- `npm run test:worker -- tests/worker/import-planning.test.ts tests/worker/extension-save.test.ts`：定向 Worker 通过
- `node scripts/run-e2e.mjs tests/e2e/import-conflict-flows.test.ts tests/e2e/model-viewer.test.ts`：4 passed（10.7s）
- Computer Use / packaged / Windows：未执行
- 2026-08-06 用户复验通过：FILTER-001、IMPORT-007、MODEL-004、MODEL-002；格式 token 输入框随后加宽至 `min(480px, 90vw)`
