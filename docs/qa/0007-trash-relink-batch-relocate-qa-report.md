# 切片 0007 QA 报告

> 状态：fixing；主用户流自动化通过，崩溃恢复覆盖缺失，人工平台 QA 待执行
> 日期：2026-07-13（基线）/ 2026-07-14（补充）

## Build under test

- 固定提交范围：`8dc2470...cdc2247`（基线）
- stateful relink-preview 实现提交：`7bc78f47e2522f7a2dd60ba35a2c2a62d14bd21a`
- 当前合流复核基线：`2f7bd0903f3b80257d3c4d90e4125c6068a73810`；不再以未提交 working tree 作为证据

## 2026-07-14 relink-preview 自动化结果

| 门禁 | 结果 |
| --- | --- |
| Typecheck | 通过 |
| Lint | 通过 |
| Unit + Worker | 869 passed + 1 skipped（50→53 文件；含 `relink-preview-store.test.ts`、`asset-types-paths.test.ts`、`protocol.test.ts` 新增 schema 校验、`trash-relink.test.ts` +221 行） |
| Electron E2E | 23/23 passed（13 文件；含 `trash-relink-flow.test.ts` "cancels a batch relink preview and later applies a fresh preview"、`organization-metadata-persistence`、`browsing-preferences`、`library-lifecycle` #11 recent-library 缺省回退起始页） |

### 规格覆盖确认

- `keepMetadata=false` 清空行为：`tests/worker/trash-relink.test.ts:1731` 覆盖——清空人工与 AI 元数据、标签、合集关系，保留 `asset_id` 与 revision 链。
- 无绝对路径泄漏：`tests/unit/protocol.test.ts` 新增 Zod schema 校验——workerCommand/workerSuccessResult/rendererRequest/rendererSuccessResult 均拒绝 Renderer 响应中含绝对路径；`portableRelativePathSchema` 拒绝绝对/UNC 路径（`tests/unit/asset-types-paths.test.ts`）。
- 崩溃恢复：**未覆盖**。`recoverOrphanRelinkPlacement` 代码存在，但 `crash-relink-*` failpoint 未接入执行路径，测试没有制造中断并完整重启资源库。按验收纪律#2(代码存在≠覆盖),崩溃恢复 = 未验证。
- 候选去重：`realpath` 归一化 + linked-root 冲突校验覆盖。
- `FILE_BUSY` 错误原因：稳定 Enum 返回 Renderer 已覆盖。
- 多选永久删除对话框：公共 UI E2E 覆盖。

## 2026-07-13 自动化结果

| 门禁 | 结果 |
| --- | --- |
| 公共 UI E2E `organization-search-trash` | 1/1 通过 |
| Unit | 144/144 通过 |
| Worker | 430/430 通过（另 1 项真实系统回收站测试默认跳过） |
| 全量 Electron E2E | 10/10 通过 |
| Package/verify/packaged smoke | 通过（packaged 1/1） |
| Lint | 通过 |
| Typecheck | 通过 |

公共 UI E2E 在真实 Electron 窗口中删除托管资产、进入回收站、恢复至原位置，并确认资产重新
出现在所有资产视图；链接文件夹 E2E 还将临时源文件实际移入系统回收站并确认记录消失。
测试未直连数据库。

持久恢复 Worker 测试覆盖 SQLite 删除事务失败后重启自动对账、链接根离线时保留记录、重复
ID 拒绝、移动后抛错、离线根可重试和部分失败。macOS 通过环境门禁实际执行 native
system-trash helper（49/49）。

重新定位回归覆盖 managed 单项/批量选择外部候选后复制回原托管路径、原目录重建、外部源保留、
刷新、关闭重开、`resolveAssetPath` 实际字节和新 revision；linked 单项更新相对路径身份。

## 平台与未完成项

- macOS：自动化全绿（unit/WORKer/E2E）；真实 helper 与 Electron 公共 UI 验证通过。Computer Use 人工 QA（回收站操作、批量重新定位完整流程、冲突恢复交互、永久删除确认对话框）待执行。
- Windows：无 runner，未验证，尤其不能推断 long path、占用文件和系统回收站行为已通过。
- 打包后 macOS `.app` 冒烟（回收站与批量重新定位）待执行。

## 结论

preview/apply、取消、`keepMetadata=false`、路径隐私、候选去重、FILE_BUSY 和多选永久删除对话框具备自动化证据；重新定位崩溃恢复没有证据，原”规格覆盖完整/0 HARD”结论撤回——按验收纪律#2(代码存在≠覆盖),failpoint 存在但未触发+重启+对账 = 未验证。切片保持 fixing，另待 macOS Computer Use、打包后冒烟与 Windows 平台验证。
