# 第十垂直切片：资源库导入导出

> 状态：候选 `f1330a7` 已包含自动实现与 20k 抽样一致性强化；最终合流门禁、macOS 打包手工与 Windows QA 待完成
> 日期：2026-07-13；最后校准：2026-07-16

## 目标

让用户把整个资源库导出为自包含文件夹或标准 ZIP，在另一台设备或同一设备上导入（ZIP 解压后打开、或直接打开现有资源库目录），导出内容可在 Windows 与 macOS 之间直接打开无需格式转换。导出时自动排除可重新生成内容以减小体积，并每次询问是否一并复制链接文件夹源内容。

## 用户主线

1. 在已打开的资源库中选择"导出资源库"，选择导出格式（完整文件夹 / 标准 ZIP）。
2. 系统显示预检信息：托管资产数量、总大小、是否包含链接文件夹源内容选项。ZIP 格式额外显示标准 ZIP 兼容性预检结果。
3. 用户确认导出目标路径后开始导出，Renderer 接收实时进度（已复制文件数、已处理字节数、当前阶段）。
4. 导出完成后显示摘要（成功文件数、跳过项、耗时）。用户可取消进行中的导出，取消后目标目录的已写入内容被清理。
5. 在其他设备或位置，选择"导入资源库"：选择 ZIP 文件或现有资源库目录。
6. 导入 ZIP 时先校验 ZIP 结构完整性（必须包含 `Assets/` 和 `.serpent/library.db`），然后解压到用户指定位置，成功后提示是否立即打开。
7. 导入文件夹时直接校验是否为有效资源库（`Assets/` + `.serpent/library.db` 存在且可打开），校验通过后打开，用户可选择复制到当前位置再打开或直接原地打开。
8. 导入的资源库中若包含链接文件夹路径，原路径失效时保留 `offline` 状态，用户可按切片 0003 流程重新指定根目录。

## 范围

### 包含

- 导出为完整文件夹：按资源库目录结构复制托管资产、数据库、用户元数据和实际仍保留的历史修订；排除 `.serpent/previews/`、`.serpent/operations/` 及 AI 临时文件。
- 导出为 ZIP：同上内容范围，仅生成不带 ZIP64 扩展的标准 ZIP；预检时若总大小超过 4 GB 或条目数超过 65534，提示无法导出 ZIP，只允许改用文件夹导出。
- 导出前通过 SQLite Online Backup API 获取一致数据库快照，不影响当前活动库的读写。
- 每次文件夹或 ZIP 导出都询问是否把链接文件夹源内容一并复制进导出结果（默认不包含）。链接内容写入 `_linked/<显示名>-<folder-id-前8位>/`，避免同名链接根互相覆盖；数据库仍保留原设备路径，导入后失效时按 offline/relink 流程处理。
- 导出进度推送（阶段：快照数据库 → 枚举文件 → 复制/ZIP 写入 → 完成），Renderer 展示进度条与可取消按钮。
- 导出摘要事件包含成功文件数、总字节数、被排除的可重新生成内容数量、是否包含链接内容。
- 导入 ZIP：结构校验 → 解压到用户指定目录 → 校验解压结果 → 提供"立即打开"选项。
- 导入文件夹：校验是否为有效资源库 → 用户选择复制到新位置或原地打开 → 打开资源库（复用切片 0001 `OpenLibrary`）。
- 导入/导出操作取消：清理已写入的目标文件/目录，不留下半成品。
- Renderer 导出入口、格式选择对话框、链接内容勾选框、进度面板、摘要面板；导入入口、ZIP / 文件夹选择对话框、校验结果与"立即打开"提示。
- 单元测试、Worker 集成测试与 Electron 用户流测试。
- 失败显示安全且具体的原因，完整错误链写入持久应用日志。

### 不包含

- 按合集或标签子集导出（MVP 仅支持导出整个资源库）。
- 增量导出、差异导出或同步导出。
- ZIP64 支持。
- 对导出 ZIP 设置密码或加密。
- 导入时自动修复损坏的资源库；损坏库明确报错不静默修补。
- 导入/导出队列或后台批量处理（一次一个操作）。
- 在导入时自动重定向失效的链接文件夹路径（保持 `offline`，由用户手动重新指定）。

## schema

本切片不新增数据库表。导出是只读操作，不需要持久化状态；导入通过现有 `OpenLibrary` 路径完成，不引入新表。

导出时通过 SQLite Online Backup API 获取一致快照：

```text
-- Worker 在导出期间打开第二个只读连接：
-- backupDb = new Database(':memory:')  或临时文件
-- sourceDb.backup(backupDb)
-- 然后把 backupDb 的字节写入导出目标
```

导出内容选取规则（以资源库根目录为基准）：

