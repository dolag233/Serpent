# Embedded HTTP MCP Server 开发日志

日期：2026-08-10  
工单：`Serpent-a0yk`  
设计：[顶层设计](../superpowers/specs/2026-08-10-embedded-http-mcp-server-design.md) / [ADR-0029](../adr/0029-embedded-loopback-http-mcp-server.md)

## 本次实现

- Desktop Main 内嵌 loopback Streamable HTTP MCP 服务，只绑定 `127.0.0.1`，默认关闭。
- 设置页支持启用/禁用、手动启动/停止、自动启动、端口、复制客户端配置和逐项撤销 credential。
- bearer credential 只保存带应用 pepper 的 SHA-256 哈希；HTTP 请求先完成 Host/Origin/认证校验，再读取 body。
- MCP session 与 Automation Execution、活动资源库、context revision、能力授权和动态工具列表绑定；资源库切换通过 Main 的本机选择器/确认和 Gateway。
- 删除旧 stdio、headless、attached proxy、私有 socket、启动脚本及其旧测试；Registry/Gateway/Journal 作为唯一命令与权限边界保留。
- 2026-08-13 收口历史遗留 E2E：`tests/e2e/automation-mcp-launcher.test.ts` 不再启动废弃 `run-mcp`，改为隔离 Desktop profile 的内嵌 HTTP 配置、真实 SDK initialize/tools/list/tools/call、断开重连测试。
- 为 Windows 补充设置、凭据、Execution Journal 的受控 JSON 文件替换路径，并在服务 listener/runtime 错误时清理 session。
- 根据独立 Luna 审查补齐 IPC Zod 边界、崩溃恢复写入、MCP cancellation/progress、MCP 原生路径选择、稳定 HTTP 错误码、插件 `tools/list_changed` 通知，并清理当前用户文档中的旧入口说明。

## 自动化证据

当次执行：

- `npx vitest run tests/unit/embedded-mcp-server.test.ts tests/unit/serpent-mcp-adapter.test.ts tests/unit/serpent-mcp-dual-client-smoke.test.ts tests/unit/plugin-mcp.test.ts tests/unit/automation-command-gateway.test.ts tests/unit/automation-execution-journal.test.ts` — 6 个文件、82 个测试通过。
- `npx vitest run tests/unit/app-settings-sections.test.ts tests/unit/media-binaries.test.ts` — 2 个文件、16 个测试通过。
- `npx vitest run tests/unit/atomic-json-file.test.ts tests/unit/embedded-mcp-server.test.ts tests/unit/serpent-mcp-adapter.test.ts` — 3 个文件、16 个测试通过。
- 末次回归同一组定向测试：3 个文件、17 个测试通过。
- `npm run test:unit` — 301 个文件、2275 passed、1 skipped。
- `npm run lint` — 通过。
- `npm run typecheck` — 通过。
- `git diff --check` — 通过。

追加主线门禁：

- `npm run verify:mainline` 的 lint、typecheck、extension verify、全量 Electron 单测（360 个文件、3254 passed、9 skipped）和搜索性能测试（5/5）通过。
- 同一门禁的核心 E2E 未全绿：共 13 个失败，集中在 asset pagination、browsing preferences、context menu、recent-library focus、video preview、organization/trash，以及 plugin management/host activation；这些失败没有进入本 MCP 重构的修复范围，需另行回归定位。因此不能把 `verify:mainline` 记为全绿。
- 为满足全量 Electron 单测的当前契约，同步修正 `tests/worker/model-pipeline.test.ts` 对已有 `width`/`height` ready 结果的断言；不是 MCP 行为变更。

真实 Electron/当前 packaged 旅程及 Windows 实机/runner 尚未执行；这些不以 macOS 单元测试替代。

## 代码审查

独立 `gpt-5.6-luna` 审查及修复记录见 [Luna review](../reviews/2026-08-10-embedded-http-mcp-server-luna-review.md)。审查确认 Windows 实机未执行；当前代码级验证覆盖了崩溃恢复模型，但不能替代 Windows packaged 旅程。

## 外部使用反馈与本轮修复

2026-08-10 外部 MCP 使用中，资源库整理尚未完成：Mac 在原生选择器/确认阶段进入锁屏，Computer Use 无法继续，因此没有把“700 张素材已导入、文件夹和合集已整理”记为验收通过。已将可复现的软件问题拆为以下工单，并先行修复代码：

- `Serpent-o0mh`：导入计划在用户确认后仍返回不可继续的 `conflicts`，Worker 现在对已确认的 automation plan 使用安全默认策略（内容重复跳过、同名保留副本），直接返回实际 completion。
- `Serpent-oif9`：initialize/审批中断后会话残留；HTTP 层现在绑定请求断开、初始化超时、关闭和空闲清理，避免活动会话长期占用，新连接可重新建立。
- `Serpent-wft4`：原生选择器前缺少上下文；Desktop 现在先显示不含绝对路径的 info 提示，确认窗口包含 MCP 客户端、动作、资源库和数量信息；只读 session 可使用受限的 `serpent_ui_notify`。
- `Serpent-d7s6`：历史上的设备级“跳过高风险操作确认”方案已由 `Serpent-9rbn` 取代并关闭；当前实现改为按 credential、按普通 capability 的 `ask`/`always-allow` 策略。关键危险操作不提供跳过、会话记忆或持久绕过，始终进入 Main-owned 独立确认窗口。
- `Serpent-8eu9`：Main 原本发送了 `library.opened`，但 Renderer 只在无当前库的脚本预览场景监听；现在自动化事件带 `source: "mcp"`，已有窗口会切换并重新加载目标库，普通 Renderer 请求仍沿用响应路径避免重复加载。

本轮自动化证据：`npm run typecheck`、`npm run lint`、`git diff --check` 均通过；导入/MCP/协议/UI 同步定向回归为 8 个文件、196 个测试通过。真实外部 MCP 重新导入、Computer Use、packaged 和 Windows 实机仍未执行；本次 Computer Use 尝试因 macOS 锁屏无法继续，Windows 不能用本机单测结果替代。

### 2026-08-10 权限模型收口

在上述外部反馈修复基础上，`Serpent-9rbn` 已将权限模型收口为：普通 MCP capability 首次调用按具体权限提示，支持“通过”和“本会话总是通过”；设置页按 credential 保存“每次询问/总是允许”，并提供仅覆盖当前普通 capability 的“开启全部权限”。资源库、文件夹、资产永久删除及清空回收站等 critical 操作不进入该策略矩阵，改由 Main-owned 独立窗口逐次确认，红色确认按钮、取消默认焦点，关闭/Escape 均取消。

当前验证证据：`npm run test:unit` 为 305 个文件、2297 passed、1 skipped；`npm run typecheck -- --pretty false`、`npm run lint` 均通过；关键确认 E2E `node scripts/run-e2e.mjs tests/e2e/critical-confirmation.test.ts` 为 1 passed；链接资产 critical 路径定向 E2E 为 3 passed；critical 回收站焦点/红色确认 E2E 为 1 passed。`npm run verify:mainline` 的 lint、typecheck、extension verify、Electron 单测（364 个文件、3277 passed、9 skipped）和搜索性能（5 passed）通过；E2E 当次为 60 passed、14 failed，失败集中在既有浏览/插件/资产数据竞态，另有旧删除断言已在定向测试中同步后通过。

当前验证边界：真实桌面视觉验收仍因 Computer Use 遇到 macOS 锁屏未执行；当前 HEAD packaged 专项旅程和 Windows 旅程仍待执行。以上 macOS 自动化结果不构成 Windows 通过结论。
