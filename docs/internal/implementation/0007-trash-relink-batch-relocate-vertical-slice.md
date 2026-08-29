# 第0007垂直切片：回收站、手动找回与批量重新定位

> 状态：主功能与 relink 文件归属安全已实现；真实 UtilityProcess、packaged 与 Windows QA 未收口
> 日期：2026-07-13；最后校准：2026-07-16；安全收口候选：`f1330a7`

## 目标

为托管资产提供 Serpent 回收站（软删除、30天保留、可恢复、可永久删除），为链接资产提供确认删除与可选系统回收站；允许用户手动找回单项丢失资产或指定新根目录按原有相对目录结构批量重新定位多项丢失资产。资产身份和修订边界延续切片 0002/0003 的稳定模型。

## 用户主线

1. 在资产网格或详情面板对托管资产执行"删除"，资产立即从当前视图消失，进入 Serpent 回收站。
2. 打开回收站视图，浏览已删除资产及其原始位置和剩余保留天数。
3. 从回收站选择一项或多项资产，恢复到原始文件夹或指定文件夹；若原始路径已被占用则按同名冲突规则处理。
4. 在回收站中永久删除资产，文件从 `.serpent/trash/` 移除且数据库行级联清理；若文件正被占用则跳过并提示，不阻塞同批次其他资产。
5. 对链接资产执行"删除"时弹窗询问是否同步删除磁盘源文件；选择是则移入系统回收站后移除资产记录，选择否则直接移除记录。
6. 托管或链接资产因外部移动/重命名变为 missing 后，手动找回单项：选择新文件路径，保留原资产身份与人工元数据，重新生成文件衍生内容。
7. 多项 missing 资产在新位置保持原有相对目录结构时，指定新根目录完成批量重新定位；支持"沿用原资产信息"确认并批量应用。

## 范围

### 包含

- schema v5 migration runner：保留 migration checksum 审计。
- `assets` 扩展：`deleted_at`、`trashed_from_relative_path`、`trashed_from_folder_id`；partial index on `deleted_at`。
- 托管资产软删除：文件从 `Assets/` 移至 `.serpent/trash/<asset_id>/<filename>`，更新 `relative_file_path` 为 `__trash__/<asset_id>/<filename>`，保留原始路径与文件夹引用供恢复。
- 回收站视图：列出已删除资产（`deleted_at IS NOT NULL`）、原始位置、删除时间、剩余天数。
- 从回收站恢复：恢复至原始文件夹或用户指定文件夹；目标路径冲突时复用切片 0002 的同名冲突规则（保留两者/替换/跳过，默认保留两者）。
- 永久删除：移除 `.serpent/trash/` 下的文件，级联删除 asset/revision/artifact 行；文件被占用时跳过该项并在结果中提示。
- 自动清理：资源库打开时检查超过 30 天的已删除资产并逐项永久删除；单个占用跳过不阻塞整批。
- 链接资产删除：Renderer 弹出确认对话框（含"同步删除磁盘文件"勾选），Worker 移除记录或移入系统回收站后移除记录。
- 单项手动找回：用户通过 Main 原生文件选择器选定新文件路径，Worker 校验文件存在且不在资源库托管范围内，更新 `relative_file_path`/`path_identity`/`availability`，保留人工元数据与组织关系，创建 `external_change`（或 `relink`）revision；缩略图、提取元信息、AI 内容标记为失效由后续切片重新生成。
- 批量重新定位：用户通过 Main 选择新根目录，Worker 按各资产原有 `relative_file_path`（相对其所属根）在新根下查找匹配文件；匹配成功的恢复 available 并保留元数据，无匹配的保留 missing。
- 重新定位确认：批量重新定位前展示匹配摘要（找到/未找到数量、示例路径），询问"沿用原资产信息"；沿用时保留 Label、描述、人工与 AI 标签、合集、评分、喜欢、源链接和人工色卡，标记缩略图/提取元信息/AI 内容失效；用户可勾选批量应用该决定。
- Renderer 回收站面板、删除确认弹窗、手动找回/批量重新定位安全流程。
- 错误可观测性：Renderer 不接收绝对路径，界面给出具体原因，应用日志保留系统错误码和 cause 链。

### 不包含

