# 第0004垂直切片：标签、合集与资产元数据编辑

> 状态：实现与 macOS 开发态验收完成；packaged smoke 与 Windows QA 保留条件
> 日期：2026-07-13

## 目标

让用户为资产创建和管理标签、合集与智能合集，并通过元数据编辑面板设置 Label、描述、评分、喜欢状态、人工色卡和源链接。人工元信息与资产身份绑定，不因文件内容替换丢失；合集提供跨文件夹的虚拟策展视图；智能合集定义可保存为查询模板供后续切片执行。沿用切片 0002/0003 的 portable path identity、stat-based 刷新和 operation manifest 模式。

本切片仅定义组织层数据模型和用户元数据操作；标签/合集表的建立为切片 0005（搜索/过滤/排序/智能合集执行）和切片 0009（AI 自动分类）提供基础结构。

## 用户主线

1. 在资源库中创建、重命名或删除标签。
2. 为一项或多项资产批量添加/移除标签。
3. 创建树状合集，设置名称、描述和封面资产；在合集之间拖拽排序。
4. 向合集添加资产并从合集中移除资产（不删除资产本身）；合集内手动排序资产。
5. 打开父合集时默认汇总自身及所有后代合集资产；可切换为"仅当前层"。
6. 创建/编辑/删除智能合集（保存查询与排序定义，不执行）。
7. 在资产详情面板中查看和编辑 Label、描述、评分（0-5 星）、喜欢状态、源链接和人工色卡。
8. 元数据更新使用乐观锁：基于旧版本提交时拒绝静默覆盖并提示用户刷新。

## 范围

### 包含

- schema v5 migration runner：保留 migration checksum 审计。
- `tags`、`human_asset_tags`、`ai_asset_tags`（结构就位，AI 写入推迟到切片 0009）、`asset_metadata`、`collections`、`collection_assets`、`smart_collections` 表。
- 标签 CRUD：创建、重命名、删除（级联清理 `human_asset_tags` 和 `ai_asset_tags`）；库内以不区分大小写（NOCASE）的名称唯一。
- 标签分配/移除：支持单资产或批量的资产-标签关系变更；重复分配与移除不存在的标签幂等或报错。
- AssetMetadata 读写：Label、描述、评分（0-5 整数）、喜欢（布尔）、人工色卡（JSON 颜色数组）、源链接 URL。
- 乐观并发控制：`entity_version` 字段；set 操作要求 `expectedVersion`，不匹配时返回 `VERSION_CONFLICT`。
- 合集 CRUD：树状层级，同父下按 position 排序；更新名称、描述、封面资产和位置。
- 合集资产成员管理：添加、移除、手动重排序；父合集默认递归汇总子合集资产并去重。
- 智能合集 CRUD：名称、查询定义（JSON）、排序定义（JSON）；本切片不执行查询。
- AssetSummary 扩展：新增 `label`、`rating`、`favorite` 字段（从 `asset_metadata` 计算）。
- Renderer 标签面板、合集侧边栏区域、智能合集列表、资产元数据编辑面板。
- Worker 集成测试（乐观锁、级联删除、批量操作）、Electron 用户流测试。

### 不包含

- AI 标签生成与 AI 内容层写入（切片 0009）；`ai_asset_tags` 和 `aicontent` 表仅建表，本切片不写入。
- 搜索、过滤、排序与智能合集查询执行（切片 0005）。
- FTS5 索引建立（切片 0005 在标签/合集表基础上构建）。
- 缩略图、视频预览、自动色卡提取（切片 0006）；人工色卡可编辑，自动色卡属 RevisionArtifact。
- 回收站、手动找回与批量重新定位（切片 0007）。
- 浏览器扩展采集（切片 0008）。
- 标签同义词治理、标签合并与批量编辑元数据覆盖（后续切片）。

## schema v5

