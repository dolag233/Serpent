# 2026-08-17 Eagle 打开进度、错误处理与大型库性能

> 工单：`Serpent-lvif` / `Serpent-sq4i` / `Serpent-l2at` / `Serpent-7tjg` / `Serpent-joz6` / `Serpent-4s8b` / `Serpent-o4id` / `Serpent-qc7v` / `Serpent-rzqj` / `Serpent-j3ba` / `Serpent-qn6k` / `Serpent-n485` / `Serpent-onch` / `Serpent-tz35`
>
> 分支：`dev_performance_2`

## 用户报告

1. 打开 Eagle 资源库时进度条写成「打开 Billfish」或「导入资源库: 验证中…」。
2. 选择保存位置后提示类似「无效路径」，随后应用卡在验证中；再次打开会出现「无法完成这项操作」。
3. 资产卡片的名称、大小、分辨率、修改日期长时间空白；需要更快出字，或用骨架占位。
4. 以本机约 2 万+ 资产的 Eagle `.library` 为基准：首次打开/转换 ≤10 分钟；之后切到该 Serpent 库 ≤1 秒；完整卡片 <0.2s；缩略图 <0.5s；切文件夹 <0.3s；Inspector <0.15s。该路径不进仓库测试默认值。

## 根因

- `library.opening` 对 Eagle 和 Billfish 都会拆掉当前库，但 Renderer 把 `libraryTransferKind` **写死**成 `open-billfish`。
- 打开失败后 `submitEagleLibraryName` 的 `finally` 把 kind 打回 `import`，却不撤 `importProgress`，于是条带变成「导入资源库: 验证中…」并一直转。
- Windows 文件夹选择器常带尾斜杠（`E:\设计\`）。`path.dirname(join(parent, name))` 与带尾斜杠的 parent 字符串不相等，`targetLibraryPath` 一律抛 `INVALID_LIBRARY_PATH`。父目录不存在时也是同一句「请选择有效的本地文件夹。」
- 路径失败发生在 `library.opening` 已经发出、旧库已经关闭之后，UI 既没有库也没有可点的取消。
- Eagle 转换走通用 `prepareImport`：每个文件缓冲复制 + `fsync` + 整文件 SHA-256/SHA-1，2 万项会被哈希拖死；Worker 超时后 Main 只映射成 `INTERNAL_ERROR`（「无法完成这项操作」）。
- 布局占位卡在没有缩略图 artifact 时 `return null`，视口里只剩空槽，caption 要等 AssetSummary 分页才出现。

## 改动

- 进度条按 `event.operation` 区分 `open-eagle` / `open-billfish` / `open` / `import`。
- 打开失败、取消、`library.open-failed` 都必须清掉进度条；卡住的空 `importId` 验证中转圈允许重新打开。
- 保存位置在关闭旧库之前校验；尾斜杠剥离；缺失父目录可创建；磁盘根、源库内部、非文件夹给出独立 reason。
- Worker 请求超时曾映射为 `LIBRARY_TRANSFER_TIMEOUT`。`Serpent-4s8b` 起打开/转换类 RPC 不再设墙钟超时，该文案只作为其它仍有时限命令的兜底。
- 转换失败后尝试重新打开刚才关掉的 Serpent 库（`replacement-restore` 生命周期）。
- Eagle/Billfish 批量转换跳过整文件哈希，用 `copyFile`/`COPYFILE_FICLONE` 代替逐字节 copy+fsync，批次 128。
- 布局索引带上 displayName/byteSize/modifiedAt；占位卡始终画骨架或真实 caption；Inspector 在 Summary 未到时用布局字段先出文件名/尺寸。
- 打开大型 Eagle 库时，软件侧开销曾压过拷贝：每条资产 `readdir` 整个 Assets（O(n²)）、每条一次 `synchronous=FULL` 的 SQLite 事务、每批结束全库 `listAssets`、再读一遍源图 header。现改为 path_identity 索引、每批一次提交、用 Eagle metadata 的宽高、缩略图拷贝与登记拆开。进度日志每批写 `eagle-import.batch` 的 `copyMs`/`applyMs`。

## 自动化

定向单测（系统 Node / vitest）：9 files / 192 passed。

Worker 必须走 Electron ABI（`node scripts/run-vitest-with-electron.mjs`；直接 `npx vitest` 会因 better-sqlite3 NODE 137 vs Electron 148 失败）：

```text
npx vitest run <unit files>                    # 9 files / 192 passed
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/eagle-open.test.ts tests/worker/search.test.ts
# 2 files / 93 passed

