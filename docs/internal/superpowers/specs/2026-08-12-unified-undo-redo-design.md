# Serpent 统一撤回/重做顶层设计

> 日期：2026-08-12  
> 状态：顶层设计完成；第一阶段已进入实现与验证，剩余范围见开发日志和 Beads 工单  
> 决策：ADR-0032  
> 研究：`docs/internal/research/2026-08-12-unified-undo-redo-research.md`

## 1. 目标

让用户对 Serpent 中常见的文件、文件夹、合集、智能合集、标签和元数据操作使用一致、可预测的撤回/重做；无论动作来自 Desktop、脚本、MCP 还是插件，均进入同一条资源库操作历史，并在 Desktop 中同步展示结果。

本设计解决的是已成功提交后的业务撤回/重做，不取代：

- SQLite 事务 rollback；
- `file_operations` 的崩溃恢复；
- Serpent 回收站的 restore；
- 后台 Job 的取消/重试；
- 资产 Revision 或未来版本管理。

## 2. 当前实现审计

| 现有机制 | 位置 | 当前能力 | 根本限制 |
| --- | --- | --- | --- |
| Renderer 最近文件操作 | `src/renderer/App.tsx:1091`、`:5798` | 仅 move/copy/trash 的单个内存槽；toast 和菜单调用 | 无 redo、无多步历史、切库清空、与脚本/MCP 分离 |
| 脚本 Undo Group | `src/main/automation-execution-journal.ts:218`、`:822` | Main JSON 持久化 group 和 opaque reference | 不与资源库事务原子；按 execution owner 限制；只可消费一次 |
| Gateway 声明 | `src/automation/command-registry.ts:1535` | `supportsUndo` 布尔值 | 无 inverse/redo 类型保证；无法表达 barrier、保留和前置条件 |
| Gateway 组装 | `src/automation/command-gateway.ts:859` | 每个支持撤回的命令创建一个组，尝试从结果读取 `operationId` | 不是一次脚本 execution 一个组；没有 operationId 就退化为不可撤回 |
| 脚本恢复器 | `src/main/index.ts:5846` | 硬编码 move/trash 的 Worker undo | registry 已把 copy 标记可撤回，但恢复器不处理 copy；扩展必然继续漂移 |
| Worker 文件日志 | `src/worker/library-service.ts:805` | 文件转换、回滚和重启恢复；部分 move/copy/trash 有专用 undo | 只覆盖文件操作；把 `UNDONE` 放在 error_code；没有通用 redo |
| macOS/Windows 菜单 | `src/main/application-menu.ts:42`、`src/renderer/main-menu-items.ts:142` | 已预留业务 Undo/Redo 命令 | redo 恒禁用；自定义 accelerator 还需处理文本编辑优先级 |

结论：应复用的是“Undo Group 表示一次用户意图”“Worker 持有文件不变量”“Gateway 是统一能力目录”；不应复用的是 Main JSON 作为权威历史、`supportsUndo` 布尔值、Renderer 单槽和 Main 的命令类型 switch。

## 3. 领域语言

### 3.1 History Group（操作历史组）

一个用户意图在历史中的最小撤回边界。持久化时称为 `HistoryEntry`，包含一个或多个按提交顺序排列的 HistoryStep；二者不是两级可独立撤回的结构。

### 3.2 History Step（历史步骤）

一次已经提交的领域 mutation。保存版本化的 forward/inverse recipe、受影响实体和两方向前置条件。step 不是任意函数、SQL 或 transport 参数。

### 3.3 Operation Receipt（操作回执）

Worker 在 mutation 提交后返回的公开、安全投影：`historyEntryId`、是否可撤回/重做、展示摘要和提交状态。内部 recipe 不离开 Worker。

### 3.4 Barrier（历史屏障）

已经提交但不可撤回的修改，例如从磁盘永久删除。它截断 redo，并使依赖被删除实体的旧历史失效。只读和可再生成的派生任务不是 barrier。

### 3.5 Stale（已失效）

历史条目仍存在，但当前实体/路径/内容不再满足安全前置条件。Stale 不等于失败；系统必须说明冲突对象与可采取的后续动作，不能静默进行近似恢复。

## 4. 架构