- 版本管理 UI 或可恢复历史修订（后续版本）。
- 跨资源库回收站或联合删除。
- 回收站空间配额或逐项大小预估。
- 链接资产的 Serpent 回收站（链接资产删除后直接从数据库移除，不进入 Serpent 回收站）。
- 批量重新定位跨不同根目录的资产（只能指定一个共同新根）。
- 自动猜测外部移动/重命名后的新位置。
- 缩略图/预览/AI 内容的实际重新生成逻辑（本切片仅标记失效，实际生成由切片 0006/0009 承担）。
- 链接文件夹转换（`ConvertLinkedFolderToManaged`，后续切片）。
- 图形化过滤规则编辑器（后续切片）。
- 回收站内容在资源库导出中的包含策略（导出由切片 0010 决定）。

## schema v5

```text
-- assets 表追加列（在已有 v4 结构上扩展）
ALTER TABLE assets ADD COLUMN deleted_at TEXT;                -- NULL = 活动，非空 = 在回收站
ALTER TABLE assets ADD COLUMN trashed_from_relative_path TEXT; -- 删除前在 Assets/ 下的原始路径
ALTER TABLE assets ADD COLUMN trashed_from_folder_id TEXT      -- 删除前所属资源库文件夹
  REFERENCES managed_folders(folder_id) ON DELETE SET NULL;

-- partial index 加速回收站查询与自动清理
CREATE INDEX assets_deleted_at_idx ON assets(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX assets_deleted_folder_idx ON assets(trashed_from_folder_id) WHERE deleted_at IS NOT NULL;
```

不变量：

- `deleted_at` 仅对 `location_kind = 'managed'` 的资产设置；linked 资产删除后直接移除记录行。
- `deleted_at` 非空时，`relative_file_path` 格式为 `__trash__/<asset_id>/<filename>`，与 `Assets/` 下真实路径不冲突。
- `deleted_at` 非空时，`trashed_from_relative_path` 与 `trashed_from_folder_id` 必须非空；恢复或永久删除时根据恢复情况清理这些列。
- `trashed_from_folder_id` 指向的文件夹可能已被删除，此时恢复目标回退至 `Assets/` 根目录。
- 自动清理按 `deleted_at < datetime('now', '-30 days')` 分批执行；逐项永久删除，不因单个文件占用中止整批。
- 回收站文件位于 `.serpent/trash/<asset_id>/<filename>`，路径由 Worker 安全构造并验证不逃逸 `.serpent/trash/`。
- managed 资产原有的 `assets_managed_relative_unique` partial index 继续保护活动资产路径唯一性；回收站路径 `__trash__/...` 以资产 ID 为键天然不冲突。
- 恢复时若原 `trashed_from_folder_id` 对应文件夹已不存在，自动回退到 `Assets/` 根目录；若目标路径已有同名活动文件，复用切片 0002 的同名冲突规则。

## 协议

Renderer 只能发起语义请求——永远不接收或提交源绝对路径。

### Renderer 语义请求

```text
// 托管资产回收站操作
asset.trash.request       { libraryId, assetIds[] }
asset.restore.request     { libraryId, assetIds[], targetFolderId? }
asset.delete-permanent.request { libraryId, assetIds[] }
trash.list.request        { libraryId }
trash.purge.request       { libraryId }  // 手动触发到期清理

// 链接资产删除
asset.delete-linked.request { libraryId, assetIds[], deleteSourceFile }

// 丢失资产找回
asset.relink.request      { libraryId, assetId }
asset.relink-batch.request { libraryId, keepMetadata }
```

Main 通过系统选择器获得路径后发送内部 Worker 命令：
- `asset.relink.request`：Main 打开单文件选择器，发送 `asset.relink { libraryId, assetId, newAbsolutePath }`
- `asset.relink-batch.request`：Main 打开目录选择器，Worker 先返回匹配摘要，Renderer 展示确认弹窗；用户确认后 Main 发送 `asset.relink-batch.apply { libraryId, newRootPath, keepMetadata }`

### Worker 内部命令

```text
asset.trash                { libraryId, assetIds[] }
asset.restore              { libraryId, assetIds[], targetFolderId? }
asset.delete-permanent     { libraryId, assetIds[] }
asset.delete-linked        { libraryId, assetIds[], deleteSourceFile }
asset.list-trash           { libraryId }
asset.purge-trash          { libraryId }
asset.relink               { libraryId, assetId, newAbsolutePath }
asset.relink-batch.preview { libraryId, newRootPath }
asset.relink-batch.apply   { libraryId, newRootPath, keepMetadata }
```

### 响应形状

