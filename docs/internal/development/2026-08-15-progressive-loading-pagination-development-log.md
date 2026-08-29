# 渐进式加载：浏览/搜索分页 + renderer 增量渲染（Serpent-ws4k）

> 日期：2026-08-15
> 分支：`wt/ws4k-pagination`（基于 `origin/dev` 2cf0265）
> 工单：Serpent-ws4k（P1，已在主线认领；本日志只记录实现，`accepted` 由主 agent 独立签署）
> 依据：`docs/internal/research/2026-08-14-progressive-loading-analysis.md`（A2/B1 候选）
> 原则：`docs/internal/ui/0006-progressive-loading-ux-principles.md`

## 一、问题

- 所有浏览/搜索路径都走 `BROWSE_SCOPE_SEARCH = { scopeMode: true }`，worker
  `searchAssets` 一次返回最多 50_000 条 AssetSummary（~25 字段），经
  UtilityProcess→Main→Renderer 三段结构化克隆 + 3 次 Zod 校验，首屏等待全部
  完成后才原子替换列表；超 50k 的部分永远看不到。
- renderer 的 `asset-browse-load-more.ts`（browseLoadMoreObserverRoot /
  resolveSearchTotalAfterAppend / countNewlyAddedAssets）与 `searchOffset` 状态
  是写好但从未接线的死代码。
- 用户点名：切换文件夹慢、搜索一次性全量返回耗时长；要求「永远渐进式加载」。

## 二、方案（实现位置 file:line）

1. **分页拉取（浏览/搜索/标签/合集/智能合集/回收站/会话恢复）**：首屏
   `limit = BROWSE_PAGE_SIZE = 300`（工单要求 200–500）、`offset = 0`，替换全部
   scopeMode 调用点；worker 侧 limit/offset 分页本已就绪，仅协议 limit 上限从
   200 放宽到 500（`src/shared/protocol/requests.ts`，renderer 与 worker 两侧
   4 处）。未引入 keyset 游标：默认/全部排序分支都以 `a.asset_id` 作 tiebreaker，
   OFFSET 分页天然稳定，且 COUNT 全量扫描本就占大头（keyset 记为后续优化）。
2. **renderer 增量追加（接线死代码）**：新模块
   `src/renderer/use-browse-pagination.ts` —— `beginPage` 注册当前查询上下文
   （query/filters/scope/sort/showIgnored/target），`appendNextPage` 由
   IntersectionObserver sentinel（`browseLoadMoreObserverRoot`，rootMargin 800px）
   触底触发，按 `offset = 已加载数` 拉下一页，`appendAssetPage`（
   `asset-browse-load-more.ts`）去重合并，`resolveSearchTotalAfterAppend` 在空页/
   全重复页时把 total 钳到已加载数防止哨兵空转。`applySearchResult` 保留替换语义
   （全新查询/范围切换），追加语义在控制器内实现（去重合并 + total 钳制复用
   countNewlyAddedAssets/resolveSearchTotalAfterAppend）。
3. **全选全部兼容（REQ-BROWSE-001 / Serpent-6w7n）**：select-all / invert 不再只
   覆盖已加载页 —— 触发时按需拉取全量轻量 ID 集。worker `searchAssets` /
   `executeSmartCollection` 新增 `idsOnly`（只 SELECT asset_id，跳过缩略图/序列
   富化，仍按 `BROWSE_SCOPE_MAX_ASSETS` 上限截断以保持既有 50k 语义），经
   `asset.search` / `smart-collection.execute` 命令透传（可选字段，向后兼容），
   renderer `selectAllBrowseScope` / `invertBrowseScope` 异步解析后设置选择。
   BROWSE_SCOPE_MAX_ASSETS 语义与范围总数量显示（searchTotal）保持不变。
4. **搜索竞态**：`searchRequestGenerationRef` 保留；翻页请求由控制器 generation
   校验（每次 beginPage 递增）丢弃过期页。
5. **调用点逐一适配**：App.tsx loadContent / handleSearchTagsFromManagement /
   chooseTag / chooseCollection / executeSearchDefinition / chooseSmartCollection
   全部改分页并注册 beginPage；restore-browser-session.ts 的 tag/collection/smart
   恢复路径改分页并注册（新增 `beginBrowsePage` dep），`findSessionSelectedAsset`
   的兜底单资产查找保持 scopeMode 全量（窄查询、结果不进入列表，评估后保留）；
   `applyClosedLibraryUi` 调用控制器 `reset`。
6. **缩略图调度**：worker `asset.search` 的 'visible' 波仍作用于结果前 N 条，
   分页后首屏调度即正确，未改。

## 三、测试

- `tests/worker/search.test.ts` 新增 4 个用例：idsOnly 全量 ID 集 /
  limit-offset 被忽略 / 尊重 trash scope / 智能合集 idsOnly。
