# 2026-07-20 查看页滚轮缩放（手势起点锚定）与视频缩放开发日志

> 工单：`Serpent-yo0n`（滚轮以指针为中心缩放）、`Serpent-190`（视频查看缩放）。
> 关联：`Serpent-6k1`（Windows 审计 VIEWER-012 普通滚轮不能缩放，同一产品缺陷）。

## 范围与结论

- 图片/动图查看：普通鼠标滚轮直接缩放，触控板双指滚动平移、捏合缩放（设备语义经 `viewer-wheel-intent.ts` 分类）。
- 缩放中心按用户裁决实现为「手势起点锚定」：一次滑动手势的**第一个** wheel 事件记录指针位置为缩放中心，整段手势复用；手势静默 500ms 后下一段滚动重新锚定（`resolveWheelGestureAnchor`）。
- 视频查看：与图片对齐的缩放/平移/Fit——滚轮缩放、放大后拖拽平移、控制栏「适应」按钮与百分比回显、触控板手势、Fit 态横滑切资产；不绑定 D/F 键（为 `Serpent-sk1` 逐帧预留），Space 仍为播放/暂停。
- Cmd/Ctrl + =/-/0 键盘缩放按用户指示**本轮不做**，已开 `Serpent-46i9` 统一设计（覆盖查看页与浏览画布卡片缩放，需先查 macOS 菜单 zoom 角色抢占）。

## 根因（纪律 #10，非补丁）

1. **锚点漂移的根因是 CSS 居中在溢出时改变布局原点**，不是缩放数学。定位过程（真机调试脚本逐帧取证）：① 网格 `place-items: center` —— Chromium 的 safe centering 在媒体溢出时把元素钉到起始边；② 改 `place-items: unsafe center` 无效 —— grid 隐式轨道随内容撑大、轨道本身 start 对齐；③ 改 absolute + `margin: auto` —— 垂直居中成功（marginTop=188.7px 平分），水平仍为 0：CSS 2.1 §10.3.8 对**可替换元素**（img/video）在宽度确定时把 auto 水平 margin 归零。三种机制下渲染原点都比「居中模型」偏移 (media−viewport)/2（实测 233.12px，与断言偏差 233.49 精确吻合）。最终方案：媒体元素 `position: absolute; left/top: 50%; translate: -50% -50%` —— 百分比 translate 相对自身盒，任何缩放级别都居中，布局原点与缩放无关；平移量留在内联 `transform`，与 `translate` 属性先后复合。`zoomAt` 锚点数学与 `clampViewerPan` 模型由此在所有缩放级别成立；旧实现的捏合缩放同样存在此漂移，一并修复。
2. **设备分类**：Chromium 把触控板捏合上报为 `ctrlKey=true` 的 wheel；行/页模式与非 0 小数为离散/连续设备信号；像素模式按「整数且主增量 ≥40px」判定鼠标刻度量。已知折中：驱动级平滑滚动的鼠标（如 Magic Mouse）会被读作触控板而平移，缩放可用 Ctrl/Cmd+滚动——已写入模块注释。
3. **共享状态机**：`use-viewer-zoom-pan.ts` 从 `zoomable-preview-image.tsx` 抽出（fit/pan/zoom/wheel/拖拽/ResizeObserver），图片与视频共用，避免两套手势实现漂移；`ZoomableImage` 对外 API 与语义保持不变。

## 实现位置

- `src/renderer/viewer-wheel-intent.ts`（分类 + 手势锚点，纯函数）
- `src/renderer/use-viewer-zoom-pan.ts`（共享 hook）
- `src/renderer/zoomable-preview-image.tsx`（重构消费 hook）
- `src/renderer/VideoPlayerControls.tsx`（缩放视口 + Fit 按钮 + 百分比）
- `src/renderer/AssetPreviewModal.tsx`（视频接入切资产手势）
- `src/renderer/styles.css`（`.preview-image`/`.preview-video` 改 left/top 50% + translate −50% 居中；新增 `.preview-video-viewport` 视口、`.preview-video-fit`、`.preview-video-zoom-label`）

## 测试

- 单元 `tests/unit/viewer-wheel-intent.test.ts`：分类矩阵 9 例 + 手势锚点 4 例（起点锚定/漂移保持/超时重锚/边界）。
- E2E `tests/e2e/media-preview.test.ts`：普通滚轮缩放 + 指针锚点数学断言（±2px）、手势内漂移不改中心、静默后重锚、Ctrl+wheel 继续缩放、F 回 Fit。
- E2E `tests/e2e/media-video-playback.test.ts`：视频滚轮放大 → 拖拽平移位移 → 「适应」回 Fit。

## 门禁证据（当次命令 + 结果）

- `npm run typecheck`：通过。
- `npm run lint`：8 problems（7 errors + 1 warning）——全部为 react-hooks 7.x 既有问题（干净 HEAD 经 `git stash` 对照一致，已开单 lint 门禁债）；本切片新增/改动文件 0 findings。`.worktrees/**` 残留 agent 工作树曾致 eslint tsconfigRootDir 解析失败，已按 `.claude/**` 先例加入 eslint ignores（`.worktrees/` 本就在 .gitignore）。
- `npm run test:unit`：1013 passed + 1 skipped；唯一失败 `theme-css-tokens`（styles.css 原生 hex 残留）为干净 HEAD 既有红灯，已开单 hex token 债。新增 `viewer-wheel-intent.test.ts` 13/13 通过。
- `node scripts/run-e2e.mjs tests/e2e/media-preview.test.ts tests/e2e/media-video-playback.test.ts`：2 passed——图片滚轮缩放/指针锚点（±2px）/手势锚定/静默重锚/F 回正，与视频缩放→平移→Fit 全绿。`video preview reports a specific generation failure` 失败经 `git stash` 在干净 HEAD 复现（既有红灯，与本切片无关，已开 `Serpent-if0i`）。
- 真机调试取证：一次性 Playwright 调试脚本逐帧导出 boundingBox/computedStyle（marginTop=188.7px 平分而 marginLeft=0px），坐实可替换元素水平 auto margin 归零的根因；脚本用后已删。

## 验收记录

- `Serpent-190` 视频缩放：2026-07-20 用户当场确认「确实有作用了，可以验收」→ 清单 VIEWER-013 记人类验收通过。
- `Serpent-yo0n`：首轮「以光标为中心」验收不通过 → 根因修复（居中布局原点与缩放级别解耦 + 手势起点锚定）后重新进入待人类验收（VIEWER-012 更新）。
- macOS 惯例咨询已答复：捏合/Ctrl+滚动为系统惯例，Cmd+滚轮无系统惯例；键盘 ± 归 `Serpent-46i9`。
- Computer Use：本会话环境具备桌面控制能力（kimi-cu MCP）；真机视觉验收待主 agent 执行或移交。
- 审查规则更新：CLAUDE.md/AGENTS.md 第 11 条按用户要求改为「大规模功能性编码后才审查、只开 2 个 agent、启动前必须询问模型」。
