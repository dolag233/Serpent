# Desktop Console 脚本 API 参考

本页是当前 Desktop Console 实际注入的 `serpent` API 逐项参考。方法调用均返回 Promise；输入会由 Automation Command Registry 严格校验。参数错误、资源不存在、权限/计划拒绝和并发冲突会以异常方式报告，脚本应使用 `try/catch` 处理并在需要时重新读取状态。

## 通用类型

```ts
interface Page<T> {
  items: readonly T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

interface Asset {
  id: string;
  name: string;
  currentRevisionId: string;
  rating: number;
  favorite: boolean;
  locationKind: 'managed' | 'linked';
  folderId: string | null;
}
```

### 错误处理

Host 命令失败会以异常方式进入脚本的 `catch`。错误对象至少包含稳定的 `code` 和安全的 `message`；PublicError 还可能包含 `reason`，版本冲突会包含 `currentEntityVersion`。未知的宿主内部异常统一使用 `INTERNAL_ERROR`，不会把路径、数据库或进程诊断泄露给脚本。

```ts
try {
  await serpent.assets.setRating(assetIds, 4);
} catch (error) {
  if (error.code === 'AUTOMATION_CAPABILITY_DENIED') {
    console.log('当前脚本没有所需权限');
  } else if (error.code === 'ASSET_NOT_FOUND') {
    console.log('资产已经不存在，跳过');
  } else {
    throw error;
  }
}
```

常见 Gateway 错误码包括 `AUTOMATION_INVALID_REQUEST`、`AUTOMATION_CAPABILITY_DENIED`、`AUTOMATION_LIBRARY_NOT_BOUND`、`AUTOMATION_EXECUTION_CANCELLED` 和 `AUTOMATION_EXECUTION_TIMED_OUT`；具体命令也可能返回 `ASSET_NOT_FOUND`、`FOLDER_NOT_FOUND`、`VERSION_CONFLICT`、`CANCELLED` 等 PublicError。脚本应按错误码决定是否提示、重新读取或停止，不要仅按英文文案判断。

分页默认 `limit=50`，最大 `limit=200`；`offset` 从 0 开始。批量数组通常最多 10,000 项，具体以 Registry Schema 为准。`currentRevisionId` 是文件内容修订 token；元数据写入使用 `entityVersion`，两者不可混用。

## `library`

### `library.inspect()`

返回 `{ libraryId: string; displayName: string }`。不返回资源库路径。必须已绑定资源库。

### `library.changeSequence()`

返回 `{ changeSequence: number }`。这是当前资源库的单调变更序号，用于复核并发变化；不是锁、事务或版本回滚点。

### `library.create(input)`

未绑定资源库时可调用；成功后宿主绑定新库。

```ts
serpent.library.create({
  displayName: string,          // 非空，最长 255
  selectedParentPath: string,  // 非空；由用户选择的父目录
  idempotencyKey?: string,     // 非空白，最长 128
}): Promise<{ libraryId: string; displayName: string }>
```

需要本机计划确认。重复调用时，只有同一执行、同一命令、同一 key 和完全相同参数才可复用结果；参数变化会拒绝。脚本只获得结果摘要，不获得父目录或库路径。

## `files`

### `files.import(input)`

```ts
serpent.files.import({
  sourceKind: 'files' | 'folder',
  sourcePaths: readonly string[], // 由用户/调用者提供的路径；结果不回显路径
  targetFolderId?: string,
  imageSequenceFps?: number,      // 整数 1..240
  expandImageSequences?: boolean, // 默认 false
  idempotencyKey?: string,        // 非空白，最长 128
}): Promise<ImportResult>
```

`sourcePaths` 至少 1 项，最多 1,000 项。需要本机计划确认；同名/疑似重复可能先返回冲突计划，成功结果区分文件数、资产数、跳过和替换。

```ts
type ImportResult =
  | { status: 'conflicts'; plan: {
      importId: string; fileCount: number; totalBytes: number;
      suspectedDuplicateCount: number; libraryDuplicateCount: number;
      nameConflictCount: number;
    } }
  | { status: 'completed'; completion: {
      importedCount: number; fileCount: number; assetCount: number;
      skippedCount: number; replacedCount: number;
      assets: readonly Asset[];
    } };
```

长导入超时后先查询执行/库状态；不要改用新 key 重提同一导入。

## `folders` 与 `linkedFolders`

### `folders.list(input?)`

