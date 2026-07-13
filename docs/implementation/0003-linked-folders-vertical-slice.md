# 第三垂直切片：链接文件夹与默认过滤

> 状态：代码复审中（自动验证通过；人工与 Windows QA 未执行）
> 日期：2026-07-13

## 目标

让用户通过"以链接方式导入"把外部真实目录挂载到资源库，不复制源字节，在链接区域浏览资产；源目录被外部覆盖、移动或删除后，复用切片 0002 的 stat-based 刷新路径得到一致的资产状态；根路径失效后标记 offline 并支持重新指定。资产身份和修订边界延续切片 0002 的稳定模型。

## 用户主线

1. 在"导入文件夹"流程选择"以链接方式导入"，选定外部真实目录。
2. 链接文件夹出现在侧边栏"链接文件夹"区域；源目录下通过默认过滤的文件立即成为资产卡片。
3. 在 Serpent 内对链接文件夹内容只读浏览（本切片不做增删改操作 UI）。
4. 外部覆盖源文件后刷新当前修订；外部移动/删除后标记 missing。
5. 源根目录失效后链接文件夹进入 offline，资产保留并显示"文件丢失"；用户重新指定根目录后按相对路径批量恢复。
6. 关闭和重开资源库后链接文件夹、资产 ID、文件大小和修改时间保持。

## 范围

### 包含

- schema v3→v4 migration runner：保留 migration checksum 审计。
- `linked_folders` 表：`folder_id`、`library_id`、`display_name`、`absolute_root_path`、`source_device_hint`、`status`、`path_identity`、`created_at`、`updated_at`。
- `assets` 扩展：`location_kind` 放开为 `managed | linked`；`linked_folder_id`；`relative_file_path` 相对链接根（仍是 `/` 规范分隔）。
- "以链接方式导入"：枚举源目录（复用切片 0002 的 stat-based 枚举与符号链接拒绝），应用默认忽略规则，注册 linked 资产，不复制字节、不建 staging、不产生 `file_operations` 行。
- 默认忽略规则（硬编码可扩展数据结构）：`.git`、`node_modules`、`.DS_Store`、`Thumbs.db`、`desktop.ini`、`__pycache__`、`.svn`、`.hg`。为后续图形编辑器预留 `filter_rule_sets` 数据结构位（本切片不建表，仅内存结构）。
- 链接区域 UI：侧边栏"链接文件夹"分组、链接资产网格（复用切片 0002 网格）、offline/missing 状态。
- 外部变化刷新：`refreshManagedAssets` 扩展为 `refreshAssets`，覆盖 linked 资产；源根失效时整组 linked 资产标 missing，`linked_folders.status = offline`。
- 重新指定根目录（`RelinkMissingFolder`）：用户选新根，按相对路径校验存在性，存在的资产恢复 available 并生成 `external_change` revision；仍不存在的保留 missing。
- 稳定资产 ID：链接资产的 `asset_id` 在外部变化和重新指定后保持不变。
- Renderer 链接区域、导入入口扩展、offline 提示与重新指定流程。
- 失败显示安全且具体的原因，完整错误链写入持久应用日志。

### 不包含

- 图形化过滤规则编辑器（后续切片；本切片仅默认规则与可扩展数据结构）。
- `ConvertLinkedFolderToManaged`（后续切片）。
- 链接文件夹内增删改操作 UI 与确认窗口（需回收站切片 0007）。
- 普通资产拖入链接文件夹（跨类型拖放，后续切片）。
- 批量重新定位 `RelinkMissingAssets`（指定新根按原相对结构恢复多项丢失资产，切片 0007）；本切片仅整组链接文件夹重新指定。
- 标签、合集、搜索、缩略图、AI。

## schema v4

```text
linked_folders
  folder_id TEXT PK
  library_id TEXT NOT NULL REFERENCES library(library_id)
  display_name TEXT NOT NULL
  absolute_root_path TEXT NOT NULL
  source_device_hint TEXT
  status TEXT NOT NULL CHECK (status IN ('available', 'offline'))
  path_identity TEXT NOT NULL UNIQUE
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL

assets (扩展)
  location_kind TEXT NOT NULL CHECK (location_kind IN ('managed', 'linked'))
  managed_folder_id TEXT REFERENCES managed_folders(folder_id) ON DELETE RESTRICT
  linked_folder_id TEXT REFERENCES linked_folders(folder_id) ON DELETE RESTRICT
  -- managed 时 managed_folder_id 可空（Assets/ 根），linked_folder_id 必空
  -- linked 时 linked_folder_id 必非空，managed_folder_id 必空
  relative_file_path TEXT NOT NULL UNIQUE
  path_identity TEXT NOT NULL UNIQUE
  ...
```

