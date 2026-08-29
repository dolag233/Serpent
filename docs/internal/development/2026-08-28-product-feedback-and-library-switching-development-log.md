# 2026-08-28 产品反馈与资源库切换收口

关联工单：`Serpent-a3844a`、`Serpent-0c8271`、`Serpent-cd3826`、`Serpent-a711e8`、`Serpent-48390f`、`Serpent-e456e3`、`Serpent-84f95d`、`Serpent-7cc33b`、`Serpent-1d8ad7`、`Serpent-671760`、`Serpent-bc29ab`、`Serpent-2b30bb`。

评论原始整理见[2026-08-28 Bilibili 视频评论反馈整理](../research/2026-08-28-bilibili-serpent-video-feedback.md)。本日志只记录本轮已经修改的实现、验证边界和仍需产品/平台证据的事项。

## 0. 复审元数据

- 需求/规格入口：`docs/internal/mvp-ui-ux-requirements-backlog.md`、`docs/internal/project-status.md`、`docs/internal/qa/human-acceptance-checklist.md`；本轮没有新建独立切片规格。
- 开发分支：`library-performance`。
- 代码基线：`c1b13e50d7f5d72dd16fb94413250114827f3254`；本轮首个实现提交：`3e31cff8b4a1807f66b642ba2130bc30c7efd702`。
- 记录状态：`reviewing`；更新时间：2026-08-28（Asia/Shanghai）。
- 当前结论受人工、Windows、packaged 与真实外部服务证据限制，不能把本日志当作跨平台最终验收签字。

## 1. 本轮产品决定

- “只建立索引、不复制素材”不新增能力，已有链接文件夹覆盖该诉求。
- Billfish “磁盘不足”归入既有 NAS/错误处理工单 `Serpent-4f44f1`，必须以日志判断，不能用剩余磁盘空间推断成功或失败。
- 链接文件夹无反应先用 25,000+ 托管资产与链接资产混合库验证；通过后不把评论中的猜测单独升级为阻断。
- RAW/ARW 已支持，但仍需真实样本和平台证据；视频/GIF 的格式问题等用户日志后再判断。
- 本地 LM Studio/Qwen 输出格式兼容属于 P1；导出素材包、高级色彩过滤、`+` 层级语义和 Blend/C4D 等属于 roadmap。
- 序列帧识别保留设置弹窗和“按单文件导入”的选择，只改成更直白的按钮文案。

## 2. 实现收口

### 查看器无闪烁（`Serpent-a3844a`）

查看器现在保留当前可展示内容，同时后台预加载目标资产；只有目标媒体实际可展示或明确失败后才提升目标层。图片、视频、音频、序列帧、PDF、HTML、文本和 3D 查看器统一提供 presentation-ready 回调；预加载层不参与全局快捷键、复制、文本保存、菜单和 chrome 活动。`App.tsx` 不再用 asset key 强制卸载整个查看器，避免缩略图卸载后出现黑帧/空帧。

### 缩略图升级闪烁回归定位与修复（2026-08-28）

用户复报“缩略图变原图时仍闪一下”后，追溯到 `Serpent-eh07` / VIEWER-019 以及历史提交：`4def1230` 为消除重复的 `fetch` + `createImageBitmap` + canvas 中间层，改为占位图与单个隐藏原图层，但保留了布尔型 `fullDecoded`；`3e31cff8` 又取消查看器整层按 asset key 卸载并加入当前层/目标层预加载，因此更频繁地经过“首帧 `src` 仍是缩略图、随后切换为原图”的过渡。该过渡中，缩略图的 `load` 可能先把布尔状态置为 true，原图 URL 更新后的被动 effect 尚未来得及清零，导致原图层提前可见，形成一帧闪烁。

修复集中在 `src/renderer/zoomable-preview-image.tsx`：解码状态改为绑定已证明成功的 URL；原图提升前等待 `HTMLImageElement.decode()`、下一帧和几何预测量，并用请求序号、当前 URL 和 DOM 连接状态丢弃过期 continuation。缩略图在原图未准备好前始终保留为可见层。`tests/e2e/media-preview.test.ts` 将初次打开和 `ArrowRight` 切图都固定到真实缩略图→原图路径，并门控原图 `decode()`，验证整个过渡期间存在可见且已解码的图片、占位节点未被卸载替换。

