# ADR-0032：由 Library Worker 持有统一操作历史

- 状态：已采纳；第一阶段实现与验证中，完整验收见开发日志和 QA 报告
- 日期：2026-08-12
- 关联：ADR-0025（Automation Gateway）、ADR-0031（无状态 MCP）

## 一句话解释

Desktop、脚本、MCP 与插件产生的可撤回修改统一写入资源库数据库中的操作历史；Library Worker 负责原子记录、校验和执行撤回/重做，Main 只协调用户意图、窗口投影和快捷键，任何 transport 都不再维护自己的撤回实现。

## 背景

当前代码包含三种相近但语义不同的机制：

1. Renderer 用单个 `lastUndoableOp` 暂存最近一次 move/copy/trash，切库或下一次操作后即丢失，也没有 redo。
2. 自动化执行日志在应用 userData 的 `automation-executions.json` 中保存 `Undo Group`，并由 Main 的硬编码分支解释恢复引用；它不是资源库事务的一部分。
3. Worker 的 `file_operations` 记录文件操作的准备、应用、提交与崩溃恢复；其中个别操作通过修改 `error_code` 表示已经撤回，但它不是通用用户历史。

三者继续分别扩展会产生声明与执行不一致、跨入口行为不同、无法原子提交以及 Windows 文件语义遗漏。脚本已有的 Undo Group 概念值得保留，但其持久化位置和执行权不应保留在自动化专用日志中。

## 决定

### 1. 一个领域能力面，一套历史

所有可见修改最终经过同一领域命令执行链。Main 为命令附加不可伪造的 `HistoryContext`（来源、HistoryEntry ID、显示标签和调用关联），Worker 在领域修改成功时生成 `HistoryEntry` / `HistoryStep`。`HistoryEntry` 是原 Undo Group 的持久化名称，也是用户看到的一次撤回/重做边界；Desktop、脚本、MCP 与插件获得的只是同一历史条目的不同投影。

自动化命令描述符不再以 `supportsUndo: boolean` 作为充分声明，而改为显式历史策略：

- `reversible`：必须同时注册 forward、inverse、前置条件和展示摘要；
- `barrier`：修改不可撤回，并清除 redo 分支、使受影响的旧条目失效；
- `none`：只读或可再生成副作用，不进入业务历史。

启动期/测试期必须验证每个 `reversible` 命令都有 Worker handler，不能出现“目录宣称可撤回、执行器却不认识”的状态。

### 2. Worker 是权威，Main 是协调器

资源库数据库新增有界、版本化的操作历史表。Worker 是历史状态、逆向配方、实体前置条件和文件系统恢复信息的唯一所有者。Main 的 `UndoCoordinator` 负责：

- 为一次桌面动作、脚本执行或插件命令调用建立用户意图组；
- 将当前库的 `canUndo` / `canRedo`、动态标签和状态变化投影到窗口；
- 把菜单、toast、脚本 API 与 MCP 命令路由到同一个 `history.undo` / `history.redo`；
- 不读取或解释逆向 payload，不直接执行文件恢复。

Renderer 只持有公开的 `historyEntryId` 和展示状态，不持有磁盘路径、SQL、操作 manifest 或可伪造的恢复引用。

### 3. 用户历史与恢复日志分离

`file_operations` 继续表示单次文件系统转换及其崩溃恢复状态。forward、undo 和 redo 每次文件转换都写独立的 `file_operations` 记录，并通过内部字段关联同一个 HistoryStep；不再用 `error_code = UNDONE` 充当用户历史状态。

`HistoryEntry.state` 的稳定状态为 `applied | undone | stale`，转换中还会短暂进入 `undoing | redoing`。每次转换写入可恢复的 HistoryAttempt，记录 step 进度和关联的 `file_operations`；Worker 重启后必须先把 attempt 收口到稳定状态。Rollback 表示一次尚未提交的命令失败后回到原状态；Crash Recovery 表示重启后收口中断的技术阶段；Restore 表示从 Serpent 回收站恢复资产。三者都不等于 Undo。

### 4. Redo 不是重新调用原始 transport

Redo 由 Worker 执行提交时保存的、版本化的 forward recipe，并验证撤回后状态仍满足前置条件。不得把原始 MCP/脚本参数重新送回 transport，也不得重新弹权限或依赖已消失的 session。

文件命令的前置条件至少包含稳定实体 ID、当前路径身份、修订/内容指纹和目标占用状态；数据库命令使用实体版本或受影响关系集合。无关修改不应仅因资源库全局 `changeSequence` 增长而使历史失效。

### 5. 线性、每库、跨重启但不盲目信任

撤回/重做是每个资源库独立的线性历史。撤回后执行新的修改会截断 redo 分支。只有栈顶条目可转换，调用必须携带预期栈顶 ID，防止 Agent 或延迟 toast 撤回错误操作。

