# Electron 后台任务架构调研

> 调研日期：2026-07-11
> 目的：为 Serpent 的缩略图生成、媒体解析、全文索引和云端 AI 队列确定 Electron MVP 后台架构。
> 来源约束：只采用 Electron 与 Node.js 官方文档。文中将官方事实与对 Serpent 的推断分开。

## 结论

Serpent MVP 应采用以下结构：

```text
Renderer（UI，sandbox + contextIsolation）
    │ 受限 IPC / MessagePort
    ▼
Main（窗口、应用生命周期、权限校验、进程监督）
    │ utilityProcess.fork
    ▼
Library Worker（一个常驻 UtilityProcess）
    ├─ 数据库与全文索引的唯一写入者
    ├─ 持久任务队列与进度聚合
    ├─ 图片缩略图、元信息提取
    ├─ 云端 AI 请求与重试
    └─ child_process.spawn / execFile
          └─ FFmpeg 等平台原生工具（按任务启动，限制并发）
```

明确选择：

- **Renderer 只负责 UI，不读取资产目录、不操作数据库、不运行后台队列。** 保持 `nodeIntegration: false`、`contextIsolation: true` 和 renderer sandbox。
- **Main 只做控制面。** 它创建窗口、校验 IPC、启动并监督 Library Worker、处理原生菜单/对话框和退出流程；不做缩略图、扫描、索引或媒体处理。Electron 官方明确要求不要用长任务或阻塞 I/O 阻塞 main，因为 main 同时承载应用的 UI 线程和进程协调。[Electron Performance：Blocking the main process](https://www.electronjs.org/docs/latest/tutorial/performance#3-blocking-the-main-process)
- **一个常驻 `utilityProcess` 作为资源库任务服务。** Electron 官方把 Utility Process 定位为适合“不可信服务、CPU 密集任务或易崩溃组件”的 Node 子进程，并建议在需要从 main fork Node 子进程时优先于 `child_process.fork`。[Electron Process Model：The utility process](https://www.electronjs.org/docs/latest/tutorial/process-model#the-utility-process)
- **FFmpeg 等独立可执行文件使用 `child_process.spawn()`/`execFile()`，由 Library Worker 按需启动。** 不用 shell 拼命令，不用同步 API；Node 官方说明 `execFile()` 默认直接启动目标文件而不先启动 shell，同步版本会阻塞事件循环。[Node.js Child Process](https://nodejs.org/api/child_process.html)
- **MVP 不使用 Web Worker 承担后端任务，也不急着引入 `worker_threads`。** 后者只在未来确认某段纯 JavaScript CPU 计算成为瓶颈时，作为 Library Worker 内的有上限线程池使用。

这不是“每种任务一个常驻进程”。MVP 先用一个 Library Worker 统一拥有数据库、队列和后台状态，媒体任务再以受控的 FFmpeg 子进程隔离。这样足以避免 UI/main 被拖死，也不会过早引入多进程分布式调度。

## 为什么不是 Renderer 或 Main

### Renderer：只适合交互和轻量展示计算

Electron 的 renderer 与浏览器页面等价；每个 `BrowserWindow` 都有对应 renderer，而且窗口销毁时对应 renderer 也会终止。[Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model#the-renderer-process) 因此把资源扫描、索引或 AI 队列放在 renderer 会产生三个问题：

1. 窗口关闭、刷新或 renderer 崩溃会丢失任务宿主。
2. 长任务会争夺滚动、卡片 hover 预览和动画所需的事件循环与 CPU。Electron 官方建议 renderer 中的小任务用 `requestIdleCallback()`，长 CPU 任务才考虑 Web Worker。[Electron Performance：Blocking the renderer process](https://www.electronjs.org/docs/latest/tutorial/performance#4-blocking-the-renderer-process)
3. 为了访问文件、Node 模块或子进程而给 renderer 开启 Node 集成，会破坏安全边界。Electron 官方建议 renderer 启用 context isolation 与 sandbox，并要求校验所有 IPC sender。[Electron Security Checklist](https://www.electronjs.org/docs/latest/tutorial/security#checklist-security-recommendations)

Renderer 可以做的后台工作仅限与当前视图绑定、无权限、可随时丢弃的计算，例如卡片布局、客户端筛选结果的轻量转换，或图片预览的浏览器端解码。持久队列和磁盘操作不属于这一类。

### Main：只做控制面

Electron 每个应用只有一个 main；它管理窗口、应用生命周期、系统原生 API，也承载 UI 线程。[Electron Process Model：The main process](https://www.electronjs.org/docs/latest/tutorial/process-model#the-main-process) Electron 官方措辞很明确：长任务阻塞 main 会冻结整个应用，main 中应避免同步 IPC 和阻塞 I/O。[Electron Performance](https://www.electronjs.org/docs/latest/tutorial/performance#3-blocking-the-main-process)

因此 main 只承担：

- 创建/恢复 Library Worker；
- 在 preload 暴露的窄接口上校验命令、路径和 sender；
- 将 renderer 与 worker 的 `MessagePort` 接通；
- 处理窗口、菜单、对话框、系统回收站等 Electron 原生能力；
- 在应用退出时停止接收新任务，等待短暂落盘，然后终止 worker 和其子进程。

main 不直接执行目录递归扫描、图像解码、FFmpeg、SQLite 全文索引重建或 AI 上传。

## 候选机制比较

| 机制 | 隔离与崩溃影响 | IPC / 数据交换 | 生命周期 | 沙箱与权限 | 打包影响 | Serpent 结论 |
|---|---|---|---|---|---|---|
| Renderer | 独立于 main，但 renderer 卡顿直接损害 UI；窗口销毁即终止 | `ipcRenderer`、MessagePort | 绑定窗口 | 默认无 Node；应保持 sandbox 和 context isolation | 普通前端 bundle | 仅 UI，不承载持久后台任务 |
| Main | 无隔离；异常或阻塞影响整个应用 | Electron IPC 中枢 | 与应用一致 | Node 全权限，最高价值攻击面 | 普通 main bundle | 只做生命周期、权限与监督 |
| Electron Web Worker | 独立 OS 线程，但仍属于 renderer 上下文；不隔离 native crash | Web `postMessage`，可转移 ArrayBuffer | 依附 renderer | 开启 `nodeIntegrationInWorker` 要求 renderer 不使用 sandbox；且 Worker 不能使用 Electron 内置模块 | worker 脚本需被 bundler 正确输出 | 不用于 Serpent 后端 |
| `worker_threads` | 独立线程、共享同一进程；JS 异常可处理，但进程级 native crash 仍会带走宿主进程 | structured clone、Transferable、SharedArrayBuffer；可共享内存 | 由宿主进程管理 | 与宿主 Node 进程同权限，不是安全边界 | worker 入口需单独打包；native addon 仍有 ABI/线程安全要求 | 未来只用于纯 JS CPU 热点的有界线程池 |
| `utilityProcess` | 独立进程；有 `error`、`exit` 和 pid，可单独杀死/重启 | `postMessage`、`process.parentPort`、可转移 MessagePort；可把 port 直连 renderer | main 在 `app.ready` 后创建并监督 | 有完整 Node API；应视为应用权限进程，而非插件安全沙箱 | worker 入口需可定位；native addon 需为 Electron ABI 构建 | MVP 的常驻后台服务 |
| `child_process` | 独立 OS 进程，最适合隔离 FFmpeg 等原生程序 | stdin/stdout/stderr、信号；`fork` 另有 Node IPC | 父进程显式启动、取消和回收 | 继承应用 OS 权限；需限制二进制和参数 | 平台二进制需随包分发、签名并从 ASAR 外执行 | 只用于 FFmpeg/外部工具，不替代任务服务 |

### UtilityProcess 的具体优势与边界

`utilityProcess.fork()` 提供 Node 环境和 MessagePort，底层通过 Chromium Services API 启动；只能在 Electron `ready` 之后调用。它支持 `env`、`cwd`、网络 `session`/`partition`、stdout/stderr、`serviceName`，并暴露 `spawn`、`error`、`exit` 事件和 `kill()`。[Electron utilityProcess API](https://www.electronjs.org/docs/latest/api/utility-process)

对 Serpent 的直接价值是：

- 图像解析或 native addon 令 worker 崩溃时，main 和 UI 仍可显示失败原因并重启服务；
- 可用 `serviceName` 在 `app.getAppMetrics()` 和 `child-process-gone` 事件中识别后台服务；
- main 创建 `MessageChannelMain` 后，可以把一端交给 worker、另一端交给 renderer，避免高频进度消息都经 main 转发。Electron 官方文档确认 MessagePort 可跨 renderer/main 传递，Utility Process API 也支持转移 `MessagePortMain`。[Electron MessagePorts](https://www.electronjs.org/docs/latest/tutorial/message-ports)、[Electron utilityProcess API](https://www.electronjs.org/docs/latest/api/utility-process)

边界也要写清楚：

- Utility Process 拥有完整 Node API，默认还继承 `process.env`。**进程隔离不等于权限沙箱**；不要把第三方插件直接放进该进程并认为其安全。
- `utilityProcess` 的 stdin 不可配置为 pipe，所以需要交互式 stdin 的 FFmpeg 等工具应由 worker 再用 `child_process.spawn()` 启动。[Electron utilityProcess API](https://www.electronjs.org/docs/latest/api/utility-process)
- `allowLoadingUnsignedLibraries` 会改变 macOS helper 与 entitlement；官方建议没有明确需求时保持关闭。Serpent 应分发已签名的原生依赖，不把该选项作为默认逃生舱。[Electron utilityProcess API](https://www.electronjs.org/docs/latest/api/utility-process)

### Web Worker 与 worker_threads 的位置

Electron 的 Web Worker 可通过 `nodeIntegrationInWorker` 获得 Node 内置模块，但该选项不能与 renderer sandbox 同时使用；Web Worker 也不能使用 Electron 内置模块。Electron 还强烈警告不要在 Web Worker 中加载 native Node 模块，因为这可能导致崩溃或内存损坏。[Electron Multithreading](https://www.electronjs.org/docs/latest/tutorial/multithreading)

这与 Serpent 需要处理不可信媒体、保持 renderer sandbox 的目标冲突，所以不采用。

Node 的 `worker_threads` 更适合**CPU 密集的 JavaScript**，不太帮助 I/O 密集任务；Node 自带异步 I/O 对后者更有效。线程可以转移 `ArrayBuffer` 或共享 `SharedArrayBuffer`，重复短任务应使用线程池而不是每任务新建线程。[Node.js Worker Threads](https://nodejs.org/api/worker_threads.html)

因此 MVP 不为“架构完整”而创建线程池。未来只有当性能分析证明色卡计算、感知哈希、纯 JS 图像变换等占用 Library Worker 事件循环时，才建立固定上限的 `worker_threads` 池。SQLite native addon、FFmpeg 和未知格式解析优先留在进程边界外，不放进共享进程的线程里。

## 按任务给出的部署决定

### 缩略图与图片元信息

放在 **Library Worker**。

- Node 异步读文件，解码与缩放通过经过验证的库完成；输出直接写入 `.serpent/previews/`，IPC 只回传状态、路径和少量元数据，不传整张大图。
- 限制并发，先生成当前视口/当前文件夹需要的缩略图，再处理后台积压，以满足 3 秒内渐进可用目标。
- 若解码库是 native addon，加载在 Utility Process 而不是 main；崩溃最多触发 worker 重启和该任务重试。
- 如果后续发现某个纯 JS 变换阻塞 worker，再把该步骤放入 `worker_threads` 池，而不是把整个任务系统迁入线程。

### FFmpeg、视频缩略图、抽帧、波形和媒体探测

由 **Library Worker 使用 `child_process.spawn()`/`execFile()` 启动 FFmpeg/ffprobe**。

- 每个任务或一小批任务一个外部进程，设置并发上限；取消任务时向具体子进程发送终止信号并清理临时文件。
- 使用参数数组直接启动固定二进制，不使用 `exec()` 或 shell 字符串，避免引用错误和命令注入。
- 捕获 stdout/stderr 和退出码，形成用户可见的失败原因；媒体解析崩溃不影响任务服务、main 和 renderer。
- 不把未经验证的媒体交给 main 或 renderer 解码。进程隔离降低崩溃波及范围，但 FFmpeg 仍继承应用用户权限，因此输入/输出路径必须由任务服务验证。

Node 官方将 `spawn()`、`execFile()` 等异步 API 与会阻塞事件循环的同步 API 明确区分；`execFile()` 默认不会先启动 shell。[Node.js Child Process](https://nodejs.org/api/child_process.html)

### 全文索引与数据库

由 **单个 Library Worker 作为唯一数据库写入者**。

- 所有资产、标签、描述、Label、文件夹和任务状态都经这个进程串行提交；renderer 发送声明式命令，不直接持有 SQLite 连接。
- 全文搜索查询也从同一服务返回分页结果；进度和结果可以经 MessagePort 直达 renderer。
- 索引更新拆成小事务并可恢复；任务入队、状态变更和最终索引结果先持久化，再通知 UI。
- 这能避免多个 renderer/main/worker 同时持有写连接而人为放大锁与一致性问题，也使 10 万文件下的重建、暂停和恢复只有一个状态源。

如果采用 native SQLite 模块，Electron 官方指出 native Node 模块必须针对 Electron ABI 重新编译；Electron Forge 会在构建 distributable 时集成 `@electron/rebuild`。[Electron Native Node Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)

### 云端 AI 队列

放在 **Library Worker 的异步 I/O 队列**，MVP 不需要专门线程或 AI 进程。

- Node 官方说明 worker threads 对 I/O 密集工作帮助不大，异步 I/O 更合适。[Node.js Worker Threads](https://nodejs.org/api/worker_threads.html)
- 队列状态持久化到数据库，包含模型、提示词/分析版本、输入衍生物、重试次数、错误、进度和取消标记。
- 暂停、继续、取消、重试都作用于队列记录；请求使用 `AbortController` 取消。
- API Key 不发送给 renderer，不出现在命令行参数或日志；worker 从 main 经受限启动参数或安全存储桥接取得凭据。
- 退出应用时停止领取新任务，短时间等待当前请求完成或取消；下次启动从持久状态恢复，而不是依靠 worker 常驻到应用退出之后。

## 崩溃、恢复与生命周期

建议的 MVP 监督规则：

1. main 在首个窗口可交互后懒启动 Library Worker。Electron 官方建议推迟不影响当前用户路径的昂贵初始化，避免启动时进行重磁盘 I/O。[Electron Performance：Loading and running code too soon](https://www.electronjs.org/docs/latest/tutorial/performance#2-loading-and-running-code-too-soon)
2. worker 启动后先恢复数据库中的 `queued/running` 任务；上次异常留下的 `running` 任务改为“待重试”，不能假定已完成。
3. 每个输出都先写临时文件，成功校验后原子替换目标；崩溃后清理孤立临时文件。
4. main 监听 worker 的 `error`、`exit`，记录诊断信息并采用有上限的退避重启；连续崩溃时进入降级模式，UI 仍可浏览已有索引并显示修复入口。
5. FFmpeg 子进程的 pid、任务 ID 与临时文件路径由 worker 跟踪。worker 意外退出后，main 重启它；新 worker 在启动清理阶段处理孤立输出。不要依赖“进程没了所以工作一定没写一半”。
6. 正常退出时：停止接单 → 提交队列状态和数据库事务 → 取消/终止外部工具 → `utilityProcess.kill()`。Electron API 保证 `kill()` 发起温和终止并回收进程，但业务层仍需先完成落盘协议。[Electron utilityProcess API](https://www.electronjs.org/docs/latest/api/utility-process)

## IPC 与权限边界

MVP 不应暴露“任意路径读写”“任意命令执行”之类通用 IPC。preload 只暴露语义化方法，例如：

```text
search(query)
importFiles(fileTokens, options)
enqueuePreview(assetIds)
pauseJobs(filter)
cancelJob(jobId)
getJobProgress()
openAsset(assetId)
```

主进程校验 IPC sender；worker 再校验资源库 ID、asset ID、操作类型和最终解析后的绝对路径是否位于获准的资源库或链接文件夹范围内。Electron 官方安全清单要求验证所有 IPC sender、启用 context isolation 和 renderer sandbox，并避免把 Electron API 暴露给不可信 Web 内容。[Electron Security Checklist](https://www.electronjs.org/docs/latest/tutorial/security#checklist-security-recommendations)

进度事件可以使用一条 renderer ↔ Library Worker 的 MessagePort 长连接；低频、需要权限裁决的命令继续经过 main。不要在 IPC 中搬运视频帧或大图 Buffer，传递文件路径、任务 ID 和小型结构化元数据即可。

## 打包与跨平台影响

### Worker 入口

- `utilityProcess.fork(modulePath)` 需要实际可加载的 Node 入口；构建配置要把它作为独立 main/worker bundle 输出，并在开发与打包环境都通过稳定的绝对路径定位。
- Electron 源码通常可放在 ASAR 中，Node `require`/`fs` 得到 Electron 的 ASAR 虚拟文件系统支持。[Electron ASAR Archives](https://www.electronjs.org/docs/latest/tutorial/asar-archives)

### FFmpeg 与其他原生可执行文件

- Windows 与 macOS 需要各自架构的二进制；不要假定一个包跨 OS/CPU 复用。
- 二进制和需动态加载的原生文件放在 `app.asar.unpacked` 或 resources 外部目录。Electron 官方说明 `spawn`/`exec` 不能可靠执行 ASAR 内二进制，只有 `execFile` 获得有限支持；ASAR 也支持显式 `--unpack`。[Electron ASAR Archives](https://www.electronjs.org/docs/latest/tutorial/asar-archives#executing-binaries-inside-asar-archive)
- 发布时对整个应用与 helper/原生二进制执行 Windows/macOS 对应的代码签名与 macOS notarization。Electron 官方把代码签名列为分发应用的重要步骤，并说明 macOS 在应用包级签名。[Electron Packaging](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging#important-signing-your-code)

### Native Node 模块

- SQLite、图像库等 `.node` addon 必须有 Electron 对应 ABI 的预编译产物或在构建时用 `@electron/rebuild` 重编译。[Electron Native Node Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- 不在 Web Worker 加载 native addon。若未来在线程中使用 addon，必须单独确认其 Node-API、线程安全和 Electron 版本支持；默认仍在 Utility Process 主线程加载，通过进程隔离控制故障半径。

## MVP 实施边界

MVP 只实现：

1. 一个 Library Worker，不做多 worker 分片。
2. 一个持久任务表，统一缩略图、媒体、索引与 AI 任务的状态机：`queued / running / paused / succeeded / failed / cancelled`。
3. 三类并发槽：轻量图片任务、FFmpeg 外部进程、网络 AI 请求；每类有独立上限，避免一种任务饿死其他任务。
4. Library Worker 是数据库唯一写入者；所有长任务不进入 main/renderer。
5. worker/FFmpeg 崩溃可检测、任务可重试、临时输出可清理。
6. 应用退出时后台任务暂停并在下次启动恢复；MVP 不承诺“客户端退出后继续处理”。

MVP 暂不实现：

- 通用 `worker_threads` 池；
- 后台守护进程或系统服务；
- 应用退出后继续执行；
- 多台机器共享同一任务调度器；
- 把第三方插件直接装入 Library Worker；
- 为每种格式长期维持一个 Utility Process。

## 何时需要升级架构

- **Library Worker 被纯 JS CPU 任务持续阻塞：** 在该进程内增加有界 `worker_threads` 池，只迁移已测得的热点。
- **某一媒体/插件解析器反复拖垮 Library Worker：** 把该解析器拆为独立、可重启的 Utility Process；数据库仍由 Library Worker 单写。
- **需要应用关闭后继续处理：** 这是产品与安装模型变化，应另做后台 agent/系统服务 ADR，而不是简单把 child process `detached`。
- **开放第三方插件：** 必须另行设计能力权限、路径授权、网络许可、签名和进程隔离；Utility Process 的 Node 环境本身不是插件沙箱。
- **出现多个资源库同时重负载：** 先按活跃资源库调度；只有性能数据证明必要时，再演进为“一活跃资源库一个 worker”或共享 worker 池。

## 最终判断

对 Serpent 的 Electron + TypeScript MVP，最小且稳健的后台架构不是 renderer/main 二选一，也不是立即建立复杂线程池，而是：

> **Renderer 保持安全和流畅，Main 保持轻量；一个 Utility Process 统一拥有数据库、全文索引与持久任务队列；FFmpeg 等不可信或易崩溃的原生媒体工作再由它通过 child_process 隔离。**

它直接支持当前的 3 秒渐进启动、10 万资产、后台可见进度、暂停/取消/重试与媒体失败不阻塞导入，也为后续格式插件和本地 AI 留出了明确的进程边界。
