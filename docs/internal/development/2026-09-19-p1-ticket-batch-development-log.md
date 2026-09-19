# 2026-09-19 P1 工单批次：取消文案、文件夹批量、字体预览、序列帧面板

> 一次性收口四个 P1 工单（`Serpent-bcaf4a`、`Serpent-d7acfa`、`Serpent-485aeb`、`Serpent-866c20`）。
> 每个工单独立交付「代码 + 测试 + 文案 + 验收清单」，本文按工单分节记录实现位置、当次验证命令与结果、未完成边界。
> 基线：`dev` @ `db74462a`（工作树内交付，未经用户许可不提交）。

## 0. 批次验证（当次命令与结果）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 全量单测 | `npx vitest run tests/unit` | **500 files / 3694 passed / 5 skipped** |
| 资源库可用性 | `npm run test:library-availability` | **9 files / 226 passed / 1 skipped** |
| 字体 worker | `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/font-thumbnail.test.ts` | **3 passed** |
| 受影响 E2E | `node scripts/run-e2e.mjs tests/e2e/critical-confirmation.test.ts tests/e2e/folder-batch-actions.test.ts tests/e2e/image-sequence-import-preview.test.ts tests/e2e/font-preview.test.ts` | **5 passed（37.1 s）** |
| 类型检查 | `npx tsc --noEmit` | 仅剩 4 条**预存在**错误（`import-progress-session.ts`、`use-browse-pagination.ts`、两个测试文件），均在本次未触碰的文件里；本次新增/修改文件 0 error |
| Lint | `npm run lint` | 2 条**预存在** error 在本次未触碰的文件（`src/renderer/use-card-hover-scrub.ts:50`、`tests/unit/use-viewer-zoom-pan-middle-button.test.tsx:28`）+ 4 条既有 warning；本次触碰的文件 0 error |

**预存在的红项（与本批次无关，已开单 `Serpent-308961`）**：`tests/worker/thumbnails.test.ts` 的
「reports every missing primary asset when reconciliation exceeds one claim wave」在 HEAD 上稳定失败（期望 101、实际 35）。
验证方式：把 `src/worker/{library-service,artifact-policy,catalog-read}.ts` 的本地改动用 `git stash` 收起后，
该用例同样失败。请勿把它算成本批次的回归。

> 用户验收后重跑的第二轮结果见 §5.3（字体预览按 6 条反馈重做，`d7acfa` 补上侧栏多选）。

## 1. `Serpent-bcaf4a`：用户取消不再用红色错误条

**问题**：危险操作确认窗点「取消」（或进度取消）后，界面用红色错误条显示「操作已取消。」，
与「预期内取消不弹错误」（`docs/internal/ui/0004-calm-error-and-copy-ux-principles.md`）冲突。

**改动**

| 位置 | 内容 |
| --- | --- |
| `src/renderer/user-cancellation.ts`（新） | `isUserCancellation()`（同时接受抛出的 `LibraryOperationError` 与 `{ code }` 形状）+ 四种操作的通知 key 常量 |
| `src/renderer/use-folder-delete-actions.ts` | 文件夹／链接子目录「强制从硬盘删除」取消 → `setNotice`（此前落到 `setError`） |
| `src/renderer/App.tsx` | 「从硬盘删除资源库」「永久删除回收站资产」「清空回收站」取消 → 各自点名操作的 info 通知 |
| i18n（中英） | `toast.diskDeleteCancelled` 改为「已取消从硬盘删除。」；新增 `permanentDeleteCancelled` / `emptyTrashCancelled` / `libraryDeleteCancelled`；`error.code.CANCELLED` 由「操作已取消。」改为「操作已取消，没有做任何改动。」 |
| 测试 | `tests/unit/user-cancellation.test.ts`（判定 + key + 中英文案不退化）；`tests/e2e/critical-confirmation.test.ts` 新增「取消文件夹硬盘删除 → info 通知且无红色错误条」 |

**验证**：`npx vitest run tests/unit/user-cancellation.test.ts` 3 passed；
`node scripts/run-e2e.mjs tests/e2e/critical-confirmation.test.ts` 2 passed（含新增用例，4.8 s）。

**边界**：`window.confirm` 式的「不移除」路径本来就不产生提示，保持沉默（不硬加提示）；
`asset.delete-from-disk`／导入／导出的取消文案沿用既有 key，只统一了措辞。

## 2. `Serpent-d7acfa`：多选文件夹的批量动作

**问题**：画布文件夹卡片可多选，但批量动作不齐：没有「设置图标」，忽略会静默跳过不合格项，
键盘 Delete / Shift+Delete 只对单个文件夹生效。

**改动**

| 位置 | 内容 |
| --- | --- |
| `src/renderer/folder-batch-actions.ts`（新） | 纯资格判定：托管文件夹四种动作都可；链接根除回收站外都可；链接子目录只由磁盘删除处理；找不到的 id 记 `unresolved`。跳过原因沿用 `menu-skip-report` 的既有码 |
| `src/renderer/commands/asset-multi-commands.ts` | 新增 `assets.appearance`（计数=可设置文件夹数）与 `assets.ignore`（计数=可忽略文件夹+资产），禁用原因取规划的跳过结果 |
| `src/renderer/AssetContextMenu.tsx` | 多选组织区放宽到「有文件夹也算」；新增外观子菜单（`EntityAppearancePicker` 一次应用到全部目标）；忽略改走注册表 + 规划目标（链接根按 `linked` 规则写、链接子目录不再静默） |
| `src/renderer/folder-shortcut-dispatch.ts` + `use-folder-command-shortcuts.ts` + `App.tsx` | 多选文件夹卡片返回 `trash-folders` / `delete-folders` 批量动作，复用既有 `trashMixedSelection` / `requestSelectionDiskDelete`；重命名仍然只对单个目标生效 |
| i18n | `command.assets.appearance` / `command.assets.ignore`（中英，带计数） |
| 测试 | `tests/unit/folder-batch-actions.test.ts`（5 例）；`folder-shortcut-dispatch.test.ts` 增加多选批量与只读 fallback；`asset-multi-commands.test.ts` 增加两条可见性/计数；`tests/e2e/folder-batch-actions.test.ts`（多选 2 个文件夹 → 移入回收站；再选 2 个 → 忽略，且能在外观项看到计数） |

**验证**：相关单测 6 files / 77 passed；`node scripts/run-e2e.mjs tests/e2e/folder-batch-actions.test.ts` 1 passed（13.8 s）。

**边界**：**硬盘删除仍是每个文件夹一次危险确认窗**（协议只有单文件夹 `folder.delete-from-disk.request`）。
本次保持「与现有确认一致」而不新造批量请求；若要「一次确认删多个」，需要新增批量请求类型（已在工单里记为后续项）。

