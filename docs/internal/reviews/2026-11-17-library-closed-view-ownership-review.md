# 2026-11-17 资源库关闭事件视图所有权修复审查

## 结论

- **Standards：通过，附非阻断的异步错误处理缺口。** 关闭处理被抽到独立模块，复用现有 `LibraryViewSession` 与 `LibraryTransitionLock`；App 仅提供状态端口。代码按当前库 ID 和 view generation 核验收件、排队执行及预览关闭后的所有权。
- **Spec：列出的三类竞争已由当前实现覆盖；无已确认阻断。** 包括 A 关闭事件在 B 当前时被丢弃、排队期间 A→B→A 后旧事件失效、预览关闭等待时同 ID 新 generation 的事件失效。当前 generation 的 MCP 关闭仍绕过本地 pending fence 并能清理 UI。
- **限制：不能声称覆盖“旧事件直到同 ID 资源库重开后才被 Renderer 收到”的情况。** 当前关闭事件只含 `libraryId` 和可选 `source`，没有关闭操作 ID 或 generation；若这种交付顺序真实发生且 pending fence 已清除，收件时会把旧事件绑定到新 A generation。Main 源码在 close response 返回前发送生命周期事件，且 Renderer 用 FIFO transition lock 串行处理；本审查没有证据表明正常 IPC 会违反该顺序。因此这是协议/传输边界与自动化证据缺口，暂列非阻断，不把它表述为已发生回归。

## 范围与证据

- 源码：`src/renderer/library-closed-view-ownership.ts`、`src/renderer/library-view-session.ts`、`src/renderer/library-transition-lock.ts`；`src/renderer/App.tsx` 中该 helper 的导入、生命周期接线、pending close fence 和 `applyClosedLibraryUi`；`src/shared/protocol/responses.ts` 的关闭事件 schema；Main 中 `applyLibraryRendererLifecycle` 的调用与发布顺序。
- 新增测试：`tests/unit/library-closed-view-ownership.test.ts`。审查者针对当前工作区运行 `npx vitest run --config vitest.config.ts tests/unit/library-closed-view-ownership.test.ts`，6 项通过。主 agent 后续报告当前源码相关 8 文件 67 项通过（2.58s）、scoped lint 0 error；这些结果未由本审查者重跑。
- 主 agent 报告初次类型检查发现测试 mock 的 `Promise<undefined>` 与 `Promise<void>` 不匹配；当前测试夹具已将 `closePreview` mock 显式标为 `Promise<void>`。该行与两个 deferred mock override 的类型关系已复核；类型检查重跑结果在本审查记录时尚未提供，故不记为通过。
- 审查者未运行 Electron、E2E、全量测试、打包或平台验收；本审查未访问真实资源库。未检查工作区其他修改。

## Standards

### 通过项

- `library-closed-view-ownership.ts` 只通过显式端口访问 App 状态与副作用，没有再向巨型 `App.tsx` 内联队列/代际判断。
- `library-view-session.ts` 以 `(libraryId, generation)` 作为 view 身份；`App.tsx` 的 `applyClosedLibraryUi` 同步推进 generation、清理库级视图、清空 `libraryRef`/React library state 并清 Main active context，闭库路径保持一致。
- `library-transition-lock.ts` 的 FIFO 队列将异步关闭与库切换串行化；队列任务 reject 后仍释放 gate，不会永久阻塞后续任务。
- 本次修改没有新增持久 `opening` / `closing` 状态。正常当前关闭完成后 `libraryRef` 为 null，finally 设为 idle；generation 变更后的迟到任务不会应用旧 UI 清理。

### 非阻断缺口

