# 2026-09-23 链接忽略统一、侧栏缩进与 Windows 图标

> 工单：`Serpent-c6d907` / `Serpent-81e416` / `Serpent-d4c8a5`  
> 状态：实现完成，待人类验收  
> 分支：`dev`

## 现象

1. 忽略说明里的 `.*/` 没有拿掉链接文件夹下名称以点开头的子目录。链接树另有「链接规则」窗口，和普通文件夹「写进忽略规则文本」的做法不一致。
2. 侧栏里链接文件夹根比普通文件夹多缩进一级，子目录跟着偏一档。
3. Windows 上链接文件夹看起来不能添加图标；菜单代码没有按平台关掉。

## 根因

- `.serpentignore` 只按托管路径 `Assets/<relative>` 匹配。链接树走 `linked_folder_rules` 精确文件夹名和 `explicit_ignored_paths`，默认规则只有 `.git` / `node_modules` 等固定名字。
- `linkedFolderDepth("")` 返回 1，子级再 `+ depth - 1`，把根从 0 改成 1 后如果漏改减 1，子级会和根挤在同一层。
- Windows UI 字体栈是 HarmonyOS / Segoe UI / 微软雅黑。emoji 类没有 `Segoe UI Emoji`，彩色 emoji 被 CJK 字体拦截。

## 修复

- `gitignoreMatchesPath` 增加 `managed | linked` 根。链接路径从链接根匹配，所以 `.*/`、`*.tmp` 对两棵树生效。右键忽略链接子目录/文件/扩展名写入同一份 `.serpentignore`（无 `Assets/` 前缀）。空相对路径的链接根仍用 `explicit_ignored_paths`（没有可写的相对路径）。`linked_folder_rules` 表保留，默认 `.git` 等仍在扫描时生效；文件夹菜单不再露出「链接规则」窗口。
- `linkedFolderDepth` 改为 0 基：空路径 0，其后每一段加 1。侧栏子级公式改为根深度加上该相对路径深度，不再减 1。挂在托管文件夹下的链接根仍是父级深度加 1。
- `.nav-entity-glyph-emoji` 使用 `--font-emoji`：`Segoe UI Emoji` 优先，避免被雅黑或 HarmonyOS 画成单色。

## 命令

| 命令 | 结果 |
| --- | --- |
| `npx vitest run --config vitest.config.ts tests/unit/gitignore.test.ts tests/unit/linked-folder-tree.test.ts tests/unit/unified-directory-nav.test.ts tests/unit/sidebar-commands.test.ts` | 4 files / 90 passed |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/gitignore-managed.test.ts` | 1 file / 4 passed（含链接树 `.*/` 与右键忽略写入规则文本） |
| `npm run test:library-availability` | 9 files / 228 passed、1 skipped |
| packaged / Computer Use | 未执行 |

## 2026-09-23 复验：空 `.111` 与「管理忽略项目」

用户反馈：设置里不需要「管理忽略项目」按钮及面板；`资源库根目录 → 1Test → .111` 无法忽略。

根因：侧栏读的是 `getLibraryNavigationSummary` 缓存。`.*/` 或右键忽略一个**空的**链接子目录时，既没有托管 `managed_folders` 行写入 `gitignore_ignored_paths`，也没有资产写入 `linked_ignored_assets`，浏览序号不变，缓存继续返回旧的 `.111`。规则本身能匹配 `.111`（与 `.hidden` 相同），直接调用 `listLinkedFolders` 的测试因此是绿的，侧栏却仍显示。

修复：

- `syncGitignore` 之后清空导航摘要缓存并推进 `browse_change_sequence`。
- 链接文件夹画布卡片同样按忽略规则过滤。
- 去掉设置里的「管理忽略项目」面板；取消忽略改为从规则文本删行或写 `!`。
- 右键忽略链接子目录时解析 `lfv:` 虚拟 id，避免当成链接根 id。

忽略这个 `.111` 的做法：在忽略规则里写 `.*/`（所有点开头的文件夹），或右键该文件夹「忽略此文件夹」（链接树写入 `.111/`，普通文件夹写入 `Assets/1Test/.111/`）。

## 复验命令

| 命令 | 结果 |
| --- | --- |
| `npx vitest run --config vitest.config.ts tests/unit/gitignore.test.ts tests/unit/folder-batch-actions.test.ts` | 2 files / 10 passed |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/gitignore-managed.test.ts` | 1 file / 7 passed（含空 `.111` 导航缓存与右键写入 `.111/`） |
| `npm run test:library-availability` | 9 files / 228 passed、1 skipped |
| packaged / Computer Use | 未执行 |
