# Plugin Providers 开发日志

日期：2026-08-01  
工单：`Serpent-upsn.8`  
范围：0024 §10.3 Phase F `derived-field.provider` 与实时 `search.provider` 垂直切片

## 已实现

- `plugin-manifest.ts` 为 provider 增加 `fieldId` / `fieldType` 元数据，并要求
  `derived-field` provider 声明二者。
- `plugin-providers.ts` 定义 provider kind、资产批次、deadline、结果上限、结果
  schema、注册表和有界 invoke queue。
- Standard QuickJS Host 与 Trusted Node Host 均支持
  `provider-invoke` / `provider-complete`，Main supervisor 对每个 invoke 设置超时。
- Provider 在激活时注册、实例结束时撤销；注册信息包含 library、plugin、package
  hash，derived field 使用 `pluginId.fieldId` 命名空间。
- `plugin-provider-scheduler.ts` 在 Main 以最多 128 个资产一批调用 provider，并将
  结果交给 Worker；Renderer 不执行逐资产 plugin JavaScript。
- Worker schema v28 增加 `plugin_derived_fields`，支持字符串、数字、布尔和 JSON
  存储；materialize 会清理同字段的旧 package hash，query 按当前 package hash
  返回 asset IDs。
- 新增 `derived-field-probe` fixture，按资产扩展名生成确定性的 `extUpper`。

## PLUGIN-024：实时 search.provider

- `src/plugins/plugin-search.ts` 定义了带 Zod 校验的 search request/chunk/complete/cancel
  合约。请求包含结构化搜索条件、分页、`deadlineAt` 和 `maxResults`；结果必须提供
  provider-owned 的稳定 `sortKey`。
- Standard QuickJS Host 与 Trusted Node Host 增加 `registerSearch({ id, search })`。
  搜索 handler 收到 bounded request 与可取消 signal；数组或 async-iterator 结果都按
  chunk 渐进返回，取消和 deadline 不再继续投递结果。
- 两个 Plugin Runtime Supervisor 对 search request/chunk/complete/cancel 建立 typed
  接缝。Main `PluginProviderScheduler.searchAssets` 与 Worker 原生 `asset.search` 并行，
  provider 只追加可解析的资产 ID；去重、cap 和 native-first 合并均在 Main 完成，provider
  超时/失败只进入 `degradedProviders`，不丢弃原生结果。
- `plugin-manager.search-providers` 是最小 Main IPC/Preload 调用面，可用于自动化探针；
  没有在 Renderer 中按资产执行插件 JavaScript。
- `derived-field-probe` 现在同时注册 `fixed-token`，结构化查询包含 `plugin-probe` 时
  返回两个固定 asset ID，供后续 Electron/Worker acceptance probe 使用。

## 自动化验证

执行：

```text
npx tsc --noEmit
npx vitest run tests/unit/plugin-provider-scheduler.test.ts tests/unit/plugin-activation-coordinator.test.ts tests/unit/plugin-providers.test.ts tests/unit/plugin-standard-host.test.ts tests/worker/plugin-derived-fields.test.ts
```

结果：既有 PLUGIN-023 记录保留；本回合执行 `npx tsc --noEmit` 通过，
`npx vitest run tests/unit/plugin-search.test.ts tests/unit/plugin-provider-scheduler.test.ts tests/unit/plugin-standard-host.test.ts`
通过（3 个文件、14 个测试）。

## 未验证与后续

- 尚未执行真实 Electron、完整进程重启、packaged、Windows 或 Computer Use 验收。
- 尚未将 derived fields 接入完整 Renderer 搜索 UI；当前提供 bounded Worker query API。
- 尚未执行真实 Electron、完整进程重启、packaged、Windows、Computer Use、Worker API
  acceptance probe 或 100k 性能 soak；search IPC 已有协议/调度单测但未声明桌面验收通过。
- 尚未验证 Trusted Host 的真实 Node 插件搜索旅程、背压 soak 和 provider crash recovery。
- 需要产品负责人按 `PLUGIN-023` 进行人工操作验收。

## PLUGIN-025：preview.provider 与 thumbnail.provider broker seam

- `plugin-manifest.ts` 现在要求 `preview` / `thumbnail` provider 声明有界扩展名
  列表；激活协调器把声明复制到 Main provider registry，调度时只选择匹配资产扩展名的
  provider，并按稳定的 `pluginId.providerId` 顺序取一个。
- `plugin-providers.ts` 增加 `PluginProviderMedia`：仅允许 MIME 类型与 base64 字节，
  解码后上限 256 KiB；不传任意路径。Provider batch result 同时支持旧的标量
  `value` 和新的 `media` 分支，derived-field materialization 只接受标量分支。
