# 外部库导入的临时目录惯例（2026-08-27）

## 问题

Serpent 在打开/导入 Billfish（`.BillfishPack`）与 Eagle（`.eaglepack` 等归档）时，主进程会将整包解压到系统临时目录（Windows 上通常为 `%TEMP%`，即用户 `AppData\Local\Temp` 下）。大包导入可能占满系统盘（常为 C:），且若清理不彻底会留下残留。

工单 Serpent-342ba9 需要对照成熟软件回答：

- 大体积解压/导入/转换时，临时文件默认放哪？
- 是否在操作前检查可用空间？不足时拒绝还是换盘？
- 成功、取消、崩溃后如何清理？能否把 `%TEMP%` 残留交给操作系统？
- 是否有「不要静默把大文件写到系统盘」的官方建议？

**Serpent 当前实现（供对照，非外部惯例）**：`materializeExternalLibrarySource` 在未传入 `tempDirectory` 时默认使用归档文件所在目录；但 `src/main/index.ts` 在 Eagle/Billfish 打开与导入路径上显式传入 `os.tmpdir()`（系统 TEMP）。解压目录在导入流程结束时通过 `cleanup` 回调 `rm` 删除；失败路径也会 `cleanup`。

## 结论摘要（给 Serpent 的建议）

1. **没有单一行业标准**：DAM/归档导入（Eagle、Billfish）几乎不公开临时目录策略；专业影像软件更常见的是**可配置的 scratch/cache 盘**或**与媒体/库同盘的工作目录**，而不是「永远系统 TEMP」。
2. **系统 TEMP 是通用默认，但大文件场景普遍让用户改盘或把数据写到目标盘**：Photoshop scratch disk、Lightroom Camera Raw cache、Premiere Media Cache、DaVinci Media Storage / Working Folders 均提供用户可选路径；7-Zip 对**归档更新**默认系统 TEMP 但推荐仅 removable 盘例外时改到归档旁目录。
3. **「直写目标位置」与「先 TEMP 再搬运」并存**：
   - **直写目标**：Chrome/Edge 下载（`.crdownload` 在下载目录）、7-Zip/资源管理器「解压到」选定文件夹、Steam 游戏下载（在库盘 `steamapps` 下组装）。
   - **专用临时区**：Inno Setup `{tmp}`、Squirrel.Windows `packages\temp`、Serpent 类全量解压 staging。
4. **空间不足时**：官方文档较少描述「自动换盘」；常见做法是**报错/阻塞**（Photoshop scratch full、DaVinci 缓存卷不可用弹窗）或**用户预先在偏好设置里改路径**。Lightroom 性能文档要求目录至少约 20% 空闲，但未描述自动 fallback。
5. **清理责任在应用**：Inno/Squirrel 明确安装结束删除临时目录；iOS/macOS 文档要求应用删除 `tmp` 内容，系统仅**周期性**清理；Windows Storage Sense 可能删除 `%TEMP%`，但时间不确定，**不能当作应用清理的替代**。
6. **对 Serpent-342ba9 的倾向**：成熟组合更接近 **B 的变体**——默认可用系统 TEMP（或应用可控的 staging），**导入前预检空间**，不足时**提示并允许/自动改到资源库所在盘**（与 DaVinci「首块 Media Storage 卷」、Lightroom「cache 与 catalog 同盘」思路一致），且**成功/取消/崩溃均主动清理**；仅依赖 OS 扫 TEMP 不够。

| 策略 | 含义 | 接近该策略的成熟软件 |
|------|------|----------------------|
| **A** | 永远系统 TEMP；预检；不够就拒绝；务必应用内清理 | Inno `{tmp}`（安装器内临时子目录）、部分 Electron `getPath('temp')` 用法 |
| **B** | 默认 TEMP（或默认可配置 scratch）；不够则改到数据盘；务必清理 | 7-Zip（可配置 working folder）、Photoshop/Lightroom/Premiere（用户改 scratch/cache）、DaVinci（首卷 + 可改 Working Folders） |
| **C** | 永远与资源库/目标同盘 | Steam 库盘下载、7-Zip「Current」（归档旁）、Chrome 下载目录直写、DaVinci 默认 CacheClip 在首个 Media Storage 卷 |

## 分产品证据

### 1. Eagle（eagle.cool）— 导入 / 解压库 / eaglepack

