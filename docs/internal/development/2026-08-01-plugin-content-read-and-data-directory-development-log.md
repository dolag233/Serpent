# 2026-08-01 Plugin Content Read and Data Directory Development Log

## Scope

本回合完成 `Serpent-pn7k` 的只读内容 Gateway 延伸，以及 `Serpent-2nxg` 的插件文件数据目录。现有 `asset.content.replace` 与 KV storage 行为保持兼容；本回合不迁移既有 KV JSON 文件。

## API shape

- `asset.content.read`
  - input: `{ assetId: string; maxBytes?: number }`
  - `maxBytes` 默认 `32 MiB`，最大 `32 MiB`
  - result: `{ assetId, revisionId, byteSize, dataBase64, truncated, mimeType: string | null }`
  - 仅允许 `managed`、`available` 资产；只读取 Worker 内部解析出的当前文件路径，不向 Guest 暴露路径。
- `serpent.assets.readContent(assetId, options?)`
  - 通过共享 `src/scripting/serpent-guest-api.ts` 命令表接入 Standard/Trusted Host。
- `serpent.data.getDirectory({ scope?: 'user' | 'library' })`
  - result: `{ path, scope }`
  - 默认作用域为插件安装作用域；用户作用域无需打开库，库作用域要求当前库已打开。
  - 用户目录：`<userData>/plugin-files/<pluginId>/`
  - 库目录：`<libraryRoot>/.serpent/plugin-files/<pluginId>/`

## Compatibility and permission boundary

新增 manifest 权限 `data.files`，由 Main 的 `PluginStorageStore` Host handler 执行检查。目录解析只使用 Main 保存的 `pluginId`、安装作用域和打开库目录；插件不能提交绝对根路径。既有 KV 路径仍为库级 `.serpent/plugin-data/<pluginId>.json`、用户级 `userData/plugin-storage/<pluginId>/user.json`，本回合未迁移或覆盖这些文件；文件目录使用 `<pluginId>/` 目录，因此与 `<pluginId>.json` 为不同路径。

## Evidence

- `npm run typecheck`：通过，`tsc --noEmit` 与 `tsc -p tsconfig.extension.json` 均 exit 0。
- 定向测试命令：`npx vitest run tests/unit/automation-command-gateway.test.ts tests/unit/quickjs-sandbox-prototype.test.ts tests/unit/plugin-trusted-host.test.ts tests/unit/plugin-data-directory.test.ts tests/worker/asset-metadata-revision.test.ts`；4 个单测文件通过，共 64 tests；Worker 文件的 3 tests 因本机 `better-sqlite3` 为 Node ABI 148 而当前 Node 要求 ABI 137，均在建库阶段以 `ERR_DLOPEN_FAILED` 阻断，未将其记为功能通过。
- 未运行完整 `npm test`、Electron E2E、`verify:mainline`、packaged、Windows 或 Computer Use；因此 PLUGIN-034/035 仅进入“待人类验收”。