```ts
serpent.folders.list({ limit?: number; offset?: number }): Promise<Page<{
  id: string; parentId: string | null; name: string;
}>>
```

只返回资源库文件夹的 ID/父子关系/名称。

### `folders.create(name, parentFolderId?)`

```ts
serpent.folders.create(
  name: string,
  parentFolderId?: string | null,
): Promise<{ id: string; parentId: string | null; name: string }>
```

创建空文件夹；需要执行级授权。它不会把已有资产分类到该文件夹。

### `linkedFolders.list(input?)`

返回 `Page<{ id: string; name: string; status: 'available' | 'offline'; assetCount: number }>`。不返回链接文件夹的绝对根路径。

## `assets`：查询

### `assets.search(input)`

```ts
serpent.assets.search({
  query: string | null,
  limit?: number,
  offset?: number,
  filters?: readonly unknown[],
  scope?: unknown,
  sort?: unknown,
}): Promise<Page<Asset> & { snippets?: readonly { assetId: string; text: string }[] }>
```

脚本最稳定的用法是工具栏同款字符串，例如 `tag:抽象`、`name:rain | tag:rain`；`name:` 会归一为 `filename`。`null` 搜索当前资源库的非回收站资产。Registry 还接受结构化 `filters`/`scope`/`sort`，其完整 JSON Schema 由 Registry 生成；当前独立脚本声明对这些字段使用宽类型，不能假定未声明的字段形状。

### `assets.list(input?)`

```ts
serpent.assets.list({
  folderId?: string,
  recursive?: boolean, // 默认 false
  limit?: number,
  offset?: number,
}): Promise<Page<Asset>>
```

### `assets.getMetadata(assetId)`

返回：

```ts
{
  assetId: string;
  description: string | null;
  rating: number;
  favorite: boolean;
  palette: string | null;
  automaticPalette: readonly { hex: string; ratio: number }[];
  effectivePalette: readonly string[];
  paletteSource: 'manual' | 'automatic' | null;
  sourcePageUrl: string | null;
  author: string | null;
  tags: readonly { id: string; name: string; source: 'user' | 'ai' }[];
  entityVersion: number;
  updatedAt: string;
}
```

### `assets.getAiContent(assetId)`

返回 `{ assetId, description: string | null, tags: readonly string[], rating: number | null, modelVersion: string | null }`。这是 AI 内容层，不会覆盖人工 metadata。

### `assets.getExtractedMetadata(assetId)`

返回格式专属提取元数据；当前 Registry 结果是 `unknown`，调用者必须按实际资产格式和返回值做防御性处理，不要把它当成稳定跨格式对象。

## `assets`：元数据与评分

### `assets.setMetadata(input)`

```ts
serpent.assets.setMetadata({
  assetId: string,
  expectedVersion: number,
  description?: string | null,  // 最长 10,000
  rating?: 0 | 1 | 2 | 3 | 4 | 5,
  favorite?: boolean,
  sourcePageUrl?: string | null,
  author?: string | null,
}): Promise<AssetMetadata>
```

先读取 `getMetadata()` 的 `entityVersion`，再作为 `expectedVersion` 写入。版本冲突应重新读取后决定是否重试。它不是文件内容 revision。

### `assets.setRating(assetIds, rating)`

批量设置 0..5 星，返回 `{ updatedCount: number; skipped: readonly unknown[] }`。需要执行级授权；检查 `skipped`，不能只看成功 Promise。

## `assets`：文件内容与位置

### `assets.readContent(assetId, options?)`

```ts
serpent.assets.readContent(assetId, { maxBytes?: number }): Promise<{
  assetId: string; revisionId: string; byteSize: number;
  dataBase64: string; truncated: boolean; mimeType: string | null;
}>
```

这是受限的 Base64 读取，不是任意 filesystem 读取；默认/最大字节预算由内容 Registry 常量限制，`truncated` 为 true 时不能当作完整文件。

### `assets.replaceContent(assetId, dataBase64, options?)`

```ts
serpent.assets.replaceContent(assetId, dataBase64, {
  expectedRevisionId?: string,
  mimeHint?: string,
}): Promise<{ assetId: string; revisionId: string; byteSize: number }>
```

需要文件计划确认。`expectedRevisionId` 用于防止覆盖读取之后已变化的内容；大内容应使用 staging，而不是拼接超大的单次调用。

### `assets.stageContent(assetId, dataBase64, options?)`