| 维度 | 结论 |
|------|------|
| 默认临时位置 | **未找到官方说明** eaglepack 解压是否使用系统 TEMP、归档旁目录或库目录。支持页仅描述双击/导入 eaglepack 与库备份流程。 |
| 空间预检 / 换盘 | **未找到官方说明**。 |
| 清理 | **未找到官方说明**。 |
| 静默写系统盘 | **未找到官方说明**。 |
| API 侧证 | Eagle 插件 API 暴露 `eagle.app.getPath('temp')` 与 `TEMP` 环境变量，与 Electron 一致，说明生态上**系统 temp 是可查询的标准路径**，但不等于 eaglepack 导入一定用它。 |

来源：

- Import / Exporting Eaglepacks（无临时目录细节）：https://en.eagle.cool/support/article/import-exporting-eaglepacks
- Eagle Plugin API `app.getPath`（`temp`）：https://developer.eagle.cool/plugin-api/api/app.md

### 2. Billfish — 导入 / 解包 `.BillfishPack`

| 维度 | 结论 |
|------|------|
| 默认临时位置 | **未找到官方说明**。帮助中心仅描述菜单「导入 Billfish 素材包」与进度条，未提及临时目录。 |
| 空间预检 / 换盘 | **未找到官方说明**。 |
| 清理 | **未找到官方说明**。 |
| 静默写系统盘 | **未找到官方说明**。 |

来源：

- 如何导入 Billfish 素材包：https://www.billfish.cn/help/daorubillfishpack
- 导入和导出：https://www.billfish.cn/help/daoruhedaochu

### 3. Adobe Lightroom Classic

| 维度 | 结论 |
|------|------|
| 默认临时位置 | Catalog 与 `[Catalog] Previews.lrdata` **默认同目录**；Camera Raw cache 默认在系统用户缓存区，可在 **File Handling → Camera Raw Cache Settings → Choose** 改位置。LR Classic **无** Photoshop 式独立 scratch disk；部分操作临时占满启动盘（社区反馈），官方未提供单独 temp 盘设置。 |
| 空间预检 | 性能文档要求存放 catalog/previews/图像的磁盘至少约 **20% 空闲**；未描述自动拒绝导入。 |
| 空间不够 | **未找到**自动换盘；建议增删 cache、Disk Cleanup、将 cache 放到快速硬盘。 |
| 清理 | 可 Purge Camera Raw Cache；可 Discard Standard and 1:1 Previews；Disk Cleanup 建议。 |
| 静默写系统盘 | 通过让用户把 Camera Raw cache 指到快速/大容量盘，隐含**大缓存不应默认挤系统盘**的产品取向。 |

来源：

- Optimize Lightroom performance（Camera Raw cache 位置、20% 空闲、catalog 与 preview 同夹）：https://helpx.adobe.com/lightroom-classic/desktop/technical-support/performance-guidelines/optimize-performance-lightroom.html

### 4. Adobe Bridge

| 维度 | 结论 |
|------|------|
| 默认临时位置 | **未在本次调研中取得可引用的官方正文**（helpx 缓存专题页抓取为前端壳，无稳定正文 URL 片段）。 |
| 空间预检 / 换盘 / 清理 | Adobe 生态惯例：Bridge 缓存可在偏好设置中配置并清理（与 Premiere/Lightroom Media/Camera Raw cache 同类）；**具体条目需补读 Bridge 偏好设置官方页**。 |
| 对照 | Adobe 社区文档列举多应用大缓存路径时需分别检查 Bridge cache、LR previews、Premiere Media Cache 等（说明**各应用独立配置，默认多在用户 profile / 系统盘**）。 |

来源（Bridge 缓存细节 **未找到独立官方说明正文**，以下为 Adobe 生态交叉引用）：

- Adobe Community：多应用 scratch/cache 需分别配置：https://community.adobe.com/questions-712/scratch-disk-is-full-1618924

### 5. Adobe Photoshop — scratch disk

| 维度 | 结论 |
|------|------|
| 默认临时位置 | **默认使用内部 OS 盘**作为 scratch disk；可在 Preferences → Scratch Disks 增选多盘并排序。 |
| 空间预检 | scratch 不足时出现 “Scratch disks full” / 无法启动；文档建议 scratch 盘至少约 **100 GB** 空闲。 |
| 空间不够 | **不自动换盘**；用户需手动添加/排序 scratch 盘，或在启动时 Ctrl+Alt / Cmd+Option 打开 Scratch Disk 对话框。 |
| 清理 | Edit → Purge；退出后 scratch 临时数据释放；优化 History States / auto-recovery 减少 scratch 占用。 |
| 静默写系统盘 | 官方明确 scratch 默认 OS 盘，但强烈引导用户把**最快、空间最大**的盘置顶——大临时数据应避免挤满系统盘。 |

