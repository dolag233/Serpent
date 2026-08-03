# ADR-0027：插件实例范围、统一生命周期与交互上下文分层

- 状态：已接受
- 日期：2026-08-02
- 依赖：[ADR-0025](0025-automation-core-script-runtime-and-mcp.md)、[ADR-0026](0026-plugin-runtime-installation-and-trust.md)

## 背景

早期插件实现把 Plugin Instance 默认绑定到一个资源库，并为菜单、工具栏、设置等扩展点分别增加描述字段。这个模型无法同时解释全局常驻插件、多库资源复用、二级菜单、稳定菜单定位、条件显示和命令执行目标，也容易把“当前 UI 选择”误当成功能 API。

Houdini 等成熟宿主的经验表明，稳定标识、声明式位置、可计算条件、完整脚本 API 和明确生命周期比某一种 XML/JSON 格式更重要。Serpent 还需要避免菜单打开时调用插件代码，并保持受限插件的安全边界。

## 决策

### 安装范围与实例范围分离

`installationScope = user | library` 只描述 Package 存放位置；Manifest 另行声明 `instanceScope = global | library`。

- global：应用会话中每个确定插件版本一个实例，可服务多个窗口和资源库。
- library：每个已打开资源库一个隔离实例。
- Contribution 身份按 `pluginInstanceId + localContributionId` 隔离。

### 生命周期统一

所有实例仅使用 `setup(context)` 与 `dispose(reason)`。两类实例的调用时机不同，`context.instanceScope` 明确当前范围；不增加 `openLibrary` 生命周期。库打开/关闭是可订阅领域事件。

### UI 状态与功能能力分离

- Contribution Context 是 Host 发布的有界同步快照，只用于 `when`、`enablement` 和 `checked`。
- Invocation Context 在命令触发时冻结，标识本次操作的窗口、资源库和选择目标。
- Domain API 是插件实际读取和修改领域对象的完整能力面，继续经过 Gateway。
- 复杂条件通过异步 Predicate Resolver 预计算 namespaced Context Key；菜单打开只读取缓存。

### Command 与 Menu 分离

Command Registry 是标题、图标、启用条件、快捷键和 handler 的行为源。菜单等 Contribution 只引用 command。菜单保持树结构，使用稳定 Host/item ID、语义 group 和 before/after 约束定位；不按文案或 DOM 位置定位。

### UI 标准化的后续边界（2026-08-04 更新）

本 ADR 只决定插件实例、生命周期、Context/Invocation Context 和 Command/Menu 的交互边界，不决定宿主视觉组件的公共 API。产品已将全量 UI 标准化提升为 `Serpent-nzxh` P1 Epic；内部 UI library、Host-rendered semantic descriptor、菜单树递归可见性和迁移顺序由 [0028 UI 标准化与插件结构化 UI 设计分析](../implementation/0028-ui-standardization-and-plugin-ui.md) 设计。实现时仍必须保持本 ADR 的原则：插件不访问宿主 DOM/React/CSS，Context 只服务 UI，功能通过完整 Domain API 执行。

## 原因

- 全局模型 Worker 可以由 global Plugin Instance 自己复用，而不需要 Host 建立跨插件共享进程抽象。
- library 实例仍能获得清晰的权限、存储、日志和撤销边界。
- 冻结 Invocation Context 避免异步命令误操作后来新选中的资产。
- 同步 Context Key 让菜单表现稳定且接近原生 UI，同时允许复杂判断使用完整领域 API 异步求值。
- Command/Menu 分离可统一快捷键、禁用原因和多个表面，避免行为重复声明。

## 后果

- 现有“所有 Activation 绑定单库”的实现和全局 Contribution ID 需要重构。
- Manifest、SDK、fixture 和测试直接升级；项目未发布，不保留旧协议适配层。
- Host 必须维护窗口级 `contextId`、单调 `revision`、Context Key Store 和 Predicate 缓存取消。
- 全局插件通过显式 library binding 执行领域操作，不能依赖当前 GUI 焦点。
- 当前只稳定本 ADR 定义的交互协议；toggle、dropdown、slider 等视觉组件 API 不由本 ADR 直接承诺，待 0028 的内部 UI library 和 semantic descriptor 设计冻结后再按其阶段实施。

## 否决方案

- **按安装位置推导实例范围**：用户级插件也可能需要每库隔离，资源库级包也不应被错误解释成全局实例。
- **增加 `openLibrary`/`closeLibrary` 生命周期**：会形成与 setup/dispose 重叠的状态机；领域事件已能表达库变化。
- **在 `when` 中执行任意 JS/Python**：会阻塞 UI 热路径，并扩大受限插件攻击面和故障域。
- **向 Contribution Context 塞入完整资产对象**：快照会过期、体积不可控，并复制领域 API。
- **Host 提供 GPU/VRAM 调度**：非受限插件已有系统能力，通用 Host 接口会把特定推理策略错误固化成平台责任。
