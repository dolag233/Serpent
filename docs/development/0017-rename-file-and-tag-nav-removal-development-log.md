# 0017 资产文件重命名与 REQ-TAG-001 侧栏标签枚举移除开发日志

> 日期：2026-07-17（第二增量）
> 基线：上一提交 `c10e94c`
> 范围：REQ-MENU-002（重命名部分）、REQ-TAG-001、REQ-LABEL-002（重命名落地）

## 目标与依据

- `docs/implementation/mvp-ui-ux-requirements-backlog.md`：REQ-MENU-002 单资产菜单缺口（重命名）、REQ-TAG-001（左侧不枚举标签，已确认待实施）、REQ-LABEL-002（修改显示名称 = 重命名真实文件，走文件操作语义）。
- 选择理由：继上一增量（reveal-in-folder / copy-file-path）继续收口 0017 文件操作；复制/粘贴仍受集中澄清队列 #5 阻塞，其他应用打开另行排期。
- 未触碰 `tests/e2e/linked-folders.test.ts`（另一 agent 未提交工作）。

## 实现摘要

### 1. asset.renameFile 后端全链路

- 协议：`asset.rename-file.request` / `asset.rename-file` / `asset.file-renamed`，strictObject 双向校验；请求只含 `libraryId + assetId + newBaseName`（REQ-COMMAND-003，注入 `absolutePath` 有单测拒绝）。新错误码 `INVALID_ASSET_FILE_NAME` / `ASSET_FILE_NAME_CONFLICT`（`src/shared/protocol/errors.ts`）。
- 链路：preload（`src/preload/index.ts:521`）→ main 转发（`src/main/index.ts:934`）→ worker dispatch（`src/worker/index.ts:494`）→ `libraryService.renameAssetFile`（`src/worker/library-service.ts:9641` 附近）。
- 语义：扩展名永远保留；非法名（分隔符、控制字符、`.`/`..`、尾随空格/点、DOS 保留名、Windows 禁用字符 `<>:"|?*`、base+ext 超 255 UTF-8 字节）类型化拒绝；同名冲突走 DB identity（case-folded）+ 父目录扫描（含未跟踪文件）双查；missing/trashed/offline 拒绝（linked 离线显式查 `linked_folders.status`）；完全同名 no-op 零写入；FTS 经 `syncAssetSearchContent` 事务内同步；不记 revision（与 move/trash 惯例一致）；先磁盘后 DB、失败 best-effort 回滚 + diagnose。
- **审查后修正（M1）**：初版漏检 Windows 禁用字符 `<>:"|?*`，与错误文案"可跨平台安全使用"矛盾；已补 worker 校验（复用 `WINDOWS_FORBIDDEN_CHARACTER`）+ renderer 镜像 + worker 非法名矩阵 7 个新用例。既有文件导入仍放行此类字符（对齐 import 现状），仅约束新选名字。

### 2. REQ-TAG-001 侧栏标签枚举移除

- `NavigationSidebar.tsx` 删除整个「标签」Section（列表 + 新建输入框 + 右键菜单）；`App.tsx` 净减约 80 行（createTag/renameTag/deleteTag UI 链路、tag input state、organization 菜单 tag 分支）；`context-menu.tsx` descriptor 移除 `orgKind`；`RenameDialog` kind 收窄为 collection/smart。
- 保留：tag 范围机制（chooseTag/activeTagId、导航历史、会话恢复）、发现工具栏「标签过滤」输入框（现存进入标签范围的 UI 入口）、Inspector chip、菜单可搜索选择器、protocol/worker 全部 tag API。
- **已知搁浅能力（待产品裁决，集中澄清队列 #8）**：标签重命名/删除目前无 UI 入口；worker 域能力保留并有 worker 测试覆盖。

### 3. 重命名菜单入口与对话框

- 单资产右键菜单「组织」组新增「重命名…」（`AssetContextMenu.tsx:543`），不可用资产禁用并附原因；多选与回收站分支不出现。
- `RenameDialog` 扩展 `kind="asset"`：主名可编辑、扩展名静态展示、打开自动聚焦选中主名、内联中文错误（role=alert）、Esc/焦点陷阱接入全局链；状态机抽为 `useAssetRename.ts`（AGENTS.md 第 8 条，App.tsx 增量 ~40 行）。
- renderer 预校验镜像 worker 规则（协议层把 schema 违例压成 INTERNAL_ERROR，故客户端先拦截给友好文案，worker 仍是权威）。
- 成功后刷新当前范围并保持资产选中（E2E 断言 `aria-pressed=true`）。

