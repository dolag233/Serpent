# Wave 1 开发日志：2026-07-17 第二批用户反馈（T1–T4）

> 建立：2026-07-17
> 范围：`mvp-ui-ux-requirements-backlog.md`「2026-07-17 第二批反馈排期」Wave 1 四轨道
> 执行方式：workflow + worktree 并行启动；API 配额中断后由主 agent 顺序接管合流（T1/T2/T4 半成品由主 agent 检视补齐）。审查状态逐轨道如实记录。

## T3 — BUG-TRASH-001 回收站预览丢失（已合流 `d4de957`，实现 `39f134d`）

### 根因（先写失败测试复现，再修复）

`getArtifactAbsolutePath`（`src/worker/library-service.ts:7703`）在 artifact 解析 SQL 中过滤 `a.deleted_at IS NULL`，资产移入回收站后 worker 拒绝解析其缩略图 artifact（`ASSET_NOT_FOUND` → Main 的 `serpent://` handler 返回 404 → `<img>` 不解码）。另发现同族缺陷：`listTrash` 从不 JOIN artifact 状态，恒定返回 `thumbnailArtifactId=null`。

已证伪的假设：回收站物理移动只动源文件（`.serpent/trash/<assetId>/`），不触碰 `revision_artifacts`；回收站视图走的是正常缩略图路径（searchAssets trash scope → `thumbnailArtifactMap`，无 `deleted_at` 过滤）。

### 修复（根因修复，非补丁）

1. 移除 `getArtifactAbsolutePath` 的 `deleted_at` 子句；服务边界由 `a.current_revision_id = ra.revision_id` 的 JOIN 承担——永久删除（行被 DELETE）的资产仍无法解析，`status='ready'`、`invalidated_at IS NULL`、usage allowlist、realpath/符号链接 containment 检查全部不变。
2. `listTrash` 复用 `thumbnailArtifactMap` + 媒体类型探测（与 `searchAssets` 同模式），两条回收站列表路径暴露一致的缩略图状态。

### 影响面核查

全部 4 个 `getArtifactAbsolutePath` 调用方：protocol 分发（本意）；AI 云端分析读字节（AI 入队自身在 `:7832/:7906` 过滤 deleted_at，无害）；palette 读取（best-effort）；palette job（对 trash 竞态从误报 ASSET_NOT_FOUND 变为健壮）。`serpent://source`（getCurrentMediaSource）仍拒绝 trashed 资产——不变（查看页本就不能从回收站打开）。链接资产不进 Serpent 回收站（trashAssets 拒绝非 managed；deleteLinkedAssets 硬删行）——行为不变。

### 证据（四列）

| 需求 | 实现 | 自动化 | 人工/平台 |
| --- | --- | --- | --- |
| BUG-TRASH-001 | `src/worker/library-service.ts:7703-7717`、`10612-10634` | `tests/worker/trash-relink.test.ts:393`（trash 后可解析+sharp 可解码，修复前 ASSET_NOT_FOUND）、`:434`（listTrash/search 一致）、`:451`（trash→restore 字节一致）、`:480`（永久删除回归门禁）；worker 相关 111 passed；全量 988 passed + 2 skipped（worktree 内 Electron runtime） | E2E 与 Computer Use **未执行**（合流后由主 agent 后台跑 E2E；视觉移交人工 QA） |

### 审查状态（如实记录）

- 实现 agent 自做双轴自审（Standards/Spec 无阻断）。
- workflow 广度审查 3/6 完成并通过（regression、a11y-text、css-visual，0 findings）；Standards 深审、Spec 深审、security 广度因 API 配额 403 未执行。
- 合流时主 agent 深审实现 diff（`39f134d`）：SQL 边界、listTrash 对齐、调用方影响与测试断言真实有效，判定通过。
- 纪律 #11 的 2 sonnet + 4 haiku 完整交叉审查本增量未足额执行（配额），记录为偏差；后续增量配额恢复后优先补齐。

### 环境注记

新 worktree `npm ci` 后 better-sqlite3 为 Node ABI 137，canonical `npm run test` 在 Electron 43（ABI 148）下需 `npx @electron/rebuild -f -w better-sqlite3`；该全量失败在未改动基线上复现，证明为环境问题而非本变更引入。

---

## T1 — 视觉修饰包（已合流 `f93f9f4`，实现 `68adf55`）

覆盖 9 个 REQ 条目，全部实现于 `src/renderer/`（styles.css、toast-notifications.ts、useToastNotifications.ts、App.tsx、CreateDialog.tsx、Icons.tsx）。

