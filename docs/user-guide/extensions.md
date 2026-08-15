# 插件、脚本与 MCP

Serpent 有三种扩展方式。本章介绍使用和管理；编写扩展请看[扩展作者手册](../manual/README.md)。

## 插件

插件可以贡献菜单、工具栏、设置页、快捷键、Inspector/查看器入口、自定义视图、任务和 Provider。插件管理入口在「设置」→「插件」；资源库关闭时仍可管理全局插件，但不能安装或管理资源库插件。

### 安装

1. 打开「设置」→「插件」，点击安装。
2. 选择安装范围：
   - **全局插件**：安装到当前用户配置，所有资源库可用，不随资源库同步。
   - **资源库插件**：安装到当前资源库的 `.serpent/plugins`，可随资源库同步；每台设备仍需单独信任。
3. 选择本地插件文件夹或 ZIP，或输入 GitHub 的 `owner/repository`、完整仓库地址或 Release 地址。
4. 安装完成后插件管理器会刷新包列表。安装只放置并校验文件，不会执行包内安装脚本。

GitHub 安装优先使用 Release 平台 ZIP，找不到时才兼容下载仓库 ZIP。插件包必须包含 `serpent-plugin.json` 和已构建的 JavaScript 入口；Serpent 不会替插件运行 `npm install` 或构建命令。

### 启用、信任和停用

在插件卡片打开「启用」开关。全局包默认信任；资源库包在这台设备第一次启用时会出现信任确认，可以拒绝。插件同时存在全局和资源库版本时，选择实际使用的版本，或选择禁用。

插件有两种运行模式：

- **restricted（受限）**：QuickJS 隔离环境，没有 Node、文件系统、网络、Shell、SQLite 或宿主 DOM，只能调用声明权限的 Serpent API。
- **unrestricted（非受限）**：独立 Node UtilityProcess，拥有 Node.js、文件系统、网络和子进程能力。Manifest 中的权限仍控制 Serpent Gateway 能力，但不是安全沙箱；只应信任你完全接受其本地代码风险的插件。

Safe Mode 只暂停 unrestricted 插件，restricted 插件仍可运行。权限、运行模式或来源发生变化时，重新启用会再次要求确认。

### 更新、重载和卸载

- GitHub 插件的自动更新默认关闭；在插件设置中打开时会要求确认，并只更新 GitHub 来源。
- 点击重载可在不重启 Serpent 的情况下重新加载已安装版本。
- 点击卸载会移除包和锁定记录，但**不会自动删除插件数据**。全局数据位于用户数据目录的 `plugin-files/<pluginId>` 与 `plugin-storage/<pluginId>/user.json`；资源库数据位于 `.serpent/plugin-files/<pluginId>` 与 `.serpent/plugin-data/<pluginId>.json`。若要彻底清理，请先备份后手动删除对应数据目录。

本地 ZIP 有限制：压缩包不超过 256 MiB，最多 10,000 个文件，单文件不超过 64 MiB，解压后不超过 512 MiB。ZIP 条目必须是相对 POSIX 路径，不能包含绝对路径、路径穿越或符号链接。

![插件管理和安装入口](../assets/ui/extension.png)

## 自动化脚本

脚本适合一次性批处理或可保存的整理操作，例如批量加标签、评分或移动文件。打开资源库后，从「更多工具」→「自动化脚本」进入 Desktop Console；创建或打开 `.serpent.js` / `.serpent.ts`，然后运行。

脚本运行在 QuickJS 一次性沙箱中：注入 `serpent` 和 `console`，不提供 Node、`require`、任意文件系统、网络、Shell、SQLite、环境变量、`eval`、`Function` 或宿主 DOM；仅可通过受控的 `serpent.ui.notify` 显示非阻塞通知。所有领域操作都经过 Gateway 权限和资源库上下文校验。每次运行有 60 秒墙钟、10 秒 CPU、64 MiB 内存、1 MiB 输出、最多 4 个并发 Gateway 调用和 128 个未决 Promise 的预算；没有 `serpent run` 或 `repl` CLI。

## MCP

MCP（Model Context Protocol）是给外部 Agent 或 MCP Host 使用的本机连接。它不是远程服务，也不需要 Node、npm 或 `npm run mcp`。

### 第一次连接

1. 打开「设置」→「MCP」，打开「启用 MCP 服务」。
2. 如需随 Serpent 启动，打开「自动启动」；否则点击「启动」。默认端口为 `47342`，也可以在停止服务后改为 `1024–65535`。
3. 选择配置格式（通用 JSON、Claude、Cursor、Codex，或“地址 + Token”），点击「添加客户端」。Serpent 会创建一次性显示的 credential，并把 endpoint 和 Bearer Token 复制到剪贴板。
4. 将配置粘贴到目标客户端并连接。服务地址只监听 `127.0.0.1:<端口>/mcp`。

![MCP 设置和客户端配置](../assets/ui/MCP-settings.png)

### 权限和安全

每个客户端 credential 默认是 **Auto（自动）**：普通和可恢复操作直接执行，危险操作需要 Agent 用一次性 challenge 再确认。**Full Access（完全权限）** 允许受信任客户端直接执行更多普通操作，但仍不能绕过危险操作的二次确认；只有 Full Access 客户端可见插件暴露的 MCP 命令。插件的 MCP 暴露默认关闭，需要在插件设置中逐项打开。

库级工具调用必须显式提供 `libraryId`，不能依赖 Serpent 当前聚焦的资源库。插件工具还必须提供目标资产、文件夹或合集 ID。MCP 不提供任意 Shell、SQL、文件系统或公网网络访问。

不再使用的客户端应在设置中撤销 credential；撤销后旧 Token 立即失效。服务的请求体、连接数、初始化和空闲时间都有上限，详细协议见[MCP 开发指南](../manual/mcp/development.md)。

## 如何选择

- 需要菜单、设置页、工具栏、查看器入口或自定义 UI：**插件**
- 需要可保存的一次性批处理：**自动化脚本**
- 需要让外部 Agent/MCP Host 调用 Serpent：**MCP**

完整开发文档和 API 参考见[扩展作者手册](../manual/README.md)。
