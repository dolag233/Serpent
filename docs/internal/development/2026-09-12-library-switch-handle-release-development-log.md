# 2026-09-12 切库后旧资源库句柄释放：核实与回归固化

> 工单：`Serpent-95d532`（P1，Windows：切换资源库后旧 `library.db` 仍被占用）
> 新增回归：`tests/e2e/library-switch-handle-release.test.ts`（已进 `test:e2e` 与 `test:e2e:isolated` 清单）

## 1. 结论

**已不再复现。** 在本机 Windows 上，用真实 Electron 走标准切库路径（先建库 A，再用资源库切换菜单建库 B，触发 `runLibraryOpenPipeline` 关闭 A）后：

```
PROBE after A->B switch (A): {"dbExists":"true","dbRename":"ok (not locked)","dirDelete":"ok (not locked)"}
```

- A 的 `.serpent/library.db` 可以被**改名**（Windows 上文件被占用时 rename 会 EBUSY/EPERM）→ SQLite 句柄确已释放。
- A 的整个资源库**目录**可以被递归删除 → 连 watcher/目录句柄也没有残留。

## 2. 代码侧核对（为什么会好）

- `App.runLibraryOpenPipeline`（`src/renderer/App.tsx:4568-4640`）在打开新库之后对旧库显式调用 `libraryApi.close({ libraryId: previousLibraryId })`，并在成功后清理 close-pending 状态；最近资源库入口 `openRecentLibrary` 走的是**同一条 pipeline**。
- Worker `LibraryService.closeLibrary`（`src/worker/library-service.ts:46370` 起）按顺序：取消延迟维护/后台对账、清备份定时器、`cancelJobs` + `abortActiveMediaJobs`、`stopAssetWatcher` + `stopLinkedWatchers`、处理 pending imports，再 `connection.close()` 并清掉各类按库缓存 —— 句柄与 watch 都在这条路径上收掉。
- 票面提到的三条调查方向（Worker 是否 close、是否停 watch/媒体任务、Main 是否等 Worker 释放）在现实现里都有对应动作；票面 2026-08-20 之后又落了「关闭顺序」等资源库生命周期改动，本单症状随之消失。

## 3. 回归固化

临时探针（已删除）转成常驻 E2E `tests/e2e/library-switch-handle-release.test.ts`：建 A → 经切换菜单建 B → `renameSync(library.db)` 与 `rmSync(库目录)` 都必须成功，失败会带 `locked:<errno>` 断言失败。命令与结果：

```
node scripts/run-e2e.mjs tests/e2e/library-switch-handle-release.test.ts
→ 1 passed (13.2s)
```

## 4. 未验证边界

- 探针驱动的是「创建并切换」路径（与最近资源库入口共用 pipeline）；**没有**逐一点击最近列表项、起始页换库等其它入口。
- 没有在资源管理器里手动删除该目录（自动化用的是 Node `rmSync`，语义等价于独占删除，但不等于 Explorer 的删除交互）。
- 没有覆盖「切库时仍在跑缩略图/预览/同步」的满载场景（票面症状是静态切库）。
- macOS / packaged：未执行（Windows 开发态已按 §1 证据验证）。
- 若用户在真实环境仍能复现，请附当次操作顺序与资源库位置，我按 `Serpent-95d532` 重新打开继续查。
