# 图像色彩空间读取现状调研

> 调研日期：2026-07-26
> 范围：Serpent 当前 MVP 图像格式，以及现有 sharp 0.35.3、OpenImageIO 3.1.12.0 + LibRaw/OCIO 路径。
> 目标：确认哪些格式能从文件读取 ICC/色彩空间信息，并找出实现色彩空间默认值与手动选择时的缺口。

## 结论摘要

1. **目前 Serpent 没有真正读取或持久化静态图像的色彩空间元数据。** sharp 的类型声明只保留尺寸、方向、页数和 GIF 时序；缩略图路径随后无条件调用 `.toColourspace('srgb')`。OIIO 路径虽然能接收 `oiio:ColorSpace`、ICC 和 EXR 头部属性，但当前只生成 PNG 缩略图，没有解析这些属性形成 `extracted_metadata`。
2. **可以可靠读取的格式**是 PNG、JPEG、WebP、TIFF 的 ICC profile（sharp 或 OIIO），PSD 的 ICC profile（OIIO），以及 EXR 的 `chromaticities`/`adoptedNeutral`/`colorInteropID` 等头部色彩描述（OIIO/OpenEXR）。RAW 由 LibRaw/OIIO 读取相机元数据，并按 `raw:ColorSpace` 输出到一个目标色彩空间，默认是 sRGB；这不是保留原始相机工作空间的 ICC 管线。
3. **固定或没有标准 profile 的格式**：JPEG/JFIF 按惯例是 sRGB 但仍可带 ICC；BMP 的 OIIO reader 明确假设 sRGB 且不支持 color-primary header；GIF、ICO、TGA 的 OIIO 文档没有列 ICC 属性，TGA只有 `oiio:ColorSpace`提示；SVG 当前直接由 Chromium 渲染，Serpent 没有读取 SVG 的 ICC/CSS 色彩描述。
4. **用户所说 PSD 线性预览问题有明确根因候选**：当前 PSD 走 `--ociodisplay`，没有把 OIIO 读到的 `ICCProfile` 转成显示输入空间；`--ociodisplay` 无 `from=` 且没有可用 `oiio:ColorSpace` 时会按默认 scene-linear 解释。因此“PSD 默认按文件声明色彩空间打开”需要先读 ICC，再映射/调用 ICC transform，不能只把 PSD 当作 scene-linear。

## 仓库现状

### 格式分派与当前处理

`src/shared/media-formats.ts:9-21` 将 PNG/JPEG/GIF/TIFF/WebP/SVG 分派给 sharp，将 BMP/ICO/PSD/EXR/TGA 及 DNG/CR2/CR3/NEF/ARW/RAF/ORF/RW2 分派给 OIIO/LibRaw。

`src/worker/library-service.ts:68-114` 的 `SharpInstance.metadata()` 类型没有 `space`、`hasProfile`、`icc` 等字段。`generateImageThumbnail` 在 `src/worker/library-service.ts:9420,9465` 无条件执行 `.toColourspace('srgb')` 后输出 WebP；因此即使底层 libvips 能读 profile，Serpent 也不会保存来源 profile 或空间名。

OIIO 图像分派在 `src/worker/library-service.ts:9358-9367`；EXR/TGA 被显式标记为 `scene_linear`，BMP/ICO/PSD/RAW 没有输入空间覆盖。`generateOiiOThumbnail` 在 `src/worker/library-service.ts:10457-10504` 只调用 `oiiotool --ociodisplay` 生成 PNG，不读取 `--info -v` 的 metadata，也不写入图像色彩元数据。现有 `extracted_metadata` 读取器（`src/worker/library-service.ts:7542-7593`）只接受视频 schema，静态图没有对应 artifact。

### 按格式核对

