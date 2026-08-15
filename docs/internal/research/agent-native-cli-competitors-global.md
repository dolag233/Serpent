# Agent 原生 CLI 竞品研究

> 调研日期：2026-07-13
> 目的：为 Serpent 原生 CLI 设计提供一手证据，重点研究非纯编译器/版本控制工具如何同时服务人类、自动化脚本与 AI agent。
> 来源约束：只使用产品官方文档、官方仓库和官方发布说明。社区 CLI、第三方封装和二手文章不作为结论依据。

## 结论摘要

Serpent 不应把“支持 agent”理解成简单增加一组 shell 命令。成熟产品实际拆成三层：

1. **确定性的能力面**：CLI 提供稳定资源标识、结构化输入输出、明确错误和非交互执行。
2. **领域语义与安全策略**：Skills 或领域命令帮助 agent 选择正确操作、解释资源关系、对高风险写入要求确认。
3. **协议适配层**：MCP 负责工具发现和自然语言调用，但不替代 CLI 的脚本、CI、管道和离线能力。

七个代表性产品给出的共同信号是：

- 最接近 Serpent 本地桌面架构的是 **Obsidian CLI**：CLI 控制既有桌面核心，应用未运行时自动拉起，而不是另开一套数据所有者。
- 最成熟的 agent-native 产品是 **飞书/Lark CLI**：三层命令体系、默认 JSON、NDJSON、统一成功/错误 envelope、schema introspection、Skills 与高风险审批协议形成完整闭环。
- 最值得借鉴的机器契约来自 **1Password CLI**：全局输出格式、稳定 ID、stdin JSON 管道、dry-run，以及把敏感“引用”与“值”分离。
- **Notion CLI** 证明 CLI 与 MCP 应互补：CLI 适合 PAT/CI 和确定性操作，托管 MCP 适合 OAuth 驱动的交互式 agent。
- **Atlassian CLI** 证明批量选择器、`--yes` 与 `--ignore-errors` 很实用，但每个子命令零散实现 `--json` 会造成契约不一致。
- **Blender** 证明桌面生产软件可以拥有真正离线、无显示器的执行内核；同时也展示了参数顺序有副作用、无统一 JSON 的长期自动化成本。
- **Slack CLI** 证明诊断信息或升级提示污染 stdout 会直接破坏 agent/脚本；官方后来专门关闭了会干扰 JSON 解析的升级通知。

因此，Serpent 推荐采用如下组合，而不是复制任何单一竞品：

```text
serpent CLI / future MCP / future Skills
                 │
                 ▼
      shared typed command registry
                 │
                 ▼
     single Serpent Core + Library Worker
                 │
                 ▼
        SQLite + filesystem + jobs
```

- CLI 是第一方、完整、确定性的能力面；MCP 和 Skills 以后从同一命令注册表生成或封装。
- CLI 绝不直接打开 SQLite。GUI 存在时连接唯一核心；GUI 不存在时自动启动无窗口核心。
- 非 TTY/agent 模式禁止依赖“当前资源库、当前文件夹、当前选中资产”等 GUI 隐式状态。
- 全局默认 JSON，成功只写 stdout，诊断只写 stderr，详细日志持久化并返回 correlation ID。
- 所有写命令统一提供 `--dry-run`；危险操作统一提供 `--yes`；覆盖语义单独使用 `--overwrite`，不让 `--force` 同时承担多个含义。
- 增加竞品普遍缺失的 `--idempotency-key` / `--request-id`，使 agent 可安全重试。

## 横向比较

