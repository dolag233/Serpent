# Serpent 统一撤回/重做框架研究

> 调研日期：2026-08-12  
> 调研基线：`dev` 工作树，`HEAD 861134e`。工作树原本存在其他 agent 的未提交改动；本文按当前可见代码记录事实，但没有修改这些改动。  
> 范围：Desktop、脚本、MCP/headless 共用的领域撤回/重做；资产文件、文件夹、合集、智能合集等基础操作。  
> 来源约束：仓库源码与测试，以及 Electron、SQLite、Microsoft 的一手官方资料。

## 结论

Serpent 不应把现有 `AutomationExecutionJournal` 或 Worker 的 `file_operations` 直接升级为“全局撤回栈”。二者分别解决自动化执行审计和跨数据库/文件系统的崩溃恢复，生命周期、所有权与状态机都不同于用户可见的 undo/redo。

推荐新增一套**资源库级、Worker 所有、调用来源无关的领域操作历史**：

- Desktop、脚本、MCP/headless 的所有可撤回写命令都写入同一份资源库历史。
- 一个用户意图对应一个历史组；组内保存类型化的正向/反向描述、前置条件与实际成功子集。
- 元数据类操作在同一个 SQLite 写事务中同时提交领域变更和历史记录。
- 文件类操作继续由 `file_operations` 保证每次 apply/undo/redo 尝试的崩溃恢复；领域历史只引用这些持久操作，不冒充文件恢复日志。
- undo 成功后产生可 redo 状态；redo 必须使用类型化正向描述和新的状态前置条件，不能简单重放旧 IPC 请求。
- Renderer 不再保存唯一的 `lastUndoableOp`；Main 只负责菜单、焦点仲裁、权限与跨进程编排，Worker 才是历史事实来源。
- `Command Registry` 从 `supportsUndo: boolean` 升级为类型化历史策略；现有 automation undo group 可迁移为同一历史组的来源适配层，但不继续拥有独立撤回状态。

## 术语边界

| 术语 | 本文定义 | 触发时机 | 是否是用户历史 |
|---|---|---|---|
| Undo / 撤回 | 在原操作已经成功提交后，按领域语义执行反向操作 | 用户或获授权客户端主动请求 | 是 |
| Redo / 重做 | 成功撤回后，在当前前置条件仍成立时重新应用该意图 | 用户或获授权客户端主动请求 | 是 |
| Rollback / 回滚 | 当前尝试尚未成功提交时，消除本次尝试产生的部分副作用 | 错误、取消、事务失败 | 否 |
| Crash recovery / 崩溃恢复 | 进程重启后识别未完成的技术操作，并继续、回滚或标记失败 | 启动/重新打开资源库 | 否 |
| Restore / 恢复 | 把回收站实体或 tombstone 恢复到有效位置的领域命令 | 用户显式恢复，或 trash 的反向策略 | 可能是 undo 的实现，但本身不等于 undo |
| Compensation / 补偿 | 无法真正回到旧物理状态时，用新的领域写入抵消已提交结果 | 分布式/外部副作用、过期历史 | 只有产品明确承诺时才可作为 undo 策略 |

这几个概念必须在类型、日志、错误码和文案中分开。SQLite `ROLLBACK`、`file_operations.status='rolled_back'`、回收站 Restore、脚本 Undo Group 不能继续被笼统称为“撤销”。

## 当前实现事实

### 1. Desktop 只有一个易失的“最后文件操作”槽位

- Renderer 的 `UndoableFileOp` 只覆盖 move、copy、trash；move/copy 保存 `operationId`，trash 只保存 `assetIds`（`src/renderer/use-asset-drag-drop-handlers.ts:16-24`）。
- `App` 只维护一个 `lastUndoableOp`，不是栈，也不持久化（`src/renderer/App.tsx:1091-1097`）。新的 move/copy 会覆盖旧值；切换/关闭资源库会清空它（`src/renderer/App.tsx:5523-5526`、`5662-5677`）。
- Desktop 的撤回分派只处理这三类操作，完成后直接清空槽位，因此没有连续撤回或 redo（`src/renderer/App.tsx:5721-5809`）。
- trash 的 Desktop 撤回走普通 Restore 对话路径，而 automation trash undo 走“仅原位置空闲才恢复”的保守路径，两者已经产生语义分叉（`src/renderer/App.tsx:5798-5803`；`src/worker/library-service.ts:21241-21273`）。
- 从硬盘删除会无条件清空此前唯一的 undo 槽位（`src/renderer/useBatchActions.ts:249-260`）；它没有基于受影响实体选择性失效。
- 当前工作树中的应用菜单已使用自定义 `edit.undo` / `edit.redo` 命令和平台快捷键；redo 明确恒禁用（`src/main/application-menu.ts:33-47`；`src/renderer/main-menu-items.ts:137-153`）。这是正确的菜单接入方向，但还不是统一历史。

