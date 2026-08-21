# 2026-08-21 资源库误恢复梯子

关联：打包后 `better-sqlite3` 无法加载、打开已有库时弹出 `recoveryBackup1` / 空库抢救。

## 根因

恢复梯子把「应用打不开 SQLite」和「备份 schema 比当前构建新」都当成主库损坏：

1. Program Files 安装包的 `better_sqlite3.node` `ERR_DLOPEN_FAILED` 被 `openLibraryPrimary` 的 fallback 映射成 `LIBRARY_CORRUPT`。
2. `primaryDatabaseIsDamaged` 在 native 模块加载失败时也返回 true，于是把主库改名为 `corrupt-backup/`。
3. 抢救在 SQLite 仍不可用时失败，却不把主库搬回去，留下「没有 `library.db`」。
4. 随后可用的构建打开该库：`NOT_A_LIBRARY` 进入梯子；`validateDatabaseBackup` 用 `verifyDatabase`（要求恰好等于当前 schema），把 v40 备份判为 `LIBRARY_VERSION_TOO_NEW` 并跳过；Assets 抢救建成空库。

`绘画资源库` 实测：隔离区与 backup-1 仍是 **7164** 资产、schema **v40**；被抢救的主库是 **0** 资产、新 `library_id`。当前源码最高 schema 仍是 v39，v40 来自更新构建留下的附加迁移；1–39 checksum 与现行 `MIGRATIONS` 一致，可按 ADR-0028 可写打开。

## 修复

- 新增 `LIBRARY_ENGINE_UNAVAILABLE`：`ERR_DLOPEN_FAILED` / 缺少 FTS5 不再当库损坏。
- 损坏探测与备份校验改用 `verifyOpenableSchema`（接受过新 schema），不再用 `verifyDatabase` 的「必须等于当前版本」。
- Assets 抢救失败时删除半成品并把隔离的主库改回去。

## 用户库处置

| 库 | 结论 |
| --- | --- |
| `E:\Resources\Serpent\绘画资源库` | 已从隔离区拷回 30MB 主库；空抢救文件改名为 `library.db.false-rescue-empty-*.db` 留底 |
| `小型资源库` / `素材资源库` / `设计-Eagle` | 主库与备份资产数一致，可继续用 |
| `\\HYPER-DOLAG\smb\nas资源库` | 当前与隔离区同 `library_id`、10 资产；隔离区标签 18、当前 6。未覆盖今日主库 |
| `E:\Resources\Serpent\参考资源库` | 只有 `Assets`，不是 Serpent 库 |

## 测试

`npm run test:library-availability`（须完整跑完）。新增：过新备份恢复主库、抢救失败回滚、引擎错误分类。
