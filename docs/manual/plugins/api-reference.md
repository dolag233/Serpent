# Serpent 插件 API 参考

本参考对应当前 Plugin API `1`、Manifest `1`。它描述可发布插件可依赖的 schema 和 Guest API；实现仍在开发态，
未列出的字段和方法不应被插件使用。restricted 与 unrestricted 共享同一套 `serpent.*` API；后者只是额外拥有 Node 能力。

## 1. 入口上下文

```ts
export async function setup(context: PluginSetupContext): Promise<void>;
export async function dispose(reason: unknown): Promise<void>;
```

`context` 的稳定字段：

```ts
interface PluginSetupContext {
  pluginId: string;
  pluginInstanceId: string;
  installationScope: 'user' | 'library';
  instanceScope: { kind: 'global' } | { kind: 'library' };
  serpent: SerpentPluginApi;
  subscriptions: { add(value: (() => void) | { dispose(): void }): void };
  signal: AbortSignal;
}
```

`subscriptions` 由 Host 在 dispose 时逆序清理；`signal` 在实例停用、关库、崩溃隔离或 deadline 时 abort。插件必须释放自己的
Worker、模型、外部进程和循环，`dispose` 必须幂等。Contribution 目前由 Manifest 声明，本文不提供动态 Registrar。

## 2. Manifest schema

```ts
interface PluginManifest {
  manifestVersion: 1;
  id: string;
  version: string;                 // SemVer
  name: string;
  description: string;
  author: string;
  license: string;
  repository?: `https://github.com/${string}/${string}`;
  engines: { serpent: string; pluginApi: 1 };
  runtime: PluginRuntime;
  ui?: { entry: string };
  permissions: PluginPermission[];
  contributes: PluginContributes;
  mcp?: { expose: string[] };
}

type PluginRuntime =
  | { mode: 'restricted'; entry: string; instanceScope?: 'global' | 'library' }
  | {
      mode: 'unrestricted'; entry: string;
      instanceScope?: 'global' | 'library';
      nativeModules?: { platform: 'darwin' | 'win32' | 'linux'; arch: 'arm64' | 'x64' | 'ia32'; nodeAbi: number }[];
    };
```

规范运行模式只有 `restricted` 和 `unrestricted`；当前读取时兼容旧别名 `standard`→`restricted`、`trusted`→`unrestricted`，
新插件应只写规范值。ID 长度 3–64，local ID 通常 1–64；包内路径必须是相对路径。`permissions` 最多 64 个且不能重复。

### 权限枚举

当前 `pluginPermissionSchema` 的完整枚举为：

```text
library.read  folder.read  folder.write  asset.read  metadata.read
tag.read  collection.read  job.read  metadata.write  tag.write
collection.write  ai.enqueue  job.manage  file.import  file.move
file.rename  trash.write  clipboard.read  clipboard.write  content.read
content.write  net.fetch  storage.read  storage.write  data.files
secrets.read  secrets.write  ui.workspace  ui.inspector  ui.viewer
ui.settings  ui.notify  input.shortcut  input.capture.viewer
input.capture.application  hook.blocking  preview.provider
thumbnail.provider  metadata.extractor  import.provider export.provider
ai.provider  derived-field.provider  search.provider  theme.trusted-css
```

权限是 Gateway/Host 的能力门槛和风险披露。对 unrestricted 的直接 Node 行为不能形成强制拦截。

## 3. Contribution schema

```ts
interface PluginContributes {
  commands?: CommandContribution[];       // max 256
  menus?: Record<string, MenuItem[]>;     // each max 256
  toolbar?: ToolbarContribution[];        // max 64
  inspector?: InspectorContribution[];   // max 64
  viewerActions?: ViewerActionContribution[];
  shortcuts?: ShortcutContribution[];
  views?: ViewContribution[];             // max 128
  settings?: SettingContribution[];       // max 128
  hooks?: HookContribution[];             // max 128
  jobs?: JobContribution[];               // max 128
  providers?: ProviderContribution[];     // max 128
  themes?: ThemeContribution[];           // max 8
}

interface CommandContribution {
  id: string;
  title: string;
  mcp?: { export: true };
  when?: ContextExpression;
  enablement?: ContextExpression;
  checked?: ContextExpression;
}

