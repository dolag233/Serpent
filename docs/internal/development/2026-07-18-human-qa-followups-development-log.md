# 2026-07-18 人类验收跟进

## 结论摘要

| 项 | 结论 | 跟进 |
| --- | --- | --- |
| I18N-001–003 | 通过 | 默认语言改为跟随系统 |
| THEME-002 | 通过 | 对比度、toast 去描边、右键阴影、亮色星标 #ecc83a |
| VIEWER-003 | 通过 | — |
| INSPECT-006 | 通过 | — |
| AVAIL-001 | 通过 | 去掉 Inspector「可用」行，仅 missing/trash 显示 |

## 实现要点

- `LocalePreference` 含 `system`；E2E 经 preload 注入 `__SERPENT_E2E_LOCALE__=zh-CN`。
- `--accent-soft-fg` / 亮色 toast+菜单阴影；`--rating-star: #d9b54b`。
- Inspector 状态行仅在不可用或回收站时渲染。

## 复验（同日）

用户确认 THEME-002 / AVAIL-001 及相关微调（toast 无描边、亮色星标更黄）通过。
