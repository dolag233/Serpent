# 2026-09-12 非法状态错误码收口（Phase 1：用户可见的资源库变更操作）

> 工单：`Serpent-50c466`（P1）｜ 清单：`ERROR-STATE-001`
> 依据：`docs/internal/reviews/2026-08-21-error-handling-deep-review.md`（「INVALID_IMPORT_DECISION 不得作通用非法状态；已删除/已完成应幂等或专用码」）、`docs/internal/ui/0004-calm-error-and-copy-ux-principles.md` §3/§6

## 1. 问题

用户执行回收站/恢复/永久删除/删除到硬盘/移动/重命名/链接目录操作时，只要状态不成立，Worker 抛的都是 `INVALID_IMPORT_DECISION`，界面显示「**导入冲突处理选项无效。**」——与用户实际动作完全无关，既没有说明原因也没有可做的下一步。

全仓该码共 **73 处**调用点；本次处理其中**用户可见的资源库变更一类（40 处）**。

## 2. 新增的四个专用码（中英文案）

| 码 | 中文 | 英文 |
| --- | --- | --- |
| `ASSET_ALREADY_TRASHED` | 该资产已经在回收站里了。请从回收站恢复，或在回收站中永久删除。 | That asset is already in the trash. Restore it, or delete it permanently from the trash. |
| `ASSET_NOT_TRASHED` | 该资产不在回收站里。请先在浏览区把它移入回收站。 | That asset is not in the trash. Move it to the trash first. |
| `ASSET_NOT_MANAGED` | 该文件在链接文件夹里，不在资源库自己的存储中。Serpent 不会移动或删除链接文件夹里的文件，请在文件管理器中处理。 | That file lives in a linked folder, outside the library’s own storage. Serpent leaves those files where they are — handle it in your file manager. |
| `INVALID_STATE_TRANSITION` | 资源库当前的状态不支持这一步（可能有另一个窗口或后台任务刚改过它）。请刷新磁盘变化后重试。 | That action is not valid in the library’s current state, which another window or background task may have changed. Refresh disk changes and try again. |

`INVALID_IMPORT_DECISION` 保留给真正的导入决策校验（`prepareImport` / `resolveImport`）。

## 3. 处理范围（40 处，按方法）

| 方法 | 处数 | 判定 |
| --- | --- | --- |
| `trashAssets` | 3 | 空/重复 id → `INVALID_STATE_TRANSITION`；链接资产 → `ASSET_NOT_MANAGED`；已在回收站 → `ASSET_ALREADY_TRASHED` |
| `trashSelection` | 4 | 空/重复/超限 → `INVALID_STATE_TRANSITION`；混合条件拆成 链接资产 / 已在回收站 两条 |
| `previewRestoreAssets` | 2 | 空/重复 → `INVALID_STATE_TRANSITION`；资产存在但不在回收站 → `ASSET_NOT_TRASHED` |
| `restoreAssets` | 3 | 同上 |
| `restoreAssetsIfOriginalVacant` | 3 | 同上 |
| `deleteAssetsPermanent` | 3 | 空/重复、批次不一致 → `INVALID_STATE_TRANSITION`；未在回收站 → `ASSET_NOT_TRASHED` |
| `deleteAssetsFromDisk` | 3 | 空/重复、批次不一致 → `INVALID_STATE_TRANSITION`；混合条件拆成 链接资产 / 已在回收站 |
| `deleteAssetsFromDiskAsync` | 5 | 同上（循环内 + 批次后各一处混合条件） |
| `deleteActiveManagedAssetsFromDisk(+WithProgress)` | 2 | 批次与查询结果不一致 → `INVALID_STATE_TRANSITION` |
| `deleteLinkedFolderSubtree` / `resolveLinkedDirectoryMutationTarget` | 2 | 链接相对路径非法 → `INVALID_STATE_TRANSITION`（保留 `{ cause }`） |
| `moveManagedFolders` | 1 | 空/重复 id → `INVALID_STATE_TRANSITION` |
| `moveAssets` | 2 | 空/重复、源不是活跃 managed → `INVALID_STATE_TRANSITION` |
| `copyAssets` | 2 | 空/重复、链接行混杂 → `INVALID_STATE_TRANSITION` |
| `renameAssetFiles` | 1 | 空/重复 items → `INVALID_STATE_TRANSITION` |
| `deleteLinkedAssets` | 3 | 空/重复/超 20 → `INVALID_STATE_TRANSITION`；资产存在但不是链接资产 → `INVALID_STATE_TRANSITION` |
| `relinkAsset` | 2 | 已在回收站 → `ASSET_ALREADY_TRASHED`；资产不是 missing → `INVALID_STATE_TRANSITION` |

