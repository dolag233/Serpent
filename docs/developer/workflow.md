# 分支与开发工作流

这份文档面向第一次参与 Serpent 开发的贡献者。它解释两个长期分支的职责，以及为什么开发过程中的工单、文档和验收证据必须和代码一起维护。

## `main` 与 `dev`

| 分支 | 定位 | 应该包含什么 |
| --- | --- | --- |
| `main` | 发布基线 | 可交付的软件代码、测试、资源、公开文档和构建配置；从这里打包和发布 |
| `dev` | 日常开发集成分支 | `main` 的后代，加上 `.beads/`、`AGENTS.md`、`docs/internal/` 等开发协作资料 |

`main` 的目标是“拿来发布”，`dev` 的目标是“方便持续开发”。功能分支必须从 `dev` 创建；开发、验收、工单认领和内部记录都在 `dev` 或其功能分支完成。当前仓库的开发分支名就是 `dev`。

开发资料不应被偷偷带入发布基线。不要直接把 `dev` 合并到 `main`：优先逐个 cherry-pick 已审查的功能提交；如果必须合并，使用 `--no-commit`，并在提交前移除 `.beads/`、`.codex/`、`.cursor/`、agent 指南和 `docs/internal/` 等开发专用内容。合流后检查：

```bash
git merge-base --is-ancestor main dev
git ls-tree main --name-only
```

推送 `dev` 按正常 hooks 流程执行；`main` 没有 Beads 镜像时，按仓库发布流程使用对应的 `--no-verify` 推送规则。不要为了绕过检查而删除 hooks 或跳过质量门禁。

## 一次功能开发的推荐顺序

### 1. 先了解项目和当前状态

在写代码前阅读：

- `docs/product-brief.md`：产品目标与 MVP 边界；
- `docs/internal/project-status.md`：当前前沿、已知风险和平台证据；
- `docs/internal/domain-model.md`：实体、关系和术语；
- `docs/internal/development-process.md`：质量门禁与完成定义；
- `docs/internal/qa/human-acceptance-checklist.md`：哪些能力待人类验收、哪些反馈已撤回。

再确认工作树没有别的 agent 的未提交改动：

```bash
git status --short
git branch --show-current
```

共享工作树时不要覆盖不属于本任务的改动；发现同一文件正在被别人修改，先协调范围再编辑。

### 2. 用 Beads 认领唯一工单

Serpent 的任务事实源是 Beads。先查看可做事项，再原子认领，不能凭标题直接开工：

```bash
bd ready --json
bd show <issue-id>
bd update <issue-id> --claim
```

认领后，状态会变为 `in_progress` 并记录 assignee。一个工单同一时间只能由一个 agent 实施。发现新需求就新建工单，不要把范围偷偷塞进当前工单：

```bash
bd create "简短标题" -d "背景、范围和验收条件" -p 1 -t bug -l "label"
```

完成后写清提交哈希和验证结果再关闭：

```bash
bd close <issue-id> --reason "完成说明；验证命令和结果；提交 <sha>"
```

`dev` 上的 `.beads/issues.jsonl` 是随代码提交的镜像；安装 hooks 后，提交/推送会同步镜像。Dolt 数据库不能用普通 Git merge 直接合并：跨分支迁移工单前先保存两边的 `bd export --all` 和 `bd stats`，按工单 ID 做并集并人工处理冲突。

### 3. 先写规格和开发记录，再实现

功能切片至少有以下资料，文件名按已有目录约定：

```text
docs/internal/implementation/NNNN-<slice>-vertical-slice.md
docs/internal/development/NNNN-<slice>-development-log.md
docs/internal/reviews/NNNN-<slice>-code-review.md
docs/internal/qa/NNNN-<slice>-qa-report.md
```

开发日志应在第一行代码前建立，并持续记录基线 SHA、实现决定、规格偏离、命令结果、失败根因、已知风险和下一步。聊天内容不算项目知识；重要结论必须进入 `docs/`。

### 4. 以垂直切片实现

从用户旅程出发贯穿 Renderer → Preload → Main → Worker，而不是只改一个界面或只让单元测试变绿。新增交互要复用现有 command、menu、dialog、theme token 和错误文案模式；不要在巨型 `App.tsx` 里继续堆叠大型新逻辑。

功能变更必须同步受影响的测试。根据边界选择层级：纯逻辑放 `tests/unit/`，Worker/SQLite 放 `tests/worker/`，完整跨进程旅程放 `tests/e2e/`；打包行为再跑 packaged E2E。涉及浏览、缩略图、预览、导入、搜索、删除或自定义协议时，不能只跑局部单测。

### 5. 用证据完成验收

每条规格都要能追溯到：需求、实现位置、自动化测试、人工/平台证据。没有 Windows runner、真实外部 AI、packaged 或 Computer Use 证据时，写“未验证”，不能写“通过”。大功能完成后由主 agent 在最终合流状态执行真实桌面旅程；多 agent 合流后再集中运行：

```bash
npm run verify:mainline
```

失败测试先判断是回归还是规格变化：回归修代码，规格变化同步 fixture、断言、文档和开发日志，不能删除测试来消除红灯。

## 文档应该记录什么

- 面向用户的行为写入 `docs/user-guide/`，并同步中英文和截图；
- 产品边界、术语和不可逆决定写入产品简报、领域模型或 ADR；
- 实施方案和验收条件写入 `docs/internal/implementation/`；
- 为什么这样做、怎样验证、还剩什么风险写入 `docs/internal/development/`；
- 双轴代码审查（Standards / Spec）写入 `docs/internal/reviews/`；
- 自动化、平台和人工操作证据写入 `docs/internal/qa/` 与持续验收清单。

文档中的“已验证”必须带命令、提交基线、平台和结果摘要。截图、日志和测试资源不得泄露 API Key、Token、私人路径或原始用户资产。

## 结束一个工作单元

结束前依次检查：

1. `git diff --check` 和与改动直接相关的测试；
2. 代码、测试、文档、开发日志和 `.beads` 镜像是否属于同一个变更；
3. `bd show <issue-id>` 是否记录了正确状态和 assignee；
4. `git status --short` 是否只剩本任务改动；
5. 向下一位开发者交接基线、改动文件、验证命令、未验证项和下一步。

提交和推送遵循当前用户授权；没有明确授权时，先交付工作树状态和建议命令，不擅自推送。
