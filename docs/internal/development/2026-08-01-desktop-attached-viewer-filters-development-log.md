# 2026-08-01：Attached MCP Viewer 导航与完整 Discovery 过滤

> 工单：`Serpent-990x`、`Serpent-ap4u`（父工单：`Serpent-lq5y.2`）
> 状态：开发态垂直增量完成；保留视觉与平台验收边界

## 变更

- 新增 `src/shared/desktop-browse-discovery.ts`：Discovery 过滤快照/补丁应用与 Viewer 邻居解析（纯函数，无 DOM）。
- `serpent_desktop_get_state` / `set_discovery` 扩展 format、tag、rating、favorite、sourceUrl、availability 与 width/height/aspectRatio/longEdge/duration 范围及 exclude 语义；颜色仍为 palette facet。
- 新增 `serpent_desktop_navigate_viewer({ direction: previous|next })`，复用现有 `visibleAssets` + `navigateAssetPreview`；边界返回 `DESKTOP_BROWSE_VIEWER_BOUNDARY`，未打开返回 `DESKTOP_BROWSE_VIEWER_CLOSED`。
- Main `DesktopBrowseControl`、Attached MCP、Renderer Hook 与 App 接缝同步；headless Registry 仍不暴露 Desktop-only 工具。

## 验证

- `npx vitest run tests/unit/desktop-browse-discovery.test.ts tests/unit/desktop-browse-control.test.ts tests/unit/desktop-control-mcp.test.ts tests/unit/desktop-browse-reveal.test.ts`：4 文件、11/11 通过。
- `npm run typecheck`：主 TypeScript 与扩展 TypeScript 通过。
- `node scripts/run-e2e.mjs tests/e2e/automation-mcp-attached-desktop.test.ts`：1 passed（8.4s）；覆盖 Viewer `next`、边界 `DESKTOP_BROWSE_VIEWER_BOUNDARY`，以及 `favoriteFilter`/`formatFilter`/`ratingFilter` 设置与清除。

## 人类验收

- AUT-027（Viewer 前后切换）、AUT-028（完整 Discovery 过滤）已进入待人类验收。
- Computer Use、packaged、Windows、跨分页/跨文件夹 reveal 真实视觉证据仍未执行。