混合条件（`location_kind !== 'managed' || deleted_at !== null`）原来是"一个条件两个原因"，本次**拆成两条独立判断**，分别给 `ASSET_NOT_MANAGED` / `ASSET_ALREADY_TRASHED`，这样文案能说出真正的原因（不是补丁式地换个码）。

## 4. 测试与证据

```
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/trash-relink.test.ts
→ Test Files 1 passed / Tests 88 passed | 2 skipped（其中 11 条断言从 INVALID_IMPORT_DECISION 改为新码）

node node_modules/vitest/vitest.mjs run tests/unit/error-state-transition-copy.test.ts
→ 9 passed（每个新码都有中英文案、messageForCode 解析到自己的文案而不是 fallback、且文案里不含「导入」/import conflict）

npm run test:library-availability
→ Test Files 9 passed (9) / Tests 211 passed | 1 skipped（含 library-service 28、migration-discipline、schema 链）

tsc --noEmit / eslint → exit 0
```

`tests/worker/trash-relink.test.ts` 的 11 条断言按场景改为：linked 资产 trash → `ASSET_NOT_MANAGED`；重复 trash → `ASSET_ALREADY_TRASHED`；restore 活跃资产 → `ASSET_NOT_TRASHED`；restore 重复 id → `INVALID_STATE_TRANSITION`；永久删除活跃资产/混合批次 → `ASSET_NOT_TRASHED`；重复 id → `INVALID_STATE_TRANSITION`；`deleteLinkedAssets` 重复 id / 对 managed 资产 → `INVALID_STATE_TRANSITION`；relink 可用资产 → `INVALID_STATE_TRANSITION`；relink 已回收站资产 → `ASSET_ALREADY_TRASHED`。

## 5. Phase 2 的范围（当时未做，已在 §7 完成）

> 历史记录：本节写下时 Phase 2 尚未开始，用来界定边界。实际完成情况与最终映射见 §7。

剩下的调用点属于**另一类根因（输入/模式/格式校验）**，每类需要自己的码与文案，不宜塞进首批四个码里：智能合集定义解析、忽略规则/路径规范化、图片序列、文本资产读写、自动化预览、插件/缩略图/模型伴随、`placeManagedRelinkFile` 等；`resolveImport` 属**正当用法**（导入决策本身），保持不动。
另有一项**行为层面**的改进来自同一份审查报告，本单未做（需要产品口径）：永久删除/回收站对"已完成"的批次改为**幂等成功**而不是报错。现在重复点仍会得到上面的专用码提示。若要改成静默幂等，请单独开单确认交互。

## 6. 自主核查：独立子代理审计后的修正（2026-09-12 同日）

`Serpent-50c466` 的另一条轨道派了一个独立子代理（deepseek-v4.1-flash，只读）做全量复核，产出 [`docs/internal/reviews/2026-09-12-error-code-misuse-audit.md`](../reviews/2026-09-12-error-code-misuse-audit.md)（77 处基线调用点、逐处 file:line + 所属方法 + 可达性判定）。它的结论直接纠正了本次 §3 的一处失误：

**§3 的失误**：把 23 处**参数/选择守卫**（空数组、重复 id、`.length !== .length`、跨文件夹选择、批次里混了类型不符的项）也写成了 `INVALID_STATE_TRANSITION`，而它的文案是「资源库当前的状态不支持这一步（可能有另一个窗口或后台任务刚改过它）。请刷新磁盘变化后重试。」——对"选择为空/重复"这类输入，原因归错了、解法（刷新磁盘变化）永远不会好。已按审计建议新增：

| 新码 / reason | zh-CN |
| --- | --- |
| `INVALID_SELECTION` | 所选内容不适用于这项操作。请重新选择，或刷新列表后重试。 |
| `ASSET_STATE_CONFLICT` | 该资产的当前状态不支持这项操作（可能已在别处删除、恢复或修改）。请刷新列表后重试。 |
| reason `IMAGE_SEQUENCE_SELECTION` | 创建序列图需要同一文件夹内、文件名按编号连续的一组图片（至少 3 张）。 |

