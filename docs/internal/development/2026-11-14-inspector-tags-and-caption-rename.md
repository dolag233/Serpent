# Inspector 标签操作与卡片名称双击

- 分支：`dolag_dev`；基线：`663fc24ecabd`；状态：用户指出初版标签选择和复制粘贴只在删除编辑模式且缺框选，现已修正并通过定向自动化，人工复验待做。
- 工单：`Serpent-0f4c3d`。

## 范围与设计

用户对原反馈的逐条回复已排除其他几项；本轮只处理标签输入、标签多选复制粘贴、编辑全选和名称双击重命名。

- Inspector 标签输入区此前排在标签列表末尾，标签多时需要滚动；挂载时 `autoFocus` 还可能让浏览器滚动 Inspector。输入区现在排在标签列表前，聚焦使用 `preventScroll`。
- 普通 Inspector 状态即可单击选择、Ctrl/⌘ 单击增减、Shift 单击选择范围、拖框选择；编辑状态也使用同一选择。框选复用画布的矩形相交与平台修饰键规则。复制把所选标签名按行写入系统剪贴板；粘贴复用已有 `onApplyTagNames`，给当前单选或多选资产添加标签。复制/粘贴按钮在普通状态可见。切换资产时清除标签选择；重复名称不重复添加。
- Inspector 标签和标签管理页进入原地重命名时全选输入文本，聚焦不改滚动位置。
- 双击资产文件名或文件夹卡片名称进入现有原地重命名；双击卡片其他区域仍执行查看或进入文件夹。回收站文件夹名称继续按原行为打开层级。

## 变更与测试

| 需求 | 实现 | 自动化 | 人工 / 平台证据 |
| --- | --- | --- | --- |
| 标签输入在列表上方，聚焦不滚动 | `InspectorPanel.tsx`、`styles.css` | `inspector-tag-clipboard.test.ts` 检查输入区位置并通过；大标签量滚动尚无真实窗口证据 | 隐藏 Electron 通过；前台未执行 |
| 普通状态多选、框选、复制、粘贴标签到另一资产 | `use-inspector-tag-clipboard.ts`、`use-tag-marquee.ts`、`InspectorTagChip.tsx`、`InspectorPanel.tsx` | `inspector-tag-clipboard.test.tsx`、`inspector-tag-chip.test.tsx` 与 `inspector-tag-clipboard.test.ts` 通过；隐藏 Electron 实测 Shift、拖框、Ctrl 取消、跨资产复制粘贴 | 用户指出初版漏掉普通状态与框选；修正后隐藏 Electron 通过，前台复验未执行 |
| 编辑标签全选 | `InspectorTagChip.tsx`、`TagManagementWorkspace.tsx` | 对应两个组件单测通过 | 未执行 |
| 双击名称重命名 | `App.tsx`、`FolderCard.tsx` | 文件夹卡片单测、`asset-rename.test.ts` 4 项和 `folder-context-menu.test.ts` 定向 1 项通过 | 隐藏 Electron 通过；前台未执行 |

本轮执行 `npx vitest run tests/unit/inspector-tag-chip.test.tsx tests/unit/inspector-tag-clipboard.test.tsx tests/unit/folder-card-rename.test.tsx tests/unit/tag-management-workspace.test.ts`：4 files / 10 passed。`npm run typecheck`：通过。定向 ESLint：0 errors，`App.tsx` 2 条既有 hooks warning。`git diff --check`：通过。

独立双轴审查发现：① 编辑态待移除的标签仍可能进入复制内容；现已让复制状态只接受可见标签，并补回归测试。② 剪贴板失败提示可能在退出编辑后残留；现已按资产选择重置，并在编辑开始、结束、取消时清理。审查还发现一个与本轮无关的仓库根目录未跟踪小图片文件；此前删除曾被自动审批拒绝，本轮不会将它加入版本控制。

用户自行退出运行中的开发实例后，使用隔离 `userData` 在后台执行 `node scripts/run-e2e.mjs` 定向旅程：`asset-rename.test.ts` 4 passed，`inspector-tag-clipboard.test.ts` 1 passed，`folder-context-menu.test.ts` 的原地改名用例 1 passed。首次标签用例的两张夹具图片内容相同，触发重复内容提示；修成不同内容后又发现导入时两张资产默认同选，测试先清除选择再单选来源资产。文件夹用例初次失败是测试定位器按名称筛选，进入输入态后名称文本消失；改用稳定输入框定位后通过。这些均为测试准备/断言问题，最终用例已重跑通过。

前台 Computer Use 此前被用户要求暂不执行，本轮仍未执行。大标签量、亮暗主题和滚动位置的真实可见窗口检查仍需人类验收，不能写为最终验收通过。

## 用户复验反馈与修正

