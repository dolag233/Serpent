# 第0009垂直切片：云端 AI 自动分类（BYOK）

> 状态：部分实现 / fixing（队列可靠性修复已落地；完整队列 UI、真实供应商与跨平台 QA 未完成）
> 日期：2026-07-13
> 2026-07-16 产品变更：AI 生成 Label 及其开关已被 ADR 0022 取消；0018 负责协议和兼容迁移。
>
> **当前实现提示（2026-08-15）**：本文是 0009 的历史切片规格，不能直接当作当前操作说明。当前用户入口和事实以 [`docs/user-guide/ai.md`](../../user-guide/ai.md)、`src/shared/ai-endpoints.ts` 与 `src/shared/ai-analysis-settings.ts` 为准：MVP 为云端 BYOK；支持 DashScope、OpenAI Chat/Responses、Anthropic Messages、Gemini Native 五种 API 格式；输出为描述、标签和 AI 评分；自动分析需要用户显式开启；视频只发送联系表，3D 发送四视图，音频/文本不支持。旧文中的 Label、结构化元信息、poster+contact sheet、三供应商和默认自动运行均为历史内容。

## 目标

让用户在导入资产后，由配置的第三方云端视觉模型自动生成 Label、描述和标签，并独立于人工内容保存；支持按资产/文件夹范围触发分析、暂停/继续/取消/重试队列、清空 AI 内容，且 AI 永不覆盖用户手动填写的信息。API Key 由用户自行提供并存储在操作系统安全凭据中，Serpent 不代理、不计费、不追踪额度。

## 用户主线

1. 首次使用 AI 时，用户选择供应商（OpenAI / Gemini / Anthropic）、填入 API Key、选择模型并接受数据发送免责声明。配置界面提供"测试连接"，即时反馈认证、权限、额度和网络状态。
2. 保存有效配置后 AI 自动启用；后续启动不再重复提示。用户可在全局设置中独立开关 AI 对 Label、描述、标签和结构化元信息的写入，默认全部开启。
3. 资产导入完成后（切片 0002/0003），AI 在后台自动创建分析任务并在 Worker 中执行；界面显示队列进度：请求数、已处理数、失败数。
4. 图像资产分析：发送缩略图到视觉模型，模型返回 Label、描述和建议标签。视频资产分析：先读取封面与多帧联系表（依赖切片 0006 已生成的 contact_sheet 衍生物），一并发给模型，并附文件名信息。
5. AI 生成结果写入 `ai_content` 和 `ai_asset_tag`，与人工内容和技术元信息独立存储。人工已填写的字段不被 AI 覆盖；主界面为 AI 值显示来源标记，编辑界面分开展示人工层与 AI 层。
6. AI 优先复用资源库已有标签；若未命中且全局设置允许，可创建新标签。
7. 用户可随时暂停、继续、取消或重试 AI 队列；可按文件或文件夹过滤分析范围。网络或服务端临时错误自动重试两次，认证/权限/参数错误直接失败并提示手动重试。
8. 用户可对单项资产、所选资产、指定文件夹或整个资源库一键清空 AI 内容；批量清空需要确认。清空只移除 AI 内容及 AI 标签关系，不删除人工信息、提取元信息或 Tag 实体。
9. Worker 异常退出后，下次启动将 running 状态的 AI 任务重置为可重试，不丢失任务记录。

## 范围

### 包含

