# 第0024框架规格：脚本—插件扩展平台

> 状态：顶层设计已确认，等待按 Beads 子工单分阶段实施
>
> 日期：2026-07-29
>
> 上位决策：[ADR-0025](../adr/0025-automation-core-script-runtime-and-mcp.md)、[ADR-0026](../adr/0026-plugin-runtime-installation-and-trust.md)
>
> 相关规格：[0023 脚本自动化与 Agent MCP](0023-automation-scripting-mcp-framework.md)
>
> Beads 实施 Epic：`Serpent-upsn`

## 1. 目标

Serpent 需要一个足够强的 TypeScript/JavaScript 插件系统，使第三方插件能够：

- 扩展资产、文件夹等对象的右键菜单，扩展工具栏、Inspector、查看页和设置页。
- 在左侧导航增加入口，并在中央工作区运行完整的插件 UI 与逻辑。
- 注册快捷键，读取键盘、鼠标、滚轮和输入法事件；在明确的捕获会话中暂时独占应用内输入。
- 观察或参与导入、删除、恢复、文件夹变更等领域操作。
- 扩展格式解析、缩略图、预览、元信息、搜索、过滤、排序、AI 和后台任务。
- 通过和自动化脚本相同的领域 API 读取、组织和修改资产，不复制数据库或文件操作实现。
- 以用户级方式安装，也可以把插件代码放入资源库，使多台设备同步同一工作环境。

系统不建设插件社区和人工审核流程。第一阶段只提供本地包、本地目录和符合规范的 GitHub 仓库安装。

## 2. 已确认的产品决定

1. 插件只提供 TypeScript/JavaScript 一等开发模型，不提供 Serpent 管理的 Python 运行时。
2. 脚本与插件共享 Automation Command Gateway、能力词汇、领域 API 和日志基础，但不是同一种产品对象。
3. 标准插件运行在受控环境；可信插件获得完整 Node.js 能力，由用户在理解风险后决定是否运行。
4. 用户级插件安装在当前 Serpent 用户配置中；资源库级插件代码保存在资源库内并随资源库同步。
5. 资源库级插件在每台设备首次出现时都必须显式信任；信任状态不得随资源库同步。
6. 同一插件同时存在用户级和资源库级版本时，不自动决定优先级。用户必须选择本机在该资源库中使用哪个版本，也可以暂时禁用。
7. 选择结果在本机记忆。普通同源升级沿用选择；权限增加、运行模式改变或来源改变时重新询问。
8. 只考虑个人多设备同步，不设计管理员、成员、审批或协作权限。本地用户可以任意修改资源库插件及其同步配置。
9. GitHub 安装只要求仓库 URL 和规范化仓库内容，不要求 GitHub Release。
10. 标准插件不执行远程仓库中的构建、`npm install`、`postinstall` 或任意 Shell。

## 3. 脚本、插件和 MCP 的关系

```text
                        Automation Command Gateway
                         /          |           \
                        /           |            \
        Automation Script      Plugin Host       MCP Adapter
        单次/显式运行           安装/生命周期       Agent 精选工具
        循环与批处理            UI/Hook/Provider    结构化调用
```

三者共享的是领域能力，不共享产品生命周期：

| 维度 | 自动化脚本 | 插件 | MCP |
| --- | --- | --- | --- |
| 主要用途 | 一次性或保存的复杂批处理 | 长期扩展应用行为与 UI | Agent 的精选结构化工具 |
| 生命周期 | 每次运行形成 Execution，完成即结束 | 安装、激活、停用、升级、卸载 | MCP 连接生命周期 |
| UI | Console 输出、计划和结果 | 菜单、面板、完整工作区、设置 | 无应用内自定义 UI |
| Hook / 输入捕获 | 不支持长期注册 | 支持 | 不支持 GUI 输入 |
| 领域操作 | `serpent` SDK → Gateway | 同一 SDK → Gateway | Registry 映射 → Gateway |
| 运行时 | QuickJS 隔离执行 | 标准 QuickJS / 可信 Node | 本地 stdio host |