## 测试证据（当次命令 + 结果）

- `npm run typecheck` / `npm run lint`：绿（仅既有 BABEL 体积提示）。
- `npm run test:unit`：39 文件 395 passed（含 protocol 新增 rename 用例，protocol.test.ts 共 51）。
- `node scripts/run-vitest-with-electron.mjs run tests/worker/asset-rename.test.ts`：8/8 passed（managed/linked、4 种冲突、missing/trashed/offline、no-op、纯大小写、非法名矩阵含 Windows 禁用字符、trim、字节边界）。
- E2E（`npx playwright test`，当次逐个文件运行）：
  - `asset-rename.test.ts` 3/3（基本改名落盘 + 选择保持、冲突内联重试、非法名内联 + Esc）；
  - `context-menu.test.ts` 10/10；`organization-search-trash.test.ts` 3/3；`organization-metadata-persistence.test.ts` 2/2；`asset-pagination.test.ts` 全绿；`browsing-preferences.test.ts` 全绿；`shell-navigation.test.ts` 1/1（含新增 REQ-TAG-001 负向断言：侧栏无「标签」区与「添加标签」按钮）。
- 修复过程记录：①asset-rename 用例 1 选择器 strict 冲突（新名出现在卡片/Inspector 3 处）→ 断言限定到卡片内；②organization-search-trash 超时 → 根因为重写后新增「筛选与排序」面板开启步骤与后文 toggle 形成奇偶（面板被关导致 `喜欢过滤` 不可见），补一次关闭恢复配对，并把该文件超时提升到与同类长旅程一致的 120s。
- 环境注意：worker 测试必须走 `scripts/run-vitest-with-electron.mjs`（better-sqlite3 ABI）；本次已按 AGENTS.md 执行 `npx @electron/rebuild -f -w better-sqlite3` 恢复 dev ABI。

## 交叉审查（AGENTS.md 第 11 条）

2 深审（Standards / Spec）+ 4 广度（回归与死代码、无障碍与未用导入、CSS 泄露、安全回归）全部完成：**0 HARD**。

- Standards：有条件通过 → 条件已满足（M1 禁用字符修正 + 文档同提交更新）。
- Spec：有条件一致 → M1 已修；M3（无防回归负向断言）已补 shell-navigation 断言；M2（回滚/SOURCE_CHANGED/IO 失败分支无测试）按验收纪律记**未验证**；M4（标签重命名/删除无 UI 入口）记为待产品裁决（澄清队列 #8）。
- 非阻断 follow-up：renameTag/deleteTag API 面 UI 不可达（待裁决）；`DialogKind` 既有死成员；renderer 校验镜像建议补单测；`useAssetRename` 回退文案死代码；对话框 aria-describedby/aria-busy 增强；org RenameDialog 不在全局 Esc 链（既有缺口）；worker TOCTOU 窗口（全库既有模式，需统一设计时处理）。

## 未验证与保留条件

- 回滚/并发守卫/IO 失败映射分支：代码存在但 failpoint 未触发，记未验证（验收纪律 2）。
- Windows 平台 rename 语义、大小写行为：未验证（无 runner，AGENTS.md 声明）。
- Computer Use / 截图：当前环境无桌面控制能力，按用户确认记**未执行**，移交人工 QA。
- linked 资产重命名的崩溃窗口：renameSync 与 DB 提交之间崩溃时，下次 linked refresh 会把新文件作 external_change 导入、旧资产 missing（与 trashAssets 同级风险，如需零窗口要新增 journal kind）。

## 人类验收清单变化

- 新增 **MENU-015 单资产重命名文件**（待人类验收）。
- TAG-001/002/003 维持已撤回；REQ-TAG-001 实施事实记录于本日志与 backlog；标签重命名/删除入口待澄清队列 #8 裁决后重新定义。