## 3. `Serpent-485aeb`：字体资产预览

> **已被 §5 修订**：用户验收不通过（6 条反馈：封面语言/文案、查看文字与字号、工具条、点击后 Esc 失效、Inspector 元信息）。
> 本节保留第一轮实现记录，最终实现与验证口径以 §5 为准；**§5 的语言判定随后又已被 §6 推翻重做**
> （「cmap 有假名 → 日文」是错的：实测本机 194 个中文/韩文字体被误判为日文）。

**问题**：`.ttf/.otf/.woff/.woff2/.ttc` 落到 `other`，卡片只有通用图标，查看器没有字形预览，
格式过滤也把它们堆进「其他」。

**改动**

| 位置 | 内容 |
| --- | --- |
| `src/shared/media-formats.ts` | `FONT_EXTENSIONS` + `isSupportedFontExtension` + `fontMimeForExtension`（`font/ttf`、`font/otf`、`font/woff`、`font/woff2`、`font/collection`） |
| 媒体类型贯通 | `font` 进入 schema/联合类型：`asset-types`、`protocol/responses`、`library-api`、`catalog-read`、`automation/command-registry`、`plugins/plugin-context`、`thumbnail-support`、`preview-policy`、`asset-card-badges`、`palette-visibility`、`plugin-context-state`、`plugin-contribution-context` |
| `src/worker/library-service.ts` | `detectMediaType` 识别字体；`toSummaryMediaType` 透传；查看器走 `playbackMode:'source'`；缩略图入队扩展名白名单加入字体；字体分支复用 offscreen 例程（URL 带 `sample=font`，产物打 `offscreen-font-1` 标签，stale 判定独立） |
| `src/worker/artifact-policy.ts` | `artifactRoleForJob` / `artifactKindForJob` 的 `generate_thumbnail` 允许 `font`（**这是字体一直拿不到缩略图的真正闸门**）；`artifactPolicyForMediaType('font')` = 卡片缩略图、非调色板 |
| `src/main/font-sample-page.ts`（新）+ `src/main/index.ts` | `serpent://source/<lib>/<asset>?revision=…&sample=font` 返回生成的样张页；`@font-face` 指向去掉 `sample` 的同一 URL（同源，不需要放开 CORS）；文案/尺寸来自 query 且全部转义 |
| `src/renderer/FontViewerSurface.tsx` + `font-sample-url.ts`（新） | 查看器用 iframe 载入样张页，提供「预览文字」「字号」控件；非 `serpent://source/` URL 直接拒绝 |
| `src/renderer/AssetPreviewModal.tsx` / `InspectorPanel.tsx` | `mediaType === 'font'` 分支渲染字体查看器；Inspector 增「{FORMAT} 字体」一行（只写能从文件确定的格式，不编造字重/样式） |
| `src/renderer/format-filter-presets.ts` + i18n | 字体独立分组（`filter.formatGroupFont`），不再是「其他」；`shared/product-format-extensions` 同步排除 |
| `index.html` | CSP `font-src 'self' data: serpent:` |
| 测试 | `tests/unit/font-sample.test.ts`（样张页转义/尺寸/URL 校验）、`summary-media-type.test.ts`（六种字体扩展名）、`format-filter-presets.test.ts`（字体分组）、`artifact-policy.test.ts`（字体角色）；`tests/worker/font-thumbnail.test.ts`（样张 URL 带 `sample=font`、产物落库、入队闸门放行）；`tests/e2e/font-preview.test.ts`（真实 `resources/fonts/DejaVuSans.ttf`：卡片缩略图解码 + TTF 角标 + Inspector 行 + iframe 内 `document.fonts.check` + canvas 字形像素 + 字号/文案改绑） |

**验证**：字体相关单测 4 files / 26 passed；worker `font-thumbnail` 3 passed；
`node scripts/run-e2e.mjs tests/e2e/font-preview.test.ts` 1 passed（6.8 s，含字形像素断言）。

**边界**：字重/样式等字体内部字段尚未解析（无字体表解析器），Inspector 按「读不到就省略」处理；
TTC 集合字体依赖 Chromium 是否能选到可用面，选不到时样张页会回退到系统字体（不报红）。
Windows 与 macOS 的真机字形观感列入人类验收。

## 4. `Serpent-866c20`：序列帧确认面板标题与播放预览

**问题**：导入后成组的确认面板标题是问句「做成序列帧？」；面板没有播放预览，
改帧率或范围看不到效果。

**改动**

| 位置 | 内容 |
| --- | --- |
| i18n（中英） | `title` / `groupTitle` 统一为陈述式「导入序列帧」/「Import image sequence」；主按钮改「导入为序列帧」/「Import as image sequence」；`groupSummary` 去掉「做成」口吻；新增 `preview` / `previewAlt` / `previewCaption` / `previewUnavailable` / `previewLoading` |
| `src/renderer/image-sequence-preview.ts`（新） | 纯函数：范围内循环推进、范围夹取、帧率→间隔（1–240 FPS）、两种来源（库内资产 / 导入候选 offerId+帧号）的 URL 解析与计数 |
| `src/renderer/ImageSequenceImportPreview.tsx`（新） | 面板内预览：按当前范围与 FPS 循环播放，改范围/帧率立刻跟上；提交中暂停 |
| `src/renderer/ImageSequenceImportDialog.tsx` | 新增「预览」区；标题/按钮文案改为陈述式 |
| `src/renderer/post-import-image-sequences.ts` + `App.tsx` | 计划里补 `frameRevisionIds`（`serpent://source` 必须带 revision）；App 组装预览来源（成组走库内资产、导入前走 Main 的 `offerId`） |
| `src/main/pending-import-frame.ts`（新）+ `index.ts` | `serpent://import-frame/<offerId>/<seq>/<frame>`：只服务图片、按 `firstFrame+offset` 约定解析、越界/过期一律 404；E2E 用 `SERPENT_E2E_SEQUENCE_PROMPT=1` 保留确认面板 |
| 测试 | `tests/unit/image-sequence-preview.test.ts`（6 例：范围/循环/换档/越界不猜）、`pending-import-frame.test.ts`（3 例）；`tests/e2e/image-sequence-import-preview.test.ts`（标题陈述式 + 预览真实解码 + 2 FPS 推进 + 范围缩小到 1 帧 + 确认导入成组） |

**验证**：单测 9 passed；`node scripts/run-e2e.mjs tests/e2e/image-sequence-import-preview.test.ts` 1 passed（7.1 s）。

