# ADR-0028：schema 版本兼容——完全兼容旧版本数据为硬目标，只读降级为兜底

> 状态：已采纳（2026-08-07）
> 触发：Serpent-033e。2026-08-07 真实事故：一个库被未合入代码的 v34 迁移升级后，v33 构建打开时抛 `LIBRARY_VERSION_TOO_NEW` 直接拒绝打开，用户看到模糊的 "The recent library could not be reopened"。产品负责人明确：**项目公开后不允许因 schema 版本问题打不开资源库**；且**完全兼容旧版本数据是硬性要求**——只读模式只是兜底，不是目标。

## 决策

0. **原则（硬目标）**：任何版本都必须完全兼容旧版本数据——新代码打开旧库自动无损迁移到最新，升级后全功能可用（浏览/搜索/预览/编辑）。只读降级是最后防线，不代表"兼容"。
1. **旧代码打开新版本库 → 只读降级，绝不拒绝打开**：
   - `openLibrary` 先只读探测 `user_version`；高于 `SUPPORTED_SCHEMA_VERSION` 时以 SQLite `readonly` 连接打开（`openConfiguredDatabase(filename, timeout, { readonly: true })`），跳过迁移、校验、watcher、恢复等全部写路径。
   - 打开结果携带 `readOnly`、`libraryVersion`、`supportedSchemaVersion`，经 main 透传 renderer，界面显示全局只读提示条（含版本号），写操作失败统一映射为 `LIBRARY_READ_ONLY` 可操作错误。
   - SQLite 连接级只读保证写入被拒（`SQLITE_READONLY`），因此**无需枚举禁用写命令**；`publicErrorForWorkerFailure` 将 `SQLITE_READONLY` 映射为 `LIBRARY_READ_ONLY`。
   - 只读库关闭时跳过 `cancelJobs`/watcher/import 回滚等写清理（`closeLibrary` 的 `readOnly` 分支）。
   - 浏览/搜索/预览等读路径不受影响。

2. **迁移纪律（既保证旧数据升级无损，也使只读降级永远安全）**：
   - 新迁移**只允许**：新增表、新增列（可为 NULL 或有默认值）、新增索引/触发器、放宽 CHECK 约束（通过表重建时保留旧列名与旧列语义）。
   - **禁止**：删除或重命名现有表/列/索引/触发器；改变现有列的类型/语义；收紧 CHECK。
   - **每个迁移的验收必须证明「旧版本库 → 迁移后全功能可用」**：数据不丢、语义不变、搜索/缩略图/标签等派生数据可重建。违反此纪律的迁移不合并；迁移纪律审查是代码审查固定项（CLAUDE.md「数据兼容性纪律」）。
   - 版本门禁语义不变：`LIBRARY_VERSION_TOO_NEW` 仍存在于非 openLibrary 的写路径（create/import 校验），openLibrary 不再抛出。

## 理由

- 用户数据是产品底线：schema 升级造成的「打不开」是发布阻断级缺陷，任何构建顺序（先开旧库再升级）都不应出现。
- SQLite 连接级只读比命令级 gate 更可靠且零遗漏；写失败由统一错误映射兜底。
- 「只加不改」的迁移纪律把只读降级的正确性从「运行时验证」变成「结构不变量」，成本远低于对每个新结构做只读兼容测试。

## 兼容性与风险

- 若未来某个迁移违反纪律（删列/改语义），旧代码只读打开后查询可能报错 → 由纪律审查阻止，出现即视为迁移缺陷。
- 只读库的 `schema_migrations` 校验被跳过（结构未知时不校验历史，避免误报 LIBRARY_CORRUPT）。

## 测试

- `tests/worker/library-schema-readonly.test.ts`：v34 假迁移库 → 只读打开 + 版本信息；只读连接写拒绝；`SQLITE_READONLY → LIBRARY_READ_ONLY` 映射；正常库不受影响；只读库关闭无写路径。
