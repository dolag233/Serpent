# PLUGIN-016：Custom UI iframe 开发日志

日期：2026-08-01  
工单：`Serpent-upsn.6`  
范围：0024 Phase E 的首个 `workspace.views` 自定义 UI 垂直切片

## 架构选择

- UI 资产通过 `serpent-plugin://` 由 Main 进程提供服务。请求包含插件 ID、插件实例、资源库和贡献 ID；Main 只从当前激活插件包的包内路径解析文件，不把任意文件系统路径暴露给 Renderer。
- Renderer 使用 Host-owned React wrapper 渲染贡献标签和 iframe。iframe 只设置 `sandbox="allow-scripts"`，不注入 React，不获得 preload、Node、宿主 DOM 或文件系统访问。
- Main 对每个 UI 资源响应设置 CSP。脚本、样式、媒体和字体仅允许当前插件 origin（另允许必要的内联样式和图片 `data:`）；`connect-src`、`object-src` 和 `frame-src` 保持收紧。
- iframe 与 Host 使用 `src`、`instanceId`、`contributionId` 绑定的 Zod 消息协议。sandbox iframe 的事件 origin 为 opaque `null`，Host 同时校验 origin、`event.source`、当前 iframe 和贡献绑定，未知消息直接丢弃。
- Theme 使用 Host CSS variables 读取后的 token 数据通过 `plugin-ui.theme` 发送，iframe 自己写入 CSS variables；命令和受限 namespaced storage 通过 Main typed IPC 接缝执行。

## 实现增量

1. `contributes.views[].entry` 加入 manifest 与贡献注册，`workspace.views` 列表携带 `entryPath`。
2. 新增 `serpent-plugin://` URL 构造、解析、MIME 类型和包内路径校验；补充目录遍历拒绝，包括原始 URL 中的编码 dot segments。
3. 新增 Main protocol handler、当前激活包解析和 UI storage get/set IPC。
4. 新增 `PluginWorkspaceViews` renderer 模块和工作区视图样式；App 仅负责挂载 Host-owned wrapper。
5. 新增 `plugin-ui-protocol.ts`，覆盖 ready、theme、invoke-command、storage get/set、command result 和 storage result。
6. 新增 `iframe-workspace-probe` 固定探测插件，验证 ready、theme、command 和 storage 交互。

## 四列追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| `workspace.views` 可携带 HTML entry | `src/plugins/plugin-manifest.ts`；`src/plugins/plugin-contributions.ts` | `tests/unit/plugin-contributions.test.ts` | 待人类验收：`PLUGIN-016` |
| 非 app origin、安全包内资源服务 | `src/main/plugin-ui-assets.ts`；`src/main/index.ts`；`src/main/plugin-activation-coordinator.ts` | `tests/unit/plugin-ui.test.ts` | 真实 Electron / packaged / Windows 未执行 |
| sandbox iframe Host wrapper | `src/renderer/plugin-workspace-views.tsx`；`src/renderer/App.tsx` | 类型检查；UI 协议定向测试 | Computer Use、真实 Electron 未执行 |
| typed postMessage、origin/source/instance 绑定 | `src/shared/plugin-ui-protocol.ts`；`src/renderer/plugin-workspace-views.tsx` | `tests/unit/plugin-ui.test.ts` | 人工交互未执行 |
| command/storage 最小桥接 | `src/main/plugin-package-ipc.ts`；`src/shared/plugin-manager-api.ts` | `tests/unit/plugin-ui.test.ts`；`tests/unit/plugin-manager-response-parse.test.ts` | 真实重启恢复未执行 |

## 验证

- `npx tsc --noEmit`：通过。
- `npx vitest run --config vitest.config.ts tests/unit/plugin-ui.test.ts tests/unit/plugin-contributions.test.ts tests/unit/plugin-contract.test.ts tests/unit/plugin-manager-response-parse.test.ts`：4 个测试文件、30 个测试通过。
- `npx vitest run --config vitest.config.ts tests/unit/serpent-protocol-privileges.test.ts tests/unit/plugin-package-ipc.test.ts`：2 个测试文件、8 个测试通过。
- 未运行全量测试、Electron E2E、packaged 验证或 Windows 验证，符合本增量范围。

## 未完成与风险

- `sidebar.entries`、`inspector.views`、`viewer.overlays`、`settings.pages` 尚未接入 iframe；本切片只交付 `workspace.views`。

## PLUGIN-017：`sidebar.entries` iframe 切片（2026-08-01）

