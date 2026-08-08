# 2026-07-18 排序提升为一等工具栏模式（Serpent-w4p）

## 范围

CU-D6：排序从「更多」过滤弹出层底部移出，避免高面板裁切不可达；覆盖名称 / 修改日期 / 大小 / 分辨率（`long_edge`）/ 时长。

## 实现

- `SortModeControl`：维度条右侧独立排序按钮 + 升/降序切换
- `sortDefinitionSchema` / preload / library-api 增加 `long_edge`
- Worker `searchAssets`：`long_edge` 排序与过滤共用长边表达式，缺失元数据排后
- 「更多」维度仅保留额外过滤条件；图标改为 `menu`，排序占用 `sliders`

## 测试

- `tests/worker/search.test.ts` — `sorts by long_edge ascending with nulls last`
- `tests/unit/sort-mode-control.test.ts` — 主字段清单

## 验收

人类清单 **SORT-005**。

## 未覆盖

Windows 工具栏布局未验证；智能合集保存/恢复 `long_edge` 依赖现有 sort JSON 路径，未单独 E2E。