### 2. 脚本正文没有 undo API；Console 宿主有一次性恢复入口

- Guest API 是按领域命令投影的不可变 API，仅提供 `forLibrary()` 与命令命名空间，没有 `undo()`（`src/scripting/serpent-guest-api.ts:6-30`）。
- `undo()` 属于 Renderer/Console 的宿主控制 API，而非脚本正文 API（`src/shared/automation-script-api.ts:225-253`；`docs/manual/scripts/api-reference.md:345-367`）。
- 因此“脚本支持撤回”的准确含义是：脚本命令成功后，Main 可能给 Console 返回一个 opaque `undoGroupId`，由 Console 代表用户请求一次恢复；脚本本身不能任意回滚历史。

### 3. Automation Undo Group 是 Main-owned 的一次性恢复票据

- `AutomationUndoGroup` 保存在 Main 的 execution journal 快照中。Item 只有自由字符串 `kind`、`reference` 和布尔 `reversible`；Group 有 `open/succeeded/partially-succeeded/failed/cancelled/interrupted` 状态和单一 `undoable` 布尔值（`src/main/automation-execution-journal.ts:209-248`）。
- 该 journal 是 app userData 下的 `automation-executions.json`，不是资源库数据（`src/main/index.ts:4557-4562`）；默认执行历史上限为 500，且职责包含执行状态、授权和取消控制（`src/main/automation-execution-journal.ts:447-487`）。它无法成为独立 headless 客户端之间共享的资源库历史。
- 一个 Group 只有在状态为 `succeeded`、至少有一个 Item、且全部 Item 可逆时才变为 undoable；`partially-succeeded` 一律不可撤回（`src/main/automation-execution-journal.ts:869-900`）。这与“部分成功后撤回实际成功子集”的产品目标不一致。
- `consumeUndoGroup()` 只把 `undoable` 改为 false 并写入“already been applied”，没有 `undone` 状态、正向描述或 redo 能力（`src/main/automation-execution-journal.ts:908-921`）。
- 重启时，尚未完成的 Group 被标成 `interrupted` 且永久不可撤回；已完成 Group 可以从 JSON 恢复（`src/main/automation-execution-journal.ts:1046-1076`；`tests/unit/automation-execution-journal.test.ts:96-177`）。
- 撤回还绑定原 execution 与 Renderer sender 所有权；它不是“当前资源库顶部历史”的通用操作（`src/main/automation-script-ipc.ts:416-450`）。

### 4. Registry 的 `supportsUndo` 只是声明，不足以描述反向和重做策略

- Registry descriptor 只有一个 `supportsUndo: boolean`，没有反向命令类型、redo 策略、历史标签、保留策略或过期前置条件（`src/automation/command-registry.ts:1518-1547`）。
- 当前只有 `asset.trash`、`asset.move`、`asset.copy` 声明 `supportsUndo: true`（`src/automation/command-registry.ts:1973-1992`、`2195-2214`、`2557-2563`）；资产元数据/评分/重命名、文件夹、标签、合集、智能合集写操作均为 false（例如 `src/automation/command-registry.ts:1910-1927`、`2397-2458`、`2880-3104`）。
- Gateway 对每一个 `supportsUndo` 命令单独创建 Group。成功结果必须暴露字符串 `operationId`，否则 Group 被记为 partial 且不可撤回（`src/automation/command-gateway.ts:859-901`）。因此现有实现并没有把一次脚本运行中的多个领域命令组合为一个 undo group。
- Gateway 只从返回对象里猜测 `operationId`，再把 descriptor command ID 写入自由字符串 `kind`；它没有编译期保证该引用能被反向执行（`src/automation/command-gateway.ts:881-895`）。
- 这已经形成实际漂移：Registry 把 `asset.copy` 标成可撤回，Worker 和 Desktop 也有 copy undo，但 Automation recovery handler 只分派 `asset.move` 与 `asset.trash`，对 copy 会抛出 unsupported（`src/main/index.ts:5845-5877`）。

