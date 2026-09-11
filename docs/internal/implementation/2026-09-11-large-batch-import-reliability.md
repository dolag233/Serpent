# 十万级导入可靠性（2026-09-11 用户日志）

> 状态：设计已拆工单，待实现  
> 日期：2026-09-11  
> 证据：Windows 便携版 0.2.1 用户日志（约 18:11–19:43）；资源库位于网盘同步盘；导入 10 万+ 文件后失败、进度长时间不消失、取消报失效、冲突窗关闭后「全部丢失」  
> 工单入口：Epic 见本文 §6；执行队列以 `.beads/issues.jsonl` 为准

本文件给后续 agent 用。不要凭聊天记忆改行为。实现时对照本文不变量，不要只打补丁绕过单条 SQL。

## 1. 用户可见现象

1. 导入「一直在进行」，体感几个小时，进度几乎不动。
2. 取消导入后提示待处理导入已失效。
3. 另一次：内容重复窗关掉（或关应用）后，刚拷进去的文件全部不见。

## 2. 日志事实（脱敏）

- 启动后先重开已有库，不是新建库。
- 开库约 1 分钟内：约 1000 条缩略图/海报/色卡失败。Sharp cause 为源文件不存在；外层被包成 `LIBRARY_NOT_WRITABLE`。同时磁盘对账把资产标 missing。
- 打开系统文件选择器后，约 35 分钟无 error 日志（扫描/暂存拷贝阶段）。
- `asset.import.resolve` 抛 `SqliteError: too many SQL variables`，栈在 `countLogicalAssetUnits` ← `resolveImport`。
- 约 54 分钟后 `asset.import.abandon` → `IMPORT_NOT_FOUND`。
- 随后 `asset.refresh` 同样 `too many SQL variables`，栈在 `withImageSequenceSummaries` ← `listAssets` ← `refreshManagedAssets`。

本段日志墙钟约 1.5 小时。「几个小时」视为同步盘上暂存拷贝 + 失败后遮罩不消失的体感，不排除更早一次未进入该文件的导入。

## 3. 根因链

按发生顺序，不是互斥的五个独立 bug。

```
暂存拷贝 10 万文件到库盘（同步盘上极慢）
  → 弹出内容重复/同名冲突
  → 用户确认
  → resolveImport 开头删除 pending
  → 文件 rename 进 Assets + DB 提交（可能已 committed）
  → createDetectedImageSequences / countLogicalAssetUnits
       一次 IN (10 万个 ?)  → SQLITE 变量上限（常见 32766；仓库内已有按 900 分块先例）
  → 请求失败；catch(committed===true) 再次调用 countLogicalAssetUnits 再次抛错
  → 无 import.progress complete/failed；Renderer 不清 overlay
  → 用户取消 → pending 已不存在 → IMPORT_NOT_FOUND
```

关窗/取消冲突窗的丢失路径：

| 时机 | 代码 | 磁盘结果 |
| --- | --- | --- |
| 冲突窗仍开着：取消、Esc、关库、关应用 | `abandonImport` / `LIBRARY_CLOSED` / `IMPORT_EXPIRED`（默认 15 分钟 TTL） | 删除 `.serpent/operations/<id>/` 暂存。源目录一般还在。用户体感是「拷了几小时全没了」。 |
| 已点确认，状态已是 `applying`，文件已从 stage rename 到 Assets，但 `file_operations` 尚未 `committed`，此时崩溃或关进程 | 下次打开 `recoverFileOperations`：`!hadDestination && !staged && dest exists` → `rmSync(destination)` | **删掉已经放进 Assets 的新文件**。若 DB 行已写入，卡片会裂或整批消失。 |

`resolveImport` 在成功路径里先把 `file_operations` 标 `committed` 再跑序列检测。若序列检测/计数在 **标 committed 之后** 失败，本次日志的取消不会再回滚已提交行。用户关的是「失败后的遮罩」，不是 applying 恢复。另一句「关掉重复全部丢失」更符合：未确认就 abandon，或确认后 applying 未完成就关进程再打开。

## 4. 不变量（实现不得破坏）

1. **未确认的导入可以丢弃暂存**。冲突窗取消 = 放弃本批入库。必须让用户知道会丢掉已拷到 operations 的副本，而不是源文件。
2. **已写入 assets 表且文件已在 Assets 的导入不得当崩溃垃圾删除。** 恢复只能删「无 DB 行的孤儿目标」或把 backup 换回去。
3. **SQLite `IN (?)` 绑定数必须分块。** 任意用户规模的 ID 列表都按仓库已有 900 上限切（见 `library-service.ts` jobs 查询注释）。禁止再为「这次导入不会很大」开新的一次打完的 IN。
4. **迁移只加不改。** 本设计不改 schema。
5. **临时文件有始有终。** 取消/过期/失败仍须删 operations 暂存；不得改成把暂存丢到系统盘且不清理。
6. **Renderer 不接收路径/SQL。** 分块与恢复只在 Worker。
7. 改资源库相关代码必须跑完 `npm run test:library-availability`。

