# 第一垂直切片：桌面壳与资源库生命周期

> 状态：可实施计划
> 日期：2026-07-12

## 目标

建立 Serpent 后续功能都依赖的最小可信运行骨架：启动 Electron 桌面应用，通过沙箱化 Renderer 与受约束 IPC 调用单个 Library Worker，在用户指定位置创建、关闭并重新打开一个可移动资源库，并用 SQLite 迁移管理数据库结构。

完成后用户还不能导入或预览资产；这一切片只证明应用边界、资源库目录、数据库所有权和错误恢复路径成立。

## 用户可见场景

1. 用户启动 Serpent，看到空状态页。
2. 用户选择“创建资源库”，输入名称并选择父目录。
3. Serpent 创建自包含目录，并显示已打开资源库的名称和位置。
4. 用户关闭应用后重新启动，通过“打开资源库”选择同一目录。
5. Serpent 校验目录和数据库版本后恢复该资源库。
6. 若目录不是资源库、数据库损坏、结构版本过新或存储暂时不可写，界面显示可理解的错误，不留下半创建状态。

## 范围

### 包含

- Electron + TypeScript 应用骨架。
- 每台电脑单一应用进程；第二次启动把请求转交现有进程。
- 开启 `contextIsolation` 和 Renderer sandbox；Renderer 不获得 Node、文件系统或数据库访问。
- Main 只负责窗口、系统文件选择器、应用生命周期和 UtilityProcess 生命周期。
- 单个 Library Worker UtilityProcess，拥有所有资源库文件系统与数据库访问。
- Main/Preload/Renderer/Worker 之间的显式消息契约和运行时校验。
- 创建、打开、关闭一个资源库。
- 初始 SQLite migration、`schema_version` 和资源库身份记录。
- 资源库创建与打开的失败清理、结构校验和错误码。
- 从第一天建立单元测试及 Electron 集成冒烟测试。
- 从第一天维护开发日志，并交付可复现的代码审查记录和 QA 报告。

### 不包含

- 文件或文件夹导入。
- 链接文件夹。
- 资产表、标签、合集或智能合集的完整 schema。
- FTS5 搜索。
- 缩略图、视频、FFmpeg、OIIO 或 OCIO。
- AI 供应商和任务队列。
- 多资源库同时打开的完整 UI；底层契约不得阻止以后增加。
- NAS 专用模式；本切片只识别存储位置并为后续策略预留能力。
- 悬停放大及最终视觉设计。

## 进程与权限边界

```text
Renderer (sandboxed)
  │ typed commands/events only
  ▼
Preload (minimal bridge)
  │ invoke / event subscription allowlist
  ▼
Main (window + dialogs + process lifecycle)
  │ MessagePort / validated messages
  ▼
Library Worker (filesystem + SQLite owner)
```

不变量：

- Renderer 永远不接收任意路径读写、SQL 或通用 IPC 发送能力。
- Main 不打开资源库数据库，不执行迁移，不扫描资产目录。
- Library Worker 是资源库数据库和文件操作的唯一应用级所有者。
- 所有跨进程输入和输出都经过运行时 schema 校验；TypeScript 类型不能替代运行时校验。
- 错误通过稳定错误码和安全的用户消息传递，不把原始异常或敏感配置直接暴露给 Renderer。

## 初始资源库布局

```text
<LibraryName>/
  Assets/
  .serpent/
    library.db
    previews/
    revisions/
    trash/
```

本切片只创建这些稳定顶层位置。可重新生成目录允许为空；具体媒体缓存布局延后。

## 最小数据库结构

首个 migration 只建立：

- `schema_migrations`：已应用 migration、校验信息和应用时间。
- `library`：稳定 `library_id`、展示名称和创建时间。

约束：

- migration 按顺序、事务化且可重复检查。
- SQLite `PRAGMA user_version` 是当前 schema 版本的唯一权威值；`schema_migrations` 只保存迁移审计，不在 `library` 中复制 schema 版本。
- 应用拒绝写入比自身支持版本更新的数据库。
- 打开资源库时执行 `PRAGMA quick_check(1)`，并检查 migration 记录、library 身份唯一性和必要目录；完整检查由后续“检查资源库”功能承担。
- 每个打开资源库只有一个长期 SQLite 连接，并由 Library Worker 串行调度写入。
- v1 是首个有效资源库 schema，不存在可从其升级的已发布旧格式；`user_version = 0` 不被识别为旧资源库。通用升级步骤在出现 v2 migration 时启用，v1 当前只验证创建 migration 的事务性、审计记录和版本拒绝规则。

## 创建资源库流程

1. Renderer 提交名称；Main 通过系统对话框取得用户选择的父目录。
2. Main 只把用户明确选择的目标传给 Library Worker。
3. Worker 校验目标路径、名称、可写性和是否已存在冲突目录。
4. Worker 在同一父目录创建带操作标识的临时目录。
5. Worker 创建目录骨架、数据库，执行 migration 并写入资源库身份。
6. Worker关闭并重新打开数据库做最小校验。
7. Worker 将临时目录原子重命名为最终资源库目录。
8. 成功后才向 Renderer 发布 `LibraryOpened`。
9. 任一步失败时关闭句柄并清理本次创建的临时内容；无法安全清理时保留诊断信息并返回可操作错误。

## 打开资源库流程

