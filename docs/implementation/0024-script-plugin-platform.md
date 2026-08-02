# 第0024框架规格：脚本—插件扩展平台

> 状态：最终架构设计已确认，按此拆分实施（尚不表示实现或平台验收完成）
>
> 日期：2026-07-29
>
> 最后修订：2026-08-02
>
> 上位决策：[ADR-0025](../adr/0025-automation-core-script-runtime-and-mcp.md)、[ADR-0026](../adr/0026-plugin-runtime-installation-and-trust.md)、[ADR-0027](../adr/0027-plugin-instance-lifecycle-and-interaction-context.md)
>
> 相关规格：[0023 脚本自动化与 Agent MCP](0023-automation-scripting-mcp-framework.md)
>
> Beads 实施 Epic：`Serpent-upsn`、`Serpent-7nah`

## 1. 目标

Serpent 插件平台要让第三方扩展像原生能力一样参与应用，但不能为每个新需求继续增加一次性的 Manifest 字段和 Renderer 分支。插件应能够：

- 以稳定命令和结构化 Contribution 扩展菜单、工具栏、Inspector、Viewer、设置与工作区。
- 使用树形菜单、子菜单、语义分组、前后锚点、当前快捷键、隐藏、置灰和选中状态。
- 根据当前选择、查看资产、资源库和应用状态决定 UI 表现；复杂判断可以调用完整领域 API，但不能阻塞菜单打开。
- 在命令执行时获得冻结的调用快照，再通过与脚本相同的 `serpent` 领域 API 完成功能。
- 使用统一的 `setup(context)` / `dispose(reason)` 生命周期，并明确选择全局实例或资源库实例。
- 注册事件、阻断 Hook、Provider、输入捕获和可恢复后台 Job。
- 在受限（restricted）运行时或用户明确授权的非受限（unrestricted）Node.js 运行时中工作。
- 以用户级方式安装，也可以将包放入资源库，使代码和非秘密配置随库复制。

本规格借鉴 Houdini 的核心思想——稳定标识、声明式 UI 结构、顺序约束、可计算条件、完整脚本环境和明确生命周期——但不采用 XML，也不复制 Houdini 的 Python 运行时。规范格式是可校验 JSON；作者可使用类型化 TypeScript Builder 在构建时生成同一 JSON。

## 2. 设计原则与已确认决定

1. **Action 与 Contribution 分离**：脚本、插件和 MCP 共享 Automation Command Gateway；只有插件拥有常驻生命周期和 UI/Hook/Provider Contribution。
2. **命令是行为源，菜单只是位置**：命令定义标题、图标、启用条件、快捷键和 handler；菜单、工具栏等只引用命令。
3. **上下文不是功能 API**：Contribution Context 只服务 UI 决策；Invocation Context 固定本次操作目标；实际读写通过完整领域 API。
4. **安装范围不决定实例范围**：用户级/资源库级描述包存放位置；`global`/`library` 描述运行实例边界。
5. **生命周期只有一对**：所有插件均使用 `setup(context)` 和 `dispose(reason)`；不增加 `openLibrary` 等第二套生命周期。
6. **条件计算不阻塞 UI 热路径**：同步条件只读取 Host 发布的 Context Key；复杂异步计算先解析成插件命名空间 Context Key。
7. **Host 保持领域不变量**：插件使用 Gateway 时继续受到权限、实体版本、Execution Plan、Worker 所有权和恢复机制约束。
8. **非受限插件不伪装成沙箱**：完整 Node.js 能力意味着插件可自行探测 GPU/CPU/内存、启动模型进程或直接访问系统；Host 不承诺拦截这些行为。
9. **视觉 UI 标准化延期**：主线 Serpent 尚未完成组件与视觉规范，当前只稳定交互语义、结构和边界，不把 toggle/dropdown/slider 枚举包装成稳定 UI Kit。
10. **无需旧协议兼容**：项目尚未发布；实施时直接替换旧 Manifest、Contribution 和生命周期契约，同步迁移仓内 fixture、测试和文档，不维护兼容适配层或弃用周期。

## 3. 脚本、插件和 MCP

```text
                        Automation Command Gateway
                         /          |           \
                        /           |            \
        Automation Script      Plugin Host       MCP Adapter
        一次 Execution          长期 Instance      Agent transport
        领域 Action             Contribution       同一 Action 面
```

