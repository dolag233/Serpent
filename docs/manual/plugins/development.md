# Serpent 插件开发与发布指南

本文面向准备实际开发、联调和发布 Serpent 插件的人类开发者。文档以当前仓库的
`plugin-manifest.ts`、`plugin-sdk.ts`、Plugin Manager API 和测试 fixture 为准；当前平台仍处于开发态，
未在本文中承诺尚未实现的能力。

## 1. 先了解插件模型

插件是长期运行的扩展，不是一次性脚本。它可以声明命令、菜单、工具栏、Inspector/Viewer 操作、快捷键、
设置、沙箱 iframe 页面、Hook、Job 和 Provider，并在 `setup` 中注册运行时 handler。
领域读写仍通过 `serpent` API 进入 Automation Gateway；Renderer 不加载插件后端代码，插件也不能获得任意
SQL 或宿主 DOM。

安装范围和实例范围是两件事：

- 安装范围 `user` 或 `library` 决定包存放在哪里；它不决定实例数量。
- `runtime.instanceScope` 为 `global` 时，一个已解析版本在应用会话中只有一个实例，可服务多个库。
- `runtime.instanceScope` 为 `library` 时，每个打开的库各有一个隔离实例。
- 每个实例有自己的 `pluginInstanceId`；Contribution 按实例撤销，不能只按插件 ID 处理。

当前入口只有一对生命周期函数：`setup(context)` 和 `dispose(reason)`。没有 `openLibrary`、`closeLibrary` 等第二套
生命周期。库打开/关闭通过领域事件表达。

## 2. 最小可安装包

发布包是不可变成品，至少包含：

```text
my-plugin/
  serpent-plugin.json       # 必需，Manifest v1
  entry/main.js             # 必需，runtime.entry 指向它
  README.md                 # 建议，发布包应提供
  LICENSE                   # 建议，发布包应提供
  entry/ui/index.html       # 可选，沙箱 UI 页面
```

入口可以由 TypeScript 编译生成，但安装和运行时只读取包内已生成的 JavaScript；安装过程不替插件执行
`npm install`、构建、`postinstall` 或 Shell。

一个最小受限插件：

```json
{
  "manifestVersion": 1,
  "id": "com.example.hello",
  "version": "1.0.0",
  "name": "Hello",
  "description": "A small Serpent plugin.",
  "author": "Example",
  "license": "MIT",
  "engines": {
    "serpent": ">=0.1.0 <1.0.0",
    "pluginApi": 1
  },
  "runtime": {
    "mode": "restricted",
    "entry": "entry/main.js",
    "instanceScope": "library"
  },
  "permissions": ["library.read", "storage.read", "storage.write"],
  "contributes": {
    "commands": [],
    "menus": {},
    "toolbar": [],
    "inspector": [],
    "viewerActions": [],
    "shortcuts": [],
    "views": [],
    "settings": [],
    "hooks": [],
    "jobs": [],
    "providers": [],
    "themes": []
  }
}
```

`contributes` 的数组/对象可以省略，schema 会使用空默认值；发布包建议像上例一样完整写出，便于审查和维护。
Manifest 是 strict schema：未知字段、重复权限、重复 Contribution ID、无效包内路径都会被拒绝。

## 3. Manifest 完整字段

顶层字段如下：

| 字段 | 必需 | 当前约束 |
| --- | --- | --- |
| `manifestVersion` | 是 | 只能是 `1` |
| `id` | 是 | 3–64 字符，稳定的反向域名式 ID；发布后不要更改 |
| `version` | 是 | SemVer |
| `name` | 是 | 1–160 字符 |
| `description` | 是 | 1–2000 字符 |
| `author` | 是 | 1–160 字符 |
| `license` | 是 | 1–160 字符 |
| `repository` | 否 | HTTPS GitHub 仓库 URL，必须正好是 `owner/repository` |
| `engines` | 是 | `serpent` 是显式比较符 SemVer range；`pluginApi` 当前只能为 `1` |
| `runtime` | 是 | 见下一节 |
| `ui` | 否 | `{ "entry": "包内相对 HTML 路径" }`，作为插件 UI 包入口 |
| `permissions` | 是 | 最多 64 个，不得重复；只声明当前确实需要的权限 |
| `contributes` | 是 | 见第 5 节；各类 Contribution ID 在插件内必须唯一 |
| `mcp` | 否 | `{ "expose": ["命令 local id"] }`，见第 10 节 |