```text
tags
  tag_id TEXT PK
  library_id TEXT NOT NULL REFERENCES library(library_id)
  name TEXT NOT NULL COLLATE NOCASE
  created_at TEXT NOT NULL
  UNIQUE (library_id, name COLLATE NOCASE)

human_asset_tags
  asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE
  tag_id TEXT NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE
  PRIMARY KEY (asset_id, tag_id)

ai_asset_tags
  asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE
  tag_id TEXT NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE
  revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL
  model_id TEXT NOT NULL
  model_version TEXT NOT NULL
  PRIMARY KEY (asset_id, tag_id)

asset_metadata
  asset_id TEXT PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE
  label TEXT
  description TEXT
  rating INTEGER NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5)
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1))
  palette TEXT
  source_page_url TEXT
  entity_version INTEGER NOT NULL DEFAULT 1
  updated_at TEXT NOT NULL

collections
  collection_id TEXT PRIMARY KEY
  library_id TEXT NOT NULL REFERENCES library(library_id)
  parent_id TEXT REFERENCES collections(collection_id) ON DELETE CASCADE
  name TEXT NOT NULL
  description TEXT
  cover_asset_id TEXT REFERENCES assets(asset_id) ON DELETE SET NULL
  position INTEGER NOT NULL DEFAULT 0
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL

collection_assets
  collection_id TEXT NOT NULL REFERENCES collections(collection_id) ON DELETE CASCADE
  asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE
  position INTEGER NOT NULL DEFAULT 0
  PRIMARY KEY (collection_id, asset_id)

smart_collections
  smart_collection_id TEXT PRIMARY KEY
  library_id TEXT NOT NULL REFERENCES library(library_id)
  name TEXT NOT NULL
  query_definition TEXT NOT NULL
  sort_definition TEXT NOT NULL
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL
```

不变量：

- `asset_metadata` 与 `assets` 为 1:1 行，资产创建时（通过触发器或在 import/resolve 中显式 INSERT）自动初始化默认行。
- `palette` 为 JSON 字符串数组，如 `'["#FF0000","#00FF00","#0000FF"]'`，允许 `NULL`（无人工色卡）。
- `entity_version` 从 1 起递增；更新元数据时要求 `expectedVersion` 匹配当前值，不匹配返回 `VERSION_CONFLICT` 且不写入。删除资产时 `asset_metadata` 级联删除。
- `human_asset_tags` 与 `ai_asset_tags` 互不依赖；同一资产-标签对可同时存在人工和 AI 记录。本切片仅操作 `human_asset_tags`；`ai_asset_tags` 由切片 0009 写入。
- 标签 `name` 的 NOCASE 唯一性在 `library_id` 作用域内约束；不同资源库的标签互不冲突。
- 合集 `parent_id` 为 NULL 时为根合集；`ON DELETE CASCADE` 确保删除父合集时子合集被移除（仅删除合集结构，不删除资产）。
- 合集资产 `position` 从 0 起，同一 `collection_id` 内唯一；重排序时整体替换成员 position 数组。
- 父合集资产列表默认递归汇总：`collection_id = ? OR parent_id = ?` 的并集，资产去重（同资产出现在多个子合集中只出现一次）。切块开关由 Renderer 维护，Worker 返回当前层还是递归层由请求参数 `recursive` 控制。
- 智能合集 `query_definition` 和 `sort_definition` 为 JSON 文本，schema 由切片 0005 定义；本切片仅存储，不校验结构完整性也不执行查询。
- 迁移时不对既存资产回填元数据行——新建表后由触发器保证新插入资产的默认行；本切片提供 `backfillAssetMetadata` 显式命令为历史资产补齐默认行。

## 协议

Renderer 语义请求（不含内部 ID 以外的绝对路径）：

```text
tag.list { libraryId }
tag.create { libraryId, name }
tag.rename { libraryId, tagId, name }
tag.delete { libraryId, tagId }
tag.assign { libraryId, assetIds[], tagIds[] }
tag.remove { libraryId, assetIds[], tagIds[] }

collection.list { libraryId }
collection.create { libraryId, parentId?, name }
collection.update { libraryId, collectionId, name?, description?, coverAssetId?, position? }
collection.delete { libraryId, collectionId }
collection.assets.add { libraryId, collectionId, assetIds[] }
collection.assets.remove { libraryId, collectionId, assetIds[] }
collection.assets.reorder { libraryId, collectionId, orderedAssetIds[] }
collection.assets.list { libraryId, collectionId, recursive }

smart-collection.list { libraryId }
smart-collection.create { libraryId, name, queryDefinition, sortDefinition }
smart-collection.update { libraryId, smartCollectionId, name?, queryDefinition?, sortDefinition? }
smart-collection.delete { libraryId, smartCollectionId }

asset.metadata.get { libraryId, assetId }
asset.metadata.set { libraryId, assetId, expectedVersion, label?, description?, rating?, favorite?, palette?, sourcePageUrl? }
asset.metadata.backfill { libraryId }
```