### 5. Automation Group 的组合恢复不是原子的

- Main 以逆序逐个恢复 Item，这个顺序本身是可复用的（`src/main/index.ts:5849-5864`）。
- 但如果前面的 Item 已成功恢复、后面的 Item 失败，函数直接抛错；调用方不会 consume Group，已经恢复的 Item 也没有单独状态（`src/main/index.ts:5849-5877`；`src/main/automation-script-ipc.ts:444-457`）。再次点击可能重复恢复已处理 Item。
- 当前 Gateway 通常每命令只创建一个 Item，所以风险暂时被掩盖；一旦按原设计把多个命令组合到同一 Group，这会变成数据一致性问题。

### 6. Worker `file_operations` 是技术恢复日志，其中只有少数种类兼作一次性 undo 依据

- `file_operations` 保存 `operation_id/kind/status/manifest_json/error_code/timestamps`；状态只有 `preparing/applying/committed/rolled_back/failed`（`src/worker/library-service.ts:805-815`）。它没有 `undone/redoable/invalidated` 等领域历史状态。
- managed move/copy manifest 已经保存正反向文件位置、冲突持有区和 `originalOperationId`，是重要的可复用基础（`src/worker/library-service.ts:2512-2551`）。
- 资源库打开时会扫描日志。未完成操作按 manifest 类型恢复；已提交的原始 move/copy 会被特意保留，直到一次 undo 消费（`src/worker/library-service.ts:5494-5584`）。源码也明确称其为 “one-shot undo”（`src/worker/library-service.ts:5521-5527`）。
- move undo 会重新验证资产仍在原操作的目标位置、文件仍存在、冲突备份仍存在；然后创建一个新的 `managed-move-undo` 技术操作（`src/worker/library-service.ts:18810-18882`）。成功后原操作被标成 `UNDONE`，原操作与 undo 操作目录均删除（`src/worker/library-service.ts:18591-18609`），因此现有数据不足以 redo。
- copy undo 验证新资产仍位于预期路径后直接从磁盘和数据库删除副本，把原操作标成 `UNDONE` 并删除操作目录（`src/worker/library-service.ts:19004-19069`）。它同样是一次性消费，不产生 redo 描述。
- trash 返回稳定 `operationId`，并在 SQLite 事务中写一条 committed `trash` 记录（`src/worker/library-service.ts:20636-20701`）。但文件先被逐个 rename，再开始记录该事务；异常处理只是 best-effort 把已移动文件改回去（`src/worker/library-service.ts:20608-20634`、`20702-20716`）。不能把它视为与 managed move/copy 相同强度的多阶段 crash journal。
- trash undo 根据 manifest 找出资产，再调用严格的 `restoreAssetsIfOriginalVacant`；只有全部恢复时才把原 trash operation 改成 `rolled_back`（`src/worker/library-service.ts:21204-21254`）。这属于 restore 实现被复用于 undo，不代表 Restore 与 Undo 是同一概念。

### 7. SQLite 事务、写租约和变更序号可复用，但事务不能覆盖文件系统

- 本机资源库连接启用 WAL、`synchronous=FULL`、foreign keys 和 busy timeout（`src/worker/library-service.ts:3425-3465`）。
- metadata-only 命令已有统一的跨进程写租约 + `BEGIN IMMEDIATE` 事务边界；注释明确禁止把文件/网络/媒体工作塞进该 helper（`src/worker/library-service.ts:5778-5807`）。
- collections、collection memberships、smart collections、file_operations 等写入都有 trigger 推进持久 `library_change_sequence`（`src/worker/library-service.ts:1830-1880`）。这适合做跨客户端刷新与粗粒度计划过期信号。
- 只有 `asset_metadata` 已有 `entity_version`；managed folders、collections 和 smart collections schema 没有同等实体版本（`src/worker/library-service.ts:959-998`）。仅凭库级 change sequence 会把无关写入也视作冲突，无法精确判断一条旧历史是否仍可安全撤回。

