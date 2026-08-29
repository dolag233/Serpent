# Wave 2 实施规格：侧栏拖拽调宽、资产拖拽操作、过滤增强

> 状态：生效
> 建立：2026-07-17
> 来源：`mvp-ui-ux-requirements-backlog.md`「2026-07-17 第二批反馈排期」Wave 2（产品负责人直接反馈，优先级高于常规池条目）
> 依赖：Wave 1（T1 视觉修饰、T4 文件夹原地编辑）合流后启动；本文只定义 Wave 2 三条轨道（T5/T6/T7）的范围、语义与验收口径。

## 总约束

- 三条轨道在独立 git worktree 并行实施，主工作树只由主 agent 做合流；冲突按 T5 → T7 → T6 顺序合并。
- 每轨道遵守验收纪律全项；新交互逻辑抽独立模块（纪律 #8）；禁止补丁式修复（纪律 #10）。
- 轨道内只跑 typecheck / lint / scoped vitest；Electron E2E 由主 agent 合流后集中后台执行（纪律 #12）。
- 本环境无 Computer Use：视觉类条目按「未执行」移交人工 QA，进入人类验收清单待验收。

## T5 — REQ-SHELL-007 左右侧栏拖拽调宽

### 范围

- 左侧导航面板与右侧 Inspector 面板各提供 4–6px 的边缘拖拽热区（pointer events），拖动实时改变面板宽度。
- 宽度钳制：导航面板建议 200–420px；Inspector 面板建议 260–560px（实现时以当前默认宽度为基准定默认值，钳制值写入代码常量并在开发日志记录）。
- 双击拖拽热区恢复默认宽度。
- 宽度跨完整重启持久化。

### 实现方向

- 宽度用 CSS 自定义属性（如 `--nav-width` / `--inspector-width`）挂在壳层容器上，布局 grid/flex 消费变量；拖拽只更新变量与偏好，不引起画布重排抖动。
- 持久化仿 `src/renderer/canvas-preferences.ts` 的版本化偏好模式（Zod 校验、遗留 key 迁移、存储可注入），新建 `src/renderer/shell-preferences.ts`；不把宽度塞进 canvas-preferences（语义不同）。
- 拖拽逻辑抽独立 hook（如 `use-panel-resize.ts`），不在 App.tsx 内联（纪律 #8）。
- 拖拽热区 `role="separator"`、`aria-orientation="vertical"`；键盘方向键调宽作为后续项记录，不阻塞本增量。

### 测试与验收

- 单元测试：偏好模块（解析/迁移/钳制）+ resize hook 的钳制与重置逻辑。
- 人类验收条目（合流后加入清单）：拖动左右面板边缘改变宽度并重启恢复；双击恢复默认。

## T6 — REQ-DND-001/002 资产拖拽到文件夹（移动）与回收站（删除）

### 已确认的前置事实（2026-07-17 代码核查）

- 移动命令已存在：`asset.move.request` / `asset.moved` / `asset.move-undo.request`（`src/shared/protocol/requests.ts:358`、`responses.ts:513`），配套 `ASSET_MOVE_CONFLICT` 类型化错误与 `MoveDialog.tsx`；本轨道复用该命令，不新增 worker 移动能力。
- 回收站命令已存在（trashAssets，菜单「移至回收站」同链路）；拖拽到回收站语义与菜单完全一致（含相同的确认/跳过行为）。

### 范围与语义

- 拖拽源：资产卡片。拖动已在选择集合内的卡片 = 拖动整个选择（固定快照语义，与批量菜单一致）；拖动未选中卡片 = 先改为仅选中它再拖动（与 Finder/Eagle 一致）。
- 放置目标：
  1. 目录树文件夹行（`NavigationSidebar`）：dragover 时背景高亮；非法目标禁止放置并说明——同一文件夹（no-op）、链接文件夹（托管资产物理移动不支持跨位置类型）、回收站内资产拖回文件夹（恢复请走恢复入口，给出说明）。
  2. 回收站导航项：语义等同菜单「移至回收站」。
