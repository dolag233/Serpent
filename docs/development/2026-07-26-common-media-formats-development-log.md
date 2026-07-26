# 2026-07-26 常用媒体格式开发记录（Serpent-aav1）

> 状态：实现进行中；本记录只陈述当次可复现证据，不构成跨平台或人类验收通过。

## 依赖安装与构建步骤

在本地磁盘工作副本执行，不要从 SMB/NAS 运行 Electron 或构建工具；Windows 与 macOS 的 `node_modules` 必须分别安装。

```powershell
# Windows（PowerShell 7）
npm ci --registry=https://registry.npmjs.org
pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/media-build/win32-x64.ps1
```

```bash
# macOS（本地 APFS 工作副本）
npm ci --registry=https://registry.npmjs.org
bash scripts/media-build/darwin-arm64.sh
```

构建脚本会按 `resources/media-binaries/source-lock.json` 下载固定版本的 vcpkg/源码，使用本机缓存编译 FFmpeg 与 OpenImageIO，并将 bundle 写入 `resources/media-binaries/<platform>/`，同时生成 `artifacts/media-binaries/` 下的压缩包。首次安装应用依赖后可用 `npm start` 启动开发环境；打包后如需继续运行开发态测试，执行 `npx @electron/rebuild -f -w better-sqlite3` 恢复开发用原生模块 ABI。

本地 bundle 的快速检查：

```powershell
node scripts/media-binaries.mjs manifest --platform win32-x64
```

`node scripts/media-binaries.mjs verify` 还要求 bundle 已发布到不可变 HTTPS 地址并写入 checksum receipt；本地构建未发布时该命令按设计拒绝，不代表编译失败。

## 本轮实现和根因修复

- 共享媒体格式表已覆盖静态图像（TGA、EXR、TIFF、BMP、ICO、SVG、PSD）、RAW（DNG、CR2、CR3、NEF、ARW、RAF、ORF、RW2）、视频（MP4、MOV、AVI、WMV、WebM、MKV、M4V）和音频（WAV、MP3、OGG/OGA、M4A、AAC、FLAC、Opus）。
- OpenImageIO 负责非 Sharp 静图、PSD 合成预览和 LibRaw 解码；视频生成 WebM 代理；音频生成 Ogg/Opus 播放代理和波形 PNG 缩略图。
- Windows FFmpeg 初次重建虽传入 `--enable-encoder=png`，但未启用 `zlib`，最终只有 PNG 解码器。音频波形写入 image2/PNG 因而失败，AAC 等文件在缩略图 job 阶段中止。
- 将 FFmpeg 的 `zlib` vcpkg feature 加入 macOS/Windows 共用清单，并把 `--enable-zlib`、PNG encoder 和 `showwavespic` 设为 bundle capability gate。最终 Windows FFmpeg 同时报告 `--enable-zlib`、`--enable-encoder=png` 和 PNG encoder。
- Electron 媒体失败 E2E 还揭示了 Renderer 竞态：若 Worker 在首次浏览列表加载资产前快速发出失败事件，原逻辑会丢弃它，用户看不到缩略图失败。现在先保留失败事件，待列表抵达后按资产能力展示；ready 或不支持缩略图的资产会清理记录。
- SVG 继续使用 Sharp 生成网格/Inspector 缩略图，但查看器现在通过 `serpent://source` 直接读取原始 SVG（`image/svg+xml`），因此放大时保持矢量渲染，不再放大 WebP 缩略图。

## 可追溯证据（Windows，本地开发 bundle）