所有路径必须是包内相对路径；不能是绝对路径、路径穿越或逃逸符号链接。`runtime.entry` 和 `ui.entry` 必须
指向包内文件。

## 4. restricted、unrestricted、安全与信任

### restricted

`restricted` 运行在可终止的 QuickJS 隔离环境中：没有 Node built-ins、`process`、环境变量、任意 import、
原生文件系统、数据库或宿主 DOM。插件只能通过声明权限后可用的 `serpent.*` API 工作。适合一般菜单、领域操作、
Provider 和 Job。

### unrestricted

`unrestricted` 运行在每个实例独立的 Node.js UtilityProcess 中，拥有 Node、文件系统、网络、子进程和依赖的完整能力。
它仍应优先通过 `serpent.*` 操作 Serpent 领域对象，但权限清单不能拦截插件绕过 Gateway 直接调用 Node 的行为；权限同时
是 Serpent API 的能力控制和对用户的风险披露，不是沙箱承诺。需要原生模块时可声明：

```jsonc
"runtime": {
  "mode": "unrestricted",
  "entry": "entry/main.js",
  "instanceScope": "global",
  "nativeModules": [
    { "platform": "darwin", "arch": "arm64", "nodeAbi": 136 }
  ]
}
```

`nativeModules` 中的 platform 只能是 `darwin`/`win32`/`linux`，arch 只能是 `arm64`/`x64`/`ia32`，且 `nodeAbi` 为正整数。
不要把 `unrestricted` 描述成“受权限完全保护”；它等同于运行一段本地 Node 程序。

安装、信任、激活是三个独立阶段：

1. 安装只把包放入用户或资源库存储，不执行入口代码。
2. Host 校验 Manifest、文件列表、SHA-256、引擎版本、权限和 Resolution。
3. 用户在当前设备明确授信后，Host 才能创建实例并调用 `setup`。

资源库包可随资源库复制，但信任决定、密钥和本机路径永远只保存在当前设备；不能因为包同步到另一台设备就自动运行。
同一 ID 同时有用户级和库级包时，Host 不设隐式优先级，由用户选择 `use-user`、`use-library` 或禁用。非受限插件安装后
默认不启用，需在设置中手动打开。Safe Mode 会停用第三方插件以便恢复。

当前仅实现本地文件夹、本地 ZIP 和 GitHub 安装；发布时优先上传 GitHub Release 平台 ZIP。包升级应先 staging、校验、健康检查
再切换；权限、运行模式或来源改变时要重新信任。

## 5. 声明 Contribution

行为放在 `contributes.commands`，其他 Host 表面引用命令，不重复实现 handler。命令的 `id` 是插件内 local ID，运行时完整 ID
为 `<pluginId>.<id>`。

```jsonc
"contributes": {
  "commands": [
    { "id": "inspect", "title": "Inspect asset", "mcp": { "export": true } }
  ],
  "menus": {
    "asset": [
      {
        "command": "inspect",
        "group": "analysis",
        "after": "asset.open",
        "when": "selection.assetCount == selection.count",
        "enablement": "library.open && library.writable"
      }
    ]
  },
  "toolbar": [{ "id": "inspect-toolbar", "command": "inspect", "title": "Inspect" }],
  "inspector": [{ "id": "inspect-section", "command": "inspect", "title": "Inspect" }],
  "viewerActions": [{ "id": "inspect-viewer", "command": "inspect" }],
  "shortcuts": [{ "id": "inspect-key", "command": "inspect", "accelerator": "F9" }]
}
```

