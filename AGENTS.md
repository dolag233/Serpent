# Serpent — Agent 指南

> 本文件是所有 AI agent 的仓库级规范并进入版本控制。Claude Code 还应读取 `CLAUDE.md`，Cursor 读取 `.cursor/rules/serpent.mdc`，Copilot 读取 `.github/copilot-instructions.md`；这些入口都指向同一套质量门禁。

## 项目简介

Serpent 是一款开源（MIT）、跨平台（Windows + macOS）的数字资产管理软件，对标 Eagle/Billfish。首发用户为游戏美术、影视后期、平面/UI/品牌设计师。技术栈：Electron + TypeScript + SQLite + Vite + React。

完整产品定义、领域模型、术语、开发流程都在版本控制内的 `docs/` 下。开始工作前先读 `docs/product-brief.md`、`docs/development-process.md`、`docs/domain-model.md`、`docs/project-status.md` 和 `docs/qa/human-acceptance-checklist.md`。

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
npm run test:e2e       # Playwright E2E（library-lifecycle + asset-ingestion + process-lifecycle）
npm run test:e2e:packaged  # packaged app 启动测试（需先 npm run package）
npm run package        # 打包到 out/Serpent-<platform>-<arch>/
npm run verify:package # 校验 ASAR 和 better_sqlite3.node 原生模块
npm run make           # 生成平台安装包（dmg/squirrel/zip）
# 注意：npm run package / make 会更新 dev 的 node_modules/electron binary，跑完务必执行
# npx @electron/rebuild -f -w better-sqlite3 恢复 dev native 模块，否则 npm run test 会报
# better_sqlite3.node NODE_MODULE_VERSION 不匹配（package 用新 Electron Node ABI，dev 测试需重编译对齐）。
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

本仓库使用 beads（`bd` CLI）作为唯一工单系统，`.beads/` 进版本控制随 git 同步。`docs/implementation/mvp-ui-ux-requirements-backlog.md` 保留为需求来源、用户原话与验收记录；工单状态以 bd 为准。

- 开工前先跑 `bd ready --json` 取当前无阻塞工单，按优先级（P1 最高）选任务，不凭记忆挑活。`bd ready` 会排除已 `in_progress` / blocked / deferred 的工单。
- **排他认领（强制）**：同一工单同一时间只允许一个 agent 实施。选中后立刻 `bd update <id> --claim`（原子认领：设 assignee + `in_progress`）；不要只改状态却不认领。禁止对已是 `in_progress`、或已有其他 assignee 的工单动手；不确定时先 `bd show <id>` / `bd list --status=in_progress`。不得与其他 agent「一起做」同一工单，也不得绕过 `bd ready` 凭标题或记忆开干。
- 完成后 `bd close <id> --reason "<完成说明与提交哈希>"`。若中途放弃，把状态改回 `open` 并清掉自己的 assignee，否则会长期挡住 ready 队列。
- 发现新需求/缺陷随时开单：`bd create "<标题>" -d "<说明>" -p <0-4> -t <feature|bug|task|epic> -l "<标签>"`。优先级语义：P1=用户点名/验收失败修复，P2=本迭代主线，P3=后续打磨。
- 阻塞关系：`bd dep add <被阻塞 id> <阻塞 id>`；被澄清队列（`Serpent-w3b`）阻塞的工单不得自行猜测实施。
- 跨设备 / 多 agent：先 `git pull` 再用 bd；认领或关闭后尽快 `bd dolt push`（并随代码提交同步 `.beads/`），否则其他会话看不到认领状态，仍可能撞单。
- **分支合并工单（强制）**：内置 Dolt 数据库位于未纳入 Git 分支切换的 `.beads/embeddeddolt`，不能把 `git merge` 当作工单合并；合并前必须在两个分支分别记录 `git rev-parse HEAD`、`bd export --all` 快照和 `bd stats`。合并后以两份快照按工单 ID 做并集，按 `updated_at` 逐项迁移；同时间戳或状态/优先级语义冲突必须人工记录和解决，禁止直接选 ours/theirs。
- **工单迁移安全**：已有 Dolt 数据库禁止直接运行 `bd init --from-jsonl`、`--reinit-local` 或覆盖式重建。使用 `bd import <snapshot> --json` 做增量 upsert，检查实际 ID 集合、重复 ID、状态/优先级冲突和依赖，再运行 `bd export -o .beads/issues.jsonl` 生成完整镜像；`bd import --dry-run` 的批次计数不能作为逐项迁移证据。
- **合并后的提交门禁**：`.beads/issues.jsonl` 与 `.beads/interactions.jsonl` 的工单变更必须和代码合并一起提交；提交前核对 `bd list --all --json` 与完整导出的 ID 集合一致，并在开发日志中记录来源快照、迁移结果和未解决冲突。若原分支只有本地 Dolt、没有快照，不能凭标题猜测恢复描述、依赖或验收条件。
- 可运行 `bd prime` 获取完整命令参考。
- **真实编码待办怎么查**（与「待人类验收」清单区分）：见 [`docs/agent-work-queue.md`](docs/agent-work-queue.md)。开工顺序：`bd ready --json` → `docs/project-status.md` 当前前沿 → 清单中仅「人类验收不通过」作缺陷池。

## 当前开发状态

垂直切片推进，每切片交付代码 + 测试 + 开发日志 + 代码审查 + QA 报告（见 `docs/development-process.md`）。

