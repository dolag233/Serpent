# A-D 阶段验收反馈汇总（E）

日期：2026-08-13
范围：A 全仓库代码审查、B 审查总结、C 全量 E2E、D Computer Use 真实用户旅程
结论：不能发布为“全功能通过”。当前 macOS packaged 主路径可用，但仍存在发布阻断的自动化、历史一致性、MCP 契约和 Windows 未验证项。

## 1. 证据基线

| 阶段 | 证据 | 结论 |
|---|---|---|
| A/B | `docs/internal/reviews/2026-08-12-full-repository-review.md` 与既有 Luna 审查 | 发现 History、Worker 恢复、MCP 无状态契约、Windows 路径/句柄等结构性风险。 |
| C | `docs/internal/qa/2026-08-13-full-e2e-c-report.md` | 标准开发态 76 passed / 3 skipped / 0 failed；扩展组仍有 MCP launcher、序列帧、AI Inspector、metadata 定位器失败；3D/PBR 因无 WebGL 阻塞。 |
| D | `docs/internal/qa/2026-08-13-computer-use-d-full-journey-report.md` | 18 个真实用户目标全部逐项执行，但仅部分目标全绿；视频/GIF 已通过真实 UI 补测。 |
| 平台 | 当前环境 macOS arm64 | Windows runner、Windows packaged、Windows GPU/WebGL、NTFS/UNC/句柄行为均未验证。 |

## 2. 发布阻断问题（P0/P1）

这些问题应先于发布修复，不能用局部 UI 通过抵消：

1. 历史 MCP headless launcher 的 `listTools` 60 秒超时，并出现 `$RefreshReg$ is not defined`：已由 `Serpent-6dp0` 迁移为当前 Desktop 内嵌 HTTP E2E；旧 `Serpent-ibu7` 已按 ADR 标记废弃，不再作为当前产品入口。
2. MCP 权限档此前仍暴露旧的 read-only/read-write/full-access 与 Desktop prompt，和新版无状态、Auto/Full Access、危险操作 challenge 契约不一致：`Serpent-8b5b`、`Serpent-8b5b.13`（本轮已修复子任务，Epic 仍有其他缺口）。
3. MCP 插件工具缺少显式 `libraryId`，可能回退当前库；插件暴露开关未完全接入：`Serpent-8b5b.12`（已修复子任务，Epic 仍有其他缺口）。
4. MCP/脚本/Worker 取消、断线恢复、durable Job 和重启对账不完整：`Serpent-8b5b.11`。
5. Worker 崩溃后缺少有界重启、重连和资源库恢复：`Serpent-i78d`。
6. 文件副作用与 History receipt 非原子，Undo/Redo transition 中途失败或重启只能标 stale，不能补偿或继续：`Serpent-5n4z.15`。
7. 批量资产/文件夹/混合 Trash 操作只保留最后一个 history entry，一次 Undo 不能恢复完整用户意图：`Serpent-5n4z` 及其子任务。
8. 只读降级下删除可能先发生磁盘副作用，再被数据库拒绝：`Serpent-bd5o`（已修复并有 Worker 对账单测）。
9. 资产作用域刷新后卡片丢失，已导致浏览偏好、右键菜单、组织流程等 E2E 失败：`Serpent-d112.1`。
10. 框选坐标缓存的布局失效已由 `Serpent-wgl2.1` 修复并通过 Electron 回归；拖拽过程帧率问题仍由 `Serpent-2qsz` 跟踪。
11. 序列帧 Home/ArrowRight 存在 0/1-based 偏移：`Serpent-ramh`（核心竞态已修复；完整 E2E 后续仍被旋转控件 locator 阻塞）。
12. Windows UNC 路径、`EPERM`/FILE_BUSY、链接文件夹目录回收站和长路径等仍缺少正确实现或实机证据：`Serpent-8b5b.9`、`Serpent-5n4z.9.1`、`Serpent-5n4z.9.2` 等。

## 3. D 阶段真实 UI 结果

