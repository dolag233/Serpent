# GitHub #90：同步中保存与连接状态

状态：实现、定向测试与隐藏 Electron 旅程通过；待人类验收。

独立双轴审查：[Issue #90 审查记录](../reviews/2026-11-07-issue-90-sync-save-review.md)。

## 复现与原因

反馈录像显示：文件传输进度持续前进，设置页同时显示「保存中」和「连接失败」。源码时序可稳定构造出连接状态误报：`sync.run` 是 Worker 独占 mutation，`sync.probe` 在它结束前不能获准运行；旧 Main 从发出请求就启动 15 秒计时，排队中的探测会超时并重试，最终把尚未执行的网络探测当成连接失败。设置页打开时自动探测，使这一时序可达。

保存绑定本身由 Main 写入本地配置。旧实现还在返回保存结果前同步调用自动同步调度入口；自动同步在手动同步期间进入 Worker 队列，等手动同步结束后可能再跑一遍。录像中「保存中」持续的具体阻塞点仍缺少原实例日志；不能仅凭连接探测的超时解释它。

真实 WebDAV 复测又暴露同一条探测路径的错误推断：服务端对根集合的 `OPTIONS` 返回 200，`Allow` 不列 `PUT`，但在本轮随机独立目录下对子文件 `PUT` 返回 201，`GET` 返回 200 且内容一致。HTTP 方法声明只针对被查询的集合，不能据此否定新子文件上传。旧探测将其标为 `supportsContentTransfer=false`，使设置页拒绝同步；这是可稳定复现的兼容性问题。

## 改动

- 连接探测不再从进入 Worker 队列时启动 Main 的网络超时。Worker 获准执行后，WebDAV 只读探测有总计约 15 秒的网络预算；不再通过写入、移动和删除临时远端文件判断能力。根集合 `OPTIONS` 不列 PUT 不再阻止对子文件同步，实际写入失败由同步操作报告。配置凭据即使匿名读取成功仍验证带凭据请求；界面将探测结果称为「服务器可访问」。传输命令仍不设墙钟期限。[旧版同步设计](../superpowers/specs/2026-08-15-webdav-library-sync-design.md)的连接探测条款已同步修订。
- 保存绑定先完成本地写入并回复 IPC，再在下一轮事件循环触发自动同步。
- Main 记录手动同步的目标；同目标的保存不启动重复同步，若覆盖它的手动同步失败则补一次自动尝试。不同目标的重新绑定及手动同步期间的本地变更只保留一次后续自动同步。旧手动同步完成时不再覆盖传输期间新保存的绑定，并保留轮询间隔和卡片状态设置。
- 设置页在传输期间显示「同步中」，暂缓新连接探测；传输中已返回的旧探测结果不覆盖状态，传输结束后补探测。
- 增加隐藏 Electron 旅程：本机模拟 WebDAV 服务暂停一次传输，要求保存及读回绑定在传输结束前完成。
- 增加选择性真实端点旅程：只从已有配置读取匹配服务记录及加密密钥，使用隔离 userData、本地测试库和随机远端目录；经真实传输后校验保存、状态与远端目录清理。测试源码不包含本机地址、凭据或真实库数据。

## 验收追溯

| 需求 | 实现 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 同步期间不把 Worker 排队误报为连接失败，探测不留远端临时文件 | `src/main/worker-client.ts`、`src/worker/sync/webdav-driver.ts`、`src/renderer/LibrarySettingsDialog.tsx` | `tests/unit/worker-client.test.ts`、`tests/worker/webdav-driver.test.ts`、`tests/unit/library-settings-sync.test.tsx` | 原反馈录像有矛盾状态；隐藏 Electron 旅程未操作真实设置页，前台人眼验收未执行 |
| 保存立即确认，不等待自动同步传输；旧传输完成不覆盖新绑定 | `src/main/library-request/sync.ts`、`src/main/index.ts` | `tests/unit/main-sync-owned-request.test.ts`、`tests/e2e/sync-save-during-run.test.ts` | 当前源码隐藏 Electron 旅程 1 passed；模拟传输暂停期间保存并读回成功。原实例保存阻塞点未定位 |
| 手动同步期间合并自动同步触发 | `src/main/index.ts`、`src/main/sync-auto-scheduler.ts` | `tests/unit/sync-auto-scheduler.test.ts`、`tests/e2e/sync-save-during-run.test.ts` | 隐藏 Electron 旅程确认手动同步后同目标 manifest 只写入一次；前台人眼验收未执行 |
| 根集合 OPTIONS 未声明 PUT 时仍可同步子文件 | `src/worker/sync/webdav-driver.ts` | `tests/worker/webdav-driver.test.ts`、`tests/e2e/sync-real-webdav-manual.test.ts` | 真实端点 OPTIONS 200 且 Allow 无 PUT；独立子文件 PUT 201、GET 200；修复后隐藏 Electron 实际同步上传 2 项，远端测试目录清理后 PROPFIND 404 |

## 当次验证

- `npx vitest run tests/unit/main-sync-owned-request.test.ts tests/unit/library-settings-sync.test.tsx tests/unit/sync-auto-scheduler.test.ts tests/unit/worker-client.test.ts tests/worker/webdav-driver.test.ts tests/worker/sync-engine.test.ts`：首轮修复 6 files / 74 passed；真实端点发现后的定向 `npx vitest run tests/worker/webdav-driver.test.ts` 为 1 file / 11 passed。
- `npm run typecheck`：通过。
- 对上述改动源码及测试执行定向 `npx eslint`：0 errors。
- `node scripts/run-e2e.mjs tests/e2e/sync-save-during-run.test.ts`：用户退出开发实例后，当前源码重新构建，隐藏 Electron 旅程 1 passed（4.8 秒）。此前保护门禁曾拒绝覆盖运行实例使用的 `.vite`，没有结束用户实例。
- `node scripts/run-e2e.mjs tests/e2e/sync-real-webdav-manual.test.ts`（通过环境变量选择已保存服务，未把地址/凭据写入源码）：首次实测因根集合 OPTIONS 不含 PUT 被误判；修复并重新构建当前源码后 1 passed（13.9 秒）。64 MiB 测试文件上传中，设置页保存耗时 132 ms、保存时手动同步未结束、无「连接失败」；本轮同步报告上传 2 项，结束后显示「服务器可访问」。随机远端目录 DELETE 后 PROPFIND 404；本地临时目录数为 0。
- `npx vitest run tests/worker/sync-library-integration.test.ts tests/worker/sync-engine.test.ts tests/unit/main-sync-owned-request.test.ts`：其中 2 files / 21 passed，`sync-library-integration` 的 16 项因本机 `better-sqlite3` 为 Electron ABI、当前 Node 需要另一 ABI 而未运行到断言。随后用本机 Electron 的 Node 运行时（`ELECTRON_RUN_AS_NODE=1`）执行 `sync-library-integration.test.ts`：1 file / 16 passed；同法执行 `sync-two-device.test.ts` 与 `sync-open-remote.test.ts`：2 files / 5 passed。没有重编译依赖、结束开发实例或覆盖 `.vite`。

## 待验证

合成与真实端点隐藏 Electron 旅程已复核保存响应、绑定读回、同步中状态和传输完成后的连接状态；合成旅程还确认同目标只同步一次。原反馈的 15 秒录像不能定位旧版 Main 保存响应是否实际发出；新代码在真实服务 64 MiB 传输期间已确认及时返回。用户现有资源库内容、Windows 发布包及 macOS 未验证。前台 Computer Use 未执行，仍待用户在可见设置页人眼验收。
