# Wave 2 开发日志：侧栏调宽、资产拖拽、过滤增强（2026-07-17 第二批反馈）

> 建立：2026-07-17
> 范围：`mvp-ui-ux-requirements-backlog.md`「2026-07-17 第二批反馈排期」Wave 2（T5/T6/T7）；实施规格 `docs/implementation/0016-0018-wave2-sidebar-dnd-filters-spec.md`
> 执行方式：API 配额受限，三轨道全部由主 agent 在主工作树顺序实现并当次验证（无 agent 集群）；交叉审查同 Wave 1 记录为配额偏差，待恢复后补审。

## T5 — REQ-SHELL-007 左右侧栏拖拽调宽（`0ae84f5`）

- `shell-preferences.ts`：版本化 Zod 偏好（nav 200–420 / inspector 260–560，默认 224/268，对齐历史固定宽度），存储可注入，仿 canvas-preferences 模式；无遗留 key（新偏好族）。
- `use-panel-resize.ts`：指针拖拽 hook——纯函数 `resolvePanelWidth`（nav 右缘拖右增宽、inspector 左缘拖左增宽）、拖拽中锁定 body cursor/选择、拖拽结束持久化、双击恢复默认；refs 只在事件/效应中写入（react-hooks 新规则）。
- `.app-shell` 三列轨改用 `--nav-width`/`--inspector-width` 变量（fallback 为历史值）；`is-resizing` 时禁用折叠过渡；6px 固定定位拖拽柄覆盖面板边缘（`role="separator"`、aria 标签、hover/active 细线反馈、面板折叠时不渲染）。
- 四列：实现见上；自动化 `tests/unit/shell-preferences.test.ts`（往返/钳制/损坏回退/拖拽数学 14 断言）；全量 unit 440 passed；人工/平台——Computer Use 未执行（SHELL-009 待人类验收）。

## T6 — REQ-DND-001/002 资产拖拽移动与删除（`c9d75d1`）

- `asset-drag-drop.ts` 纯决策模块：拖拽源选择快照（选中集合内拖整组、集合外拖单卡）、`resolveFolderDrop`（同文件夹含 root≡null 判 no-op；仅 managed+available+非回收站可移，跳过计数）、`resolveTrashDrop`（同资格）；10 单测。
- 卡片在非回收站范围全部可拖；dragstart 写入既有约定负载 `application/x-serpent-managed-assets`（合集内排序拖拽路径不变；该负载同时**激活了链接行已有的「复制到链接文件夹」拖放**——此前没有设置方，是死代码，侧栏提示文案早已承诺该能力）。
- 侧栏：根目录行/托管文件夹行/回收站行接受内部负载（`parseManagedAssetDrag`），`is-drop-target` 背景高亮（与 NAV-005 同语言，window dragend/drop 兜底清除）；非内部拖拽原样走外部导入处理，零回归。
- 执行器：文件夹落点复用 `moveAssets(keep-both)`（沿用菜单同款冲突策略与撤销 operationId），toast 报告移动/冲突跳过/不可用跳过；回收站落点复用 `trashManagedAssets`，有跳过时补完整 toast。
- 四列：实现见上；自动化 `tests/unit/asset-drag-drop.test.ts` + 全量 unit 448 passed；E2E（合成拖拽）按规格由本日志下方集中结果记录；人工/平台——Computer Use 未执行（DND-001/002 待人类验收）。

## T7 — REQ-TAG-002 / REQ-FILTER-009 / REQ-FILTER-010 过滤增强包（`308e5b0`）

- 前置核查（规格已录）：categorical `tag` 子句本就支持同字段多值 OR、数值子句支持 width/height/aspect_ratio 范围（AND 跨子句、OR 子句内、NULL 语义明确）。本增量 UI 装配 + 新增 `long_edge` 字段。
- REQ-TAG-002：`FilterTagPicker`——搜索 + 使用计数 + 多选 chip（可移除、top-20 候选不铺全量）；选择同步回既有逗号分隔 `tagFilter` 串（查询层零改动）；单选既有标签时保留原「标签范围」入口行为（`activeTagId`）。
- REQ-FILTER-009：宽高比 chips 16:9/4:3/1:1/3:4/9:16 → ±5% 相对容差范围（`ASPECT_RATIO_TOLERANCE` 命名常量），再点清除；自定义 min/max 保留。
- REQ-FILTER-010：协议枚举新增 `long_edge` 数值字段；worker SQL `NULLIF(MAX(COALESCE(w,0), COALESCE(h,0)), 0)`（两维皆缺 → NULL，与其他数值字段相同的正查省略/排除保留语义）；chips 1K（<2240）/2K（2240–3199）/4K（≥3200）+ 自定义长边范围。
- 边界声明（规格一致）：本增量**不**宣称完成维度过滤条（REQ-FILTER-001 仍待原型）；多标签为同字段 OR 语义；宽高比/分辨率只在有尺寸数据的资产上匹配。
- 四列：实现 `src/renderer/FilterTagPicker.tsx`、`FilterPresetChips.tsx`、`filter-presets.ts`、`App.tsx` 面板区、`src/shared/asset-types.ts` 枚举、`src/worker/library-service.ts` buildFilterWhere；自动化 `tests/unit/filter-presets.test.ts`（9 断言含 16:9 精确串）、`tests/worker/search.test.ts` long_edge 分桶 + NULL/排除语义、全量 unit 454 passed、worker search 69 passed；人工/平台——Computer Use 未执行（FILTER-009/010/011 待人类验收）。

## Wave 2 合流门禁（当前 HEAD `308e5b0`）

- typecheck 通过、eslint 0 findings（T5/T6 各修掉一处新增 react-hooks 警告后清零）、unit 454 passed、worker search 69 passed。
- E2E 回归（后台集中，当次结果）：
  - 首轮 21 passed + 1 failed：organization-search-trash 的批量用例仍按旧 datalist 输入驱动标签过滤（fill 不触发搜索）。定性为**测试适配缺口**而非产品回归——新选择器需要先点选候选。
  - 适配（6 处 / 4 文件补 option 点击）后复跑：organization-search-trash、asset-pagination、browsing-preferences、organization-metadata-persistence **10/10 全绿**；同轮 shell-navigation、folder-context-menu、context-menu 均绿。
  - 早前 Wave 1 收尾已另行验证：asset-ingestion、desktop-ingestion、media-preview、asset-rename 当次全绿。
- 审查偏差：纪律 #11 完整交叉审查（2 sonnet + 4 haiku）继续受 API 配额限制未执行；主 agent 对三轨道全部实现深审（架构不变量、纪律 #8/#10、测试真实性）。配额恢复后与 Wave 1 一并补审。
- 视觉/交互类条目全部移交人工 QA（本环境无 Computer Use）。