修正后 `INVALID_STATE_TRANSITION` 只保留给**真正的状态竞争**（查询结果与请求批次不一致等 6 处）；23 处守卫改判为 `INVALID_SELECTION`（其中链接目录路径非法的 2 处→`INVALID_FOLDER_NAME`、"不是链接资产"的 1 处→`ASSET_NOT_MANAGED`）。

同时按审计 §5.2 完成其余用户可见点（全部复用既有码，除上面两个新码）：

| 场景 | 站点 | 新码 |
| --- | --- | --- |
| 跨文件夹/不构成序列的建序列图 | 16580/16599/16602 | `INVALID_SELECTION`（后两处带 `IMAGE_SEQUENCE_SELECTION`） |
| 选中帧状态变化（如某帧已进回收站） | 16596 | `ASSET_STATE_CONFLICT` |
| 智能合集查询 JSON 非法 | 31807/31935/32036 | `INVALID_SMART_COLLECTION_QUERY`（含形参联合类型） |
| 链接规则模式非法（自由文本） | 38222/38228/38232/38237 | `INVALID_FOLDER_NAME` |
| 重定位落点被占用 | 32300/32360 | `ASSET_FILE_NAME_CONFLICT` + reason `SOURCE_CHANGED` |
| 回收站第一阶段 lstat 失败 | 35350 | `LIBRARY_IO_ERROR` + reason `IO_ERROR` |
| AI 设置缺失（Main） | main/index.ts:4219/4225 | `AI_ANALYSIS_FAILED` + `AI_NOT_CONFIGURED`（与同文件 4066/4074 一致） |
| 自动化帧区间无文件（Main） | main/index.ts:4667 | `INVALID_SELECTION` |
| 清空 AI 内容缺 folderId / 自动化预览缺 folder | 19512 / 11130 | `FOLDER_NOT_FOUND` |

测试同步：`trash-relink` 4 条断言（重复 id / 非链接资产）改判；`search.test.ts` 2 条与 `organization.test.ts` 1 条改为 `INVALID_SMART_COLLECTION_QUERY`；新增 `image-sequence` 2 条（跨文件夹 → `INVALID_SELECTION`+reason、帧进回收站 → `ASSET_STATE_CONFLICT`）与 `linked-folders` 1 条（规则模式非法 → `INVALID_FOLDER_NAME`）；`error-state-transition-copy` 扩到 21 条，覆盖 6 个状态/选择码 + 6 个复用码的中英文案，并断言 `INVALID_SELECTION` 的文案里**没有**"另一个窗口"、`INVALID_STATE_TRANSITION` 有。

## 7. Phase 2：剩余调用点清理（同日完成）

审计报告 §2.1 里剩下的 **17 处**（worker 16 + main 1）已按它的建议逐条处理，`INVALID_IMPORT_DECISION` **只剩 `resolveImport` 里正当的 2 处**（`library-service.ts:41102` 写 `file_operations.error_code`、`:41104` 校验 suspectedDuplicate/nameConflict 取值）+ `import-planning.test.ts:1199` 的对应断言。

下表按**函数 / 守卫条件**定位（行号会随后续改动漂移；经独立复核，本文早期版本里按行号写的表格整体偏旧 2–3 行，已改为符号定位）：

