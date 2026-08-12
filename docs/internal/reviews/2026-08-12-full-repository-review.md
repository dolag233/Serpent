# 全仓库全量测试与专项审查报告

> 日期：2026-08-12
> 审查基线：`6876b380fe1a104986fe4d614be10942bc5af523`
> 当前代码：`4707caf54f14cca408ca14440bb3c9898debe339` + 未提交工作树
> 环境：macOS arm64；Windows runner 不可用

## 结论

当前代码不能标记为全量通过，也不能把统一撤回/重做、MCP 或 Windows 功能标记为 accepted。

单元、Worker、类型、lint、扩展校验和 macOS packaged 启动的基础路径通过；但主线 Electron E2E 仍有稳定失败，且独立审查一致发现：History Group/批量原子性、崩溃恢复、文件系统与 History receipt 的一致性、MCP 新版无状态契约、以及 Windows 路径/句柄语义尚未收口。

## 测试证据

| 档位 | 命令 | 结果 |
| --- | --- | --- |
| 主线门禁 | `npm run verify:mainline` | lint、typecheck、extension verify、Vitest、search performance 通过；Electron E2E **62 passed / 12 failed / 3 skipped**，命令以 1 退出 |
| 当前构建打包 | `npm run package` | 通过；基于当前工作树重新生成 macOS arm64 `.app` |
| 包产物校验 | `npm run verify:package` | 通过；ASAR、media bundle、Script/Plugin Host runtime 校验通过 |
| packaged 启动 | `SERPENT_E2E_PACKAGED_EXECUTABLE=/Users/dolag/Development/Serpent/out/Serpent-darwin-arm64/Serpent.app/Contents/MacOS/Serpent npm run test:e2e:packaged` | **2 passed / 1 skipped**；跳过项是 Windows close 行为 |
| 稳定性复现 | `npx playwright test tests/e2e/asset-pagination.test.ts -g "ordinary browsing continuously appends every asset"` | **1 failed**；`asset-000.txt` 精确文本出现 2 个 |
| 稳定性复现 | 失败 E2E 的 11 个目标用例单独 grep 重跑 | **11 failed / 1 passed**；偏好、右键菜单、重启焦点、视频诊断、组织流程、插件 Host 均再次失败 |
| Native 恢复 | `npx @electron/rebuild -f -w better-sqlite3` | 通过；用于 packaged 后恢复开发测试 ABI |

失败 trace/error-context 保存在 `test-results/`，没有用重跑一次通过来掩盖失败。

## 独立审查覆盖

- Standards/全仓库回归：确认撤回权限过低、文件 mutation 与 history 非原子、Main journal 投影静默失败、Windows 未验证等问题。
- Undo/Redo Spec：确认 Worker 仍是单 entry/step，脚本和桌面复合操作没有 Worker-owned group，attempt 失败/重启只标 stale。
- Worker/SQLite/可靠性：确认 file_operations 未绑定 history step、写租约/sequence 并发窗口、folder trash/restore 的文件系统与 SQLite 多阶段窗口、recipe 缺少内容/路径身份。
- Windows/跨平台：确认扩展 UNC 路径丢根、Windows `EPERM` 错误语义、链接文件夹目录失败静默、长路径与占用句柄缺少实机证据。
- MCP/脚本/插件：确认断线取消执行、内存幂等、Auto/full-access 契约漂移、danger challenge 的精确 plan 绑定缺失、插件回退 Desktop 当前库且绕过统一 Gateway。

## P1 确认问题

1. 一次脚本 execution、桌面多文件夹/混合 Trash 仍产生多个 HistoryEntry；一次 Undo 不能恢复完整用户意图。
2. History transition 多 step 失败或 Worker 重启后只标 stale，无 compensation/continue，对磁盘、SQLite、file journal 无对账闭环。
3. 文件变更发生在 History receipt 写入之前；容量/SQLite/投影失败可能造成“文件已改变但不可撤回”。
4. `history.undo/redo` 权限声明只需要 `library.read`，可能让只读自动化上下文执行写入型逆操作。
5. MCP transport 断开会结束 session 并取消未完成执行，没有独立 durable Job 查询/取消；幂等结果仅在进程内 Map。
6. MCP 仍暴露旧的 `read-only/read-write/full-access` 模式和 Desktop prompt，未完全符合新版 `auto/full-access + dangerous challenge`。
7. MCP 插件工具缺少显式 `libraryId`，可能回退 Desktop 当前库，并绕过统一 Gateway 的权限、幂等、History 与错误投影。
8. Windows 扩展 UNC 路径规范化会丢失 UNC 根。
9. 主线 E2E 稳定命中资产作用域/刷新后卡片丢失，导致浏览偏好、右键菜单、组织回收站流程失败；已独立复现并建单。

## P2/P3 确认问题

- Windows 文件占用的 `EPERM` 被映射为 `PERMISSION_DENIED`，应区分 `FILE_BUSY`/可重试。
- 链接文件夹送入系统回收站时目录级失败被空 catch 吞掉，造成静默部分成功。
- legacy `asset.copy` 仍声明可撤回，但旧脚本恢复器不支持该类型。
- MCP challenge 的 `planHash`/`idempotencyKey` 绑定不完整；`ui.notify` 的 severity/mode、脚本 Guest API 类型/手册与运行时漂移。
- `libraryChangeSequence` 不是每个 scoped response 必返，`context-changed` 投影不完整。
- plugin 输出尚未证明路径/credential 脱敏；critical confirmation 样式仍有硬编码 token。

## 工单落地

新增：

- `Serpent-8b5b.9`：Windows 扩展 UNC 路径丢根（P1）
- `Serpent-5n4z.12`：撤回/重做权限声明过低（P1）
- `Serpent-d112.1`：资产作用域刷新后卡片丢失的核心 E2E 回归（P1）
- `Serpent-5n4z.9.1`：链接文件夹目录回收站失败静默（P2）
- `Serpent-5n4z.9.2`：Windows `EPERM`/`FILE_BUSY` 语义（P2）
- `Serpent-5n4z.8.1`：legacy `asset.copy` 撤回兼容（P2）

已有 `Serpent-5n4z.1/.8/.9`、`Serpent-bjm4`、`Serpent-8b5b`、`Serpent-rtg8`、`Serpent-upsn.9`、`Serpent-y51c.10`、`Serpent-q6le`、`Serpent-tssh`、`Serpent-d112` 已追加本次证据；未关闭任何仍未满足验收条件的工单。

## 未验证项

Windows runner/packaged 安装卸载、NTFS 句柄/大小写/保留名/长路径/UNC/跨卷/回收站、Windows 菜单快捷键、MCP Windows ACL 与多连接、真实 Computer Use 视觉验收、Worker kill/restart 后磁盘与 DB 对账均未执行。根据验收纪律，这些只能记为未验证，不能由 macOS 结果外推。

本轮只读审查没有修改业务源码；工作树中此前已有的用户/其他 agent 改动均保留。
