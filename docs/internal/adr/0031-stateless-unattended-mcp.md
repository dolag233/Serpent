# ADR-0031：MCP 使用业务无状态请求、默认 Auto 权限与 Agent 危险确认

- 状态：已接受（2026-08-10）
- 关联：ADR-0025、ADR-0029
- 替代：ADR-0030；ADR-0029 中的 session 业务上下文、资源库授权与动态工具目录

## 背景

现有 MCP 将当前资源库、按库授权、会话 capability grant 和工具可见性绑定到 transport session。标准客户端的重连、刷新工具和并发连接因此造成业务上下文丢失、重复切库、重复授权和工具消失。常规导入依赖原生选择器，又使 Agent 无法无人值守完成任务。开启“跳过权限”仍会被资源库授权、计划确认和 critical 窗口阻塞，产品承诺与实际行为不一致。

## 决策

1. Serpent MCP 是业务无状态接口。transport session 只用于请求关联、通知、进度和取消，不保存 active library、library authorization、capability grant、默认目标或动态工具目录。
2. 所有库级命令显式携带 `libraryId`；每个响应回显实际 `libraryId` 和资源库变更序号。Desktop 当前显示的资源库不作为 MCP 默认值。
3. 核心 `tools/list` 对已认证客户端保持静态。前置条件通过稳定错误表达，不能靠隐藏工具表达。
4. 权限绑定客户端 credential 并跨连接、重连和应用重启持久。新 credential 默认 `auto`；另提供需要红色危险提示才能开启的 `full-access`。不保留 `ask`、单次人类批准或 session grant。
5. `routine` 和 `recoverable` 操作在 Auto 下直接执行。`dangerous` 操作第一次调用绝不修改状态，只返回危险原因、精确影响、可恢复性、前置版本和短时 challenge；Agent 以绑定相同计划的第二次调用确认后才执行。
6. 危险 challenge 绑定 credential、命令、完整参数、目标、资源库和前置版本，短时有效且只能消费一次。人类无需介入；若一项能力不能接受 Agent 二阶段自主执行，则在设置中禁用或不向 MCP 暴露。
7. 非交互式安全还包括显式目标、Schema、路径边界、实体版本、`changeSequence`、幂等键、可恢复删除、资源预算、持久 Job、审计和即时撤销。
8. 文件导入、资源库创建等 Agent 命令接受显式绝对路径，由 Main/Worker 做跨平台规范化与边界检查。MCP 不打开系统文件选择器。
9. Desktop 是非阻塞投影。显式 show 命令可以切换可见资源库，但不改变其他 MCP 调用语义；Host 自动显示必要 info/progress，不把通知当作批准。
10. 长任务返回持久 Job ID；断线重连后可继续查询。幂等和 Job 状态不依赖 transport session。
11. 首次配置必须是 Serpent 内开启服务、按目标客户端复制一个完整配置、粘贴一次；不要求理解或手工编辑端口、Bearer、JSON，不要求终端、Node.js 或 npm。稳定 credential 跨重启有效。
12. 产品未发布，不保留旧 session 语义、工具名或配置兼容层。

## 后果

- 客户端重连、刷新工具和多连接不会再触发切库或权限交互；调用可以独立重试和并发调度。
- 默认 Auto 客户端能在用户参与为零时完成完整工作流；真正危险的操作仍有可测试的 Agent 二阶段防误触边界。
- 每个库级工具输入都更明确，调用负担略有增加，但彻底消除了隐式目标和 Desktop 焦点竞态。
- 现有 Permission Broker、session grant、library authorization、动态工具目录和 MCP critical modal 路径需要删除或重构；不能在旧模型上叠加更多例外。
- 显式本机路径扩大了可信客户端可请求的文件范围，因此路径校验、审计、credential 撤销和 Windows reparse point/UNC 测试成为发布门禁。
- Windows 必须独立验证路径、原子策略存储、端口生命周期、多连接、Job 恢复和 packaged 行为；macOS 结果不能替代。

## 被拒绝的替代方案

- **只合并或减少弹窗**：仍保留 session 状态，重连后问题必然复发。
- **继续提供“本 session 总是通过”**：session 是不可靠的 transport 生命周期，不应成为产品权限边界。
- **critical 逐次弹人类确认**：打断无人值守工作；改由精确、一次性的 Agent 二阶段 challenge 防止误调用。
- **只在参数中加入 `confirm: true`**：Agent 可在第一次误调用中顺手带上，不能形成独立风险判断时点。
- **用 Desktop 当前库作为默认目标**：多客户端和用户手动切换时存在竞态，可能写错资源库。
- **常规文件操作继续使用原生选择器**：要求人类接管，不能服务 Agent 工作流。
- **完全无认证的 loopback 服务**：本机其他进程可直接控制 Serpent；稳定 credential 不妨碍一次配置后的可用性。

## 详细规格

见[业务无状态、可无人值守的 MCP 设计](../superpowers/specs/2026-08-10-stateless-unattended-mcp-design.md)。