| 产品 | 主要运行模型 | 离线能力 | 认证 | 资源选择 | 机器输出/流 | 写入安全 | Agent / Skills / MCP |
|---|---|---|---|---|---|---|---|
| 飞书/Lark CLI | 云 API 客户端 | 业务操作需联网 | OAuth；user/bot 身份；OS keychain | URL、token、稳定 ID、搜索 shortcut | 默认 JSON；NDJSON/CSV/table；统一 envelope | dry-run；`--yes`；Skill 高风险审批 | 26 个官方 Skills；明确“built for humans and AI Agents” |
| Notion CLI beta | 云 API + Workers 客户端 | 内容操作需联网；Worker 可本地执行 | 浏览器 OAuth、PAT、OS keychain | workspace/worker/page/data-source 稳定 ID | JSON/TSV；stdin；stream/watch | 部分 `--yes`；sync `--preview` | CLI 面向 AI coding assistants；另有托管 MCP |
| Obsidian CLI | 连接桌面 app；首命令可拉起 app | 本地 vault 操作可离线 | 继承本机 app/vault 上下文 | cwd、vault name/ID、file name、精确 path | 部分命令 JSON/TSV/CSV | 删除默认进回收站；永久删除显式提升 | 官方明确支持 agentic coding tools；未见官方通用 MCP |
| 1Password CLI | 云账户客户端；可由桌面 app 代理认证 | 官方未承诺离线 CRUD | 生物认证/桌面 app、session、service account | account/vault/item name 或 ID；`op://` URI | 全局 JSON；stdin JSON 管道 | item create/edit dry-run；force；敏感值遮蔽 | CLI/服务账户用于自动化；MCP/agent 安全层避免 secret 进入模型上下文 |
| Atlassian CLI | Jira/Admin 云 API 客户端 | 需联网 | OAuth、API token/key、bot account | site/project key/work-item key/JQL/filter ID | 每命令 `--json`；CSV；jq 管道 | `--yes`；`--ignore-errors`；批量 JSON/CSV | Rovo Dev 同包；另有云托管 Rovo MCP |
| Slack CLI | 云 API + 本地 app 开发编排 | API 操作需联网；部分项目构建本地 | workspace 登录、service token、bot/user token | team/app/channel/user/message ID | API JSON；hooks stdin/stdout JSON | 全局 `--force` 忽略警告 | 可 scaffold agent；官方 Slack MCP 与 CLI 分工 |
| Blender | 本地桌面执行引擎的 background 模式 | 完整离线 | 无 | `.blend` 路径、scene、frame、Python API | 人类日志；无统一业务 JSON | Python exit code 可配置；无通用 dry-run | 没有官方 Skills/MCP；Python 是扩展面 |

“离线”栏只依据官方承诺。1Password 的本地缓存或桌面 app 集成不能推导为官方保证的离线数据层；云产品 CLI 也不能因为凭据缓存在本地就视为离线可用。

## 1. 飞书/Lark CLI：目前最完整的 agent-native CLI

### 产品定位与运行模型

