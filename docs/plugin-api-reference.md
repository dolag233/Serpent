# Serpent 插件 API 参考

> 面向人类插件开发者。与 [`plugin-development-guide.md`](plugin-development-guide.md) 配套。  
> 领域命令与脚本 Console 对齐处，可对照 [`automation-scripting-guide.md`](automation-scripting-guide.md)。  
> 运行时类型声明可由主仓 `generatePluginSdkTypeDeclaration()` 生成；下列以当前开发态行为为准。

## 约定

- 入口：`setup(context)` / `dispose(reason)`；global 与 library 实例共用这一对生命周期回调。
- `context.signal` 在实例停用时变为 aborted；`context.subscriptions.add(value)` 托管函数或 `{ dispose() }`，Host 会在 `dispose` 完成后逆序清理。
- 菜单、快捷键、设置等 Contribution 由 `serpent-plugin.json` 声明；当前开发态不提供运行时动态 Contribution Registrar。
- 所有领域写操作经 Automation Gateway；结果为 JSON 安全结构，**不含资源库绝对路径**（剪贴板复制路径除外：脚本只收到数量）。  
- `restricted` 与 `unrestricted` 必须暴露**同一套** `serpent.*` 方法面；`unrestricted` 额外拥有 Node，但不因此省略 Guest API。旧清单别名 `standard`/`trusted` 读入时映射到上述主标识。

---

## `serpent.library`

| 方法 | 权限（典型） | 说明 |
| --- | --- | --- |
| `inspect()` | `library.read` | `{ libraryId, displayName }` |
| `changeSequence()` | `library.read` | 当前变更序号（乐观锁/计划用） |

---

## `serpent.assets`

| 方法 | 权限 | 说明 |
| --- | --- | --- |
| `search(input)` | `asset.read` 等 | 分页搜索；`query` 可为 `null` |
| `list(input?)` | `asset.read` | 列表；可带 `folderId` / `recursive` |
| `getMetadata(assetId)` | `metadata.read` | 元数据 |
| `setMetadata(input)` | `metadata.write` | 需 `expectedVersion` 等 |
| `getAiContent(assetId)` | `metadata.read` | AI 内容 |
| `extractedMetadata.get` 对应方法 | `metadata.read` | 提取元数据 |
| `rating.set` / `paths.copy` / `moveToTrash` / `move` / `renameFile(s)` / 回收站相关 | 见清单 | 与脚本同面；文件类操作需计划确认 |
| `readContent(assetId, options?)` | `content.read` | 按 assetId 读取有界字节（base64）；**不返回磁盘路径** |
| `replaceContent(assetId, dataBase64, options?)` | `content.write` | 原地替换托管资产内容；**计划确认**；新 revision `origin: replace`；刷新缩略图 |

### `readContent`（开发态）

```ts
await serpent.assets.readContent(assetId, { maxBytes?: number })
// -> {
//   assetId, revisionId, byteSize, dataBase64,
//   truncated: boolean, mimeType: string | null
// }
```

- 字节上限与内容替换上限同量级（约 32MiB）。  
- `truncated: true` 表示返回切片小于完整文件。

### `replaceContent`

```ts
await serpent.assets.replaceContent(assetId, dataBase64, {
  expectedRevisionId?, // 可选乐观锁
  mimeHint?,           // 可选；不改变扩展名
})
// -> { assetId, revisionId, byteSize }
```

- 仅 **managed** 且可用资产；linked 拒绝。  
- 用户取消计划 → 命令取消，文件不变。

---

## `serpent.folders` / `tags` / `collections` / …

与自动化脚本相同的领域 Action 面（创建文件夹、标签、合集等）。完整列表见自动化指南；插件须在清单中声明对应权限。

---

## `serpent.storage`

命名空间 KV（小配置），不是大文件存储。

```ts
await serpent.storage.set(key, value, { scope?: 'library' | 'user' })
await serpent.storage.get(key, { scope?: 'library' | 'user' })
await serpent.storage.delete(key, { scope?: 'library' | 'user' })
await serpent.storage.listKeys({ scope?: 'library' | 'user' })
```

权限：`storage.read` / `storage.write`。  
库级默认落在资源库 `.serpent/plugin-data/` 一带；应用级在 `userData` 下。大文件请用 `serpent.data`。

---

## `serpent.data`

插件文件系统数据根（模型、缓存）。

```ts
await serpent.data.getDirectory({ scope?: 'user' | 'library' })
// -> { path: string, scope: 'user' | 'library' }
```

| 参数 | 行为 |
| --- | --- |
| 省略 `scope` | 使用插件**安装范围** |
| `user` | `{userData}/plugin-data/<pluginId>/` |
| `library` | `<库>/.serpent/plugin-data/<pluginId>/`（需已打开库） |

权限：`data.files`（Host 校验；不是 Gateway capability）。  
`path` 为绝对路径：供 **unrestricted** 使用 Node `fs`；受限模式即使返回路径，Guest 内也没有 Node `fs`，勿依赖裸路径 IO。