```text
Desktop UI / Script / MCP / Plugin
                 │ semantic command
                 ▼
      Main Command + Undo Coordinator
      - stamps source / historyEntryId
      - menu, toast, desktop projection
      - no inverse payload interpretation
                 │ typed Worker command + HistoryContext
                 ▼
             Library Worker
      - domain validation and write lease
      - forward/inverse recipe registry
      - SQLite history + file operation journal
      - undo/redo precondition checks
                 │
                 ├─ library.db: operation_history(_steps)
                 └─ .serpent/operations: crash recovery only
```

### 4.1 分层职责

| 层 | 必须负责 | 明确禁止 |
| --- | --- | --- |
| Renderer | 呈现 canUndo/canRedo、动态标签、toast；提交公开 historyEntryId | 保存 inverse payload；按命令种类执行恢复 |
| Preload | Zod 校验的 `history.status/undo/redo` 与事件桥 | 任意路径、SQL、内部 manifest |
| Main | 建立/结束 intent group；路由菜单、脚本/MCP；发布 UI 同步事件 | 成为历史权威；直接改 DB/文件 |
| Gateway/Registry | 声明历史策略、能力、风险、原子性；统一 receipt | 仅靠布尔值承诺可撤回 |
| Worker | 原子写历史、校验栈顶/实体前置、执行 recipe、崩溃对账 | 根据 UI 文案或 transport 猜测恢复行为 |

## 5. 状态模型

```text
forward commit ──> applied ──undo──> undoing ──success──> undone
                      │                 │                    │
                      │                 └─recovery/rollback──┘
                      │                                      │
                      └─conflict────────────────────────────> stale

undone ──redo──> redoing ──success──> applied
```

- `undo` 只接受当前 undo 栈顶的 `expectedHistoryEntryId`。
- `redo` 只接受当前 redo 栈顶的 `expectedHistoryEntryId`。
- 在 `undone` 状态执行新的 mutation：清空当前库 redo 分支，再提交新条目。
- transition 前先预检全组；开始后写 HistoryAttempt。运行失败或崩溃时，Worker 根据 attempt 将已完成 step 继续收口或反向补偿，最后回到稳定状态。
- transition 遇到外部变化：条目标记 stale，返回结构化原因；不跳过它去撤回更早条目。
- group 中的 undo 按 step 逆序，redo 按 step 正序。

历史随资源库跨完整应用重启保留。Worker 重开库后先恢复未完成 attempt，再验证顶部条目的保留材料和当前实体状态；只有验证通过的条目进入 `canUndo/canRedo` 投影，失效条目保留稳定原因。

## 6. 数据设计

具体列名可在实施时调整，但必须保留以下语义：

```text
operation_history
  history_entry_id
  source = desktop | script | mcp | plugin
  source_reference?              # execution/invocation 的非秘密 ID
  label_key + label_args_json
  policy = reversible | barrier
  state = open | applied | undoing | undone | redoing | stale
  applied_sequence
  created_at / updated_at
  stale_code?

operation_history_steps
  history_step_id
  history_entry_id
  ordinal
  command_id
  recipe_kind
  recipe_version
  forward_payload_json
  inverse_payload_json
  affected_entities_json
  current_direction = forward | inverse

operation_history_attempts
  attempt_id
  history_entry_id
  direction = undo | redo
  status = preparing | applying | committed | rolled_back | failed
  next_step_ordinal
  error_code?
  created_at / updated_at
```

约束：

- payload 由 recipe 专属 Zod schema 校验，不能保存任意 SQL/JS。
- 绝对路径和恢复 manifest 不进入 Renderer、脚本或 MCP；必要路径只在 Worker DB/操作目录。
- DB-only mutation 与 history step 在同一 SQLite transaction 提交。
- 文件 mutation 沿用 prepare/apply/commit；HistoryEntry 只在 forward 文件阶段收口后变为 `applied`。
- 每次 undo/redo 文件转换生成新的 `file_operations` 行并关联 HistoryStep；用户历史状态不复用 `file_operations.error_code`。
- HistoryAttempt 记录组合组的转换进度和幂等键；启动恢复完成前不向任何入口接受新的 undo/redo。
- 清理采用“条目数量 + recipe/blob 占用 + 年龄”的有界策略；当前可操作栈和正在恢复的 operation 不得被清理。具体默认额度由实施工单通过真实大文件样本确定。

## 7. 命令协议

### 7.1 注册表

示意：

```ts
history: {
  policy: 'reversible',
  recipeKind: 'managed-asset-move',
  group: 'current-intent',
}
```