来源：

- Set up and manage scratch disks：https://helpx.adobe.com/photoshop/desktop/troubleshoot/troubleshoot-tools-resources/set-up-and-manage-scratch-disks.html
- Troubleshoot scratch disk full（默认 internal OS drive、100GB、多盘）：https://helpx.adobe.com/photoshop/kb/troubleshoot-scratch-disk-is-full-challenger.html
- Resolve scratch disk full errors：https://helpx.adobe.com/photoshop/desktop/troubleshoot/performance-stability-issues/troubleshoot-scratch-disk-full-errors-in-photoshop.html

### 6. Adobe Premiere Pro — Media Cache / scratch 取向

| 维度 | 结论 |
|------|------|
| 默认临时位置 | Media Cache Files 与 Media Cache Database 默认在用户 profile 下 Adobe Common（系统盘）；Preferences → Media Cache 可 **Browse** 改到快速 SSD/NVMe，可与媒体同盘。 |
| 空间预检 | **未找到**导入前预检；可配置「cache 超过卷容量 10%」等自动删除策略。 |
| 空间不够 | 自动删除最旧 cache（可选）；**未找到**自动改到其他盘。 |
| 清理 | 可手动/自动删除 `.pek`、`.cfa`、`.ims` 等；退出后重启触发清理策略。 |
| 静默写系统盘 | 文档建议专用快速盘存放 Media Cache，避免默认隐藏文件夹长期膨胀。 |

来源：

- Manage media cache（Browse 改位置、SSD 建议）：https://helpx.adobe.com/premiere/desktop/troubleshooting/media-issues/manage-media-cache.html
- Automatically manage your Media Cache files（自动删除策略、默认 90 天 / 10% 卷大小）：https://helpx.adobe.com/premiere/desktop/troubleshooting/media-issues/automatically-manage-your-media-cache-files.html

### 7. Capture One

| 维度 | 结论 |
|------|------|
| 全部 | **未找到官方说明**（Phase One 支持页在调研时受访问限制，未能读取 catalog/session 与缓存临时目录正文）。 |

### 8. Photo Mechanic

| 维度 | 结论 |
|------|------|
| 全部 | **未找到官方说明**（Camera Bits 文档站 `docs.camerabits.com` 在调研时无可用正文返回）。 |

### 9. 7-Zip

| 维度 | 结论 |
|------|------|
| 默认临时位置 | **解压到用户选定目标目录**（Extract 操作本身直写目标）。**更新归档**时使用 working folder：可选 System temp folder、**Current**（目标归档所在目录）、或 Specified；官方推荐 System temp + 「Use for removable drives only」。 |
| 空间预检 | **未找到官方说明**。 |
| 空间不够 | **未找到**自动 fallback 文档。 |
| 清理 | 更新流程：在 working folder 建临时 base archive，完成后复制覆盖并**删除临时文件**（`-w` 开关）。 |
| 静默写系统盘 | 对 removable 盘建议不要用慢速/小容量系统 TEMP，而是归档旁或指定盘（**明确区分盘类型**）。 |

来源：

- 7-Zip Options — Folders / Working folder：https://documentation.help/7-Zip-18.0/options.htm
- `-w` (set Working directory) switch：https://documentation.help/7-Zip/working_dir.htm

### 10. WinRAR

| 维度 | 结论 |
|------|------|
| 全部 | **未找到可稳定抓取的一手在线官方正文**（rarlab / winrar 帮助站在调研时不可用或超时）。WinRAR 与 7-Zip 同类产品在「Paths / 临时解压文件夹」中通常允许指定临时目录；**待补 rarlab 官方帮助「Paths」章节 URL**。 |

### 11. Windows 资源管理器 — 解压 ZIP

| 维度 | 结论 |
|------|------|
| 默认临时位置 | 用户「解压全部」时**直写所选目标文件夹**；**未找到**官方说明会先解到 `%TEMP%` 再移动（与第三方压缩工具更新归档行为不同）。 |
| 空间预检 | **未找到官方说明**；空间不足时解压失败。 |
| 清理 | 无应用级 staging；失败可能留下不完整文件，需用户处理。 |
| 嵌套压缩 | **未找到**专门说明。 |

