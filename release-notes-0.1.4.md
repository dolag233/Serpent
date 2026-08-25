**Serpent 0.1.4** — 更快、更稳的媒体浏览与查看 · Faster, more reliable media browsing and viewing

## 新增功能 / New features

- **序列帧导入**：导入时可自动检测序列帧，并在导入窗口调整帧范围、FPS，以及按单帧或序列导入。

  **Image-sequence import**: Automatically detect image sequences during import, adjust the frame range and FPS, and choose between importing individual frames or a sequence.

- **更多图像格式支持**：新增 AVIF 支持；RAW/ARW、TIFF、TGA、PSD、EXR、ICO 等格式改进缩略图、元数据和查看体验；ICO 会优先使用最大尺寸图层。

  **Broader image-format support**: Added AVIF support and improved thumbnails, metadata, and viewing for RAW/ARW, TIFF, TGA, PSD, EXR, ICO, and related formats. ICO previews prefer the largest available image layer.

- **MCP Agent 连接交接**：设置中可复制包含授权信息的连接文本，直接粘贴给可信 Agent 即可连接 Serpent。

  **MCP Agent handoff**: Copy an authorized connection snippet from Settings and paste it directly into a trusted Agent to connect to Serpent.

- **更完整的格式过滤**：网页、文档及其他常见格式现在可以在格式过滤面板中找到并筛选。

  **More complete format filters**: Web, document, and other common formats are now available in the format filter panel.

## 性能与可靠性 / Performance and reliability

- **大型资源库与 NAS 浏览优化**：优化打开资源库、切换文件夹/合集、搜索、递归浏览和可见区域缩略图调度，减少后台任务对交互和查看器的影响。

  **Large-library and NAS improvements**: Opening libraries, switching folders and collections, searching, recursive browsing, and visible thumbnail scheduling are more responsive, with less background-work contention during interaction and viewing.

- **媒体任务资源保护**：为 Sharp、FFmpeg、OpenImageIO 等解码路径增加统一资源预算、退避重试和资源压力提示，避免高负载下任务互相争抢或无限重试。

  **Media-task resource protection**: Added shared resource budgets, backoff retries, and clear resource-pressure handling for Sharp, FFmpeg, and OpenImageIO paths to prevent contention and retry loops under load.

- **缩略图与查看器加载改进**：忽略的文件会在任务入队前排除；预览优先于低优先级派生任务；非原生浏览器格式可使用全分辨率源图查看；大型 TIFF 会绕过容易被异常元数据触发的解码路径。

  **Thumbnail and viewer improvements**: Ignored files are filtered before queueing; previews take priority over low-priority derivatives; formats not natively rendered by the browser can use full-resolution source decoding; large TIFF files avoid decoder paths that can be tripped by oversized metadata.

## 修复 / Fixes

- 修复 RAW/ARW Inspector 元数据显示、换行和对齐问题。
- 修复分辨率等卡片信息在不同显示开关组合下消失的问题。
- 修复图片查看器等待技术元数据、预览与原图切换不稳定等问题。
- 修复文件夹和资产 inline 重命名、系统资源管理器拖拽导入、原生拖拽预览比例等交互问题。
- 修复启动、关闭、后台媒体任务和资源库切换过程中的若干稳定性问题。

  - Fixed RAW/ARW Inspector metadata layout, wrapping, and alignment.
  - Fixed resolution and other card details disappearing under certain display-option combinations.
  - Fixed image-viewer delays while waiting for technical metadata and unstable preview/source transitions.
  - Fixed several folder and asset inline-rename, Explorer drag-and-drop import, and native drag-preview issues.
  - Fixed a range of stability issues around startup, shutdown, background media tasks, and library switching.

## 已知限制 / Known limitations

- NAS/SMB 资源库仍处于实验性支持阶段；文件锁和断线恢复取决于共享盘，同一资源库仍建议只保留一个写入实例。

  NAS/SMB libraries remain experimental. Locking and reconnect behavior depend on the share, and a single writing instance per library is still recommended.

- Windows packaged 应用、真实 NAS 和部分大型媒体格式矩阵仍需要持续进行平台验收。

  Windows packaged builds, real NAS environments, and parts of the large-media format matrix still require continued platform validation.
