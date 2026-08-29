**Serpent 0.1.5** — 大型资源库浏览更顺滑、链接文件夹与合集更可靠 · Smoother large-library browsing and more reliable linked folders and collections

## 新增功能 / New features

- **大型资源库浏览性能架构**：虚拟化平铺/瀑布流、浏览会话与几何块、可见区域缩略图调度、远程资源库元数据本地快照缓存，以及查看器单源解码与产物策略，显著改善 2 万+ 资源库打开、滚动、切换文件夹/合集与搜索时的响应。

  **Large-library browsing architecture**: Virtualized tiled and masonry layouts, browse sessions and geometry blocks, visible-window thumbnail scheduling, remote-library metadata snapshot caching, and viewer single-source decoding with artifact policy improve responsiveness when opening, scrolling, switching folders/collections, and searching libraries with 20k+ assets.

- **链接文件夹增强**：支持在链接目录内识别外部移动并保留资产身份；源文件已不存在时可清除残留索引；删除失败提示可通过 hover 查看完整原因。

  **Linked-folder improvements**: Recognize external moves inside linked directories while preserving asset identity; clear stale index entries when source files are gone; hover partial-delete notices for full diagnostics.

- **合集层级**：父合集重命名不再丢失子合集；资产可正确拖入子合集并保持成员关系。

  **Collection hierarchy**: Renaming a parent collection no longer drops child collections; assets can be dropped into subcollections with membership preserved.

- **设置与体验**：新增任务完成提示音开关；AI 设置分类更名为「AI 分析」；「关于」窗口可查看日志；支持 JFIF 图像资产。

  **Settings and UX**: Optional task-completion sound; AI settings renamed to “AI analysis”; view logs from About; JFIF image asset support.

## 性能与可靠性 / Performance and reliability

- **导入与外部库**：Eagle/Billfish 外部缩略图 copy-first 与后台 512 归一化；外部库解压前磁盘空间预检与临时目录清理；删除资源库后释放媒体读取拦住，修复同 ZIP 重导入卡片损坏。

  **Import and external libraries**: Copy-first external thumbnails with background 512px normalization; disk-space precheck and temp-dir cleanup for external archives; release media-read fences after library deletion so re-importing the same ZIP no longer breaks cards.

- **媒体任务与查看器**：统一媒体内存预算与可见波次调度；视频全屏控件闲置自动隐藏；拖动进度条后 Space 优先播放/暂停；查看器缩放范围统一为 0.05–8×；FBX 缩略图与失败诊断改进。

  **Media tasks and viewer**: Unified media memory budgets and visible-wave scheduling; auto-hide fullscreen video chrome; Space toggles playback after scrubbing the progress bar; viewer zoom unified to 0.05–8×; improved FBX thumbnails and failure diagnostics.

## 修复 / Fixes

- 修复平铺模式大库滚动时视口顶部缩略图不加载、越往下缺失越多的问题。
- 修复导入后文件夹树不刷新、删除资源库缺少延迟进度反馈、合集/链接文件夹若干交互回归。
- 修复模态面板遮挡窗口控制按钮、原生拖拽预览比例、AI OpenAI 兼容响应解析等问题。
- 优化若干 UI 细节与稳定性问题。

  - Fixed tiled-view thumbnails failing to load at the top of the viewport in large libraries, worsening with scroll depth.
  - Fixed folder tree not refreshing after import, missing delayed progress when deleting libraries, and several collection/linked-folder interaction regressions.
  - Fixed modal panels blocking window controls, native drag-preview aspect ratio, and OpenAI-compatible AI response parsing.
  - Various UI polish and stability fixes.

## 已知限制 / Known limitations

- NAS/SMB 资源库、Windows packaged 与部分大型库性能门禁仍需要持续平台验收。

  NAS/SMB libraries, Windows packaged builds, and parts of the large-library performance gates still require continued platform validation.