- 全局 AI 配置：供应商选择、模型选择、字段写入开关、语言设置、自动分析开关。API Key 经 Electron `safeStorage` 加密存储，配置 JSON 存于应用用户数据目录。
- 首次配置免责声明一次展示；"测试连接"用最小请求区分认证失败、权限不足、额度用尽、网络不可达和未知错误。
- 内置三种供应商适配器（OpenAI、Gemini、Anthropic），各自处理认证、模型选择、视觉输入格式、结构化输出解析和 HTTP 错误，对上暴露统一的内部 `AIAnalysisResult` 接口。
- 内置受支持模型清单（代码常量，每版本快照更新）：GPT-4o / GPT-4o Mini、Gemini 2.5 Flash / Pro、Claude Sonnet 4 / Haiku 3.5。
- schema migration：`ai_content` 表（按资产+字段存储 AI 生成值）、`ai_asset_tag` 表（AI 赋予的标签关系，与切片 0004 的 `human_asset_tag` 独立）。
- `jobs` 表扩展 AI 分析 job kind（`ai.image.analysis`、`ai.video.analysis`），复用切片 0004 的 Job 队列模型（status、priority、progress、attempt_count、error_code）。
- AI 分析前置条件检查：`auto_analyze_enabled` 开启时，资产导入后自动入队；图像资产须有缩略图就绪（切片 0006），视频资产须有 contact_sheet 衍生物就绪。
- 图像分析流程：读取缩略图缓存路径，base64 编码，发送到视觉模型，解析结构化输出，写入 `ai_content`/`ai_asset_tag`（单事务，按字段写）。视频分析流程：读取 poster + contact_sheet 两条路径，合并为多图请求，附文件名上下文。
- 结构化输出验证：模型返回不符合预期 schema 时记录错误并标记 job 失败，不静默丢弃。
- AI 写入尊重优先级：`AssetMetadata` 中对应字段有值时跳过 AI 写入；`HumanAssetTag` 关系独立于 `AIAssetTag`，Render 端取并集展示。
- AI 队列暂停/继续/取消/重试；按 `assetIds` 或 `folderId` 过滤入队范围；重试时重置 `attempt_count` 和 error 字段。
- 重试策略：遇到网络错误、超时、HTTP 5xx、429 时自动重试最多两次（指数退避）；HTTP 401/403/400 不自动重试，直接标记失败。
- 进度事件（`ai.progress`）：libraryId、queued/running/succeeded/failed 计数，通过 IPC 推送到 Renderer。
- AI 内容清空：支持 `assetIds`（最多一项或多项）、`folderId`（该文件夹下所有资产）、`entireLibrary`（整个资源库），批量操作须 `confirm = true`。清空后发送 `ai.cleared` 事件。
- Worker 崩溃恢复：`status = running` 的 AI job 在 Worker 启动时重置为 `queued`。
- 资源库关闭时取消该库所有 pending/running AI job（不等待完成）。
- 每个供应商独立并发限制（如 2 并发），全库全局额度 MRI 限流。
- 非阻断错误展示：Renderer 显示 job 失败原因（安全化，不含 Key 或内部路径），完整错误链写入持久应用日志。
- 托管资产和链接资产均支持 AI 分析。

### 不包含

- 本地模型（Ollama、本地文件、自动下载管理）。
- 向量语义搜索或视觉相似搜索（ADR-0011 已推迟）。
- AI 搜索查询转换（属于切片 0005 的搜索框 AI 按钮）。
- 自动色卡生成（本地算法，非 AI，属切片 0006）。
- 每项资产的 AI 模型独立选择或覆盖。
- AI 分析历史记录（只保留当前结果，重新分析原子替换）。
- 供应商账户额度追踪或费用估算。
- 合集或智能合集 AI 内容生成。
- 模型变更后批量重分析（用户手动按需触发）。
- AI 置信度评分或用户可见的模型版本信息。
- 自动清理 AI 创建但已无资产关联的孤立 Tag。
- WebSocket / 流式 AI 响应（MVP 仅请求-响应模式）。
- 视频联系表抽帧间隔、最大帧数和尺寸的可配置 UI（使用切片 0006 默认参数）。
- 第三方供应商 API 演进的自动适配（需手动更新代码常量清单）。

## schema

在切片 0004（tags / collections / asset_metadata / jobs）、0005（FTS5）、0006（revision_artifacts）的 schema 基础上追加。不修改已有表结构，仅新增表和 job kind。

