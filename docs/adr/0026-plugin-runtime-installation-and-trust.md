# ADR-0026：插件采用双运行模式与用户/资源库双作用域安装

- 状态：已接受
- 日期：2026-07-29
- 替代：[ADR-0003](0003-plugin-permission-model.md) 中“权限可以完整约束所有插件行为”的未决解释
- 依赖：[ADR-0025](0025-automation-core-script-runtime-and-mcp.md)

## 背景

Serpent 插件既需要安全地扩展菜单、工作区、搜索和资产领域操作，也需要为 DCC 集成、原生解码和外部程序保留接近 Houdini 插件的完整系统能力。单一沙箱无法同时满足这两种目标；如果向完整 Node 插件承诺细粒度权限可强制拦截，会形成虚假安全边界。另一方面，用户希望插件代码可以跟随资源库在多台设备同步，但同步代码不能等同于同步信任或自动执行。

## 决策

- 受限插件（`restricted`）运行在可终止的受控 JS 环境中，只能通过声明并授权的 Plugin SDK 调用 Serpent；非受限插件（`unrestricted`）运行在独立 Node.js UtilityProcess 中，获得完整系统能力。非受限插件的权限清单用于风险披露和 Serpent API 管理，不承诺拦截其直接 Node 行为。
- 脚本与受限插件可以复用 QuickJS、TypeScript 转换和 Automation Command Gateway。脚本是 Automation Execution（可 headless、完成即结束），通过领域 Action 操作软件；插件拥有安装、激活、UI Contribution、Hook、Provider、输入捕获和后台任务生命周期。不得用常驻脚本代替插件 Contribution；也不得把 `library.create` / `file.import` 等 Action 划成“仅插件”。Console 与 MCP 共享同一 Action 面（见 ADR-0025 2026-07-30 修订）。
- 插件可以安装为用户级，也可以作为不可变成品放入资源库 `.serpent/plugins/` 并随库同步。资源库插件在每台设备首次出现时必须显式信任；信任、密钥和本机路径只保存在当前设备。
- 同一插件 ID 同时存在用户级和资源库级版本时，Serpent 不设置隐式优先级，而是提示用户选择使用哪个版本或禁用。选择在当前设备按资源库记忆；普通同源升级沿用，权限、模式或来源变化时重新确认。
- 插件一等开发语言为 TypeScript/JavaScript。Serpent 不维护 Python 运行时；非受限插件如确有需要，可以自行调用用户环境中的外部程序。
- GitHub 安装优先取符合命名规范的 **Release 平台 asset ZIP**（见 [插件分发与更新规范](../manual/plugins/distribution-and-updates.md)）；不执行远程仓库中的依赖安装、构建或生命周期脚本。过渡期可对无规范 asset 的成品 zipball 回退，并提示作者迁移。

## 后果

- 受限插件拥有可测试、可执行的能力边界；非受限插件拥有最大扩展能力，但用户必须接受其等同本地程序的风险。
- 资源库可以同步完整插件工作环境，同时每台设备保留独立执行授权。
- Plugin Host 必须新增包完整性、信任、版本 Resolution、崩溃隔离、Contribution、Hook、Provider 和输入捕获模型。
- 插件领域操作继续经过 Automation Command Gateway 和 Library Worker；非受限插件直接绕过 Gateway 的系统行为不享受 Serpent 的 Undo、计划确认、恢复和兼容性保证。
