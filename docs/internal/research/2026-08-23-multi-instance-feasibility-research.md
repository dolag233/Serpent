# Serpent 多实例、多窗口与多资源库可行性调研

> 日期：2026-08-23  
> 范围：同一台电脑上同时打开多个 Serpent 窗口、同时浏览多个资源库，以及同一资源库被多个实例打开时的并发边界。  
> 结论：本调研只记录现状和实施建议，不改变产品代码。

## 1. 结论先行

可以实现，但不是打开一个开关就完成的小改动。

- 当前正式应用是单实例模型：第二个进程会把参数交给已有进程，已有窗口获得焦点，第二个进程退出。
- `npm run start:multi` 是开发调试开关，不是用户可用的多窗口功能。它隔离 `userData` 并绕过单实例锁，目的是让开发者启动隔离的开发进程；它没有提供多个窗口之间的库上下文、菜单、事件和写入协调。
- Library Worker 的底层已经可以在一个进程内维护多个资源库句柄：`LibraryService` 使用 `openById` 和 `openIdByPath` 两个 Map，命令也普遍携带显式 `libraryId`。这是实现多库窗口的良好基础。
- 桌面层仍把 `mainWindow` 当成唯一窗口。Library IPC、拖拽、生命周期事件、进度事件和许多权限检查都只接受或发送给这个窗口；Renderer 也只有一个当前 `library` 状态，打开新库会替换并关闭旧库。

因此，推荐的产品路线是：**一个 Electron 进程，多个 BrowserWindow，每个窗口绑定一个资源库；多个窗口共享一个 Library Worker，但所有请求和事件按窗口及 `libraryId` 路由。** 这比直接放开多个独立进程更容易保持菜单、托盘、扩展、MCP 和后台任务的一致性。

## 2. Electron 的平台能力与当前实现

Electron 原生支持创建多个 `BrowserWindow`；每个窗口有独立的 `webContents` 和唯一窗口 ID。[BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window)

但 Electron 的 `app.requestSingleInstanceLock()` 会让一个应用进程成为主实例；后续进程拿不到锁并应退出，主实例收到 `second-instance` 事件。官方示例的默认行为就是恢复并聚焦已有窗口。[app API：单实例锁与 second-instance](https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata)

Serpent 当前正是这个模型：

- `src/main/index.ts` 在模块初始化阶段调用 `app.requestSingleInstanceLock()`；拿不到锁就 `app.quit()`。
- `second-instance` 只调用 `focusMainWindow()`，不会创建第二个窗口，也不会把待打开的资源库路径路由给新窗口。
- Main 只保存一个 `let mainWindow: BrowserWindow | undefined`。
- `LIBRARY_REQUEST_CHANNEL` 的 IPC handler 直接检查 `event.sender === mainWindow.webContents`；资产原生拖拽、插件管理、应用菜单状态、locale、活动上下文等 handler 也有同类单窗口检查。
- `publishAssetChange`、`publishLibraryChanged`、进度、AI 进度和生命周期通知均发送到 `mainWindow.webContents`。

仓库里已有一个 Electron-free 的 `src/main/window-router.ts`，能按窗口 ID 保存库上下文并向指定窗口或同库窗口广播；但它目前只被单元测试使用，没有接入 `src/main/index.ts`。这说明多窗口路由曾被抽象过，但当前产品壳尚未完成迁移。

## 3. Worker 和资源库底层现状

### 3.1 同一 Worker 可以打开多个库

`LibraryService` 的 `openById`、`openIdByPath`、watcher、任务和缓存大多按 `libraryId` 建立 Map。`openLibrary()` 在路径已打开时返回现有摘要，`listLibraries()` 返回所有当前打开的库，`closeAllAsync()` 逐库关闭。因此 Worker 层并不是“只能有一个库”。

Renderer 之所以只能看到一个库，主要是 UI/生命周期策略：`runLibraryOpenPipeline()` 在新库打开成功后关闭旧库、清空资产和导航状态，然后设置新的 `library`；外部 Eagle/Billfish 打开流程还会在 Main 中调用 `closeOpenLibrariesBeforeReplacement()`，把所有已打开的库关闭后再替换。

