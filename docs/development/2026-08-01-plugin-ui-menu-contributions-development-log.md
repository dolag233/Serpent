# 2026-08-01 插件 UI 菜单贡献（Phase E slice 1–3）

## 范围

本增量实现 Host-rendered `menus.asset`、`menus.folder`、`menus.collection` 与 `menus.workspace`：

- 激活时从 manifest 注册稳定的菜单贡献，停用时随插件实例撤销；
- 标准 Host 与可信 Host 均支持 `serpent.commands.register(id, handler)`；
- Renderer 打开资产/文件夹/合集/工作区空白区右键菜单时读取贡献，调用命令时传递 `assetIds` / `folderIds` / `collectionIds`；
- 固定探测插件将上下文 ID 写入插件 Storage，作为跨进程调用证据。

插件不能注入宿主 React 或访问宿主 DOM；iframe 自定义视图、工具栏、Inspector/viewer/settings 页面仍未在本切片实现。

## 实现位置

- `src/plugins/plugin-contributions.ts`：命令标题解析、`listMenuContributions(registry, target)`；
- `src/plugins/plugin-commands.ts`：命令 invoke/complete schema（含 `folderIds` / `collectionIds`）、队列和超时；
- `src/scripting/plugin-guest-realm.ts` / `quickjs-sandbox-prototype.ts`：Standard Host 命令桥；
- `src/scripting/plugin-standard-host.ts` / `plugin-trusted-host.ts`：双 Host handler；
- `src/main/plugin-runtime-supervisor.ts` / `plugin-trusted-runtime-supervisor.ts`：命令调用等待；
- `src/main/plugin-activation-coordinator.ts` / `plugin-package-ipc.ts`：激活实例过滤、IPC；
- `src/renderer/plugin-menu-contributions.ts` / `AssetContextMenu.tsx` / `App.tsx`：宿主菜单渲染（含工作区空白区）；
- `tests/fixtures/plugins/menu-command-probe/`：Standard Host 探测插件（asset/folder/collection/workspace）。

## 验证

- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/plugin-contributions.test.ts tests/unit/plugin-commands.test.ts tests/unit/plugin-package-ipc.test.ts`
  - 定向单测通过（slice 2 增量）。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/plugin-contributions.test.ts tests/unit/plugin-package-ipc.test.ts`
  - slice 3（`menus.workspace`）定向单测 14 passed。
- `npx tsc --noEmit`
  - 通过。

## Slice 3：`menus.workspace`（PLUGIN-015）

- `pluginHostMenuTargetSchema` / IPC `list-contributions` 支持 `menus.workspace`；
- 工作区画布空白区右键打开 `type: "workspace"` 上下文菜单，仅渲染插件命令分区；
- `run-command` 在有选中资产时传递 `assetIds`，无选中时省略（与工具栏一致）；
- 探测插件写入 `workspace-command` storage。

## 未验证与推迟

- 当前仅完成开发态定向自动化；真实 Electron 菜单操作（文件夹/合集/工作区空白区分支）、完整进程重启恢复、packaged、Windows 和 Computer Use 尚未验证；
- Trusted Host 的命令路径已接入协议和 handler，但本切片未新增独立 Trusted 命令 E2E；
- iframe sandbox、自定义视图和其他 UI contribution target 推迟到后续 slice。