| 维度 | 自动化脚本 | 插件 | MCP |
| --- | --- | --- | --- |
| 生命周期 | 每次运行形成 Execution | 安装、实例化、setup、dispose | 连接生命周期 |
| UI/Hook/Provider | 无 | 有 | 无 |
| 领域操作 | `serpent` SDK → Gateway | 同一 SDK → Gateway | Registry → Gateway |
| 运行时 | QuickJS | restricted QuickJS / unrestricted Node | 本地 stdio host |

受限插件可复用 Script Runtime 的 QuickJS、TypeScript 转换、RPC 和资源预算实现，但必须拥有独立 Plugin Runtime Contract。不能用“永不结束的脚本”模拟插件，也不能让普通脚本注册常驻 Contribution。

插件可以注册命名空间命令；只有目标插件实例存在且调用者获授权时，脚本/MCP 才能调用显式导出的命令。导出参数必须是有界 Schema，不允许暴露任意 `eval`、秘密或未声明 Node 接口。

## 4. 领域对象与作用域

### 4.1 Package、Installation、Trust 与 Resolution

- **Plugin Package**：不可变、带完整性摘要的插件成品，包含清单、编译后代码、可选 UI、文档和许可证。
- **Plugin Installation**：把 Package 放入用户插件存储或资源库插件存储；安装不表示信任或运行。
- **Plugin Trust Decision**：当前设备针对确定包摘要、来源、运行模式和权限集合做出的决定，不随资源库同步。
- **Plugin Resolution**：同一插件 ID 同时存在用户级和资源库级版本时，当前设备针对某资源库选择 `use-user | use-library | disabled`。

`installationScope = user | library` 只回答“包在哪里”。它不回答运行时是否全局。

### 4.2 Plugin Instance

通过完整性、信任、版本选择和能力检查后创建的运行单元。Manifest 明确声明：

```ts
type PluginInstanceScope =
  | { kind: 'global' }
  | { kind: 'library' };
```

- **全局实例**：应用会话中每个确定插件版本最多一个，可服务多个窗口和多个已打开资源库。
- **资源库实例**：每个已打开资源库分别创建；同一包在两个库中形成两个隔离实例。
- Contribution 注册键为 `pluginInstanceId + localContributionId`，不能只用插件 ID 或资源库 ID。
- 全局实例的 Contribution 注册一次，在每个窗口的 Context 中分别求值；关闭一个库不能撤销其他库或全局实例的 Contribution。

### 4.3 Interaction Context 三分法

- **Contribution Context**：Host 发布的、体积有界、可同步读取的实时 UI 状态，只用于 `when`、`enablement`、`checked` 和显示文案选择。
- **Invocation Context**：用户触发命令时冻结的目标快照；命令不得在异步等待后重新猜测当前焦点或选择。
- **Domain API**：插件执行功能时调用的完整 `serpent` SDK；它不是上下文快照。
- **Context Key**：Contribution Context 中可供表达式读取的规范值。Host 发布内建 key；插件 Predicate Resolver 只能发布自己命名空间下的派生 key。

### 4.4 其他对象

- **Plugin Contribution**：命令、菜单、工具栏、视图、设置、Hook 或 Provider 的结构化描述；必须可按实例完整撤销。
- **Input Capture Session**：插件在应用内临时持有键盘或指针事件的有界会话，不是系统全局 Hook。
- **Plugin Job**：由 Host Job 系统持久化、由确定插件 handler 执行的后台工作；进度、取消和恢复能力由契约声明。

## 5. 生命周期

插件入口只导出：

```ts
export async function setup(context: PluginSetupContext): Promise<void>;
export async function dispose(reason: PluginDisposeReason): Promise<void>;
```

`PluginSetupContext` 至少包含：

```ts
interface PluginSetupContext {
  pluginId: string;
  pluginInstanceId: string;
  installationScope: 'user' | 'library';
  instanceScope:
    | { kind: 'global' }
    | { kind: 'library'; libraryId: string };
  serpent: SerpentPluginApi;
  subscriptions: DisposableStore;
  signal: AbortSignal;
}
```

Contribution 描述仍由 `serpent-plugin.json` 声明并在 `setup` 前注册；当前版本不提供运行时动态 Contribution Registrar，避免把菜单拓扑和实例撤销拆成两套来源。`subscriptions` 用于托管事件、Provider、Hook、Job handler 等注册返回的 disposable；`signal` 在实例停用、关库、崩溃隔离或 Host 超时时触发。