## 能力缺口

1. **没有统一事实来源**：Desktop 单槽位、Main automation JSON、Worker file journal 分属三处；MCP/headless 不能可靠看到 Desktop 历史，Desktop 也看不到其他客户端的完整历史。
2. **没有 redo 状态与数据**：现有 Desktop 和 automation 都只消费一次；move/copy undo 还会删除支持材料。
3. **覆盖面过窄**：文件夹、合集、合集成员、智能合集、标签、评分、元数据、重命名等基础操作没有统一反向策略。
4. **`supportsUndo` 可声明但不可执行**：copy 已证明 bool 与 recovery handler 会漂移。
5. **分组语义未落地**：Gateway 每条命令建一组；脚本一次运行无法成为一个用户意图。
6. **部分成功模型不成立**：automation partial group 被整体禁用；组合恢复中途失败又没有 item-level 进度。
7. **冲突检测不完整**：多数组织实体没有 entity version；自由字符串引用不能表达路径指纹、当前父级、排序版本或成员集合。
8. **永久删除与普通写入的失效规则过粗**：Desktop 直接清空唯一历史；统一系统需要明确哪些条目因数据被销毁而失效。
9. **恢复材料没有统一保留/清理契约**：redo 需要知道何时可以清理 backup、trash、operation directory 和历史 payload。
10. **菜单与文本编辑焦点未统一仲裁**：业务撤回不能抢走输入框的文字编辑撤回，原生 role 又不能执行领域历史。
11. **Windows 真实行为证据不足**：现有源码已经承认 open handle、delete-pending、EPERM/EBUSY 与异步关闭差异（`src/worker/library-service.ts:3109-3142`、`26978-26992`），但统一 undo/redo 还没有 Windows rename/delete/目录树测试矩阵。

## 可复用部分

### 可以直接保留为基础设施

- Library Worker 作为 SQLite 与资源库文件的唯一进程内所有者。
- 资源库写租约、Job lease/fencing、`BEGIN IMMEDIATE` bounded write 和 `library_change_sequence`。
- managed move/copy 的类型化 manifest、冲突持有区、启动恢复与 failpoint 测试框架。
- trash tombstone、原位置恢复规则和 Restore 的冲突检测函数。
- Registry 作为所有入口共享的命令目录，以及 Gateway 的 schema、权限、计划、审计与来源解析。
- opaque Group ID、按用户意图分组、逆序执行、Main/Renderer 不接触绝对路径等 automation undo group 原则。
- 自定义 `edit.undo` / `edit.redo` 菜单命令、动态 enabled 状态和跨平台 accelerator。

### 可以迁移但不能原样保留

- `supportsUndo` 应迁移成类型化 `historyPolicy`，例如：
  - `none`
  - `transactional-snapshot`
  - `recoverable-file-operation`
  - `trash-restore`
  - `compensating`（默认禁止，需单独产品决定）
- Automation `undoGroupId` 可以继续作为公开 opaque ID，但应指向资源库历史组，而不是 Main JSON 中的第二份事实。
- `file_operations.operation_id` 可以作为一次 apply attempt 的恢复引用，但一个历史 Item 必须能关联 original/undo/redo 多次 attempt，不能把原始 operation row 本身当历史 Item。
- `library_change_sequence` 可作为快速失效筛选；真正执行前仍需实体版本、路径身份、内容 revision 或成员集合前置条件。

## 明确不应复用的概念

