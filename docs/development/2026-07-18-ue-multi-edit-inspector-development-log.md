# 2026-07-18 REQ-SELECT-004：UE 式多选属性编辑

> 工单：`Serpent-eb7`  
> 状态：已实现（macOS 开发态）；Computer Use / Windows 未执行；进入待人类验收。

## 目标

替代 Inspector「标签与评分将应用于 N 项资产」提示模型：

- 标量字段（描述 / 评分 / 喜欢 / 源链接 / 人工色卡）：值不一致 → 显示「多个值」并禁用；一致（含同为空）→ 可编辑并应用到全部选中
- 标签：仅显示共有标签（交集）；移除共有标签从全部选中移除；新增标签为全部选中添加

## 实现

| 模块 | 作用 |
| --- | --- |
| `src/renderer/inspector-multi-edit.ts` | 纯决策：`resolveScalarField` / `intersectAssetTags` / `buildInspectorMultiEdit` |
| `tests/unit/inspector-multi-edit.test.ts` | 12 单测锁定 mixed/uniform/交集语义 |
| `InspectorPanel.tsx` | 多选 UI：mixed 占位、无「将应用于 N 项」提示、标签用交集 |
| `App.tsx` | 多选时并行加载元数据、批量写入描述/喜欢/源链接/色卡；评分沿用 `setAssetsRating`；批量标签后刷新全部选中并重建模型 |

## 验证

- `npm run typecheck`：通过
- `npm run lint`：无新增 error（既有 App.tsx hooks warnings）
- `npx vitest run tests/unit/inspector-multi-edit.test.ts tests/unit/inspector-tag-target.test.ts`：18 passed
- E2E / Computer Use：未执行（本增量以单测 + 类型门禁收口；人类桌面验收覆盖）

## 探索交叉核对（2026-07-18）

只读探索 [Explore Inspector multi-select](6ad7f2c7-0636-435a-8a80-0f04a7cb02ae) 与落地提交 `c1e0c87` 对照：标量聚合、标签交集、去掉 `applyToSelection`、多选元数据加载与批量写回均已覆盖。未采纳项（显式保留）：专用 worker 批量 description/favorite/sourceUrl API（当前按资产循环 `setAssetMetadata` + 冲突跳过）；英雄区仍显示主资产预览。

清单：`MENU-020`/`MENU-021` 步骤与预期已同步为 UE 模型；回归验收以 `SELECT-009`/`SELECT-010`/`SELECT-011` 与更新后的 `MENU-021` 为准。

## 多选英雄区（2026-07-18 续）

- 预览：主选在上、最多 3 张缩略图错位叠放（`pickInspectorStackAssets`）。
- 标题：`{name} 等{count}个文件`（`inspector.multiSelectionTitle`，count=选中总数）。
- 多选时隐藏单资产尺寸摘要行与丢失/回收站状态条（避免以主资产冒充整体）。

## 人类验收

见清单 `SELECT-009` / `SELECT-010` / `SELECT-011` / 更新后的 `MENU-021`。