```text
ai_content
  ai_content_id TEXT PK
  asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE
  revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL
  field_name TEXT NOT NULL CHECK (field_name IN ('label', 'description', 'structured_metadata'))
  value TEXT NOT NULL
  model_id TEXT NOT NULL
  model_version TEXT NOT NULL
  generated_at TEXT NOT NULL

ai_asset_tag
  asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE
  tag_id TEXT NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE
  revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL
  model_id TEXT NOT NULL
  model_version TEXT NOT NULL
  PRIMARY KEY (asset_id, tag_id)

CREATE INDEX ai_content_asset_field ON ai_content(asset_id, field_name);
CREATE INDEX ai_asset_tag_asset ON ai_asset_tag(asset_id);
CREATE INDEX ai_asset_tag_tag ON ai_asset_tag(tag_id);
```

不变量：

- `ai_content` 中同一 `(asset_id, field_name)` 最多一行；重新分析时在同一事务内 DELETE 旧行再 INSERT 新行，保证原子替换。此约束由应用层保证（Worker 单一写入者串行化该资产的分析）。
- `revision_id` 记录分析时资产的当前修订；UI 不直接展示，供未来判断 AI 结果是否因内容变化而过期。
- `ai_asset_tag` 与切片 0004 的 `human_asset_tag` 独立存储，Render 端取 `(human_asset_tag UNION ai_asset_tag)` 展示，同一 tag_id 可同时存在于两张表。
- AI 写入 tag 时优先匹配已有 Tag 行（按 name 精确匹配，大小写不敏感）；无匹配且全局设置 `tagEnabled` 允许创建时，在 `tags` 表 INSERT 新行。Tag 创建后即使所有资产关系被清空也不自动删除。
- `model_id` 和 `model_version` 记录生成来源；`model_id` 对应内置模型清单中的标识，`model_version` 由供应商 API 响应中的 model 字段提取或使用请求时的固定快照值。
- `jobs` 表不新增列，通过 `kind` 区分：`ai.image.analysis`（图像资产分析）、`ai.video.analysis`（视频资产分析）。`asset_id` 和 `revision_id` 指向分析目标；`error_code` 存储安全化错误码（`AI_NETWORK`、`AI_AUTH`、`AI_RATE_LIMIT`、`AI_PARSE_FAILED`、`AI_VENDOR_ERROR`）；`error_detail` 包含去敏后的供应商错误信息（不含 Key 或完整请求体）。

全局 AI 配置（非库内 schema，存于应用用户数据目录 `ai-config.json`）：

```text
{
  provider: 'openai' | 'gemini' | 'anthropic',
  model: string,
  labelEnabled: boolean (default true),
  descriptionEnabled: boolean (default true),
  tagEnabled: boolean (default true),
  structuredMetadataEnabled: boolean (default true),
  language: string (default 'auto'，映射 OS locale；用户可指定 BCP-47 tag),
  autoAnalyzeEnabled: boolean (default true),
  disclaimerAccepted: boolean (default false)
}
```

API Key 经 `safeStorage.encryptString()` 加密后存为 `<userData>/ai-key.enc`，Worker 启动和 reconfigure 时由 Main 传递 base64 编码的加密载荷；Worker 不持久化解密后的 Key 到磁盘或日志。

内置模型清单（代码常量，不进数据库，每次发布更新快照）：

```text
openai:
  gpt-4o              (vision)
  gpt-4o-mini         (vision)
gemini:
  gemini-2.5-flash    (vision)
  gemini-2.5-pro      (vision)
anthropic:
  claude-sonnet-4-20250514  (vision)
  claude-haiku-3-5-20250514 (vision)
```

## 协议

### Renderer 语义请求（新增，追加到 `rendererRequestSchema` 联合）

```text
ai.configure.request
  { provider, apiKey, model, labelEnabled, descriptionEnabled, tagEnabled,
    structuredMetadataEnabled, language }

ai.test-connection.request
  { provider, apiKey, model }

ai.analyze.request
  { libraryId, assetIds?, folderId? }
  -- 不传 assetIds/folderId：分析库中所有无当前 AI 内容或 AI 内容已过期的资产

ai.pause-jobs.request    { libraryId }
ai.resume-jobs.request   { libraryId }
ai.cancel-jobs.request   { libraryId, jobIds? }
ai.retry-jobs.request    { libraryId, jobIds? }

ai.clear-content.request
  { libraryId, assetIds? | folderId? | entireLibrary?, confirm }
  -- entireLibrary = true 时须 confirm = true

ai.status.request         { libraryId }
ai.settings.get.request   {}                          -- 返回当前全局 AI 配置（不含 Key）
```

