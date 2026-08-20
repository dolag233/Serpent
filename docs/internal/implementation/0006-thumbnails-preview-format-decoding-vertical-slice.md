# 第0006垂直切片：缩略图、预览与格式解码

> 状态：修复中（binary 随包与完整视频预览 UI 未完成）
> 日期：2026-07-13

## 目标

让用户在所有资产卡片上立即看到缩略图，对可解析媒体进行资产查看、显式全屏查看和外部打开，并为视频和复杂格式提供稳定解码路径。缩略图与预览作为 revision 衍生物缓存，不覆盖原文件；解码失败不阻止资产入库。首发格式：PNG、JPG/JPEG、GIF、MP4、MOV、AVI、WMV、EXR、TGA、TIFF。

## 用户主线

1. 导入或浏览资产时，网格中的每项资产卡片立即显示占位，随后渐进替换为缩略图。
2. 鼠标悬停资产卡片时看到放大缩略图；GIF 和可播放视频在放大状态下自动播放（原型验证后确认最终交互）。
3. 双击、Space 或 Enter 进入中央资产查看页面；按 Esc 或“返回”回到来源资产浏览。显式全屏是查看页面内的独立动作。
4. 右键"使用外部应用打开"，调用系统默认或用户指定的软件处理源文件。
5. 视频在资产查看页面和显式全屏中直接播放；仅当原视频实际播放失败时才自动生成 H.264/AAC MP4 代理后播放。GIF 不生成代理。
6. EXR 和 TGA 资产显示经过色彩管理和曝光补偿的常规预览；通道/多 part 专业结构检查推迟。
7. 缩略图、封面、联系表和 H.264/AAC MP4 代理在后台渐进生成；失败时资产保留通用图标，允许重试。

## 范围

### 包含

- schema v5→v6 migration runner：保留 migration checksum 审计。
- `revision_artifacts` 表：缓存缩略图、视频封面、联系表、视频代理、提取元信息与自动色卡。
- `jobs` 表：持久化后台衍生物生成任务，支持排队、暂停、继续、取消、重试和崩溃恢复。
- sharp 图片解码：PNG/JPEG/GIF/普通 TIFF 的元信息提取与缩略图生成；EXIF 方向校正、等比缩放、sRGB 输出。
- OIIO `oiiotool` CLI 子进程：EXR/TGA/复杂 TIFF 解码，OCIO display transform，曝光补偿；默认使用 `ocio://cg-config-v4.0.0_aces-v2.0_ocio-v2.5` 内置 config。
- FFmpeg `ffprobe` 探测：container、codec、duration、宽高、帧率、旋转、色度信息、字幕流。
- FFmpeg 视频封面：优先内嵌 cover，否则 `thumbnail` 过滤器统计选帧；跳过片头黑场。
- FFmpeg 视频联系表：等间隔抽帧 + `scale` + `drawtext` 时间编号 + `tile` 拼图，供 AI 切片 0009 使用。
- FFmpeg H.264/AAC MP4 代理：限制长边、码率和短 GOP；原视频实际播放失败后才转代理再交给 `<video>`。GIF 不进入该队列。
- Chromium 运行时能力缓存：`canPlayType` + 真实加载测试，按平台/架构缓存结果；可直放时跳过代理。
- 渐进加载：Renderer 资产网格先渲染占位，收到 `asset.thumbnail.ready` 事件后替换；启动 3 秒内可交互。
- `assetSummarySchema` 扩展：`thumbnailStatus`、`mediaType`、`durationMs?`、`width?`、`height?`。
- 资产查看页面/显式全屏的语义 IPC 请求；Renderer 不接收绝对路径或 FFmpeg/OIIO 参数。
- 缩略图与预览失败时显示具体原因和重试入口；完整错误链写入持久应用日志。
- 单元、Worker 集成与 Electron 用户流测试。

### 不包含

- 悬停放大卡片的最终交互（需独立原型验证；若验证不通过，MVP 退回普通卡片和显式预览入口）。
- 音频波形生成和悬停播放（后续格式扩展）。
- 3D 模型预览（MVP 后）。
- 资产查看页面的最终控件、缩放灵敏度、平移手势与范围切换 UX 由切片 0013 收口；本切片只保证媒体正确、安全地可查看。
- EXR 完整通道检查器、多 part 浏览、专业色彩空间手动覆盖 UI；MVP 仅默认首个可视 RGB/RGBA part + OCIO 内置 config，色彩空间不确定时假设 scene_linear 并显式标注。
- AI 自动分类、标签建议和视频内容分析（切片 0009）。
- 色卡手动编辑 UI（本切片仅自动提取与缓存；编辑 UI 见切片 0004）。
- 外部应用"打开方式"的多候选菜单（仅右键单入口）。
- 插件格式扩展点。
- PureRef 式白板。

## schema v6

