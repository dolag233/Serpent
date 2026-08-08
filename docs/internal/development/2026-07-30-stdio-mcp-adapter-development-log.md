# 2026-07-30 stdio MCP Adapter 首切片开发日志

> 工单：`Serpent-y51c.5`
> 规格：`docs/internal/implementation/0023-automation-scripting-mcp-framework.md` Phase C
> 产品对齐：Console 与 MCP 同一 Action 面；未配置写授权时只暴露公开只读工具

## 本切片交付

1. Registry → MCP tools/list 目录：`src/mcp/tool-catalog.ts`
2. tools/call → Gateway 映射：`src/mcp/call-tool.ts`
3. MCP Server（stdio 可连接）：`src/mcp/create-serpent-mcp-server.ts`
4. Main 会话宿主：`src/main/automation-mcp-host.ts` + `src/main/automation-mcp-bootstrap.ts`
5. Electron 无窗口入口：`SERPENT_MCP=1` 时跳过主窗口，打开 `SERPENT_MCP_LIBRARY_PATH` 并挂 stdio
6. 启动器：`npm run mcp -- --library /abs/path/to.serpentlibrary`
7. 依赖：`@modelcontextprotocol/sdk@1.30.0`
8. 单测：`tests/unit/serpent-mcp-adapter.test.ts`、`tests/unit/automation-mcp-bootstrap.test.ts`

## 刻意未完成（同一工单后续）

- 至少两个 MCP Host 真实冒烟（Cursor / Claude Desktop 等）与 stdout 纯净证据
- 写工具本机批准 UI（TTY/对话框）端到端路径
- packaged `serpent-mcp` 分发与 Windows 证据
- headless 无库 `library.create`（journal 仍要求 libraryId）

## 优先级

产品确认脚本化先于插件加宽；插件 `Serpent-upsn.3/.4` 已记录暂停加宽说明。
