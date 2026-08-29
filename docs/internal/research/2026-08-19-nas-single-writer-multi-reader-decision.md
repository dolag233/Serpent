# NAS/网络共享上的资源库：单写者 + 多读者模型（决策草案）

> 状态：**决策草案（待产品确认）** — 2026-08-19
> 触发：`Serpent-4f44f1`（NAS 打开 Eagle 转换报「无法写入」）与 `Serpent-f863df`（多台机器同时打开同一资源库）
> 本文件把 2026-08-19 产品讨论固化；确认后修订 ADR-0006/0014/0019/0028 并拆实施工单。

## 1. 背景

2026-08-18 起，用户（Theon 机器）在 NAS 上打开 Eagle 资源库并选择把转换后的 Serpent 库保存到 NAS 时失败：

- 0.1.1：`LIBRARY_NOT_WRITABLE`（「无法在所选文件夹写入文件」，误导性）
- 0.1.2（已含 `121be93` 错误映射）：`LIBRARY_NETWORK_SHARE`（「无法把资源库数据库放在此网络共享（NAS/SMB）上……请在本机磁盘创建或复制资源库；若需多台电脑间同步，请改用 WebDAV 同步」）

两份日志的 SQLite 根因相同：`SQLITE_IOERR_IN_PAGE`，发生在 `openConfiguredDatabase` 执行 `PRAGMA journal_mode = WAL` 时（见 `serpent (1).log` 行 10 与行 8349，cause.stack 均为 `Database.pragma → openConfiguredDatabase → createLibrary`）。

用户提出疑问：**为什么存在「数据库不能放 NAS」的约束？** 核查发现该约束并无原文出处，且与既有 ADR 矛盾（见 §2）。

## 2. 现状事实核查：三层矛盾

### 2.1 ADR 的设计意图：NAS 允许，降级 + 提示风险

| 文档 | 原文要点 |
|---|---|
| ADR-0006（多资源库） | 资源库允许位于本机磁盘、移动硬盘、**NAS 或第三方同步目录**；「产品提示风险但不禁止用户选择」；NAS 使用中断线时停止写入并进入只读/离线状态，恢复后重新校验再允许写入 |
| ADR-0014（短时写锁） | 「**检测为 NAS 时使用 rollback journal**，并显示网络文件系统风险提示」 |
| ADR-0019（SQLite FTS5 与单进程） | 「本机与直连移动盘使用 WAL、`synchronous=FULL`；**NAS 使用 DELETE rollback journal、`synchronous=FULL`，标记为实验性、自担风险**；MVP 明确不支持同一资源库被多台电脑同时打开」；「导出活动资源库时通过 SQLite Online Backup API 获取一致数据库快照」 |

### 2.2 代码实现：只做了 ADR 的「本地盘」半边

- `openConfiguredDatabase`（`src/worker/library-service.ts:4120`）**无条件** `journal_mode = WAL` + `synchronous = FULL`，没有网络盘检测、没有 rollback 回退 → NAS 上建库/打开必炸 `SQLITE_IOERR_IN_PAGE`。
- `121be93`（0.1.2）把 `SQLITE_IOERR_*` 精确映射为 `LIBRARY_NETWORK_SHARE`（`src/shared/protocol/errors.ts:269`），文案如实告知「不支持」——**把「未实现 ADR 降级」变成了「产品不支持」的外观**。
- `createLibrary` 前置检查只有目录存在 + `accessSync(W_OK)`（`src/worker/library-service.ts:32795`），NAS 可写即放行，之后在 WAL pragma 处失败。

### 2.3 约束表述：「数据库不能放 NAS」无原文出处

仓库中真实存在的约束是**环境约束**：「不能从 SMB/NAS 路径跑 Electron」（应用本体与依赖，`icudtl.dat` SIGTRAP / code-sign 失败）。「数据库不能放 NAS」仅出现在工单分析文字中，AGENTS.md / CLAUDE.md / ADR 均无此条款原文。它是「环境约束被泛化」+「0.1.2 报错文案」共同形成的印象。

