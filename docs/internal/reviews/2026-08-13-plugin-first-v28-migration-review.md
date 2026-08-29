# 2026-08-13：plugin-first v28 迁移审查

审查范围：`Serpent-btgc`，旧 plugin-first v28 库迁移到 canonical schema v36。
审查方式：实现者对照迁移 registry、schema 对象和历史 CRUD；使用真实 SQLite 历史布局 fixture 回归。Windows、packaged 未执行。

## 结论

原实现存在 P1：它识别出 plugin-first history 后只补 v24–v32 并重写 history，未执行 canonical v33–v36 的物理 schema 变更。修复后，迁移在重写 history 前逐项补齐 v33–v36，并针对已经存在的完整对象保持幂等。

## 审查要点

1. **不会只改版本号**：模型 artifact、fingerprint、operation history 和 redo stack 都在 `user_version`/history 更新前物理存在。
2. **不会吞掉半成品**：operation history 表/trigger 只存在一部分时直接失败，不继续伪装成 v36。
3. **历史可用**：迁移后实际写入一个 script barrier，并从关闭后的 SQLite 文件读取其 `source/state/policy`，证明 CRUD 路径不只是 schema smoke test。
4. **正常迁移链不变**：canonical v1–v36 的 registry 和 checksum 未修改；特殊分支只匹配严格的 plugin-first v28 fingerprint 组合。
5. **数据无损边界**：fixture 由 v23 canonical 库加 plugin-first v24–v28 migration body 构造，迁移后通过 schema/history 对账；本轮没有对用户真实库执行写入。

## 测试证据

- schema compatibility + library service + operation history：83 passed。
- 全量 worker：61 files passed、4 skipped；1022 passed、10 skipped。
- typecheck、定向 ESLint、`git diff --check`：通过。

## 未验证项

- Windows NTFS 文件锁、打包应用升级和旧库跨平台复制。
- 真实用户库备份/恢复演练。

这些项目不阻塞本工单的 macOS SQLite 迁移修复结论，但仍不能标记为跨平台发布验收通过。
