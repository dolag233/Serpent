# 竞品同步方案与 WebDAV 调研

> 调研日期：2026-08-15  
> 范围：Obsidian、Joplin、Logseq 的同步架构，以及 WebDAV 作为同步传输层的适用性。  
> 资料优先采用产品官方文档、官方仓库和 IETF 标准；第三方 Obsidian 插件只用于说明 WebDAV 在其生态中的实际用法，不代表 Obsidian 内置能力。

## 结论先行

- WebDAV 很适合做“通用文件传输适配器”，不等于它本身就是完整的同步方案。
- 它受欢迎的主要原因是：基于 HTTP、跨平台、容易通过 HTTPS 和现有账号体系部署、支持文件夹和文件的读写与列举，而且 Nextcloud、ownCloud、群晖、Apache、Nginx 等都有成熟服务端实现。
- Joplin 的做法最适合借鉴：同步核心只依赖 `read`、`write`、`delete`、`list` 等抽象能力，WebDAV 只是其中一个 driver。这样可以同时支持 WebDAV、S3、本地目录和未来的 Serpent Cloud，而不会把同步业务逻辑写死在某个协议里。
- Obsidian 的官方 Sync 说明了另一条路线：应用自己维护远端仓库、增量文件同步、冲突处理、离线队列和版本历史。WebDAV 只提供存储和文件操作时，上述能力仍然必须由 Serpent 自己实现。
- Logseq 的新 DB Graph Sync 进一步说明：当数据模型从“文件夹里的文件”变为数据库和实时协作时，WebDAV 的文件语义就不够了，需要专用服务端协议（Logseq 使用 WebSocket/HTTP）。
- 对 Serpent 而言，建议先把 WebDAV 定位为“资源库同步的远端文件层”，同步索引、冲突策略、任务队列和大文件策略由客户端负责；不要把远端目录镜像误当成同步完成。

## 竞品实现

### Obsidian

Obsidian 官方将数据分为本地 vault 和 remote vault：本地 vault 是设备上的文件夹，remote vault 是集中式远端存储。官方 Sync 会连接多个本地 vault 到同一个 remote vault。

- 官方 Sync 按文件追踪变化，只传输被修改的文件，而不是每次同步整个文件夹。
- 设备离线时仍可继续编辑；重新联网并打开 Obsidian 后，变更会排队并自动同步。
- 官方 Sync 还负责冲突处理和选择性同步，因此“把文件放进某个云盘目录”与“应用内同步”是两个不同层级的方案。
- 官方文档列出的官方产品是 Obsidian Sync，并未把 WebDAV 作为内置同步目标。Obsidian 生态里常见的 WebDAV 支持来自第三方插件，例如 Remotely Save；该插件同时支持 WebDAV、S3、Dropbox、OneDrive 等，并在 WebDAV 服务端下按 vault 名称建立子目录。

来源：

