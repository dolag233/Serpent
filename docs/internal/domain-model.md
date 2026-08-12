# Serpent 领域模型

> 状态：生效，持续演进
> 日期：2026-07-11；最后校准：2026-08-12

## 核心关系

```text
Library
├─ ManagedFolder*            # 映射 Library/Assets 下真实目录
├─ LinkedFolder*             # 指向外部真实目录
├─ Asset*
│  ├─ current Revision
│  ├─ AssetMetadata
│  ├─ Tag*                   # 多对多分类
│  ├─ Collection*            # 树状、跨文件夹的长期策展分类
│  └─ RevisionArtifact*      # 缩略图、联系表、提取信息
├─ SmartCollection*          # 保存查询，不保存资产副本
└─ Job*                      # 可恢复后台任务
```

## 自动化访问面

Desktop、脚本与 MCP 都是第一方访问面，但 `Automation Command Gateway` 才是规范能力边界。所有入口调用相同的领域命令并遵守相同不变量，不得各自拥有 SQLite、文件操作或后台任务实现。JS/TS 脚本与 MCP 共享**同一领域 Action 面**；差别是调用者（人 vs Agent）与 transport，不是命令子集。通用 CLI 已撤出当前产品范围。

自动化入口只公开语义化领域 Action，不公开任意 SQL、数据库连接、Node.js、Shell、原始网络或绕过领域规则的文件系统接口。领域实体以稳定 ID 作为底层身份。精确定位单一实体时，入口只接受稳定 ID 或该实体在显式资源库中的唯一资源库路径，并解析为稳定 ID；标签、合集和其他结构化条件属于过滤，全文表达式属于搜索，二者都不冒充精确资源引用。

每次脚本运行形成 Automation Execution。MCP 的 transport session 只承载协议请求关联、progress、logging 与 cancellation，不形成业务上下文：不持有当前资源库、按库授权、会话权限或默认目标。每个 MCP 库级命令显式携带 `libraryId`，每次调用都可独立重试；客户端重连、刷新工具和 Desktop 焦点变化不改变业务语义。脚本和 MCP 都不直接接触 Library Worker。

Automation Capability 是稳定权限单位，不是风险等级。MCP Permission Policy 按客户端凭据持久保存，默认 `auto`，也可预先设为 `read-only` 或禁用具体能力；命令执行期间不弹人类权限 Prompt，也不存在 session grant。执行计划、路径边界、实体版本、资源库 `changeSequence`、冲突与 Worker 状态校验始终保留。

不可逆、低频或可能造成大范围数据损失的操作属于 dangerous。危险 MCP 命令第一次调用只生成精确风险报告和一次性 challenge，不产生写入；Agent 以绑定同一 credential、命令、参数、目标库和前置版本的第二次调用确认后才可执行。challenge 过期、篡改、重放或前提变化均不执行。它防止 Agent 单次误调用，不替代 credential 信任和能力禁用；全程不要求人类接管。

MCP Server 是正式 Desktop Main 内嵌、由设置管理的 loopback 服务，只负责标准 Streamable HTTP transport、客户端认证和 Automation Command 的协议适配。核心工具目录静态可发现，资源库目标显式，Desktop 只是非阻塞投影。端口可达和客户端已认证不能绕过权限策略、危险 challenge 或领域校验。

所有入口产生的可撤回领域修改进入同一个、每资源库独立的 Operation History。Library Worker 原子记录版本化的 forward/inverse recipe、受影响实体和前置条件，并且是撤回/重做执行的唯一所有者；Main 只建立用户意图组并把状态投影到窗口。Automation Execution 可以引用 History Group，但自动化执行日志不拥有恢复 payload。`file_operations` 继续只负责单次文件转换的崩溃恢复，不充当用户 Undo 栈。完整语义见 ADR-0032。

Operation History 是线性的：撤回后发生新修改会清空 redo 分支；只有当前栈顶可转换。永久磁盘删除等不可逆修改是 History Barrier，会使相关旧条目失效，但不会被伪装为可撤回。历史随资源库跨应用重启保留；Worker 重开库时先收口未完成的 HistoryAttempt，再重新验证恢复材料和实体前置条件，不能因记录存在就盲目承诺可撤回。

插件 Contribution（菜单、Hook、UI、输入捕获、Provider）不属于脚本/MCP Action 面。

## 插件扩展面

插件和自动化脚本共享 Automation Command Gateway 与 `serpent` 领域 API，但生命周期不同：
脚本是一次 Automation Execution；插件是可安装、激活和停用的扩展，能够注册 UI
Contribution、领域 Hook、Provider、输入捕获和后台 Job handler。

