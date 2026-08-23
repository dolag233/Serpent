# RAW/ARW 预览与 Inspector 相机元信息开发记录

## 基本信息

- 工单：`Serpent-a6f74d`
- 分支：`dev`
- 基线：`84770f5`（CANVAS-039/040 已提交）
- 开始时间：2026-08-23
- 当前状态：已修复重复生成与查看器代理问题，等待人工视觉验收
- 最后更新：2026-08-23

## 目标

修复相机 RAW 资产生成缩略图时错误使用 OCIO 显示变换导致的
`OIIO_COLOR_TRANSFORM_FAILED`，并让 `.ARW`、`.RAW` 及已有 RAW 扩展在 Inspector
显示文件与相机拍摄信息。无可读 EXIF 时仍应保留成功生成的预览。

## 已完成的垂直行为

- `.raw` 纳入共享 RAW/OIIO 格式注册表，使用 `image/x-camera-raw` 产品 MIME。
- OIIO 处理 RAW 时走 LibRaw 默认 sRGB 输出，不再追加显式 OCIO `--colorconfig` /
  `--ociodisplay`；EXR、TGA 等非 RAW OIIO 格式保持原有变换链路。
- Worker 通过 `exifr` 受控提取 TIFF/EXIF/IPTC/XMP，归一化到有限字段白名单，
  再写入 `extracted_metadata` artifact；任意原始 EXIF 键和本地绝对路径不跨 IPC。
- Renderer 对单选 RAW 资产异步读取该 artifact，并显示类型、大小、位置、日期、
  分辨率、作者、相机、镜头及曝光相关字段，支持中英文和缺失字段渐进出现。
- Inspector 现有视频/音频/GIF 元数据请求行为保持不变。
- RAW 卡片继续使用 512px `thumbnail`；查看器首次打开时生成独立的
  `viewer_image` 全尺寸 PNG，不再把卡片缩略图当作查看器内容。
- `viewer_image` 生成按资源库 revision 单飞；同一文件快速打开不会并发写入两条
  当前 artifact。
- RAW 不再进入通用的颜色空间差异重生成判断。此前生成器版本是
  `raw-default-srgb`，但判断逻辑只接受 `colorspace=...`，导致每次查看都失效并
  重建缩略图，日志中反复出现 `OIIO_GENERATION_FAILED` 和
  `UNIQUE constraint failed: revision_artifacts.revision_id, revision_artifacts.kind`。
  现在 RAW 的默认 sRGB 解码与可选颜色空间重渲染路径明确分离。
- RAW Inspector 详情行改用普通资产元数据使用的 `.metadata-list`，不再使用独有的
  右对齐布局。

## 关键实现决定

1. RAW 不复用通用 OCIO 显示变换：LibRaw 已负责相机 RAW 的默认显示输出，
   继续套用当前配置会触发用户报告的颜色转换错误。
2. 相机元数据复用现有 `extracted_metadata` 协议和 artifact 生命周期，避免新增
   任意文件读取接口；schema 以加字段方式兼容旧视频/GIF artifact。
3. 元数据提取是 best-effort。解析失败只跳过元数据 artifact，不使已成功的 PNG
   缩略图失败。
4. Inspector 值使用固定字段到翻译键的映射，路径只作为已持久化的相对位置值显示，
   不把 Worker 路径或 SQL 能力暴露给 Renderer。

## 测试与证据

- 定向单测：`npx vitest run --config vitest.config.ts
  tests/unit/raw-image-metadata.test.ts tests/unit/media-formats.test.ts
  tests/unit/video-metadata-format.test.ts` 通过，3 个文件、19 项通过。
- Worker RAW 回归：`node scripts/run-vitest-with-electron.mjs run --config
  vitest.config.ts tests/worker/video-exr.test.ts -t "RAW"` 通过，4 项通过；覆盖
  RAW 调用不含 OCIO 参数、PNG artifact ready、相机元数据 artifact ready 及读取、
  无 EXIF 仍成功和旧失败重排队。
- `npm run typecheck`：通过（主 tsconfig 与 extension tsconfig 均退出 0）。
- `npm run test:library-availability`：通过，9 个文件、196 项通过、1 项跳过；原生
  模块 ABI 与 FTS5 probe 均通过。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts
  tests/worker/video-exr.test.ts tests/unit/raw-image-metadata.test.ts
  tests/unit/media-formats.test.ts`：RAW 查看器新增并发测试通过；完整文件为
  47/51 通过，4 个既有媒体组件自动修复/探测节流用例
  失败，RAW 定向用例全部通过，失败未归因于本次 RAW 路由。
- `npm run lint`：未全绿；报告 `session-log.ts` 1 个既有错误、`library-service.ts`
  4 个既有错误和 `App.tsx` 1 个既有 warning；本次修改文件（排除该既有大文件）
  定向 ESLint 通过。
- 真实 RAW Electron E2E：
  `$env:SERPENT_REAL_RAW_TEST_FILE='E:\\Media\\Images\\Photos\\2026\\2026-02-09\\ZKH09734.ARW';
  node scripts/run-e2e-isolated.mjs tests/e2e/raw-image-preview.test.ts` 通过（1 项）。
  覆盖真实导入、缩略图解码、Inspector 相机元信息和查看器图像解码。
- 当前提交 packaged、Windows 和人工视觉验收仍待执行，不能以自动化结果代替。

## 重要文件

- `src/worker/library-service.ts`
- `src/worker/raw-image-metadata.ts`
- `src/renderer/InspectorPanel.tsx`
- `src/renderer/raw-image-metadata-format.ts`
- `src/shared/asset-types.ts`
- `src/shared/media-formats.ts`
- `tests/worker/video-exr.test.ts`
- `tests/worker/real-raw-format-matrix.test.ts`
- `tests/unit/raw-image-metadata.test.ts`
- `docs/internal/qa/human-acceptance-checklist.md`

## 已知风险与后续

- OIIO/LibRaw 的真实 ARW/RAW 解码必须在带真实相机样本的环境中确认，当前未宣称
  已解决真实媒体旅程。
- Inspector 当前通过现有 extracted-metadata 轮询读取；元数据生成较慢时先显示基础
  `AssetSummary`，待 Worker artifact ready 后补齐详细行。
- 已完成一次独立双轴审查：未发现阻断级架构/规格问题；审查提出的元数据尺寸
  nullable、无 EXIF、旧 RAW 失败重排队范围和 Flash 枚举细化已在当前工作树补齐。