- **不把 `AutomationExecutionJournal` 当全局 history store**：它位于 app userData、绑定 execution/session/sender、受 500 条执行历史限制，并混合授权审计职责。
- **不把 `file_operations` 当用户历史表**：它是技术恢复日志，状态机与保留策略服务于 crash recovery；很多 committed 记录会清理，很多领域写也不会产生该记录。
- **不把 SQLite transaction rollback 当 Undo**：事务回滚只说明本次数据库提交未发生，不能恢复已经提交后的用户意图，更不能覆盖文件系统。
- **不把 Restore 当 Undo 的同义词**：用户可以独立 Restore；trash undo 只是以严格 Restore 作为一个 inverse strategy。
- **不把 Revision 当版本恢复快照**：产品模型明确指出旧 Revision 不保证仍有旧文件字节（`docs/internal/domain-model.md:196-202`；`docs/product-brief.md:267-273`）。
- **不以重新执行旧请求实现 Redo**：源文件、目标路径、成员集合、实体版本和权限都可能变化；Redo 必须有自己的前置条件和类型化正向描述。
- **不使用 Electron `role: 'undo'/'redo'` 承载业务历史**：role 会接管行为，设置 role 后自定义 `click` 被忽略；它适合原生文本编辑，不知道 Serpent 的资源库、权限、冲突或 Worker 状态。
- **不让 transport 拥有独立栈**：脚本、MCP、Desktop 只能投影和请求同一个资源库历史，不能各自再实现撤回。
- **不承诺不可恢复操作可撤回**：从硬盘永久删除、外部链接源被其他软件覆盖、AI/派生物生成等要么不可逆，要么应重新生成，不应伪装成历史项。

## 推荐设计约束

### 1. 历史归属与进程边界

- Canonical history 按 `library_id` 持久化在资源库 SQLite 中，由 Library Worker 读写。
- Main 提供 `history.undo`、`history.redo`、`history.peek/list` 的编排与 UI/权限适配；Renderer、脚本和 MCP 不接触数据库、manifest 或绝对路径。
- 所有来源共用一条每库线性历史。调用来源、session、execution、plugin 和 causation 作为审计字段，不作为历史所有权；用户可以在 Desktop 撤回 agent 刚完成的操作。
- 历史在进程重启后保留；是否仍可撤回取决于保留材料和执行时前置条件，不取决于原发起进程是否仍存在。

### 2. 领域历史与技术尝试分层

建议概念模型：

```text
HistoryGroup                         # 一个用户意图
  group_id, library_id
  label_key + bounded label_args
  source, execution_id?, actor_ref?
  state: applied | undoing | undone | redoing | invalidated | failed
  cursor/order, created_at, updated_at
  items[]

HistoryItem                          # 一个可逆领域结果
  item_id, group_id, ordinal
  command_id
  strategy
  forward_descriptor                # 类型化、版本化、无任意路径
  inverse_descriptor                # 类型化、版本化、无任意路径
  preconditions                     # entity version/revision/path identity/membership
  result_scope                      # 实际成功的实体 ID；不含 skipped 项
  retention_refs[]                  # 可选，指向 file_operations/backup/tombstone

HistoryAttempt                       # 每次 apply/undo/redo 的执行记录
  attempt_id, item_id, direction
  file_operation_id?, status, error_code
  started_at, finished_at
```

- 表名与字段名可在 ADR/实现规格中调整；核心是不把 HistoryItem 和 file operation attempt 合并。
- schema/payload 必须版本化、Zod 校验、有大小上限、禁止秘密与未经脱敏的外部绝对路径。
- 历史 UI 文案保存稳定 `label_key` 与有限参数，不保存预渲染中文/英文字符串。

### 3. 状态机与线性 redo 分支

```text
apply committed -> applied
applied --undo--> undoing --success--> undone
undone  --redo--> redoing --success--> applied
undoing/redoing --crash--> Worker recovery -> previous stable state or retryable failed state
applied/undone --precondition destroyed--> invalidated
```

- 只有顶部且前置条件成立的 Group 可 undo/redo；新成功写入发生在 `undone` 状态之后时，截断 redo 分支。
- 不可撤回写入不应默认清空全部历史；只失效它实际破坏的条目。永久删除若销毁某实体的所有恢复材料，应成为明确的 history barrier，并记录失效原因。
- undo/redo 失败不得先移动 cursor。组合组必须记录 Item/Attempt 进度；崩溃恢复完成后，Group 才进入稳定状态。
- Group 内按正向顺序 apply、反向顺序 undo。部分成功时只把实际 committed 的可逆子集纳入 Group；`skipped`/失败项保留在结果摘要，不阻止成功子集整体撤回。

### 4. Registry 契约

`supportsUndo: boolean` 应被类型化策略替代，并在构建/测试时保证完整：