interface ToolbarContribution { id: string; command: string; title?: string }
interface InspectorContribution { id: string; command: string; title?: string }
interface ViewerActionContribution { id: string; command: string; title?: string }
interface ShortcutContribution { id: string; command: string; accelerator: string }
interface ViewContribution {
  id: string; title: string;
  location: 'sidebar' | 'workspace' | 'inspector' | 'viewer' | 'settings';
  entry?: string;
}
```

所有这些 Contribution 的 ID 在插件内共享同一命名空间，必须唯一。菜单中的 command 必须引用已声明命令。

## 4. 菜单、条件和上下文

Manifest 菜单的 key 当前是 `asset`、`folder`、`collection`、`workspace`：

```ts
interface MenuItem {
  command?: string;
  id?: string;                         // submenu 必填，command item 禁止
  title?: string;                      // submenu 必填
  group?: string;
  before?: string;
  after?: string;
  first?: boolean;
  last?: boolean;
  when?: ContextExpression;
  enablement?: ContextExpression;
  checked?: ContextExpression;
  submenu?: MenuItem[];
}
```

一项必须恰好是 command 或 submenu；`before`/`after` 只能选一个；`first`/`last` 不能同时为 true；子菜单最大三级。Host 保留树形结构，
用稳定 ID、group 和相对锚点求确定顺序；缺少锚点降级到 group 末尾，循环只拒绝相关边。

`ContextExpression` 是最多 4096 字符的只读表达式，支持：

```text
&&  ||  !  ==  !=  in  intersects  matches  ( )  [ ... ]
```

`when=false` 不渲染，`enablement=false` 置灰，`checked` 控制选中态。`matches` 支持通配和受限正则。表达式不能执行 JS、RPC、I/O
或 Domain API。当前没有公开的 Manifest Predicate Resolver 字段；不要自行添加。

### Contribution Context

Host 发布带 `contextId`、`revision` 的有界快照：

```ts
interface PluginContributionContext {
  contextId: string; revision: number;
  app: { platform: string; locale: string; theme: 'light' | 'dark' | 'system'; busy: boolean };
  surface: { id: string; kind: string };
  window: { windowId: string };
  library: { id?: string; open: boolean; writable: boolean; offline: boolean };
  selection: {
    ref?: string; count: number; primaryId?: string; assetCount: number; folderCount: number;
    mixed: boolean; extensions: string[]; mimeTypes: string[]; mediaKinds: string[];
    summary: { managedCount: number; unmanagedCount: number; availableCount: number; unavailableCount: number; deletedCount: number; hasDeleted: boolean; hasUnavailable: boolean };
    hasDeleted: boolean; hasUnavailable: boolean;
  };
  browse: { folderId?: string; collectionId?: string; tagId?: string; search?: string; filter?: string };
  viewer: { active: boolean; assetId?: string; extension?: string; mimeType?: string; mediaKind?: string; fullscreen: boolean };
}
```

它只用于 UI 条件，不是资产对象，也不是功能 API。`selection.ref` 是 Host 管理的引用；完整对象请调用 `serpent.assets`。

### Invocation Context

命令触发时 Host 冻结目标：

```ts
interface PluginInvocationContext {
  contextId: string; revision: number; libraryId: string;
  selection: { ref?: string; refs: string[]; assetIds: string[]; folderIds: string[] };
  browse: { folderId?: string; collectionId?: string; tagId?: string; search?: string; filter?: string };
  viewer: { active: boolean; assetId?: string };
}
```

异步命令必须使用这份快照，不要在等待之后读取新的 UI 选择。当前生成的独立 Guest SDK 类型把 `commands.register` handler 参数
收窄为 `{ assetIds?: readonly string[] }`；完整 Invocation Context 是 Host 内部契约，插件不要访问未由 SDK 声明的字段。

## 5. Guest API

以下为当前生成 SDK 的公共面，所有方法均返回 Promise 或受约束的 AsyncIterable；具体领域输入/输出继续服从 Gateway schema。

### `serpent.assets`

```ts
serpent.assets.search({ query: string | null, limit?: number, offset?: number }): Promise<unknown>
serpent.assets.readContent(assetId, { maxBytes?: number }): Promise<{
  assetId: string; revisionId: string; byteSize: number; dataBase64: string;
  truncated: boolean; mimeType: string | null;
}>
serpent.assets.replaceContent(assetId, dataBase64, options?): Promise<{
  assetId: string; revisionId: string; byteSize: number;
}>
serpent.assets.stageContent(assetId, dataBase64, options?): Promise<{
  assetId: string; stagingToken: string; byteSize: number; complete: boolean;
}>
serpent.assets.replaceContentBatch(items): Promise<{ operationId: string; items: unknown[] }>
```

`readContent` 有字节上限并可能返回 `truncated`；`replaceContent` 只接受 managed 且可用资产，须 `content.write`，并经过计划确认。
批量替换使用 staging 和 `expectedRevisionId` 做统一预检，不能假定多文件系统原子性。

通过 Automation Gateway 暴露的公共分页列表 API（包括 `folder.list`、`asset.list` 和资产搜索）的 `limit` 都是正整数，默认值由 API
决定，最大值为 **200**（包含 200）；传入 201 或更大值会得到 `AUTOMATION_INVALID_REQUEST`。插件应按页读取结果，不要把 256 当作合法页大小。

权限是独立的门槛：例如读取 extracted metadata 需要 `metadata.read`，不能因为已经拥有 `asset.read` 或 `content.read` 就假定
`asset.extracted-metadata.get` 一定可用。权限不足应作为结构化失败处理；插件可以在有权限时读取 metadata，否则用已声明的 content 能力自行解析。

其他领域面与 Automation Gateway 对齐，包括 folders、tags、collections、metadata、library、files、clipboard、secrets、net、ai。
使用哪个命令必须同时满足对应 permission；当前实现不向插件提供任意 SQL 或库绝对路径读写。

### `serpent.forLibrary`

```ts
const scoped = serpent.forLibrary(libraryId);
await scoped.assets.search({ query: null, limit: 20, offset: 0 });
await scoped.jobs.enqueue({ handlerId: 'process', payload: { assetIds } });
```

global 插件必须显式绑定已打开库；library 插件只能绑定自己的库。Scoped API 不包含 `forLibrary`、events、hooks、jobs 注册、providers、
storage、data、commands、input 或 contributions，只保留领域面和 Job 的 `enqueue`、`reportProgress`、`cancel`、`pause`、`resume`、`retry`。

### `serpent.storage` 与 `serpent.data`

```ts
await serpent.storage.get(key, { scope: 'user' | 'library' });
await serpent.storage.set(key, value, { scope: 'user' | 'library' });
await serpent.storage.delete(key, { scope: 'user' | 'library' });
await serpent.storage.listKeys({ scope: 'user' | 'library' });