| 路径 | 包含 | 说明 |
| --- | --- | --- |
| `Assets/**` | 是 | 全部托管文件 |
| `.serpent/library.db` | 是 | 通过 backup API 写入一致快照 |
| `.serpent/revisions/**` | 是 | 实际仍保留的历史修订文件 |
| `.serpent/trash/**` | 是 | 回收站中的托管文件 |
| `.serpent/artifacts/**` | 是 | 当前缩略图/代理等衍生文件（缺省会导致导入后破损图；Serpent-pxd） |
| `.serpent/previews/**` | 否 | 遗留可重新生成目录（当前协议不再使用） |
| `.serpent/operations/**` | 否 | 进行中的导入暂存，不可恢复 |
| `*.tmp` / AI 临时文件 | 否 | 可重新生成 |
| 链接文件夹源内容 | 可选 | 每次导出询问用户 |

导入 ZIP 校验规则：

- ZIP 必须包含 `Assets/` 目录且非空（至少一个条目）。
- ZIP 必须包含 `.serpent/library.db` 文件条目。
- 不允许 ZIP 内路径逃逸（`../` 或绝对路径）。
- 校验失败给出具体缺失项，不解压。

## 协议

Renderer 只发语义请求（不暴露绝对路径）：

```text
// 导出
RequestExportLibrary { libraryId }

// 导入
RequestImportLibrary
```

Main 通过系统对话框获取路径后发送内部命令：

```text
// Worker 内部命令
LibraryExport {
  libraryId
  destinationPath          // 用户选择的目标目录或 .zip 文件路径
  format: 'folder' | 'zip'
  includeLinkedContent: boolean
}

LibraryExportCancel { exportId }

LibraryImportZip {
  sourceZipPath
  destinationParentPath    // 解压到的父目录
}

LibraryImportFolder {
  sourceFolderPath
  copyToParentPath?        // 如果用户选择"复制到新位置再打开"，提供父目录；否则原地打开
}

// Worker 推送事件
ExportProgress {
  exportId
  libraryId
  phase: 'snapshot-db' | 'enumerate' | 'copy' | 'compress' | 'complete' | 'failed' | 'cancelled'
  filesProcessed: number
  totalFiles: number
  bytesProcessed: number
  totalBytes: number
}

ExportCompleted {
  exportId
  libraryId
  format: 'folder' | 'zip'
  destinationPath
  fileCount: number
  totalBytes: number
  excludedPreviewCount: number
  includedLinkedContent: boolean
  durationMs: number
}

ImportZipProgress {
  importId
  phase: 'validate' | 'extract' | 'verify' | 'complete' | 'failed' | 'cancelled'
  entriesProcessed: number
  totalEntries: number
  bytesProcessed: number
  totalBytes: number
}

ImportZipCompleted {
  importId
  extractedPath
  libraryId?               // 解压后自动校验并获取 library_id，为空表示校验失败
  displayName?
}

ImportFolderCompleted {
  importId
  libraryId
  displayName
  libraryPath              // 最终打开的资源库路径
}
```

不变量：

- Renderer 永远不接收导出目标绝对路径或 ZIP 源绝对路径。
- 导出进度每处理 50 个文件或每 200 ms 推送一次，取先到达者。
- `ExportProgress` 和 `ImportZipProgress` 的 `totalFiles`/`totalBytes` 在枚举阶段结束后从 0 更新为实际值。
- 取消操作：Main 发送取消命令，Worker 在下一个检查点停止、清理目标路径的已写入内容、推送终止状态。检查点粒度 = 每个文件复制/写入完成后。

## 导出流程

1. Worker 收到 `LibraryExport`，生成 `exportId`。
2. **快照阶段**：通过 `better-sqlite3` 的 SQLite Online Backup API 分页获取一致数据库副本到临时文件；page batch 之间让出事件循环，不以 `VACUUM INTO` 阻塞活动资源库。完成后执行 `quick_check`，取消会终止后续复制并清理快照。
3. **枚举阶段**：遍历资源库目录，按选取规则生成文件清单并计算总大小/文件数。ZIP 格式在此阶段执行标准 ZIP 兼容性预检（总大小 < 4 GiB，条目数 < 65535）；预检不通过则返回错误，不启动复制。
4. **复制/压缩阶段**：
   - 文件夹格式：逐文件复制到目标目录，保持相对路径结构。
   - ZIP 格式：流式写入目标 ZIP 文件（Node.js 内置 `zlib` 或 `archiver`），不先在磁盘构建完整临时副本。
5. **完成阶段**：推送 `ExportCompleted`，包含摘要信息。
6. 取消时：删除目标路径（`rmSync` recursive），推送 `ExportProgress` with `phase: 'cancelled'`。

