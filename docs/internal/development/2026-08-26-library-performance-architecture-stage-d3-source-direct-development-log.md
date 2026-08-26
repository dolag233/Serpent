# 2026-08-26 大型资源库性能架构阶段 D.3 开发日志：小型源图直出与媒体准入

关联架构：[`0032-library-performance-architecture.md`](../implementation/0032-library-performance-architecture.md)  关联工单：`Serpent-3kfe`、`Serpent-90ff52`、`Serpent-sa65`

## 目标与边界

Eagle 式双轨策略的目标是减少小型、浏览器可解码图片的无意义缩略图生成：卡片、
Inspector 和查看器可以直接读取经过 revision 鉴权的源文件；大图、复杂格式和视频
仍使用独立 artifact。直出不是“看到扩展名就放行”，而是同时满足以下条件：

- 媒体类型为 image，格式为 JPG/JPEG、PNG、WebP 或 GIF；SVG 不走该路径。
- Worker 已有正数的宽高元数据，长边不超过 2048 px。
- 当前 revision 源文件不超过 2 MiB、解码像素不超过 2,000,000，且 source URL 仍由当前
  库/revision 协议鉴权。长边仍限制为 2048 px；像素预算是为了控制浏览器 RGBA 解码峰值，
  查看器显式 source 路径不受这条卡片 admission 限制。

超过边界或尺寸未知的图像继续进入 `card-thumbnail` 策略。存量 ready artifact 不删除，
新导入和新 revision 才采用 admission 结果；因此策略切换不会让旧卡片突然失去已生成
的产物。

## 实现与四列追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 小型原生图像采用 source-direct，不创建 primary thumbnail job | `src/shared/preview-policy.ts`；`src/worker/artifact-policy.ts`；`LibraryService.enqueueThumbnailJobs` | `tests/unit/preview-policy.test.ts`、`tests/unit/artifact-policy.test.ts`；`tests/worker/thumbnails.test.ts` | macOS Electron Worker 定向通过；Windows/NAS/packaged 未验证 |
| 卡片、BrowseLayout、hover、Inspector 与查看器使用同一 source/revision 语义 | `src/worker/library-service.ts` 的 summary/layout 字段；`src/renderer/asset-card-hover-preview.ts`；`src/renderer/BrowseLayoutPreview.tsx`；`src/renderer/inspector-preview.ts` | `tests/unit/asset-card-hover-preview.test.ts`、`tests/unit/inspector-preview.test.ts`、`tests/unit/protocol.test.ts`；`tests/e2e/media-preview.test.ts` | 隔离 macOS Electron：卡片、Inspector naturalWidth/object-fit、viewer context 真实解码通过；Windows/packaged/Computer Use 未执行 |
| source-direct 资产仍能获得非首帧的色卡，不把色卡重新变成缩略图门禁 | `LibraryService.enqueuePaletteJob`、`enqueueReadyPaletteJobs`、`generateQueuedPaletteArtifact` | `tests/worker/palette-artifact.test.ts`；`tests/worker/thumbnails.test.ts` | Electron Worker：source-direct 1×1 PNG 直接读取源图提取 bounded 64×64 palette 通过；真实大图/NAS 未验证 |
| 序列帧逐帧复用 artifact 优先、revision-pinned source-direct 回退，并排除缺失/删除帧 | `src/renderer/sequence-frame-preview.ts`；`AssetCardMedia.tsx`；`SequenceFrameCanvas.tsx`；`ImageSequencePlayer.tsx`；`LibraryService.withImageSequenceSummaries` | `tests/unit/sequence-frame-preview.test.ts`；`tests/worker/image-sequence.test.ts`；`tests/e2e/image-sequence-viewer.test.ts` | macOS 隔离 Electron：序列真实 Canvas、暂停后逐帧 source 解码、旋转/镜像与重启持久化 1/1 通过；Windows/packaged/Computer Use 未执行 |
| 超阈值/未知尺寸/非视觉格式保持 derived artifact 语义 | `preview-policy.ts`、`artifact-policy.ts` 与既有 media admission | `tests/unit/preview-policy.test.ts`；`tests/worker/real-media-bundle.test.ts`、`thumbnail-throughput.test.ts`、`media-ignore-scheduling.test.ts`、`folder-browse-entries.test.ts`、`trash-relink.test.ts` | 5 个 Worker fixture 回归 99 passed / 1 skipped；真实复杂格式矩阵未验证 |

## 关键实现

1. `AssetSummary`、`BrowseLayoutEntry` 和 geometry entry 传递 `previewKind` 与
   `previewRevisionId`，避免 Renderer 以“没有 thumbnail artifact”误判为损坏。
2. source URL 只在当前 revision 可用且策略明确允许时生成，artifact URL 仍优先；
   旧 artifact 不被 source-direct 回退覆盖。
