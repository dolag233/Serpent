# 切片 0007 开发日志：回收站、手动找回与批量重新定位

> 状态：文件归属安全阻断已关闭；真实 UtilityProcess、packaged 与 Windows QA 未完成
> 日期：2026-07-13（基线）/ 2026-07-14（补充）/ 2026-07-16（安全收口）

## 依据

- 规格：`docs/implementation/0007-trash-relink-batch-relocate-vertical-slice.md`
- 实现提交：`cd19485`、`825ebf0`
- 固定复审范围：`8dc2470...cdc2247`

## 2026-07-16 文件归属安全收口

- `f1330a7` 将 relink 日志升级为 v3：rename 前一次性写入并 fsync `manifest.json`，rename 后一次性写入并 fsync `placed.json`。
- 文件身份包含 `dev`、`ino`、`size`、`mtimeNs`、`ctimeNs` 与 SHA-256；使用单一 `O_NOFOLLOW` fd 执行 fstat → hash → fstat。
- 删除前先原子移动到 operation quarantine 再复核 inode 与内容；竞争失败时恢复原路径，或转存 `.serpent/recovered`。
- v1/v2、损坏 manifest/marker、rename→marker 窗口、零 inode/device 和任何 identity mismatch 都保留文件并写诊断，不能授权删除。
- 新增 manifest 前、manifest 后 placement 前、placement 后 marker 前、DB commit 前后等精确 failpoint；定向 Worker 11/11 通过。
- 测试仍是 `closeAll()` + 新 `LibraryService`，不是 UtilityProcess kill/restart；WAL、IPC 重连与 Main 的意外退出状态机仍为明确证据缺口。

## 实现摘要

- schema v7 增加软删除来源字段和 `relink` revision origin。
- Worker 实现托管资产软删除、恢复、永久删除、30 天清理、单项找回与批量重新定位。
- Renderer 提供回收站、删除确认、恢复、找回与批量重新定位流程。
- 公共 UI E2E 补充托管资产从正常视图进入回收站并恢复的端到端证据。
- 链接资产删除支持“仅移除记录”或“将源文件移入系统回收站并移除”；每项失败返回稳定资产
  ID 和具体安全原因，完整原因链写入日志。
- 系统回收站操作使用 `trash@10.1.1` 随包的 macOS/Windows native helper，以参数数组调用；
  helper 在 ASAR 外打包并由 package verifier 校验。
- 外部回收站移动以 `file_operations` v2 manifest 持久记录。若源文件已移动但 SQLite 提交失败，
  下次打开资源库自动对账；链接根离线时不会以“文件不存在”为依据误删记录。
- helper 即使在移动源文件后才抛错，也会核验在线根并进入对账；根离线导致状态不确定时，
  操作保持 `applying`，待根恢复后再次打开资源库继续判定，并写入带 operation ID 的日志。
- 单次链接源删除最多 20 项，单项 helper 截止 15 秒，Main 总等待 6 分钟；协议与 Worker
  双层拒绝重复 ID。
- 修复 managed 单项/批量重新定位的“假 available”：外部候选现在复制回原托管相对路径，
  原目录缺失时重建，外部源保留；新 revision、artifact 失效和缩略图 job 在同一数据库事务
  登记。刷新、关闭重开和 `resolveAssetPath` 都读取到新字节。
- linked 单项重新定位在既有链接根内更新相对路径与 portable path identity，避免刷新后再次
  missing；整根迁移仍使用 linked-folder relink 流程。

## 流程偏差与重建证据

本日志由提交、Worker 测试和本轮 E2E 事后重建；实现阶段没有同步完成开发日志、双轴审查与
QA，属于流程偏差。固定提交审查与当前 working-tree 复审分别保留，不把未提交修复写成历史。

## 验证

- 公共 UI E2E `organization-search-trash`：1/1 通过，覆盖托管资产删除、回收站浏览、恢复、
  返回所有资产后可见。
- 最终全局自动门禁：unit 144/144、Worker 430/430、Electron E2E 10/10；lint、typecheck、
  package/verify 通过。
- `SERPENT_TEST_REAL_SYSTEM_TRASH=1` 的 macOS 真实系统回收站 Worker 测试 49/49 通过；
  Electron E2E 也实际移动临时链接源文件。Windows 未验证。

