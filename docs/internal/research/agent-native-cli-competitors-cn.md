# Agent-native CLI 国内竞品研究

> 调研日期：2026-07-13
> 范围：只采用产品官方文档、官方 GitHub 组织/代码仓库和官方发布说明。本文把第一方 CLI、开发者 CLI、MCP Server、SDK 与第三方工具严格区分。

## 摘要

国内协作软件已经出现一条很清晰的新路线：**把既有产品能力包装成稳定的第一方 CLI，再用结构化输出、机器可判定错误、权限隔离、dry-run 和 Agent Skills 让 Agent 可靠调用**。飞书和钉钉是当前最完整的两个样本，企业微信则采用更薄的“动态 MCP 工具转 CLI”方式；WPS 目前更偏远程 MCP；语雀同时提供了人类交互 CLI 和独立的 MCP/Skills 生态，但两者成熟度与安全契约不等同。

对 Serpent 最有价值的结论不是“做一个能调 API 的命令行”，而是：

1. CLI 应当是 GUI 之外的**第一方、稳定、可测试的产品入口**，而不是数据库脚本或 Electron UI 自动化。
2. Agent-native 的基础是稳定协议，不是自然语言包装：默认 JSON、stdout/stderr 分离、稳定退出码、结构化错误、分页、幂等与批处理部分失败语义。
3. 人类确认和 Agent 自动化不能二选一：高风险命令默认拒绝非交互执行，明确提供 `--dry-run`、`--yes`/确认令牌和可审计日志。
4. Skills 适合作为“如何正确编排 CLI”的说明层，不应成为唯一能力层；CLI 自身必须可以被任意 shell、脚本和 Agent 调用。
5. Serpent 是本地优先产品，不能照搬云产品的薄 API 客户端。CLI 与 GUI 应复用同一应用服务和 Library Worker，不应各自直接写 SQLite 或实现两套业务规则。

## 先澄清：“飞书 CLI”不是一个产品

官方资料中至少有四类容易被混称为“飞书 CLI”的能力：

| 名称 | 官方定位 | 是否面向终端用户/Agent 操作飞书业务 |
| --- | --- | --- |
| `lark-cli` | 第一方 Lark/飞书业务 CLI，覆盖消息、文档、多维表格、日历、邮件、任务等，并明确声明为 humans and AI Agents 构建 | 是；这是本研究主要参考对象 |
| `opdev` | 飞书开发者工具的命令行形式，用于新建应用项目、登录、上传代码包、真机预览等 | 否；它服务于“开发飞书应用”，不是操作日常飞书数据 |
| `ae` | 飞书低代码平台开发 CLI，用于组件/云函数开发、源码拉取部署、构建任务追踪 | 否；它服务于低代码工程生命周期 |
| 飞书 MCP | 将云文档或 OpenAPI 封装成适合模型调用的 MCP 工具 | 是，但属于 MCP Server/工具协议，不等于通用 shell CLI |

一手来源：