3. Inspector 原先只认识 ready thumbnail，现改为在 artifact 缺失时使用同一有界
   source-direct URL，因此不会出现“卡片已解码、Inspector 仍空白”的分叉。
4. source-direct 跳过 primary thumbnail 后，palette 不再等待 thumbnail-completed
   事件。Worker 在入队和 claim 阶段分别做 source/revision/availability 检查，生成时
   只用受限 source read 和 64×64 bounded Sharp 提取，palette 仍是
   `background-secondary`，不是首屏门禁。
5. 测试中需要验证“确实生成 derived thumbnail”的 fixture 改用 2049 px 长边，避免
   旧的 1×1 测试图片被新策略正确地跳过后造成错误失败；这不是放宽断言，而是让 fixture
   表达它测试的 artifact 分支。

## 验证记录

- `npm run typecheck`：通过。
- `npx eslint src/renderer/inspector-preview.ts src/renderer/InspectorPanel.tsx
  src/worker/library-service.ts tests/unit/inspector-preview.test.ts
  tests/worker/palette-artifact.test.ts`：通过。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts
  tests/worker/palette-artifact.test.ts tests/worker/thumbnails.test.ts`：2 files / 76 tests
  passed。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts
  tests/worker/thumbnail-throughput.test.ts tests/worker/media-ignore-scheduling.test.ts
  tests/worker/folder-browse-entries.test.ts tests/worker/trash-relink.test.ts
  tests/worker/real-media-bundle.test.ts`：5 files / 99 passed / 1 skipped。
- `npm run test:library-availability`：9 files / 203 tests passed。
- `node scripts/run-e2e.mjs tests/e2e/media-preview.test.ts --grep "generates a decoded thumbnail"`：
  1 passed / 8.2s；卡片、Inspector 和查看器真实媒体解码断言通过。
- `node scripts/run-e2e.mjs tests/e2e/image-sequence-viewer.test.ts`：1 passed / 8.7s；
  覆盖自动识别、解散/重建、FPS 持久化、播放、暂停后的 source-direct 逐帧解码、旋转、
  右键菜单双向镜像与完整退出后的恢复。测试原先查找已不存在的 toolbar class 和内联镜像
  按钮，本轮按当前查看器交互修正选择器，未改变运行时行为。
- `node scripts/run-e2e.mjs tests/e2e/asset-pagination.test.ts
  tests/e2e/thumbnail-scroll-regression.test.ts`：4 passed / 40.1s。
- `node scripts/run-e2e.mjs tests/e2e/media-preview.test.ts`：1 passed、1 skipped、1 failed；
  source-direct/Inspector 旅程通过，失败项是既有视频错误验收在 `closeLibraryViaSwitcher`
  等待切换器隐藏时超时，非 source-direct 断言失败，仍按未完全通过记录。
- 当前 HEAD 的真实 Electron 20,000 资产滚动基准（相同本地 APFS fixture、两次独立 userData）：
  10/10 + 10/10；P50 为 162.3/156.6 ms，P95/Max 为 315.9/308.4 ms，所有样本
  `longTaskCount=0`。这次基准同时覆盖 source-direct admission、可视区媒体 URL 限制、稀疏几何
  和导航摘要延后；证明本地 20k 组合路径已达 500 ms 目标，但不是 Windows/NAS/packaged 证据。
- source-direct 真实 Electron 小型图 benchmark 首次运行 3/4 个跳转达到 500ms，P50
  456ms、P95/Max 769.1ms；重复运行 2/4，P50 526.4ms、P95 553.9ms。结果仍有明显
  波动，不能宣称 `Serpent-sa65` 或 0032 的 500ms 门禁通过。
- 当前 HEAD 在补齐序列帧 source/revision 路由后再次运行同一 2100 图像命令：3/4，
  P50 462.3ms、P95/Max 672.2ms；第 3 跳转记录 4 个长任务、最长 108ms。P50 有改善
  但尾延迟和长任务仍未达标，不能用这次结果覆盖 20k/100k 门禁。
- `npm run lint`：通过（仅保留 `library-service.ts` 超过 500KB 的 Babel deopt 提示）；
  `npm run typecheck` 同上通过。

## 未完成与风险

当前已取得本地 20k 混合基线，但尚未取得 100k、真实 SMB/NAS、Windows、packaged 和
Computer Use 证据。小图直出减少了 primary thumbnail 工作，但不能替代分别测量
ready artifact、source-direct 和复杂格式三组的 decoded-thumbnail 尾延迟；不能把布局、
协议、源读取和媒体生成混在一个数字里。Stage D.3 因此保持实现完成、性能/平台验收未完成。

## 基准口径更正（2026-08-26）

