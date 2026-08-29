# 2026-08-01：插件 MCP 选择性暴露（PLUGIN-031）

## 范围

工单：`Serpent-upsn.9`（不关闭，主题、开发模板、打包和最终 QA 仍未完成）  
规格：`docs/internal/implementation/0024-script-plugin-platform.md` Phase F  
基线：`541d1b063839967b08101f75df3d7c96c4974f7a`  
状态：实现中

本增量只处理插件命令的 MCP 选择性暴露：

- Manifest 命令级 MCP 声明，并兼容已有顶层声明形式。
- 本机用户显式开关，默认关闭，状态不进入资源库同步数据。
- MCP `tools/list` 动态列举已激活、已声明且已启用的插件命令。
- MCP `tools/call` 通过现有 Plugin Activation Coordinator `runCommand` 路径执行，使用 MCP 执行绑定的资源库。
- 参数只允许有界的稳定资产/文件夹/合集 ID，不提供 `eval`、Node、文件路径或秘密字段。

## 关键实现决定

MCP 暴露开关使用 Main-owned `PluginMcpExposureStore` 的本机 JSON 文件保存，不复用插件可写 Storage，也不写入资源库。这样插件不能自行提权，资源库同步也不会把某台设备的 Agent 授权带到另一台设备。

Manifest 继续支持已有的 `mcp.expose: string[]`，同时支持命令项上的 `mcp: { export: true }`。两种形式只产生声明资格；只有用户设置页写入启用状态后，命令才进入 MCP 工具目录。

## 自动化验证

已执行的定向命令：

- `npx vitest run tests/unit/plugin-mcp.test.ts tests/unit/plugin-contract.test.ts tests/unit/plugin-package-ipc.test.ts`：3 files / 32 tests passed。
- `npx tsc --noEmit`：exit 0。

- `npx vitest run tests/unit/serpent-mcp-adapter.test.ts tests/unit/plugin-contributions.test.ts`：2 files / 20 tests passed。

本切片不执行完整测试、Electron E2E、packaged、Windows 或 Computer Use QA。

## 已知剩余

- 真实 Electron 设置页与 MCP stdio Host 旅程尚未执行。
- packaged、Windows、主题 token/可信 CSS、插件开发模板、安装升级卸载和最终主线 QA 仍属于 `Serpent-upsn.9`，本增量不关闭该工单。