- `lark-cli` 官方仓库称其为“official Lark/Feishu CLI”，并明确列出 200+ 命令、Agent Skills、结构化输出和三层命令架构：[larksuite/cli README](https://github.com/larksuite/cli#readme)。
- `opdev` 官方文档的能力是新建项目、登录、上传、真机预览等应用开发操作：[飞书开发者工具-命令行](https://open.feishu.cn/document/tools-and-resources/development-tools/ide-with-commands)。
- `ae` 官方文档将场景限定为自定义组件、云函数、源码部署等低代码开发：[飞书低代码平台 CLI 概述](https://www.feishu.cn/content/667033238710)。
- 飞书官方把 MCP 描述为 OpenAPI 面向 AI 的工具化封装，并提供本地 OpenAPI MCP 与云文档 MCP：[本地 OpenAPI MCP 概述](https://open.feishu.cn/document/mcp_open_tools/mcp-overview?lang=zh-CN)、[MCP 概述](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/mcp_introduction?lang=zh-CN)。

## 飞书 `lark-cli`：当前最完整的参考样本

### 真实定位

`lark-cli` 不是 GUI 的自动化层，也不是一个只用于搭建飞书应用的开发者工具。它是独立安装的第一方业务客户端，通过飞书开放平台操作消息、文档、云盘、表格、日历、任务等业务对象。官方仓库明确把 Agent 作为一等用户，并提供 26 个 Agent Skills。[官方 README](https://github.com/larksuite/cli#readme)

### 运行架构

从官方仓库和使用方式可确认其核心形态为：

```text
Human / shell / AI Agent
          |
       lark-cli              独立 Go 可执行程序；无需飞书 GUI 或本地 daemon
          |
  shortcuts / API commands / raw API
          |
  OAuth credential + identity/scopes
          |
   Lark/Feishu Open Platform 云端 API
```

- **三层命令面**：面向人和 Agent 的高层 shortcut、与平台端点一一映射的 API command、覆盖长尾能力的 raw API。这个设计避免为了“全覆盖”而手写每个高层命令。[三层命令说明](https://github.com/larksuite/cli#three-layer-command-system)
- **没有 GUI/daemon 依赖**：安装后直接运行独立命令；登录需要浏览器或设备授权，业务命令直接访问云端。源码主体为 Go，官方安装同时支持 npm 引导和源码构建。[安装与快速开始](https://github.com/larksuite/cli#installation--quick-start)
- **Agent Skills 是编排层**：Skills 说明领域操作与安全规则，但最终仍调用同一个 CLI；并非另建一套 Agent 专用后端。[Agent Skills](https://github.com/larksuite/cli#agent-skills)
- **事件是显式长连接命令**：实时事件通过 WebSocket 消费并按 NDJSON 输出，而不是要求常驻桌面 GUI。[官方 README 的 event 说明](https://github.com/larksuite/cli#features)

### 认证与权限

- 首次配置应用凭证，随后 OAuth 登录；支持按业务域、精确 scope 或推荐 scope 授权。
- 明确区分 user 与 bot 身份，并允许 `--as user|bot`；Agent 能在执行前知道自己代表谁。
- Agent 模式可使用 non-blocking device flow：先返回验证 URL/设备码，用户授权后继续轮询。
- 凭证使用操作系统原生 Keychain 保存，官方还强调输入注入与终端输出清理。

来源：[Authentication](https://github.com/larksuite/cli#authentication)、[Security & Risk Warnings](https://github.com/larksuite/cli#security--risk-warnings-read-before-use)。

### 机器接口与错误契约

- JSON 是默认输出，还支持 pretty、table、NDJSON、CSV。
- 成功只写 stdout，退出码 0；失败写 stderr，非零退出码。
- 成功与失败都有稳定 envelope；错误包含 `type`、`subtype`、上游 `code`、`message`、`hint`、`retryable` 等机器字段。
- 批处理“部分成功”被建模为第三种结果：stdout 提供每项结果，`ok:false` 且进程非零退出，不会伪装成整体成功。
- 高风险操作未确认时使用独立 `confirmation` 错误类别和退出码 10，而不是挂起等待输入。

来源：[JSON Output Contract](https://github.com/larksuite/cli#json-output-contract)、[lark-cli Error Contract](https://github.com/larksuite/cli/blob/main/errs/ERROR_CONTRACT.md)。

### 危险操作与 Agent 适配

- 有副作用的操作提供 `--dry-run`。
- 高风险操作要求显式确认；错误契约将“需要 `--yes`”作为可机器判断的类别。
- README 对 Agent 权限和 prompt injection 风险给出显式警告，不把“已 OAuth”误当作“可以无限自动执行”。
- 参数/响应 schema 可自省；Agent 不必依赖易漂移的自然语言帮助。

### 对 Serpent 的直接启示

可借鉴“三层命令”思想，但 Serpent 的第三层不能是 raw SQL。较合适的对应关系是：

```text
快捷命令（asset import、tag assign、collection add）
    -> 稳定的领域命令（与 Worker command schema 一一对应）
        -> 可自省 schema / batch protocol
```

所有层都必须经过同一领域校验、文件操作计划、日志与事务边界。

## 钉钉 `dws`：安全和企业治理更强的相似路线

钉钉官方站点直接把 DingTalk CLI 描述为“为人类和 AI Agent 而生”，官方站点链接 `DingTalk-Real-AI/dingtalk-workspace-cli` 仓库；因此它是第一方 CLI，不是社区包装。[钉钉 CLI 官方页](https://open.dingtalk.com/dingtalk-cli)、[官方仓库](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli)

### 关键设计

- **运行方式**：跨平台独立 Go 可执行程序，直接连接钉钉云端；无需钉钉桌面 GUI。大部分产品命令编译进二进制，扩展插件可以把 stdio/HTTP MCP 工具动态映射成 CLI 子命令。
- **认证**：OAuth 浏览器登录，同时提供面向 Docker/SSH/CI 的 device flow；企业管理员需要显式启用 CLI 访问。自建应用模式支持 client id/secret，凭证进入 Keychain并自动刷新。
- **多组织隔离**：每个组织为独立 profile，写命令默认只作用于当前组织；官方明确建议跨组织写入前确认目标组织。
- **输出**：支持 table/json/raw、`--jq`、NDJSON 事件流；面向 Agent 提供结构化 JSON。
- **安全**：`--dry-run` 预览，`--yes` 跳过确认；README 将 OAuth device flow、域名 allowlist、最小权限、认证与审计列为零信任边界。
- **Agent 适配**：Skills 可以 mono 安装，也可以按产品拆分以减少上下文；同时提供批量导入、日程编排等现成脚本。

来源：[DingTalk Workspace CLI README](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli#readme)、[官方更新记录](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/CHANGELOG.md)。

### 值得 Serpent 借鉴的点

1. CLI 权限可由组织/管理员总开关控制；对应到 Serpent，可考虑资源库级“允许自动化写入”策略。
2. profile 让命令目标显式化；Serpent 应有明确的 library selector，并在写操作结果中回显 library id/path identity。
3. Skills 可按领域拆分，但命令本身保持相同，避免 Agent 集成形态反过来污染核心 CLI。
4. 插件/MCP 工具映射成 CLI 子命令展示了 CLI 与 MCP 可以共享 schema，而不必维护两套手写接口。

## 企业微信 `wecom-cli`：动态 MCP 工具转 CLI

`WecomTeam/wecom-cli` 是企业微信官方团队仓库，README 明确将其定位为“让人类和 AI Agent 都能在终端中操作企业微信”的开放平台 CLI。[官方仓库](https://github.com/WecomTeam/wecom-cli)

### 运行架构与特征

```text
Human / Agent
    |
wecom-cli (Rust binary, npm distribution)
    |
动态获取业务分类、工具 schema、MCP 配置
    |
企业微信云端 MCP / API 能力
```

- 命令形态高度通用：`wecom-cli <category> <method> [json_args]`，不是为每个操作设计大量 flags。
- 分类工具列表和 schema 需要动态获取，因此**连 `--help` 都需要凭证和网络**。这证明它本质上是薄的动态工具客户端，而不是自包含的领域 CLI。
- `init` 支持扫码或 Bot ID/Secret，凭证加密保存到本地；MCP 配置也缓存为加密文件。
- 支持 stderr 日志级别和按日 JSON 日志文件；媒体下载返回本地临时路径。
- 仓库提供 Agent Skills，但当前公开命令参考没有给出类似飞书的稳定 success/error envelope、退出码分类、dry-run 或危险操作确认契约。

来源：[企业微信 CLI README](https://github.com/WecomTeam/wecom-cli#readme)、[CLI 命令参考](https://github.com/WecomTeam/wecom-cli/blob/main/docs/cli-reference.md)。

### 对 Serpent 的意义

动态 schema 能显著降低覆盖大量命令的开发成本，但不应照搬“帮助也依赖网络”的缺点。Serpent 的命令 schema 应随程序版本本地发布，并允许离线自省。通用 JSON 参数可作为低层逃生口，但高频操作仍应有可发现的 typed flags 和清晰帮助。

## WPS 365：第一方远程 MCP，尚不是通用 CLI 路线

WPS 官方开放平台已经提供基于 WPS 365 OpenAPI 的 MCP Server，架构是 Host/MCP Client 通过 Streamable HTTP 访问 WPS 云端 MCP Server。它需要与开放 API 相同的访问凭证，且目前官方文档仍要求申请试用权限。[MCP 简介](https://open.wps.cn/documents/app-integration-dev/mcp-server/introduction)、[对接指南](https://open.wps.cn/documents/app-integration-dev/mcp-server/use-guide)

需要严格区分：

- 这是**第一方远程 MCP Server**，不是第一方通用 shell CLI。
- 官方对接文档提供的是 Python MCP Client 示例；在本次查阅的官方资料中，没有发现与 `lark-cli`/`dws` 同级、面向终端用户的 WPS 业务 CLI。
- MCP 能力继承 WPS 365 API 的应用/用户授权和权限范围；操作仍依赖云端服务，不依赖本地 WPS GUI。
- MCP 会返回结构化工具结果，但危险操作确认通常由 Agent Host 或集成方负责；官方页面未展示统一的 dry-run/确认/退出码契约。

WPS 的价值在于展示另一条路线：产品只提供标准工具服务，把交互、安全确认和 Agent 编排留给 Host。对本地资产管理软件而言，这种方式不足以替代 CLI，因为 shell 自动化、批处理、离线使用和可诊断退出码仍需要本地一等客户端。

## 语雀：人类 CLI 与 Agent MCP 分离

语雀官方 GitHub 组织目前同时维护 `yuque-cli`、`yuque-mcp-server` 和 `yuque-ecosystem`，因此不能把其中任何一个社区同名项目误当官方。[语雀官方 GitHub 组织](https://github.com/yuque)

### `yuque-cli`

- 第一方交互式 Node.js CLI，核心是全屏 REPL、键盘导航、列表选择、Markdown pager/editor。
- 支持一次性 `whoami`、仓库/文档列表、打开、显示、搜索等命令，但整体明显偏人类交互。
- 使用 `YUQUE_TOKEN` 或 REPL 登录；保存 token 的文档路径是 `~/.yuque/settings.json`。
- 官方 README 没有定义 Agent 友好的 JSON envelope、稳定错误类别、dry-run 或危险操作确认协议。

来源：[yuque/yuque-cli](https://github.com/yuque/yuque-cli#readme)。

### `yuque-mcp-server` 与 Skills

- 第一方本地 stdio MCP Server，由 Agent Host 使用 `npx yuque-mcp` 拉起，直接访问语雀云 API；不依赖语雀 GUI/daemon。
- 提供 19 个用户、搜索、知识库、文档、资源、目录和小记工具，并有 Claude Code/OpenCode/Cursor 等配置与 Skills。
- token 可从环境变量或命令行参数传入；命令行参数可能被进程列表或历史记录观察，环境变量/安全凭证代理更适合生产使用。
- 当前工具清单以读取、创建、更新为主，没有展示统一 dry-run 或确认层。

来源：[yuque/yuque-mcp-server](https://github.com/yuque/yuque-mcp-server#readme)、[Yuque AI Ecosystem](https://github.com/yuque/yuque-ecosystem#readme)。

### 对 Serpent 的意义

语雀证明“人类交互 CLI”和“Agent MCP”可以分别演进，但也暴露出契约分裂风险：如果两者不是同一领域核心的两个 transport，就会出现能力、安全和错误语义不一致。Serpent 应先建立统一 command schema，再从它生成/适配 CLI 与未来 MCP。

## 横向对比

| 产品 | 第一方能力形态 | GUI/daemon 依赖 | 认证与权限 | 机器输出 | 危险操作 | Agent 适配成熟度 |
| --- | --- | --- | --- | --- | --- | --- |
| 飞书 | 完整业务 CLI + MCP + Skills；另有独立开发者 CLI | 无；独立本地 CLI 直连云 API | OAuth；user/bot；scope；Keychain；device flow | 默认 JSON；稳定 envelope；stdout/stderr；NDJSON；稳定退出码 | dry-run；确认类别；`--yes`；风险警告 | 很高 |
| 钉钉 | 完整业务 CLI + 动态 MCP 插件 + Skills | 无；独立本地 CLI 直连云端 | OAuth/device；企业管理员开关；profiles；Keychain | JSON/table/raw/NDJSON；`--jq` | dry-run；`--yes`；域名 allowlist；审计 | 很高 |
| 企业微信 | 动态 MCP 工具映射 CLI + Skills | 无 GUI；但凭证与网络是帮助/执行前提 | 扫码或 bot secret；本地加密；能力按企业规模/机器人开放 | JSON args；有 JSON 日志；公开文档未定义完整输出错误契约 | 公开文档未见统一 dry-run/确认 | 中等，薄客户端取向 |
| WPS 365 | 远程 MCP + OpenAPI | 无本地 GUI；依赖云端 MCP | 应用/用户授权；开放 API 权限；目前需申请 | MCP 结构化结果 | 主要交给 Host/集成方；官方资料未见统一 CLI 契约 | 中等，平台/企业集成取向 |
| 语雀 | 人类 REPL CLI；另有 stdio MCP + Skills | 无；均直连云 API | personal/team token；CLI 本地设置；MCP env/arg | CLI 未见稳定 JSON 契约；MCP 为结构化工具 | 未见统一 dry-run/确认 | MCP 中等，CLI 偏人类 |

## 给 Serpent 的建议性设计原则

以下是从竞品事实推导出的建议，不是竞品已验证事实。

### 1. 一个领域核心，多个入口

```text
Renderer ----\
CLI ----------> Application command layer -> Library Worker -> SQLite + filesystem
MCP (future) -/
```

GUI、CLI 和未来 MCP 只负责输入/输出适配。资产导入、移动、删除、标签、合集、搜索、AI、导入导出都必须走同一 command handler、Zod schema、事务和诊断日志。

### 2. CLI 必须能脱离 GUI 工作，但不能成为第二个数据库所有者

飞书等云产品可以让每次 CLI 进程直接调用云 API；Serpent 是本地产品，还要解决 SQLite 单写者和文件监听所有权。建议在后续架构讨论中从以下两种机制二选一或组合：

- GUI/后台核心已运行：CLI 通过认证的本地 IPC 把命令交给现有 owner。
- GUI 未运行：CLI 启动 headless core/Library Worker，持有资源库锁，命令结束后安全退出；需要长任务时升级为受控 daemon/job。

无论选择哪种机制，都不能让 CLI 绕过 Worker 直接写数据库。

### 3. 从第一版就固定机器契约

建议默认 JSON，至少包含：

```json
{
  "ok": true,
  "command": "asset.import",
  "libraryId": "...",
  "data": {},
  "meta": { "requestId": "..." }
}
```

错误必须写 stderr、返回非零退出码，并有稳定的 `type`/`reason`/`retryable`/`hint`/`logPath`。人类格式使用 `--format table|pretty`，不能反过来要求 Agent 解析彩色文本。

### 4. 显式建立风险等级

- 只读：无需确认。
- 可逆写入：默认执行，但返回变更摘要与 undo/operation id。
- 破坏性或外部副作用：默认要求确认；非交互时返回稳定的 `CONFIRMATION_REQUIRED`，由 `--yes` 或一次性确认令牌解锁。
- 批量操作：先支持 `--dry-run`/plan，再 apply；部分失败必须逐项报告并返回非零退出码。

### 5. 提供本地 schema 自省与 Skills

可参考飞书/钉钉，但避免企业微信“help 也依赖网络”的缺陷：

- `serpent schema list`
- `serpent schema show asset.import`
- `serpent capabilities --library <id>`
- 随版本发布 `serpent` Agent Skill，解释目标选择、风险规则、恢复策略和批处理模式。

Skills 只是帮助 Agent 正确使用稳定 CLI；即使没有 Skills，`--help`、schema、JSON 与退出码也必须足够完成自动化。

## 调研边界与可信度

- 本文结论截止 2026-07-13；这些产品在 2026 年更新很快，实施 Serpent CLI 前应重新核对最新稳定版。
- “未见”表示在本次查阅的官方文档与官方代码仓中没有找到，不等同于证明厂商内部或未公开版本绝对不存在。
- 未引用任何个人 GitHub、社区 MCP 或第三方 CLI 作为产品官方能力。特别是企业微信、语雀存在大量同名第三方项目，本文只采用 `WecomTeam`、`yuque` 官方组织与产品官方站点。
