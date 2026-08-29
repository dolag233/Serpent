# 2026-07-17 第三批反馈开发日志：递归范围、拖拽反馈、Inspector 批量标签

> 对应需求池「K. 递归范围、批量操作与拖拽反馈（2026-07-17 第三批新增）」。
> 执行方式：主 agent 直接实施 Track A 代码翻转；2 个编码 subagent 并行（Track B、Track C）；1 个测试 subagent 补 Track A 测试；2 个只读调查 subagent 先行。全部测试与门禁由主 agent 集中执行。

## Track A — REQ-FOLDER-008 / REQ-FILTER-012（递归显示与递归搜索，最高优先）

**调查发现**（只读 agent）：worker 与协议层早已支持递归——`searchAssets` 的 folder scope 带 `recursive` 字段，SQL 用 `WITH RECURSIVE` CTE 沿 `managed_folders.parent_folder_id` 走后代（`src/worker/library-service.ts:8614-8624`）；链接文件夹天然递归（扁平根 + 路径编码子目录）。阻塞点只是渲染层 5 处硬编码 `recursive: false`。

**实现**（`src/renderer/App.tsx`，仅渲染层，协议/worker 零改动）：

- 浏览范围构造（`loadContent`，约 891–899 行）：folder scope 默认 `recursive: true`；根目录范围（`folderId: null` = 无文件夹的托管资产）保持 `recursive: false`，递归对它无意义。
- 会话恢复（约 1002 行）：恢复 folder scope 时同样递归，避免重启后行为漂移。
- `currentSearchScope()`（约 2107 行）：folder scope 搜索默认递归（REQ-FILTER-012）。
- 未动的部分：合集递归沿用既有复选框；导入目标仍是精确选中文件夹（`chooseFolder` 的 import target ref 只受 scope 切换影响，不受显示递归影响）；MoveDialog/拖拽落点逻辑不假设「可见 == 直接子级」。

**测试**：

- worker 回归（`tests/worker/search.test.ts`）：`matches grandchild folder assets in folder-scoped search only when recursive`——父→子→孙三级文件夹，查询词命中孙级资产仅当 `recursive: true`；`recursive: false` 时不命中。原始 SQL 插数据后必须走 `setAssetMetadata` 同步 FTS（既有 fixture 模式）。
- E2E（`tests/e2e/folder-recursive-scope.test.ts`，已加入 `package.json` 的 `test:e2e` 清单）：父/子文件夹 + 导入到子文件夹（含磁盘落点断言）→ 点父文件夹两张卡都可见（REQ-FOLDER-008）→ 父范围内搜索 `child-note` 命中子文件夹资产（REQ-FILTER-012）。

## Track B — REQ-DND-003 / BUG-DND-001（拖拽预览与高亮稳定性）

**根因诊断**（只读 agent，已采信并修复）：

1. **特异性压制**：`.nav-row:hover:not(:disabled)`（0,3,0）压过 `.nav-row.is-drop-target`（0,2,0）；拖拽中 Chromium 的 `:hover` 行为不稳定，所以高亮"时有时无"。
2. **子元素 enter/leave 抖动**：NavRow 的 svg/label/count 子元素是独立 drag 目标，跨越时触发 `dragleave` 清掉高亮。
3. 链接文件夹行接受拖放但完全没有高亮接线。
4. 拖拽预览从未自定义——是 Chromium 默认的整卡不透明快照。

**实现**：

- 新模块 `src/renderer/asset-drag-preview.ts`：纯视图模型 `assetDragPreviewModel`（缩略图 vs 文件名 chip、计数徽标文案）+ DOM 构造 `createAssetDragPreview` + 单例挂载 `showAssetDragPreview`（先清残留节点）+ `dismissAssetDragPreview`。96×72、`opacity: 0.6`、圆角 9px、`overflow: hidden`，计数徽标用既有 `--accent`。
- `App.tsx` 卡片 `onDragStart`（仅托管资产拖拽路径；合集排序早退路径保持原样）：`setDragImage(preview, 48, 36)`；`onDragEnd` 负责销毁。
- `styles.css`：`.nav-row.is-drop-target, .nav-row.is-drop-target:hover:not(:disabled)`（0,4,0 压过 hover）；`.nav-row > * { pointer-events: none; }`（已核实原地编辑输入框渲染在 `.nav-inline-edit` 兄弟节点，不在 `.nav-row` 内，无需豁免）。
- `NavigationSidebar.tsx`：`onDragLeave` 加 `relatedTarget` 包含性守卫（文件夹行与回收站行两处）；链接文件夹行补齐 `dropActive` 高亮（`linked:${folderId}` key）。

**测试**：`tests/unit/asset-drag-preview.test.ts` 4 项（纯模型 + 几何常量）。DOM/视觉部分无 jsdom 环境，按纪律移交真实应用验收。

## Track C — REQ-MENU-007（多选时 Inspector 标签批量）

**调查发现**（只读 agent）：右键菜单的批量标签/合集/移动/回收站/恢复/删除早已真批量（`useBatchActions.ts` → 数组化协议命令）。真正的缺口是 **Inspector**：多选时添加/移除/新建标签只作用于主资产；评分/收藏同样单资产（本轮不动，见后续项）。

**实现**（编码 agent）：

- 新模块 `src/renderer/inspector-tag-target.ts`：纯决策 `resolveInspectorTagTarget(selectedAssetIds, primaryAssetId)` → single/batch/null（去重；≥2 走批量；恰好 1 保持单资产路径以保留历史行为）。
- `App.tsx` 三个 Inspector 回调改为分发器：多选时路由到既有 `batchAssignTagToSelection`/`batchRemoveTagFromSelection`（协议早已数组化，零 worker 改动）；新建标签路径先创建再批量分配。
- **批量后刷新**：批量助手只刷标签列表，不刷 Inspector 的 `assetMetadata`——补 `refreshInspectorTagStateAfterBatch()`，否则 chip 显示过期。
- `InspectorPanel.tsx`：新增可选 `selectionCount` prop，N≥2 时标签区底部显示「标签操作将应用于 N 项资产」（复用 `.tag-chip-placeholder` 样式，无新 token）。

**测试**：`tests/unit/inspector-tag-target.test.ts` 6 项（批量阈值、去重、主资产偏好、空选择）。

## 集中门禁（主 agent 执行，全绿）

| 门禁 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | pass |
| eslint（全部触及文件） | 0 findings |
| unit | **467 passed**（+10：drag-preview 4、inspector-tag-target 6） |
| worker | **601 passed + 1 skipped**（+1：孙级递归搜索回归） |
| E2E（20 spec 全量） | **63/63 passed** |

E2E 过程中修掉新 spec 自身的一个选择器歧义（父文件夹名称同时出现在面包屑与侧栏，改用 `button.nav-row` 限定）。既有 62 项无一回归——递归翻转未破坏任何既有范围断言。

## 后续项（已记录，不在本轮）

- worker 端 `assignTags` 对未知 assetId 目前是整体抛错，REQ-MENU-007 的「逐项报告处理/跳过」需要 skip 语义 + 响应协议扩展。
- Inspector 评分/收藏多选批量（`asset.metadata.set` 单资产 + 版本化，需要 renderer 循环或批量命令）。
- 多选菜单暂不补「在 Finder 显示 / 复制路径」（单资产命令循环即可，未排期）。
- Computer Use 桌面验收当前环境不可用，按 AGENTS.md 记「未执行」，移交人工 QA。
