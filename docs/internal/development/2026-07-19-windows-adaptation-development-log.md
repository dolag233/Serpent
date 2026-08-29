# Windows 适配开发日志（2026-07-19）

分支：`codex/windows-adaptation`。目标：让原本只在 macOS 验证的 Serpent 能在 Windows 上正常启动、建库、导入导出并通过测试套件。

## 已修复（Windows 适配，已提交）

### 1. 建库崩溃：FTS5 被 vcpkg 劫持（根因，最严重）
- 现象：`npm start` 能起，但任何 `library.create` 报 `no such module: fts5` → `LIBRARY_CORRUPT`。
- 根因：本机装了 vcpkg 用户级 MSBuild 集成（`vcpkg integrate install`），重编 `better-sqlite3` 时链接器误用了 vcpkg 那份**不含 FTS5** 的 `sqlite3.dll` 导入库，而非自带的静态 amalgamation；vcpkg 还 applocal 部署了陈旧 dll 到 `build/Release`。
- 修复：新增 `scripts/rebuild-native.mjs`（`npm run rebuild:native`），强制 `VcpkgEnabled=false`、探测残留 `sqlite3.dll`、并在 Electron ABI 下实测 FTS5。`objdump` 确认完全静态链接。提交 `25d5653`。

### 2. 跨盘符导出被误拒（用户实测反馈，bead Serpent-59f）
- 现象：库在 Windows 磁盘根目录、导出到用户下载目录时报"请选择有效的本地文件夹"（`INVALID_LIBRARY_PATH`）。
- 根因：`exportLibraryToZip`/`exportLibraryToFolder` 用 `path.relative` 判断"目标是否在库内"，但**跨盘符时 `path.relative` 返回绝对路径**，被误判为"在库内"。
- 修复：抽 `src/worker/path-utils.ts` 的 `pathIsWithin`（含 `path.isAbsolute` 守卫），两条导出路径共用；同步替换 `zip-import-stream.ts` 的私有实现。提交 `759dda9`。

### 3. Windows delete-pending 导致 refresh 崩溃（真实产品 bug）
- 现象：删除被监听的链接根目录后 `refreshManagedAssets` 抛 `INVALID_IMPORT_SOURCE`。
- 根因：Windows 删除被 `fs.watch` 持有的目录后进入"删除挂起"态——`lstat` 仍可见、但任何访问返回 EPERM（STATUS_DELETE_PENDING），直到最后一个句柄关闭；POSIX 直接 ENOENT。
- 修复：`linkedRootIsGone` 增加可访问性校验；可用性对账探针把 **EPERM（仅 win32）** 视同 ENOENT（`isUnreadablePathError`），消失的根翻 offline 而非崩溃。真实 EACCES/EIO 仍照常传播。提交 `759dda9` + `e1fd47a`。

### 4. ZIP 导出取消句柄
- 取消后立即删目标文件会撞上尚未释放的句柄（EPERM → 误报 `LIBRARY_NOT_WRITABLE`）。改为先等 output stream `close` 再清理。提交 `759dda9`。

### 5. 超长文件名错误码差异
- NTFS 超长名报 ENOENT（ERROR_FILENAME_EXCED_RANGE）→ 误报 `SOURCE_NOT_FOUND`；POSIX 报 ENAMETOOLONG → `PATH_LIMIT_EXCEEDED`。改为落盘前对每个路径分量做确定性长度校验（255），两平台一致报 `PATH_LIMIT_EXCEEDED`。提交 `e1fd47a`。

