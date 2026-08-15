# 冲突预览、文件夹回收站、导出名称与 `Serpent-i1qt` 开发日志

日期：2026-08-09

## 本次收口

### 视频同名冲突使用 poster

冲突对话框本身已经通过 `serpent://preview/{libraryId}/{artifactId}` 渲染已有预览；问题在 Worker 的冲突查询仍固定连接 `revision_artifacts.kind = 'thumbnail'`。图片的主预览是 `thumbnail`，视频的主预览是 `video_poster`，因此视频冲突项拿不到 artifact id。

`findActiveManagedAssetByContent` 与 `findActiveManagedAssetAtPath` 现在按源文件扩展名选择 `video_poster` 或 `thumbnail`，并且都过滤失效 artifact。新增 Worker 回归覆盖视频的同名冲突和内容重复两条路径。

### 文件夹拖入回收站

Trash 导航行现在接受 `application/x-serpent-managed-folders` payload，并调用已有的 `folder.trash` API。多选拖拽会先去重；父文件夹与子文件夹同时选中时只提交父文件夹，避免父级递归移入回收站后再次提交子级。

如果当前浏览范围属于被移入回收站的文件夹树，操作后自动回到资源库根目录；否则按当前范围刷新。新增纯逻辑单测和真实 Electron 拖拽 E2E。

### 导出默认名称

Renderer 将当前 `library.displayName` 通过类型化导出请求传给 Main。Main 为 folder/zip 保存对话框使用该名称，并清理 Windows 不允许的文件名字符、保留名称长度上限和 DOS 保留名兜底；ZIP 导出最多保留一个 `.zip` 后缀。纯函数和协议兼容性有单测覆盖。

### `Serpent-i1qt`

导航行的资产/子文件夹计数是视觉辅助信息，现标记为 `aria-hidden="true"`，不会再拼进按钮 accessible name。`asset-pagination` 的 exact `回收站` 查询因此不受计数到达时序影响。

## 验证记录

- `npm run typecheck`：最终通过。
- 定向 Vitest（folder drag、export name、protocol、import planning）：129/129 通过。
- `npx eslint`（本次变更相关文件）：通过。
- `node scripts/run-e2e.mjs tests/e2e/asset-pagination.test.ts`：连续 5 次通过，满足 `Serpent-i1qt` 验收条件。
- `node scripts/run-e2e.mjs tests/e2e/folder-recursive-scope.test.ts`：3/3 通过，包含新增“managed folder rows can be dragged into Trash”。
- `npm run test`：最终 367 个测试文件通过、4 个跳过；3258 个测试通过、9 个跳过。
- `npm run lint`：通过；删除了 `src/renderer/offscreen-thumbnail/page-renderer.ts:237` 的未使用变量 `directions`。

packaged、Windows 和用户当前开发实例的 Computer Use 复验仍需单独执行；E2E 使用隔离 userData，不替代这些平台证据。
