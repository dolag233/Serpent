# RAW 查看器高清图生成提速

2026-11-14，用户反馈真实 ARW 在查看器里从模糊卡片预览变清晰至少等待一分钟，并提供一张约 43 MiB 的相机样本供只读测试。

## 定位与方案

RAW 卡片先显示小图，查看器随后用 OIIO/LibRaw 解码传感器全幅，并写入 8 位 PNG。尺寸读取只有约 0.05 秒；主要开销在完整解码与输出。进一步用真实样本跑 Worker 时发现缓存匹配串有旧问题：期望 `raw-viewer-full;`，实际写入 `raw-viewer-full-srgb;`。每次再次打开都会判定缓存不匹配并重新解码。改为 JPEG 后第一次真实测试也复现了这个失配，第二次返回了新的 artifact ID；修正完整版本匹配后，第二次返回同一个 ID。

对同一张样本直接调用仓库内 OIIO，得到：

| 输出 | 耗时 | 文件大小 | 解码尺寸 |
| --- | ---: | ---: | --- |
| 原路线 PNG | 22.25 秒 | 40.5 MiB | 7952 × 5304 |
| JPEG 质量 90 | 5.15 秒 | 3.0 MiB | 7952 × 5304 |
| JPEG 质量 95 | 5.94 秒 | 5.5 MiB | 7952 × 5304 |

选择质量 95 的 JPEG，保留相同的全尺寸像素画布。JPEG 是有损显示图，100% 放大时可能与旧 PNG 存在细节差异；原始 ARW 文件不改。只有 RAW 的 `viewer_image` 从 PNG 换成 JPEG，卡片缩略图和其他 OIIO 格式仍走各自原路线。以下自动亮度、逐通道均值曲线是曾试用并被用户反馈否决的实验过程，不代表最终方案。

用户试用首轮结果后，反馈清晰图仍出现得慢且与卡片预览的颜色不一致。样本的 LibRaw 默认输出是 sRGB，但默认关闭自动亮度；缩小到同一尺寸后，内嵌相机 JPEG 平均 RGB 为 `[131,139,138]`，默认全幅输出为 `[89,96,95]`。加入 `raw:auto_bright=1` 后为 `[145,155,154]`，与内嵌 JPEG 的平均绝对像素差从约 43–45/255 降至 14–17/255。相机 JPEG 另有机内色彩风格，不能承诺逐像素一致；这里修正的是预览切换时最明显的曝光落差，sRGB 色彩空间标记保持不变。