来源：

- Zip and unzip files（解压到文件夹的用户操作说明）：https://support.microsoft.com/en-us/windows/zip-and-unzip-files-f0128a00-85ca-698e-8665-400e38585c51

### 12. Google Chrome — 下载与 `.crdownload`

| 维度 | 结论 |
|------|------|
| 默认临时位置 | **默认下载目录**（通常为用户 Downloads）；`.crdownload` **落在该目录**，非 `%TEMP%`。 |
| 空间预检 | **未找到**官方预检；磁盘不足可导致下载失败（第三方说明）。 |
| 清理 | 完成后重命名去掉 `.crdownload`；失败可 Resume；关闭浏览器可能移除未完成 `.crdownload`。 |
| 静默写系统盘 | 用户可在 Settings → Downloads **更改默认下载位置**；非静默固定 C 盘。 |

来源：

- Download a file（默认下载位置、可 Change）：https://support.google.com/chrome/answer/95759
- Chromium `GetUserDownloadsDirectory`（Downloads 已知文件夹）：https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/common/chrome_paths_win.cc

### 13. Microsoft Edge — 下载

| 维度 | 结论 |
|------|------|
| 默认临时位置 | 与 Chromium 一致，未完成下载使用 **`.crdownload`**，位于**下载文件夹**（非 `%TEMP%`）。 |
| 其他 | 管理下载、更改下载位置见 Edge 支持「Manage downloads」；调研时页面为动态渲染，**具体句子以 Edge 帮助中心当前版为准**。 |

来源：

- Manage downloads in Microsoft Edge：https://support.microsoft.com/en-us/microsoft-edge/manage-downloads-in-microsoft-edge-229c9043-bf5a-44c0-a995-5385f3a0182a
- `.crdownload` 格式说明（Edge 与 Chrome 共用，第三方百科引用浏览器行为）：https://fileextension.fandom.com/wiki/CRDOWNLOAD

### 14. Steam — 游戏下载暂存

| 维度 | 结论 |
|------|------|
| 默认临时位置 | **未找到** Valve 帮助中心 FAQ 正文中关于 `steamapps/downloading` 路径的明确说明（调研 FAQ 页无正文命中）。行业通行结构与客户端「存储」设置一致：内容下载到**用户配置的库盘**下 `steamapps`（组装完成后再进入 `common`）。 |
| 空间预检 | 客户端在磁盘不足时提示；**未找到**官方文档摘录。 |
| 换盘 | 用户可在设置中添加库文件夹到其他盘；**未找到**自动 fallback 官方说明。 |
| 清理 | 下载完成后组装进库；失败/取消行为 **未找到官方说明** 正文。 |

来源：

- Steam Support FAQ 调研 URL 无正文：https://help.steampowered.com/en/faqs/view/5C0B-6F2F-1F49-9C49（**未找到官方说明**）

### 15. DaVinci Resolve — 缓存 / scratch

| 维度 | 结论 |
|------|------|
| 默认临时位置 | Render cache 默认在 Preferences 中**第一个 Media Storage 卷**根下的隐藏 `CacheClip`；Gallery 为 `.gallery`。Project Settings → Working Folders 可 Browse 改 cache/proxy/gallery 路径。 |
| 空间预检 | **未找到**导入前预检。 |
| 空间不够 / 卷不可用 | 官方手册：**若所选缓存卷不可用，Resolve 会弹窗警告**（不描述自动改盘）。 |
| 清理 | Cache 为可重建工作数据；用户可改路径或删除 cache 目录。 |
| 静默写系统盘 | 手册强调**首个 Media Storage 卷应为最快 scratch 卷**，避免系统盘成为默认首卷导致 cache 落系统盘。 |

来源：

- DaVinci Resolve User Manual（Working Folders / CacheClip / Media Storage）：https://documents.blackmagicdesign.com/UserManuals/DaVinci_Resolve_18_Manual.pdf（Chapter Project Settings — Working Folders；Preferences — Media Storage）
- 手册镜像章节（与官方手册同源排版，便于引用）：https://www.steakunderwater.com/VFXPedia/__man/Resolve18-6/DaVinciResolve18_Manual_files/part163.htm

### 16. Windows 安装器 — Inno Setup `{tmp}`

