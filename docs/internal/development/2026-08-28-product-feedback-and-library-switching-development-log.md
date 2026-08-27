# 2026-08-28 产品反馈与资源库切换收口

关联工单：`Serpent-a3844a`、`Serpent-0c8271`、`Serpent-cd3826`、`Serpent-a711e8`、`Serpent-48390f`、`Serpent-e456e3`、`Serpent-84f95d`、`Serpent-7cc33b`、`Serpent-1d8ad7`、`Serpent-671760`、`Serpent-bc29ab`、`Serpent-2b30bb`。

评论原始整理见[2026-08-28 Bilibili 视频评论反馈整理](../research/2026-08-28-bilibili-serpent-video-feedback.md)。本日志只记录本轮已经修改的实现、验证边界和仍需产品/平台证据的事项。

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

### 跨设备链接文件夹错误（`Serpent-0c8271`）

打开库时检查每个已记录的链接根目录；当前设备缺失时抛出 `LINKED_FOLDER_UNAVAILABLE`，错误只说明“当前设备不可用、数据库完整、重新连接或重新指定路径”，不向 Renderer 传播不必要的绝对路径。该错误不会被当成库损坏写入损坏恢复记录，也不会留下半可用库状态。

### 启动与切库安全（`Serpent-cd3826`、`Serpent-2b30bb`）

- 生产启动不再自动打开最近资源库；最近列表仍可从切换器选择。只有隔离 E2E 通过 `SERPENT_E2E_RESTORE_RECENT=1` 显式启用自动恢复。
- 打开失败时 Fatal 对话框提供“切换资源库”，切换器在忙碌状态仍可打开；打开/创建/关闭库、导入、导出和同步期间切换会先说明会中断的行为与风险。
- 浏览会话恢复和导入目标分离；恢复上次浏览文件夹不会把它偷偷当成重启后的导入目标。
- 生命周期 E2E 曾在完整套件中暴露 macOS 清理时序：断言已通过，但 `application.close()` 仅关闭最后窗口，而产品按 macOS 规则保持进程常驻，导致 finally 超时。测试现显式请求 `app.quit()` 并设置有界回收，第二实例路径在最小套件和完整套件中均稳定通过。

### 删除即时反馈（`Serpent-a711e8`）

托管资产移入回收站先局部移除卡片并清空选择，持久化 RPC 在后台完成；成功后按持久化计数校正，失败则重新加载当前范围恢复卡片并显示错误。新增延迟 750ms RPC 的 Electron 回归，验证卡片在 600ms 内消失且成功通知最终到达。

### 菜单、提示音和反馈相关收口

- macOS 原生菜单的“关于 → 查看日志”已接入与 Windows 相同的诊断日志动作，并补齐 preload command allow-list。
- 将完成音频纳入 Git 管理，任务完成或非取消失败时复用单一 `Audio` 实例，音量固定为 0.18；取消不播放，播放失败不阻断业务。已接入资源库打开/关闭/删除、普通文件/文件夹/序列帧导入、Eagle/Billfish、资源库导入导出、链接转托管、重链、磁盘刷新和同步。
- 序列帧按钮改为“导入单独文件 / 导入序列帧”，同步英文和可访问名称。
- 本地模型结构化输出采用能力协商：优先 `json_schema`，兼容端点降级到 `json_object` 或文本，再由 Zod 做最终解析；仅在响应明确表示格式不支持时降级，不吞掉真正的业务错误。调研见 [AI provider structured-output compatibility](../research/2026-08-28-ai-provider-structured-output-compatibility.md)。

## 3. 四列验收追踪