| 格式 | 文件可表达的色彩信息 / 官方 reader 能力 | Serpent 当前状态 | MVP 建议 |
|---|---|---|---|
| PNG | OIIO PNG plugin 读取 `oiio:ColorSpace`、`ICCProfile`，并可读 CICP（依赖 libpng 1.6.45+）。sharp `metadata()` 也返回 `space`、`hasProfile`、`icc`。 | sharp 快路径转换到 sRGB 并丢弃元数据；未持久化 profile。 | 读取 ICC/CICP；有 profile 时按 profile 默认显示，无 profile 按 sRGB，并在 UI 标注来源。 |
| JPEG/JPG | JPEG/JFIF 按惯例存 sRGB，但可携带 ICC；OIIO reader 读取 `ICCProfile` 以及 EXIF/IPTC/XMP/GPS；sharp 读取 `space`/`hasProfile`/`icc`。 | 与 PNG 相同，统一转 sRGB，未保留 profile。 | profile 优先；无 profile 使用 sRGB（不能把“JPEG 必然 sRGB”当作覆盖 ICC 的理由）。 |
| GIF | GIF plugin 文档只列帧、循环和 comment 等属性，没有 ICC/`oiio:ColorSpace`。 | sharp 只取静态页生成 sRGB WebP；没有颜色元数据。 | MVP 视为 sRGB/调色板颜色；不要伪造“已读取 ICC”。 |
| WebP | OIIO WebP reader 支持 `ICCProfile`；sharp `metadata()` 返回 `hasProfile`/`icc`。 | sharp 生成 sRGB WebP，profile 不落库。 | 与 PNG/JPEG 相同，保留并使用 ICC。 |
| SVG | SVG 颜色主要由 CSS/paint、`color-profile` 等 XML/CSS 语义决定；当前 Serpent 用 Chromium 原图查看，未调用 XML/CSS 色彩 profile 解析器。 | 双击查看已改为原始 SVG；没有 profile 提取或 OCIO 转换。 | MVP 先保持浏览器语义；记录“无统一文件级 ICC 读取”，后续若要 color-profile 需单独设计安全 XML/CSS 解析。 |
| TIFF/TIF | OIIO TIFF 用 libtiff，文档列 `ICCProfile`、EXIF/IPTC/XMP；sharp 也可返回 `space`/`hasProfile`/`icc`。TIFF 还可表达 CMYK/YCbCr/CIELAB 等 PhotometricInterpretation。 | 普通 TIFF 走 sharp 并转 sRGB；sharp 失败才走 OIIO。两条路径都未持久化 profile。 | 读取 ICC + PhotometricInterpretation；复杂 TIFF 统一由 OIIO 读取，避免两套颜色语义分叉。 |
| BMP | OIIO BMP reader 当前 `oiio:ColorSpace` 始终为 sRGB，明确不支持 color-primary header。 | OIIO 生成 PNG；未保存默认空间。 | 固定默认 sRGB，并显示“格式默认”，不要宣称可读取任意 BMP profile。 |
| ICO | OIIO 文档只列 bits-per-sample/PNG 标记，没有 ICC 或 `oiio:ColorSpace`；ICO 中的 PNG 子图不能假定 profile 被 OIIO 透传。 | OIIO 生成 PNG；无颜色信息。 | 固定 sRGB；若未来要读取内嵌 PNG profile，需显式选择子图并验证 reader 行为。 |
| PSD | OIIO PSD reader 可读 RGB/CMYK/multichannel/grayscale/indexed/bitmap，并列出 `ICCProfile` 及其派生属性；不支持 Lab/duotone。 | 当前只生成 OIIO PNG，未提取 ICC；没有 `from=` 输入空间，可能退回 scene-linear，正是用户观察到的风险。 | P0：提取 ICC profile 元信息；先建立 ICC→OCIO/ICC transform 的映射；默认按嵌入 profile，失败时明确显示“无法识别，按 sRGB/scene-linear”。 |
| EXR | OpenEXR 标准属性包括 `chromaticities`、`whiteLuminance`、`adoptedNeutral`，新版本还有 `colorInteropID`；OIIO 会把 EXR 任意头属性写入 `ImageSpec`。OpenEXR 明确指出库本身不执行显示色彩转换，应用负责转换。 | 当前所有 EXR 强制 `scene_linear`，忽略文件的 chromaticities/colorInteropID；多 part/多通道另有待办，本调研不改变范围。 | 读取每个 part 的通道与色彩头；可映射到 OCIO 时按文件默认，否则 scene-linear 但明确标注不确定；不要用一个全局 scene_linear 覆盖文件声明。 |
| TGA | OIIO Targa plugin 提供 `oiio:ColorSpace` 提示，但没有 ICCProfile；TGA 常见文件没有可移植的 ICC 容器。 | 当前强制 `scene_linear`，未读取 OIIO hint。 | 优先读取 `oiio:ColorSpace`；缺失时使用格式默认（通常 sRGB）并标注。 |
| RAW（DNG/CR2/CR3/NEF/ARW/RAF/ORF/RW2） | OIIO raw plugin 基于 LibRaw，读取 EXIF/makernotes；源码用 `raw:ColorSpace` 选择输出空间，并将默认设置为 `srgb_rec709_scene`，支持 sRGB、sRGB-linear、Adobe、ProPhoto、ACES、Rec2020 等（版本依赖）。这是相机 RAW 解码输出空间，不等价于文件携带的通用 ICC profile。 | 当前没有传 `raw:ColorSpace`，因此使用 LibRaw/OIIO 默认 sRGB 输出；没有把相机矩阵/ICC 信息写入 artifact。 | 记录解码目标空间和相机元数据；默认 sRGB，允许将来选择 RAW 输出空间。不要把 RAW 的默认 sRGB 输出误报为“读取到了源 ICC”。 |

## 官方依据

