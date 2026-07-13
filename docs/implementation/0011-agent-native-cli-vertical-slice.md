# 第0011垂直切片：一等命令行客户端与 Agent 原生操作面

> 状态：需求已确认；目标版本 v0.2.0，待 v0.1.0 MVP 验收后实施
> 日期：2026-07-13

## 目标

为 Serpent 提供不依赖桌面客户端运行的一等命令行客户端，使人类、脚本和软件 agent 能通过同一套语义化领域能力完成绝大部分非纯 GUI 工作，包括资产、文件夹、元数据、标签、合集、搜索、回收站、AI、任务及资源库导入导出。

CLI 与桌面客户端不存在优先级关系。二者必须同时做到可用、易用，并共享领域命令、校验、错误原因和日志链；CLI 不成为调试后门，不公开任意 SQL、数据库连接、JavaScript 执行或不受约束的文件系统写入。

## 版本定位

0011 不作为 `v0.1.0` 首发 MVP 的发布阻断，而作为 `v0.2.0` 的主切片。原因是 CLI 需要复用
0001–0010 已稳定的领域语义，并新增跨进程写租约、持久变更序号、detached job 领取和双平台
独立分发；在底层工作流仍存在正确性缺口时并行固化 CLI 契约，会制造两个同时变化的公共能力面。

这项排期不改变产品决定：CLI 与桌面客户端在完成后均为一等客户端，不存在运行时优先级。

## 已确认的产品决定

1. CLI 在桌面客户端未运行时可独立完成工作。
2. CLI、桌面客户端及后台 job 是独立进程，不要求常驻 daemon。
3. 每个客户端进程内由 Library Worker 独占数据库连接和资源库文件操作；多个本机进程可以并发读取，同一资源库的修改通过短暂跨进程写租约串行执行。
4. 客户端负责文件监控；资源库同时记录持久变更序号，使其他已打开客户端能发现 CLI 完成的数据库修改并刷新状态。
5. 精确资源引用只接受稳定 ID 或显式资源库中的唯一资源库路径，且必须一对一解析。显示名称不参与猜测。
6. 标签、合集、文件夹、评分、格式等是过滤条件；全文表达式是搜索条件。过滤和搜索都不是精确资源引用。
7. 每个资源库内命令必须显式指定资源库，不读取 GUI 当前状态。
8. CLI 不承担 agent 权限确认。危险操作是否需要批准由调用 CLI 的 agent 应用层决定；CLI 只提供语义明确的功能和可选预演。
9. 第一版不提供通用 idempotency key；标签分配、合集关系和元数据设置等操作尽量自然幂等，导入与文件写入使用显式冲突策略。
10. 长任务默认可在前台等待，也可 detach 后返回 job ID；detached job 不依赖发起终端或桌面客户端存活。
11. CLI 随桌面安装包提供，也提供同版本的独立平台压缩包；第一版不以 `npm install -g` 作为主要分发方式。
12. CLI 是规范能力面；未来 Skills 与 MCP 只包装同一命令注册表和领域实现。
13. CLI 提供机器可读命令自描述，用于生成帮助、补全、Skills 与未来 MCP schema。

进程与并发决定详见 [ADR-0021](../adr/0021-independent-first-party-clients.md)。

## 运行架构

```text
Desktop executable                 CLI executable
        │                                │
        │ typed domain commands          │ typed domain commands
        ▼                                ▼
process-local Library Worker       process-local Library Worker
        │                                │
        ├──────── concurrent reads ──────┤
        └──── per-library write lease ───┘
                         │
                         ▼
               library.db + managed files
```

### 不变量

- CLI 进程不得导入 Renderer 或要求 Electron BrowserWindow。
- CLI 不直接打开 SQLite；数据库连接只存在于其 process-local Library Worker。
- 写租约只覆盖修改操作，不在资源库打开期间长期持有。
- SQLite 事务继续保护数据库写入；`file_operations` 继续保护跨数据库与文件系统的多阶段操作。写租约不代替任一机制。
- schema 迁移、任务领取、导入、移动、重命名、删除、恢复和 AI 结果写回都属于需要租约的修改。
- 锁等待必须有超时；超时返回稳定错误原因并记录持久日志，不能只显示“操作失败”。
- detached job 必须原子领取，多个进程不能执行同一 job。
- 多机并发仍明确不支持；本切片只提供同一台电脑上的多进程协调。

## 资源定位

### 显式资源库

所有资源库内命令必须显式传入资源库。具体参数仅开放以下最后决策：