AI 配置路径不绑定单个资源库，因此 `ai.configure.request` 和 `ai.test-connection.request` 不带 `libraryId`。配置修改通过 Main 中转并在 Worker 端即时生效。

Main 在收到 `ai.configure.request` 后：若 `disclaimerAccepted` 尚未为 true，Renderer 须先展示免责声明并获得用户确认；确认后 Main 用 `safeStorage.encryptString(apiKey)` 加密，存储 `<userData>/ai-key.enc` 和 `<userData>/ai-config.json`，再将 base64 编码的加密 Key + 配置打包为内部 command 发给 Worker。

`apiKey` 不出现在任何 Renderer 响应中：`ai.settings.get.request` 返回的配置不含 apiKey 字段；测试连接结果只报告成功/失败及错误分类，不返回 Key 或原始 HTTP 响应体。

### Worker 内部命令（Main → Worker，追加到 `workerCommandSchema`）

```text
ai.configure
  { provider, encryptedApiKeyBase64, model, labelEnabled, descriptionEnabled,
    tagEnabled, structuredMetadataEnabled, language, autoAnalyzeEnabled }

ai.test-connection
  { provider, encryptedApiKeyBase64, model }

ai.enqueue-analysis
  { libraryId, assetIds?, folderId? }
  -- Worker 枚举目标资产、过滤已有有效 AI 内容的项、批量创建 Job 行

ai.pause-jobs    { libraryId }
ai.resume-jobs   { libraryId }
ai.cancel-jobs   { libraryId, jobIds? }
ai.retry-jobs    { libraryId, jobIds? }

ai.clear-content
  { libraryId, assetIds? | folderId? | entireLibrary, confirm }

ai.status        { libraryId }
```

Worker 在 `ai.configure` 时用 `safeStorage.decryptString(Buffer.from(encryptedApiKeyBase64, 'base64'))` 解密 Key 并缓存在内存中（不写磁盘），后续 AI 调用直接使用。Worker 关闭时清除内存缓存。

### Worker 内部 AI 调用接口（不进 IPC，供适配器实现）

```text
analyzeImage(params: {
  apiKey: string; model: string; imageBase64: string;
  language: string; existingTagNames: string[];
  enabledFields: { label: boolean; description: boolean; tags: boolean };
}) => Promise<{ label?: string; description?: string; tags: string[];
                modelVersion: string }>

analyzeVideo(params: {
  apiKey: string; model: string;
  posterBase64: string; contactSheetBase64: string; filename: string;
  language: string; existingTagNames: string[];
  enabledFields: { label: boolean; description: boolean; tags: boolean };
}) => Promise<{ label?: string; description?: string; tags: string[];
                modelVersion: string }>
```

三个供应商适配器各自实现此接口，封装 API endpoint、认证头、多图消息构造和结构化输出 JSON Schema 约束。解析失败时抛出带 `AI_PARSE_FAILED` 错误码的异常。

### 事件推送（Worker → Main → Renderer，新增 IPC 通道）

```text
serpent:ai:progress    { libraryId, kind: 'ai.progress',
                          queued, running, succeeded, failed }
serpent:ai:completed   { libraryId, kind: 'ai.analysis.completed',
                          assetId, fieldCount, tagCount }
serpent:ai:cleared     { libraryId, kind: 'ai.content.cleared',
                          affectedAssetCount }
```

`ai.progress` 在 job 状态变更时去抖推送（最多每秒一次）；`ai.analysis.completed` 单资产分析完成时推送；`ai.content.cleared` 清空操作完成后推送。Render 端在收到 `ai.analysis.completed` 或 `ai.content.cleared` 后刷新受影响的资产列表。

## 测试接缝