标准插件可以复用 Script Runtime 的 QuickJS 引擎、TypeScript 转换、RPC 和资源预算实现，但必须使用独立的 `Plugin Runtime Contract`。不能通过“永不结束的脚本”模拟插件，也不能让保存脚本注册常驻 Hook、UI 或输入监听。

插件可以注册命名空间命令。脚本只能在目标插件已激活并被授权时调用这些命令：

```ts
await serpent.plugins.call('com.example.palette.extract', {
  assetIds,
});
```

插件命令默认不暴露给 MCP。插件清单必须声明 `mcp.expose`，用户还要在本机明确启用，MCP 才能以 `plugin.<pluginId>.<commandId>` 暴露经过 Schema 校验的命令。插件不能向 MCP 暴露任意 `eval`、秘密或未声明的 Node 接口。

## 4. 核心领域对象

### 4.1 Plugin Package

一份不可变、带完整性摘要的插件成品。Package 包含清单、已编译后端、可选 UI、文档与许可证，不等于 Git 仓库或源码工作区。

### 4.2 Plugin Installation

把一个 Plugin Package 放入用户插件存储或资源库插件存储。安装只表示代码存在，不表示它已被信任或激活。

### 4.3 Plugin Trust Decision

当前设备上的用户对一个确定的包摘要、来源、运行模式和权限集合做出的信任决定。资源库同步不得复制该决定。

### 4.4 Plugin Resolution

同一插件 ID 同时存在用户级和资源库级版本时，当前设备针对当前资源库选择实际运行版本的决定：

```text
use-global | use-library | disabled
```

Resolution 不随资源库同步，因为另一台设备可能没有相同的用户级版本。

### 4.5 Plugin Activation

确定版本通过兼容性、完整性、信任和权限检查后，为一个资源库创建运行中 Plugin Instance。一个插件 ID 在一个资源库中最多激活一个版本。

### 4.6 Plugin Contribution

插件向 Host 注册的菜单、命令、视图、设置、Provider 或 Hook 描述。Contribution 必须有稳定 ID，停用插件后可完整撤销。

### 4.7 Input Capture Session

插件在应用内临时持有键盘或指针事件的有界会话。Capture 不是操作系统全局键盘钩子，也不是普通快捷键监听。

## 5. 包格式与清单

规范仓库或本地包至少包含：

```text
serpent-plugin.json
dist/
  main.js                  # 有后端时必需
  ui/index.html            # 有自定义 UI 时必需
README.md
LICENSE
```

依赖必须打包进 `dist`。标准插件不允许原生 Node 模块；可信插件如包含原生模块，必须在清单声明支持的 OS、架构和 Node ABI。

清单 v1 建议结构：

```json
{
  "manifestVersion": 1,
  "id": "com.example.palette-tools",
  "version": "1.2.0",
  "name": "Palette Tools",
  "description": "Extract and organize asset palettes.",
  "author": "Example",
  "license": "MIT",
  "repository": "https://github.com/example/serpent-palette-tools",
  "engines": {
    "serpent": ">=0.2.0 <1.0.0",
    "pluginApi": 1
  },
  "runtime": {
    "mode": "standard",
    "entry": "dist/main.js"
  },
  "ui": {
    "entry": "dist/ui/index.html"
  },
  "permissions": [
    "asset.read",
    "metadata.write",
    "ui.workspace",
    "input.shortcut"
  ],
  "contributes": {
    "commands": [],
    "menus": {},
    "views": [],
    "settings": []
  }
}
```

约束：

- `id` 一经发布不可改变，使用小写、数字、点、连字符和下划线，长度 3–64。
- `version` 使用 SemVer。
- 所有路径必须是包内相对路径；拒绝路径穿越、绝对路径和符号链接逃逸。
- 安装器限制归档大小、文件数量、单文件大小和展开后总大小。
- 清单、文件列表和每个文件 SHA-256 写入 lock；运行前再次校验。
- 未声明入口、权限、Contribution 或平台依赖不得在运行时动态增加。

## 6. 安装、同步与更新

### 6.1 用户级安装

用户级 Package 安装在 Electron `userData` 下的版本化插件存储。用户可以选择对全部资源库、指定资源库或当前禁用，但代码本身只安装一次。

### 6.2 资源库级安装

资源库级 Package 放在：

