# 0017/0018 可搜索标签选择器与文件操作命令 — 开发日志

> 日期：2026-07-17
> 范围：REQ-TAG-004（右键菜单标签操作改可搜索二级选择器）、REQ-MENU-002 部分（在 Finder/Explorer 中显示、复制文件路径）、REQ-COMMAND-003（路径不越界）
> 执行方式：主 agent 拆派 2 个编码 subagent 并行（选择器 / IPC 管线），主 agent 集中集成、测试、审查与文档；另 1 个 subagent 更新 E2E 选择器契约，2 个审查 subagent 做 Standards/Spec 双轴。

## 四列可追溯

| 需求 | 实现 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| REQ-TAG-004 可搜索选择器（单资产添加、批量添加/移除） | `src/renderer/TagPickerMenu.tsx`、`src/renderer/tag-picker-candidates.ts`、`src/renderer/AssetContextMenu.tsx:156-184,356-378,582-594` | `tests/unit/tag-picker-candidates.test.ts`（8 用例）；E2E 两步交互 `organization-search-trash.test.ts`、`organization-metadata-persistence.test.ts`、`browsing-preferences.test.ts`；选择器交互 `context-menu.test.ts:681` | Computer Use **未执行**（本环境无桌面控制能力），移交人工 QA |
| TAG-008 零使用不进 Inspector 建议（保持） | `src/renderer/tag-suggestions.ts` 委托 `buildTagAssignCandidates` 默认 `includeUnusedTags:false` | `tests/unit/tag-suggestions.test.ts`、`tests/unit/tag-picker-candidates.test.ts:35` | 已由用户此前验收，回归保持 |
| REQ-MENU-002 在 Finder/Explorer 中显示 | `AssetContextMenu.tsx:491-501` → `App.tsx:2691-2703` → `preload/index.ts:764-768` → `main/index.ts:1801-1820`（`shell.showItemInFolder`） | `tests/unit/protocol.test.ts:283,605` | 无 E2E（openExternal 同先例）；Computer Use 未执行 |
| REQ-MENU-002 复制文件路径 | `AssetContextMenu.tsx:527-537` → `App.tsx:2705-2721` → `preload/index.ts:770-774` → `main/index.ts:1821-1840`（`clipboard.writeText`） | 同上 | 同上 |
| REQ-COMMAND-003 绝对路径不越界 | 请求/响应仅携带 assetId（`protocol/requests.ts:471-481`、`responses.ts:620-629`）；Worker 界内解析（`worker/index.ts:921` 既有 `media.get-asset-path`） | `protocol.test.ts` 双向伪造 `absolutePath` 注入被拒 | — |

REQ-MENU-002 仍缺口：其他应用打开、复制、粘贴（语义挂澄清队列 #5）、重命名（REQ-LABEL-002 排 0017）。

## 关键决策

1. **零使用标签三分语义**：菜单添加选择器包含零使用标签（`includeUnusedTags`）——选择器无创建入口，新建未用标签须可从菜单再添加；移除选择器与 Inspector 建议不包含（TAG-008 用户已验收语义保持）。这是 E2E 首轮 3 失败（侧栏新建标签无法从菜单添加）的根因修复，非补丁：语义写入模块头注释与单测。
2. **菜单内滚动豁免（审查 HARD-1 修复）**：`context-menu.tsx` backdrop 的 document capture scroll-dismiss 原为无条件关闭；选择器候选区（240px 独立滚动）与键盘 `scrollIntoView` 会触发它，恰好摧毁"大量标签"这一 REQ-TAG-004 目标场景。修复为豁免菜单内部 scroll 事件（与外点关闭同一 contains 判定）；画布/导航/文档滚动仍关闭菜单（MENU-006 语义不变，`context-menu.test.ts:45` 用例保持绿）。
3. **返回后焦点恢复（审查 MEDIUM-1 修复）**：选择器「返回」后菜单初始聚焦 effect 不重跑，焦点落 body；现 `onBack` 在下一帧把焦点还给触发入口项，键盘导航不断裂。
4. **选择器形态**：菜单内原地替换视图（非二级浮层），复用 ContextMenu 的 clamp/flip 与关闭链路；`context-menu.tsx` 本体除滚动豁免外零改动。
5. **搭车修复 0016-A 合并遗留失效选择器**：`.brand-mark` 已随壳层清理移除（→ `.item-count`）；侧栏新增「导入链接文件夹」secondaryAction 导致同名按钮两处命中（→ 按状态作用域 `.tool-group-import`）。**注意**：`tests/e2e/linked-folders.test.ts` 为另一 agent 未提交改动，其选用的 `.empty-actions` 作用域下并不存在该按钮（empty-actions 只有导入文件/导入文件夹），本回合保持其文件不动，正确方向应为 `.tool-group-import` 或侧栏 `getByLabel`。

## 验证证据（当次命令与结果）

- `npm run typecheck` ✅ / `npm run lint` ✅（03:05 最终状态）
- `npm run test:unit` ✅ 39 文件 391 passed（含新 candidates/protocol 用例）
- E2E 当次全量（17 文件中 16 个）：organization-search-trash 4/4、organization-metadata-persistence 2/2、browsing-preferences、context-menu 10/10（含新选择器用例）、selection-marquee、trash-relink-flow、media-preview 17/17、asset-pagination/managed-move/media-video-playback 3/3、library-lifecycle/asset-ingestion/process-lifecycle/desktop-ingestion 10/10、shell-navigation/library-recent 2/2 ✅
- `linked-folders.test.ts` 3/3 ❌：0016-A 侧栏按钮重复命中 + 另一 agent 进行中的 `.empty-actions` 修正方向错误（见决策 5）；该文件未提交、未触碰，移交该 agent。
- 双轴审查（2 审查 subagent）：Standards 通过（0 HARD）；Spec 有条件通过 —— HARD-1（滚动关闭）、MEDIUM-1（焦点）已本回合修复并 E2E 复验；MEDIUM-2 证据缺口已补选择器交互 E2E；MEDIUM-3 文档与本提交同批。
- Computer Use：**未执行**（当前环境无真实桌面控制能力，按 AGENTS.md 移交人工 QA），截图证据缺失。

## 后续

- TAG-004/TAG-005：实现与自动化完成；Computer Use/截图证据补齐后方可重新进入人类验收。
- 0017 剩余：复制/粘贴、重命名、其他应用打开、文件夹领域命令、文件夹卡片。
- 0018 剩余：标签过滤入口（REQ-TAG-002）。