npm run test:library-availability
# pretest: better-sqlite3 matches the Electron ABI
# 9 files / 188 passed | 1 skipped (189)
```

`npm run typecheck`：通过（`tsc --noEmit` + extension）。
`npm run lint`：曾报 `library-parent.ts` `no-useless-assignment`（`resolvedParent` 初值未读），已改为只从 `realpathSync` 赋值后再通过该文件 eslint。

`npm run test`（审查期间全量）：436 files passed / **4 failed** / 12 skipped；3818 tests passed。
失败与跟进：
- `eagle-import` 批次间取消：批次改为 128 后 40 项无法在批次边界取消。已改为 160 项并在每批结束后 `throwIfCancelled`。定向复跑 `eagle-import` + `import-planning`：**56 passed / 1 skipped**。
- `import-planning` NTFS `|` 文件名：Windows 无法创建该夹具，已 `skipIf(win32)`。
- `thumbnails` GIF webm_proxy、`video-exr` 硬件编码器探测：隔离复跑仍失败（`thumbnail` 而非 `webm_proxy`；proxy artifact 为 `null`）。本次 diff 未改 `resolvePreviewArtifact` / 缩略图队列，视为分支上既有问题（与 on-demand video proxy 同路径），不纳入本 Eagle 打开改动。

Main 在关旧库前调用 `resolveWritableLibraryParent`（mkdir/realpath），是为了路径失败时不拆掉当前库；与 `src/main/external-library-archive.ts` 引用 Worker 解压辅助同类。Worker `openEagleLibrary` 仍会再校验一次。

真实 2w+ Eagle 库计时不进 CI，由 PERF-005 人类验收。关单表示实现完成，不是用户已点「人类验收通过」。

## 2026-08-17 `Serpent-o4id`：去掉卡片扫光

未就绪缩略图改为默认文件图标；caption 骨架只保留静止色条。删除 `.asset-card-media.is-pending` 与 `serpent-card-pending-shimmer`。

## 2026-08-17 `Serpent-7tjg`：转换耗时应落在磁盘拷贝

用户确认上一轮优化后真实大库仍然过慢。本轮去掉仍压在拷贝前面的软件开销：

- Windows 不再先试 `COPYFILE_FICLONE`（必失败再普通拷贝）。
- 批量 `copyFile` 不再二次 `lstat`；登记阶段不再对空目标 `existsSync` 2 万次。
- 标准 Eagle `name.ext` + `name_thumbnail.png` 不再 `readdir` 整个 `.info`。
- 进度 IPC 250ms 节流；成功批次不再走 `diagnose` error 通道。
- 合集 `MAX(position)` 改为每集合 O(1) 游标，避免 2 万项 O(n²)。
- Eagle 元数据写入后不再重复重建 FTS。
- 缩略图在拷源文件之后立刻拷走（同一 `.info` 目录还热），登记阶段只写 DB。

验收：`PERF-004` / `PERF-005`。须完全退出 Electron 后重新 `npm start`；半成品库换新保存位置。

定向验证（`Serpent-o4id` / `Serpent-7tjg`）：

```text
npx vitest run tests/unit/browse-layout-preview.test.ts tests/unit/eagle-library.test.ts
# 2 files / 8 passed

node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/eagle-import.test.ts tests/worker/eagle-open.test.ts
# 2 files / 11 passed

node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/import-planning.test.ts tests/worker/billfish-import.test.ts
# 2 files / 56 passed | 1 skipped

npx tsc --noEmit -p tsconfig.json
# 通过

npm run test:library-availability
# 9 files / 188 passed | 1 skipped (189)
```

## 2026-08-17 `Serpent-qc7v`：占位卡与完成卡 caption 对齐

瀑布流占位卡把 Eagle 布局索引里的宽高画成第一行，完成卡却是「文件名 + 大小/日期」，滚动时文字跳动。占位 caption 改为与完成卡同一套结构：瀑布流不显示分辨率；平铺仍先显示「宽 × 高」（CANVAS-010）。分辨率作为可选卡片字段记 `Serpent-rzqj`（P2），本次不实现。

```text
npx vitest run tests/unit/browse-layout-preview.test.ts
# 1 file / 4 passed
```

## 2026-08-17 `Serpent-j3ba`：进度条色点居中，字节分母为全库总量

用户反馈打开 Eagle/Billfish 时：

1. 进度条左侧主题色点偏上，应对齐整条（文案 + 进度条 + 取消按钮）的垂直中心。
2. `复制中 307/1458 · 5.5 GB/7.1 GB` 的分母 7.1 GB 是当前已读批次累计，不是整个资源库。文件数分母已经是全库；字节分母应同样稳定。

根因：`.import-progress-strip` 把色点顶对齐；Eagle 转换在每批 `readEagleAssetCandidate` 时才累加 `totalBytes`。Billfish 在循环前已经 `reduce` 全部 `item.byteSize`，字节分母本来就是全库。

改动：

- `.activity-pulse` 改为 `display: block` + `align-self: center`；`.import-progress-strip` 使用 `align-items: center`。
- 复制开始前按批扫描 Eagle 源文件字节（优先 `metadata.size`，否则 `lstat`），跳过 `isDeleted`；复制阶段不再把批次大小加进分母。

```text
npx vitest run tests/unit/eagle-library.test.ts
# 1 file / 7 passed

