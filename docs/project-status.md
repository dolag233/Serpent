# Serpent 项目状态

> 更新时间：2026-07-14
> 事实来源：`docs/implementation/mvp-roadmap.md` 与各切片开发/审查/QA 文档

## 当前方向

v0.1.0 先收口 0001–0010 的桌面 MVP 主线。0011 CLI 需求已确认并排入 v0.2.0，不代表桌面客户端优先级更高，只表达领域语义与运行时基础的实施依赖。0012 资产画布与卡片信息配置已在 macOS 完成自动化、双轴审查和 Computer Use 验收（Windows/10 万帧率保留条件）。0013 查看器与 0014 选择/上下文操作属于 v0.1.0 UX 收尾；查看错位与右键菜单无法关闭两个 P0 已完成热修，完整 UX 仍按切片推进。

## 当前前沿

1. **P0 发布阻断**：0006 不可变媒体二进制发布来源与 receipt、packaged media playback；
   建立真实 Windows runner 并执行跨平台矩阵。
2. **P1 验证收口**：0012 已完成 macOS Computer Use 与截图验收；0007 的 relink-preview 主流已完成，但崩溃恢复回到 fixing，另剩 macOS Computer Use 与 Windows；0004 待按当前树复审修复真实行为缺陷，并补打包后与 Windows 证据；
   再完成 0005 packaged 搜索冒烟。
4. **P2 外部旅程**：补 0009 范围分析/清空 UI 与密钥边界决定；完成 0008 真实浏览器扩展
   往返和 0010 大库/跨平台往返。
5. **最终完成审计**：跨资源库复制、视频/GIF 悬停预览、NAS 断线只读、10 万资产冷启动
   3 秒，以及跨切片 packaged/Windows 主线。
6. 0013/0014 完整 UX 实施前先做竞品研究与交互原型；已报告的查看错位与右键菜单关闭缺陷已经完成 P0 热修。

## 2026-07-14 0013 P0 查看错位热修

- 根因：绝对定位的查看器渲染在保留深层 `scrollTop` 的 `.workspace-canvas` 内部，导致查看器使用滚动内容坐标系；稳定复现的偏移量为 `10673px`，与画布当前滚动量完全一致。
- 修复：查看器移到非滚动 `.workspace` 定位上下文；进入时保存、返回时精确恢复画布滚动位置并以 `preventScroll` 恢复资产焦点。
- 自动化：相关 Electron E2E 6/6；最终 `verify:mainline` 全绿（lint、typecheck、extension、874 passed + 1 skipped、搜索性能 4/4、Electron E2E 42/42）。
- Computer Use：在真实 142 项资源库滚动至第 100 项附近后打开图片，查看页面位置与解码正常；返回后原位置和选择保持。
- **状态：P0 通过，可验收 `VIEWER-001`；完整 0013 仍未完成。**
- 详见 `docs/development/0013-asset-viewer-navigation-and-gestures-development-log.md` 与 `docs/qa/0013-asset-viewer-navigation-and-gestures-qa-report.md`。

## 2026-07-14 0012 实施与门禁

- 版本化画布偏好模块 `src/renderer/canvas-preferences.ts`（Zod 校验、遗留 key 迁移、存储可注入）+ App.tsx 集成（统一 state、3 字段开关 `文件名`/`文件大小`/`修改日期`、条件化 aria-label、条件化 caption）。
- 最终 `verify:mainline` 全绿：lint/typecheck/extension、798 passed + 1 skipped、search perf 4/4、Electron E2E 20/20。
- 双轴审查完成、阻断项已修（descriptor 数组、PREF_KEY import、实际卡片宽度断言、tag/collection scope）。
- **有条件通过**：macOS Computer Use 与截图门禁完成，发现并修复空 caption、工具栏逐字换行和窄窗设置裁剪；Windows 与 10 万资产帧率未验证。
- `process-lifecycle` 已用 fresh E2E profile 隔离；不存在 recent 路径的完整重启回归约 0.8 秒回到起始页，未复现交接文档推断的生产挂起。
- 详见 `docs/development/0012-asset-canvas-views-and-card-display-development-log.md`、`docs/reviews/0012-asset-canvas-views-and-card-display-code-review.md`、`docs/qa/0012-asset-canvas-views-and-card-display-qa-report.md`、`docs/implementation/0012-design-decisions-2026-07-14.md`。