```ts
serpent.assets.stageContent(assetId, dataBase64, {
  stagingToken?: string,
  complete?: boolean, // 默认 false
}): Promise<{ stagingToken: string; assetId: string; byteSize: number; complete: boolean }>
```

分块暂存本身不提交最终替换；拿到 `stagingToken` 后再用 `replaceContentBatch` 提交。不要把 staging token 当作文件路径或长期凭据。

### `assets.replaceContentBatch(items)`

每项必须是 `{ assetId, dataBase64, expectedRevisionId }` 或 `{ assetId, stagingToken, expectedRevisionId }`；asset ID 不得重复。返回 `{ operationId, items: { assetId, revisionId, byteSize }[] }`，需要文件计划确认。

### `assets.moveToFolder(assetIds, targetFolderId, options?)`

```ts
serpent.assets.moveToFolder(assetIds, targetFolderId, {
  conflictStrategy?: 'keep-both' | 'replace' | 'skip',
}): Promise<{
  movedCount: number; skippedCount: number;
  operationId: string | null; assets: readonly Asset[];
}>
```

需要计划确认。`targetFolderId` 可为 `null` 表示资源库根范围。移动保留资产 ID 与元数据；应检查跳过项和 `operationId`。

### `assets.renameFile(assetId, newBaseName)`

重命名单项，返回当前资产摘要；`newBaseName` 非空、最长 255。需要计划确认。扩展名由当前文件处理规则保留，不要把绝对路径传入。

### `assets.renameFiles(items)`

`items` 为不重复的 `{ assetId, newBaseName }[]`，最多 10,000 项。返回 `{ renamedCount, skipped, assets }`；`skipped.reason` 可能是 `asset_not_found`、`asset_unavailable`、`name_conflict` 或 `invalid_name`。需要一份批量计划确认；局部冲突不会自动回滚已成功项。

### `assets.copyFilePaths(assetIds)`

返回 `{ copiedCount: number }`。Main 将路径写入系统剪贴板，脚本、Console 返回值和日志不包含这些路径；这是唯一面向外部系统的受控效果。需要执行级授权。

### `assets.moveToTrash(assetIds)`

返回 `{ trashedCount: number; operationId: string }`。需要计划确认；这是移入 Serpent 回收站，不是永久删除。命令提交后，Console 宿主会同时收到 Worker 生成的 `historyEntryId`，撤回/重做走资源库统一操作历史；`operationId` 只是文件转换恢复日志引用，脚本正文不能拿它重放操作。

## `trash`

### `trash.list(input?)`

返回 `Page<Asset>`，列出回收站资产。

### `trash.restoreIfOriginalVacant(assetIds)`

需要计划确认。返回稳定结果包含 `restoredCount`、`skippedCount`、`skipped` 和 `assets`；跳过原因包括 `original_folder_missing`、`name_conflict`、`trash_file_missing`。只在原位置可用时恢复。

## `tags`

- `tags.list({ limit?, offset? })` → `Page<{ id: string; name: string; assetCount: number }>`。
- `tags.create(name)` → 新建标签对象（至少包含 `id`、`name`）；执行级授权。
- `tags.assign(assetIds, tagIds)` → `{ assignedCount, skipped }`；执行级授权。
- `tags.remove(assetIds, tagIds)` → `{ removedCount, skipped }`；执行级授权。

批量 ID 至少一项；创建标签不会自动给资产打标签。

## `collections` 与 `smartCollections`

- `collections.list({ limit?, offset? })` → `Page<{ id; parentId; name; description; assetCount; childCollectionCount }>`。
- `collections.create(name, parentId?)` → 新合集对象；执行级授权。
- `collections.getMemberships(assetIds, { limit?, offset? })` → `Page<{ assetId: string; collectionId: string }>`。
- `collections.addAssets(collectionId, assetIds)` → `{ collectionId }`；执行级授权。
- `collections.removeAssets(collectionId, assetIds)` → `{ collectionId }`；执行级授权。
- `smartCollections.list({ limit?, offset? })` → `Page<{ id; name; queryDefinition; assetCount }>`，只读。

当前公共脚本 API 不提供智能合集创建/修改，也不提供任意合集查询表达式执行。

## `palettes`

### `palettes.mostFrequent(input?)`

```ts
serpent.palettes.mostFrequent({ days?: number; limit?: number }): Promise<{
  days: number; assetCount: number; paletteAssetCount: number;
  colors: readonly { hex: string; weight: number; assetCount: number }[];
}>
```

