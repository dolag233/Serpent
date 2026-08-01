# 自动化脚本使用说明（开发态）

> 入口：打开资源库后，在工作区右上角的“更多工具”中选择“自动化脚本”。
>
> 这是交互式 JavaScript / TypeScript Console，不需要先创建脚本文件。可以把已验证的 Console 代码保存为 `.serpent.js` 或 `.serpent.ts`，也可以重新打开它。脚本按 **headless 可运行** 理解：可以没有已打开的资源库（例如先 `library.create` 再建文件夹并导入）。脚本只通过注入的 `serpent` 领域 Action 调用 Gateway；没有 Node、任意文件系统、原始网络、环境变量、SQL 或任意 IPC 权限。MCP 暴露的领域 Action 与 Console 相同，差别只在调用者（人 vs Agent）。需要控制已打开 Desktop 的窗口或网格选中状态时，使用附着 MCP；这不是脚本 API。

## 运行与确认

- 未保存的 Console 代码每次点击“运行”都会先确认它可读取资产/标签/合集、修改评分、创建标签或空文件夹、复制路径、重命名或移入回收站。保存脚本首次运行也会确认；之后仅当脚本文本、目标资源库或所需能力改变时才会再次确认。
- 评分、标签整理和空文件夹创建在本次运行授权后执行。
- 每一条真实文件操作会再显示一次**计划确认**。计划只显示数量、冲突/不可执行数量和能否撤销，不泄露文件绝对路径；确认后如果资源库发生变化，Worker 会拒绝过期计划，而不是继续操作旧目标。
- “移入回收站”可从 Serpent 回收站恢复；自动化不会永久删除任何文件。
- 脚本运行、拒绝和失败会记录到应用日志；脚本不会得到绝对路径。复制路径是唯一例外：路径由 Main 直接写入系统剪贴板，脚本只收到复制数量。
- “保存脚本”和“打开脚本”只显示文件名，不会把选择的绝对路径传给 Console。保存或打开时，Main 会签发一个仅对当前窗口和当前文本有效的临时句柄；编辑文本后该句柄立即失效，不能借用已保存脚本的持久授权。

脚本每次最多读取 200 项。下面示例都用分页，适用于较大的资源库。

## 可用 API

```ts
serpent.library.inspect()
// -> { libraryId, displayName }（不含资源库路径）

serpent.library.create({ displayName, selectedParentPath })
// -> { libraryId, displayName }；仅未绑定 headless 执行可调用

serpent.files.import({
  sourceKind: 'files' | 'folder',
  sourcePaths,
  targetFolderId?,
  imageSequenceFps?,
  expandImageSequences?, // 仅控制导入时是否按序列展开源文件；默认 false
})
// -> { status: 'conflicts', plan } 或 { status: 'completed', completion }
// completion.fileCount / assetCount 分别表示导入文件和逻辑资产

serpent.folders.list({ limit?, offset? })
// -> { items: [{ id, parentId, name }], total, offset, limit, hasMore }
serpent.folders.create(name, parentFolderId?)
// -> { id, parentId, name }
// 注意：当前没有「把已有资产移动到文件夹」的脚本/MCP Action；创建文件夹 ≠ 完成分类

serpent.linkedFolders.list({ limit?, offset? })
// -> { items: [{ id, name, status, assetCount }], ... }（不含绝对路径）

serpent.tags.list({ limit?, offset? })
serpent.tags.create(name)
serpent.tags.assign(assetIds, tagIds)
serpent.tags.remove(assetIds, tagIds)

serpent.collections.list({ limit?, offset? })
serpent.collections.getMemberships(assetIds, { limit?, offset? })
serpent.collections.create(name, parentId?)
serpent.collections.addAssets(collectionId, assetIds)
serpent.collections.removeAssets(collectionId, assetIds)

serpent.smartCollections.list({ limit?, offset? })

serpent.jobs.media.list({ limit?, offset? })
serpent.jobs.ai.status({ jobIds?, limit?, offset? })
serpent.jobs.ai.enqueue({ assetIds?, folderId?, resumePaused? })
// AI 只负责理解/建议（描述、标签等）；不直接移动文件夹或静默改磁盘位置

serpent.assets.search({ query, limit?, offset? })
// Console / 脚本：query 为工具栏同款字符串或 null，例如 'tag:抽象'、'name:Ser | tag:Ser'
// MCP：可同样传字符串；也可直接传结构化 SearchQuery（field 用 filename，不是 name）
// 结构化示例：{ query: { clauses: [{ field: 'filename', values: ['sunny'], exclude: false }] } }
// name: 是 UI 别名，会归一到 filename；子串匹配可能让 rain 命中 rainbow
serpent.assets.list({ folderId?, recursive?, limit?, offset? })
// -> { items: [{ id, name, currentRevisionId, rating, favorite, locationKind, folderId }], ... }

serpent.assets.getMetadata(assetId)
// -> { tags, rating, favorite, automaticPalette, entityVersion, ... }
serpent.assets.getAiContent(assetId)
// -> { assetId, description, tags, rating, modelVersion }
// 读取当前 AI 层结果；不会把 AI 建议混入人工 metadata，也不会修改资源库
serpent.assets.getExtractedMetadata(assetId)
const metadata = await serpent.assets.getMetadata(assetId)
serpent.assets.setMetadata({
  assetId,
  expectedVersion: metadata.entityVersion,
  description?, rating?, favorite?, sourcePageUrl?, author?
})

serpent.assets.setRating(assetIds, 0 | 1 | 2 | 3 | 4 | 5)
serpent.assets.copyFilePaths(assetIds)
serpent.assets.moveToTrash(assetIds)
// -> { trashedCount, operationId }；operationId 是 Main/Worker 内部恢复引用
serpent.assets.moveToFolder(assetIds, targetFolderId, { conflictStrategy? })
// -> { movedCount, skippedCount, operationId }；需本机计划确认；保留标签/合集/评分/元数据
serpent.assets.renameFile(assetId, newBaseName)
serpent.assets.renameFiles([{ assetId, newBaseName }, ...])

serpent.trash.list({ limit?, offset? })
serpent.trash.restoreIfOriginalVacant(assetIds)

serpent.palettes.mostFrequent({ days?: 2, limit?: 12 })
```