```text
-- v5: schema_version = 4 (current)
-- v6: 新增 revision_artifacts + jobs

revision_artifacts
  artifact_id TEXT PK
  revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE CASCADE
  kind TEXT NOT NULL CHECK (
    kind IN (
      'thumbnail', 'video_poster', 'contact_sheet',
      'webm_proxy', 'extracted_metadata', 'extracted_palette'
    )
  )
  mime_type TEXT NOT NULL            -- e.g. 'image/webp', 'video/mp4', 'application/json'
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0)
  file_path TEXT NOT NULL            -- relative to .serpent/artifacts/<artifact_id>.<ext>
  width INTEGER                      -- px, nullable for non-image artifacts
  height INTEGER                     -- px, nullable for non-image artifacts
  generator_version TEXT NOT NULL    -- e.g. 'sharp@0.34.0', 'ffmpeg@n7.1', 'oiio@3.1.11'
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'generating', 'ready', 'failed')
  )
  error_code TEXT                    -- NULL unless status = 'failed'
  generated_at TEXT                  -- ISO 8601, NULL until status = 'ready'
  invalidated_at TEXT                -- set when superseded; NULL for current

CREATE UNIQUE INDEX revision_artifacts_current
  ON revision_artifacts(revision_id, kind)
  WHERE invalidated_at IS NULL;

jobs
  job_id TEXT PK
  library_id TEXT NOT NULL
  asset_id TEXT REFERENCES assets(asset_id) ON DELETE CASCADE
  revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL
  kind TEXT NOT NULL CHECK (
    kind IN (
      'generate_thumbnail', 'generate_video_poster',
      'generate_contact_sheet', 'generate_webm_proxy',
      'extract_metadata', 'extract_palette'
    )
  )
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')
  )
  priority INTEGER NOT NULL DEFAULT 0
  progress REAL DEFAULT 0.0
  attempt_count INTEGER NOT NULL DEFAULT 0
  error_code TEXT
  error_detail TEXT
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL

CREATE INDEX jobs_library_status_priority
  ON jobs(library_id, status, priority DESC, created_at);
```

不变量：

- `revision_artifacts.file_path` 始终相对 `.serpent/artifacts/`，使用 `/` 规范分隔；实际路径由 Worker 安全解析。
- 每个 `(revision_id, kind)` 组合最多一条 `invalidated_at IS NULL` 的记录（唯一索引保证）。
- 内容变化产生新 revision 后，旧 revision 的所有 artifact 标记 `invalidated_at`，不立即删除（清理策略见回收站切片 0007）。
- `jobs.library_id` 冗余以支持跨库任务列表查询，实际执行时通过 `asset_id` 定位资源库。
- 应用异常退出后，`status = 'running'` 的 job 在下次打开资源库时恢复为 `queued`，`attempt_count` 不变。
- `extracted_metadata` artifact 的 `file_path` 指向 JSON 文件，内容结构化存储宽高、duration、codec、色彩空间等；不写入 asset 或 revision 主表冗余列。
- `extracted_palette` 的 `file_path` 指向 JSON 文件，存储算法提取的代表色数组（hex + 比例）；用户编辑后的色卡另存于 `AssetMetadata.palette`（切片 0004）。
- 缩略图默认输出 WebP（质量 80，长边 512px），视频封面 JPEG（质量 85，长边 640px），联系表 JPEG（质量 85），H.264/AAC MP4 代理（长边 720px，GOP ≤ 60 帧）。

## 协议

Renderer 只发语义请求：

```text
RequestThumbnail { libraryId, assetId }
RequestPreview { libraryId, assetId, mode = 'client' | 'fullscreen' }
RequestClosePreview { libraryId, assetId }
RequestOpenExternal { libraryId, assetId }
RequestRetryArtifact { libraryId, assetId, kind }
CancelArtifactJob { libraryId, assetId, kind }
ListAssetJobs { libraryId }
```

Main 转发给 Worker，Worker 在执行时通过 IPC 推送事件：

```text
asset.thumbnail.ready   { libraryId, assetId, artifactId }
asset.thumbnail.failed  { libraryId, assetId, errorCode, reason }
asset.proxy.ready       { libraryId, assetId, artifactId }
asset.proxy.failed      { libraryId, assetId, errorCode, reason }
asset.metadata.extracted { libraryId, assetId }
job.progress            { libraryId, jobId, kind, status, progress }
```

Worker 内部命令（不暴露给 Renderer）：

```text
media.probe            { libraryId, assetId, revisionId }
media.generate         { libraryId, assetId, revisionId, kind }
media.cancel           { libraryId, jobId }
```

恢复与调度策略：