| 需求条目 | 实现位置 | 自动化证据 | 人工/平台证据 |
| --- | --- | --- | --- |
| 音频波形与 Ogg/Opus 代理 | `src/worker/library-service.ts`、`src/shared/media-formats.ts` | `real-common-av-formats.test.ts`：1/1 通过，覆盖 WAV、MP3、OGG/OGA、M4A、AAC、FLAC、Opus；使用最终 `resources/ffmpeg/win32-x64` | Windows 实际 Electron 查看器未执行 |
| 视频 WebM 代理 | 同上 | `real-common-av-formats.test.ts`：同次通过，覆盖 MP4、MOV、AVI、WMV、WebM、MKV、M4V | MOV/AVI 此前由产品负责人验收；其余格式仍待人工验收 |
| 静态图像与 PSD 合成预览 | `src/worker/library-service.ts`、`src/shared/thumbnail-support.ts` | `real-static-format-matrix.test.ts`：静图 1/1 通过，覆盖 BMP、TIFF、TGA、EXR、ICO、SVG；PSD 夹具 1/1；`media-formats.test.ts` 验证 SVG 原图 MIME | Windows 开发态 Electron E2E 验证 SVG 查看器使用 `serpent://source`；真实多 part EXR 和跨平台人工缩放仍待验收 |
| 相机 RAW 解码 | `resources/media-binaries/vcpkg/vcpkg.json`、`src/worker/library-service.ts` | `real-raw-format-matrix.test.ts`：1/1 通过，覆盖 DNG、CR2、CR3、NEF、ARW、RAF、ORF、RW2 | Windows/macOS 人工导入未执行 |
| 可交付 Windows 媒体工具 | `scripts/media-build/win32-x64.ps1`、`scripts/media-build/prepare-vcpkg-overlay.mjs`、`scripts/media-binaries-lib.mjs` | 2026-07-26 重建成功（vcpkg 13 分钟）；stage 写入并校验 `resources/media-binaries/win32-x64/manifest.json`，生成 `artifacts/media-binaries/serpent-media-win32-x64.zip`；`media-binaries.test.ts` 8 passed/4 skipped | release bundle 尚未提升到不可变 HTTPS URL，故 release receipt verify 按设计拒绝 |
| Renderer/Main/Worker 媒体失败与恢复 | `src/renderer/App.tsx`、`tests/e2e/media-preview.test.ts` | 2026-07-26 Windows 开发态 Electron E2E：3/3 通过；覆盖图片 `naturalWidth > 0`、查看器解码、缺 FFmpeg 的失败角标/重试/日志和后台任务，以及完整退出后以最终 Serpent FFmpeg 自动修复历史失败预览 | 打包应用与人工操作未执行 |

生成 AV 测试夹具时使用 `D:\Tools\ffmpeg\ffmpeg.exe`，原因是产品 FFmpeg 有意 `--disable-avdevice`、不能使用 lavfi 输入；实际解码、缩略图和代理均使用最终的 Serpent bundle，而非该夹具生成器。

## 尚未验证 / 后续

- macOS 尚未重建对应 bundle，也未运行本轮真实格式矩阵。
- Windows/macOS 的打包应用未验证查看页解码、播放、缩放/平移和 EXR plane/part 切换；当前环境没有可用的 Computer Use 桌面控制能力。
- 需要包含多个可显示 part 的真实 EXR 样本，完成查看器的人工验证。
- Windows bundle 尚未提升到不可变 HTTPS 发布地址与 checksum-pinned receipt；这属于 0006 发布阻断，不能以本地 build 替代。

## Serpent-aoj0 色彩空间增量（2026-07-26）

- EXR 多通道选择按产品要求暂缓；本增量聚焦色彩空间读取、默认应用与 OIIO 输入空间选择。
- Sharp 图像读取 `space`/ICC profile；OIIO 图像读取 `oiio:ColorSpace`、`ICCProfile:profile_description` 与 EXIF 色彩空间提示，并统一映射到锁定 OCIO 配置。
- OIIO 缩略图生成器现在把输入空间写入生成版本；PSD 等历史缩略图若未带颜色键，会在查看时自动按检测到的 profile 重生成。查看器对 OIIO-backed 图像提供色彩空间选择。
- 真实 PSD（Adobe RGB ICC）验证：默认检测 `adobergb`，切换 `srgb_texture` 会重新生成；`tests/worker/real-static-format-matrix.test.ts` 2/2 通过。
- 格式边界记录在 [`docs/research/image-colorspace-support-2026-07-26.md`](../research/image-colorspace-support-2026-07-26.md)：RAW 的输出空间不等于源 ICC；BMP/ICO/GIF/SVG/TGA 等缺少可靠通用 profile 的格式不宣称已读取任意 ICC。

## 色彩空间设置入口增量（后续反馈）

- 查看器色彩空间选择器现对可通过 OIIO 重渲染的 Sharp 图像开放，不再只显示 OIIO decoder；选择结果保存为资产级 override，不修改源文件。
- 单资产右键菜单新增“设置色彩空间”，与查看器共用同一 override；选择“使用检测到的色彩空间”可清除 override。
- 新增 schema v22 的 `asset_color_space_overrides` 表；打开查看器时自动使用已保存 override，缩略图缓存按输入空间失效并重生成。
- 视频也展示并保存输入色彩空间选择，但 FFmpeg 播放代理的实际色彩转换仍需单独实现，当前不宣称视频像素已完成色彩管理。