当前菜单 key 为 `asset`、`folder`、`collection`、`workspace`；它们对应 Host 的菜单表面。菜单项必须二选一：
`command` 或 `submenu`。子菜单必须有 `id` 和 `title`，命令项不能有 `id`；`before` 与 `after` 不能同时使用，
`first` 与 `last` 不能同时为 true。子菜单最多三级。`group`、`before`、`after` 用稳定 ID，不要按文案或 DOM 定位。
缺失锚点只降级到目标 group 末尾；循环约束只拒绝相关边，不应让整张菜单消失。

`when` 为 false 时不渲染，`enablement` 为 false 时保留但置灰，`checked` 控制 toggle/radio 的选中状态。三者都只能读取
Context Key，不能执行 JavaScript、I/O 或 API 调用。表达式支持 `&&`、`||`、`!`、`==`、`!=`、`in`、`intersects`、`matches`、
括号和数组字面量；单个表达式最多 4096 字符。

快捷键 Contribution 只是默认 accelerator；菜单展示中央 Keybinding Registry 当前有效快捷键。插件设置的 `boolean`、`select`、
`number` 和 `slider` 均由 Host 使用统一的原生样式、ARIA、加载和错误状态渲染；插件不需要自己实现 toggle、dropdown 或 slider。
当前仍没有动态 Registrar；不要在插件中依赖运行时注册新的 Host surface。

`slider` 示例：

```jsonc
{ "id": "scale", "title": "Scale", "type": "slider", "default": 0.5,
  "minimum": 0, "maximum": 1, "step": 0.1 }
```

### 5.1 Theme Contract v1

插件主题只能通过语义引用和插件自有颜色 token 接入 Host 主题，不得覆盖 Host 的任意 CSS 变量。主题贡献的 `version` 当前为 `1`：

```jsonc
"themes": [{
  "id": "brand",
  "version": 1,
  "light": {
    "references": {
      "accent": "action.accent",
      "panel": "surface.pane"
    },
    "tokens": {
      "badge": "#c45a00"
    }
  },
  "dark": {
    "references": {
      "accent": "action.accent",
      "panel": "surface.pane"
    },
    "tokens": {
      "badge": "#ff9a3c"
    }
  }
}]
```

`references` 的值必须是 Host 公共语义名：`surface.canvas`、`surface.pane`、`surface.raised`、`surface.overlay`、
`content.primary`、`content.secondary`、`content.tertiary`、`border.divider`、`border.control`、`border.focus`、
`action.accent`、`state.info`、`state.success`、`state.warning`、`state.error`。`tokens` 只能是颜色值（十六进制、rgb/rgba、
hsl/hsla、`transparent` 或 `currentColor`），每个模式最多 32 个。

在 iframe 中，Host 会保留只读的 `--ui-*` 语义变量，并把插件映射为隔离变量：`references.accent` 变成
`--serpent-plugin-ref-accent`，`tokens.badge` 变成 `--serpent-plugin-token-badge`。插件不得依赖 Host 内部旧变量（如
`--accent`、`--canvas`），也不能用主题贡献注入字体、布局、URL、`calc()` 或任意 CSS。

iframe 收到的主题消息类型是 `plugin-ui.theme-changed`，带有 `theme`、`contrast`、单调 `revision` 和 token map；插件应按 revision
更新自身样式，并忽略旧 revision。主题变化包括用户切换亮/暗/系统主题以及强调色变化。

Host 当前提供的外观预设包括 `vscode-dark`、`serpent-dark`、`serpent-light` 和 `soft-light`。插件不需要识别预设 ID，
只需使用 iframe 收到的 `--ui-*` 只读语义 token 和 `plugin-ui.theme-changed` 消息即可。用户在 Host 中设置的背景颜色或背景图片
不会暴露给插件，也不能通过插件主题贡献修改。

## 6. Contribution Context 与 Invocation Context

