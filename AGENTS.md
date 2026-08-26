# Serpent — Agent 指南

> 本文件是所有 AI agent 的仓库级规范并进入版本控制。Claude Code 还应读取 `CLAUDE.md`，Cursor 读取 `.cursor/rules/serpent.mdc`，Copilot 读取 `.github/copilot-instructions.md`；这些入口都指向同一套质量门禁。

## 项目简介

Serpent 是一款开源（MIT）、跨平台（Windows + macOS）的数字资产管理软件，对标 Eagle/Billfish。首发用户为游戏美术、影视后期、平面/UI/品牌设计师。技术栈：Electron + TypeScript + SQLite + Vite + React。

完整产品定义、领域模型、术语、开发流程都在版本控制内的 `docs/` 下。开始工作前先读 `docs/product-brief.md`、`docs/internal/development-process.md`、`docs/internal/domain-model.md`、`docs/internal/project-status.md` 和 `docs/internal/qa/human-acceptance-checklist.md`。

## 环境约束（必读）

**源码托管在 GitHub**：[github.com/dolag233/Serpent](https://github.com/dolag233/Serpent)（private）。通过 `git clone` 拉到本地任意路径，开发完成后 `git push` 同步回远端；多设备之间用 `git pull`/`git push` 同步，不在 NAS 或网络共享目录上直接开发。

**不能从 SMB/NAS 路径跑 Electron**。在 SMB 挂载上跑 `npm start` 时 Electron 报 `icudtl.dat not found in bundle`，主进程 SIGTRAP 崩溃；打包后的 `.app` 也不能从 SMB 直接运行（code-sign/资源查找失败）。因此 `node_modules`、`.vite`、`out`、`test-results` 等环境目录必须装在本地磁盘，不要装在 NAS/网络挂载上。

### 首次搭建

```bash
git clone https://github.com/dolag233/Serpent.git <本地路径>
cd <本地路径>
git checkout codex/slice-002-asset-ingestion  # 当前活跃切片分支，按需切换
npm ci --registry=https://registry.npmjs.org
```

Node 版本要求 `>=24 <25`（见 `.nvmrc` = 24.15.0），用 `nvm use` 切换。native 模块（`better-sqlite3`、Electron binary）按平台编译，每个平台独立维护 `node_modules`，不可跨平台共享。

GitHub 认证：推荐 `gh auth login`（HTTPS + web 浏览器，自动配 git credential helper），或 SSH key。

### 日常开发

本地工作副本是工作区。源码改动用 `git commit` + `git push` 同步到 GitHub；其他设备拉最新用 `git pull`。环境目录不进 git，每台设备独立维护。

## 如何启动

```bash
# 在本地工作副本根目录执行
npm start
```

`scripts/dev-start.mjs` 先选空闲环回端口并设置 `SERPENT_VITE_PORT`（Vite `strictPort`），再跑 `electron-forge start`，避免 5173 被占时 Forge 仍加载旧 URL 导致黑屏。需要两个开发实例时用 `npm run start:multi`（隔离 userData；勿对同一库双开写入）。首次启动可能触发 Electron postinstall 下载完整 binary（含 icudtl.dat）。

## 常用命令

```bash
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npm run test           # vitest run（单元 + worker 集成）
npm run test:unit      # 仅单元测试
npm run test:worker    # 仅 worker 集成测试
npm run test:library-availability  # 资源库可用性底线（改资源库相关代码时必须完整跑完）
npm run test:e2e       # Playwright E2E（library-lifecycle + asset-ingestion + process-lifecycle）
npm run test:e2e:packaged  # packaged app 启动测试（需先 npm run package）
npm run package        # 打包到 out/Serpent-<platform>-<arch>/
npm run verify:package # 校验 ASAR 和 better_sqlite3.node 原生模块
npm run make           # 生成平台安装包（macOS dmg / Windows zip + Inno Setup 安装器）
# 注意：npm run package / make 会更新 dev 的 node_modules/electron binary，跑完务必执行
# npx @electron/rebuild -f -w better-sqlite3 恢复 dev native 模块，否则 npm run test 会报
# better_sqlite3.node NODE_MODULE_VERSION 不匹配（package 用新 Electron Node ABI，dev 测试需重编译对齐）。
```

**测试临时产物清理（强制）**：每次测试完成后，必须删除本次测试生成的临时目录、导出包、数据库、媒体文件、截图等产物。只清理能够确认属于本次测试且已没有进程占用的路径；归属不明或可能属于用户的数据不得删除。

## 进程架构

```
Renderer (sandboxed, no Node)
  │ typed commands/events only
  ▼
Preload (minimal bridge, contextIsolation)
  ▼
Main (window + dialogs + process lifecycle)
  ▼
Library Worker (UtilityProcess; filesystem + SQLite owner)
```

不变量：Renderer 永远不接收任意路径读写或 SQL 能力；Main 不打开资源库数据库或扫描资产目录；Library Worker 是数据库和文件操作唯一所有者；所有跨进程 I/O 经 Zod 运行时校验。

## 工单管理（纯文本 JSONL）

当前工单真相源是 `.beads/issues.jsonl`，每行一个 JSON 工单对象，随普通 Git 提交、
拉取和合并。工单脚本不使用 SQLite、Dolt、daemon 或远端工单数据库；禁止运行
`bd dolt push`、`bd dolt pull`、`bd export`、`bd import` 来同步工单。

统一使用：

```bash
npm run ticket -- <命令>
# 等价于
node scripts/ticket.mjs <命令>
```

> **Windows/PowerShell 注意（2026-08-20 实测）**：`npm run ticket --` 经 npm 透传时
> 会丢失带值选项（`-p 1`/`-t bug`/`-l "标签"` 静默落到默认值 P2/task）。
> 请直接使用 `node scripts/ticket.mjs <命令>` 调用，参数才完整生效。

常用命令：

```bash
npm run ticket -- add "工单标题" -d "详细描述" -p 1 -t bug -l "标签1,标签2"
npm run ticket -- show <id> --json
npm run ticket -- list --status open --json
npm run ticket -- ready --json
npm run ticket -- claim <id>
npm run ticket -- desc <id> --body "替换后的描述"
npm run ticket -- desc <id> --file description.md
npm run ticket -- comment <id> --text "验收记录或澄清说明"
npm run ticket -- status <id> closed --reason "完成原因"
npm run ticket -- status <id> open --reason "用户报告回归，需要重新验证"
npm run ticket -- priority <id> 0..4
npm run ticket -- dep add <被阻塞工单> <阻塞工单>
npm run ticket -- dep remove <被阻塞工单> <阻塞工单>
npm run ticket -- delete <id>
npm run ticket -- list --all --ids-only --json
npm run ticket -- list --fields id,title,status,priority --json
```

规则：

- `add` 的优先级为 `0–4`（0 最高），类型为 `bug|feature|task|epic|chore`。
- `ready` 只列出 `open` 且没有未关闭阻塞项的工单；`claim` 会原子设置负责人和 `in_progress`。
- `desc` 支持 `--body`、`--file`、`--stdin`；`status` 支持 `open|in_progress|closed|deferred`。
- `comment` 使用 `--text` 追加对话式记录；关闭工单重开为 `open` 或 `in_progress` 时必须提供非空 `--reason`，理由会保留为评论。
- `list --all` 表示不增加过滤；`--ids-only` 和 `--fields` 用于精简 JSON 输出，默认 `--json` 仍保留完整记录。
- 有其他工单依赖时，`delete` 默认拒绝；确认清理依赖引用时才使用 `--force`。
- 脚本写入前会在锁内重新读取 JSONL 并原子替换文件；同一文件仍只允许一个写者，不要与手工编辑或其他并行写入同时操作。
- 每次会话先执行 `git pull`、`npm run ticket -- ready --json` 和
  `npm run ticket -- list --status in_progress --json`。
- 用户验收通过后用 `status <id> closed --reason "..."` 关闭工单，并同步更新
  `docs/internal/qa/human-acceptance-checklist.md`；脚本不自动 commit/push。

## 历史工单实现（Beads/Dolt，仅供迁移参考）

该实现及相关 hook 仅保留作历史迁移背景。当前工单一律按上方的纯文本
JSONL 流程操作，禁止重新启用旧数据库同步。

## 当前开发状态

垂直切片推进，每切片交付代码 + 测试 + 开发日志 + 代码审查 + QA 报告（见 `docs/internal/development-process.md`）。

- 0001–0010 已有广泛实现，仍按各切片 QA 文档收口 packaged、Windows、真实外部旅程与发布阻断；不能把历史实现提交视为最终验收。
- 0012 已完成 macOS 开发态验收；0013 查看体验继续收口；0014 功能候选为 `f1330a7`，最终合流和 Windows 证据待补。
- 2026-07-16 真实使用反馈新增 0015–0019 MVP 产品化范围：中英文、亮/暗主题、命令快捷键、应用壳与发现工具栏、文件夹卡片/文件操作、标签体验与 Label 退役、Inspector/选择/瀑布流正确性。开始相关工作前必须读取 `docs/internal/implementation/mvp-ui-ux-requirements-backlog.md`。
- 当前事实、优先级和保留条件以 `docs/internal/project-status.md` 为准，不在本文件复制逐切片细节。

## 发布规范（强制，2026-08-21 用户要求：所有规范必须强调）

发布全流程按 `docs/internal/development/release-process-and-distribution.md` 逐条执行，禁止凭印象：

- 版本号用 `npm version --no-git-tag-version`，提交 `chore(release): 版本号 x.y.z → x.y.z+1`，先落 dev。
- **打包只在 dev 分支**（main 剥离 docs/internal 后 verify-package 门禁过不了，设计如此）；main 仅作发布基线。
- **main 合流纪律**：剥离全部开发文件（`AGENTS.md`/`CLAUDE.md`/`docs/internal/`/`.beads/`/`.github/`），**单一提交完成**（merge --no-commit → git rm → 一次 commit），禁止「引入又删除」来回提交；`scripts/hooks/pre-commit` 守卫 main（`npm run install:git-hooks`）。
- **产物命名**（自动更新按名字选资产，禁止裸 exe 或 Forge 默认名）：`Serpent-win-x86-64-<ver>-portable.zip` / `-setup.zip`（Inno `SerpentSetup.exe` 打包成 zip）/ macOS `Serpent-darwin-arm64-<ver>-portable.zip` / `-package.dmg`；每个资产配同名 `.sha256`。
- **Changelog 中英双语**（中文在前），标题 `**Serpent <版本>** — 一句话 · English one-liner`，按重要度排序，次要改动概括；保存 `release-notes-<ver>.md`。
- **Release**：`gh release create v<ver> --title "Serpent <ver>" --notes-file release-notes-<ver>.md --target main`（gh 在 `C:\Program Files\GitHub CLI\gh.exe`，PATH 可能缺失用全路径）；tag `v<ver>` 指向 main 发布基线。
- 打包后必须 `npm run rebuild:native` 恢复 dev 环境（FTS5 probe OK），并切回 dev 分支。

## 关键约束

- **平台**：macOS arm64 已验证；Windows 完全未验证（无 runner）。Windows 行为（命名冲突、rename 语义、打包）是显式未验证项，不能写成"通过"。
- **Node**：`>=24 <25`，`.nvmrc` 锁定 24.15.0。
- **打包后 `.app` 不能从 SMB 运行**：必须先复制到本地 APFS（macOS QA 用）。
- **Agent 共享知识必须进仓库**：产品决定、事故复盘、质量门禁和切片状态不得只留在聊天、个人 memory 或本机忽略文件中。
- **隐私与本地环境信息（强制）**：任何提交文件（源码、测试、开发日志、文档、工单和截图 fixture 等）都不得包含开发机器的本地绝对路径、个人目录或资源库名称、隐私数据、访问令牌、API Key、密码、Cookie 或其他环境凭据。测试和示例必须使用临时目录、占位符或脱敏 fixture；提交前检查路径、密钥和个人信息，避免隐私泄露。
- **性能目标（产品质量门）**：大型资源库性能是产品目标，所有性能回归使用 `tests/worker/large-library-performance.test.ts` 的 20,000 资产基线（约 90% 可解码图片：jpg/png/webp/gif/tiff，多种横竖比例；图片长边按游戏美术口径 1% 8K / 3% 4K / 30% 2K / 余量 1K；5% 短视频：mp4/webm/mov；各 1% 的 3D/文本/音频/不支持格式），并在开发日志记录当次命令和结果。打开库主窗口壳 **1 秒内可交互**；切换文件夹/合集首屏目标 **500 ms** 内并渐进补齐；固定 token 搜索首屏目标 **1 秒** 内且只服务最新请求；Inspector 由 `AssetSummary` 先渲染文件名/尺寸/评分，首屏目标 **500 ms** 内，标签/合集/AI/技术元数据渐进加载；删除/恢复后的选择和可见卡片目标 **200 ms** 内局部更新，后台完成持久化收敛。预算是产品目标，不是把共享 CI 单次波动写成硬性通过条件；缺少真实 Electron、独立进程或 Windows 证据只能写“未验证”。
- **功能变更必须同步测试**：任何新增功能、行为变更或用户可见交互调整，都必须在同一变更中检查并同步更新受影响的单元、Worker、集成或 Electron E2E 测试。若测试因产品规格有意变化而失效，必须更新 fixture、断言和测试说明，并在开发日志中记录旧行为与新行为；不能把“测试落后于产品变化”当作完成状态，也不能通过删除测试来消除失败。
- **TypeScript pinned 6.0.3**：typescript-eslint@8.63.0 不支持 TS 7.x，等生态适配后再升。
- **标准化 UI（强制，2026-08-12 用户反馈）**：不同地方的同类 UI 必须使用同一套样式。新增/修改任何 UI 元素前，先查找并复用既有样式体系——主题变量（`--text`/`--secondary`/`--raised-2`/`--menu-item-hover-background` 等 token）、既有组件（`Tooltip`/`HoverTipHost`、`MenuSurface`、`DialogShell`、`Icon` 等）与既有 CSS 类。**禁止硬编码颜色/尺寸 fallback**（如 `#2b2d33`、`opacity: 0.62`）——会破坏亮/暗主题。hover 提示必须用标准 `data-hover-tip` / `<Tooltip>`（延迟与主题由 HoverTipHost 统一，~420ms），禁止自造 tooltip 浮层。**模态面板（模糊 scrim）必须复用 `dialog-backdrop` 且窗口控制按钮保持可点**（`--ui-layer-window-caption`，见 [`docs/internal/ui/0007-modal-caption-interactivity.md`](docs/internal/ui/0007-modal-caption-interactivity.md)，Serpent-52a9b4）。样式审查是代码审查固定项：核对新样式只依赖主题 token 与既有类。

## 验收纪律（2026-07-14 复盘新增，强制生效）

> 触发：autonomous loop 出现"部分实现 + 局部测试通过"被写成"规格覆盖完整"的系统性偏差（详见 `docs/internal/development/2026-07-14-acceptance-discipline-retrospective.md`）。下列规则覆盖"完成定义"的判定口径，所有 agent 每会话强制遵守。

1. **四列可追溯**：每项规格验收维护四列——需求条目 | 实现位置(file:line) | 自动化测试(test:line) | 人工/平台证据。任一列缺失只能写"部分完成/未验证"，不得写"覆盖完整/已验证"。
2. **代码存在 ≠ 覆盖**：failpoint/恢复路径的存在不构成覆盖证据；必须证明 failpoint 实际触发 + 进程重启 + 磁盘/DB 对账。未触发即"未验证"。
3. **增量完成 ≠ 切片完成**：增量步骤（P0/P1）完成只在"步骤"粒度标记；切片完成需规格全部条目四列齐。步骤完成 ≠ 切片 `accepted`。
4. **当前 HEAD 必须当前构建**：packaged/打包验收必须基于当前提交重新构建；构建被门禁（如 `media:verify`）阻断时只能记"未执行"，不得用旧包/旧产物证明当前 HEAD。
5. **独立最终验收**：实现者可写开发日志；最终 Spec 审查、Computer Use、`accepted` 结论由独立角色（另一 agent / 主 agent）签署。实现者不得自签 `accepted`。
6. **测试竞态先复现**：flaky/超时-重跑通过不构成关闭；必须建立稳定复现 + 定位时序耦合（全局 busy/锁/共享状态）后才能关闭。重跑通过只记"疑似 flaky，未关闭"。
7. **packaged/独立进程 E2E 必须隔离 userData**：用 temp `SERPENT_E2E_USER_DATA_PATH`，不得用默认（避免读/污染真实配置）。
8. **抑制巨型文件膨胀**：新交互（选择/菜单/批量动作）抽独立模块（controller/hook/descriptor builder），不得继续内联进 `App.tsx` 等巨型文件；新增内联 > ~60 行先拆分。
9. **文档证据实时**："通过/已验证"必须附当次命令+结果摘要；被 kill/部分执行的运行不得写成"确认绿"。
10. **禁止补丁式修复**：修复问题或编写需求时必须发掘深层原因，把整个问题和相关所有代码都纳入考量，不得直接打一个补丁以绕过问题。遇到 bug 先定位根因→理解全部影响范围→设计完整方案→一次修到位。
11. **编码后交叉审查（分级触发）**：仅在完成**大规模「功能性」编码**后（新功能、行为变更、跨模块重构；不含小修复、文案/文档、纯样式微调）才启动交叉审查，且只启动 **1 个审查 agent**（一次审查同时覆盖 Standards 与 Spec 双轴；可按变更性质侧重 regression/安全等视角）。**每次会话可用的 subagent 模型可能不同，启动审查或测试 subagent 前必须先询问用户本次使用哪个模型。**小规模变更由实现者对照门禁自查即可，不得为每次改动都开审查集群。
12. **测试后台执行**：自动化测试（尤其会弹出窗口的 Electron E2E）一律以后台任务方式运行，不得抢占用户前台窗口、打断用户正在进行的操作；确需前台观察时先征得用户同意。多个 agent/轨道并行时，由主 agent 集中串行运行 E2E，避免同时弹出多个 Electron 实例。
13. **测试范围分级（默认从简）**：简单编码、文案/文档、纯样式或非功能性 UI 打磨（圆角、阴影、颜色、间距、图标微调等）**默认不跑**全套 `test` / `test:e2e` / `verify:mainline`；实现者自查或最多跑直接相关的定向单测即可。只有完成**大型功能**、跨进程行为变更，或同一会话内**多次功能性开发累计**后，才考虑扩大测试范围；触及核心体验门禁所列路径时仍按该门禁执行，不得用本条规避。**任何资源库相关修改（打开/关闭/迁移/schema/损坏恢复/切库/library-service/library.db）必须完整跑完 `npm run test:library-availability`，不得用本条从简。**

## 磁盘与工作区洁净纪律（2026-08-26 用户要求，强制生效）

> 触发：用户实测「从硬盘删除资源库后残留 `<原资源库名>..del-xxxx` 文件夹」「导入 Billfish/Eagle 解压临时文件落 C 盘且不清理」，定性为极其严重、错误的处理方式。任何代码路径都不得在用户磁盘/工作区留下未清理的内容——未删除的残留、未清理的临时文件、悄悄写入系统盘的大体积数据，一律视为违规。

1. **删除即删除**：用户发起删除（资源库/文件夹/资产）后，目标必须被真正删除。任何失败、旁置（rename-aside）、后台兜底路径都不得静默残留；无法即时删除时（句柄占用、Defender 扫描等），必须向用户明确提示并提供再次清理入口，禁止 best-effort 静默丢弃。
2. **临时文件有始有终**：所有临时目录/文件（解压、转换、导入、导出中间产物）必须：①创建前预检目标盘空间是否充足，不足时提前提示或阻止；②任务完成或失败时在同一生命周期内清理；③进程异常退出也有回收兜底（启动时清理遗留 / 使用系统临时目录由系统回收）。
3. **不污染用户工作区**：不得在用户选择的数据目录之外（尤其系统盘）静默写入大体积内容；写入用户可见路径前必须先让用户知情。
4. **审查固定项**：任何涉及删除、临时文件、磁盘写入的变更，代码审查必须核对本条：无残留路径、无静默失败、无空间预检缺失。

## 文档入口

- `docs/product-brief.md` — 产品愿景与 MVP 边界
- `docs/internal/development-process.md` — 切片开发与质量流程
- `docs/internal/domain-model.md` / `docs/glossary.md` — 领域模型与术语
- `docs/internal/adr/0001`–`0022` — 架构决策记录
- `docs/internal/implementation/NNNN-*.md` — 切片实施规格
- `docs/internal/implementation/mvp-ui-ux-requirements-backlog.md` — 2026-07-16 新增 MVP UI/UX、文件管理需求与集中澄清队列
- `docs/internal/development/NNNN-*.md` — 切片开发日志
- `docs/internal/reviews/NNNN-*.md` — 双轴代码审查
- `docs/internal/qa/NNNN-*.md` — QA 报告
- `docs/internal/qa/human-acceptance-checklist.md` — 面向产品负责人的持续人类验收队列
- `docs/internal/ui/0001-studio-contact-sheet-direction.md` — UI 视觉方向
- `docs/internal/ui/0003-keyboard-shortcut-ux-principles.md` — 默认快捷键 UX 原则（何时配键、跨平台、查看器媒体键）
- `docs/internal/ui/0004-calm-error-and-copy-ux-principles.md` — 错误与文案语气（禁止「严重错误」、阻塞窗标题、避免焦虑）
- `docs/internal/ui/0006-progressive-loading-ux-principles.md` — 禁止同步阻塞加载；打开库约 1 秒可交互，IO 瓶颈用 placeholder 渐进补齐
- `docs/internal/research/` — 技术调研

## 人类功能验收清单（强制）

- `docs/internal/qa/human-acceptance-checklist.md` 是跨 agent 的功能验收队列。所有 agent 在开始开发前必须读取，开发过程中持续更新，不能只在会话结束时补写。
- **UI / 浏览等需人眼的条目**：按可由人类独立操作的最小功能拆分。只有功能路径已实现、相关自动化通过、无该范围已知阻断、且能写出操作步骤与预期时，才能加入「待人类验收」。自动化通过或 agent 自测**不能**把这类条目改为「人类验收通过」；仅用户本人确认后才可。用户报问题时立即改为「人类验收不通过」或「已撤回」。
- **插件 / 脚本 / MCP / Gateway（`PLUGIN-*`、`AUT-*`）**：以自动化测试为准（档位见 [`docs/internal/agent-plugin-playbook.md`](docs/internal/agent-plugin-playbook.md)）。Agent 在声明档位绿时可设「自动化验收通过」；缺档位设「自动化证据不足」；失败设「自动化未通过」。不要求人类逐步点验。packaged / Windows 未跑须在条目中标明「未执行」。
- 每完成一个新的可验收增量，必须在同一提交中更新清单，并在汇报中列出变化的 ID。

## 核心体验回归门禁

- **资源库可用性是项目最重要的底线。** 库必须能打开、可写、关闭后再打开仍能用；Desktop 不提供只读资源库；损坏自动备份/抢救。任何资源库相关修改（`library-service`、schema/`MIGRATIONS`、打开/关闭/切库、损坏恢复、library Worker 协议）都必须完整跑完 `npm run test:library-availability`，不能只跑局部单测或用「测试范围从简」跳过。该套件也是 `verify:mainline` 的先跑门禁。
- 浏览、缩略图解码、客户端查看、导入、搜索和删除是核心用户旅程。任何跨 Renderer / Preload / Main / Worker、自定义协议、CSP、媒体二进制或打包资源的修改，都必须重跑真实 Electron E2E。
- 预览测试必须证明媒体被解码：图片检查 `complete && naturalWidth > 0`；视频至少检查元数据和非零尺寸。只断言 DOM、状态或 job 成功不算通过。
- 持久化必须以“完整退出应用后重新启动”为测试边界；仅关闭窗口或复用同一 Worker 不算重启恢复。
- 多 agent 或共享工作树结束后，主 agent 必须在最终合并状态运行 `npm run verify:mainline`。详见 `docs/internal/development-process.md`。
- **主分支切勿引入开发相关文件（强制）**：`.beads/`（工单数据）与 `.github/`（CI 配置）只属于 dev；dev → main 合并前必须从合并结果中剥离两者，禁止将工单/CI 文件带入 main（2026-08-19 用户要求，详见 `docs/internal/development/release-process-and-distribution.md` §2）。
- 每个较大功能或核心 UX 更新在验收前，主 agent 必须使用 Computer Use 操作真实 Serpent 应用，并用截图检查关键 UI 状态；自动化全绿不能代替 UX/视觉验收。截图证据与发现写入对应开发日志或 QA 报告。
- 当前环境没有 Computer Use 或等价真实桌面控制能力时，该项必须记为未执行并移交给具备能力的 agent 或人工 QA；不得自行跳过或标记为通过。

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
> 旧版托管配置，当前工单流程以本文前面的“纯文本 JSONL”章节为准，禁止执行。
<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
> 旧版托管配置，当前工单流程以本文前面的“纯文本 JSONL”章节为准，禁止执行。
<!-- END BEADS CODEX SETUP -->
