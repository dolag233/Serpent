# Serpent 项目状态

> 更新时间：2026-07-16
> 事实来源：`docs/implementation/mvp-roadmap.md` 与各切片开发/审查/QA 文档

## 当前方向

v0.1.0 继续收口 0001–0010 的桌面主线，并纳入真实使用反馈确认的 0013–0019 产品化范围。0011 CLI 仍排入 v0.2.0，这只表达领域语义与运行时依赖。0012 已完成 macOS 开发态验收；0014 形成候选 `f1330a7`，但新反馈确认 Inspector、框选修饰键、瀑布流、完整文件菜单、应用壳、目录浏览、标签、双语和主题仍属于 MVP 待办。

## 当前前沿

1. **P0 发布阻断**：0006 不可变媒体二进制发布来源与 receipt、packaged media playback；
   建立真实 Windows runner 并执行跨平台矩阵。
2. **P0 产品正确性**：0018 Label 退役及 0019 Inspector、框选、瀑布流、clock 图标和菜单输入模式已形成实现提交 `5b8b8fe`；真实 Electron E2E、Computer Use 与双轴审查已完成。用户已验收 Inspector 标签、瀑布流横向优先以及等比无框轻圆角预览；最新资产身份区居中布局待其查看。
3. **P1 MVP 产品化**：0016-A 资源库菜单、可点击面包屑、历史导航和普通/链接统一树已落地（SHELL-004、NAV-001–003 待人类验收）；壳层装饰清理与菜单分组/快捷键显示已由用户验收。下一步完成 0015 命令注册表/本地化/主题、0017 文件夹与文件操作、0018 批量标签过滤。详细同步见 `docs/development/0015-0016-progress-sync.md`。
4. **P1 验证收口**：0012 已完成 macOS Computer Use 与截图验收；0007 的 relink v3 已关闭已知文件所有权风险，仍需真实 UtilityProcess kill/restart、macOS Computer Use 与 Windows；0004 待按当前树复审修复真实行为缺陷，并补打包后与 Windows 证据；
   再完成 0005 packaged 搜索冒烟。
5. **P2 外部旅程**：补 0009 范围分析/清空 UI 与密钥边界决定；完成 0008 真实浏览器扩展
   往返和 0010 大库/跨平台往返。
6. **最终完成审计**：跨资源库复制、视频/GIF 悬停预览、NAS 断线只读、10 万资产冷启动
   3 秒，以及跨切片 packaged/Windows 主线。

## 2026-07-17 0017 第三增量：托管文件夹右键菜单与真实重命名

- REQ-MENU-005 部分落地：统一目录树中托管文件夹获得共享组件右键菜单——「新建子文件夹」（落在被右键文件夹下）与「重命名…」（folder.rename 全链路：物理目录 rename + 后代文件夹/子树资产路径前缀事务重写 + 未删除资产 FTS 同步 + 失败回滚；冲突 FOLDER_NAME_CONFLICT 与非法名 INVALID_FOLDER_NAME 类型化拒绝，纯大小写改名可行；回收站恢复经 trashed_from_folder_id 落回新目录）。复制/粘贴/克隆/移动/删除待澄清队列 #5/#7 裁决，不在本增量。
- 验证：typecheck/lint、unit 398 passed；worker folder-rename 10/10 + asset-rename 8/8；E2E 新文件 4/4、修复后复跑 18/18（folder-context-menu/asset-rename/context-menu/shell-navigation）；`test:e2e` 清单补挂 folder-context-menu 与上一增量遗漏的 asset-rename。
- 交叉审查（1 Standards 深审 + 1 Spec 深审 + 4 广度）：0 HARD 安全项；纪律 #8（App.tsx 内联）已抽 `useFolderActions` hook、文案双真源已并入共享表、父名提示重复已撤销、取消路径陈旧 parentId 已清、maxLength 对齐 80；回滚分支/崩溃窗口按纪律记未验证。
- **Computer Use 未执行**（当前环境无桌面控制能力）：MENU-016/MENU-017 进入待人类验收，截图证据移交人工 QA。
- 详见 `docs/development/0017-folder-context-menu-and-rename-development-log.md`。

## 2026-07-17 0017 第二增量：资产文件重命名与侧栏标签枚举移除