本次修复后的定向 E2E `node scripts/run-e2e.mjs tests/e2e/media-preview.test.ts --grep "generates a decoded thumbnail and keeps asset viewer context coherent"` 为 1/1 通过；当前工作树的 `npm run verify:mainline` 也已完成，包含 `npm run test:e2e` 的 84 个通过、3 个按平台/环境跳过、0 个失败。用户已于 2026-08-28 确认图片查看与切图不再闪烁，完成该工单的人类验收；Computer Use、Windows 和 packaged 仍未执行。

### 跨设备链接文件夹错误（`Serpent-0c8271`）

打开库时检查每个已记录的链接根目录；当前设备缺失时抛出 `LINKED_FOLDER_UNAVAILABLE`，错误只说明“当前设备不可用、数据库完整、重新连接或重新指定路径”，不向 Renderer 传播不必要的绝对路径。该错误不会被当成库损坏写入损坏恢复记录，也不会留下半可用库状态。

### 启动与切库安全（`Serpent-cd3826`、`Serpent-2b30bb`）

- 生产启动不再自动打开最近资源库；最近列表仍可从切换器选择。只有隔离 E2E 通过 `SERPENT_E2E_RESTORE_RECENT=1` 显式启用自动恢复。
- 打开失败时 Fatal 对话框提供“切换资源库”，切换器在忙碌状态仍可打开；打开/创建/关闭库、导入、导出和同步期间切换会先说明会中断的行为与风险。
- 资源库打开、关闭、移除和磁盘删除共用 Renderer 侧串行切换锁；即使用户在打开过程中再次点击关闭/删除，也不会交叉清理新旧库或恢复错误的浏览状态。
- 浏览会话恢复和导入目标分离；恢复上次浏览文件夹不会把它偷偷当成重启后的导入目标。
- 生命周期 E2E 曾在完整套件中暴露 macOS 清理时序：断言已通过，但 `application.close()` 仅关闭最后窗口，而产品按 macOS 规则保持进程常驻，导致 finally 超时。测试现显式请求 `app.quit()` 并设置有界回收，第二实例路径在最小套件和完整套件中均稳定通过。

### 删除即时反馈（`Serpent-a711e8`）

托管资产移入回收站先局部移除卡片并清空选择，持久化 RPC 在后台完成；成功后按持久化计数校正，失败则重新加载当前范围恢复卡片并显示错误。新增延迟 750ms RPC 的 Electron 回归，验证卡片在 600ms 内消失且成功通知最终到达。

### 资源库切换数据隔离与关闭事件代际（`Serpent-cd3826`，2026-08-28）

本轮复现并修复了“资源库 A 切到 B 后，A 的文件夹/合集仍短暂残留”的完整竞态链：普通切库先发布新库身份，但旧版延迟导航摘要仍可回写；同时旧库关闭事件只携带 `libraryId`，在 B→A→B 的快速切换中，第一次关闭 B 的迟到事件会误清空刚重新打开的 B。

- Renderer 新增 `LibraryViewSession`（库 ID + 单调代际），主浏览页、导航摘要、文件夹卡片、缩略图/元数据事件、标签/合集读回和主要范围导航均在提交前校验当前代际；切换开始会取消排队的侧栏 hydration，并先清空所有旧库域状态。
- 切库仍把旧库关闭作为独立的生命周期清理异步执行；Worker 调度器允许不同库的读请求与旧库生命周期清理并行，但仍禁止读取正在关闭的同一库。
- Renderer 为无 source 标签的普通关闭事件记录一个或多个待完成关闭代际；同一库被重新打开后，旧代际事件只会被丢弃，不会清空新库。MCP 关闭事件仍按显式来源处理。
- 导航摘要保留普通导航的静默 hydration；资源库替换改为安全边界：Renderer 等待 browse page 与完整导航摘要准备好后才让主界面可见；如果等待超过 3 秒，才显示仅含目标库名和“切换资源库”按钮的全窗口提示。旧库导航不会以部分首屏形式暴露。

### 资源库打开安全感优先（2026-08-28 产品修订）

本轮根据用户对 `Serpent-cd3826` 的复验反馈，撤回“资源库打开后先展示首屏、侧栏再渐进 hydration”的交互口径。原因不是性能优化目标改变，而是资源库是最高风险的数据身份边界：大型库在结构读取期间显示不完整的文件夹/合集，会让用户误以为数据丢失或串库。