本日志前面的 20k 两次 10/10 使用了旧版 benchmark：分母只包含已经挂载 `<img>` 的卡片，
遗漏了仍是可见图片但尚未挂载图片元素的卡片。该证据撤回。修正后的默认严格模式在同一
20k APFS 库一次跳转为 0/1（5000.9ms 仍有 13 张图片未解码）；明确标记的 first-wave
模式十次跳转为 9/10，P50 167.1ms、P95/Max 555.9ms，观察窗口内全部图片完成仅 4/10。
first-wave 单次 439.7ms 不能代表稳定通过。因此 D.3 的代码验证仍成立，但 `Serpent-sa65`
和 `Serpent-90ff52` 的性能门禁仍未通过。

## 2026-08-27 追加：有界 source-direct 字节门槛校准

### 变更与原因

将 `SOURCE_DIRECT_MAX_BYTES` 从 1 MiB 调整为 2 MiB，2,000,000 解码像素和 2048 px
长边限制保持不变。真实 19,965 live asset 夹具的 1K PNG 桶有 2,399 个文件，每个源文件
为 1,477,290 bytes、786,432 pixels；原先仅因 PNG 是无损编码、略超过 1 MiB 而进入
primary Sharp 缩略图队列。新门槛使这批低像素源图走 revision-pinned `serpent://source`
直出，预计移除 2,399 次冗余 primary thumbnail 生成，同时不会放行 2K 图或未知尺寸图。

### 四列追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 低像素、约 1.5 MiB 的 PNG 不再生成 primary thumbnail | `src/shared/preview-policy.ts`；`src/worker/artifact-policy.ts`；`src/worker/library-service.ts` | `tests/unit/preview-policy.test.ts` 新增旧门槛以上边界；`tests/worker/thumbnails.test.ts` 新增 1024×768、1.5 MiB 源图无队列断言；同次定向运行 2 files / 72 tests passed | macOS arm64 Worker 实际导入/队列证据通过；真实用户库、Windows、NAS/SMB、packaged、Computer Use 未执行 |
| 保留解码安全边界，超 2 MiB/超 2 MP/超 2048 px 仍走 derived thumbnail | `src/shared/preview-policy.ts` 三个独立 admission 条件 | `tests/unit/preview-policy.test.ts` 的超字节、超像素、超长边和未知尺寸拒绝断言 | 20k 夹具统计确认新增直出仅命中 1K PNG 桶；复杂格式和 2K+ 图片仍未放行 |

### 性能对照与证据边界

使用实际 live 19,965 的 20k 夹具、独立 APFS COW 副本、独立 userData、真实 Electron、固定
10 次跳转和 `all-images` 严格门禁。1 MiB 新鲜副本对照为严格 4/10、全部解码 p50 510.7ms、
p95/max 626.0ms、first visual wave p50 130.7ms、p95/max 216.1ms、最终 10/10；2 MiB
新鲜副本复测为严格 3/10、全部解码 p50 540.1ms、p95/max 618.3ms、first visual wave p50
146.4ms、p95/max 238.1ms、最终 10/10。两次运行都受 4K/8K 冷图尾延迟影响，不能据此
宣称 2 MiB 让严格门禁变绿。另一次 2 MiB 副本是在前一轮并发实验后运行，得到 7/10，因
可能受文件缓存影响不作为主结论。

这组对照没有证明 `Serpent-sa65` 的全部图片 500ms 门禁已通过；冷尾部仍由 4K/8K 等 derived
thumbnail 生成主导。可以确认的优化是策略分类和队列工作量：同一夹具中 source-direct
资产从约 7,196 增至约 9,595，新增约 2,399 个 1K PNG 直接预览；抽样真实卡片中
`serpent://source` 的数量与策略计算一致，且所有观察样本最终完成。该变更仍需混合真实用户
素材、NAS/SMB、Windows、packaged 和人工验收，相关工单不关闭。

### 本次提交后的真实 Electron 回归

`node scripts/run-e2e-isolated.mjs tests/e2e/media-preview.test.ts
tests/e2e/image-sequence-viewer.test.ts tests/e2e/document-preview.test.ts
tests/e2e/asset-pagination.test.ts tests/e2e/thumbnail-scroll-regression.test.ts`：12 个用例中
10 passed、1 skipped、1 failed。通过项覆盖普通媒体真实解码、序列查看器、文档预览、分页和
图片快速滚动；失败项是视频海报滚动在首个 350 ms 采样点偶发留下单个未解码的
`video-scroll-19.mp4`，不是 source-direct 图片断言。为区分稳定回归与时序波动，随后以
`--grep "video poster scrolling" --repeat-each=10 --workers=1` 独立重跑，10/10 passed；因此
这次不修改产品逻辑或放宽断言，保留前一次完整选择性回归的失败证据，不把整组 E2E 写成全绿。
