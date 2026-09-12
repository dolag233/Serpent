# `INVALID_IMPORT_DECISION` 误用审计（2026-09-12）

> 触发：工单 `Serpent-50c466`（INVALID_IMPORT_DECISION 用于非导入非法状态）。
> 本报告是**独立第二意见筛查**：只读源码，不修改任何源文件，只新增本文件。
> 范围：`INVALID_IMPORT_DECISION` 全量调用点分类 + 同类文案错配的扩大筛查 + 最小 Phase-1 修复建议。
> 未运行任何测试（vitest/Electron），纯静态审计。

## 0. 快照与前提（重要）

审计开始时工作树是**脏的**（主 agent 正在实现本工单）；审计过程中该实现已提交为 **`e5292edf`**（`fix(errors): 回收站/恢复/删除等非法状态改用专用错误码（Serpent-50c466 Phase 1）`）。我已核对：提交后的 `src/worker/library-service.ts` blob 与我审计时读取的工作树内容**完全相同**（`ba3afcf3e2e4d2491350f7812aae1a0e6d97f1aa`），因此本报告所有 `file:line` 对 `e5292edf` 有效。

| 项 | 值 |
|---|---|
| `HEAD`（fix 之后） | `e5292edf` |
| fix 之前的基线 | `a1d2a3e9` |
| 审计的 `src/worker/library-service.ts` blob（工作树 == `e5292edf`） | `ba3afcf3e2e4d2491350f7812aae1a0e6d97f1aa` |
| `src/main/index.ts` blob | `27bf2be614f74726ec12dabdd0dc3935cc06f0a8`（本工单未改动） |
| `e5292edf` 的改动 | `library-service.ts` +100/-55；`errors.ts` +10；两个 catalog 各 +4；`trash-relink.test.ts` 11 处断言改写；新增 `tests/unit/error-state-transition-copy.test.ts`；另有开发日志与验收清单更新 |

因此本报告的 `file:line` 一律指 **`e5292edf` 之后的工作树**。行号已按 fix 造成的位移重新核对；`library-service.ts` 的偏移规律是：`>14221` 之后 +6 行、`>35558` 之后 +9 行、`>36440` 之后 +12 行（相对 fix 之前的 `a1d2a3e9`）。§2.1 用当前行号（仍在使用旧码的 37 处可以直接搜到），§2.2 同时给出基线行号与当前行号（已改的 40 处只能搜到新码）。

---

## 1. Method

执行的命令 / 检索（均为只读）：

```bash
git status --short
git diff -U2 -- src/worker/library-service.ts src/shared/protocol/errors.ts src/renderer/i18n/catalogs/{zh-CN,en}.ts tests/worker/trash-relink.test.ts
git hash-object src/worker/library-service.ts src/main/index.ts
git log --oneline -3
git show e5292edf:src/worker/library-service.ts | git hash-object --stdin   # 与工作树 blob 比对
```

```
rg -n "INVALID_IMPORT_DECISION" src tests                      # 97 处命中
rg -n "INVALID_STATE_TRANSITION|ASSET_ALREADY_TRASHED|ASSET_NOT_TRASHED|ASSET_NOT_MANAGED" src
rg -n "FOLDER_ALREADY_EXISTS|FOLDER_NAME_CONFLICT" src/worker/library-service.ts
rg -n "FOLDER_NOT_FOUND" src/worker/library-service.ts          # 91 处（改后 71 处纯 throw 形式）
rg -n "FOLDER_NOT_EMPTY|PLUGIN_HOOK_BLOCKED|HISTORY_TOO_LARGE|SYNC_IN_PROGRESS|AUTOMATION_UNDO" src
rg -n "INTERNAL_ERROR" src
rg -n "VERSION_CONFLICT" src
rg -n "IMPORT_APPLY_FAILED|IMPORT_COLLECTION_ASSIGN_FAILED|AUTOMATION_FILE_PLAN_INVALID" src
rg -n "INVALID_IMPORT_SOURCE" src                                # 126 处
rg -n "INVALID_DROP_SELECTION" src
rg -n "toMessage\(|messageForPublicError\(" src/renderer          # 155 处
rg -n "error\.message" src/renderer                              # 24 处
rg -n "deleteAssetsFromDisk\(|deleteAssetsFromDiskAsync\(" src
rg -n "moveManagedFolders|trashSelection|restoreAssets|deleteAssetsPermanent|createImageSequence|clearAiContent|relinkAsset|setIgnore|renameAssetFiles|previewAutomationFileOperation" src/worker/index.ts
```

**调用点总数**

| 类别 | 数量 |
|---|---|
| 基线 `a1d2a3e9` 上生产代码中的 `INVALID_IMPORT_DECISION` 调用点 | **77**（`src/worker/library-service.ts` 73 + `src/main/index.ts` 4） |
| 当前 `e5292edf` 中**仍保留**的调用点 | **37**（worker 33 + main 4） |
| `e5292edf` 已改写的调用点（→ 44 个新抛出点：4 处 `if (A \|\| B)` 被拆成两条分支） | **40** |
| 测试中的断言/注释（`tests/**`） | **17**（`trash-relink` 11、`search` 2、`organization` 1、`model-pipeline` 1、`import-planning` 1、`comprehensive-perf-bench` 1 条注释） |
| 协议定义 / i18n 文案 | 3（`src/shared/protocol/errors.ts:25`、`zh-CN.ts:2099`、`en.ts:2116`） |

分类口径（全报告统一）：

- **legit-import**：该码 + 该文案确实在描述"导入冲突处理选项"。
- **misuse**：文案与场景无关（本工单的病灶）。
- **internal-invariant**：文案同样无关，但只有当内部调用方违反契约（UI/MCP 层已拦截）时才会到达。

文案通路已核实：Worker `LibraryServiceError` → `publicErrorForWorkerFailure`（`src/worker/public-error.ts:89-101`，保留 `error.code`）→ Main 原样透传（`src/main/index.ts:4311`）→ Renderer `toMessage`/`messageForPublicError`（`src/renderer/error-utils.ts:30-99`）按 `error.code` 取 catalog 文案。**所以这些码会以 zh-CN 文案「导入冲突处理选项无效。」原样出现在界面上**，不是内部日志。

`INVALID_IMPORT_DECISION` 的中英文文案：

- `src/renderer/i18n/catalogs/zh-CN.ts:2099` → 「导入冲突处理选项无效。」
- `src/renderer/i18n/catalogs/en.ts:2116` → `"Import conflict decision is invalid."`
- 协议原文 `src/shared/protocol/errors.ts:25` → `'Choose a valid import conflict decision.'`

---

## 2. Inventory：每一个 `INVALID_IMPORT_DECISION` 调用点

### 2.1 工作树中仍在使用该码的调用点（37）