- 打开资源库后，Worker 扫描所有 `status = 'running'` 的 job 并重置为 `queued`。
- 排队所有缺少当前 `ready` artifact（`invalidated_at IS NULL`）的 revision。
- 对当前 revision 中明确标记为 `FFMPEG_REQUIRED` / `OIIO_REQUIRED` 的失败
  预览，先探测对应组件；组件恢复后自动重置并重新排队。损坏文件、格式
  不支持和其他解码失败不自动循环重试；每个资源库会话每个组件只触发一轮
  自动修复；组件探测失败在本会话内短暂负缓存，避免每个可见区请求同步
  启动外部进程。
- 优先级：缩略图优先（用户可见），其次视频封面，再次元信息提取，最后联系表和 H.264/AAC MP4 代理。`webm_proxy` 是为兼容既有 schema 保留的历史任务名。
- 并发限制：sharp 队列最多 2 并发；FFmpeg/OIIO 子进程最多 1 并发（各子进程内流控）。

预览 URL 策略：

- Renderer 请求预览时，Worker 返回受控的 `serpent://` 协议 URL，格式 `serpent://preview/<libraryId>/<artifactId>`。
- Main 注册 `serpent://` 自定义协议处理器，读取 Worker 授权后的缓存文件并返回字节。
- 视频代理同策略，`serpent://proxy/<libraryId>/<artifactId>`。
- Renderer 永不感知 `.serpent/artifacts/` 磁盘路径。

外部打开：

- `RequestOpenExternal` 触发时，Main 通过 `shell.openPath()` 用系统关联打开原文件。
- 不提供"打开方式"多候选菜单（推迟），仅单入口。

## 测试接缝

- schema v4→v6 migration、重复打开幂等、migration 事务回滚与 checksum 篡改。
- sharp 缩略图生成：PNG/JPEG/GIF/TIFF 元信息提取，EXIF 方向校正，超大/损坏输入拒绝，尺寸溢出保护，并发限制。
- OIIO `oiiotool` 子进程：EXR 解码 + sRGB display transform、TGA 解码、OCIO 内置 config 可用性、超时/取消/KILL 传播、损坏文件退出码非零。
- FFmpeg `ffprobe` 探测：MP4/MOV/AVI/WMV JSON 输出解析，旋转 side_data、VFR 检测、无音轨/多音轨。
- FFmpeg 视频封面：内嵌 cover 优先、`thumbnail` 统计选帧、跳过片头百分比、无封面时的 fallback 策略。
- FFmpeg 联系表：`fps` + `scale` + `drawtext` + `tile` 管道输出，时间戳正确性，网格行列计算。
- FFmpeg 视频代理：H.264/AAC MP4 编码、分辨率/码率限制、短 GOP seek、取消/KILL 清理临时文件、输出大小上限拦截；无可用 H.264 编码器时记录失败，不回退 VP9。
- Chromium 能力缓存：`canPlayType` + 真实加载测试，平台/架构差异记录，直放失败自动切换代理。
- 渐进加载：资产网格先占位后替换，`asset.thumbnail.ready` 事件传播，滚动虚拟列表不泄漏。
- 预览 IPC：`serpent://` 协议 handler，Renderer 不接触绝对路径，MIME type 正确返回。
- 外部打开：`shell.openPath()` 被阻止时返回安全错误。
- 任务生命周期：排队→运行→完成、暂停/继续/取消/重试、崩溃恢复、并发限制、优先级调度。
- 媒体环境恢复：缺少 FFmpeg/OIIO 时产生的失败 artifact 在组件恢复并重新
  打开/触发调度后自动重排队；非组件失败保持终态。
- artifact 失效：内容变化 → 生成新 revision → 旧 artifact 标记 `invalidated_at`，新 revision 排队新衍生物。
- 错误可观测性：Renderer 接收安全的错误码与原因文本；应用日志保留系统错误码、stderr 摘要、退出码和 cause 链。
- Electron 用户流：导入各格式后缩略图渐进显示、视频资产查看/显式全屏播放、H.264/AAC MP4 代理降级、GIF 原生预览、EXR 预览 + 曝光 slider、外部打开、取消重试。

## 完成标准

- 全部自动化门禁通过；macOS 打包全部首发格式预览冒烟有明确结果，Windows 保留为显式未验证项。
- 所有支持格式的资产在导入后 10 秒内出现缩略图（10 万资产库中后台渐进，首屏 50 项 3 秒内替换完成）。
- 视频原文件播放失败时自动生成 H.264/AAC MP4 代理并播放；GIF 始终使用原生图片预览，无代理任务。数据库中的 `webm_proxy` kind/job 名称仅为兼容旧数据。
- EXR/TGA 显示经过色彩管理和曝光补偿的可识别预览，不确定色彩空间时显式标注。
- 缩略图或预览失败时资产保留通用图标，不阻止入库、不影响其他资产，可手动重试。
- 内容变化后旧衍生物失效，新衍生物再生。
- 不存在向 Renderer 泄露绝对路径、二进制路径或 FFmpeg/OIIO 命令行参数的 IPC 消息。
- 开发日志、双轴审查与 QA 报告完整。