| 位置（函数 / 守卫） | 场景 | 改判 |
| --- | --- | --- |
| `previewAutomationFileOperation`：assetIds 空/重复 | 自动化文件计划预览 | `INVALID_SELECTION` |
| `setLinkedFolderRules`：>200 条或 ruleId 重复 | 链接规则 | `INVALID_SELECTION` |
| `copyLinkedAssetsToManagedFolder`：assetIds 空/重复 | 复制链接资产 | `INVALID_SELECTION` |
| `createImageSequence` / `setImageSequenceFps`：fps 非有限 / <1 / >240 | 对话框与 MCP schema 都已限 1..240，属不可达的内部契约守卫（保留 `INTERNAL_ERROR` 是有意的：见 §8 F14） | `INTERNAL_ERROR` |
| `clearAiContent`：library/folder scope 未带 confirm | 原 `reason: PERMISSION_DENIED` 也不贴切，一并去掉 | **新码** `CONFIRMATION_REQUIRED`（现由 main 的 AI 设置分支使用，见 §8 F11） |
| `generateThumbnail`：`mediaType === 'other'` 或无解码器 | 缩略图 | **新码** `UNSUPPORTED_MEDIA_TYPE`（§8 F6 去掉了重复 reason） |
| `resolveModelCompanions`：非受支持模型扩展名 | 模型伴随 | `UNSUPPORTED_MEDIA_TYPE` |
| `enqueueArtifactRetry`：kind 与媒体类型不符 | 工件重试 | `UNSUPPORTED_MEDIA_TYPE` |
| `readTextAsset` / `saveTextAsset`：资产非文本 | 文本资产读写 | `UNSUPPORTED_MEDIA_TYPE` |
| `readTextAsset`：文件内容含 NUL | 类型受支持、内容是二进制（§8 F3） | **新码** `ASSET_CONTENT_INVALID` |
| `normalizeExplicitIgnorePath` / `setIgnore`：路径或扩展名忽略项非法 | 忽略规则 | `INVALID_FOLDER_NAME` |
| `prepareImport`：目标是链接文件夹（应走 `prepareOrExecuteImport`） | 调用方契约错 | `AUTOMATION_FILE_PLAN_INVALID`（§8 F8a 去掉了无关 reason） |
| `resolveImport`：该导入正在等待"源失败"决定 | 与主诉无关的状态 | **新码** `IMPORT_AWAITING_DECISION`（§8 F4：不再复用状态竞争码 + 矛盾 reason） |
| `asset.import-sequence.confirm`：`sequenceIndex` 过期（main） | offer 失效 | `IMPORT_NOT_FOUND`（同分支 4638/4644 已这么用） |

新增文案（中英同步）：`UNSUPPORTED_MEDIA_TYPE`「这类文件不支持这项操作。请改选受支持的文件类型。」、`CONFIRMATION_REQUIRED`「这项操作需要先确认。请重新打开对话框并确认后再试。」、`ASSET_CONTENT_INVALID`「这个文件的内容不是文本（可能是二进制或已损坏），文本视图无法打开它。…」、`IMPORT_AWAITING_DECISION`「这次导入还在等你决定怎么处理读不到的文件。…」、`AI_SETTINGS_INCOMPLETE`「自动分析还没开启：请先在 AI 设置里填入 API Key、选择模型，然后重试。」、reason `PERMANENT_DELETE_NEEDS_TRASH`「永久删除只对回收站里的资产生效：请先把它移入回收站。」（原 Phase 2 的 reason `IMPORT_AWAITING_SOURCE_DECISION` 已在 §8 F4 中删除。）

证据：

```
tests/worker/model-pipeline.test.ts          16 passed（断言从旧码改为 UNSUPPORTED_MEDIA_TYPE）
tests/worker/linked-folders.test.ts          38 passed
tests/worker/image-sequence.test.ts          17 passed
tests/worker/thumbnails.test.ts              69 passed
tests/worker/palette-artifact.test.ts        11 passed
tests/worker/derived-artifact-repair.test.ts  6 passed
tests/worker/import-planning.test.ts         57 passed | 1 skipped
tests/worker/ai-completion.test.ts           47 passed
tests/worker/ai-analysis.test.ts             28 passed
tests/worker/automation-write-fencing.test.ts 12 passed
npm run test:library-availability            9 files / 211 passed | 1 skipped
tsc --noEmit / eslint                        exit 0
```

## 8. 独立复核（2026-09-12）：发现与处理

派了一个只读审查子代理（deepseek-v4.1-flash）复核本次「报错信息 + 日志记录」的工作，报告收录在 [`docs/internal/reviews/2026-09-12-error-code-review.md`](../reviews/2026-09-12-error-code-review.md)（73 个改判站点 → 58 right、11 wrong、4 unsure/unreachable；9 类文案问题；2 项日志/诊断问题；8 项测试缺口；2 项文档不实）。它抓到的问题与**已做的修改**：