```text
PluginPackage
├─ manifest + immutable files + integrity
└─ runtime_mode = restricted | unrestricted

PluginInstallation
├─ installation_scope = user | library
├─ package
└─ enabled intent

PluginTrustDecision             # 当前设备本地
PluginResolution                # 当前设备为当前资源库选择 user/library/disabled
PluginInstance
├─ instance_scope = global | library
├─ setup(context) / dispose(reason)
└─ ContributionRegistry         # pluginInstanceId + localContributionId
```

不变量：

- 用户级安装位于应用用户数据；资源库级安装位于 `.serpent/plugins/<pluginId>/` 并可以随资源库同步。每个安装范围的插件 ID 只有一个活动包目录，版本信息只在清单与 lock 中记录；升级通过 staging 后覆盖该目录。
- 资源库级 Package 同步不包含本机信任。每台设备首次运行前都必须显式信任。
- 同一插件 ID 的用户级和资源库级版本发生冲突时由用户选择；两者不得同时激活。
- 安装范围只描述 Package 存放位置，不推导运行实例范围。全局实例每应用会话一个，资源库
  实例每个已打开库一个；二者使用同一 `setup` / `dispose` 生命周期，不另设 openLibrary。
- 受限插件只能通过声明并授权的 Host API 行动。非受限插件具有完整 Node.js 能力，其权限清单
  不能被描述为完整系统沙箱。
- 插件通过 Gateway 发起的领域命令继续遵守实体版本、Execution Plan、文件恢复和 Library
  Worker 所有权；非受限插件绕过 Gateway 的直接系统行为不享受这些保证。
- 插件 Hook 不得在数据库事务或文件锁内执行；搜索、过滤和排序 Provider 不得在 Renderer
  中逐资产同步求值。
- Contribution Context 只承载 UI 条件所需的有界同步状态；命令触发时冻结 Invocation
  Context；实际功能使用完整 `serpent` Domain API。复杂 UI 条件异步解析成 Context Key，
  菜单打开不得等待插件代码。

## 聚合与实体

### Library（资源库）

独立、可整体移动和备份的资产容器。包含：

- 用户可读的 `Assets/` 托管文件树。
- 普通可见的 `.serpent/` 内部数据目录。
- 资源库文件夹、链接文件夹、资产、标签、合集和智能合集。
- 自己的数据库、全文索引、预览、任务状态、修订和回收站。

多个资源库可以同时打开，但搜索、标签和设置互相独立；跨库拖放复制资产。

MVP 中，同一资源库同一时间只允许在一台电脑上活动使用。多机并发打开、跨设备写入协调和协作锁不属于当前领域边界；未来团队协作需单独建模用户身份、服务端仲裁和资产锁。

建议身份字段：

```text
Library
  id
  schema_version
  display_name
  created_at
  settings
```

### ManagedFolder（资源库文件夹）

映射 `Assets/` 下真实目录的主要层级结构。每项托管资产最多属于一个资源库文件夹；合集提供跨文件夹虚拟分类，标签提供检索与筛选维度。

```text
ManagedFolder
  id
  library_id
  parent_id?
  name
  relative_path
  created_at
```

不变量：

- `relative_path` 必须位于该资源库的 `Assets/` 内。
- 同一父目录下名称唯一，遵守 Windows 与 macOS 共同路径约束。
- 移动或重命名文件夹必须协调磁盘操作与数据库状态，并支持崩溃恢复。
- 复制导入整个文件夹时，在当前 ManagedFolder 下完整保留源目录树；单独导入、拖入或粘贴文件时使用当前 ManagedFolder，未选择时使用 `Assets/` 根目录。
- 浏览 ManagedFolder 时，直接子文件夹作为 FolderBrowseEntry 与资产并列出现，但它仍是目录实体而不是 Asset。
- 目录摘要区分直接资产数、递归资产数和子目录数；最终 UI 显示口径由 0017 规格确认。
- 文件夹内容预览是从其资产缩略图派生的可再生成读模型，不成为文件夹身份或用户元数据。

### LinkedFolder（链接文件夹）

指向资源库外部真实目录。用户只能通过“导入文件夹 → 以链接方式导入”创建。

```text
LinkedFolder
  id
  library_id
  display_name
  absolute_root_path
  source_device_hint
  filter_rule_set_id
  status = available | offline | missing
```

链接过滤规则命中的路径不形成资产，不被显示或操作。根路径失效后，用户可以指定新根目录，并依据相对路径批量找回资产。

LinkedFolder 与 ManagedFolder 在导航中共享“文件夹”呈现语义，但保留不同位置类型和写入规则。链接正常、离线或断链通过状态图标和说明表达，不靠独立导航分区表达。

链接文件夹可以单向转换为资源库文件夹：先复制源内容，全部校验成功后再移除链接关系，源内容保留。

