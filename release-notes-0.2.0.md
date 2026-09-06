**Serpent 0.2.0** — 官方插件社区、批量转换压缩，以及导入删除进度 · Official plugin community, batch convert/compress, and import/delete progress

## 新增功能 / New features

- **官方插件社区**：设置 → 插件即可浏览并安装官方与已认证插件。安装钉死 GitHub Release ZIP 与 sha256，不走 zipball；点卡片可看作者、版本、仓库与中英文 README。

  **Official plugin community**: Browse and install official and certified plugins from Settings → Plugins. Installs pin a GitHub Release ZIP plus sha256 (no zipball). Opening a card shows author, version, repository, and localized README.

- **插件平台**：宿主标准对话框、FFmpeg 路径接口、写回计划错误码与改扩展名转码，方便无限制插件批量处理媒体。首发一方插件「媒体转换器」支持视频转码与图片/视频压缩（体积与分辨率可并列约束）。

  **Plugin platform**: Host widget dialogs, FFmpeg binary paths, write-back plan errors, and rename-on-transcode so unrestricted plugins can batch-process media. First-party Media Converter supports video transcode and image/video compression, including parallel size and resolution constraints.

- **导入与删除进度**：导入显示真实复制进度并可取消；批量移到回收站、永久删除和从硬盘删除共用同一套进度对话框，从硬盘删除也可中途取消。内容去重改为优先用指纹查询，大库导入在复制完成后不再长时间卡住。

  **Import and delete progress**: Imports show real copy progress and can be cancelled. Bulk trash, permanent delete, and delete-from-disk share the same progress dialog; disk delete can be cancelled mid-run. Duplicate detection prefers stored fingerprints so large-library imports no longer stall long after copy finishes.

- **整理与浏览**：侧栏文件夹可按字母、时间或数量排序；纯文件夹卡片用四宫格展示子文件夹预览；搜索可返回文件夹结果；工作区界面跳转进入浏览历史。

  **Organization and browsing**: Sidebar folders sort by name, date, or count; empty folder cards show a 2×2 collage of child previews; search can return folders; workspace views push onto navigation history.

- **教学提示**：首次使用时提示链接文件夹、展开子文件夹等功能。

  **Teaching hints**: First-run cues for linked folders, expanding subfolders, and similar features.

- **链接文件夹**：保存、移动、复制、拖拽和恢复定位时与托管文件夹同等对待，不再强制复制。

  **Linked folders**: Save, move, copy, drag, and restore-locate now treat linked folders like managed folders, without forcing a copy.

- **应用外观**：四档界面字体大小；侧栏文件夹展开/收起图标对齐；查看器去掉多余关闭按钮。

  **Appearance**: Four UI font-size tiers; sidebar folder expand/collapse icons aligned; redundant viewer close control removed.

- **启动体验**：启动后自动打开上次使用的资源库。

  **Startup**: Reopens the last-used library on launch.

## 性能与可靠性 / Performance and reliability

- 取消 Worker 对本地资源操作的请求限时，长时间导入、扫描和预览不再被掐断；同时取消资产内容读写的 32 MiB 策略上限，大文件可由插件分块读写。
- 收口媒体超时与主题过滤；导航后退与首次打开更稳。

  Removed Worker request time limits on local library work so long imports, scans, and previews are no longer cut off; also lifted the 32 MiB content read/write policy cap so plugins can stage large files in chunks. Media timeouts and theme filtering are tightened; navigation back and first-open restore are more reliable.

## 修复 / Fixes

- 优化资源库忽略规则：托管与链接位置共用 Git 风格语法并持久化，保存后立即作用于浏览、搜索和扫描。
- 修复 Windows 粘贴图片、插件写回与对话框等问题。
- 优化若干 UI 细节与稳定性问题。

  - Improved library ignore rules: Git-style patterns persist for managed and linked locations and apply immediately to browse, search, and scan.
  - Fixed Windows image paste, plugin write-back, and dialog issues.
  - Various UI polish and stability fixes.
