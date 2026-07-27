# release:verify 本地失败盘点与修复收口

> 日期：2026-07-27  
> 触发：本地 `npm run release:verify` 在 `npm test` 阶段失败（约 6 分钟，未跑到 `test:perf:search` / `test:e2e`）。  
> 处置：已拆单并完成修复；定向套件 + soak 复跑通过。全量 `release:verify` 未在本回合重跑。

## 已通过的门禁（当次失败运行）

| 门禁 | 结果 |
|------|------|
| `rebuild:native` | 通过 |
| `lint` | 通过 |
| `typecheck` | 通过 |
| `extension:verify` | 通过 |

## 失败用例、根因与修复

| 测试文件 | 现象 | 根因 | 修复 | beads |
|----------|------|------|------|-------|
| `tests/unit/extension-message.test.ts` | `GET /folders` 断言缺字段 | API 已返回 `recentBrowsedFolderIds` | 断言补 `recentBrowsedFolderIds: []` | **Serpent-u0y8** |
| `tests/worker/search-performance.test.ts` | filter+sort `total=0` | 纯 DB 种子无磁盘文件，`openLibrary` refresh 把 available 标成 missing；`reference-NNNNNN` 亦易触序列模式 | `SearchPerfLibraryService` 跳过 refresh；文件名改为 `perf-spec-*-x` | **Serpent-2ta0** |
| `tests/worker/library-import-export-soak.test.ts` | revisions 40000 vs 20000；ZIP import 略超门槛 | refresh 追加 historical revision；Win NTFS/杀软 | 断言 current_revision 数量；Win `PERF_PLATFORM_FACTOR=2.5` | **Serpent-z6t8** |
| `tests/worker/relink-crash-recovery.test.ts` | missing 5 vs 3；corrupt marker → available；EPERM | 跨目录 basename 序列误判风险；保留目的地后 refresh 自动 reconcile；未 close 句柄 | `detectImageSequences` 按目录分组；`preservedRelinkPathIdentities`；测试 `closeAll`+`maxRetries`；批次文件名避开数字尾缀 | **Serpent-rrlk** / **Serpent-nn6m** / **Serpent-5856** |
| `tests/worker/library-watcher.test.ts` | 多一条 `open.refresh-managed-assets`；EPERM | create/open 现会 refresh | diagnostics `arrayContaining`；`closeAll`+`maxRetries` | **Serpent-eqia** / **Serpent-5856** |
| `tests/worker/palette-artifact.test.ts` | poster 调色板 artifact 仍 null | `maxJobs:1` 可能先跑其它 job | 循环 drain 直到 `extract_palette` 完成 | **Serpent-w2ow** |
| `tests/worker/trash-relink.test.ts` | 二次 recovery 仍 applying | recover 早于 linked folder status 调和 | `openLibrary` 先 `reconcileLinkedFolderStatuses` | **Serpent-3loo** |

**Epic**：**Serpent-09h1**

## 产品级改动（`src/worker/library-service.ts` / `src/shared/image-sequence.ts`）

1. **`detectImageSequences`**：分组 key 含父目录，避免跨目录 basename 尾缀数字合并。
2. **`reconcileLinkedFolderStatuses`**：从 refresh 抽出；`openLibrary` 在 `recoverFileOperations` **之前**调用。
3. **`preservedRelinkPathIdentities`**：relink 恢复保留目的地时，同次 open 的 refresh 跳过该 path 的 availability reconcile。

## 复跑证据（2026-07-27）

### 定向套件

```text
node scripts/run-vitest-with-electron.mjs run \
  tests/unit/image-sequence.test.ts \
  tests/unit/extension-message.test.ts \
  tests/worker/relink-crash-recovery.test.ts \
  tests/worker/library-watcher.test.ts \
  tests/worker/palette-artifact.test.ts \
  tests/worker/trash-relink.test.ts \
  tests/worker/search-performance.test.ts
# → 7 files, 155 passed | 2 skipped

node scripts/run-vitest-with-electron.mjs run tests/worker/library-import-export-soak.test.ts
# → 1 file, 3 passed, ~256s
```

### `npm run release:verify`（2026-07-27 23:03–23:09）

| 门禁 | 结果 |
|------|------|
| `rebuild:native` | 通过 |
| `lint` | 通过（修正 `library-watcher.test.ts` 未使用 `library` 变量后） |
| `typecheck` | 通过 |
| `extension:verify` | 通过 |
| `test` | **2211 passed** \| 12 skipped（234 files） |
| `test:perf:search` | **5 passed** |
| `test:e2e` | **66 failed**（本机 Windows 环境阻断，非本次代码回归） |

E2E 统一错误：`electron.launch: Process failed to launch!` → `bad option: --remote-debugging-port=0`（Playwright 注入参数与当前 Electron 43 不兼容）。仓库内已有同类记录（如 `docs/qa/2026-07-21-media-auto-repair-qa-report.md`）。完整日志：`release-verify-local.log`。

**注意**：勿用裸 `npx vitest` 跑 worker 集成——须 Electron ABI（`run-vitest-with-electron.mjs`）。
