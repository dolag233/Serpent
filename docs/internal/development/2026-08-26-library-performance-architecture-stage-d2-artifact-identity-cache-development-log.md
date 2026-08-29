# 2026-08-26 大型资源库性能架构阶段 D.2 开发日志：artifact identity、局部失效与缓存观测

关联架构：[`0032-library-performance-architecture.md`](../implementation/0032-library-performance-architecture.md)

本阶段完成阶段 D.2。目标不是把缓存做成第二个数据源，而是让 Worker/SQLite 的
artifact descriptor 读取拥有可证明的身份、失效边界和命中观测；同时让 Main 的
PreviewCache 能回答“是否命中、复制了多少字节、淘汰了多少字节”。阶段 C 浏览会话与
虚拟化、阶段 E watcher/文件操作仍未完成。

## 根因

阶段 D.1 已经统一了 artifact role 和策略层 `artifactKey`，但数据库仍只有
`revision_id + kind` 的当前唯一边界。这样会把不同生成器、设置和 viewer/card 角色
混在同一个逻辑槽位里，生成器升级时只能依赖分散的重试路径。另一个问题是
`getCurrentArtifact` 每次都重新做相同的小 SQL 读取，既没有 ready/failed descriptor
的命中指标，也没有在跨进程写入后立刻结束本地缓存的旧窗口。Main 的本地预览镜像也
只有实际淘汰逻辑，没有 hit/miss/store/eviction 的固定计数。

## 实现与追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 持久化 artifact role、generator、settings 与稳定 identity | `src/worker/library-service.ts` v44 migration；`src/worker/artifact-policy.ts` 的 `artifactIdentityForPersistedRow` | `tests/unit/artifact-policy.test.ts`；`tests/worker/migration-discipline.test.ts`；`tests/worker/migration-checksum-snapshot.test.ts`；`tests/worker/thumbnails.test.ts` schema/assertion | macOS arm64 Worker 与旧库迁移回归通过；Windows、NAS/SMB、packaged 未验证 |
| 生成器变更只局部失效当前选中资产的 primary artifact | `LibraryService.primaryArtifactGeneratorIsCurrent`、`invalidateStalePrimaryArtifacts`、`enqueueThumbnailJobs` | `tests/worker/thumbnails.test.ts` 覆盖旧 generator 的 ready row 被失效并重新入队 | 本地 Worker 证据通过；真实大库和跨平台文件占用未验证 |
| ready/failed descriptor 受 change sequence fence 保护并按库关闭失效 | `src/worker/artifact-descriptor-cache.ts`、`LibraryService.getCurrentArtifact`、`LibraryWriteCoordinator.refresh` | cache 单测；`thumbnails.test.ts` 覆盖 ready→failed 变更后的 miss/hit/store/invalidation 计数 | 通过独立 Worker/SQLite 连接变更 sequence 的本地证据；真实多进程 NAS 未验证 |
| Main PreviewCache 固定记录命中、未命中、存储、错误、淘汰及字节量 | `src/main/preview-cache.ts` | `tests/unit/preview-cache.test.ts` | 当前仅 macOS 开发态单测；未把本地镜像指标冒充为跨平台性能证据 |

## 设计细节

- v44 为 `revision_artifacts` 增加 `artifact_role`、`generator_id`、`settings_hash`、
  `artifact_key`。迁移会为旧行回填身份，并通过 AFTER INSERT trigger 兼容仍使用旧列
  列表的历史写入点；旧插件迁移历史也会补齐 v44 结构。`settings_hash` 在本实现中是
  generator 声明里的稳定设置 token，不宣称为密码学 hash；最终 identity 使用长度前缀
  拼接，避免分隔符碰撞。
- 当前唯一索引改为 `(revision_id, artifact_key)`，仅约束未失效且已有 key 的行；这让
  card thumbnail、viewer image、poster、proxy 和不同 generator/settings 可以共存，
  同时保留 `revision_artifacts_identity_idx` 供定向读取。`getCurrentArtifact` 会按
  generator version 精确过滤，不把旧 failed/ready row 当作新生成结果。
- Worker descriptor cache 的 key 为
  `libraryId + assetId + revisionId + kind + expectedGeneratorVersion`，值包括身份、
  状态、路径和尺寸等小描述符，不缓存媒体字节。每个值带读取时的 durable
  `changeSequence`；同步 `refresh()` 先读 sequence，再允许查询命中，因此跨进程提交
  不需要等待 250ms 轮询窗口。关闭库只清理对应 `libraryId`，不会冲掉其他库的缓存。
- 局部 stale repair 只接收显式 asset ID，不在可见卡片请求里扫描整库。插件 artifact
  保持插件版本语义；视频 poster、音频 waveform、OIIO/raw/ICO、文档和模型分别按现有
  generator family 判断，避免用一个 `sharp@...` 规则误伤其他格式。
- PreviewCache 的指标是诊断计数，不改变授权路径；缓存仍只存 Main 本地镜像，Renderer
  不获得绝对路径。`bytesStored`/`bytesEvicted` 记录实际镜像和淘汰字节，不把它们写成
  源文件解码内存峰值。

## 验证记录

- `npm run rebuild:native`：完成，better-sqlite3 Electron probe 与 FTS5 可用。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/artifact-policy.test.ts tests/unit/artifact-descriptor-cache.test.ts tests/unit/preview-cache.test.ts tests/worker/migration-discipline.test.ts tests/worker/migration-checksum-snapshot.test.ts tests/worker/thumbnails.test.ts`：6 files / 89 tests passed（迁移、策略和 D.2 主路径）。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/thumbnails.test.ts tests/unit/artifact-descriptor-cache.test.ts tests/unit/preview-cache.test.ts`：3 files / 75 tests passed；包含 ready/failed descriptor 的 Worker 闭环测试。
- `npm run test:library-availability`：9 files / 201 tests passed。
- `npm run test:worker`：83 files passed、13 skipped；1,213 tests passed、20 skipped。
- `npm run typecheck`：通过。
- 改动文件 ESLint：通过；`git diff --check`：通过。
- `node scripts/run-e2e.mjs tests/e2e/document-preview.test.ts tests/e2e/media-preview.test.ts tests/e2e/media-video-playback.test.ts`：7 passed / 1 skipped；真实 PDF、HTML、图片自然尺寸解码、视频源/代理播放路径通过。跳过项是已有的完整进程重启后历史视频修复路径。
- `npm run test:unit`：386 files passed、1 skipped；2,864 tests passed、2 skipped，另有 4 个既有环境失败：`library-parent` 两项 macOS `/private` 路径断言、随附 FFmpeg 缺少 `lavfi` 输入格式、`media-binaries` 测试夹具中的 7-byte packaged `better_sqlite3.node` 门禁。它们没有触及 D.2 路径，不能把本次全量单元套件写成全绿。
- 没有把上述本地证据写成 20k/100k、真实 NAS/SMB、Windows、packaged 或 Computer Use 性能通过；阶段 A 记录的 10k 代理基线和阶段架构要求的 20k 独立性能基线仍需后续验证。

## 下一步

阶段 D.2 已完成，阶段 D 的 artifact policy、admission、持久身份、局部失效与缓存
观测链路已具备。按 0032 的实施顺序，下一模块是阶段 C：`BrowseSession` 稳定快照、
窗口摘要、几何块与侧栏渐进 hydration。该阶段完成前，0032 总体和 `Serpent-3kfe`
Epic 不能标记完成。
