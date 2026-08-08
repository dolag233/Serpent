# 创意资产的版本、同步、锁与审批

> 调研日期：2026-07-11
> 目的：判断 Serpent MVP 是否需要版本管理，并给出可以逐步演进的模型。
> 来源约束：只采用产品官方文档、官方源码或公开规范。下文把“官方事实”和“对 Serpent 的建议”分开，避免把竞品行为误写成既定需求。

## 结论

Serpent MVP **不需要完整、用户可见的专业版本管理**。可以推迟版本列表、版本比较、回滚、分支、审批流、变更集和编辑锁 UI；这些都不是当前“本地资产管理、快速搜索和预览”价值主张成立的前提。

但如果 MVP 包含“集中存储并自动同步”，就不能把版本问题完全推迟。最低限度必须有一层**不可丢数据的修订基础设施**：稳定的资产 ID、不可变内容对象、当前修订指针、上传时的基准修订校验，以及发生并发修改时保留两个内容版本。否则“自动同步”会变成静默覆盖器。

建议把两件事明确拆开：

- **修订基础设施**是数据安全能力，应从数据模型第一天存在，但初期可以不暴露复杂 UI。
- **版本管理产品功能**是工作流能力，应在真实团队需求出现后逐步增加。

审批也应与文件版本分开建模：审批结论绑定某个具体修订，而不是笼统绑定资产。Dropbox Replay 会为同一文件保存多个版本，并把每个版本的评论和标注放在一起；这说明“新版本上传”与“审阅上下文”需要关联，但不应混成同一状态。[Dropbox Replay 概览](https://help.dropbox.com/installs/dropbox-replay)、[Replay 文件与项目管理](https://help.dropbox.com/create-upload/dropbox-replay-projects)

## 竞品与相邻系统怎么做

### Dropbox 与 Dropbox Replay：同步冲突和审阅版本是两套机制

普通 Dropbox 自动同步允许多人或离线设备修改同一个文件。发生并发修改时，它会新建带用户名、`conflicted copy` 和日期的冲突副本；官方建议比较两个版本后手工合并，而不是静默选择一方。[Dropbox 冲突副本](https://help.dropbox.com/organize/conflicted-copy)

Dropbox 还提供可选的文件锁。锁定后其他人仍可查看、评论和分享，但不能编辑；锁拥有者或团队管理员可以解锁，管理员强制解锁时可以通知原拥有者。[Dropbox 文件锁](https://help.dropbox.com/organize/file-locking)

Dropbox 的普通版本历史覆盖编辑、重命名、上传、删除和移动等活动，可查看、比较并恢复旧版本；保留期限是产品策略，可按套餐不同而变化。[Dropbox 版本历史](https://help.dropbox.com/delete-restore/version-history-overview)

Dropbox Replay 则把版本当作显式审阅对象：用户手动为一个文件添加新版本，通过版本下拉框查看旧版本，旧版本的已解决和未解决评论仍可访问；项目下载也区分最新版本、已批准文件和所有版本。[Replay 文件与项目管理](https://help.dropbox.com/create-upload/dropbox-replay-projects) Replay 还支持两个视频版本并排比较，并能同时查看当前与旧版本评论。[Replay 视频版本比较](https://help.dropbox.com/view-edit/dropbox-replay-compare-video-versions)

**启示：** 自动同步层首先保证“不丢”；面向创意评审的版本则由用户显式提交。两者不必在 MVP 同时产品化。

### Frame.io：线性版本栈、保存即版本，但不提供通用文件锁

Frame.io V4 将版本栈建模为有序且严格线性的 File 容器；顺序决定版本号，栈顶 File 是界面显示的 head asset。它不是 Git 式分支图。[Frame.io V4 API Guide](https://developer.adobe.com/frameio/guides/)

在 Frame.io Mounted Storage 中，保存回同一个文件会自动形成新版本；两个人同时保存时不会被 Frame.io 锁住，而是分别产生版本进入版本栈。官方明确说明 Mounted Storage 不提供 live file locking，但可承载 Premiere 的 `.prlock` 等由创作软件自己维护的锁文件。[Frame.io Drive 故障排查](https://help.frame.io/en/articles/14501774-frame-io-drive-troubleshooting)、[Mounted Storage 优化](https://help.frame.io/en/articles/14501766-mounted-storage-optimization-hub)

Frame.io 还区分自动保存/增量编辑产生的 system-generated versions 与用户显式上传的 user-created versions。版本栈有数量上限；自动裁剪只清理没有评论、用户元数据或里程碑标记的版本，承载有意义活动的版本会被保护。[Frame.io Drive 故障排查](https://help.frame.io/en/articles/14501774-frame-io-drive-troubleshooting)

Mounted Storage 把项目根挂载为卷，按需分块读取并使用本地缓存；本地移动、重命名、删除和写入会同步到云端，权限沿用 Frame.io Web。[Frame.io Drive 故障排查](https://help.frame.io/en/articles/14501774-frame-io-drive-troubleshooting)

**启示：** “并发内容都保留为版本”是锁之外的可行策略；但如果自动捕获每次保存，Serpent 必须区分系统版本和用户版本、抑制零字节/临时文件、去抖自动保存并提供保留上限，否则版本会迅速膨胀。

### iconik：版本关联原件、代理和处理结果，存储可以混合部署

iconik 支持把上传内容作为新版本、把既有资产或版本合并为新版本、将旧版本提升为 latest，以及删除指定或全部旧版本；其 Assets API 直接暴露相应版本操作。[iconik Versioning](https://www.iconik.io/blog/update-versioning-in-iconik)、[iconik Assets API](https://app.iconik.io/docs/apidocs.html?url=%2Fdocs%2Fassets%2Fspec%2F)

iconik 的 Files API 按 `version_id` 查询文件、格式、代理、关键帧和字幕，也能对特定版本发起转码。这说明媒体 DAM 的“版本”不仅指一个原件 Blob，还需要拥有自己的衍生物和处理状态。[iconik Files API](https://app.iconik.io/docs/apidocs.html?url=%2Fdocs%2Ffiles%2Fspec%2F)

iconik 既能存储原件，也能连接已有云端或本地存储；连接既有云存储时可不复制高分辨率原件，只生成低分辨率代理和关键帧，ISG 也能扫描 SAN/NAS/个人电脑并选择上传原件或仅上传本地转码结果。[iconik 入门](https://www.iconik.io/blog/getting-started-with-iconik)、[iconik Developer Docs](https://app.iconik.io/docs/)

iconik 的 Assets API 将 approval request 和针对具体 `version_id` 的用户审批作为独立资源；Webhook 文档给出了所有审阅者批准后移动 collection、修改存储 ACL 或复制到外部系统的自动化示例。[iconik Assets API](https://app.iconik.io/docs/apidocs.html?url=%2Fdocs%2Fassets%2Fspec%2F)、[iconik Webhooks](https://app.iconik.io/docs/webhooks.html)

本次查到的 iconik 官方文档和 API 没有清楚说明通用资产编辑锁、同时覆盖冲突或二进制合并机制，因此不据此推断 iconik 提供锁。

**启示：** 版本应拥有独立的预览、代理、提取元数据和 AI 结果；`storage_backend` 应留扩展接口，以后才能在“集中上传原件”和“NAS 原地存储、云端仅保存索引/代理”之间演进。

### Adobe：版本是审阅容器，审批是独立生命周期

Adobe 的 Photoshop—Frame.io 官方集成允许用户从创作软件中创建新版本并继续交给相关方审阅；官方将 Frame.io 描述为集中评论、审阅和批准资产的平台。[Photoshop 中通过 Frame.io 分享审阅](https://helpx.adobe.com/photoshop/using/share-for-review-frameio.html)

Adobe Creative Cloud cloud documents 会自动跨设备同步并维护版本历史；恢复旧版本时，Photoshop Web 会把选中的旧内容保存为新的当前版本，而不是破坏性改写历史。[Creative Cloud 资产概览](https://helpx.adobe.com/creative-cloud/apps/create-and-manage-libraries/organize-manage-creative-cloud-assets.html)、[Photoshop Web 文档版本](https://helpx.adobe.com/photoshop/web/get-set-up/learn-the-basics/view-and-restore-document-versions.html)

Adobe 的一个 3D 资产管线示例把资产生命周期建模为 `Uploading → Processing → Reviewable → Approved`，处理失败是另一状态；只有进入 Reviewable 后才可批准，已批准资产才可用于项目。[Adobe Project Sunrise 资产管线](https://helpx.adobe.com/sunrise/assets/asset-pipeline.html) 同一产品中，上传新版本会递增资产版本号而不创建新资产，说明稳定资产身份和内容修订是分离的。[Adobe Project Sunrise FAQ](https://helpx.adobe.com/sunrise/get-started/faq.html)

**启示：** `asset`、`revision`、处理状态和审批状态应是不同概念。不要把“转码成功”“这是最新版”和“业务已批准”塞进一个布尔字段。

### Git LFS：大文件内容与版本元数据分离，锁是可选协议

Git LFS 在 Git 中保存包含版本、SHA-256 对象 ID 和大小的指针，而大文件本体存入按 OID 组织的本地对象目录并按需与 LFS 服务器同步。[Git LFS 规范](https://github.com/git-lfs/git-lfs/blob/main/docs/spec.md)

Git LFS 的锁协议支持创建、列出、验证和删除锁。服务端应拒绝同一路径上的重复锁；推送前验证会把锁区分为“我们的”和“他人的”，若更新了他人锁定的文件则停止推送；解锁协议还预留了强制解锁。[Git LFS File Locking API](https://github.com/git-lfs/git-lfs/blob/main/docs/api/locking.md)

Git LFS 的官方设计说明将锁的目标描述为避免不可合并二进制文件被意外并行编辑，同时承认锁只能通过工作流和服务端检查来约束，仍需支持处理遗留锁和有意覆盖规则的情况。[Git LFS 锁设计提案](https://github.com/git-lfs/git-lfs/blob/main/docs/proposals/locking.md)

**启示：** Serpent 可以借鉴“内容对象 + 指针”的数据布局，但不应照搬 Git 的提交、分支和工作区心智模型。创意用户需要的是稳定资产、显式修订、当前版本和可恢复冲突。

### Perforce Helix Core：不可合并资产采用集中式提交与按类型独占锁

Perforce 的标准工作流是从服务器取得最新版本，checkout 后编辑，再通过 changelist 提交；changelist 是一组文件变更的逻辑单元。首次提交上传项目内容，后续提交只上传新增或改变的文件。[Perforce 添加和处理版本化文件](https://help.perforce.com/helix-core/quickstart/current/Content/quickstart/admin-populate-stream.html)

对于二进制文件，Perforce 支持 `+l` exclusive-open：一个用户打开后其他用户不能再打开；另一种 `p4 lock` 允许多人打开，但只有锁持有人能提交。[Perforce 防止多人 checkout](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/P4Guide/resolve.lock.exclusive.html)

Perforce 的 typemap 可按路径或扩展名配置文件类型、独占锁和修订保留数。官方特别建议游戏引擎项目对不可合并的 3D 模型、图片、视频等二进制资产启用独占锁，并可用 `S#` 只保留最近若干修订以控制空间。[Perforce typemap](https://help.perforce.com/helix-core/quickstart/current/Content/quickstart/admin-create-typemap.html)

P4V 可以展示文件、文件夹和 changelist 的修订历史，取回指定修订、预览任意修订，并在支持时比较两个修订。[P4V 修订历史](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/files.history.html)

**启示：** 对游戏美术常见的不可合并文件，长期最好支持“按类型/路径配置为需锁定”，而不是所有资产一刀切强制锁定。changelist 和分支属于后续专业制作管线能力，不适合放入首发 MVP。

## 对 Serpent MVP 的建议

### MVP 应该有的隐藏基础

1. **稳定资产身份。** `asset_id` 不随文件名、Label、文件夹位置或内容更新而变化。
2. **不可变内容对象。** 用内容哈希标识原始字节；新内容写入新对象，成功校验后才切换 `current_revision_id`。这与 Git LFS 用 SHA-256 OID 将大文件对象和指针分开的做法相近。[Git LFS 规范](https://github.com/git-lfs/git-lfs/blob/main/docs/spec.md)
3. **最小修订记录。** 每次手动“替换文件”或同步上传改变了内容哈希时，创建 `revision`，至少记录内容对象、作者/设备、创建时间、原始文件名、大小和基准修订。
4. **乐观并发校验。** 客户端提交内容或元数据时携带它开始编辑时看到的 `base_revision_id` 或实体版本号。服务器只在基准仍是当前值时直接推进；否则进入冲突路径。
5. **绝不静默覆盖二进制内容。** 冲突时保留远端当前修订和本次上传，生成“冲突待处理”记录。Dropbox 在同时或离线编辑时保存冲突副本，是这一数据安全原则的成熟先例。[Dropbox 冲突副本](https://help.dropbox.com/organize/conflicted-copy)
6. **可恢复删除与原子切换。** 删除先进入回收站；上传完成、校验成功、预览生成状态已记录后，再原子更新当前修订指针。
7. **元数据与文件内容分轨。** Label、描述、标签、评分、色卡、收藏和 AI 生成字段不应因为内容新版本被整包复制覆盖。至少保留字段更新时间与修改者，为后续按字段合并和审计留接口。
8. **版本自己的衍生物。** 缩略图、视频代理、关键帧、波形、技术元数据和内容级 AI 结果应引用 `revision_id`；资产身份级的 Label、描述和人工标签默认跨版本。iconik 的 API 将代理、关键帧和字幕放在具体版本下，是这一划分的直接先例。[iconik Files API](https://app.iconik.io/docs/apidocs.html?url=%2Fdocs%2Ffiles%2Fspec%2F)

### MVP 可以明确不做

- 不做 Git 式分支、合并和 rebase。
- 不做跨多个资产的 changelist。
- 不做二进制内容 diff；图片/视频并排比较可留到评审阶段。
- 不做审批状态机、评论锚点和“最终版”。
- 不做自动捕获创作软件的每次保存；默认只由手动替换或明确同步写入形成修订。
- 不做强制 checkout/锁 UI；如果首发实际上只有个人库和多设备同步，这项复杂度没有回报。
- 不承诺永久保存全部历史。保留最近 N 个修订、按天数回收或仅保留冲突修订都可以成为管理员策略；Perforce 和 Dropbox 都把保留范围做成可配置的产品策略。[Perforce typemap](https://help.perforce.com/helix-core/quickstart/current/Content/quickstart/admin-create-typemap.html)、[Dropbox 版本历史](https://help.dropbox.com/delete-restore/version-history-overview)

## 建议的渐进式模型

### 阶段 0：本地优先的个人资产库

- 资产 ID、内容哈希、不可变内容对象和当前修订指针已经存在。
- UI 只显示当前内容；修订主要用于失败恢复和避免写坏库。
- 索引模式下，外部原文件变化只触发重新索引；除非用户选择“纳入版本”，否则不把外部文件系统的每次保存永久留档。

### 阶段 1：多设备自动同步

- 服务器是共享库的权威顺序源，提供单调递增的变更序列或游标。
- 客户端离线队列携带基准实体版本；恢复联网后按顺序重放。
- 内容冲突保留双方并提示选择当前版；元数据先采用按字段的乐观并发，无法自动判断时保留冲突记录。
- 此阶段提供简单的“历史/恢复”入口会显著降低支持成本，但无需版本比较和审批。
- 若未来改为“保存即版本”，需区分 `system` 与 `user` 修订，过滤临时/零字节文件，对连续自动保存去抖，并保护已有评论、审批或里程碑的版本不被自动清理；Frame.io 的 Mounted Storage 已采用类似区分和保护规则。[Frame.io Drive 故障排查](https://help.frame.io/en/articles/14501774-frame-io-drive-troubleshooting)

### 阶段 2：轻量团队库

- 增加手动“上传新版本”、版本列表、恢复为新版本和修订说明。
- 对指定扩展名或目录启用可选独占锁；锁记录至少包含拥有者、取得时间、设备/会话和租约或最后心跳。
- 提供请求解锁、管理员强制解锁和通知。Dropbox 与 Git LFS 都证明了强制解锁是清理遗留锁所需的逃生舱。[Dropbox 文件锁](https://help.dropbox.com/organize/file-locking)、[Git LFS File Locking API](https://github.com/git-lfs/git-lfs/blob/main/docs/api/locking.md)
- 即使启用锁，服务端仍必须执行基准修订校验，因为离线设备、外部程序和故障恢复都可能绕过客户端只读状态。

### 阶段 3：审阅与批准

- 评论、标注、审阅决定绑定 `revision_id`。
- 用独立状态机表达 `draft / in_review / changes_requested / approved`；上传新修订后，旧修订的审批结论保留但不自动批准新修订。
- 图片和视频增加并排/同步播放比较；Dropbox Replay 的版本比较与跨版本评论可作为交互参考。[Replay 视频版本比较](https://help.dropbox.com/view-edit/dropbox-replay-compare-video-versions)

### 阶段 4：专业游戏/影视管线

- 在确有需求后增加 changelist、资产依赖快照、制作软件提交插件、发布标签、保留策略和审计导出。
- 对可合并文本/元数据允许并行编辑，对不可合并二进制按类型或路径默认独占锁。
- 只有用户研究证明同一资产需要并行实验线时才引入分支；绝大多数 DAM 的“多个候选版本”可用修订 + 状态/集合表达，无需 Git 分支。

## 最小数据模型草案

```text
Asset
  id
  current_revision_id
  library_id
  created_by / created_at
  deleted_at

Revision
  id
  asset_id
  parent_revision_id
  blob_id
  original_filename
  byte_size
  created_by / created_at
  source_device_id
  origin = user | system | conflict | restore
  note

Blob
  id = content_hash
  storage_backend
  object_key
  verified_at

AssetMetadata
  asset_id
  label / description / rating / palette / ...
  entity_version
  updated_by / updated_at

RevisionArtifact
  revision_id
  kind = thumbnail | proxy | keyframe | waveform | extracted_metadata | ai_result
  blob_id / processing_status

Lock                         # 阶段 2
  asset_id
  owner_user_id
  acquired_at / expires_at
  session_id

ReviewDecision               # 阶段 3
  revision_id
  reviewer_id
  status
  decided_at
  note
```

这里的 `parent_revision_id` 初期只用于指出“本次上传基于哪个版本”，不等于承诺分支 UI。若两个客户端都基于同一父修订上传，系统可以识别分叉并保留两者；用户选择其中一个成为当前修订即可。

## 需要尽早写入产品约束的同步规则

| 情况 | 建议行为 |
|---|---|
| 两端上传相同内容哈希 | 复用内容对象，不新增有意义的内容版本；可合并来源事件 |
| 一端只改 Label，另一端只加标签 | 按字段合并 |
| 两端同时改同一标量字段 | 不静默丢弃；先用实体版本拒绝后写入，提示选择或保留审计记录 |
| 两端同时替换二进制内容 | 两个修订都保留，只有一个成为 current；另一项标为待处理冲突 |
| 离线端基于旧版本上传 | 与并发替换同样处理，不因为时间戳更新就自动获胜 |
| 资产被锁后另一端提交 | 拒绝推进 current；保留临时上传供用户下载或转成冲突修订 |
| 管理员强制解锁 | 记录审计事件并通知原锁持有人 |
| 恢复旧版本 | 创建一个指向旧 Blob 的新修订，不改写或删除历史；Adobe cloud documents 的恢复行为可作参考 |

## 最终判断

对当前 Serpent 定位，首发应把资源集中在：导入/索引、缩略图与 hover 预览、过滤排序搜索、Label/描述/标签/评分/色卡等元数据、AI 自动归类，以及 Windows/macOS 稳定性。

因此产品层面的版本管理可以推迟；但数据层的 `Asset → Revision → Blob` 分离、基准修订校验和冲突保全不能推迟。这样不会把 MVP 做成 Perforce，也不会在未来增加团队自动同步时被迫重写资产身份和存储模型。