**边界**：预览面板的「暂停/当前帧」控件未做（工单里是可选项）；待导入的候选帧预览依赖
`sample` 之外的 `import-frame` 路由，只有在 Worker 流式给出待确认序列时才会走到。

## 5. `Serpent-485aeb` 第二轮：按验收反馈重做字体预览

**触发**：用户验收不通过（原话：卡片与查看器都不符合预期），并提出 6 条要求：
① 区分字体语言（日文字体用日文预览文字）；② 封面 =「字体预览 AaBbCc 0123」/「{字体名} · Serpent」；
③ 查看文字与封面不同、含常用符号（≤10 个）、同屏至少三种字号；④ 查看界面可设预览文字 / 字号 / 字重 / B-I-U，
面板样式对齐图片查看器工具条（可稍大），滚轮调字号；⑤ 双击查看后点过查看界面再按 Esc 必须仍能退出；⑥ Inspector 显示更多字体元信息（对标视频元信息）。

### 5.1 根因

| 现象 | 根因 |
| --- | --- |
| 点击查看界面后 Esc 失效 | 查看器把字形交给沙箱 iframe（`sample=font` 页面）渲染。点进 iframe 后键盘焦点进入子文档，`App.tsx` 挂在顶层 `document` 上的 Escape 监听收不到事件——不是按键映射问题，是 iframe 焦点边界问题 |
| 封面用中文标签盖拉丁字体 | 样张页文案写死中文，Worker 并不认识字体语言（无字体表解析能力），遇到纯拉丁字体会渲染成豆腐块 |
| Inspector 只有「TTF 字体」一行 | 同上：没有读取 `name`/`OS/2`/`maxp`/`head` 的能力，只能报扩展名 |
| 查看器只有文案 + 字号两个控件 | 第一轮把「够用」当成了验收线，工具条没有对齐既有查看器 chrome 体系 |

### 5.2 改动

| 位置 | 内容 |
| --- | --- |
| `src/shared/font-metadata.ts`（新） | 纯字节解析器：sfnt（TTF/OTF）、TTC（取第一个面）、WOFF1（单表 zlib 按需 inflate）、WOFF2（UIntBase128 目录 + brotli 解压后按目录顺序重建表偏移）；读 `name`（家族/子家族/全名/版本/厂商/版权）、`head`（unitsPerEm）、`OS/2`（usWeightClass/usWidthClass/fsSelection 粗斜标志）、`maxp`（字形数）、`cmap`（format 4/6/12 探针 あ/ア/一/A 判定日文/中文/拉丁）。任何解析失败返回 `null`，绝不抛异常、绝不编造字段 |
| `src/worker/font-file-metadata.ts`（新） | 文件侧封装：`readFontMetadata()`（stat 预检 + 64MB 上限 + readFileSync）、`fontSampleQuerySuffix()`（把 family/lang 拼进样张 URL）、`fontMetadataToExtractedFields()` |
| `src/main/font-sample-page.ts` | 封面改为「语言标签 + AaBbCc 0123」/「{family} · Serpent」，`<html lang>` 跟随字体语言；转义不变；查看器模式（`mode=viewer`/`text`/`size`/`theme`）随 iframe 一并删除 |
| `src/main/index.ts` | 样张路由调用 `resolveFontSampleRequest(url)`（把 `sample`/`family`/`lang` 从 `@font-face` 的源 URL 上剔除，`lang` 非法值收敛为 null），路由本身只剩三行 |
| `src/worker/library-service.ts` | 字体缩略图分支先解析字体再拼 URL（`&family=…&lang=…`）；`getExtractedMetadata` 对 `font` 走**按需解析**（字体没有 `extracted_metadata` 产物，格式/字重等事实本来就在字体文件里），解析结果经 `extractedVideoMetadataSchema` 补齐后返回，读不到时返回 `failed` + `FONT_METADATA_UNREADABLE`，不编造字段 |
| `src/shared/asset-types.ts` | `extractedVideoMetadataSchema` 增字体可选字段段（family/subfamily/fullName/version/manufacturer/copyright/weightClass/widthClass/isBold/isItalic/unitsPerEm/glyphCount/language），全部 `optional()`（不设默认值，避免破坏既有调用方构造的元数据字面量） |
| `src/renderer/FontViewerSurface.tsx` | **去掉 iframe**：用 `new FontFace('SerpentFontViewer-<assetId>', url(serpent://source/…))` + `document.fonts.add` 直接渲染，Esc / 焦点 / 样式问题一并消失（家族名按资产区分：导航切换时新旧查看器会同时挂载，共用家族名会让其中一个用上另一个的字体文件）；底部工具条复用图片查看器的 `.preview-zoom-controls` chrome（`font-viewer-controls` 只做微调）：预览文字、字号滑杆、字重下拉、B/I/U 开关、恢复默认；样张上滚轮改字号（`passive:false` + `preventDefault`）；默认样张文字按字体语言选择，用户改过后不再被覆盖 |
| `src/renderer/font-viewer-settings.ts`（新） | 纯设置逻辑：三种语言各自的默认样张文字（都与封面不同、含 6–7 个常用符号）、字号夹取（24–200）、滚轮步进、**三种字号保证互不相同**（`fontViewerSpecimenSizes`） |
| `src/renderer/font-inspector-rows.ts`（新） | Inspector 行构造：家族 / 样式（子家族 + OS-2 粗斜回退）/ 版本 / 字重（`700 · Bold`）/ 字形数 / em 单位 / 字符集 / 厂商；缺失即省略 |
| `src/renderer/InspectorPanel.tsx` | 字体纳入元数据抓取条件；字体行以既有 `inspector-raw-tech-row` 形式并入技术元信息条（带 hover 提示） |
| i18n（中英） | 查看器：字重 / 粗体 / 斜体 / 下划线 / 恢复默认预览；Inspector：家族 / 样式 / 版本 / 字重 / 字形数 / em 单位 / 字符集 / 厂商 + 日文 / 中文 / 拉丁文 |
| `src/renderer/styles.css` | `.font-viewer*` 重写：`position: relative` 承载底部 chrome，样张区留出工具条高度，工具条只依赖主题 token 与既有 `.preview-zoom-controls` / `.preview-color-space-control` 类 |
| 删除 | `src/renderer/font-sample-url.ts`（iframe 专用 URL 构造器）及其单测；查看器不再需要样张页 |

