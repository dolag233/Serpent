# 2026-09-12 文件夹右键「导入链接文件夹」：把磁盘目录链接为普通文件夹的子级

> 工单：`Serpent-316493`（P1）｜ 清单：`LINKED-FOLDER-NEST-001`
> 关联：`Serpent-186547`（根级「+」/「链接」按钮，同批交付）、`Serpent-fa68f9`、`Serpent-f6f779`

## 1. 产品口径（用户 2026-09-12 确认）

1. **语义与文案**：右键菜单条目叫「导入链接文件夹」（与根级入口同名）。在普通文件夹 A 上右键 → 导入链接文件夹 → 选择硬盘上的文件夹 B → **B 以链接方式成为 A 的子文件夹**，文件不复制、仍在原位置。
2. **父级范围**：只能挂在**普通（managed）文件夹**下；不挂在链接文件夹下（不做链接套链接），因此最多一层：managed 父 → linked 子。
3. **目录来源**：只链接磁盘上已存在的目录（复用现有选目录对话框）。

配套：根级「+」/「链接」按钮固定在库根创建（`Serpent-186547`），子级创建统一走右键。

## 2. 实现

| 层 | 改动 |
| --- | --- |
| 数据库 | 迁移 **v49**：`ALTER TABLE linked_folders ADD COLUMN parent_folder_id TEXT`（只增不改，ADR-0028）。**故意不加 REFERENCES**：回收站会 `DELETE` managed_folders 行，级联 SET NULL 会把嵌套关系静默清掉；保留 id 才能让父级恢复后自动回到原位。附幂等 `ensureLinkedFolderParentSchema`（迁移 49 分支 + legacy 修补路径） |
| 协议 | `asset.import-linked.request` 与 `asset.import-linked` 命令新增可选 `parentFolderId`；preload 透传；main 选目录后带进命令 |
| Worker | `importFolderAsLinked({ …, parentFolderId })`：父级必须是本库的 managed 文件夹（否则 `FOLDER_NOT_FOUND`）；写入 `parent_folder_id`；返回值回显父级。`listLinkedFolders` 读回根行的 `parentFolderId`（虚拟子目录仍按链接根内部层级） |
| 拒绝规则 | 目标在**本库文件夹内部** → `INVALID_IMPORT_SOURCE` + `LINKED_SOURCE_INSIDE_LIBRARY`；目标**已经是链接根** → `LINKED_SOURCE_ALREADY_LINKED`；目标**在某个已链接根内部** → `LINKED_SOURCE_INSIDE_LINKED_FOLDER`。三个 reason 都有中英文案（`error.reason.*`） |
| 导航树 | `buildUnifiedDirectoryNavEntries`：链接根按 `parentFolderId` 取 managed 父级深度 +1，虚拟子目录在此基础上偏移；**父级不可见**（在回收站 / 已删盘）时回落到库根显示——不会出现看不见的链接，父级恢复后自动回到父级下。`sortManagedTreeEntries`：把链接子级排在该 managed 父级子树之后（链接行没有创建时间，与"不可比较的排在末尾"一致） |
| 右键菜单 | 新命令 `folder.import-linked`（仅 `locationKind === 'managed'` 可见）→ `onImportLinkedFolderInto` → `App.importFolderAsLinked(folderId)`；AssetContextMenu 三处 action map + props 同步 |

## 3. 踩坑记录（两个都值得记）

1. **`managed_folders` 没有 `library_id` 列**：每个资源库就是自己的数据库文件。父级校验最初写成 `WHERE folder_id = ? AND library_id = ?` → SQLite `no such column: library_id` → 被公共错误层归类成 `LIBRARY_STRUCTURE_MISMATCH`（该错误其实来自 `SQLITE_ERROR + no such column`，不是真的结构不匹配）。E2E 里表现为"导入没反应"。
2. **worker 测试必须走 Electron ABI**：直接 `node node_modules/vitest/vitest.mjs run tests/worker/...` 会因 `better_sqlite3.node` 与宿主 Node 的 NODE_MODULE_VERSION 不匹配而全部报 `LIBRARY_ENGINE_UNAVAILABLE`（本次在本机 Node v26 上首次误判为"环境不可用"）。正确入口是 `scripts/run-vitest-with-electron.mjs`（即 `npm run test:worker` / `test:library-availability`）。

## 4. 测试与证据

