# 2026-08-29 链接文件夹移动、残留清除与错误诊断开发日志

## 范围

本次处理用户反馈中的 1–3：

- 链接文件夹内的源文件被移动后，自动识别为同一资产并更新路径；
- 源文件已被外部移动或删除时，可以清除残留的链接资产索引；
- 部分删除失败通知通过标准 hover 展示完整原因。

瀑布流顺序问题只登记为 P2 工单 `Serpent-14dcaf`，本次不实现。

## 红测与根因

基线提交为 `45a8c335`。新增的移动回归测试先在基线上运行，稳定失败：外部把
`moved.txt` 移入链接根内的子目录后，刷新结果为 2 条资产而不是 1 条，旧路径
记录与新路径记录同时存在。

根因分为三层：

1. 对账原先以链接根内的相对路径作为资产匹配键；路径改变后，旧行只能被标记
   为 missing，新路径会插入新 asset_id，因而丢失原资产关联的标签、合集和元数据。
2. 删除链接资产时先对源路径执行 `lstat`。源文件已经在 Serpent 外部被移动或
   删除时，`ENOENT` 被当成“移入系统回收站失败”，所以索引行被错误保留。
3. 部分删除 toast 的消息容器使用单行省略号，完整的结构化失败原因没有通过
   统一 hover 入口暴露。

## 实现

- 数据库 schema v48 为 `assets` 增加 `source_device`、`source_inode`，并建立
  非删除资产索引。链接文件枚举时保存文件系统身份，不需要为 25,000+ 文件做
  内容 hash。
- 对账前在同一 `linked_folder_id` 内按设备 + inode 进行唯一匹配。匹配成功时
  复用旧 `asset_id`，更新 `relative_file_path`、路径身份、源身份和可用状态；
  标签、合集、评分、描述等仍挂在同一资产行上。身份重复、缺失或跨链接根时
  不猜测，保留 missing + 新资产的保守行为。
- 打开对账和普通刷新共用移动收编逻辑；批量刷新通过 discovery 标记避免对
  每个 64 项批次重复扫描全量链接资产身份。
- 删除时，如果链接根确认在线且源路径明确为 `ENOENT`/`ENOTDIR`，只清除已不存在
  的索引记录；如果源文件仍存在但系统回收站拒绝操作，继续保留源文件和索引并
  返回结构化失败原因。成功提示同步改为准确描述“移除记录；仍存在的源文件已
  移入回收站”。
- `WorkspaceNoticeBanner` 的完整消息通过现有 `data-hover-tip` / `HoverTipHost`
  机制提供，亮色、暗色和中英文继续复用现有主题与提示系统。

## 四列可追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 链接根内移动后复用原资产并更新路径 | `src/worker/library-service.ts`：schema v48、`reconcileMovedLinkedAssets`、刷新对账分支 | `tests/worker/library-watcher.test.ts`：移动后仅 1 条资产、asset_id 不变、路径更新 | macOS Worker 自动化；真实 UI、Windows、packaged、NAS 未执行，列入待人类验收 |
| 已不存在的链接源可清除索引；真实删除失败不静默 | `src/worker/library-service.ts`：`deleteLinkedAssets` 缺失源分支 | `tests/worker/trash-relink.test.ts`：外部删除后刷新为 missing，再删除记录成功 | macOS Worker 自动化；系统回收站失败和 Windows 行为待人类验收 |
| 部分失败完整错误可 hover 查看 | `src/renderer/WorkspaceNoticeBanner.tsx`、`src/renderer/i18n/catalogs/{zh-CN,en}.ts` | `tests/unit/workspace-notice-banner.test.ts`：完整消息存在于标准 hover 属性 | 静态渲染证据；真实亮/暗主题视觉验收待人类执行 |

## 验证记录

| 检查 | 命令/结果 |
| --- | --- |
| 移动与残留清除定向 Worker 测试 | `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/library-watcher.test.ts tests/worker/trash-relink.test.ts`：2 files，100 tests passed，1 skipped |
| hover 定向单测 | `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/workspace-notice-banner.test.ts`：1 file，1 test passed |
| 资源库可用性门禁 | `npm run test:library-availability`：9 files，210 tests passed |
| 链接文件夹 Electron E2E | `node scripts/run-e2e.mjs tests/e2e/linked-folders.test.ts`：3 tests passed |
| 全量自动化测试 | `npm test`：499 files passed、15 skipped；4323 tests passed、25 skipped |
| 类型检查 | `npm run typecheck`：通过 |
| ESLint 与 diff 检查 | `npm run lint`：通过；`git diff --check`：通过 |

未执行的 Windows、packaged、NAS 与真实 UI 证据不能写成通过。