实现将资源库打开/切换与普通浏览区分开：打开阶段等待资产首屏查询及文件夹、链接文件夹、合集、智能合集、标签、回收站摘要组成的导航快照后，才提交可见的主界面；若等待超过 3 秒，才显示简洁的“正在打开 xx 资源库”和“切换资源库”按钮。加载期间可打开其他资源库选择面板，选择动作排队，不破坏当前事务。

普通文件夹/合集切换、搜索、缩略图、AI 和查看器原图升级仍遵循渐进式加载；本次只是把资源库身份切换提升为“给用户以安全感”的明确等待边界。

反馈闭环：新增 E2E 在修复前以 `npx playwright test tests/e2e/library-recent.test.ts -g "does not retain" --config=playwright.config.ts` 稳定复现旧库导航残留（期望 0、实际 1）；修复后同一用例通过，并复跑 `library-recent.test.ts` 3/3、`npm run test:library-availability` 9 文件/207 测试、`npm run test` 493 文件通过/15 跳过（4,258 通过/25 跳过）。全量 E2E 曾出现一次与本变更无直接关联的资产导入页面崩溃，独立复跑通过；随后当前工作树的完整 `npm run verify:mainline` 已通过，故本轮全量 E2E 记录为 84 通过、3 跳过、0 失败。

### 菜单、提示音和反馈相关收口

- macOS 原生菜单的“关于 → 查看日志”已接入与 Windows 相同的诊断日志动作，并补齐 preload command allow-list。
- 将完成音频纳入 Git 管理，任务完成或非取消失败时复用单一 `Audio` 实例，音量固定为 0.18；取消不播放，播放失败不阻断业务。已接入资源库打开/关闭/删除、普通文件/文件夹/序列帧导入、Eagle/Billfish、资源库导入导出、链接转托管、重链、磁盘刷新和同步。
- 序列帧按钮改为“导入单独文件 / 导入序列帧”，同步英文和可访问名称。
- 本地模型结构化输出采用能力协商：优先 `json_schema`，兼容端点降级到 `json_object` 或文本，再由 Zod 做最终解析；仅在响应明确表示格式不支持时降级，不吞掉真正的业务错误。调研见 [AI provider structured-output compatibility](../research/2026-08-28-ai-provider-structured-output-compatibility.md)。

## 3. 四列验收追踪

| 需求条目 | 实现位置（当前工作树） | 自动化测试 | 人工/平台证据 |
|---|---|---|---|
| 查看器缩略图升级与切图无空帧 | `src/renderer/AssetPreviewModal.tsx:1330`、`src/renderer/zoomable-preview-image.tsx:120`、`src/renderer/styles.css` | `tests/e2e/media-preview.test.ts`：初次打开和 `ArrowRight` 切图均门控原图 decode，验证可见解码层与占位节点连续；定向 1/1、全量 83/3 通过/跳过 | 用户 2026-08-28 人工确认图片查看与切图不再闪烁；Computer Use、Windows、packaged 未执行 |
| NAS 链接根在当前设备不可用时明确报错 | `src/worker/library-service.ts:41313`、`src/shared/protocol/errors.ts:52` | `tests/worker/linked-folders.test.ts`：Electron Worker 24/24 通过 | 真实 NAS/SMB、跨两台电脑和 Windows 未执行，待人类验收 |
| 打开/切换资源库超过 3 秒才显示简洁提示，完成一致结构后再显示 | `src/renderer/App.tsx:513`、`src/renderer/App.tsx:706`、`src/renderer/App.tsx:9851`、`src/renderer/LibraryLoadingOverlay.tsx`、`src/renderer/library-view-session.ts`、`src/renderer/library-transition-lock.ts` | `tests/unit/library-loading-overlay.test.tsx`；`tests/unit/interactive-scheduler.test.ts`、`tests/unit/defer-navigation-hydration.test.ts`、`tests/unit/library-view-session.test.ts`；`tests/e2e/library-recent.test.ts`（含 3 秒显示门槛与无旧导航残留） | 当前工作树此前 `npm run verify:mainline` 已通过；本次 3 秒门槛变更待重新执行完整门禁。Computer Use、损坏库/真实长事务、Windows 与 packaged 未执行，用户仍需人工复验 |
| 删除卡片即时消失且失败可回滚 | `src/renderer/useBatchActions.ts:298` | `tests/e2e/organization-search-trash.test.ts` 延迟 RPC 回归 1/1 通过 | macOS 延迟 RPC 已验证；20k 实库、Windows 和人工视觉未执行 |
| TIFF 查看器使用源文件原生尺寸 | `src/worker/library-service.ts`、查看器媒体层 | `tests/e2e/tiff-image-preview.test.ts`：2048×1024 TIFF 原生尺寸 1/1 通过 | 当前 macOS Electron 已验证；PSD/EXR/TGA 全格式矩阵、Windows、packaged 和人工视觉未执行 |
| macOS 关于菜单查看日志 | `src/shared/application-menu.ts:76`、`src/renderer/main-menu-items.ts:279`、`src/preload/index.ts:2596` | application/main-menu/about 单测通过；macOS Electron E2E 实际点击 native `about.diagnostics` 通过 | packaged macOS 原生菜单和真实发布更新流程未执行 |
| 本地模型输出格式协商 | `src/worker/ai/openai-adapter.ts` | AI protocol fixture 定向测试通过 | 真实 LM Studio/Qwen、Ollama、vLLM、云端 provider 矩阵未执行 |