`rating` 是用户手动评分；AI 分析评分不会覆盖它。`search({ query: null })` 搜索当前资源库所有非回收站资产。UI 搜索字段别名：`name`→`filename`，`tag`→`tags`。

`currentRevisionId` 是文件内容修订的稳定 ID：导入新文件、替换托管文件或接受链接文件的外部内容变化时切换为新的 ID；移动、重命名、回收站、恢复、评分、喜欢、标签和其他元数据修改不会改变它。`entityVersion` 只属于资产元数据行的乐观并发控制，供 `setMetadata({ expectedVersion })` 防止陈旧写入；它不是文件版本，也不应在脚本结果或 UI 中当作内容版本展示。

## 资源库变更推送（MCP）

MCP 客户端可以继续轮询 `serpent_library_change_sequence` 获取当前序号，也可以监听标准 MCP `notifications/message`。资源库发生变更且该 MCP 执行已绑定该资源库时，通知的 `data` 为：

```json
{
  "type": "library.changed",
  "libraryId": "library-id",
  "changeSequence": 42
}
```

未绑定的 MCP 执行不会收到资源库变更推送。通知不包含资源库路径或其他文件系统路径。

## 已打开 Desktop 的附着 MCP

`npm run mcp` 默认连接当前用户已经打开的 Serpent Desktop；如果没有运行实例，会先启动一个可见的 Desktop，再请求本机附着确认。连接使用当前 Desktop 的 Main/Library Worker 和当前激活资源库，不会另开一个与界面隔离的 Worker。显式使用 `npm run mcp -- --headless` 保留原来的无界面 MCP 行为，适用于 CI、指定 `--library` 和 `--unbound` 流程。

附着确认通过后，只有两个 Desktop 专用工具可用：

```text
serpent_desktop_focus()
serpent_desktop_select_assets({ assetIds, mode: "replace" | "add" | "remove" })
```

`serpent_desktop_focus` 只恢复、显示并聚焦 Serpent 主窗口。`serpent_desktop_select_assets` 只改变当前 Renderer 的资产选中状态，不写入数据库、不递增 `entity_version`/内容 `revision`、不创建文件计划或 Undo Group；网格中当前已加载的对应卡片会使用正常的选中高亮。附着 MCP 不提供任意窗口控制、DOM 注入、键鼠模拟、Shell、SQL、网络或文件系统能力。附着会话随 Desktop 退出而结束，拒绝确认不会产生库或 UI 副作用。

## Undo Group

可撤销的文件操作返回 `undoGroupId`，同一用户意图中的连续变更共享一个组。Desktop Console
可以从执行完成状态发起撤销；MCP 和脚本应保存该 ID，并把撤销结果中的
`undoneCount`、`skippedCount` 视为最终结果。部分成功或组内存在不可逆成员时，不得报告为“全部已撤销”。
重复使用已经消费的组会被拒绝。Undo Group 不提供永久删除能力，也不绕过本机计划确认。

