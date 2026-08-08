# 2026-08-01：Attached MCP Desktop 状态与文件夹导航

> 工单：`Serpent-lq5y.2.1`（父工单：`Serpent-lq5y.2`）
> 状态：开发态垂直增量完成；保留视觉与平台验收边界

## 变更

- Desktop 控制协议新增版本内 typed browse state、`serpent_desktop_get_state` 和 `serpent_desktop_open_folder`。
- 同一协议增量新增 `serpent_desktop_set_discovery`，接受现有搜索、palette color facet、SortDefinition 字段与 asc/desc，不创建第二套查询实现。
- 新增 `serpent_desktop_reveal_asset`，只接受稳定 `assetId` 与 `nearest|center` 语义位置；Renderer 通过资产摘要解析当前可见、需要切换托管文件夹、不可用和不支持范围，不返回 DOM 或像素坐标。
- 新增 `serpent_desktop_open_viewer` 与 `serpent_desktop_close_viewer`，复用现有 Desktop Viewer 的打开/关闭动作，结果只返回 viewerAssetId 和 Browse 状态摘要。
- Main 新增 `DesktopBrowseControl`，通过受限 Main↔Renderer IPC 请求/响应获取状态并发送打开文件夹意图。
- Renderer 新增 `useDesktopAutomationBrowse`，复用现有 `chooseFolder`、`currentQueryDefinition` 和 `loadContent` 领域动作；无效 folderId、其他浏览组织范围、预览/模态阻塞时返回稳定错误。
- Attached MCP 复用既有附着会话与 library binding；工具结果只返回库 ID、浏览状态、资产 ID 和 UI 摘要，不返回路径、DOM、路由或像素坐标。
- Headless MCP 仍不注册 Desktop-only 工具。

## 验证

- `npx vitest run tests/unit/desktop-browse-reveal.test.ts tests/unit/desktop-browse-control.test.ts tests/unit/desktop-control-plane.test.ts tests/unit/automation-mcp-host.test.ts`：4 个测试文件、10/10 通过；覆盖 reveal 解析器和 Viewer open/close IPC 往返。
- `npm run typecheck`：主 TypeScript 与扩展 TypeScript 通过。
- `npm run lint`：通过。
- `node scripts/run-e2e.mjs tests/e2e/automation-mcp-attached-desktop.test.ts`：1 passed（7.2s）；覆盖 Attached MCP 工具发现、状态读取、根范围/文件夹打开、无效 folderId、includeSubfolders 开关、red 筛选、byte_size desc 排序状态应用/清除、assetId + center reveal、Viewer 打开/关闭和真实网格选中。

## 已知边界

- 当前增量实现状态读取、托管文件夹/根范围导航、搜索/颜色 facet/排序状态控制、assetId 语义 reveal 和 Viewer 打开/关闭；完整过滤字段、颜色结果视觉语义、跨分页/跨文件夹 reveal 的真实 E2E、Viewer 前后切换留在父工单后续子增量。
- 当前 E2E 使用根范围和无效 ID；真实目标文件夹视觉导航、Computer Use、packaged macOS、Windows 尚未执行。
