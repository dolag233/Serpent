# Agent 工作队列发现指南

> 更新时间：2026-07-25  
> 目的：让 agent **不靠聊天记忆**也能找到「现在该写什么代码」，并与人类验收队列区分职责。

## 三套系统，各管一事

| 系统 | 文件 / 工具 | 管什么 | agent 用来 |
|------|-------------|--------|------------|
| **执行队列** | `bd`（`.beads/issues.jsonl`） | 无阻塞、可认领的编码/修复工单 | **开工前必查** |
| **需求来源** | `docs/implementation/mvp-ui-ux-requirements-backlog.md` | 用户原话、REQ ID、产品方向 | 理解背景；无工单则开单 |
| **功能验收清单** | `docs/qa/human-acceptance-checklist.md` | UI：人类操作通过/不通过；**PLUGIN/AUT：自动化验收** | UI 不从「待人类验收」当执行队列；PLUGIN/AUT 按测试档位更新状态；「人类验收不通过」仍是缺陷池 |

**UI「待人类验收」条目多是正常现象**：值得人点，不等于未实现。  
**插件开发**：见 [`docs/agent-plugin-playbook.md`](agent-plugin-playbook.md)。

---

## 标准开工流程（每个会话）

```bash
git pull
bd export -o .beads/issues.jsonl   # 与本地 dolt 对齐后再认单
bd ready --json                      # 无阻塞、可立即实施的工单
bd list --status=in_progress --json
```

1. 读 `docs/project-status.md` 的 **「当前前沿」**（发布阻断 vs MVP 产品化）。
2. 从 `bd ready` 按 **P0 → P1 → P2** 选一条；立刻 `bd update <id> --claim`。
3. 用 `bd show <id>` 看描述；用 `rg Serpent-<id>` / `rg REQ-` 在 `docs/` 补上下文。
4. 实现完成后：`bd close <id> --reason "…"`（若仍有 packaged/Windows 等开放条件则保持 open 并备注）。UI 增量更新清单为「待人类验收」；`PLUGIN-*`/`AUT-*` 按自动化档位更新为「自动化验收通过」等（见清单规则与 `agent-plugin-playbook.md`）。

### 分支合并前后的工单迁移（强制）

`.beads/embeddeddolt` 是本地嵌入式 Dolt 数据库，不属于 Git 版本化内容；切换分支、回退提交和普通 `git merge` 都不会把两个分支的 Dolt 工单自动合并。`.beads/issues.jsonl` 是可提交的镜像，但历史上可能只是部分导出，因此不能只比较它的行数。

每次合并包含工单变更的分支时，必须按以下流程执行：

1. 在两个分支分别记录 `git rev-parse HEAD`、`bd stats`，并导出带分支和提交标识的工单快照（例如 `bd export --all -o /tmp/serpent-beads/<branch>-<commit>.jsonl`）。快照是工单记录的迁移输入，不等同于完整 Dolt 历史备份；需要审计历史时另行使用 `bd backup`。
2. 先完成代码合并，再以两份快照按工单 ID 做并集；逐项比较 `updated_at`、状态、优先级、负责人、标签、依赖和评论。相同时间戳或语义冲突必须人工记录并解决，不能直接选择 ours/theirs。
3. 对现有 Dolt 使用 `bd import <snapshot> --json` 做增量 upsert，禁止使用 `bd init --from-jsonl`、`--reinit-local` 或覆盖式重建。`bd import --dry-run` 的 `created` 数量只是批次统计，不能当作逐项迁移证据。
4. 迁移后核对实际 ID 集合、重复 ID、状态/优先级冲突和依赖，再运行 `bd export -o .beads/issues.jsonl` 生成完整镜像；将 `.beads/issues.jsonl`、`.beads/interactions.jsonl` 与代码一起提交，并在开发日志中记录来源快照、迁移数量、冲突及验证命令。

如果原分支只有本地 Dolt、没有可读快照，只能根据可靠的 ID/标题/优先级/状态恢复工单；缺少的描述、依赖和验收字段必须显式标记为不完整，不能凭标题臆造。

---

## 真实编码待办从哪里看

