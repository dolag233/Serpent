# Serpent 用户手册：插件、脚本与 MCP

这组手册面向希望为 Serpent 编写插件、自动化脚本或 MCP 客户端的用户和开发者。它描述的是当前仓库已经提供的开发态接口；实现尚未发布为独立 SDK，示例应在 Serpent 仓库根目录、Node.js 24 环境中运行。

`docs/manual/` 是面向扩展作者发布的用户手册目录；架构决策、实施规格、开发日志和 QA 记录仍分别位于 `docs/internal/adr/`、`docs/internal/implementation/`、`docs/internal/development/` 和 `docs/internal/qa/`。

## 从哪里开始

| 目标 | 入门 | API 参考 |
| --- | --- | --- |
| 编写插件 | [插件开发指南](plugins/development.md) · [最佳实践](plugins/best-practices.md) | [插件 API 参考](plugins/api-reference.md) |
| 编写自动化脚本 | [脚本开发指南](scripts/development.md) | [脚本 API 参考](scripts/api-reference.md) |
| 接入 MCP | [MCP 开发指南](mcp/development.md) | [MCP API 参考](mcp/api-reference.md) |

脚本与 MCP 共用同一套 Gateway Action。脚本在 Desktop Console 中运行，MCP 通过 Desktop 内嵌的 loopback Streamable HTTP 服务连接；两者的命令名、参数、权限和执行状态应保持一致。脚本的 TypeScript 声明文件也可直接查看：[automation-api.d.ts](../internal/skills/serpent-automation/automation-api.d.ts)。

## 三种扩展方式如何选择

- 需要菜单、设置页、工具栏、查看器入口或插件自己的沙盒 UI：使用插件。
- 需要一次性批处理、可保存的用户脚本或复用现有 Action：使用自动化脚本。
- 需要让外部 Agent 或 MCP Host 调用 Serpent：使用 MCP。
- 需要执行真实业务操作时，优先寻找现有 Script/MCP Action；插件 UI 负责触发和展示，插件本身不应绕过 Host 直接访问数据库或资源库文件。

## 当前边界

- 脚本运行在 QuickJS 隔离进程中，不提供 Node.js 内置模块、任意文件系统、SQLite、任意网络或 Library Worker 句柄。
- 插件的受限运行模式同样只能使用 Host 暴露的 API；无限制插件可以自行管理外部进程和模型，但 Host 不提供通用 GPU、CPU、内存或 VRAM 调度接口。
- MCP 是 Desktop 内嵌的本机 loopback Streamable HTTP 服务，不是远程服务。服务默认关闭，用户可在设置中启停、设置自动启动、复制客户端配置和撤销 credential；写入能力受本机授权和高风险操作确认共同控制。
- MCP 不假设用户安装 Node.js、npm 或任何命令行启动器；客户端只需使用设置页复制的 endpoint 和 credential 连接正在运行的 Serpent Desktop。
- 当前发布文档覆盖开发态入口。打包后的 MCP 生命周期、Windows 和跨平台发布旅程仍需以当前 QA 证据为准，不能仅凭本地开发态测试宣称已验证。

## 共同的安全和可靠性约定

1. 不把绝对路径、秘密、数据库句柄或任意原始 IPC 对象放进插件贡献、脚本输出或 MCP 参数。
2. 读取类操作应使用分页和明确上限；批量写入应使用幂等键、执行计划和 `execution.status` 追踪结果。
3. 客户端超时不等于操作失败。对可能已经提交的操作，先查询执行状态，再决定是否重试。
4. 资源库切换、插件停用和 Worker 崩溃都可能使上下文失效；开发者应把 `libraryId`、资产 ID、revision 和执行 ID 当作需要重新校验的边界。
5. 文档中的 API 名称以当前实现和类型声明为准；如果规范文档、旧 Skill 或示例与 [脚本 API 参考](scripts/api-reference.md) 冲突，应优先采用 API 参考并记录问题。

## 相关规范

- [脚本自动化 Skill](../internal/skills/serpent-automation/SKILL.md)：面向 Agent 的操作约束和运行提示。
- [插件分发与更新](plugins/distribution-and-updates.md)：GitHub Release、ZIP、文件夹安装及更新策略。
- [插件平台最终设计](../internal/implementation/0024-script-plugin-platform.md)：Host/插件边界、贡献模型和生命周期的设计来源。
- [脚本/MCP 框架实施规格](../internal/implementation/0023-automation-scripting-mcp-framework.md)：自动化 Gateway、脚本运行时和 MCP 的实现背景。

## 文档状态

这些页面是随 Serpent 源码版本控制的发布文档，不代表已经完成所有平台验收。涉及打包、Windows、完整退出重启或真实桌面操作的声明，必须同时查看项目状态和 QA 文档中的当次证据。