## 5. 设计决策

### 5.1 共享 `IN` 分块

新增小模块（建议 `src/worker/sqlite-in.ts`），不要把切块逻辑继续复制进 `library-service.ts`。

- 常量与 jobs 查询一致：`SQLITE_IN_BIND_LIMIT = 900`。
- 提供：按 ID 列表执行 `SELECT ... WHERE col IN (chunk)` 并合并行；需要时提供 `NOT IN` / `DELETE ... IN`。
- 单测：用临时 SQLite，插入远超 900（例如 2500）行，断言结果完整且语句绑定不超过上限。不要为了复现去拷 10 万真实媒体。

优先替换这些调用（均已在 10 万 ID 下炸过或同构）：

- `countLogicalAssetUnits`
- `withImageSequenceSummaries`（含 membership 与 primary 两条 IN）
- `createDetectedImageSequences` 按 asset_id 取 path 的 IN
- `refreshManagedAssets` 的 `assetIds` 过滤 IN（调用方若传入超大列表）
- 导入提交后若仍 `listAssets` 全库再 filter，改为按 `affectedAssetIds` 分块取，禁止为了返回卡片再扫一遍全库

导入路径以外、同样 `ids.map(() => '?')` 的点（删除、标签、合集）一并换成 helper，避免下一处 10 万多选再炸。允许同一 PR 先覆盖导入/刷新/序列三条热路径，其余列在工单里作为必须扫完的清单，不要只改被日志打到的函数名。

### 5.2 `resolveImport` 的提交边界

当前问题：pending 在函数开头就删；后处理失败时 `catch (committed)` 里再次调用会失败的计数。

改为：

1. 文件系统 + assets/revisions 提交成功，并把 `file_operations` 标成 `committed` 之后，后处理（序列检测、逻辑计数、list 卡片）全部包在独立 try 中。
2. 后处理失败：仍返回成功的 `ImportCompletion`（`importedCount` 等已有数字；`assetCount` 回退为受影响 ID 去重数量或分块计数；`assets` 可空）。诊断日志记录后处理失败，不得把整次导入打成 `SQLITE_ERROR`。
3. 禁止在 `committed===true` 的 catch 里再次无保护调用同一 SQL。
4. pending 删除时机：进入 applying 之后即可从「可 abandon 的决策会话」移除，但必须把 `importId` 记入短时 `finalizedImportIds`，使随后的 cancel/abandon 返回成功（已结束），而不是 `IMPORT_NOT_FOUND`。
5. 无论成功或「提交成功但后处理失败」，都发 `import.progress` `phase: 'complete'`（若整笔回滚则 `'failed'` / `'cancelled'`），好让 Renderer 清遮罩。

### 5.3 applying 恢复

`recoverFileOperations` 对 version-1 import、`status==='applying'` 时：

对每个 manifest 文件：

1. 若 backup 存在：维持现语义（把目标换回 backup）。这是「替换已有文件」的崩溃恢复。
2. 否则若目标路径在 `assets`（`deleted_at IS NULL`）已有行：视为已应用，**不得** `rmSync`。
3. 否则若 `!hadDestination` 且 stage 已空且目标存在且 **无** DB 行：可以删孤儿文件（崩溃发生在 rename 之后、INSERT 之前）。
4. 若存在任何已应用文件（第 2 步），操作标 `committed`（或 `PROCESS_INTERRUPTED_RECOVERED`），不要整单 `rolled_back`。
5. 空目录清理仍只用 `rmdir`（非空则留下）。

不要为了「恢复简单」把整个导入目录树 `rm` 掉。

关应用时：`closeLibrary` 对仍在 **决策中**（preparing / 冲突窗 pending）的导入维持 abandon 暂存。对已 `applying` 的导入不要在关库时当 pending 扔掉；交给下次 `recoverFileOperations` 按上面规则收口。

### 5.4 进度与冲突窗

Renderer（`App.tsx` `resolveImportConflictsWith`）：

- resolve 抛错也必须 `setImportProgress(null)`。
- `IMPORT_NOT_FOUND` 且该 `importId` 已在本次会话提交过：沿用 `shouldSuppressImportContinueError`（`Serpent-85e60c`），不要再弹「请重新选择文件」卡死遮罩。
- 冲突/重复窗取消文案：中英都要写明「将丢弃这次已经复制到资源库暂存区的文件，源文件夹里的原文件不会删除」。
- 进度在 `copy`/`hash` 阶段若单文件极慢（同步盘），至少保持已处理/总数更新；不要只有「正在准备导入」。

Worker：`cancelImport` 对 `finalizedImportIds` 视为成功取消/已结束，并发 `cancelled` 或直接让 UI 关掉（若已 complete 则以 complete 为准，不要覆盖成功结果）。

### 5.5 等待决策时的 TTL

`scheduleImportExpiry` 默认 15 分钟。冲突窗开着时到期会静默删暂存，用户再确认就是 `IMPORT_NOT_FOUND`。

