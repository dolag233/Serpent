# Serpent NAS 兼容性研究

> 研究日期：2026-08-20
> 研究范围：Serpent 当前的资源库、同库多机访问、NAS/网络素材与同步位置
> 研究状态：方案研究，不是产品验收结论。本文记录研究结论及当前工作树的第一阶段实现状态；不替代真实 NAS、Windows 或 packaged 验收。

## 1. 结论先行

Serpent 应把“资源库数据库放在哪里”和“素材文件放在哪里”作为两个独立决策。推荐的新版兼容方案是：

1. **默认方案：本地资源库 + NAS 作为链接素材位置、备份位置或受控同步源。** 本地库继续使用 WAL；NAS 上不放正在工作的 SQLite 数据库，也不使用通用同步软件实时同步活动数据库文件。
2. **直接放在 SMB/NAS：保留为明确标注的实验兼容模式。** 只允许在完成存储检测和 SQLite 事务/锁预检后启用；远端库使用 SQLite rollback journal（建议 `DELETE`）和 `synchronous=FULL`，不使用 WAL；默认单写者，掉线时立即停止写入。未知存储类型按远端/不安全处理。
3. **同一库多机：默认不支持多机同时写入。** 后续可实现“多读者 + 恰好一个写者”，但必须让写者租约、文件监听、缩略图/AI/重整等后台副作用全部服从同一写入所有权；在真实两台机器和至少一种 Samba/NAS 设备上验证前，不应宣称支持。
4. **迁移和恢复优先于自动修复。** 任何 NAS 直连失败都应引导用户把完整资源库复制到本地磁盘后恢复；不能让用户手动删除 `-wal`/`-shm` 文件，也不能把一次 `SQLITE_IOERR` 直接断言为“网络盘问题”。

这项建议与当前产品边界一致：产品定义允许 NAS/第三方同步目录作为资源位置但要求风险提示；MVP 同一资源库只允许一台电脑处于活动状态；断线时应停止写入并在重连后重新验证。参见 [产品简介](../../product-brief.md)、[现有 NAS 单写者/多读者决策草案](2026-08-19-nas-single-writer-multi-reader-decision.md) 和 [SQLite/FTS/单进程 ADR](../adr/0019-sqlite-fts-and-single-app-process.md)。

## 2. 当前实现基线

### 2.1 资源库数据库

以当前 `HEAD` 为基线，Worker 的 `openConfiguredDatabase` 在可写打开时无条件执行：

```ts
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
```

位置：`src/worker/library-service.ts:4079-4135`（HEAD 基线）。因此，直接把库放在 SMB/NAS 上时，基线实现会尝试使用 WAL；这与 SQLite 官方对 WAL 的网络文件系统限制冲突。

在 HEAD 基线中，打开/创建路径会检查目录存在、可写、schema 和迁移，但没有跨平台网络卷识别，也没有针对远端锁语义、临时文件、重开和掉线的预检。可写库打开后还会启动资源监听、链接目录协调、缩略图等后台工作：

- `createLibrary`：`src/worker/library-service.ts:32791-32852`
- `openLibraryPrimary`：`src/worker/library-service.ts:33296-33420`
- `adoptWritableOpenLibrary`：`src/worker/library-service.ts:33208-33293`
- 资源监听：`src/worker/library-service.ts:3613, 5540-5660`

`openLibraryReadOnly` 只供检查/CLI 等场景使用；当前 Desktop 并不会把普通打开的库降级成真正的只读会话。因而“多机读者”目前不是只加一个 DB 租约就能成立的产品能力。

### 2.2 写入协调与多机边界

仓库已有 `LibraryWriteCoordinator` 和 `library_write_leases`：

- `src/worker/library-write-coordinator.ts`
- `src/worker/library-service.ts:6941-7005`
- `src/worker/index.ts:907-994`

它可以成为未来跨进程/跨机写者租约的基础，但租约本身并不自动阻止所有后台文件副作用，也不能替代存储检测和 journal 选择。以 HEAD 基线为准，数据库打开仍是 WAL；工作树中的未提交改动虽已为确认网络卷选择 rollback，但尚未实现多机所有权。研究结论必须把“已有租约代码”视为可复用基础，而不是已经完成的多机安全保证。

当前仓库的产品和 ADR 也明确：一个 Serpent 应用进程负责一个库；同一库多机同时打开不是 MVP 支持范围；活动 SQLite 文件不能交给通用同步目录实时同步。

### 2.3 网络同步与链接素材

当前同步路径会把远端内容物化到本地资源库，而不是让活动 SQLite 文件直接驻留 WebDAV/NAS：