const { path, scope } = await serpent.data.getDirectory({ scope: 'user' | 'library' });
```

storage 是小型命名空间 KV，需要 `storage.read`/`storage.write`。data 需要 `data.files`，返回的路径是插件专属目录：
`{userData}/plugin-files/<pluginId>/` 或 `<library>/.serpent/plugin-files/<pluginId>/`。库级目录要求库已打开；restricted 没有 Node fs，
unrestricted 才能用 Node 读写该目录。

storage 的公开返回值是裸值，不带 IPC 包装层：

- `get` 返回保存的值；键不存在时返回 `null`，不是 `{ value: null }`。
- `set` 成功时只解析为 `void`。
- `delete` 返回布尔值，表示是否删除了已有键。
- `listKeys` 返回排序后的 `string[]`。

只有 `data.getDirectory` 保留 `{ path, scope }` 结构。不要读取 `{ value }`、`{ ok }`、`{ deleted }` 或 `{ keys }`；这些是 Host
内部传输结果，不属于插件 API 契约。

### `serpent.events` 与 `serpent.hooks`

```ts
serpent.events.on('library.changed' | 'asset.changed' | '*', async (event) => {
  // event.eventId、kind、libraryId、occurredAt、causeChain、summary
});
await serpent.events.next();

serpent.hooks.onWill('asset.trash', async (context) => ({ action: 'allow' }));
```

事件至少一次投递，按 `eventId` 去重。当前 Hook 事件只有 `asset.trash`，返回 `allow`、`warn` 或带 code/message 的 `block`；阻断需 Manifest
声明 blocking 且拥有 `hook.blocking`，运行在预检阶段而非事务内。Hook 默认 2 秒超时并 fail-open。

### `serpent.jobs`

```ts
serpent.jobs.registerHandler('process', async (payload, job, signal) => {
  signal.throwIfAborted();
});
const { jobId } = await serpent.jobs.enqueue({
  handlerId: 'process', payload: { assetIds }, recoveryStrategy: 'checkpoint'
});
await serpent.jobs.reportProgress({ jobId, completed: 1, total: 10, phase: 'processing', message: 'done' });
await serpent.jobs.cancel({ jobId, reason: 'user-requested' });
await serpent.jobs.pause({ jobId, checkpoint: { cursor: 'asset-42' } });
await serpent.jobs.resume({ jobId });
await serpent.jobs.retry({ jobId, retryInput: { onlyFailed: true } });
```

Job handler 必须在 Manifest `contributes.jobs` 中存在。`recoveryStrategy` 为 `idempotent` 或 `checkpoint`；只有 checkpoint handler 可暂停/恢复。
进度 payload 有界。`completed/total` 是数量进度的权威来源；当 `total` 为 0 时才使用可选的 `progress`（0 到 1）作为比例。后台 UI 的插件任务区会显示 `completed/total`、百分比、`phase` 和 `message`；失败时优先显示错误详情。逐项结果和重试输入由 Job 状态保留，后续任务面板可据此展开或定向重试。

Host 不对 Job handler 设置统一的墙钟超时。插件应自行决定处理失败时机：handler 抛出错误会记录为失败，handler 也必须响应 `signal` 的取消请求；Host 只在插件实例停用、进程崩溃或协议故障时结束该执行。

Job 运行或排队时，Host 主界面会显示一个非阻塞的插件任务活动条，工具栏的「后台任务」入口同步显示活动标记。点击「后台运行」或关闭按钮只收起前台提示，Job 继续执行，仍可从工具栏打开完整任务面板。任务完成、失败或取消后，任务面板中的历史状态仍可查看。

### `serpent.commands`、`providers`、`input` 与日志

```ts
serpent.commands.register('inspect', async (context) => { /* 使用冻结目标 */ });
serpent.providers.register('preview', { id: 'probe', compute: async (batch, context) => [] });
serpent.providers.registerSearch({ id: 'search', search: async (request, signal) => [] });