调用时机：

| 实例范围 | `setup` | `dispose` |
| --- | --- | --- |
| global | 应用会话中该版本首次可运行时 | 应用退出、停用、卸载、升级、崩溃隔离 |
| library | 目标库已打开且版本 Resolution/Trust 完成时 | 关库、停用、卸载、升级、崩溃隔离 |

库打开、关闭、切换、离线和恢复是普通领域事件，不是额外生命周期回调。全局插件可通过 API 列出已打开库并订阅事件；命令触发时得到绑定目标库的 API。后台跨库操作必须显式使用 `serpent.forLibrary(libraryId)`，并受实例范围限制：library 实例只能绑定自己的库。

`dispose` 必须幂等。Host 在 deadline 后可强制终止进程，并无条件撤销该实例的 Contribution、Hook、Provider、Capture、Predicate 和未移交资源。

## 6. 包、清单、安装与信任

包至少包含：

```text
serpent-plugin.json
dist/main.js
dist/ui/index.html          # 可选自定义 UI
README.md
LICENSE
```

清单核心结构：

```json
{
  "manifestVersion": 2,
  "id": "com.example.image-upscaler",
  "version": "0.1.0",
  "engines": { "serpent": ">=0.2.0 <1.0.0", "pluginApi": 2 },
  "runtime": {
    "mode": "unrestricted",
    "entry": "dist/main.js",
    "instanceScope": "global"
  },
  "permissions": ["asset.read", "content.write", "ui.contribute"],
  "contributes": {
    "commands": [],
    "menus": [],
    "keybindings": [],
    "configuration": []
  }
}
```

规则：

- ID 稳定、版本使用 SemVer、所有路径为包内相对路径。
- 归档限制大小、文件数、单文件大小和展开总量；拒绝路径穿越、绝对路径和符号链接逃逸。
- 清单、文件列表和 SHA-256 写入 lock，运行前再次校验。
- 受限插件依赖必须打包进 `dist`，安装时不运行 `npm install`、构建、postinstall 或 Shell。
- 用户级包位于 `userData`；资源库级包位于 `.serpent/plugins/<id>/<version>/`，其信任、秘密和本机路径不随库复制。
- 同 ID 用户/资源库版本不设隐式优先级；用户选择并按设备+库+插件 ID 记忆。
- 更新先进入 staging，校验和健康窗口通过后切换；权限增加、运行模式或来源变化必须重新确认。

安装与信任的完整安全边界继续遵循 ADR-0026 和 [`plugin-distribution-and-updates.md`](../plugin-distribution-and-updates.md)。

## 7. 运行模式与 Host 架构

### 7.1 受限插件（restricted）

受限后端运行在可终止 QuickJS 隔离单元中，没有 Node built-ins、`process`、环境变量、任意 import、原生文件系统、数据库或宿主 DOM。它只通过有 Schema 的 Plugin SDK 行动，并受 CPU、墙钟、内存、输出、队列和并发限制。

受限插件可以在授权后使用 Host 提供的资产内容流、插件存储、用户选择文件 Handle 和按域名 allowlist 限制的网络 API；这不等于任意系统访问。

### 7.2 非受限插件（unrestricted）

非受限后端运行在独立 UtilityProcess 中，具有完整 Node.js、文件系统、网络、子进程和第三方依赖能力。权限清单只约束 Serpent API 并向用户披露风险，不能可靠阻止插件绕过 Gateway 直接行动。

每个非受限 Plugin Instance 使用独立受监督进程；Host 不提供通用共享模型 Worker。插件可在 `setup` 中创建并复用自己的模型/外部进程，在 `dispose` 中释放；崩溃重启和模型切换由插件处理，Host 只监督实例健康与撤销注册。

非受限插件自行探测 GPU、VRAM、CPU、内存和设备能力。Serpent 不增加通用 `system.getGpuInfo` 或推理并发调度 API；无法可靠探测时采用串行等安全降级是插件责任。

### 7.3 进程关系