- `src/worker/index.ts:1133-1305` 下载清单和资产后调用本地 `createLibrary`。
- `src/renderer/OpenSyncLibraryDialog.tsx` 要求用户选择本地目标位置。

这条路径是推荐方案的良好基础。链接文件夹则把外部素材根目录存为绝对路径，并由 watcher/刷新机制观察其变化；NAS 断线、挂载点改变和 watcher 漏事件都需要单独建模，不能等同于本地文件夹。

### 2.4 当前错误映射的问题

`src/shared/protocol/errors.ts` 的通用 `SQLITE_IOERR*` 映射不能直接等同于网络共享：同一错误也可能来自本地磁盘 I/O、设备故障、权限/句柄问题或损坏的文件系统。只有已确认网络卷的打开路径才应使用 `LIBRARY_NETWORK_SHARE`；其他未带存储上下文的 I/O 错误使用 `LIBRARY_IO_ERROR`。`SQLITE_BUSY/LOCKED` 应优先表示锁竞争，不能直接提示“网络共享”。

### 2.5 工作树中的未提交 NAS 改动（不视为已验收）

本次研究期间工作树中已存在一组未提交的 NAS 改动；它们不是本研究文档新增的内容，也不能替代产品验收。当前改动包括：

- `src/worker/network-storage.ts`：macOS/Linux 通过 `mount` 输出和文件系统类型识别网络挂载，Windows 通过 UNC 启发式和 `GetDriveTypeW` 识别映射盘。
- `src/worker/library-service.ts:4112-4158`：确认 `local` 时选择 WAL，确认 `network` 或 `unknown` 时选择 `DELETE` rollback journal，并把确认的 `networkStorage` 传到资源库摘要。
- `src/main/index.ts`、`src/renderer/App.tsx` 和中英文文案：显示网络存储风险提示。
- `tests/unit/network-storage.test.ts`、`tests/worker/security-durability.test.ts`：覆盖检测函数和显式 `storageKind: network` 时的 journal 选择。

这组改动解决了“已确认网络路径不应无条件启用 WAL”的第一步，但与本研究推荐的新版完整方案仍有明确差距：

- `unknown` 当前会使用 fail-safe 的 rollback journal，但尚未进入本研究建议的完整预检/迁移路径，也不会自动宣称网络卷已兼容。
- 当前检测尚未使用 Apple `FileManager` 卷资源属性、Windows `PathIsUNCW`/`GetVolumeInformationW` 的完整卷画像；挂载表和启发式检测不能单独证明远端锁语义安全。
- 尚未看到目标目录临时文件 flush/rename/delete、rollback SQLite 重开、锁语义和断线预检；显式网络 journal 单测不构成真实 SMB/NAS 证据。
- `adoptWritableOpenLibrary` 仍会启动 watcher、缩略图、AI/reconcile 等后台服务；网络库的写者所有权和多机只读状态尚未实现。
- 已将无存储上下文的 `SQLITE_IOERR*` 分到 `LIBRARY_IO_ERROR`；确认网络卷的打开失败仍使用 `LIBRARY_NETWORK_SHARE`。掉线、锁、只读、空间、I/O 和损坏的完整状态机/上下文细分仍未完成。

后文的“推荐方案、禁止边界和验收指标”针对最终产品设计；在这组未提交改动完成跨平台和真实 NAS 验证前，不应把它们写成“已支持”。

推荐把“存储位置识别”和“底层错误”作为两个字段保存：`storageProfile`（`local`/`network`/`unknown`）+ `failureReason`（锁、掉线、只读、空间不足、I/O、损坏等）。这样既能给出针对性操作，也不误导用户。

## 3. 官方资料核对

### 3.1 SQLite：WAL 不是网络文件系统方案