| 维度 | 结论 |
|------|------|
| 默认临时位置 | `{tmp}` 为 Setup 在**用户临时目录下创建的子目录**（如 `...\Temp\IS-xxxxx.tmp`），**不是**简单等于用户 `TEMP` 环境变量字符串本身。 |
| 清理 | **Setup/Uninstall 退出时删除该目录下全部文件与子目录**。 |
| 空间 / 换盘 | **未找到**空间预检与自动换盘说明。 |

来源：

- Inno Setup Constants — `{tmp}`：https://jrsoftware.org/ishelp/topic_consts.htm

### 17. NSIS

| 维度 | 结论 |
|------|------|
| 全部 | **未找到**可稳定访问的官方 Reference 正文（nsis.sourceforge.io 在调研时受防护/超时）。NSIS 惯例使用 `$TEMP` 或 `$PLUGINSDIR`；**待补 NSIS 官方 `$TEMP` 文档 URL**。 |

### 18. MSI / Windows Installer

| 维度 | 结论 |
|------|------|
| 默认临时位置 | 安装包展开与自定义操作常用用户/系统 **TEMP**；**未找到**本次调研中可引用的 MSDN「Temporary folder」专页正文（URL 404）。 |
| 清理 | 安装结束后由安装引擎清理临时组件；失败时可能残留，依赖 Repair/Cleanup 或手动删除。 |

来源：

- Windows Installer temporary folder（Learn 页面调研时为 404）：https://learn.microsoft.com/en-us/windows/win32/msi/temporary-folder（**未找到可引用正文**）

### 19. Electron / Squirrel.Windows 更新

| 维度 | 结论 |
|------|------|
| Electron `app.getPath('temp')` | 返回**系统临时目录**；可用 `app.setPath('temp', path)` 覆盖（须在 `ready` 前）；`userData` 文档明确**不建议写大文件**。 |
| Squirrel.Windows | 安装根在 `%LocalAppData%\MyApp`；**完整包解压到 `%LocalAppData%\MyApp\packages\temp`**，再由 `Update.exe` 复制到 `app-x.y.z`；packages 目录存放已下载 nupkg。 |
| 清理 | Inno 型：安装流程结束删除 `{tmp}`；Squirrel packages 目录为持久更新缓存，**非**每次删除全部 packages。 |
| 静默写系统盘 | Squirrel **刻意**使用 LocalAppData（通常系统盘）以保证可写；与「大媒体放数据盘」的 DAM 场景不同。 |

来源：

- Electron `app.getPath` / `temp` / `userData` 不宜大文件：https://www.electronjs.org/docs/latest/api/app
- Squirrel.Windows Install Process（`packages\temp`）：https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/using/install-process.md

### 20. macOS / iOS — 临时目录与回收

| 维度 | 结论 |
|------|------|
| `tmp/` | 应用写入**不需要长期保留**的临时文件；**应用应在使用完毕后删除**；系统可能在应用未运行时**周期性 purge**。 |
| `Library/Caches/` | 缓存可长期存在；系统可能在磁盘压力等条件下删除，应用须能重建。 |
| purgeable space | Apple 文件系统指南描述 tmp 与 Caches 分工；**未将大导入 staging 默认等同于 tmp 而不清理**。 |
| `NSTemporaryDirectory()` | Foundation 提供系统临时目录 API；行为与上述 `tmp/` 目录策略一致（Apple Developer 在线 Documentation 在调研时 404，以 File System Programming Guide 为准）。 |

来源：

- File System Programming Guide — macOS/iOS `tmp/`、`Library/Caches/`、应用应删除临时文件：https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileSystemOverview/FileSystemOverview.html

### 21. Windows Storage Sense / Disk Cleanup 对 `%TEMP%`

| 维度 | 结论 |
|------|------|
| 态度 | Storage Sense 可清理**用户临时文件**；默认在**磁盘空间不足**时运行；可配置清理临时文件、回收站、下载文件夹（下载需显式开启）。 |
| `%TEMP%` 删除 | Microsoft 故障排查文档（引用 Storage Sense / SilentCleanup）：**可能删除 `%TEMP%` 内容**；Storage Sense 默认关闭，但在 C 盘空间不足时**可能被启用**；SilentCleanup 在登录会话超过约 7 天时也可能清理。 |
| 对应用含义 | **不能**假设 TEMP 会立即回收；大文件残留可能长期占用；也不应假设 OS 永不删 TEMP（可能与进行中任务冲突）。 |