Main 将 Renderer 请求中的 `libraryId` 和语义参数透传为 Worker 内部命令（同结构，type 改为 `tag.list` 等）。Worker 返回 discriminated union：`{ ok: true, type: 'tag.list', tags: TagSummary[] }` 或 `{ ok: false, error: PublicError }`。

`AssetSummary` 扩展为：

```text
assetId, managedFolderId?, linkedFolderId?, locationKind,
relativeFilePath, displayName, currentRevisionId, byteSize,
modifiedAt, availability,
label?, rating, favorite
```

`TagSummary`：

```text
tagId, name, assetCount
```

`CollectionSummary`：

```text
collectionId, parentId?, name, description?, coverAssetId?, position, assetCount, childCollectionCount
```

`SmartCollectionSummary`：

```text
smartCollectionId, name, queryDefinition, sortDefinition
```

`AssetMetadataResult`：

```text
assetId, label?, description?, rating, favorite, palette?, sourcePageUrl?, entityVersion, updatedAt
```

## 乐观并发控制

`asset.metadata.set` 要求 `expectedVersion` 参数。Worker 执行：

```text
UPDATE asset_metadata
SET label = ?, description = ?, ..., entity_version = entity_version + 1, updated_at = ?
WHERE asset_id = ? AND entity_version = ?
```

若 `changes === 0`（版本不匹配或行不存在），返回 `VERSION_CONFLICT` 错误并附带当前 `entityVersion`，由 Renderer 提示用户基于最新值重新编辑，不静默覆盖。

## 测试接缝

- schema v4→v5 migration、重复打开幂等、migration 事务回滚与 checksum 篡改。
- 标签 NOCASE 唯一约束、跨资源库隔离、删除标签级联清理 `human_asset_tags`。
- 标签批量分配/移除：幂等（重复分配不报错）、不存在资产/标签报错、空数组不操作。
- AssetMetadata：默认值（rating=0, favorite=0）、rating 边界 0-5、palette JSON 格式校验、sourcePageUrl 可选。
- 乐观锁：版本匹配则更新成功且 `entity_version` 递增 1；版本不匹配返回 `VERSION_CONFLICT`；并发写入通过 `expectedVersion` 序列化。
- 合集树：创建、嵌套（父子关系）、重命名、更新描述/封面、删除级联子孙合集（资产不删除）。
- 合集资产成员：添加去重、移除、reorder（全量替换 position 数组）、recursive 列表去重。
- 智能合集：CRUD、名称唯一、查询/排序定义以 JSON 原样存取。
- AssetSummary 扩展：`label`、`rating`、`favorite` 正确左连接 `asset_metadata`；无元数据行的历史资产返回默认值。
- `backfillAssetMetadata`：为所有缺少元数据行的资产创建默认行；幂等（重复调用不报错）。
- Renderer 不能提交标签 ID 以外的内部标识；`palette` 和 `description` 长度校验由 Zod schema 保证（description 上限 10000 字符，palette 上限 20 色）。
- Electron 用户流：创建标签并分配给资产、构建合集树并添加资产、编辑详情面板元数据、乐观锁冲突提示。
- 错误可观测性：Renderer 接收具体原因，应用日志保留完整错误链。

## 完成标准

- 全部自动化门禁通过；macOS 打包元数据编辑冒烟有明确结果，Windows 保留为显式未验证项。
- 标签、合集与元数据操作在关闭重开资源库后完整保持。
- 删除标签级联清理关系但不误删资产；删除合集级联子孙合集但不删除资产。
- 乐观锁版本冲突不静默覆盖；并发写入按 `entityVersion` 正确序列化。
- 不存在指向已删除标签的 `human_asset_tags` 行。
- 开发日志、双轴审查与 QA 报告完整。
