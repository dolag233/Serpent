# 2026-08-15 分支与开发工作流文档记录

## 范围

- 工单：`Serpent-iqw6`。
- 将现有 `docs/internal/development-process.md` 中的分支规则、Beads 流程、文档集合、质量门禁和验收纪律提炼到公开开发者入口，方便新贡献者理解 `main` 与 `dev` 的边界。
- 新增中英文 `docs/developer/workflow`，并在开发者 README 中加入入口。

## 核对事实

- `main` 是发布基线，只保留可交付软件和公开文档；`dev` 是日常开发分支，额外保存 `.beads/`、`AGENTS.md` 和 `docs/internal/` 等协作资料。
- 功能开发先读取产品简报、项目状态、领域模型、开发流程和人类验收清单，再用 `bd ready` → `bd show` → `bd update --claim` 认领工单。
- 规格、开发日志、代码审查、QA 报告和人类验收清单各自承担不同证据职责；“已验证”必须带命令、基线、平台和结果，未执行的平台明确标记。

## 验证

- 本次只改 Markdown 文档；未运行完整测试套件。
- `git diff --check`：通过；开发者文档本地链接检查：`NO_BROKEN_DEVELOPER_DOC_LINKS`。