历史记录持久写入资源库，并在应用完整退出、Desktop 重启或原发起脚本/MCP 已消失后仍属于该资源库。Worker 重开资源库时先收口未完成 attempt，再按恢复材料和实体前置条件重建可操作栈；只有重新验证通过的顶部条目才向 UI 暴露为可点击的 Undo/Redo。跨重启保留不等于盲目重放，外部文件变化会使条目变为 stale。

### 6. 用户意图分组

- Desktop：一次明确动作形成一个 History Group；一个动作内部可包含多个 Worker step。
- 脚本：一次 execution 懒创建一个 History Group，所有已提交、可逆的 mutation 按顺序加入；读取不加入。脚本失败但已提交部分全部可逆时，仍可整组反向补偿；只要包含已提交的 barrier，整组不得宣称可完整撤回。
- MCP：保持业务无状态；每个 mutation 默认形成独立组。批量命令自身是一个组，不增加“当前撤回 session”。
- 插件：一次 Host command invocation 默认一个组；插件不能自行提交 inverse payload。

组是展示和补偿边界，不伪装成跨多个独立 SQLite 事务的 ACID 事务。部分成功必须显式记录，只有实际 committed 的可逆 step 进入组；撤回按 step 逆序执行，重做按正序执行。转换前先预检全组，转换中用 HistoryAttempt 记录进度，防止中途失败后重复执行已完成 step。

### 7. 快捷键与文本编辑互不抢占

`Cmd/Ctrl+Z` 与 redo 快捷键在输入框、文本域或 contenteditable 获得焦点时优先使用编辑器原生历史；只有非文本编辑上下文才调用资源库操作历史。macOS 顶部菜单和 Windows 应用内菜单使用同一状态投影，不能让自定义业务 accelerator 永久抢走文本撤销。

### 8. 不可逆操作是显式 barrier

从磁盘永久删除资产/文件夹/资源库、删除链接源文件等操作仍需现有危险确认，并明确标记为不可撤回。它们提交后清除 redo 分支，并按受影响实体使旧历史条目变为 stale；不得因为存在 Undo 框架而暗示可以恢复。

## 为什么不选择其他方案

### 扩展 Renderer 的 `lastUndoableOp`

它无法覆盖脚本/MCP、无法跨窗口或进程协调、不能与数据库提交保持一致，也会让 `App.tsx` 继续承担领域状态。

### 扩展 Main 的 `automation-executions.json`

该文件适合脚本执行审计和本机授权，不是资源库领域数据；它不能与 Worker 的 SQLite/文件提交原子写入，也会让 Desktop 和 MCP 依赖脚本生命周期。

### 直接把 `file_operations` 当成 Undo 栈

恢复日志描述“单次文件阶段如何收口”，而用户历史描述“一个用户意图如何反向/正向重放”。合集、智能合集、标签和元数据没有文件操作；同一历史 step 的 undo/redo 又会产生新的文件转换。合并两种状态机会造成清理、失败和展示语义冲突。

### 为每类实体维护独立撤回栈

用户操作经常同时修改文件、文件夹和组织关系。按实体拆栈无法保持真实时间顺序，也无法让脚本的一次意图形成单一撤回边界。

## 影响

### 正向影响

- 所有入口行为一致；自动化变更会立即反映到 Desktop 的菜单和提示。
- history receipt 与领域写入处于同一 Worker 边界，声明、执行和恢复可校验。
- 新增可撤回命令时有明确协议、handler 和测试门禁。
- Windows 文件差异被集中在 Worker 文件 recipe 中，而不是散落在 UI/脚本恢复器。

### 成本与限制

- 需要数据库迁移、统一 dispatcher、历史状态机和大量操作矩阵测试。
- 文件复制、导入和内容替换的 redo 需要额外保留策略或严格源状态前置条件；首批不得用“重新执行大概相同的操作”冒充 redo。
- 跨重启条目只有在恢复材料与前置条件重新验证通过后才可操作；第一阶段不提供任意历史跳转或分支时间线。

## 实施约束

- 迁移时保留 `AutomationExecutionJournal` 的执行、授权和审计职责，但移除其对逆向执行的所有权；旧 Undo Group 只迁移为历史引用投影。
- 任何 history payload 必须版本化、Zod 校验、限制大小且不跨 IPC 暴露绝对路径。
- 每类 reversible command 必须有 forward→undo→redo→undo 循环测试、stale/conflict 测试和完整退出边界测试。
- 文件操作必须覆盖 macOS 与 Windows 的大小写路径、占用句柄、同名冲突、跨卷限制、Unicode 和长路径；没有 Windows runner 时只能标记未验证。