## 常用辅助函数

```ts
async function allSearch(query: string | null) {
  const items = [];
  for (let offset = 0; ; ) {
    const page = await serpent.assets.search({ query, limit: 200, offset });
    items.push(...page.items);
    if (!page.hasMore || page.items.length === 0) return items;
    offset += page.items.length;
  }
}

async function allFolderAssets(folderId: string) {
  const items = [];
  for (let offset = 0; ; ) {
    const page = await serpent.assets.list({ folderId, recursive: true, limit: 200, offset });
    items.push(...page.items);
    if (!page.hasMore || page.items.length === 0) return items;
    offset += page.items.length;
  }
}
```

## 六个示例

引用 `allSearch()` 或 `allFolderAssets()` 的示例需要把上方对应辅助函数与示例**一起**放进同一次运行；每次 Console 运行都会使用新的沙箱，不会保留上一次定义的函数。

### 1. 将 tag 含“抽象”的资产移入回收站

```ts
const assets = await allSearch('tag:抽象');
const result = await serpent.assets.moveToTrash(assets.map((asset) => asset.id));
console.log(result);
return { matched: assets.length, ...result };
```

这是移入 Serpent 回收站，不是永久删除。运行时会显示一次计划确认。

### 2. 复制所有手动评分至少 4 星资产的文件路径

```ts
const assets = await allSearch(null);
const selected = assets.filter((asset) => asset.rating >= 4);
const result = await serpent.assets.copyFilePaths(selected.map((asset) => asset.id));
return { selected: selected.length, ...result };
```

路径已写入系统剪贴板，但返回值只包含 `copiedCount`，不会在脚本输出或日志中暴露路径。

### 3. 给指定文件夹的文件名追加第一个 tag

```ts
const folders = await serpent.folders.list({ limit: 200 });
const folder = folders.items.find((item) => item.name === '概念草图');
if (!folder) throw new Error('找不到“概念草图”文件夹。');

function baseName(name: string) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function safeSuffix(tag: string) {
  return tag.trim().replace(/[\\/:*?"<>|]/g, '-');
}

const updates = [];
for (const asset of await allFolderAssets(folder.id)) {
  const metadata = await serpent.assets.getMetadata(asset.id);
  const firstTag = metadata.tags[0]?.name;
  if (!firstTag) continue;
  const suffix = safeSuffix(firstTag);
  if (suffix) updates.push({ assetId: asset.id, newBaseName: `${baseName(asset.name)}_${suffix}` });
}

const result = updates.length === 0
  ? { renamedCount: 0, skipped: [] }
  : await serpent.assets.renameFiles(updates);
return { candidates: updates.length, ...result };
```

`renameFiles()` 会把整批作为一份计划确认；每个文件保留自己的扩展名。已有同名文件、不可用资产或不支持的名称会出现在 `skipped`，已成功的项不会因为某个局部冲突而回滚。

### 4. 汇总近 2 天新增资产最常用的自动色卡

```ts
const palette = await serpent.palettes.mostFrequent({ days: 2, limit: 12 });
console.log(palette.colors);
return palette;
```

此调用只汇总已经完成的本地自动色卡，不会发起 AI 请求。`paletteAssetCount` 小于 `assetCount` 说明部分资产的媒体后台任务仍未生成色卡；等待后台任务完成后再次运行即可得到完整汇总。

### 5. 将所有喜欢的资产设为 5 星

```ts
const assets = await allSearch(null);
const likedIds = assets.filter((asset) => asset.favorite).map((asset) => asset.id);
const result = likedIds.length === 0
  ? { updatedCount: 0, skipped: [] }
  : await serpent.assets.setRating(likedIds, 5);
return { liked: likedIds.length, ...result };
```

### 6. 恢复回收站中原位置仍空闲的资产

```ts
const trash = [];
for (let offset = 0; ; ) {
  const page = await serpent.trash.list({ limit: 200, offset });
  trash.push(...page.items);
  if (!page.hasMore || page.items.length === 0) break;
  offset += page.items.length;
}

const result = trash.length === 0
  ? { restoredCount: 0, skippedCount: 0, skipped: [] }
  : await serpent.trash.restoreIfOriginalVacant(trash.map((asset) => asset.id));
return result;
```

