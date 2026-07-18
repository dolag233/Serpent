# 2026-07-18 REQ-FILTER-001/002：Eagle 式维度过滤条

> 工单：`Serpent-fqt`  
> 状态：第一垂直切片已实现（macOS 开发态）；颜色/文件夹维度入口未做（无现成查询语义或属范围导航）；Computer Use / Windows 未执行。

## 目标

用紧凑维度条 + 弹出层替代「筛选与排序」大面板；已启用条件以 chips 持续可见，可逐项或全部清除；查询语义（同字段 OR、跨字段 AND、排除）不变。

## 本增量

| 模块 | 作用 |
| --- | --- |
| `DimensionFilterBar.tsx` | 标签 / 形状 / 评分 / 格式 / 更多 维度按钮 + popover；激活 chips |
| `active-discovery-filters.ts` | 从 discovery 状态生成可清除 chips |
| `TechnicalRangeFilter.tsx` | 从 App 抽出的数值范围控件 |
| `filter-presets.ts` | 新增横图/竖图方向预设 |
| `App.tsx` | 移除 `<details class="discovery-filters">` 大面板，接入维度条 |

颜色、文件夹维度：本切片未挂入口（颜色过滤能力未就绪；文件夹切换仍走侧栏/面包屑范围）。排序暂放在「更多」内（`Serpent-w4p` 将提升为一等控件）。

## 验证

- `npm run typecheck` 通过
- `npm run lint` 无新增 error
- unit：`active-discovery-filters` + `filter-presets` 通过

## 人类验收

见 `FILTER-013` / `FILTER-014`。