SQLite 官方 [Write-Ahead Logging](https://sqlite.org/wal.html) 明确指出，WAL 的共享内存 wal-index 要求使用数据库的所有进程位于同一台主机；WAL 在网络文件系统上不能工作。WAL 还会在数据库旁产生 `-wal` 和 `-shm` 文件，多个进程需要访问同一共享内存状态。

SQLite 官方 [临时文件说明](https://sqlite.org/tempfiles.html) 说明 rollback journal 也依赖与数据库同目录的 journal 文件来保证事务回滚；WAL 则依赖 `-wal` 和 `-shm`。因此把 WAL 换成 rollback journal，只能移除 WAL 特有的共享内存限制，不能证明 SMB/NAS 的锁、原子写入、flush 和断线行为满足 SQLite 的全部假设。

SQLite 官方 [隔离文档](https://sqlite.org/isolation.html) 说明 SQLite 的写入仍是“一次一个写者”；rollback 模式写入时会排斥读者，WAL 才允许读者和写者并行，但 WAL 的并行能力不能用于跨主机网络文件系统。

SQLite 官方 [PRAGMA 文档](https://sqlite.org/pragma.html#pragma_journal_mode) 将 `DELETE` 列为默认 journal mode，并把 `OFF` 作为关闭原子性的危险模式。新版不应通过 `journal_mode=OFF`“绕过”网络盘问题；远端实验模式应采用有原子回滚保障的 rollback journal，并把并发和掉线限制写进产品边界。

SQLite 官方 [Online Backup API](https://sqlite.org/backup.html) 说明，直接复制正在运行的数据库文件存在一致性问题；Online Backup API 能在源库运行时分段复制，在短暂读取间隔外不长期锁住源库，并生成从备份开始时刻观察到的一致快照。它应作为 NAS 备份/迁移的基础，而不是对活动 `.db`、`-wal`、`-shm` 做通用文件复制。

### 3.2 Windows：UNC、映射盘和卷信息必须分别处理

Microsoft 官方 [Naming Files, Paths, and Namespaces](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file) 定义了 `\\server\\share\\directory` 形式的 UNC 网络路径；映射盘只是另一种访问 UNC 共享的路径入口，不能只检查字符串是否以 `\\` 开头。

Microsoft 官方 [PathIsUNCW](https://learn.microsoft.com/en-us/windows/win32/api/shlwapi/nf-shlwapi-pathisuncw) 可判断路径是否为合法 UNC 路径；[GetDriveTypeW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdrivetypew) 可将根路径识别为 `DRIVE_REMOTE`。检测实现应同时覆盖 UNC 路径和映射盘根，而不是只使用一个启发式正则。

Microsoft 官方 [GetVolumeInformationW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getvolumeinformationw) 可从本地路径或 UNC 根读取文件系统名、卷标和能力标志，也能帮助识别只读卷。但其文档特别说明 SMB 不支持部分卷管理函数；因此卷信息 API 适合补充诊断和只读判断，不能单独作为“这一定是安全本地盘”或“这一定支持 SQLite 锁”的证明。

Microsoft 官方 [ReadDirectoryChangesW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw) 说明远端目录监听可能因网络重定向器/文件系统能力失败；远端监听还受缓冲区大小和溢出影响，溢出后必须重新枚举目录。Windows 的 watcher 结果只能作为刷新优化，不能作为资产变化的唯一事实来源。

### 3.3 Apple：用卷资源属性识别本地/远端，但不能把检测当成安全证明

Apple 官方 [FileManager.mountedVolumeURLs(includingResourceValuesForKeys:options:)](https://developer.apple.com/documentation/foundation/filemanager/mountedvolumeurls(includingresourcevaluesforkeys:options:)) 提供已挂载卷的 URL，并支持预取卷资源属性；文档提醒获取属性可能触发 I/O，因此检测应放在不会阻塞 UI 的路径。

Apple 官方 [URLResourceKey](https://developer.apple.com/documentation/foundation/urlresourcekey) 提供 `.volumeIsLocalKey`、`.volumeIsReadOnlyKey`、`.volumeMountFromLocationKey`、`.volumeTypeNameKey` 等属性；其中 [volumeIsLocalKey](https://developer.apple.com/documentation/foundation/urlresourcekey/volumeislocalkey) 表示卷是否在本地设备上，[volumeMountFromLocationKey](https://developer.apple.com/documentation/foundation/urlresourcekey/volumemountfromlocationkey) 可提供卷的挂载来源。实现应按“匹配目标路径的最深挂载点”读取这些属性，并将属性缺失归为 `unknown`，而不是乐观当成本地卷。

Apple 的卷属性识别只能解决“路径所在卷大致是什么类型”，不能替代实际的 SQLite journal、锁、重开和掉线预检；网络文件服务器的语义仍需通过真实兼容性矩阵验证。

### 3.4 Samba：锁和 oplock 是服务端配置能力，不是客户端常量

Samba 官方 [smb.conf](https://www.samba.org/samba/docs/current/man-html/smb.conf.5.html) 对 `locking` 的说明指出，关闭真实锁会让客户端以为锁成功，从而造成数据损坏风险；`oplocks` 允许客户端缓存文件，网络不可靠或文件高度争用时应谨慎，`fake oplocks` 在多客户端读写场景可能导致损坏。

这意味着 Serpent 不能对所有“SMB/NAS”做同一个安全承诺：服务器型号、Samba 配置、SMB 版本、缓存/锁策略、断线恢复方式都可能改变结果。产品应在开放兼容模式前进行预检，并把“服务器配置不受 Serpent 控制”写入警告和支持边界；绝不能要求用户通过关闭锁或启用 fake oplocks 来修复应用问题。

## 4. 三种形态的兼容性判定

| 形态 | 新版建议 | 默认支持级别 | 关键限制 |
| --- | --- | --- | --- |
| SQLite 资源库直接放 SMB/NAS | 提供有条件的实验模式；远端使用 rollback journal + `synchronous=FULL` | 实验兼容，不作为默认推荐 | 单写者；必须通过存储/事务/锁预检；掉线立即停止写入；不保证任意 NAS |
| 多机同时打开同一库 | 先保持“不支持多机写入”；后续实现“多读者 + 一个写者” | 当前禁止；未来功能需单独验收 | 读者必须真的只读；只有租约持有者可触发所有 DB/文件副作用；需真实两机证据 |
| 本地库 + NAS/网络存储作为同步或素材位置 | 默认推荐；活动 DB 在本地，NAS 用链接素材、备份或受控同步 | 推荐 | watcher 不是事实源；链接源可离线；通用同步工具不能同步活动 DB |

### 4.1 直接 SMB/NAS 资源库

允许条件：

- 路径被可靠识别为 `network`，或者检测结果为 `unknown` 时用户明确进入实验模式；未知不应自动启用 WAL。
- 目标父目录能创建、写入、读取、flush、重命名、删除临时文件。
- 临时 SQLite 库能以 rollback journal 创建、写事务、关闭、重开并通过 `PRAGMA quick_check(1)`；实际 `PRAGMA journal_mode` 必须是 `delete`/其他明确的 rollback mode，而不能是 `wal`。
- 预检必须记录结果和设备路径，不写入用户正式库的数据。
- 应用必须把直接 NAS 库标记为“网络库/实验模式”，给出备份、单写者、掉线和性能提示。

禁止把以下情况当作可用：预检超时、锁测试失败、只能读不能可靠重命名、journal mode 被服务器/驱动改写、重新打开失败、断线后状态不明、数据库完整性检查失败。

### 4.2 同库多机

当前版本应继续禁止多机同时写入；“一个 DB lease”不等于完整多机支持。未来若实现：

- 只能有一个写者租约持有者；其他设备是明确的只读会话。
- 读者不能运行写事务、资源 watcher 触发的写入、缩略图持久化、AI 元数据落库、自动重整、导入、删除、评分、标签或合集变更。
- 写者崩溃后通过租约过期和重新验证接管，不允许客户端仅凭本地超时自行抢写。
- 所有写者和读者都必须观察 `library_change_sequence` 或等价变更序列；读者漏事件后应重新查询，而不是依赖 SMB watcher。
- 只有写者执行外部文件移动、删除、重命名等副作用；数据库和文件系统操作必须在同一 ownership 状态机下协调。

在这套行为和真实两机测试完成前，“多机同时打开”只能作为拒绝/迁移提示，不得作为稳定功能宣传。

### 4.3 本地库 + NAS 素材/同步

这是新版默认路线：

- `.serpent` 和 SQLite 数据库放本地 APFS/NTFS 等本地可写卷，继续使用 WAL。
- NAS 作为链接文件夹的素材源时，元数据和缩略图仍由本地库持有；NAS 断线时显示离线状态，禁止把不可确认的文件操作当作成功。
- NAS 作为备份目标时，先用 SQLite Online Backup API 生成一致的本地/临时快照，再复制快照或完整资源库目录到 NAS，并在目标上验证大小、哈希、SQLite 完整性和资产计数。
- 现有 WebDAV/远端同步流程应继续“下载到本地新库、应用清单、再切换”，而不是把远端数据库直接挂载成活动库。
- 任何 generic sync（Dropbox、OneDrive、iCloud Drive、Synology Drive 等）都不能实时同步活动 `.db` 或其 `-wal`/`-shm` 文件。

## 5. 推荐的跨平台检测和打开流程

### 5.1 存储画像

在打开数据库前，建立不依赖具体 UI 的 `StorageProfile`：

```text
storageKind: local | network | unknown
readOnly: boolean | unknown
mountSource: string | unknown       // 仅用于诊断，脱敏后展示
filesystem: string | unknown
pathKind: local-path | unc | mapped-drive | mounted-volume | unknown
probe: pass | fail | not-run
```

`linked source`、`sync source`、`backup target` 是用途字段，不应覆盖数据库卷的 `storageKind`。同一个 NAS 可以是“远端素材源”，但本地库仍是 `local`；反过来，数据库直接放 NAS 时库本身是 `network`。

任何平台检测失败都返回 `unknown`，不返回 `local`。unknown 的默认行为是：不启用 WAL，不自动声称兼容，要求预检或引导迁移。

### 5.2 Windows

建议在 native helper 或主进程的受控平台适配层实现：

1. 对路径做 Windows 长路径/大小写/分隔符规范化，并找到卷根。
2. 对 UNC 路径使用 `PathIsUNCW`；对盘符路径调用 `GetDriveTypeW(rootWithTrailingSlash)`，`DRIVE_REMOTE` 视为网络卷，因此覆盖映射盘。
3. 用 `GetVolumeInformationW` 读取文件系统名、只读标志和诊断信息；调用失败或返回不完整时保持 `unknown`。
4. 不把“不是 UNC”“是 NTFS”当成本地安全证明，也不把卷信息 API 当成锁语义测试。
5. 远端 watcher 只能触发补充刷新；监听失败、缓冲区溢出或断线都必须转为重新枚举/手动刷新提示。

### 5.3 macOS

建议在不阻塞 Renderer 的异步 worker/主进程路径：

1. 使用 `FileManager.mountedVolumeURLs(includingResourceValuesForKeys:options:)` 取得挂载卷列表，并预取 `.volumeIsLocalKey`、`.volumeIsReadOnlyKey`、`.volumeMountFromLocationKey`、`.volumeTypeNameKey`。
2. 为目标库路径选择匹配路径最长的挂载点，避免父卷信息覆盖嵌套网络挂载。
3. `.volumeIsLocalKey == false`、挂载来源显示网络位置或只读属性明确时，标记 `network`/`readOnly`；属性缺失时标记 `unknown`。
4. 检测只用于策略选择和提示，仍需运行临时 SQLite 预检；不因某一卷属性说“local”就跳过事务验证。

### 5.4 通用预检

检测结束后，针对目标目录运行一次可清理、可追踪的预检：

1. 在目标父目录创建随机临时文件，写入、关闭、重新打开读取、flush、重命名、删除。
2. 创建临时 SQLite 数据库，强制 `journal_mode=DELETE`、`synchronous=FULL`，完成建表、插入、更新、事务回滚和重开。
3. 检查正式 journal mode、`quick_check(1)`、`foreign_key_check` 和临时文件清理结果。
4. 记录耗时、错误码、路径类型和预检版本；日志中不记录凭据，网络主机/共享名按现有隐私策略脱敏。
5. 预检失败则给出迁移本地或修复网络挂载的操作，不尝试以 WAL、`journal_mode=OFF` 或删除 sidecar 规避。

预检不能替代双机锁测试。双机锁测试必须由两台独立主机、同一个真实共享、真实应用进程完成，并覆盖断线和进程崩溃后的恢复。

## 6. 多机状态机和后台副作用

推荐的远端库会话状态：

```text
opening
  ├─ local + writable  -> local-writable
  ├─ network + probe pass + lease acquired -> network-writable
  ├─ network + no lease -> network-read-only
  ├─ probe fail/unknown -> migration-required
  └─ I/O/disconnect -> offline

network-writable --lease lost/disconnect--> offline
network-read-only --writer change sequence--> refresh-read-only
offline --reconnect + probe + lease--> network-writable | network-read-only
```

关键规则：

- DB 租约必须有 owner ID、过期时间、心跳和 fencing/版本号；客户端不能只靠本地时钟假设自己仍是写者。
- `LibraryWriteCoordinator` 可作为实现基础，但应将 lease ownership 传递给 watcher、缩略图、AI、reconcile、自动备份和所有外部文件操作。
- 读者状态下，UI 命令层也要拒绝所有会修改数据库或素材的命令，而不是只依赖最后一层事务报错。
- 失去租约、收到 `EIO`、挂载消失或无法确认写入结果时，立即阻断后续写入；不要自动重试可能已经落盘的非幂等操作。
- 恢复连接后先重新读取卷画像、探测库、检查 schema/完整性和变更序列，再取得 lease；若状态不明，优先迁移或恢复快照。

## 7. 错误映射和用户文案

当前 `LIBRARY_NETWORK_SHARE` 不能承载所有 I/O 情况。建议增加或细化以下可操作错误：

| 证据/错误 | 建议内部原因 | 用户动作 |
| --- | --- | --- |
| 已识别网络卷，journal/锁/预检失败 | `LIBRARY_STORAGE_UNSUPPORTED` | 将完整库复制到本地；检查 NAS 的锁/缓存配置；查看预检详情 |
| 已识别网络卷，挂载消失、连接断开或恢复失败 | `LIBRARY_STORAGE_OFFLINE` | 重新挂载后重试；若有未确认写入，先从快照恢复/验证 |
| `SQLITE_BUSY`、`SQLITE_LOCKED` 或 lease 被占用 | `LIBRARY_BUSY` | 等待写者完成或在其他设备关闭库；不要提示网络盘故障 |
| `SQLITE_READONLY`、`EROFS`、卷只读 | `LIBRARY_READ_ONLY` / `READ_ONLY_FILESYSTEM` | 重新挂载可写卷或迁移到本地可写位置 |
| `EACCES`、`EPERM`、临时文件创建/重命名失败 | `LIBRARY_NOT_WRITABLE` | 检查权限、占用和目录访问；必要时迁移 |
| `ENOSPC`、`EDQUOT`、`SQLITE_FULL` | `DISK_FULL` | 释放本地或 NAS 配额/空间后重试 |
| `SQLITE_CORRUPT`、`SQLITE_NOTADB`、完整性检查失败 | `LIBRARY_CORRUPT` | 停止写入；从最近验证过的快照恢复或复制到本地抢救 |
| `EIO`、无法归类的 `SQLITE_IOERR*` | `LIBRARY_IO_ERROR` | 停止写入，检查磁盘/网络并优先恢复快照；不要武断说是 NAS |

“网络库”是状态提示，不是所有失败的根因。文案应说明“检测到的位置”和“实际失败原因”，例如：“网络资源库无法确认事务安全性。为了保护数据，请复制到本地磁盘后打开。”而不是笼统地说“SQLite 不支持 NAS”。

## 8. 迁移、备份和用户引导

### 8.1 NAS → 本地

提供一个向导式“复制到本地磁盘并打开”：

1. 提示关闭本库的其他窗口/设备，并等待所有写入结束。
2. 首选 SQLite Online Backup API 或已验证的一致快照；不能只复制裸 `.db`。
3. 复制完整资源库目录，包括 `.serpent`、数据库、`Assets`、缩略图/派生目录以及所有 SQLite sidecar；源目录保持不变。
4. 在本地目标上执行 schema、`quick_check`、外键检查、资产计数、文件大小/哈希抽样和可读预览验证。
5. 只有验证通过且用户确认后，才把本地副本设为最近使用；保留源库路径和迁移时间，便于回滚。

### 8.2 本地 → NAS

只有用户主动选择实验模式时提供：

1. 关闭本地库的全部客户端并创建验证快照。
2. 由应用完成 journal 模式迁移和完整目录复制；不指导用户手动删除 `-wal`/`-shm`。
3. 在 NAS 目标目录运行文件和 SQLite 预检，失败则不切换当前库。
4. 明确提示单写者、网络掉线、服务端锁配置、备份责任和性能不保证。

### 8.3 活动 WAL 库的抢救

当旧版本已经把库放在 NAS 并生成了 WAL sidecar：

- 先让所有客户端退出，不要删除 `-wal`/`-shm`。
- 如果能打开，使用 SQLite 一致备份/应用迁移把库复制到本地，再在本地验证。
- 如果不能打开，复制完整目录到本地进行只读诊断和恢复；源目录保留不动。
- 只有在完整性和资产校验通过后，才允许用户选择废弃旧路径。

### 8.4 NAS 链接素材离线/重连

链接文件夹应提供“重新选择根目录/重新连接”入口，并显示 `available`、`offline`、`needs-relink` 等状态。不要仅凭盘符、共享名或相对路径自动猜测另一台机器上的目录。后续可保存脱敏的路径身份信息（卷/共享提示、相对根、设备提示），但自动匹配仍应由用户确认。

## 9. 明确禁止支持的边界

以下行为不应作为 Serpent 的受支持方案：

- 在 SMB/NAS、通用云盘或同步目录上使用 SQLite WAL 活动库。
- 两台或多台机器同时写同一个库，或绕过 Serpent 直接用 SQLite 工具/脚本修改活动库。
- 通过关闭 SMB locking、使用 fake oplocks、关闭文件锁或要求某个 NAS 特殊缓存配置来“修复”一致性。
- 用 Dropbox/OneDrive/iCloud/Synology Drive 等同步工具实时复制 `.db`、`-wal`、`-shm` 或 journal 文件。
- 在 NAS/SMB 上运行 Electron `.app`、`node_modules`、`.vite`、`out` 或测试环境。仓库指南已明确这些运行时/构建目录必须放在本地磁盘；这条限制与“素材是否可链接到 NAS”是两件事。
- 断线后继续接受写入，或在写入结果不确定时自动重试非幂等移动/删除/评分操作。
- 把 watcher 收到事件当成网络素材变化的完整事实，或把 watcher 漏事件标记为数据已同步。
- 将实验模式的通过结果推广为所有 NAS 型号、所有 SMB 版本和 Windows/macOS 的跨平台保证。

## 10. 分阶段实施计划

### Phase 0：决策和观测（不改业务行为）

- 固化本文方案，更新产品边界/ADR/项目状态，明确“本地库 + NAS 素材/备份”是推荐路径。
- 设计 `StorageProfile`、错误码和诊断字段；为预检日志定义脱敏规则。
- 建立 macOS 本地/SMB、Windows 本地/UNC/映射盘、至少一种 Samba/NAS 的测试矩阵。

### Phase 1：跨平台存储检测和远端打开预检

- 实现 Windows UNC/映射盘检测和 macOS 卷属性检测，unknown fail-safe。
- 打开/创建前运行临时文件和 rollback SQLite 预检；远端不启用 WAL。
- 将直接 NAS 标记为实验模式，并记录实际 journal mode、预检结果和恢复提示。
- 更新错误映射，区分锁、掉线、只读、空间、I/O 和损坏。

### Phase 2：单写者/多读者状态机

- 让 lease ownership 控制所有 DB 写入和文件副作用。
- 实现真正只读的 reader 命令面、写者心跳/过期/fencing、变更序列刷新。
- 网络 watcher 仅作为优化；读者和断线恢复必须支持查询/重扫。
- 在没有两台独立机器实测前保持功能开关关闭或仅允许明确实验开启。

### Phase 3：备份和迁移向导

- 集成 Online Backup API/一致快照路线，提供 NAS↔本地迁移。
- 增加 WAL→rollback 的应用内迁移，不暴露 sidecar 手动操作。
- 复制后自动做完整性、计数、哈希抽样和媒体预览验证。

### Phase 4：NAS 链接素材体验

- 链接根目录状态、重新连接、手动重扫和离线操作保护。
- 为跨机器路径建立设备/卷/共享提示与用户确认的 relink 流程。
- 记录 watcher 漏事件后的恢复证据，不能依赖单一 watcher。

### Phase 5：发布门禁和默认策略

- 真实 macOS + Windows 矩阵、Samba + 至少一个主流 NAS 手工测试。
- 若无法获得 Windows/真实 NAS 证据，发布说明必须写“未验证”，默认关闭直接远端活动库。
- 只有所有写者/断线/恢复/迁移指标满足后，才考虑把远端单写者模式从实验提升为受限支持；多机读者仍需独立发布说明。

## 11. 验收指标和证据要求

每项结论按“需求条目 | 实现位置 | 自动化测试 | 人工/平台证据”四列追踪；缺一列只能写部分完成/未验证。建议指标如下：

### 存储和 journal

- macOS：本地 APFS、外接本地卷、SMB 挂载；Windows：NTFS、本地可移动卷、UNC SMB、映射盘；至少一台 Samba 和一台实际 NAS。
- 本地库实际 journal 为 WAL，且 `synchronous=FULL`；远端实验库实际 journal 为 rollback/`DELETE`，不产生活动 `-wal`/`-shm`。
- 创建、打开、事务提交、关闭、完整退出、重启、重开、迁移、断线重连均有日志和命令结果。
- 任何预检失败都必须阻止切换或明确进入迁移提示，不得静默降级。

### 数据安全

- 运行多轮关闭/重启和受控 I/O 故障测试，数据库通过 `quick_check`/外键检查，资产计数和哈希抽样无丢失。
- 备份快照能在独立进程/完整重启后打开；不能用“同一 Worker 没报错”替代重启证据。
- 断线写入结果不确定时，后续写入被阻断；重连后重新预检，不能自动假设成功。

### 并发

- 两台独立机器浏览同一远端库时，读者不会写库；只有一个 lease holder 能写。
- 第二写者得到可操作的忙/只读提示；写者崩溃后租约过期接管有明确测试证据。
- 不出现两个 watcher/缩略图/AI/reconcile 写者；变更序列能让读者最终看到写者提交的变化。

### 素材和同步

- NAS 链接素材支持断线、重连、路径重选和手动刷新；漏 watcher 事件后手动/周期重扫可恢复。
- 同步测试证明每台机器维护本地活动数据库，远端只传清单/快照/受控数据；没有活动 `.db` 的实时文件同步。

### 性能和发布

- 本地资源库继续遵守仓库既有首屏和交互预算；NAS 库另行记录 p50/p95 打开、首屏、查询和刷新延迟，不把本地 500ms 目标直接套到网络盘。
- 打包测试使用本地磁盘和隔离 `userData`；Electron、构建产物和测试临时目录不从 SMB/NAS 运行。
- 在 Windows 或真实 NAS 未执行时，报告写“未验证”，不能写跨平台通过。

## 12. 研究引用和仓库依据

### 官方一手资料

- [SQLite Write-Ahead Logging](https://sqlite.org/wal.html)
- [SQLite Temporary Files](https://sqlite.org/tempfiles.html)
- [SQLite Isolation](https://sqlite.org/isolation.html)
- [SQLite PRAGMA journal_mode](https://sqlite.org/pragma.html#pragma_journal_mode)
- [SQLite Online Backup API](https://sqlite.org/backup.html)
- [Microsoft: Naming Files, Paths, and Namespaces](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file)
- [Microsoft: PathIsUNCW](https://learn.microsoft.com/en-us/windows/win32/api/shlwapi/nf-shlwapi-pathisuncw)
- [Microsoft: GetDriveTypeW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdrivetypew)
- [Microsoft: GetVolumeInformationW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getvolumeinformationw)
- [Microsoft: ReadDirectoryChangesW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw)
- [Apple: FileManager mountedVolumeURLs](https://developer.apple.com/documentation/foundation/filemanager/mountedvolumeurls(includingresourcevaluesforkeys:options:))
- [Apple: URLResourceKey](https://developer.apple.com/documentation/foundation/urlresourcekey)
- [Apple: volumeIsLocalKey](https://developer.apple.com/documentation/foundation/urlresourcekey/volumeislocalkey)
- [Apple: volumeMountFromLocationKey](https://developer.apple.com/documentation/foundation/urlresourcekey/volumemountfromlocationkey)
- [Samba: current smb.conf](https://www.samba.org/samba/docs/current/man-html/smb.conf.5.html)

### 仓库依据

- [AGENTS.md](../../AGENTS.md)：本地运行约束、架构、资源库底线、Windows 未验证声明、验收纪律。
- [产品简介](../../product-brief.md)：本地资源库、链接文件夹、NAS/第三方同步风险、MVP 单机活动库和断线处理边界。
- [开发流程](../development-process.md)：资源库可用性门禁、证据纪律和发布验收要求。
- [领域模型](../domain-model.md)：资源库、素材、链接源和同步的语义边界。
- [2026-08-19 NAS 单写者/多读者决策草案](2026-08-19-nas-single-writer-multi-reader-decision.md)：已有事故、WAL/rollback 取舍、租约草案和待确认风险。
- [ADR-0019：SQLite FTS 与单应用进程](../adr/0019-sqlite-fts-and-single-app-process.md)：单库单进程、NAS rollback 实验边界、活动 DB 不做通用同步、Online Backup 方向。
- `src/worker/library-service.ts`：当前 WAL 打开路径、库创建/打开、可写接管和 watcher 启动。
- `src/worker/library-write-coordinator.ts`、`src/worker/index.ts`：当前租约/有界写入基础和同步物化本地库路径。
- `src/shared/protocol/errors.ts`：当前错误码与过宽的 `SQLITE_IOERR`/网络共享映射。

## 13. 本次工作边界

本研究先于实现完成，研究结论覆盖完整方案；随后同一工作区已落地 Phase 1 的最小闭环：`src/worker/network-storage.ts` 提供 macOS/Linux 挂载表、Windows UNC/映射盘识别，`openConfiguredDatabase` 对确认网络卷使用 rollback `DELETE` journal，并通过 `networkStorage` 标记和中英文提示告知实验性风险。实现与测试证据见 [2026-08-20 NAS 开发日志](../development/2026-08-20-nas-compatibility-development-log.md)。

尚未实现或验证的部分：临时文件/SQLite 预检、断线状态机、真正的单写者/多读者后台所有权、NAS↔本地迁移向导、强化快照策略；Windows、真实两机 SMB、真实 NAS 的完整写入/重启/断线矩阵、打包应用均未在本次自动化中执行。研究文档和实现均只留在本地工作区，按产品要求不推送，等待产品在真实 NAS 上测试后再决定下一阶段。
