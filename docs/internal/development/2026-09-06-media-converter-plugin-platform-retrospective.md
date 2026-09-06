# 2026-09-06 MediaConverter 插件开发复盘（Host 侧）

> 来源：MediaConverter 无限制插件（`com.dolag.serpent.media-converter`）联调全过程。  
> 产品纠正（2026-09-06）：菜单「是否显示 / 是否置灰」由**插件**用 `when` / `enablement` 实现，不是 Host 按媒体类型替插件过滤；HTML/iframe 对话框**保留**给复杂界面与交互，不是继续收窄。  
> 相关日志：[插件 ui.dialog / media.binaries](2026-09-05-plugin-host-dialog-and-binaries-protocol-fix.md)、[widget 对话框](2026-09-06-plugin-widget-dialog-kit.md)。  
> 验收：`PLUGIN-048`、`PLUGIN-049`；后续收口见工单（本文件 §6）。

本文回答：开发过程踩了哪些坑、哪些是实现问题、哪些是 Serpent 插件模块问题、哪些值得改、哪些是系统性结构缝。**着重 Host。**

---

## 0. 产品纠正（不得再写进方案）

### 0.1 菜单可见性与置灰是插件接口，不是 Host 媒体类型白名单

错误提案：给命令加 `accepts: ['video']`，由 Host 在混合选中时过滤或灰掉。

正确契约（已有，必须守住）：

- **`when`**：插件声明「这一项要不要出现」。为 false 则不渲染。
- **`enablement`**：插件声明「出现后能不能点」。为 false 则保留并置灰。
- 两者只读 Contribution Context（`selection.mediaKinds`、`selection.extensions`、`selection.mixed`、`library.writable` 等），不能 RPC、不能执行 JS。
- 混合选中（视频+图片）时，「视频转码」出现还是灰掉，由**该插件的表达式**决定。Host 提供足够的 Context Key；Host **不**替插件做媒体类型政策。
- 命令 handler 仍应处理「菜单没挡住的不兼容项」（例如快照里仍混有图片）：这是插件实现，不是再开一套 Host `accepts`。

### 0.2 HTML/iframe 对话框是正式能力，不是准备删掉的缺口

错误提案：继续收窄 HTML 对话框，只留 widget kit。

正确分层：

| 场景 | 走哪条 |
| --- | --- |
| 标准表单（字段、下拉、开关、提交/取消） | **默认** `serpent.ui.openDialog({ title, render })` widget IR，Host primitive 绘制 |
| 复杂界面、自定义交互、WebGL、第三方页、非表单工作台 | **`openDialog({ dialogId })` HTML/iframe** 或 Custom View iframe，必须保留 |
| Manifest JSON | **不是**对话框 UI 语言；只描述菜单/设置/贡献 |

widget kit 解决的是「每个插件自造一套主题不一致的表单」。它不取代需要自由布局的对话框。iframe 资源协议、ready 握手、取消/超时等 Host 缺陷要修，但不能用「禁止 HTML」当产品方向。

---

## 1. 先列坑（按用户能看见的故障）

| # | 用户看见什么 | 主要责任 | 本轮是否已修 |
| --- | --- | --- | --- |
| 1 | 右键压缩无反应，插件进程被杀 | Host：host-command 白名单照抄脚本 | 已修协议分叉 |
| 2 | 协议修好后仍无面板，约 5 秒失败 | Host：对话框挂在查看器分支；5 秒命令超时 | 已修 overlay + 等待时暂停超时 |
| 3 | 点「开始处理」无 Job | Host：preload `send` vs Main `handle` | 已修 |
| 4 | 空白面板 / 取消无效 / 永远载入 | Host：默认做成 iframe Webview | 已改默认走 widget；iframe **仍要可用** |
| 5 | 下拉点不开 | Host：原生 `<select>` 在模糊 scrim 合成层里 | 已改 PortaledPopover |
| 6 | MP4→WebM 编码残留 H.264 | Host：select 不校验 remembered value | 已修 toolkit coerce |
| 7 | 子文件夹压缩「未找到资产信息」 | Host：`assets.list` 默认不递归；曾无按 ID 查询 | 已加 `assetIds`；选中应走 invocation 快照 |
| 8 | 大库弹窗前卡很久 | Host 缺按 ID 查询 + 插件弹窗前扫库 | 查询已加；插件侧去掉阻塞 list |
| 9 | 替换失败「缺少修订版本」 | Host：快照一度丢掉 `currentRevisionId` | 已补字段 |
| 10 | 第二个压缩把活动条盖成 0%；上一个对话框挂死 | Host：Job 条选最新 queued；`setRequest` 不 resolve 旧 Promise | 已打补丁，未升为原语 |
| 11 | 视频压缩/转码失败，图片能过 | Host 捆绑 FFmpeg 8 方言/编码器与插件假设不一致 | 插件已适配；Host 未提供能力 API |
| 12 | 50% 压缩越压越大 | **插件**：把总比特当 `-b:v` | 插件已修 |
| 13 | 转码成 WebM，报导入冲突英文句 | Host：计划 schema 不认 `newFileName`；错误域用错 | schema 已补；错误码仍是导入冲突 |
| 14 | 磁盘已是 `.webm`，卡片仍显示 MP4 | Host：`renameAssetFile` 不发 `asset.changed` | 已补事件 |
| 15 | 点确认没事发生，再点竞态 | Host 轮询慢 + 插件无防重入 | 部分已修 |
| 16 | Job 失败：SQLite 引擎不可用 | Host：Windows vcpkg 劫持 better-sqlite3；杀进程脚本用失效 wmic | 已 hermetic 标志 + 杀进程 |
| 17 | 混合选中转码处理中才报「不是视频」 | **插件**：未在 handler 里过滤；不是 Host 该按类型藏菜单 | 插件预过滤；菜单仍由插件 `when`/`enablement` 管 |
| 18 | 假 ffmpeg 单测绿、真机挂 | **实现/测试策略** | 插件仓补了真 FFmpeg 测 |

