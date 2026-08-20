# 2026-08-20 NAS / 网络共享兼容性 QA 报告

> 状态：条件通过，等待真实 NAS/Windows/packaged 与产品人工验收
> 工单：`Serpent-4f44f1`
> 审查基点：`e12e40e87b91da8ced451c0362ff642768ce4929`
> 当前代码：NAS 实现本地提交 `cd11c89c`；按用户要求不推送

## 范围与结论

本阶段验证网络卷识别、SQLite journal 选择、错误分类、网络存储提示，以及资源库核心可用性回归。实现目标是：确认本地卷使用 `WAL + synchronous=FULL`；确认网络卷使用 `DELETE rollback journal + synchronous=FULL`；未知卷也不启用 WAL；多机并发、断线状态机和 watcher 单写者仍不在本阶段宣称完成。

结论：自动化和 Worker 构建证据通过；真实 NAS 写入/完整退出恢复、Windows、packaged 和断线矩阵尚未执行，因此不能标记为 accepted。

## 四列可追溯矩阵

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| macOS/Linux/Windows 网络卷识别 | `src/worker/network-storage.ts:63-190` | `tests/unit/network-storage.test.ts:10-71`；5/5 通过 | macOS 当前挂载 `/Volumes/Working` 的只读检测返回 `network`；Windows 和真实 Linux/NFS 未在目标平台执行 |
| 本地卷 WAL、网络/未知卷 rollback journal | `src/worker/library-service.ts:4088-4161` | `tests/worker/security-durability.test.ts:108-132`；9/9 Worker 测试通过 | 本地临时库自动化通过；真实 SMB 上 `.serpent/library.db` journal 尚未由人工确认 |
| NAS 打开 I/O 与通用磁盘 I/O 分开分类 | `src/worker/library-service.ts:4156-4160`、`src/shared/protocol/errors.ts:248-275` | `tests/unit/protocol.test.ts:2080-2089`、`tests/worker/public-error.test.ts:106-115`；相关 100/21 测试通过 | 真实 NAS 失败复现和日志对照待产品测试 |
| 打开结果显示实验性网络存储提示 | `src/shared/protocol/responses.ts:101-128`、`src/main/index.ts:1745-1785`、`src/renderer/App.tsx:9057-9061` | 协议覆盖包含在 `tests/unit/protocol.test.ts` 100/100 中；`tests/unit/i18n-translate.test.ts` 6/6 通过 | Computer Use 在 `/Volumes/smb/nas资源库` 复现并修复 banner 字面量键；修复后重新打开显示中文文案，读取 3 个资产；完整写入/退出恢复仍待 `LIB-NAS-001` |

## 自动化证据

| 命令 | 结果 |
| --- | --- |
| `npx vitest run --config vitest.config.ts tests/unit/network-storage.test.ts tests/unit/protocol.test.ts` | 2 files，100 passed |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/public-error.test.ts tests/worker/security-durability.test.ts` | 2 files，21 passed |
| `npm run test:library-availability` | 9 files，189 passed |
| `npm run test:worker` | 77 files passed，1162 passed，11 skipped；2 个既有媒体/ffmpeg 失败 |
| `npx vite build --config vite.worker.config.ts` | 347 modules transformed，`dist/library_worker.js` 构建成功；构建后 `dist/` 已清理 |
| `git diff --check` | 通过 |

Worker 全量的两个失败仍为环境相关的既有媒体能力问题：`tests/worker/thumbnails.test.ts` animated GIF webm proxy 返回 `thumbnail` 而非 `webm_proxy`；`tests/worker/video-exr.test.ts` 硬件编码器一帧 probe 未生成 ready mp4。失败不在本次网络卷、journal 或错误分类路径。

`npm run typecheck` 仍被既有 `tests/unit/ticket-script.test.ts` 缺失 `scripts/ticket.mjs` 类型导出阻断：`issuesPath`、`readIssues`、`TicketError`、`writeIssues`。全文件 ESLint 仍有 `library-service.ts` 既有未使用变量和 `App.tsx` 既有 Hook warning；新增网络检测模块及单测的 ESLint 已通过。

## 2026-08-20 真实 SMB 开发态复验

使用 Computer Use 操作本地 Electron 开发态，打开用户指定的 `/Volumes/smb/nas资源库`：

1. 修复前实际显示字面量 `library.networkStorageBanner`，与用户截图一致；资源库成功打开并读到 3 个资产。
2. 根因为 Renderer 调用了 `library.networkStorageBanner`，而中英文 catalog 的实际路径是 `shell.networkStorageBanner`。
3. 修复 `src/renderer/App.tsx` 调用并新增中英文 catalog 路径断言；重新通过资源库选择器打开同一路径后，banner 显示“该资源库位于网络共享（NAS/SMB）上……”而不是 key。

本次只验证了已存在资源库的打开、读取和提示显示，没有把用户库作为临时数据执行导入、元数据写入或删除；因此不替代 `LIB-NAS-001` 的完整退出恢复验收。

## 平台与人工验收

- macOS arm64：当前开发态只完成挂载表识别的只读检查；真实 SMB/NAS 创建、导入、写入、完整退出恢复和断线未执行。
- Windows：无 runner；UNC、映射盘 native API、创建/打开/重启恢复和打包行为均未验证。
- packaged：未执行；Electron 包不能直接从 SMB 工作区运行，需复制到本地 APFS 后再测。
- 多机同时打开/写入、服务端锁配置、挂载断线与恢复：未实现/未验证，不作为本阶段通过条件。

产品人工步骤见 [`LIB-NAS-001`](human-acceptance-checklist.md)：使用专用临时库，验证提示、写入、完全退出后重新打开，完成后删除临时数据；不要手动删除 SQLite sidecar 文件。

## 最终 QA 结论

条件通过。代码审查双轴无 P0/P1 阻断，自动化资源库门禁通过；待产品完成真实 macOS NAS 验收，并由 Windows/packaged QA 补齐平台证据后，才能进入 accepted。
