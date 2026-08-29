# 2026-07-18 侧栏长名称省略（Serpent-l6v / CU-D9）

## 问题

深层或很长的文件夹名在左侧导航折行，撑高目录树行高；合集 / 智能合集名称同样缺少截断。

## 实现

- `NavRow` 标签改为 `.nav-row-label`：`overflow: hidden`、`text-overflow: ellipsis`、`white-space: nowrap`、`min-width: 0`。
- `.nav-row` 增加 `min-width: 0` 与 `overflow: hidden`，配合既有 `height: 28px` 与 `minmax(0, 1fr)` 网格列，保证缩进加深后仍单行截断。
- 深度缩进仍用按钮 `paddingLeft: 7 + depth * 14`；disclosure 仍在 `.nav-tree-row` 左侧独立列，不受标签截断影响。
- `title` 默认等于全名；若调用方另传状态文案（如离线链接文件夹），格式为 `名称 — 状态`。

覆盖范围：托管/链接文件夹、合集树、智能合集，以及「所有资产」「回收站」等共用 `NavRow` 的行。

## 验收

**NAV-006** — 见 `docs/internal/qa/human-acceptance-checklist.md`。

## 验证

- Computer Use：未执行（当前环境无桌面控制）；移交人工按 NAV-006 验收。
- 未改协议 / Worker；未跑全量 E2E（纯展示 CSS + 共享行组件）。
