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
| 打开与导入同等长超时（后由 `Serpent-4s8b` 改为无墙钟超时） | `src/main/worker-client.ts` | `tests/unit/worker-client.test.ts` |
| 协议强制同时带源路径与父目录 | `library.open-eagle` | `tests/unit/protocol.test.ts` |

取消任一选择器即取消，不创建半成品库。Eagle 源目录只读。打开成功后仍由 Renderer 关闭旧库并切换到新库。

## 2026-08-16 用户反馈：名称面板、立即关旧库、打开进度条文案

用户在真机打开流程上补充三点：进度条应是「打开资源库」而不是「导入资源库」；一旦确定会打开就立即关掉当前库，避免转换期间仍显示旧库；校验 Eagle 有效后弹出与创建资源库相同的名称面板（默认名为 Eagle 库名），再选保存位置。

| 行为 | 位置 | 测试 |
| --- | --- | --- |
| 先 `library.inspect-eagle` 校验源，Renderer 只拿到 `displayName` | Main pending 源路径 + Worker `inspectEagleLibrary` | `tests/worker/eagle-open.test.ts` inspect 用例；`tests/unit/protocol.test.ts` 禁止 renderer 带路径 |
| 名称面板复用 `CreateDialog` 的 `eagle` phase，提交文案为「选择保存位置」 | `CreateDialog.tsx`；i18n `dialog.openEagleLibrary` | `tests/unit/create-dialog-eagle-open.test.ts` |
| 选定保存位置后、长时间转换前关闭已打开的库，并发布 `library.opening` / `library.closed` | Main `closeOpenLibrariesBeforeReplacement`；Renderer 清空当前库 UI | lifecycle `open-eagle` 协议用例 |
| 进度条前缀与取消钮走「打开」文案，不复用「导入资源库」 | `App.tsx` `libraryTransferKind` | `tests/unit/no-library-empty-state.test.ts` 文案断言 |
| Worker 使用用户填写的 `displayName` 创建新库 | `openEagleLibrary({ displayName })` | `tests/worker/eagle-open.test.ts` 自定义名称用例 |

取消名称面板或保存位置选择器时保留当前库。保存位置选定后转换失败则回到无库起始面。

无库起始页或「创建资源库」里的「导入资源库」选择面板提供可展开的「打开外部资源库」，展开后才显示 Eagle 与 Billfish。2026-08-16 稍后 Billfish 入口已取消置灰（`Serpent-ot5r`）。此处的外部库入口走打开并转换，不是合并进当前库。

## P0：切库被 `library.closed` 清成无库

用户：默认打开 meme 后从菜单切到小型资源库，却弹出创建资源库面板。

根因：为打开 Eagle 立即关旧库，Renderer 对任意匹配当前 `libraryId` 的 `library.closed` 调用了 `applyClosedLibraryUi`。普通切库是先打开新库再关闭旧库；关闭旧库的事件仍带着旧 id，监听闭包也还是旧 id，于是把刚切过去的库清掉，无库起始面出现。

修复：只在 `library.opening` 且 `operation === 'open-eagle'` 时拆掉当前库 UI。切库的 `library.closed` 不再清空 Renderer。2026-08-16 用户确认 SWITCH-001 人类验收通过。

展开后的 Eagle/Billfish 与面板其他按钮同样式、同宽，不再缩进。

## 验证

```
npx vitest run --config vitest.config.ts tests/unit/library-lifecycle-sync.test.ts tests/unit/import-library-chooser.test.ts
```

2 files, 2 passed。切库 `library.closed` 不得拆掉当前库；导入选择面板展开后才显示 Eagle/Billfish。

```
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/eagle-open.test.ts
```

1 file, 4 passed（3.36s）：默认名转换、自定义显示名、inspect 拒绝非 Eagle 目录、源目录内作为保存位置被拒绝。

```
npm run test:library-availability
```

9 files, 186 passed / 1 skipped（36.08s）。

真实 Eagle 小库、Computer Use、packaged、Windows 未执行。