```text
Renderer
  ├─ Host-rendered Contribution
  └─ sandboxed plugin iframe ─ typed postMessage ─ Main Plugin Broker
                                                   │
Main Plugin Supervisor ────────────────────────────┼─ Automation Gateway
  ├─ package / trust / instance lifecycle          ├─ Context & Command Registry
  ├─ contribution registry                         ├─ Event / Hook / Job Broker
  ├─ crash quarantine                              └─ AppLogger
  ├─ Restricted Host: QuickJS realm per instance
  └─ Unrestricted Host: UtilityProcess per instance
                                                   │
                                             Library Worker
                                      SQLite / files / jobs owner
```

Renderer 不加载第三方后端代码，不接收任意路径、SQL、秘密或 Node 能力；Main 不打开资源库数据库；Hook 不得在 SQLite 事务或文件锁内等待插件。

## 8. 统一交互框架

### 8.1 Command Registry

命令是唯一行为定义：

```ts
interface CommandContribution {
  id: string;
  title: LocalizedText;
  icon?: IconReference;
  enablement?: ContextExpression;
  disabledReason?: LocalizedText | ContextTemplate;
  defaultKeybinding?: KeybindingRule[];
  handler: string;
}
```

- 完整命令 ID 为 `<pluginId>.<localId>`；注册表内部再以 `pluginInstanceId` 隔离。
- 菜单和工具栏只引用 command ID，不复制 handler、快捷键或启用逻辑。
- 菜单展示中央 Keybinding Registry 的当前有效快捷键，而不是 Manifest 中可能过时的默认值。
- 命令 handler 接收 Invocation Context 和已绑定目标库的 Domain API。

### 8.2 Contribution Context

内建 Context 至少包含：

| 范围 | 关键字段 |
| --- | --- |
| 应用 | `app.platform`、`app.locale`、`app.theme`、`app.busy` |
| 表面 | `surface.id`、`surface.kind` |
| 窗口 | `windowId`、`contextId`、`revision` |
| 资源库 | `library.id`、`library.open`、`library.writable`、`library.offline` |
| 选择 | `selection.ref`、`count`、`primaryId`、`assetCount`、`folderCount`、`extensions`、`mimeTypes`、`mediaKinds`、`mixed`、`hasDeleted`、`hasUnavailable` |
| 浏览 | 当前 folder/collection/tag/search/filter 等 scope ID |
| Viewer | `viewer.active`、`assetId`、`extension`、`mimeType`、`mediaKind`、`fullscreen` |

`selection.ref` 是 Host 管理的不可伪造引用；Context 中只放摘要，完整资产信息由 Domain API 读取。一个 `asset.contextMenu` 同时适用于单选和多选；未写数量条件时，Host 不得默认排除多选。

### 8.3 条件表达式与异步 Predicate

每个可交互 Contribution 使用一致语义：

- `when` 为 false：不渲染。
- `enablement` 为 false：保留位置但置灰。
- `checked`：控制 toggle/radio 选中状态。

表达式是无副作用、可终止、只读 Context Key 的声明式语言，支持布尔、比较、集合包含/相交、正则/通配匹配和括号；不允许在表达式中执行 JS、I/O 或 Domain API。

复杂条件由插件注册 Predicate Resolver：

1. Host 在相关 Context revision 变化后异步调用 Resolver。
2. Resolver 可调用完整 Domain API，并发布如 `com.example.upscaler.canRun` 的 namespaced key。
3. 缓存键至少包含 `pluginInstanceId + contextId + revision + predicateId`。
4. 新 revision 取消旧请求；Resolver 有 deadline、错误隔离和 fallback 值。
5. 菜单打开只读缓存，绝不等待插件 RPC。

### 8.4 菜单树与 Placement Solver

```json
{
  "surface": "asset.contextMenu",
  "items": [
    {
      "id": "upscale",
      "command": "com.example.image-upscaler.upscale",
      "group": "transform",
      "after": "host.asset.open-with",
      "when": "selection.assetCount == selection.count && selection.extensions intersects ['jpg','jpeg','png']"
    },
    {
      "id": "advanced",
      "title": "Advanced",
      "group": "transform",
      "children": [
        { "id": "upscale-4x", "command": "com.example.image-upscaler.upscale4x" }
      ]
    }
  ]
}
```

规则：