- [sharp 输入 metadata](https://sharp.pixelplumbing.com/api-input/)：`space`、`hasProfile`、`icc`、EXIF 等字段。
- [sharp 输出色彩行为](https://sharp.pixelplumbing.com/api-output/)：默认不保留 metadata 时会转换到设备无关 sRGB 并移除 ICC。
- [OpenImageIO ImageInput](https://openimageio.readthedocs.io/en/v3.0.7.0/imageinput.html)：`oiio:ColorSpace` 只是提示，读取像素不会自动做颜色转换。
- [OpenImageIO 色彩与 ICC 元数据规范](https://openimageio.readthedocs.io/en/v3.0.16.0/stdmetadata.html)：`oiio:ColorSpace` 的标准名称、`ICCProfile` 字节数组及派生属性。
- [OpenImageIO 3.2 bundled plugins](https://openimageio.readthedocs.io/en/latest/builtinplugins.html)：BMP/JPEG/OpenEXR/PNG/PSD/RAW/TGA/TIFF/WebP 各插件的实际 metadata 能力和限制（Serpent 使用 3.1.12.0，插件能力以对应版本为准，3.2 文档作为当前官方能力索引）。
- [OpenImageIO oiiotool 色彩管理](https://openimageio.readthedocs.io/en/v3.1.12.1/oiiotool.html)：`--ociodisplay` 会从 metadata 推断 `from=`，无提示时默认 scene-linear；`--iscolorspace` 只改解释、不改像素；`--iccwrite` 可导出 ICC 字节。
- [OpenImageIO rawinput.cpp](https://raw.githubusercontent.com/AcademySoftwareFoundation/OpenImageIO/main/src/raw.imageio/rawinput.cpp)：LibRaw/OIIO 的 `raw:ColorSpace` 分支、默认 `srgb_rec709_scene`、相机/EXIF metadata 读取。
- [OpenEXR 标准属性](https://openexr.com/en/latest/StandardAttributes.html) 与 [Technical Introduction – RGB Color](https://openexr.com/en/latest/TechnicalIntroduction.html)：`chromaticities`、`adoptedNeutral`、`colorInteropID` 的定义，以及显示转换由应用负责。

## 对 Serpent-aav1 / Serpent-aoj0 的实施建议

1. 新增统一的静态图像颜色 metadata 结构（建议包含 `declaredSpace`、`profileKind`、`profileDescription`、`iccProfileArtifact`、`confidence`、`source`），并把它作为 `extracted_metadata` 的一种 schema，而不是把颜色字段塞进 `asset_metadata`。
2. sharp 路径先调用 `metadata()` 保存 `space`/`hasProfile`/`icc`，再生成 sRGB 缩略图；缩略图可以是 sRGB，但查看器需要根据保存的 profile 重新走原图显示转换。
3. OIIO 路径调用 `oiiotool --info -v -a` 解析 `oiio:ColorSpace`、`ICCProfile:*`、EXR `chromaticities`/`colorInteropID` 和各 part 的 channel 信息；需要完整 ICC 字节时用受控临时文件配合 `--iccwrite`。
4. PSD 的默认策略应是“嵌入 ICC → 可识别映射 → 显示转换”；若映射失败必须显示未知/回退状态，不能静默当 scene-linear。EXR 则按 chromaticities/colorInteropID 推断，未知时才使用显式 scene-linear fallback。
5. 用户选择色彩空间应作用于“查看器显示 transform”，而不是重写原文件或缩略图缓存的源声明。色彩空间列表来自锁定 OCIO config 的 `--colorconfiginfo`；用户选择需进入衍生物缓存键，避免错误复用默认色彩空间的 PNG。
6. 将来做 RGBA 通道查看器时，颜色转换要先于通道显示：R/G/B 按输入色彩空间转换，A 保持线性/不做颜色变换；这与 OIIO 文档对 alpha/z 通道的约定一致。

## 2026-07-26 编码进展

`Serpent-aoj0` 已开始实现（EXR 多通道暂缓）：

- 新增 `src/worker/image-color-space.ts`，统一解析 Sharp 的 ICC/space 与 OIIO `--info -v -a` 输出，并映射到锁定 OCIO 配置的输入空间。
- OIIO 生成的静态图缩略图现在携带 `colorspace=<id>` 生成键；PSD 等已有旧缩略图在查看时会自动按检测到的 profile 重生成，用户也可在查看器选择 OCIO 输入空间。
- 预览协议新增 `colorSpace`（检测来源、是否线性、可选输入空间）；可通过 OIIO 重渲染的 Sharp 格式也开放手动重渲染，选择结果保存为资产级 override。
- 已用真实 PSD（包含 `Adobe RGB (1998)` ICC）验证默认检测为 `adobergb`，并验证切换到 `srgb_texture` 会重新生成；真实静图矩阵 2/2 通过。

## 当前验收边界

EXR 多通道选择、EXR `chromaticities` 到 OCIO 的完整映射、RAW 原始相机 profile 保留、SVG/GIF/ICO/TGA 的可靠 profile 读取仍未完成；这些不能以当前 `colorSpace` 字段的存在替代完整支持。视频目前只保存输入空间选择，FFmpeg 播放代理的实际色彩转换仍未接入。Windows/macOS 打包应用与人工色彩对照仍待验收。
