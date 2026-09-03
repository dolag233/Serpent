# 2026-09-03 四档应用字体大小开发日志

## 目标

为 Serpent 增加“紧凑 / 默认 / 舒适 / 更大”四个相近字号档位。档位只控制应用自己的排版比例，不调用 Chromium 页面缩放，也不改变操作系统 DPI；Windows 继续使用现有 HarmonyOS Sans SC 字体栈和显式字重映射。

## 实现

- `src/renderer/font-size-preferences.ts` 定义版本化偏好、四档比例（0.94 / 1 / 1.06 / 1.12）、安全解析、持久化、slider 索引映射和根元素应用；异常存储值回退到默认档。
- `src/renderer/FontSizeProvider.tsx` 在 React 内提供偏好状态；`src/renderer/main.tsx` 在首帧前应用偏好，避免默认字号闪烁。
- `src/renderer/ui/tokens.css` 的语义字号、`src/renderer/styles.css` 和 3D 查看器字号统一读取 `--ui-font-scale`；常用字重读取 UI 字重 token，保留少量既有中间字重以维持视觉层级。
- 主进程独立危险确认窗口在测量内容前读取父窗口的已校验字号比例和平台字体栈，避免独立 data URL 窗口脱离应用字号/Windows 字体设置。
- 外观设置复用现有设置卡片和 elevation slider 的轨道、thumb、刻度 token，并补充中英文文案；slider 暴露四个整数档位和当前档位的可读名称。

## 四列可追溯

| 需求条目 | 实现位置 | 自动化测试 | Computer Use / 平台证据 |
| --- | --- | --- | --- |
| 四档偏好、异常值回退与持久化 | `src/renderer/font-size-preferences.ts:6-35`；`src/renderer/FontSizeProvider.tsx:38-55`；`src/renderer/AppSettingsPages.tsx:58-65,307-370` | `tests/unit/font-size-preferences.test.ts:47-78`；`tests/unit/font-size-provider.test.tsx:28-56` | macOS Computer Use 会话已选中 0/1/2/3 四档并恢复默认；截图未入库，避免带入用户资产信息 |
| 首帧应用、不使用 page zoom | `src/renderer/main.tsx:42`；`src/renderer/ui/tokens.css:1-120` | `tests/e2e/shell-navigation.test.ts:238-269` 四档断言 | macOS Electron E2E 四档 scale/字号/zoom 断言通过 |
| Renderer / 设置 / 资产界面 / 查看器字号适配 | `src/renderer/styles.css:7651-7795`；`src/renderer/ui/ui.css`；`src/renderer/3d-viewer/viewer-surface.css`；`src/renderer/AppSettingsPages.tsx:338-370` | `tests/e2e/shell-navigation.test.ts:243-269,422-440`；字体偏好单测 | Computer Use 检查设置、主工作区、收起导航、Inspector、标签/颜色弹层、菜单、资源库切换器、3D 查看器，未见裁切或布局崩坏 |
| 独立危险确认窗口随父窗口字号适配 | `src/main/critical-confirmation-window.ts:1-160` | `tests/unit/critical-confirmation-window.test.ts:1-120` | 单测覆盖 scale 与平台字体栈同步；真实危险确认未触发（避免删除操作） |
| Windows 字体栈、字重、DPI / 分辨率 | `src/renderer/styles.css`；`src/renderer/harmonyos-sans-sc-windows.css`；`src/renderer/ui/tokens.css` | `tests/e2e/windows-typography.test.ts:1-120`（仅 Windows 执行） | 当前 macOS 环境无法执行，Windows / packaged / 真实 DPI 未验证 |

## 验证记录

| 检查 | 命令 / 结果 |
| --- | --- |
| 字体偏好与主进程确认窗定向单测 | `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/font-size-preferences.test.ts tests/unit/font-size-provider.test.tsx tests/unit/critical-confirmation-window.test.ts`：3 files，8 tests passed |
| PDF 缩略图回归 | `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/thumbnails.test.ts tests/unit/pdf-viewer-layout.test.ts`：2 files，76 tests passed |
| 全量测试（此前三档基线） | `npm run test`：507 files，4,380 tests passed；15 files / 25 tests skipped |
| 本次全量回归 | `npm run test`：506 files passed，1 file failed，15 skipped；4381 passed，25 skipped。失败为既有 `tests/unit/plugin-standard-host-probe-fixture.test.ts` 的 guest realm 激活断言；单独重跑该文件为 1/1 passed，字体/过滤定向测试均通过，因此全量门禁本次仍记为未全绿。 |
| Electron 字体 E2E | `node scripts/run-e2e.mjs tests/e2e/shell-navigation.test.ts`：1 passed，覆盖 0/1/2/3 |
| 全量 Renderer 单测 | `npm run test:unit`：421 files passed，1 skipped；3,085 tests passed，3 skipped |
| TypeScript | `npm run typecheck`：通过 |
| ESLint | `npm run lint`：通过 |
| CSS / diff 空白检查 | `git diff --check`：通过 |
| 真实 Electron / Computer Use | macOS 已检查四档 slider（含最大档）及主要工作区/弹层/Inspector/3D 查看器；字体偏好恢复默认。亮暗主题、中英文、窄窗口、危险确认真实窗口、Windows/DPI、packaged 未执行 |

## 验收边界

自动化和 macOS 视觉检查不能替代 Windows 字体、不同 DPI / 分辨率、packaged app 和用户本人验收；未取得对应证据前不写“全平台通过”。