Contribution Context 是 Host 发布的有界 UI 快照，只用于菜单/命令的 `when`、`enablement`、`checked`。当前字段包括：

- `app.platform`、`app.locale`、`app.theme`、`app.busy`
- `surface.id`、`surface.kind`、`window.windowId`
- `library.id`、`library.open`、`library.writable`、`library.offline`
- `selection.ref`、`count`、`primaryId`、`assetCount`、`folderCount`、`mixed`、扩展名/MIME/媒体类型、删除/不可用摘要
- `browse.folderId`、`collectionId`、`tagId`、`search`、`filter`
- `viewer.active`、`assetId`、`extension`、`mimeType`、`mediaKind`、`fullscreen`

Context 带 `contextId` 和单调递增 `revision`。它只含摘要；要读取完整资产，使用 Domain API。

Invocation Context 是命令触发时冻结的目标快照，包含 `contextId`、`revision`、目标 `libraryId`、selection refs/assetIds/folderIds/collectionIds、
浏览范围和 viewer 目标。异步等待后不能重新猜测当前焦点或选择；在 `commands.register` 的 handler 中从 `context.invocation` 读取这份快照，
顶层 `targetLibraryId` 与 ID 数组只是便捷字段。

复杂条件不能在打开菜单时 RPC 插件。开发态的 Predicate Resolver 会在 Context revision 变化后异步计算，缓存键包含
`pluginInstanceId + contextId + revision + predicateId`；新 revision 会取消旧计算，超时/错误使用 fallback。当前 Manifest 没有
公开的 Predicate Contribution 字段，不能把它写成可发布配置。

## 7. 生命周期、订阅和实例范围

入口示例：

```js
exports.setup = async function setup(context) {
  context.subscriptions.add(() => console.log('released'));
  context.signal.addEventListener('abort', () => {
    // 停止自己的循环、外部进程或模型任务
  });
  await context.serpent.storage.set('initialized', true);
};

exports.dispose = async function dispose(reason) {
  // dispose 必须幂等：释放插件自己创建的 Worker、模型、监听器和文件句柄。
  void reason;
};
```

`context` 包含 `pluginId`、`pluginInstanceId`、`installationScope`、`instanceScope`、`serpent`、`subscriptions` 和 `signal`。
`subscriptions.add()` 接受函数或 `{ dispose() }`；Host 在 dispose 后逆序清理。`signal` 在停用、关库或崩溃隔离时 abort；Host 不会因为 Job handler 运行时间长而自动 abort。
Host 会无条件撤销该实例的 Contribution、Hook、Provider、Capture 和未移交资源；deadline 后可终止进程。

global 实例要显式选择目标库；library 实例只能使用绑定库。`instanceScope` 只说明实例范围，不承诺携带库 ID；目标库应使用当前实例领域面或 `forLibrary(libraryId)`。不要把安装位置当作当前库，也不要自行实现 `openLibrary` 生命周期。

## 8. 设置、页面与 UI

Host-rendered 设置声明在 `contributes.settings`：

```jsonc
"settings": [
  { "id": "enabled", "title": "Enabled", "type": "boolean", "default": true },
  {
    "id": "quality", "title": "Quality", "type": "select",
    "description": "Processing quality.",
    "options": [
      { "value": "fast", "label": "Fast" },
      { "value": "high", "label": "High" }
    ],
    "default": "fast"
  },
  { "id": "limit", "title": "Limit", "type": "number", "minimum": 1, "maximum": 100, "default": 10 },
  { "id": "model", "title": "Model", "type": "string", "default": "base" }
]
```

支持的 type 是 `boolean`、`number`、`slider`、`string`、`select`。select 的 option value 必须唯一，default 必须是已声明值；number/slider 的
default 必须在 minimum/maximum 内，slider 的 step 必须大于 0。静态设置 schema 非法会拒绝插件；已保存的单个值非法时只该字段回退默认值并产生诊断，
不会清空整页。

