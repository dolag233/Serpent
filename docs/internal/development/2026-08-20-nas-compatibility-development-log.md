# 2026-08-20 NAS / 网络共享资源库兼容方案（第一阶段）

> 关联工单：`Serpent-4f44f1`、`Serpent-6156e9`、`Serpent-f863df`
> 关联研究：[NAS 兼容性研究](../research/2026-08-20-nas-compatibility-research.md)
> 本地提交：`cd11c89c`；按产品要求不推送，等待 NAS 真机测试
> 代码审查：[双轴审查记录](../reviews/2026-08-20-nas-compatibility-code-review.md)；QA：[QA 报告](../qa/2026-08-20-nas-compatibility-qa-report.md)

## 目标与边界

本阶段解决已复现的阻断：在 macOS SMB 挂载的 NAS 上创建/打开资源库时，SQLite 无条件启用 WAL，因 `-wal` / `-shm` 共享内存与锁语义不兼容而报 `SQLITE_IOERR_IN_PAGE`。

本阶段落地“确认网络卷 → rollback journal”这一最小兼容闭环：

- 仅确认是本机磁盘或直连移动盘的卷继续使用 `WAL + synchronous=FULL`。
- 确认是 NAS/SMB/NFS/WebDAV 等网络卷，或无法确认卷类型时，使用 `DELETE rollback journal + synchronous=FULL`，避免未知挂载误启用 WAL。
- macOS/Linux 从 `mount` 挂载表识别网络文件系统；Windows 识别 UNC、扩展 UNC 和 `GetDriveTypeW = DRIVE_REMOTE` 的映射盘。
- 资源库打开结果携带 `networkStorage` 标记，桌面显示实验性风险提示。
- 网络卷仍不承诺与本地磁盘相同的锁、断线和刷盘安全性；多机并发写入、Watcher 单写者和强化备份不在本阶段宣称完成。

## 实现

| 需求 | 实现位置 | 说明 |
| --- | --- | --- |
| 网络卷识别 | `src/worker/network-storage.ts` | 保守识别；只有确认本地卷时保留 WAL，未知卷按 rollback 处理。 |
| SQLite journal 选择 | `src/worker/library-service.ts` `openConfiguredDatabase` | 本地卷 `WAL`，网络/未知卷 `DELETE`；两者均 `synchronous=FULL`、外键开启、busy timeout 保持不变。 |
| 网络卷打开状态 | `src/shared/protocol/responses.ts`、`src/main/index.ts` | `networkStorage` 只返回布尔标记，不穿透绝对路径以外的新增敏感信息。 |
| 风险提示与错误文案 | `src/renderer/App.tsx`、中英文 catalog、`src/shared/protocol/errors.ts` | 不再把 NAS 表述为一律禁止；提示实验性和单写者边界，确认网络卷的打开 I/O 失败与无存储上下文的通用 I/O 失败分别给出连接/权限/本地复制或诊断建议。 |

## 测试证据

已执行：

```text
npx vitest run --config vitest.config.ts tests/unit/network-storage.test.ts
# 1 file, 5 tests passed

node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/security-durability.test.ts
# 1 file, 9 tests passed
```

新增覆盖：macOS `smbfs` 挂载、带空格挂载点、最长挂载点匹配、Linux `type nfs4` 挂载、Windows UNC/扩展 UNC、Windows 映射盘、网络/未知卷 SQLite `DELETE` journal；通用 `SQLITE_IOERR` 不再武断标为 NAS。

`npm run typecheck` 当前仍被仓库既有的 `tests/unit/ticket-script.test.ts` 对 `scripts/ticket.mjs` 的缺失导出声明阻断（`issuesPath`、`readIssues`、`TicketError`、`writeIssues`）；本次新增源码未产生该错误。全文件 ESLint 仍有 `library-service.ts` 既有未使用变量和 `App.tsx` 既有 Hook warning；新增 `network-storage.ts` 与其单测已通过 ESLint。

补充回归：

```text
npm run test:library-availability
# 9 files, 189 tests passed

npx vitest run --config vitest.config.ts tests/unit/network-storage.test.ts tests/unit/protocol.test.ts
# 2 files, 100 tests passed

node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/public-error.test.ts tests/worker/security-durability.test.ts
# 2 files, 21 tests passed

npm run test:worker
# 77 files passed, 1162 tests passed, 11 skipped, 2 existing media/ffmpeg failures
```

Worker 全量的两个失败均在既有视频能力环境：`thumbnails.test.ts` 的 animated GIF webm proxy 断言返回 thumbnail，以及 `video-exr.test.ts` 的硬件编码器一帧探测未生成 ready mp4；没有落在本次 NAS 检测、SQLite journal 或库打开路径。

## 待产品/平台验证

1. macOS：在真实 SMB/NAS 挂载上创建库、打开库、导入/编辑后完全退出并重新打开；确认 `.serpent/library.db` 使用 rollback journal，且应用显示网络存储提示。
2. Windows：验证 UNC 与映射盘创建/打开/重启恢复；当前环境没有 Windows runner，不能写成已验证。
3. 断线、服务端锁配置、两台电脑同时写入：保持“未验证/不支持承诺”状态，后续拆分为写者租赁、Watcher 所有权、断线状态机与备份策略工单。