```text
.serpent/plugins/<plugin-id>/<version>/
.serpent/plugin-lock.json
```

Package、lock 和资源库级非秘密设置随资源库整体复制或第三方同步。更新、删除和配置都是普通本地修改，不引入协作权限。

资源库打开时：

1. 读取 lock，不执行插件代码。
2. 校验清单、兼容性和文件摘要。
3. 未在本机信任的 Package 标记为“等待信任”。
4. 用户查看来源、版本、运行模式、权限和变更后决定信任。
5. 只有信任和版本 Resolution 都完成后才能激活。

### 6.3 GitHub 仓库安装

用户粘贴 GitHub 仓库 URL 后，安装器：

1. 读取仓库标签，优先选择最新兼容 SemVer tag。
2. 下载该 tag 的源码归档；不要求 GitHub Release。
3. 只接受仓库中已经存在的规范清单和 `dist` 成品。
4. 不运行依赖安装、构建、生命周期脚本或 Shell。
5. 记录仓库 URL、tag、commit SHA、包摘要和安装时间。

允许从默认分支安装，但必须提示“分支内容可变”，并锁定本次 commit SHA。更新仍生成新的不可变 Package，不在原目录上覆盖。

### 6.4 原子更新与回滚

- 新版本先下载到 staging，完成校验和兼容性检查后原子切换 lock。
- 保留上一可运行版本用于自动回滚；插件成功激活并通过健康窗口后再清理更旧版本。
- 权限增加、`standard → trusted`、来源变化或完整性异常必须重新确认。
- 同一来源、同一运行模式且权限未增加的普通升级沿用既有版本选择。
- 更新后反复崩溃时自动回滚并隔离新版本。

### 6.5 用户级与资源库级版本冲突

Host 不设隐式优先级。第一次遇到冲突时展示：

- 使用用户级版本。
- 使用资源库级版本。
- 暂时不启用。

界面同时显示版本、来源、Package 摘要、权限差异、运行模式和兼容性。选择按“设备 + 资源库 + 插件 ID”保存，可在插件管理页更改。两个版本绝不能同时运行。

## 7. 运行模式与真实安全边界

### 7.1 标准插件

标准插件后端运行在可终止的 QuickJS 隔离单元中：

- 没有 Node built-ins、`process`、环境变量、任意 import、文件系统、网络或数据库。
- 只通过 Host 注入的 Plugin SDK 和有 Schema 的消息调用 Serpent。
- 有 CPU、墙钟、内存、输出、并发请求、事件队列和未完成 Promise 上限。
- 无限循环、内存膨胀或运行时崩溃不得带走 Renderer、Main 或 Library Worker。
- 标准插件 UI 运行在独立 origin 的 sandboxed iframe 中，无 Node、无同源应用 DOM 权限。

标准插件权限是可执行的能力边界：未声明或未授权的 Host API 必须拒绝。
这里的“没有文件系统和网络”是指没有任意原生访问；标准插件仍可在授权后使用 Host
提供的资产内容流、插件存储、用户选择的文件句柄和按域名 allowlist 限制的
`serpent.net.fetch`。这些调用可记录、可取消并受大小与速率限制。

### 7.2 可信插件

可信插件后端运行在独立 UtilityProcess 中，获得完整 Node.js 能力，可以使用文件系统、网络、子进程和第三方依赖。

可信模式的关键事实必须直接告诉用户：

- 权限清单主要用于风险披露、Serpent API 授权和管理界面说明。
- Serpent 无法可靠拦截可信插件直接通过 Node.js 执行的所有系统行为。
- 即使 Serpent 的文件命令要求计划确认，恶意可信插件仍可能绕过 Gateway 直接使用 `node:fs`。
- 可信插件崩溃隔离和日志记录不是恶意行为防护。

每个可信插件使用独立进程，不能把多个可信插件装入 Main、Renderer 或同一共享 Node 上下文。插件停用、卸载或崩溃时终止对应进程并撤销所有 UI、Hook 和输入捕获。

### 7.3 为什么保留两种模式

标准模式适合绝大多数 UI、组织、搜索、格式元信息和自动化插件，提供可执行的边界。可信模式承载 DCC 集成、自定义原生解码器、外部程序和完整开发环境等无法被标准 Host 表达的能力。不能把可信模式包装成“仍然完全受权限控制”的虚假安全承诺。