决策：

- 处于「等用户决策」（冲突、无法读取、序列帧确认）时，TTL 改为 **24 小时**，或暂停到期直到 resolve/abandon/关库。
- 关库仍可放弃决策中的 pending（现 `LIBRARY_CLOSED`），但应在下次打开时不要误恢复成空遮罩。
- 不要在用户还盯着对话框时清暂存。

### 5.6 缺失源与错误码（第二波）

源文件不存在不是「库不可写」。Sharp/ffmpeg `ENOENT` 应映射为 `SOURCE_NOT_FOUND` / 媒体任务失败码，而不是 `LIBRARY_NOT_WRITABLE`。

开库后：`availability=missing` 或廉价 `exists` 失败的资产不要进入 startup 缩略图波次。对账标 missing 应发生在入队之前，或入队时跳过。

这不修复导入 SQL，但解释了「整库很卡、卡片全裂」与导入失败叠在同一份日志里。

### 5.7 暂存前冲突预检（第二波，产品）

当前是先把全部源文件拷进 operations/stage，再算重复并弹窗。10 万文件在同步盘上会先耗数小时，再让用户取消并丢掉暂存。

后续方向（不要和 P0 混在一个 PR）：

- 枚举后先按相对路径 + 体积（及已有指纹）做库内冲突计划，**确认决策后再暂存**；或
- 仅对需要「保留两者 / 替换」的子集暂存。

内容哈希仍须遵守现有 skipContentHash / 指纹查询，禁止对同体积文件再全量 SHA-256（IMPORT-UI-001 已收口）。

本项不改变「取消 = 不入库」的语义，只避免取消时丢掉数小时无意义拷贝。

## 6. 工单与依赖

实现顺序：先 SQL 分块，再提交边界，再恢复与 UI。TTL 可并行。5.6 / 5.7 不要堵 P0。

| ID | 优先级 | 主题 | 依赖 |
| --- | --- | --- | --- |
| `Serpent-168624` | P0 epic | 十万级导入失败、进度卡住与关窗回滚丢文件 | 被全部子单阻塞 |
| `Serpent-d4d79f` | P0 | SQLite IN 分块 | 无；先做 |
| `Serpent-3d4290` | P0 | resolveImport 提交后不得因后处理失败整单失败 | 被 `d4d79f` 阻塞 |
| `Serpent-41c7e1` | P1 | applying 恢复不得删已入库文件 | 无 |
| `Serpent-8fadb4` | P1 | 进度/取消/冲突窗文案与 overlay | 被 `3d4290` 阻塞 |
| `Serpent-d1280f` | P1 | 等待决策时延长/暂停 15 分钟 TTL | 无 |
| `Serpent-9b7a3a` | P2 | 缺失源错误码与开库缩略图跳过 | 无 |
| `Serpent-0a5018` | P2 | 暂存前冲突预检 | 无 |

## 7. 测试

- Helper 单测：临时 DB + 2500 ID。
- Worker：导入 N 个文件（N > 分块，文件可极小）走完 `resolveImport`，断言不抛 `too many SQL variables`，`importedCount` 正确；后处理若被注入失败，导入仍 committed。
- Worker：模拟 `applying` + 目标已有 assets 行 + stage 已空 → 恢复后文件仍在，操作不是整单 rolled_back。
- Worker：模拟 `applying` + 无 DB 行的孤儿目标 → 仍删除孤儿。
- 单元：冲突取消文案 key；resolve 失败清 progress；对 finalized importId 的 cancel 不报 `IMPORT_NOT_FOUND`。
- 改 `library-service` / schema 使用 / 开库恢复：必须完整 `npm run test:library-availability`。
- 不要用用户的真实库或同步盘路径；不要在仓库里留下本次测试目录。

## 8. 明确不做（本轮）

- 不把资源库默认改到 WAL 以「修好同步盘」。同步盘损坏是另一张 P0（`Serpent-29893e`）。
- 不在本设计里做网盘占位文件的完整「智能同步」产品。
- 不把 10 万文件的卡片列表一次返回 Renderer。
- 不把取消冲突窗改成「暂存永久留下来等下次」。未确认导入仍可丢弃暂存。

## 9. 验收条目（实现同一提交里写入清单）

实现对应工单后，在 `docs/internal/qa/human-acceptance-checklist.md` 增加最小可操作条，例如：

- `IMPORT-SQL-001`：向已有库导入明显超过 3 万的文件（可用大量小文件），确认提交后导入成功结束，遮罩消失，不是 SQLITE 内部错误。
- `IMPORT-UI-005`：resolve 失败或取消已结束的导入时，遮罩消失，不出现「请重新选择文件」死循环。
- `IMPORT-UI-006`：内容重复窗取消后，源文件夹文件仍在；文案写明丢掉的是暂存副本。
- `IMPORT-RECOVER-001`：确认导入后在写入过程中强杀进程，再打开库：已出现在库里的新文件还在。

仅用户本人可把 UI 条标成「人类验收通过」。
