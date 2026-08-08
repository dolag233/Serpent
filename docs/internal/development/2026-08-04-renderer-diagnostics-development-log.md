# 2026-08-04：Renderer 崩溃与卡死诊断日志（Serpent-lyf8）

## 根因与范围

此前主进程只在开发态记录 `console-message` 与 `render-process-gone`，没有覆盖
Renderer 卡死/恢复，也没有覆盖 Electron child process（例如 GPU/Utility）异常退出；
因此黑屏或卡死时，`serpent.log` 可能只有加载失败信息，缺少真正的进程状态。

## 实现

- `src/main/renderer-diagnostics.ts` 统一记录 Renderer 控制台 warning/error、
  `render-process-gone`、`unresponsive`、`responsive` 和 App 级
  `child-process-gone`。
- Renderer 诊断监听在开发态和 packaged 应用都安装；普通 verbose/info 控制台输出不写日志，
  warning 写 info，error 和进程异常写 error，空闲窗口不会产生周期性噪音。
- 记录 window ID、退出 reason/exitCode、child process type/serviceName 以及 console
  source/line，沿用 `AppLogger` 的路径和敏感信息脱敏。

## 验证

- `npx vitest run --config vitest.config.ts tests/unit/renderer-diagnostics.test.ts`：2 tests passed。
- `npx eslint src/main/renderer-diagnostics.ts src/main/index.ts tests/unit/renderer-diagnostics.test.ts`：通过。
- `npm run typecheck`：通过。
- `git diff --check`：通过。

真实 Renderer 崩溃、GPU 进程退出、Windows packaged 和 Computer Use 尚未在本环境执行；
这些仍需在对应平台/构建中补充证据，不能以单元测试代替。