### Asset（资产）

稳定的逻辑档案卡。文件名、目录位置或内容变化时，`asset_id` 不变。MVP 不存在独立于真实文件名的 Label/显示别名；用户重命名资产时执行文件重命名领域命令。

```text
Asset
  id
  library_id
  location_kind = managed | linked
  managed_folder_id?         # managed 时存在
  linked_folder_id?          # linked 时存在
  relative_file_path
  current_revision_id
  availability = available | missing
  created_at
  deleted_at?
```

不变量：

- 所有通过过滤规则的文件都是资产；MVP 不存在纯 URL 书签资产。
- 资产只能是 managed 或 linked，不能同时属于两种位置。
- managed 资产最多属于一个 ManagedFolder。
- linked 资产的相对路径必须位于 LinkedFolder 根目录内。
- 不支持内置预览的文件仍可成为资产。
- 连续编号图片的每一帧仍是独立 Asset；`AssetSequence` 关系指定主帧、有序成员与 FPS，普通浏览只显示主帧。关系失效或解散后，剩余帧必须恢复为普通可见资产。
- 用户在 Serpent 内移动托管资产时 `asset_id`、资产级元信息和组织关系保持不变，只更新真实路径。
- 外部软件移动或重命名托管文件后不自动猜测新位置；资产进入 `missing` 状态，等待单项或批量重新关联。

### Revision 与内容位置

Revision 表达资产当前文件内容的一次修订。MVP 不展示版本历史 UI，但该层用于安全替换、衍生物失效和未来同步。

```text
Revision
  id
  asset_id
  parent_revision_id?
  content_hash?
  byte_size
  modified_at
  original_filename
  origin = import | external_change | replace | restore
  accepted_at
```

托管与链接存在重要区别：

- 托管资产的内容位于资源库中。MVP 可以用不可变临时内容对象完成校验和原子切换，但在提供可见的版本管理能力之前，不把客户端替换产生的旧内容作为可恢复历史长期保留。
- 链接资产不复制源字节。外部变化被接受后可以生成修订记录并使旧衍生物失效，但旧文件字节无法恢复。
- 托管文件被外部软件原地覆盖时，Serpent 通常只能在发现变化后处理，因此 MVP 同样不承诺保存被覆盖前的旧字节。

Revision 记录表示“内容发生过切换”，不等于对应旧文件字节一定仍存在，也不等于 MVP 提供版本历史或恢复界面。

### AssetMetadata（人工资产元信息）

用户维护的资产级信息不因文件内容更新而整体丢失，也不被 AI 分析覆盖。

```text
AssetMetadata
  asset_id
  description?
  rating = 0..5
  favorite
  palette?
  source_page_url?
  author?
  entity_version
  updated_at
```

`entity_version` 仅是 `AssetMetadata` 行的乐观并发控制 token，不是文件内容版本，也不要求
在用户界面展示。文件内容修订由 `Asset.current_revision_id` 指向 `Revision`；导入、替换或
接受外部内容变化时切换到新的修订，元数据和组织操作不改变该指针。

`author`（Serpent-7x0）是用户可编辑的创作者/作者字段，与 `source_page_url` 共用清空语义（保存空字符串即清空为 `null`）。图片首次生成缩略图时，若 `author` 为空，Worker 会尝试从文件的 EXIF/IPTC/XMP 元数据中提取创作者信息（优先级：XMP `dc:creator` > IPTC By-line/Creator > EXIF `Artist`）并回填，但不覆盖用户已填写或此前已提取过的非空值；这是尽力而为的增强，提取失败或没有相关字段时保持为空，不阻塞缩略图生成。视频等不支持 EXIF 的格式不做自动提取。

AI 生成的单值或结构化内容单独保存：

```text
AIContent
  id
  asset_id
  revision_id?
  field_name
  value
  model_id
  model_version
  generated_at
```

每项资产、修订和字段只保留当前 AI 内容；重新分析成功后原子替换旧 AI 内容，MVP 不保留 AI 分析历史。描述等字段存在人工值时优先显示人工值，否则可以显示已启用的 AI 值；主界面为生效的 AI 值显示来源标记，编辑界面分别呈现人工层和 AI 层。AI 不生成资产名称，也不重命名文件。

文件提取的技术元信息属于修订衍生物，不与人工或 AI 内容混存。清空 AI 内容支持单项资产、当前选择、文件夹和整个资源库，批量操作需要确认；它只删除 `AIContent` 和 AI 标签关系，不影响人工元信息、人工标签、提取元信息或 Tag 实体。

自动色卡属于当前修订的算法衍生物，不使用 AI；`AssetMetadata.palette` 仅保存用户编辑或替换后的人工色卡。存在人工色卡时优先显示，否则显示当前修订的自动色卡。

