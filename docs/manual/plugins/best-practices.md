# 插件开发最佳实践

本文是 [插件开发指南](development.md) 的操作补充：不重复字段表，只写容易在真实插件里踩到的边界。契约以当前仓库的 Manifest schema 和 Host 实现为准。

完整走通过「无限制运行时 + 原生二进制 + 后台 Job + 内容写回 + GitHub 平台包」这条路径的参考实现：

- 仓库：[Serpent-Plugin-ImageUpscaler](https://github.com/dolag233/Serpent-Plugin-ImageUpscaler)
- 插件 ID：`com.dolag.serpent.image-upscaler`
- 安装方式：GitHub Release 平台 ZIP，不要对源码目录执行 `npm install`

下文用「Image Upscaler」指这份参考实现。它不是 SDK 模板，也不是唯一正确结构；适合对照「成品包长什么样、Job 怎么报进度、Windows ZIP 怎么打」。

## 1. 先定运行模式和实例范围

| 需要 | 选择 |
| --- | --- |
| 只用 `serpent.*` 读写领域对象、设置、通知 | `runtime.mode: "restricted"` |
| 子进程、原生 `.node` / `.bin`、自己的模型文件、任意 `fs`/`net` | `runtime.mode: "unrestricted"` |
| 命令/Job 在整个应用会话里注册一次，可服务多个库 | `runtime.instanceScope: "global"` |
| 每个打开的库各有一份隔离状态 | `runtime.instanceScope: "library"` |

`unrestricted` 仍必须走 Gateway 改托管资产。权限清单不能拦住插件直接调 Node，但 `assets.readContent` / `stageContent` / `replaceContentBatch` 仍然受权限和确认计划约束。不要用 `fs` 覆盖资源库 `Assets/`。

Image Upscaler 使用 `unrestricted` + `global`：Upscayl 需要子进程和本地模型，命令与 Job handler 在会话内只注册一次，跨库时用 `serpent.forLibrary(libraryId)`。

## 2. 入口只使用 setup / dispose

当前入口是 `setup(context)` 和 `dispose(reason)`。不要写 `activate` / `deactivate` 或第二套 `openLibrary` 生命周期。

```js
exports.setup = async function setup(context) {
  const { serpent, subscriptions, signal } = context;
  subscriptions.add(() => { /* 释放自己创建的资源 */ });
  signal.addEventListener('abort', () => {
    // 停掉外部进程、下载和循环
  });
};

exports.dispose = async function dispose(reason) {
  void reason;
};
```

`global` 实例没有「当前库」隐含值。命令 handler 从冻结的 `context.invocation.libraryId` 取值，再 `serpent.forLibrary(libraryId)`。不要把安装范围 `user`/`library` 当成目标库。

## 3. 命令、菜单与 Invocation

- 行为写在 `contributes.commands`；菜单、工具栏、Inspector 只引用 command id。
- `when` 控制是否出现，`enablement` 控制是否可点。两者只能读 Context Key。
- 异步等待之后不要重新读取「当前选择」。handler 使用 `context.invocation`（`libraryId`、`selection.assetIds` 等）。顶层 `targetLibraryId` / `assetIds` 只是兼容字段。

Image Upscaler 的资产菜单用子菜单挂 1x/2x/4x，并用 `selection.extensions intersects ['jpg','jpeg','png','webp']` 隐藏非图片选择；写库前检查 `library.writable` 以及选择中没有已删除/不可用资产。

## 4. Job、进度与取消

Manifest 先声明 Job，`recovery` 只能是 `idempotent` 或 `checkpoint`。handler 在实例级 `serpent.jobs.registerHandler` 注册；`enqueue` / `reportProgress` 走目标库的 `forLibrary(...)`。

进度协议：

- `completed` / `total` 是 Host 进度条的权威来源。不要把「1 张图」报成 `total: 1` 然后在推理的几十秒里一直停在 `0/1`。
- 把可观察的工作拆成足够细的单元。Image Upscaler 对每张图使用 100 个单元，并把 Upscayl 输出的百分比映射进去。
- `phase` 和 `message` 是给用户看的短句，不要放绝对路径、资产 UUID 或协议细节。Host 会做长度限制和路径脱敏，但原文应由插件自己写清楚。
- 提交写回前把进度报到 100%，并换成「正在提交」这类终态说明。不要把「等待确认」留在 Job 已经 `succeeded` 之后还显示的最后一条进度上。

取消：把 Job `signal` 和 `setup` 的 `context.signal` 接到同一条中止链上，杀掉当前子进程，且不要对未完成批次调用 `replaceContentBatch`。应用退出后的 `queued`/`running` Job 会变成 Host 的 `interrupted`，不会自动重跑；需要用户或插件显式重试。

工作区画布上的活动条由 Host 绘制。插件不能隐藏进度条，也不能改标题（当前显示插件 ID 和 handler ID）。进度数字和阶段文案才是插件可控制的部分。

## 5. 内容读取、分块 staging 与一次确认

读：`assets.readContent(assetId, { maxBytes })`。写回托管资产：`stageContent` + `replaceContentBatch`（或单资产 `replaceContent`）。写回走 Execution Plan，用户确认一次。

分块上限针对的是**每次调用解码后的二进制**，当前为 `1,048,576` 字节（1 MiB），不是整张图的大小。IPC 用 Base64，因此：

- Base64 字符串长度必须是 4 的倍数；
- `Buffer.from(chunk, 'base64').length <= 1_048_576`；
- 安全默认分块长度为 `Math.floor(1_048_576 / 3) * 4`（`1_398_100` 个字符，解码后 `1_048_575` 字节）。

不要用 `Math.ceil(1_048_576 / 3) * 4`，解码后会变成 `1_048_578` 字节，Host 会拒绝。

Image Upscaler 先把整批图推理并 stage 完，再调用一次 `replaceContentBatch`，让 Host 只弹出一次统一替换确认。任一项失败则整批不提交。

大选择集不要塞进 Job payload。可以把请求元数据（资产 ID、参数）写到 `serpent.data.getDirectory()` 下的文件，Job payload 只带文件名。路径必须是数据目录内的相对名，禁止 `..`。

## 6. 设置用 Host 原生字段

布尔、下拉、数字、slider 声明在 `contributes.settings`，需要分组时再用 `contributes.ui` v1 的 `settings.groups` 引用 `settingId`。不要为这些控件自己做 HTML。`select` 的 `default` 必须是已声明 option。

自定义布局才使用 `contributes.views` 的沙箱 iframe。iframe 不能碰宿主 DOM、React 或 Node。

## 7. 原生二进制、模型与数据目录

`serpent.data.getDirectory({ scope: "user" | "library" })` 才是插件可写的数据根：

```text
{userData}/plugin-files/<pluginId>/
<库根>/.serpent/plugin-files/<pluginId>/
```

模型和缓存放这里或随平台包捆绑。官方、体积固定、安装后必须能离线用的文件，优先打进对应平台 ZIP（Image Upscaler 的两个 4x 模型就是这样做的）。

捆绑可执行文件时：

1. 按 `{platform}-{arch}` 分目录，例如 `runtime/bin/win32-x64/upscayl-bin.exe`。
2. Windows 旁路 DLL 与 exe 放在同一目录。
3. Host 从 ZIP 解出的文件当前以 `0o600` 写入。macOS/Linux 上 `existsSync` 为真不等于可执行。解析到二进制后，非 Windows 平台应 `chmod 0o755`（若缺少执行位）。
4. `spawn` 不要走 `shell: true`。`EACCES` / `ENOENT` 要转成用户能懂的错误，不要只把原始 `spawn ...` 抛到通知里。
5. Windows 上删除刚用过的临时目录可能遇到 `EBUSY`。任务已经成功时，清理失败不应把 Job 改写成失败。

## 8. 成品包与 ZIP 条目名

安装通道只接受成品包：本地文件夹、本地 ZIP、GitHub Release ZIP。安装过程不执行 `npm install`、`build` 或 `postinstall`。

ZIP 内路径必须是相对 POSIX 路径：

| 可接受 | 会失败或依赖 Host 兼容 |
| --- | --- |
| `serpent-plugin.json` | `./serpent-plugin.json`（Windows `tar -c .` 常见） |
| `entry/main.js` | `entry\\main.js`（Compress-Archive 常见） |
| 可选的唯一顶层目录 `my-plugin/serpent-plugin.json` | `/abs/path`、`C:\\...`、`../escape` |

禁止符号链接。`node_modules/.bin` 下的 shim 链接不要打进包；需要的依赖以普通文件形式捆绑。

Windows 没有 Info-ZIP 的 `zip` 命令。GitHub Actions `windows-latest` 一般有 `tar` 和 `7z`。`tar -a -c -f out.zip -C dist .` 生成的是 ZIP，但条目会带 `./` 前缀，旧版 Host 会报 `PLUGIN_ARCHIVE_INVALID`（absolute or traversing path）。不要把「能解压」和「路径合法」当成一回事：Host 用 adm-zip **读取** ZIP，不提供 Windows 上的 `zip` 打包器。

推荐：在 Node 里遍历 `dist/`，用正斜杠写入条目名（Image Upscaler 的 `scripts/posix-zip.js`）。macOS 上的 `zip -r out.zip .`（在 `dist/` 内执行）通常不会写出 `./`。打完后至少抽查：

- 存在 `serpent-plugin.json`、`README.md`、`LICENSE` 和 `runtime.entry`；
- 没有任何条目以 `./` 开头或包含 `\`、`..`。

当前 Host 会把 `./` 和 `\` 规范化后再校验，作者仍应按上表写出干净路径，以便旧版 Serpent 和本地 ZIP 安装都能通过。

体积与数量上限见 Host `defaultPluginPackageLimits`（归档、单文件、解压总字节、文件数）。原生运行时很容易接近单文件上限，发布前按平台分开打包。

## 9. GitHub Release

文件名必须是：

```text
{pluginId}-{version}-{platformToken}.zip
```

`version` 不含前导 `v`；tag 可以是 `v0.1.0`。有原生代码时为每个支持的平台各上传一个 ZIP，不要让 Windows 用户下载到 `darwin-arm64` 包。纯 JS 插件可只上传 `…-any.zip`。

清单需要 `repository` 字段，且正好是 `https://github.com/owner/repo`。用户在 Serpent 里粘贴仓库 URL 或 Release 页后，Host 按当前 `platform-arch` 匹配 asset，没有再回退 `any`。

Image Upscaler 用 GitHub Actions 的 `macos-latest` 与 `windows-latest` 矩阵分别 `npm run build` 和 `npm run package:release`，再把两个 ZIP 发到同一个 Release。本机可用 `npm run build && npm run package:release` 验证当前平台包。

## 10. 发布前最短核对

1. `serpent-plugin.json` 通过当前 schema；权限只包含实际用到的项。
2. 入口是 `setup`/`dispose`；命令从 `context.invocation` 读目标库和选择。
3. Job 的 `completed/total` 在长时间步骤中会前进；`phase`/`message` 不含路径和内部 ID。
4. 大内容按 1 MiB 二进制上限分块 staging；整批一次 `replaceContentBatch`。
5. 捆绑的 Unix 二进制在运行时补执行位；Windows 临时目录清理失败不覆盖已成功的 Job。
6. 每个平台 ZIP 的条目名都是相对 POSIX 路径，文件名符合 `{pluginId}-{version}-{platformToken}.zip`。
7. 用本地文件夹、本地 ZIP、GitHub 三种通道各装一次，并完成信任、启用、停用。

对照实现时直接看 Image Upscaler 的 `serpent-plugin.json`、`src/plugin.js`、`src/content-staging.js`、`scripts/build.mjs`、`scripts/posix-zip.js` 和 `.github/workflows/release.yml`。