自定义页面是 sandboxed iframe，声明在 `contributes.views`，location 为 `sidebar`、`workspace`、`inspector`、`viewer` 或 `settings`，
可选 `entry` 指向包内 HTML。`ui.entry` 是包级 UI 入口；页面通过 typed bridge 使用 Host/后端能力，不能注入 React、访问宿主 DOM 或 Node。
插件设置字段已经使用 Host 内部 UI library 的统一 primitives；插件仍不能把宿主 CSS class 当作 API。更复杂的 Host-rendered
结构化 UI descriptor 使用 `contributes.ui`，设计与字段限制见 [`0029 UI 标准化执行方案与插件原生 UI 契约`](../../implementation/0029-ui-standardization-execution-and-plugin-ui-contract.md)。

### 8.1 Plugin UI Contract v1

`contributes.ui` 是 JSON/TypeScript descriptor，不是 HTML、CSS 或 React 配置：

```jsonc
"ui": {
  "version": 1,
  "settings": {
    "groups": [{
      "id": "general",
      "title": "General",
      "items": [{ "settingId": "enabled" }, { "settingId": "quality" }, { "settingId": "scale" }]
    }]
  },
  "menus": {
    "asset": [{
      "id": "tools", "title": "Tools",
      "submenu": [{ "command": "run-action", "shortcut": "⌘R" }]
    }]
  },
  "notices": [{ "id": "ready", "message": "Ready", "tone": "success" }],
  "activities": [{ "id": "scan", "title": "Scanning", "message": "Reading assets.", "indeterminate": true }],
  "jobs": [{ "id": "index", "title": "Index assets" }]
}
```

设置组中的 `settingId` 必须引用同一 manifest 的 `contributes.settings`；因此 boolean/select/slider 的值、范围、选项和持久化仍由现有设置协议负责。
菜单沿用现有 command、`when`、`enablement`、`checked`、`before`/`after`、快捷键和 submenu 语义。`notices`、`activities` 和 `jobs` 只能描述数据；Host 负责使用原生组件、可访问性和主题渲染，插件通过 `onCommand`/设置桥接获得结果。

Host 会逐字段诊断并跳过非法条目，保留同一 descriptor 中其他合法部分；不支持的版本、未知字段、函数、HTML、CSS 和宿主 DOM 引用都会被拒绝。复杂、动态或需要自定义布局的界面继续使用 sandboxed iframe Custom View。

## 9. Jobs、storage 与 data

Job 先在 Manifest 声明：

```jsonc
"jobs": [{ "id": "process", "title": "Process assets", "recovery": "checkpoint" }]
```

`recovery` 只能是 `idempotent` 或 `checkpoint`。运行时注册 handler，随后 enqueue；可报告进度、取消、暂停、恢复和重试。
只有 checkpoint Job 支持暂停/恢复；插件缺失、停用或版本不兼容时 Job 进入 blocked/paused，不由其他版本接管。
`recovery` 描述的是插件自己的幂等/检查点能力，不代表 Host 会在应用重启后自动恢复 Job。应用退出、崩溃或插件运行时会话结束时，仍处于
`queued`/`running` 状态的 Job（以及因插件实例失活而暂停的 Job）会在下一次应用 Worker 会话打开资源库时被标记为 `interrupted`，不会被静默执行；同一进程内关闭并重新打开资源库不会伪造应用重启。插件或用户必须显式调用
重试来重新入队，且中断 Job 可以由当前相同插件包的新实例接管。`interrupted` 是 Host 状态，插件的完成回调不能伪造这个状态。
大文件、模型和缓存不要塞进 storage。

`serpent.storage` 是插件命名空间 KV，小配置使用 `scope: "user" | "library"`；按权限 `storage.read`/`storage.write` 控制。
`serpent.data.getDirectory({ scope })` 返回插件数据根：用户级为 `{userData}/plugin-files/<pluginId>/`，库级为
`<库根>/.serpent/plugin-files/<pluginId>/`。库未打开时不能取得库级目录。受限模式没有 Node fs；unrestricted 才能在该目录下用 fs，
也不要把返回路径当作可写入库 Assets 的通道。