const capture = await serpent.input.capture({ scope: 'viewer', keyboard: true, pointer: false });
for await (const event of capture.events) { /* bounded input */ }
capture.release();
serpent.console.log('message', { safe: true });
```

Provider kind 为 `preview`、`thumbnail`、`metadata`、`import`、`export`、`ai`、`derived-field` 或 `search`。Manifest 对 Provider 的
扩展名/MIME、derived field id/type 有额外校验；返回媒体、metadata、import plan、export descriptor 和 AI analysis 都有大小与字段约束，
禁止路径和秘密。Input scope 为 `application`、`viewer`、`view`，需相应权限；它不是全局系统 Hook。日志限量并带插件标记。

## 6. MCP 导出

二选一即可导出命令：

```json
{ "id": "inspect", "title": "Inspect", "mcp": { "export": true } }
```

或：

```jsonc
"mcp": { "expose": ["inspect"] }
```

激活后会成为 MCP 候选工具，但只有使用 `--write-access`（或附着模式获得本地写入确认）的连接才会在 `tools/list` 中看到并调用它们。插件命令目前按可能产生副作用处理；只导出稳定、有界、可校验的命令，不能导出任意 eval、秘密、路径
或 Node 接口。

插件 MCP 命令的输入必须包含至少一个非空的 `assetIds`、`folderIds` 或 `collectionIds` 数组；`tools/list` 的 JSON Schema 与运行时均以
`minItems: 1` 校验，空数组或完全没有上下文 ID 会被拒绝。

## 7. 设置与 iframe 页面

```ts
type Setting =
  | { id: string; title: string; description?: string; type: 'boolean'; default?: boolean }
  | { id: string; title: string; description?: string; type: 'number'; default?: number; minimum?: number; maximum?: number }
  | { id: string; title: string; description?: string; type: 'string'; default?: string }
  | { id: string; title: string; description?: string; type: 'select'; default?: string; options: { value: string; label: string }[] };
```

`select` option value 不得重复，default 必须存在；number 范围和 default 必须一致。持久化值的错误代码为 `invalid-type`、`out-of-range`、
`invalid-option`，只影响该字段。静态 schema 错误则安装/激活失败并指出 JSON path。

iframe view 的 Host target 为 `sidebar.entries`、`workspace.views`、`inspector.views`、`viewer.overlays`、`settings.pages`；Manifest 对应
`views[].location`。页面只能经 typed bridge 通信。当前不提供动态 UI Registrar、任意 React 组件、宿主 DOM 或稳定 UI primitives。

## 8. 错误与测试契约

- 权限缺失、库未打开、实例范围不符、资产 revision 冲突、超时和取消必须作为可处理失败；不要把失败吞掉后报告成功。
- setup 失败只隔离该实例；连续崩溃会 quarantine。dispose、Hook、Provider、Input 和 Job 都有取消/背压/deadline。
- 非关键未知事件可记录后忽略；未知控制消息或协议版本错误可终止并隔离当前实例。
- 不要在事务/文件锁内等待插件 Hook，也不要让菜单打开等待插件 RPC。

仓库 fixture 是可执行示例：`standard-host-probe`、`trusted-host-probe`、`menu-command-probe`、`unrestricted-settings-probe`、
`iframe-workspace-probe`、`job-probe`、`hook-blocking-probe`、`preview-thumbnail-probe`、`derived-field-probe`、`input-capture-probe`。
实现新插件时至少补充对应 fixture/单测，并执行相关 `tests/unit`、`tests/worker` 和后台 Electron E2E；E2E 使用临时
`SERPENT_E2E_USER_DATA_PATH`，完整退出再启动才能证明持久化恢复。packaged、Windows 或 Computer Use 未执行时必须写明未验证。

## 9. 当前开发态限制

不要依赖动态 Registrar、UI primitives、`openLibrary`、通用 Host GPU/VRAM/CPU/内存 API、Host 共享模型 Worker、Python runtime、
任意 SQL、宿主 DOM 注入或 unrestricted 行为的强制权限拦截。它们不是当前 Plugin API 1 的承诺。类型声明以仓库
`generatePluginSdkTypeDeclaration()` 生成结果为准；文档中未列出的 API 不属于稳定契约。