## 8. Plugin Host 进程架构

```text
Renderer
  ├─ Host-rendered contributions
  └─ sandboxed plugin iframe ── typed postMessage ── Main Plugin Broker
                                                   │
Main Plugin Supervisor ────────────────────────────┼─ Automation Gateway
  ├─ package / trust / activation                  ├─ Event & Hook Broker
  ├─ contribution registry                         ├─ Input Capture Broker
  ├─ crash quarantine                              └─ AppLogger
  │
  ├─ Standard Plugin Host UtilityProcess
  │    └─ QuickJS realm per plugin
  │
  └─ Trusted Plugin UtilityProcess per plugin
                                                   │
                                             Library Worker
                                      SQLite / files / jobs owner
```

不变量：

- Renderer 不加载第三方后端代码，不接收任意路径、SQL、秘密或 Node 能力。
- Main 只做安装、信任、调度、窗口/UI Broker 和进程监督，不打开资源库数据库。
- Plugin Host 不直接打开资源库数据库；领域操作仍经过 Gateway 和 Library Worker。
- Hook 不得在 SQLite 事务或不可中断文件临界区内等待插件。
- 自定义 UI 只能通过 typed bridge 调用其已授权的后端或 Host API。

## 9. Plugin SDK 能力面

### 9.1 领域 API

复用 0023 的 `serpent` SDK 和 Registry：

- `assets`：分页列表、搜索、详情、元数据、评分、喜欢、路径复制。
- `folders`：列表、创建、重命名、移动、删除/恢复计划。
- `tags`、`collections`：查询与批量关系修改。
- `files`：导入、移动、重命名、回收站等 Execution Plan。
- `jobs`、`ai`：入队、查询、暂停、继续、取消、重试。
- `library`：当前 Plugin Instance 所绑定资源库的只读信息。
- `content`：按资产 ID 读取有界内容流或预览 artifact，不暴露任意绝对路径。
- `net`：按清单域名 allowlist 发起 HTTP(S) 请求；不提供原始 socket。
- `clipboard`：在独立权限下读写声明类型的剪贴板内容。
- `storage`、`secrets`：访问插件自己的命名空间数据和系统凭据项。

插件不能用当前 GUI 焦点冒充资源库身份。每个 Instance 明确绑定资源库；跨库工作拆成独立命令或 Instance。
标准插件访问用户在文件选择器中显式选择的外部文件时只获得不可伪造的临时或持久
Handle，不获得任意父目录遍历能力。启动进程、原始磁盘路径和任意系统文件访问仅属于
可信模式。

### 9.2 UI Contributions

Host-rendered、声明式扩展点：

- `commands`
- `menus.asset`
- `menus.folder`
- `menus.collection`
- `menus.workspace`
- `toolbar`
- `inspector.sections`
- `viewer.actions`
- `settings.sections`
- `shortcuts`

完整自定义 UI 扩展点：

- `sidebar.entries`
- `workspace.views`
- `inspector.views`
- `viewer.overlays`
- `settings.pages`

小型菜单、按钮和设置行由 Host 渲染，继承主题、键盘导航、无障碍和禁用语义。完整工作区和复杂面板使用 sandboxed iframe；插件不能把任意 React 组件注入 Serpent React 树，也不能查询或修改宿主 DOM。

所有 Contribution 必须支持：

- 稳定 ID 和插件命名空间。
- 可见条件、启用条件和禁用原因。
- 激活时注册，停用时完整撤销。
- 亮色、暗色、缩放和中英文环境。
- Host 级菜单顺序规则；插件不能用任意 z-index 覆盖系统对话框。

### 9.3 设置与存储

插件清单提供设置 Schema，Host 生成基础设置 UI；复杂设置可贡献自定义页面。

数据分层：

| 类型 | 保存位置 | 是否同步 |
| --- | --- | --- |
| 用户级默认设置 | `userData` | 否 |
| 资源库级插件设置 | `.serpent/` 插件配置 | 是 |
| 本机覆盖值 | `userData`，按资源库和插件分区 | 否 |
| API Key / token | 系统凭据库 | 否 |
| 插件缓存 | 本机 cache | 否，可清理 |
| 插件持久领域数据 | 通过命名空间 Storage API | 取决于声明 scope |

