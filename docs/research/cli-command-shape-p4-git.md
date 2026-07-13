# CLI 命令形状小调研：Perforce `p4` 与 Git

> 调研日期：2026-07-13
> 范围：仅分析命令结构、参数顺序和典型 CRUD/文件操作；来源仅为 Perforce 与 Git 官方文档。

## 结论先行

`p4` 与 Git 的常用命令都主要是**动作/工作流优先**：

```text
p4 <action> [options] <files...>
git <action> [options] [--] <paths...>
```

这种形状在“资源基本都是文件”的工具中很简洁，但 Serpent 同时拥有 asset、folder、tag、collection、smart collection、job、library 等多类一等资源。若直接照搬，会迅速出现 `add`、`remove`、`list`、`import` 的目标歧义。

因此本文推荐 Serpent 使用**资源优先、动作第二**：

```text
serpent <resource> <action> [options] [--] <targets...>
```

例如 `serpent asset import ...`、`serpent tag assign ...`、`serpent collection add-assets ...`。它比动作优先多一个稳定层级，但更适合多领域产品、shell completion、schema 自省和 Agent 工具发现。

## Perforce `p4`

### 基本结构

Perforce 官方给出的通用语法是：

```text
p4 [global options] command [command-specific options] [command arguments]
```

也就是：全局选项在 command 前，命令专用选项在 command 后，最后是文件或其他位置参数。[Perforce Command-line syntax](https://help.perforce.com/helix-core/server-apps/p4guide/2024.2/Content/P4Guide/syntax.syntax.html)

### 动作优先还是资源优先

常用文件命令是明显的**动作优先扁平命令**：

```text
p4 add <files...>
p4 edit <files...>
p4 delete <files...>
p4 sync <files...>
p4 submit
p4 revert <files...>
```

“文件”通常不作为显式 noun 出现在命令树中，而由末尾 `FileSpec` 隐含表达。读取列表也使用 `p4 files <FileSpec>`，这里 `files` 本身成为查询命令。[Perforce 文件命令列表](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/commands-by-functional-area.html)

P4 并不是 REST 式 CRUD：

- `add` 不是立即创建 depot 文件，而是把文件“open for add”加入 pending changelist。
- `edit` 不是直接传入字段更新资源，而是把已有文件 open for edit。
- `delete` 先从 workspace 移除并在 changelist 中标记；`submit` 后才在 depot 生效。
- 查询分散在 `files`、`opened`、`fstat` 等工作流命令中。

官方工作流明确要求 add/edit/delete 后再 `p4 submit`；`revert` 可放弃 pending change。[Work with files](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/P4Guide/basic-tasks.recurring-file.html)

### 参数顺序示例

`p4 edit` 的官方 synopsis：

```text
p4 [g-opts] edit [-c changelist] [-k -n] [-t type] [--remote=remote] file ...
```

其中 `-n` 是 preview，不改变文件或 metadata。[p4 edit](https://help.perforce.com/helix-core/server-apps/cmdref/2025.1/Content/CmdRef/p4_edit.html)

典型示例：

```text
p4 add admin-guide/...
p4 edit -c 14 ...
p4 delete -n //depot/project/...
p4 files //depot/project/...
p4 submit
```

### 对 Serpent 有价值的部分

- 全局 context 选项与命令选项分层清楚；可对应 `serpent --library ... asset list`。
- target 放最后，支持多个 target 和通配/从文件读入，适合批处理。
- `-n` preview 和 submit/revert 思想适合 Serpent 的危险批量操作，但 Serpent 不必把所有普通写操作都强制变成 changelist。
- P4 的扁平动作命令依赖“主要资源只有文件”这一前提，不适合直接复制到 Serpent。

## Git

### 基本结构

Git 同样是主程序后接一个 subcommand：

```text
git [global-options] <command> [command-options] [arguments]
```

Git 官方 CLI 约定要求：

- command 的 dashed options 应先于普通 arguments；脚本不应依赖“选项放在位置参数后仍能解析”。
- revision 在 path 前。
- revision/path 或 option/path 可能歧义时，用 `--` 显式分隔。
- 脚本应完整拼写 long option，避免未来新增选项导致缩写歧义。

来源：[Git command-line interface conventions](https://git-scm.com/docs/gitcli)。

### 动作优先还是资源优先

Git 的高频命令也是**动作/工作流优先**，资源往往隐含为工作树、index、commit、branch 或 path：

```text
git add <pathspec...>
git status [<pathspec...>]
git mv <source> <destination>
git rm <pathspec...>
git commit
git restore <pathspec...>
```

Git 并非严格动作优先：某些领域使用 noun 作为管理入口，再在选项或子命令中表达动作，例如 `git remote add`；`git branch --delete` 则把动作做成 noun command 的 option。因此 Git 的命令形状是长期演化出的混合体，并不是适合新产品原样模仿的一致 CRUD 规范。

### 典型 CRUD/文件示例

```text
# Create/Update：把新建或修改后的内容加入 index
git add -- assets/hero.png

# Read：查看状态
git status --short -- assets/

# Update identity/path：移动或重命名
git mv --dry-run old.png new.png

# Delete：从工作树与 index 移除
git rm --dry-run -- assets/unused.png

# Persist staged state
git commit -m "Update assets"
```

官方 synopsis 与行为：

- `git add [options] [--] [<pathspec>...]`，并原生提供 `--dry-run`：[git-add](https://git-scm.com/docs/git-add)。
- `git status [<options>] [--] [<pathspec>...]`：[git-status](https://git-scm.com/docs/git-status)。
- `git mv [options] <source> <destination>`，支持 `--dry-run`：[git-mv](https://git-scm.com/docs/git-mv)。
- `git rm [options] [--] [<pathspec>...]`，支持 `--dry-run`，目录递归删除必须显式 `-r`：[git-rm](https://git-scm.com/docs/git-rm)。

### 对 Serpent 有价值的部分

- `--` 应作为路径/ID 与 options 的稳定分界；尤其资产文件名可能以 `-` 开头。
- 选项在位置参数前，适合 shell 生成和 Agent 调用。
- `--dry-run` 是统一、完整拼写的危险操作预览入口。
- 批量 target 可来自 argv 或 `--pathspec-from-file`/stdin；Serpent 可提供 `--ids-from`、`--stdin` 和 NDJSON。
- Git 命令短是因为大量上下文由“当前仓库”隐含。Serpent 可以有当前 library，但写命令仍应在结果中回显实际 library，避免 Agent 操作错库。

## Serpent 候选 A：资源优先，动作第二（推荐）

### 语法

```text
serpent [global-options] <resource> <action> [options] [--] [targets...]
```

示例：

```text
# Asset
serpent --library studio asset import --folder-id fld_01 -- /shots/a.exr /shots/b.exr
serpent --library studio asset list --format json --tag environment
serpent --library studio asset update ast_01 --label "Hero" --rating 5
serpent --library studio asset move ast_01 --folder-id fld_02 --dry-run
serpent --library studio asset trash --yes -- ast_01 ast_02
serpent --library studio asset restore ast_01

# Tag
serpent --library studio tag create "Environment"
serpent --library studio tag list
serpent --library studio tag rename tag_01 "Environment Art"
serpent --library studio tag assign tag_01 --assets ast_01,ast_02
serpent --library studio tag unassign tag_01 --assets ast_02
serpent --library studio tag delete tag_01 --dry-run

# Collection
serpent --library studio collection create "Portfolio"
serpent --library studio collection list
serpent --library studio collection rename col_01 "Final Portfolio"
serpent --library studio collection add-assets col_01 --assets ast_01,ast_02
serpent --library studio collection remove-assets col_01 --assets ast_02
serpent --library studio collection delete col_01 --dry-run
```

### 优点

- 同一资源的命令在 help、completion、Skills 和 schema 中天然聚合：`serpent asset --help`。
- 动作含义由 noun 限定，不会混淆“删除资产”“删除标签”和“从合集移除资产”。
- 易于增量扩展到 `library`、`folder`、`smart-collection`、`job`、`ai`，不会污染顶层命令空间。
- Agent 先选领域再选动作，工具发现范围更小，也更容易做资源级权限和风险策略。
- 可将每个 `<resource>.<action>` 稳定映射到 Worker command/schema，例如 `asset.import`。

### 代价

- 比 `git add`/`p4 edit` 多一个词。
- 某些跨资源工作流不适合硬塞进单个 noun，应另设少量顶层 workflow，例如 `serpent search`、`serpent doctor`、`serpent schema`。

## Serpent 候选 B：动作优先，资源第二

### 语法

```text
serpent [global-options] <action> <resource> [options] [--] [targets...]
```

示例：

```text
serpent --library studio import assets --folder-id fld_01 -- /shots/a.exr
serpent --library studio list assets --tag environment
serpent --library studio update asset ast_01 --label "Hero"
serpent --library studio trash assets --yes -- ast_01 ast_02

serpent --library studio create tag "Environment"
serpent --library studio list tags
serpent --library studio rename tag tag_01 "Environment Art"
serpent --library studio assign tag tag_01 --assets ast_01,ast_02
serpent --library studio delete tag tag_01 --dry-run

serpent --library studio create collection "Portfolio"
serpent --library studio add assets --to-collection col_01 -- ast_01 ast_02
serpent --library studio remove assets --from-collection col_01 -- ast_02
```

### 优点

- 最接近 Git/P4 的肌肉记忆，口语上像“create tag”“list assets”。
- 用户按意图/动作查找命令时直接。
- 对资源种类很少的产品更短。

### 缺点

- 顶层动作会快速膨胀，`add`/`remove`/`delete` 的语义依赖后续资源和 flags。
- 关系操作很难保持一致：`assign tag`、`add assets --to-collection`、`remove assets --from-collection` 不是同一种语法形状。
- completion 和 `--help` 会把所有领域混在一起；Agent 需要读取更大的命令面。
- CRUD 动词会掩盖真实领域行为，例如 asset 的删除实际可能是 trash、永久删除或仅移除 linked record。

## 推荐及固定规则

推荐候选 A：**资源优先，动作第二**。

建议同时固定以下规则：

1. 全局 options 必须在资源前：`serpent --library X asset list`。
2. command options 在 target 前；target 可能与 option 混淆时必须支持 `--`。
3. 脚本与 Agent 文档只使用完整 long options，不依赖缩写。
4. 单数资源名用于命令 namespace：`asset`、`tag`、`collection`；输出集合不改变命令名。
5. 使用领域动词而非强行 CRUD：`asset import/trash/restore/relink`、`tag assign/unassign`、`collection add-assets/remove-assets`。
6. 所有破坏性动作统一支持 `--dry-run`；实际执行需要明确的 `--yes` 或确认令牌。
7. target 默认使用稳定 ID；允许路径或名称时必须用显式 flag，避免名称/ID/路径猜测。
8. 少量真正跨资源或诊断型能力保留顶层命令：`search`、`doctor`、`schema`、`completion`。

最终推荐形状：

```text
serpent [--library <selector>] <resource> <domain-action> [options] [--] [targets...]
```

它保留了 Git/P4 最值得继承的“选项先于位置参数、target 最后、dry-run、明确分隔符”，同时避免把面向文件版本控制的扁平动作空间错误套用到多领域数字资产管理产品。