官方仓库将其定义为“built for humans and AI Agents”，覆盖 Messenger、Docs、Drive、Base、Sheets、Calendar、Mail、Tasks 等 18 个业务域，拥有 200+ 命令和 26 个 Agent Skills。它本身是调用飞书开放平台的云 API 客户端，不连接飞书桌面 app，也不提供离线数据所有权。[官方仓库与 README](https://github.com/larksuite/cli)

最重要的设计是三层命令体系：

1. **Shortcuts**：面向人类和 agent 的高层领域操作，使用 smart defaults、扁平参数和 dry-run。
2. **API Commands**：由官方 OpenAPI 元数据生成并经过质量门禁，1:1 对应 API endpoint。
3. **Raw API**：允许调用 2500+ API，保证长尾覆盖。

这避免了两个极端：只有底层 API 会让 agent 猜复杂 payload；只有精选 shortcut 又会长期缺功能。[官方 README：Three-Layer Command System](https://github.com/larksuite/cli#three-layer-command-system)

### 认证与身份

- `auth login` 支持交互选择 scope、按 domain 选择、精确 scope 和 `--recommend`。
- agent 可使用 `--no-wait` 立即取得验证 URL 和 device code，再把 URL 交给用户，之后恢复轮询。
- 命令显式区分 `--as user` 与 `--as bot`；相同 API 在不同身份下有不同成员关系、可见性和权限语义。
- 官方 README 声明凭据保存到 OS-native keychain，并提供输入注入防护与终端输出清理。[官方 README：Authentication 与 Security](https://github.com/larksuite/cli#authentication)

对 Serpent 的启发不是复制 OAuth，而是**把执行身份与执行上下文显式化**。未来如果 Serpent 出现用户、插件、自动化 token 等身份，不能只依赖“当前 GUI 用户”。

### 资源选择器

飞书资源不是统一路径，而是带类型的稳定 token/ID：例如 chat `oc_xxx`、message `om_xxx`、Drive folder token、file token 和 wiki token。官方 Drive Skill 明确要求：

- URL 明确时可解析 token；wiki URL 必须先 `drive +inspect` 得到底层真实类型/token。
- 搜索优先使用 `drive +search`，将“我创建的”“我负责的”“最近编辑”等自然语言映射到明确 flags。
- 写操作前把歧义 URL/token 解析成可执行对象；解析失败不得盲目换接口继续尝试。

这是一种值得 Serpent 采用的两段式模型：**Resolve（名字/路径/查询 → 稳定 ID）后再 Mutate（ID → 写操作）**。[官方 `lark-drive` Skill](https://github.com/larksuite/cli/blob/main/skills/lark-drive/SKILL.md)

### JSON、流式输出与错误契约

输出格式包含 `json`（默认）、`pretty`、`table`、`ndjson` 和 `csv`。JSON 成功写 stdout 且 exit 0：

```json
{"ok":true,"identity":"user","data":{},"meta":{"count":1}}
```

错误写 stderr 且非零退出：

```json
{"ok":false,"identity":"user","error":{"type":"api","subtype":"...","code":123,"message":"...","hint":"..."}}
```

官方特别要求调用方检查 `ok` 或退出码，而不是假设上游 API 的 `code == 0`。同时提供自动分页、页数上限、页间 delay、NDJSON 管道和实时事件 WebSocket Skill。[官方 README：Output Formats、JSON Output Contract、Pagination](https://github.com/larksuite/cli#advanced-usage)

### 确认、dry-run 与 agent safety

高层 shortcut 对有副作用的操作支持 `--dry-run`。Drive Skill 对删除、公开权限、owner 转移、版本回滚、批量覆盖/同步采用更严格的策略：必须先解析具体执行对象和冲突策略，并在当前轮得到用户对这些具体细节的确认；CLI 返回 `confirmation_required` 后，才允许追加 `--yes` 重试。[官方 `lark-drive` Skill](https://github.com/larksuite/cli/blob/main/skills/lark-drive/SKILL.md)

这是本次调研中最接近“agent 原生”的安全闭环：安全不只靠 CLI flag，也靠 Skill 的领域策略。但它仍没有覆盖所有命令的通用幂等键。

### 可借鉴与反例

可借鉴：

- 高层领域 shortcut + typed command + raw escape hatch。
- 默认 JSON，stdout/stderr 分离，稳定错误 taxonomy。
- `schema <command>` 让 agent 在运行时检查参数、响应、身份和 scopes，而不是猜字段。
- Skills 记录资源路由、禁止事项、高风险确认和失败重试边界。

反例：

- CLI、Skills 与 2500+ raw API 的表面巨大，若生成层和精选层版本不同步，会产生长期维护压力。
- 云 API 的资源 token 体系复杂；Serpent 应提供单一 canonical asset/library URI，减少跨域 token 路由。
- 没有全局 idempotency contract；agent 在网络错误后仍可能不知道一次写入是否已成功。

## 2. Notion CLI：CLI 与 MCP 的互补边界

### 产品定位与运行模型

Notion 在 2026 年推出官方 `ntn` CLI，当前仍标为 beta。官方明确说它让 developers 和 AI coding assistants 从终端读取、更新 Notion，并管理 Workers。内容和管理操作直接调用 Notion 云 API，不依赖桌面进程；Worker 既可本地执行，也可部署云端。[Notion 官方帮助](https://www.notion.com/help/use-notion-from-your-terminal-with-notion-cli)

### 认证与无界面工作流

- `ntn login` 使用浏览器授权与终端验证码比对，token 默认进入 OS keychain。
- `--no-browser` 提供设备式两段流程；无 TTY 时自动回退。
- CI、脚本和 bot 官方推荐 `NOTION_API_TOKEN`，其优先级高于 keychain。
- `NOTION_WORKSPACE_ID` 可跳过交互 workspace 选择。
- 没有 keychain 时允许 `NOTION_KEYRING=0` 写明文 `auth.json`，官方明确要求将其视为 secret。[Notion CLI 认证文档](https://developers.notion.com/cli/get-started/authentication)

Serpent 不需要云认证，但应复制“交互上下文与无界面上下文分开”的原则：TTY 可以选择，非 TTY 必须显式传 library 或配置环境变量。

### 资源选择、结构化输出与流

- Worker 解析顺序固定为 `--worker-id` > 当前目录 `workers.json`；都缺失则报错，不回退到隐式 UI 选择。
- 页面父级使用带类型引用：`page:<id>`、`database:<id>`、`data-source:<id>`。
- 常用命令支持 `--json`，列表支持无表头 TSV `--plain`，API body 可从 stdin 或文件读取。
- `workers exec --stream` 支持流式结果；sync status 默认 watch，`--no-watch` 单次返回。
- verbose 诊断进入 stderr，Authorization 默认脱敏；取消脱敏使用显式危险选项。[Notion CLI 完整命令参考](https://developers.notion.com/cli/reference/commands)

### 确认、预演和幂等

- 删除 page/worker、环境变量覆盖等操作支持 `--yes`。
- sync trigger 支持 `--preview`，返回可由 `--context` 延续的 `nextContext`。
- deploy 通过 `workers.json` 的稳定 worker ID 判断创建或更新，体现声明式“创建后收敛更新”。

但 `--json`、`--yes` 与 preview 不是全局一致；page create 仍没有通用 idempotency key，官方也没有发布稳定退出码分类表。

### Agent / MCP 关系

Notion 同时提供官方托管 MCP。CLI 是确定性的终端/CI 表面，支持 PAT；MCP 则通过工具发现与 OAuth 服务交互式 agent。二者不是互相替代。[Notion MCP 官方概览](https://developers.notion.com/guides/mcp/overview)

对 Serpent 的直接启发：先把完整能力做成共享 typed commands + CLI；未来 MCP 只负责把精选命令暴露为工具，Skills 再提供工作流语义。不要先做 MCP 后补 CLI，否则脚本能力、测试能力和 headless QA 会被协议层绑架。

## 3. Obsidian CLI：最接近 Serpent 的桌面伴随模式

### 运行模型与离线能力

Obsidian CLI 控制正在运行的 Obsidian 桌面 app。官方文档明确：app 必须运行；若未运行，首条命令会启动 app。CLI 不是第二个直接修改 vault 的独立数据进程。它对本地 vault 的读取、搜索、写入、标签、属性、任务和插件操作可在本地完成，因此不需要云服务；Sync/Publish 另有独立 `obsidian-headless` beta。[Obsidian CLI 官方文档](https://obsidian.md/help/cli)、[Obsidian Headless Sync](https://obsidian.md/help/sync/headless)

这个拓扑与 Serpent 的 ADR-0019“单一应用进程”和 ADR-0018“Library Worker 唯一拥有数据库与文件操作”高度相容。推荐 Serpent 采用同样的单核心所有权，但比 Obsidian 更进一步：GUI 未运行时启动无窗口 core，不强制产生可见窗口。

### 资源选择器与上下文漂移

Obsidian 的解析顺序很适合人类：

1. 当前工作目录是 vault 时使用该 vault，否则使用 GUI 当前活动 vault。
2. 可显式指定 `vault=<name|id>`，且必须放在命令前。
3. `file=<name>` 使用 Wikilink 名称解析；`path=<vault-relative-path>` 要求精确路径。
4. 都省略时，很多命令使用 GUI 当前活动文件。

此外，move/rename 会复用 app 的“自动更新内部链接”领域逻辑，而不是粗暴改文件。[Obsidian CLI：Target a vault/file](https://obsidian.md/help/cli)

Serpent 应吸收“人类友好选择器 + 稳定精确选择器并存”，但必须限制隐式状态：

- TTY 可提示消歧并使用最近资源库。
- `--non-interactive`、管道或 `--output json` 下必须显式 library；多匹配资产名必须报 `AMBIGUOUS_RESOURCE`。
- GUI 当前选中资产不应成为 agent 的默认目标。

### 输出与写入安全

Obsidian 多个 list/query 命令支持 `format=json|tsv|csv`，search 支持 JSON，Bases query 还支持 Markdown 与 paths；但不存在全局统一 JSON envelope，也没有 NDJSON 事件流。[Obsidian CLI 命令参考](https://obsidian.md/help/cli)

写入安全主要依赖领域默认：

- create 只有显式 `overwrite` 才覆盖。
- delete 默认进入系统或应用回收站，`permanent` 才永久删除。
- append/prepend 天生非幂等，官方没有 compare-and-set 或 request key。

这说明“安全默认”很重要，但不足以让 agent 自动恢复：没有 dry-run、稳定错误分类和公开退出码时，调用者无法区分歧义、权限、冲突或临时失败。

### Agent 与扩展面

官方明确称 developer commands 可让 agentic coding tools 自动测试和调试：包括 reload 插件、截图、读取错误、检查 DOM/CSS、执行 app 内 JavaScript；`command id=<command-id>` 可调用核心和插件注册到 Command Palette 的命令。[Obsidian CLI 产品页](https://obsidian.md/cli)

值得借鉴的是**共享命令注册表**。Serpent GUI action、CLI command、E2E test seam 和未来 MCP tool 应尽可能来自同一 typed handler，避免四套薄封装各自漂移。反例是开放任意 `eval`：Serpent 不应让 agent 获得无约束 JS/SQL/文件系统执行能力。

## 4. 1Password CLI：机器契约与最小权限

### 运行模型与认证

`op` 面向 1Password 云账户，可选择与桌面 app 集成：CLI 通过已解锁 app 使用 Touch ID、Windows Hello 或系统认证，并可在 app 中查看 CLI 活动日志。也可以在服务器/CI 使用 session 或 service account。桌面集成是认证 broker，不应被理解为离线数据所有者；官方没有承诺离线 CRUD。[1Password CLI app integration](https://www.1password.dev/cli/app-integration)

自动化方面，官方推荐 service account 并限制到所需 vault，遵循最小权限；这比让 CI 使用个人账号更稳健。[1Password：Load secrets into scripts](https://developer.1password.com/docs/cli/secrets-scripts)

### 资源选择与管道

Item CRUD 同时接受名称、稳定 ID 或 sharing link；vault 可进一步缩小范围。官方建议名称重复或担心 API rate limit 时使用 ID，并在 service account 模式要求显式 vault。列表 JSON 可以直接通过 stdin 传给 `op item get -` 或下一条命令，形成对象管道，而不是用文本字段再解析。[1Password item 命令参考](https://www.1password.dev/cli/reference/management-commands/item)

`op://vault/item/section/field` secret reference 则把“资源引用”和“敏感值”分开。agent 或配置文件可以携带引用，真实值只在运行时注入授权子进程。[1Password secret references](https://www.1password.dev/cli/secret-reference-syntax)

Serpent 可以采用相似 URI，例如：

```text
serpent://library/<library-id>/asset/<asset-id>
serpent://library/<library-id>/collection/<collection-id>
serpent://library/<library-id>/tag/<tag-id>
```

名称和路径只负责 resolve；跨命令、日志、dry-run plan 和异步 job 使用 canonical URI/ID。

### 输出、dry-run 与反例

1Password 提供全局 `--format json`、无颜色和标准时间格式；item create/edit 的 `--dry-run` 返回结果预览；JSON template 与 stdin 可避免敏感值进入 shell history。[1Password CLI reference](https://www.1password.dev/cli/reference)、[item 命令参考](https://www.1password.dev/cli/reference/management-commands/item)

不足之处：

- 名称仍可直接执行写操作，重名要靠 vault 消歧。
- `--force` 在不同命令中可能同时意味着覆盖或跳过确认。
- create 没有通用幂等键，也没有完整公开的稳定退出码 taxonomy。

Serpent 应使用统一 `--yes` 表示“确认已取得”、`--overwrite` 表示冲突策略、`--idempotency-key` 表示重试身份，三者不能混为 `--force`。

### Agent / MCP 的安全边界

1Password 的关键 agent 模式不是让模型读取 secret，而是由 `op run` 在子进程生命周期内注入。官方也建议在 MCP 配置中只保存变量引用，再由 `op run` 启动 MCP server，使 token 不进入模型上下文。[1Password Secure AI access](https://www.1password.dev/get-started/secure-ai-access)

Serpent 当前没有同类 secret 数据，但可以照搬“最小数据披露”原则：缩略图路径、原始文件绝对路径、AI key、日志中的下载 URL/query token 不应因为 CLI 默认 JSON 就全部暴露。不同命令需要显式的 public DTO。

## 5. Atlassian CLI：批量操作、确认和可恢复失败

### 运行模型与认证

ACLI 直接调用 Jira Cloud/Admin 云服务，不依赖桌面 app，业务操作需要联网。人类可用浏览器 OAuth；脚本/CI 可从 stdin 读取 API token，官方 CI 指南建议使用 bot account 和 secret variable。[ACLI auth login](https://developer.atlassian.com/cloud/acli/reference/commands/jira-auth-login/)、[ACLI CI 指南](https://developer.atlassian.com/cloud/acli/guides/use-acli-on-ci/)

### 资源选择与批量语义

Jira 命令支持多层选择器：site、project key、work item key/ID、JQL、saved filter ID，以及 JSON/CSV/file 批量输入。例如 edit/delete/transition 都可以用 key 列表、JQL 或 filter 选择整批对象。[work item edit](https://developer.atlassian.com/cloud/acli/reference/commands/jira-workitem-edit/)、[work item delete](https://developer.atlassian.com/cloud/acli/reference/commands/jira-workitem-delete/)

这对 Serpent 非常有价值：资产操作不应只接受逐个 ID，也应统一支持：

- `--asset <id>`，可重复。
- `--assets-from <jsonl|file>`。
- `--query <search-expression>`。
- `--collection <id>` / `--folder <id>`。

但任何 query-based mutation 都必须先产生冻结的 plan（包含匹配 ID 与版本），执行时不能重新查询后悄悄作用于新对象。

### 输出、确认和部分失败

ACLI 多数命令可 `--json`，查询可 `--csv` 并通过 jq/管道继续处理；部分命令支持生成输入 JSON 模板。批量写操作通常提供：

- `--yes` 跳过确认。
- `--ignore-errors` 在单项失败时继续其余对象。
- JSON 输出报告每项结果。[ACLI troubleshooting](https://developer.atlassian.com/cloud/acli/guides/troubleshooting-guide/)、[command chaining/output](https://developer.atlassian.com/cloud/acli/guides/manage-command-chaining-and-output-redirection/)

反例是契约不够统一：`--json`、`--generate-json`、`--yes` 由各子命令零散实现，没有全局 output envelope、dry-run 和稳定错误 taxonomy。`--ignore-errors` 如果没有逐项状态和最终非零退出策略，也容易让自动化误报全成功。

Serpent 应规定：批量命令即使继续执行，只要任一项失败，顶层 `ok=false` 或使用专用 partial-success exit code；JSON 中必须列出每个 asset 的 `succeeded|skipped|failed` 与 reason。

### 与 Rovo MCP 的关系

Atlassian 另有云托管 Rovo MCP，以 OAuth 2.1 或管理员允许的 API token 连接 Jira、Confluence 等产品；它遵守现有用户权限，面向 agent tool discovery。ACLI 同时包含 Rovo Dev，但 Jira CRUD CLI 与 MCP 仍是两种并列入口。[Atlassian Rovo MCP 官方概览](https://developer.atlassian.com/cloud/rovo-mcp/)

再次印证：MCP 是 agent 协议适配，CLI 是确定性脚本表面，底层领域命令和权限模型应共享。

## 6. Slack CLI：stdout 纯净与 CLI/MCP 分工

### 运行模型和认证

Slack CLI 主要用于创建、运行、部署 Slack app，也提供 `slack api` 调用任意 Web API method。API 操作需要联网；`slack run` 可在本地运行应用，但仍通过 Socket Mode 连接 Slack backend。[Slack CLI 官方文档](https://docs.slack.dev/tools/slack-cli/)

认证解析有明确优先级：显式 `--token`、指定 app 安装的 bot token、`SLACK_BOT_TOKEN`、`SLACK_USER_TOKEN`、最后才是交互 app 选择。CI 使用 service token；本地登录凭据存入 `~/.slack/credentials.json`。[`slack api` reference](https://docs.slack.dev/tools/slack-cli/reference/commands/slack_api/)、[Slack CLI authorization](https://docs.slack.dev/tools/slack-cli/guides/authorizing-the-slack-cli/)

### 资源选择与输出

全局可以选择 team/workspace、app/environment；业务 API 继续使用 channel ID、user ID、message timestamp 等稳定标识。`slack api` 支持 key=value 或 JSON body，并原样返回 API JSON。

值得特别注意的是 2026 年 v4.2.0 发布说明：官方关闭了会在 `slack manifest` JSON 输出时出现的升级通知，因为通知会干扰脚本解析；有参数的 `slack api` 也不再触发后台更新检查。[Slack CLI v4.2.0 官方发布说明](https://docs.slack.dev/changelog/2026/06/03/slack-cli/)

这是 Serpent 必须写进规格的不变量：

- JSON stdout 不能混入 banner、升级提示、进度条、warning 或日志。
- warning/diagnostic 全进 stderr；进度事件用 JSONL 或独立 fd/channel。
- 自动更新检查不得改变命令结果、退出时间或输出格式。

### Agent、MCP 和 hooks

Slack CLI v4 可用 `slack create agent` scaffold agent，官方模板内置 Slack MCP；MCP 则提供专门面向 LLM 的工具描述与 workspace 操作。官方明确区分 API（确定性 software-to-software）与 MCP（agent tool discovery）。[Slack CLI v4 agent 发布说明](https://docs.slack.dev/changelog/2026/04/10/slack-cli/)、[Slack MCP 官方概览](https://docs.slack.dev/ai/slack-mcp-server/)

CLI 与不同语言 SDK 之间使用 hooks：CLI spawn 子进程，通过 stdin 传 JSON、stdout 接 JSON，协议可使用 message boundaries 把诊断和响应分隔。这为 Serpent 将来支持 plugin/extension 命令提供了参考，但核心 Library Worker 不应执行未受信任插件代码。[Slack CLI hooks](https://docs.slack.dev/tools/slack-cli/reference/hooks/)

反例：全局 `--force` 只是“ignore warnings and continue”，语义过宽；token 解析优先级虽然方便，但隐式环境变量可能让 agent 在错误 workspace 身份下执行。Serpent 的 JSON 响应应总是回显 canonical library ID 与执行身份/模式。

## 7. Blender：真正无界面本地生产内核

### 运行模型

Blender 是本次唯一成熟的本地资产生产软件范例。`blender --background` 在没有 UI、甚至没有 X server 的环境运行，可通过 SSH 渲染；`--python`、`--python-expr` 和 `--command` 可执行任意自动化。它不需要云认证，可完整离线。[Blender Command Line Rendering](https://docs.blender.org/manual/en/latest/advanced/command_line/render.html)、[Blender Command Line Arguments](https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html)

对 Serpent 的意义：无窗口核心不等于另做一套 CLI 数据层。Blender 的 UI 和 background 模式共享同一领域内核；Serpent 也应让 GUI Main 与 headless launcher 启动相同 Library Worker 和 command handlers。

### 退出码、输出与反例

Blender 提供 `--python-exit-code <0..255>`，脚本异常可转成指定非零退出码；`--` 之后的参数原样传给 Python。这对 CI 很重要，但没有统一业务 JSON envelope，stdout 主要是人类日志，结构化输出要由脚本自建。[Blender CLI Python options](https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html)

最大的反例是参数**按出现顺序立即生效**。官方示例指出，先 render 再设置 output 或在设置后加载 `.blend` 都会得到错误结果。一个命令的最终语义依赖 flags 排列，不利于 agent 生成和重试。

Serpent 命令必须先完整 parse + validate，再生成 plan，最后执行；flags 顺序不能改变语义。也不应复制 Blender 的任意 Python/JS escape hatch，因为 Serpent 的核心安全不变量是 Renderer/CLI 不获得 SQL 与任意路径写权限。

## 跨产品设计规律

### 1. CLI、Skills、MCP 各自负责什么

| 层 | 主要职责 | 不应承担 |
|---|---|---|
| CLI / typed command | 确定性执行、脚本、CI、管道、离线/本地能力、稳定错误 | 自然语言意图猜测、隐式授权 |
| Skill | 领域术语、资源解析、工作流顺序、禁止事项、确认政策、重试边界 | 直接绕过 CLI/核心写数据库 |
| MCP | 工具发现、schema 暴露、agent 协议传输、OAuth/客户端集成 | 成为唯一能力面、替代 CLI、承诺完整离线 |

飞书把 Skills 建在 CLI 上；Notion、Slack、Atlassian 把 MCP 与 CLI 并列在同一平台能力上；1Password 更进一步限制 MCP/agent 接触 secret 的方式。没有证据支持“只做 MCP 就等于 agent-native”。

### 2. 资源选择器必须分人类模式与机器模式

成熟 CLI 通常同时提供：

- 人类可读名称：vault、workspace、project key、文件名。
- 精确地址：ID、token、相对路径、canonical URI。
- 集合选择：search、JQL、filter、folder、tag。
- 上下文默认：cwd 配置、环境变量、当前 app 状态。

Serpent 推荐解析优先级：

```text
explicit canonical ID / URI
  > explicit exact path within explicit library
  > explicit query / collection / folder selector
  > project config or SERPENT_LIBRARY
  > interactive picker (TTY only)
  > error (non-TTY)
```

同名匹配不得静默取第一个。query-based mutation 必须先冻结资产集合和 `entity_version`，执行时检测版本冲突。

### 3. 输出是公开 API，不是 UI 文本

推荐统一 envelope：

```json
{
  "schemaVersion": 1,
  "ok": true,
  "requestId": "...",
  "libraryId": "...",
  "data": {},
  "meta": {"count": 1}
}
```

错误：

```json
{
  "schemaVersion": 1,
  "ok": false,
  "requestId": "...",
  "libraryId": "...",
  "error": {
    "code": "AMBIGUOUS_RESOURCE",
    "message": "找到多个同名资产",
    "hint": "请改用 --asset-id",
    "retryable": false,
    "logId": "..."
  }
}
```

- stdout：唯一结果流。
- stderr：人类诊断；`--output json` 时也应为结构化错误或保持安静。
- JSONL：列表/进度/事件，每行一个带 type 的完整对象。
- 日志：持久化详细 cause/stack/OS error，响应只给稳定 reason + logId。
- exit code：同时作为 shell 快捷信号，但不能取代机器 error code。

### 4. 安全确认要和冲突策略、幂等分开

竞品普遍把若干概念塞进 `--force`，Serpent 应明确拆分：

- `--dry-run`：不产生任何持久副作用，返回与执行同构的 plan。
- `--yes`：调用方确认已理解 plan 中列出的危险操作。
- `--overwrite` / `--on-conflict keep-both|skip|replace|fail`：业务冲突策略。
- `--idempotency-key`：同 key + 同 payload 返回首次结果；同 key + 不同 payload 报错。
- `--continue-on-error`：批量单项失败是否继续，不改变最终 partial-failure 状态。

删除默认进入回收站；永久删除要求独立命令或显式 `--permanent --yes`。由 query 选择的永久删除应强制 dry-run/plan token 两阶段执行。

### 5. 长任务需要同步、异步和流三种形态

Notion 的 watch/stream、飞书的 NDJSON/事件、Slack 的 message-boundary hooks 显示单次 JSON 不足以覆盖导入、缩略图、AI、导出等 Serpent 任务。

建议：

- 默认短命令等待结果。
- `--async` 立即返回 job ID。
- `serpent job watch <id> --output jsonl` 输出状态/进度事件。
- `serpent job get|cancel|retry <id>` 使用稳定 job API。
- Ctrl+C 只取消等待；是否取消服务端 job 由显式 `--cancel-on-interrupt` 决定，避免终端断连误杀任务。

## 对 Serpent 的建议与不建议

### 建议直接进入设计约束

1. CLI 是现有核心的客户端，不直接访问 SQLite 或任意资源库路径。
2. GUI 未启动时，CLI 启动无窗口 Serpent Core；GUI 之后连接/接管同一个核心，不创建第二所有者。
3. GUI、CLI、E2E 和未来 MCP 共享 typed command registry、Zod schema 与 PublicErrorReason。
4. 所有实体有稳定 ID 和 canonical URI；名字/路径查询只做 resolve。
5. 全局 `--output json|jsonl|table`，非 TTY 默认 JSON；stdout/stderr/log 严格分层。
6. 所有 mutating command 支持 dry-run；危险操作需要 yes；冲突策略显式；批量逐项报告。
7. 幂等 key、request ID、schema version 和 log correlation ID 从第一版加入，避免以后破坏兼容。
8. agent 默认只获得领域命令，不获得 raw SQL、任意 JS eval、任意文件路径写入。
9. Skills 基于 CLI 文档与 schema 生成/维护，记录领域路由、安全政策和恢复策略；MCP 以后只包装同一能力。

### 不建议复制

- Obsidian 的活动 vault/活动文件作为非交互默认。
- Blender 的参数顺序副作用和任意 Python escape hatch。
- 1Password/Slack 的多义 `--force`。
- Atlassian/Obsidian/Notion 每个子命令自行决定是否支持 JSON、yes、preview。
- 云 CLI 常见的“创建成功但网络响应丢失后无法安全重试”。
- 把敏感绝对路径、AI key、日志 stack 或远端 token 放进默认 JSON。
- 先做 MCP 再补 CLI/核心命令，导致协议层成为领域逻辑所有者。

## 一手来源索引

### 飞书/Lark

- [Lark/Feishu CLI 官方仓库](https://github.com/larksuite/cli)
- [官方 README：Agent-native、三层命令、JSON、NDJSON、dry-run、schema](https://github.com/larksuite/cli#readme)
- [官方 Drive Skill：资源路由、高风险审批和确认协议](https://github.com/larksuite/cli/blob/main/skills/lark-drive/SKILL.md)
- [Lark OpenAPI MCP 官方仓库](https://github.com/larksuite/lark-openapi-mcp)

### Notion

- [Notion CLI 官方帮助（beta）](https://www.notion.com/help/use-notion-from-your-terminal-with-notion-cli)
- [Notion CLI authentication](https://developers.notion.com/cli/get-started/authentication)
- [Notion CLI command reference](https://developers.notion.com/cli/reference/commands)
- [Notion MCP 官方概览](https://developers.notion.com/guides/mcp/overview)

### Obsidian

- [Obsidian CLI 官方命令参考](https://obsidian.md/help/cli)
- [Obsidian CLI 产品页](https://obsidian.md/cli)
- [Obsidian Headless Sync](https://obsidian.md/help/sync/headless)
- [Obsidian Headless Publish](https://obsidian.md/help/publish/headless)

### 1Password

- [1Password CLI reference](https://www.1password.dev/cli/reference)
- [1Password desktop app integration](https://www.1password.dev/cli/app-integration)
- [1Password item CRUD、stdin、dry-run](https://www.1password.dev/cli/reference/management-commands/item)
- [1Password scripts 与 service accounts](https://developer.1password.com/docs/cli/secrets-scripts)
- [1Password secure AI access](https://www.1password.dev/get-started/secure-ai-access)

### Atlassian

- [ACLI get started 与认证](https://developer.atlassian.com/cloud/acli/guides/how-to-get-started/)
- [ACLI CI pipeline](https://developer.atlassian.com/cloud/acli/guides/use-acli-on-ci/)
- [ACLI work item edit](https://developer.atlassian.com/cloud/acli/reference/commands/jira-workitem-edit/)
- [ACLI work item delete](https://developer.atlassian.com/cloud/acli/reference/commands/jira-workitem-delete/)
- [Atlassian Rovo MCP 官方概览](https://developer.atlassian.com/cloud/rovo-mcp/)

### Slack

- [Slack CLI 官方文档](https://docs.slack.dev/tools/slack-cli/)
- [`slack api` reference](https://docs.slack.dev/tools/slack-cli/reference/commands/slack_api/)
- [Slack CLI hooks 与 JSON message boundaries](https://docs.slack.dev/tools/slack-cli/reference/hooks/)
- [Slack CLI v4 agent 支持](https://docs.slack.dev/changelog/2026/04/10/slack-cli/)
- [Slack CLI v4.2 stdout/JSON 修复](https://docs.slack.dev/changelog/2026/06/03/slack-cli/)
- [Slack MCP 官方概览](https://docs.slack.dev/ai/slack-mcp-server/)

### Blender

- [Blender Command Line Arguments](https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html)
- [Blender Command Line Rendering](https://docs.blender.org/manual/en/latest/advanced/command_line/render.html)
