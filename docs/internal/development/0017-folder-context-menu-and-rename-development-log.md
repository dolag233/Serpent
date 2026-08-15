# 0017 第三增量：托管文件夹右键菜单（新建子文件夹 + 重命名真实目录）开发日志

> 日期：2026-07-17
> 分支：codex/slice-002-asset-ingestion
> 执行：主 agent 集中把关；3 个编码 subagent 并行（worker 链路 / renderer / E2E），6 个审查 subagent（Standards 深审 + Spec 深审 + 回归/死代码/a11y+CSS/安全 4 路广度）

## 范围

REQ-MENU-005 中无澄清依赖的两项先行落地；复制/粘贴/克隆/移动/删除仍等集中澄清队列 #5/#7 裁决，明确不在本增量。

- 托管文件夹在左侧统一目录树中获得统一右键菜单（共享 ContextMenu 组件）：「新建子文件夹」「重命名…」。
- 新建子文件夹落在**被右键的文件夹**下（而非当前选中文件夹）；沿用既有「新建文件夹」对话框，目标提示行显示父文件夹名。
- 重命名 = 物理目录 rename + DB 事务内重写本行、全部后代 `managed_folders` 行、子树下全部 managed 资产的 `relative_file_path`/`path_identity` 前缀 + 未删除资产 FTS 同步；失败物理回滚 + diagnose。
- 对话框预填当前名、空名/提交中禁用确认、类型化失败内联中文错误且不关闭（冲突「已存在同名文件夹或文件。」、非法名「名称包含不支持的字符。」）。

## 四列可追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 文件夹右键菜单两项入口 | `src/renderer/context-menu.tsx:40`（folder descriptor）、`src/renderer/NavigationSidebar.tsx:317`（managed NavRow onContextMenu）、`src/renderer/AssetContextMenu.tsx:270`（菜单分支） | `tests/e2e/folder-context-menu.test.ts:89`（菜单两项可见） | Computer Use 未执行（本环境无桌面控制能力，移交人工 QA；MENU-016/017 待人类验收） |
| 新建子文件夹落到被右键文件夹 | `src/renderer/useFolderActions.ts:92`（openFolderDialog/createFolder，`folderDialogParentId ?? selectedFolderId`） | E2E 用例 1（父名提示行、嵌套缩进 +14px、磁盘 `Assets/父/子` 存在） | 同上 |
| 重命名全链路 | `src/worker/library-service.ts:3618`（renameManagedFolder）；协议 `requests.ts:84/613`、`responses.ts:282`；`src/preload/index.ts:125`；`src/main/index.ts:602`；`src/worker/index.ts:249`；`src/shared/library-api.ts:126` | `tests/worker/folder-rename.test.ts` 10/10；`tests/unit/protocol.test.ts:460` 3 例；E2E 用例 2（侧栏/面包屑/资产/磁盘） | 同上 |
| 冲突/非法名类型化拒绝 | worker 冲突判定（portable identity，纯大小写改名豁免）、normalizeFolderName（含 Windows 禁用字符/设备名/尾点，library-rules 既有门禁） | worker 用例 4–8；E2E 用例 3/4（内联错误、对话框不关闭、可重试） | 同上 |
| 回收站链路不断 | restore 经 `trashed_from_folder_id` 查当前 `managed_folders.relative_path`（`library-service.ts:10227`） | worker 用例 10（trash→rename→restore 落回新目录，磁盘断言） | — |

## 审查与修复（本回合闭环）

6 路审查 0 HARD 安全问题；以下发现已修复并复验：

1. **纪律 #8 巨型文件**：App.tsx 内联逻辑抽为 `src/renderer/useFolderActions.ts`（镜像 useAssetRename），App 只剩接线。
2. **文案双真源**：删除对话框专属 `folderRenameErrorMessage`，统一走 `PUBLIC_ERROR_MESSAGES_ZH`；`INVALID_FOLDER_NAME`/`FOLDER_NAME_CONFLICT` 文案以对话框措辞为准（E2E 同步）。
3. **重复父名提示**：撤销 CreateDialog 新增 `parentFolderName` 行（既有「将在"X"内创建真实目录。」已覆盖），样式同步移除，E2E 改断言既有行。
4. **陈旧 parentId 防御缺口**：CreateDialog 取消与 Esc 路径清空 `folderDialogParentId`。
5. **maxLength 与服务层不一致**：255 → 80（对齐 normalizeFolderName 80 码点上限）。
6. **回收站资产重写腿无测试**：补 worker 用例 10（见上表）。

记为 follow-up（判断级/既有约定，不阻断）：RenameDialog 系列共同的 focus-trap/焦点回落与 aria-invalid/describedby 缺口；renameWithRollback 骨架与 renameAssetFile 的抽取；`FOLDER_ALREADY_EXISTS`（create）与 `FOLDER_NAME_CONFLICT`（rename）双码并存。

## 验证（当次命令与结果）

- `npm run typecheck`、`npm run lint`：通过。
- `npm run test:unit`：398 passed（39 文件，含 protocol 新增 3 例）。
- `node scripts/run-vitest-with-electron.mjs run tests/worker/folder-rename.test.ts tests/worker/asset-rename.test.ts`：17 passed（folder-rename 10 + asset-rename 8，复跑 folder-rename 10/10）。
- `node scripts/run-e2e.mjs folder-context-menu asset-rename context-menu shell-navigation library-recent`：新文件 4/4；回归 15/15；修复后复跑（folder-context-menu + asset-rename + context-menu + shell-navigation）18/18。
- `package.json` 的 `test:e2e` 清单补挂 `folder-context-menu.test.ts`，并补挂上一增量遗漏的 `asset-rename.test.ts`。

## 未验证（按验收纪律如实记录）

- 回滚分支（DB 事务失败后的物理回退 + diagnose）：无 failpoint 触发测试，与 renameAssetFile 同约定，记未验证。
- renameSync 与事务提交之间的进程崩溃窗口：依赖下次 refresh 对账，无崩溃注入测试，记未验证。
- Windows 平台行为（目录 rename 语义、大小写卷）：无 runner，记未验证。
- Computer Use 截图：本环境无桌面控制能力，移交人工 QA。
- 运行中的缩略图任务/refresh 扫描与文件夹 rename 竞争：沿用 renameAssetFile 既有约定（不做任务协调），子树级影响面更大，记为已知风险。

## known-red 移交（非本增量）

`tests/e2e/linked-folders.test.ts` 为另一 agent 未提交改动（空态「导入链接文件夹」按钮作用域问题，3/3 红），本回合未触碰、未纳入提交。
