# Embedded HTTP MCP Server — Luna Review

日期：2026-08-10  
审查模型：`gpt-5.6-luna`  
审查基线：实现工作树相对 `HEAD=870f549...` 的全部 MCP 变更  
范围：Standards + Spec，重点检查 Windows 行为

## 初始发现

Luna 完成独立审查时确认初始定向 typecheck、lint 和 82 个 MCP 相关测试通过；由于当前环境是 macOS，Windows 实机未执行。发现如下问题：

### Standards

1. P1：Main → Renderer 的 MCP settings response/event 发送前没有经 Zod 校验。
2. P1：MCP settings、credential 和 Execution Journal 在 Windows 上采用“删除目标后 rename”，崩溃时可能留下空缺。
3. P1：缺少 settings 页、完整 Electron 生命周期、packaged 和 Windows 的自动化证据。
4. P2：`EmbeddedMcpServer` 与 `main/index.ts` 仍承担较多生命周期、授权、IPC 和通知编排职责。

### Spec

1. P1：`tools/call` 未接收 MCP `extra.signal`，也没有 progress notification。
2. P1：`serpent_library_create` 的 MCP 输入暴露了任意 `selectedParentPath`。
3. P1：HTTP 401/404 只有文本，没有规范化的认证、撤销、session-not-found/session-closed 错误码。
4. P1：插件工具变化没有稳定触发 `tools/list_changed`。
5. P2：部分用户文档仍推荐 stdio/headless/npm/attached 入口。

## 修复结果

- IPC handler 对所有 MCP settings response 使用 `mcpSettingsResponseSchema.parse`，Main → Renderer event 使用 `mcpSettingsSnapshotSchema.parse`；Preload 继续执行接收侧校验。
- 新增 [atomic-json-file.ts](../../../src/main/atomic-json-file.ts)：POSIX 使用原子替换；Windows 替换时先将旧目标移到稳定 `.bak`，失败恢复旧文件，启动读取时恢复崩溃中断状态。settings、credential、Execution Journal 三个 Store 均已迁移。
- `tools/call` 接收 SDK `extra.signal`，Gateway 合并 session cancellation 与本次请求 cancellation；Worker 适配器继续将取消传递到 Worker 等待路径。客户端提供 progress token 时，Serpent 发送开始/完成 progress notification。
- MCP `library.create` 和 `file.import` 的工具 schema 不再包含 `selectedParentPath`/`sourcePaths`。Main 仅在 `source === 'mcp'` 时打开 Desktop 原生选择器并把结果补入内部 Gateway 输入；脚本 API 的路径参数不因此改变。
- HTTP 层现在返回 `MCP_CLIENT_UNAUTHORIZED`、`MCP_CLIENT_REVOKED`、`MCP_SESSION_NOT_FOUND`、`MCP_SESSION_CLOSED` 等稳定 code，并对 session closed 保留有限历史以返回 410。
- 插件激活注册和插件管理变更均通知内嵌 Server，活动 session 发送标准 `notifications/tools/list_changed`。
- 当前用户手册、扩展指南、架构文档和 MCP API 错误说明已切换到 Desktop 内嵌 loopback HTTP；旧 stdio/headless/attached 设计文档保留为明确标注的历史记录。

## 验证与未决项

当次验证：

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run test:unit`：301 个文件，2275 passed、1 skipped。
- `npx vitest run tests/unit/atomic-json-file.test.ts tests/unit/embedded-mcp-server.test.ts tests/unit/serpent-mcp-adapter.test.ts`：16 passed；覆盖 HTTP SDK、Host/Origin、认证先于 body、撤销错误码、progress token、MCP schema 路径隐藏和 Windows 崩溃恢复模型。
- `git diff --check`：通过。

仍未执行：真实 Computer Use 设置页验收、当前 HEAD packaged 应用、Windows runner/实机，以及完整跨进程 Electron 生命周期。P2 的模块职责拆分未作为本轮风险性重构插入；后续若继续演进，可将 HTTP listener/session/credential 与 Main IPC 编排拆成独立模块。
