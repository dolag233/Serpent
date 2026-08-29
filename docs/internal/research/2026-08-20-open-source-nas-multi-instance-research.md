# 开源项目在 NAS/网络存储上的多实例运行研究

> 研究日期：2026-08-20
> 研究范围：Nextcloud、Paperless-ngx、Seafile、Immich 的官方文档、官方 GitHub 源码/配置/Issue，以及 SQLite、Redis、PostgreSQL 官方文档。重点区分“应用实例共享 NAS 上的文件”与“多个客户端直接打开 NAS 上的数据库文件”。
> 结论性质：**非 Serpent 产品验收结论**。本文是外部项目和基础设施语义的只读研究，不证明 Serpent 当前实现已经支持 NAS、多机并发或任何平台。

## 先说结论

开源项目的共同做法不是让多个应用进程直接共享 NAS 上的 SQLite 文件，而是把共享状态拆成三类：

1. 文件/对象放在共享文件系统或对象存储；
2. 元数据放在客户端/服务端数据库，生产多实例通常使用 PostgreSQL、MariaDB/MySQL，而不是 SQLite 文件共享；
3. 会话、任务、文件锁或分布式协调放在 Redis/Valkey、数据库事务或“单后台节点”中。

SQLite 官方明确说，多个不同主机同时对网络文件系统上的数据库读写不应作为可靠架构；WAL 更明确要求所有连接位于同一主机，不能用于网络文件系统：[SQLite Over a Network](https://www.sqlite.org/useovernet.html)、[SQLite WAL](https://www.sqlite.org/wal.html)。因此，“项目支持 NAS 文件”不能推导出“项目支持把 SQLite 数据库放在 NAS”。

本次四个项目中，Nextcloud、Seafile、Immich 有明确的一手多实例/共享存储资料；Paperless-ngx 有多进程/多机器任务处理和 NAS 消费目录资料，但没有一套完整的共享数据库 HA/集群承诺。Paperless-ngx 作为“有限多实例消费者”对照项保留，不把它当作完整 NAS 集群方案。

## 1. 项目对照表

| 项目 | NAS/网络存储放什么 | 多实例协调 | 变更/锁 | SQLite 与部署边界 |
| --- | --- | --- | --- | --- |
| Nextcloud | 用户文件可在本地数据目录的 NFS 挂载或外部存储；生产数据库用 MySQL/MariaDB/PostgreSQL；Redis 做共享缓存和事务性文件锁 | 数据库事务 + Redis 分布式缓存/文件锁；多 Web 服务器必须连接同一 Redis/集群 | 应用层事务性文件锁；NFS/本地文件系统可配置外部变更检查；锁有 TTL，异常上传会释放 | SQLite 仅测试/最小实例；未证明 SQLite 放 NAS；集群需要共同数据库、Redis、Web 层和正确的共享存储 |
| Paperless-ngx | `consume`、`data`、`media` 可配置/绑定挂载；官方明确讨论 NFS/SMB 消费目录；数据库默认 `data/db.sqlite3`，生产多用户/高吞吐推荐 PostgreSQL/MariaDB；Redis/Valkey 是 broker | Celery/任务处理器通过 Redis-compatible broker 分发任务；共享 broker 可用 key prefix 隔离多个实例；数据库保存应用状态 | inotify 或轮询；网络文件系统要轮询；稳定性延迟防止半写入；没有文档化的共享 consume 目录分布式锁保证 | SQLite 支持但并发会 `db locked`；未形成完整共享 DB/HA 集群方案；同一 consume 目录多消费者的去重/竞态边界需自行验证 |
| Seafile | 官方旧版给出 NFS 共享 `seafile-data` 文件对象、头像和缩略图；当前集群更推荐 S3/OpenStack Swift/Ceph；MariaDB/MySQL 与 Redis 在外部服务 | 负载均衡 + 共享数据库 + 同一 memory cache；后台任务明确只允许一个节点运行 | Pro 文件锁自动过期；Notification Server 用 WebSocket 推送库/锁状态，否则客户端轮询 | 集群是 Pro 方案；至少前端/后端节点；当前文档不使用 SQLite；NFS 是旧版可行路径，当前推荐对象存储 |
| Immich | 多个 server 实例必须挂载相同文件；外部图库可以是 NAS 挂载；PostgreSQL 共享实例；Redis 共享实例；PostgreSQL 数据目录要求本地 SSD、不要网络共享 | 共享 PostgreSQL + Redis/BullMQ 队列；任务没有 worker 时留在队列等待 | 外部库默认扫描/周期扫描；实验性 watcher 在网络盘上很可能失效；Redis 队列承担任务领取与 worker 协调 | 不使用 SQLite；多实例支持明确但不给出具体跨机器教程；需要 Docker、负载均衡/网络、相同挂载和共享基础设施 |

## 2. Nextcloud：共享文件 + 服务端数据库 + Redis 文件锁

### NAS 上放什么

Nextcloud 的配置文档把 `datadirectory` 定义为用户文件位置，并明确说本地数据目录中可以包含 NFS 挂载；`filesystem_check_changes` 专门描述“Nextcloud data/ 目录和 data/ 下的 NFS mounts”。这证明的是共享文件存储/挂载路径，不是 SQLite-on-NAS 的生产承诺：[Configuration Parameters](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/config_sample_php_parameters.html)。Nextcloud 也支持把外部存储作为单独 storage backend：[External Storage](https://docs.nextcloud.com/server/latest/admin_manual/configuration_files/external_storage_configuration_gui.html)。

生产元数据数据库应是 MySQL/MariaDB 或 PostgreSQL。官方系统要求把 SQLite 列为“仅测试和最小实例”，并把 MySQL/MariaDB、PostgreSQL 列为生产数据库选项：[System requirements](https://docs.nextcloud.com/server/26/admin_manual/installation/system_requirements.html)。Redis 不负责持久化用户文件，而是用于分布式缓存和事务性文件锁。

### 多实例如何协调

Nextcloud 的 clustered setup 要求多个 Web 服务器把 `memcache.distributed` 和 `memcache.locking` 指向同一个 Redis/Redis cluster，不能各自使用 `localhost` 或本机 Unix socket；同一页还建议 APCu 只做本地缓存、Redis 做分布式缓存和锁：[Memory caching](https://docs.nextcloud.com/server/stable/admin_manual/configuration_server/caching_configuration.html)。数据库则是权威元数据状态，多个 Web/PHP 进程通过数据库事务访问它。

事务性文件锁在文件系统之上运行，锁父目录以防止目录重命名，并处理共享文件、外部存储和中断上传；默认后端是数据库，重负载时可切换 Redis：[Transactional file locking](https://docs.nextcloud.com/server/stable/admin_manual/configuration_files/files_locking_transactional.html)。这是一种“应用层文件锁”，不是把 SMB/NFS 的底层锁能力当成唯一保障。

### 文件变更、断线和锁失败

对 Nextcloud 外部直接产生的变化，`filesystem_check_changes` 可设置每次请求检查一次；默认值为 0，外部变更不应假设会被实时发现：[Configuration Parameters](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/config_sample_php_parameters.html)。这更接近“请求时检查/扫描”，不是跨机器可靠的操作系统 watcher。

事务性文件锁文档明确写出：同步客户端上传中断时会释放锁；`filelocking.ttl` 会清理超过 TTL 的旧锁：[Configuration Parameters](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/config_sample_php_parameters.html)。但它不防止两个用户同时打开同一文档编辑，只防止同时保存，不能被误解为内容级合并。

如果 Redis 锁服务不可用或多实例没有指向同一 Redis，官方资料只给出配置和风险说明，没有把 NAS 断线自动恢复描述为数据库事务的一部分。部署时应把 Redis/数据库不可达视为实例不可写或运维故障，不能继续依赖本地缓存做跨节点协调。

### SQLite 是否允许、限制是什么

SQLite 可以安装运行，且 SQLite 文件位于 `data/`；但官方明确只建议测试/简单安装，生产应使用 MySQL/MariaDB/PostgreSQL。官方故障排查还把 `database is locked` 直接解释为 SQLite 无法承受大量并行请求，并建议转换到其他数据库：[General troubleshooting](https://docs.nextcloud.com/server/latest/admin_manual/issues/general_troubleshooting.html)。因此，Nextcloud 的“数据目录可在 NFS”不能被转写成“SQLite 数据库可安全放 NFS”。

## 3. Paperless-ngx：Redis/Celery 多进程消费者，但不是完整共享库集群

### NAS 上放什么

官方安装文档允许通过 Docker bind mount 修改 `consume`、`media` 等目录，并把 `PAPERLESS_CONSUMPTION_DIR`、`PAPERLESS_DATA_DIR`、`PAPERLESS_MEDIA_ROOT` 分别定义为消费目录、应用数据和文档/缩略图目录：[Setup](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/setup.md)、[Configuration](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/configuration.md)。

数据库默认是 `data/db.sqlite3`；官方配置对多用户或高吞吐部署推荐 PostgreSQL 或 MariaDB。Redis-compatible broker 是必需组件，`PAPERLESS_REDIS_PREFIX` 用于多个 Paperless 实例共享同一 broker 时隔离 key/channel：[Configuration](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/configuration.md)。这些资料支持“文件目录可挂载网络存储”和“数据库/Redis 作为独立服务”，但没有支持“SQLite 数据库文件直接放 NAS”的声明。

### 多实例如何协调写入

Paperless-ngx 的架构是 Web server、consumer、task processor、scheduler 分进程运行；官方 usage 文档说 task processor 依赖 Celery，任务可由不同来源进入队列，并且 broker 与这些进程可以位于不同机器：[Usage](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/usage.md)。因此可以把多个 web/consumer/worker 连接到同一 broker 和服务端数据库，形成任务处理层的横向扩展。

但这不等于同一 NAS 消费目录有分布式租约。文档没有承诺多个 consumer 对同一目录的唯一领取语义；官方 troubleshooting 甚至说明同一个文件可能因扫描器多次修改而被尝试消费两次，需要提高 stability delay：[Troubleshooting](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/troubleshooting.md)。v3 默认允许重复文档，只有开启 `PAPERLESS_CONSUMER_DELETE_DUPLICATES` 才按 hash 删除重复文件：[Configuration](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/configuration.md)。这意味着去重是业务选项，不是文件系统锁的替代品。

### 文件变更、断线和锁失败

消费目录默认使用原生文件系统通知；官方明确指出 NFS/SMB/CIFS 可能不可靠，应设置正的 `PAPERLESS_CONSUMER_POLLING_INTERVAL` 改为轮询。还提供 `PAPERLESS_CONSUMER_STABILITY_DELAY`，要求文件的大小和修改时间稳定一段时间后再消费，防止网络扫描器仍在写入时被拿走：[Configuration](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/configuration.md)。

SQLite 并发失败的官方处理路径很直接：多个 worker 同时处理文件时可能出现 `db locked`；频繁并发处理应改用 PostgreSQL，否则只能增加 SQLite timeout 或尝试 WAL：[Troubleshooting](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/troubleshooting.md)。这只是本机/同一服务数据库的并发缓解，不会使 WAL 变成跨主机 NAS 方案；SQLite 官方仍规定 WAL 进程需在同一主机：[SQLite WAL](https://www.sqlite.org/wal.html)。

官方没有为 NAS 断线后的“已领取任务、文件已移动但数据库未提交、连接恢复后的自动对账”提供完整协议。因而 Paperless-ngx 可作为“共享收件目录 + 队列 worker”的参考，不应作为 Serpent 同库多机写入的完整范本。

### SQLite 是否允许、部署限制

SQLite 是默认且受支持的后端，适合小规模；多用户、高吞吐、多个 worker 应使用 PostgreSQL/MariaDB。官方 bare-metal 安装限定 Linux，Docker 是常用部署方式；broker、worker 和数据库连接必须稳定可达。NAS 上放 `consume` 目录时要轮询；NAS 上放 SQLite `data` 并没有官方安全承诺，尤其不能因为 Paperless 支持 SQLite 就推导出跨主机共享数据库安全。

## 4. Seafile：官方集群 + 共享对象/文件存储 + 单后台节点

### NAS 上放什么

Seafile 旧版官方集群文档给出 NFS 方案：只共享 `seafile-data` 中的 file objects，以及 `seahub-data` 中的用户头像和缩略图；每个节点的配置和日志保持独立：[Setup Seafile cluster with NFS](https://manual.seafile.com/11.0/deploy_pro/setup_seafile_cluster_with_nfs/)。这是一条很清晰的“共享派生/对象文件，节点本地保存配置”的边界。

但当前官方集群文档把后端存储定义为 S3、OpenStack Swift 或 Ceph 等分布式存储，并说集群通常应使用对象存储；系统要求还假设 Redis、MariaDB、索引器在独立机器上：[Seafile Docker Cluster Deployment](https://manual.seafile.com/13.0/setup/cluster_deploy_with_docker/)、[System requirements](https://manual.seafile.com/latest/setup/system_requirements/)。所以 NFS 是官方历史可行路径，不应被写成当前所有集群部署的首选。

### 多实例如何协调写入

当前 Pro 集群架构是负载均衡器、多个前端 Seafile server、后端存储三层。前端实例独立运行，但所有实例必须连接同一个 memory cache；官方推荐 Redis。数据库配置使用 MariaDB/MySQL，作为共享的权威元数据服务：[Cluster installation (Pro)](https://manual.seafile.com/13.0/setup/cluster_deploy_with_docker/)、[Environment variables](https://manual.seafile.com/latest/config/env/)。

后台任务是特别重要的“单写者/单协调者”模式：官方明确规定整个集群当前只能运行一个 background task server，多个后台节点可能冲突；需要 HA 时建议用 Keepalived 做热备：[Cluster installation (Pro)](https://manual.seafile.com/13.0/setup/cluster_deploy_with_docker/)。这说明并非所有工作都靠 Redis 自动分布式协调，某些副作用任务直接采用单节点所有权。

### 文件锁、变更通知和故障处理

Seafile Pro 有应用层 file lock，锁会自动过期以避免长期占用，并可缓存锁查询：[seafile.conf — File Locking](https://manual.seafile.com/14.0/config/seafile-conf/)。这属于服务端的文件锁状态，不是依赖 NFS 的 `flock` 成功。

Notification Server 通过 WebSocket 把库更新、文件锁状态和目录权限变化推送给客户端；没有它时客户端和 Web 界面依靠轮询，锁状态不是实时的：[Notification Server](https://manual.seafile.com/13.0/extension/notification-server/)。前端实例失败时负载均衡器停止向其转发；后台节点仍是单节点，官方只给出 Keepalived 热备方向。NFS 断线、锁服务不可达时的完整自动恢复/事务补偿没有在这些官方部署文档中定义，应视为待验证运维故障，而不是已有保证。

### SQLite 是否允许、部署限制

官方集群部署使用 MariaDB/MySQL、Redis/内存缓存和对象存储/NFS 文件对象，没有 SQLite 集群路径；集群是 Seafile Pro 能力。官方系统要求建议至少两个节点（前端和后端），单节点应部署成单节点而非 cluster：[System requirements](https://manual.seafile.com/latest/setup/system_requirements/)。这与 Serpent 当前嵌入式 SQLite + 本地 Worker 的形态差异很大，但“共享文件对象、共享服务端数据库、单后台副作用节点”很有迁移价值。

## 5. Immich：明确的多实例服务，但 PostgreSQL 数据目录禁止网络共享

### NAS 上放什么

Immich 的 scaling 文档直接要求每个 server 实例连接相同的 PostgreSQL、Redis，并挂载相同文件；跨机器部署可能需要网络隧道或 NFS mount，但官方不提供统一教程：[Scaling Immich](https://docs.immich.app/guides/scaling-immich/)。

外部图库可以挂载 NAS 路径，官方示例包含 `/mnt/nas/...`，可选择只读挂载；外部文件被扫描后在 Immich 数据库中建立资产记录：[External Libraries](https://docs.immich.app/features/libraries/)。这属于“NAS 上放媒体文件，数据库仍是服务端 PostgreSQL”。

Immich 的 PostgreSQL `DB_DATA_LOCATION` 则相反：官方要求数据库文件系统支持权限，并明确建议本地 SSD、永远不要网络共享：[Requirements](https://docs.immich.app/install/requirements/)。这是本次研究中最直接的反例：同一个项目同时支持 NAS 媒体文件和多实例，却明确拒绝把 PostgreSQL 数据目录放网络共享；更不能把这个项目解读成 SQLite-on-NAS 支持。

### 多实例如何协调写入

共享 PostgreSQL 保存元数据，Redis 提供 BullMQ 队列。官方源码的 `JobRepository` 为每个队列创建 BullMQ `Worker`，读取共同的 Bull 配置；多个实例因此可以竞争队列任务，而不是各自在 NAS 上扫描后直接写一份本地数据库：[Immich job.repository.ts](https://github.com/immich-app/immich/blob/main/server/src/repositories/job.repository.ts)。官方 scaling 文档还明确说，停止一个 server 后，只要仍有 API worker，任务会留在队列中等待其他 worker：[Scaling Immich](https://docs.immich.app/guides/scaling-immich/)。

### 文件变更、断线和锁失败

外部图库不是通过任意 NAS watcher 作为唯一事实源。官方说明：文件在 Immich 外部修改后需要扫描；自动 watching 是实验性功能，网络盘上很可能不起作用，应使用周期性 library refresh：[External Libraries](https://docs.immich.app/features/libraries/)、[System Settings](https://docs.immich.app/administration/system-settings/)。这与 Paperless 的“网络目录改轮询”结论相同，但 Immich 的重扫结果还会影响数据库资产/回收站状态，必须将扫描任务纳入队列和幂等设计。

如果 worker 停止，官方语义是后台 jobs 等待可用 worker；如果 watcher 卡住，官方给出禁用 watcher、重新启动 microservices 的运维路径：[External Libraries](https://docs.immich.app/features/libraries/)。官方没有给出 NAS 写入中断时单个文件与 PostgreSQL 事务的两阶段提交，因此外部库最好使用只读挂载，或把文件删除/sidecar 写入限制在单一 worker 所有者。

### SQLite 是否允许、部署限制

Immich 的官方部署要求 PostgreSQL 和 Redis，不使用 SQLite。多实例支持是服务端 Docker/容器编排能力：所有实例必须共享数据库、Redis 和文件挂载；需要负载均衡和同一路径映射。单机多容器通常没有收益，因为一个容器本身已有多个 worker：[Scaling Immich](https://docs.immich.app/guides/scaling-immich/)。

## 6. 可迁移到 Serpent 的架构模式

### 模式 A：单写者 Worker + 多读者，数据库不跨主机共享

**形态：** 每台客户端/实例只读自己的本地 SQLite；只有一个明确的写者 Worker 处理资源库元数据、文件移动、缩略图和 AI 副作用。NAS 只作为链接素材、备份或受控交换目录。

**适合程度：当前最适合 Electron + Worker + SQLite。** 不需要把 SQLite 变成网络数据库，也不需要引入 Redis。可以把 Serpent 现有“一个活动资源库只在一台电脑使用”的 MVP 边界继续保持，并强化断线、重扫、导出快照和同步协议。多机要看到同一数据，使用已有/未来的文件级或清单级同步，而不是共享活动 `.db`。

**代价：** 不能提供同一资源库的即时多机元数据写入；需要冲突合并、变更序列或明确的“关闭后换设备”语义。

### 模式 B：权威服务端 Worker + PostgreSQL + Redis/队列 + 共享媒体存储

**形态：** 类似 Immich/Nextcloud/Seafile：NAS/S3 放媒体或对象文件；PostgreSQL 在 NAS 主机或同一局域网内以服务端进程运行，但不是把数据库文件通过 SMB/NFS 暴露给客户端；Redis/Valkey 负责队列、锁、会话或缓存；客户端通过 IPC/HTTP 调用唯一权威服务。

**对当前形态的判断：必须迁移架构。** Electron Renderer/Preload/Main/Library Worker 目前是本机进程边界，SQLite 是 Worker 所有者。要支持多机并发写，必须增加常驻服务端/网络协议，迁移到 PostgreSQL 或其他 client/server 数据库，并重新定义认证、租约、幂等、任务恢复、权限和版本迁移；Redis 不是单独替代数据库的方案。

**适合的子集：** 即使暂不做多机，Serpent 也可以先把导入、缩略图、AI 分析抽象为持久 Job，并让同一个 Worker 独占副作用；未来迁移服务端时复用任务模型。

### 模式 C：共享文件存储 + 周期扫描/重放，不依赖 NAS watcher

**形态：** 文件写入通过临时文件、稳定性检查、原子 rename 或上传完成标记完成；消费者使用 inotify 作为优化，网络盘则使用轮询/周期扫描；扫描结果以内容哈希、稳定资产 ID、变更序列和幂等 Job 写入数据库。断线后停止写入，恢复后重新探测并补扫。

**适合程度：适合当前 Worker，但只适合单一数据库所有者。** Serpent 可以把 watcher 降级为提示和加速，不能把 watcher 当事实源。当前 Electron + SQLite 下，补扫和任务队列应仍由本机唯一 Worker 执行；多个客户端各自补扫会重复缩略图/AI 和产生元数据竞态。

**何时需要协调服务：** 如果多个机器都能消费同一任务集，就需要 Redis/BullMQ 类队列、数据库租约或一个服务端单写者；“每个客户端都启动一个 watcher”不能构成协调方案。

### 模式 D：应用层租约/TTL + 单节点后台任务

**形态：** 参考 Nextcloud 的 Redis 锁和 Seafile 的单 background server：写操作/文件操作/派生任务先获取租约；租约有 owner、TTL、续租、fencing 或版本号；失联后新实例重新验证再接管；读者不执行副作用。

**适合程度：可作为 Serpent 未来单写者增强，但不能修复 SQLite-on-NAS 的根限制。** 如果数据库仍是 SQLite，租约必须保护的是“哪一个本机 Worker 可以打开并写入数据库”，而不是让两个主机各自打开同一 SQLite 文件后再用应用层锁。跨主机租约本身需要 PostgreSQL/Redis/服务端；在 NAS 上写租约表又回到了 SQLite 网络锁问题。

## 7. 对 Serpent 的建议

1. **短期推荐：本地活动数据库 + NAS 媒体/链接目录/备份/同步交换。** 继续保持 SQLite 只由本机 Library Worker 打开；NAS 文件变化用手动刷新或周期补扫；断线进入 offline/read-only，恢复后重新校验。
2. **不推荐：多个 Electron 实例直接打开同一个 NAS `.db`。** 即使把 WAL 改成 rollback journal，也只能移除 WAL 的共享内存限制，不能证明 SMB/NFS 的锁、flush、断线恢复和原子 rename 满足 SQLite 全部假设。[SQLite Over a Network](https://www.sqlite.org/useovernet.html)、[SQLite WAL](https://www.sqlite.org/wal.html)
3. **长期若要多机同时写：选择权威服务端方案。** 让服务端 Worker 运行数据库和文件协调；数据库用 PostgreSQL/MariaDB 等 client/server 引擎，NAS 只承载媒体/对象；Redis/Valkey 可用于队列和租约，但必须有数据库事务、幂等和恢复协议配合。[PostgreSQL client/server architecture](https://www.postgresql.org/docs/current/tutorial-arch.html)、[Redis distributed locks](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
4. **不要把“锁失败”静默重试成写成功。** 断线、租约过期、`SQLITE_BUSY/LOCKED`、文件 rename/flush 失败时，停止后续非幂等操作；重新连接后做存储画像、数据库完整性、变更序列和未完成 Job 对账。

## 8. 实际查过的官方 URL 清单

### 项目官方文档/源码

- Nextcloud：[System requirements](https://docs.nextcloud.com/server/26/admin_manual/installation/system_requirements.html)、[Memory caching](https://docs.nextcloud.com/server/stable/admin_manual/configuration_server/caching_configuration.html)、[Transactional file locking](https://docs.nextcloud.com/server/stable/admin_manual/configuration_files/files_locking_transactional.html)、[Configuration Parameters](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/config_sample_php_parameters.html)、[External Storage](https://docs.nextcloud.com/server/latest/admin_manual/configuration_files/external_storage_configuration_gui.html)、[General troubleshooting](https://docs.nextcloud.com/server/latest/admin_manual/issues/general_troubleshooting.html)
- Paperless-ngx：[Setup](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/setup.md)、[Configuration](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/configuration.md)、[Usage](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/usage.md)、[Troubleshooting](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/troubleshooting.md)
- Seafile：[Cluster installation (Pro)](https://manual.seafile.com/13.0/setup/cluster_deploy_with_docker/)、[System requirements](https://manual.seafile.com/latest/setup/system_requirements/)、[Setup cluster with NFS](https://manual.seafile.com/11.0/deploy_pro/setup_seafile_cluster_with_nfs/)、[Environment variables](https://manual.seafile.com/latest/config/env/)、[seafile.conf file locking](https://manual.seafile.com/14.0/config/seafile-conf/)、[Notification Server](https://manual.seafile.com/13.0/extension/notification-server/)
- Immich：[Scaling Immich](https://docs.immich.app/guides/scaling-immich/)、[Requirements](https://docs.immich.app/install/requirements/)、[External Libraries](https://docs.immich.app/features/libraries/)、[System Settings](https://docs.immich.app/administration/system-settings/)、[Jobs and Workers](https://docs.immich.app/administration/jobs-workers/)、[official job repository source](https://github.com/immich-app/immich/blob/main/server/src/repositories/job.repository.ts)

### 基础设施官方文档

- SQLite：[SQLite Over a Network](https://www.sqlite.org/useovernet.html)、[Write-Ahead Logging](https://www.sqlite.org/wal.html)、[Appropriate Uses For SQLite](https://www.sqlite.org/whentouse.html)、[Online Backup API](https://www.sqlite.org/backup.html)
- Redis：[Distributed Locks with Redis](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
- PostgreSQL：[Client/Server Architecture](https://www.postgresql.org/docs/current/tutorial-arch.html)

## 摘要、推荐方案、风险、待验证清单

### 摘要

真正可扩展的 NAS 多实例方案把 NAS 当文件/对象存储，把数据库作为服务端事务系统，把 Redis/队列或单后台节点作为协调面。Nextcloud、Seafile、Immich 的一手资料都体现这一点；Paperless-ngx 说明网络目录监听需要轮询、SQLite 并发会锁，但没有承诺同一共享消费目录的完整多实例一致性。

### 推荐方案

当前 Serpent 采用“本地 SQLite + 单 Worker 写入 + NAS 作为媒体源/备份/同步交换”的路径。未来若产品必须允许多机同时写同一资源库，应建设“权威服务端 Worker + PostgreSQL + Redis/队列 + 共享媒体存储”，而不是把 SQLite 文件继续放在 SMB/NFS 上。

### 风险

- 网络文件系统的锁、缓存、flush、rename、断线恢复因 SMB/NFS 实现和配置不同，项目文档中的“支持网络文件”不构成任意 NAS 保证。
- watcher 可能漏事件或不支持网络盘；轮询会增加延迟和扫描成本。
- 单写者接管、任务重试、文件副作用与数据库事务若没有 fencing/幂等，可能出现重复缩略图、重复 AI、孤儿文件或元数据与文件不一致。
- Redis 锁若没有 TTL、续租、唯一 owner/token 和故障语义，不能单独宣称安全；Redis 也不能替代数据库事务。
- 把 PostgreSQL 数据目录放 NAS 同样有数据库存储风险；Immich 的官方要求明确建议 PostgreSQL 数据目录使用本地 SSD、不要网络共享。

### 待验证清单

- 用两台独立主机、同一真实 SMB/NFS 共享验证：单写者租约、读者降级、租约过期接管、进程崩溃、断线中断写入、恢复后完整性检查。
- 分别验证 SQLite rollback journal、PostgreSQL 服务端数据库、Redis/Valkey 服务在 NAS 断线/恢复时的可观察错误与恢复边界；不得用一次成功打开替代压力测试。
- 验证 NAS 上文件临时写入、flush、rename、删除、权限、配额、大小写/Unicode 路径和锁竞争；记录设备、协议、服务端配置和结果。
- 验证 watcher 漏事件、事件重复、目录重命名、网络盘重新挂载后的补扫；确认补扫不会重复 AI/缩略图或覆盖人工元数据。
- 为 Serpent 决定“同库多机”产品语义：只读多读者 + 一个写者，还是多写者合并；在语义确定前不把 lease 表或局部单测写成多机支持证据。
- 若选择服务端方案，先做 PostgreSQL schema/迁移、Job 幂等、租约 fencing、断线重连、权限和备份恢复原型，再评估 Electron 客户端协议和部署形态。
