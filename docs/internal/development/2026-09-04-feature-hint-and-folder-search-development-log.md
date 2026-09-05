# 2026-09-04 功能提示（包含子文件夹）+ 搜索文件夹结果开发日志

> 覆盖 `Serpent-b8a853`（递归显示子文件夹内容图标功能提示）与 `Serpent-f74e48`（搜索支持返回文件夹结果）。两者均为 renderer 侧实现，不涉及 worker/schema/库结构，未触碰 `test:library-availability` 路径（不修改任何资源库相关代码，仅消费已加载的文件夹摘要/画布状态）。
> 状态：实现完成 + 自动化证据，**待用户「人类验收通过」**（见 human-acceptance-checklist FEATURE-HINT-001 / SEARCH-FOLDER-001）。经两轮用户反馈修正，最终形态见「最终设计」。

## 需求与验收

- **b8a853**：当用户进入「无直接资产、但有子文件夹」的文件夹时，`包含子文件夹` 图标需要**持续微弱的主题色脉冲**提示（可展开子文件夹）；用户**展开过一次后永不再提示**；设置提供全局「功能提示」开关；必须用主题 token（禁硬编码颜色）。
- **f74e48**：全局搜索（搜索框）同时返回匹配名称/子路径的文件夹，点击可进入；文件夹结果要用**资产浏览器文件夹卡片同款**（最终：直接复用普通浏览的 folder-card-row）。

## 新增模块（纯逻辑，可单测）

- `src/renderer/feature-hint-preferences.ts` — 功能提示全局偏好：`enabled`（默认 true）+ `seen` 键集合（`recursive-subfolders:<libraryId>:<folderId>`，语义 =「已 dismiss」）；`withFeatureHintShown` 幂等记录。
- `src/renderer/recursive-subfolders-hint.ts` — `shouldFlashRecursiveSubfoldersHint`：递归关闭 + 全局开关开 + 未 dismiss（此文件夹从未展开过）+ 画布 `hasChildFoldersWithoutDirectAssets`（`folders-only` 模式）为真。
- `src/renderer/search-folder-results.ts` — `resolveSearchFolderResults`：从 `parseSearchExpression` 抽取 plain-text / `filename` / `folder_path` 正向词，在已加载的 `ManagedFolderSummary[]` / `LinkedFolderSummary[]` 上按 `name` / `relativePath` 子串匹配（NFKC 归一），默认上限 8、按 folderId 去重、返回 **`FolderBrowseEntry[]`**（与资产浏览器卡片同构）。

## 接线（`src/renderer/App.tsx`）

- 派生 `recursiveHintKey`（libraryId + folder scope）+ `recursiveHintActive`（**纯派生，无 effect、无瞬态 state**）→ 仅 folder-scope 的 `包含子文件夹` 按钮加 `is-feature-hinting` class，CSS 做**无限循环**的淡脉冲；脉冲期间「展开过一次」→ 按钮 onClick 里 `withFeatureHintShown` 持久化 dismiss → 永不再脉冲。
- 搜索文件夹结果**直接复用普通浏览的 folder-card-row**：`folderRowEntries = !showTrash && 搜索中 && 有匹配 ? searchFolderResults : canvasFolderBrowseEntries`；把整行（FolderCard + 选中/右键/拖拽等全部原有交互）提升为 `folderCardRowElement` 变量，同时挂到**非空与空态两分支**——搜索无资产命中时也能看到匹配文件夹；搜索模式下单击卡片进入该文件夹（`chooseFolder`），浏览模式保持原选择语义。
- `src/renderer/AppSettingsPages.tsx` — 「一般」设置新增 `SettingsToggleRow`「功能提示」，全局开关（保留既有 `seen`）。
- `src/renderer/i18n/catalogs/en.ts` / `zh-CN.ts` — `settings.featureHints`、`settings.featureHintsHint`。
- `src/renderer/styles.css` — `feature-hint-accent-pulse` keyframes（`color-mix(var(--accent) 8%/14%/34%…)` + `--tertiary`，全 token，2.6s 缓动持续脉冲）。

## 两轮用户反馈修正

1. **hint 真实库不触发**：初版用 `ManagedFolderSummary.childFolderCount`/`directAssetCount` 判定，真实库里「无资产、有子文件夹」的文件夹多为**链接文件夹**（summary 无 childFolderCount）→ 永不触发。改为以画布 `browseCanvasBodyLayout.mode === "folders-only"` 为信号，托管/链接通吃。
2. **脉冲形态**：初版为一次性 1.6s 闪烁；用户要求**不断闪烁且更淡** → 改为 2.6s 无限淡呼吸脉冲（`--accent` 低混比，无硬编码色）；停止条件改为**展开过一次后永不再现**（dismiss 语义）。
3. **搜索文件夹结果样式**：初版自造 chip，二次独立分区复用 FolderCard，用户均不通过 → 最终取消任何独立分区/标题/CSS，直接让**普通浏览的 folder-card-row** 在搜索时渲染匹配文件夹（同样式同容器同交互）。

## 第三轮用户反馈修正（缓存 + 封面预览）

