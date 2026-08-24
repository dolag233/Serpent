# 媒体格式支持调研

> 2026-08-24。本文用于规划格式支持工单，不代表下列格式已经完成 Windows/macOS 的最终验收。格式是否“支持”必须同时验证导入识别、缩略图、查看器解码、格式过滤，以及两个平台的实际构建。

## 当前注册表

当前共享媒体格式注册表（`src/shared/media-formats.ts`，音频另由 `src/shared/audio-media.ts` 注册）包含：

- 图像：PNG、JPEG、GIF、TIFF、WebP、SVG、BMP、ICO、PSD、EXR、TGA，以及 DNG、CR2、CR3、NEF、ARW、RAF、ORF、RW2 等 RAW。
- 视频：MP4、MOV、AVI、WMV、WebM、MKV、M4V。
- 音频：WAV、MP3、OGG/OGA、M4A、AAC、FLAC、Opus（音频的具体预览能力仍应按解码路径逐项验证）。
- 3D：FBX、OBJ、glTF、GLB、STL。
- 文档/网页：PDF、HTML、HTM。

### 当前图像查看器路径

- PNG、JPEG、GIF、WebP、SVG 可以直接由 Chromium 读取源文件（SVG 保留矢量语义）。
- BMP、TIFF、TGA、PSD、EXR 和 RAW/ICO 不能依赖 Chromium 的源文件 MIME。它们的卡片仍使用有界缩略图，但双击查看会生成独立的全分辨率解码图；EXR 的 plane 和色彩空间属于该查看图的生成条件。
- TIFF 缩略图直接使用 OIIO，避免 Sharp/libvips 读取大型私有 TIFF 元数据时触发内存分配上限。普通文件与带大型自定义 tag 的 TIFF 都必须走同一条安全路径。

AVIF 当前不在注册表中，已建立工单 `Serpent-b906b1`。

## 建议优先级

### P1：优先补齐的图像格式

- **AVIF（`.avif`）**：现代高压缩图像，支持透明度和动画；需要走图像源图/缩略图/查看器链路，不应因为它是图像而自动生成视频类 proxy。MDN 将 AVIF 列为 `image/avif`，并指出其适合静态和动画图像：[Image file type and format guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types)。对应工单：`Serpent-b906b1`。
- **HEIF/HEIC（`.heif`、`.heic`）**：手机和摄影工作流常见，通常包含 HEVC 编码，需要确认打包后的 Sharp/OIIO/系统解码器是否具备可分发的解码能力，以及许可和跨平台一致性。HEIF 属于 ISO/IEC 23008-12 体系，MPEG/ISO 的 MIAF 说明见：[ISO/IEC 23000-22](https://www.iso.org/standard/87576.html)。
- **APNG（`.apng`）**：设计素材和动图工作流中会遇到。需要明确查看器是显示首帧、播放动画，还是只提供静态缩略图；不能把 APNG 当作普通 PNG 后悄悄丢掉动画帧。W3C PNG 第三版同时登记 `image/png` 与 `image/apng`，并说明 APNG 已广泛实现：[PNG Specification (Third Edition)](https://www.w3.org/TR/png-3/)。

### P1/P2：影视与声音工作流

- **视频容器**：MTS/M2TS/TS（摄像机和蓝光）、MXF（影视制作）、OGV（开放格式）、FLV/3GP（旧项目）。这些格式是否值得加入，取决于 FFmpeg 构建是否包含对应 demuxer/codec；应先做“容器可读性 + 联系表 + 查看器播放”的矩阵，不要只凭扩展名放行。
- **音频**：AIFF/CAF（macOS/音频制作）、WMA（Windows 旧项目）、AMR（移动端录音）、MKA（Matroska 音频）。优先确认波形、时长和查看器播放；音频不应被误判为图像 proxy。

### P2：游戏美术与高端图像工作流

- **JPEG XL（`.jxl`）**：适合高质量、无损和 HDR 工作流，但运行时和打包解码支持仍需确认。JPEG Committee 将其定义为 ISO/IEC 18181 图像编码系统：[JPEG XL documentation](https://jpeg.org/jpegxl/documentation.html)。
- **DDS（`.dds`）与 KTX/KTX2（`.ktx`、`.ktx2`）**：游戏纹理、立方体贴图和压缩 GPU 纹理常见。支持时应决定是否显示指定 mip/array/layer，并提供清晰的“纹理预览”语义；不能只把二进制文件标成普通图片。
- **JPEG 2000（`.jp2`、`.j2k`）**：影视、扫描和出版仍会出现，但应先确认 OIIO/LibTIFF 等后端在两个桌面平台均可用。

### P2：其他 3D/交换格式

- **PLY、DAE/Collada、3MF、USD/USDZ**：分别对应扫描、传统 DCC 交换、打印和 Apple/影视 资产。建议在现有 FBX/OBJ/glTF/STL 体验稳定后再排期，并为材质、动画、坐标系和外部纹理缺失定义降级行为。

## 实施原则

1. 先在共享注册表登记扩展名，再同步导入识别、格式过滤、缩略图和查看器分支；不要只改某一个列表。
2. 明确三种能力：源文件查看、缩略图/派生图、播放或交互查看。图像格式通常不需要媒体播放 proxy；Chromium 不认识的图像由对应解码器生成全分辨率查看图，不能把卡片缩略图冒充为原图查看。
3. 每个格式至少覆盖：正常文件、透明度/动画或多帧（如适用）、损坏文件、非 ASCII 路径、长文件名，以及 Windows/macOS 打包运行时。
4. 对需要专用解码器、系统组件或许可判断的格式，先做能力探测和小样本验证，再决定是否加入产品级注册表；“后端库理论上能读”不等于 Serpent 已支持。
5. 格式过滤必须从共享注册表生成，避免导入支持后过滤器遗漏；新增格式同时补充自动化测试和人类验收条目。

## 结论

当前最直接的下一步是完成 `Serpent-b906b1` 的 AVIF 全链路支持；随后按 HEIF/HEIC、APNG 的优先级验证，再根据真实用户素材决定影视容器、音频和游戏纹理格式。JPEG XL、DDS/KTX2 以及更多 3D 交换格式应在确认解码器、跨平台打包和查看器语义后分别立项。
