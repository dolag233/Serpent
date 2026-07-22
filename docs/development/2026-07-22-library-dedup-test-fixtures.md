# 库级去重对自动化夹具的影响（2026-07-22）

> 工单：`Serpent-2crl` / `Serpent-liyu`（IMPORT-006 / `Serpent-55fy` 落地后）

## 现象

资源库级内容去重（byteSize → SHA-256）后，`prepareOrExecuteImport` 在「不同文件名、相同字节」时会返回 **冲突计划**（`importId`），而不再直接完成导入。

产品 UI 正确路径：弹出同名 / 内容重复对话框（IMPORT-007–009）。

测试夹具若仍写：

```ts
prepareOrExecuteImport(...) as ImportCompletion
```

会在冲突时得到假 completion（无磁盘文件），后续 `rmSync(Assets/foo)` 报 `ENOENT`（见 `trash-relink` relinkBatchApply）。

## 约定

- Worker 测试统一使用 [`tests/worker/import-no-conflict.ts`](../../tests/worker/import-no-conflict.ts)。
- 默认决策：`suspectedDuplicate: 'create-copy'`、`nameConflict: 'keep-both'`，保证夹具需要 N 个资产时仍能入库。
- AI / 媒体测试若故意要「跳过重复」，可显式传入 `suspectedDuplicate: 'skip'`。
## 产品修正（Serpent-hy1n）

库级重复且目标相对路径空闲时，「创建副本」写入请求的 basename（如 `b.png`），不再无故变成 `b (2).png`。仅当目标路径已被占用（路径级重复或本批占用）时才 `copyPath` 自动编号。