- `PluginProviderScheduler.resolveMediaProvider()` 通过 Worker 取得 typed asset snapshot，
  对单个资产执行一次带 deadline 的 Host invoke；成功返回有界内联 bytes，未声明扩展、
  缺失 handler、失败、取消或超时返回 `native-fallback`。这是完整媒体管线未来接入的
  Main seam，不改变现有 Worker 原生缩略图/预览生成。
- `plugin-manager.preview-provider` / `plugin-manager.thumbnail-provider` 已加入 Main IPC、
  Preload API 和 renderer-safe response schema，Renderer 只能接收 bounded MIME/base64，
  不接收文件路径。
- 新增 `preview-thumbnail-probe` fixture，为 `.probe` 同时注册 preview 与 thumbnail，
  返回确定性的 1×1 PNG；新增 scheduler 成功/超时 fallback 与 payload cap 单测。

## PLUGIN-025 自动化验证

执行：

```text
npx vitest run tests/unit/plugin-providers.test.ts tests/unit/plugin-provider-scheduler.test.ts tests/unit/plugin-package-ipc.test.ts tests/unit/plugin-contract.test.ts
```

结果：4 个文件、33 个测试通过。`npx tsc --noEmit` 通过（无输出，exit code 0）。

## PLUGIN-025 未验证与后续

- 尚未把 broker 接入 Worker 的完整缩略图/预览 job 或 `asset.preview` / `asset.thumbnail`
  用户旅程；当前只提供明确的 Main API seam。
- 尚未执行真实 Electron、完整进程重启、媒体实际解码、Trusted Host、packaged、Windows、
  Computer Use、背压/crash recovery 或 100k soak。

## PLUGIN-026：metadata.extractor broker seam

- `plugin-manifest.ts` 现在要求 `metadata` provider 声明有界扩展名列表，与 preview/thumbnail
  共用 opt-in 扩展匹配规则。
- `plugin-providers.ts` 增加 `PluginProviderMetadata`：仅允许扁平标量 JSON（string/number/
  boolean/null），序列化后上限 16 KiB，拒绝 `path`/`secret`/`filePath` 等键名与路径样字符串；
  Provider batch result 新增 `metadata` 分支。
- `PluginProviderScheduler.resolveMetadataProvider()` 通过 Worker 取得 typed asset snapshot，
  对单个资产执行一次带 deadline 的 Host invoke；成功返回有界 JSON，未声明扩展、缺失 handler、
  失败、取消或超时返回 `native-fallback`。这是完整元数据管线未来接入的 Main seam，不改变
  Worker 原生 `asset.extracted-metadata.get` 提取。
- `plugin-manager.metadata-provider` 已加入 Main IPC、Preload API 和 renderer-safe response
  schema，Renderer 只能接收 bounded JSON，不接收文件路径。
- 扩展 `preview-thumbnail-probe` fixture，为 `.probe` 同时注册 metadata provider，返回确定性
  `probeKind` / `extensionUpper` / `assetName` 字段；新增 scheduler 成功/超时 fallback 与
  metadata cap/禁 path 单测。

## PLUGIN-026 自动化验证

执行：

```text
npx vitest run tests/unit/plugin-providers.test.ts tests/unit/plugin-provider-scheduler.test.ts tests/unit/plugin-package-ipc.test.ts tests/unit/plugin-contract.test.ts
```

## PLUGIN-026 未验证与后续

- 尚未把 broker 接入 Worker 的完整元数据提取 job 或 Inspector/导入侧用户旅程；当前只提供
  明确的 Main API seam。
- 尚未执行真实 Electron、完整进程重启、Trusted Host、packaged、Windows、Computer Use、
  背压/crash recovery 或 100k soak。

## PLUGIN-027：import.provider broker seam

- `plugin-manifest.ts` 现在要求 `import` provider 声明至少一个扩展名和/或 MIME 类型。
- `plugin-providers.ts` 增加 `PluginProviderImportPlan`：仅允许 `accepted`、`note` 与可选
  合成 `asset` stub，序列化后上限 8 KiB；Provider batch result 新增 `importPlan` 分支。
- `PluginProviderScheduler.resolveImportProvider()` 对候选文件名/MIME 构造 synthetic batch，
  执行一次带 deadline 的 Host invoke；成功返回有界 import plan，未声明扩展/MIME、缺失
  handler、失败、取消或超时返回 `native-fallback`。不绕过 Gateway `file.import`。
- `plugin-manager.import-provider` 已加入 Main IPC、Preload API 和 renderer-safe response
  schema。
- 扩展 `preview-thumbnail-probe` fixture，为 `.probe` / `application/x-serpent-probe` 注册
  import provider，返回确定性 `accepted: true` / `probe-import-accepted` 计划。

## PLUGIN-028：export.provider broker seam

- `plugin-manifest.ts` 现在要求 `export` provider 声明有界扩展名列表。
- `plugin-providers.ts` 增加 `PluginProviderExportDescriptor`：可选 `fileName`、`mimeType`、
  `bytesBase64`（解码后上限 256 KiB）与 `note`；Provider batch result 新增
  `exportDescriptor` 分支。
