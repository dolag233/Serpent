# 0018–0019 开发日志 — Label 退役与产品正确性收口

> 切片规格：`docs/implementation/mvp-ui-ux-requirements-backlog.md`（REQ-LABEL-001–003、0019 产品正确性）
> 设计决策：`docs/adr/0022-retire-asset-label.md`
> 审查报告：`docs/reviews/0018-0019-ui-correctness-code-review.md`
> QA 报告：`docs/qa/0018-0019-ui-correctness-qa-report.md`

## 基线与状态

- 分支：`codex/slice-002-asset-ingestion`
- 基线 SHA：`3400d2b1dce2b905344988829885fb16576ce2a1`
- 实现提交：待本批实现提交生成后在后续证据提交回填。
- 开始：2026-07-16；最后更新：2026-07-16。
- 状态：`implementing` → `automated-verification` → `code-review` → `qa`。macOS 开发态自动化与代表性 Computer Use 已完成；用户已验收标签、瀑布流、Inspector 等比预览及图片轻圆角。最新资产身份区居中布局待用户查看；Windows 与 packaged app 未验证，因此结论为有条件通过。

## 已完成的垂直行为

- schema v14、FTS、共享协议、Renderer/Main/Worker、三家 AI adapter 及 CLI 文档退役独立 Label/显示别名；资产名称只使用真实文件名。
- 旧开发库的人工/AI Label 值直接丢弃；显式含 `field = "label"` 的智能合集删除，其余元数据与智能合集保留。
- Inspector 使用真实预览 artifact，按自然长宽比完整显示；横图宽度优先，竖图受最大高度约束；移除统一预览外框，只给实际图片保留 5px 轻圆角。
- Inspector 图片、文件名、大小/分辨率/修改日期组成居中的资产身份区；分割线以下的状态、标签和元数据保持左对齐。
- 切换资产时不再显示“连接中/加载中”遮罩，并以资产 ID 防止异步元数据串入另一资产。
- 标签以 chip 显示；圆角输入支持最近添加、搜索、鼠标立即添加、方向键和回车；没有任何人工或 AI 资产关系的标签不进入建议。
- 瀑布流采用显式横向播种、随后最短列布局；修复 Shift 框选引发目录焦点高亮；右键菜单将轻量鼠标 hover 与键盘焦点样式分离；修改日期改为时钟图标。

## 公共测试接缝

- `resolveInspectorPreviewSrc` 独立验证 artifact/媒体类型与 fallback 判定。
- `computeMasonryColumns` 以纯函数验证横向播种、最短列选择与布局边界。
- `filterTagSuggestions` 独立验证搜索、零使用过滤和候选上限；Worker 集成测试验证人工/AI 关系并集计数与创建时间排序。
- `getAssetCommandShortcut` 统一按平台产生可展示快捷键。
- E2E 注入 800×200 真实图片并读取 `naturalWidth/naturalHeight`、计算样式与边界，证明预览被解码且没有固定框裁剪。

## 重要实现决定及理由

1. **Label 数据直接删除**：产品已明确取消概念且 v0.1.0 尚未发布；不把旧别名静默写入标签、描述或文件名。
2. **依赖 Label 的智能合集删除**：字段消失后继续保留会产生静默空结果，删除比错误语义更可预测。
3. **预览自然尺寸 + 双上限**：图片使用 `width:auto/max-width:100%/height:auto/max-height`，让横图尽量撑满、竖图完整显示；容器不画框，避免竖图两侧留白看起来像边框。
4. **建议里的“最近”= 最近创建**：现有 schema 没有标签使用时间；当前按 `tags.created_at DESC` 提供准确的最近添加，不虚构最近使用。行为级最近使用留待独立数据模型。
5. **标签使用数合并人工和 AI**：同一资产同时存在两种关系只计一次，避免 AI-only 标签被错误隐藏。

## 与规格的偏离

- 没有建立独立标签管理页，符合用户确认“标签只用于过滤”的方向。
- 没有实现严格的最近使用时间；当前明确命名为最近添加并按创建时间排序，未获得的数据语义不做猜测。
- 最新 Inspector 身份区布局按用户当场反馈调整，用户要求无需再跑 Computer Use，由其自行查看；该项仍在人类验收队列中。

## 关键命令与结果

- `npm run verify:mainline`：在合并 Label/Inspector/标签/瀑布流/菜单主体后的工作树通过 lint、typecheck、extension、918 passed + 1 skipped、search performance 4/4、Electron E2E 51/51。
- 最终审查修复与身份区对齐后：`npm run lint`、`npm run typecheck` 通过；`tests/worker/organization.test.ts` + `tests/unit/tag-suggestions.test.ts` 共 56/56 通过。
- Inspector 比例/边框/圆角专项 Electron E2E：`tests/e2e/media-preview.test.ts` 1/1 通过；用户随后确认实际圆角无问题。
- 为避免自动化 Electron 窗口打断用户前台操作，最终小型展示调整后没有立即重复全量 E2E；发布前仍须在约定的集中窗口对最终提交再跑 `verify:mainline`。

## 失败、根因与修复

1. **横图在 Inspector 约为 1.11:1 而非 4:1**：固定高度和 `width:100%` 组合把真实媒体塞进统一长方形。移除固定高度并以自然尺寸和 max 约束布局，加入解码后比例 E2E。
2. **竖图两侧出现“边框”**：实际是统一预览容器的背景/边框包住自然留白。真实预览容器改为无框，仅 fallback 保留边界；图片自身恢复 5px 圆角。
3. **标签建议按字母顺序却称“最近”**：`listTags` 原先 `ORDER BY name`。改为 `created_at DESC, name`，补确定时间测试。
4. **AI-only 标签被视为零使用**：计数只查询 `human_asset_tags`。改为人工/AI 关系 `UNION` 后计数，并验证同资产不会重复计算。
5. **资产切换可能混入旧元数据**：多个异步入口重复应用状态。提取统一应用函数并用 `selectedAssetIdRef` 做身份门禁。

## 已知问题与后续

- Windows Ctrl 交互、v14 真实数据库迁移和文件系统行为完全未验证。
- macOS packaged app/安装包未验证；最终当前提交的集中 `verify:mainline` 仍需在不打断前台使用的窗口补跑。
- 左侧标签枚举、普通/链接文件夹分区、旧应用壳和导入型工具栏仍是 0016-A 后续范围。
- 大规模标签库性能与真正的“最近使用”模型未实现；AI 用户旅程由产品负责人后续单独验收。

## 重要文件入口

- `src/worker/library-service.ts`：v14 迁移、标签计数/排序与元数据行为。
- `src/renderer/InspectorPanel.tsx` / `src/renderer/styles.css`：Inspector 身份区、预览和标签交互。
- `src/renderer/App.tsx`：资产切换、元数据身份门禁和集成状态。
- `tests/e2e/media-preview.test.ts` / `tests/e2e/organization-metadata-persistence.test.ts`：真实媒体和标签用户旅程。
- `docs/qa/human-acceptance-checklist.md`：跨 agent 唯一的人类验收队列。
