# 2026-07-18 REQ-FILTER-001/002：Eagle 式维度过滤条

> 工单：`Serpent-fqt`  
> 状态：维度条已齐（颜色/标签/文件夹/形状/评分/格式/更多）；挂载于工作区标题下；排序由 `Serpent-w4p` 一等化。Computer Use / Windows 未执行。

## 目标

用紧凑维度条 + 弹出层替代「筛选与排序」大面板；已启用条件以 chips 持续可见，可逐项或全部清除；查询语义（同字段 OR、跨字段 AND、排除）不变。

## 本增量（含后续补齐）

| 模块 | 作用 |
| --- | --- |
| `DimensionFilterBar.tsx` | 颜色 / 标签 / 文件夹 / 形状 / 评分 / 格式 / 更多 |
| `color-filter-presets.ts` | 主色 hue 桶 + SQL 片段 |
| Worker `buildFilterWhere` | `field: "color"` → `palette_meta.dominant_hue` |
| 文件夹维度 | 切换 `chooseFolder` 范围（非 FilterClause） |
| 挂载位置 | `workspace-discovery`（避免顶栏 44px 撑破） |

## 验证

- `npm run typecheck` 通过
- unit：`color-filter-presets`、`active-discovery-filters` 通过

## 人类验收

`FILTER-013` / `FILTER-014` / `FILTER-015`。
