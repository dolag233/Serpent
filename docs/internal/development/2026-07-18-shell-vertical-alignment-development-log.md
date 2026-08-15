# 2026-07-18 REQ-SHELL-002：壳层竖直对齐统一收口

> 工单：`Serpent-680`  
> 需求：`REQ-SHELL-002`  
> 状态：CSS 收口已落地；工单保持 `in_progress`（未提交）；Computer Use / Windows 未执行。

## 背景

`591f524` 已对顶栏部分控件做了 `align-items` / `line-height` 修补，但全局工具栏、浏览标题栏、发现过滤条、目录数量徽标与 filter chips 仍用散落字面高度与不对称 padding，图标 inline SVG 基线空隙与 chip 高度不一致导致各栏中线不齐。

## 本增量

文件：`src/renderer/styles.css`（CSS-only，不改 JSX / 设计语言）。

### 高度 token（沿用既有数值）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--shell-toolbar-height` | 44px | 应用顶栏、resizer/dialog inset、窄屏 pane 顶偏移 |
| `--shell-workspace-bar-height` | 40px | 浏览目录标题栏 |
| `--shell-control-height` | 28px | 工具按钮、搜索框、维度按钮、面包屑行高、库切换器等 |
| `--shell-chip-height` | 22px | 数量徽标、激活过滤 chip、标签 chip、预设 chip |

### 居中收口

1. **图标**：`.icon { display: block }`，去掉 inline SVG 默认基线空隙。
2. **顶栏**：`.app-toolbar` 显式 `height: var(--shell-toolbar-height)`；面包屑行高对齐 control；搜索清除钮 `top: 50%` + `translateY(-50%)`。
3. **浏览栏**：标题文字与 tools 同为 control 高度中线；`.item-count` 固定 chip 高度 + `inline-flex` 居中。
4. **发现栏**：上下 padding 由 `6/8` 改为对称 `6/6`；维度行 `min-height` + chips 行 `align-items: center`；active / search / tag / preset chips 统一 `--shell-chip-height`。

## 验证

- 变更范围仅 `styles.css` + 文档；未改协议 / worker / 定位器。
- Computer Use：本回合未执行；移交人工 QA（`SHELL-020`）。
- Windows：未验证。

## 人类验收

- 条目：`SHELL-020`（`docs/internal/qa/human-acceptance-checklist.md`）
- 需求池：`REQ-SHELL-002` 状态更新为已实现、待人类验收。

## 未做

- 未提交 git（按任务要求）。
- 未关闭 `Serpent-680`（保持 `in_progress`）。