### 6. 平台语义与测试基础设施
- `binary-resolver`：Windows 无 x-bit，`X_OK` 映射为 `F_OK`，已存在文件即可运行；目录不再通过 bundled 检查。
- `recent-libraries` 测试：Windows chmod 只切换只读属性，0o600 断言改为 POSIX-only。
- `sharp.cache({ files: 0 })`：关闭 libvips 文件缓存，避免缩略图/调色板生成后源文件被占用无法删除/重命名。
- 测试资源泄漏：`LibraryService` 持有 SQLite 连接与 `fs.watch` 句柄，POSIX 能删开着文件、Windows 不能；给 10+ 测试文件加 `closeAll` 收尾。
- `relinkMissingFolder` 走 `assetLstat` 测试缝；D2 用例改注入式 EACCES（chmod 模拟仅 POSIX 有效）。
- `folder-path` 符号链接用例：先 `closeAll` 释放 watcher 再重建符号链接（Windows delete-pending）。
- `library-service` "父目录不可写" 用例 POSIX-only（Windows 无法用 chmod 让属主目录不可写）。
- soak 性能预算：Windows 文件系统密集负载（NTFS + Defender 扫描 2 万文件）更慢，`win32` 用 2x 预算，保留 POSIX 紧预算以仍能抓回归。

提交：`574e596`、`759dda9`、`e1fd47a`、`5a9cbcc`。

## 验证结果
- 全量 worker 套件：**5 失败 | 627 通过**（+少量 skip）。
- 剩余 5 个失败**均非 Windows 问题**，在 macOS 上同样失败，见下"主线红"。

## 主线红（非 Windows，仅记录、待各功能负责人认领）

> 这些都是今天其他功能提交改了源码、却未同步更新对应测试。修法是把**测试期望**对齐到已发布的源码行为（不改产品逻辑）。按用户要求本次 Windows 适配**不改动**它们。已开单：

| 测试 | 失败 | Bead | 引入提交 | 原因 | 建议修法（测试侧） |
|---|---|---|---|---|---|
| `tests/worker/folder-rename.test.ts` > "renames a managed folder on disk and rewrites descendant folder and asset paths" | 顶层文件夹 `directAssetCount` 期望 0、实得 1 | `Serpent-q6f` | `306f4de`（Serpent-toh） | `listManagedFolders` 现把 `directAssetCount` 覆盖为**后代递归计数**（注释："displayed badge count = all descendants"） | 期望改为递归计数（顶层 1、子层 1） |
| `tests/worker/thumbnails.test.ts` > "marks an unsupported asset without offering a generatable preview" | `.txt` 期望 `mediaType:'other'/status:'missing'`、实得 `'text'/'ready'` | `Serpent-mwc` | `facb5bd`（text 预览） | `text` 已成一级 mediaType，`.txt` 可生成预览 | 用例改用真正不支持的扩展名，或断言 `text` 行为 |
| `tests/worker/organization.test.ts` > "rejects empty and sort-only smart collection definitions (CU-M5)" | 空 `{}` 智能集合期望被拒、实得创建成功 | `Serpent-df9` | `ab518ab`（Serpent-era） | `createSmartCollection` 现允许空草稿（"create may start as a draft"） | 改为断言允许创建空草稿 |
| `tests/worker/search.test.ts` > "rejects empty smart collection definitions (CU-M5)" | 同上 | `Serpent-f72` | `ab518ab` | 同上 | 同上 |
| `tests/worker/video-exr.test.ts` > "dispatches audio assets to ffmpeg waveform + opaque cover" | 期望封面 tag `waveform-cover5`、源码为 `waveform-cover6` | `Serpent-voy` | `963daa7` | `AUDIO_WAVEFORM_COVER_GENERATOR_TAG` 升到 cover6，测试未跟 | 测试常量改为 `cover6` |

## 未覆盖 / 移交项
- **E2E 与打包**：生产构建被一个**主线 CSS 构建阻断**挡住（`src/renderer/styles.css` 有一处丢失选择器后遗留的孤立声明，lightningcss 压缩报 `Invalid token in pseudo element`），与 Windows 无关。已开单 `Serpent-a4q`；需主线修复后才能跑 packaged/E2E 验收。
- 较大功能的 Computer Use 真实桌面验收：本环境无该能力，记为**未执行**，移交具备能力的 agent / 人工 QA。
- Windows 无 CI runner：以上均为本机人工验证，未进自动化流水线。