```text
// 回收站
trash.list      → { assets: AssetSummary[] }     // 复用切片 0002 AssetSummary，扩展 deletedAt 字段
asset.trash     → { trashedCount: number }
asset.restore   → { restoredCount: number, assets: AssetSummary[] }
delete-permanent → { deletedCount: number, skippedCount: number, skippedReasons: string[] }
delete-linked   → { deletedCount: number }

// 找回
asset.relink    → { asset: AssetSummary }
asset.relink-batch.preview → { matchedCount, unmatchedCount, totalCount, examples[] }
asset.relink-batch.apply   → { restoredCount, unchangedMissingCount, assets[] }
```

Ass‎etSummary 扩展：

```text
AssetSummary 增加：
  deletedAt        string | null   // ISO timestamp，null = 活动
  trashedFromPath  string | null   // 删除前原始路径（仅回收站视图显示）
  remainingDays    number | null   // 距自动清理剩余天数（仅回收站视图显示）
```

### 回收站操作事务边界

托管资产删除（`asset.trash`）：

1. 验证全部 `assetIds` 均为 `location_kind = 'managed'` 且 `deleted_at IS NULL`。
2. 对每项资产：`mkdirSync` 确保 `.serpent/trash/<asset_id>/` 存在，`renameSync` 将文件从 `Assets/<relative>` 移至回收站目标路径。
3. 在单个 SQLite 事务内：写入 `file_operations` 操作记录，更新 `assets` 行（`relative_file_path` → `__trash__/...`、`deleted_at`、`trashed_from_relative_path`、`trashed_from_folder_id`，清空 `managed_folder_id`、`path_identity`）；revision 行保留。
4. 任一步失败：按已执行步骤反向恢复磁盘；回滚数据库事务。

恢复（`asset.restore`）：

1. 验证目标文件夹存在于 `Assets/` 内或回退到根目录。
2. 对每项：检查回收站文件存在，解析目标路径；若同名冲突则按规则处理（默认保留两者追加序号）。
3. `renameSync` 将文件移回目标 `Assets/` 路径；单个 SQLite 事务更新 asset 行（恢复 `relative_file_path`、`managed_folder_id`、`path_identity`，清空 `deleted_at`/`trashed_from_*`）。
4. 失败回滚同导入事务模式。

永久删除（`asset.delete-permanent`）：

1. 对每项：`rmSync` 移除回收站文件；若 `ENOENT` 已不存在，仍继续删除数据库行（视为已部分清理）。
2. 若 `EBUSY`/`EPERM`/`EACCES`：跳过该项，记录原因，继续下一项。
3. 数据库行通过 `ON DELETE CASCADE` 级联移除 revision。

### 手动找回与批量重新定位

单项找回（`asset.relink`）：

1. 验证 `asset` 存在且 `availability = 'missing'`、`deleted_at IS NULL`。
2. 验证新文件存在、非目录、不在 `Assets/` 内（避开托管空间）、不逃逸符号链接。
3. 单事务内：更新 `relative_file_path`、`path_identity`、`availability = 'available'`；创建 `origin = 'relink'` 的新 revision；保留 `asset_id`、`managed_folder_id`、`AssetMetadata`、Tag/Collection 关系。
4. 发出 `RevisionArtifact` 失效事件（缩略图、提取元信息、AI 内容标记为 stale）。

批量重新定位（`asset.relink-batch.preview` → `asset.relink-batch.apply`）：

1. preview：枚举当前资源库所有 `availability = 'missing' AND deleted_at IS NULL` 的资产；对每项按原 `relative_file_path` 的最后 N 级组件在新根下构造候选路径，`existsSync` 检查；返回匹配/不匹配统计与示例路径（不含绝对路径，仅相对片段）。
2. apply：对 preview 中匹配成功的资产逐项执行单项找回逻辑；`keepMetadata` 决定是否保留人工元数据与组织关系。
3. `keepMetadata = true`（默认）：保留 Label、描述、人工与 AI 标签、合集、评分、喜欢、源链接、人工色卡；标记缩略图/提取元信息/AI 内容失效。
4. `keepMetadata = false`：清空 Label、描述，移除标签与合集关系，重置评分/喜欢/源链接/色卡；仅保留 `asset_id` 和 revision 链。
5. 批量重新定位产生一条 `file_operations` 操作记录与一个摘要事件，不逐项通知。
6. 匹配成功的资产创建 `origin = 'relink'` 的 revision；无匹配的保留 missing 不变。

链接资产删除（`asset.delete-linked`）：

