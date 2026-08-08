# 0015-C 开发日志：菜单表面全量接入注册表 + 快捷键统一 + 评分批量

> 承接 `0015-command-registry-foundation-development-log.md`（核心注册表 + 资产单选菜单）。
> 对应需求池 REQ-COMMAND-001 / REQ-COMMAND-002 / REQ-MENU-007。
> 执行方式：两波共 4 个编码 subagent 并行（波 1：多选菜单 + 评分批量；波 2：侧栏菜单 + 快捷键统一），门禁由主 agent 集中执行。

## Track C1 — 多选菜单接入（`asset-multi-commands.ts`）

- 7 条定义：`assets.restore` / `assets.delete-permanent`（全回收站分支）、`assets.assign-tag` / `assets.remove-tag` / `assets.move-to-folder` / `assets.move-to-trash` / `assets.clear-selection`。
- `AssetMultiCommandContext` 携带计数（selectionCount/managedCount/availableManagedCount/linkedCount/trashedAll + 对应 id 子集），标题经 title 函数嵌入计数（`移入回收站（N 项）`等）。
- 注册表规则与旧内联条件逐条比对**无分歧**；动态行（按合集、按链接目录）与跳过说明块保持 JSX 原样；`clear-selection` 取 delete 组使 resolveMenu 排序与其常驻末位一致（消费端按 id 查，不影响布局）。
- `tests/unit/asset-multi-commands.test.ts` 38 项。

## Track C2 — 评分批量（REQ-MENU-007 收官）

- 新批量命令 `asset.rating.set` 端到端：请求 `{ libraryId, assetIds[], rating: 0-5 }`（Zod 边界校验）→ worker 单事务只写 `rating` 列（不碰 entity_version/updated_at，避免使渲染层缓存的 expectedVersion 失效；无元数据行的资产按默认值建行）→ 响应 `{ updatedCount, skipped }` 复用 tag 跳过模型。
- Inspector 星级点击在多选（≥2）时走批量路径（复用 `resolveInspectorTagTarget` 决策），单选保持既有版本化路径；通知经新 `formatBatchRatingNotice`（「已为 N 项资产设置评分 X 分」/「清除评分」，部分跳过追加「；跳过 M 项（资产不存在）」）。
- 多选提示语原地改写为「标签与评分操作将应用于 N 项资产」。
- `tests/worker/batch-rating.test.ts` 5 项 + 协议/通知单测。

## Track C3 — 侧栏菜单接入（`sidebar-commands.ts`）

- 11 条定义覆盖三个分支：文件夹（`folder.open-in-file-manager`/`create-subfolder`/`rename`/`linked-rules`/`copy-path`）、合集（rename/edit-details/delete）、智能合集（rename/update-query/delete）。
- 离线链接禁用与原因、managed/linked 可见性矩阵、平台条件标题（Finder/文件资源管理器）全部逐条对齐旧条件，**无分歧**。
- `danger` 无核心字段，保持 JSX 字面量（测试显式断言该分工）；`window.confirm` 文案含换行逐字保留在 def 的 run 内。
- `tests/unit/sidebar-commands.test.ts` 31 项。

## Track C4 — 快捷键定义与事件匹配统一（REQ-COMMAND-002 方向）

- `ShortcutSpec` 平台值从裸标签字符串升级为 `ShortcutChord { label, key, metaKey?, ctrlKey? }`；`formatShortcut` 读 chord.label；新增 `matchesShortcut`（完整移植旧匹配语义：alt/shift 拒绝、修饰键精确相等、key 大小写不敏感、mac ⌘⌫=meta+Backspace、Windows=裸 Delete、无跨平台回退）。
- App.tsx 键盘 handler 改为按命令 id 从注册表取 spec 匹配，所有守卫条件（输入框/预览/模态/选择态）原样不动；旧 `asset-command-shortcuts.ts` 双份定义删除（主 agent 收尾：AssetContextMenu 的 isMacPlatform 导入改道后 shim 整体删除）。
- `tests/unit/shortcut-matcher.test.ts` 新增（含 3 条真实定义的防漂移断言）；command-registry/asset-commands/asset-multi-commands 既有测试迁至 chord 形态，标签断言不变。

## 集中门禁（主 agent，全绿）

| 门禁 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | pass |
| eslint `src/ tests/` | 0 findings |
| unit | **610/610**（52 文件；本轮 +82：multi 38、sidebar 31、matcher 及协议/通知若干） |
| worker | **608 passed + 1 skipped**（+5 batch-rating） |
| E2E（20 spec 全量） | **63/63**（五个菜单表面接入后行为保持） |

## 后续项

- 工具栏按钮接入注册表（导入/视图/资源库操作等，见盘点报告第 5 节）。
- 更多命令补快捷键（重命名等，REQ-COMMAND-002 剩余）。
- 收藏（favorite）批量未提需求；多选菜单的 reveal/copy-path 亦未排期。
- `danger` 是否进核心 CommandDefinition 待第三个消费场景出现时再定。
- 本地化/主题仍等澄清队列 #11。
