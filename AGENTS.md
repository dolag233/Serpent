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

`electron-forge start` 先用 Vite 编译 main/preload/worker 三个 target，然后启动 Electron dev server，弹出主窗口。首次启动可能触发 Electron postinstall 下载完整 binary（含 icudtl.dat）。

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

## 当前开发状态

垂直切片推进，每切片交付代码 + 测试 + 开发日志 + 代码审查 + QA 报告（见 `docs/development-process.md`）。

- **切片 0001（桌面壳与资源库生命周期）**：✅ 有条件通过。macOS arm64 完成；Windows 未验证（无 runner）。提交 `ae1fcf4b5646c46a7334024032c99dfb8549b576`。
- **切片 0002（托管文件夹、资产导入与外部变化）**：🚧 实施中。schema v1→v2、managed_folders/assets/revisions/file_operations 表、文件夹树、文件/目录导入、冲突计划与解决、外部变化刷新。分支 `codex/slice-002-asset-ingestion`。

## 关键约束

- **平台**：macOS arm64 已验证；Windows 完全未验证（无 runner）。Windows 行为（命名冲突、rename 语义、打包）是显式未验证项，不能写成"通过"。
- **Node**：`>=24 <25`，`.nvmrc` 锁定 24.15.0。
- **打包后 `.app` 不能从 SMB 运行**：必须先复制到本地 APFS（macOS QA 用）。
- **Agent 共享知识必须进仓库**：产品决定、事故复盘、质量门禁和切片状态不得只留在聊天、个人 memory 或本机忽略文件中。
- **TypeScript pinned 6.0.3**：typescript-eslint@8.63.0 不支持 TS 7.x，等生态适配后再升。

## 文档入口

- `docs/product-brief.md` — 产品愿景与 MVP 边界
- `docs/development-process.md` — 切片开发与质量流程
- `docs/domain-model.md` / `docs/glossary.md` — 领域模型与术语
- `docs/adr/0001`–`0020` — 架构决策记录
- `docs/implementation/NNNN-*.md` — 切片实施规格
- `docs/development/NNNN-*.md` — 切片开发日志
- `docs/reviews/NNNN-*.md` — 双轴代码审查
- `docs/qa/NNNN-*.md` — QA 报告
- `docs/qa/human-acceptance-checklist.md` — 面向产品负责人的持续人类验收队列
- `docs/ui/0001-studio-contact-sheet-direction.md` — UI 视觉方向
- `docs/research/` — 技术调研

## 人类功能验收清单（强制）

- `docs/qa/human-acceptance-checklist.md` 是唯一的跨 agent 人类功能验收队列。所有 agent 在开始开发前必须读取，开发过程中持续更新，不能只在会话结束时补写。
- 清单按可由人类独立操作的最小功能拆分，不按提交、代码模块或大切片笼统记录。只有功能路径已实现、当前合流状态的相关自动化通过、没有该条目范围内的已知阻断，并且能够写出确定的操作步骤与预期结果时，才能加入“待人类验收”。
- 自动化通过、代码审查通过、Computer Use 通过或 agent 自测通过，都不能把状态改为“人类验收通过”。只有用户本人明确确认后才能设置该状态；用户报告问题时，必须在当前开发回合立即改为“人类验收不通过”或“已撤回”，记录反馈并链接后续修复证据。
- 每完成一个新的可验收增量，必须在同一提交中更新清单，并在阶段性汇报和最终回复中列出新增或变化的验收项 ID、用户可以怎样验收，以及尚未进入清单的相关未完成范围。
- 不允许为展示进度而把部分实现、旧构建结果、未执行的平台项目或仅有内部 API/数据结构的工作写成可验收功能。详细自动化、平台和截图证据仍写入对应开发日志/QA 报告，清单只保留稳定链接和面向人的步骤。

## 核心体验回归门禁

- 浏览、缩略图解码、客户端查看、导入、搜索和删除是核心用户旅程。任何跨 Renderer / Preload / Main / Worker、自定义协议、CSP、媒体二进制或打包资源的修改，都必须重跑真实 Electron E2E。
- 预览测试必须证明媒体被解码：图片检查 `complete && naturalWidth > 0`；视频至少检查元数据和非零尺寸。只断言 DOM、状态或 job 成功不算通过。
- 持久化必须以“完整退出应用后重新启动”为测试边界；仅关闭窗口或复用同一 Worker 不算重启恢复。
- 多 agent 或共享工作树结束后，主 agent 必须在最终合并状态运行 `npm run verify:mainline`。详见 `docs/development-process.md`。
- 每个较大功能或核心 UX 更新在验收前，主 agent 必须使用 Computer Use 操作真实 Serpent 应用，并用截图检查关键 UI 状态；自动化全绿不能代替 UX/视觉验收。截图证据与发现写入对应开发日志或 QA 报告。
- 当前环境没有 Computer Use 或等价真实桌面控制能力时，该项必须记为未执行并移交给具备能力的 agent 或人工 QA；不得自行跳过或标记为通过。
