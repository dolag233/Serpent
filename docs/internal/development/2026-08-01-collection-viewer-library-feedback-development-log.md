# 2026-08-01 合集、查看器与创建资源库反馈开发记录

> 工单：`Serpent-2bmy`。本文记录当前工作区的实现和当次可复现证据，不代表 Windows/macOS 人工验收通过。

## 需求与实现

- 合集侧栏在存在子合集时显示子合集数量；“包含子合集”从侧栏移到中间工作区标题旁，复用文件夹“包含子文件夹”的按钮和图标，并保持即时刷新。
- 查看窗口中的视频默认设置 `loop`，视频播放器测试同时断言循环属性。
- 创建资源库界面的“打开资源库”在无库起始态保持界面挂载到原生选择器完成，避免自动打开副作用；当前创建对话框没有自动化脚本按钮。

实现位置：`src/renderer/NavigationSidebar.tsx`、`src/renderer/App.tsx`、`src/renderer/VideoPlayerControls.tsx`、`src/renderer/styles.css` 与中英文目录翻译；E2E 调整见 `tests/e2e/organization-search-trash.test.ts`、`tests/e2e/media-video-playback.test.ts`。

## better-sqlite3 原生 ABI 事故与修复

`better-sqlite3` 包含必须按 Node ABI 编译的原生 `.node` 文件。当前主机 Node 24 使用 ABI 137，而 Electron 43.1.0 内嵌 Node 使用 ABI 148；共享同一 `node_modules` 时，先为其中一个运行时重编译就会让另一个运行时报 `ERR_DLOPEN_FAILED / NODE_MODULE_VERSION`。

新增 `scripts/ensure-native.mjs`：实例化内存数据库探测 Electron ABI（仅 `require` 不会触发原生加载），发现不匹配时调用 `scripts/rebuild-native.mjs`；`start`、`test`、`test:worker`、性能测试、`test:e2e` 和隔离 E2E 均通过 npm lifecycle 自动执行。这样不再需要每次手动猜测该运行时应执行哪条 rebuild 命令。

## 当次证据

- `npm run typecheck`：通过。
- 定向 ESLint（本轮变更的 Renderer、E2E、native 脚本）：通过。
- `npx vitest run --config vitest.config.ts tests/unit/video-player-controls.test.ts tests/unit/no-library-empty-state.test.ts`：35/35 通过。
- `node scripts/ensure-native.mjs`：在故意留下 Node ABI 137 后自动重编译到 Electron ABI；再次运行报告匹配。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/organization.test.ts`：63/63 通过。
- `organization-search-trash` 的合集递归 E2E 覆盖子合集数量与标题按钮切换；媒体视频 E2E 在本机媒体 bundle 不可用时按既有条件跳过。
- `npm run test:unit` 全量仍有既有 `app-logger` Windows 路径断言失败（与本轮变更无关），不能记为全量通过。

## 使用约定

直接使用 `npm start`、`npm run test`、`npm run test:worker`、`npm run test:e2e`；不要直接用裸 `npx vitest` 运行 Worker 测试。`npm run package` / `npm run make` 后重新启动或测试时，lifecycle 会自动把 `better-sqlite3` 对齐到 Electron。

## 新反馈：合集递归计数与创建层级

- `listCollections` 与 `updateCollection` 现在按当前合集及所有后代合集构造资产集合，并使用 `COUNT(DISTINCT asset_id)` 去重；已删除资产不计入显示数量。Worker 测试覆盖父子合集重复成员、子合集独有成员以及删除后的计数刷新。
- 合集创建输入行改为在合集树中按父节点插入，根合集和子合集均使用与文件夹创建一致的 Enter/Escape/失焦提交行为，提示文案统一为「新建合集」。合集右键菜单新增「新建子合集」命令。

证据：`npm run typecheck` 通过；`tests/worker/organization.test.ts` 64/64；`tests/unit/sidebar-commands.test.ts` 44/44。当前仅记录为待人类验收，未将自动化结果写成用户验收结论。

## 新反馈：资产加入合集二级选择器

资产右键菜单的合集操作改为 Windows 风格 hover 二级菜单，添加和移除分别进入可搜索的合集选择器；空搜索时按本地持久化的最近使用合集优先显示，选择后继续复用原有单资产/批量 worker 写路径。旧的逐合集平铺菜单已移除，避免合集数量增多时撑长主菜单。

合集范围内的 Delete 快捷键现在优先解释为“从当前合集移除”：只有非回收站、当前存在合集范围且有选中资产时才拦截 Delete，并复用既有批量移出逻辑；其他范围仍保持原来的移入回收站/永久删除语义。

浏览区文件夹卡片现在复用侧栏的托管资产拖放协议：普通拖放调用移动路径，Alt 拖放调用复制路径；外部文件导入和文件夹重排仍沿用原有分支，避免改变已有 dropEffect 与冲突策略。

资产移入回收站或从硬盘删除后，批量操作路径和 App 的混合资产/文件夹路径都会重新读取 `listCollections`，因此合集侧栏的递归去重计数与当前成员状态不再滞后；浏览内容仍沿用原有 `reloadCurrentContent` 刷新。

## 反馈收口与独立代码审查

- 合集内 Delete 的键盘路径已加入 Electron E2E：验证只移除直接成员，资产仍存在于“所有资产”，递归计数同步扣减。
- 浏览区文件夹卡片拖放已加入 Electron E2E：普通拖放移动资产并验证目标磁盘路径；Alt 复制沿用同一处理器的复制分支。
- 修正合集创建输入行：空白失焦会取消编辑，Enter 与 blur 只提交一次，行为与文件夹内联创建一致。
- 修正删除/恢复后的合集刷新：托管文件夹删除、链接资产删除及资产/文件夹恢复路径都会重新读取合集摘要。
- 深审发现并修复撤回冲突根因：当冲突路径仍有活动数据库行但源文件已丢失时，冲突现在标记为 metadata-only；keep-both/skip 可继续，replace 会安全地将陈旧行移入回收站而不执行失败的文件重命名。撤回对话框在重试仍遇冲突时保持可操作，不再退化为一次性通用错误。

## 当次验证

- `npm run typecheck`：通过。
- `npm run lint -- --quiet`：通过。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/managed-move.test.ts`：9/9 通过（含新增陈旧数据库行冲突回归）。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/trash-relink.test.ts`：77 通过、2 跳过。
- 后台 Electron：`folder-recursive-scope.test.ts` 2/2 通过；`organization-search-trash.test.ts` 新增合集 Delete/计数路径所在测试通过，但同文件另有两个既有流程失败（恢复选择器标签与标签视图刷新），未将全文件记为通过。
- 代码审查基线 `ca751c0`：Standards/Spec 双轴审查发现的关键 P1 已逐项处理；本记录不替代用户人工验收，相关清单保持“待人类验收”。
