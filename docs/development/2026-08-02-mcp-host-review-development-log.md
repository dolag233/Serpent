# MCP Host 轨道审查与权限/绑定收口

## 状态

- 分支：`codex/plugin-runtime-management`
- 基线：`5bac1b49f7b6aaa5c62ef96e6ba0186f206ebc46`
- 范围：MCP stdio、Desktop attached MCP、插件 MCP 工具桥、Automation Gateway 接缝
- 状态：开发态实现与定向验证完成；packaged/Windows 未执行

## 审查结论

本轮确认并修复了三类真实问题：

1. Desktop attached MCP 没有把 `PluginMcpToolProvider` 接入 `tools/list` 与 `tools/call`，附着模式看不到也不能调用已导出的插件命令。
2. 插件 MCP 命令此前不受本地 MCP 写入配置约束。现在插件命令只有在 `--write-access` 或附着确认授予写入权限时才出现在工具列表中，并按可能产生副作用的命令标注。
3. 附着 MCP 插件命令此前重新读取当前聚焦资源库，而不是使用附着会话绑定的资源库。现在 `libraryId` 沿插件工具的 list/call 路径显式传递，避免用户切换 Desktop 当前库后串库。
4. stdio transport 建立失败时此前会留下 Main-owned Execution；现在启动失败立即取消该 Execution。另保留连接关闭时的收口逻辑，避免能力和资源预算悬挂。

未采纳的方向：没有在本轮把 `PluginMcpExposureStore` 接到 Provider。当前插件 MCP 文档和已有验收口径仍是 manifest `mcp.export` 候选 + MCP 本地写入确认；Renderer 暴露设置目前没有实际调用方，直接启用该 Store 会造成插件工具永远不可用。该设置 UI/契约需要另开插件轨道后再统一设计。

## 关键入口

- `src/mcp/call-tool.ts`：MCP 工具调用、插件工具写入门槛与会话库传递
- `src/mcp/create-serpent-mcp-server.ts`：headless tools/list/call
- `src/main/desktop-attached-mcp.ts`：attached tools/list/call 与会话绑定
- `src/main/plugin-mcp-tool-provider.ts`：激活插件命令桥
- `src/main/automation-mcp-host.ts`：stdio Execution 生命周期
- `tests/unit/desktop-attached-mcp.test.ts`：附着插件工具与资源库绑定回归
- `tests/unit/serpent-mcp-adapter.test.ts`、`tests/unit/plugin-mcp.test.ts`：只读/写入暴露与插件调用回归

## 验证证据

- 定向 MCP 单测：6 files / 25 tests passed。
- Gateway/Execution Journal 回归：5 files / 73 tests passed。
- MCP E2E：`node scripts/run-e2e.mjs tests/e2e/automation-mcp-attached-desktop.test.ts tests/e2e/automation-mcp-dual-host.test.ts tests/e2e/automation-mcp-idempotency.test.ts tests/e2e/automation-mcp-library-changed.test.ts`，5 passed (38.0s)。
- ESLint：本轮涉及的 MCP/Main/测试文件无错误；Markdown 文件被 ESLint 配置忽略。
- `npm run typecheck`：未完全通过，唯一错误是工作树已有的插件 UI `src/main/index.ts:4999` Buffer/BodyInit 类型错误，非本轮 MCP 改动引入。
- `git diff --check`：通过。

## 已知边界

- packaged/Windows MCP Host 尚未执行。
- Desktop attached 的真实最小化、切换其他应用、Desktop 退出后的系统级旅程仍保留原有 QA 风险。
- 插件命令目前没有独立 impact metadata，因此统一按可能产生副作用处理；后续若要允许只读插件 MCP，需要新增命令影响级别并沿 Registry/Gateway 统一授权，不能只修改 MCP annotations。