---

## 2. Serpent 软件侧（系统性）

不是 18 个独立笔误。MediaConverter 需要的是应用扩展面（菜单、对话框、选中物体、后台 Job、改文件身份、捆绑编码器），当时的插件平台更接近「脚本 Gateway + iframe」。缺口用特判填，就会成串。

### 2.1 命令被当成短 RPC，UI 和 Job 是长生命周期

- 脚本白名单复制到插件 host-command：未知 `ui.dialog` 被当成协议错误并杀掉 UtilityProcess。
- `openDialog` 阻塞到用户提交，invoke 5 秒超时仍在走。
- 对话框宿主绑在 `previewAsset` 上，网格右键不 mount。
- IPC send/handle 不对称，提交结果丢失。

**结构缝：** UI 等待、IPC、计算共用一套超时和一套命令 id 表。新 Host-only API 若只加一边，会再次杀进程。

**值得改：** 能力单源（复杂，工单）；等待 host-command 暂停超时（已有特判，复杂项里把超时模型分档）。

### 2.2 对话框产品线曾缺「宿主控件组合」，但 HTML 线不能拆掉

第一版把插件对话框做成 workspace iframe：ready 握手、不透明 placeholder、自造按钮、资源 allowlist 不含 `dialogs`。标准表单因此又丑又脆。

转向 widget IR 是对的：**默认表单走 Host primitive**。用户明确要求：**复杂界面仍走 HTML/iframe**。要修的是 iframe 对话框的超时、取消、协议、overlay，而不是再收窄这条能力。

**值得改：** widget 作为默认表单路径（已做）；iframe 对话框保持一等公民（文档口径，本轮改手册）；模态栈/Job 条升为 Host 原语（复杂，工单）。

### 2.3 Invocation 只有 ID 时，插件只能去「找当前选中了谁」

`assets.list` 默认库根、Guest 投影丢掉相对路径/尺寸/revision、没有 `assetIds` 时只能扫全库。用户指出选中应由 Host 传入。现已有 `invocation.selection.assets` 有界快照。

**结构缝：** 安全剥离（去掉绝对路径）做成了「去掉写回所需的最小字段」。Guest 投影需要正式的写回最小字段表。

**值得改：** 把最小快照表写进手册/SDK（简单，本轮做）；Gateway 在缺 `expectedRevisionId` 时拒绝 replace 并给专用错误（可并入复杂工单）。

### 2.4 「改内容」和「改身份」被塞进同一套导入冲突机器

Worker 已支持 `newFileName`，自动化计划/Zod/审批一度只认 `newBaseName`。校验失败抛 `INVALID_IMPORT_DECISION`（「Choose a valid import conflict decision.」）。转码改扩展名不是导入冲突。

`replaceContentBatch` 发 `asset.changed`；随后 rename 曾不发。Renderer 只信 `asset.changed` 做画布重载（`library.changed` 被忽略以免缩略图刷爆）。于是磁盘已改名、卡片仍显示旧扩展名。

**结构缝：** 文件操作计划与命令输入字段不是同一份 schema；身份变更事件不完整。

**值得改：** 计划校验用独立错误码（简单，本轮做）；`replaceContent` 可选新文件名、全路径身份事件审计（复杂，工单）。

### 2.5 捆绑 FFmpeg 只给路径，不给 ABI

宿主 FFmpeg 8：`-print-format` 非法（要 `-output_format`）；非 GPL 包无 `libx264`/`libx265`，Windows 上常见 `libopenh264`。`media.getBinaryPaths()` 只返回绝对路径。插件写死 `libx264` 或旧 flag 就会在真机失败，假 runner 测不出来。

**值得改：** 锁定说明书（简单，本轮做）；`media.getCapabilities()`（复杂，工单）。

### 2.6 Windows native 不 hermetic 时，任何插件写回都会变成「库引擎不可用」

用户级 vcpkg MSBuild 集成把 better-sqlite3 链到无 FTS5 的 `sqlite3.dll`。replace/rename 更新搜索索引即 `LIBRARY_ENGINE_UNAVAILABLE`。`kill-stale-dev` 依赖已失效的 wmic，重建 EPERM。