node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/eagle-import.test.ts tests/worker/billfish-import.test.ts
# 2 files / 11 passed

npx tsc --noEmit -p tsconfig.json
# 通过

npm run test:library-availability
# 9 files / 188 passed | 1 skipped (189)
```

## 2026-08-17 `Serpent-qn6k`：去掉名称说明，允许磁盘根作为保存位置

用户认为名称面板里「下一步选择的是父文件夹…不能选磁盘根目录」没必要，并要求：给不出不能选根目录的理由就应支持。

原先禁止磁盘根只是产品习惯（`Serpent-8b5b.3` / `sq4i`），不是技术限制。选 `E:\` 只会创建 `E:\<名称>`，不会把整盘收进资源库。真正危险的是把磁盘根当成**导入文件夹来源**（会递归扫整盘），`ROOT_NOT_ALLOWED` 仍保留。

改动：名称面板 help 留空（与 Billfish/新建资源库一致）；`targetLibraryPath` / `resolveWritableLibraryParent` 接受文件系统根；无写权限走 `PERMISSION_DENIED`。

```text
npx vitest run tests/unit/create-dialog-eagle-open.test.ts tests/unit/library-parent.test.ts tests/unit/library-rules.test.ts
# 3 files / 73 passed

node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/import-planning.test.ts tests/worker/eagle-open.test.ts
# 2 files / 57 passed | 1 skipped (58)

npm run test:library-availability
# 9 files / 188 passed | 1 skipped (189)
```

## 2026-08-17 `Serpent-4s8b`：去掉打开/转换墙钟超时与资源库体积产品门

用户在大型 Eagle 库快转换完时收到「打开或转换资源库超时」。根因是 Main 对 `library.open-eagle` 固定 30 分钟墙钟超时：Worker 仍在写盘，UI 已报失败。

- `requestTimeoutForCommand` 对打开/创建/导入/导出/Eagle/Billfish/`asset.import.*`/`asset.refresh` 等磁盘绑定命令返回 `null`；`request()` 不再 `setTimeout`。用户取消仍走现有 cancel。
- 外部库 ZIP/EaglePack/BillfishPack 解压不再设 1GB/4GB/10 万条目产品门；只保留 zip 压缩比炸弹与路径安全。RAR/7z 仍因整包读入内存，超过约 1GB 时提示先解压成文件夹再打开。
- Serpent ZIP **导入**不再设 4GB 解压上限。ZIP **导出**仍受标准 ZIP 4GiB / 65534 条目格式限制，错误继续提示改导出文件夹。
- 10 分钟是性能目标，不是硬超时；慢机器必须能跑完。

定向验证（`Serpent-4s8b`）：

```text
npx vitest run tests/unit/worker-client.test.ts tests/unit/external-library-archive.test.ts
# 2 files / 18 passed

npx tsc --noEmit -p tsconfig.json
# 通过

node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/zip-import-stream.test.ts tests/worker/library-zip.test.ts
# 2 files / 43 passed

npm run test:library-availability
# 9 files / 188 passed | 1 skipped (189)
```

## 2026-08-17 晚间人类验收

- EXTLIB-006 / `Serpent-qn6k`：通过。
- PERF-004 / `Serpent-qc7v` / `Serpent-o4id`：通过（占位布局一致、扫光已去掉）。剩余：占位卡标题没有 TITLE-001 中间省略 → `Serpent-n485`。
- PERF-005 / Eagle 导入：不通过，仍巨慢。用户要求后续性能测试必须插桩，否则是盲人摸象。`Serpent-7tjg` 已 reopen，并被 `Serpent-onch` 阻塞。
- 新开：`Serpent-onch` 插桩热区；`Serpent-tz35` 有后台处理时打开查看器必须优先当前操作。

## 2026-08-17 `Serpent-n485`：占位卡文件名中间省略

`BrowseLayoutPreview` 把 `displayName` 整段塞进 `<strong>`，窄卡时变成末尾裁切，没有 `wghuasgf...sad.jpg`。改为复用 `splitFilenameForDisplay` 与完成卡同一套 prefix/tail/extension。

```text
npx vitest run tests/unit/browse-layout-preview.test.ts
# 1 file / 5 passed
```

## 未验证

- 真实 2w+ Eagle 库转换（2026-08-17 人类验收不通过；先做 `Serpent-onch` 插桩）
- packaged
- Computer Use
