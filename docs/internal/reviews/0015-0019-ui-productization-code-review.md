# 0015–0019 UI 产品化增量双轴审查

> 审查日期：2026-07-16  
> 固定点：`be37817`  
> 被审查状态：`e2d5d60`  
> 结论：**不通过，不可进入人类验收**

## 范围

审查 `be37817..e2d5d60` 的壳层清理、面包屑/链接图标、Inspector 紧凑布局与标签 chip、资产右键菜单分组和快捷键显示。另核对项目状态所称 0019 合流是否真实存在。

## 自动化与真实应用证据

- `npm run lint && npm run typecheck && npm run test`：通过，55 个测试文件，885 passed、1 skipped。
- 相关 Electron E2E：`media-preview`、`organization-metadata-persistence`、`context-menu` 共 11/11 通过。
- Computer Use：在真实 Electron 当前 HEAD、真实 142 项资源库执行只读检查。截图见 [当前 HEAD 总览](../qa/evidence/0015-0018-ui-productization/01-current-head-overview.jpeg)。
- 自动化未覆盖本报告发现的标签即时刷新、菜单快捷键真实性、当前树与文档一致性；绿灯不能抵消以下问题。

## Standards 轴

### P1 — 标签 mutation 成功但 Inspector 不刷新

`src/renderer/App.tsx:1378`、`:1395`、`:1412` 的分配、移除、创建并分配成功路径只刷新全局 `listTags`，没有更新或重新读取当前 `assetMetadata.tags`。`src/renderer/InspectorPanel.tsx:196` 的 chip 完全依赖旧 metadata，因此 UI 会提示成功但 chip 保持旧状态。

### P1 — 菜单显示并不存在的快捷键

`src/renderer/AssetContextMenu.tsx:405` 显示 `⌘O/Ctrl+O`，当前键盘处理器没有 O 命令；删除显示 `⌘⌫/Ctrl+Del`，`src/renderer/App.tsx:3495` 实际接受无修饰的 Delete 或 Backspace。菜单与真实行为不一致，并暴露 plain Backspace 误删风险。

### P1 — 交付记录和测试证据缺失

新增能力没有对应 0015/0016/0018 规格、开发日志、QA 和最小人类验收条目；需求池仍标为待实施。提交信息中的“verify:mainline 44/44 x2”也没有沉淀为当前树 QA 证据。

### P2 — 人工与 AI 同标签产生重复 key

`src/worker/library-service.ts:4884` 使用 `UNION ALL` 返回相同 tag ID 的人工和 AI 关联；`src/renderer/InspectorPanel.tsx:262` 只用 `tag.id` 作为 React key。双来源时会重复 chip、产生 duplicate-key 警告，并留下不明确的删除语义。

### P2 — 新 UI 写死暗色值

`src/renderer/styles.css:1871` 起的 Inspector/tag 样式大量写死暗色背景、文字和 hover 色，绕过主题 token，与 MVP 亮/暗主题方向冲突。

## Spec 轴

### P1 — 面包屑没有导航能力

`src/renderer/App.tsx:4057` 只渲染资源库名和当前范围两个静态 span，没有父目录段或点击行为；`src/renderer/styles.css:253` 仍保留 chip 边框。REQ-NAV-001/002 未完成。

### P1 — 浏览工具栏仍塞满导入导出

`src/renderer/App.tsx:4488` 起的导入、粘贴、链接导入和资源库导入导出全部仍常驻；CSS `order` 只改顺序，没有完成 REQ-CANVAS-002/003 的迁移。

### P1 — 左侧继续枚举全部标签

`src/renderer/NavigationSidebar.tsx:428` 仍渲染创建入口和 `tags.map(...)`，与已确认的 REQ-TAG-001 正面冲突。不能为了旧 E2E 兼容保留已取消的产品模型。

### P1 — 链接文件夹仍单独分区

`src/renderer/NavigationSidebar.tsx:595` 仍为独立“链接文件夹”区，且没有 hover 状态解释；REQ-NAV-004 只完成了图标颜色的一部分。

### P1 — 旧 Label 被伪装成第二个“标签”

`src/renderer/InspectorPanel.tsx:381` 仍绑定 `editLabel` 和 `handleMetadataLabelSave`，只是把文案从“标签 (Label)”改成“标签”。它与真正 tag chip 同屏，违反 ADR 0022 和 REQ-LABEL-001，并直接误导用户。

### P1 — Inspector 仍没有真实缩略图

`src/renderer/InspectorPanel.tsx:225` 只显示通用文件图标和文件名，没有图片缩略图、视频 poster 或 pending/unsupported 分支。真实应用截图已确认该缺陷。

### P2 — “最近标签”实际是名称排序

`src/renderer/InspectorPanel.tsx:168` 将 `allTags.slice(0, 8)` 注释为 recent，但 Worker 的标签列表按名称排序，不是最近使用。

## 分支与文档一致性审计

项目状态曾声明 0019 四项已合流，但当前 HEAD 不包含：

- `ea4f044` — 框选修饰键；
- `36c776c` — 画布列填充与 clock；
- `19c4a02` — 菜单单高亮；
- `8a73132` — Inspector 缩略图与防闪烁。

它们仍位于独立分支；当前树也缺少验收清单所链接的 0019 规格、布局单测和 Inspector 单测。因此相关六个人类验收条目已撤回。

## 收口建议

1. 不在当前状态继续叠 UI；先按 0015–0019 边界建立规格和可验收增量。
2. 逐个审查并合流 0019 候选，解决与当前 Inspector/menu 改动的冲突，再跑一次当前树门禁和 Computer Use。
3. 标签改动先修即时刷新、双来源模型和 Label 退役，随后删除左侧标签枚举与逐标签菜单。
4. 建立统一命令注册表后再显示快捷键；菜单文字和键盘监听必须来自同一命令定义。
5. 0016 壳层在命令、标签与目录模型稳定后实施，禁止以 CSS 重排冒充信息架构迁移。