1. **关闭清理失败可能留下 `closing`。** `setClosing` 在 try 之外；若当前 owner 的 `closePreview` reject，catch 会报告错误，但 finally 只在 `snapshot().libraryId === null` 时设 idle。此时 `applyClosedUi` 尚未运行，库 ID 仍非 null，故状态会停在 closing。App 的 `closeAssetPreview` 会吞掉其 API closePreview 错误并先执行本地 viewer teardown，当前常见异步错误路径不会触发这个分支；但其同步 teardown 仍可抛，且新增测试只覆盖“owner 已过期时 preview reject”，没有覆盖当前 owner 的 reject。建议补一个当前 owner 失败测试，并明确生命周期已确认 Worker 闭库时仍要清掉旧库视图还是恢复状态。
2. **fire-and-forget 队列的外围 reject 未兜底。** `void ports.queue(...)` 忽略了返回 Promise。task 主体虽有 catch，但 `setClosing` 位于 try 外，`reportFailure` 与 finally 的 `setIdle` 也可能抛出；这些情况下 `LibraryTransitionLock` 会释放后续 gate，但调用方仍可能收到未处理 rejection。App 当前的状态 setter 与关闭端口没有显示会抛出的正常路径，故列为稳健性缺口，而非已复现用户故障。
3. **关闭后刷新 recents 的异常会被 helper 的 owner guard 吞掉。** `applyClosedUi` 会将 generation 推进至 null，随后 `refreshRecentLibraries` 若 reject，catch 中 `isCurrent()` 必为 false，不调用 `reportFailure`。当前 App 的 `refreshRecentLibraries` 自己捕获 `listRecent` 异常并保持既有菜单内容，故此处没有未上报的当前应用错误；若未来该端口改为 reject，应决定 recents 失败是否需报告，并单独处理 teardown 后的错误归属。

## Spec 覆盖记录

| 需求/风险 | 当前实现 | 自动化证据 | 人工/平台证据 |
| --- | --- | --- | --- |
| B 当前时收到 close(A)，不得清掉 A 的后续重开 | 收件时要求 `libraryRef` 和 view session 都匹配事件库 ID；不匹配即丢弃 | `does not clear reopened A when close(A) arrives in B...` | 审查者未执行；主 agent 的真实旅程见开发记录 |
| close(A) 排队后经历 A→B→A，旧关闭不得影响新 A | 排队执行前比较捕获的库 ID 与 generation | `does not clear A when its close is queued before an A-to-B-to-A round trip` | 审查者未执行；主 agent 的真实旅程见开发记录 |
| 等待预览关闭期间 view generation 更新，旧 close 不得继续清理或报告旧错误 | preview await 后再次核对 owner；stale 错误不报告 | `does not clear a reopened generation...`、`does not report preview failure after...stale` | 审查者未执行；主 agent 的真实旅程见开发记录 |
| 当前 ordinary close 和当前 MCP close 正常清理 | owner 仍匹配时清理并刷新；MCP 来源绕过 pending generation 集合检查 | `applies a current close...`、`ignores a pending ordinary close...but applies current MCP close` | 审查者未执行；主 agent 的真实旅程见开发记录 |
| 同 ID 重开后才收到旧 lifecycle close | 事件 schema 没有 origin generation/close ID；owner 是收件时当前 snapshot | 现有六项测试未覆盖 Main→Renderer 延迟交付及 fence 清除后再收件 | 审查者未执行；主 agent 的真实旅程见开发记录；延迟交付边界未验证，需协议/传输顺序证据或带关联 ID 的事件契约 |

## 阻断项

无已确认阻断。建议保留上表最后一项为未验证边界，并在后续确认异步 teardown 的当前 owner 失败语义后补测试。

主 agent 后补执行证据：最终 `npm run typecheck` exit1，新增 mock 类型两错已消失，只剩其他 CLIP 开发轨道既有四项 Database 错误；不是全仓类型通过。该结果由主 agent 提供，审查者未独立运行类型门禁。最终候选重建两源普通旅程与清理结果见[开发记录](../development/2026-11-17-library-closed-view-ownership.md)，不改变上述 transport/异常路径边界。