- 菜单保持树结构，不在注册时丢失 parent/children 关系。
- item 有稳定局部 ID；支持 `parent`、语义 `group`、`before`、`after`、`first`、`last`。
- Host 对同一表面建立确定性约束图并拓扑排序；同优先级以插件 ID、实例 ID、item ID 稳定打破平局。
- 缺失锚点降级到目标 group 末尾并写开发诊断；循环约束拒绝相关边并写明确错误，不能使整个菜单消失。
- 表面策略决定最大深度；首版菜单最多三级。超深节点只拒绝该分支。
- 原生项也必须拥有稳定 Host ID，插件不按文案或 DOM 位置定位。
- `menus.asset` 旧式平面结构直接删除，由统一 `surface: asset.contextMenu` 结构替代。

### 8.5 其他表面

同一 Command、Context、条件和 Placement 语义适用于 toolbar、Inspector action、Viewer action、workspace/sidebar entry。完整自定义工作区、Inspector、Viewer overlay 和设置页继续使用 sandboxed iframe，通过 typed bridge 调用后端或 Host API；插件不能把任意 React 组件注入宿主树或访问宿主 DOM。

## 9. 配置数据与 UI 标准化边界

本阶段稳定的是配置数据 Schema，不是视觉控件 Schema：

```ts
interface ConfigurationProperty {
  key: string;
  valueType: 'boolean' | 'number' | 'string' | 'enum';
  default: unknown;
  scope: 'user' | 'library' | 'machine' | 'machine-library';
  minimum?: number;
  maximum?: number;
  enum?: readonly unknown[];
  description?: LocalizedText;
}
```

容错边界：

- 静态 Manifest/Schema 非法：安装或激活阶段拒绝整个插件，返回精确 JSON path；不能静默猜测作者意图。
- 已持久化值非法：仅该字段回退默认值并给出字段级诊断；其他设置仍可读取和渲染。
- 已删除或未声明的旧 key 可保留在命名空间存储中，但不参与渲染和运行时配置结果。
- 项目未发布，不提供旧设置 Schema 兼容或迁移承诺；仓内 fixture 与新 Schema 一次性迁移。

现有 Host-rendered boolean/select 等设置行视为实验实现，不是稳定公开组件 API。等主线 Serpent 自身形成设计 token、交互状态、布局、表单、无障碍和组件规范后，再单独设计插件 UI primitives（toggle、dropdown、slider、field、section 等）及 `@serpent/ui` 包。届时插件只描述语义，Host 组件负责原生一致性；当前不得继续无限扩张 `setting.type` 枚举。

## 10. Domain API、批量写回与 Execution Plan

插件复用 0023 的完整 `serpent` SDK：assets、folders、tags、collections、files、jobs、ai、content、storage、secrets、net、clipboard 和 library binding。受限插件不获得任意绝对路径；非受限插件直接系统访问不享受 Gateway 保证。

批量内容替换是通用 Gateway Action，不是 Image Upscaler 专用接口：

```ts
await serpent.assets.replaceContentBatch({
  items: [
    { assetId, expectedRevisionId, content: { stagingToken } }
  ]
});
```

语义：

- 所有输出先写入 Host 管理的 staging；大文件不塞入单个 IPC payload。
- 一个批次生成一个 Execution Plan 和一次用户确认。
- 在首次提交前统一校验全部 `expectedRevisionId`；任一变化则整个批次拒绝开始。
- 多文件系统写入无法承诺真正原子；Host 使用 staging、恢复 journal 和明确 per-item result，在崩溃后继续或回滚到可解释状态。
- 成功提交后统一切换 Revision、失效衍生物、刷新缩略图并发布领域事件；Undo/恢复以整个批次关联。

## 11. Job、长生命周期 Worker 与资源管理

Plugin Job API 至少支持：

- `reportProgress({ completed, total, phase, message? })`
- `signal` 取消和明确 cancelled 结果
- 逐项成功/失败结果与可重试输入
- handler 声明 `resumable` 和 checkpoint Schema 后的暂停/恢复；未声明者只支持取消/重试
- 插件缺失、停用或版本不兼容时进入 blocked/paused，不由其他版本静默接管

推荐阶段包括 `preparing`、`loading-model`、`reading`、`processing`、`staging`、`committing`；`awaiting-confirmation` 属于 Execution Plan/UI 状态，不应伪装成插件仍在计算。

模型推理、OCR、视频处理等插件在 `setup` 中启动长生命周期 Worker，在多个 Job 间复用模型，并在 `dispose` 或模型配置变化时释放。全局实例天然可跨库复用一个 Worker；library 实例按库隔离。Host 不替插件设计显存并发策略，也不默认把多个插件的外部模型进程合并共享。

