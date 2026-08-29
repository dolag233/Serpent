# 纯文本工单脚本开发记录

## 状态

- 日期：2026-08-17
- 状态：JSONL 工单切换与反馈增量已实现
- 存储：`.beads/issues.jsonl`，每行一个 JSON 工单对象
- 目标：保留 Beads 的最小可用工作流，同时移除本地/远端二进制数据库依赖

## 本增量范围

`node scripts/ticket.mjs` 提供：

- `add`：新增工单
- `show` / `list`：查看和筛选工单
- `desc`：通过 `--body`、`--file` 或 `--stdin` 修改描述
- `status` / `close`：修改状态并记录关闭原因
- `priority`：调整工单优先级（P0–P4）并更新时间
- `comment`：追加验收、失败原因和澄清记录
- `status`：关闭工单重开为 `open` / `in_progress` 时强制 `--reason`，并保留重开评论
- `claim`：排他认领并进入 `in_progress`
- `dep add|remove`：维护阻塞依赖
- `ready`：列出无未关闭阻塞项的 `open` 工单
- `delete`：删除工单；有依赖时默认拒绝，`--force` 会清理引用
- `list`：支持 `--all`、`--ids-only` 和 `--fields` 精简输出；默认 JSON 输出保持全量兼容

脚本只读写 JSONL，不创建每工单文件、不启动 daemon、不访问 Dolt、不执行
`git commit` 或 `git push`。写操作在 lock 内重新读取文件，并使用同目录临时文件
原子替换；文档同时明确同一 JSONL 文件同一时刻只允许一个写者。

## 关键决定

1. **使用现有 `.beads/issues.jsonl`**：避免新建另一份工单真相，也保留当前 921 条
   工单和既有 Beads 字段；后续可在确认脚本稳定后停用 embedded Dolt。
2. **继续使用 Beads JSONL 结构**：依赖使用现有 `dependencies[].depends_on_id`，
   新工单可被现有查看器和迁移工具识别。
3. **命令面保持向后兼容**：`list --json` 继续输出完整对象；新增 `--fields`、
   `--ids-only` 只作为显式精简视图，`--all` 作为旧 `bd list --all` 的无过滤兼容写法。
4. **审计记录追加到 comments**：评论使用现有 Beads JSONL 的评论字段；重开理由也
   追加为标准化评论，避免状态变更后理由丢失。
5. **仓库指南切换为单一入口**：`AGENTS.md` 和 `CLAUDE.md` 只保留 JSONL 用法，
   旧 Beads/Dolt 配置压缩为不可执行的历史提示。

## 验证

- `npm run test:unit -- tests/unit/ticket-script.test.ts`
  - 结果：366 个测试文件通过，2695 个测试通过，4 个跳过。
  - 覆盖：评论追加与旧记录兼容、关闭后重开保护、重开评论审计、`--all`、
    `--ids-only`、`--fields` 和默认全量 JSON 输出。
- `npx eslint scripts/ticket.mjs tests/unit/ticket-script.test.ts`
  - 结果：通过。
- `node scripts/ticket.mjs --help`
  - 结果：帮助信息包含 `comment`、`--all`、`--ids-only` 和 `--fields`。
- `node scripts/ticket.mjs list --priority 0 --fields id,title,status,priority --json --root .`
  - 结果：成功读取当前仓库 JSONL，并返回 15 条 P0 工单的四字段精简视图。
- `git diff --check -- scripts/ticket.mjs tests/unit/ticket-script.test.ts AGENTS.md CLAUDE.md docs/internal/development/2026-08-17-text-ticket-tracker-development-log.md docs/internal/qa/human-acceptance-checklist.md`
  - 结果：通过。

未执行 packaged、Windows 或 Electron 测试：本工具是 Node CLI，不涉及桌面进程、
资源库数据库或媒体路径。

## 后续

- 用户可用 `comment`、带理由的重开和精简 `list` 视图进行验收记录。
- 不引入历史工单裁剪；embedded Dolt 仍只作为历史迁移背景保留。