- [Obsidian：Local and remote vaults](https://obsidian.md/help/sync/vault-types)
- [Obsidian：Introduction to Obsidian Sync](https://obsidian.md/help/sync)
- [Remotely Save：WebDAV 与多种云存储支持](https://github.com/remotely-save/remotely-save#webdav)

### Joplin

Joplin 是最直接的“同步核心 + 多种存储 driver”案例。

- Joplin 将同步过程抽象为独立层，外部服务只需要提供类似文件系统的 `read`、`write`、`delete`、`list` 能力。
- 官方支持 Joplin Cloud、Nextcloud、S3、WebDAV、Dropbox、OneDrive 和本地文件系统。
- 同步可以在后台运行，也可以由用户手动触发。
- Joplin 还把每个可同步对象的本地同步时间和同步目标写入同步状态，并用 `info.json` 保存目标级属性；这提醒我们：远端存储格式可以服务于同步可靠性，不必强行保持和用户本地目录完全一致。
- Joplin 还单独实现了同步状态、删除传播、冲突处理和可选端到端加密；这些不是 WebDAV 自动提供的。

来源：

- [Joplin：Synchronisation](https://joplinapp.org/help/apps/sync/)
- [Joplin：Synchronisation 开发规格](https://joplinapp.org/help/dev/spec/sync/)
- [Joplin：WebDAV synchronisation](https://joplinapp.org/help/apps/sync/webdav/)
- [Joplin：End-To-End Encryption](https://joplinapp.org/help/apps/sync/e2ee/)

### Logseq

Logseq 目前需要区分旧的文件图谱和新的 DB Graph：

- 官方 DB Graph 文档把 Logseq Sync 称为 RTC（Real Time Collaboration），目标是跨设备同步数据库图谱并支持实时协作。
- 官方同步需要设置加密密码，并可以配置自托管 Sync Server URL。
- 官方代码中的默认端点是 WebSocket `wss://api.logseq.com/sync/<graph-id>`，同时提供 HTTP API 基址；本地开发/自托管适配器也围绕 WebSocket/HTTP 服务实现。
- 因此 Logseq 的新数据库同步不是 WebDAV 目录镜像。它使用专用服务来处理图谱、用户、加密和协作状态。

来源：

- [Logseq DB Graph 文档：Sync / RTC](https://github.com/logseq/docs/blob/master/db-version.md#sync)
- [Logseq 官方仓库：DB sync 开发说明](https://github.com/logseq/logseq/blob/master/docs/develop-logseq.md#db-sync)
- [Logseq 官方配置：默认 WebSocket/HTTP 同步端点](https://github.com/logseq/logseq/blob/master/src/main/frontend/config.cljs)

## WebDAV 到底提供什么

WebDAV（RFC 4918）是 HTTP/1.1 的扩展，不是一个完整的多端同步算法。标准定义了：

- 资源属性（properties），例如内容长度、类型、修改时间、ETag 等。
- 集合（collections），对应常见的目录/文件夹模型。
- URL 命名空间操作，例如复制和移动资源。
- 锁（locking），用于降低多个客户端同时修改同一资源造成的覆盖风险。
- `PROPFIND` 用于列举资源和读取属性，`MKCOL` 用于创建集合，`LOCK`/`UNLOCK` 用于锁，`COPY`/`MOVE` 用于命名空间操作；普通 `GET`、`PUT`、`DELETE` 仍用于读取、写入和删除文件。
- `207 Multi-Status` 允许一次响应返回多个资源的结果，`Depth` 允许客户端请求当前资源、直接子项或递归层级。

来源：[IETF RFC 4918：HTTP Extensions for Web Distributed Authoring and Versioning](https://www.rfc-editor.org/rfc/rfc4918.html)

RFC 4918 没有规定以下内容：

- 多个客户端如何发现“上次同步后发生了哪些变化”的增量日志。
- 冲突时应该保留哪一份、自动合并还是生成副本。
- 端到端加密、版本历史、回收站和审计记录。
- 大文件分块、断点续传、去重、上传优先级和带宽调度。
- 服务端向客户端主动推送变更的统一事件协议。

另外，锁不是可靠的并发合并机制：RFC 4918 明确指出，WebDAV 服务器不一定支持锁，而且即使使用锁，也不能保证不会发生覆盖更新。Serpent 仍需用版本号、哈希和条件写入自行检测冲突。

所以，WebDAV 解决的是“如何通过标准 HTTP 管理远端文件资源”，而不是“如何让两个资源库安全合并到同一个状态”。

## 为什么很多软件选择 WebDAV

### 1. 服务器生态成熟，用户可以自托管

用户可以在 NAS、家庭服务器、公司服务器或云主机上部署 WebDAV，而不必把数据交给某一个软件厂商。Joplin 官方列出了 Apache、Nginx、Nextcloud、ownCloud、Synology 等兼容服务；Remotely Save 也列出了多个 WebDAV 服务商和自建方案。

来源：

- [Joplin：已知可用的 WebDAV 服务](https://joplinapp.org/help/apps/sync/webdav/)
- [Remotely Save：WebDAV 服务示例](https://github.com/remotely-save/remotely-save#webdav)

### 2. 复用 HTTP 的基础设施

WebDAV 基于 HTTP，因此可以复用 HTTPS、现有反向代理、域名、证书、认证和防火墙策略。应用不必为每一家云盘分别集成一套 SDK。

这并不代表所有服务端实现完全一致：不同服务可能对锁、递归 `PROPFIND`、路径编码、配额和认证方式有差异。因此客户端必须做能力探测和错误兼容，而不是只测试单一的 Nextcloud 实例。Nextcloud 的官方文档也把 WebDAV 描述为通用访问方式，并建议优先使用其专用同步客户端；在 Windows 上，原生 WebDAV 还有连接稳定性和单文件大小限制等平台差异。

### 3. 文件夹语义直观，适合“库文件”模型

资源库本身常常包含文件夹、缩略图、元数据文件和忽略规则。WebDAV 可以直接表达这些对象，人工也能在浏览器或 NAS 文件管理器中看到远端目录，排查问题比完全私有的 API 更容易。

### 4. 跨平台客户端实现成本相对可控

Windows、macOS、Linux、移动端都能使用 HTTP 客户端；Serpent 只需实现一个 WebDAV driver，就可以覆盖多种服务端。Joplin 的同步抽象说明了这种架构可以把服务端差异隔离在轻量 driver 中。

## 对 Serpent 的适配启示

### 建议的分层

```text
同步编排层
  ├─ 本地资源库扫描与变更队列
  ├─ manifest / 版本 / ETag / 内容哈希
  ├─ 冲突检测与用户决策
  ├─ 重试、暂停、取消、限速和断点策略
  └─ 进度、日志、恢复和回收站

远端存储适配层
  ├─ WebDAV（PROPFIND / PUT / DELETE / MKCOL / MOVE ...）
  ├─ S3-compatible
  ├─ 本地目录或局域网共享
  └─ 未来的 Serpent Cloud API
```

### 资源库格式不要只依赖文件时间

- 每个资源和元数据条目应有稳定 ID、内容哈希、大小、修改版本和同步状态。
- 对 WebDAV 远端同时记录 ETag、`getlastmodified` 和内容哈希；时间戳只能作为辅助信号，不能独立决定覆盖。
- 远端列表结果是无序的，多层 `PROPFIND` 可能很慢；应支持分页/分层扫描、缓存和增量 manifest，避免每次打开库都递归列举整个目录。

### 大文件和派生文件应分层

- 原始视频、EXR、PSD、模型等大文件是主要带宽和失败成本，不应和缩略图、联系表、AI 元数据采用同一优先级。
- 可以先同步库结构、元数据和缩略图，再按需同步原始文件；但必须明确“仅同步预览”与“完整离线副本”的状态，避免用户误以为原文件已经备份。
- WebDAV 本身不提供统一的分块/断点协议，Serpent 需要针对服务端能力选择临时文件上传、范围请求或可恢复任务；无法可靠续传时，应保留本地任务状态并支持重试，而不是从 UI 上显示成功。

### 冲突和删除必须是显式策略

- 不能把远端空目录直接解释为“用户删除了全部资源”；首次连接、路径错误、权限不足和真正的删除需要区分。
- 同一资源在两台设备都发生修改时，应检测版本/哈希冲突，默认生成冲突副本或要求用户选择，而不是静默覆盖。
- 删除操作需要软删除或回收站保护，并在同步日志中显示来源设备和时间；WebDAV 的 `DELETE` 只代表远端删除动作成功，不提供业务层撤回能力。

### 安全和隐私

- 默认只允许 HTTPS WebDAV；HTTP 明文应明确警告。
- 密码、应用专用密码或 token 应进入系统凭据存储，避免写进资源库 JSON 或日志。
- 如果资源库含未加密的原始资产，WebDAV 服务端管理员可以读取它们；若产品承诺端到端加密，需要在上传前对内容和必要的元数据进行加密，并设计密钥恢复流程。
- 服务器的配额、权限、锁和路径编码必须在连接测试阶段探测并给出可读错误。

## 推荐的 MVP 范围

如果 Serpent 近期要支持 WebDAV，建议先做窄而可靠的版本：

- 仅支持单个资源库绑定一个 WebDAV 根目录。
- 使用稳定的远端目录布局，例如 `assets/`、`metadata/`、`previews/`、`manifest.json`，不要直接把本地 SQLite 文件当成可并发同步文件。
- 先同步 manifest 和元数据，再排队上传/下载原始资产与派生缩略图。
- 首版明确采用单设备写入或“冲突生成副本”，不承诺自动合并二进制资源。
- 提供连接测试、首次同步预览、同步状态、失败重试和暂停/取消。
- 把 WebDAV 实现放在 `RemoteStorageDriver` 接口后面，未来可无痛增加 S3 或 Serpent Cloud。

## 参考资料清单

- [Obsidian：Local and remote vaults](https://obsidian.md/help/sync/vault-types)
- [Obsidian：Introduction to Obsidian Sync](https://obsidian.md/help/sync)
- [Joplin：Synchronisation](https://joplinapp.org/help/apps/sync/)
- [Joplin：Synchronisation 开发规格](https://joplinapp.org/help/dev/spec/sync/)
- [Joplin：WebDAV synchronisation](https://joplinapp.org/help/apps/sync/webdav/)
- [Nextcloud：Accessing files using WebDAV](https://docs.nextcloud.com/server/latest/user_manual/en/files/access_webdav.html)
- [Logseq DB Graph：Sync / RTC](https://github.com/logseq/docs/blob/master/db-version.md#sync)
- [Logseq：DB sync 开发说明](https://github.com/logseq/logseq/blob/master/docs/develop-logseq.md#db-sync)
- [RFC 4918：WebDAV](https://www.rfc-editor.org/rfc/rfc4918.html)
- [Remotely Save：WebDAV 多云同步插件](https://github.com/remotely-save/remotely-save)