## 12. 事件、Hook、Provider 与输入

- `onDid*` 观察提交后事实，携带稳定 ID、最小摘要、`eventId`、来源和 cause chain；至少一次投递，插件负责去重。
- `onWill*` 只在领域预检/Execution Plan 阶段运行，不能在事务或文件锁内运行；返回 allow/warn/block，不直接改写参数。
- 阻断 Hook 默认 timeout fail-open；只有用户对特定插件明确启用才可 fail-closed。
- Provider 用于 preview、thumbnail、metadata、import、export、AI、derived field 和 search；大规模搜索/排序优先物化字段，不能在 Renderer 逐资产同步调用插件。
- Input Capture 分 `view`、`viewer`、`application`，有互斥、IME、背压、紧急释放和系统对话框优先级；失焦、停用、崩溃、关库和视图关闭时自动释放。

## 13. Worker 协议与故障域

协议按消息重要性分层：

- **控制面**：handshake、request/response、lifecycle、capability negotiation。未知类型、错误 correlation 或不兼容版本属于协议错误，终止并按策略重启/隔离该实例。
- **可选事件面**：统一 envelope `{ kind: 'event', eventType, critical: false, payload }`。未知非关键事件记录诊断后忽略，不杀死 Worker。
- 已声明 `critical: true` 但 Host 不认识的事件视为能力协商失败，不能假装成功。

Contribution Registry 每次 setup/dispose/reload 增加 revision 并通知 Renderer 刷新。未知事件、单个非法 Contribution、单个持久化设置值和某个 Predicate 失败各自局部降级，不得错误扩大为整个插件设置页、全部菜单或整个 Host 崩溃。

## 14. 可靠性、安全与恢复

- Plugin Supervisor 记录实例范围、启动、setup/dispose、Hook、Provider、Job、退出和诊断。
- setup 有 deadline；失败不能阻止应用或资源库打开。连续崩溃进入 quarantine。
- Safe Mode 本次启动不加载第三方插件，但保留管理、诊断和卸载入口。
- UI iframe、受限 Host 和非受限进程有心跳；失联后按实例撤销全部注册。
- Hook、Provider、Predicate、事件和输入队列均有取消、上限、deadline 与背压。
- 更新使用 staging、健康窗口和上一版本回滚；插件自有持久数据迁移必须可恢复。
- Serpent 不上传插件遥测；用户可主动导出诊断。

## 15. API 版本策略（发布前）

- 本项目尚未发布，当前 Plugin API/Manifest 直接升级为新主版本并替换旧实现。
- 不保留旧 Contribution 适配器、不提供一个发布周期弃用、不为旧 fixture 维持双 Schema。
- 公共类型必须从 Schema 生成；Host、SDK、文档、示例和测试 fixture 同一变更发布。
- 真正对外发布前另行制定兼容政策；本条不能被实现者提前解释成永久无版本管理。

## 16. 对 Image Upscaler 反馈的取舍

| 反馈 | 决定 |
| --- | --- |
| 批量内容替换、单次确认、Revision 校验、staging | 接受，建模为通用 Gateway Action；不虚构跨文件真正原子性 |
| 常驻模型 Worker | 接受插件实例内复用；不提供强制 Host 共享模型 Worker |
| Host 提供 GPU/VRAM/CPU/内存接口与推理调度 | 拒绝；非受限插件自行探测和调度 |
| 条件菜单、结构化选择上下文、多选菜单 | 接受，归入统一交互框架 |
| Job 进度、取消、暂停/恢复 | 接受进度与取消；暂停/恢复只对声明 checkpoint 的 handler 开放 |
| 非法设置不能清空整页 | 接受持久化值字段级降级；静态非法 Manifest 仍整体拒绝 |
| 未知 Worker 事件永不终止 | 部分接受；非关键事件忽略，未知控制消息仍 fail-closed |
| 多库 Contribution 隔离 | 接受，以 pluginInstanceId 隔离而非只拼 libraryId |
| Host 级共享 Worker | 拒绝为通用契约；由 global Plugin Instance 自己复用资源 |

## 17. 测试门禁

### 契约与生命周期

