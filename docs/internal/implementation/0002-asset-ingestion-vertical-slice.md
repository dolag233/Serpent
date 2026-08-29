# 第二垂直切片：托管文件夹、资产导入与外部变化

> 状态：实施中
> 日期：2026-07-12

## 目标

让用户在已打开资源库中建立映射磁盘的文件夹，把单个/多个文件或完整目录复制进资源库，立即看到资产卡片，并在磁盘内容被外部覆盖、移动或删除后得到一致的资产状态。资产身份和修订边界从本切片开始稳定。

## 用户主线

1. 在资源库 `Assets/` 根目录或某个真实文件夹中创建子文件夹。
2. 选择文件导入，或选择整个文件夹并完整保留其层级。
3. 无冲突文件直接进入资源库；冲突批次先显示安全摘要，再一次选择疑似重复与同名冲突策略。
4. 导入过程中先显示进度，成功后资产出现在当前范围；单项失败不留下数据库孤儿或半文件。
5. 关闭和重开资源库后，文件夹树、资产 ID、文件大小和修改时间保持。
6. 外部覆盖托管文件后刷新当前修订；外部移动/删除后标记“文件丢失”，不猜测新位置。

## 范围

### 包含

- schema v2 migration runner：v1 → v2，并保留 migration checksum 审计。
- `managed_folders`、`assets`、`revisions`、`file_operations` 最小表。
- `Assets/` 根目录下真实文件夹的创建与读取。
- 导入单个/多个文件到当前文件夹；未选择文件夹时使用根目录。
- 复制导入整个文件夹，保留源目录名和完整层级。
- 任意文件可成为资产；未支持预览的类型仍用通用卡片显示。
- 疑似重复（同文件名且同大小）与同名冲突计划。
- 批次级决策：疑似重复跳过/合并/创建副本；同名保留两者/替换/跳过，默认保留两者。
- “创建副本/保留两者”跨平台安全地追加序号。
- 同文件系统 staging、事务化数据库写入、文件回滚和可恢复操作记录。
- 稳定资产 ID 与当前 revision；客户端内替换不长期保留旧字节。
- 显式刷新及后台目录观察：外部覆盖刷新修订，外部移动/删除标记 missing。
- Renderer 文件夹树、导入入口、冲突弹窗、资产网格和 missing/失败状态。
- 导入失败显示安全且具体的原因，并把完整错误链写入持久应用日志。
- 单元、Worker 集成与 Electron 用户流测试。

### 不包含

- 链接文件夹及其过滤规则。
- 标签、合集、搜索、智能合集和用户元数据编辑。
- 缩略图、视频播放、专业格式解码、色卡或 AI。
- 回收站 UI、手动找回和批量重新定位（后续切片）。
- 跨资源库拖放和剪贴板/浏览器扩展导入。

## schema v2

```text
managed_folders
  folder_id TEXT PK
  parent_folder_id TEXT NULL
  name TEXT
  relative_path TEXT UNIQUE
  created_at TEXT

assets
  asset_id TEXT PK
  location_kind = managed
  managed_folder_id TEXT NULL
  relative_file_path TEXT UNIQUE
  current_revision_id TEXT NULL
  availability = available | missing
  created_at TEXT
  updated_at TEXT

revisions
  revision_id TEXT PK
  asset_id TEXT
  parent_revision_id TEXT NULL
  byte_size INTEGER
  modified_at TEXT
  original_filename TEXT
  origin = import | external_change | replace
  accepted_at TEXT

file_operations
  operation_id TEXT PK
  kind
  status = preparing | applying | committed | rolled_back | failed
  manifest_json TEXT
  error_code TEXT NULL
  created_at TEXT
  updated_at TEXT
```

`current_revision_id` 在 revision 插入后更新。`relative_file_path` 始终相对 `Assets/` 且使用 `/` 作为数据库规范分隔符；实际路径通过 Worker 安全解析并验证仍位于 `Assets/` 内。

## 导入协议

Renderer 只能发起语义请求：

```text
RequestImportFiles { libraryId, targetFolderId? }
RequestImportFolder { libraryId, targetFolderId? }
ResolveImportConflicts { importId, suspectedDuplicate, nameConflict }
ListAssets { libraryId, folderId?, recursive }
CreateManagedFolder { libraryId, parentFolderId?, name }
RefreshManagedAssets { libraryId }
```

Main 通过系统选择器获得源路径并发送内部 `PrepareImport`。Worker 若发现冲突，返回不含源绝对路径的 `ImportConflictPlan`；Renderer 只回传不可伪造的 `importId` 与有限枚举决策。无冲突批次直接执行。待处理计划随 Worker 生命周期存在，超时或关闭资源库后失效。

## 文件事务

1. 解析目标文件夹并验证所有派生路径位于 `Assets/`。
2. 在 `.serpent/operations/<operationId>/stage` 复制源文件并记录 manifest。
3. 完成源 stat 与冲突计划；在用户决策前不修改最终目标。
4. 执行时把会替换的旧文件临时移入同一 operation 目录。
5. 在单个 SQLite 事务内写 `file_operations`、asset/revision 变化；文件移动使用同卷 rename。
6. 任一失败按 manifest 逆序恢复磁盘并回滚数据库。
7. 成功提交后删除不需保留的旧字节和 staging；清理失败保留显式 operation 状态供下次打开恢复。

## 外部变化

- 观察事件只用于触发去抖刷新，不直接当成事实。
- 刷新以数据库路径和当前 stat 为准。
- 路径不存在：资产变为 `missing`，保留资产 ID 和 revision。
- 路径存在且大小或修改时间变化：创建 `external_change` revision，并更新当前 revision；旧预览等衍生物由后续切片失效。
- 只改文件名/移动后原路径不存在：仍标记 missing，不扫描猜测。
- 批量变化产生一个摘要事件，Renderer 刷新当前列表。

## 测试接缝

- v1 数据库升级到 v2、重复打开幂等、migration 事务回滚与 checksum 篡改。
- 路径规范化、目标越界拒绝、文件夹名称规则、自动追加序号。
- 导入既有文件/目录不预设名称长度；由当前目标文件系统实际裁决路径限制，并把系统错误码映射为安全原因。
- 文件/文件夹复制导入与层级保持。
- 两类冲突的计划和所有决策分支。
- 中途复制、rename、数据库提交失败时磁盘与数据库回滚。
- 关闭重开后资产身份不变。
- 外部覆盖生成 revision；外部删除/移动标记 missing。
- Renderer 不能提交源路径，冲突 token 不可伪造/复用。
- Electron 用户流：创建文件夹、导入、解决冲突、重启恢复、外部删除后刷新。
- 错误可观测性：Renderer 不接收绝对路径，但界面给出具体原因，应用日志保留系统错误码和 cause 链。

## 完成标准

- 全部自动化门禁通过，macOS 与 Windows 打包资产导入冒烟均有明确结果。
- 磁盘目录与数据库文件夹树一致；导入文件可在 Finder/资源管理器直接理解。
- 不存在指向缺失托管文件却标记 available 的成功导入记录。
- 失败或取消不留下可见半文件、孤儿 asset/revision 或可复用冲突 token。
- 客户端替换保留资产 ID，外部覆盖创建新 revision；两者均不承诺恢复旧字节。
- 开发日志、双轴审查与 QA 报告完整。
