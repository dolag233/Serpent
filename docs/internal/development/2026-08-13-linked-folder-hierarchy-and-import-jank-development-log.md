# 链接文件夹层级与大批量导入卡顿

## 工单与范围

- `Serpent-a9vh`（P0）：链接文件夹按磁盘层级显示子文件夹
- `Serpent-7216`：导入后不再显示操作提示文案
- `Serpent-yti0`（P1）：大批量导入后 UI 卡顿，派生任务看起来未并行
- `Serpent-vjuf`（P1）：缩略图失败时回退显示原图
- `Serpent-l1oi`（P1）：瀑布流宽高比使用源分辨率元信息

当前状态：LINK-006/007、PERF-001、CANVAS-036 人类通过。Windows 打开后残留小框选已开单
`Serpent-er9g` / SELECT-016，未修。Computer Use、packaged 未执行。

## 根因

链接资产只记录导入根 `linked_folder_id` 与 `relative_file_path`。浏览与侧栏把链接根当成扁平节点，子目录资产全部堆在根上。

缩略图、色板、OIIO 成功会发 `asset.changed`；`revision_artifacts` 写入还会触发 `library.changed`。Renderer 对这两类事件做全量 `searchAssets` + 重绘网格。大批量导入后每张缩略图都打断画布。任务管理器里其他 Electron 进程空闲符合「单一 Library Worker + 有界异步并发」架构，不是多进程空转。

瀑布流在缺少 `width`/`height` 时用 `col * 0.72`（接近 4:3）。图片宽高原先主要等缩略图 artifact。失败卡片只显示占位和「缩略图失败」，即使 `serpent://source` 可以解码。

## 实现

- 虚拟子目录 id：`lfv:{rootId}/{relativePath}`，无新表、无破坏性迁移。
- `listLinkedFolders` / `listFolderBrowseEntries` / `searchAssets` / `listAssets` 按路径前缀区分当前层与递归。
- 侧栏去掉 `nav.linkedFolderHint`；链接树可展开。
- 导入与 refresh 用 header 探测写入 `extracted_metadata` 宽高。
- 缩略图/色板/OIIO 不再发 `asset.changed`；`library.changed` 不再全量重载网格。卡片由 `onThumbnailEvent` 就地更新。
- 图片缩略图失败时卡片使用默认文件图标，不回退原图、不显示黄色警告角标。
- 打开/排空后继续入队缺失缩略图（每波 500，priority 50）；有未完成缩略图时不入队色卡。
- 2026-08-14：窗口化使框选只能命中已挂载的约 50 张卡，曾撤回全量挂载；随后 Renderer
  工作集约 3.8GB、界面再次卡死。现恢复窗口化，框选改为命中已发布的全量布局几何。
- 缩略图并发改为 `logicalCpus - 3`（预留 2 个给系统、1 个给当前 Serpent 线程），
  不再写死 8 路 / 每波 16。高峰仍跳过 EXIF 与宽高回填。
- 导入同步 header 探测上限 64；其余由 `backfillMissingImageDimensions` 后台回填并发送 `asset.dimensions.ready`。

## 2026-08-14 绘画资源库只读证据

`E:\Resources\Serpent\绘画资源库\.serpent\library.db`：

- assets 7180（全部 linked；根层 4940，嵌套 2240）
- thumbnail ready 190 / failed 5；extracted_metadata 带 width 5
- jobs queued/running 0；extract_palette succeeded 190
- 扩展名以 `.jpg` 6346、`.png` 834 为主

## 验证记录

已执行：

```text
npx vitest run --config vitest.config.ts tests/unit/linked-folder-tree.test.ts tests/unit/unified-directory-nav.test.ts tests/unit/folder-card-selection.test.ts tests/unit/folder-breadcrumb-trail.test.ts tests/unit/asset-card-hover-preview.test.ts
npx vitest run --config vitest.config.ts tests/unit/media-concurrency.test.ts tests/unit/canvas-asset-layout.test.ts tests/unit/viewport-window.test.ts tests/unit/masonry-preview-frame.test.ts tests/unit/justified-slot-style.test.ts tests/unit/marquee-geometry.test.ts tests/unit/marquee-selection.test.ts
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/linked-folders.test.ts
```

结果：单测 5 files passed；窗口化/并发定向 7 files / 39 passed；Worker `tests/worker/linked-folders.test.ts` 17 passed (4.88s)。本机直接 `vitest` 跑 Worker 会因 better-sqlite3 Node ABI 不匹配失败，需走 Electron 脚本。

Computer Use、packaged、Windows 未执行。

## 2026-08-14 晚间工单收口

本批新增并实现：

