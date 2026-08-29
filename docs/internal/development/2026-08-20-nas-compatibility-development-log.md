# 2026-08-20 NAS / 网络共享资源库兼容方案（第一阶段）

> 关联工单：`Serpent-4f44f1`、`Serpent-6156e9`、`Serpent-f863df`、`Serpent-6c5c65`
> 关联研究：[NAS 兼容性研究](../research/2026-08-20-nas-compatibility-research.md)
> 第一阶段代码已随 `dev` 推送；本次跨实例自动刷新增量尚未提交，等待 NAS A/B 真机测试
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

当次 NAS 初始验证记录时，`npm run typecheck` 曾被 `tests/unit/ticket-script.test.ts` 对 `scripts/ticket.mjs` 的缺失导出声明阻断（`issuesPath`、`readIssues`、`TicketError`、`writeIssues`）；本次收口已在 `forge.env.d.ts` 补齐精确的 `*ticket.mjs` 类型契约并恢复通过。全文件 ESLint 仍有 `library-service.ts` 既有未使用变量和 `App.tsx` 既有 Hook warning；新增 `network-storage.ts` 与其单测已通过 ESLint。

## 真实 SMB 复验与 banner 文案修正

用户在隔离 NAS 测试库上复现了网络存储 banner 显示翻译键的问题。Computer Use 实际打开该资源库后确认：资源库可打开并读取 3 个资产，但 Renderer 显示 `library.networkStorageBanner`。

根因为调用路径写成了 `library.networkStorageBanner`，而中英文 catalog 都将该文案定义在 `shell.networkStorageBanner`。已修正 `src/renderer/App.tsx`，并在 `tests/unit/i18n-translate.test.ts` 增加中英文断言。修复后通过资源库选择器重新打开同一路径，实际显示中文网络共享提示；未将本次对用户已有库的读取测试记录为完整 NAS 写入/重启验收。

定向回归命令：

```text
npx vitest run --config vitest.config.ts tests/unit/i18n-translate.test.ts
# 1 file, 6 tests passed
```

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

## 跨实例自动刷新增量（`Serpent-6c5c65`）

### 根因

Worker 原本已经通过 `library_change_sequence` 每 250ms 轮询共享数据库，因此 A 电脑提交后，B 的 Main 实际可以收到 `library.changed`。但 Renderer 对该事件只刷新操作历史；A 电脑产生的 `asset.changed` 事件不会跨进程发送到 B，导致 B 的画布、资产计数和侧栏仍停留在旧快照。

### 实现

| 需求 | 实现位置 | 说明 |
| --- | --- | --- |
| NAS 变更自动刷新当前内容 | `src/renderer/App.tsx`、`src/renderer/library-change-refresh.ts` | `networkStorage=true` 的 `library.changed` 触发静默 `reloadCurrentContent`，刷新当前范围、计数和侧栏；不伪造本地 `asset.changed`。 |
| 连续变更合并 | `src/renderer/App.tsx` | 复用 120ms 防抖/进行中合并，并对跨实例 NAS 刷新增加约 750ms 尾随限流，避免缩略图/job 写入造成刷新风暴。 |
| 重启/恢复后保留 NAS 判定 | `src/main/index.ts` | `library.list` 的 Renderer 映射补回 `networkStorage` 字段。 |
| 本地库性能边界 | `src/renderer/App.tsx` | 本地库仍不因单纯的 `library.changed` 做全量搜索；原有本地导入刷新路径保持不变。 |

### 自动化证据

```text
npx vitest run --config vitest.config.ts tests/unit/library-change-refresh.test.ts
# 1 file, 3 tests passed

npx eslint src/main/index.ts src/renderer/App.tsx src/renderer/library-change-refresh.ts tests/unit/library-change-refresh.test.ts
# 0 errors；保留既有 App.tsx Hook warning

git diff --check
# 通过
```

`tests/worker/library-write-coordinator.test.ts` 已有“独立 SQLite 连接观察 change sequence”覆盖；第一次误用系统 Node 执行该 Worker 文件时触发 `better-sqlite3` Electron ABI 148 / Node ABI 137 不匹配，随后按仓库规定改用 Electron runtime 重跑并通过（1 file / 6 tests）。全量 unit 的 FFmpeg、路径和 UI pattern 失败仍为仓库既有问题，均不是本次 Renderer 改动引入。

### 尚未验证

需要在隔离 NAS 测试库或专用临时 NAS 资源库上启动 A/B 两个独立 Serpent 实例，实测新增、删除、评分/标签等元数据变化是否自动收敛；还需验证断线重连、连续导入和完整退出恢复。当前代码和自动化测试不能替代该人工验收。
