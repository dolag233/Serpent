# 0022 序列图与查看页显示变换实施规格

## 目标

让连续编号图片能作为一个序列资产导入、整理和播放，并为图片、视频查看页提供不修改源文件的旋转与镜像。

## 领域与数据

- 每帧保留独立 `Asset` 和 `Revision`。
- `asset_sequences` 保存主资产、FPS 和时间；`asset_sequence_frames` 保存有序帧关系与原始帧号。
- 普通浏览/search/collection 返回主资产；主资产的 `AssetSummary.sequence` 携带序列 ID、FPS、帧数与轻量帧预览信息。
- 解散关系后所有帧恢复为普通可见资产。删除任一成员前先解散其序列，避免剩余帧被隐藏。

## 识别规则

1. 只处理可预览的图片扩展名。
2. 文件名 stem 必须以数字结尾；数字之前是前缀。
3. 同目录、前缀、扩展名与数字宽度一致的文件进入同一候选集。
4. 按帧号排序，拆分为最大连续段；每段至少 3 帧。
5. `1,2,3,5,6,7` 是两个序列，`1,2,4` 不是序列。
6. 单文件导入扫描同目录，只自动加入包含用户所选文件的连续段；文件夹导入识别全部段。
7. 自动序列默认 24 FPS；手动创建时必填 1–240 FPS。

## 交互

- 自动识别后，画布显示第一帧卡片并标出帧数与 FPS。
- 用户多选至少三张符合规则的图片后，可从右键菜单选择“创建序列图…”，在对话框设置 FPS。
- Inspector 单选序列时以居中的三层堆叠显示第一帧、中间帧和末帧。
- 双击序列进入查看页，提供播放/暂停、帧进度和 FPS 信息；播放按 FPS 循环。
- 图片或视频查看页提供“顺时针旋转 90°”“水平镜像”“垂直镜像”。每次切换资产时重置，且不产生文件或数据库写入。

## 验收

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
|---|---|---|---|
| 单文件、文件夹与链接目录连续段识别 | [`image-sequence.ts`](../../src/shared/image-sequence.ts)、[`library-service.ts`](../../src/worker/library-service.ts) | [`image-sequence.test.ts`](../../tests/unit/image-sequence.test.ts)、[`Worker 集成`](../../tests/worker/image-sequence.test.ts) | macOS Electron E2E：单选中间帧后自动导入并折叠为 3 帧序列 |
| 手动创建、解散与 FPS | [`ImageSequenceDialog.tsx`](../../src/renderer/ImageSequenceDialog.tsx)、[`AssetContextMenu.tsx`](../../src/renderer/AssetContextMenu.tsx)、Worker API/SQLite v23 | [`Worker 集成`](../../tests/worker/image-sequence.test.ts)、[`真实 Electron E2E`](../../tests/e2e/image-sequence-viewer.test.ts) | E2E 解散自动序列后多选三帧，以 13 FPS 重建；完整退出重启后仍为 13 FPS |
| 序列卡片、Inspector 堆叠和播放 | [`AssetCardMedia.tsx`](../../src/renderer/AssetCardMedia.tsx)、[`InspectorPanel.tsx`](../../src/renderer/InspectorPanel.tsx)、[`ImageSequencePlayer.tsx`](../../src/renderer/ImageSequencePlayer.tsx) | [`真实 Electron E2E`](../../tests/e2e/image-sequence-viewer.test.ts) | macOS 开发态截图检查：卡片帧数角标、三帧居中堆叠、帧滑块与播放状态正常 |
| 图片/视频旋转与镜像仅影响预览 | [`AssetPreviewModal.tsx`](../../src/renderer/AssetPreviewModal.tsx)、[`zoomable-preview-image.tsx`](../../src/renderer/zoomable-preview-image.tsx)、[`VideoPlayerControls.tsx`](../../src/renderer/VideoPlayerControls.tsx) | [`显示变换单测`](../../tests/unit/viewer-display-transform.test.ts)、[`真实 Electron E2E`](../../tests/e2e/image-sequence-viewer.test.ts) | macOS 开发态截图检查：90° 后画面保持原比例并转为竖向；双镜像可见启用态；未产生源文件写入 |

## 不在本次范围

- 把序列转码或导出为视频。
- 不连续帧的自动补帧。
- 修改源图片方向、EXIF 或像素。
- 跨目录序列。