```ts
historyPolicy:
  | { strategy: 'none'; reason: string }
  | {
      strategy: 'transactional-snapshot' | 'recoverable-file-operation' | 'trash-restore';
      labelKey: string;
      buildHistoryItem(result, input, beforeState): HistoryItemDraft;
      undoCommand: HistoryCommandId;
      redoCommand: HistoryCommandId;
      retentionClass: 'metadata' | 'file-backup' | 'trash';
    }
```

- Registry 声明为可 undo/redo 时，必须同时存在反向/正向 executor、输入/结果 schema、权限、错误映射和契约测试；禁止 copy 这种“声明可撤回但 Automation handler 不支持”的漂移。
- Desktop、script、MCP 不各自写 recovery `switch`；它们都调用统一 History Coordinator。
- Guest script 不必获得任意 `undo(groupId)` 能力；Console/MCP Host 可以公开受权限控制的 `history.undo/redo`。脚本执行期间产生的写操作仍自动进入同一历史。

### 5. 各类基础操作的建议策略

| 操作类别 | 建议策略 | 关键快照/前置条件 | 明确限制 |
|---|---|---|---|
| 资产评分、喜欢、描述、作者、源链接、人工标签 | transactional snapshot | 旧值、新值、asset/entity version | 与写入同事务记录；AI 派生字段不进入人工 history |
| 合集创建/更新/排序 | transactional snapshot | 行的前后值、父级、位置、cover、entity version | 重排应保存受影响范围，不只保存单项 position |
| 合集成员 add/remove/reorder | transactional snapshot | 实际新增/移除成员和顺序版本 | 只撤回本次实际变化，不移除调用前已存在的成员 |
| 智能合集 create/update/delete/reorder | transactional snapshot | query JSON、名称、位置、entity version | 不保存匹配资产副本；redo 重新执行保存的查询定义写入，不冻结结果集 |
| 文件夹 create | inverse delete-empty | folder ID、父级、名称、路径 identity | 若之后已有内容则 stale，不能递归强删 |
| 文件夹 rename/move | recoverable file operation | folder ID、子树路径 identity、父级、目标占用情况 | 必须关闭 Serpent 自有文件句柄；Windows sharing violation 可重试但不能静默跳过 |
| 文件夹移入 Serpent 回收站/恢复 | tombstone + recoverable file operation | tombstone、子树身份、实际成功资产 | 与“从硬盘删除”分离；永久删除不可撤回 |
| 资产 move/rename | recoverable file operation | asset ID、revision、源/目标路径 identity、冲突备份 | 每次 undo/redo 都创建新的可恢复 attempt；不能消费后删除 redo 必需材料 |
| 资产 copy | inverse delete-created-set + redo copy descriptor | 新 asset IDs、源 revision/fingerprint、目标路径 | redo 时源变化则 stale；不能复制“当前任意新内容”冒充原重做 |
| 资产 trash/restore | trash-restore | operation/tombstone、原路径、目标空闲 | 普通 Restore 是新操作；Undo Trash 默认严格恢复，不自动 keep-both |
| 导入 | 分阶段决定 | 实际创建的 asset IDs、源 fingerprint、复制结果 | undo 可移除本次创建项；redo 若依赖外部源必须重新验证源，不能承诺长期可用 |
| 内容替换 | 默认 none，直到保留旧字节 | previous/new revision + durable old bytes | 仅有 Revision 行不足以恢复内容 |
| 从硬盘永久删除、外部源删除 | none / history barrier | 受影响实体与失效原因 | 不提供假撤回 |
| 缩略图、预览、代理、AI 分析 | none | — | 属于可再生成派生物或后台任务，不进入用户编辑历史 |

### 6. 并发、过期与权限

- 每次 undo/redo 都重新取得资源库写租约，并在 Worker 内验证 Item 的前置条件；不能因为 Group 曾经可撤回就跳过当前校验。
- 给 folder、collection、smart collection 与成员排序补充实体/集合版本。库级 change sequence 只做快速检测和 UI 刷新，不能作为唯一冲突判断。
- 过期返回稳定原因，例如 `ENTITY_CHANGED`、`PATH_OCCUPIED`、`SOURCE_MISSING`、`CONTENT_CHANGED`、`RETENTION_EXPIRED`、`HISTORY_NOT_AT_CURSOR`，默认不强制覆盖。
- undo/redo 仍是写操作，必须经过同一 Gateway 权限和危险操作策略；但不能要求原 execution/session 仍存活。权限检查针对“现在要产生的反向副作用”。
- MCP/headless 只使用 group ID、library ID 或“当前顶部”语义；绝对路径、backup 目录和 Worker manifest 不越过边界。