- 是否只接受资源库根目录；或
- 同时接受本机已经登记的 library ID。

CLI 不从当前目录、环境变量、最近打开记录或 GUI 当前资源库隐式选择目标。

### 精确资源引用

实体的底层身份始终是稳定 ID。人类可以使用该实体在当前资源类型命名空间内的唯一资源库路径；解析后立即转为 ID。

候选示例（语法待确认）：

```text
asset:       ast_01ABC | /Textures/Stone/rock.exr
folder:      fld_01ABC | /Textures/Stone
tag:         tag_01ABC | /Environment
collection:  col_01ABC | /References/Architecture
```

精确引用必须解析为零或一个实体：零匹配返回 `RESOURCE_NOT_FOUND`；数据不变量被破坏而出现多匹配时返回 `RESOURCE_PATH_CONFLICT`，不得取第一项。

### 集合选择

资产集合只通过显式的过滤或搜索能力产生：

- 过滤：标签、合集、资源库文件夹、格式、评分、喜欢、可用性、源链接及格式元信息。
- 搜索：现有 FTS5 结构化查询和关键词查询。
- 批量写入在开始执行前把结果冻结成稳定 ID 列表，避免查询范围在执行中漂移。
- 冻结不是权限确认，也不要求调用方二次批准。

## 命令注册表

CLI、Desktop、E2E、Skills 和未来 MCP 共享一个 command registry。每条注册项至少包含：

```text
commandId
summary
inputSchema
resultSchema
mutatesLibrary
supportsDryRun
supportsDetach
requiredCapabilities
```

CLI 解析 argv 后调用 command registry，不重新实现领域逻辑。现有 Renderer request schema 可以作为迁移输入，但不能继续让 Main 对话框路径选择与核心领域参数耦合；CLI 使用显式路径参数，Desktop 先通过对话框获得路径后调用同一领域命令。

## 候选命令形状（待最终确认）

竞品调研建议采用资源优先、唯一叶子动作：

```text
serpent --library <root> <resource> [subresource] <action> [options] [--] [targets...]
```

候选示例：

```text
serpent --library <root> asset import -- <source-files...>
serpent --library <root> asset remove [--delete-file] <asset-refs...>
serpent --library <root> tag assets add <tag-ref> <asset-refs...>
serpent --library <root> collection assets remove <collection-ref> <asset-refs...>
serpent --library <root> search <expression> [filters...]
```

固定语法约束候选：

- 顶层资源使用单数规范名。
- 最多一层关系子资源，最后一词是唯一动作。
- 全局 option 位于资源前，command option 位于位置参数前。
- 支持 `--` 分隔选项与可能以 `-` 开头的路径。
- Agent 文档与 schema 只使用完整 long option；是否提供人类短别名以后单独决定。
- flags 顺序不改变命令语义；实现必须先完整 parse、validate、plan，再执行。

## 删除语义（参数名待确认）

- 托管资产默认移入 Serpent 回收站。
- 链接资产默认只移除 Serpent 记录，保留源文件。
- 显式直接删除参数会让托管资产跳过 Serpent 回收站，并让链接资产删除实际源文件。
- CLI 不强制确认，不要求 `--yes`。
- 支持时可提供 `--dry-run`，但不把它设为执行前置条件。
- 冲突策略使用独立的 `--on-conflict fail|skip|keep-both|replace`，不使用含义不明确的 `--force`。

直接删除参数最终在 `--delete-file` 与 `--permanent` 中选择。

## 输出、退出码与日志（默认格式待确认）

已确认：

- 默认输出必须对人类可读。
- stdout 只输出命令结果，不混入日志、升级提示或诊断。
- stderr 输出诊断；失败返回非零退出码。
- 所有失败必须提供具体原因并写入持久日志，不能只返回“操作失败”。
- 错误至少包含稳定 `code`、人类可读 `message`，以及可用时的 `details` 和 `logId`。
- 批量操作逐项记录成功、跳过或失败；任一失败时顶层命令返回非零。

待确认：是否在默认人类输出之外保留可选 `--json`。无论结果输出选择如何，`serpent commands --json` 的机器可读命令自描述已确认进入第一版。

## 长任务

```text
# 前台等待并显示进度
serpent ... <long-command>

# 启动独立 job 进程并立即返回 job ID
serpent ... <long-command> --detach

serpent ... job show <job-id>
serpent ... job wait <job-id>
serpent ... job cancel <job-id>
serpent ... job retry <job-id>
```