- `PluginProviderScheduler.resolveExportProvider()` 通过 Worker 取得 typed asset snapshot，
  对单个资产执行一次带 deadline 的 Host invoke；成功返回有界 export descriptor，未声明扩展、
  缺失 handler、失败、取消或超时返回 `native-fallback`。
- `plugin-manager.export-provider` 已加入 Main IPC、Preload API 和 renderer-safe response
  schema。
- 扩展 `preview-thumbnail-probe` fixture，为 `.probe` 注册 export provider，返回确定性
  `probe-export-stub` 与固定 1×1 PNG bytes。

## PLUGIN-029：ai.provider broker seam

- `plugin-manifest.ts` 现在要求 `ai` provider 声明有界扩展名列表。
- `plugin-providers.ts` 增加 `PluginProviderAiAnalysis`：`description`（≤4 KiB）、`tags`
  （≤32 项）与可选 `rating`（1–5）；Provider batch result 新增 `analysis` 分支。
- `PluginProviderScheduler.resolveAiProvider()` 通过 Worker 取得 typed asset snapshot，
  对单个资产执行一次带 deadline 的 Host invoke；成功返回有界 analysis stub，未声明扩展、
  缺失 handler、失败、取消或超时返回 `native-fallback`。不调用外部网络。
- `plugin-manager.ai-provider` 已加入 Main IPC、Preload API 和 renderer-safe response
  schema。
- 扩展 `preview-thumbnail-probe` fixture，为 `.probe` 注册 ai provider，返回确定性
  `description` / `tags` / `rating: 4` 分析结果。

## PLUGIN-027/028/029 自动化验证

执行：

```text
npx tsc --noEmit
npx vitest run tests/unit/plugin-providers.test.ts tests/unit/plugin-provider-scheduler.test.ts tests/unit/plugin-package-ipc.test.ts
```

## PLUGIN-027/028/029 未验证与后续

- 尚未把 broker 接入 Gateway `file.import`、导出 job 或 `ai.enqueue` 用户旅程；当前只提供
  明确的 Main API seam。
- 尚未执行真实 Electron、完整进程重启、Trusted Host、packaged、Windows、Computer Use、
  背压/crash recovery 或 100k soak。

## PLUGIN-030：媒体 Provider 接入 artifact 管线

- Worker 新增 `plugin-media-provider.request/response` 内部回调协议。Provider Host 调用仍
  只在 Main `PluginProviderScheduler` 执行；Worker 不加载插件 JavaScript，也不把路径发送给
  插件或 Renderer。
- Worker 的自动 thumbnail queue、`media.generate-thumbnail` 和
  `media.get-preview-artifact` 均先请求匹配扩展名的 `thumbnail`/`preview` provider。返回
  `provided` 时，Worker 将有界 MIME/base64 解码后写入现有 `.serpent/artifacts` 和
  `revision_artifacts` 的 `thumbnail` 行；旧当前 artifact 先失效，Renderer 继续使用已有
  `serpent://preview/<libraryId>/<artifactId>` 协议。`native-fallback`、超时、异常或写入
  失败均继续既有原生生成路径。
- 对原生不支持的扩展，plugin artifact 的 MIME 若为图像则以 `mediaType: image` 返回预览；
  对普通原生图片，plugin artifact 的 `generator_version` 标记使其可以覆盖“原图优先”分支。
- 由于视频/音频预览依赖 `webm_proxy` / `audio_proxy`，本增量没有把任意 plugin bytes
  伪装成播放代理；这些 provider 类型仍保留为后续扩展范围。

### PLUGIN-030 自动化验证

执行：

```text
npx tsc --noEmit
npx vitest run tests/unit/plugin-provider-scheduler.test.ts tests/worker/thumbnails.test.ts
```

结果：`npx tsc --noEmit` 通过；`npx vitest run tests/unit/plugin-provider-scheduler.test.ts`
通过（1 个文件、12 个测试）。`tests/worker/thumbnails.test.ts` 已执行但被本机
`better-sqlite3.node` ABI 不匹配阻断（模块为 NODE_MODULE_VERSION 148，当前 Node 要求
137），因此该文件 41 tests 未形成有效结果；未执行全量测试、Electron E2E、packaged、
Windows 或 Computer Use。

### PLUGIN-030 未验证与后续

- 尚未执行真实 Electron 媒体解码、完整进程重启、Trusted Host、packaged、Windows、
  Computer Use、背压/crash recovery 或 100k soak。
- 当前 provider artifact 使用现有 `thumbnail` kind；视频/音频 `webm_proxy` /
  `audio_proxy` 持久化仍走原生生成。
- 需要产品负责人按 `PLUGIN-030` 验收 `.probe` 的缩略图、预览和 native fallback。