### 7. 保留与清理

- 历史条数/时间上限按资源库配置；metadata snapshot 可长期保留，file backup/trash 受磁盘配额和回收站保留期约束。
- 清理前从 HistoryItem 的 retention refs 计算引用；仍在 undo/redo 分支上的唯一恢复材料不得被通用 file-operation cleanup 删除。
- 材料过期时把 Group 标成 `invalidated` 并保留可理解原因，而不是静默从菜单消失。
- 导出资源库时是否包含 history 及其恢复材料必须显式决定；若导出排除材料，对应历史应在导出副本内标为不可执行，不能留下悬空引用。

## Electron 菜单结论

Electron 官方把 `undo` / `redo` 列为标准 Edit roles，并建议标准编辑行为使用 role；role 会提供平台默认 label/accelerator。但 `MenuItem` 一旦设置 `role`，自定义 `click` 会被忽略。[Electron MenuItem 官方文档](https://www.electronjs.org/docs/latest/api/menu-item)、[Electron Menus / Roles 官方文档](https://www.electronjs.org/docs/latest/tutorial/menus#roles)

因此 Serpent 应保留两条清晰路径：

1. 文本输入焦点内，使用 Chromium/Electron 原生编辑 undo/redo。
2. 非文本编辑焦点，使用自定义 `edit.undo` / `edit.redo` 命令查询资源库历史，并由 Renderer/Main 动态同步 enabled/label。

快捷键处理必须先做焦点仲裁，不能同时让原生 role 和业务 command 响应同一次 `Cmd/Ctrl+Z`。Windows 当前没有 application menu（`tests/unit/application-menu.test.ts:14-20`），所以 Renderer 命令与快捷键必须独立可用，不能把功能只实现到 macOS 菜单。

## SQLite 持久化结论

- SQLite 保证一个事务中的数据库变更原子提交；同一时刻只允许一个写事务，`BEGIN IMMEDIATE` 可提前取得写事务并可能返回 `SQLITE_BUSY`。[SQLite Transaction 官方文档](https://www.sqlite.org/lang_transaction.html)
- SQLite 的原子提交只覆盖数据库文件，不会把 NTFS/APFS 上的 rename/copy/delete 纳入同一事务。Serpent 仍需要 `file_operations` 的多阶段 manifest 和恢复逻辑；新增 history table 不能替代它。[SQLite Atomic Commit 官方文档](https://www.sqlite.org/atomiccommit.html)
- Serpent 当前 WAL + `synchronous=FULL` 与官方说明一致：FULL 在 WAL 模式为每次事务额外同步 WAL，提供比 NORMAL 更强的断电持久性。[SQLite PRAGMA synchronous 官方文档](https://www.sqlite.org/pragma.html#pragma_synchronous)、[SQLite WAL 官方文档](https://www.sqlite.org/wal.html)
- 历史记录与 metadata-only 领域变更应在同一 SQLite transaction 内提交，避免“变更成功但没有历史”或“历史存在但变更没发生”。文件操作则在技术 operation committed 后，以可恢复的顺序推进 history state。

## Windows 平台风险

### Open handles 与 sharing violation

Microsoft 明确说明：普通 rename 需要 DELETE 权限；文件有 open handle 时通常不能 rename，目录或子目录中存在 open file handle 时目录 rename 也可能失败。目标存在且有 open handle 时 replace 同样可能失败。[FILE_RENAME_INFORMATION 官方文档](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information)

DeleteFile 也要等所有 handle 关闭；若打开时没有合适的共享权限，会产生 sharing violation。[Closing and Deleting Files 官方文档](https://learn.microsoft.com/en-us/windows/win32/fileio/closing-and-deleting-files)

对 Serpent 的约束：

- undo/redo 文件操作前主动释放自身 viewer、thumbnail decoder、watcher、archive stream 等句柄；不能只靠重试掩盖自身泄漏。
- 对 `EPERM/EACCES/EBUSY` 等已分类 sharing 错误做有上限、异步退避重试，保持 history state 为 `undoing/redoing`；超限后回到可诊断、可重试状态。
- 目录 move/rename 的 Windows E2E 必须在子树文件被 Serpent viewer 打开、被外部进程打开、watcher 活跃三种情况下分别验证。
- case-only rename、保留名、路径组件长度和 Unicode 规范化要复用现有 portable path identity/validation，而不是在 history 层另写路径比较。

### 跨卷 move 不是原子 rename

Microsoft 的 `MoveFileEx` 文档指出：文件跨卷移动需要 `MOVEFILE_COPY_ALLOWED`，其实现是 copy + delete；源删除失败时函数甚至可以成功并留下源文件。目录不能用该方式跨盘移动，跨卷移动还不会保留原 security descriptor。[MoveFileEx 官方文档](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexa)

对 Serpent 的约束：

- 资源库内 ManagedFolder/Asset 的 move/undo/redo 应限定在同一资源库卷内；跨资源库/跨卷定义为 copy/import + 可选独立 delete，不能伪装成原子 move。
- 任何 copy+delete 流程都必须有独立阶段、内容校验和崩溃恢复，不能只保存一条 rename inverse。
- Windows 真机测试必须验证目标 ACL、源残留、占用与重启恢复，macOS 通过不能作为替代证据。

## 推荐验证矩阵

| 维度 | 最低证据 |
|---|---|
| Registry | 每个 `historyPolicy != none` 的命令都有类型化 undo/redo executor、schema、label 和契约测试 |
| SQLite metadata | 原写入 + history 同事务；undo + cursor 同事务；redo + cursor 同事务；注入崩溃后不存在半历史 |
| 文件操作 | apply/undo/redo 每个阶段 failpoint；完整关闭 Worker/应用后重开并对账磁盘、DB、history、file_operations |
| 组合组 | 多 Item 逆序撤回；中途失败；重启恢复；部分成功只撤回成功子集；重复请求幂等/稳定拒绝 |
| 并发 | Desktop 与 MCP/headless 交错写；旧实体版本；无关实体变化不误伤；新写截断 redo 分支 |
| UI | 输入框文字 undo 与业务 undo 焦点仲裁；菜单 label/enabled；连续多次 undo/redo；切库时每库历史正确 |
| Windows | open file、open subtree file、watcher、case-only rename、目标占用、跨卷 copy/delete、长路径、完整重启 |
| 安全 | Renderer/MCP 不见绝对路径和 manifest；undo/redo 重新鉴权；永久删除与 retention expiry 明确失效 |

## 最终判断

现有代码不是从零开始：Worker 已有可靠性最高、价值最大的文件操作 manifest 与恢复框架；Automation 已有 opaque group、逆序恢复和来源无关 Gateway 的雏形；Desktop 菜单也已经选择了自定义业务命令而非误用 Electron role。

但三者目前没有共同的历史事实来源，且现有机制明确是“一次性恢复”而非 redo 系统。顶层设计应先建立资源库级 HistoryGroup/HistoryItem/HistoryAttempt 与类型化 Registry 策略，再按 metadata → collection/smart collection → folder/file 的顺序接入。直接扩展 Renderer `lastUndoableOp`、给 `AutomationExecutionJournal` 增加 redo 布尔值，或把 `file_operations` 改名为 history，都会继续制造跨入口和跨平台分叉。

## 官方来源

- [Electron MenuItem](https://www.electronjs.org/docs/latest/api/menu-item)
- [Electron Menus — Roles](https://www.electronjs.org/docs/latest/tutorial/menus#roles)
- [SQLite Transaction](https://www.sqlite.org/lang_transaction.html)
- [SQLite Atomic Commit](https://www.sqlite.org/atomiccommit.html)
- [SQLite Write-Ahead Logging](https://www.sqlite.org/wal.html)
- [SQLite PRAGMA synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous)
- [Microsoft FILE_RENAME_INFORMATION](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information)
- [Microsoft Closing and Deleting Files](https://learn.microsoft.com/en-us/windows/win32/fileio/closing-and-deleting-files)
- [Microsoft MoveFileEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexa)
