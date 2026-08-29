# Electron + TypeScript MVP 媒体解析与预览技术栈

> 调研日期：2026-07-11
> 范围：Windows、macOS；首发格式 PNG/JPG/JPEG/GIF、MP4/MOV/AVI/WMV、EXR/TGA/TIFF。
> 来源约束：仅引用 Electron/Chromium、FFmpeg、sharp/libvips、OpenImageIO/OpenEXR/OpenColorIO、ImageMagick 的官方文档、源码仓库与许可证。许可证部分是工程风险说明，不是法律意见。

## 结论

MVP 建议采用以下组合：

1. **Electron/Chromium 负责 UI 和最终播放。** 对运行时确认可播放的文件直接用 `<video>`；不要把“扩展名是 MP4/MOV”当作必然可播放，因为容器与内部编解码器是两回事，Chromium 的能力还取决于构建选项和操作系统。Chromium 官方列出的容器包括 MP4/QuickTime/MOV，但 `ffmpeg_branding` 与 `proprietary_codecs` 会改变实际能力。[Chromium 音视频架构与格式说明](https://chromium.googlesource.com/website/+/cb33846322e88ba1acc3188c1daa4b00b94be767/site/audio-video/index.md)
2. **随应用分发一套自建、版本锁定、LGPL-only 的 `ffmpeg`/`ffprobe` 可执行文件。** 它负责媒体探测、视频封面、低分辨率 hover/scrub 代理、视频抽帧联系表，后续也负责音频波形。AVI、WMV 以及 Chromium 不能直接播放的 MOV/MP4 都先转为 WebM 代理再交给 `<video>`。
3. **普通图片用 sharp。** PNG/JPEG/GIF/TIFF 的元信息和缩略图走 sharp；其官方预编译包覆盖 Windows x64、macOS x64/ARM64，并支持 JPEG、PNG、TIFF、GIF 等输入，Electron 打包也有明确的 ASAR 解包配置。[sharp 安装与 Electron 打包](https://sharp.pixelplumbing.com/install/)
4. **EXR/TGA 和专业显示预览用 OpenImageIO（OIIO）+ OpenColorIO（OCIO）。** OIIO 官方列出 OpenEXR、Targa、TIFF、JPEG、PNG、GIF 等格式，并提供 `oiiotool`、颜色转换及 OCIO display transform；它比把 EXR 当普通 8-bit 图片解码更贴合影视资产。[OIIO 官方文档](https://openimageio.readthedocs.io/en/stable/)
5. **所有媒体解析都离开 renderer 和 Electron main process。** 用 Electron `utilityProcess` 承载 TypeScript 任务调度器；该进程再用无 shell 的子进程调用 FFmpeg/OIIO。sharp 也只加载在 utility process。解析器崩溃、内存暴涨或被取消时，不应拖垮主界面。
6. **MVP 不引入 ImageMagick。** 它的覆盖面很广，但与 sharp + OIIO 重叠，委托库和安全策略会扩大打包、许可证和攻击面。以后可把它作为受限格式插件，而不是核心依赖。

这套方案的关键取舍是：**原文件保持不变，UI 只消费缓存衍生物**。衍生物包括静态缩略图、WebM 预览代理、联系表、波形和显示变换后的 EXR 预览；失败只影响预览，不影响资产入库。

## 为什么不能只靠 Chromium

Chromium 的 `<video>` 对支持的组合拥有成熟的硬件解码、播放控制和 seek 行为，适合作为最终播放器。但扩展名只说明容器，不说明内部编码。例如 MOV/MP4 中可能装不同视频和音频编码；Chromium 官方文档也把容器、编码器和 `proprietary_codecs` 构建开关分别列出。[Chromium 格式说明](https://chromium.googlesource.com/website/+/cb33846322e88ba1acc3188c1daa4b00b94be767/site/audio-video/index.md)

因此：

- 启动或首次遇到一种 codec/container 组合时，使用 `HTMLMediaElement.canPlayType()` 加一次真实加载测试，并按 Electron 版本、平台和架构缓存能力结果。
- 原文件能稳定播放时直接播放，避免代理生成等待。
- 加载失败、seek 异常或格式明确为 AVI/WMV 时，切换到 FFmpeg 代理。
- UI 不承诺“Electron 支持 MP4/MOV/AVI/WMV”，而承诺“Serpent 可为支持解码的源文件生成可播放预览”。

单独替换 Electron 内部的 `ffmpeg` 二进制不是建议路径：那会把应用行为绑到 Chromium 私有构建配置。独立的 FFmpeg CLI 边界更容易锁版本、测试格式、隔离崩溃并履行许可证义务。

## 视频、GIF、音频的处理方案

### 探测

所有视频先运行 `ffprobe`，输出 JSON，记录：

- container、duration、start time、bit rate；
- 每条 stream 的 codec、像素格式、宽高、帧率、旋转/显示矩阵；
- 音频 codec、声道、采样率；
- color primaries、transfer、matrix、range；
- 可用的标题、简介和字幕流。

`ffprobe` 的输出被设计为机器可解析，也能列出当前构建实际包含的格式、demuxer 和 codec；安装测试应保存 `-version`、`-buildconf`、`-formats`、`-codecs` 的结果作为发布证据。[ffprobe 官方文档](https://ffmpeg.org/ffprobe.html)

### 静态封面

- 优先取内嵌封面；否则从时间线早期抽帧。
- 若首帧为黑场或片头，可用 FFmpeg `thumbnail` 过滤器从一批连续帧中选择代表帧；官方示例直接将代表帧缩放后输出 PNG。[FFmpeg `thumbnail` 过滤器](https://www.ffmpeg.org/ffmpeg-filters.html#thumbnail)
- 输出统一为带版本参数的 WebP/JPEG 缓存，缓存键至少包含源内容指纹、目标尺寸、处理器版本和颜色策略。

### hover 播放与 scrub

对不能直接播放的源文件生成低分辨率、短 GOP 的 **WebM/VP9 + Opus** 代理：

- WebM/VP9/Opus 是 Chromium 的自然播放路径，避免为了预览输出再引入 GPL 的 x264。
- 代理限制长边、码率和音频码率；保留原始长宽比和旋转。
- 使用较短关键帧间隔，换取鼠标横向 scrub 时更快定位。
- hover 默认静音；真正“打开”资产后才启用声音和标准播放控件。
- 原文件可原生播放时先直读；若网络路径 seek 抖动、codec 不稳定或用户开启“总是生成代理”，仍可转代理。

GIF 可以先由浏览器直接播放；如果产品要求对 GIF 做时间轴 scrub，则将 GIF 同样转成无音频 WebM 代理。sharp 能读取 GIF 的帧数和每帧 delay，并能加载多帧输入，但其预编译输入范围不包括 TGA/EXR。[sharp 输入与动画元信息](https://sharp.pixelplumbing.com/api-input/)、[sharp 构造器](https://sharp.pixelplumbing.com/api-constructor/)

### 视频抽帧联系表与后续音频波形

- 联系表先按时长等间隔抽取固定数量帧，缩放后用 `tile` 合成；FFmpeg 官方 `tile` 过滤器就是将连续帧拼成网格，也给出了关键帧联系表的示例。[FFmpeg `tile` 过滤器](https://www.ffmpeg.org/ffmpeg-filters.html#tile)
- 给送入视觉模型的格子叠加时间编号；同时把文件名、标题、简介和可用字幕作为文本上下文，但不要烧进用户可见预览。
- 后续音频波形直接由 FFmpeg `showwavespic` 生成单帧波形；官方支持尺寸、分声道、颜色、线性/对数/平方根刻度以及 average/peak 模式。[FFmpeg `showwavespic`](https://www.ffmpeg.org/ffmpeg-filters.html#showwavespic)

FFmpeg 官方格式文档覆盖 MOV/MP4/QuickTime、AVI 和承载 WMV/WMA 的 ASF 家族，但最终可解码能力仍取决于具体构建；不要只按文件扩展名分派。[FFmpeg formats 文档](https://ffmpeg.org/ffmpeg-formats.html)

## 图片处理方案

### sharp：常规图片快路径

sharp 适合 PNG/JPEG/GIF/TIFF 的批量元信息与缩略图：它基于 libvips，官方目标就是把常见大图快速转换为较小的 Web 友好图像，并以低内存、并行方式工作。[sharp 官方说明](https://sharp.pixelplumbing.com/)

建议行为：

- `metadata()` 先读宽高、页/帧数、delay、ICC、EXIF orientation、alpha 等头部信息；它不需要完整解码压缩像素。[sharp metadata](https://sharp.pixelplumbing.com/api-input/)
- 缩略图执行 EXIF 方向校正、等比缩放和统一输出。
- 默认输出 sRGB 衍生图；sharp 官方说明，在不保留元数据时会转换到设备无关 sRGB 并移除 ICC。若 UI 需要显示原始 profile 信息，先单独提取保存，再生成显示缩略图。[sharp 输出与色彩行为](https://sharp.pixelplumbing.com/api-output/)
- 设置输入像素/尺寸上限、任务超时和并发上限。sharp 提供处理超时以及按底层 operation 建立允许/阻止列表的接口。[sharp timeout](https://sharp.pixelplumbing.com/api-output/#timeout)、[sharp operation block](https://sharp.pixelplumbing.com/api-utility/#block)

不要依赖 sharp 预编译包处理 EXR/TGA。官方预编译格式表列出 JPEG、PNG、Ultra HDR、WebP、AVIF、TIFF、GIF、SVG，没有 TGA/EXR。[sharp 预编译格式](https://sharp.pixelplumbing.com/install/#prebuilt-binaries)

### OIIO + OCIO：EXR/TGA/专业 TIFF 路径

OpenEXR 是 scene-linear HDR 专业格式，支持 multipart、任意通道和大量元数据，不等同于“更高位深的 JPEG”。[OpenEXR 官方说明](https://openexr.com/en/latest/)

MVP 的专业预览边界建议是：

- 默认选第一个可显示 part 的 RGB/RGBA 通道；保留 part、channel、data/display window 等元信息，暂不做完整通道检查器。
- OIIO 读取 EXR/TGA/复杂 TIFF，缩放后通过 OCIO display transform 输出 sRGB 预览。OIIO 的 `--ociodisplay` 会应用指定 display/view；未给来源色彩空间时，它会尝试读取元数据，否则假设默认 scene-linear 空间。[OIIO `--ociodisplay`](https://openimageio.readthedocs.io/en/v3.1.13.0/oiiotool.html#cmdoption-oiiotool-ociodisplay)
- 内置一份版本锁定的 OCIO config，并允许用户为资源库选择自定义 config；OIIO 支持 `$OCIO` 或显式 `--colorconfig`，也能列出当前色彩空间、display 和 view。[OIIO 色彩管理命令](https://openimageio.readthedocs.io/en/v3.1.13.0/oiiotool.html#oiiotool-commands-for-color-management)
- 曝光以线性 RGB 乘以 `2^EV` 后再执行 display transform。MVP 可在用户调曝光时异步重做小尺寸预览；不要先压成 8-bit sRGB 再调曝光。
- 文件色彩空间无法可靠判断时显示“假设为 scene-linear”的状态，并允许手工覆盖；不能把猜测隐藏起来。

OIIO 当前官方文档标注 Apache-2.0；OpenEXR 是 BSD-3-Clause；OpenColorIO 源文件使用 BSD-3-Clause。它们与 MIT 应用可以共存，但仍需分发各自许可证与第三方 notices。[OIIO 许可证与介绍](https://openimageio.readthedocs.io/en/stable/)、[OpenEXR 许可证](https://openexr.com/en/rb-3.1/license.html)、[OCIO 许可证标识](https://opencolorio.readthedocs.io/en/v2.4.0/guides/contributing/contributing.html#copyright-notices)

### 为什么不选 ImageMagick 作为 MVP 核心

ImageMagick 能读取大量格式，官方格式表也包含 AVI 等委托型输入；但实际支持依赖编译时 delegates，官方明确建议在处理文件前配置适合本地环境的安全策略。[ImageMagick 格式表](https://imagemagick.org/formats/)、[ImageMagick 下载与安全提示](https://imagemagick.org/download/)

它适合未来的长尾格式插件，但 MVP 同时引入 sharp、OIIO、FFmpeg 和 ImageMagick 会造成：

- 相同文件由多个 decoder 产生不同颜色/方向/页选择结果；
- 额外的动态库、delegate 与许可证清单；
- 更大的不可信输入攻击面；
- Windows/macOS 打包结果更难保持一致。

ImageMagick 自身许可证允许在不同许可证应用中使用，但要求随分发保留许可证和清晰归属；风险主要来自其编译进去或调用的 delegates，而不是 ImageMagick 主许可证本身。[ImageMagick 官方许可证](https://imagemagick.org/license/)

## 进程模型与故障隔离

建议结构：

```text
Electron renderer
  └─ IPC：提交任务、订阅进度、读取已完成衍生物
Electron main
  └─ 生命周期与受限 IPC；不解析媒体
utilityProcess: media-worker
  ├─ sharp 队列（普通图片）
  ├─ spawn ffprobe / ffmpeg（每任务或小并发池）
  └─ spawn oiiotool / iinfo（EXR/TGA/复杂 TIFF）
```

Electron 官方说明 `utilityProcess` 相当于使用 Chromium Services API 启动、带 Node.js 和 MessagePort 的 `child_process.fork`；主进程还能通过 `child-process-gone` 区分 crash、OOM、launch-failed 等原因。[Electron `utilityProcess`](https://www.electronjs.org/docs/latest/api/utility-process)、[Electron `child-process-gone`](https://www.electronjs.org/docs/latest/api/app#event-child-process-gone)

实施约束：

- 解析器参数必须使用数组传给 `spawn`/`execFile`，`shell: false`；绝不把文件名拼进 shell 命令。
- 每项任务有 wall-clock timeout、最大输出字节数和取消信号；取消时终止整个子进程树。
- 将 CPU、内存、磁盘 I/O 并发分别限流；网络资源库默认更低并发。
- 先写临时文件，校验成功后原子改名；缓存项带处理器与配置版本，升级后可重建。
- renderer 只获得资产 ID、任务状态和受控的预览 URL，不获得任意命令执行能力。
- 媒体失败记录 stderr 摘要、退出码和可重试状态；不要因为缩略图失败而拒绝入库。

单个 `utilityProcess` 不是安全沙箱：它拥有 Node.js。这里使用它是为了故障和资源隔离；对恶意文件的边界主要来自短命外部进程、超时、资源限制、固定参数和及时升级解析器。

## Windows/macOS 打包

发布物需按 `win32-x64`、`darwin-x64`、`darwin-arm64` 分别构建与测试：

- sharp 是 native Node module。Electron 官方指出 native module 必须匹配 Electron ABI；sharp 官方则要求在 electron-builder/Forge 中将 `sharp` 和 `@img` 从 ASAR 解包。[Electron native module](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules/)、[sharp Electron 打包](https://sharp.pixelplumbing.com/install/#electron)
- `ffmpeg`、`ffprobe`、`oiiotool`、OIIO format plugins、OCIO/OpenEXR 共享库和 config 都作为真实文件放在 `resources` 下，不放进 ASAR。Electron 官方说明 ASAR 是虚拟只读文件系统，执行二进制和动态库存在限制，native module 通常也需 unpack。[Electron ASAR 文档](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- 每个平台发布前在干净机器运行 capability manifest：记录二进制 SHA-256、版本、构建参数、可用格式/codec、OIIO plugin 列表、OCIO config 版本，并以首发格式样本跑 smoke test。
- macOS 将 helper、CLI 和动态库纳入 codesign/notarization；不要依赖用户安装 Homebrew。Windows 同样随应用带齐 DLL，不依赖系统 PATH。
- 不从第三方“万能 FFmpeg build”直接搬二进制；必须能还原精确源码、配置与依赖许可证。

## MIT 项目的许可证红线

### FFmpeg

FFmpeg 大部分代码是 LGPL-2.1-or-later，但启用 GPL 部分后整个 FFmpeg 构建会变成 GPL。官方明确说明 GPL 部分默认不会启用，需显式 `--enable-gpl`；官方合规清单要求不要启用 `--enable-gpl` 或 `--enable-nonfree`，并特别提醒不要使用 GPL 的 libx264。[FFmpeg LICENSE](https://ffmpeg.org/doxygen/7.0/md_LICENSE.html)、[FFmpeg legal checklist](https://www.ffmpeg.org/legal.html)

Serpent 发布构建必须：

- 明确禁用 `--enable-gpl`、`--enable-nonfree`；
- 不链接 libx264、x265 等 GPL 组件，也不加入许可证不清的外部 codec；
- 保存精确 configure 参数、修改 diff、依赖版本和对应源码；
- 在 About、第三方许可证和下载页按 FFmpeg 官方清单完成归属与源码提供；
- 将 FFmpeg 与 Serpent 自身 MIT 源码清楚分开，不声称整个发布包只有 MIT；
- 发布前由熟悉目标司法辖区的人审查 H.264/AAC/HEVC 等专利问题。FFmpeg 官方明确说 LGPL/GPL 合规并不能回答 codec 专利问题，风险随司法辖区与商业使用而变化。[FFmpeg Patent Mini-FAQ](https://www.ffmpeg.org/legal.html#Patent-Mini_002dFAQ)

代理输出选择 WebM/VP9/Opus，是为了不依赖 GPL 的 x264，也降低预览输出端的专利复杂度；它不自动消除“读取用户 H.264/HEVC/WMV 文件”可能涉及的专利问题。

### sharp / libvips

sharp 自身是 Apache-2.0，但它基于 LGPL-2.1-or-later 的 libvips；sharp 官方预编译包同时提供 sharp 和 libvips 二进制，而 libvips 官方仓库明确标注 LGPL-2.1-or-later。[sharp 许可证](https://sharp.pixelplumbing.com/)、[libvips 官方仓库与许可证](https://github.com/libvips/libvips)

因此不能因为 npm 包顶层写 Apache-2.0，就把整套二进制当成纯 Apache/MIT。发布前应固定 sharp 版本，导出其 `sharp.versions` 依赖清单，保留 sharp/libvips 及所有随包依赖的许可证与对应源码，并专门审查预编译 libvips 的 LGPL 履行方式。[sharp 版本清单 API](https://sharp.pixelplumbing.com/api-utility/#versions)

若团队不愿承担这项合规工作，备选是 MVP 全部静态图片都走自建的 OIIO CLI；代价是 TypeScript 集成和批量缩略图吞吐需要额外优化。不能用 ImageMagick 来“绕开”依赖审计，因为它的 delegates 同样需要逐项审核。

### 自动化防线

CI 应对每个平台产物执行：

1. 检查 FFmpeg `-buildconf`，发现 `enable-gpl`、`enable-nonfree`、`libx264`、`libx265` 等禁用项即失败。
2. 生成第三方组件 SBOM、许可证目录和源码归档链接。
3. 比较能力 manifest；Windows/macOS 支持集发生意外漂移即失败。
4. 用已知格式样本验证读取、封面、代理、seek、色彩变换、取消和坏文件超时。

## MVP 验收矩阵

| 类型 | 主路径 | 失败/后备路径 | MVP 验收重点 |
|---|---|---|---|
| PNG/JPG/JPEG | sharp → sRGB 缩略图 | OIIO 诊断 | EXIF 方向、ICC、alpha、超大图限额 |
| GIF | sharp 静态缩略图；Chromium hover 动画 | FFmpeg WebM 代理 | 帧时长、循环、可选 scrub |
| TIFF | sharp 普通 TIFF | OIIO 处理高位深/多页/复杂 TIFF | 页数、位深、ICC；MVP 默认首个可显示图像 |
| TGA | OIIO → sRGB 缩略图 | 通用图标 | alpha/origin、RLE 样本 |
| EXR | OIIO + OCIO display transform | 通用图标并显示错误 | scene-linear、data/display window、首个 RGB part、曝光 |
| MP4/MOV | Chromium 运行时直放 | FFmpeg WebM 代理 | 多 codec、旋转、VFR、seek、音视频时长 |
| AVI/WMV | FFmpeg WebM 代理 | 通用图标 + 外部打开 | 老旧 codec、损坏索引、超时/取消 |
| 音频（后续） | Chromium 播放 + FFmpeg 波形 | 外部打开 | peak/average 波形、长音频增量生成 |

测试样本不能只有“扩展名各一个”；每个视频容器至少覆盖多种内部 codec、无音轨/多音轨、旋转、VFR、损坏尾部和超长 GOP。每种图片至少覆盖 alpha、ICC、16/32-bit、超大尺寸和损坏输入。

## 实施顺序

1. 先落地统一 `MediaProbe` / `DerivativeJob` 接口和 utility process，所有结果按内容指纹缓存。
2. 接入 `ffprobe`、视频封面和 WebM 代理，先让 MP4/MOV/AVI/WMV 都有稳定降级路径。
3. 接入 sharp 的 PNG/JPEG/GIF/TIFF 元信息与缩略图。
4. 接入 OIIO + OCIO 的 EXR/TGA 路径，并把输入色彩空间假设显式展示给用户。
5. 完成 runtime native-playback capability cache，直放只是代理前的优化。
6. 最后加入联系表、AI 抽帧拼图、任务进度/取消/重试；音频波形沿用同一衍生物管线。

这个顺序可以最早形成“任何支持文件都能入库、能预览则预览、失败可诊断”的完整闭环，同时避免把 Chromium 的偶然 codec 支持或某个平台已安装的软件误当作产品能力。
