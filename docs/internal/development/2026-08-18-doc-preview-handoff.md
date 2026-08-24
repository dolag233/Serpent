# Handoff: PDF / HTML 浏览器预览与缩略图（Serpent-8ca259）

> 交接时间：2026-08-18
> 交接人：前一实现 agent（中途暂停，由后续 agent 接续）
> 工单：`Serpent-8ca259`（P1, feature）— PDF 与 HTML 以浏览器方式预览并生成缩略图
> 分支：`feat/doc-preview`（独立 worktree，基于 `dev` 7e605ed）
> 主工作树：`dev` 分支（含未提交的工单数据 `.beads/issues.jsonl`）

## 一、任务目标（用户口径 2026-08-18）

1. 支持 **PDF**：以浏览器方式预览（从上到下滑动翻页）+ 生成缩略图（第 1 页）。
2. 支持 **HTML**：**非文本格式**，以浏览器方式预览 + 生成缩略图（网页截图）。
3. 提交策略：**两个提交**（PDF 一个、HTML 一个）。
4. 已知决策：HTML 缩略图渲染时页面 JS 会执行（沙箱内，等同浏览器打开本地文件）；查看页用 WebContentsView 内嵌渲染。

## 二、当前进度（已完成 ✅ / 进行中 🚧 / 未开始 ❌）

### 提交 1（PDF 支持）已完成并提交 ✅
- **提交**:`dc2860c`（分支 feat/doc-preview，未推送远端）
- 内容：document 媒体类型全链路 + PDF 缩略图（Worker pdfjs + @napi-rs/canvas）+ PDF 查看（PdfViewerSurface 滚动翻页）+ text-media 移除 HTML + i18n/CSS
- **验证**：thumbnails 57/57（含 PDF fixture 测试）、text-media 4/4、library-availability 9/188、typecheck/lint 绿
- 依赖：pdfjs-dist@6.2.108、@napi-rs/canvas（已提交）
- 真实 Electron UI 未验证

### 提交 2（HTML 支持）未开始 ❌
- 见下方「未完成」第 1/2 项

### 未完成 🚧 / 未开始 ❌

1. **HTML 缩略图（未开始）** — Main 端 offscreen 渲染：加载本地 HTML → 截图 → 存 thumbnail artifact
   - 参考：`src/main/offscreen-thumbnail-renderer.ts`（现有模型缩略图的 offscreen BrowserWindow + paint 事件模式，可扩展/仿照）
   - Worker 端 `generateThumbnail` 对 HTML 目前返回 null（占位），需接入 Main 渲染通道（类似 model 的路由：`options.modelThumbnailRenderer` 之前路由到 Main）
   - 安全：offscreen 渲染在沙箱内，JS 会执行；建议限制远程网络请求（仅 file:// 本地资源）、禁用弹窗/新窗口

2. **HTML 查看（未开始）** — WebContentsView 内嵌浏览器渲染（含 CSS/JS/图片）
   - `AssetPreviewModal` 的 document 分支目前统一走 `PdfViewerSurface`，需按扩展名分流：`.pdf` → PdfViewerSurface，`.html/.htm` → 内嵌 WebContentsView（需 Main 侧窗口管理 + 渲染层挂载）

3. **HTML 与 text-media 归类冲突（待处理）**
   - `src/shared/text-media.ts` 的 `TEXT_EXTENSIONS` 仍含 `.html`/`.htm`（格式过滤 token、`isTextFileName`）
   - `detectMediaType` 已优先返回 document，但格式过滤/文本读取路径可能仍把 HTML 当文本 —— 需复核 `isTextFileName` 调用点（如 `asset.text.read`、格式过滤 SQL、AI 分析分支）

4. **卡片角标/类型展示** — `document` 类型在卡片角标（assetTypeBadgeLabel）目前无专门角标（会显示扩展名），确认是否需要 PDF/HTML 专用角标

5. **搜索/提取**（可选，未要求）— 文档文本是否入搜索（extracted_metadata），本单未要求

6. **测试补全（未做）**
   - worker 单测：PDF 缩略图生成（构造最小 PDF fixture）
   - 协议测试：mediaType 枚举含 document
   - renderer 单测：PdfViewerSurface 渲染（happy-dom 下 canvas 受限，可能需要 mock pdfjs）
   - `npm run test:library-availability`（改动了 library-service）
   - Electron E2E（PDF 打开查看）

7. **提交拆分（未做）** — 用户要求两个提交：
   - 提交 1：PDF 支持（mediaType document + PDF 缩略图 + PdfViewerSurface 查看 + 依赖）
   - 提交 2：HTML 支持（offscreen 缩略图 + WebContentsView 查看）

## 三、关键技术笔记

- **pdfjs-dist 6.x**：
  - Worker 用 `pdfjs-dist/legacy/build/pdf.mjs`（ESM 动态 import，Node 可跑）；`getDocument({ data: new Uint8Array(...) })`
  - 渲染参数：`page.render({ canvas, canvasContext, viewport })`（6.x 需要 `canvas` 属性，不是只有 canvasContext）
  - 清理：`loadingTask.destroy()`（`pdfDocument` 无 destroy 方法）
  - Renderer 用 `pdfjs-dist`（browser build），`getDocument({ url })` 直接加载 `serpent://source/...`
- **@napi-rs/canvas**：NAPI 无编译依赖，Worker 可用；`createCanvas` + `getContext('2d')` + `toBuffer('image/png')`。类型与 DOM canvas 不兼容，用 `as never` 桥接
- **serpent://source 协议**：Main 侧已放行任意 sourceRevisionId（`src/main/index.ts` 6738+），PDF/HTML 无需额外协议改动
- **document 类型影响面**：`media_type` 在 DB 里是字符串列，无需迁移；所有 TS 枚举已同步（4 处 z.enum + palette-visibility + thumbnail-support + renderer 类型）。新增媒体类型时搜索 `'image', 'video', 'audio', 'text', 'model', 'other'` 确保全覆盖

## 四、待接续步骤（建议顺序）

1. **提交 1（PDF）**：整理当前 worktree 改动，确认 PDF 相关完整性（含 HTML 占位分支），提交到 `feat/doc-preview`
2. 跑 PDF 相关 worker 单测 + library-availability + typecheck/lint
3. **HTML 缩略图**：Main offscreen 渲染通道（扩展 offscreen-thumbnail-renderer 或新建）
4. **HTML 查看**：WebContentsView 内嵌
5. **text-media 归类复核**：HTML 从 TEXT_EXTENSIONS 行为对齐（格式过滤/文本读取）
6. **提交 2（HTML）**
7. 真实 Electron 验证（PDF 翻页滚动、HTML 渲染）+ 清单条目 + 关闭工单

## 五、注意

- 主工作树 `dev` 有未提交的 `.beads/issues.jsonl`（今日工单操作：Serpent-8ca259/61je.4 评论/多机共享/IME 等），交接前请确认是否需要一并提交推送
- worktree 分支 `feat/doc-preview` 尚未推送远端
- 所有改动都在 worktree 内，主工作树 dev 的代码未动
