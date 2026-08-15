# 标签管理 chip 网格重做开发日志（Serpent-eaxs）

> 日期：2026-07-24 · 执行：主 agent（Windows 开发机） · 工单：`Serpent-eaxs`
> 前史：`Serpent-mqp` 行列表基线（TAG-001/002 通过、TAG-003 删除不通过）；`Serpent-36il`/`k6g6` 迭代于 2026-07-22 因执行质量被用户整体回退（TAG-009–012 撤回）。

## 需求来源

2026-07-24 用户当面澄清：回退不是否定方向，是上一版执行太差且主界面样式没有真正变化。明确要求：

1. 不要一行一行的列表/表格，要以「标签 chip」的形式展示标签，可直接照搬资产标签 chip UI（REQ-TAG-010 方向确认）。
2. 支持按数量、名称排序（REQ-TAG-011）。
3. 可选中标签，右键执行标签管理功能（REQ-TAG-012：AND/OR 搜索、批量删除、合并命名）。
4. 双击进入被双击的单个标签浏览（REQ-TAG-013）。
5. 顺带覆盖 TAG-003「删除无反应」回归（`Serpent-gilc`，本机 beads 库缺该工单，以验收清单记录为准）。

## 四列可追溯

| 需求 | 实现 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| chip 流式网格（非行列表） | `src/renderer/TagManagementWorkspace.tsx`（`.tag-management-grid`/`.tag-management-chip`）；样式 `src/renderer/styles.css`（chip 复用资产标签 chip 视觉语言，选中环与资产卡片一致） | `tests/e2e/tag-management.test.ts`（grid 存在 + 旧 `.tag-management-list` 为 0） | 未执行（无 Computer Use，移交人工） |
| 名称/数量排序 | `src/renderer/tag-management-model.ts` `sortTags`（数量键用 A→Z 名称兜底且方向不翻转） | `tests/unit/tag-management-model.test.ts`（sortTags 4 例）+ E2E 方向翻转断言 | 未执行 |
| 选择模型（单击/Ctrl/Shift，与资产画布一致） | `tag-management-model.ts` `applyTagSelectionClick` + 组件接线 | 单测 7 例（含降级、反向范围、追加）+ E2E 多选计数与 Esc 清除 | 未执行 |
| 右键菜单（单选：浏览/重命名/删除；多选：AND/OR/合并/删除） | `TagManagementWorkspace.tsx` 本地复用 `ContextMenuBackdrop/ContextMenu/ContextMenuItem`（`onClose` 覆盖，不扩 descriptor 联合体） | E2E 单选/多选菜单项断言 | 未执行 |
| AND 搜索「包含 N 个标签」 | `src/renderer/App.tsx` `tagFilterMatch` 状态 + `currentQueryDefinition` 拆分为每标签一个 clause（worker 既有行为：clause 间 AND、clause 内 OR） | `tests/worker/search.test.ts` 新增「ANDs separate single-value tag clauses」 | 未执行 |
| OR 搜索「含有任一标签」 | 同上，`match: "any"` 走既有单 clause 多值路径 | 同上 worker 测试的 OR 对照 + E2E 菜单项存在 | 未执行 |
| 合并标签（用户命名新标签） | App `handleMergeTagsInManagement` → 既有 worker `mergeTags`（36il 回退时保留）；组件合并对话框（`Intl.ListFormat` 本地化名单） | E2E 合并流程（2→1，源标签消失） | 未执行 |
| 批量删除 + TAG-003 回归 | App `handleDeleteTagsInManagement`（单个走 `deleteTag`，多个走既有 `deleteTags`）；确认框改用标准 `.dialog-backdrop` + `.create-dialog` 模态 | E2E 删除流程（菜单→确认→chip 消失） | 未执行 |
| 双击仅浏览被双击标签 | 组件 `onDoubleClick` → `chooseTag`（与选择无关） | E2E 双击后管理页卸载、画布恢复 | 未执行 |
| 画布事件隔离（根因修复） | 组件根节点 `onMouseDown` stopPropagation，阻断 `.workspace-canvas` 的框选/focus steal 吞掉管理页交互（TAG-003 疑似根因之一：旧版未隔离） | E2E 全流程隐式覆盖 | 未执行 |

## 关键设计决定

