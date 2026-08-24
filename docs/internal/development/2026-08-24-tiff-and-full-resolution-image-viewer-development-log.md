# TIFF 缩略图与非原生图像全分辨率查看开发记录

## 背景

用户反馈部分大型 TIFF 的缩略图生成失败。日志显示失败发生在 Sharp/libvips 读取 TIFF 自定义元数据时：自定义 tag 的累积分配超过 50 MiB，随后部分超大图还触发 Sharp 的像素安全上限。失败任务占用共享 Worker 的媒体调度，造成后续请求超时。普通 8K TIFF 能成功并不能覆盖这种带大型私有元数据的文件。

同时，TIFF、BMP、TGA、PSD、EXR 等当前支持但 Chromium 不能直接渲染的图像，查看器此前会复用卡片缩略图。查看器现在需要使用源文件解码得到的全分辨率图像；PNG、JPEG、GIF、WebP、SVG 仍直接读取源文件。

## 实现

- 新增 `imageViewerDecoderForExtension`，把 TIFF/TIF 的查看解码器明确路由到 OIIO，并保留其它格式的缩略图解码选择。
- TIFF 缩略图不再先调用 Sharp 再等待失败回退，而是直接由 OIIO 生成 512px 卡片图，绕过 libvips 对自定义 TIFF tag 的分配上限。
- 新增 OIIO `viewer_image` 单飞生成路径。BMP、TIFF、TGA、PSD、EXR 等非原生图像在查看器中使用源分辨率 PNG 解码图；RAW 和 ICO 继续使用已有的专用全尺寸路径。
- 查看图的颜色空间和 EXR subimage/plane 写入生成版本，切换选项时会失效旧查看图并重新生成，避免显示上一种设置的像素。
- 卡片仍使用有界缩略图，不会因为打开查看器而替换卡片布局或上传源文件。

## 验证

- `npx eslint src/shared/media-formats.ts src/worker/library-service.ts tests/unit/media-formats.test.ts tests/worker/video-exr.test.ts tests/worker/real-static-format-matrix.test.ts`：通过。
- `npx tsc --noEmit --pretty false`：通过。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/video-exr.test.ts -t "routes TIFF thumbnails directly through OIIO|uses a full-resolution OIIO viewer artifact"`：2 passed。
- 使用仓库内置 OIIO 二进制运行 `tests/worker/real-static-format-matrix.test.ts`：1 passed、1 skipped；BMP、TIFF、TGA、EXR、ICO 和 SVG 的真实格式矩阵通过，且非 SVG 查看图使用独立全尺寸工件。
- 同一 Worker 文件的完整定向运行 52 项中 54 项通过；4 个既有媒体组件自动修复/探测测试因测试环境的组件探针状态失败，与本次 TIFF/查看图断言无关，需单独处理，不能记为本次功能通过。

## 待人工验收

- 使用带大型私有元数据的 TIFF，确认缩略图能生成且后台任务不再出现 Sharp 的 TIFF 内存上限错误。
- 分别打开 TIFF、BMP、TGA、PSD、EXR，确认查看器最终显示源分辨率解码图；切换 EXR plane 与色彩空间后确认像素随设置更新。
- 在 Windows 与 macOS 的打包应用中复验；当前未执行 packaged/Windows 人工验收。