| 需求 | 实现要点 | 自动化 | 人工/平台 |
| --- | --- | --- | --- |
| REQ-SELECT-003 选中描边 | 选中环改为卡片外侧 2px box-shadow（比预览 1px 边框粗且完全外扩）；Shift 悬停双圈根因＝Chromium 在 Shift 键按下时匹配 `:focus-visible`，全局 button focus accent outline 与选中环叠加——卡片 focus 改为同一外扩几何，两态不再叠加 | 样式变更无自动断言；视觉项 | Computer Use 未执行，移交人工 QA（SELECT-008） |
| REQ-NAV-005 目录高亮 | `.nav-row.is-active` 移除 accent 内嵌竖条与边框色，仅背景深浅区分 hover/active | 同上 | 未执行（NAV-004） |
| REQ-THEME-004 蓝色强调色 | `--accent #42b8a4→#3b82f6`、`--accent-dark→#2563eb`；散落的硬编码 teal 全部改为 `color-mix` 从 token 派生（主按钮、toast、marquee、文本框焦点、上传装饰等） | 同上 | 未执行（THEME-001） |
| REQ-CANVAS-006 AI 搜索入口 | `smart` 图标五角星→四角星芒（与其他图标同 stroke 风格）；`.compact-action` `flex:0 0 auto`+`white-space:nowrap` 修文字溢出；搜索框 `flex:1 1 240px`（min 200 / max 360） | 同上 | 未执行（CANVAS-011） |
| REQ-CANVAS-007 滑块 | 3px 轨道 / 10px thumb / 中性 token（`--divider`/`--secondary`），不再使用强调色 | 同上 | 未执行（THEME-001） |
| REQ-CANVAS-008 预览圆角 | 预览容器 `border-radius:4px` 四角统一；选中环在父卡片上，overflow 裁剪不影响环 | 同上 | 未执行（CANVAS-010） |
| REQ-SHELL-008 新建资源库 | 起始页空态去「01」索引列与 specimen 竖栏，单列直出表单 | 同上 | 未执行（SHELL-007） |
| REQ-SHELL-009 冗余文案 | 移除「MANAGED ASSETS」「LOCAL ASSET WORKSPACE」「NEW LOCAL LIBRARY」装饰行；文件夹对话框文案随 T4 一并移除 | 同上 | 未执行（SHELL-007） |
| REQ-SHELL-010 通知淡出 | `toast-notifications.ts` 纯状态机（5s/10s 自动关闭→closing→transitionend/fallback 卸载）+ `useToastNotifications` React 绑定；`.toast` 180ms opacity/translate 退出过渡 | `tests/unit/toast-notifications.test.ts`（190 行生命周期测试）；全量 unit 408 passed | 未执行（SHELL-008） |

验证（worktree 内当次）：typecheck 通过、eslint 0 错误、unit 408 passed。

## T2 — REQ-MENU-006 文件夹菜单命令（已合流 `e257a19`，实现 `2733436`）

- 协议：Renderer→Main `folder.open-in-file-manager.request` / `folder.copy-path.request`（仅 folderId，REQ-COMMAND-003）；Main→Worker `folder.get-path`；Worker 结果（含 absolutePath）只停留在 Worker→Main 边界，renderer 响应 schema 不携带路径。
- Worker `resolveFolderPath`（`src/worker/library-service.ts`）：managed＝Assets 根 + 相对路径（磁盘缺失→`FOLDER_NOT_FOUND`）；linked＝realpath 根（offline/消失→类型化错误）。
- Main：`shell.openPath`（在访达打开文件夹）与 `clipboard.writeText`，错误映射 PUBLIC_ERROR，仿资产版 reveal/copy-path。
- 菜单：文件夹右键新增「打开」组（在 Finder 中打开）与「复制文件夹路径」；链接文件夹行改用共享菜单（链接规则入口并入，Shift+右键保留转换入口）；离线链接禁用路径动作并给出原因（与不可用资产约定一致）。
- 四列：实现见上；自动化 `tests/worker/folder-path.test.ts`（7/7：managed 嵌套解析、缺失拒绝、linked 解析、offline 拒绝、realpath 规范化）+ `tests/unit/protocol.test.ts`（+113 行注入双向拒绝）；人工/平台——Computer Use 未执行（MENU-018 待人类验收）。
- 验证（worktree 内当次）：typecheck/lint/unit 全绿、worker folder-path 7/7。

## T4 — REQ-FOLDER-007 文件夹原地编辑（已合流，实现 `e5c2c88`）

- 新增 `inline-folder-edit.ts`（176 行纯状态机：rename/create 提交、取消、类型化错误保持）与 `use-inline-folder-edit.ts`（React 绑定，命令链 folder.create/folder.rename 不变）。
- `NavigationSidebar`：`InlineFolderEditRow`——重命名时该行变输入框（自动 focus+全选，Enter 提交 / Esc 取消 / blur 按「合法非空则提交否则取消」）；新建时父文件夹首位插入待命名行（`inlineCreateRowIndex`/`inlineFolderEditDepth` 纯函数定位）；错误内联显示于行下方（`role="alert"`），输入保持打开；输入聚焦时全局快捷键经 editable-target 检查惰性化。
- 删除 `FolderRenameDialog.tsx`、`useFolderActions.ts` 及 CreateDialog 的 folder 分支（CreateDialog 现为纯资源库创建框）；侧栏「+」走同一原地流程（落在当前选中文件夹下）。
- 合流冲突解决：`App.tsx` 导入（inline hook + toast hook 并置）、`CreateDialog.tsx`（取 T4 纯资源库形态 + T1 无装饰文案意图，eyebrow 全移除）；`NavigationSidebar`/`styles.css`/folder-context-menu E2E 自动合并成功；T2 的菜单新项（打开/复制路径）与 T4 的原地编辑处理函数接口一致（onCreateSubfolder/onRenameFolder 签名未变），合并后两者共存。
- 四列：实现见上；自动化 `tests/unit/inline-folder-edit.test.ts`（245 行：提交/取消/错误保持/blur 语义），全量 unit 419 passed；E2E `tests/e2e/folder-context-menu.test.ts` 已改写为原地流程（主 agent 集中后台跑）；人工/平台——Computer Use 未执行（MENU-019 待人类验收）。

## 合流后统一验证与遗留

（合流门禁、E2E 结果随执行追加。）

- 审查偏差：纪律 #11 完整交叉审查（2 sonnet + 4 haiku/轨道）因 API 配额 403 未足额执行；已完成 T3 广度 3/6 通过 + 主 agent 对 T1–T4 全部实现 diff 的深审（架构不变量、纪律 #8/#10、类型化错误、测试真实性）。配额恢复后补一轮完整交叉审查。
- E2E 由主 agent 集中后台执行：folder-context-menu、context-menu、shell-navigation、browsing-preferences、organization-search-trash、media-preview、asset-rename。
- 视觉类条目全部移交人工 QA（本环境无 Computer Use）。
