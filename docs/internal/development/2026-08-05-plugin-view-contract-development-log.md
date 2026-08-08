# Plugin View Contract 开发日志（Serpent-ex46.7）

- 日期：2026-08-05
- 分支：`codex/slice-002-asset-ingestion`
- 工单：`Serpent-ex46.7`（Plugin View Contract、主题 bridge 与实例生命周期）；父系 `Serpent-ex46`（UI 标准化第二阶段）

## 需求（工单验收）

Host-managed Plugin View Contract：viewType/instance/scope/state/mount/unmount/resize/theme-change/dispose；修复入口与内容状态耦合导致的闪烁；覆盖 iframe crash/reload/多库隔离。验收：插件入口不因内容加载/刷新瞬间消失；global/library View 实例隔离；主题变化不重载即可传播；iframe crash/reload/dispose 有确定状态和清理；有多库与真实 Electron E2E。

## 实现

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 协议扩展：host→plugin `view-mounted`（viewType/scope/libraryId/state）、`view-state-changed`、`view-resized`、`view-unmounted`；plugin→host `ready` 扩展可选 viewType/scope 校验字段 | `shared/plugin-ui-protocol.ts`（`PLUGIN_UI_VIEW_TYPES`/`PLUGIN_UI_VIEW_SCOPES`、4 个新 host 消息、ready 扩展；view state 限定 bounded JSON ≤16KB） | `tests/unit/plugin-view-contract.test.ts`：新消息 parse、未知 viewType/scope 拒绝、state 超限拒绝、ready 兼容旧格式 | — |
| 生命周期状态机（纯函数）：loading/ready/reloading/crashed/disposed；ready 只在 loading/reloading 接受；disposed 吸收一切 | `renderer/plugin-iframe-view-host.tsx`（`nextPluginViewState`） | 状态机全转移表：初始加载/就绪文档 reload 区分、崩溃恢复、disposed 吸收 | — |
| Host 组件：onLoad 发 mounted（新文档每次重置挂载通知）、ready 校验（contributionId/instanceId/viewType/scope）、theme 变化走 `theme-changed` 不重载、ResizeObserver→resized（rAF 防抖）、卸载发 unmounted + 状态 disposed | 同文件（`PluginIframeViewHost`） | —（组件行为由 E2E 覆盖） | — |
| 实例隔离：iframe key = contribution+scope+library（切库/切 scope 重建文档）；7 个 surface 接入（sidebar/inspector/workspace/viewer-overlay/settings-page/settings-detail） | `buildPluginIframeViewDescriptors(contributions, viewType, scope)` + 7 个 surface 构建器传参 | descriptor 构建：排序/过滤/元数据附加 | — |
| 占位与崩溃态：loading/reloading 显示占位层（防闪烁），crashed 显示重试（URL bump 强制重载） | `PluginIframeViewHost` + `styles.css`（`.plugin-view-host-*`） | — | 待人工/Computer Use |
| **CSP 修复（真实产品 bug）**：渲染进程 CSP 缺 `frame-src`，回退 `default-src 'self'` 阻止 `serpent-plugin://` iframe 嵌入（插件视图从未能加载） | `index.html`（CSP 加 `frame-src 'self' serpent-plugin:`） | E2E 验证 iframe 实际加载 | — |
| E2E 日志隔离（验收纪律 7 修复）：E2E 下 `setAppLogsPath` 指向隔离 userData（原写真实 `~/Library/Logs`，且因目录不存在导致 logger 静默失效） | `main/index.ts`（startApplication）+ `tests/e2e/plugin-view-contract.test.ts`（attach 日志/journal） | — | — |
| E2E：真实 Electron 全链路（安装→信任→激活→侧栏视图→mounted 消息→主题不重载→强制重载重新握手→库2 隔离无入口） | `tests/e2e/plugin-view-contract.test.ts` + fixture `tests/fixtures/plugins/view-contract-probe/` | `node scripts/run-e2e.mjs tests/e2e/plugin-view-contract.test.ts`：1 passed | — |

## E2E 排障中定位的真实问题（根因链）

1. **插件包缺 README/LICENSE** → `PLUGIN_SOURCE_READ_FAILED`（fixture 补齐）
2. **QuickJS Host 入口格式**：restricted 插件 entry 必须是 `setup(serpent)`/`dispose()`——`export const plugin = true` 运行时报错 → 实例崩溃 → 贡献撤销（E2E 侧栏空）
3. **CSP 阻止插件 iframe**（见上，产品 bug）
4. **插件页面 CSP 禁内联脚本**：`script-src 'self'`——fixture 脚本抽外部文件（产品设计正确）
5. **sandbox iframe 内 `location.reload()` 被禁**（无 allow-same-origin）——E2E 改父页面重导航 + `framenavigated` 验证
6. **E2E 断言陷阱**：reload 后新文档计数归零（窗口级状态）；finally 清理与 Electron 退出竞态（`maxRetries` + walk 容错）

## 验证记录

- `npm run typecheck`：通过。`npm run lint`：通过。
- `npm run test:unit`：286 文件 2117 通过 / 1 skip。
- `node scripts/run-e2e.mjs tests/e2e/plugin-view-contract.test.ts`：1 passed（3.3s）——注意 E2E 必须走 run-e2e.mjs（先 vite 构建），直接 npx playwright 会用旧构建。
- 未执行：Computer Use / 人工视觉验收（占位/崩溃态观感）；packaged / Windows。

## 关联

- 前置：`Serpent-ex46.2`（Theme Contract v1）、`Serpent-ex46.6`（Plugin UI Contract v1）。
- 阻塞：`Serpent-ex46.8`（UI 标准化发布文档、fixture、诊断与最终验收）。
- 遗留：palette-tools / unrestricted-settings-pages E2E 基线失败（信任后 checkbox disabled / 资产选择计数）——与本工单无关的预存问题，单独排查。