不变量：

- `absolute_root_path` 存用户选择的原值；打开资源库时用 `realpathSync` 解析，失效则 `status = offline` 且整组资产 `availability = missing`。
- `source_device_hint` 记录设备信息（macOS 用 `stat.dev`/卷名，Windows 用卷标），用于跨设备重新指定时的提示；不作为身份键。
- `linked_folders.path_identity` 用 `portablePathIdentity(absolute_root_path)` 规范化，避免同一根重复链接；跨平台路径等价见 `library-rules.ts`。
- linked 资产的 `relative_file_path` 始终相对其链接根，使用 `/` 规范分隔；实际路径通过 Worker 安全解析（`path.resolve(root, ...relative)` 并验证仍位于根内、无符号链接逃逸）。
- CHECK 约束强制 `managed_folder_id` 与 `linked_folder_id` 互斥：`CASE WHEN location_kind='managed' THEN linked_folder_id IS NULL WHEN location_kind='linked' THEN managed_folder_id IS NULL AND linked_folder_id IS NOT NULL END`。

## 导入协议

Renderer 只发语义请求：

```text
RequestImportFolderAsLinked { libraryId, displayName? }
RelinkMissingFolder { libraryId, folderId }
ListLinkedFolders { libraryId }
ListAssets { libraryId, folderId?, recursive }   // 复用切片 0002，folderId 可指向 linked_folder
```

Main 通过系统选择器获得源根路径并发送内部 `ImportFolderAsLinked`。Worker 枚举源目录、应用默认过滤、在单个 SQLite 事务内插入 `linked_folders` 行与全部 linked `assets`/`revisions`。不复制字节、不建 staging、不产生 `file_operations` 行（无磁盘副作用需要回滚，只有数据库行；事务失败即整体回滚）。

## 外部变化

- 复用切片 0002 的 watcher：除观察 `Assets/` 外，再观察每个 `available` 链接文件夹的根目录。链接文件夹的观察事件同样只触发去抖 stat-based 刷新，事件 payload 路径不直接改库。
- 刷新以数据库路径和当前 stat 为准：
  - linked 资产相对路径在源根下不存在 → `availability = missing`。
  - 存在且大小或修改时间变化 → 创建 `external_change` revision，更新当前 revision。
  - 源根目录本身 `realpathSync` 失败或不再是目录 → 整组 linked 资产标 `missing`，`linked_folders.status = offline`。
- 重新指定根目录后，`status` 恢复 `available`，按相对路径逐项重新校验。

## 丢失与重新指定

- `linked_folders.status = offline` 时，资产保留 `asset_id`、revision、所有元数据。
- `RelinkMissingFolder`：用户选新根，Worker 校验新根是目录、不逃逸、非符号链接；更新 `absolute_root_path`、`source_device_hint`、`path_identity`、`status = available`；按相对路径逐项校验，存在的恢复 `available` 并生成 `external_change` revision，仍不存在的保留 `missing`。
- 本切片不做批量重新定位（`RelinkMissingAssets`，切片 0007）；仅整组链接文件夹重新指定。

## 测试接缝

- schema v3→v4 migration、重复打开幂等、migration 事务回滚与 checksum 篡改。
- 链接导入：源目录枚举、默认过滤命中（.git/node_modules 等不形成资产）、符号链接拒绝、逃逸路径拒绝。
- linked 资产列表与 scope（`linked_folder_id` 过滤、recursive 语义）。
- 外部覆盖生成 `external_change` revision；外部删除/移动标 `missing`。
- 源根失效 → 整组 `missing` + `status = offline`；重新指定后恢复。
- 关闭重开后链接资产身份不变。
- Renderer 不能提交源绝对路径；`linked_folders` 的 `absolute_root_path` 不跨 IPC 暴露给 Renderer（仅 `displayName` + `status` + `folderId`）。
- 默认过滤规则集可扩展（数据结构测试，为图形编辑器预留）。
- Electron 用户流：链接导入、外部覆盖刷新、根失效与重新指定。
- 错误可观测性：Renderer 不接收绝对路径，界面给具体原因，日志保留系统错误码与 cause 链。

## 完成标准

- 全部自动化门禁通过；macOS 打包链接导入冒烟有明确结果，Windows 保留为显式未验证项。
- 链接资产身份在外部变化和重新指定后保持。
- 不存在指向缺失源文件却标记 available 的成功链接导入记录。
- 默认过滤规则命中 `.git`/`node_modules` 等不形成资产。
- 开发日志、双轴审查与 QA 报告完整。
