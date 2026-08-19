# 2026-08-19 Beads 钩子清空 issues.jsonl 事故

## 现象

`git commit` 成功后工作区 `.beads/issues.jsonl` 变为 **0 字节**；`npm run ticket -- list` 无工单。提交日志出现 `Exported 0 issues to ...issues.jsonl`。

## 根因（双重）

1. **Git 钩子仍调用 `bd hooks run pre-commit`**（`.git/hooks/*` 由历史 `bd` 安装；模板在 `.beads/hooks/` 曾保留 Beads 集成块）。
2. **`.beads/config.yaml` 中 `export.auto: true`**：`bd` 在钩子里把 **本地 Dolt** 导出到 `issues.jsonl`。
3. **本地 embedded Dolt 与 JSONL 脱节**：`bd stats` 显示 **0 条工单**，而 Git 中 JSONL 约 900+ 行（~1.2MB）。空库导出 → 覆盖 JSONL → 文件被清空。

项目已切换为 **`scripts/ticket.mjs` 直写 JSONL**（见 `2026-08-17-text-ticket-tracker-development-log.md`），但 Dolt + 自动导出未退役，导致反复复发。

## 修复

| 项 | 改动 |
|---|---|
| 停用自动导出 | `.beads/config.yaml`：`export.auto: false`，`dolt.auto-commit: off` |
| 钩子模板 | `.beads/hooks/*` 改为 no-op，注释说明禁止 `bd export` |
| 安装脚本 | `node scripts/install-git-hooks.mjs` 将模板复制到 `.git/hooks` |
| 脚本护栏 | `ticket.mjs` `writeIssues` 拒绝把非空 JSONL 写成空 |

## 恢复数据

```bash
git checkout HEAD -- .beads/issues.jsonl
# 或从上一提交：git show HEAD:.beads/issues.jsonl > .beads/issues.jsonl
node scripts/install-git-hooks.mjs
```

## 纪律（强制）

- 工单只用 `npm run ticket -- <命令>`；**禁止** `bd export` / `bd import` / `bd dolt push` 同步工单（见 `AGENTS.md`）。
- 新 clone / 怀疑钩子时：运行 `node scripts/install-git-hooks.mjs`。
- 若 `issues.jsonl` 变空：先从 `git show HEAD:.beads/issues.jsonl` 或远端恢复，再查是否有人重跑了 `bd setup` 或恢复了旧钩子。

## 验证

- `node scripts/install-git-hooks.mjs`
- 空文件试提交不应再出现 `Exported 0 issues`
- `npx vitest run tests/unit/ticket-script.test.ts`
