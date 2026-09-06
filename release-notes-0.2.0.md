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

- **应用体验**：四档界面字体大小；Windows 粘贴图片恢复可用；启动后自动打开上次资源库；查看器去掉多余关闭按钮；链接文件夹在保存/移动/复制/拖拽中与托管文件夹平权。

  **App experience**: Four UI font-size tiers; Windows image paste restored; last-used library reopens on launch; redundant viewer close control removed; linked folders share save/move/copy/drag behavior with managed folders.

## 性能与可靠性 / Performance and reliability

- 取消资产内容读写的 32 MiB 策略上限，大文件可由插件分块读写。
- 过滤、忽略规则与发现工具栏继续收口；导航后退与首次打开体验更稳。

  Lifted the 32 MiB content read/write policy cap so plugins can stage large files in chunks. Filter, ignore-rule, and discovery-toolbar polish; more reliable navigation back and first-open restore.

## 修复 / Fixes

- 修复若干插件写回、对话框、粘贴图片与文件夹交互问题。
- 优化若干 UI 细节与稳定性问题。

  - Fixed several plugin write-back, dialog, image-paste, and folder-interaction issues.
  - Various UI polish and stability fixes.

## 已知限制 / Known limitations

- 本版本 Windows 安装包与便携版在发布当时构建；macOS 产物需在 Apple Silicon 机器另行打包上传。
- NAS/SMB 资源库与部分大型库性能门禁仍需要持续平台验收。

  Windows setup and portable builds are produced at release time; macOS artifacts need a separate Apple Silicon package-and-upload. NAS/SMB libraries and parts of the large-library performance gates still need continued platform validation.