- 链接资产、missing 资产作为拖拽源时按批量菜单同样的快照/跳过规则处理，结果 toast 报告移动/删除 N 项、跳过 M 项及原因。
- 技术上使用窗口内 HTML5 Drag & Drop；必须验证与既有交互无冲突：框选只在画布空白启动（卡片 drag 不触发 marquee）、双击打开查看页不受影响、拖拽经过不触发卡片 hover 媒体预览。
- 拖放解析与守卫抽纯函数模块（如 `asset-drop-targets.ts`）：输入拖拽集合+目标，输出动作（move/trash/reject）与原因，便于单测。

### 测试与验收

- 单元测试：drop-target 解析全分支（同文件夹/链接/回收站/非法源）；多选快照。
- E2E（主 agent 集中）：Playwright 合成 dragstart/dragover/drop 事件覆盖拖到文件夹与拖到回收站两条路径。
- 人类验收条目：拖拽单资产与多选到文件夹完成移动；拖拽到回收站完成删除并可在回收站看到。

## T7 — REQ-TAG-002 / REQ-FILTER-009 / REQ-FILTER-010 过滤增强包

### 定位边界（重要）

- FILTER-001–008 已判「人类验收不通过」，完整维度过滤条（REQ-FILTER-001/002）仍待原型。**本轨道不宣称完成维度过滤条**，只落地用户点名的第一批具体能力：多标签过滤、宽高比预设、分辨率预设，接入现有过滤入口并按 REQ-FILTER-002 保持已启用条件可见可删。
- 多标签语义：遵循既有查询语义「同字段 OR、跨字段 AND」（REQ-FILTER-007/008）；多选标签 = OR。若用户期望 AND 将另开澄清，不在本增量猜测。

### 已确认的前置事实（2026-07-17 代码核查）

- 查询层已支持同字段多值 OR（FILTER-008 语义保留）；本增量主要工作在 UI 装配 + 新维度查询字段。
- 尺寸数据已存在：`width`/`height` 列（`src/worker/library-service.ts:799`）与查询侧的 `artifact_width`/`artifact_height`（含 video_meta 回退，约 `library-service.ts:4174`）；注意方向交换（`swapsDimensions`，`library-service.ts:6580` 附近）——宽高比计算必须与缩略图一致地处理 EXIF orientation。

### 范围

1. **REQ-TAG-002 多标签过滤**：标签过滤入口支持搜索并选择多个标签（带使用计数，不铺开全部标签）；已选标签作为可见条件 chip 可逐项删除/全清。
2. **REQ-FILTER-009 宽高比过滤**：预设选项 16:9 / 4:3 / 1:1 / 3:4 / 9:16 + 自定义输入。匹配语义 v1：资产宽高比（考虑 orientation 交换）与目标比例的相对偏差 ≤ 5% 视为命中；该阈值写为命名常量并记入开发日志。只在有尺寸数据的资产上匹配，无尺寸资产不命中并在条件说明中注明。
3. **REQ-FILTER-010 分辨率过滤**：预设 1K / 2K / 4K + 自定义宽/高范围输入。分桶定义 v1（按长边）：1K = 长边 < 2240；2K = 2240 ≤ 长边 < 3200；4K = 长边 ≥ 3200。定义写入开发日志，用户可在验收时调整。

### 测试与验收

- worker 测试：三个新维度/多标签的查询正确性（含 orientation 交换样例、无尺寸资产、边界长边值）。
- 单元测试：条件 chip 的增删与序列化。
- 人类验收条目：多选标签过滤（OR 语义）；选择 16:9 预设只显示横向宽屏资产；选择 4K 预设只显示长边 ≥ 3200 的资产；自定义输入可用。

## 合流与证据要求

- 三轨道各自完成实现 + 2 sonnet 深审 + 4 haiku 广度审查 + 修复 PASS 后，主 agent 按 T5 → T7 → T6 顺序合并，跑 typecheck/lint/unit/worker 全量与后台 E2E（含新增 DnD、过滤用例与受影响回归：context-menu、shell-navigation、browsing-preferences、organization-search-trash）。
- 合流提交同步：开发日志、本规格状态、`project-status.md`、人类验收清单新增条目（标注 Computer Use 未执行）。