### 5.3 验证（当次命令与结果）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 字体解析器单测 | `npx vitest run tests/unit/font-metadata.test.ts` | **6 passed**（真实 DejaVuSans.ttf / @fontsource WOFF / WOFF2 + 合成 TTC、日文/中文 cmap、粗斜标志、损坏输入返回 null 而不抛） |
| 样张页 + 查看器设置 + Inspector 行 | `npx vitest run tests/unit/font-sample.test.ts tests/unit/font-viewer-settings.test.ts tests/unit/font-inspector-rows.test.ts` | **3 files / 13 passed**（样张页含 `resolveFontSampleRequest`：剔除 `sample`/`family`/`lang`、非法语言收敛 null） |
| 全量单测 | `npx vitest run tests/unit` | **503 files / 3705 passed / 5 skipped** |
| 资源库可用性（强制门禁） | `npm run test:library-availability` | **9 files / 226 passed / 1 skipped（112 s）** |
| Worker 字体管线 | `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/font-thumbnail.test.ts` | **5 passed**（新增：样张 URL 带 `family=DejaVu Sans&lang=latin`；`getExtractedMetadata` 返回家族/语言/字形数；坏字体返回 `FONT_METADATA_UNREADABLE` 且 `metadata: null`） |
| 字体 E2E（重写） | `node scripts/run-e2e.mjs tests/e2e/font-preview.test.ts` | **1 passed（6.6 s）**：卡片缩略图解码 + TTF 角标 + Inspector 家族/字形数/字符集行 + 按资产家族名 `document.fonts.check(...)` + canvas 字形像素 > 50 + 三种互不相同的字号 + 文案与封面不同且含符号 + 字号控件与滚轮 + B/I/U 生效 + **点过样张后 Esc 退出**（样张路由重构与家族名修正后又各跑一次，均 1 passed / 6.5–6.6 s） |
| 同批其它 E2E | `node scripts/run-e2e.mjs tests/e2e/critical-confirmation.test.ts tests/e2e/folder-batch-actions.test.ts tests/e2e/image-sequence-import-preview.test.ts` | **5 passed（40.9 s）** |
| 类型检查 | `npx tsc --noEmit` | 仅剩 4 条预存在错误（未触碰文件）；本次新增/修改文件 0 error |
| Lint（定向） | `npx eslint <本次每个改动文件>` | 0 error（`library-service.ts` 超过 500KB 的 Babel 提示不算错误） |

### 5.4 边界

- 封面缩略图是**一次离屏采集的 512px JPEG artifact**，无法跟随亮/暗主题：样张页固定用深色卡片面（与第一轮一致）。要跟随主题需要在缩略图入队时带上主题并进 `generator_version`，属后续项。
- 字重下拉给的是**合成字重**（浏览器按 100–900 排版同一份字形文件），不是字体文件里真有这些权重；字体文件真实可用权重需要解析 `fvar`（可变字体）后才能给出，本次未做。
- WOFF2 需要整份解压：超过 64MB 的字体只跳过解析（封面回退通用文案、Inspector 显示格式行），不会阻塞导入。
- TTC 只解析第一个面；集合内多面选择仍未做（E2E 用合成 TTC 覆盖解析路径）。
- 同源 iframe 吞键盘焦点的问题**同样存在于 HTML / PDF 查看器**（它们仍用 iframe）。本次只修字体查看器（用户报告的范围），已另开单 `Serpent-a7dccf`（P2）跟踪，避免静默扩大改动面。
- **Computer Use / 截图视觉验收本次未执行**：当前环境没有真实桌面控制能力，工具条观感（间距、亮暗主题下的对比、样张三种字号的比例）按 `AGENTS.md` 记为未执行，交由用户在验收时用真实应用确认。自动化的口径只能证明「加载了真字体、字号/字重/样式真的变了、Esc 真的能退出」。

## 6. `Serpent-485aeb` 第三轮：语言判定重做（第二轮判定方式是错的）

**触发**：用户验收「字体分辨语言的功能不对」，要求先查相关讨论/仓库再改。

### 6.1 查到的依据