`reversible` 描述符必须通过完整性校验：recipe 已注册、forward 与 inverse schema 版本存在、Worker 结果包含 OperationReceipt、至少有一次循环测试。`barrier` 必须声明 affected scope 和用户风险摘要。

### 7.2 公共命令

```text
history.status(libraryId)
  -> undoTop?, redoTop?, transitionInProgress

history.undo(libraryId, expectedHistoryEntryId)
  -> updated status + affected summary

history.redo(libraryId, expectedHistoryEntryId)
  -> updated status + affected summary
```

Console 宿主和 MCP 可以读取安全历史摘要，但自动化撤回/重做必须显式提供 entry ID；不存在“撤回当前 session 最后一个不确定操作”。MCP 每次调用仍是自包含请求，不创建持久 transport 上下文。脚本正文仍只组合领域命令，不获得任意浏览或改写全库历史的能力。

### 7.3 脚本迁移

- `AutomationExecutionJournal` 继续记录 execution、授权、结果和日志。
- script execution 第一次 mutation 时由 Main 懒创建 intent group；后续 mutation 复用 group。
- execution 记录只保存 `historyEntryId`/group projection，不保存可执行 recovery reference。
- Console 宿主已有的 automation `undo(...)` 迁移为同一 `history.undo(...)` 路由；脚本正文不能看到 recipe、任意历史或直接调用 `asset.move-undo`。
- 如果一次 execution 含 barrier，完成结果明确返回 `undoable: false` 和原因；只读调用不影响可撤回性。

## 8. 操作覆盖矩阵

### 8.1 第一阶段：基础、高频、低存储成本

| 领域 | Forward | Undo | Redo | 主要前置条件 |
| --- | --- | --- | --- | --- |
| 资产元数据 | 描述/作者/来源/评分/喜欢更新 | 恢复被修改字段旧值 | 恢复新值 | `entity_version` 与字段快照 |
| 标签关系 | assign/remove | 应用精确关系差集 | 重放原差集 | 资产、标签仍存在 |
| 资产文件 | rename/move | 回原路径/名称 | 回目标路径/名称 | asset ID、revision、路径身份、目标占用 |
| 资产回收站 | trash/restore | restore/trash | trash/restore | tombstone 与内容指纹 |
| 资产复制 | copy | 删除本次创建且未变化的副本 | 以同一 ID/recipe 重新创建 | 源 revision 未变化、目标可用 |
| 文件夹 | create/rename/move/delete-empty | 删除空目录/恢复旧名或父级/重建目录 | 重放 forward | 子树集合、路径身份、目录占用 |
| 文件夹回收站 | trash/restore | restore/trash | trash/restore | tombstone、子树和资产状态 |
| 合集 | create/update/delete/reorder | 恢复完整字段、父子树与顺序 | 重放新状态 | 合集/父级版本和引用存在 |
| 合集成员 | add/remove/reorder | 恢复精确成员差集/顺序 | 重放差集/顺序 | 合集、资产仍存在 |
| 智能合集 | create/update/delete/reorder | 恢复规则、名称与顺序 | 重放新状态 | entity version、规则 schema |
| 标签实体 | create/rename/delete | 删除新标签/恢复名称与关系快照 | 重放 | 名称唯一性、关系版本 |

### 8.2 第二阶段：需要保留或大快照策略

- 导入文件/文件夹：undo 需保留同一资产身份，redo 不能依赖外部源永久存在。
- 替换托管内容：需要在历史额度内保留旧字节；Revision 行本身不保证旧字节存在。
- 删除/重新挂载 LinkedFolder：恢复索引、规则和组织关系快照，且不能假装恢复外部源状态。
- 标签 merge、大范围清空 AI 内容：可能产生很大的关系/内容快照，需单独做容量和性能基线。
- 图片序列创建/解散和其他复合关系操作：纳入同一 recipe 机制，但在对应领域验收后实施。

### 8.3 永不进入普通 Undo 的操作

- 从磁盘永久删除资产、文件夹、链接源或整个资源库；
- 清空/压缩历史本身；
- 导出、打开、选择、浏览历史、搜索和纯读取；
- 缩略图、联系表、代理、AI 分析等可再生成 Job；
- 外部应用在 Serpent 之外直接修改文件。

这些操作要么是 barrier，要么是 `none`；不能因为按钮叫“恢复”或“重试”就纳入 Undo。

## 9. UI 与可观测性

