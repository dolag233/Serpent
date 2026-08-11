# Serpent — Claude Code 指南

> 本文件给 Claude Code 使用并进入版本控制。`AGENTS.md` 是跨工具的规范正文；本文件只补充入口，不得与其质量门禁冲突。

## 项目简介

Serpent 是一款开源（MIT）、跨平台（Windows + macOS）的数字资产管理软件，对标 Eagle/Billfish。首发用户为游戏美术、影视后期、平面/UI/品牌设计师。技术栈：Electron + TypeScript + SQLite + Vite + React。

开始工作前必须读取 `AGENTS.md`、`docs/product-brief.md`、`docs/internal/development-process.md`、`docs/internal/domain-model.md`、`docs/internal/project-status.md` 和 `docs/internal/qa/human-acceptance-checklist.md`。

## 环境约束（必读）

**源码托管在 GitHub**：[github.com/dolag233/Serpent](https://github.com/dolag233/Serpent)（private）。通过 `git clone` 拉到本地任意路径，开发完成后 `git push` 同步回远端；多设备之间用 `git pull`/`git push` 同步，不在 NAS 或网络共享目录上直接开发。

**不能从 SMB/NAS 路径跑 Electron**。在 SMB 挂载上跑 `npm start` 时 Electron 报 `icudtl.dat not found in bundle`，主进程 SIGTRAP 崩溃；打包后的 `.app` 也不能从 SMB 直接运行（code-sign/资源查找失败）。因此 `node_modules`、`.vite`、`out`、`test-results` 等环境目录必须装在本地磁盘，不要装在 NAS/网络挂载上。

**ufbx WASM 组件（`resources/ufbx/`，随仓库分发，Serpent-g05n）**：FBX 转换与 FBX 模型缩略图依赖 ufbx WASM 产物（平台无关单二进制，已提交进 git；版本与产物 SHA 锁在 `scripts/ufbx-wasm-lock.json`，v0.23.0 + Emscripten 6.0.5）。git pull 即有产物，无需本机安装 Emscripten。**仅当重建/升级 ufbx 时**才需要 Emscripten 6.0.5 + `node scripts/build-ufbx-wasm.mjs --emsdk <emsdk目录>`（产物哈希校验失败时按 lock 注释核对）。`npm run package/make` 的 `prepackage`/`premake` 会校验产物存在与哈希（`scripts/verify-ufbx-wasm.mjs`），缺失/漂移即打包失败并给出构建指引——不要跳过或删除该校验。

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

`scripts/dev-start.mjs` 自动避开被占用的 Vite 端口（`strictPort`），再启动 Forge。双实例开发：`npm run start:multi`。首次启动可能触发 Electron postinstall 下载完整 binary（含 icudtl.dat）。

## 常用命令

```bash
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npm run test           # vitest run（单元 + worker 集成）
npm run test:unit      # 仅单元测试
npm run test:worker    # 仅 worker 集成测试
npm run test:e2e       # Playwright E2E（library-lifecycle + asset-ingestion + process-lifecycle）
npm run test:e2e:packaged  # packaged app 启动测试（需先 npm run package）
npm run package        # 打包到 out/Serpent-<platform>-<arch>/
npm run verify:package # 校验 ASAR 和 better_sqlite3.node 原生模块
npm run make           # 生成平台安装包（macOS dmg / Windows zip）；Windows 安装器：npm run make:inno（ISCC → out/make/inno/SerpentSetup.exe，需先 npm run package）
# GitHub 直连不稳定时需 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
# （@electron/get 缓存命中后仍强制拉 SHASUMS256.txt 校验）。
# Windows 安装器方案（2026-08-08 决策）：WiX MSI 已回退——MSI 的 UI 语言在
# 启动时锁定，切换语言需自定义 bootstrapper（WiX 社区确认）；Inno Setup /
# NSIS 内置多语言选择（VS Code 用 Inno）。Inno Setup 已接入（独立于 Forge
# make：scripts/inno-build.mjs + assets/inno/serpentsetup.iss；语言选择、
# per-machine 安装路径、干净卸载；AppVersion 自动取自 package.json）。
# 注意：npm run package / make 会更新 dev 的 node_modules/electron binary，跑完务必执行
# npm run rebuild:native 恢复 dev native 模块（重编 better-sqlite3 并用 Electron ABI 实测 FTS5），
# 否则 npm run test 会报 better_sqlite3.node NODE_MODULE_VERSION 不匹配
# （package 用新 Electron Node ABI，dev 测试需重编译对齐）。
# Windows 特别警告：绝不要直接跑裸 npx @electron/rebuild / node-gyp——本机若装有
# vcpkg 用户级 MSBuild 集成，链接器会把 better-sqlite3 自带静态 sqlite3 错解析为 vcpkg 的
# 无 FTS5 sqlite3.dll（library.create 报 LIBRARY_CORRUPT / no such module: fts5）。
# scripts/rebuild-native.mjs 已强制 VcpkgEnabled=false 并删除 applocal 残留 dll。
```

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

## 工单管理（beads）

- **Git hooks（必装，一次性）**：工单镜像随提交/推送自动同步依赖 `.beads/hooks/` 的 git hooks。新 clone 后执行：
  ```bash
  bd hooks install
  chmod +x .beads/hooks/*   # bd install 未设执行权限，git 会忽略无权限 hook
  ```
  安装后 pre-commit 自动导出 `.beads/issues.jsonl`，pre-push 触发 bd 同步（2026-08-08 实测：此前 hook 无执行权限被 git 忽略，导致镜像与 Dolt 长期漂移、需手动 `bd export`）。

本仓库使用 beads（`bd` CLI）作为唯一工单系统。`.beads/issues.jsonl` 和 `.beads/interactions.jsonl` 是随 Git 同步的工单镜像；`.beads/embeddeddolt` 是未纳入 Git 的本地嵌入式 Dolt 数据库，不能假设会随分支切换同步。`docs/internal/implementation/mvp-ui-ux-requirements-backlog.md` 保留为需求来源、用户原话与验收记录；工单状态以 bd 为准。

- 开工前先跑 `bd ready --json` 取当前无阻塞工单，按优先级（P1 最高）选任务，不凭记忆挑活。`bd ready` 会排除已 `in_progress` / blocked / deferred 的工单。
- **排他认领（强制）**：同一工单同一时间只允许一个 agent 实施。选中后立刻 `bd update <id> --claim`（原子认领：设 assignee + `in_progress`）；不要只改状态却不认领。禁止对已是 `in_progress`、或已有其他 assignee 的工单动手；不确定时先 `bd show <id>` / `bd list --status=in_progress`。不得与其他 agent「一起做」同一工单，也不得绕过 `bd ready` 凭标题或记忆开干。
- 完成后 `bd close <id> --reason "<完成说明与提交哈希>"`。若中途放弃，把状态改回 `open` 并清掉自己的 assignee，否则会长期挡住 ready 队列。
- 发现新需求/缺陷随时开单：`bd create "<标题>" -d "<说明>" -p <0-4> -t <feature|bug|task|epic> -l "<标签>"`。优先级语义：P1=用户点名/验收失败修复，P2=本迭代主线，P3=后续打磨，P4=MVP 之后。
- 阻塞关系：`bd dep add <被阻塞 id> <阻塞 id>`；被澄清队列（`Serpent-w3b`）阻塞的工单不得自行猜测实施。
- 跨设备 / 多 agent：先 `git pull` 再用 bd；认领或关闭后尽快 `bd dolt push`（并随代码提交同步 `.beads/`），否则其他会话看不到认领状态，仍可能撞单。
- **分支合并工单（强制）**：若两个分支都提交了完整且最新的 `.beads/issues.jsonl`，合并时以两份 JSONL 为迁移输入即可，不需要再读取两个分支的 Dolt；按工单 ID 做并集，并逐项比较 `updated_at`、状态、优先级、负责人、标签、依赖和评论。`.beads/issues.jsonl` 不是 Dolt 数据库本身，不能默认它一定完整。
- **Dolt 只用于补齐快照**：合并前必须在每个分支/工作区记录 `git rev-parse HEAD`、`bd stats`，并运行 `bd export --all -o <branch>-<commit>.jsonl` 生成快照。若发现 JSONL 与 `bd list --all --json` 不一致，或某分支有未导出的本地工单，必须从该分支原工作区的 Dolt 导出后再合并；在同一工作区切换 Git 分支不会切换 `.beads/embeddeddolt`，不能把这种切换当作读取另一分支 Dolt。
- **工单迁移安全**：已有 Dolt 禁止使用 `bd init --from-jsonl`、`--reinit-local` 或覆盖式重建；使用 `bd import <snapshot> --json` 做增量 upsert。迁移后核对实际 ID 集合、重复 ID、状态/优先级冲突和依赖，再运行 `bd export -o .beads/issues.jsonl` 生成完整镜像。`bd import --dry-run` 的批次计数不能作为逐项迁移证据。
- **合并后的提交门禁**：`.beads/issues.jsonl` 与 `.beads/interactions.jsonl` 的变更必须和代码一起提交，并在开发日志中记录来源快照、迁移结果和未解决冲突。若原分支只有本地 Dolt、没有可读快照，只能恢复可靠的 ID/标题/优先级/状态；不能凭标题臆造描述、依赖或验收条件。
- 可运行 `bd prime` 获取完整命令参考。

## 当前开发状态

垂直切片推进，每切片交付代码 + 测试 + 开发日志 + 代码审查 + QA 报告（见 `docs/internal/development-process.md`）。

- 0001–0010 已有广泛实现，仍按各切片 QA 文档收口 packaged、Windows、真实外部旅程与发布阻断；不能把历史实现提交视为最终验收。
- 0012 已完成 macOS 开发态验收；0013 查看体验继续收口；0014 功能候选为 `f1330a7`，最终合流和 Windows 证据待补。
- 2026-07-16 真实使用反馈新增 0015–0019 MVP 产品化范围：中英文、亮/暗主题、命令快捷键、应用壳与发现工具栏、文件夹卡片/文件操作、标签体验与 Label 退役、Inspector/选择/瀑布流正确性。开始相关工作前必须读取 `docs/internal/implementation/mvp-ui-ux-requirements-backlog.md`。
- 当前事实、优先级和保留条件以 `docs/internal/project-status.md` 为准，不在本文件复制逐切片细节。

## 关键约束

- **平台**：macOS arm64 已验证（开发态 + Computer Use 验收）；Windows 2026-08-08 起有真机开发态验证与 package/make/Inno 安装器实测（见 `docs/internal/development/2026-08-08-windows-packaging-and-squirrel-installer-development-log.md`），但 DPI/多屏/真实媒体/签名/升级卸载等发布级条目仍待收口，相关功能不能仅凭 Windows 未测就写"通过"。
- **Node**：`>=24 <25`，`.nvmrc` 锁定 24.15.0。
- **打包后 `.app` 不能从 SMB 运行**：必须先复制到本地 APFS（macOS QA 用）。
- **共享知识进入仓库**：事故复盘、质量门禁和切片状态不得只留在 Claude memory、聊天或本机忽略文件中。
- **TypeScript pinned 6.0.3**：typescript-eslint@8.63.0 不支持 TS 7.x，等生态适配后再升。
- **标准化 UI（强制，2026-08-12 用户反馈）**：不同地方的同类 UI 必须使用同一套样式。新增/修改任何 UI 元素前，先查找并复用既有样式体系——主题变量（`--text`/`--secondary`/`--raised-2`/`--menu-item-hover-background` 等 token）、既有组件（`Tooltip`/`HoverTipHost`、`MenuSurface`、`DialogShell`、`Icon` 等）与既有 CSS 类。**禁止硬编码颜色/尺寸 fallback**（如 `#2b2d33`、`opacity: 0.62`）——会破坏亮/暗主题。hover 提示必须用标准 `data-hover-tip` / `<Tooltip>`（延迟与主题由 HoverTipHost 统一，~420ms），禁止自造 tooltip 浮层。样式审查是代码审查固定项：核对新样式只依赖主题 token 与既有类。（镜像 AGENTS.md）

## 数据兼容性纪律（强制，Serpent-033e/ADR-0028）

> 产品要求（2026-08-07）：**任何版本都必须完全兼容旧版本数据**——用户升级后旧数据要能无缝继续使用（浏览/搜索/预览/编辑全功能），不允许出现"旧数据不兼容/不可用"的情况。只读降级（ADR-0028）只是最后兜底防线，不是目标。

1. **迁移只加不改**：schema 迁移只能新增表、新增列（可为 NULL 或有默认值）、新增索引/触发器、通过表重建放宽 CHECK（保留旧列名与旧列语义）；**禁止**删除/重命名现有表、列、索引、触发器，禁止改变现有列类型或语义。违反此纪律的迁移不合并。
2. **旧数据升级必须无损可验证**：每个迁移的验收要证明「旧版本库 → 迁移后全功能可用」——数据不丢、语义不变、搜索/缩略图/标签等派生数据可重建。
3. **升级路径永远存在**：新代码打开旧版本库必须自动迁移到最新；旧代码打开新版本库只读降级（ADR-0028）；**不得引入第三种"无法打开"的状态**。
4. 迁移纪律审查是代码审查的固定项：任何涉及 `MIGRATIONS` / schema 变更的提交，审查必须核对本条。

## 验收纪律（2026-07-14 复盘新增，强制生效）

> 触发：autonomous loop 出现"部分实现 + 局部测试通过"被写成"规格覆盖完整"的系统性偏差（详见 `docs/internal/development/2026-07-14-acceptance-discipline-retrospective.md`）。下列规则覆盖"完成定义"的判定口径，Claude Code 每会话强制遵守。

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
13. **测试范围分级（默认从简）**：简单编码、文案/文档、纯样式或非功能性 UI 打磨（圆角、阴影、颜色、间距、图标微调等）**默认不跑**全套 `test` / `test:e2e` / `verify:mainline`；实现者自查或最多跑直接相关的定向单测即可。只有完成**大型功能**、跨进程行为变更，或同一会话内**多次功能性开发累计**后，才考虑扩大测试范围；触及核心体验门禁所列路径时仍按该门禁执行，不得用本条规避。

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
- `docs/internal/qa/human-acceptance-checklist.md` — 功能验收队列；UI 仅用户可标「人类验收通过」；`PLUGIN-*`/`AUT-*` 以自动化测试为准（见 `docs/internal/agent-plugin-playbook.md`）
- `docs/internal/ui/0001-studio-contact-sheet-direction.md` — UI 视觉方向
- `docs/internal/research/` — 技术调研

## 核心体验回归门禁

遵循 `AGENTS.md` 的“核心体验回归门禁”和 `docs/internal/development-process.md`。尤其禁止用 job/DOM 存在代替媒体实际解码，也禁止用关闭窗口代替完整进程重启的持久化测试。

较大功能或核心 UX 更新还必须由主 agent 使用 Computer Use 操作真实桌面应用，并以截图完成 UI/视觉验收；Claude Code 的自动化实现或测试结果不能替代该最终产品验收。

如果当前环境没有 Computer Use 或等价真实桌面控制能力，必须把该项记为未执行并移交给具备能力的 agent 或人工 QA，不得自行跳过或标记为通过。


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