- 前台 Ctrl+C 请求取消当前操作。
- detached 任务只能通过显式 job 命令取消，不随终端退出。
- job 状态、进度、错误原因和日志关联必须持久化。
- 导入、导出、缩略图/预览生成和 AI 分析复用同一任务机制。

## 第一版能力矩阵（待最终确认）

### 计划包含

- 资源库：创建、打开验证、检查、导入、导出。
- 文件夹：托管/链接创建、列出、重命名、刷新、重新定位。
- 资产：导入、列出、查看、移动、重命名、重新定位、删除、恢复、永久清理、外部变化刷新。
- 资产信息：Label、描述、评分、喜欢、源链接、人工色卡。
- 标签：CRUD、分配与移除。
- 合集：树 CRUD、成员添加/移除/排序；智能合集 CRUD 与执行。
- 搜索：关键词、字段搜索、过滤、排序、分页。
- 媒体：请求或重试缩略图、封面、联系表和代理生成；查询产物与失败原因。
- AI：配置状态、Key 写入/删除、连接测试、分析、范围清理、队列控制。
- 回收站：查看、恢复、永久删除、自动清理触发。
- job：列出、查看、等待、暂停、继续、取消、重试。
- 诊断：版本、环境、资源库健康检查、日志位置及命令自描述。

### 计划排除

- 窗口、面板、选中项、弹窗预览、全屏切换等纯 GUI 状态。
- 读取 GUI 当前上下文作为命令默认值。
- 浏览器扩展当前 folder/tag/collection 上下文同步 UI。
- 任意 SQL、任意脚本求值、任意资源库外文件写入。
- Agent 权限策略、自然语言意图理解和批准 UI；这些属于 CLI 调用方。
- MCP 服务器本身；MCP 是后续对同一 registry 的薄适配。

## 测试接缝

- CLI argv parser：全局参数、资源/子资源/动作、`--` 路径分隔、未知参数、重复参数和帮助。
- 精确引用：ID、资源库路径、零匹配、冲突、不允许名称猜测。
- 显式资源库：缺失、路径不存在、ID 不可定位、schema 不兼容。
- 同一领域命令分别从 Desktop 与 CLI 调用，结果和错误原因一致。
- 桌面关闭时 CLI 创建/打开/导入/搜索/修改/导出完整主线。
- 桌面与 CLI 并发读；两个 CLI 竞争写租约；锁超时；持锁进程崩溃后的租约恢复。
- CLI 修改后桌面通过变更序号和文件监控刷新；重复事件幂等。
- schema 迁移期间第二写者等待或得到 `LIBRARY_BUSY`，不能观察半迁移数据库。
- detached job 在父终端退出后继续；两个进程不能重复领取；cancel/retry 状态正确。
- 人类输出快照；stdout/stderr 分层；退出码；详细日志；批量部分失败。
- 删除默认语义、直接删除参数、linked 源文件失败不丢数据库记录。
- Windows 与 macOS 的可执行文件打包、路径引用、空格/Unicode/长路径和 Ctrl+C。
- `commands --json` schema 稳定性与 completion 生成。

## 完成标准

- 第一版能力矩阵中所有包含项都有可执行 CLI 命令、帮助和测试，且不存在仅 GUI 可达的非纯 GUI 领域功能。
- CLI 在桌面未启动时可独立工作；桌面和 CLI 同时运行时不出现数据库损坏、重复任务或文件/数据库状态分裂。
- CLI 与 Desktop 对同一命令共享实现、Zod schema、错误原因和日志链。
- 精确引用只接受 ID 或唯一资源库路径，过滤和搜索不冒充精确引用。
- 所有失败都有具体安全原因，持久日志保留可诊断 cause；stdout 不被日志污染。
- macOS 与 Windows 安装产物都包含可直接运行的 `serpent`；独立 CLI 包与桌面内置 CLI 版本一致。
- 自动化、双轴审查、macOS/Windows CLI 冒烟、开发日志和 QA 报告全部通过。

## 仍需用户确认

1. 资源优先的规范命令形状，以及关系操作使用 `add/remove` 还是 `assign/unassign`。
2. 各资源类型命名空间内的位置参数是否自动识别 ID 与资源库路径。
3. `--library` 是否只接受资源库根目录。
4. 直接删除参数使用 `--delete-file` 还是 `--permanent`。
5. 默认人类输出之外是否保留 `--json`。
6. 顶层 `search` 与 `asset list` 过滤的分工。
7. 第一版能力矩阵边界。