- 菜单动态显示“撤回移动 12 项”“重做删除合集”等；Windows 应用内菜单和 macOS 顶部菜单共享状态。
- toast 的撤回按钮绑定产生该 toast 的 `historyEntryId`；它不再无条件指向全局 `lastUndoableOp`。不是栈顶后立即禁用/消失。
- 自动化命令成功后，通过统一 history/domain event 刷新 Desktop、展示与人工操作同等的 info，不依赖 transport 私有 toast。
- 文本控件聚焦时，Undo/Redo 优先处理文本编辑；离开文本编辑后才处理业务历史。
- stale/conflict 提供明确对象和原因，例如“原位置已存在同名文件，未撤回”；不得回退成通用失败。
- 日志记录 entry/step/transition ID、命令、来源、状态和错误码；用户可见投影不含绝对路径和 credential。

## 10. 并发、失败与安全

- 每库同一时间只运行一个 history transition，复用 Library Write Coordinator 的租约/fencing。
- undo/redo 以预期栈顶 ID + recipe 前置条件双重校验；幂等重试返回同一终态，不重复移动文件。
- 插件 Hook 不在 SQLite transaction 或文件锁内执行。Undo/Redo 是否触发 Hook 使用与普通领域命令相同的 post-commit 事件，但必须标记 `historyDirection`，避免 Hook 递归产生新历史。
- Undo/Redo 是普通受控写能力，不绕过 MCP permission policy；对一个显式、可逆且仍为栈顶的 entry 执行不属于危险操作，也不依赖原调用者仍存在。不可逆 barrier 仍走 dangerous challenge。
- history payload 不保存 token、脚本源、用户密钥或任意外部请求正文。

## 11. Windows 专项设计门禁

实现不能以 macOS `rename` 成功作为跨平台证据：

- 路径身份沿用当前逐段 NFC + 共同大小写约束；大小写-only rename 使用受控临时名两跳并可恢复。
- Windows 目标文件被外部程序打开时可能返回 sharing/access 错误；对已分类的短暂占用可做有上限的异步退避重试，超限后必须保持/恢复原历史状态并返回结构化 conflict，不得静默 copy-delete 或把条目标成 undone。
- 资源库内 ManagedFolder/Asset move 限定在同卷；跨资源库/跨卷属于 copy/import 加可选独立 delete，不能伪装成原子 move。任何 copy+verify+delete 都必须有独立恢复 manifest。
- 验证 Explorer/第三方软件占用、只读属性、长路径、Unicode、目标同名和防病毒扫描短暂占用。
- Windows packaged E2E 未实际运行前，所有相关工单只能写“实现/静态审查完成，Windows 未验证”。

## 12. 验收策略

每类 operation 至少覆盖：

1. forward → undo → redo → undo，实体 ID 和组织关系符合策略；
2. 无关修改不使条目失效；相关实体/路径变化产生 stale；
3. undo/redo 中途 failpoint + Worker 重启 + DB/磁盘对账；
4. 撤回后新修改清空 redo；
5. Desktop、脚本和 MCP 各产生同构 HistoryEntry，Desktop 状态同步；
6. 完整退出后未完成 attempt/file operation 正确恢复；重开时只有材料和前置条件验证通过的旧栈顶可操作；
7. 文本输入焦点下快捷键不触发业务历史；
8. macOS 真实 Electron E2E；Windows 使用真实 runner/packaged 证据，不以 mock 代替。

## 13. 实施顺序

1. History schema、recipe registry、状态机和 migration。
2. Main UndoCoordinator、公共协议、菜单/toast 投影与文本焦点路由。
3. 迁移已有 move/copy/trash，删除 Renderer 单槽和 Main 硬编码恢复器。
4. 元数据、标签、合集、智能合集等 DB-only recipe。
5. 文件夹与复合文件操作 recipe、崩溃恢复和 Windows 门禁。
6. 脚本/MCP/插件统一投影，清理旧 Automation Undo Group 所有权。
7. 第二阶段大快照操作、容量策略和 packaged/Windows 验收。

## 14. 完成定义

- 所有第一阶段矩阵项均有实现位置、自动化测试和人工/平台证据四列追溯。
- Registry 中不存在 `reversible` 却无双向 handler 的命令。
- Renderer/Main 不再按 move/copy/trash 类型解释恢复引用。
- Desktop、脚本、MCP 对同一命令产生相同业务状态、历史状态和 UI 事件。
- macOS 当前构建 E2E 通过；Windows 未跑时明确保留未验证，不宣称跨平台完成。