### 已通过或有直接证据

- 新建资源库、选择位置、冷启动打开和退出恢复。
- 图片导入、视频导入、视频海报/元数据预览。
- GIF 导入、卡片预览、Inspector 预览和 86 帧元数据。
- 普通搜索、文件夹创建、合集创建、作者字段编辑。
- 两个视频 `Cmd+A` 批量选择；右键菜单显示 2 项批量标签、合集、移动、回收站等操作。
- `Cmd+Z` 与 `Shift+Cmd+Z` 的基础撤回/重做提示。
- 回收站入口和危险操作独立确认窗口；确认说明不可撤销、不能被 MCP 权限绕过，测试只点击取消。
- 导出 ZIP 默认名称自动使用当前库名称（`meme资源库.zip`）。
- MCP 设置页显示回环地址、自动启动、客户端凭据和访问模式。

### 部分完成或未验证

- 同名冲突：重复选择同一源文件时原生导入按钮保持禁用，没有形成“同名冲突/内容重复”决策对话框证据；需补专用 fixture 和冲突分支 E2E。既有冲突契约工单继续保持打开。
- 批量移动：批量菜单入口可见，但 Computer Use 菜单动作的 element ID 失效，未完成移动后范围与撤回闭环；不能写成通过。
- 框选：本轮未形成滚动中框选、布局变化后框选和帧率基准的稳定证据，沿用 P1 工单。
- PDF：原生选择器能找到 `ReSTIR DI.pdf`，但导入按钮保持 disabled；当前媒体注册表也没有 PDF 预览注册，不能写成 PDF 查看器通过。
- 3D/PBR：原生选择器能找到 FBX，但导入按钮保持 disabled；本轮没有 GLB/glTF/OBJ/STL 可导入 fixture，也没有 WebGL 可用环境，因此不能宣称 3D 通过。相关 0030 任务和 WebGL 阻塞继续保留。
- 视频 AI：导入后 Inspector 有 AI 描述和标签，批量菜单也显示“AI 分析（2 项）”；手动再次触发、失败恢复和停止/重试未完成。
- 多媒体查看器：图片、视频、GIF 有直接截图证据；音频、序列帧、PDF、3D 的完整查看器旅程未闭环。

## 4. 测试工具与产品缺陷的边界

D 过程中 Computer Use 右键菜单出现可见菜单但后续 element ID 失效，导致菜单动作无法执行，且菜单一度无法通过可见 Cancel 关闭。该现象应作为测试基础设施/可访问性定位问题记录，不能直接归因于 Serpent 的移动或 AI 业务逻辑；因此相关功能统一标记“未验证/测试工具阻塞”。

为恢复测试实例曾关闭并重新启动当前 packaged app；没有执行永久删除、清空回收站或从硬盘删除资源库。测试向用户的 `meme资源库` 新增了 2 个视频和 1 个 GIF，最终显示 706 项资产；未自动删除这些测试资产。

## 5. 修复顺序

1. 先修 MCP launcher、无状态/权限/插件目标库/Job 取消恢复，重新跑 C 的 MCP 与脚本扩展 E2E。
2. 修 History group、receipt 原子性、Worker 崩溃恢复和只读副作用门禁，补 failpoint + 重启 + 磁盘/SQLite/journal 对账。
3. 修核心浏览/框选作用域、性能和序列帧偏移，重跑真实 Electron E2E 与 Computer Use。
4. 补冲突 fixture，分别验证同名冲突和内容重复，确认视频冲突预览图不回归。
5. 在可用 GPU 环境补 3D/PBR；在 Windows 实机/packaged 环境补路径、句柄、权限、快捷键和安装器证据。
6. 最后重新执行全量门禁、独立 Luna 审查和 D 关键用户旅程，只有四列证据齐全的条目才能标记 accepted。

## 6. E 阶段结论

E 阶段反馈汇总完成。当前应进入修复阶段，但不应关闭已有 P1 工单，也不应把 macOS Computer Use 结果外推成 Windows 通过。修复后必须同步自动化测试、QA 矩阵和人类验收清单。

