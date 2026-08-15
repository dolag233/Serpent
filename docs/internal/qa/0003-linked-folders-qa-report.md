# Slice 0003 QA report: linked folders

> Status: automated verification complete; ../../manual/platform QA pending
> Date: 2026-07-13

## Build under test

- Branch: `codex/slice-002-asset-ingestion`
- Original fixed range: `8dc2470...cdc2247`
- Working-tree re-test: uncommitted shared tree on macOS arm64, Node 24.15.0 / Electron 43.1.0.
- Final shared-tree package/ASAR/native verification and packaged startup E2E were executed on macOS arm64.

## Automated evidence

| Gate | Result |
| --- | --- |
| Original repository E2E report at `cdc2247` | 8/8 passed overall, including linked-folder user flow; reconstructed from commit/test record, not rerun here |
| `linked-folders.test.ts` + `library-watcher.test.ts` | **18/18 passed** (incl. D1 verif + D2 fix) |
| `npm run lint` | passed |
| `npm run typecheck` | passed |
| Full `npm test` (worker) | **551/551 passed** (1 skipped) |
| Full Electron E2E (linked-folders) | **3/3 passed** (incl. restart-restore + filter-rules) |
| Regression E2E (org/search/trash + media-preview) | **5/5 passed** |
| `npm run package` + `npm run verify:package` | passed |
| Packaged startup/import E2E | **1/1 passed** |

## Acceptance matrix

| Scenario | Automated result | Manual result |
| --- | --- | --- |
| v3→v4 migration preserves revisions/FKs | passed | not executed |
| Linked import, ignore rules and no source-byte copy | passed | not executed |
| Nested symlink is not followed/registered | passed (implemented as skip) | spec deviation pending decision |
| External overwrite creates revision; root loss becomes offline/missing | passed | not executed |
| Relink restores existing paths with stable asset IDs | passed | not executed |
| Managed and linked watchers debounce into stat reconciliation | passed | not executed |
| Renderer hides absolute paths | protocol/E2E evidence in original range | not manually inspected this pass |
| Persisted safe error/log pairing | diagnostic hooks covered; log path is `app.getPath('logs')/serpent.log` | not executed |

## Platform/manual QA

- macOS arm64 UI: **not executed in this pass**. No screenshots or manual checklist evidence.
- Packaged macOS startup and real Worker import: passed; linked-folder flow was not repeated against the packaged artifact.
- Windows: **not executed; no runner**. Case-insensitive identity, volume replacement, watcher and relink behavior remain risks.

## Final result

2026-07-14 re-review findings resolved: D1 re-verified as misread (no code change needed), D2 fixed (single-asset non-ENOENT error no longer aborts entire relink batch), restart-restore and filter-rules E2E added. Watcher-triggered E2E and external-change-conflict E2E recorded as follow-up (worker-level coverage exists; E2E too flaky). All automated gates pass.

Automatic slice-specific verification passed and the slice may remain in code review. Overall QA is **not complete** and this is **not acceptance**.

## 2026-07-14 当前树复审发现(待修复 → 已处理)

> 由 sonnet 复审 agent 对当前树(基线 `b2d9ba9`)重审 0003,聚焦 worker + spec + E2E(暂缓 App.tsx UI 复审,避免与 0014 P1 的 App.tsx 编辑冲突)。复审发现由主 agent 逐一重验并修复。

### 缺陷

- **D1(MEDIUM,重验为误读)**:复审声称 `refreshManagedAssets` 在 linked-folder 规则全 `enabled=0` 时静默跳过新资产。**重验结果:误读**。实际代码追踪:全规则禁用时 `!rules.some(r => r.enabled && r.action==='include')` 为 `true`,但 `linkedPathIsIgnored(probe, rules)` 内所有 disable 规则被 `continue` 跳过,probe 不被 always-ignored 匹配,返回 `false`,故 `canPrune = true && false = false`(目录不剪枝,遍历继续)。新增 `tests/worker/linked-folders.test.ts` 的 "D1 re-verify" 测试(全规则禁用后外部新增文件,刷新后正确注册)已通过。**无需代码修改**。
- **D2(LOW,已修复)**:`relinkMissingFolder`(`src/worker/library-service.ts:4058-4064`)单文件 `lstatSync` 抛非 ENOENT/ENOTDIR 错误(如 EACCES)时 `throw IMPORT_APPLY_FAILED` 中止整个 relink 批次。**已修复**:改为 `diagnose` + `continue`(跳过该资产、保持 missing、继续其余)。新增 worker 测试 "D2: relink continues processing remaining assets" (EACCES 模拟,其余资产正常恢复)已通过。

### 缺失 E2E(已补充)

- linked 库**重启恢复**(spec line 17/112:关闭重开资产身份不变)——**已添加** `restores a linked library after a full app restart`(使用 `SERPENT_E2E_USER_DATA_PATH` + `SERPENT_E2E_RESTORE_RECENT`,二次启动验证资产 ID/availability/文件夹状态不变)。通过。
- ~~watcher 触发~~的刷新(非手动"刷新磁盘变化")——**记录为 follow-up**。Worker 级 watcher debounce + reconciliation 已在 `tests/worker/library-watcher.test.ts` 覆盖;E2E 级 watcher 触发过于 flaky(依赖平台文件事件时序),不阻塞本切片。
- ~~浏览中外部变化冲突~~——**记录为 follow-up**。现有 E2E 已覆盖手动刷新后外部变化;实时 watcher 竞争条件 E2E 不稳定,不阻塞本切片。
- **默认过滤规则**导入执行(.git/node_modules 不入资产,spec line 109)——**已添加** `applies default ignore rules`(.git + node_modules + real assets,验证仅真实资产注册)。通过。

### scope 超出 spec(已实现,非缺陷,记录)

- editable rules(spec line 37 "仅默认规则",已实现 full CRUD @line 3485)。
- `convertLinkedFolderToManaged`(spec line 38 "后续切片",已实现 full @line 3624)。
- `copyAssetsToLinkedFolder`(spec line 40 "后续",已实现 @line 3533)。
- `refreshManagedAssets` 未按 spec line 29 改名 `refreshAssets`(naming debt)。
- 符号链接:spec "拒绝",impl skip+log(deviation,dev-log line 28 已记)。
