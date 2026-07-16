# 0018–0019 标签与产品正确性 QA 报告

> 分支：`codex/slice-002-asset-ingestion`
> 基线 SHA：`3400d2b1dce2b905344988829885fb16576ce2a1`
> 实现提交：`5b8b8fe`；本报告的 SHA/复审证据回填由紧随其后的文档提交完成。
> 构建环境：macOS 26.5.1 arm64，Node 24.15.0，npm 11.12.1，Electron 43.1.0。
> 构建产物：Electron + Vite 开发态 `.vite/build` main/preload/worker/renderer；未生成 packaged app 或安装包。
> 日期：2026-07-16
> 状态：macOS 开发态有条件通过；Windows 与 packaged app 未验证。

## 本次可见增量

- Inspector 使用真实预览 artifact；横图按自然比例横向撑满检查器，竖图在最大高度内完整显示，不再塞进固定长方形区域；真实预览没有统一卡片外框，只在图片本身保留轻微圆角。图片、文件名与大小/分辨率/日期共同构成居中的资产身份区，分割线以下恢复左对齐；仅不支持预览的 fallback 保留占位边界。
- 切换资产时不显示“连接中”或元数据加载占位，也不会把上一资产的元数据、标签或 AI 内容混到新资产。
- Inspector 以 tag chip 显示和移除标签；添加入口使用同类圆角输入，支持空输入建议、搜索、直接点击添加、方向键选择和回车确认；零使用标签不进入建议。
- 瀑布流使用显式列：首行从左到右播种，后续再进入当前最短列，避免少量资产全部挤在左侧；首尾可达按视觉最深卡片验证。
- 框选开始时释放导航焦点，Shift 框选不再让当前文件夹额外显示键盘焦点高亮；修饰键集合语义保持一致。
- 右键菜单区分指针与键盘导航：鼠标只显示轻量 hover，键盘移动时才显示单一焦点标记。
- Label/资产显示别名从 schema v14、FTS、协议、三家 AI adapter 和 Renderer 退役；预发布 Label 值直接丢弃，显式依赖 Label 的旧智能合集删除。

## 自动化证据

- Inspector 比例回归：`tests/e2e/media-preview.test.ts` 使用 800×200 横图，断言图片和容器接近自然 4:1、图片横向占满且外框 `border-style: none`；修复前稳定得到约 1.11:1，修复后通过。
- 标签交互：`tests/e2e/organization-metadata-persistence.test.ts` 覆盖建议直接点击、方向键、回车、最后一次移除后从建议消失，并跨完整应用重启读取真实数据库。
- 瀑布流：`tests/e2e/browsing-preferences.test.ts` 覆盖三资产稀疏范围、混合比例、96/160/320 卡片尺寸、1054/1440 窗口宽度及真实视觉首尾。
- Inspector 切换：MutationObserver 记录切换期间的文本和资产身份，禁止出现“连接中/加载中”及跨资产混态。
- Label 迁移：v13→v14 专项测试覆盖字段删除、其他元数据保留、Label 智能合集删除及普通智能合集保留。
- 主体合并树集中门禁：`npm run verify:mainline` 通过 lint、typecheck、extension、918 passed + 1 skipped、search performance 4/4、Electron E2E 51/51。
- 最终审查修复和资产身份区对齐后：lint/typecheck 通过；organization + tag-suggestions 56/56 通过。为避免 Electron 自动化窗口再次打断用户前台操作，没有立即重复全量 E2E；最终提交仍保留集中重跑项。

| 检查 | 命令/范围 | 结果 |
|---|---|---|
| lint | `npm run lint` | GREEN，0 error |
| 类型检查 | `npm run typecheck` | GREEN，core + extension |
| 单元/Worker 主体 | `npm run verify:mainline` 内 Vitest | 60 files；918 passed + 1 skipped |
| 审查后专项 | organization + tag-suggestions | 2 files；56/56 passed |
| 搜索性能 | 10 万资产 suite | 4/4 passed |
| Electron E2E 主体 | 全量 suite | 51/51 passed |
| Inspector 最终样式专项 | media-preview 真图 | 1/1 passed；用户人工确认圆角正常 |

## 真实应用 UX 检查

使用 Computer Use 操作本地真实 Serpent 窗口，检查现有 142 项资源库中的竖图、标签选择器与菜单。Inspector 当前 288×512 图片完整显示，预览宽度使用 Inspector 可用空间且受最大高度限制；未出现固定 220px 高的横向图片框。

- [Inspector 等比预览](evidence/0018-0019-ui-correctness/01-inspector-proportional-preview.png)
- [Inspector 标签选择器](evidence/0018-0019-ui-correctness/02-inspector-tag-picker.png)

发现但不纳入本增量的既有产品化缺口：左侧仍枚举标签，普通/链接文件夹仍分区，浏览工具栏仍包含导入导出操作，应用壳仍显示 Logo/连接装饰。这些进入紧随其后的 0016-A 壳层与导航增量。

最新“文件名 + 大小/分辨率/日期居中放在分割线上方”是用户在上述截图后提出的小型展示调整；用户明确要求不再使用 Computer Use，由其自行查看，因此旧截图只证明比例、无统一外框和标签选择器，不冒充最新对齐证据。

## 失败用例与处置

- **P1，已修复：横图比例错误。** 复现为 800×200 图片在 Inspector 中约 1.11:1；根因是固定高度容器，改为自然尺寸和 max 约束后专项 E2E 通过。
- **P2，已修复：竖图出现统一边框。** 根因是预览 wrapper 背景/边界包住自然留白；真实媒体 wrapper 改为无框，图片本身保留 5px 圆角。
- **P1，已修复：AI-only 标签被隐藏。** 根因是使用数只计人工关系；现按人工/AI 关系并集计数并去重。
- **P2，已修复：最近建议实际按字母排序。** 现按创建时间倒序，文案与证据统一为“最近添加”。

## 错误可观测性

本增量没有新增用户可见失败类型；预览不支持继续使用明确 fallback，不显示“重新生成资产”等误导动作。既有应用日志位于 `~/Library/Logs/Serpent/serpent.log`。本轮不改变 IPC 错误映射，未重复制造错误路径验证“安全提示 + 完整诊断”；发布前错误可观测性仍沿用各原始切片证据，不能视为本报告的新通过项。

## 尚未验证

- Windows Ctrl 交互、文件系统迁移和 schema v14 的真实 Windows 数据库。
- macOS packaged app 与正式安装包。
- 大规模标签库下的性能与“最近使用”行为；当前空输入按标签创建时间倒序显示最近添加项，并保证只出现仍被人工或 AI 关系使用的候选。
- AI 用户旅程由产品负责人后续单独验收。

## 最终结论：有条件通过

macOS 开发态的功能、主体自动化、双轴审查和代表性视觉检查完成；用户已验收标签、瀑布流、Inspector 等比无框预览及轻圆角。保留条件是最新身份区对齐待用户查看、最终提交集中 E2E、packaged app 和 Windows 平台。