storage API 返回插件可直接使用的值：`get` 返回保存值或不存在时的 `null`，`set` 返回 `void`，`delete` 返回是否实际删除的
布尔值，`listKeys` 返回排序后的键数组。Host 的 `{ value }`、`{ ok }`、`{ deleted }`、`{ keys }` 是内部 IPC envelope，插件不得依赖。
`data.getDirectory` 是例外，仍返回 `{ path, scope }`。

Automation Gateway 的公共分页列表 API 的 `limit` 最大为 200（含 200）；`folder.list`、`asset.list` 和资产搜索请求传入 201 会被
拒绝。分页和权限错误都要按失败处理：例如 `asset.extracted-metadata.get` 需要 `metadata.read`，缺少该权限时不能假定 Host 会返回空
metadata。

## 10. Domain API、forLibrary 与 MCP

插件使用与脚本共享的 Gateway 领域面，包括 library、assets、folders、tags、collections、metadata、content、jobs、storage、data、
secrets、net、clipboard 等。实际可调用能力由权限决定；结果不承诺返回资源库绝对路径。

内容读取使用 `assets.readContent(assetId, { maxBytes })`，得到受限 base64、revision、大小、MIME 和 `truncated`。内容写回使用
`replaceContent` 或 `stageContent`/`replaceContentBatch`，须使用 managed asset、权限和 expected revision；写入经过 Execution Plan/确认，
大文件不放在单一 IPC payload。批量替换先统一校验 revision，再提交 staging；不能宣称文件系统原子性。

Gateway 拒绝、计划过期、用户取消或权限不足时，Promise 会 reject 一个带有 `error.code` 和公开 `error.message` 的错误；例如
`AUTOMATION_CAPABILITY_DENIED`、`AUTOMATION_EXECUTION_CANCELLED`。插件应按错误码分支处理并把需要排查的信息写入自己的诊断状态，不能依赖通用的
`HOST_COMMAND_FAILED` 作为业务判断。宿主仍会隐藏未标记的内部错误细节。

global 插件跨库必须显式：

```js
const library = context.serpent.forLibrary(libraryId);
const page = await library.assets.search({ query: null, limit: 20, offset: 0 });
await library.jobs.reportProgress({
  jobId,
  completed: 1,
  total: 10,
  phase: 'processing',
  message: 'done'
});
```

Host 的「后台任务 → 插件任务」会把 `completed/total` 与百分比显示在进度条旁，并将 `phase` 与 `message` 显示为插件提供的进度说明。文字由插件负责组织，Host 只做长度限制后的安全展示；失败任务仍优先显示错误详情。

运行中的 Job 还会出现在主界面画布上方的非阻塞活动条中，工具栏「后台任务」入口会显示活动标记；用户无需先打开任务对话框才能发现插件正在工作。完成、失败或取消后的最近结果会短暂保留，并可从活动条进入完整任务面板。

`forLibrary()` 返回领域 API 和 Job 的 enqueue/report/cancel/pause/resume/retry，但不返回 events、hooks、providers、storage、data、
commands 或 handler 注册；handler 必须在实例级 `serpent.jobs` 注册。library 实例不能借此越过自己的库边界。

命令可通过 `contributes.commands[].mcp.export: true` 或顶层 `mcp.expose: ["command-id"]` 导出。插件激活后会成为 MCP 候选工具，但 MCP 连接仍须请求本地写入配置；插件命令目前按可能产生副作用处理，只导出有界、可校验的命令，不暴露 eval、秘密或任意 Node 接口。
插件 MCP 调用还必须提供至少一个非空的 `assetIds`、`folderIds` 或 `collectionIds` 数组；空数组会在 JSON Schema 和 Host 运行时两层拒绝。

## 11. Hook、Provider 与输入

Hook 在 Manifest 中声明 `id`、`event`、`blocking`。当前实现首发事件是 `asset.trash`；运行时 `serpent.hooks.onWill` 返回：