- **不扩 context-menu descriptor 联合体**：管理页菜单是自包含本地状态 + 复用菜单原语（`ContextMenuBackdrop` 支持 `onClose` 覆盖，`ContextMenuItem` 的全局 `close()` 为空操作），避免改动 1400+ 行的 `AssetContextMenu.tsx` 和 7 个既有 descriptor 分支（纪律 #8）。
- **选择集剪枝用派生而非 effect**：删除/合并后失效 id 在 `prunedSelectedIds` 派生层过滤，每次选择转移以其为基准自清洁；避免 `react-hooks/set-state-in-effect` 违规。
- **AND 语义零 worker 改动**：`FilterClause` 文档既有约定「clause 间 AND、clause 内 OR」，渲染层在 `match === "all"` 时拆分即可；过滤栏手动编辑会重置为 `any`。
- **多选右键目标解析**：右键未选中 chip 时选择集折叠为该 chip（与资产画布一致），`resolveTagMenuTargetIds` 纯函数覆盖。
- **tagFilterMatch 不持久化**：会话内状态，浏览偏好恢复后回到 OR；AND/OR 跳转不写入导航历史（复合过滤无单一 tagId 可记录）。遗留项，见下。

## 验证记录（当次命令 + 结果）

- `npm run typecheck`：通过。
- `npx eslint <改动文件>`：新模块 0 findings；`App.tsx` 的 4 处 `set-state-in-effect` 为 HEAD 既有（`git show HEAD:src/renderer/App.tsx | eslint --stdin` 同样报错），非本次引入。
- `npx vitest run tests/unit/tag-management-model.test.ts`：14/14 通过。
- `npm run test:unit`：1375 passed / 1 failed —— 失败为 `audio-extracted-metadata-fixture.test.ts` 读取硬编码 macOS 绝对路径（`23a1fd1` 引入的既有 Windows known-red），与本次无关。
- `node scripts/run-vitest-with-electron.mjs run tests/worker/search.test.ts`：74 passed / 6 failed —— 6 个失败全部是 HEAD 既有 FTS 规范化断言（括号包裹语义），与本次无关；新增 AND clause 测试单独 `-t` 运行通过（1/1）。
- `node scripts/run-e2e.mjs tests/e2e/shell-navigation.test.ts`：失败 —— HEAD 既有：`SortModeControl` 的 `aria-label="排序: 名称, 升序"` 与建库输入框争抢 `getByLabel('名称')` strict mode。与本次无关，但值得修（另开工单）。
- `node scripts/run-e2e.mjs tests/e2e/tag-management.test.ts`：**1 passed（2.6s）**——创建/chip 网格非行列表/默认名称升序/方向翻转/单选+Ctrl 多选/Esc 清除/单选与多选右键菜单/内联重命名/合并 2→1/删除确认（TAG-003 守卫）/双击退出管理页全链路通过。

## 2026-07-24 用户实测修复（第二轮）

用户实测发现两处问题，均已定位根因并修复：

1. **点击「标签管理」立即跳回「所有资产」**：根因不在本次新代码——`enterTagManagement` 会清空过滤控件（mqp 基线行为），而全局过滤防抖 effect（`App.tsx`）把「过滤从有到无」解读为「清空过滤→显示全部」，200ms 后静默搜索，其响应处理器 `executeSearchDefinition` 无条件 `setShowTagManagement(false)`。只要进入管理页前有任何过滤输入就 100% 复现；2026-07-21 macOS 验收时从干净状态进入所以未暴露。修复：防抖 effect 增加 `showTagManagement` 守卫并加入 deps——进入时清掉待定计时器、管理页存续期间不再派发自动搜索；显式提交搜索（回车）仍会退出管理页看结果（`runSearch` 显式路径不变）。
2. **管理页上半区大片空白**：`.workspace-canvas` 是 `display: grid; place-items: center`（为空态/预览居中），mqp 旧版同样被垂直居中。修复：`.tag-management` 加 `align-self: start` 顶对齐。

E2E 同步补强：`tag-management.test.ts` 新增「带过滤输入进入管理页不跳走」（填充全局搜索→进入→等待 500ms 仍可见）与「页面顶对齐」（workspace 与 canvas 顶距 < 60px）断言。

## 未验证 / 遗留项（按纪律如实记录）

- **Computer Use / 视觉验收未执行**：本环境无桌面控制能力，chip 视觉、选中环、菜单观感移交人工 QA。
- **Windows-only**：本机即 Windows；macOS 未验证。
- **全量 `npm run test` / `test:e2e` 未跑**：按纪律 #13 本次只跑定向测试；合流前需全量门禁。`tag-management.test.ts` 已挂入 `package.json` 的 `test:e2e` / `test:e2e:isolated` 清单。
- **`tagFilterMatch` 会话态**：刷新/恢复浏览偏好后 AND 退化为 OR；AND/OR 视图不进历史导航。
- 本机 beads 缺 `gilc`/`bfhc`/`36il`/`k6g6` 工单（dolt 未认证拉取失败）；关闭 TAG-003 相关工单需在 mac 端或认证后执行。
