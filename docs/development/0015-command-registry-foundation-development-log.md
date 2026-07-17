# 0015-A/B 开发日志：统一命令注册表基础设施 + 资产菜单首个消费方

> 对应需求池 REQ-COMMAND-001（基础设施）与 REQ-MENU-007 剩余项（批量标签逐项跳过报告）。
> 执行方式：2 个编码 subagent + 1 个只读盘点 agent 并行，随后 1 个编码 subagent 做菜单接入；门禁由主 agent 集中执行。

## 背景

产品化排期第一刀是 0015（命令注册表 / 本地化 / 主题）。本地化与主题的默认值卡在集中澄清队列 #11（未确认，不猜），命令注册表无阻塞且是 0017 文件操作与 REQ-COMMAND-002 快捷键补全的前置，故先行。

## Track 1 — 注册表核心（`src/renderer/commands/`）

纯模块、零 React/DOM 依赖、node 环境可测：

- `command-types.ts`：`CommandGroup`（open/organize/metadata/delete + GROUP_ORDER，对齐右键菜单语义基线）、`ShortcutSpec`（联合类型，编译期强制至少一个平台键）、`formatShortcut(spec, platform)`（不做跨平台回退）、`CommandSurface`、`CommandContext`（只读快照）、`CommandDefinition`（title 支持函数）、`ResolvedMenuItem`。
- `command-registry.ts`：`createCommandRegistry(defs)`（重复 id 抛错、冻结快照、泛型 `<C extends CommandContext>` 以支持扩展上下文）→ `resolveMenu(ctx)` 按 GROUP_ORDER + 注册序稳定排序，visible 过滤、disabledReason 唯一禁用来源。
- `tests/unit/command-registry.test.ts` 11 项。

## Track 2 — 批量标签逐项跳过报告（REQ-MENU-007 剩余项）

- worker：`assignTags`/`removeTags` 对未知 assetId 从整体抛错（assign）/静默零行（remove）统一改为**逐项跳过**，新增私有 `partitionKnownAssetIds`；响应带 `skipped: Array<{ assetId, reason: 'asset_not_found' }>`。有效集合仍事务处理；未知 tagId 依旧类型化抛错；deleted_at 资产保持既有资格不收紧。重复 assetId 现在去重（此前 count 校验会抛）。
- 协议：`responses.ts` 新增 `tagOperationSkipReasonSchema`/`tagOperationSkipSchema`（strictObject，可加性）；preload 与 library-api 透传。
- renderer：新纯助手 `batch-tag-notice.ts`（reason→中文映射，未知 reason 回退原始码）；`useBatchActions` 通知变为「已为 8 项资产添加标签；跳过 2 项（资产不存在）。」，全成功文案不变，全跳过有单独措辞。
- 测试：`tests/worker/organization.test.ts`（1 个抛错用例改写为 3 个跳过用例 + 2 个全有效断言）、`tests/unit/protocol.test.ts`、`tests/unit/batch-tag-notice.test.ts` 4 项。

## Track 3 — 命令全量盘点（只读）

产出 7 大表面（单资产/多资产/文件夹/合集/智能合集菜单、键盘快捷键、工具栏、资源库菜单）的逐条命令清单（id 建议、标签、可用性、禁用原因、handler file:line、API 调用），以及 ContextMenu 描述联合与 `ContextMenuItem` props 原文、不适合静态注册表的动态行（按合集/链接文件夹参数化行、TagPickerEntry、计数模板标签、平台条件文案、对话框两段式命令）。该清单即本日志附录，见「命令盘点」一节（源头：agent-15 调查报告，全文随本轮提交存档于会话记录；后续 track 以此为准）。

## Track 4 — 资产单选菜单接入（0015-B）

- 新模块 `src/renderer/commands/asset-commands.ts`：12 条定义（回收站分支 `asset.restore`/`asset.delete-permanent`；正常分支 `asset.open-external`/`reveal-in-folder`/`remove-from-current-collection`/`relink`/`move-to-folder`/`copy-file-path`/`rename`/`ai-analyze`/`move-to-trash`/`delete-linked`）。`AssetCommandContext extends CommandContext` 增加 locationKind/assetAvailable/assetDeleted/activeCollectionId/aiCanAnalyze/assetDisplayName；`run` 经注入的 `actions` 回调包分发（避免反向 import App.tsx 成环）。平台条件标题（Finder/文件资源管理器）走 title 函数。
- `AssetContextMenu.tsx`：**零布局重排**——静态项 JSX 位置不动，label/shortcut/disabled/disabledReason/onAction 改由按 id 查 `resolveMenu` 供给；动态行（合集、链接目录、TagPickerEntry）、摘要行、跳过说明原样保留。注册表规则与旧内联条件逐条比对，**无分歧**（唯一行为差异：AI 分析启用时 disabledReason 由「带了但组件忽略」改为 null，渲染等价）。App.tsx 零改动（现有 props 足够）。
- `tests/unit/asset-commands.test.ts` 45 项表驱动：managed±available、linked、deleted、合集上下文有无、AI 双分支禁用原因、mac/windows 双平台标签与快捷键。

## 集中门禁（主 agent，全绿）

| 门禁 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | pass |
| eslint `src/ tests/` | 0 findings |
| unit | **528/528**（+61：registry 11、batch-tag-notice 4、asset-commands 45、protocol 1） |
| worker | **603 passed + 1 skipped**（净 +2：跳过用例 3 换 1，另有断言补充） |
| E2E（20 spec 全量） | **63/63**（菜单行为保持的证据：context-menu/folder-context-menu/organization-search-trash 全绿） |

## 后续项（已记录）

- 多选菜单接入注册表（需批量感知 ctx：计数与跳过原因模板标签）。
- `asset-command-shortcuts.ts` 事件匹配器与 ShortcutSpec 统一（让按键定义与菜单文案不可漂移）。
- 文件夹/合集/智能合集菜单、工具栏按钮、资源库菜单接入。
- Inspector 评分/收藏批量（`asset.metadata.set` 单资产+版本化，需 renderer 循环或批量命令）。
- 本地化/主题仍等澄清队列 #11。
- 本轮为基础设施增量：按验收纪律**不新增人类验收条目**（无可由用户独立操作的新功能路径；菜单行为不变由 E2E 保证）。