**结论：支持 NAS 资源库不是推翻产品决策，而是落地 ADR-0006/0014/0019 早已采纳、但从未实现的设计。**

## 3. 技术根因：为什么 WAL 在 NAS 上失败

- WAL 模式依赖三样东西：`-wal` 边车文件、`-shm` 共享内存文件、字节范围锁。
- SMB 协议没有真正的跨进程共享内存；`-shm` 依赖服务端 Samba 的锁定/oplock 配置模拟。配置不兼容 → `SQLITE_IOERR_IN_PAGE`（本次实测）。
- **rollback journal 模式不依赖共享内存**，只依赖普通文件锁（`LockFileEx`），多数 Samba 默认配置可用 —— 这解释了「用户自己的 NAS 可以」：其 Samba 恰好连 WAL 也兼容。
- 结论：rollback journal 降级后 NAS 可用面显著扩大，但**不是 100%**：网络文件锁语义始终取决于具体 SMB 实现（ADR-0014 后果段原话）。

## 4. 产品决策（草案，待确认）

1. **支持网络共享（NAS/SMB）上的资源库**，标记为**实验性、自担风险**；本机与直连移动盘行为完全不变。
2. **并发模型：数据库单写者 + 多读者**：
   - 数据库同一时刻**只能由一个 Serpent 实例修改**（复用现有写租赁机制，见 §5）；
   - **文件不需要锁**：文件操作只由持有数据库写租赁的实例执行，其他实例只读，文件级冲突在结构上被避免；
   - 多个实例（含多台机器）**可以同时打开同一资源库浏览**；
   - **多机同时写暂不支持**（写冲突与同步合并是 `Serpent-f863df` 的研究课题，本方案不解决）。
3. **数据安全靠备份兜底，数据库备份是第一道防线**（对「不安全的 SMB」的策略，见 §6）。
4. 配套规则：**文件事件处理（watcher 扫描 / 缩略图 / AI 分析）只允许当前持写租赁的实例做**——否则读者实例会把写者实例的写入当作外部变更重复处理（f863df 冲突点 1/2）。这条规则一次解决 f863df 列出的前三个冲突点（watcher 重复、AI 重复、元数据冲突）。

## 5. 与现有架构的契合（好消息：地基已存在）

| 模型要求 | 现有机制 | 位置 |
|---|---|---|
| 唯一写者（跨机器） | `library_write_leases` 表（`owner_id` + `acquired_at_ms` + `expires_at_ms`），原子获取 | `src/worker/library-service.ts:1798`（schema）、`src/worker/library-write-coordinator.ts` |
| 他人持锁时等待 | `acquire()` 轮询（默认 5s 超时 / 50ms 重试 / 15s 续期），超时抛「Another Serpent session is updating this library」 | `src/worker/library-write-coordinator.ts:336`、`:14`（默认值） |
| 崩溃机器占锁 | 租赁过期（`expires_at_ms`）→ 新实例接管 | 同表，`tryAcquire` 校验过期 |
| 读者检测「别人改过库」 | `library_change_sequence` 触发器计数器（assets/revisions/folders 变更自增） | `src/worker/library-service.ts:1806` |
| 文件操作也走租赁 | `selection.trash` 等大文件操作显式获取租赁；`runBoundedWrite` 覆盖元数据写 | `src/worker/index.ts:953`、`src/worker/library-service.ts:6973` |

写租赁是**持久化 DB 表**，天然跨机器生效——当前设计已含跨进程语义，只是从未在 NAS 场景被触发。

## 6. 备份策略（用户拍板重点）

- **一致性快照**：用 SQLite Online Backup API（`db.backup()`，ADR-0019 已有先例）而非文件复制——不阻塞在线写、不受写事务中间态影响。
- **触发时机**：打开时（上次关闭后未备份）、关闭时、周期性（约 30 分钟，若库脏）、**每次迁移前**。
- **备份后校验**：复用 `verifyDatabase`；校验失败立即重试并告警。
- **保留策略**：沿用现有双轮换备份（backup-1 / backup-2）+ Assets 抢救梯度（ADR-0028 / `Serpent-dw9a`）；NAS 场景可加时间戳快照 + 保留 N 份。
- 诚实边界：备份兜底的是**逻辑损坏/误操作**与**部分 SMB 物理故障**；NAS 断电丢写（服务端缓存未刷盘）造成的最后窗口损坏只能靠备份频率收敛，无法消除（ADR-0019 后果段：「NAS/同步目录永远无法仅凭 SQLite 配置获得与本地磁盘相同的保证」）。

