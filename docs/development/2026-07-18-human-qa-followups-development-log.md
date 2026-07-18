# 2026-07-18 人类验收跟进

## 结论摘要

| 项 | 结论 | 跟进 |
| --- | --- | --- |
| I18N-001–003 | 通过 | 默认语言改为跟随系统 |
| THEME-002 | 先不通过→已修→再待验 | 亮色启用态对比度、右键阴影、星标 #D9B54B |
| VIEWER-003 | 通过 | — |
| INSPECT-006 | 通过 | — |
| AVAIL-001 | 先不通过→已修→再待验 | 去掉 Inspector「可用」行，仅 missing/trash 显示 |

## 实现要点

- `LocalePreference` 含 `system`；E2E 经 preload 注入 `__SERPENT_E2E_LOCALE__=zh-CN`。
- `--accent-soft-fg` / 亮色 toast+菜单阴影；`--rating-star: #d9b54b`。
- Inspector 状态行仅在不可用或回收站时渲染。