- Manifest、路径/归档/摘要、信任、Resolution、用户/资源库安装。
- global setup 一次、library setup 每库一次、dispose 幂等、关一库不撤销其他实例。
- `pluginInstanceId + contributionId` 隔离；setup/dispose/reload 后 Registry revision 刷新。

### Context、Command 与菜单

- Contribution/Invocation/Domain API 不混用，Invocation Context 在等待后仍指向原目标。
- `when`/`enablement`/`checked`、Predicate revision 取消、超时与缓存。
- 单选、多选图片、混合选择、viewer/浏览上下文；无条件菜单不排除多选。
- 二/三级菜单、before/after/group、缺锚点、循环约束和当前快捷键显示。
- 停用、卸载、重装、切库后菜单及时刷新。

### Gateway、Job 与协议

- batch replace 一次确认、统一 Revision 预检、staging 大文件、部分提交崩溃恢复、统一事件/缩略图。
- Job 进度、取消、逐项失败、checkpoint 恢复和不可恢复 handler 的明确拒绝。
- 未知非关键事件不杀 Worker；未知控制消息终止并只隔离当前实例。
- 非法持久化设置只回退单字段；非法静态 Manifest 精确报错并拒绝。

### 安全与真实应用

- 受限插件隔离、非受限进程崩溃、权限变化、Hook 死锁、Provider deadline、Input Capture 释放。
- 真实 Electron E2E 后台运行并隔离 userData；packaged、完整重启、macOS/Windows 和 Computer Use 按仓库四列证据记录，未执行不得写成通过。

## 18. 分阶段交付

1. **基础 Runtime（已有实现继续收口）**：Package、Trust、Resolution、restricted/unrestricted Host、Gateway、事件、Hook、Provider、Input、iframe。
2. **实例生命周期重构**：引入 instance scope，统一 setup/dispose，消除“所有实例绑定单库”的旧假设。
3. **交互内核**：Command Registry、Context Key、Contribution/Invocation Context、条件引擎、Predicate Resolver。
4. **菜单与表面统一**：树形菜单、Placement Solver、快捷键显示，并让 toolbar/Inspector/Viewer 复用同一语义。
5. **批处理与 Job 能力**：batch replace、staging/recovery、进度/取消/可选 checkpoint。
6. **故障域收口**：设置值字段降级、协议控制面/事件面分层、多实例回归。
7. **视觉组件体系（延期）**：只在主线 Serpent UI 设计系统稳定后实施插件 primitives 与统一设置 UI。

具体 Beads ID 和依赖以 `Serpent-upsn`、`Serpent-7nah` 子工单为准。

## 19. 明确不做

- 当前阶段的插件市场、评分、审核、团队审批和 Serpent 托管 Python 环境。
- 受限插件的任意 Node、Shell、SQL、宿主 DOM 或系统全局键鼠 Hook。
- 在 Context 表达式中执行插件 JS 或等待 RPC。
- 把 Contribution Context 扩成完整资产对象或功能 API。
- 通用 GPU/CPU/内存探测 API、Host 推理调度器或跨插件模型 Worker。
- 在主线 UI 规范形成前承诺 toggle/dropdown/slider 的稳定视觉组件 API。
- 为未发布的旧插件协议维护兼容层。

## 20. 给实施 Agent 的硬约束

1. 不得绕过 Automation Command Gateway 复制资产、数据库或文件操作逻辑。
2. 不得把第三方后端加载到 Renderer 或 Main，也不得把 `node:vm` 当安全边界。
3. 不得让资源库插件在显式信任前执行入口代码。
4. 不得由安装范围推导实例范围，也不得重新引入 `openLibrary` 生命周期。
5. 不得让菜单打开等待插件 RPC；复杂判断必须预计算为 Context Key。
6. 不得用文案、DOM 顺序或数组下标作为菜单锚点。
7. 不得把 Context 摘要作为领域读取/写入 API。
8. 不得声称多文件替换具有文件系统原子性；必须设计 staging 和恢复 journal。
9. 不得因未知非关键事件、单个坏设置值或单个坏菜单分支杀死整个插件 Host/UI。
10. 不得为 GPU 探测或模型并发增加无必要 Host 能力。
11. UI 组件标准化工单在主线设计系统稳定前保持延期，不用临时枚举冒充最终抽象。
12. 每个行为变更同步更新 Schema、SDK 类型、fixture、文档和相关测试。