| # | 发现 | 处理 |
| --- | --- | --- |
| F1（高） | `App.tsx:6244/6276/6292/6306` 与 `TextViewerControls.tsx` 直接渲染协议英文 `message`、丢掉 reason → 本次为序列图新写的 zh 文案与 `IMAGE_SEQUENCE_SELECTION` 在主路径上**一个字都不显示**，清单 ⑤ 的预期在该路径不可能出现 | 已改为 `messageForPublicError(result.error, locale)`（App 4 处；`locale` 在同一作用域已有）与 `toMessage(error, …, locale)`（文本查看器保存失败分支）。修复后清单 ⑤ 的预期成立 |
| F2（高） | `deleteLinkedAssets` 的兜底把「managed 资产」与「已在回收站的链接资产」都写成 `ASSET_NOT_MANAGED`（对前者事实相反，对后者原因/解法都错）；`SELECT` 只查 `location_kind`，结构上无法区分 | 已改为查 `location_kind, deleted_at`：`deleted_at !== null` → `ASSET_ALREADY_TRASHED`；否则（managed）→ `INVALID_SELECTION`。测试断言同步为 `INVALID_SELECTION`。注：「已回收的链接资产」在当前调用方下不可达（链接行不会带 `deleted_at`：`deleteLinkedFolderSubtree` 是删行 + 移 OS 回收站），该分支属防御——我为此写过一个用例，实测得到 `ASSET_NOT_FOUND`，说明前提不成立，已删掉该用例而不是留一个假绿 |
| F3（高） | 「文本资产内容含 NUL」用了 `UNSUPPORTED_MEDIA_TYPE` + `UNSUPPORTED_FORMAT`：类型本就受支持，解法不可用；reason 还含内部术语「当前切片」 | 已新增 `ASSET_CONTENT_INVALID`（「这个文件的内容不是文本（可能是二进制或已损坏），文本视图无法打开它。…」）并去掉该 reason；`UNSUPPORTED_FORMAT` 的文案改为「Serpent 目前还不能处理这种文件格式。」（去掉"当前切片"） |
| F4（高） | 「该导入在等源失败决定」用了 `INVALID_STATE_TRANSITION` + reason，一句话里两个互斥的原因/解法 | 已新增 `IMPORT_AWAITING_DECISION`，并**删除** reason `IMPORT_AWAITING_SOURCE_DECISION` |
| F5（中） | `ASSET_NOT_TRASHED` 的解法对**恢复**路径是反的（让它先移入回收站） | 文案改为意图中立（「…不在回收站里，可能已经被恢复。请刷新回收站列表后重试。」）；「永久删除」这一处单独带 reason `PERMANENT_DELETE_NEEDS_TRASH` 保留原有引导 |
| F6（中） | `UNSUPPORTED_MEDIA_TYPE` 的 6 处附加 `UNSUPPORTED_FORMAT` 与 code 文案语义重复、无解法 | 已全部去掉该 reason（`model-pipeline` 测试断言同步为 `reason` 为 `undefined`） |
| F7（中） | `main/index.ts` 保存 AI 设置失败却报「AI 服务未能完成资产分析」 | 「未接受数据发送说明」→ `CONFIRMATION_REQUIRED`；「没有 API Key」→ 新增 `AI_SETTINGS_INCOMPLETE`（「自动分析还没开启：请先在 AI 设置里填入 API Key、选择模型，然后重试。」） |
| F8（中） | 3 处附加 reason 与本码原因冲突（`prepareImport` + `SOURCE_NOT_FOUND`；两处重定位落点占用 + `SOURCE_CHANGED`） | 已去掉这 3 处 reason |
| F9（中） | `jobs.error_code` 里放公开码时渲染成**裸标识符**（AI 批量失败对话框中英界面都是） | `ai-job-error-message.ts` 先查 `error.reason.*`、再回退 `error.code.*`；新增 `tests/unit/ai-job-error-message.test.ts`（4 条） |
| F10（中） | `previewAutomationFileOperation` / `clearAiContent` 的「folderId 不存在」用 `FOLDER_NOT_FOUND`（归因磁盘断开），后者还带无关 reason | 两处改为 `INVALID_SELECTION` 并去掉 reason。这里我采用了 INVALID_SELECTION 而不是新增 `RECORD_NOT_FOUND`：本次范围内只有这 2 处，且「重新选择」正是该情形的解法；给标签/合集/记录族统一新码属 `Serpent-3c71f3` 的设计决定 |
| F11（中） | `CONFIRMATION_REQUIRED` 是死文案（`clearAiContent` 的 folder/library scope 无调用方） | 由 F7 的 main AI 设置分支使用，已可达；`clearAiContent` 那个分支仍是防御（Renderer 只发 asset scope，已验证），保留 |
| F12（中） | 开发日志 §7 写「19 处」而表格/diff 是 17 处；表头「当前行号」是旧行号（差 2–3 行） | 本节已改为 **17 处（worker 16 + main 1）**，并把表格改为按**函数/守卫**定位（不再写会漂移的行号） |
| F15（低） | 3 处 `INVALID_STATE_TRANSITION` 兜底是不可达死代码（循环已为每个缺失 id 抛错） | 已删除这 3 处（`deleteAssetsFromDiskAsync` / `deleteAssetsFromDisk` / `deleteAssetsPermanent` 各 1） |
| F17（低） | 两个 catalog 有 3 个无对应公开码的死键（`TAG_UNDO_EXPIRED`/`INVALID_SYNC_URL`/`SYNC_PASSWORD_STORAGE_UNAVAILABLE`） | 已删除（全仓无引用，仅 `main/index.ts` 注释提到旧码名） |
| F18（低） | 单测的 `enFor()` 同时接受 catalog 与协议文本，掩盖 en catalog 与 wire 文本的漂移 | 已改为只断言 catalog 文本（用户实际看到的），并新增 `UNSUPPORTED_MEDIA_TYPE`/`CONFIRMATION_REQUIRED` 等进码表；协议侧由 schema 测试覆盖 |

