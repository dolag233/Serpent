# Beads Dolt 同步与工单合并记录（2026-08-07）

> 依据 CLAUDE.md「分支合并工单（强制）」：两份分支都提交了完整且最新的 `.beads/issues.jsonl` 时，以 JSONL 为迁移输入做并集，不读取 Dolt。

## 背景

本会话（8ab6ffb）与另一会话（7db2918）并行工作后，本地 Dolt 与远端（另一会话 push 的状态）出现 non-fast-forward；`bd dolt pull` 报 issues 表 merge 冲突、merge aborted。本机无 dolt CLI，bd 未暴露冲突解决命令。

## 基线记录（合并前）

- 本地 HEAD：`8ab6ffb57de7d963d5e99e8491ea808a264a0dfe`
- 本地 Dolt：673 条；JSONL（8ab6ffb）：673 行；`bd stats`：673 total / 38 open / 48 in_progress / 12 blocked —— Dolt 与 JSONL 完全一致
- 快照：`bd export --all -o /tmp/beads-local-snapshot.jsonl`（673 条）

## 合并方法与结果

- **来源**：7db2918 的 JSONL（另一会话，随代码提交）+ 8ab6ffb 的 JSONL（本会话）
- **并集验证**：`git diff 7db2918 8ab6ffb -- .beads/issues.jsonl` 仅 +4 行（Serpent-gomd / Serpent-tcr1 / Serpent-sd9n / Serpent-5xbg），无修改、无删除——**内容层零冲突**，另一会话全部工单原样保留
- **迁移结果**：并集 = 673 条，已随 8ab6ffb 提交推送（git）
- **Dolt 层**：non-fast-forward + merge 冲突 → 按「以 JSONL 为迁移输入」规则执行 `bd dolt push --force`（Push complete）。安全性：远端 Dolt 的工单内容全部包含在已提交的 JSONL 中，force 覆盖不丢数据

## 未解决冲突

- 内容层：无
- 提示另一会话：下次 `bd dolt pull` 前若本地有未推送的 Dolt 改动，先 `bd export --all` 导出快照，避免同样冲突

## 关联工单

- `Serpent-gomd`（视频查看器播代理回归，P1）
- `Serpent-tcr1`（批量 AI 分析后 Inspector 不刷新，P1）
- `Serpent-sd9n`（HDRI 选择器 E2E 失败，P2，既有问题）
- `Serpent-5xbg`（缺失衍生件后台补生成，P1，用户点名）