资源库设置可以覆盖用户默认值。秘密、绝对本机路径和信任记录不得写入资源库同步数据。

### 9.4 日志与后台任务

- 每个日志条目带 `pluginId`、版本、Instance、资源库、操作和 `logId`。
- 用户可在后台任务/脚本统一入口按插件过滤日志，完整诊断同时写入持久日志文件。
- 标准插件 console 输出限量并单独标记。
- 插件可以注册后台 Job handler；Job 由现有任务系统持久化并显示来源插件。
- 插件缺失、停用或版本不兼容时，其未完成 Job 进入 paused/blocked，不由其他版本静默接管。
- Job handler 必须幂等或声明恢复策略，更新插件时等待安全点或明确取消。

## 10. 事件、Hook 与 Provider

### 10.1 事件：已经发生

`onDid*` 事件只用于观察提交后的事实，例如：

- 资产导入、移入回收站、恢复、永久删除。
- 文件夹创建、重命名、移动、删除。
- 元数据、标签、合集、AI 内容变化。
- 搜索、过滤、排序上下文变化。
- 资源库打开、关闭、离线和恢复。

事件携带稳定 ID、最小摘要、`eventId`、来源和 cause chain，不直接携带绝对路径或秘密。插件需要更多信息时再调用领域 API。

领域事件默认至少一次投递，插件必须使用 `eventId` 去重。纯 UI 状态事件可以是会话内尽力而为，不承诺重放。

### 10.2 Hook：操作尚未提交

`onWill*` 只能在领域预检/Execution Plan 阶段运行，不能在事务或文件锁内执行。Hook 返回：

```ts
type HookDecision =
  | { action: 'allow' }
  | { action: 'warn'; message: string }
  | { action: 'block'; code: string; message: string };
```

Hook 不能直接重写命令参数或修改数据库，避免多个插件形成不可预测的变换链。需要补充操作时，插件在 `onDid*` 后发起独立、可追踪的领域命令。

阻断型 Hook 需要 `hook.blocking` 权限。默认超时策略是 fail-open 并记录日志；只有用户为特定插件明确启用“插件不可用时阻止操作”，才允许 fail-closed。排序按用户优先级、插件 ID 稳定执行，不能依赖安装时间。

插件发起的命令必须携带 cause chain。Host 限制递归深度并检测重复的“事件 → 命令 → 同类事件”循环。

### 10.3 Provider：扩展一种能力

下列能力使用 Provider，而不是滥用事件 Hook：

- `preview.provider`
- `thumbnail.provider`
- `metadata.extractor`
- `import.provider`
- `export.provider`
- `ai.provider`
- `derived-field.provider`
- `search.provider`

搜索、过滤和排序不得在 Renderer 中对 10 万资产逐项调用插件 JS。优先模型是：

1. Provider 计算命名空间化的派生字段。
2. Host 通过批量 API 把字段写入插件索引存储。
3. Serpent 原生搜索、过滤和排序对物化字段执行查询。

确实需要实时查询的 `search.provider` 必须支持取消、分页、deadline、结果上限和渐进返回；超时只降级该 Provider，不阻塞原生结果。自定义排序必须提供可缓存的稳定 sort key，不允许每一帧渲染时调用插件比较函数。

## 11. 键盘、鼠标与输入捕获

普通快捷键：

```ts
serpent.input.registerShortcut({
  id: 'open-palette',
  accelerator: 'Ctrl+Space',
  command: 'com.example.palette.open',
});
```

需要连续持有输入时，插件创建 Capture Session：

```ts
const session = await serpent.input.capture({
  scope: 'application',
  keyboard: true,
  pointer: false,
  ownerViewId: view.id,
});

try {
  for await (const event of session.events) {
    if (event.type === 'keydown' && event.key === 'Enter') break;
    if (event.type === 'keydown' && event.key === 'Escape') break;
    // text、compositionstart/update/end、keyup、pointer、wheel
  }
} finally {
  session.release();
}
```