### Tag（标签）

标签承担检索与筛选维度，一项资产可拥有多个标签。标签不是资源导航范围，不在左侧导航中完整枚举，也不建立独立标签管理页面；主要入口是发现过滤条和 Inspector 的 tag chip 编辑器。

```text
Tag
  id
  library_id
  name

HumanAssetTag
  asset_id
  tag_id

AIAssetTag
  asset_id
  tag_id
  revision_id?
  model_id
  model_version
```

AI 优先复用已有标签，但允许按全局设置创建新标签。资产最终显示人工与 AI 标签关系的并集；同一标签同时存在两种关系时，清空 AI 内容只移除 AI 关系，人工关系继续保留。AI 创建的 Tag 即使失去所有资产关系也不自动删除，由用户自行清理。

Inspector 添加标签时可以选择最近使用、搜索现有标签或输入新名称创建后分配。大量标签不得直接全部渲染到导航或右键菜单中；这些入口使用可搜索的选择器。

### Collection（合集）

类似 Pinterest 画板，作为文件夹主结构之外的虚拟分类和策展视图。合集可以形成树状层级，长期收集来自不同资源库文件夹或链接文件夹的资产，不映射磁盘目录，也不改变资产的实际存放位置。一项资产可以加入零个或多个合集。

```text
Collection
  id
  library_id
  parent_id?
  name
  description?
  cover_asset_id?
  position

CollectionAsset
  collection_id
  asset_id
  position
```

打开父合集时默认汇总自身及所有后代合集中的资产，并允许切换为“仅当前层”。合集内支持手动资产排序；删除合集只删除合集和成员关系，不删除资产。AI 不创建合集关系，也不建议或自动把资产加入合集。

### SmartCollection（智能合集）

保存搜索、过滤和排序定义；不保存资产副本或静态成员关系。

```text
SmartCollection
  id
  library_id
  name
  query_definition
  sort_definition
```

查询规则：跨字段 AND、同字段多值 OR、单条件可排除；任意嵌套条件组不进 MVP。

### RevisionArtifact（修订衍生物）

依赖具体文件内容，内容变化后需要失效或重新生成。

```text
RevisionArtifact
  id
  revision_id
  kind = thumbnail | video_poster | contact_sheet | waveform |
         extracted_metadata | extracted_palette | ai_result
  path_or_payload
  status
  generator_version
```

### Job（后台任务）

持久化任务队列中的可恢复工作单元。

```text
Job
  id
  library_id
  asset_id?
  revision_id?
  kind
  status = queued | running | paused | succeeded | failed | cancelled
  priority
  progress
  attempt_count
  error_code?
  error_detail?
  created_at
  updated_at
```

任务支持暂停、继续、取消、重试。上次异常退出留下的 `running` 任务在下次启动时恢复为可重试状态。

## 关键命令

```text
CreateLibrary
OpenLibrary
ImportFiles
ImportFolderAsManaged
ImportFolderAsLinked
CreateManagedFolder
RenameManagedFolder
CopyManagedFolder
CloneManagedFolder
MoveManagedFolder
DeleteManagedFolder
ConvertLinkedFolderToManaged
MoveManagedAsset
RenameManagedFile
RelinkMissingFolder
RelinkMissingAssets
RefreshExternalChanges
DeleteAsset
RestoreAsset
MergeSuspectedDuplicates
SetAssetMetadata
ClearAIContent
AssignTags
AddToCollection
RemoveFromCollection
SaveSmartCollection
SearchAssets
EnqueueAnalysis
PauseJobs / ResumeJobs / CancelJobs / RetryJobs
ExportLibrary
```

`ExportLibrary` 默认导出托管资产、数据库、用户元数据和实际仍保留的历史修订，排除可重新生成的缩略图、预览、代理和 AI 临时文件；是否包含链接文件夹源内容每次询问。

ZIP 导出只生成不带 ZIP64 扩展的普通 ZIP。预检发现超出实现支持的传统 ZIP 大小或条目上限时，不启动压缩任务并引导用户改用完整文件夹导出。

## 关键事件

```text
AssetImported
ExternalFileChanged
ExternalChangeRefreshed
AssetBecameMissing
LinkedFolderRelocated
ManagedFileMoved
MissingAssetRelinked
AssetRevisionChanged
ArtifactInvalidated
MetadataChanged
AIAnalysisCompleted
AIContentCleared
JobFailed
AssetMovedToTrash
LibraryConnectionLost
LibraryConnectionRestored
```

## 明确后置的领域问题

- 可见版本管理上线后，托管修订内容保留多久，以及如何计入回收站和空间清理。