这不是插件逻辑，但会挡住所有 `content.write`。已在 forge / `npm start` / ensure-native / rebuild-native 设 `VcpkgEnabled=false`。完整「`npm start` 硬门」仍可加强（复杂，不单独立项除非再回归）。

### 2.7 widget select 的 options/value 不变量

选项随容器变化后，remembered `h264` 仍显示。Host toolkit 与 Guest 源均应 coerce 到合法项。Trusted toolkit 已有回归测试 `resets a select when the stored value is no longer in the options`。须长期守住，禁止再引入原生 `<select>` 进模糊 modal。

---

## 3. 实现/插件侧（不记到 Host 头上）

- 码率公式：目标字节×8 未除以时长，50% 也会变大。
- 图像只调质量不缩放，到不了绝对目标体积。
- 打开对话框前阻塞 `assets.list` + 编码器 probe。
- 无在途锁，确认后反馈慢，用户连点导致 revision 竞态。
- WebM 用备注代替改下拉选项（也撞上 Host select coerce）。
- 混合选中不预过滤；菜单 `when`/`enablement` 也未按插件自己的产品意图写严。
- 用假 ffmpeg 冒充视频路径已测通；过早把 `PLUGIN-049` 标自动化通过。

这些放大了 Host 缺陷：用户变成唯一集成测试机。

---

## 4. 哪些值得改（本轮拆分）

用户要求：「应该做」先开单；**简单的本轮做**；复杂的未来再做。

| 项 | 复杂度 | 本轮 |
| --- | --- | --- |
| 插件 Host-only 命令与脚本白名单单源（编译期/生成表，禁止 copy-paste） | 复杂 | 只开单；可加「禁止重叠」回归测试作定金 |
| 写回最小快照表写入手册/SDK 类型说明 | 简单 | 做 |
| `replaceContent` 带新文件名；全库身份变更都发 `asset.changed` | 复杂 | 只开单（rename 事件已有） |
| 自动化文件计划校验不得使用导入冲突错误码/文案 | 简单 | 做 |
| `media.getCapabilities()` | 复杂 | 只开单 |
| 捆绑 FFmpeg 8 方言与编码器锁定说明书 | 简单 | 做 |
| 插件模态栈 + Job 活动条作为 Host 原语（单模态、running 优先、enqueue 事件） | 复杂 | 只开单（已有补丁） |
| widget select options 变化必须 coerce | 简单（已有实现+单测） | 守住；Guest 源保持同一逻辑 |
| 菜单 `when`/`enablement` 由插件实现（纠正 §0.1） | 文档 | 做 |
| HTML/iframe 对话框保留给复杂 UI（纠正 §0.2） | 文档 | 做 |

不另开「Host accepts: video」工单。

---

## 5. 给后续插件作者的 Host 契约摘要

1. 当前选中：只读 `invocation.selection.assets`，不要为「选中了谁」去 `assets.list`。
2. 菜单：自己写 `when`（显示）和 `enablement`（置灰）。
3. 标准表单：widget kit。复杂交互：HTML 对话框或 Custom View，合法。
4. 写回：快照里的 `currentRevisionId` + `replaceContent`/`replaceContentBatch` 的 `expectedRevisionId`；改扩展名还要 `renameFile` 的完整 `fileName`，直到 Host 提供合一 API。
5. FFmpeg：用 `getBinaryPaths()`，**probe 编码器**，不要假设 `libx264` 或 FFmpeg 4 的 `-print-format`。
6. 画布是否刷新取决于 Host 是否发 `asset.changed`，不要静默假设 rename 会刷新。

---

## 6. 工单索引

Epic：`Serpent-627bef` MediaConverter 复盘后的插件平台收口。

| ID | 标题 | 复杂度 | 本轮 |
| --- | --- | --- | --- |
| `Serpent-bed011` | 插件 Host-only API 与脚本白名单必须单源 | 复杂 | 只开单（可加不相交回归作定金） |
| `Serpent-bbb346` | 把插件写回最小快照字段表写进手册与 SDK | 简单 | 做 |
| `Serpent-e0e8be` | replaceContent 支持改文件名并审计身份变更事件 | 复杂 | 只开单 |
| `Serpent-8fc527` | 自动化文件计划校验不得冒充导入冲突错误 | 简单 | 做 |
| `Serpent-be59cf` | 暴露宿主 FFmpeg capabilities 给插件 | 复杂 | 只开单 |
| `Serpent-2d4975` | 锁定捆绑 FFmpeg 方言与编码器说明书 | 简单 | 做 |
| `Serpent-ed5880` | 插件模态栈与 Job 活动条升为 Host 原语 | 复杂 | 只开单 |
| `Serpent-f3add4` | 守住 widget select 在 options 变化时 coerce | 简单 | 守住/补 Guest 断言 |
| `Serpent-92a5c2` | 手册写明 when/enablement 与 HTML 对话框分层 | 简单 | 做 |