来源：

- Storage Sense（清理用户临时文件、低空间触发）：https://learn.microsoft.com/en-us/windows/configuration/storage/storage-sense
- Manage drive space with Storage Sense（默认低空间清理临时文件）：https://support.microsoft.com/en-us/windows/experience/storage-filemanagement/manage-drive-space-with-storage-sense
- `%TEMP%` 被 Storage Sense / SilentCleanup 删除（by design）：https://learn.microsoft.com/en-us/troubleshoot/windows-server/shell-experience/temp-folder-with-logon-session-id-deleted

### 22. Windows / Node / Electron 系统 TEMP 定义

| 维度 | 结论 |
|------|------|
| `GetTempPath` | 顺序：`TMP` → `TEMP` → `USERPROFILE` → Windows 目录；**调用方须自行验证路径存在与权限**。 |
| `os.tmpdir()` | Windows 上 `TEMP` 优先于 `TMP`；未设置时默认 `%SystemRoot%\temp` 等。 |

来源：

- GetTempPathW：https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-gettemppathw
- Node.js `os.tmpdir()`：https://nodejs.org/docs/latest/api/os.html#ostmpdir

## 操作系统对 TEMP 的回收

| 平台 | 机制 | 对大型导入 staging 的含义 |
|------|------|---------------------------|
| Windows | Storage Sense、Disk Cleanup、SilentCleanup 可能删除用户 `%TEMP%` | 残留可能最终被清，但时机不可控；进行中导入可能失败；**应用仍应自清理** |
| Windows | Inno `{tmp}`、部分安装器自建子目录并在退出时删除 | 短生命周期 staging 的正面范例 |
| macOS / iOS | `tmp/` 由应用删除；系统可 purge | 与 Windows 相同：勿依赖 OS 替应用兜底 |
| 跨平台 | Node/Electron 默认 TEMP = OS 规则 | Serpent 显式 `tmpdir()` 即此路径 |

## 对 Serpent-342ba9 的含义

### 策略对照

| 策略 | Serpent-342ba9 落地要点 | 成熟软件距离 |
|------|---------------------------|--------------|
| **A** 永远系统 TEMP，预检，不够拒绝，务必清理 | 实现简单；与当前 `index.ts` 传 `tmpdir()` 一致；需**导入前** `statfs`/`GetDiskFreeSpaceEx` 预检解压后体积（含膨胀系数），不足则**明确错误**；`cleanup` 覆盖取消/失败/进程退出兜底。 | Inno `{tmp}`、Electron 默认 temp；**不适合** Steam/DaVinci/Chrome 等大文件直写数据盘模式 |
| **B** 默认系统 TEMP，不够改资源库盘，务必清理 | **推荐对齐方向**：预检系统 TEMP 可用空间；不足时 fallback 到**资源库根目录所在盘**下 `.serpent-staging` 或同级专用目录（用户可见或可配置）；成功后 `rm`；启动时扫描陈旧 staging 目录。 | 最接近 7-Zip（可配置 working folder）、Adobe scratch/cache **用户改盘**、DaVinci **首卷 + Working Folders**；比纯 A 更符合 DAM 用户「库在大盘」预期 |
| **C** 永远跟资源库同盘 | 永不占 C 盘；大包直接写库盘；需库盘空间预检；SMB/NAS 上 IO 与 Serpent 约束需单独评估。 | Steam 库盘、7-Zip Current、DaVinci 默认 CacheClip on first media volume；Chrome 若用户把下载目录设在 D 盘则同类 |

### 额外产品约束（来自调研共识）

1. **预检**：Lightroom 20% 空闲、Photoshop scratch 100GB 属于性能建议；Serpent 应对**解压后预估大小**做硬预检（不足则拒绝或触发 B）。
2. **不要静默写系统盘**：Adobe/DaVinci 均通过偏好设置把大缓存放到用户知情的位置；Serpent 若用 TEMP，应在空间紧张或 fallback 时**提示**（磁盘洁净纪律）。
3. **清理**：Inno/Squirrel/iOS 文档均强调**应用生命周期内**或**退出时**清理；不能写「交给 Storage Sense」。
4. **默认实现细节**：`external-library-archive.ts` 已支持 `tempDirectory` 覆盖；工单应改**调用方策略**（`index.ts` 不再无条件 `tmpdir()`），而非仅文档。

### Eagle/Billfish 对标说明