- `tests/unit/asset-browse-load-more.test.ts` 新增 `appendAssetPage` 去重合并用例。
- `tests/unit/browser-session.test.ts` 补 `beginBrowsePage` dep。

验证命令与结果（2026-08-15，独立 worktree，
`VITEST_CACHE_DIR` 指向 worktree 内 `.vitest-cache`）：

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 通过（tsc --noEmit + tsconfig.extension.json，exit 0） |
| `npm run lint` | 通过（eslint .，exit 0） |
| `npx vitest run --config vitest.config.ts tests/unit/{asset-browse-load-more,browser-session,protocol,selection-keyboard}.test.ts` | 97/97 通过 |
| `npx vitest run ... tests/unit/{automation-command-gateway,worker-client,plugin-provider-scheduler,plugin-search,app-assets,browse-selection-order,browse-selection-menu,invert-selection,merge-asset-summaries,application-menu,main-menu-items}.test.ts` | 126/126 通过 |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/search.test.ts` | 86/86 通过 |

E2E 未运行（主 agent 集中串行收口）；`tests/e2e/asset-pagination.test.ts` 是
连续追加模型验收（73 资产 < 300，第一页即全量，滚动轮询仍通过）。

## 五、交叉审查修复（2026-08-15，追加提交）

flash 模型审查发现并修复：

1. **select-all/invert 异步竞态（必修）**：`fetchScopeAssetIds` await 后无条件
   应用结果，切换文件夹/搜索范围后立刻 Ctrl+A 会把旧范围 ID 集写进新范围选择。
   修复：`use-browse-pagination.ts` 提取 `fetchBrowseScopeAssetIdsGuarded`（捕获
   代际 → await → 再校验代际），hook 的 `fetchScopeAssetIds` 用 `generationRef`
   作为代际读取器；过期/失败返回 null，select-all/invert 对 null/空集 no-op
   （不清空既有选择——与旧同步行为一致：空范围时键盘守卫
   `browseScopeAssetIds.length === 0` 与菜单 `hasBrowseAssets` 本就不触发，空
   ID 集仅在空范围出现，旧行为即 no-op；注释与单测均已写明）。
2. **9 处同构注册块收敛（建议修）**：App.tsx 6 处 + restore-browser-session.ts
   3 处 `beginBrowsePage({kind/query/filters/scope/sort/showIgnored/target},
   {items/total/offset})` 提取为 `registerBrowseSearchPage` /
   `registerBrowseSmartCollectionPage`（`use-browse-pagination.ts` 导出，
   `BeginBrowsePage` 统一类型），消除复制。
3. **测试补缺（必修）**：`dispatchSelectionKeyboardAction`（selection-keyboard.ts
   提取，hook 只接线 DOM 监听）覆盖 select-all/invert/clear 回调触发与守卫；
   新 `tests/unit/browse-pagination.test.ts` 覆盖 idsOnly 拉取、
   `fetchBrowseScopeAssetIdsGuarded` 代际过期丢弃用例、两个注册 helper。
4. **小项说明**：审查提到的 `NATIVE_DRAG_PRIME_VISIBLE_COUNT=500` 在当前代码
   中并不存在（`primeNativeAssetDragCache` 对结果全部 assetId 预热，无 500
   截断）；分页后每页结果 ≤300，拖拽预热窗口即当前页，与 `BROWSE_PAGE_SIZE=300`
   天然一致，无需改动。

修复提交后验证：`npm run typecheck` / `npm run lint` / 定向单测
（selection-keyboard + browse-pagination 新增用例）全部通过（见提交说明）。

## 四、遗留项 / 风险

- **keyset 游标**：OFFSET 深分页（>50k 时每页从头扫描）未做，收益在 COUNT 全量
  扫描之后；分析文档 A2 可选项，后续工单再做。
- **COUNT + 数据查询双重 JOIN 扫描**（A5）未做，属另一工单；分页后数据查询本身
  已轻量。
- **drag 缓存预热仍在响应路径**（A1 = Serpent-v4jf 单独工单）；分页后每页只
  预热 300 条，端到端延迟已大幅下降。
- **滚动中发生增删改**：追加页可能与列表出现重复/跳过（去重合并 + total 钳制
  兜底）；批量变更路径会触发 reloadCurrentContent 重新注册分页。
- **select-all 变异步**：Ctrl+A 现在先取 ID 集再设置选择（50k ID ≈ 1.5MB 单次
  轻量查询），期间有短暂异步间隙；菜单/键盘守卫（hasBrowseAssets / 已加载
  id 非空）保持禁用语义。invert 同。
- 交叉审查按 AGENTS.md 分级触发要求由主 agent 安排（需用户指定审查 subagent
  模型）；`accepted` 不得由实现者自签。