- `Serpent-er9g`：框选层初始 `display:none`，只有真实拖框时由选择逻辑显示。
- 框选滚动坐标：已挂载卡片优先使用实时 DOM 矩形，未挂载卡片才使用发布的全量布局；每次新拖框清空旧矩形缓存，修复滚动后把上一行卡片误选的问题。
- `Serpent-4mlf` / `e71f`：刷新列表时按 `currentRevisionId` 保留已就绪封面，虚拟卡片封面改为 eager，避免快速滚动回退默认图标。
- `Serpent-7hri` / `b4ix`：从单资产与多选右键菜单移除“复制到外部目录”；链接文件夹拖入路径保留。
- `Serpent-nd35` / `6ywf`：确认递归祖先计数逻辑并补充跨子文件夹移动回归测试。
- `Serpent-ni8w` / `47s4`：保留主进程文本路径复制，新增 macOS `⌥⌘C`、Windows `Ctrl+Shift+C`。
- `Serpent-lf16` / `n8tl`：新增仅携带资产 id 的原生文件拖拽 IPC；Worker 解析路径后由 Main 调用 `webContents.startDrag`，不要求 Windows 安装 Bash 等额外软件。
- `Serpent-lpnt` / `k2zw`：Sharp 解码失败的 JPEG 进入内置 FFmpeg 截帧恢复，产出 ready WebP artifact。

同时确认 `Serpent-a9vh`、`7216`、`l1oi` 已由此前实现覆盖；`Serpent-vjuf` 按用户决定关闭为 superseded：失败卡片保持默认文件图标，不回退浏览器原图。

本次自动化证据：`npm run typecheck`、`npm run lint`、`npm run test:unit`（331 files / 2518 tests）、Electron Worker 定向测试（JPEG 恢复、链接层级/尺寸、祖先计数）以及链接文件夹 + 框选 + 右键菜单 E2E（32/32）通过。Windows 真机、QQ/微信原生拖拽和 Computer Use 未执行，已写入人类验收清单。

主线门禁的 `npm run verify:mainline` 已通过 lint、typecheck、extension verify；全量 Worker 测试复现仓库既有 `video-exr` 2、`real-media-bundle` 1、`palette-artifact` 3 个失败，随后无输出挂起并以 130 终止，未将其记为本批回归。

## 2026-08-14 P0：Value:3 快速滚动与原生资产拖拽回归

本轮 Computer Use 的固定复现参数记录为：当前 `npm start` 实例、瀑布流视图、资产缩略图大小滑块无障碍值 `Value:3`（约 5 列）。此前在该档位连续下滚 10 次时，中央列出现拦腰式白区，卡片角标也可能脱离卡片；后续复现不得改用默认缩略图大小。当前机器重新检查时处于锁屏状态，真实桌面验收尚未执行，不能把自动化结果写成人工通过。

空白回归的修复收口为：普通规模资源库（不超过 256 项）保持完整卡片树，避免快速滚动时虚拟窗口反复卸载/挂载造成可见空洞；大资源库仍保留窗口化；静态缩略图使用 eager；刷新列表时按 `currentRevisionId` 保留已就绪 artifact。新增 `tests/e2e/thumbnail-scroll-regression.test.ts`，在 `Value:3` 下覆盖 100 张混合比例图片与视频海报，检查滚动过程可见卡片、列高度、图片解码和角标完整性。

原生拖拽修复为 Main 侧使用真实预览 artifact（无 artifact 时使用非空小型 fallback），不再把 Serpent 应用图标作为拖拽图；Renderer 只传资产 ID，Worker/Main 解析绝对路径；回拖到文件夹、回收站、合集和链接文件夹时从 OS 文件路径回溯资产 ID，避免原生拖拽丢失自定义 MIME 后退化为重复导入。E2E 中显式使用 `window.serpent.e2e` bridge 保留 HTML5 拖放测试，防止测试进入真实 OS 拖拽循环。

本轮自动化证据：

```text
npm run test:unit                                      # 331 files / 2518 passed
npm run typecheck                                      # passed
npm run lint                                           # passed
npx playwright test tests/e2e/thumbnail-scroll-regression.test.ts tests/e2e/folder-recursive-scope.test.ts --workers=1
                                                        # 5 passed
npm run test:worker -- tests/worker/thumbnails.test.ts -t "maps native dropped" --reporter=dot
                                                        # 1 passed
npx vitest run tests/unit/asset-drag-preview.test.ts tests/unit/asset-drag-drop.test.ts tests/unit/protocol.test.ts --reporter=dot
                                                        # 98 passed
```

仍待解锁后用 Computer Use 在同一 `Value:3` 下验证：快速连续滚动、资产拖到 Serpent 内部并处理冲突窗、拖到 Finder/外部、取消拖拽后继续点击操作。Windows 原生拖拽仍未在真机执行。

## 2026-08-14 用户复核后的范围修正