```
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/linked-folders.test.ts
→ Test Files 1 passed (1) / Tests 37 passed (37)
  新增 5 条：嵌套导入并回读父级、重开后嵌套仍在（v49 列存活）、
  父级不是 managed → FOLDER_NOT_FOUND、目标在库内 → LINKED_SOURCE_INSIDE_LIBRARY、
  重复链接 / 目标在已链接根内 → LINKED_SOURCE_ALREADY_LINKED / LINKED_SOURCE_INSIDE_LINKED_FOLDER

npm run test:library-availability
→ Test Files 9 passed (9) / Tests 211 passed | 1 skipped (212)
  （library-availability 12、migration-discipline 8、schema-compatibility 56、
    schema-downgrade-chain 59、schema-lenient-read 27、database-recovery 10 等；
    v49 迁移通过迁移纪律与 schema 链检查）

node scripts/run-e2e.mjs tests/e2e/linked-folders.test.ts
→ 4 passed（含新增：右键 Alpha →「导入链接文件夹」→ 侧栏把 source 渲染在 Alpha 下
   （Alpha 14px / source 28px），worker 回读 parentFolderId=Alpha；
   菜单项在 managed 上可见、在 linked 行上不存在；同一目录再次导入被拒
   （INVALID_IMPORT_SOURCE + LINKED_SOURCE_ALREADY_LINKED））

node node_modules/vitest/vitest.mjs run tests/unit/unified-directory-nav.test.ts tests/unit/sidebar-commands.test.ts
→ 15 + 47 passed（新增：嵌套深度与父级、父级缺失回落库根、链接子级排在父级子树之后；
   命令注册表 20 条、managed 菜单含 folder.import-linked、linked 菜单不含）

tsc --noEmit / eslint → exit 0
```

## 5. 语义决策（已实现，供人验时确认）

- 父级在回收站期间：子链接**临时显示在库根**（不隐藏，避免"链接凭空消失"）；父级恢复后自动回到父级下。
- 父级从硬盘永久删除：`parent_folder_id` 变成悬空值 → 同样回落显示在库根，链接关系不丢（磁盘目录从未被 Serpent 动过）。
- 链接根本身的删除/移除仍走原有路径（移除索引 / 删盘），不受本次改动影响。
- 排序：链接子级排在同类 managed 子级之后（沿用"无创建时间排末尾"的既有规则）。

## 6. 追加：空白处右键 = 根目录右键（`Serpent-a6c516` / `NAV-FOLDER-ROOT-002`）

用户补充：「把文件夹面板的空白处的语义理解为根目录，因此如果在空白处右键就相当于在根目录右键」，需要支持在文件浏览器中打开、添加文件夹等入口。

实现：

- 新增共享 sentinel `LIBRARY_ROOT_FOLDER_ID = 'serpent:library-root'`（`src/shared/library-root-folder.ts`）：根目录没有 `managed_folders` 行，用显式 sentinel 跨 Renderer → Main → Worker 传递，且**不复用**渲染层的浏览 scope 字符串 `'root'`。
- `NavigationSidebar`：空白区新增 `onContextMenu`（同样用 `isFolderListBlankTarget` 判定，行/控件上的右键仍走各自菜单）→ 新 prop `onOpenRootFolderContextMenu`。
- `App`：以 `{type:'folder', folderId: sentinel, name: 资源库根目录, locationKind:'managed', isLibraryRoot:true}` 打开文件夹菜单；创建 / 导入链接文件夹 / 粘贴把 sentinel 映射为 `null`（根级）。
- `commands/sidebar-commands.ts`：上下文新增 `isLibraryRoot`。库根菜单只保留 **在文件浏览器中打开 / 新建文件夹（根级文案，不再是"新建子文件夹"）/ 导入链接文件夹 / 粘贴 / 复制文件夹路径**；重命名、复制文件夹、克隆、移动、移入回收站、从硬盘删除、从资源库移除都不出现。插件文件夹命令也隐藏（它们按文件夹 id 分发，根没有真实 id）。
- `use-shell-file-actions` 的路径动作不需要改：`folder.get-path` 已支持根 sentinel，`LibraryService.resolveFolderPath` 对 sentinel 返回库的 `Assets` 目录（Main 用它 shell.openPath / 写剪贴板，路径不回到 Renderer）。

证据：E2E `nav-pane-background` 新增用例——在缩进槽右键弹出「文件夹操作：资源库根目录」，菜单含在文件浏览器中打开/新建文件夹/导入链接文件夹/复制文件夹路径，不含重命名/移入回收站/删除；点「新建文件夹」后新文件夹 `parentFolderId=null`（根级）。单测：`sidebar-commands` 50 passed（含库根可见性、根级文案、命令透传 3 条）、`navigation-sidebar` 23 条中 19 passed（4 条为既有 Node v26 环境失败），含空白处右键触发根菜单、行上右键不触发。

## 7. 未验证项

- packaged / Windows：未执行。
- 人类验收：见清单 `LINKED-FOLDER-NEST-001`（含右键入口、嵌套渲染、拒绝文案、父级进回收站后的表现）。
- 未做（明确非目标）：链接套链接（在链接文件夹上右键不提供该入口）；把链接目录链接到链接根内部；跨库移动链接根。