| # | file:line | 所在函数 | 触发场景 | verdict | 建议替换 |
|---|---|---|---|---|---|
| 1 | `src/worker/library-service.ts:11122` | `previewAutomationFileOperation` | `assetIds` 为空或含重复 | misuse | `INVALID_SELECTION`（新）或 `AUTOMATION_FILE_PLAN_INVALID` |
| 2 | `src/worker/library-service.ts:11130` | `previewAutomationFileOperation` | `move` 的 `targetFolderId` 不存在 | misuse | `FOLDER_NOT_FOUND`（同文件 `12705` 对同一场景已这么用） |
| 3 | `src/worker/library-service.ts:15846` | `setLinkedFolderRules` | 规则 >200 条或 `ruleId` 重复 | misuse | `INVALID_SELECTION`（新） |
| 4 | `src/worker/library-service.ts:16034` | `copyLinkedAssetsToManagedFolder` | `assetIds` 为空或重复 | misuse | `INVALID_SELECTION`（新） |
| 5 | `src/worker/library-service.ts:16576` | `createImageSequence` | `fps` 非有限 / <1 / >240 | internal-invariant | 无合适既有码；对话框已拦截（`ImageSequenceDialog.tsx:33,103`），列 Phase-2 |
| 6 | `src/worker/library-service.ts:16580` | `createImageSequence` | 去重后 <3 个或含重复 id | internal-invariant | `INVALID_SELECTION`（新） |
| 7 | `src/worker/library-service.ts:16596` | `createImageSequence` | 选中项缺文件/已回收/不可用/已成序列 | misuse | `ASSET_STATE_CONFLICT`（新） |
| 8 | `src/worker/library-service.ts:16599` | `createImageSequence` | 选中图片不在同一目录 | **misuse（用户可达）** | `INVALID_SELECTION`（新）+ 新 reason `IMAGE_SEQUENCE_SELECTION` |
| 9 | `src/worker/library-service.ts:16602` | `createImageSequence` | 文件名不构成同一组序列 | **misuse（用户可达）** | 同上 |
| 10 | `src/worker/library-service.ts:16663` | `setImageSequenceFps` | `fps` 越界 | internal-invariant | 同 #5 |
| 11 | `src/worker/library-service.ts:19496` | `clearAiContent` | `folder`/`library` scope 未带 `confirm` | internal-invariant | 无既有码；Phase-2（或新增 `CONFIRMATION_REQUIRED`） |
| 12 | `src/worker/library-service.ts:19512` | `clearAiContent` | `folder` scope 缺 `folderId` | misuse | `FOLDER_NOT_FOUND`（既有） |
| 13 | `src/worker/library-service.ts:21100` | `generateThumbnail` | `mediaType === 'other'` 或图片无解码器 | internal-invariant | 无既有码；Phase-2（建议 `UNSUPPORTED_MEDIA_TYPE`） |
| 14 | `src/worker/library-service.ts:26866` | `resolveModelCompanions` | 非受支持模型扩展名 | internal-invariant | 同 #13 |
| 15 | `src/worker/library-service.ts:26912` | `enqueueArtifactRetry` | `kind` 与资产媒体类型不符 | internal-invariant | 同 #13 |
| 16 | `src/worker/library-service.ts:31807` | `createSmartCollection` | `queryDefinitionJson` 解析失败（>64 KiB 或 schema 不符） | **misuse（用户可达）** | `INVALID_SMART_COLLECTION_QUERY`（**既有**） |
| 17 | `src/worker/library-service.ts:31935` | `updateSmartCollection` | 同上 | **misuse（用户可达）** | `INVALID_SMART_COLLECTION_QUERY`（既有） |
| 18 | `src/worker/library-service.ts:32036` | `parseSmartCollectionDefinition` | 形参类型联合 `'INVALID_IMPORT_DECISION' \| 'LIBRARY_CORRUPT'` | misuse（类型声明） | 改成 `'INVALID_SMART_COLLECTION_QUERY' \| 'LIBRARY_CORRUPT'` |
| 19 | `src/worker/library-service.ts:32300` | `placeManagedRelinkFile` | 目标路径已被占用（重定位落盘前） | misuse | `ASSET_FILE_NAME_CONFLICT`（既有）+ reason `SOURCE_CHANGED` |
| 20 | `src/worker/library-service.ts:32360` | `placeManagedRelinkFile` | 创建目录后目标再次出现 | misuse | 同上 |
| 21 | `src/worker/library-service.ts:33933` | `readTextAsset` | 资产媒体类型不是 `text` | internal-invariant | Phase-2 `UNSUPPORTED_MEDIA_TYPE` |
| 22 | `src/worker/library-service.ts:33975` | `readTextAsset` | 内容含 NUL（二进制伪装文本） | internal-invariant | 同上 |
| 23 | `src/worker/library-service.ts:34038` | `saveTextAsset` | 非文本资产写回 | internal-invariant | 同上 |
| 24 | `src/worker/library-service.ts:38222` | `normalizeLinkedFolderRule` | 规则 pattern 为空 / >512 / 含 NUL / 扩展名 pattern 去点后为空 | **misuse（用户可达）** | `INVALID_FOLDER_NAME`（既有） |
| 25 | `src/worker/library-service.ts:38228` | `normalizeLinkedFolderRule` | `target: 'path'` 的 pattern 不合法 | **misuse（用户可达）** | `INVALID_FOLDER_NAME` |
| 26 | `src/worker/library-service.ts:38232` | `normalizeLinkedFolderRule` | 非 path 规则含 `/`、`\`、`.`、`..` | **misuse（用户可达）** | `INVALID_FOLDER_NAME` |
| 27 | `src/worker/library-service.ts:38237` | `normalizeLinkedFolderRule` | 清理前导点后为空 | **misuse（用户可达）** | `INVALID_FOLDER_NAME` |
| 28 | `src/worker/library-service.ts:38247` | `normalizeExplicitIgnorePath` | 忽略路径不合法 | internal-invariant | `INVALID_FOLDER_NAME` |
| 29 | `src/worker/library-service.ts:38594` | `setIgnore` | 扩展名忽略项含 `/` 或 `\` | internal-invariant | `INVALID_FOLDER_NAME` |
| 30 | `src/worker/library-service.ts:39529` | `prepareImport` | 目标文件夹是链接文件夹（调用方该用 `prepareOrExecuteImport`） | internal-invariant | `INTERNAL_ERROR`（内部契约守卫，非用户面）或 `AUTOMATION_FILE_PLAN_INVALID` |
| 31 | `src/worker/library-service.ts:41096` | `resolveImport` | 该导入正在等待"源失败"决定（`awaitingSourceFailureDecision`） | internal-invariant | 无既有码；Phase-2 |
| 32 | `src/worker/library-service.ts:41104` | `resolveImport` | 失败时把 `INVALID_IMPORT_DECISION` 写进 `file_operations.error_code` | **legit-import** | 保留 |
| 33 | `src/worker/library-service.ts:41106` | `resolveImport` | `suspectedDuplicate` / `nameConflict` 取值非法 | **legit-import** | 保留（与文案完全一致） |
| 34 | `src/main/index.ts:4219` | `ai.config.set.request` 分支 | 打开"自动分析"但未接受数据发送说明 | **misuse（UI 面）** | `AI_ANALYSIS_FAILED`（既有）+ reason `AI_NOT_CONFIGURED`（既有） |
| 35 | `src/main/index.ts:4225` | `ai.config.set.request` 分支 | 没有 API Key 也没有已保存的 Key | **misuse（UI 面）** | 同上 |
| 36 | `src/main/index.ts:4652` | `asset.import-sequence.confirm` 分支 | `sequenceIndex` 不等于 `nextSequenceIndex`（对话框过期） | misuse | `IMPORT_NOT_FOUND`（同一分支 4638/4644 对"offer 失效"已这么用） |
| 37 | `src/main/index.ts:4667` | `asset.import-sequence.confirm` 分支 | 所选帧区间解析后没有任何源文件 | misuse | `INVALID_SELECTION`（新）或 `IMPORT_NOT_FOUND` |

### 2.2 `e5292edf` 已改写的调用点（40）— 我的独立复核

`git diff a1d2a3e9..e5292edf` 显示主 agent 把 40 处改写为 4 个新码：`ASSET_ALREADY_TRASHED`、`ASSET_NOT_TRASHED`、`ASSET_NOT_MANAGED`（`src/shared/protocol/errors.ts:65-69`）与 `INVALID_STATE_TRANSITION`（`errors.ts:70-71`）。我对每一条的判定：

| 原 site（`HEAD` 行号） | 现 site（工作树行号） | 所在函数 / 场景 | 新码 | 我的复核 |
|---|---|---|---|---|
| 12691 | 12691 | `moveManagedFolders`：`folderIds` 空/重复 | `INVALID_STATE_TRANSITION` | **错配**（参数非法 ≠ 库状态变更） |
| 13518 | 13518 | `deleteLinkedFolderSubtree`：`relativePath` 不可规范化 | `INVALID_STATE_TRANSITION` | **错配**（应为 `INVALID_FOLDER_NAME`） |
| 13648 | 13648 | `resolveLinkedDirectoryMutationTarget`：同上 | `INVALID_STATE_TRANSITION` | **错配**（应为 `INVALID_FOLDER_NAME`） |
| 14068 | 14068 | `deleteActiveManagedAssetsFromDisk`：查不到活动 managed 行 | `INVALID_STATE_TRANSITION` | 合理 |
| 14151 | 14151 | `deleteActiveManagedAssetsFromDiskAsync`：同上 | `INVALID_STATE_TRANSITION` | 合理 |
| 14200 | 14200 | `deleteAssetsFromDiskAsync`：id 空/重复 | `INVALID_STATE_TRANSITION` | **错配** |
| 14224 | 14224 | `deleteAssetsFromDiskAsync`：`location_kind !== managed` | `ASSET_NOT_MANAGED` | 正确 |
| 14227 | 14227 | `deleteAssetsFromDiskAsync`：`deleted_at !== null` | `ASSET_ALREADY_TRASHED` | 正确 |
| 14230 / 14233 / 14236 | 14230 / 14233 / 14236 | 同上，批量后置校验拆分 | `INVALID_STATE_TRANSITION` / `ASSET_NOT_MANAGED` / `ASSET_ALREADY_TRASHED` | 三条均合理（14230 为状态兜底） |
| 33102 | 33108 | `moveAssets`：id 空/重复 | `INVALID_STATE_TRANSITION` | **错配** |
| 33121 | 33127 | `moveAssets`：链接源 → 链接目标 | `INVALID_STATE_TRANSITION` | **错配**（应为 `INVALID_SELECTION`） |
| 33331 | 33337 | `copyAssets`：id 空/重复 | `INVALID_STATE_TRANSITION` | **错配** |
| 33372 | 33378 | `copyAssets`：managed/linked 混批 | `INVALID_STATE_TRANSITION` | **错配** |
| 35169 | 35175 | `renameAssetFiles`：items 空/重复 | `INVALID_STATE_TRANSITION` | **错配** |
| 35272 | 35278 | `trashAssets`：id 空/重复 | `INVALID_STATE_TRANSITION` | **错配** |
| 35283 | 35289 | `trashAssets`：序列展开后空/重复 | `INVALID_STATE_TRANSITION` | **错配** |
| 35309 | 35315 | `trashAssets`：非 managed | `ASSET_NOT_MANAGED` | 正确（文案也贴合：链接文件夹文件请在文件管理器处理） |
| 35310 | 35316 | `trashAssets`：已回收 | `ASSET_ALREADY_TRASHED` | 正确（工单主诉场景之一） |
| 35484 | 35490 | `trashSelection`：资产+文件夹都为空 | `INVALID_STATE_TRANSITION` | **错配** |
| 35492 | 35498 | `trashSelection`：重复 / >10 000 | `INVALID_STATE_TRANSITION` | **错配** |
| 35555 | 35561 / 35564 | `trashSelection`：非 managed / 已回收 | `ASSET_NOT_MANAGED` / `ASSET_ALREADY_TRASHED` | 正确 |
| 35698 | 35707 | `previewRestoreAssets`：id 空/重复 | `INVALID_STATE_TRANSITION` | **错配** |
| 35725 | 35734 | `previewRestoreAssets`：资产存在但未回收 | `ASSET_NOT_TRASHED` | 正确（工单主诉场景之二） |
| 35782 | 35791 | `restoreAssets`：id 空/重复 | `INVALID_STATE_TRANSITION` | **错配** |
| 35789 | 35798 | `restoreAssets`：序列展开后空/重复 | `INVALID_STATE_TRANSITION` | **错配** |
| 35824 | 35833 | `restoreAssets`：资产存在但未回收 | `ASSET_NOT_TRASHED` | 正确 |
| 36278 | 36287 | `restoreAssetsIfOriginalVacant`：id 空/重复 | `INVALID_STATE_TRANSITION` | **错配** |
| 36282 | 36291 | 同上（序列展开后） | `INVALID_STATE_TRANSITION` | **错配** |
| 36305 | 36314 | `restoreAssetsIfOriginalVacant`：未回收 | `ASSET_NOT_TRASHED` | 正确 |
| 36392 | 36401 | `deleteAssetsFromDisk`：id 空/重复 | `INVALID_STATE_TRANSITION` | **错配** |
| 36425 | 36434 / 36437 | `deleteAssetsFromDisk`：非 managed / 已回收 | `ASSET_NOT_MANAGED` / `ASSET_ALREADY_TRASHED` | 正确 |
| 36428 | 36440 | `deleteAssetsFromDisk`：兜底 | `INVALID_STATE_TRANSITION` | 合理（状态类兜底） |
| 36490 | 36502 | `deleteAssetsPermanent`：id 空/重复 | `INVALID_STATE_TRANSITION` | **错配** |
| 36520 | 36532 | `deleteAssetsPermanent`：活动资产被永久删除 | `ASSET_NOT_TRASHED` | 正确（文案"请先移入回收站"贴合） |
| 36522 | 36534 | `deleteAssetsPermanent`：混批兜底 | `INVALID_STATE_TRANSITION` | 可接受 |
| 37330 | 37342 | `deleteLinkedAssets`：空 / >20 | `INVALID_STATE_TRANSITION` | **错配** |
| 37333 | 37345 | `deleteLinkedAssets`：重复 id | `INVALID_STATE_TRANSITION` | **错配** |
| 37363 | 37375 | `deleteLinkedAssets`：managed 资产走链接删除 | `INVALID_STATE_TRANSITION` | **错配**（应为 `INVALID_SELECTION`/`ASSET_NOT_MANAGED`） |
| 37585 | 37597 | `relinkAsset`：已回收 | `ASSET_ALREADY_TRASHED` | 正确 |
| 37586 | 37598 | `relinkAsset`：`availability !== 'missing'` | `INVALID_STATE_TRANSITION` | 可接受（自动修复/后台任务确实可能刚改过） |

**结论**：`ASSET_ALREADY_TRASHED` / `ASSET_NOT_TRASHED` / `ASSET_NOT_MANAGED` 15 处判定我全部认同（另有 4 处把原来的 `if (A || B) throw` 拆成两条分支，故 40 个原 site 变成 44 个新抛出点）；`INVALID_STATE_TRANSITION` 共 29 处，其中 **23 处是"参数/选择非法"却被写成"库状态被别的窗口改过、请刷新磁盘变化"**，属于同一类文案错配（详见 §4.1），6 处（`14068, 14151, 14230, 36440, 36534, 37598`）判定合理。测试里已经把其中 4 处固化成期望值（`tests/worker/trash-relink.test.ts:1202,1296,1776,1931` 改成 `INVALID_STATE_TRANSITION`），改码时需要一并改测试。

---

## 3. Reachability（每个 misuse 的用户可达性）

判定依据：Renderer 调用链（`src/renderer/*` → `src/preload/index.ts` → `src/main/index.ts` → `src/worker/index.ts` → `src/worker/library-service.ts`）与 MCP/脚本命令注册表（`src/automation/command-registry.ts`）。

### 3.1 普通用户操作可达（Renderer UI）

| site | 用户操作 | 证据链 |
|---|---|---|
| `library-service.ts:16599, 16602`（创建序列图：跨文件夹 / 文件名不成组） | 在"全部资产/标签/合集"等可跨文件夹选择的视图里选中 ≥3 张图片 → 右键「创建序列图…」→ 确认 | 菜单可用性只校验数量/媒体类型/可用性/未成序列，**不校验同一目录或命名模式**：`src/renderer/AssetContextMenu.tsx:1294-1302`；动作 `AssetContextMenu.tsx:1528` → `App.tsx:6236 createSelectedImageSequence` → `preload/index.ts:750` → `worker/index.ts:2529 asset.sequence.create` → `library-service.ts:16569 createImageSequence`。对话框直接把 `result.error.message` 显示出来（`App.tsx:6244`，且是英文原文，见 §4.6） |
| `library-service.ts:31807, 31935`（智能合集查询定义非法） | 内联保存/更新智能合集 | `use-inline-smart-collection-edit.ts:114-126`（失败文案直接取 `error.code.*` catalog）；`worker/index.ts` smart-collection.create/update |
| `library-service.ts:38222-38237`（链接文件夹过滤规则 pattern 非法） | 打开链接文件夹「过滤规则」对话框，在 pattern 输入框里输入空值、`a/b`、`..` 等 → 保存 | 输入框是自由文本：`LinkedRulesDialog.tsx:109-120`（`maxLength=512`，无格式校验）；保存 `App.tsx:7500-7520` → `preload/index.ts:1024` → `worker/index.ts:2689 linked-folder.rules.set` |
| `library-service.ts:35316`（回收已回收资产）— **已由在途 fix 修正** | 卡片已失效（另一窗口删除 / 撤销 / 后台收敛）后再点删除 | 原用户报告见 `docs/internal/reviews/2026-08-21-error-handling-deep-review.md:11-12,32`；测试固化 `tests/worker/trash-relink.test.ts:416-430` |
| `library-service.ts:35734`（预览恢复未回收资产）、`35833`（恢复未回收资产）— 已修 | 回收站视图过期时点「恢复」 | 同上用户报告；测试 `trash-relink.test.ts:1180-1191`、`1193-1209` |
| `library-service.ts:35561/35564`（混合删除里含链接/已回收项） | 失效卡片参与批量删除 | `App.tsx:8273 api.trashSelection`、`use-folder-drag-drop-handlers.ts:136` |
| `library-service.ts:14224/14227`（从硬盘删除时资产非 managed / 已回收）— 已修 | 「从硬盘删除」在状态过期时 | `App.tsx:8157`、`useBatchActions.ts:386` → `preload/index.ts:1580`（`asset.delete-from-disk.request`）→ `worker/index.ts:3317` |
| `library-service.ts:36532`（永久删除一个活动资产）— 已修 | 回收站视图过期时永久删除 | `App.tsx:8018 api.deleteAssetsPermanent` |
| `library-service.ts:37597/37598`（重定位已回收 / 已不缺失的资产）——已修 | 缺失资产的「重新定位」对话框期间文件被自动修复或资产被回收 | `App.tsx:8353 api.relinkAsset` |
| `library-service.ts:32300/32360`（重定位落盘时目标被占用） | 批量重定位在预览后、落盘前目标被外部创建 | `App.tsx:8407/8431` 批量重定位 → `worker/index.ts` asset.relink-batch.apply |
| `main/index.ts:4219/4225`（AI 设置保存） | AI 设置里打开自动分析但未接受数据说明 / 未填 Key | `App.tsx:9752-9777 persistAiConfig` → `setError(toMessage(result.error, …))`，即 toast 直接显示「导入冲突处理选项无效。」；同一条件在 `main/index.ts:4066,4074` 已经用 `AI_ANALYSIS_FAILED`+`AI_NOT_CONFIGURED` |
| `main/index.ts:4667`（序列导入确认解析不到文件） | 序列导入对话框选择帧区间 | `main/index.ts:4632 asset.import-sequence.confirm`；Renderer 对话框驱动 |

### 3.2 仅 MCP / 自动化 / 脚本可达（Renderer 已拦截）

| site | 触发方式 | 证据 |
|---|---|---|
| `library-service.ts:11122, 11130` | MCP/脚本 `asset.trash` 等文件计划预览传重复 `assetIds`、或 `move` 目标不存在 | 输入 schema 只做 `min(1).max(10_000)`，**不查重**：`command-registry.ts:600-605, 706-710`；计划预览 `command-registry.ts:2276-2290, 2744`、`main/automation-file-plan-approval.ts:72-73,131-132` |
| `library-service.ts:12691` | MCP `folder.move` 传重复 `folderIds` | `command-registry.ts:706-710`（无查重） |
| `library-service.ts:35278/35289`（trash id 空/重复） | MCP `asset.trash` 重复 id | 同上；注意先走后置校验，重复 id 会在这里被拦下 |
| `library-service.ts:36502` | MCP `asset.delete-permanent` 重复 id | `command-registry.ts:603-605` |
| `library-service.ts:35707, 35791, 35798, 36287, 36291` | MCP `asset.restore-if-original-vacant` / 脚本 `restoreIfOriginalVacant` 重复 id 或空数组 | `command-registry.ts:667, 2610-2631`、`scripting/serpent-guest-api.ts:496` |
| `library-service.ts:36314` | MCP 对未回收资产调用 `restore-if-original-vacant` | 同上 |
| `library-service.ts:33108/33127/33337/33378/35175/35490/35498/36401/37342/37345` | 参数/选择非法 | Renderer 侧已拆分 managed/linked（`use-asset-drag-drop-handlers.ts:95-139`）、按 20 分块（`useBatchActions.ts:240-261`），因此正常 UI 不会命中 |

### 3.3 仅防御（需要 bug 或违反内部契约）

`library-service.ts:14068/14151/14230/14236`（先自校验后必然一致）、`16570/16574/16657`（对话框已拦截 `ImageSequenceDialog.tsx:33`；菜单门槛 `AssetContextMenu.tsx:1294-1302`）、`19490/19506`（Renderer 只发 `scope.kind === 'asset'`：`App.tsx:10069-10073`）、`21094/26860/26906`（队列/查看器已按类型过滤）、`33927/33969/34032`（文本查看器只对 text 资产打开）、`38210/38235/38582`（路径来自库内数据，扩展名不可能含 `/`）、`39517`（调用方契约）、`41096`（Renderer 会先走 skip-source-failure）、`main/index.ts:4652`；连同 `35484/35492/35698/36425/36428/36522/37330/37333/37363/33102/33121/33331/33372/15840/16028`（Renderer 已按 managed/linked 拆分与 20 条分块：`use-asset-drag-drop-handlers.ts:95-139`、`useBatchActions.ts:240-261`）。

---

## 4. Wider screening：其他"文案与场景不匹配"的错误码

### 4.1 `INVALID_STATE_TRANSITION`（在途 fix 新增）被用于"参数非法"——23 处

新文案（`zh-CN.ts:2127`）：「资源库当前的状态不支持这一步（可能有另一个窗口或后台任务刚改过它）。请刷新磁盘变化后重试。」英文（`en.ts:2144`）："That action is not valid in the library's current state, which another window or background task may have changed. Refresh disk changes and try again."

但下列站点与"库状态被改过"无关，而是**调用参数为空/重复/类型不符**，用户按提示"刷新磁盘变化"永远不会好：

`library-service.ts:12691, 13518, 13648, 14200, 33108, 33127, 33337, 33378, 35175, 35278, 35289, 35490, 35498, 35707, 35791, 35798, 36287, 36291, 36401, 36502, 37342, 37345, 37375`（不在该列表内的另外 6 处——`14068/14151/14230/36440/36534/37598`——确实描述状态竞争，判定合理）。

影响面：MCP/脚本调用方（`command-registry.ts:600-605, 706-710` 允许重复 id）会收到一个把责任推给"另一个窗口"的提示；测试也已把它固化（`tests/worker/trash-relink.test.ts:1202, 1296, 1776, 1931`）。
建议：新增 `INVALID_SELECTION`（§5.2）承接这一族，`INVALID_STATE_TRANSITION` 只保留给真正的状态竞争（`14068/14151/14230/36440/36534/37598`）。

### 4.2 `FOLDER_ALREADY_EXISTS` 的文案是"恢复专用"，却用在创建路径

- 文案：`zh-CN.ts:2088`「当前位置已经存在同名文件夹或文件，**无法恢复到原路径**（不会覆盖）。请先改名或移走占用项后**再恢复**。」`en.ts:2103-2104` 同义。
- 非恢复场景的抛出点：`library-service.ts:12357`（`createManagedFolder`）、`9914`（文件夹创建的历史回放）、`12996`（自动命名后缀耗尽）、`16118`（链接转托管命名后缀耗尽）、`17084`、`17205`、`17291`、`17449`、**`31834`/`31954`（智能合集创建/重名）**、`36972`。
- 用户可见路径：内联文件夹新建/重命名会把该码的 catalog 文案直接显示在行内（`src/renderer/use-inline-folder-edit.ts:184-189`）；内联智能合集同理（`src/renderer/use-inline-smart-collection-edit.ts:120-126`）。即：**建一个重名文件夹/重名智能合集，会被告知"无法恢复到原路径…请先改名或移走占用项后再恢复"**。
- 补充：组织操作另一条路径已做过兜底映射（`App.tsx:13584-13585` 把 `FOLDER_ALREADY_EXISTS` 映射为 `toast.nameConflict`），这只掩盖了部分入口。
- 建议：创建/重名路径改用既有的 `FOLDER_NAME_CONFLICT`（`errors.ts:12`，文案中性），`FOLDER_ALREADY_EXISTS` 只留给恢复冲突。

### 4.3 `FOLDER_NOT_FOUND` 的文案是"资源库文件夹被移动/磁盘断开"，却用于标签、合集、智能合集

- 文案：`zh-CN.ts:2090`「找不到该资源库文件夹。它可能已被移动、重命名，或磁盘已断开。请重新连接磁盘，或再次选择该文件夹。」
- 明显错配的抛出点（举实测例）：
  - 标签：`library-service.ts:17604`（`tagRows.length !== input.tagIds.length` → 标签不存在）
  - 合集：`library-service.ts:18030, 18088, 18115`（`!col`）、`17890`
  - 智能合集：`library-service.ts:31920`（update 时不存在）、`31991`（delete 时不存在）、`32017`（execute 时不存在）
  - 其他非文件夹对象：`23110`、`30886`、`31169`、`31520`
- 影响：这些码经 `toMessage` 直接落 catalog（例如 `App.tsx:5220/5300/6960` 等），用户在处理标签/合集时会读到"磁盘可能已断开"。
- 建议（Phase-2）：为标签/合集/智能合集各加一个 `TAG_NOT_FOUND` / `COLLECTION_NOT_FOUND` / `SMART_COLLECTION_NOT_FOUND`（或统一 `RECORD_NOT_FOUND`），或至少给这些调用点补一个 reason。

### 4.4 `IMPORT_APPLY_FAILED` 被用在**回收站**流程（非导入）

- 站点：`library-service.ts:35350`（`trashAssets` 第一阶段 `lstatSync` 失败且不是"路径不可读"时）。
- 文案：`zh-CN.ts:2105`「导入在复制或登记完成前停止，没有静默覆盖已有文件。请检查磁盘空间和源文件是否仍可读取后重试；**已经导入成功的条目不必再选一次**。」
- 场景：用户在删除资产，却被告知"导入停止/已导入条目不必再选一次"。同一 try 块的失败兜底已经用 `LIBRARY_NOT_WRITABLE`（`library-service.ts:35469`、`35695` 的 `serviceError(error, 'LIBRARY_NOT_WRITABLE')`），说明这里属于漏用。
- 建议：改 `LIBRARY_IO_ERROR`（`errors.ts:55`，reason `IO_ERROR`）或与兜底一致用 `LIBRARY_NOT_WRITABLE`。

### 4.5 `VERSION_CONFLICT` 的"元数据被改过"文案被用在自动化计划失效

- 站点：`library-service.ts:39480, 39492`（`validateAutomationImportPlan`：`planHash`/`changeSequence`/`sourceStates` 与批准的计划不一致，`currentEntityVersion: plan.changeSequence`）。
- 文案：`errors.ts:71`/`zh-CN.ts:2131`「元数据已被其他操作修改。请刷新后重新编辑。」
- 场景：MCP/脚本审批过的文件计划过期，与"元数据编辑冲突"无关。既有更贴切的码：`AUTOMATION_FILE_PLAN_INVALID`（`errors.ts:26`）与 Gateway 层 `AUTOMATION_PLAN_STALE`（`src/shared/automation-host-command-error.ts:53`）。
- 建议：改用 `AUTOMATION_FILE_PLAN_INVALID`（保留 `currentEntityVersion` 语义则需放宽 schema，或让 Gateway 报 `AUTOMATION_PLAN_STALE`）。
- 同一族、程度较轻：`library-service.ts:34694, 34702, 34748` 用 `VERSION_CONFLICT` 表示"文件内容哈希与备份时不一致"（`reason: SOURCE_CHANGED`），文案说"元数据"、实际是内容——建议后续为"内容冲突"使用 `ASSET_MOVE_CONFLICT` 或新增 reason。

### 4.6 协议 `Error.message`（含英文原文）直接进界面

`toMessage` 的兜底链会返回原始 `error.message`（`src/renderer/error-utils.ts:94-96`），而 `PublicError.message` 被协议强制等于英文 `PUBLIC_ERROR_MESSAGES[code]`（`errors.ts:176-179`）。实测直接使用该字段的界面点：

- `App.tsx:6244`、`6276`（创建/更新序列图对话框内联错误）、`6292`、`6306`（解散序列的 toast）——**中文界面显示英文句**。
- `TextViewerControls.tsx:114`（`setActionError(result.error.message)`）、`:216`（detail 参数）。
- `App.tsx:13606-13608`（`toOrganizationMessage` 对非 `LibraryOperationError` 返回 `error.message`）。
- 结构上**没有**发现本地路径经 `PublicError` 泄漏（`superRefine` 拒绝任何与码不匹配的 message，`errors.ts:176-179`；Main 的 `createPublicError` 全部使用固定文案）。当前残留风险是英文/内部文本，而非路径；唯一带 URL 的 `Error` 在 `src/renderer/3d-viewer/loader-registry.ts:262`（`serpent://` 内部协议地址，非本地路径）。
- 建议：这些点改用 `messageForPublicError(result.error, locale, fallback)`。

### 4.7 7 个公开码在两个 catalog 里都缺失 → 具体文案被"通用兜底"吞掉

缺 zh-CN 与 en 的码：`FOLDER_NOT_EMPTY`、`AUTOMATION_UNDO_GROUP_NOT_FOUND`、`AUTOMATION_UNDO_NOT_AVAILABLE`、`AUTOMATION_UNDO_STALE`、`PLUGIN_HOOK_BLOCKED`、`HISTORY_TOO_LARGE`、`SYNC_IN_PROGRESS`（`errors.ts:13, 74-76, 77, 83, 86` 定义；`zh-CN.ts:2082-2146`、`en.ts:2097-2164` 两个 `error.code` 段均无键；2026-08-21 深审已记录同类缺口）。

对 `LibraryOperationError`，`toMessage` 会退到调用方传入的兜底句（`error-utils.ts:75`），于是：

- `library-service.ts:13393`、`13421` 抛 `FOLDER_NOT_EMPTY`（`deleteEmptyManagedFoldersFromDisk`，用户可见：删除非空文件夹）→ 界面只显示 `toast.folderDeleteFromDiskFailed` 之类通用句（`App.tsx:8200`），"只能删除空文件夹"这一**原因和解法完全丢失**。
- `main/automation-script-ipc.ts:480/486/527` 抛 `AUTOMATION_UNDO_NOT_AVAILABLE`、`command-gateway.ts:1107` 抛 `PLUGIN_HOOK_BLOCKED`、`library-service.ts:9348` 抛 `HISTORY_TOO_LARGE`、`library-service.ts:23383` 抛 `SYNC_IN_PROGRESS` 同理。

### 4.8 Worker 侧硬编码中文文案，绕过 i18n

`src/worker/index.ts:1480-1489` 的 `thumbnailFailureReason()` 返回中文字符串，经 `worker/index.ts:779` 作为 `reason` 下发，Renderer 直接把它当卡片 tooltip 显示（`App.tsx:11919-11923`）。英文界面用户会看到中文。同一现象：`worker/index.ts:1482-1487` 覆盖内存压力/组件缺失/源文件丢失四种原因——文案质量不错，但应在 i18n catalog 中按 `error.reason.*` 表达。

### 4.9 `INTERNAL_ERROR` 用在 shell / 剪贴板动作失败（已知，非本工单范围）

`main/index.ts:5294, 5306`（打开外部程序）、`5323`（打开方式）、`5349`（在文件夹中显示）、`5369`（复制路径）、`5389/5402`（复制文件）、`5431/5443/5460/5485/5506/5518`、`5756`、`5848` 等，全部返回 `INTERNAL_ERROR`，而该码的文案（`zh-CN.ts:2084`）在教用户"把整个资源库文件夹复制到本机磁盘再打开"——与"没能在访达里定位这个文件"毫不相干。这是 2026-08-21 深审已登记的 `Serpent-d19850`，本报告只作复核与定位，不重复开单。

---

## 5. 建议的最小 Phase-1 集（仅用户可见）

优先原则（对照 `docs/internal/ui/0004-...md` §7）：原因 + 解法、具体、不复用无关文案、正文来自 `code`/`reason` 映射。

### 5.1 需要新增的公开码（先列既有，再给新增理由）

**既有、可直接复用**（`src/shared/protocol/errors.ts`）：`INVALID_SMART_COLLECTION_QUERY`(66)、`FOLDER_NOT_FOUND`(14)、`INVALID_FOLDER_NAME`(10)、`AI_ANALYSIS_FAILED`(69) + reason `AI_NOT_CONFIGURED`(128)、`ASSET_FILE_NAME_CONFLICT`(63)、`LIBRARY_IO_ERROR`(55)/`LIBRARY_NOT_WRITABLE`(49)、`IMPORT_NOT_FOUND`(27)、`AUTOMATION_FILE_PLAN_INVALID`(26)、`ASSET_NOT_FOUND`(61)。
既有理由码里**没有**任何一条能表达"这个资产的当前状态不允许该动作"或"所选内容不适用于该动作"，因此新增 2 个码（其余候选一律用上面既有的）：

| 新码 | zh-CN | English |
|---|---|---|
| `ASSET_STATE_CONFLICT` | 该资产的当前状态不支持这项操作（可能已在别处删除、恢复或修改）。请刷新列表后重试。 | This asset is not in a state that supports this action — it may have been deleted, restored, or changed elsewhere. Refresh the list and try again. |
| `INVALID_SELECTION` | 所选内容不适用于这项操作。请重新选择，或刷新列表后重试。 | The selected items cannot be used for this action. Reselect them, or refresh the list and try again. |

可选新增 reason（仅用于把序列图那一条说具体，`publicErrorReasonSchema`，`errors.ts:92-163`）：

| 新 reason | zh-CN | English |
|---|---|---|
| `IMAGE_SEQUENCE_SELECTION` | 创建序列图需要同一文件夹内、文件名按编号连续的一组图片（至少 3 张）。 | Creating an image sequence needs at least three images in one folder whose names share one numbering pattern. |

文案合成方式已核实：`error.withReason` = `"{message} 原因：{reason}"`（`zh-CN.ts:2222` / `en.ts:2239`）。

### 5.2 Phase-1 改动清单（file:line → 提议码）

| # | file:line（当前工作树） | 提议码 | 理由 |
|---|---|---|---|
| 1 | `src/worker/library-service.ts:16596` | `ASSET_STATE_CONFLICT` | 选中图片的状态在菜单打开后变了 |
| 2 | `src/worker/library-service.ts:16599` | `INVALID_SELECTION` + reason `IMAGE_SEQUENCE_SELECTION` | 跨文件夹选择，UI 未拦截（`AssetContextMenu.tsx:1294-1302`） |
| 3 | `src/worker/library-service.ts:16602` | `INVALID_SELECTION` + reason `IMAGE_SEQUENCE_SELECTION` | 命名模式不构成一组 |
| 4 | `src/worker/library-service.ts:16580` | `INVALID_SELECTION` | 顺带修正同一函数的参数守卫 |
| 5 | `src/worker/library-service.ts:31807` | `INVALID_SMART_COLLECTION_QUERY` | 既有码，语义完全一致 |
| 6 | `src/worker/library-service.ts:31935` | `INVALID_SMART_COLLECTION_QUERY` | 同上 |
| 7 | `src/worker/library-service.ts:32036` | 形参联合类型改为 `'INVALID_SMART_COLLECTION_QUERY' \| 'LIBRARY_CORRUPT'` | 否则类型层仍指向误用码 |
| 8 | `src/worker/library-service.ts:38222` | `INVALID_FOLDER_NAME` | 自由文本规则的非法值；文案"名称包含不支持的字符"给出原因 |
| 9 | `src/worker/library-service.ts:38228` | `INVALID_FOLDER_NAME` | 同上 |
| 10 | `src/worker/library-service.ts:38232` | `INVALID_FOLDER_NAME` | 同上 |
| 11 | `src/worker/library-service.ts:38237` | `INVALID_FOLDER_NAME` | 同上 |
| 12 | `src/worker/library-service.ts:32300` | `ASSET_FILE_NAME_CONFLICT` + reason `SOURCE_CHANGED` | 重定位落点被占用，文案"同名文件已存在"精确 |
| 13 | `src/worker/library-service.ts:32360` | 同上 | 同上 |
| 14 | `src/worker/library-service.ts:35350` | `LIBRARY_IO_ERROR`（reason `IO_ERROR`） | 非导入流程却用导入文案；同 try 块兜底已是 `LIBRARY_NOT_WRITABLE` |
| 15 | `src/main/index.ts:4219` | `AI_ANALYSIS_FAILED` + `AI_NOT_CONFIGURED` | 与 `main/index.ts:4066,4074` 同一条件的既有做法 |
| 16 | `src/main/index.ts:4225` | 同上 | 同上 |
| 17 | `src/main/index.ts:4667` | `INVALID_SELECTION` | 所选帧区间没有任何文件 |
| 18 | `src/worker/library-service.ts:12691, 14200, 33108, 33127, 33337, 33378, 35175, 35278, 35289, 35490, 35498, 35707, 35791, 35798, 36287, 36291, 36401, 36502, 37342, 37345, 37375` | `INVALID_SELECTION`（`37375` 可用 `ASSET_NOT_MANAGED`） | **修正在途 fix 引入的新错配**（§4.1）：这些是参数/选择非法，不是"库状态被别的窗口改过" |
| 19 | `src/worker/library-service.ts:13518, 13648` | `INVALID_FOLDER_NAME` | 同上，链接文件夹路径名非法 |
| 20 | `src/worker/library-service.ts:19512` | `FOLDER_NOT_FOUND` | 缺 `folderId` |
| 21 | `src/worker/library-service.ts:11130` | `FOLDER_NOT_FOUND` | 同文件 `12705` 已有先例 |

> 范围说明：第 1–17 行是**用户可见**场景（Phase-1 主体）；第 18–21 行不是用户可见，但它们是**在途 fix 刚刚写入的新错配**（`INVALID_STATE_TRANSITION` 覆盖了参数/选择非法），与 `ASSET_ALREADY_TRASHED` 等新码位于同一批改动、同一批测试断言里，因此建议在同一个提交内一并收口，否则新文案会带着"另一个窗口改过库状态"的假原因进入 MCP/脚本可见面。

Phase-1 之外（Phase-2，非用户可见或需要产品定文案）：`21100/26866/26912/33933/33975/34038`（"该文件类型不支持这项操作"→ 建议新增 `UNSUPPORTED_MEDIA_TYPE`）、`19496`（建议 `CONFIRMATION_REQUIRED`）、`39529`、`41096`、`16576/16663`（对话框已拦截；若要加码则新增数值非法码）。

### 5.3 每个修复对应的单元测试应断言什么

统一断言形状：**公共码 + 用户在界面上看到的整句**（zh-CN 与 en 各一条），而不是只断言 `code`。

1. **`ASSET_STATE_CONFLICT`（序列）** — `tests/worker/` 里对 `createImageSequence`：
   先建 3 张图 → 把其中一张 `trashAssets` → 断言 `code === 'ASSET_STATE_CONFLICT'`；再断言
   `messageForPublicError({code, message}, 'zh-CN')` 等于 zh catalog 文案（含「请刷新列表后重试」），`'en'` 等于英文文案。
2. **`INVALID_SELECTION` + `IMAGE_SEQUENCE_SELECTION`（跨文件夹）** — 两个文件夹各放 2 张同前缀连号图，调用 `createImageSequence`，断言
   `code === 'INVALID_SELECTION'`、`reason === 'IMAGE_SEQUENCE_SELECTION'`，且 zh 文案 === 「所选内容不适用于这项操作。 原因：创建序列图需要同一文件夹内、文件名按编号连续的一组图片（至少 3 张）。」（用 `toMessage(new LibraryOperationError(err), 'fallback', 'zh-CN')` 走完整通路，断言结果 === 期望整句而不是 fallback）。
3. **智能合集查询非法** — 现有 `tests/worker/organization.test.ts:1631-1639` 与 `tests/worker/search.test.ts:1931-1955` 的 `'INVALID_IMPORT_DECISION'` 改为 `'INVALID_SMART_COLLECTION_QUERY'`，并补一条 zh 文案断言 === `zhCN.error.code.INVALID_SMART_COLLECTION_QUERY`。
4. **链接规则 pattern 非法** — 对 `setLinkedFolderRules` 传 `{target:'extension', pattern:'a/b'}`：断言 `code === 'INVALID_FOLDER_NAME'`，且 zh 文案 ===「名称包含不支持的字符。」（不是导入句）。
5. **AI 配置** — 在 Main 侧测试（或对 `ai.config.set.request` 的处理器测试）断言：无 key 保存 → `code === 'AI_ANALYSIS_FAILED'`、`reason === 'AI_NOT_CONFIGURED'`，zh 文案以「AI 服务未能完成资产分析。」开头并以「原因：请先在 AI 设置中保存 API Key、选择模型并接受数据发送说明。」结尾。
6. **回收站流程不再出现导入文案** — 对 `trashAssets` 触发 `lstat` 非"路径不可读"错误（可用 `options.assetLstat` 注入口，参见 `library-service.ts:17115-17117` 的既有 seam）：断言 `code === 'LIBRARY_IO_ERROR'` 且 zh 文案 **不含**「导入」。
7. **新增"反回归"断言** — 扩展 `tests/unit/error-state-transition-copy.test.ts` 的 `never tells the user an unrelated import conflict happened` 覆盖范围：对 §5.2 清单里所有码断言 zh 文案不含「导入」、en 不含 `import`（当前该测试只覆盖 4 个新码，不覆盖仍在使用 `INVALID_IMPORT_DECISION` 的场景）。
8. **参数守卫归属** — `INVALID_STATE_TRANSITION` 的 4 条既有测试断言（`tests/worker/trash-relink.test.ts:1202, 1296, 1776, 1931`）改为 `INVALID_SELECTION`，并断言 zh 文案含「请重新选择」且不含「另一个窗口」。

---

## 6. Counts summary

（下表按 §3 的判定逐 site 归档，每个 site 只计一次、优先级为 用户可达 > MCP/脚本 > 防御；合计 77 = 基线 `a1d2a3e9` 的生产调用点总数。）

| 指标 | 数量 |
|---|---|
| 生产代码调用点总数（基线 `a1d2a3e9`，worker 73 + main 4） | **77** |
| 当前 `e5292edf` 仍保留 `INVALID_IMPORT_DECISION` | **37**（worker 33 + main 4） |
| `e5292edf` 已改写 | **40**（→ 44 个新抛出点，其中 4 处 `if (A\|\|B)` 拆成两个分支） |
| verdict = legit-import | **2**（`library-service.ts:41092, 41094`；工作树 `41104, 41106`） |
| verdict = misuse | **75**（77 − 2） |
| verdict = internal-invariant | **14**（§2.1 表中标记；出现在"防御"桶内） |
| **普通用户操作可达（Renderer UI）** | **23**（§3.1，按 `HEAD` site 计） |
| ├ 在途 fix 已修（工作树行号） | **9**（`14224, 14227, 35316, 35561/35564, 35734, 35833, 36532, 37597, 37598`） |
| └ **仍需修（Phase-1 主体，工作树行号）** | **14**（`16596, 16599, 16602, 31807, 31935, 32036, 32300, 32360, 38222, 38228, 38232` + `main/index.ts:4219, 4225, 4667`） |
| 仅 MCP / 自动化 / 脚本可达 | **15**（`11122, 11130, 12691, 14200, 35169, 35272, 35283, 35309, 35782, 35789, 36278, 36282, 36305, 36392, 36490`） |
| 仅防御（bug 或内部契约违反） | **37**（§3.3） |
| 在途 fix 引入的新错配：`INVALID_STATE_TRANSITION` 用于参数/选择非法 | **23**（另有 6 处状态类判定合理） |
| 测试中需要同步改写的断言 | **17**（`trash-relink` 11 处已在途改完；剩 `search.test.ts:1936,1951`、`organization.test.ts:1636`、`model-pipeline.test.ts:605`、`import-planning.test.ts:1199`） |

## 7. 结论（独立复核意见）

1. 工单判断成立，且被**验证**：`INVALID_IMPORT_DECISION` 在基线 `a1d2a3e9` 上有 75/77 处与文案无关，其中 **23 处可由正常用户操作触发**（`e5292edf` 已修 9 处）。
2. `e5292edf` 的方向正确：`ASSET_ALREADY_TRASHED` / `ASSET_NOT_TRASHED` / `ASSET_NOT_MANAGED` 三个码的语义与文案经复核**全部贴合**（尤其覆盖了工单主诉的"再删已删资产""恢复已恢复资产"）。
3. 但 `e5292edf` 引入了**同一类错误的新实例**：23 处"参数/选择非法"被写成 `INVALID_STATE_TRANSITION`，文案把原因归给"另一个窗口改过库状态"、解法给"刷新磁盘变化"——对空数组/重复 id 这类输入永远无效，且已被 4 条测试固化（`tests/worker/trash-relink.test.ts:1202,1296,1776,1931`）。若该提交尚未 push，建议在同一提交内改掉；已 push 则应作为立刻跟进的 P1，否则工单只解决了一半。
4. 还有 4 个"非导入却被导入文案污染"的独立点仍未处理：回收站里的 `IMPORT_APPLY_FAILED`（`35350`）、AI 设置（`main/index.ts:4219/4225`）、智能合集查询（`31807/31935`）、链接规则规则值（`38222-38237`）。
5. Phase-1 不需要为这些场景发明大量新码：仍需修的 14 处里 10 处可直接复用既有码（`INVALID_SMART_COLLECTION_QUERY` ×3、`ASSET_FILE_NAME_CONFLICT` ×2、`INVALID_FOLDER_NAME` ×3、`AI_ANALYSIS_FAILED`+`AI_NOT_CONFIGURED` ×2），只有 4 处需要新码（`ASSET_STATE_CONFLICT` ×1、`INVALID_SELECTION` ×3，后者含 `main/index.ts:4667`）。

## 8. 未覆盖 / 明确不做

- 未运行任何测试（工单要求静态审计）；因此"界面实际显示整句"的依据是代码通路（`error-utils.ts:30-99` + catalog），不是运行证据。
- `INTERNAL_ERROR` 在 shell/剪贴板路径的系统性收口属已登记工单 `Serpent-d19850`，本报告只复核定位（§4.9），未展开。
- MCP Gateway 的 `AUTOMATION_*` 错误族（`src/shared/automation-host-command-error.ts:14-59`）文案自查未发现错配；`src/automation/command-gateway.ts` 内十余处 `INTERNAL_ERROR` 均为"依赖未注入/host 误用"，面向脚本而非界面，未列入。