用户复核后撤回以下快速滚动方案：刷新时保留上一轮 `ready` 缩略图、静态卡片改用 `loading="eager"`、小资源库禁用窗口化。这组方案没有解决白区问题，且实际滚动表现不可接受；对应 Renderer 辅助函数和单测已撤回。`Serpent-1s3d` 仍是未解决的 P0，Value:3 仍是固定复现档位。

原生拖拽继续保留独立修复：Worker 按当前 revision 返回卡片缩略图/视频 `video_poster` 的真实路径，Main 生成 96×72 拖拽图并使用可见文件图标兜底；Renderer 在 Escape 时清理拖拽 ghost 与内部拖拽状态。`npm run typecheck`、`npm run lint`、协议/拖拽相关单测 4 files / 101 tests 通过；Computer Use 在 Value:3 下中途按 Escape 后资源库未变且应用保持响应。截图无法可靠捕获 macOS 原生拖拽代理本身，因此图标视觉仍需人眼观察。

## 2026-08-14 Serpent-1s3d：截断式白区

用户补充：第四档最明显；快速向下滑动时，下面新露出的区域是截断式整片纯白，不是单张卡片没刷出缩略图。

根因不是「禁用窗口化」能修的小库问题。固定 `VIEWPORT_OVERSCAN_PX = 1200` 在大卡片下只覆盖约 4 张卡的跑道；scroll 事件经 rAF 再 `setState` 后，React 提交时视口已经再往下走了一截，旧切片的 `spacerAfter` 露成白区。同时卡片实际高度若与 `columnWindow` 估算不一致，单列会拦腰错位。

修复：

1. `viewportOverscanPx` 至少 `max(1200, 视口×3, 卡片×8)`，瀑布流/平铺窗口共用。
2. `masonryCardSlotStyle` 把槽位高度和 `--masonry-preview-height` 锁成与窗口化同一套估算；CSS 去掉 `.masonry-column` 的 14px gap，避免 spacer 看不见的空带。
3. 缺宽高占位从 `col*0.72` 改为与 `.asset-preview { aspect-ratio: 1.3 }` 一致。

自动化：`tests/unit/viewport-window.test.ts`、`masonry-slot-style.test.ts`、`masonry-preview-frame.test.ts`；E2E `thumbnail-scroll-regression.test.ts` 改为在 Value:3 下断言视口内无 >80px 未覆盖带，不再要求小库挂载全部卡片。2026-08-14 用户复验：仍有类似截断白区，体感略好一点；CANVAS-037 记为人类验收不通过，`Serpent-1s3d` 保持 open。

## 2026-08-15 Serpent-1s3d：修复滚动提交竞态

### 根因与修复

诊断 E2E 在连续跳转 `0.84 → 0.31` 时稳定捕获到：`scrollTop=1378`，但 React 仍提交上一轮
深处窗口，最前一个槽位落在视口下方，`maxUncoveredBandPx=406`。问题不在媒体缩略图是否
解码，而在 `useCanvasLocalViewport` 的 `scroll → requestAnimationFrame → setState` 时序：
反向滚动时，旧窗口会在新视口已经出现后多保留一帧。此前的 `max(1200, view×3, card×8)`
只覆盖普通跳跃，不能覆盖快速反向跳跃。

本次修复：

1. `src/renderer/viewport-window.ts` 在 scroll handler 内立即读取并发布窗口，去掉中间的 rAF
   队列，减少一帧陈旧切片。
2. 窗口跑道调整为 `max(1200, viewport×5, cardSize×12)`，使 compositor 事件到 React 提交
   的交接期间，上一窗口仍覆盖新视口；没有禁用窗口化，也没有改成全量 eager 缩略图。
3. `tests/e2e/thumbnail-scroll-regression.test.ts` 的真实跳转序列扩展为 12 次，包含连续下滚、
   大幅反向跳转和再次下滚；每次在 DOM 更新前立即检查视口内未覆盖带是否 `<80px`。

### 质量证据

| 需求条目 | 实现位置 | 自动化测试 | Computer Use / 平台证据 |
| --- | --- | --- | --- |
| 快速滚动时新进入视口的列不出现整片白区 | `src/renderer/viewport-window.ts` 的同步 scroll 发布与 `viewportOverscanPx` | `npx vitest run tests/unit/viewport-window.test.ts tests/unit/masonry-slot-style.test.ts --reporter=dot`：13 passed；`node scripts/run-e2e.mjs tests/e2e/thumbnail-scroll-regression.test.ts`：2 passed | macOS 开发态真实 Electron，`场景原画参考库` 477 项、瀑布流；Value:3 采集 55 帧并执行 10 次快速滚动，Value:2/1 各采集 50 帧并执行 10 次；ScreenCaptureKit 按 100ms 间隔采样，所有帧未见截断白区 |

`npm run typecheck` 和 `npm run lint` 均通过。2026-08-15 用户本人确认：至少 10 次快速滑动
未出现截断式白区，CANVAS-037 人类验收通过。packaged 与 Windows 未执行。
