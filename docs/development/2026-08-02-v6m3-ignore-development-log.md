# Serpent-v6m3：显式忽略文件与文件夹

日期：2026-08-02  
状态：实现完成，待人类验收

## 范围

- 为托管库和链接文件夹增加持久化的显式 ignore 条目；文件和文件夹均支持。
- 文件夹 ignore 按相对路径前缀生效，不删除现有索引行，便于恢复显示。
- 扫描、浏览、搜索、文件夹计数、链接文件夹计数和封面均排除被忽略路径。
- 对媒体路径解析、复制、移动、重命名、标签/元数据编辑、回收站和硬盘删除增加防护，避免对隐藏项目继续执行操作。
- 右键菜单提供“忽略”；设置 → 常规 → 已忽略项目提供恢复入口。

## 实现位置

- `src/worker/library-service.ts`：迁移 v24、扫描过滤、查询谓词、ignore API 和操作防护。
- `src/shared/asset-types.ts`、`src/shared/library-api.ts`：忽略条目模型和 API 合约。
- `src/shared/protocol/requests.ts`、`responses.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/worker/index.ts`：IPC 请求/响应链路。
- `src/renderer/AssetContextMenu.tsx`：文件/文件夹/批量忽略入口。
- `src/renderer/AppSettingsDialog.tsx`、`AppSettingsPages.tsx`、`IgnoredPathsDialog.tsx`：恢复显示入口。

## 验证

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npx vitest run tests/unit/main-menu-items.test.ts tests/unit/merge-asset-summaries.test.ts`：5 tests passed。
- Worker 集成测试未能执行：本机 `better-sqlite3` 原生模块为 `NODE_MODULE_VERSION 148`，当前 Node 要求 `137`，在数据库创建阶段统一报 `ERR_DLOPEN_FAILED`；不是本次代码断言失败。

## 验收边界

当前加入人类验收清单 `IGNORE-001`。Windows 与 macOS 的真实扫描/恢复旅程仍需基于对应平台的当前构建验证。