竞品官方**未公开** eaglepack/BillfishPack 解压目录，无法声称「与 Eagle/Billfish 一致」。Serpent 应选择**对用户磁盘友好**且与 Adobe/Valve/7-Zip 大文件惯例一致的策略（**B 或 C**），并在 UI 可选高级设置中暴露 staging 目录（对标 Photoshop scratch / Premiere Media Cache Browse）。

## 来源

| # | 标题 | URL |
|---|------|-----|
| 1 | Eagle — Import / Exporting Eaglepacks | https://en.eagle.cool/support/article/import-exporting-eaglepacks |
| 2 | Eagle Plugin API — `app.getPath` | https://developer.eagle.cool/plugin-api/api/app.md |
| 3 | Billfish — 如何导入 Billfish 素材包 | https://www.billfish.cn/help/daorubillfishpack |
| 4 | Billfish — 导入和导出 | https://www.billfish.cn/help/daoruhedaochu |
| 5 | Lightroom Classic — Optimize performance | https://helpx.adobe.com/lightroom-classic/desktop/technical-support/performance-guidelines/optimize-performance-lightroom.html |
| 6 | Photoshop — Set up scratch disks | https://helpx.adobe.com/photoshop/desktop/troubleshoot/troubleshoot-tools-resources/set-up-and-manage-scratch-disks.html |
| 7 | Photoshop — Troubleshoot scratch disk full | https://helpx.adobe.com/photoshop/kb/troubleshoot-scratch-disk-is-full-challenger.html |
| 8 | Premiere — Manage media cache | https://helpx.adobe.com/premiere/desktop/troubleshooting/media-issues/manage-media-cache.html |
| 9 | Premiere — Automatically manage Media Cache | https://helpx.adobe.com/premiere/desktop/troubleshooting/media-issues/automatically-manage-your-media-cache-files.html |
| 10 | 7-Zip — Options (Folders / Working folder) | https://documentation.help/7-Zip-18.0/options.htm |
| 11 | 7-Zip — `-w` switch | https://documentation.help/7-Zip/working_dir.htm |
| 12 | Microsoft — Zip and unzip files | https://support.microsoft.com/en-us/windows/zip-and-unzip-files-f0128a00-85ca-698e-8665-400e38585c51 |
| 13 | Google Chrome — Download a file | https://support.google.com/chrome/answer/95759 |
| 14 | Chromium — `chrome_paths_win.cc` | https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/common/chrome_paths_win.cc |
| 15 | Microsoft Edge — Manage downloads | https://support.microsoft.com/en-us/microsoft-edge/manage-downloads-in-microsoft-edge-229c9043-bf5a-44c0-a995-5385f3a0182a |
| 16 | DaVinci Resolve 18 Manual (PDF) | https://documents.blackmagicdesign.com/UserManuals/DaVinci_Resolve_18_Manual.pdf |
| 17 | Inno Setup — Constants `{tmp}` | https://jrsoftware.org/ishelp/topic_consts.htm |
| 18 | Squirrel.Windows — Install Process | https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/using/install-process.md |
| 19 | Electron — `app.getPath` | https://www.electronjs.org/docs/latest/api/app |
| 20 | Apple — File System Programming Guide | https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileSystemOverview/FileSystemOverview.html |
| 21 | Microsoft — Storage Sense | https://learn.microsoft.com/en-us/windows/configuration/storage/storage-sense |
| 22 | Microsoft — Manage drive space with Storage Sense | https://support.microsoft.com/en-us/windows/experience/storage-filemanagement/manage-drive-space-with-storage-sense |
| 23 | Microsoft — `%TEMP%` deleted by Storage Sense | https://learn.microsoft.com/en-us/troubleshoot/windows-server/shell-experience/temp-folder-with-logon-session-id-deleted |
| 24 | Microsoft — GetTempPathW | https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-gettemppathw |
| 25 | Node.js — `os.tmpdir()` | https://nodejs.org/docs/latest/api/os.html#ostmpdir |
| 26 | Adobe Community — multi-app cache paths | https://community.adobe.com/questions-712/scratch-disk-is-full-1618924 |

**调研中未找到可引用官方正文的产品/主题**：Billfish/Eagle 解压临时目录；Capture One；Photo Mechanic；WinRAR 在线帮助；NSIS `$TEMP` 页；MSI temporary folder 专页；Steam 下载暂存路径 FAQ 正文；Adobe Bridge 缓存专页正文。