支持范围：

- `view`：只捕获插件自己的活动视图。
- `viewer`：捕获当前资产查看页。
- `application`：捕获 Serpent 应用窗口内的输入。

规则：

- 同一时间只有一个 application Capture owner；后来的请求明确失败，不能静默抢占。
- 系统/权限/破坏性确认对话框优先级高于插件，出现时强制暂停或释放 Capture。
- 插件崩溃、停用、视图关闭、资源库关闭和窗口失焦时自动释放。
- Host 保留不可被插件拦截的紧急释放快捷键。
- 文本输入支持 IME composition，不能只监听 `keydown` 拼接字符。
- 高频 pointer move 和 wheel 事件合并、限速并施加队列背压。
- 标准插件不能捕获 Serpent 以外的系统全局输入；可信插件自行使用系统 Hook 属于完整 Node 风险范围。
- macOS `Ctrl+Space` 等系统保留组合键需要冲突提示和用户重新绑定。

权限使用 `input.shortcut`、`input.capture.viewer`、`input.capture.application`；安装/变更时授权，不在每次 Capture 时重复弹窗。

## 12. 主题

插件 UI 使用 Host 提供的设计 token、CSS variables、字体、间距和状态色。标准插件的 CSS 只作用于自己的 iframe。

主题包可以提供受支持 token 的覆盖值。直接向 Serpent 宿主 DOM 注入任意 CSS 属于可信主题能力，需要单独警告；它可能破坏布局、无障碍和升级兼容性，不享受稳定选择器承诺。

## 13. 可靠性和故障恢复

- Plugin Supervisor 记录启动、激活、Hook、Provider、Job、退出原因和资源占用。
- 激活有 deadline；超时或失败不能阻止资源库打开。
- 插件连续崩溃进入 quarantine，下次启动默认禁用并显示原因。
- Serpent 提供 Safe Mode：本次启动不加载第三方插件，但保留管理和卸载入口。
- UI iframe、标准 Host 和可信进程均有心跳；失联后撤销 Contribution、Hook 和 Capture。
- Hook、Provider 和事件队列有上限、取消和背压；慢插件不得拖慢主浏览、搜索或文件提交。
- 更新使用 staging、健康窗口和上一版本回滚。
- 插件错误向用户显示安全、可操作原因，完整堆栈和路径只进入本地日志。
- Serpent 不上传插件遥测；诊断由用户主动导出。

## 14. API 与兼容性

- Plugin API 独立使用整数主版本，首版为 `1`。
- `engines.serpent` 和 `engines.pluginApi` 在安装与激活时双重校验。
- API 字段和 Contribution 弃用至少保留一个发布周期。
- Plugin SDK 类型从公共 Schema 生成；Host、类型、示例和测试 fixture 同版本发布。
- 插件自有数据迁移必须声明 `from` / `to` 和回滚策略，在新版本激活前完成。
- 更新失败不得留下半迁移状态；资源库级数据迁移需要备份或可逆日志。

## 15. 测试门禁

每个功能变更必须同步更新受影响测试。实施至少覆盖：

### 契约与安装

- Manifest、SemVer、平台、路径穿越、符号链接、归档炸弹和文件摘要。
- GitHub tag、默认分支锁 commit、不执行构建脚本。
- 用户级/资源库级安装、两设备模拟同步、每设备信任。
- 同 ID 双版本选择、记忆、切换、缺失版本和升级重新确认。

### 运行时与安全

- 标准插件无法访问 Node、环境变量、文件系统、网络、宿主 DOM 和任意 IPC。
- 无限循环、内存膨胀、Promise 风暴、事件洪水和输出洪水可终止。
- 可信插件进程崩溃不影响 Main、Renderer、Worker 和其他可信插件。
- 权限不足、权限增加、模式变化、来源变化和摘要篡改 fail-closed。

### UI 与输入

- Contribution 注册/撤销、菜单 enablement、视图恢复、主题、语言、缩放和无障碍。
- iframe CSP、origin、postMessage Schema 和导航/下载限制。
- 快捷键冲突、IME、Capture mutex、紧急释放、崩溃释放和系统对话框抢占。
- Electron E2E 必须在后台、隔离 userData 和测试资源库运行。

