# 2026-08-29 资源浏览区资产拖拽回归开发日志

## 用户问题

用户反馈资源浏览界面无法拖动资产，因而无法通过拖拽移动文件路径。卡片仍能显示，说明浏览查询成功，但拖拽开始时没有进入 Electron 原生文件拖拽。

## 根因

浏览画布已从旧的 `asset.list` / `asset.search.result` 响应切换为分页 Browse Session。Main 进程的原生拖拽缓存预热仍只识别旧响应类型，因此 `browse.session.opened` 和 `browse.session.page` 的资产从未写入原生拖拽缓存。Renderer 的生产路径在 `dragstart` 时找不到缓存条目，`startDrag` 静默返回，表现为拖拽功能完全消失。

## 修复

- 新增 `src/main/native-asset-drag-prime.ts`，集中维护卡片响应到拖拽预热资产的映射。
- 加入 `browse.session.opened`、`browse.session.page`，保留旧的列表、搜索和智能合集响应；并覆盖刷新、移动、复制、恢复、重命名、重链接、文本保存、扩展保存、普通导入和 Eagle/Billfish 导入等所有返回 `AssetSummary` 的响应形状。
- `asset.import.resolve` 没有直接携带 `libraryId`，现在通过冲突计划保留的 `importId → libraryId` 上下文完成拖拽预热。
- 只向 Main 传递资产 ID 和序列帧 ID；绝对路径仍由 Worker 解析，符合 Renderer 不接触任意文件路径的进程边界。
- 新增回归单测，覆盖 Browse Session 首页、分页、旧响应、所有变更/导入响应类别和失败/非卡片响应。
- 原生 Electron 拖拽返回 Renderer 时表现为 `Files`，合集与回收站此前只识别内部 MIME，导致没有高亮；现在统一识别原生 `Files` 与内部托管 MIME。链接文件夹导入后的刷新改为等待完整导航快照，避免操作已完成但侧栏仍暂时缺少新链接文件夹。

## 验证记录

| 检查 | 命令/结果 |
| --- | --- |
| 拖拽映射与缓存单测 | `npx vitest run --config vitest.config.ts tests/unit/native-asset-drag-prime.test.ts tests/unit/native-asset-drag.test.ts`：通过（包含所有资产响应形状） |
| 侧栏拖拽高亮单测 | `npx vitest run --config vitest.config.ts tests/unit/navigation-sidebar.test.ts`：5 tests passed；合集与回收站原生 `Files` 拖拽高亮回归通过 |
| 拖拽、提示音、JFIF 定向单测 | `npx vitest run --config vitest.config.ts tests/unit/native-asset-drag-prime.test.ts tests/unit/native-asset-drag.test.ts tests/unit/task-completion-sound.test.ts tests/unit/format-filter-presets.test.ts tests/unit/media-formats.test.ts`：5 files / 25 tests passed |
| 浏览画布拖放 Electron E2E | `node scripts/run-e2e.mjs tests/e2e/folder-recursive-scope.test.ts`：3 tests passed；含资产卡片拖到文件夹卡片移动路径 |
| 链接文件夹相关 E2E | 当前构建逐项重跑：普通链接文件夹完整流程 1/1、完整重启恢复 1/1、默认忽略规则 1/1；此前全量串行运行中 5 秒行查找超时，根因是菜单命令异步触发导入/导航快照尚未回填，已改为等待导航快照 |
| 插件管理 E2E | `node scripts/run-e2e.mjs tests/e2e/plugin-management.test.ts --grep "installs a library plugin"`：1 passed；此前单次重启启停检查失败未复现 |
| 响应映射与侧栏回归定向检查 | `npx vitest run --config vitest.config.ts tests/unit/native-asset-drag-prime.test.ts tests/unit/navigation-sidebar.test.ts && npm run typecheck`：9 tests passed，typecheck 通过 |
| 资源库可用性底线 | `npm run test:library-availability`：9 files / 207 tests passed |
| 全量 unit | `npm run test:unit`：410 files passed、1 skipped；3012 tests passed、3 skipped |
| 全量 Electron E2E | `npm run test:e2e`：84 passed、3 skipped、0 failed；当前构建串行运行 7.2 分钟 |
| 类型检查 | `npm run typecheck`：通过 |
| ESLint | 改动文件定向 ESLint（关闭既有 `react-hooks/set-state-in-effect` 规则）通过；全量 `npm run lint` 仍仅报告未改动的 `src/renderer/App.tsx:520` |
| diff 检查 | `git diff --check`：通过 |

## 未验证边界

E2E 为了避免原生 OS 拖拽嵌套事件循环使用 HTML5 诊断路径；macOS/Windows 真正从资源卡片拖到侧栏文件夹、Finder/Explorer 的原生文件拖拽仍需人工验收。工单 `Serpent-d549d8` 保持 `in_progress`，不能仅凭上述自动化标记为人类验收通过。

## 合并到 `dev` 后复测（2026-08-29）

- 首次全量 E2E 暴露了测试自身的两个竞态/平台假设：macOS 不应查找 Windows 标题栏控件；通过测试桥导入后点击“刷新磁盘变化”只代表事件已派发，不能代表异步刷新已结束。已分别移除跨平台误断言，并让辅助函数等待刷新按钮恢复可用；没有放宽生产切库保护。
- 当前 `dev` 全量 Electron E2E：`npm run test:e2e`，84 passed、3 skipped、0 failed，耗时约 7.3 分钟。
- 当前 `dev` 资源库可用性：`npm run test:library-availability`，9 files / 208 tests passed。
- 当前 `dev` 全量 unit：`npm run test:unit`，413 files passed、1 skipped；3037 tests passed、3 skipped。
- 当前 `dev` 类型检查：`npm run typecheck`，通过；全量 ESLint：`npm run lint`，通过；`git diff --check`，通过。
