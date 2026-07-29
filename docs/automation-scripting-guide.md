# 自动化脚本使用说明（开发态）

> 入口：打开资源库后，在工作区右上角的“更多工具”中选择“自动化脚本”。
>
> 这是交互式 JavaScript / TypeScript Console，不需要先创建脚本文件。可以把已验证的 Console 代码保存为 `.serpent.js` 或 `.serpent.ts`，也可以重新打开它。脚本只作用于本次运行时 Main 绑定的资源库；没有 Node、文件系统、网络、环境变量、SQL 或任意 IPC 权限。

## 运行与确认

- 未保存的 Console 代码每次点击“运行”都会先确认它可读取资产、修改评分、复制路径、重命名或移入回收站。保存脚本首次运行也会确认；之后仅当脚本文本、目标资源库或所需能力改变时才会再次确认。
- 评分和复制路径在本次运行授权后执行。
- 每一条真实文件操作会再显示一次**计划确认**。计划只显示数量、冲突/不可执行数量和能否撤销，不泄露文件绝对路径；确认后如果资源库发生变化，Worker 会拒绝过期计划，而不是继续操作旧目标。
- “移入回收站”可从 Serpent 回收站恢复；自动化不会永久删除任何文件。
- 脚本运行、拒绝和失败会记录到应用日志；脚本不会得到绝对路径。复制路径是唯一例外：路径由 Main 直接写入系统剪贴板，脚本只收到复制数量。
- “保存脚本”和“打开脚本”只显示文件名，不会把选择的绝对路径传给 Console。保存或打开时，Main 会签发一个仅对当前窗口和当前文本有效的临时句柄；编辑文本后该句柄立即失效，不能借用已保存脚本的持久授权。

脚本每次最多读取 200 项。下面示例都用分页，适用于较大的资源库。

## 可用 API

```ts
serpent.folders.list({ limit?, offset? })
// -> { items: [{ id, parentId, name }], total, offset, limit, hasMore }

serpent.assets.search({ query, limit?, offset? })
serpent.assets.list({ folderId?, recursive?, limit?, offset? })
// -> { items: [{ id, name, rating, favorite, locationKind, folderId }], ... }

serpent.assets.getMetadata(assetId)
// -> { tags, rating, favorite, automaticPalette, ... }

serpent.assets.setRating(assetIds, 0 | 1 | 2 | 3 | 4 | 5)
serpent.assets.copyFilePaths(assetIds)
serpent.assets.moveToTrash(assetIds)
serpent.assets.renameFile(assetId, newBaseName)
serpent.assets.renameFiles([{ assetId, newBaseName }, ...])

serpent.trash.list({ limit?, offset? })
serpent.trash.restoreIfOriginalVacant(assetIds)

serpent.palettes.mostFrequent({ days?: 2, limit?: 12 })
```

`rating` 是用户手动评分；AI 分析评分不会覆盖它。`search({ query: null })` 搜索当前资源库所有非回收站资产。搜索语法与顶部搜索一致，例如 `tag:抽象`、`name:Ser | tag:Ser`。

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

## 当前边界

- 已支持保存和重新打开 Console 代码，但尚未提供独立 `.d.ts` 类型包、模块式 `export default async function` 脚本入口、执行历史 UI、安装包验证或 MCP transport。
- 脚本不能创建/修改标签、喜欢状态、描述、AI 设置或资源库配置；它只能使用上表的受限 API。
- 单次脚本执行有 CPU、内存、输出、待处理 Promise 和 60 秒墙钟限制。可用“停止”或关闭窗口取消未开始的命令。
