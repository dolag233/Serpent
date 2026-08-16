# 2026-08-16 打开 Eagle：两段目录选择与指定保存位置

关联工单：`Serpent-768x.1`（父：`Serpent-768x`）。

## 用户反馈

导入 Eagle 资源库可用；打开 Eagle 资源库完全失败。产品定义：打开 Eagle 的实际过程是读取 Eagle 库并转换成新的 Serpent 库，因此必须弹出两个文件选择器——先选 Eagle 源，再选 Serpent 保存位置。

## 根因

1. `library.open-eagle` 只收集 Eagle 源目录，Worker 在源的同级自动创建 `<名称> (Serpent)`。Eagle 库常在不可写、NAS 或已存在同名转换目录的位置，创建会失败。
2. `asset.import-eagle` 走 30 分钟超时，`library.open-eagle` 落在默认 15 秒。转换创建库 + 复制全部条目必然超时，表现为“完全打不开”。

## 实现

| 行为 | 位置 | 测试 |
| --- | --- | --- |
| 连续两个目录选择器：源 Eagle，再选保存父目录 | `src/main/index.ts` `library.open-eagle.request`；文案 `openEagleLibraryDestination` | `tests/unit/native-dialog-i18n.test.ts` |
| Worker 在 `selectedParentPath` 下按 Eagle 显示名创建新库，不默认写到源同级 | `LibraryService.openEagleLibrary` | `tests/worker/eagle-open.test.ts` |
| 保存位置不能落在 Eagle 源目录内 | 同上 | 同上 `rejects` 用例 |
| 打开与导入同等长超时 | `src/main/worker-client.ts` `EXPORT_IMPORT_COMMANDS` | `tests/unit/worker-client.test.ts` |
| 协议强制同时带源路径与父目录 | `library.open-eagle` | `tests/unit/protocol.test.ts` |

取消任一选择器即取消，不创建半成品库。Eagle 源目录只读。打开成功后仍由 Renderer 关闭旧库并切换到新库。

## 验证

```
npx vitest run --config vitest.config.ts tests/unit/native-dialog-i18n.test.ts tests/unit/worker-client.test.ts tests/unit/protocol.test.ts
```

3 files, 103 passed（796ms）。

```
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/eagle-open.test.ts
```

1 file, 2 passed（3.92s）：转换库落在所选父目录；源目录内作为保存位置被拒绝。

真实 Eagle 小库、Computer Use、packaged、Windows 未执行。