解码参数含义见 [OpenImageIO RAW 插件文档](https://openimageio.readthedocs.io/en/v3.1.14.0/builtinplugins.html)。

在同一 ARW 上交替测量全幅解码与 JPEG 质量 95 输出：默认 AHD 加自动亮度约 5.14–5.47 秒，PPG 加自动亮度约 2.14–2.21 秒，PPG 产物约 7.09 MiB。两种全幅结果在三个 700×700 细节区域的平均绝对像素差为 0.76、0.76、1.14/255；缩小图肉眼检查没有明显差异。PPG 因而保留，固定自动亮度在后续多样本测试中被否决。其他 RAW 保留默认去马赛克与曝光设置。以上是解码命令耗时，不是应用端到端数字。

## 二次反馈：夜景预览与全图差异

用户提供夜景的「最终效果」和「预览图」截图后，对本地相机文件的内嵌 JPEG 缩小图逐张比对，找到对应 RAW。夜景预览截图平均 RGB 约 `[90,71,55]`，相机内嵌 JPEG 约 `[90,71,56]`；现有全尺寸 JPEG 平均约 `[51,42,33]`，与用户最终效果截图的 `[51,41,32]` 一致。因此问题来自相机 JPEG 和 LibRaw 全尺寸解码采用了不同呈现曲线；仅调 sRGB 标记或使用固定自动亮度无法解决。上面的白天样本结论不能推广到夜景。

第二轮方案以同一文件的内嵌 JPEG 为参考：Sharp 计算预览的三个通道均值；OIIO 用半尺寸、低分辨率且不写文件的探测，测出不同有界 gamma 值对 RAW 输出三个通道的影响；每个通道选择最接近预览的曲线，再做一次完整尺寸解码。探测约 0.4–0.7 秒，夜景完整解码加探测约 2 秒，白天约 3 秒。这个方案仍被用户反馈色调不对，因此不能把下面两张样本的改善当作画质验收。

夜景样本校准后全图平均 RGB 约 `[91,68,56]`，三个通道与内嵌 JPEG 的平均绝对像素差从约 `[43,34,28]` 降到 `[24,23,21]`（均以 255 为满量程）。白天样本的差从约 `[14,17,17]` 降到 `[10,11,13]`。校准使整体色调接近相机预览，但不能复现机内 JPEG 的局部动态范围优化、降噪和锐化；100% 细节仍来自 RAW 全尺寸解码。校准范围限制在 gamma 0.4–1.6，避免极端预览导致过度修正。

生成器版本使用同一个 `rawViewerGeneratorPrefix` 函数写入与匹配。最终 ARW 版本包含 `jpeg95-ppg-neutral-histogram1`，其他 RAW 版本包含 `jpeg95`。已有旧版本缓存在下一次查看时重建，之后重复打开复用新产物。这也防止之前“写入版本和期望版本不同”导致反复解码的问题再次出现。

## 三次反馈：多样本与开源实现对照

固定 `raw:auto_bright=1` 是一个根因：在一张暗背景样本上，相机 JPEG 以暗调呈现，固定自动亮度让未校准全图的平均 RGB 从约 `[69,68,63]` 抬到 `[173,171,160]`，像素差从约 30/255 升到 73/255；另一个日间样本则恰好需要提亮。因此自动亮度不能凭格式统一决定。前一轮逐通道 gamma 仅匹配 RGB 均值，无法区分「暗背景加局部高光」与均匀亮度的画面；该暗背景样本校准后仍有约 44/255 像素差、0.175 的亮度 CDF 距离。

对照开源一手资料：[OpenImageIO RAW 选项](https://openimageio.readthedocs.io/en/v3.1.14.0/builtinplugins.html) 表明 LibRaw 默认返回 sRGB，`raw:auto_bright` 是独立的曝光修正，`raw:use_camera_matrix` 对非 DNG 默认不强制使用。实测内嵌 JPEG 与旧全尺寸 JPEG 都被识别为 sRGB 且无 ICC；将用户截图对应夜景的 `raw:use_camera_matrix` 强制改为 3 后，输出逐像素完全相同。因此本例的问题在相机机内呈现曲线与 RAW 解码曲线，而非浏览器把 ICC 误读成另一色彩空间。[RawTherapee 的自动匹配](https://github.com/RawTherapee/RawTherapee/blob/dev/rtengine/histmatching.cc)以内嵌相机预览和中性 RAW 小图的亮度直方图拟合色调曲线；这里仅借鉴思路，独立实现有界双参数拟合，没有复制其 GPL 代码。[darktable 文档](https://docs.darktable.org/usermanual/development/en/lighttable/digital-asset-management/thumbnails/)也明确提醒机内 JPEG 预览与 RAW 软件渲染会不同。

最终方案对 ARW 查看器关闭固定自动亮度，保留 PPG；在内存中解码相机预览并计算 64 档亮度累计分布，OIIO 将半尺寸 RAW 缩小后用 64 次 `--rangecheck` 输出亮度累计计数，不写探测文件。对全局曝光倍率和共享 RGB 曲线做有界网格拟合，随后仅做一次全尺寸 JPEG 输出。共享曲线避免前一轮逐通道 gamma 对色相的扭曲。没有内嵌 JPEG、探测失败或数据无效时回退到中性 RAW 输出。卡片和其他媒体路线不变。

本机只读扫描 1593 张 ARW，按 12 个不同日期的代表图（预览亮度由暗到亮）做中性 RAW 与新曲线的全尺寸对比；CDF 距离是两张图 64 档累计亮度分布的平均绝对差，越小越接近。亮度 CDF 距离 **12/12 下降**，平均绝对像素差 **11/12 下降**。例如最暗一张 CDF `0.071→0.013`、像素差 `17.4→4.7`；最亮一张 CDF `0.157→0.017`、像素差 `39.6→5.2`。唯一像素差上升的样本 `59.1→66.1` 是竖拍，内嵌 JPEG 横放而 RAW 全图竖放；两张图按相同矩形强行缩放后无法逐像素对齐，其亮度 CDF 仍 `0.124→0.017`。另针对用户截图对应的夜景样本，以截图和预览做像素比对确认同一相机画面，新全图亮度 CDF 差约 `0.011`（旧逐通道均值曲线约 `0.045`）、RGB 平均像素差约 `[19,16,13]`/255；暗背景样本从固定自动亮度路线的 CDF `0.175` 降到约 `0.013`。这些只证明全局色调更接近内嵌预览，不等于复制相机的局部动态范围、降噪、锐化或每像素颜色。

针对审查提出的「亮度改善不等于颜色改善」，另将三张同方向、可对位样本缩至 128×85，独立转换至 CIE Lab 做平均像素差（左值为中性 RAW，右值为新曲线）：

| 样本类别 | ΔE76 | 色度平面差 Δab |
| --- | ---: | ---: |
| 用户截图对应夜景 | 18.25 → 9.84 | 8.71 → 6.15 |
| 暗背景 | 12.70 → 2.20 | 1.34 → 1.33 |
| 日间 | 17.63 → 4.32 | 2.45 → 2.27 |

三个样本的整体色差和色度平面差都未恶化，其中夜景色度也明显改善；但该指标仍受画面轻微裁切、相机局部处理和降噪影响，且不能代表全部相机型号。竖拍的方向不一致另记 `Serpent-6e41b6`，不把其错位像素差算作色彩结论。

计算方法：本机 Sharp 0.35.5 将相机内嵌 JPEG、中性 RAW JPEG、新曲线 RAW JPEG 各自强制缩至 128×85 的 RGB8；逐像素按标准 sRGB 分段传递函数线性化，再用 sRGB→XYZ 矩阵与 D65 参考白转换到 CIE Lab。ΔE76 为每个像素的 `√(ΔL²+Δa²+Δb²)` 后取全图算术平均，Δab 为 `√(Δa²+Δb²)` 后取全图算术平均。两列的左、右值分别使用同一内嵌 JPEG 对照中性 RAW 与新曲线 RAW。由于强制缩放不是几何配准，这些值只作相同方向、构图接近样本的相对比较。

这些数字是单个 OIIO 命令的本机样本测试，不代表应用端到端等待。Worker 的单槽 OIIO 队列或当前系统负载仍可能增加等待；独立 Electron 回归尚未执行，不能据此断言应用端到端等待已降到 2–3 秒。用户已表示当前速度可以接受，本轮重点是色调一致性。

| 需求 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| RAW 查看器用更快的全尺寸显示图，ARW 色调与卡片预览接近 | `src/worker/library-service.ts` `generateOiiOThumbnail`、`src/worker/raw-viewer-color-match.ts` | `tests/worker/video-exr.test.ts` RAW 并发、失败重试、媒体类型及真实样本的预览/全图 CDF 断言；`tests/unit/raw-viewer-color-match.test.ts` 探测边界与分布拟合 | 12 张多日期样本及用户截图对应夜景的命令与分布对比见上；真实 Electron 查看器未执行。 |
| 缓存能区分旧 PNG 和新 JPEG，重复打开不重解码 | `src/worker/library-service.ts` `ensureRawViewerImage` | 同一 Worker 定向测试验证并发与再次打开复用、修复旧失败 artifact；真实样本测试验证相同 artifact ID | 真实样本 Worker 测试通过；已有真实资源库路径未执行。 |

## 当次验证与限制

- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/raw-viewer-color-match.test.ts`：3 passed。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/video-exr.test.ts -t "RAW"`：三轮 12 passed、64 skipped；包含内嵌预览探测、卡片与查看器参数隔离、并发与重复打开缓存断言。
- 设置 `SERPENT_REAL_RAW_TEST_FILE` 为用户提供的样本，运行同一 Worker 文件的真实 RAW 定向测试：首轮首次因版本失配失败；修正后 1 passed、75 skipped，总耗时 9.15 秒。二轮 PPG 与自动亮度改动后再次通过：1 passed、75 skipped，总耗时 7.11 秒，其中测试主体 2.64 秒。该测试确认 JPEG 实际可解码、宽度超过 7000 像素、第二次打开 artifact ID 不变。
- 同一真实 RAW 定向测试分别以用户最初提供的白天样本和截图对应夜景样本运行：各 1 passed、75 skipped；测试主体分别 3.80 秒、2.94 秒，确认全尺寸 JPEG 可解码、三个通道均值与内嵌预览差小于 0.06、第二次打开复用相同 artifact。
- `npm run test:library-availability`：三轮 9 files / 238 passed / 1 skipped，约 80 秒。
- `npm run typecheck`：通过。
- `npx eslint src/worker/raw-viewer-color-match.ts src/worker/library-service.ts tests/unit/raw-viewer-color-match.test.ts tests/worker/video-exr.test.ts`：0 errors；Babel 仅提示大文件样式生成降级。
- `git diff --check`：通过。
- 用户当前有运行中的 Serpent 实例；未重建共享 `.vite`，也未启动可能抢占前台的 Electron E2E。
- 本次生成的三个基准图位于仓库忽略的 `test-results` 测试目录。清理前已核实只有本次生成的三个文件，但工具自动审批两次拒绝 `Remove-Item`（包括单文件删除），因此本轮无法执行强制清理；需要在允许删除时清理这三个测试产物。

以上列出的是前两轮的历史测试。第三轮新方案的当次验证：

- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/raw-viewer-color-match.test.ts`：3 passed；覆盖无文件探测、CDF 解析、同均值不同分布的拟合。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/video-exr.test.ts -t RAW`：12 passed / 64 skipped。初次运行因旧测试仍寻找 `--printstats` 失败，更新为新 CDF 路线后通过。
- 设置 `SERPENT_REAL_RAW_TEST_FILE` 后对四张真实 ARW 分别运行 `-t 'decodes a real RAW'`：用户截图对应夜景、日间、暗背景、竖幅均 1 passed / 75 skipped。竖幅初次运行暴露旧测试把横向宽度超过 4000 当作全尺寸条件；改成长边超过 4000 后通过。每张都检查 JPEG 可解码、卡片/全图亮度 CDF 距离 <0.06、比同源中性 RAW 更接近卡片、重复打开复用 artifact。加入相对中性基线断言后四张再次均通过。
- `npm run test:library-availability`：9 files / 238 passed / 1 skipped，约 106 秒。`npm run typecheck` 与变更文件 ESLint 通过。
- 未操作用户前台窗口，真实 Electron 查看器与 packaged 仍未执行。用户看过新生成的画面对比并表示「看起来效果还行」；完整应用旅程仍待验。三个原有的忽略基准图在本轮被重复用于对比；试验 OIIO 标准输出时还在工作区根目录误生成一个 23 字节的 `-` PPM 文件。已经核实其归属并尝试清理，但自动审批拒绝了删除；这些测试产物待允许清理。没有把图片或真实文件路径写入仓库。
