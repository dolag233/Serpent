# 主视图交互反馈 QA

候选为 `dolag_dev` 基线 `ebb7f9be` 之上的工作区，Windows 后台 Electron 从本轮 Vite 构建启动，使用隔离的配置和测试库。

| 需求 | 实现位置 | 自动化覆盖 | 人工与平台证据 |
| --- | --- | --- | --- |
| `CARD-RENAME-046` 资产和文件夹名称拖选 | `src/renderer/inline-rename-text-selection.ts:3`、`src/renderer/FolderCard.tsx:113` | `tests/e2e/browse-feedback.test.ts:103` 的 F2 拖选旅程和 `tests/unit/folder-card-rename.test.tsx:60` | Windows 后台 Electron 通过，待用户验收，macOS 与发布包未执行 |
| `LIBRARY-CREATE-PICKER-047` 等待创建位置期间无加载提示 | `src/renderer/App.tsx:6323`、`src/main/library-create-location.ts:21` | `tests/e2e/browse-feedback.test.ts:159` 的挂起选择器、取消与重试；`tests/unit/library-create-location.test.ts:14` 验证凭证 | Windows 后台 Electron 通过，系统对话框由可控替身挂起，实际系统窗口的前台表现待用户验收，macOS 与发布包未执行 |
| `CANVAS-CREATE-FOLDER-048` 在当前目录空白处新建子目录 | `src/renderer/folder-browse-canvas.ts:101`、`src/renderer/AssetContextMenu.tsx:794` | `tests/e2e/browse-feedback.test.ts:131` 的全库聚合视图、根目录、嵌套目录和收起侧栏旅程；`tests/unit/folder-browse-canvas.test.ts` 验证范围边界 | Windows 后台 Electron 通过，待用户验收。链接目录、macOS 与发布包未跑端到端 |

定向 Vitest 通过 9 文件 247 项。定向 ESLint 无错误，`App.tsx` 有一条既有 AI 回调依赖警告。`npm run typecheck` 仍被既有 CLIP 预览的四条类型错误阻断。资源库 Worker 创建、打开和数据库协议未调整；真实 Electron 资源库生命周期用例覆盖正常创建、关闭、重新打开、完整重启和无效最近库。

最终从当前代码重建后运行 `node scripts/run-e2e.mjs tests/e2e/browse-feedback.test.ts tests/e2e/library-lifecycle.test.ts`，6 项通过（约 1.8 分钟）。本轮最终的文件夹卡片单测重跑 3 项通过。测试应用与夹具在各用例结束时清理；自动执行审批阻止了清理测试运行记录目录。

2026-11-19，用户验收通过创建位置选择、空白处新建文件夹和文件名称拖选，报告侧栏文件夹名称仍无法拖选。新增的侧栏 F2 用例在修复前实测仍全选四个字符，修复后用同一鼠标轨迹选中部分文字，Esc 后原目录行恢复。`node scripts/run-e2e.mjs tests/e2e/browse-feedback.test.ts -g 'in the sidebar' --trace off` 在 Windows 后台 Electron 重建后 1 项通过（22.9 秒）。`npx vitest run --config vitest.config.ts tests/unit/navigation-sidebar.test.ts tests/unit/folder-card-rename.test.tsx` 共 49 项通过。侧栏修复待用户复验。

随后用户确认侧栏拖选通过。`CANVAS-FOLDER-MENU-049` 的菜单在 `src/renderer/AssetContextMenu.tsx:792`，当前目录及导入参数在 `src/renderer/App.tsx:15509` 和 `src/renderer/App.tsx:10181`。`node scripts/run-e2e.mjs tests/e2e/browse-feedback.test.ts -g 'blank canvas' --trace off` 最终 Windows 后台重建后 2 项通过（40.8 秒）。用例核对根目录与具体目录标题、新建子目录、文件导入、文件夹导入和剪贴板图片写入。测试在 `tests/e2e/browse-feedback.test.ts:160` 和 `tests/e2e/browse-feedback.test.ts:189`，使用隔离目录与系统选择器替身。剪贴板图片注入只在解包测试模式下优先，测试不依赖系统剪贴板的文件列表。菜单/目录范围/粘贴目标单测 26 项通过，Main 导入路由单测 12 项通过。用户人工验收、链接目录端到端、macOS 和发布包待执行。
