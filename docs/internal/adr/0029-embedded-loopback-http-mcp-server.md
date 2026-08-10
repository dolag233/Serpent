# ADR-0029：MCP 只由 Desktop 内嵌 loopback HTTP 服务提供

- 状态：已接受（2026-08-10）
- 替代：ADR-0025 中 MCP 使用 stdio、MCP Host 生命周期启动 headless Worker、以及不提供应用内 listener 的 transport 决策

> ADR-0031 已替代本文中的 session 业务上下文、资源库授权、动态工具目录和运行时人类批准；本文继续决定唯一 transport、loopback 边界和 Desktop 内嵌生命周期。

Serpent 的目标用户不应安装 Node.js、npm、源码或专用代理才能使用 MCP。MCP 的唯一产品入口因此改为由正式 Desktop Main 内嵌并在设置中管理的标准 Streamable HTTP Server，只绑定 `127.0.0.1`，通过稳定客户端 credential 识别调用者。服务默认关闭，可手动启停或选择随 Serpent 自动启动；应用退出即停止，不安装系统 daemon。

MCP 业务语义与权限由 ADR-0031 管理：每个请求显式指定目标，默认 Auto，普通和可恢复操作直接执行；真正危险的操作由 MCP 先返回风险报告，再由 Agent 使用绑定计划的 challenge 二次确认。运行中不弹人类权限窗、不打开文件选择器。任何执行仍不能绕过显式目标、Schema、路径边界、实体版本、`changeSequence`、幂等、恢复或 Worker 状态校验。`serpent_ui_notify` 只承担非阻塞可观察性。

不采用裸 TCP，因为它不是 MCP 标准 transport，会迫使每个客户端安装 Serpent 专用桥接层；不保留 stdio、headless、attached、Unix socket、Windows named pipe、启动脚本或旧配置兼容，因为产品尚无稳定 MCP 发布包袱。局域网和公网访问不属于本地 listener 的渐进开关；若未来需要远程控制，必须另行设计 HTTPS、OAuth 与远程身份边界。