## 2026-07-14：stateful relink-preview 增强

本日将原有的隐式 `pendingRelinkRoots` 状态改造为显式 stateful relink-preview 机制，并完成自动化验证与双轴审查。

### 增强内容

- 新增 `src/main/relink-preview-store.ts`（`RelinkPreviewStore`）：通过不透明 UUID `previewId` 管理待处理的批量重新定位预览。Main 持有 `rootPath`，Renderer 只持有 `previewId`；apply 时 Main 将 `rootPath` 转发至 Worker，Renderer 始终不接触绝对路径。操作：`create(libraryId, rootPath) → previewId`、`consume(libraryId, previewId) → rootPath`、`cancel`、`clearLibrary`。
- 用户流新增"取消预览后再次创建并应用全新预览"闭环：取消不改变资产状态，新预览独立计算。
- 已加入 `recoverOrphanRelinkPlacement` manifest 基础设施；2026-07-14 独立验收确认两个 `crash-relink-*` failpoint 只声明未调用，尚不能证明真实中断后会留下可恢复状态，因此不计为已完成崩溃恢复。按验收纪律#2(代码存在≠覆盖),崩溃恢复 = 未验证。
- 候选去重：`realpath` 归一化 + linked-root 冲突校验，避免同一物理文件多次匹配或与已链接资产位置重叠。
- 新增 `FILE_BUSY` 错误原因枚举（`src/shared/protocol/errors.ts`），永久删除时文件被占用返回稳定 Enum 到 Renderer。
- 新增 `removeTrashPath` 测试接缝，支持 Worker 测试中覆盖性清理临时回收站目录。
- Renderer 新增多选永久删除确认对话框。

### 新增测试文件

- `tests/unit/relink-preview-store.test.ts`：RelinkPreviewStore 的 create/consume/cancel/clearLibrary 独立单元测试。
- `tests/unit/asset-types-paths.test.ts`：`portableRelativePathSchema` 拒绝绝对路径与 UNC 路径的协议边界测试。
- `tests/e2e/trash-relink-flow.test.ts`：端到端"取消批量重新定位预览后应用全新预览"公共 UI 测试。

### 已有测试补充

- `tests/unit/protocol.test.ts`：新增 workerCommand/workerSuccessResult/rendererRequest/rendererSuccessResult 的 Zod schema 校验，断言无绝对路径泄漏到 Renderer 响应。
- `tests/worker/trash-relink.test.ts`（+221 行）：新增 `keepMetadata=false` 清空人工与 AI 元数据、标签、合集的总分覆盖（`:1731`）；候选去重；FILE_BUSY 枚举；removeTrashPath 接缝覆盖。未包含重新定位崩溃重启用例。

### 自动化验证结果（2026-07-14）

| 门禁 | 结果 |
| --- | --- |
| Typecheck | 通过 |
| Lint | 通过 |
| Unit + Worker 测试 | 869 passed + 1 skipped（50→53 文件） |
| Electron E2E | 23/23 passed（13 文件；含 `trash-relink-flow`、`organization-metadata-persistence`、`browsing-preferences`、`library-lifecycle` 新增用例） |
| `library-lifecycle` #11 | "falls back to the start screen when the recent library no longer exists" 通过（修复了不可恢复 recent 库导致主进程挂起的健壮性缺陷） |

### 双轴审查结论（2026-07-14）

- **Standards（当日独立验收校准）**：不透明 `previewId`、Worker 所有权、Zod 边界和参数化 SQL 保持成立；当时 `crash-relink-*` failpoint 尚未接入。`a1a6fe3` 接入 failpoint，`f1330a7` 进一步关闭 v1→v2 所有权窗口；真实 UtilityProcess 覆盖仍未完成。
- **Spec（独立验收校准）**：preview/apply、取消、`keepMetadata=false` 与路径隐私满足对应范围；重新定位崩溃恢复没有执行接缝和重启回归，因此切片不能写成”完全满足”。

### 当前状态

主用户流自动化已经形成提交；重新定位崩溃恢复回到 fixing。另剩 macOS Computer Use 平台 QA、打包后冒烟与 Windows 平台验证。

## 遗留风险

- Windows 系统回收站及文件占用行为具有平台差异，必须单独验证。
- 打包后 macOS 人工回收站/重新定位冒烟与 Computer Use QA 待执行。