### 1. 首选：`bd ready`（已过滤阻塞）

```bash
bd ready --json
bd list --status=open -q --json | jq 'sort_by(.priority) | .[] | {id, priority, title}'
```

当前应优先关注的 **open P0/P1** 类型（2026-07-25 卫生后快照，以 `bd list` 为准）：

| 优先级 | 典型工单 | 含义 |
|--------|----------|------|
| P0 | `Serpent-pxd` | 导入库后缩略图破损 |
| P1 | `Serpent-omn`, `itr`, `32p`, `5p45`, `woa`, `an1`, `4l7`, `e3e`, `7ny`, `rgp` | Windows/画布/文本/过滤等用户点名缺陷 |
| P1 | `Serpent-ak94` | EXT-003 Pinterest 浮层右键（原 `pn8k` 丢失后重建） |
| in_progress | `l67w`, `5p45`, `eaxs`, `kipk` | 已认领，勿撞单 |

### 2. 缺陷池：清单里「人类验收不通过」

这些才是 **明确要修** 的产品问题（不是「等你点通过」）：

```bash
rg '\| 人类验收不通过 \|' docs/qa/human-acceptance-checklist.md
```

当前重点（2026-07-25）：`EXT-003`、`TAG-003/004/005`、`FILTER-001`–`008`（旧 UI，已被 FILTER-013/014 替代——修 bug 时以新维度条为准）、`AICFG-011` 等。每条通常有 `Serpent-*` 或应新开 beads。

### 3. 未实现需求：backlog 无「已实现」

```bash
rg '未实现|待实施|待做' docs/implementation/mvp-ui-ux-requirements-backlog.md
```

无对应 open/in_progress 工单时：**先 `bd create` 再写代码**。例如 REQ-IGNORE-001（`v6m3`）、REQ-MEDIA-001（`aav1`）、REQ-NAV-007（`1xmk`）。

### 4. 发布阻断：切片与 project-status

`docs/project-status.md` → **当前前沿 §1 P0**：0006 打包媒体二进制、Windows runner、`verify:mainline`。这类工作往往 **跨切片**，需在 `docs/implementation/0006-*.md` 等规格里拆工单。

### 5. 不要当待办误用的来源

| 来源 | 为何不用作编码队列 |
|------|-------------------|
| 清单「待人类验收」~190 条 | 已实现待你抽时间验收；自动化/E2E 可能已绿 |
| backlog 里「待人类验收（SHELL-004）」 | 状态在清单，不在 beads |
| `暂不可验收` 长文 | 部分段落已过时；以清单 + `bd` 为准 |
| 已 `closed` 的 beads | 实现已完成；跟清单 ID 做人类验收 |

---

## 工单卫生规则（避免僵尸）

关闭 beads 工单 **仅当**：

- 人类验收已通过，或
- 实现已合流且跟踪转移到清单 ID / 新工单，或
- 被产品明确撤回 / 被另一工单取代

关闭理由必须写清单 ID 或提交哈希。示例：

```bash
bd close Serpent-xxx --reason "FOLDER-015 人类验收通过；…"
```

**不要**因为「待人类验收」就关闭工单——那时应关的是「实现工单」，验收留在清单。

若 `bd show <id>` 报不存在但清单仍引用：用 `bd create` **重建**（见 `Serpent-ak94` 接替 `pn8k`），并 `rg` 更新文档中的 ID。

---

## 快速命令备忘

```bash
# 当前 open 数量与 P1 列表
bd list --status=open -q --json

# 某 REQ 是否已有工单
rg 'REQ-MEDIA-001|Serpent-aav1' docs .beads

# 清单待验数量（信息用，非队列长度）
rg -c '\| 待人类验收 \|' docs/qa/human-acceptance-checklist.md

# 导出 beads 进 git
bd export -o .beads/issues.jsonl
```

---

## 与 AGENTS.md 的关系

- **编码做什么**：本文 + `bd ready`
- **做到什么算完成**：`AGENTS.md` 验收纪律 + 四列证据
- **你能不能标「人类验收通过」**：不能，只能标「待人类验收」
