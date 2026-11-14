# 其他相机 RAW 格式的预览路径核查

2026-11-14。此记录是代码与一手资料核查；除 ARW 外，当前本机没有可读的真实相机 RAW 样本，因此不构成其他格式的解码、画质或性能验收。

## 当前路径

`src/shared/media-formats.ts` 声明 `.raw/.dng/.cr2/.cr3/.nef/.arw/.raf/.orf/.rw2`。这些格式均由 OIIO 的 LibRaw 插件处理。全尺寸查看图现在都输出 JPEG95；仅 ARW 采用 PPG、中性 RAW 加内嵌 JPEG 亮度分布拟合，其余格式保留 OIIO 默认去马赛克及曝光，因而不能推断它们也已解决卡片与全图色调切换问题。

卡片先尝试 `src/worker/raw-embedded-thumbnail.ts` 的经典 TIFF IFD JPEG 提取；无法提取时回退到完整 OIIO 解码。这个提取器明确不处理 CR3/ISO-BMFF 和其他厂商自定义预览容器，因此这些文件可能缺少快速卡片路径。`.raw` 扩展名本身也不能证明是相机 RAW；非相机数据会由 LibRaw 报错。

[OpenImageIO RAW 插件文档](https://openimageio.readthedocs.io/en/v3.1.14.0/builtinplugins.html)说明：默认输出 sRGB、默认关闭自动亮度、默认去马赛克为 AHD；`raw:use_camera_matrix` 默认只为 DNG 使用内嵌矩阵。各格式及机型的预览方向、内嵌 JPEG、白平衡和色彩矩阵不能只按扩展名推定。[LibRaw 支持说明](https://github.com/LibRaw/LibRaw)也强调支持范围取决于相机型号和具体 RAW 编码。

`tests/worker/real-raw-format-matrix.test.ts` 已有九种扩展名的外部真实样本矩阵，但目前未配置所需样本目录；它只验证卡片缩略图，且以 PNG 作为所有格式的预期，未覆盖现有的内嵌 JPEG 卡片和全尺寸 JPEG 查看图。不能把这条跳过的测试当成其他 RAW 格式已验证。

## 需要的验证

在独立提供并允许只读测试的真实样本上，按每种格式至少一张横幅、一张竖幅，以及暗场和日间场景核对：内嵌预览是否提取、方向与尺寸、卡片首显时间、全图首次时间、JPEG 解码成功、重复打开缓存、卡片与全图的亮度及色差。再按实测结果决定是否将色调匹配扩展到各格式；不直接复用 ARW 的 PPG 设置，尤其不能在未测量时假定所有传感器排列都适用。
