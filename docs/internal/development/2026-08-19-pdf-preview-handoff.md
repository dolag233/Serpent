# Handoff: PDF 查看器「百叶窗」问题未解（Serpent-8ca259 续）

> 交接时间：2026-08-19
> 交接人：前序实现 agent（缩略图已修复并获用户确认；查看器问题未解决，用户明确「问题仍旧」）
> 工单：`Serpent-8ca259`（P1, feature, in_progress）— PDF 与 HTML 以浏览器方式预览并生成缩略图
> 测试文件：用户提供 `E:\Resources\Serpent\小型资源库\Assets\ReSTIR DI.pdf`（50MB，17 页，ACM 论文）
> 分支：dev（所有改动未提交，见文末清单）

## 一、当前状态总览

| 项 | 状态 | 用户确认 |
|---|---|---|
| PDF 卡片缩略图（第 1 页） | ✅ 已修复 | ✅「重大喜讯：封面正常了」 |
| 缩略图 Worker 崩溃 | ✅ 已修复（4 层） | — |
| PDF 查看器（双击打开） | ❌ 未解决 | ❌「打开查看仍然是百叶窗效果」「问题仍旧」 |
| HTML 部分 | 未动 | 未测 |

用户对查看器的反馈原文（按时间顺序）：
1. 「像个百叶窗一样，一行一行的长条圆角矩形，上面一半是黑色，下面一半是白色」
2. 「百叶窗一共有34行。总感觉和总页数相关」（34 = 2×17）
3. 「现在是17行了。我估计是每页的大小太小了。我需要pdf每页的宽度都能抵满查看界面的宽度，然后高度自动缩放，然后能够向上下滑动查看其他页的内容」
4. 「没有改善」
5. 「还是百叶窗啊...就是因为每页的高度被裁剪了呗，每个条纹还是圆角矩形」
6. （观察探针窗口后）「你的探针也是百叶窗。继续」
7. 「问题仍旧」

## 二、已修复 ✅（缩略图链路，用户已确认）

### 2.1 缩略图不入队（`src/worker/library-service.ts` ~21479）
`enqueueThumbnailJobs` 的 `supportedExtensions` 白名单只有 image/video/audio/model。用户库中该 PDF **无任何 artifact 行**（连 failed 都没有）。已加 `'pdf', 'html', 'htm'`。新增回归单测 `tests/worker/thumbnails.test.ts`（enqueues generate_thumbnail jobs for PDF and HTML document assets）。

