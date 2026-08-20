# Serpent 自动更新开发记录

日期：2026-08-20
工单：`Serpent-a3415e`
范围：GitHub Releases 更新检查、安装版/便携版分流、关于页面入口。

## 发布现状与决策

使用 `gh release view v0.1.2 --repo dolag233/Serpent --json ...` 核对到当前公开 Release 提供：

- macOS arm64：`*-package.dmg`、`*-portable.zip` 及各自 `.sha256`
- Windows x64：`*-setup.zip`、`*-portable.zip` 及各自 `.sha256`
- 没有 `latest.yml`、`latest-mac.yml`、`RELEASES` 或 `RELEASES.json`

官方 Electron 研究记录见 [`2026-08-20-electron-forge-github-release-auto-update.md`](../research/2026-08-20-electron-forge-github-release-auto-update.md)。当前 Forge ZIP + Inno Setup 与 Electron 原生 Squirrel/Mac、Squirrel.Windows 或 `electron-updater` 的 NSIS 假设不匹配，因此本次采用 Main-owned GitHub Release provider，不把普通 ZIP/DMG 宣称为原生 `autoUpdater` feed。

## 实现

- `src/main/app-update-service.ts`：调用公开 `/releases/latest`，只接受稳定 SemVer Release 和 GitHub HTTPS asset；依据当前平台、架构及安装/便携形态选择固定资产名；下载到用户 Downloads 后校验 GitHub digest 或 `.sha256`，安装版打开 DMG/解压打开 `SerpentSetup.exe`，便携版只下载并显示位置。
- Windows 安装版优先通过 Inno 安装目录中的 `.serpent-installed` 标记识别，并兼容旧安装的 `unins*.exe`；便携版支持 `PORTABLE_EXECUTABLE_*` 或 `SERPENT_DISTRIBUTION=portable` 显式标记。macOS 默认按 `/Applications/*.app` 识别，支持 `SERPENT_DISTRIBUTION` 覆盖；macOS 拖拽安装与 ZIP 解压在任意目录时无法仅靠应用自身绝对可靠地区分。
- `src/shared/app-update.ts`、Preload/Main IPC：Renderer 只收到状态、资产名和版本，不收到绝对下载路径。
- `src/renderer/AboutDialog.tsx`：帮助 → 关于 Serpent 页面把更新操作收紧到版本行，加入刷新图标与可用更新行的下载图标，复用现有主题 token、图标和 hover tip；双语文案同步。
- `src/renderer/App.tsx`：Windows 自定义主菜单与 macOS 原生菜单统一走 `openAbout`，进入关于页时自动触发更新检查。
- 发布手册补充资产命名、校验 sidecar 和未来迁移到 Squirrel/NSIS 的边界。

## 2026-08-21 清理修复

首次实现只负责下载、校验并启动安装器，安装版成功或打开失败后仍会留下 Downloads 中的压缩包；Windows 解压失败时也可能留下 `serpent-installer-*` 临时目录。本轮将安装产物生命周期收口：

- 安装版在安装器启动成功、打开失败、校验/下载失败、取消或异常退出后，统一清理下载包；Windows 解压出的临时安装目录也会递归清理，并对短暂的文件占用进行有限重试。
- Windows 安装器进程可能在 Serpent 退出后仍锁定自身 executable；主进程在启动安装器时额外安排一个 detached `cmd.exe` 清理兜底，等待安装器释放文件后删除临时目录。
- 便携版下载成功后保留 ZIP，并在下载目录中显示，便于用户手动解压/替换；便携版校验、下载或取消失败仍清理不完整文件。
- 安装进入解压阶段后不再显示“停止下载”，避免把无法中止的安装启动过程误导成可取消下载。

独立双轴审查后补强：Windows Inno 安装器写入 `.serpent-installed` 标记并保留旧版 `unins*.exe` 兼容识别；校验/下载失败补充 Main 日志上下文；About 页面按网络、资产缺失、校验、下载和打开失败分别给出双语提示。macOS `/Applications` 之外的安装来源仍需显式 `SERPENT_DISTRIBUTION=installed` 或后续构建级 marker，不能宣称已绝对识别。

## 验证记录

| 需求 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 公开 Release 检查与 SemVer 比较 | `src/main/app-update-service.ts` | `tests/unit/app-update-service.test.ts` | 当前 `v0.1.2` Release 已通过 `gh release view` 核对；真实打包应用未执行 |
| 安装版/便携版资产分流 | `detectAppDistribution` / `selectUpdateAsset` | 同上，6 tests passed | Windows Inno、Windows portable、macOS DMG/ZIP 真机旅程未执行 |
| 下载后校验再打开/显示 | `downloadAndInstall` | 同上，包含便携包下载、Windows 安装器解压、SHA-256 校验 | 未执行真实大包下载、安装器升级、退出重启与失败恢复 |
| About 页面入口、版本行更新控件与进入页面自动检查 | `src/renderer/AboutDialog.tsx` / `src/renderer/App.tsx` / `src/renderer/styles.css` | `tests/unit/about-dialog.test.ts`：可用版本行和两个 hover label `1 passed`；`tests/e2e/shell-navigation.test.ts`：macOS 原生 About 入口、刷新按钮 hover 属性和开发态自动检查 `1 passed`；打包启动 E2E `2 passed`、Windows `1 skipped` | macOS 开发态路径已由 Electron E2E 覆盖；Windows 分支、packaged/便携版真实更新旅程和人工视觉验收仍待执行 |

当次命令结果：

- `npm run package`（本轮 UI 收口后的当前 HEAD）：macOS arm64 打包通过；`npm run verify:package` 通过。
- `SERPENT_E2E_PACKAGED_EXECUTABLE=/Users/dolag/Development/Serpent/out/Serpent-darwin-arm64/Serpent.app/Contents/MacOS/Serpent npm run test:e2e:packaged`：`2 passed / 1 skipped`；Windows 关闭按钮用例因平台跳过。
- `npm run rebuild:native`：better-sqlite3 重编译完成，FTS5 probe 通过。
- `npx vitest run --config vitest.config.ts tests/unit/app-update-service.test.ts tests/unit/about-dialog.test.ts`：`2 files / 16 passed`，覆盖便携版保留、安装版成功清理、打开失败、Windows 无效安装包、取消清理以及解压后隐藏取消按钮。
- `node scripts/run-e2e.mjs tests/e2e/shell-navigation.test.ts`：`1 passed`；覆盖 macOS 原生菜单进入 About、进入页面后的开发态自动检查、版本行刷新按钮及 `data-hover-tip="检查更新"`。
- 定向 ESLint：0 errors；保留既有 `src/renderer/App.tsx:7749` hook dependency warning。
- `git diff --check`：通过。
- `npm run typecheck`：新增更新代码与新增单测类型检查通过；仍被既有 `tests/unit/ticket-script.test.ts` 对 `*.mjs` 的 4 个 named export 声明错误阻断，未将其写成全绿。

人工验收条目：`RELEASE-UPDATE-001`，状态“待人类验收”。
