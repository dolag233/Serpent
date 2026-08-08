# 2026-08-01 插件 Input Capture Session

## 范围

`Serpent-upsn.7` 的 Input Capture Session 增量，提供应用内而非操作系统全局的
`serpent.input.capture`：

- `application` / `viewer` / `view` scope 与权限拒绝；
- application owner 互斥、Escape 紧急释放；
- keyboard、pointer、wheel、text 与 IME composition 事件模型；
- 高频事件合并、有限队列和生命周期释放；
- Standard/Trusted Host typed RPC 与 Guest/SDK async iterable；
- Renderer DOM fan-in（composition/text/pointer/wheel；viewer/view keyboard）；
- system modal 暂停接缝（dialogs outrank plugins，会话保持、关闭后恢复投递）；
- 固定探测插件 `tests/fixtures/plugins/input-capture-probe/`。

## 实现位置

- `src/shared/plugin-input-capture.ts`：无 Electron 依赖的 broker、权限、互斥、
  backpressure、system modal 暂停和生命周期状态机。
- `src/shared/plugin-input-capture-renderer.ts`：Renderer fan-in 序列化、目标解析、
  IPC payload 校验。
- `src/renderer/use-plugin-input-capture-fanin.ts`、
  `use-plugin-input-capture-modal-seam.ts`：DOM 监听与 Host 模态暂停通知。
- `src/shared/plugin-runtime-utility-protocol.ts`、
  `src/shared/plugin-trusted-runtime-protocol.ts`：Host RPC 消息。
- `src/main/plugin-runtime-supervisor.ts`、
  `src/main/plugin-trusted-runtime-supervisor.ts`：Main 到 Host 的 start/release/
  event/end/error 转发。
- `src/main/index.ts`：创建 Main broker，接入 `before-input-event` 应用级键盘、
  Renderer fan-in IPC、system modal 暂停、窗口 blur；Escape 保持由 broker 优先消费。
- `src/scripting/plugin-guest-realm.ts`、`plugin-standard-host.ts`、
  `plugin-trusted-host.ts`、`src/plugins/plugin-sdk.ts`：SDK 与 async event bridge。

## 设计选择

- **Application keyboard**：仍由 Main `before-input-event` 投递（与 VIEWER-018 共用
  钩子）；Renderer 仅 fan-in composition/text/pointer/wheel。
- **Viewer / view keyboard**：由 Renderer DOM fan-in 投递。
- **System modal**：选择**暂停**而非释放——`setSystemModalActive(true)` 忽略投递但
  保持 session；模态关闭后若 session 仍有效则自动恢复（0024：dialogs outrank plugins）。
  Renderer 通过 `dialog-escape-stack` 与 `aria-modal` DOM 探测通知 Main。

## 验证

- `npx tsc --noEmit`：通过。
- `npx vitest run tests/unit/plugin-input-capture.test.ts tests/unit/plugin-input-capture-renderer.test.ts`：
  2 个测试文件、8 个测试通过。
- 先前：`npx vitest run tests/unit/plugin-input-capture.test.ts tests/unit/plugin-standard-host.test.ts tests/unit/protocol.test.ts tests/unit/plugin-contributions.test.ts`：
  4 个测试文件、85 个测试通过。

完整测试、真实 Electron 输入/IME、packaged、Windows 和 Computer Use 尚未执行。

## 明确推迟

- `view` scope 在 sandboxed plugin iframe 内的 fan-in（主文档仅覆盖 application/viewer
  与 escape-stack 模态）；
- 当前分支的真实应用旅程与 Windows 证据。