## 7. 实施拆解（按依赖顺序）

1. **网络盘检测 + journal 降级**（先决条件，无此 NAS 连读都做不到）：
   - Windows `GetDriveTypeW`（UNC `\\…` 与映射盘）、macOS `statfs` `MNT_LOCAL` 判定本地卷；
   - `openConfiguredDatabase` 增加 journal 模式参数：网络盘 → `DELETE` + `synchronous=FULL`；
   - 建库/打开时若无兼容性则给出明确提示（替代现有 `LIBRARY_NETWORK_SHARE` 一刀切）。
2. **写受限状态的 UI**：库级「本实例是否有写权限」状态；写失败（租赁被占）时明确文案——谁在写、多久前活跃、提供重试；**现有 5s 等待对长任务（导入）太短**，等待策略与文案需设计。
3. **watcher 归属规则**：非持租赁实例不处理文件事件；持租赁实例接手时做一次补扫（积压变更）。
4. **NAS 备份强化**（§6）。
5. **文档/ADR 收口**：ADR-0006/0014/0019 补实施状态；ADR-0028 补「瞬态写受限」概念（区别于已被否决的「只读资源库模式」）；AGENTS.md/CLAUDE.md 约束表述修正为「应用与依赖不能放 NAS；资源库数据库在 NAS 上为实验性、自担风险、仅单写者」。

## 8. 边界与风险（如实记录）

- **Samba 依赖仍在**：rollback journal 成功率高但不保证；「NAS 多实例打开」是尽力而为。测试矩阵无法穷尽 SMB 实现，新报障可能不可复现 → 靠检测与降级把失败前置，报错保持可操作。
- **写等待体验**：默认 5s 对长任务（导入/转换）太短；需设计等待/重试/「稍后继续」。
- **性能**：NAS 延迟 10–100 倍于本地；资源库打开/切换无论本地还是 NAS 都以结构一致为主界面门槛，持续超过 3 秒才显示简洁身份提示和切换入口；普通浏览、缩略图和搜索仍走渐进加载，打开完成时间目标可按介质放宽。
- **断线语义**：ADR-0006 要求「断线停止写入 → 只读/离线 → 恢复校验」，是一套状态机，本期可后置（P2），先让「NAS 单机可用 + 明确警告」落地。
- **与 WebDAV 同步的关系**：互补。NAS 直开 = 团队共享主库；WebDAV = 个人多设备同步。两者不互相替代。

## 9. 开放问题（待讨论）

1. 备份频率与保留份数的具体值（周期 30 分钟？保留几份时间戳快照？）
2. 写等待策略：等待时长、是否提供「排队重试」还是「失败 + 手动重试」、UI 形态（toast / 面板 / 库徽标）。
3. 是否需要库级「网络存储」标记与打开时的实验性确认（每次确认 or 一次性记住）。
4. 多机「同时打开浏览」是否需要在打开时探测其他活跃实例并展示（仅信息性）？
5. watcher 在 SMB 上本身不可靠（SMB 变更通知缺漏）——读者实例的手动刷新/重扫入口是否需要强化？

## 10. 关联

- 工单：`Serpent-4f44f1`（NAS 打开 Eagle 转换失败）、`Serpent-f863df`（多机同时打开同一资源库，本草案为其冲突点 4 的决策输入）、`Serpent-dw9a`（损坏处理与自动恢复）
- ADR：0006（多资源库）、0014（短时写锁）、0019（单进程 + NAS rollback）、0028（兼容性与不提供只读库）
- 代码：`src/worker/library-service.ts`（createLibrary / openConfiguredDatabase / 写租赁）、`src/worker/library-write-coordinator.ts`、`src/shared/protocol/errors.ts`、`src/worker/index.ts`