**未按建议改、保留并说明理由的**：

- **F13**（`INVALID_SELECTION` 不说明是空/重复/超限）：普通 UI 已按 20 分块、拖放已拆分 managed/linked，命中者主要是 MCP/脚本（审计也把它判为低）。给每个超限加 reason 会让这一族码回到"一码多因"，本次不加；如需给脚本调用方更具体的信息，属 `Serpent-3c71f3` 的编码决定。
- **F14**（fps 守卫用 `INTERNAL_ERROR`）：命中条件被对话框与 MCP schema 双重限制，是不可达的内部契约守卫；`INTERNAL_ERROR` 正是这种情形的码，不会把用户可见路径降级成兜底句。保留。
- **F16**（`INVALID_FOLDER_NAME` 用于规则/忽略模式，措辞只说"名称"）：中英一致、方向正确；规则输入框是自由文本，用户可达，但「名称包含不支持的字符」对规则模式仍然成立（规则模式就是名字/路径片段）。若要更具体，加 reason 更合适，列入 `Serpent-3c71f3`。

**仍未做的测试缺口**（复核 §6 列出，本次只补了 F9 与 F2 的断言）：`main` 序列确认 `sequenceIndex` 过期 → `IMPORT_NOT_FOUND`、`prepareImport` 链接目标 → `AUTOMATION_FILE_PLAN_INVALID` 仍无断言；fps 守卫无断言（不可达）。这三条已在复核报告里登记，本次不假称已覆盖。

## 9. 本单之外的同类问题（已开单 `Serpent-3c71f3`）

审计 §4.2–§4.9 发现的**同一类"文案与场景不符"**属其它错误码，不在本单调用点范围内：

- `FOLDER_ALREADY_EXISTS` 的**恢复专用文案**被用在文件夹/合集/智能合集**创建**路径（用户建重名文件夹会被告知"无法恢复到原路径"）
- `FOLDER_NOT_FOUND` 的"磁盘可能已断开"文案被用于标签/合集/智能合集不存在
- `VERSION_CONFLICT` 的"元数据被改过"文案被用于自动化计划过期
- 协议 `Error.message`（英文原文）被直接渲染进中文界面（`App.tsx:6244/6276/6292/6306`、`TextViewerControls.tsx:114/216`）
- 7 个公开码在两个 catalog 都缺文案（含 `FOLDER_NOT_EMPTY`，删除非空文件夹时用户可见）
- `worker/index.ts:1480-1489` 硬编码中文缩略图失败文案，英文界面也显示中文
- 行为层面（需产品口径）：永久删除/回收站对已完成批次改幂等。

## 10. 未验证 / 边界

- packaged / Windows 打包态：未执行（Windows 开发态由 worker 测试覆盖）。
- 人类验收：见清单 `ERROR-STATE-001`（连续 trash、对活跃资产 restore/永久删除、链接资产 trash 四种情况的文案）。
- 同一批次的**部分成功**语义未改：一个非法项仍会让整批失败（除了本来就标注 skipped 的场景）。
