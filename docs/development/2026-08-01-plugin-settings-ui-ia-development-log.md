# 2026-08-01 插件设置 IA 与列表样式

## 范围

设置中心插件管理 UI：侧栏「插件设置」、卡片信息层级、非受限默认不启用、刷新/设置/卸载图标操作、MCP 声明即暴露。

## 行为

1. **设置 → 插件**：安装与启用管理；卡片标题为 `名称 - v版本`；来源为文件夹/GitHub 图标；权限为圆圈感叹号 hover；无「已/未启用」文案、无受限模式标注；非受限为偏黄警告色 + 警告图标文案；空列表仅「暂未安装插件」。操作区为刷新 → 设置 → 垃圾桶卸载 → 启用开关。
2. **设置 → 插件设置**（侧栏分类列表最后一项，可展开，不换行）：列出有 `settings.sections` / `settings.pages` 的插件；点选后进入详情。
3. **非受限包**：首次无 Resolution 记录时 `resolve` 返回 `disabled/user-disabled`；用户可见文案统一为「非受限模式」（wire 仍为 `unrestricted`）。
4. **MCP**：`commands[].mcp.export`（及顶层兼容声明）在插件激活后默认出现在 MCP tools/list，可直接 tools/call；设置页不再提供暴露开关。

## 文档

- `docs/plugin-development-guide.md`：非受限命名与默认不启用；设置入口。
- `docs/qa/human-acceptance-checklist.md`：`PLUGIN-001`、`PLUGIN-031`。

## 验证

```text
npx vitest run tests/unit/plugin-package-manager.test.ts \
  tests/unit/plugin-settings-nav.test.ts \
  tests/unit/plugin-mcp.test.ts \
  tests/unit/plugin-manager-response-parse.test.ts
```

未执行：真实 Electron UI、packaged、Windows、Computer Use。

## 后续修复：贡献列表 instanceId 过滤（同日）

根因：`PluginActivationCoordinator.listContributions` 把 `#activeByLibrary` 的 Map **keys（pluginId）** 当成 active instanceId 集合，再与贡献上的 UUID `pluginInstanceId` 比较，结果恒空。插件可正常激活并写入 contribution registry，但 Renderer 经 `plugin-manager.list-contributions` 永远拿不到菜单 / `settings.pages` / 工具栏等项。Image Upscaler 已启用却无资产右键与设置 iframe 由此引起。

修复：`records.values().map(r => r.instanceId)`；`listMcpCommandContributions` 同步；`refreshLibrary` 的 `listInstalled` 使用 `integrity: 'metadata'`，避免大包全量哈希拖住激活。

```text
npx vitest run tests/unit/plugin-activation-coordinator.test.ts
# 6 passed
```

## 后续修复：启动恢复最近库未激活插件（同日）

根因：`src/main/index.ts` 启动时用 `workerClient.request({ type: 'library.open' })` 恢复 `recent-library.json`，**不经过** `handleLibraryRequest`，因此从未调用 `pluginActivationCoordinator.onLibraryOpened`。Worker 库已开、Renderer `listOpen` 正常，但 `#activeByLibrary` / `#openLibraries` 为空 → `list-contributions` 恒空（菜单、`settings.pages` iframe）。侧栏「插件设置」仍能列出插件名，因其来自清单 `hasSettingsUi`，不依赖激活。

证据：本机 `plugin-contrib-diag.json` 为 `active: []`、`contributionCount: 0`；`serpent.log` 在对应会话无 `plugin.activation.*`。

修复：抽出 `notifyLibraryOpenedSideEffects`，对话框开库与启动恢复共用；启动路径 `await` 激活后再继续。

```text
npx vitest run tests/unit/plugin-activation-coordinator.test.ts
```

复测（需完整退出 Electron 后 `npm start`）：资产右键应出现 Upscaler 菜单；设置 → 插件设置 → Image Upscaler 应出现 iframe，而非「该插件暂无设置页」。

## 后续修复：Zod view 贡献 discriminator（同日）

根因：全局/库级插件激活后 Main 已返回 `settings.pages`（本机 diag `contributionCount: 1`），Renderer 控制台反复 `plugin-manager.response-invalid Error: Duplicate discriminator value "view"`。Zod 4 禁止 `discriminatedUnion('kind')` 内多个 `kind: "view"` 变体。

修复：`pluginManagerViewContributionSchema` 单一对象 + `target` 枚举；`plugin-manager-response-parse` 增加 settings.pages / menus.asset 用例。

说明：安装作用域 `user`（全局）仍按**当前打开资源库**做 resolution（`selection: use-global`）并激活 Host；无开库则无贡献会话。这不是「库级安装」的意思。产品跟进见工单 `Serpent-2qsq`。

## 后续：贡献解析与启动激活回归测试（2026-08-02，`Serpent-l2tj`）

见 [贡献回归测试开发日志](./2026-08-02-plugin-contribution-regression-tests-development-log.md)。