1. 验证全部 `assetIds` 均为 `location_kind = 'linked'` 且 `deleted_at IS NULL`。
2. 若 `deleteSourceFile = true`：对每项调用系统回收站 API（macOS 用 `trash` 包或 `osascript`，Windows 用 `shell.trashItem` 或 COM API）移动源文件到系统回收站；失败则记录并继续。
3. 单 SQLite 事务内删除 asset 行（CASCADE 移除 revision/artifact/metadata/tag/collection 关系）。
4. 不写入 `file_operations` 行（无托管文件需要崩溃恢复）。

## 测试接缝

- schema v4→v5 migration：新增列默认 NULL、重复打开幂等、migration 事务回滚与 checksum 篡改。
- 托管资产软删除：文件在 `.serpent/trash/<asset_id>/` 下可找到；`relative_file_path` 更新为 `__trash__/...`；`trashed_from_*` 列正确记录原始位置。
- 回收站列表：`deleted_at IS NOT NULL` 过滤生效；`remainingDays` 按 30 天阈值正确计算。
- 恢复至原始文件夹：文件回到原 `Assets/` 路径；`managed_folder_id` 恢复；`deleted_at` 清空。
- 恢复至指定文件夹：文件进入目标文件夹；路径冲突时默认保留两者并追加序号。
- 恢复时原文件夹已不存在：回退到 `Assets/` 根目录，不崩溃。
- 永久删除：文件从 `.serpent/trash/` 移除；数据库行级联清理；文件被占用时跳过该项并返回 skippedCount/原因。
- 自动清理：资源库打开时逐项清理超过 30 天的已删除资产；单个占用不中断整批。
- 链接资产删除：`deleteSourceFile = true` 时源文件进入系统回收站（验证 macOS `trash` 行为）；`false` 时源文件保留；数据库记录移除。
- 已删除资产不能再次删除或恢复（幂等校验：操作前验证 `deleted_at IS NULL` 或 `IS NOT NULL` 前提条件）。
- 单项手动找回：missing 资产 → 选新文件 → `availability = 'available'`；`origin = 'relink'` revision；人工元数据保留；非文件资产不进入托管路径。
- 批量重新定位 preview：匹配/不匹配统计正确；示例路径不含绝对路径；0% 匹配时 apply 步骤拒绝执行（或返回空结果不修改）。
- 批量重新定位 apply：`keepMetadata = true` 保留人工内容并标记衍生物失效；`false` 清空人工内容；无匹配资产被修改者仅为已匹配项。
- 重新定位时的新文件路径越界拒绝（逃逸到 `Assets/` 外、符号链接）。
- Renderer 不接收源绝对路径：trash 列表不含 `.serpent/trash/` 绝对路径；relink preview examples 仅含相对片段；`AssetSummary` 不含物理路径。
- 跨 IPC 数据不泄露 `absolute_root_path`、`selectedPath` 到 Renderer（通过 Zod 响应 shape 强制）。
- Electron 用户流：删除托管资产 → 查看回收站 → 恢复 → 资产回到原位 → 永久删除 → 确认文件移除。删除链接资产 → 确认弹窗 → 勾选同步删除 → 文件进入系统回收站 → 资产记录移除。
- 批量重新定位用户流：多资产 missing → 打开批量重新定位 → 选新根 → 看到匹配预览 → 确认沿用元数据 → 匹配资产恢复 → 不匹配资产保持 missing。
- 错误可观测性：Renderer 收到具体原因（不暴露绝对路径），应用日志含系统错误码、cause 链和操作 ID。

## 完成标准

- 全部自动化门禁通过；macOS 打包回收站与批量重新定位冒烟有明确结果，Windows 保留为显式未验证项。
- 托管资产软删除后文件进入 `.serpent/trash/`，恢复后回到原位；元数据与组织关系在恢复后完整。
- 自动清理不阻塞资源库打开，不因单个文件占用导致整批失败。
- 链接资产删除确认弹窗正确，系统回收站操作在 macOS 上可验证。
- 批量重新定位后匹配成功的资产 `availability = 'available'` 且身份不变；不匹配资产不受影响。
- 不存在指向缺失文件却标记 available 的恢复或重新定位记录。
- 开发日志、[双轴审查]与 QA 报告完整（`docs/internal/development/0007-*.md`、`docs/internal/reviews/0007-*.md`、`docs/internal/qa/0007-*.md`）。
- `keepMetadata = false` 分支的清空行为（Label、标签关系、合集关系、评分等）与 `keepMetadata = true` 的保留行为均有覆盖。
- Renderer 在任何响应中不接收源绝对路径或回收站物理路径。