- 0001–0010 已有广泛实现，仍按各切片 QA 文档收口 packaged、Windows、真实外部旅程与发布阻断；不能把历史实现提交视为最终验收。
- 0012 已完成 macOS 开发态验收；0013 查看体验继续收口；0014 功能候选为 `f1330a7`，最终合流和 Windows 证据待补。
- 2026-07-16 真实使用反馈新增 0015–0019 MVP 产品化范围：中英文、亮/暗主题、命令快捷键、应用壳与发现工具栏、文件夹卡片/文件操作、标签体验与 Label 退役、Inspector/选择/瀑布流正确性。开始相关工作前必须读取 `docs/implementation/mvp-ui-ux-requirements-backlog.md`。
- 当前事实、优先级和保留条件以 `docs/project-status.md` 为准，不在本文件复制逐切片细节。

## 关键约束

- **平台**：macOS arm64 已验证；Windows 完全未验证（无 runner）。Windows 行为（命名冲突、rename 语义、打包）是显式未验证项，不能写成"通过"。
- **Node**：`>=24 <25`，`.nvmrc` 锁定 24.15.0。
- **打包后 `.app` 不能从 SMB 运行**：必须先复制到本地 APFS（macOS QA 用）。
- **Agent 共享知识必须进仓库**：产品决定、事故复盘、质量门禁和切片状态不得只留在聊天、个人 memory 或本机忽略文件中。
- **功能变更必须同步测试**：任何新增功能、行为变更或用户可见交互调整，都必须在同一变更中检查并同步更新受影响的单元、Worker、集成或 Electron E2E 测试。若测试因产品规格有意变化而失效，必须更新 fixture、断言和测试说明，并在开发日志中记录旧行为与新行为；不能把“测试落后于产品变化”当作完成状态，也不能通过删除测试来消除失败。
- **TypeScript pinned 6.0.3**：typescript-eslint@8.63.0 不支持 TS 7.x，等生态适配后再升。

## 验收纪律（2026-07-14 复盘新增，强制生效）

> 触发：autonomous loop 出现"部分实现 + 局部测试通过"被写成"规格覆盖完整"的系统性偏差（详见 `docs/development/2026-07-14-acceptance-discipline-retrospective.md`）。下列规则覆盖"完成定义"的判定口径，所有 agent 每会话强制遵守。

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
- `docs/development-process.md` — 切片开发与质量流程
- `docs/domain-model.md` / `docs/glossary.md` — 领域模型与术语
- `docs/adr/0001`–`0022` — 架构决策记录
- `docs/implementation/NNNN-*.md` — 切片实施规格
- `docs/implementation/mvp-ui-ux-requirements-backlog.md` — 2026-07-16 新增 MVP UI/UX、文件管理需求与集中澄清队列
- `docs/development/NNNN-*.md` — 切片开发日志
- `docs/reviews/NNNN-*.md` — 双轴代码审查
- `docs/qa/NNNN-*.md` — QA 报告
- `docs/qa/human-acceptance-checklist.md` — 面向产品负责人的持续人类验收队列
- `docs/ui/0001-studio-contact-sheet-direction.md` — UI 视觉方向
- `docs/ui/0003-keyboard-shortcut-ux-principles.md` — 默认快捷键 UX 原则（何时配键、跨平台、查看器媒体键）
- `docs/ui/0004-calm-error-and-copy-ux-principles.md` — 错误与文案语气（禁止「严重错误」、阻塞窗标题、避免焦虑）
- `docs/research/` — 技术调研

## 人类功能验收清单（强制）

- `docs/qa/human-acceptance-checklist.md` 是跨 agent 的功能验收队列。所有 agent 在开始开发前必须读取，开发过程中持续更新，不能只在会话结束时补写。
- **UI / 浏览等需人眼的条目**：按可由人类独立操作的最小功能拆分。只有功能路径已实现、相关自动化通过、无该范围已知阻断、且能写出操作步骤与预期时，才能加入「待人类验收」。自动化通过或 agent 自测**不能**把这类条目改为「人类验收通过」；仅用户本人确认后才可。用户报问题时立即改为「人类验收不通过」或「已撤回」。
- **插件 / 脚本 / MCP / Gateway（`PLUGIN-*`、`AUT-*`）**：以自动化测试为准（档位见 [`docs/agent-plugin-playbook.md`](docs/agent-plugin-playbook.md)）。Agent 在声明档位绿时可设「自动化验收通过」；缺档位设「自动化证据不足」；失败设「自动化未通过」。不要求人类逐步点验。packaged / Windows 未跑须在条目中标明「未执行」。
- 每完成一个新的可验收增量，必须在同一提交中更新清单，并在汇报中列出变化的 ID。

## 核心体验回归门禁

- 浏览、缩略图解码、客户端查看、导入、搜索和删除是核心用户旅程。任何跨 Renderer / Preload / Main / Worker、自定义协议、CSP、媒体二进制或打包资源的修改，都必须重跑真实 Electron E2E。
- 预览测试必须证明媒体被解码：图片检查 `complete && naturalWidth > 0`；视频至少检查元数据和非零尺寸。只断言 DOM、状态或 job 成功不算通过。
- 持久化必须以“完整退出应用后重新启动”为测试边界；仅关闭窗口或复用同一 Worker 不算重启恢复。
- 多 agent 或共享工作树结束后，主 agent 必须在最终合并状态运行 `npm run verify:mainline`。详见 `docs/development-process.md`。
- 每个较大功能或核心 UX 更新在验收前，主 agent 必须使用 Computer Use 操作真实 Serpent 应用，并用截图检查关键 UI 状态；自动化全绿不能代替 UX/视觉验收。截图证据与发现写入对应开发日志或 QA 报告。
- 当前环境没有 Computer Use 或等价真实桌面控制能力时，该项必须记为未执行并移交给具备能力的 agent 或人工 QA；不得自行跳过或标记为通过。
