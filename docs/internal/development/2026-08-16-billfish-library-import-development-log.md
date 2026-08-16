# 2026-08-16 Billfish 打开/导入接线（Serpent-ot5r）

## 范围

用户确认 `Serpent-pte2` 通过后，要求打开/导入面板里置灰的 Billfish 入口改为可用。后端从 sibling worktree 迁入本 `dev` 树，并接到与 Eagle 相同的 UI 旅程。

## 实现

- Worker：`billfish-library.ts` 读取源库；`importBillfishLibrary` / `inspectBillfishLibrary` / `openBillfishLibrary`。缩略图复用 Eagle 静态封面落盘，`generator_version = billfish-thumbnail@1`。
- 协议：`library.inspect-billfish` / `open-billfish` / `asset.import-billfish`；`BILLFISH_METADATA_UNREADABLE`。
- Main：选源、名称面板、保存位置（保存目录对话框复用 Eagle 文案键）；`library.opening` 的 `open-billfish` 立即拆掉旧库 UI。
- Renderer：打开/导入选择面板传入 `onOpenBillfish` / `onImportBillfish`；`CreateDialog` phase `billfish`；有库导入走 `importBillfishLibrary`。

菜单仍不单列 Billfish 行（pte2 信息架构）。

## 验证

```
npx vitest run --config vitest.config.ts tests/unit/import-library-chooser.test.ts tests/unit/create-dialog-eagle-open.test.ts tests/unit/library-lifecycle-sync.test.ts tests/unit/protocol.test.ts tests/unit/worker-client.test.ts
```

含在上面 8 files / 130 passed 中。

```
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/billfish-import.test.ts
```

1 file, 4 passed（3.50s）。

```
npm run test:library-availability
```

9 files, 188 passed / 1 skipped。2026-08-16 用户确认 EXTLIB-002 人类验收通过。