## 7. 本轮已落地修复

- MCP 权限模型已切换为 `auto` / `full-access`；旧 read-only/read-write 配置只在读取时迁移到 Auto，不再产生 Desktop 写入确认窗口。
- Auto 与 Full Access 的 routine/recoverable 操作均可无人值守执行；危险操作两档都保留一次性、精确绑定的 Agent challenge。
- 插件 MCP 调用已强制显式 `libraryId`，Provider 不再回退 Desktop 焦点库；暴露开关同时约束 list/call。
- MCP 设置页、英文/中文文案、MCP 手册和 `AUT-030/AUT-033/AUT-035` 已同步。
- 证据：权限相关 4 个 Vitest 文件共 40 tests passed；`npm run typecheck` 与定向 ESLint 通过。真实 Desktop 设置 UI、packaged 和 Windows 仍未验证。
- MCP 历史 launcher E2E 已迁移：`node scripts/run-e2e.mjs tests/e2e/automation-mcp-launcher.test.ts` 通过（1 passed，6.6s），覆盖隔离 Desktop profile、配置复制、HTTP `initialize/tools/list/tools/call`、断开重连；`AUT-015` 与开发日志已同步。packaged/Windows 未验证。
- 框选布局缓存修复已通过：`node scripts/run-e2e.mjs tests/e2e/selection-marquee.test.ts --grep "masonry Tab|invalidates card geometry"`（2 passed，5.3s），并有布局签名单测；`Serpent-wgl2.1` 已关闭。Windows 真实鼠标路径未验证。
- 本轮最终定向 Worker/Renderer/MCP 测试：11 文件 89 passed；`npm run test:unit`：322 文件、2463 passed、1 skipped；`npm run test:worker`：61 文件、1021 passed、10 skipped；`npm run typecheck`、定向 ESLint、`git diff --check` 通过。测试期间曾遇到 Node/Electron native ABI 不匹配，已按仓库流程使用 `@electron/rebuild` / `ensure-native` 恢复后重跑通过。

### E 后独立 Luna 审查与修复

- Luna 发现插件 MCP 静态目录仍可能依赖 Desktop 当前库；已移除 Provider 的当前库 fallback，静态 `list()`/`isKnown()` 与显式目标调用分离，并补 Provider 暴露门禁。
- Luna 发现未知 MCP 工具可能被提前的 `libraryId` 解析误报为目标缺失；已先判定工具命名空间，未知工具稳定返回 `MCP_TOOL_NOT_FOUND`。
- Luna 发现框选 `useCallback` 存在 `applyMarqueeBoxStyle` 依赖警告；已将样式写入器稳定为 Hook callback 并补依赖。
- 主动收口 Windows 风险：插件 MCP 暴露配置改用统一 crash-safe `writeAtomicJsonFile`，避免 Windows 直接 rename 覆盖失败。
- 审查记录见 `docs/internal/reviews/2026-08-13-acceptance-e-luna-review.md`。本轮定向 6 文件 50 tests passed、typecheck/lint/diff check 通过；Windows、packaged、Worker 取消/重启、History 原子性仍由既有 P1 工单跟踪。

### plugin-first v28 旧库迁移补丁

- `Serpent-btgc` 已修复：旧 plugin-first v28 库在重写 migration history 前会补齐 canonical v33–v36 的模型 artifact、content fingerprint、operation history 和 redo stack；部分 operation history schema 会 fail closed，不会伪装成 v36。
- 真实 plugin-first 历史 fixture 迁移后写入并重开读取 history barrier；schema compatibility、library service、operation history 共 83 passed；全量 worker 61 files passed / 1022 passed。
- 记录见 [`plugin-first v28 migration development log`](../development/2026-08-13-plugin-first-v28-migration-fix.md) 和 [`plugin-first v28 migration review`](../reviews/2026-08-13-plugin-first-v28-migration-review.md)。Windows、packaged、真实用户库升级仍未执行。