用户指出初版的“编辑标签”被误当成多选入口，普通状态没有标签选择和复制粘贴，且缺少拖框。`TAG-EDIT-014` 因此改为“人类验收不通过，修正待复验”。修正后普通标签即可选择，复制和粘贴按钮常驻；拖框使用现有选区几何与平台修饰键规则。受影响的旧单测从“Ctrl 单击筛选”改为“Ctrl 单击选择，右键菜单筛选”；新增框选与取消选择的单测。执行 `npx vitest run tests/unit/inspector-tag-chip.test.tsx tests/unit/inspector-tag-clipboard.test.tsx`：2 files / 7 passed；`npm run typecheck` 与定向 ESLint 通过。隔离隐藏 Electron 标签旅程：1 passed，实测普通状态 Shift 范围、跨行拖框、Ctrl 取消中间项、复制到另一资产后只粘贴两项。第一次 E2E 失败源于用例拖动的斜向矩形未覆盖换行的中间标签；根据三张标签的实际坐标调整拖框终点后通过。

进一步验证发现 Windows 的 Ctrl/⌘+C/V 已由应用菜单原生加速键接管，Inspector 局部键盘事件不会可靠收到。此时先以可见按钮提供入口，后续用户明确要求快捷键，见下节。独立 Luna 复核指出 Shift 双击会误入改名、原 Ctrl/⌘+Enter 筛选被删除；已修复并补单测。前台视觉仍未执行。

本轮测试写入的独立输出目录仍在：自动审批以 `blocked by policy` 拒绝了经过仓库路径校验的递归清理；最终只剩 Playwright 的 `.last-run.json` 后，具体文件和空目录的非递归清理也被同样拒绝。未继续尝试删除；目录属于本轮测试，尚待清理。

## 标签外观与右键菜单修正

用户再次验收指出：暗色主题只应去除标签背景的分类色，AI 标识应保留颜色；选中使用描边，外形改为圆角矩形，右键提供对应剪贴板动作。已移除 Inspector 标签的箭头伪元素及模糊投影，使用主题圆角与预留透明边框，选中只改变边框颜色，不改变尺寸。暗色只把标签底色统一为同一表面混色，AI 角标恢复现有主题色。标签筛选器的外形未纳入本次改动。

右键已选标签保留多选，右键未选标签先切到该项；菜单加入复制选中标签、粘贴标签。无标签时在空白区域右键也能粘贴，输入框仍保留文本菜单。复用 `ContextMenu` 与现有剪贴板控制器，空白菜单抽成 `InspectorTagGrid`，未修改后端协议。

本次执行 `npx vitest run tests/unit/inspector-tag-chip.test.tsx tests/unit/inspector-tag-grid.test.tsx tests/unit/inspector-tag-clipboard.test.tsx`：3 files / 9 passed；相关文件 ESLint 与 `npm run typecheck` 通过。按最小化测试规则未因控件和外观变更重跑 Electron。后台 Edge/Playwright 使用当前完整样式表渲染合成标签并截图检查：暗色三种分类色的实际背景完全相同，AI 角标仍为主题色；亮色保留分类浅底色；圆角矩形和选中描边清晰，无箭头伪元素或投影。此为样式夹具检查，非真实 Serpent 前台验收；真实窗口仍待用户复验。

## 标签复制粘贴快捷键

用户要求右键菜单提供快捷键提示，并让快捷键真正执行。`inspector-tag-shortcuts.ts` 统一 DOM 按键与应用原生菜单转发：标签区获得焦点时接管复制/粘贴，文本输入与其他资产区继续由原处理器接手；无标签时可聚焦标签空白区粘贴。复用现有复制/粘贴快捷键绑定及格式化器，菜单提示与设置一致。App 仅增加原生命令路由，未修改 Main、Preload 或 Worker。

真实测试发现 Windows 的 `useBrowseCommandKeyboard` 在 document capture 阶段先执行了资产文件复制，导致标签选中后 Ctrl+C 写入文件路径。现由该入口先识别标签焦点并将剪贴板动作路由到标签区，其余资产命令在该焦点范围让行，标签自己的 F2 改名也不会误触资产。未改变原生菜单加速键的全局启用机制。

用户退出开发实例后重建当前源码并运行隔离隐藏 Electron：1 passed，验证 Ctrl+C 实际把选中两项写入系统剪贴板，以及真实原生粘贴 MenuItem（Ctrl+V 加速键的目标）转发到当前资产并新增两项。隐藏窗口的 CDP 粘贴按键未产生 V DOM 事件；Electron sendInputEvent 也仅到达 before-input，无法证明前台实体按键。测试因此对粘贴调用真实菜单入口，没有伪造标签 IPC 或直接调用标签粘贴函数；前台物理 Ctrl+V 和 macOS 仍为未验证。早期测试的框选坐标假定换行，圆角矩形变窄后同排布局导致漏选，已改为按全部标签实际边界计算矩形。

最终运行定向 Renderer 单测（标签快捷键、标签菜单、空白菜单、剪贴板、浏览命令）：5 files / 18 passed；`npm run typecheck`、相关文件 ESLint 与 `git diff --check` 通过。未重跑后端或无关旅程。

## 用户验收与提交

2026-11-15 用户确认本轮验收通过并授权提交推送。清单 TAG-EDIT-014、CARD-RENAME-015、TAG-EDIT-016、TAG-EDIT-017 更新为人类验收通过；工单关闭。此前的自动化与平台限制作为历史证据保留，macOS 和发布包未执行。
