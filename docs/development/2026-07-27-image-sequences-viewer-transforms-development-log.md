# 2026-07-27 序列图与查看页显示变换开发日志

## 范围

- `Serpent-j8dl`：连续编号图片自动识别、手动创建、FPS 与视频式播放预览。
- 查看页图片/视频的会话级顺时针旋转、水平镜像和垂直镜像。
- Inspector 序列帧三层堆叠沿用已验收的居中布局；不重复修改 `Serpent-ijfm` / INSPECT-011。

## 设计

采用 ADR-0024 的资产组模型：帧文件继续作为独立资产，序列关系控制普通浏览的折叠与查看页播放。此设计保留现有文件身份、修订、元信息和安全路径边界，避免为复合文件重新实现整套导入与修订管线。

## 实施与证据

### 数据与识别

- SQLite schema 升至 v23，新增 `asset_sequences` / `asset_sequence_frames`；每帧仍是独立资产与修订，主帧承担普通浏览入口。
- `image-sequence.ts` 按同目录、同前缀、同扩展名、同数字宽度拆分最大连续段，最少三帧。
- 单文件导入先扫描同目录兄弟文件；文件夹导入识别全部连续段；链接目录即使三帧分三次刷新出现，也会回看同目录未分组资产后建立序列。
- 普通资产、合集和搜索列表隐藏非主帧；摘要查询只读取当前结果涉及的序列，避免每次列表都扫描整库序列关系。

### 交互

- 自动序列默认 24 FPS；多选图片右键可解散/创建并设置 1–240 FPS。
- 卡片显示帧数/FPS，并在悬停或主选中时逐帧预览。
- Inspector 用第一/中间/末帧沿用 `Serpent-ijfm` 的居中三层堆叠；查看页提供播放/暂停、逐帧滑块、FPS 与全屏。
- 图片、视频和序列查看页支持会话级顺时针 90°、水平镜像、垂直镜像。旋转只用交换后的尺寸计算 Fit，媒体元素始终保持源宽高比，避免 90° 后拉伸或双重交换。
- 显示变换每次切换资产重置，不修改源文件、EXIF、资产修订或数据库。

### 当次验证

- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/image-sequence.test.ts tests/unit/image-sequence.test.ts tests/unit/viewer-display-transform.test.ts tests/unit/protocol.test.ts tests/unit/asset-card-hover-preview.test.ts`
  - 5 files / 89 tests passed。
- `node scripts/run-e2e.mjs tests/e2e/image-sequence-viewer.test.ts`
  - 1 passed；覆盖单帧导入自动扩展、解散、手动 13 FPS 重建、Inspector 三层堆叠、帧切换、旋转/双镜像、完整退出重启持久化。
  - 截图视觉检查确认 90° 后 16:9 源图呈 9:16，未发生拉伸；顶部显示变换工具条与工作区通知分行，不再互相遮挡。
- schema 固定版本断言已由 22 同步到 23；相关五个 Worker 文件共 233 passed / 1 failed / 1 skipped。唯一失败为既有离线 linked-trash recovery 断言（恢复根目录后操作仍保持 `SOURCE_TRASH_RECONCILIATION_REQUIRED`），路径不经过序列创建/播放，另行跟踪，不记为本功能通过。
- 完整 Worker 扩大运行：677 passed / 22 failed / 7 skipped；除 schema 断言（已修）外还暴露现有媒体工件、relink recovery、search performance 与 20k soak 超时，不能据此宣称全量主线通过。

### 平台边界

- macOS arm64 开发态及生产式 file:// Electron E2E 已验证。
- Windows 与 packaged app 未执行，保持未验证。