1. **提示消失（缓存/旧 seen 污染）**：早期一次性闪烁版本把「显示过一次」写进 `serpent.feature-hints.v1` 的 `seen`；第三版改为「展开过一次才 dismiss」语义后，同一批 v1 key 被当成已 dismiss → 真实库的文件夹不再有提示。处置：**偏好键升级到 `serpent.feature-hints.v2`**（丢弃 v1 seen，全新开始），仅新版 dismiss 语义写键。
2. **搜索文件夹无预览图**：搜索用 renderer 侧轻量条目（`coverArtifactIds: []`）→ 卡片永远是占位图标。改为真复用：新增跨栈 RPC **`folder.entries-request` / `folder.entries`**，worker `folderEntriesByRefs` 对匹配的托管/链接 folder 复用既有计数 + 封面 helper（`folderCoverArtifactMap`、`linkedDirectoryCoverArtifactIds` 等）返回真实 `FolderBrowseEntry[]`；renderer 搜索激活时拉取并按匹配键回填 `folderRowEntries`（封面/计数与浏览一致），worker 侧同步调度 cover 缩略图场景。tiny PNG 走 source-direct 直出、不产生缩略图 artifact，故 E2E 不断言 `<img>`（避免时序 flaky），封面正确性由 worker 层确定性注入验证。

## 第四轮用户反馈修正（提示仍不可见 → 可见性 + reduced-motion）

用户确认「库内托管子文件夹、未开减少动态效果」仍看不到提示——该场景 E2E 稳定通过，逻辑触发无疑。根因落到**可见性**：
1. **`prefers-reduced-motion: reduce` 全局媒体查询**（`styles.css` 把动画压成 `0.01ms/1 次`）会吞掉纯动画脉冲→ 提示完全不可见。修复：`.is-feature-hinting` 改为**静态 `--accent-soft` 高亮 + `--accent-ring` 描边**（不依赖动画，reduced-motion 下也常显），仅在 `no-preference` 下叠加 2.2s 呼吸脉冲。
2. 初版 `-accent 8% 混合`太淡不可辨 → 脉冲峰值提升为 `-accent 26%` + ring 22% 光晕，仍用主题 token。
3. 若用户运行的是**旧实例/打包应用**，改动未进入——需完整退出重启 dev，或重新打包；此点无法从代码侧消除。

## 第五轮用户反馈（脉冲通过 Review + 三处行为修正）

用户确认：「闪烁效果不错」。三处修正：
1. **reduced-motion 不得关闭提示**：这是功能性注意线索、非装饰动效 → 提示动画不再受 `prefers-reduced-motion` 抑制：`@media (prefers-reduced-motion: reduce)` 下用更高优先级（`!important` 覆盖全局 0.01ms 规则）保持 2.2s 无限脉冲。
2. **新增链接文件夹「新手」提示**：在当前资源库从未使用过链接文件夹、且提示未 dismissed 时，**添加普通文件夹会脉冲侧栏「导入链接文件夹」入口**（`linked-folder-add-hint` 纯判定 + App 内 8s 瞬态窗口 + NavigationSidebar `Section` secondary 按钮挂 `is-feature-hinting`）；一旦导入过链接文件夹即永久 dismiss。
3. **所有高亮统一消失规则**：悬停高亮元素 **>0.5s** → 该提示永久消失（`onMouseEnter` 500ms 计时 / `onMouseLeave` 取消）。作用于「包含子文件夹」图标与「导入链接文件夹」入口两处。

## 验证（2026-09-04，全部重跑）

- `npx tsc --noEmit` → 通过（exit 0）。
- `npx eslint <改动文件>` → 0 错误。
- `npx vitest run --config vitest.config.ts tests/unit`（含 feature-hint-preferences / recursive-subfolders-hint / search-folder-results 新单测 20 tests）→ 通过。
- `node scripts/run-vitest-with-electron.mjs run tests/worker` → 全套通过；其中 `reconciliation-performance` 全量并发时 1 例失败（event-loop P95 76ms），**单独隔离复跑 7/7 通过**——对账路径不在本次 diff 内，判定为全量负载下的性能方差，非本次回归。
- `tests/worker/folder-browse-entries.test.ts` 新增 `folderEntriesByRefs` 用例：托管文件夹带真实封面 artifact + linked 根解析真实 displayName/计数 → 5/5 通过。
- `node scripts/run-e2e.mjs tests/e2e/feature-hint-folder-search.test.ts` → 2/2 passed（hint 持续脉冲→展开一次永不再现；搜索文件夹以原生 folder-card-row 渲染并可跳转）。

## 保留条件（未验证）
- 真实桌面 Electron 的**人类视觉验收**（淡脉冲强度、卡片行与浏览状态的一致性、亮/暗主题）。
- packaged / Windows 未执行；Computer Use 截图未执行。
- `prefers-reduced-motion` 下动画被禁用（不脉冲）；该偏好下此提示不适用，不视为验收阻断。

## 相关文档
- 验收条目：`docs/internal/qa/human-acceptance-checklist.md`（FEATURE-HINT-001 / SEARCH-FOLDER-001，待人类验收）。
- 工单：`Serpent-b8a853`、`Serpent-f74e48`（in_progress，等用户验收后关闭）。