| 来源 | 结论 |
| --- | --- |
| [Blender `blf_thumbs.cc`](https://projects.blender.org/blender/blender/raw/branch/main/source/blender/blenfont/intern/blf_thumbs.cc)（提交 [*BLF: Improved CJK Font Preview Differentiation*](https://projects.blender.org/blender/blender/commit/485ab420757)） | 字体缩略图选语言样例的现成实现：**用 OS/2 `ulCodePageRange` 位区分 CJK**，顺序为 韩文(Wansung/Johab) → 繁体(Big5) → **JIS 且非 GB2312 = 日文** → **GB2312 且非 JIS = 简体**；混合时退回 Unicode range 位 + cmap 覆盖做「具体→宽泛」探测，宽泛多语字体给中性拉丁样例 |
| [OpenType OS/2 规范 `ulCodePageRange`](https://learn.microsoft.com/ko-kr/typography/opentype/otspec182/os2#cpr) + [Win32 code page bitfields](https://learn.microsoft.com/en-us/windows/win32/intl/code-page-bitfields) | 位 17 = JIS/Japan(932)、18 = GB2312 简体(936)、19 = Wansung 韩文(949)、20 = Big5 繁体(950)、21 = Johab(1361)；且规范明确「是否 functional 由字体设计者决定」——**覆盖面不是语言** |
| [Windows `IDWriteGdiInterop1::GetFontSignature`](https://learn.microsoft.com/en-us/windows/win32/api/dwrite_3/nf-dwrite_3-idwritegdiinterop1-getfontsignature%28idwritefont_fontsignature%29) / [Apple `CTFontCopySupportedLanguages`](https://developer.apple.com/document/coretext/ctfontcopysupportedlanguages(_:)?changes=_8__2) / [fontconfig `fc-lang`](https://skia.googlesource.com/third_party/fontconfig/+/8249f871b373db5c6559f8c48242beed612b23a0/fc-lang/README) | 平台侧给出的都是**语言/文字集合**而不是单一语言：Windows 暴露的是同一套 code page 位，macOS 返回语言列表，fontconfig 用正字法文件做覆盖判定 |
| [Unicode 邮件列表 2000](http://www.unicode.org/mail-arch/unicode-ml/Archives-Old/UML021/0131.html) / [2008「什么才是中文字体」](https://www.unicode.org/mail-arch/unicode-ml/y2008-m02/0152.html) / [MS Q&A: 如何给 CJK 字体标注语言](https://learn.microsoft.com/en-nz/answers/questions/1504955/what-should-i-set-to-label-a-cjk-opentype-font-int) | 早已有共识：仅凭字形覆盖无法判断语言，CJK 字体共享同一字形集，需要看码位声明/本地化名字 |

### 6.2 实测证据（本机 1171 个字体，只读探测）

| 事实 | 数字 |
| --- | --- |
| 含假名（あ/ア）但**没有** JIS 位的字体 | **194 个** —— 第二轮的「cmap 有假名 → 日文」把它们全判成日文 |
| 其中真实语言 | 全部是中文/韩文（微软雅黑、宋体、等线、微軟正黑體、Batang…） |
| 无任何 CJK 码位但 cmap 里有假名/汉字的字体 | 848 个（如 Geometria Light）。覆盖度高 ≠ 是日文 |
| 同时声明多个 CJK 语言的字体 | 35 个（Noto Sans JP 与 思源黑体 CN 的位**完全相同**：JIS+GB2312；Malgun Semilight 五个位全占） |
| OS/2 版本 0（无码位字段） | 9 个 → 只能靠名字，判定不出来就不写语言 |

### 6.3 改动

| 位置 | 内容 |
| --- | --- |
| `src/shared/font-metadata.ts` | 语言判定重写为 `FontLanguageInfo { declared, resolved, source, sampleScript, coversLatin }`：① 读 `OS/2.ulCodePageRange1`（v1+；v0 忽略该字段）得到**声明集合**；② 单一声明直接用；③ 多声明先用 **name 表语言 ID**（0x411 ja / 0x804·0x1004 zh-Hans / 0x404·0xC04·0x1404 zh-Hant / 0x412 ko）、再用**字体名关键词**消歧；④ 仍不确定才退回 Blender 码位优先级；⑤ 最后仍不确定 → `resolved: null`（中性封面）。`sampleScript` 永远跟着结论走（思源黑体 CN 不能出现「简体标签 + 假名样例」）。另：**绝不从 cmap 覆盖度推断语言**，cmap 只用来确认样例字符存在 |
| `src/worker/font-file-metadata.ts` | 样张 URL 增加 `script=`；`lang=` 只在判定出来时才带（判定不出来就不写语言）；Inspector 字段增 `fontLanguages`（声明集合）/`fontSampleScript`/`fontCoversLatin` |
| `src/main/font-sample-page.ts` | 封面标签按 5 种语言（日文「フォントプレビュー」/简体「字体预览」/繁体「字型預覽」/韩文「폰트 미리보기」/拉丁「Font Preview」）；样例字符**固定为拉丁字母+数字 `AaBbCc 0123`**（换语言只换标签词）；**判定不出来时不写标签**，第一行只给 `AaBbCc 0123`；`resolveFontSampleRequest` 剔除 `script` 参数（封面不再需要） |
| `src/renderer/font-viewer-settings.ts` | 新增 `language: 'auto' | 语言` 与 `fontViewerSampleScript()`；查看器默认样张是**对应语言的整句示例**（如中文「字体文字预览 Serpent 0123 !?.;:@&%#」，符号统一 9 个）——比封面长，方便看字形/标点/数字，且始终包含拉丁字母与数字 |
| `src/renderer/FontViewerSurface.tsx` | 工具条新增「预览语言」下拉（自动判定（当前语言）/ 日文 / 简体中文 / 繁体中文 / 韩文 / 拉丁文）；手动切换即换一套样例文字（用户人工纠正判定的入口）；「恢复默认预览」回到自动 |
| `src/renderer/font-inspector-rows.ts` | 「字符集」显示**文件声明的集合**（如「日文、简体中文、拉丁文」），不再只写一种 |
| `src/shared/asset-types.ts` | `fontLanguage` 枚举扩为 `ja/zh-Hans/zh-Hant/ko/latin` 且可为 null；新增 `fontLanguages`/`fontSampleScript`/`fontCoversLatin`（全部 optional，不破坏既有调用方） |
| `src/renderer/styles.css` | 字体工具条控件变多后暴露真实布局 bug：绝对定位的浮动条在窄窗口把 B/I/U 挤出可视区（E2E 点不到）。改为流内居中 + `flex-wrap`，并用 `.preview-zoom-controls.font-viewer-controls` 复合选择器压过 `.preview-zoom-controls` 的 `position:absolute`（后者在样式表里更靠后） |
| 测试 | 新增 `tests/helpers/synthetic-font.ts`（合成 sfnt：码位位 + name 记录 + cmap，CJK 真字体有授权/体积问题不能进仓库）；`tests/unit/font-metadata.test.ts` 扩到 15 例（含**回归**：GB2312+假名 → 简体而不是日文；无 CJK 声明+假名 → 拉丁；JIS+GB2312 靠字体名/name 语言消歧；五个位全占 → 韩文；OS/2 v0 忽略码位字段；消不出来 → resolved null）；`font-sample`/`font-viewer-settings`/`font-inspector-rows` 同步；worker `font-thumbnail` 增两条（真实 DejaVu 的 `lang=latin&script=latin`；合成中日韩字体走完整管线） |

### 6.4 验证（当次命令与结果）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 解析器/语言判定单测 | `npx vitest run tests/unit/font-metadata.test.ts` | **15 passed** |
| 样张 + 查看器设置 + Inspector 行 | `npx vitest run tests/unit/font-sample.test.ts tests/unit/font-viewer-settings.test.ts tests/unit/font-inspector-rows.test.ts` | **17 passed** |
| Worker 字体管线 | `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/font-thumbnail.test.ts` | **6 passed**（含合成中日韩字体：`lang=zh-Hans&script=zh-Hans`；无法判定时**不带** `lang`） |
| 真字体分类核对（本机系统字体，只读） | 把解析器 bundle 到临时目录后用一次性脚本跑 1171 个字体 | 判定结果：拉丁 850 / 简体 203 / 日文 80 / 繁体 23 / 韩文 15，**无未判定项**。抽查：微软雅黑·宋体·等线 → 简体（此前误判日文）、微軟正黑體 → 繁体、Meiryo·MS Gothic → 日文、Malgun → 韩文、Arial → 拉丁、Noto Sans JP → 日文（字体名）、思源黑体 CN → 简体、文泉驛等寬正黑 → 繁体、SetoFont → 日文 |
| 字体 E2E | `node scripts/run-e2e.mjs tests/e2e/font-preview.test.ts` | **1 passed（6.3 s）**：新增「预览语言」断言（默认 auto → 切日文样例 → 切回 auto 回拉丁） |
| 全量单测 | `npx vitest run tests/unit` | **503 files / 3719 passed / 5 skipped / 0 failed**（并行负载下曾出现 1 次与本次无关的计时抖动：`quickjs-sandbox-prototype` 的 CPU 预算用例，单独跑 22/22 通过；按验收纪律记为疑似 flaky，未关闭） |
| 资源库可用性（强制门禁） | `npm run test:library-availability` | **9 files / 226 passed / 1 skipped（112 s）** |
| 类型检查 / Lint | `npx tsc --noEmit` / 定向 `npx eslint` | 仅剩 4 条预存在类型错误；本次触碰文件 0 error |

### 6.5 边界与结论

- **语言不是字体的固有属性**：CJK 字体共享字形集，`ulCodePageRange` 只是设计者的声明（规范原话），因此 35/1171 个字体同时声明多种语言。本实现的口径是「声明集合照实展示 + 尽量消歧 + 消不出来就不写语言」，并提供查看器里的手动语言切换作为兜底。
- 与 Blender 的差异（有意为之）：Blender 在多声明时直接按「韩文优先」，会把 SetoFont（日文）、文泉驛等寬正黑（繁体）判成韩文；本实现把 name 表语言 ID / 字体名判断放在码位优先级**之前**，实测这 12 个抽查字体全部正确。
- 仍可能判错的场景：字体名与 name 语言 ID 都指向错误语言（例如为多个市场重新命名的字体），或五个位全占且只有一个语言 ID 记录。用户可用查看器「预览语言」手动纠正；卡片封面如需纠正需要重生成缩略图（后续可考虑把语言选择持久化到资产元数据）。
- 封面缩略图固定深色、字重为合成字重、TTC 只取第一个面、HTML/PDF 查看器的 iframe 焦点问题（`Serpent-a7dccf`）——同 §5.4。

### 6.6 第四轮更正（2026-09-19，验收反馈：封面样例字符被换掉了）

**我改错了什么**：第三轮把「标签按语言变」扩大成「样例字符也按语言换」，于是中文封面变成「字体预览 **永字八法**」、日文变成「フォントプレビュー **あいうえお**」。用户指出两点：① 封面样例就该是 `AaBbCc 0123`（拉丁字母与数字每个字体都有，必须显示）；② 不要「永字八法」这类装饰性文字。**查看界面**才需要更长的、对应语言的整句示例。

**改动**：

- `src/main/font-sample-page.ts`：封面第一行 = `{语言标签} + 'AaBbCc 0123'`（无标签时只有 `AaBbCc 0123`）；删除按 `script` 取 CJK 样例的 `SCRIPT_SAMPLES` 与 `script` 输入参数。
- `src/worker/font-file-metadata.ts`：样张 URL 去掉 `script=`，只保留 `family` 与（能判定时的）`lang`。
- `src/shared/font-metadata.ts`：`parseFontSampleScript` 随 `script` 查询参数一并删除（`FontSampleScript` 类型仍用于查看器默认文案）。
- `src/renderer/font-viewer-settings.ts`：查看器默认文案改为**对应语言的整句示例**，符号统一 `!?.;:@&%#`（9 个）：
  中文「字体文字预览 Serpent 0123 !?.;:@&%#」/ 繁体「字型文字預覽 …」/ 日文「フォント文字プレビュー …」/ 韩文「폰트 문자 미리보기 …」/ 拉丁「AaBbCc 0123 Serpent !?.;:@&%#」。
- 测试：`font-sample`（封面固定拉丁样例 + 不出现装饰样例 + URL 无 `script`）、`font-viewer-settings`（整句示例、符号 9 个、不含「永字八法」）、worker（任何字体都不带 `script`）、E2E（切日文后断言「フォント文字プレビュー」）。

**验证**：`npx vitest run tests/unit/font-sample.test.ts tests/unit/font-viewer-settings.test.ts tests/unit/font-metadata.test.ts tests/unit/font-inspector-rows.test.ts` → **31 passed**；worker `font-thumbnail` → **6 passed**；`node scripts/run-e2e.mjs tests/e2e/font-preview.test.ts` → **1 passed**；`npx tsc --noEmit` 仅剩 4 条预存在错误。

## 7. `Serpent-485aeb` 第五轮：按截图验收提出 6 条 UI 修订

**触发**：用户给出卡片截图（「字体预览 AaBbCc 0123」/「HarmonyOS Sans SC · Serpent」）并提 6 条要求。

| # | 要求 | 落地 |
| --- | --- | --- |
| 1 | 只有有不同字重的字体才显示字重选项 | `src/shared/font-metadata.ts` 新增 `fvar` 解析（`wght` 轴 + 命名实例，16.16 Fixed → `variableWeights`），只有 ≥2 个字重才返回列表。查看器据此决定是否渲染字重下拉：**静态字体（如 HarmonyOS_Sans_SC_Bold.ttf）不再出现假的 100–900**；可变字体列出它真正提供的字重，并把 FontFace 声明为 `weight: "100 900"` 让浏览器走 `wght` 轴而不是合成加粗 |
| 2 | 「预览语言」改「语言」、不显示「自动判定(x)」、「拉丁文」改「英文」、支持更多语言 | 下拉直接显示语言（去掉 `auto` 选项，判定结果作为初始值），标签改为「语言」/「Language」；`fontPreviewLanguage.*` 新增 18 种语言：英文/简体中文/繁体中文/日文/韩文/德文/法文/西班牙文/意大利文/葡萄牙文/荷兰文/波兰文/土耳其文/俄文/希腊文/阿拉伯文/希伯来文/泰文（字体判定仍只有 latin/CJK，其余是人工可选的预览语言） |
| 3 | 斜体与 bold 由查看界面自行支持 | 样张行加 `fontSynthesis: "weight style"`：字体只有一套字形时由浏览器合成加粗/倾斜（B/I 按钮因此对任何字体都有效）；可变字体则用真实轴 |
| 4 | 不要「恢复默认预览」按钮 | 删除该按钮与 `viewer.fontPreviewReset` 文案 |
| 5 | 预览文字要持久化（serpent 级别）并支持撤回（图标按钮） | 新增 `src/renderer/font-preview-preferences.ts`：按**语言**存 localStorage（`serpent.font-preview-text.v1`），换字体/重启后继续沿用；撤回按钮用 `undo` 图标（无自定义文字时禁用），点它清掉该语言的自定义文字回到默认 |
| 6 | 封面主文字大一点、比例 4:3 → 16:9 | 样张页主文字 60→76px、次行 30→34px；离屏采集新增可选 `height`，字体样张按 1024×576（16:9）采集，`FONT_THUMBNAIL_GENERATOR_VERSION` 升到 `offscreen-font-2`（旧封面自动失效重生成）；卡片框加 `.asset-card[data-media-type="font"] .asset-preview { aspect-ratio: 16/9 }` |

**过程中发现并修掉的真实缺陷**：只把请求高度改成 576 时，E2E 断言实测缩略图比例是 **1.969**（不是 1.78）。
根因是 `new BrowserWindow({ width, height })` 默认 `useContentSize: false`——高度里含窗口边框，1024×576 的请求实际只截到 1024×520。
修复：`document-thumbnail-renderer.ts` 加 `useContentSize: true`（height 变成真正的页面视口）。这同时让 document 缩略图的视口从 1024×744 变成 1024×800，属改善，不改变既有 artifact 的有效性（未升 document 版本号）。

**验证**

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 解析器（含 `fvar`）| `npx vitest run tests/unit/font-metadata.test.ts` | **18 passed**（静态字体 → null；命名实例 [100,400,700]；只有单实例时用轴范围补；真实可变字体 `@fontsource-variable/noto-sans-sc` → 多个字重 + 简体中文） |
| 查看器设置 | `npx vitest run tests/unit/font-viewer-settings.test.ts` | **8 passed**（18 种语言各有整句示例与 9 个符号；`latin`→`en`；字重选项只在 ≥2 时给出；最近字重选择） |
| 预览文字持久化 | `npx vitest run tests/unit/font-preview-preferences.test.ts` | **4 passed**（按语言存取、只清一个语言、空/超长/损坏值处理） |
| 样张页 | `npx vitest run tests/unit/font-sample.test.ts` | **5 passed**（封面字号 76/34px；标签+`AaBbCc 0123`；中性封面） |
| Worker 字体管线 | `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/font-thumbnail.test.ts` | **6 passed**（字体样张请求高度 = 576；`lang=latin`；静态字体无字重列表） |
| 字体 E2E | `node scripts/run-e2e.mjs tests/e2e/font-preview.test.ts` | **1 passed（6.8 s）**：缩略图比例 1.7–1.85（16:9）+ TTF 角标 + Inspector 行 + 语言下拉 18 项/初值 `en` + 切德文显示德语整句 + 静态字体**没有**字重控件 + 自定义文字按语言留存 + 撤回图标按钮启用/禁用与回退 + 滚轮/字号/B-I-U + 点过后 Esc 仍能退出 |
| 全量单测 | `npx vitest run tests/unit` | **504 files / 3726 passed / 5 skipped / 0 failed** |
| 类型检查 / Lint | `npx tsc --noEmit` / 定向 `npx eslint` | 仅剩 4 条预存在类型错误；本次触碰文件 0 error |

**边界**：字重控件只覆盖**同一个文件内部**的字重（可变字体）。同一字体家族在库里存了多个字重文件（Light/Regular/Bold）时，切换它们需要查看器内切换资产，本轮未做（可在后续按需开单）。自定义预览文字是应用级偏好（localStorage），不入库、不随库导出。

### 7.1 追加更正（滚轮口径）

我先按「Ctrl+滚轮 = 独立缩放」做了一版（加了缩放状态、缩放滑杆与读数），用户当场纠正：
**「调整缩放 = 调整字号，我只是叫你 Ctrl+滚轮和直接滑动滚轮效果一样，给我删掉缩放的滑块」**。
已按要求改成：

- 删除缩放整套逻辑（`FontViewerSurface` 的 zoom 状态与滑杆、`font-viewer-settings` 的 `clampFontViewerZoom` / `stepFontViewerZoom` / `fontViewerZoomPercent` / `applyFontViewerZoom` 与 4 个 zoom 常量、i18n `fontPreviewZoom`、单测里的缩放用例）。
- 样张上的滚轮**只有一种行为**：改字号；`ctrlKey`/`metaKey` 不再区分分支。仍保留 `preventDefault()`——否则 Electron 会对 Ctrl+滚轮做**整页缩放**（这是顺带修掉的真实问题）。
- E2E 断言改为：Ctrl+滚轮向上 → 字号 128；直接滚轮向下 → 字号 124（同一动作）。

**验证**：字体相关单测 5 files / **39 passed**；`node scripts/run-e2e.mjs tests/e2e/font-preview.test.ts` → **1 passed（7.0 s）**；全量单测 **504 files / 3726 passed / 5 skipped / 0 failed**；`tsc --noEmit` 仅剩 4 条预存在错误。

### 7.2 追加：工具条控件标签改为图标

用户要求「预览文字、语言、字号这些文字 ui 都改成 icon」。已改：

- `src/renderer/Icons.tsx` 新增两个图（沿用 Lucide 描边风格）：`type`（预览文字）、`text-size`（字号）。
- `FontViewerSurface` 工具条：预览文字 = `type` 图标 + 输入框；语言 = `globe` 图标 + 下拉；字号 = `text-size` 图标 + 滑杆 + **数字读数**（沿用图片查看器的 `.preview-zoom-label` 样式，滑块需要反馈）；字重（仅可变字体出现）= `sliders` 图标 + 下拉。
- 图标不可读，因此每个控件保留 `aria-label`（读屏与 E2E 选择器继续可用）并加 `data-hover-tip`（标准 hover 提示，约 420ms）。
- `styles.css`：`.font-viewer-control .icon` 用 `--secondary`，`.font-viewer-control-value` 数字右对齐等宽。

**验证**：E2E 新增断言「工具条里 3 个图标、只剩 1 个文字 `<span>`（字号读数）」并通过；`node scripts/run-e2e.mjs tests/e2e/font-preview.test.ts` → **1 passed（7.0 s）**；字体单测 5 files / 39 passed；全量单测 504 files / 3726 passed；`tsc` 仅剩 4 条预存在错误。

### 7.3 追加：工具条竖直居中与语言控件位置

用户看图后提两条：① 工具条没有严格竖直居中；② 语言放到工具条最后。

**① 居中（先把「看起来没对齐」变成可测的量）**：原因是各控件的行高/内边距互不相同——文本输入是 `border 1px + padding 3px`（约 21px 高），下拉只有 `padding 2px`（约 17px），滑杆本身只有 4px 高，B/I/U 是 12px 字母。改法是在 `.preview-zoom-controls.font-viewer-controls` 下统一：控件 `min-height: 24px`、输入与下拉 `height: 24px; box-sizing: border-box`、下拉 `line-height: 22px; padding: 0 3px`、子元素显式 `align-self: center`、字母用 `inline-flex + center` 盒。

**这里没有靠肉眼判断**：E2E 新增断言，量出工具条内**所有**元素（label / button / icon / input / select / 数值 span / B-I-U 字母盒）的 `getBoundingClientRect()` 竖直中心，要求最大值与最小值相差 **<= 1px**；未达标就会红。

**② 顺序**：语言从中间移到工具条最后，现在是「预览文字 → 撤回 → 字号 → （可变字体才有）字重 → B → I → U → 语言」。E2E 断言最后一个控件里是语言下拉。

**验证**：`node scripts/run-e2e.mjs tests/e2e/font-preview.test.ts` → **1 passed（6.8 s）**（含中心线 <=1px 与「语言在最后」断言）；全量单测 **504 files / 3726 passed / 5 skipped / 0 failed**；`tsc` 仅剩 4 条预存在错误；lint 0 error。

## 8. `Serpent-d7acfa` 追加：Ctrl 多选要把「正在浏览的文件夹」一起选上

**用户口径**：「如果当前文件夹是 A，然后我按 Ctrl 选择了 B，那么应该是 A 和 B 同时被选中」。

**改动**

| 位置 | 内容 |
| --- | --- |
| `src/renderer/folder-selection-toggle.ts`（新） | 纯函数 `toggleFolderMultiSelection(current, folderId, { openFolderId, isSelectable })`：已选中 → 取消；未选中且**当前选区为空**且正在浏览的 A 可选且 A≠被点项 → 返回 `[A, 被点项]`；否则追加。不满足条件时不把 A 塞进选区（未知 id 会被批量动作记为跳过） |
| `src/renderer/App.tsx` | 侧栏 Ctrl/⌘ 点击改走该函数：`openFolderId` 取当前 `assetScope`（`all`/`root` 视为没有当前文件夹），`isSelectable` 校验它确实在托管文件夹或链接根列表里；**普通点击（进入文件夹）会把文件夹多选清空**，回到「只隐式选中当前文件夹」的状态；`AppContextMenu` 之前的批量菜单入口不变 |
| 测试 | `tests/unit/folder-selection-toggle.test.ts`（6 例：追加/取消/首次 Ctrl 带上当前文件夹/已有选区不重复带/点在当前文件夹上不带/当前文件夹不可选时不带）；`tests/e2e/folder-batch-actions.test.ts` 新增用例「ctrl-click includes the folder currently being browsed」（进入 CurA → Ctrl 点 CurB → 两行都是 `is-multi-selected` → 右键批量菜单显示「忽略（2 项）」与「移入回收站（2 项）」→ 再 Ctrl 点 CurA 取消只剩 CurB → 普通点击 CurC 后多选清空） |

**验证**：`node scripts/run-e2e.mjs tests/e2e/folder-batch-actions.test.ts` → **3 passed（34.9 s，含新用例 9.6 s）**；`npx vitest run tests/unit/folder-selection-toggle.test.ts` → 6 passed；全量单测与 font/critical-confirmation E2E 见下（同一提交内复跑）。

**边界**：链接**子目录**的 id 由侧栏按规则派生，`isSelectable` 只认托管文件夹与链接根，因此「正在浏览链接子目录时 Ctrl 点 B」不会把该子目录带进选区（宁可不选，也不塞未知 id）；如需覆盖，需要把侧栏的链接子目录 id 一并回传给 App。

## 9. 0.2.6 发布记录（2026-09-19）

按 `docs/internal/development/release-process-and-distribution.md` 执行（Windows 侧）。

**版本**：`a489ae3c chore(release): 版本号 0.2.5 → 0.2.6` 已在 dev（package.json / package-lock 均 0.2.6）。

**打包（dev 分支）**

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| 媒体二进制 | `npm run release:media` | media:acquire + media:verify **通过**（win32-x64 bundle-lock 校验 OK） |
| 打包 + 门禁 | `npm run release:package` | package + **verify:package 通过**；prepackage 的 ufbx WASM 哈希、扩展重建、ASAR 运行时文件与 Host utilities 校验全绿 |
| 分发产物 | `npm run release:make` | Forge ZIP 产出（`out/make/zip/win32/x64/Serpent-win32-x64-0.2.6.zip`，406,644,736 B） |
| 安装器 | `npm run make:inno` | `out/make/inno/SerpentSetup.exe`（293.7 MB），Inno 编译成功（153.7 s / 复核 134.1 s） |

**main 合流（单一提交）**：`git merge --no-commit --no-ff dev` → 7 处 modify/delete 冲突（`.beads/issues.jsonl`、6 个 `docs/internal/**`）全部以删除收口 → `git rm -r -f` 剥离 `.beads`/`.github`/`.codex`/`.cursor`/`AGENTS.md`/`CLAUDE.md`/`CONTEXT.md`/`docs/internal`/`benchmark.md` → **一次提交 `4661e17e`**（180 files changed, +13825/−859）。核对：`git diff main dev -- src tests package.json package-lock.json` 为空；main 无内部文件；`docs/developer/` 18 个文件保留。`scripts/hooks/pre-commit` 守卫通过。

**首次发布尝试与绕过**：388 MB 资产在 GitHub http2 上传时被断开（`http2: client connection force closed`）；改 `GODEBUG=http2client=0` 强制 HTTP/1.1 后 portable 与 setup 均一次成功。

**发布结果**

| 项 | 值 |
| --- | --- |
| tag | `v0.2.6`（annotated）→ `4661e17e`，指向 main 发布基线 |
| Release | https://github.com/dolag233/Serpent/releases/tag/v0.2.6（`target=main`、非 draft/prerelease、当前 Latest） |
| Windows 便携版 | `Serpent-win-x86-64-0.2.6-portable.zip` 406,644,736 B，sha256 `0ac077d217f4b14d6be03d90031161a937070c1eb895ed362f3199de44499ba3` |
| Windows 安装器 | `Serpent-win-x86-64-0.2.6-setup.zip` 307,477,435 B（内含 `SerpentSetup.exe`），sha256 `5c549866ced0f4ea285836cc53c02dc95d0862a34ab67dbb81d02eeebc80e391` |
| 更新日志元信息 | `release-meta.json` + `release-meta-0.2.6.json`（`version` = 0.2.6，中英双语条目） |
| macOS 4 个资产 | 由用户在本机（macOS）构建后上传（`.sha256` sidecar 已出现，dmg/portable.zip 传完为准） |

**按用户指示跳过**：`release:verify`（rebuild:native + verify:mainline：lint / typecheck / 全量单测 / 库可用性 / 性能 / E2E）与 `release:e2e`（packaged 启动 E2E）——本机另有 5 条**预存在**红项（2 lint + 4 typecheck + `tests/worker/thumbnails.test.ts` 的 missing-primary 用例，见 `Serpent-308961`）。打包门禁（media verify / ufbx / verify-package）均已执行且通过。

**环境恢复**：`npm run rebuild:native` → better-sqlite3 重编 + **FTS5 probe OK**；已切回 `dev`（HEAD = origin/dev = `0b40b717`）。

**遗留**：`out/`（打包目录、Forge ZIP、Inno exe、发布暂存副本）约 2 GB 未清理，保留供本机复验安装器与便携包；确认不再需要时可整体删除（可再生）。
