# 2026-08-16 Billfish 打开/导入接线（Serpent-ot5r）

## 范围

用户确认 `Serpent-pte2` 通过后，要求打开/导入面板里置灰的 Billfish 入口改为可用。后端从 sibling worktree 迁入本 `dev` 树，并接到与 Eagle 相同的 UI 旅程。

## 实现

- Worker：`billfish-library.ts` 读取源库；`importBillfishLibrary` / `inspectBillfishLibrary` / `openBillfishLibrary`。缩略图复用 Eagle 静态封面落盘，`generator_version = billfish-thumbnail@1`。
- 协议：`library.inspect-billfish` / `open-billfish` / `asset.import-billfish`；`BILLFISH_METADATA_UNREADABLE`。
- Main：选源、名称面板、保存位置（保存目录对话框复用 Eagle 文案键）；`library.opening` 的 `open-billfish` 立即拆掉旧库 UI。
- Renderer：打开/导入选择面板传入 `onOpenBillfish` / `onImportBillfish`；`CreateDialog` phase `billfish`；有库导入走 `importBillfishLibrary`。

### 归档来源（2026-08-16）

- Billfish 打开/导入入口现在只接受 `.BillfishPack` 文件，不再把目录当作 BillfishPack 来源。
- Main 新增 `external-library-archive.ts`：使用 `libarchive-wasm` 读取 ZIP、RAR v4/v5、7z、TAR、GZIP/BZIP2/XZ 等归档，拒绝绝对路径、路径穿越、符号链接/硬链接和超限条目。
- 归档会解压到 `tmpdir()` 下的随机临时目录，并通过 Main 持有的清理回调管理生命周期：检查失败、取消、导入/打开完成、失败以及应用退出都会清理；Worker 只接收已探测出的库根目录。
- Eagle 外部库入口现在允许选择文件夹或上述归档，解压后自动探测包含 `metadata.json + images/` 的实际 Eagle 根目录；Eagle 原有目录解析器和导入逻辑保持不变。
- 真实 BillfishPack `动画OPED.BillfishPack` 约 1.94 GB，确认其 ZIP magic 为 `PK`、包含 76 个条目且解压后约 1.94 GB。初版 `libarchive-wasm` 会先把整个归档读入内存，并以 1 GB 作为统一上限，导致该合法文件被误报为“无法完成这项操作”。现改为对 `.BillfishPack`、`.zip`、`.eaglepack` 使用 `zip-import-stream` 流式解压；仅对需要整体读入内存的 RAR/7z/TAR 等格式保留 1 GB 读取上限，同时继续执行条目数、单文件/总解压大小、路径和链接安全检查。
- 本轮按 Eagle 的转换流程对齐：Main 在 `library.opening` 后立即通知 Renderer，Renderer 先清空当前资源库再等待转换；Billfish 的无内部名称时默认名来自 `.BillfishPack` 文件名（去掉扩展名）。ZIP 文件名解码优先识别 Unicode Path、显式 UTF-8，以及 BillfishPack 常见的“UTF-8 字节但未设置 UTF-8 标志”格式，最后才回退到 CP437。

菜单仍不单列 Billfish 行（pte2 信息架构）。

## 验证

```
npx vitest run --config vitest.config.ts tests/unit/import-library-chooser.test.ts tests/unit/create-dialog-eagle-open.test.ts tests/unit/library-lifecycle-sync.test.ts tests/unit/protocol.test.ts tests/unit/worker-client.test.ts
```

含在上面 8 files / 130 passed 中。

```
npx vitest run --config vitest.config.ts tests/unit/external-library-archive.test.ts
```

1 file, 5 passed。覆盖 BillfishPack 嵌套根目录、Eagle ZIP 根目录、路径穿越拒绝/清理、Eagle 文件夹来源和 Billfish 目录拒绝。

该单测在切换到流式 ZIP 路径后仍为 1 file, 5 passed。真实 1.94 GB 文件已完成只读 ZIP 中央目录扫描（76 条目、总解压约 1.94 GB）；未在开发机上完整展开，避免重复占用约 2 GB 临时空间，需由用户在应用中验收实际导入/打开。

本轮定向验证：`tests/worker/zip-import-stream.test.ts` 与 `tests/unit/external-library-archive.test.ts` 共 2 files / 18 passed；另运行 `tests/unit/library-lifecycle-sync.test.ts`、`tests/unit/protocol.test.ts` 共 109 passed；`npx tsc --noEmit` 与定向 ESLint 通过。真实 Windows/packaged 旅程仍待用户验收。

### 验收反馈收口（2026-08-16）

- Billfish 检查命令现在也会在名称确认窗口出现前发布 `library.opening(open-billfish)`，Renderer 立即清空当前资源库；用户不会在转换期间继续看到旧库内容。
- 修正名称回退根因：Billfish 解析器无内置名称时先得到的是解压临时目录名，导致原有回退无法生效。现在会识别该临时目录并使用 `.BillfishPack` 文件名（去掉扩展名），Main→Renderer 还保留同值兜底，避免旧 Worker 响应泄漏 `serpent-external-library-*`。
- 文件选择器确认后立即发布验证开始事件，再进入归档解压；Renderer 显示“正在验证 Billfish 资源库…”，不会等到解压/Worker 检查结束才反馈。

本轮定向验证：4 个相关测试文件共 111 passed；`npx tsc --noEmit`、相关 Renderer/Worker 文件 ESLint、`npx vite build --config vite.main.config.ts`、`npx vite build --config vite.renderer.config.ts`、`git diff --check` 通过。Main 全文件 ESLint 仍被工作区其他改动留下的 `bindLibraryMediaReadSignal` / `isLibraryMediaReadBlocked` 未使用导入阻断；真实 Windows/packaged 旅程仍待用户用重启后的 `npm start` 或打包程序验收。

```
npx tsc --noEmit
npx eslint src/main/external-library-archive.ts src/main/native-dialogs.ts src/main/index.ts vite.main.config.ts forge.config.ts tests/unit/external-library-archive.test.ts
npx vite build --config vite.main.config.ts
```

均通过。Worker Billfish 测试和真实 Windows/packaged/RAR 人工旅程仍待在匹配 Electron ABI 的环境中验收。

```
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/billfish-import.test.ts
```

当前工作区直接运行结果为 1 passed / 3 failed：失败均发生在测试 fixture 创建 `better-sqlite3` 数据库时，原因是 Electron ABI 148 与当前 Node ABI 137 不匹配；不能把该结果视作当前 HEAD 的 Worker 绿证据。需在 `npm run rebuild:native` 后的匹配环境重跑。

```
npm run test:library-availability
```

9 files, 188 passed / 1 skipped。该结果只覆盖既有库可用性；2026-08-16 用户确认的是 EXTLIB-002 的入口可用性，归档解压旅程仍待验收。
