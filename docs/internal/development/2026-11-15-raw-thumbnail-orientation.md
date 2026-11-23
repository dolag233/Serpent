# RAW 缩略图方向

工单 Serpent-b2a0g，对应 GitHub #57。用户已接受此前亮度修复，本轮处理竖拍 RAW 缩略图横向显示。

根因：快速卡片路径抽取 TIFF RAW 内嵌 JPEG，只调用 JPEG 自身的自动旋转；部分相机仅在外层 TIFF IFD 写 Orientation，JPEG 本身没有该字段，故方向丢失。

处理：有界 RAW 解析器同时返回预览 IFD 或主 IFD 的合法 1–8 方向。优先尊重 JPEG 自身有效方向；仅缺失时补充极小的 EXIF 方向段，由既有 Sharp rotate 处理旋转/镜像，不增加一次像素重编码或调整色彩。原来的 JPEG 提取 API 继续提供原始字节给色调探测。同步保存有方向的源尺寸，缓存尺寸缺少新鲜元数据时按已解码预览校准，避免重复交换宽高。生成器升级为 raw-embedded-jpeg@2，复用已有过期生成器入队机制。

证据：

- `npx vitest run tests/unit/raw-embedded-thumbnail.test.ts`：7 passed，含大小端方向读取与非法方向忽略。
- `node scripts/run-vitest-with-electron.mjs run tests/worker/video-exr.test.ts -t 'orients embedded RAW|already oriented camera|uses the embedded RAW'`：10 passed / 75 因定向筛选未执行；真实 Sharp 解码，覆盖 8 种方向的尺寸和像素区域、JPEG 已转正不重复旋转、旧生成器重新入队、既有色调路径。
- `npm run test:library-availability`：9 files / 238 passed / 1 skipped。未改 schema、库生命周期或协议。
- `npm run typecheck` 与相关 ESLint 通过，diff 检查通过。
- 只读抽样用户先前提供的照片目录：171 张 ARW 中有 4 张外层方向为竖拍，4 张 JPEG 均缺方向；修复路径在内存中真实解码为竖图。首批 30 张均为横拍，扩大同目录样本后找到竖拍。未修改源文件或写入测试媒体。

| 需求 | 实现 | 自动化 | 人工/平台证据 |
| --- | --- | --- | --- |
| RAW 外层方向传递与镜像 | raw-embedded-thumbnail.ts；library-service.ts 的 tryGenerateRawEmbeddedThumbnail | 上述解析器与 Worker 用例 | 4 张真实竖拍 ARW 内存解码通过；用户界面待验 |
| 已转正预览不重复旋转、尺寸与缓存更新 | 同上；生成器版本校验 | already oriented camera 用例 | 用户旧库待验，macOS/packaged 未执行 |

本轮属于现有媒体修复，由实现者自查；未引入新协议、库迁移或跨进程能力。当前没有提交或发布。

## 完整应用回归与后续元数据修正

隐藏 Electron 首轮已通过竖图像素断言，但暴露后台元数据任务随后重新写入传感器宽高，导致排列尺寸仍可能变回横向。现统一在 persistRawImageMetadata 写入显示尺寸时处理方向，并兼容元数据解析器的数字及 Rotate 90/270 CW 等翻译值；单独的提取任务和缩略图附带提取使用相同规则。Worker 方向用例增加 extracted_metadata 尺寸断言，避免只修图像、不修布局。

完整应用使用隔离 userData/临时库和只读源文件副本；E2E 已增加可选的竖拍预期，验证图片 complete/nonzero 且自然高度大于宽度，以及技术元数据宽高为竖向。此前测试固定假设 ISO 和作者适用于原来的单一样本；本次竖拍样本不符合该假设，先后在这些断言失败。改为允许显式传入预期 ISO/作者（保留旧默认断言）后，使用同一竖拍样本完成导入、缩略图、元数据和高清查看器：1 passed。未使用跳过断言规避失败。

最终定向单测 2 files / 14 passed；Worker 定向 10 passed；后续元数据修正后再次完整运行资源库底线：9 files / 238 passed / 1 skipped。类型与相关 lint 通过；未运行性能或发布套件。真实窗口前台视觉、macOS、其他厂商真实 RAW 与 packaged 未验证。

测试库和副本由测试 finally 清理。本轮三次 Playwright 输出目录的清理命令被自动审批以 blocked by policy 拒绝，未尝试绕过；这些输出尚有残留且不得提交（测试输出可能含样本元数据）。`.vite` 为 E2E 构建产物，未作为发布证据。