### Hook、Provider 与性能

- did event 去重、cause chain 防循环、Hook 顺序、超时和 failure mode。
- Hook 不在事务/锁内运行，不能回调形成死锁。
- Provider 取消、分页、超时降级、版本失效和缓存重建。
- 10 万资产下插件派生搜索/过滤/排序不破坏原生首屏性能目标。

### 生命周期与恢复

- 安装、启用、停用、升级、回滚、卸载、Safe Mode 和 crash quarantine。
- 插件 Job 在应用重启、插件缺失、版本改变和资源库关闭后的状态。
- macOS / Windows packaged 安装、Unicode/长路径、升级与卸载保留资源库数据。

大规模功能完成后按仓库纪律执行独立 Standards/Spec 审查、真实 Electron E2E 和 Computer Use；实现者不得自行签署最终 accepted。

## 16. 分阶段交付

### Phase A：契约与 SDK

- Manifest Schema、Package/Installation/Trust/Resolution 数据模型。
- Plugin API v1、生成的 SDK 类型、Contribution Registry。
- 用户级/资源库级目录与 lock 规范。
- Beads：`Serpent-upsn.1`。

### Phase B：安装、信任和管理

- 本地包、本地目录、GitHub URL 安装。
- 完整性、原子升级、回滚、双版本选择。
- 插件管理页、Safe Mode 和 crash quarantine 基础。
- Beads：`Serpent-upsn.2`。

### Phase C：标准与可信 Host

- QuickJS 标准 Plugin Runtime Contract。
- 每插件可信 UtilityProcess、监督、日志和强制终止。
- Activation/Deactivation、设置和命名空间存储。
- Beads：`Serpent-upsn.3`（标准）、`Serpent-upsn.4`（可信）。

### Phase D：领域 API、事件和后台任务

- 复用 Gateway 的 Plugin SDK。
- did events、cause chain、插件 Job。
- 阻断 Hook 与 Execution Plan 集成。
- Beads：`Serpent-upsn.5`。

### Phase E：UI Contributions 与输入捕获

- Host-rendered 菜单、工具栏、Inspector、设置。
- sandboxed iframe 工作区、侧栏入口和查看页 overlay。
- shortcut、IME 和 Capture Session。
- Beads：`Serpent-upsn.6`（UI）、`Serpent-upsn.7`（输入）。

### Phase F：Provider 与高级扩展

- 预览、缩略图、元信息、导入导出和 AI Provider。
- 物化派生字段、搜索/过滤/排序扩展。
- 插件命令按用户授权选择性暴露到 MCP。
- 主题 token 包与可信 CSS 主题。
- Beads：`Serpent-upsn.8`（Provider）、`Serpent-upsn.9`（MCP/主题/打包/QA）。

## 17. 明确不做

- 第一阶段插件社区、评分、审核和官方市场。
- Serpent 托管的 Python 环境、pip 或 Python SDK。
- 标准插件的系统全局键鼠 Hook、任意 Node、Shell、SQL 或宿主 DOM。
- 打开资源库时自动运行未信任代码。
- 从 GitHub 仓库执行安装、构建或生命周期脚本。
- 两台设备同时写同一资源库、团队角色和协作审批。
- 保证可信插件的系统行为都能被权限清单拦截。
- 让资源库同步信任、密钥、绝对本机路径或版本冲突 Resolution。

## 18. 给实施 Agent 的硬约束

1. 不得绕过 Automation Command Gateway 复制资产、数据库或文件操作逻辑。
2. 不得把第三方后端代码加载到 Renderer 或 Main。
3. 不得把 `node:vm` 当成标准插件安全边界。
4. 不得让资源库插件在显式信任前执行任何入口代码。
5. 不得对用户级和资源库级同 ID 插件设置隐藏优先级。
6. 不得声称可信插件仍被细粒度权限完全限制。
7. 不得在 SQLite 事务或文件锁内等待插件 Hook。
8. 不得在 Renderer 中逐资产运行搜索、过滤或排序 Provider。
9. 不得用无限制事件流或 input capture 阻塞 Host。
10. 修改任何功能后必须在同一增量更新相关测试、类型和文档。