### 2.2 Worker 崩溃链 4 层（Electron UtilityProcess 里 pdfjs 无法工作）
`process.type='utility'` 使 pdfjs 的 isNodeJS 判定（`process.versions.electron && process.type !== "browser"`）失效 → 走浏览器代码路径；且 Vite 打包（CJS）断了 pdfjs `node_utils` 的 `createRequire(import.meta.url)` bootstrap。逐层崩溃：`DOMMatrix` → `GlobalWorkerOptions.workerSrc` → `Path2D`。修复：
1. `src/worker/index.ts` ~130：启动时 `Object.defineProperty(process, 'type', { value: undefined, configurable: true })`（UtilityProcess 里可覆盖，已实测）
2. `generatePdfThumbnail`：DOMMatrix/DOMPoint/DOMRect/**Path2D/ImageData** 用 `@napi-rs/canvas` 导出 polyfill（pdfjs 模块级 `new DOMMatrix`/`new Path2D` 无条件引用）
3. 显式 `GlobalWorkerOptions.workerSrc = pathToFileURL(createRequire(__filename).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href`（打包后默认相对路径失效）
4. `getDocument({ ..., CanvasFactory: NapiCanvasFactory })`（**注意：6.x 选项名是大写 `CanvasFactory`，且需要是类**，pdfjs 会 `new CanvasFactory({ownerDocument, enableHWA})`）

### 2.3 PDF 内嵌字体被 CSP 拦（`index.html`）
`font-src 'self'` 拦 `data:` 字体 → pdfjs 文字全不渲染（页面上只剩图 →「上黑下白」）。已改 `font-src 'self' data:`。

### 2.4 查看器 34→17 行（`src/renderer/PdfViewerSurface.tsx`）
原实现把渲染页 `host.append(wrap)` 追加到所有占位符之后 → 每页两个元素。已改 `placeholder.replaceWith(wrap)` 原位替换 + 占位符数组定位页码。**用户确认从 34 行变 17 行，此修复生效。**

## 三、未解决 ❌：查看器「百叶窗」

### 3.1 探针证据（关键矛盾）
调试探针 `tests/e2e/pdf-repro-probe.test.ts`（**临时文件，引用了用户 PDF 路径，勿提交**）在 production build + 用户 PDF 下多次全绿：
- 17 个 wrap、**0 个占位符残留**、17/17 页渲染、meta「已加载 17/17 页」
- 每页 canvas bitmap 1380×1786，CSS 显示 1396×1807（铺满 1428 视口）
- 控制台 **0 错误**、0 page error（CSP 字体修复后）
- 页面内容像素分析：白底（235-242）+ 部分页面顶部深色图（183-222），与论文版式一致
- 但用户（包括观察探针弹出的窗口）看到的仍是「圆角矩形条纹、高度被裁剪」

**DOM 层面完全正常，用户所见仍是百叶窗 → 问题在视觉/几何层面，不在 DOM 结构。**

### 3.2 待验证假设（按可能性排序）
1. **文字是否真的渲染了（未验证！）**：页面亮度 227-242 偏高。若文字缺失，页面 = 「深色图 + 空白」= 用户描述的「上黑下白条纹」。探针的 ink ratio（暗像素占比）分析**两次都没跑完**（第二次探针 16.1s 时页面提前关闭 flake）。必须验证：文字页暗像素占比应 3-10%，若 <1% 则文字没渲染 → 查渲染器字体链路（pdfjs browser build 在 vite bundle 下的 FontFace/data: 字体加载、CSP 是否真生效）。
2. **页面高度 > 窗口可视高度 → 「被裁剪」观感**：1396×1807 的页面在 ~900px 可视区里每页只能看一截。用户要求「宽度抵满 + 高度自动缩放」——可能真实期望是 **fit-inside（宽高都不超视口）** 而非纯宽度铺满。若假设 1 排除，此假设概率最大——考虑 `scale = min(hostWidth/pageW, hostHeight/pageH)` 且滚动翻页。
3. **DPR 占位符高度跳变（已修，未验证用户环境）**：占位符高度曾用含 DPR 的 scale（比页面实际 CSS 高度高 25-50%），替换瞬间页面「缩水」。已改为 `cssScale()`（不含 DPR）。用户 Windows 缩放可能是 125%/150%。**用户是在此修复前反馈的「问题仍旧」，此修复后用户尚未复测。**
4. **dev 模式与 production 差异**：用户跑 `npm start`（dev），探针跑 production build。若用户重启后仍复现而探针绿，需对比 dev 渲染器行为。

### 3.3 探针 flake（调试干扰）
探针第二次运行时页面 16.1s 提前关闭（`page.waitForTimeout: Target page closed`），app log 被 `Select-Object` 过滤器吞掉未捕获。重启探针时注意：
- 探针在 finally 里有 app log tail dump（`PROBE APP LOG TAIL`），但**不要用管道过滤器**跑探针（会吞掉输出），直接看任务输出文件
- 每次探针跑完检查是否有遗留 electron 进程（`Get-Process electron | Where StartTime > 探针启动时间`）并清理，避免僵尸实例干扰下次运行

## 四、代码改动清单（全部未提交，dev 分支）

| 文件 | 改动 |
|---|---|
| `src/worker/library-service.ts` | supportedExtensions + PDF 缩略图 4 层修复（polyfill/workerSrc/CanvasFactory）+ 注释 |
| `src/worker/index.ts` | process.type 中和 |
| `index.html` | CSP `font-src 'self' data:` |
| `src/renderer/PdfViewerSurface.tsx` | replaceWith 原位替换 + cssScale/DPR 分离 + 实时宽度 |
| `src/renderer/styles.css` | 移除 `.pdf-viewer-page-wrap`/placeholder 的 `max-width: 1200px` |
| `tests/worker/thumbnails.test.ts` | 新增入队门禁回归测试 |
| `tests/e2e/document-preview.test.ts` | 新增多页 PDF E2E（4 页 fixture：每页恰一个 wrap、占位符清零） |
| `tests/e2e/pdf-repro-probe.test.ts` | **临时调试探针（勿提交，引用用户 PDF 路径）** |

另有 8ca259 前序未提交改动（document 媒体类型全链路、PdfViewerSurface/HtmlViewerSurface、offscreen HTML 缩略图通道等，见 `docs/internal/development/2026-08-18-doc-preview-handoff.md`）。

## 五、测试状态

- ✅ typecheck 绿（`npx tsc --noEmit`）
- ✅ 探针（production build + 用户 PDF）：缩略图就绪 + 17/17 渲染 + 0 错误（多次，除一次页面关闭 flake）
- ⚠️ `tests/worker/thumbnails.test.ts` 在 Electron Node 下 exit 0 但**输出被过滤器吞掉，未确认实际断言数**（vitest 输出在管道下丢失；重跑时直接读输出文件）
- ⚠️ 新多页 PDF E2E 未跑过
- ⚠️ 完整 `test:worker` / `test:e2e` / `test:library-availability` 未跑（改动了 library-service，**必须完整跑 library-availability**）
- ⚠️ packaged 验证未做（`createRequire(__filename)` 在 asar 内解析 `pdf.worker.mjs` 未验证）
- ⚠️ 工单评论已追加（3 条，存于 `.beads/issues.jsonl` 的 `comments[].text` 字段；`ticket show --json` 输出用 `body` 字段名读取会显示为空，**实际数据在**）

## 六、建议下一步（接续者按序执行）

1. **先验证假设 1（文字渲染）**：跑探针（不加管道过滤器），看 `PROBE INK RATIO` 输出。文字页 ink 应 3-10%；若 ≈0 → 渲染器字体链路问题，查 pdfjs 在 vite bundle 下的 FontFace 加载（可对比 Node 侧 pdfjs 渲染同一页的 ink）。
2. 若文字正常 → 验证假设 2：改 `scale = min(宽度比例, 高度比例)` fit-inside，或问用户是否接受「页面完整可见优先」。**建议先给用户看一张渲染页的截图确认文字在不在**（探针已能存 `C:\Users\Dolag\AppData\Local\Temp\serpent-pdf-probe-shot.png`，但注意用户环境可能无法直接看图工具）。
3. 让用户重启 `npm start`（worker 改动必须重启才生效；渲染器改动 HMR 一般会生效）后复测——**DPR 占位符跳变修复（3.2 假设 3）用户尚未复测**。
4. 确认后跑 `npm run test:library-availability` + `test:worker` + 多页 PDF E2E + 完整 `test:e2e`，然后 packaged 验证（`npm run package` + asar 内 pdfjs worker 解析）。
5. 全部通过后：删除临时探针、按用户最初要求拆分提交（PDF 一个 / HTML 一个）、更新清单与工单。

## 七、关键技术笔记（给接续者省时间）

- **worker 侧 pdfjs 可用性四件套**（缺一不可，缺哪个崩哪个）：process.type 中和 → DOMMatrix/Path2D/ImageData polyfill → workerSrc → CanvasFactory。@napi-rs/canvas 全部导出（`require('@napi-rs/canvas')` 实测）。
- **pdfjs 6.2.108 关键 API**：选项名 `CanvasFactory`（大写，类是必须的）；`page.render({canvas, canvasContext, viewport})` 6.x 需要 `canvas` 属性；`loadingTask.destroy()` 清理。
- **CSP**：渲染器 index.html 单点；无 header 级注入。
- **Electron Node v24.18.0 无 DOMMatrix/Path2D/ImageData**（系统 node 24.14.0 有 DOMMatrix）——vitest 跑在 `run-vitest-with-electron.mjs`（Electron Node），单测能覆盖 worker 运行时。
- **`ELECTRON_RUN_AS_NODE=1 npx electron script.mjs`** 可快速复现 worker 运行时行为（process.type 默认未设；要模拟 UtilityProcess 需 `Object.defineProperty(process,'type',{value:'utility'})`）。
- **worker 构建**：`vite.worker.config.ts` CJS；`@napi-rs/canvas` 等 external；pdfjs-dist 打进 chunk（`pdf-<hash>.js`）。