- REQ-MENU-002 重命名落地：asset.renameFile 全链路（protocol/preload/main/worker），扩展名保留、非法名（含 Windows 禁用字符 `<>:"|?*`，审查修正）与同名冲突类型化拒绝、missing/trashed/offline 拒绝、同名 no-op、FTS 事务内同步；单资产菜单新增「重命名…」，对话框保留扩展名、内联中文错误、选择保持。
- REQ-TAG-001 落地：左侧导航不再枚举标签、不再提供侧栏新建标签入口；tag 范围机制保留（发现工具栏「标签过滤」输入框仍是进入标签范围的 UI 入口）；标签重命名/删除暂无 UI 入口，待集中澄清队列 #8 裁决（worker 能力保留）。
- 验证：typecheck/lint、unit 395 passed；worker rename 8/8；E2E 当次全绿——asset-rename 3/3、context-menu 10/10、organization-search-trash 3/3、metadata-persistence、asset-pagination、browsing-preferences、shell-navigation（含新增 REQ-TAG-001 负向断言）。
- 交叉审查（2 深审 + 4 广度）：0 HARD；M1（Windows 禁用字符）已修并补测试；M3（缺负向断言）已补；回滚/IO 失败分支按纪律记未验证。
- **Computer Use 未执行**（当前环境无桌面控制能力）：MENU-015 进入待人类验收，截图证据移交人工 QA。
- 详见 `docs/development/0017-rename-file-and-tag-nav-removal-development-log.md`。

## 2026-07-17 0017/0018 增量：可搜索标签选择器与文件操作命令

- REQ-TAG-004 落地：资产右键菜单标签操作（单资产添加、批量添加/移除）从平铺枚举改为可搜索选择器；菜单添加包含零使用标签（选择器无创建入口），移除与 Inspector 建议保持 TAG-008 排除；修复审查发现的菜单内滚动误关菜单与返回后焦点丢失。
- REQ-MENU-002 部分落地：单资产新增「在 Finder/Explorer 中显示」「复制文件路径」，全链路仿 openExternal（Main 进程 shell/clipboard），绝对路径不越界（REQ-COMMAND-003，协议单测双向注入拒绝）。
- 验证：typecheck/lint、unit 391 passed；E2E 16/17 文件当次全绿（含新选择器交互用例，context-menu 10/10）。双轴审查：Standards 通过、Spec 有条件通过（HARD-1/MEDIUM-1 已本回合修复复验）。
- **Computer Use 未执行**（当前环境无桌面控制能力）：TAG-004/TAG-005 保持不通过、待补截图证据后重新验收；SHELL-004/005/006 与 NAV-002 的 0016-A 修复已按用户指示重新进入待验收。
- **known-red 移交**：`tests/e2e/linked-folders.test.ts` 为另一 agent 未提交改动，其 `.empty-actions` 作用域下不存在「导入链接文件夹」按钮（该按钮在 `.tool-group-import` 与侧栏 secondaryAction），3/3 红；本回合未触碰该文件，修正方向已记录在开发日志。
- 详见 `docs/development/0017-0018-searchable-tag-picker-and-file-commands-development-log.md`。

## 2026-07-16 新增 MVP UI/UX 与文件管理需求

- 两轮真实使用反馈已形成共享需求池：`docs/implementation/mvp-ui-ux-requirements-backlog.md`；0015–0019 的暂定范围和 12 项集中澄清问题均在该文档。
- 已确认进入 MVP：应用壳与面包屑/历史、文件夹卡片与封面/计数/递归范围、完整资产和文件夹菜单、命令快捷键、中英文、亮/暗主题、标签 chip/过滤入口、Inspector 真实缩略图，以及选择和瀑布流正确性。
- 已确认产品模型变化：撤销 Label/资产显示别名，资产名称统一为真实文件名；ADR 0022、产品简报、领域模型和术语表已同步。v14 前向迁移直接丢弃预发布 Label/AI Label，并删除显式依赖 Label 的旧智能合集；其余元数据、标签关系和智能合集保留。实现与 macOS 开发态 QA 见 `5b8b8fe`。
- 自定义主题明确推迟到 MVP 后；Eagle 是信息密度和控件分组参考，不是逐像素复制目标。
- 四张用户截图已保存到 `docs/前端参考/2026-07-16-*.png`，包括 Eagle 布局/过滤参考、Serpent 瀑布流空当和标签 chip 方向。
- 0015–0018 仍未全部完成；`38fa873`、`591f524`、`64521c3`、`197ea9e`、`e2d5d60` 的部分 UI/UX 实现已在当前基线，完整状态和缺口见进度同步记录。0018 的 Label 退役和 Inspector 标签入口已形成候选，批量标签选择器与标签过滤仍待实施。0019 当前候选已合流此前独立改动并补齐集成测试、真实应用检查和等比预览修复。

