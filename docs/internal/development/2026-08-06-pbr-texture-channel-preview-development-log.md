# PBR 贴图通道预览开发日志

> 工单：`Serpent-61je.2`
> 日期：2026-08-06
> 范围：MVP 后只读能力；不修改源文件，不自动组装模型材质槽。

## 根因与范围

此前图像查看页对 PBR 贴图只按普通图片显示，文件名中的通道语义没有被识别，导致粗糙度、光滑度、金属度和高度贴图无法按中性通道方式检查。该增量采用文件名识别作为保守入口：无法可靠识别的普通图片保持原有预览，不因扩展名或任意路径被误判。

本次支持：

- Base Color / Albedo：保持颜色预览；
- Normal：保持 RGB 法线颜色预览；
- Roughness、Metallic、Height / Displacement：使用灰度预览；
- Smoothness / Glossiness：使用反转灰度预览，明确其与 Roughness 的反向关系；
- Metallic-Roughness 打包贴图：保持原始 RGB，并明确这是打包通道；
- 查看页显示 Info 说明，源文件只读且不被重写。

高分辨率图像继续复用现有 preview/MIP 升级与 `ZoomableImage` 缩放链路，不引入第二份缓存或任意文件读取能力。

## 实现

- `src/renderer/pbr-texture-channel.ts`
  - 新增 PBR 通道别名、显示模式和文件名分类器；
  - 分类优先识别 `metallicRoughness` 打包贴图，再识别独立通道；
  - 纯函数返回 CSS 显示过滤策略，未识别文件返回 `null`。
- `src/renderer/AssetPreviewModal.tsx`
  - 仅对图像资产按显示名计算通道 presentation，并传入图像查看器。
- `src/renderer/zoomable-preview-image.tsx`
  - 在实际解码的预览图上设置通道数据属性和中性显示过滤；
  - 使用共享 `Notice tone="info"` 显示通道名称与只读说明。
- `src/renderer/styles.css`
  - 增加顶部 Info 通知定位规则，限制宽度，不影响平移/缩放操作。
- `src/renderer/i18n/catalogs/zh-CN.ts`
  - `src/renderer/i18n/catalogs/en.ts`
  - 增加通道名称、显示模式和源文件不变说明。

## 自动化验证

- `node scripts/run-vitest-with-electron.mjs run tests/unit/pbr-texture-channel.test.ts`
  - `1 file passed / 9 tests passed`。
- `npm run typecheck`
  - `tsc --noEmit && tsc -p tsconfig.extension.json` 通过。
- `node scripts/run-e2e.mjs tests/e2e/pbr-texture-preview.test.ts`
  - 首次复跑发现 7 个相同像素 fixture 触发真实内容重复对话框，资产卡片不会在未处理
    冲突时出现；同时将导入卡片等待从 5 秒提升到 15 秒。fixture 现使用不同背景值，
    保留真实导入路径而不绕过冲突 UI。修复后 `1 passed (4.4s)`，测试断言每个通道图片
    `complete && naturalWidth > 0`、`data-pbr-channel`、实际计算样式和 Info 文案。
- `node scripts/run-e2e.mjs tests/e2e/media-preview.test.ts`
  - `2 passed / 1 skipped`；既有图片查看、实际解码、缩放与视频错误路径未回归。
- `npm run package`
  - 未执行到打包阶段；`prepackage` 的 `scripts/media-binaries.mjs verify` 以
    `Media bundle darwin-arm64 is not promoted for release` 阻断。当前 HEAD 没有
    packaged 证据，不能将该项记为通过。

## 验收边界

当前只提供基于文件名的只读预览识别，不宣称解析图片内容后自动推断通道，也不提供通道编辑、导出或模型材质槽绑定。Computer Use、packaged 和 Windows 尚未执行，交由 `PBR-001` 人类验收项跟踪。