1. Main 使用系统对话框取得用户选择的目录。
2. Worker 校验 `.serpent/library.db` 和所需顶层结构。
3. Worker 读取 schema 版本，拒绝不支持的更新版本。
4. Worker 应用可用 migration（v1 尚无有效旧格式可升级），执行轻量检查并读取资源库身份。
5. Worker 建立该资源库的长期连接和写队列。
6. 成功后发布资源库摘要；失败时不得留下半打开连接或后台任务。

打开规则：

- `.serpent/library.db` 与 `Assets/` 缺失时拒绝打开，避免把内容缺失误判为空库。
- `previews/`、`revisions/` 和 `trash/` 属于可恢复内部目录，缺失时由 Worker 重建。
- 重复打开已在当前 Worker 中打开的资源库是幂等成功，返回现有摘要，不创建第二连接。
- “整体移动后重开”只验收资源库关闭后的移动；打开状态下移动不在本切片范围。

## 名称与临时目录规则

- 资源库展示名称允许 Unicode，去除首尾空白后长度为 1–80 个 Unicode code point。
- 拒绝 `.`、`..`、路径分隔符、控制字符、Windows 保留设备名，以及以空格或点结尾的名称。
- 规则采用 Windows 与 macOS 的共同安全子集，避免资源库跨平台移动后失效。
- 创建中的临时目录使用 `.serpent-create-<uuid>.partial`，不能被识别为有效资源库。
- 临时目录清理失败时返回专用错误并保留该显式 partial 名称，绝不把它重命名为最终目录。

## IPC 最小契约

Renderer 只能请求用户流程：

```text
RequestCreateLibrary { displayName }
RequestOpenLibrary
RequestCloseLibrary  { libraryId }
GetOpenLibraries
```

Main 完成系统目录选择后，才向 Worker 发送内部命令：

```text
CreateLibrary { displayName, selectedParentPath }
OpenLibrary   { selectedLibraryPath }
CloseLibrary  { libraryId }
```

事件：

```text
LibraryOpening
LibraryOpened
LibraryOpenFailed
LibraryClosed
```

路径只能来自 Main 的系统选择器结果或 Worker 从已打开资源库内部派生；Renderer 不能自行传入任意路径执行文件操作。

生产目录选择器和测试目录选择器通过 Main 内部依赖注入切换；测试适配器只允许在测试构建中启用，生产 Renderer 不存在切换入口。

第二实例没有文件关联请求时只聚焦现有主窗口。macOS 关闭最后一个窗口不等于退出应用，Worker 和已打开连接保持；显式 Quit 才执行 Worker 优雅关闭和数据库释放。

## 测试计划

### 单元测试

- 资源库名称和路径约束。
- IPC 请求/响应 schema 接受有效输入并拒绝畸形输入。
- 错误映射不泄露内部堆栈或凭据。
- 名称规则覆盖 Unicode、空白、`.`/`..`、路径分隔符、控制字符、Windows 保留名和尾随点/空格。
- migration 顺序、幂等检查、事务回滚和版本过新拒绝。
- 目录布局校验。

### Worker 集成测试

- 在临时目录创建资源库并验证目录、数据库和身份。
- 关闭后重新打开同一资源库。
- 创建目标冲突、不可写目录和中途失败时不留下可被误认为有效资源库的目录。
- 非资源库目录、缺失数据库、损坏数据库和未来 schema 版本返回稳定错误。
- 同一 Worker 对同一资源库不建立重复连接。

### Electron 冒烟测试

- 应用启动并显示空状态。
- Renderer 中不存在 Node 和任意文件系统访问。
- 通过测试用对话框适配器创建并重新打开资源库。
- 第二次启动不会创建第二个独立应用进程。
- 第二次启动聚焦现有主窗口。
- 关闭窗口和应用时 Worker 与数据库连接正常退出。

## 完成标准

- 全部测试通过，类型检查和 lint 通过。
- Windows 与 macOS 至少各完成一次打包后创建/打开资源库冒烟测试。
- Renderer sandbox 与 `contextIsolation` 在打包构建中保持开启。
- Main 不包含资源库 SQL、迁移或资产文件读写。
- 资源库创建失败不会留下看似有效的半成品。
- 创建的资源库可以整体移动到新路径后再次打开，`library_id` 保持不变。
- 错误场景有稳定错误码和用户可理解提示。
- `docs/development/0001-library-shell-development-log.md` 持续记录实现决定、命令结果、失败与偏离。
- `docs/reviews/0001-library-shell-code-review.md` 保存 Standards / Spec 双轴审查、处理状态和复审结果。
- `docs/qa/0001-library-shell-qa-report.md` 保存自动化与人工 QA 证据、未执行项和最终结论。

## 实施顺序

1. 建立 TypeScript/Electron 构建、测试、lint 和打包骨架。
2. 创建并开始维护开发日志、代码审查记录和 QA 报告骨架。
3. 定义进程边界、消息契约、错误码和运行时 schema。
4. 建立 sandboxed Renderer 与最小 Preload bridge。
5. 启动 Library Worker 并完成 MessagePort 往返测试。
6. 实现 SQLite migration runner 和最小 schema。
7. 实现原子创建资源库。
8. 实现打开、关闭、版本与结构校验。
9. 接入最小空状态/创建/打开 UI。
10. 完成 Worker 集成测试与 Electron 冒烟测试。
11. 执行双轴审查并记录处理结果。
12. 在 Windows 和 macOS 打包产物上验证并完成 QA 报告。

## 后续切片

第二切片再加入：真实文件夹树、复制导入单文件/文件夹、文件操作日志、外部新增/移动/丢失检测，以及最小资产表。媒体预览、FTS5、合集、智能合集和 AI 继续保持在更后的独立切片。