## 2026-07-16 0018–0019 当前候选

- Inspector 已显示真实 artifact，切换时按资产 ID 隔离元数据/AI 内容且不显示“连接中/加载中”占位；预览采用自然比例、宽度优先和最大高度约束。
- Inspector tag chip 支持直接移除、空输入建议、搜索、输入创建、鼠标立即添加和方向键/回车；零使用标签不进入建议。用户已明确反馈“标签验收了，还不错”。
- 瀑布流改为首行从左到右、后续最短列的显式列布局；稀疏三资产、多比例、多卡片尺寸和窗口宽度均有真实 Electron 断言。用户已明确反馈“瀑布流验收了，还不错”。
- Shift 框选会释放导航焦点；右键菜单按指针/键盘输入模式显示单一、克制的高亮；修改日期使用时钟图标。
- schema v14 完成 Label/AI Label/FTS Label 退役；预发布值按产品决定直接丢弃，依赖 Label 的旧智能合集删除，其他元数据与智能合集保留。
- 代码基线为 `07d2f7e`（实现提交 `5b8b8fe`，文档/证据提交 `07d2f7e`）；Computer Use 截图、双轴审查和自动化见对应开发/审查/QA 文档。Windows 与 packaged app 仍未验证。

## 2026-07-16 0019 产品正确性分支审计（已解决）

- 早期独立候选没有进入当时主线，验收链接一度失效；其功能已由当前集成实现、测试和文档在 `5b8b8fe` 统一落地，不再依赖那些孤立提交。
- CANVAS-007–009、INSPECT-001–004、MENU-013、SELECT-007 已按当前基线重新建立准确的人类验收条目；其中用户已验收 CANVAS-009 与 INSPECT-003。
- 框选集合语义现为 Shift 并集、Command/Ctrl 切换、Command/Ctrl+Shift 范围追加；Windows 真实 Ctrl 仍待平台验证。

## 2026-07-16 0014 功能收口与 0007 文件恢复安全

- 候选提交 `f1330a7` 完成框选、跨视口多选、Windows Ctrl / macOS Command 与 Shift 组合键、统一单项/批量右键菜单，并移除遮挡画布的选择态顶部操作条。
- 右键菜单显示明确选中数量；混合选择对不适用动作给出跳过说明；动作执行使用打开菜单时的选择快照，避免菜单打开后选择变化导致误操作。
- Computer Use 在真实 Serpent 中发现并修复顶部选择操作仍残留的问题；入口、缺陷和修复后三张截图已经进入 `docs/qa/evidence/0014-selection-context/`。
- 0007 relink v3 使用不可变 manifest、放置回执、源身份与 SHA-256 校验；恢复不明确时保留两侧文件并记录诊断，不再凭路径猜测删除。
- 自动证据：lint、typecheck 通过；relink Worker 11/11；相关 Electron E2E 26/26。最终工具栏迁移后的完整 `verify:mainline` 尚未重跑，避免把历史全量结果误写成当前候选结果。
- **可供人类验收**：0014 中仍符合当前产品方向的选择与菜单基础行为；标签菜单 `MENU-003` 已因新信息架构撤回，准确队列见 `docs/qa/human-acceptance-checklist.md`。
- **保留条件**：真实 UtilityProcess kill/restart、最终合流门禁、packaged/Windows 平台验证。

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
- 0007 已完成 stateful relink-preview 与 v3 文件所有权恢复安全（不可变 manifest、放置回执、身份/SHA-256 校验、歧义时保留）；真实 UtilityProcess kill/restart 仍未覆盖，另待 macOS Computer Use 与 Windows 验证。
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
- **状态更新（2026-07-16）：`f1330a7` 已移除顶部批量条、完成统一批量菜单连线与 macOS Computer Use 截图验收；现可按清单做人类功能验收。最终合流门禁与 Windows 平台验证未执行。**
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