## 状态校准（2026-07-14）

- 0003 的可编辑规则、复制与 linked→managed 已有实现/测试；主要剩余规格偏差与平台证据。
- 0004 已完成字段清空、输入校验、串行乐观锁、批量/递归一致性、完整重启与竞争写入 E2E，并完成 macOS Computer Use；packaged 与 Windows QA 保留条件。
- 最终主线门禁为 810 passed + 1 skipped、搜索性能 4/4、Electron E2E 22/22；E2E 默认 profile 已隔离，完整重启/单实例用例仅共享显式传入的临时 profile。
- 0005 自动化与 10 万资产热查询性能门禁已通过，剩余以 packaged/人工/Windows 证据为主。
- 0006 的本地真实队列、source/proxy 播放、Computer Use 和最终 mainline 已通过；发布仍被
  二进制来源、packaged playback 与 Windows 阻断。
- 0007 已完成 stateful relink-preview 增强（RelinkPreviewStore create/apply/cancel + 候选去重 + FILE_BUSY + 多选永久删除对话框）；独立验收确认 `crash-relink-*` failpoint 只声明未调用，重新定位崩溃恢复没有测试覆盖，旧“规格完整/0 HARD”结论已撤回。另待 macOS Computer Use 与 Windows 验证。
- 0009 已存在有界缩略图输入、并发限制、进度事件和任务控制 UI；真实功能缺口集中在按范围
  分析/清空入口与密钥边界决定。

## 2026-07-14 已记录的查看页面 UX 缺口

- 图片、视频及其他支持查看的资产首次打开应完整显示并尽可能撑满查看区域，不能裁剪或变形。
- 移除常驻底部缩放条；重新设计敷衍的顶部工具栏，优先探索无栏沉浸画布和左上角轻量“返回”。
- 查看页面的退出语义是“返回资产浏览”，不是“关闭”；Esc 与返回入口结果一致。
- 提高 macOS 触控板 pinch 灵敏度，统一缩放焦点，并实现成熟、低冲突的平移交互。
- 在查看页面切换文件夹、合集、标签等资产范围时，必须先返回资产浏览页面。
- 深滚动进入查看页面的错位已完成 P0 热修；其余详细范围与验收条件见 `docs/implementation/0013-asset-viewer-navigation-and-gestures-vertical-slice.md`。

## 2026-07-14 0014 P1 选择模型

- 框选（marquee drag-select）：3 阶段 document-level mousedown/mousemove/mouseup + AABB box-overlap intersection（grid/masonry 一致）+ 40px 边缘自动滚动。
- 组合键模型：普通点击始终只选择目标；Ctrl/Cmd+click 增减；Shift+click 范围扩展（基于 selectionAnchorRef）；Ctrl/Cmd+Shift+click 范围追加。
- Esc 清除选择：非捕获 handler 在 `selectedAssetIds.length > 0` 且无 preview 且无 modal dialog 时清选；捕获阶段 guard（`stopPropagation`）在上下文菜单打开时阻止清选，确保第一 Esc 只关闭菜单、第二 Esc 才清选。
- 选择锚点修复：框选 mouseup 结束时设置 `selectionAnchorRef` 为第一个命中资产 ID，使后续 Shift+click 可从框选结果正确扩展。
- 死代码清理：移除未使用的 `autoScrollRaf` 变量及其 `cancelAnimationFrame` 清理分支。
- 交叉去重：`marqueeHitIdsRef` 存储 mousemove 命中结果，mouseup 复用避免重复 DOM AABB 遍历。
- 右键 mousedown 追踪：`lastMousedownButtonRef` 防止 Playwright 右击合成的 click 事件触发 re-click-deselect（真实浏览器右击不派发 click，仅 contextmenu）。
- 新增 E2E 测试 `tests/e2e/selection-marquee.test.ts`：10 项测试（5 原有 + 5 新增：框选后 Shift 扩展、选择生存视图切换/缩放、Ctrl/Cmd 增减往返、瀑布流自动滚动、上下文菜单 Escape 序贯保护）。
- 修复后验证：typecheck/lint 绿、unit 320 passed、E2E 24/24（selection-marquee 10 + context-menu 7 + organization-search-trash 3 + media-preview 2 + browsing-preferences 2）。
- 双轴审查：Standards 0 HARD 违规（medium 已修复：stale-anchor、dead-code、intersection-dedup；non-blocking follow-up：Primitive Obsession、Long Method、Windows Ctrl）。Spec 选择模型完成；测试缺口 line 21/16/20 已关闭；Windows Ctrl 已确认缺口。
- **状态：P1 选择模型完成；剩余 0014 = 移除顶部批量条 / 批量菜单连线 / 视觉打磨。未 accepted — Computer Use 人工视觉 QA 与 Windows 平台验证未执行。**
- 详见 `docs/development/0014-asset-selection-and-context-actions-development-log.md`、`docs/reviews/0014-asset-selection-and-context-actions-code-review.md`、`docs/qa/0014-asset-selection-and-context-actions-qa-report.md`。

