# ADR-0020：媒体预览采用 Chromium、FFmpeg、sharp、OIIO 与 OCIO

- 状态：已接受
- 日期：2026-07-11

## 背景

首发需要覆盖 PNG/JPEG/GIF、MP4/MOV/AVI/WMV、EXR/TGA/TIFF。容器扩展名不能保证 Chromium 可播放，EXR 也需要 scene-linear HDR 与显示变换，不能当作普通 8-bit 图片处理。

详见[媒体解析与预览技术栈](../research/media-preview-stack.md)。

## 决策

- Electron/Chromium 负责最终图片展示和视频播放；原文件运行时可直放则直接播放，否则使用代理。
- 随应用分发版本锁定、LGPL-only 的 FFmpeg/ffprobe，负责媒体探测、视频封面、WebM VP9/Opus 预览代理、scrub、抽帧联系表和未来音频波形。
- sharp 负责 PNG、JPEG、GIF 和普通 TIFF 的元信息与缩略图。
- OpenImageIO + OpenColorIO 负责 EXR、TGA、复杂 TIFF、基本色彩管理和曝光显示。
- 原文件不被转码覆盖；所有显示结果写入可重建衍生物缓存。
- 媒体工作由 Library Worker 调度，FFmpeg/OIIO 使用无 shell 的短命子进程；解析失败不阻止资产入库。
- MVP 不引入 ImageMagick。

## 许可证与分发约束

- FFmpeg 构建不得启用 GPL 或 nonfree 组件，不链接 libx264/libx265 等会改变分发条件的组件。
- 代理输出使用 WebM VP9/Opus。
- sharp、libvips、OIIO、OCIO、OpenEXR 及其依赖必须随包保留许可证、notice 和必要源码/归属。
- CI 记录 FFmpeg build configuration、可用格式/codec 与第三方 SBOM，发现 GPL/nonfree 构建标志立即失败。
- Windows x64、macOS x64/arm64 分别打包、签名并运行格式样本 smoke test。

## 后果

- Chromium 的原生播放是快路径，不是格式支持承诺。
- AVI/WMV 及不可直放的 MOV/MP4 先生成 WebM 代理。
- EXR 默认显示首个可视 RGB/RGBA part，应用 OCIO display transform，并允许调整曝光；完整通道检查推迟。
- 需要维护格式/codec 测试矩阵以及损坏、超大、旋转、VFR、多音轨等边界样本。
- 编解码器专利风险与开源许可证合规是不同问题，发布前仍需针对目标地区评估。