## 导入流程

### 导入 ZIP

1. Worker 收到 `LibraryImportZip`，生成 `importId`。
2. **校验阶段**：读取 ZIP central directory，验证存在 `Assets/` 目录条目和 `.serpent/library.db` 文件条目，检查无路径逃逸。校验失败返回错误。
3. **解压阶段**：逐条目解压到 `<destinationParentPath>/<zip-basename-stem>/`，保持相对路径。解压过程中推送 `ImportZipProgress`。
4. **校验阶段**：对解压结果执行 `OpenLibrary` 校验（等同于切片 0001 的打开流程）：检查 `Assets/` 目录存在、`.serpent/library.db` 可打开且 schema 版本兼容、quick_check 通过。校验通过后返回 `libraryId` 和 `displayName`。
5. 取消时：删除解压目标目录，推送终止状态。

### 导入文件夹

1. Worker 收到 `LibraryImportFolder`：
   - 若 `copyToParentPath` 存在：先将源目录完整复制到 `<copyToParentPath>/<source-basename>/`，再打开复制后的资源库。
   - 若 `copyToParentPath` 为 `null`（原地打开）：直接在源路径上调用 `OpenLibrary`。
2. 返回 `ImportFolderCompleted`，包含 `libraryId`、`displayName`、`libraryPath`。

## 测试接缝

- SQLite Online Backup API：备份一致性与源库并发写入不冲突；备份期间的写入不被静默包含也不损坏备份。
- 文件夹导出文件选取：验证 `previews/`、`operations/`、AI 临时文件被排除，`Assets/`、`library.db`、`revisions/`、`trash/` 被包含。
- ZIP 导出预检：4 GiB 边界（刚好低于/超过）、65534/65535 条目边界；预检失败不产生任何 ZIP 文件或半文件。
- ZIP 导出：在 macOS 上用原生 Archive Utility 可解压，在 Windows 上用资源管理器可解压；文件名在不同平台上可正确还原。
- 链接内容包含/排除：勾选包含时链接文件夹源文件出现在导出中；不勾选时不出现但 `linked_folders` 表行仍在库中（路径失效后标记 `offline`）。
- 导出取消：各阶段取消后目标路径清理干净（`rmSync` 递归删除），不残留目录或文件。
- 导出进度推送节流：验证 50 文件 / 200 ms 节流正确，不大批量跳过。
- ZIP 导入校验：结构不完整（缺 `Assets/` 或 `library.db`）、路径逃逸 ZIP、ZIP 损坏；解压不启动。
- ZIP 导入解压：跨平台文件名可解压；符号链接被拒绝（不跟随、不创建）。
- 导入文件夹校验：非资源库目录、schema 版本过高/过低、数据库损坏；给出明确错误，不打开也不创建新库。
- 导入文件夹复制：源路径包含符号链接时拒绝复制；复制过程中磁盘满或权限不足时清理已复制内容。
- 导入打开：成功打开后等同于切片 0001 `OpenLibrary` 结果；linked_folder 保持原有 `absolute_root_path`，在目标设备上若路径不存在则为 `offline`。
- 导入/导出操作互斥：同一资源库同时只能有一个导出或导入操作；第二个操作被拒绝。
- Renderer 不接收绝对路径：所有推送事件中出现的路径仅为安全的 `displayName` 或已由 Worker 持有、Renderer 不可见的内部引用。
- Electron 用户流：打开资源库 → 导出为文件夹 → 关闭资源库 → 导入刚导出的文件夹 → 验证资产数量与元数据一致。
- Electron 用户流：导出为 ZIP → 关闭 → 导入 ZIP → 打开 → 验证一致性。
- Electron 用户流：导出进行中取消 → 目标目录已清理 → 可重新导出。
- 错误可观测性：Renderer 不接收绝对路径，界面给具体原因，日志保留系统错误码与 cause 链。

## 完成标准

- 全部自动化门禁通过；macOS 打包导入导出冒烟有明确结果，Windows 保留为显式未验证项。
- 导出的文件夹和 ZIP 在 macOS 与 Windows 上均可直接解压/打开，无需格式转换。
- 导出的资源库重新导入后：资产数量、文件夹树、标签、合集、智能合集、评分、喜欢、标签、描述、修订记录与原始库完全一致；可重新生成内容（缩略图、预览、AI 临时文件）重新生成不受阻。
- SQLite Online Backup API 备份在导出期间与源库并发写入不冲突。
- 取消或失败后的目标路径不残留文件或目录。
- ZIP 预检阻止超出标准 ZIP 限制的导出，并指引用户改用文件夹格式。
- 导入的 ZIP 结构校验阻止无效或恶意 ZIP。
- 开发日志、双轴审查与 QA 报告完整。