## 2026-07-14 0014 P0 右键菜单热修

- 实现：新文件 `src/renderer/context-menu.tsx`（`ContextMenuProvider`/`useContextMenu` 单一状态控制器、`ContextMenuBackdrop` 5 套关闭监听、`ContextMenu` viewport clamp/flip、`ContextMenuItem`/`ContextMenuSection` 统一菜单项与分组）；`App.tsx` 重构（消除 3 套分散菜单实现，统一为 `useContextMenu` hook + `<ContextMenu>` 组件）；`src/renderer/styles.css` 新增统一设计 token（+110 行）。
- 可靠关闭触发器：外部点击（document capture phase）/Escape/滚动/resize/窗口 blur/范围切换（`chooseFolder`/`chooseTag`/`chooseCollection`/`chooseSmartCollection`）/菜单项执行后自动关闭。
- 新增 E2E 测试 `tests/e2e/context-menu.test.ts`：7 项测试覆盖外部点击/Escape/滚动/resize 关闭、viewport 边缘 clamp、单菜单 mutex、可访问名称与 Escape、窗口 blur、四角 viewport clamp、范围切换关闭。
- 验证通过：typecheck/lint、unit 320 passed、context-menu E2E 7/7、回归 organization-search-trash 3/3 + media-preview 2/2 + browsing-preferences 2/2。
- 双轴审查通过（0 HARD 违规，4 非阻断气味已记录为 follow-up）。死代码 `useSingleContextMenu` export 已移除。
- **有条件通过**：P0 热修完成；P1 完整切片（框选、组合键模型、移除顶部批量条、统一批量右键菜单、视觉打磨）待实施；macOS Computer Use 人工视觉 QA 与 Windows 平台验证未执行。
- 详见 `docs/development/0014-asset-selection-and-context-actions-development-log.md`、`docs/reviews/0014-asset-selection-and-context-actions-code-review.md`、`docs/qa/0014-asset-selection-and-context-actions-qa-report.md`。

## 2026-07-14 已记录的选择与右键菜单 UX 缺口

- 资产画布增加框选；统一 Windows Ctrl / Shift 与 macOS Command / Shift 的增选、范围选择和取消选择语义。
- 移除遮挡画布的顶部多选操作条，把单项/批量动作统一到右键菜单。
- 右键菜单需要统一视觉与定位，并在外点、Esc、滚动、resize 和窗口失焦时可靠消失。
- 详细范围与验收条件见 `docs/implementation/0014-asset-selection-and-context-actions-vertical-slice.md`。

## 2026-07-13 浏览与恢复收口

- 缩略图等比显示；支持媒体缺少预览时自动生成；查看页面不被生成任务阻塞。
- 客户端查看嵌入中央，支持前后切换、统一缩放和视频原生控制。
- 浏览区无分页，平铺/瀑布流连续加载；卡片尺寸可调并保留视觉锚点。
- 瀑布流顶部负溢出裁剪已修复，首尾可达加入 E2E。
- Main 保存最近资源库路径，Renderer 保存不含绝对路径的浏览范围/资产身份；完整进程重启后自动恢复与聚焦。
- 通知 5 秒、错误 10 秒自动关闭；完整诊断仍保留在持久日志。

## 仍未宣称完成

Windows 未进行真实平台 QA；0006 的首发视频格式、FFmpeg/OIIO 随包分发和 packaged-app 媒体主线仍需验证。任何“已实现”不等同于满足项目完成定义。