`days` 默认 2、范围 1..3650；`limit` 默认 12、最大 24。只汇总已有本地自动色卡，不会触发 AI。

## `ui`

### `ui.notify(input)`

```ts
serpent.ui.notify({
  severity: 'info' | 'warning' | 'error',
  message: string, // 1..500
  mode?: 'toast' | 'dialog', // 默认 toast
  title?: string, // 1..120
}): Promise<{ shown: true; mode; severity }>
```

可在无绑定资源库的执行中调用。`dialog` 是 Desktop 提示，不是脚本获得的任意 UI 控制。

## 错误、取消和执行限制

运行时失败码包括 `SOURCE_NOT_ALLOWED`、`SOURCE_TOO_LARGE`、`CPU_TIMEOUT`、`WALL_TIMEOUT`、`CANCELLED`、`MEMORY_LIMIT`、`OUTPUT_LIMIT`、`HOST_CALL_LIMIT`、`PROMISE_LIMIT`、`RUNTIME_ERROR`。Gateway 错误以公开错误消息呈现，内部路径/授权细节会脱敏。

默认宿主预算：CPU 10 秒、墙钟 60 秒、内存 64 MiB、输出 1 MiB、最多 4 个并发命令、最多 128 个未完成 Promise。停止按钮、关闭 Console 或 Renderer 销毁会取消执行；取消不会把未完成命令伪装成成功。

文件计划确认只在 Desktop/Main 完成。脚本正文不能消费内部 plan hash、state token、recipe 或文件恢复引用；Console 宿主可按 `executionId` 撤回本次执行记录的全部 Worker `historyEntryId`，按提交的逆序调用统一 `history.undo`，并返回已撤回计数。遇到栈顶变化或前置条件冲突时会安全停止并返回 stale 错误，不会跳过冲突条目继续撤回更早操作。

## Console 宿主控制 API（不是脚本正文 API）

Desktop Console 自己还通过 typed Host bridge 管理脚本文件和执行生命周期。这组方法供 Console/宿主 UI 使用，**不会注入脚本正文**；脚本正文不能调用 `open()`、`start()` 或 `command()` 来绕过当前运行授权。

```ts
interface SerpentAutomationScriptApi {
  open(): Promise<AutomationScriptFileResult>;
  save(input: { source: string }): Promise<AutomationScriptFileResult>;
  recentList(): Promise<AutomationRecentScriptsListResult>;
  openRecent(input: { handle: string }): Promise<AutomationScriptFileResult>;
  start(input: { libraryId: string | null; source: string; scriptId?: string }): Promise<AutomationScriptStartResult>;
  execute(input: { executionId: string }): Promise<AutomationScriptExecuteResult>;
  command(input: { executionId: string; commandId: SerpentAutomationCommandId; input: unknown }): Promise<AutomationScriptCommandResult>;
  complete(input: { executionId: string; succeeded: boolean; cancelled?: boolean }): Promise<void>;
  cancel(input: { executionId: string }): Promise<void>;
  history(input: { libraryId: string; limit?: number }): Promise<AutomationScriptHistoryResult>;
  undo(input: { executionId: string; undoGroupId?: string }): Promise<AutomationScriptUndoResult>;
}
```

`scriptId`、`handle` 和 `executionId` 都是由 Main 签发的 opaque ID，不是路径、授权凭据或可自行生成的替代值。`undoGroupId` 仅为旧版本执行记录保留的兼容参数；新执行不把 Main JSON Undo Group 当作恢复权威，统一使用资源库 Worker 的 `historyEntryId`。文件 API 只处理 `.serpent.js` / `.serpent.ts`，源文本上限 64 KiB；结果中的文件名和错误码可供 UI 展示，但绝对路径不会返回给 Renderer 或脚本正文。

## 不是当前脚本 API 的东西

`serpent.jobs`、`execution.status`、MCP 的 `serpent_execution_status`、资源库变更通知、MCP resource URI、`serpent_desktop_*` 工具以及插件的 `setup`/events/hooks/providers/jobs/input/storage 都不是当前 Desktop Console 脚本公共 API。Registry 或 `automation-api.d.ts` 出现某个命令，不等于 guest API 已投影该命令；新增命令必须同时更新 Registry、Gateway、guest 投影、类型声明、测试和文档。
