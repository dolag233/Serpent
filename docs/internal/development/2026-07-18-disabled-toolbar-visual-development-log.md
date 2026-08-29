# 2026-07-18 无资源库顶栏 disabled 视觉区分（CU-U4 / Serpent-zlj）

## 问题

Computer Use 审计 U4：无资源库时顶栏搜索、智能合集输入、相关按钮等在视觉上与可用态几乎无差异，仅靠实际不可点击体现 disabled。

## 根因

部分控件虽已传 `disabled={!library}`，但 `styles.css` 缺少或过弱的 `:disabled` 规则：

| 控件 | 此前 |
| --- | --- |
| `.text-field`（智能合集名） | 无 `:disabled` |
| `.dimension-filter-btn` / rating chip / color swatch / active chip | 无 `:disabled`；hover/active 未排除 disabled |
| `.tool-button` | 无 `:disabled`；hover / `aria-pressed` 未排除 disabled |
| `.search-control` / `.compact-action` / `.library-switcher-trigger` | 仅有 opacity，缺少 muted 色与 not-allowed 光标 |
| `.compact-action.is-accent:disabled` | 需排在 `.is-accent` 之后，否则 accent 填充盖过 disabled |
| `.ai-search-toggle[aria-pressed]` | 未排除 `:disabled`，禁用时仍可能显示 pressed 强调色 |

## 实现

文件：`src/renderer/styles.css`（沿用现有 `--tertiary` / opacity 体系，不新增设计语言）。

- 统一 chrome disabled 表现：`color: var(--tertiary)`、`opacity: 0.48`、`cursor: not-allowed`
- 覆盖：`.tool-button`、`.compact-action`（含 `.is-accent`）、`.search-control`（含 placeholder）、`.search-clear-btn`、`.text-field`、`.dimension-filter-btn`、`.dimension-rating-chip`、`.dimension-color-swatch`、`.dimension-active-chip`、`.library-switcher-trigger` / `.library-switcher-item`、`.scope-history-button`（history 仍用更淡的 `0.35` opacity）
- hover / pressed / is-active / is-open 改为 `:not(:disabled)`，避免禁用态仍显示可点反馈

未改 JSX：`disabled={!library}` 与 LibrarySwitcher 菜单项 `libraryScopedDisabled` 已存在。

## 验收

人类验收条目：`SHELL-019`（见 `docs/internal/qa/human-acceptance-checklist.md`）。

Computer Use：本回合未执行；移交人工 QA。
