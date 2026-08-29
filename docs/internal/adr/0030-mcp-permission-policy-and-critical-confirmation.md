# ADR-0030：MCP 使用细粒度权限策略，关键危险操作不可绕过

- 状态：已废止（2026-08-10），由 ADR-0031 替代
- 关联：ADR-0025、ADR-0029

## 背景

> 本 ADR 的运行时人类 Prompt、session grant 和 critical 强制人工确认已经被证明不可用，不得继续作为实施依据。现行决策见 [ADR-0031](0031-stateless-unattended-mcp.md)。

设备级“跳过高风险操作确认”和 initialize 阶段的整包读/写授权不能表达用户真实信任：用户可能希望“导入文件”仅本次允许、在当前 session 总是允许，或只对某个可信客户端长期允许。它还会把是否信任一类能力、是否允许访问某个资源库、以及本次具体操作是否安全混为一谈。

另一方面，从磁盘删除整个资源库等低频、不可逆或大范围操作不能因为用户曾开启普通权限而静默执行。

## 决策

1. 以 Automation Capability 作为稳定权限 ID，风险等级作为独立的命令/操作属性。Registry 是 capability、风险等级、计划要求与 MCP 暴露元数据的唯一事实来源。
2. 读取等 `safe` 能力默认允许；普通写入等 `controlled` 能力默认询问，并允许 `allow-once`、当前 Automation Execution 的 `allow-session`，或设置中按 `(credentialId, capability)` 保存的 `always-allow`。
3. MCP 客户端凭据、资源库授权、权限策略/会话授权、Execution Plan 与关键危险确认是独立证据，任何一层都不能推导或替代另一层。Agent 不得通过 MCP 参数、环境变量或配置文件选择授权结果。
4. 设置中的“开启所有权限”按当前客户端生效，只把当时已知的 `controlled` capability 设为持久允许；未来新增能力仍默认询问。开启动作本身需要危险设置确认。
5. `critical` 操作每次都通过 Main-owned 的独立 modal child window 确认，只提供取消和红色确认；默认焦点为取消，Escape 和关闭窗口均取消。它不接受 session/persistent allow，也不受“开启所有权限”影响。
6. 允许权限从不跳过 Execution Plan、实体版本、资源库变更序号、冲突处理或 Worker 状态校验。等待授权后必须重新校验计划和上下文。
7. 当前“从磁盘删除资源库”不向 MCP 暴露，但必须迁移到同一 critical 风险分类和确认组件，并移除“不再提示”。

## 后果

- 用户可按实际任务渐进授权，可信客户端可以减少重复确认，而不同客户端、session 和资源库不会隐式共享信任。
- 实现需要新的 Permission Policy Store、Main Permission Broker、会话授权生命周期、权限设置矩阵和两类确认 UI。
- `tools/list` 必须保留可请求的受控工具；调用时再进入 Permission Broker，不能通过隐藏工具阻止首次授权。
- 旧 `skipApproval` 值不能迁移成全权限，升级后一律按 `ask` 处理，避免静默扩大权限。
- 权限决策与审计必须脱敏，不记录 bearer token、绝对路径、文件内容或完整工具输入。
- Windows packaged 验证必须覆盖 modal owner、焦点、任务栏、父窗口关闭和原子策略存储；macOS 结果不能替代 Windows 证据。

## 被拒绝的替代方案

- **保留设备级跳过确认布尔值**：粒度过粗，不能区分能力、客户端或 session，也容易把普通权限误当成不可逆操作授权。
- **initialize 时一次批准整包读/写**：用户在真实操作发生前没有足够上下文，且导致工具发现与授权耦合。
- **所有操作都逐次确认**：安全但可用性差，无法满足长时间 Agent 工作流。
- **“开启所有权限”包含 critical 操作**：会使低频不可逆行为失去最后一道本机确认，不接受。

## 详细规格

见 [MCP 细粒度权限与关键危险操作确认设计](../superpowers/specs/2026-08-10-mcp-permission-policy-and-critical-confirmation-design.md)。