## 4. 验证记录

已完成的定向验证：

- `npm run test:library-availability`：9 个文件、207 个测试通过。
- Electron Worker 链接文件夹定向测试：22/22 通过。
- Renderer 切库安全与 API 写入追踪定向测试：2 个文件、12 个测试通过。
- 资源库加载边界回归：`node scripts/run-e2e.mjs tests/e2e/linked-folders.test.ts --grep "imports a linked folder|restores a linked library|default ignore"` 为 3/3，通过；`node scripts/run-e2e.mjs tests/e2e/library-recent.test.ts --grep "keeps decoded previews isolated"` 为 1/1，通过。测试已统一等待不透明加载遮罩消失，避免在底层首屏尚未可操作时提前读写。
- 媒体/链接 Worker 定向批次：6 个文件、156 个测试通过、2 个跳过。
- `node scripts/run-e2e.mjs tests/e2e/linked-folders.test.ts tests/e2e/media-preview.test.ts tests/e2e/organization-search-trash.test.ts tests/e2e/tiff-image-preview.test.ts`：10 通过、1 跳过；跳过项是既有的完整进程重启视频修复场景。
- 其中链接文件夹 3/3、媒体查看器 2/2、删除/恢复 4/4、TIFF 原生尺寸 1/1 通过。

所有测试临时资源均使用隔离目录；本日志不记录机器绝对路径、资源库名称或凭据。

最终主线门禁（当前工作树）已完整执行：

- `npm run lint`：通过。
- `npm run typecheck`：通过；`npm run extension:verify`：通过。
- `npm run test:library-availability`：9 个文件、207 个测试通过。
- `npm run test`：493 个文件通过、15 个跳过；4,258 个测试通过、25 个跳过。
- `npm run test:perf:search`：5/5 通过。
- `npm run test:e2e`：84 个通过、3 个按平台/环境跳过、0 个失败。跳过项为既有完整进程重启视频修复场景、Windows 生命周期场景和 Windows 字体场景。
- AI 协商定向回归：2 个文件、87 个测试通过；完整门禁覆盖 Responses 协商兼容场景，5/5 通过。提示音路径由同一完整门禁中的单测覆盖。

### 复审修订记录

- 2026-08-28：按独立审查意见补上 API 边界的写入追踪、OpenAI 结构化输出缓存的解析后提交、NAS 链接根的具体不可用原因、Fatal 对话框焦点闭环、预加载查看器隔离、更新清理日志脱敏，以及库身份替换串行锁；以上项目的最终命令结果以提交后的复跑记录为准。

## 5. 未宣称完成的边界

Computer Use 当前不可用，因此没有把真实应用视觉验收写成通过。Windows、packaged app、真实 NAS/SMB 跨设备、真实 LM Studio/Qwen、本地 25,000+ 混合资产、真实 RAW/ARW 相机矩阵和完整发布更新旅程仍需在对应环境执行。TIFF/PSD/EXR 全分辨率查看实现已存在，但仍按 `Serpent-671760` 保持待人类验收。
