# 2026-07-29：交互式脚本沙箱预览 QA（Serpent-opwv）

> 状态：受限 Desktop Console 的定向自动化与隔离真实 Electron E2E 通过。Computer Use 因 macOS 锁屏未执行，因此没有独立视觉或人类验收结论；此前 echo-only 预览的 UI 截图不能作为此能力的验收证据。
>
> 基线：`a160f60`（工作树增量，尚未提交）

## 计划验证

- controller 单元测试：运行、成功、错误、停止、忽略过期消息。
- QuickJS 原型回归：TypeScript、宿主能力、导入、CPU、内存、输出、Promise 与取消。
- 类型检查和定向 ESLint。
- 隔离真实 Electron E2E：以临时测试资源库运行实际 `assets.search` + `assets.setRating` 脚本，确认脚本窗口、结果、写入和 Inspector 评分。原生授权框由只能在未打包 E2E 环境开启的测试接缝确认；取消授权、亮/暗主题、窄窗布局和视觉质量仍交给 AUT-006 人工验收。

## 已执行自动化

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npx vitest run --config vitest.config.ts tests/unit/dialog-escape-stack.test.ts tests/unit/quickjs-sandbox-prototype.test.ts tests/unit/script-sandbox-preview-runtime.test.ts tests/unit/script-sandbox-preview-controller.test.ts` | 4 files、26 tests 通过 |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/automation-command-gateway.test.ts tests/worker/automation-readonly-command-executor.test.ts` | 2 files、16 tests 通过 |
| `npx eslint src/renderer/App.tsx src/renderer/dialog-escape-stack.ts src/renderer/use-dialog-escape-dismiss.ts src/renderer/ScriptSandboxPreviewDialog.tsx src/renderer/script-sandbox-preview-*.ts src/shared/script-sandbox-limits.ts src/scripting/quickjs-sandbox-prototype.ts tests/unit/{dialog-escape-stack,quickjs-sandbox-prototype,script-sandbox-preview-runtime,script-sandbox-preview-controller}.test.ts` | 通过 |
| `npx vite build --config vite.renderer.config.ts` | 通过；确认 renderer Web Worker、QuickJS/WASM 可生产构建。Vite 报 Worker 3.5 MB 的 chunk-size 警告；Worker 仅在按“运行”时加载，正式 Runtime 仍需另行性能设计。 |
| `npx vitest run tests/unit/search-expression.test.ts tests/unit/automation-script-ipc.test.ts tests/unit/automation-execution-journal.test.ts tests/unit/automation-command-gateway.test.ts tests/unit/quickjs-sandbox-prototype.test.ts tests/unit/script-sandbox-preview-runtime.test.ts tests/unit/script-sandbox-preview-controller.test.ts` | 7 files、63 tests 通过；覆盖工具栏/脚本共享的搜索语法、脚本启动、分页评分命令、完成记录、Gateway 授权/限额和 renderer 销毁后的自动取消。 |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/batch-rating.test.ts tests/worker/automation-readonly-command-executor.test.ts tests/worker/bounded-write-command.test.ts` | 3 files、12 tests 通过；临时资源库实际从 automation-only 搜索得到 `Ser-reference.png`，再经有界写路径将其改为 4 星。 |
| `npx vite build --config vite.renderer.config.ts` | 通过；当前 Worker chunk 约 3.54 MB，Vite 输出已知的 >500 kB 提示。按“运行”才加载 Worker，性能优化仍属于后续 Runtime 范围。 |
| `npm run typecheck && npm run lint -- --quiet && git diff --check` | 通过；ESLint 仅输出既有的 `library-service.ts` 大文件 Babel 提示。 |
| `git diff --check` | 通过 |
| `node scripts/run-e2e.mjs tests/e2e/automation-script-rating.test.ts` | 通过，1 passed（2.3s）；隔离 Electron 建临时库并导入两项资源，打开实际「自动化脚本」窗口，运行默认脚本后检查 `matched: 1`、`updatedCount: 1` 与 Inspector 的 4 星。测试专用授权仅在未打包的 `SERPENT_E2E=1` + `SERPENT_E2E_AUTOMATION_CONFIRM=1` 同时成立时跳过原生对话框。 |

## 真实 UI 状态

隔离 Electron E2E 已经通过产品的真实 Renderer、Preload、Main 与 Library Worker 路径，证明了临时资源库的搜索、评分写入及 Inspector 结果。为了避免 Playwright 不能控制原生 `dialog.showMessageBox` 阻塞测试，该测试仅在未打包且显式设置两项 E2E 环境变量时自动确认授权；普通 `npm start` 与打包应用仍会显示真实授权框。

当前 macOS 会话锁屏，Computer Use 无法进入桌面。待解锁后，仍必须按 [AUT-006](automation-foundation-test-guide.md#aut-006受限自动化脚本开发态手动测试) 用临时资源库完成真实授权确认/取消、错误、停止、Escape、亮暗与窄窗视觉检查，并保存当前界面截图。上述 E2E 与 controller 测试均不能替代该人工路径。

## 平台矩阵

| 平台 | 自动化 | 人工 UI | 结论 |
| --- | --- | --- | --- |
| macOS arm64 开发态 | 定向自动化 + 隔离 Electron 写入 E2E 通过 | Computer Use 未执行（macOS 锁屏） | 待 AUT-006 人类验收 |
| macOS packaged | 未执行 | 未执行 | 不适用（开发态预览） |
| Windows x64 | 未执行 | 未执行 | 未验证 |