1. 抽取共享 `PluginIframeViewHost`（`src/renderer/plugin-iframe-view-host.tsx`），`workspace.views` 与 `sidebar.entries` 复用同一 sandboxed iframe shell 与 postMessage 处理。
2. `sidebar.entries` 贡献列表经 `listSidebarViewContributions` + activation coordinator + `list-contributions` IPC 暴露 `entryPath`/`url`。
3. 侧栏 NavRow 入口（`NavigationSidebar`）点击后在主画布展示 `PluginSidebarViewPanel`；离开其他导航时撤销。
4. `iframe-workspace-probe` fixture 增加 `location: "sidebar"` 的 `sidebar-probe` 视图与 `entry/ui/sidebar.html`。

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| `sidebar.entries` 可携带 HTML entry | `src/plugins/plugin-contributions.ts`；`src/shared/plugin-manager-api.ts` | `tests/unit/plugin-contributions.test.ts` | 待人类验收：`PLUGIN-017` |
| 侧栏 Host 入口 + 主画布 iframe | `src/renderer/plugin-sidebar-views.tsx`；`src/renderer/NavigationSidebar.tsx`；`src/renderer/App.tsx` | 类型检查 | Computer Use、真实 Electron 未执行 |
| 共用 iframe shell | `src/renderer/plugin-iframe-view-host.tsx` | `tests/unit/plugin-ui.test.ts` | 人工交互未执行 |

## 验证（PLUGIN-017 增量）

- `npx tsc --noEmit`：通过。
- `npx vitest run --config vitest.config.ts tests/unit/plugin-contributions.test.ts tests/unit/plugin-ui.test.ts tests/unit/plugin-contract.test.ts`：3 个测试文件、28 个测试通过。

## 未完成与风险（更新）

- `shortcuts` / Input Capture（`Serpent-upsn.7`）尚未实施；`inspector.views`、`viewer.overlays`、`settings.pages` 已交付待人类验收（`PLUGIN-018`–`PLUGIN-020`）；`sidebar.entries` 已交付待人类验收（`PLUGIN-017`）。
- 尚未有当前 HEAD 的真实 Electron 桌面截图、完整 Electron 进程退出重启证据、packaged 证据或 Windows 证据。
- 下载、顶层导航和新窗口阻断已在 Main 的窗口级处理链中覆盖 `serpent-plugin://`，但仍需真实桌面旅程验证。
- `PLUGIN-016`–`PLUGIN-017` 保持“待人类验收”，不能由定向单测或类型检查改为“人类验收通过”。

## PLUGIN-018–020：剩余 iframe 位置切片（2026-08-01）

1. 新增 `plugin-inspector-views.tsx`、`plugin-viewer-overlays.tsx`、`plugin-settings-pages.tsx`，均复用 `PluginIframeViewHost`。
2. `list-contributions` / activation coordinator 支持 `inspector.views`、`viewer.overlays`、`settings.pages`。
3. Inspector 内标签 + iframe；查看器右下角可折叠覆盖层；设置 → 插件页「插件自定义页面」分区。
4. `iframe-workspace-probe` fixture 扩展 `inspector-probe`、`viewer-overlay-probe`、`settings-page-probe` 视图与 HTML/JS。

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| `inspector.views` iframe | `src/renderer/plugin-inspector-views.tsx`；`InspectorPanel.tsx` | `tests/unit/plugin-contributions.test.ts` | 待人类验收：`PLUGIN-018` |
| `viewer.overlays` iframe | `src/renderer/plugin-viewer-overlays.tsx`；`AssetPreviewModal.tsx` | `tests/unit/plugin-contributions.test.ts` | 待人类验收：`PLUGIN-019` |
| `settings.pages` iframe | `src/renderer/plugin-settings-pages.tsx`；`PluginSettingsPage.tsx` | `tests/unit/plugin-contributions.test.ts` | 待人类验收：`PLUGIN-020` |
| 贡献注册与 IPC 列表 | `src/plugins/plugin-contributions.ts`；`src/main/plugin-activation-coordinator.ts`；`src/shared/plugin-manager-api.ts` | `tests/unit/plugin-contributions.test.ts` | 类型检查 |

## 验证（PLUGIN-018–020 增量）

- `npx tsc --noEmit`：通过。
- `npx vitest run --config vitest.config.ts tests/unit/plugin-contributions.test.ts tests/unit/plugin-ui.test.ts tests/unit/plugin-manager-response-parse.test.ts`：3 个测试文件、16 个测试通过。