| 需求条目 | 实现位置（当前工作树） | 自动化测试 | 人工/平台证据 |
|---|---|---|---|
| 查看器缩略图升级与切图无空帧 | `src/renderer/AssetPreviewModal.tsx:1330`、`src/renderer/styles.css` | `tests/e2e/media-preview.test.ts`：媒体/链接组合回归 5 个场景通过，其中 1 个既有完整进程重启视频场景跳过；可见帧采样检查解码图片 | macOS Electron 已执行；Computer Use、Windows、packaged 和快速人工视觉未执行，待人类验收 |
| NAS 链接根在当前设备不可用时明确报错 | `src/worker/library-service.ts:41237`、`src/shared/protocol/errors.ts:52` | `tests/worker/linked-folders.test.ts`：Electron Worker 20/20 通过 | 真实 NAS/SMB、跨两台电脑和 Windows 未执行，待人类验收 |
| 打开失败仍可切库并提示事务风险 | `src/renderer/App.tsx:1162`、`src/renderer/library-switch-safety.ts`、`src/main/recent-libraries.ts:65` | library switch/recent/fatal 单测；`library-lifecycle` E2E 通过 | Computer Use、损坏库/真实长事务/Windows 未执行，待人类验收 |
| 删除卡片即时消失且失败可回滚 | `src/renderer/useBatchActions.ts:298` | `tests/e2e/organization-search-trash.test.ts` 延迟 RPC 回归 1/1 通过 | macOS 延迟 RPC 已验证；20k 实库、Windows 和人工视觉未执行 |
| TIFF 查看器使用源文件原生尺寸 | `src/worker/library-service.ts`、查看器媒体层 | `tests/e2e/tiff-image-preview.test.ts`：2048×1024 TIFF 原生尺寸 1/1 通过 | 当前 macOS Electron 已验证；PSD/EXR/TGA 全格式矩阵、Windows、packaged 和人工视觉未执行 |
| macOS 关于菜单查看日志 | `src/shared/application-menu.ts:76`、`src/renderer/main-menu-items.ts:279`、`src/preload/index.ts:2596` | application/main-menu/about 单测通过；macOS Electron E2E 实际点击 native `about.diagnostics` 通过 | packaged macOS 原生菜单和真实发布更新流程未执行 |
| 本地模型输出格式协商 | `src/worker/ai/openai-adapter.ts` | AI protocol fixture 定向测试通过 | 真实 LM Studio/Qwen、Ollama、vLLM、云端 provider 矩阵未执行 |

## 4. 验证记录

已完成的定向验证：

- `npm run test:library-availability`：9 个文件、207 个测试通过。
- Electron Worker 链接文件夹定向测试：20/20 通过。
- 媒体/链接 Worker 定向批次：6 个文件、156 个测试通过、2 个跳过。
- `node scripts/run-e2e.mjs tests/e2e/linked-folders.test.ts tests/e2e/media-preview.test.ts tests/e2e/organization-search-trash.test.ts tests/e2e/tiff-image-preview.test.ts`：10 通过、1 跳过；跳过项是既有的完整进程重启视频修复场景。
- 其中链接文件夹 3/3、媒体查看器 2/2、删除/恢复 4/4、TIFF 原生尺寸 1/1 通过。

所有测试临时资源均使用隔离目录；本日志不记录机器绝对路径、资源库名称或凭据。

最终主线门禁（当前工作树）已完整执行：

- `npm run lint`：通过。
- `npm run typecheck`：通过；`npm run extension:verify`：通过。
- `npm run test:library-availability`：9 个文件、207 个测试通过。
- `npm run test`：490 个文件通过、15 个跳过；4,230 个测试通过、25 个跳过。
- `npm run test:perf:search`：5/5 通过。
- `npm run test:e2e`：82 个通过、3 个按平台/环境跳过、0 个失败。跳过项为既有完整进程重启视频修复场景、Windows 生命周期场景和 Windows 字体场景。
- AI 协商与提示音定向回归：2 个文件、56 个测试通过；另有 Responses 协商兼容场景 5/5 通过。

## 5. 未宣称完成的边界

Computer Use 当前不可用，因此没有把真实应用视觉验收写成通过。Windows、packaged app、真实 NAS/SMB 跨设备、真实 LM Studio/Qwen、本地 25,000+ 混合资产、真实 RAW/ARW 相机矩阵和完整发布更新旅程仍需在对应环境执行。TIFF/PSD/EXR 全分辨率查看实现已存在，但仍按 `Serpent-671760` 保持待人类验收。