---

## `serpent.events`

```ts
serpent.events.on('library.changed' | 'asset.changed' | '*', handler)
await serpent.events.next() // 拉模式
```

载荷无绝对路径；用 `eventId` 去重。

---

## `serpent.hooks`

```ts
serpent.hooks.onWill('asset.trash', async (ctx) => {
  return { action: 'allow' } | { action: 'warn', message } | { action: 'block', code, message }
})
```

需 `hook.blocking`（阻断时）。只在计划/预检阶段运行，不在 SQLite 事务内等待。

---

## `serpent.forLibrary(libraryId)`

全局插件执行跨库功能时必须显式指定一个已打开的资源库；不能把全局运行时的
sentinel 当作目标库。资源库级插件只能指定自己绑定的库。

```ts
const scoped = serpent.forLibrary(libraryId)
await scoped.assets.search({ query: null, limit: 20 })
await scoped.jobs.enqueue({ handlerId, payload })
await scoped.jobs.reportProgress({
  jobId,
  completed: 1,
  total: 10,
  phase: 'process',
  message: 'one item done',
})
```

`forLibrary()` 返回完整的领域命令面和 Job 的 `enqueue` / `reportProgress` /
`cancel` / `pause` / `resume` / `retry`，但不重复暴露 `registerHandler`；handler
在实例级 `serpent.jobs` 上注册。

---

## `serpent.jobs`

清单 `contributes.jobs` 声明 handler；运行时：

```ts
serpent.jobs.registerHandler(handlerId, async (payload, job) => { ... })
await serpent.jobs.enqueue({ handlerId, payload?, recoveryStrategy? })
await serpent.jobs.reportProgress({
  jobId,
  completed,
  total,
  phase,
  message,
  progress?,
})
await serpent.jobs.cancel({ jobId, reason: 'user-requested' })
await serpent.jobs.pause({
  jobId,
  checkpoint: { version: 'v1', data: { cursor: 'asset-42' }, savedAt: new Date().toISOString() },
})
await serpent.jobs.resume({ jobId })
await serpent.jobs.retry({ jobId, retryInput: { onlyFailed: true } })
```

权限：`job.manage` 等。后台任务 UI 可展示来源插件、阶段、数量、失败资产和重试输入。
暂停/恢复只有声明 checkpoint 的 handler 可用；其他 Job 明确只支持取消/重试。

---

## `serpent.commands`

```ts
serpent.commands.register(commandId, async (context) => { ... })
```

与清单 `contributes.commands` / 菜单 / 工具栏绑定。可选 `mcp.export`：声明后，插件激活即可被 MCP `tools/list` / `tools/call`（无需设置页开关）。

---

## `serpent.providers`

```ts
serpent.providers.register(kind, { id, compute })
serpent.providers.registerSearch({ id, search })
```

`kind`：`preview` | `thumbnail` | `metadata` | `import` | `export` | `ai` | `derived-field` 等。  
对应权限：`preview.provider`、`search.provider` 等。须遵守超时、体积上限与 native fallback。

---

## `serpent.input`

```ts
const session = await serpent.input.capture({
  scope: 'application' | 'viewer' | 'view',
  keyboard?: boolean,
  pointer?: boolean,
  ownerViewId?: string,
})
for await (const event of session.events) { ... }
session.release()
```

权限：`input.capture.application` / `input.capture.viewer` / `input.shortcut`。

---

## `serpent.console`

```ts
serpent.console.log(...)
```

限量、带插件标记写入诊断日志。

---

## 权限一览（清单）

常用子集：

| 权限 | 用途 |
| --- | --- |
| `library.read` / `asset.read` / `folder.*` / `tag.*` / `collection.*` / `metadata.*` | 领域读写 |
| `content.read` / `content.write` | 资产字节读 / 原地替换 |
| `file.import` / `file.move` / `file.rename` / `trash.write` | 文件计划类 |
| `storage.read` / `storage.write` | KV |
| `data.files` | 数据目录 API |
| `job.manage` / `job.read` | Job |
| `ui.*` / `input.*` / `hook.blocking` | UI 与输入 / 阻断 Hook |
| `*.provider` / `theme.trusted-css` | Provider / 主题 |
| `net.fetch` | 域名 allowlist HTTP(S) |
| `secrets.*` | 系统凭据项 |

完整枚举以 `plugin-manifest` 中 `pluginPermissionSchema` 为准。

---

## 高风险操作与确认

下列命令 `approvalPolicy: plan`（会弹确认，不向插件暴露绝对路径）：

- 导入、回收站、移动、重命名、恢复空位  
- **`asset.content.replace`（原地替换内容）**

只读命令（含 `content.read`）无计划对话框。

---

## 版本与兼容

- `engines.serpent`：SemVer 范围，须覆盖当前应用版本。  
- `engines.pluginApi`：当前为 `1`。  
- `id` 发布后不可更改。  

平台与打包仍在收口中；开发态以本地安装目录联调为主。  