### 3.2 写租约已经具备跨进程基础

资源库写入使用 `library_write_leases` 与 `LibraryWriteCoordinator`。写租约是按库、短时取得和释放的，不是整个应用生命周期的独占锁；租约过期后可接管，写入同时继续受 SQLite 事务和文件操作恢复记录保护。这适合多窗口共享一个库，也为未来的独立进程读写提供了基础，但不能单独证明多机或同库多写已经支持。

## 4. SQLite 并发边界

SQLite 允许多个进程同时打开同一个数据库并同时读取；写入时需要对数据库取得写锁，写者之间不能并行。SQLite 官方 FAQ 明确说明它适合多读者，但客户端/服务器数据库通常更适合更高并发的多写者场景。[SQLite FAQ：多个进程与读写锁](https://sqlite.org/faq.html#q5)

WAL 模式能让读者不阻塞写者、写者不阻塞读者，但官方明确限制：所有进程必须在同一台主机上，WAL 不适用于网络文件系统；WAL 仍然只有一个写者。[SQLite WAL](https://www.sqlite.org/wal.html)

这对 Serpent 的含义是：

- 不同资源库：数据库文件不同，天然没有 SQLite 文件锁冲突；主要风险是 CPU、IO、缩略图/AI 队列共享。
- 同一台电脑的多个 Serpent 窗口/进程打开同一库：可以支持多读者，写入仍必须经过已有写租约和短事务。
- 同一资源库放在 NAS/SMB 上：不能把本地 WAL 的并发假设直接套上去。当前仓库的 NAS 研究已经把边界定为“单写者 + 多读者、实验性、自担风险”，并要求网络盘走 rollback journal/预检，而不是把多机多写当成已支持功能。
- 同库多个窗口如果共享同一个 Worker/SQLite 连接，窗口之间甚至不需要重复打开数据库；每个窗口只需带自己的 UI 上下文。若采用多个进程，则必须处理写租约、变更序号、watcher 重复和后台任务重复执行。

## 5. `start:multi` 的真实含义和限制

`package.json` 的 `start:multi` 运行 `scripts/dev-start.mjs --multi`。该模式：

1. 设置 `SERPENT_ALLOW_MULTI_INSTANCE=1`，跳过 Electron 单实例锁；
2. 将 `userData` 放到 `dev-instances/pid-<pid>`，避免 SingletonLock、偏好和日志互相污染；
3. 打印提示，明确要求不要让两个 GUI 同时写同一个库。

它不是正式多窗口能力，原因包括：

- 每个开发进程有自己的 Worker、Renderer、托盘、扩展服务器和 MCP 服务，不共享窗口或当前库上下文。
- 多进程会重复消耗缩略图、AI 和扫描资源；同库写入只能依赖写租约，且读者侧 watcher/后台副作用仍需额外归属规则。
- `scripts/dev-start.mjs` 每次启动前调用 `killStaleSerpentDevProcesses()`；Windows 使用 WMIC 按仓库路径匹配并终止 Electron，macOS/Linux 使用 `pkill -f` 匹配开发进程。按当前实现，第二次执行同仓库 `start:multi` 可能先杀掉已有的开发进程，因此不能把它当作可靠的并行启动器。

## 6. 实现多窗口多库需要改造的边界

### 6.1 Main/IPC 路由

- 用 `WindowRouter` 或等价实现替代全局 `mainWindow`：注册/注销每个 BrowserWindow，按 `event.sender` 得到窗口 ID。
- 每个窗口保存 `{ libraryId, selectedFolderId, viewerState }`，IPC 鉴权只验证“发送者是已注册窗口”，目标库从经过校验的命令和窗口上下文中确定。
- 所有生命周期、资产变更、缩略图、媒体任务、AI 进度事件按 `libraryId` 广播到绑定该库的窗口；只属于某个请求的响应仍只回请求窗口。
- 原生拖拽、扩展保存、菜单启用状态、locale、窗口快捷键、设置弹窗和确认弹窗改为聚焦窗口或请求窗口目标，不能继续依赖唯一 `mainWindow`。

### 6.2 Renderer 状态

- 每个 BrowserWindow 保持自己的导航、选择、查看器、筛选和 Inspector 状态。
- 打开新资源库只改变当前窗口，不再关闭其他窗口或全局关闭所有库。
- 当前的 `library` 单值状态可以保留在每个 Renderer 内，不需要让一个 Renderer 同时渲染多个库。

### 6.3 后台服务和生命周期

- 一个 Worker 共享多个库时，任务调度、缓存、watcher 和 AI 事件必须继续以 `libraryId` 隔离。
- 同一库多个窗口只应有一套 watcher/后台副作用；窗口关闭不能误关仍被其他窗口使用的库。需要引用计数或“最后一个窗口关闭才 close library”的规则。
- 外部库转换、导入、删除和切库应只影响发起操作的窗口。当前 `closeOpenLibrariesBeforeReplacement()` 的“关闭所有库”策略需要改成窗口级策略。
- 退出最后一个窗口时，Worker 仍要按每个打开库执行有序关闭、备份和任务收尾。

### 6.4 全局服务

托盘、自动更新、MCP、浏览器扩展服务器、插件 global instance、全局菜单和快捷键属于应用级服务，不能随着某一个窗口关闭而重复启动或提前销毁。它们需要一个明确的聚焦窗口/默认目标窗口规则。

## 7. 推荐实施顺序

1. **先做 P1 设计与测试工单**：确定“新窗口打开库”的入口、同库多窗口是否允许写入、关闭最后一个引用才释放库、MCP/扩展如何选目标窗口。
2. **第一阶段：同一进程多窗口、不同库**。接入 WindowRouter；每个窗口可打开一个库；先保证浏览、搜索、查看、关闭和菜单路由，暂不开放复杂的同库多写。
3. **第二阶段：写入和跨窗口刷新**。沿用 `LibraryWriteCoordinator`，补同库多窗口写入的等待/冲突提示、library change sequence 刷新和任务归属。
4. **第三阶段：外部库、扩展、MCP、插件和托盘**。逐一补窗口目标规则，避免“聚焦 A 却把资产保存到 B”。
5. **第四阶段：独立进程/同库测试**。只有在同进程窗口稳定后，再验证 `requestSingleInstanceLock` 的显式多进程模式、不同 userData、同库 lease、NAS 单写者边界和 packaged Windows/macOS 行为。

## 8. 建议验收矩阵

| 场景 | 目标行为 | 当前状态 |
| --- | --- | --- |
| 两个窗口，库 A/B | 各自浏览、搜索、查看，关闭 A 不影响 B | 未支持；Worker 基础存在，Main/Renderer 未路由 |
| 同一窗口先 A 后 B | B 替换 A | 当前支持 |
| 两个窗口，同一库 | 读操作一致；写入串行；只关闭一个窗口不关闭库 | 未支持 |
| 两个独立进程，库 A/B | 各自运行 | 开发模式部分尝试；非产品能力，`kill-stale` 有互杀风险 |
| 两个独立进程，同一库 | 单写者、多读者、变更最终同步 | 设计基础存在；未完成完整产品支持 |
| 两台机器，同一 NAS 库 | 实验性单写者、多读者 | 未作为稳定产品能力宣传，仍需平台/NAS 验证 |

## 9. 参考

- [Electron `app.requestSingleInstanceLock`](https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata)
- [Electron `BrowserWindow`](https://www.electronjs.org/docs/latest/api/browser-window)
- [SQLite FAQ：多个进程访问数据库](https://sqlite.org/faq.html#q5)
- [SQLite WAL：并发与网络文件系统限制](https://www.sqlite.org/wal.html)
- [SQLite File Locking And Concurrency](https://www.sqlite.org/lockingv3.html)
- [Serpent ADR-0021：桌面与 CLI 采用独立进程并短暂协调资源库写入](../adr/0021-independent-first-party-clients.md)
- [Serpent NAS 单写者 + 多读者决策草案](2026-08-19-nas-single-writer-multi-reader-decision.md)
- [Serpent 窗口路由原型](../../../src/main/window-router.ts)
