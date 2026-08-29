# CI macOS E2E 全挂（renderer 空白）排查交接

> 2026-08-09。本文件是给接手 agent 的交接文档，所有结论均附证据来源。

## 1. 失败现象

- Run: https://github.com/dolag233/Serpent/actions/runs/31265633667/job/93123177407（main @ dc980069，2026-08-08T15:54Z）
- Job: macOS arm64 verification（macos-15-arm64 runner，macOS 15.7.7）
- 结果：**69 failed / 2 passed / 4 skipped**（35.2m），全部失败统一签名：

```
TimeoutError: locator.click: Timeout 30000ms exceeded.
  - waiting for getByRole('button', { name: '创建资源库' })
```

即：应用窗口存在（`firstWindow()` 正常返回），但 **renderer 从未渲染出开始页**。trace（artifact `e2e-test-results-macOS arm64`）里无任何 page 事件——无网络请求、无 console、无 DOM 快照，页面完全 inert。

2 个"通过"的测试均为**不依赖 renderer UI** 的（process-lifecycle 用 `application.evaluate` 走 main 进程 + second-instance spawn）。

## 2. 已排除的假设（附证据）

| 假设 | 结论 | 证据 |
|---|---|---|
| 代码回归（本次改动） | 排除 | run 的 commit 是 ci.yml 重写，应用代码未动；失败签名从 bf31978（首个通过 typecheck 的 baseline 后续 commit）起一致 |
| 构建产物缺失/损坏 | 排除 | CI 日志显示 main/preload/worker/renderer 全部正常构建（`.vite/renderer/main_window/index.html` 存在） |
| `CI=true` 环境变量 | 排除 | 本地 `CI=true node scripts/run-e2e.mjs tests/e2e/asset-pagination.test.ts`：renderer 正常挂载，测试推进到第 478 行才因另一个 bug 失败（见 §5） |
| GPU/硬件加速 | 排除 | 646cf60 已加 `app.disableHardwareAcceleration()`（SERPENT_E2E=1 时），最新 run 仍失败 |
| 字体/CSP（data: 字体被 `font-src 'self'` 拦截） | 排除 | 是真实存在的小问题（renderer console 报 font 加载错误），但不阻止 React 挂载；本地 E2E 同样有该错误仍通过 |
| locale 注入 | 排除 | preload 默认注入 zh-CN（`SERPENT_E2E_LOCALE !== 'en'` → zh-CN），无 CI 分支 |
| 应用代码按 `CI` 分支 | 排除 | 构建产物 grep `env.CI`：main.js / library_worker.js / renderer bundle 均为 0 引用 |

**本地复现结果**（macOS 26 arm64，同架构同构建方式）：
- 同一 file:// 构建 + 同一测试文件：**12.5s 通过**（一次）
- `CI=true` 同样通过 renderer 挂载（诊断脚本确认 `#root .app-shell` 存在）
- 结论：**应用代码本身在本地完全正常，失败是 runner 环境特异性的**（剩余差异：macOS 15.7.7 vs 26；runner 虚拟化环境）

## 3. 关键疑点与下一步（决定性证据）

renderer 为何在 macOS 15 runner 上不执行 JS，本地无法复现，必须从 CI 侧取证：

**应用日志被测试的 finally 清掉了**（`<tmp>/user-data/logs/serpent.log`，`app.setAppLogsPath` 指到 temp userData），未上传。该日志含 renderer console-message、`render-process-gone`（crash/被杀）、`main.window.*` 启动事件——能直接区分"renderer crash"、"页面从未加载"、"主进程启动异常"。

建议动作（需 push 到 main 或开 PR 触发 workflow）：
1. 在 ci.yml 的 `Electron user flows` 步骤后加失败诊断步骤，dump 应用日志：
   ```yaml
   - name: Dump E2E app logs
     if: ${{ failure() }}
     run: |
       find /var/folders -name serpent.log -path "*serpent*" \
         -exec echo "===== {} =====" \; -exec tail -80 {} \; 2>/dev/null | head -300 || true
   ```
   注意：测试 finally 会删 tmp 目录，若 find 拿不到，需在测试侧改造——例如 `tests/e2e/electron-test-helpers.ts` 或各测试的 launch env 里加 `SERPENT_E2E_LOG_COPY_DIR`，让应用把日志额外拷到 `test-results/`（应用在 `src/main/index.ts:4208-4214` 决定日志路径，改这里最直接：E2E 模式额外复制一份到 `process.cwd()/test-results/app-log-<pid>.log`）。
2. 重跑，读日志区分失败模式。

次要待查（拿到日志后）：Electron 43.1.0 × macOS 15.7.7 runner 的已知渲染问题；`show:false` + `ready-to-show` 是否在 runner 上不触发（但 DOM 与可见性无关，仅兜底考虑）。

## 4. 相关事实速查

- CI 流程：`npm ci` → electron-rebuild（better-sqlite3）→ lint/typecheck → `npm test` → perf gate → `npm run test:e2e`（`scripts/run-e2e.mjs`，vite build 出 production-like file:// 应用 → playwright 26 个测试文件，serial）
- E2E 启动：`electron .`（repo 根），`SERPENT_E2E=1` + temp `SERPENT_E2E_USER_DATA_PATH`，preload 注入 `__SERPENT_E2E_LOCALE__=zh-CN`
- 窗口加载：`MAIN_WINDOW_VITE_DEV_SERVER_URL` 被 define 为 `undefined` → `window.loadFile(.vite/renderer/main_window/index.html)`（`src/main/index.ts:968-996`）
- 诊断工具（本地已验）：launch 后 `app.windows()` + `page.evaluate` 读 `#root .app-shell`；Playwright trace 对 electron 页面**不产生** frame-snapshot/console（本环境实测），依赖 trace 取证会走弯路
- 日志位置：`src/main/index.ts:4206-4214`（`setAppLogsPath` → `<userData>/logs/serpent.log`）

## 5. 顺带发现（已开单，勿混入 CI 排查）

`Serpent-i1qt`（P2）：侧边栏 回收站 行 accname = "回收站1"（count 无空格拼接，无 aria-hidden），`asset-pagination.test.ts:478` 的 `exact: true` 匹配失败——本地 5/5 复现（首次通过为竞态）。这是本地 flaky，与 CI 空白 renderer 是**两个独立问题**。修复方向：NavRow count span 加 `aria-hidden` 和/或测试改正则。