它只在原始托管文件夹仍存在、原始名字没有被占用且回收站文件仍存在时恢复。否则保持在回收站，并在 `skipped` 中返回 `original_folder_missing`、`name_conflict` 或 `trash_file_missing`。

### 7. 创建标签并批量打到搜索结果

```ts
const tag = await serpent.tags.create('天气-雨');
const assets = await allSearch(null);
const batch = assets.slice(0, 100).map((asset) => asset.id);
const result = batch.length === 0
  ? { assignedCount: 0, skipped: [] }
  : await serpent.tags.assign(batch, [tag.id]);
return { tag, matched: assets.length, ...result };
```

标签创建与分配在运行授权后立即执行，不走文件计划确认。

## 当前边界

### 产品边界（Console = MCP Action 面）

属于脚本 / MCP 的领域 Action（实现按切片推进，但规格上不划给“仅插件”）：

- 只读查询与任务状态。
- 低风险写入：评分、标签、空文件夹创建等（执行级授权）。
- 高风险 Action：`library.create`、`file.import`、移动/重命名、回收站等——Console 与 MCP 均需本机计划摘要与人类批准（类比管理员权限弹窗）；**禁止 Agent 或脚本自行提权**。

不属于脚本 / MCP（属插件 Contribution / 可信宿主，见 0024）：

- 注册右键菜单、工具栏、面板、自定义 UI、Hook、输入捕获、Provider。
- `storage.*` 插件命名空间存储、原始 `net.fetch`、任意 Shell / SQL / Node。
- 永久删除与整库删除（首版仍禁止）。

### 当前实现进度（会落后于产品边界）

- 已支持：只读表面、评分、元数据（含喜欢）、标签 create/assign/remove、空文件夹 create、合集 create/add/remove、AI enqueue、文件 plan（复制路径/重命名/回收站）、headless `library.create` 与 `file.import` readonly 预览及陈旧源拒绝。
- MCP：默认 `npm run mcp` 附着已打开 Desktop；无界面/指定资源库流程使用 `npm run mcp -- --headless --library <绝对路径>`，无预绑定资源库时使用 `--unbound`，写工具使用 `--write-access`。工具由 Registry 映射，plan 工具始终经 Main 本机确认；附着模式额外列出 `serpent_desktop_focus` 与 `serpent_desktop_select_assets`，headless 模式不列出 Desktop-only 工具。
- Console 显示最近执行历史，并可跳转单次运行日志。
- 文件移动和回收站写入已记录 `operationId` 并进入持久化 Undo Group；Console 的应用级
  `Ctrl/Cmd+Z` 会按 `executionId` / `undoGroupId` 请求 Main/Worker 恢复，脚本和 MCP
  仍只能消费返回的组结果，不能自行修改文件。
- **已知缺口（2026-07-31 天气图片 Agent 反馈）**：
  - 高风险本机确认若超过 MCP **客户端**默认超时，客户端会报超时而后台可能仍完成。MCP 会话墙钟上限已提高到 30 分钟；长写操作（`library.create`、计划预览）在 Main→Worker 侧使用 5 分钟请求超时。客户端应把工具调用超时设得足够长，并在超时或轮询间隙调用 `serpent_execution_status`（Registry `execution.status`）确认执行是否仍在进行或已结束，再决定是否重试。
  - `library.create` 与 `file.import` 支持可选的 `idempotencyKey`（非空白字符串，最长 128 个字符）。客户端超时后先轮询 `serpent_execution_status`；确需重试时，必须使用相同 key 和完全相同的命令参数。相同执行、命令和 key 会复用进行中的或已成功的结果；复用同一 key 但修改参数会被 `AUTOMATION_INVALID_REQUEST` 拒绝。不要为同一次未确认的写入生成新 key。
  - AI 入队已暴露；文件夹移动已接计划确认（`asset.move` / `moveToFolder`），可与 AI 分类流程组合使用。
- 已支持：计划确认的 `asset.move`（MCP `serpent_asset_move`，脚本 `serpent.assets.moveToFolder`）。
- 尚未验证：真实双 MCP Host 冒烟、当前 HEAD 的 packaged 应用脚本/MCP smoke 和 Windows。
  类型声明位于 `docs/skills/serpent-automation/automation-api.d.ts`，由 Registry
  命令 ID 与 `AUTOMATION_API_VERSION` 的打包门禁校验；文档和声明留在仓库，不强制进入 ASAR。
- 单次脚本执行仍有 CPU、内存、输出、待处理 Promise 和墙钟限制。可用“停止”或关闭窗口取消未开始的命令。