- schema migration：从切片 0006 的最终 schema 版本升级、重复打开幂等、migration 事务回滚与 checksum 篡改。
- 全局 AI 配置读写：`ai-config.json` 完整性与默认值回退；`safeStorage` 加密/解密 round-trip（单元测试 mock Electron safeStorage API）；`apiKey` 不出现在任何 Renderer 响应或日志中。
- "测试连接"四种错误分类：认证失败（401）、权限不足（403）、额度用尽（429 with quota body）、网络不可达（ECONNREFUSED / timeout）；成功路径。使用 mock HTTP 服务器验证适配器行为。
- 三个供应商适配器契约：相同输入（示例图像 base64、语言、已有标签）产生符合 `AIAnalysisResult` 形状的输出；各自处理认证头、多图消息格式和结构化输出约束的差异。至少一项适配器契约测试覆盖供应商返回不符合预期 JSON 时的解析失败路径。
- AI 内容写入：`ai_content` 单资产单字段唯一（重新分析原子替换）；`AssetMetadata` 中有 Label/描述时 AI 不覆盖；`HumanAssetTag` 与 `AIAssetTag` 独立存储、查询并集正确。
- AI 标签复用：模型返回标签名匹配已有 Tag（大小写不敏感）时复用 `tag_id` 不变；无匹配时按 `tagEnabled` 开关决定是否创建新 Tag。
- AI 队列：enqueue（按 assetIds、按 folderId、全库）、pause/resume/cancel/retry 状态机正确；取消后不执行 HTTP 调用；retry 重置 attempt_count。
- 重试策略：网络错误 / HTTP 5xx / 429 自动重试两次，指数退避最小 1s；HTTP 401/403/400 不自动重试并标记 failed；手动 retry 可重新尝试认证类失败。
- 视频分析前置：contact_sheet 未就绪时 job 保持 queued 或标记 waiting，不发送不完整请求；依赖切片 0006 的 revision_artifact 状态查询。
- Worker 崩溃恢复：running job 重启后重置为 queued；已完成 job 状态不变。
- Renderer 安全边界：Renderer 请求中 `apiKey` 仅在 configure 和 test-connection 入参中出现（单向发送到 Main），后续响应永不返回 Key；Worker 内部错误日志不含解密后的 Key 明文。job error_detail 经安全化，不含 Key、完整 URL 或 base64 载荷。
- 清空 AI 内容：单资产（`assetIds` 含一项）、多资产（`assetIds` 多项）、文件夹范围（`folderId`，递归子文件夹）、全库（`entireLibrary = true`）。全库和文件夹操作缺少 `confirm = true` 时拒绝。清空后 `ai_content` 和 `ai_asset_tag` 目标行删除，`human_asset_tag` 和 `AssetMetadata` 不受影响。
- 并发限流：同供应商不超过配置的最大并发数（默认 2）；队列 FIFO 调度；一个库的 AI job 不阻塞其他库的正常读写操作。
- 资源配置释放：资源库关闭时取消所有 pending/running AI job；Worker 关闭时中断进行中的 HTTP 请求（AbortController）。
- 错误可观测性：Renderer 接收安全化错误信息（`AI_NETWORK` → "网络连接失败，已自动重试"），持久应用日志保留完整错误链（含 HTTP 状态码和去敏响应摘要，不含 Key 和 base64）。

## 完成标准

- 全部自动化门禁通过；macOS 打包 AI 分析冒烟有明确结果，Windows 保留为显式未验证项。
- 三个供应商适配器各自通过契约测试（图像输入 → 结构化输出），且至少一个适配器覆盖解析失败路径。
- AI 写入不覆盖人工已填字段；清空 AI 内容不影响人工信息、提取元信息和 Tag 实体。
- 网络临时错误自动重试两次后仍失败时正确标记 job 状态；认证错误不自动重试。
- Worker 崩溃恢复后 running job 重置为 queued；资源库关闭时取消该库所有 AI job。
- Renderer 不接收 API Key、内部绝对路径或原始 HTTP 响应体；应用日志不含 Key 明文。
- 开发日志、双轴审查与 QA 报告完整。