```js
{ action: 'allow' }
{ action: 'warn', message: '...' }
{ action: 'block', code: '...', message: '...' }
```

阻断必须同时声明 `blocking: true` 和 `hook.blocking` 权限；Hook 在 Execution Plan 预检阶段运行，不在 SQLite 事务/文件锁内等待，
超时默认 fail-open。事件订阅使用 `serpent.events.on('library.changed' | 'asset.changed' | '*', handler)`；事件至少一次投递，
请按 `eventId` 去重。

Provider 支持 `preview`、`thumbnail`、`metadata`、`import`、`export`、`ai`、`derived-field`、`search`。Manifest 必须声明适配扩展名
或 MIME；derived-field 必须有 `fieldId` 和 `fieldType`。返回值受严格大小限制，不能返回路径、secret、token 或大对象；搜索应优先
物化字段，不能在 Renderer 中逐资产同步调用插件。

Input Capture 有 `view`、`viewer`、`application` 三种 scope，需对应 `input.capture.*` 权限；会话失焦、停用、崩溃、关库或视图关闭时自动
释放。它不是系统全局键鼠 Hook。

## 12. 错误、资源和发布前测试

错误应按故障域处理：非法静态 Manifest 拒绝整个插件并报告 JSON path；单个坏设置值回退字段默认值；坏菜单分支、Provider、Predicate、
非关键事件只局部降级。未知控制面消息或不兼容协议可隔离当前实例。插件自己的 `setup` 失败不能阻止应用/资源库打开；连续崩溃会进入
quarantine。`dispose` 应可重复调用且不依赖当前 UI。

开发和发布至少验证：

- 以 `npm run typecheck`、`npm run lint` 和相关 unit/worker 测试检查 schema、生命周期、storage、Job、Hook、Provider、菜单和 Context。
- 使用 `tests/fixtures/plugins/standard-host-probe/` 验证 restricted，使用 `trusted-host-probe/` 验证 unrestricted。
- 用 `menu-command-probe/` 验证 asset/folder/collection/workspace 菜单、快捷键、Inspector、Viewer、settings。
- 用 `iframe-workspace-probe/` 验证 sidebar/workspace/inspector/viewer/settings iframe；用 `job-probe/`、`hook-blocking-probe/`、
  `preview-thumbnail-probe/`、`derived-field-probe/` 验证对应扩展点。
- Electron E2E 必须后台运行并使用临时 `SERPENT_E2E_USER_DATA_PATH`；持久化必须以完整退出并重新启动为边界。
- 发布前重新打包当前 HEAD；不能用旧包证明当前包可运行。macOS/Windows 和 Computer Use 未执行时必须明确标记“未验证”。

### 发布清单

1. `serpent-plugin.json` 通过当前 schema，权限最小化，所有 Contribution ID 唯一。
2. 包内入口、UI、README、LICENSE 和依赖均已编译并可脱机运行；没有 install/build/postinstall 依赖。
3. restricted/unrestricted 风险、需要的文件/网络/原生能力在 README 和发布说明中清楚披露。
4. 本地文件夹、ZIP、GitHub Release ZIP 均安装、信任、激活、停用、升级、卸载过。
5. 已测试升级 staging、失败恢复、Job 中断后的显式重试、完整重启以及 user/library 两种安装范围。
6. 发布版本保持稳定 `id`，并记录支持的 Serpent SemVer 与 Plugin API 版本。

## 13. 明确不应写入插件的能力

当前不要依赖动态 Contribution Registrar、尚未发布的通用 descriptor Registrar、`openLibrary`、通用 Host GPU/VRAM/CPU/内存 API、Host 共享模型 Worker、
宿主 React/DOM 注入、通用 Python 运行时、任意 SQL、系统全局键鼠 Hook 或由权限拦截 unrestricted Node 行为。它们不是当前可发布的
插件契约；不确定的行为按开发态限制处理，并在插件 README 中说明。
