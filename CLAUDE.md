# Serpent — Claude Code 指南

> 本文件给 Claude Code 使用并进入版本控制。`AGENTS.md` 是跨工具的规范正文；本文件只补充入口，不得与其质量门禁冲突。

## 项目简介

Serpent 是一款开源（MIT）、跨平台（Windows + macOS）的数字资产管理软件，对标 Eagle/Billfish。首发用户为游戏美术、影视后期、平面/UI/品牌设计师。技术栈：Electron + TypeScript + SQLite + Vite + React。

开始工作前必须读取 `AGENTS.md`、`docs/product-brief.md`、`docs/development-process.md`、`docs/domain-model.md`、`docs/project-status.md` 和 `docs/qa/human-acceptance-checklist.md`。

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

## 当前开发状态

垂直切片推进，每切片交付代码 + 测试 + 开发日志 + 代码审查 + QA 报告（见 `docs/development-process.md`）。

- **切片 0001（桌面壳与资源库生命周期）**：✅ 有条件通过。macOS arm64 完成；Windows 未验证（无 runner）。提交 `ae1fcf4b5646c46a7334024032c99dfb8549b576`。
- **切片 0002（托管文件夹、资产导入与外部变化）**：🚧 实施中。schema v1→v2、managed_folders/assets/revisions/file_operations 表、文件夹树、文件/目录导入、冲突计划与解决、外部变化刷新。分支 `codex/slice-002-asset-ingestion`。

## 关键约束

- **平台**：macOS arm64 已验证；Windows 完全未验证（无 runner）。Windows 行为（命名冲突、rename 语义、打包）是显式未验证项，不能写成"通过"。
- **Node**：`>=24 <25`，`.nvmrc` 锁定 24.15.0。
- **打包后 `.app` 不能从 SMB 运行**：必须先复制到本地 APFS（macOS QA 用）。
- **共享知识进入仓库**：事故复盘、质量门禁和切片状态不得只留在 Claude memory、聊天或本机忽略文件中。
- **TypeScript pinned 6.0.3**：typescript-eslint@8.63.0 不支持 TS 7.x，等生态适配后再升。

## 验收纪律（2026-07-14 复盘新增，强制生效）

> 触发：autonomous loop 出现"部分实现 + 局部测试通过"被写成"规格覆盖完整"的系统性偏差（详见 `docs/development/2026-07-14-acceptance-discipline-retrospective.md`）。下列规则覆盖"完成定义"的判定口径，Claude Code 每会话强制遵守。

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
11. **编码后强制交叉审查**：每一次代码变更完成后，必须启动 **2 个 sonnet + 4 个 haiku** agent 进行交叉检查（使用 `/code-review` 技能或等效 workflow）。sonnet 负责 Standards + Spec 双轴深度审查；haiku 负责广度扫查（regression、dead code、accessibility、未用 import、CSS 泄露、security 回归）。

## 文档入口

- `docs/product-brief.md` — 产品愿景与 MVP 边界
- `docs/development-process.md` — 切片开发与质量流程
- `docs/domain-model.md` / `docs/glossary.md` — 领域模型与术语
- `docs/adr/0001`–`0020` — 架构决策记录
- `docs/implementation/NNNN-*.md` — 切片实施规格
- `docs/development/NNNN-*.md` — 切片开发日志
- `docs/reviews/NNNN-*.md` — 双轴代码审查
- `docs/qa/NNNN-*.md` — QA 报告
- `docs/qa/human-acceptance-checklist.md` — 持续更新的人类功能验收队列；只有用户本人可以标记“人类验收通过”
- `docs/ui/0001-studio-contact-sheet-direction.md` — UI 视觉方向
- `docs/research/` — 技术调研

## 核心体验回归门禁

遵循 `AGENTS.md` 的“核心体验回归门禁”和 `docs/development-process.md`。尤其禁止用 job/DOM 存在代替媒体实际解码，也禁止用关闭窗口代替完整进程重启的持久化测试。

较大功能或核心 UX 更新还必须由主 agent 使用 Computer Use 操作真实桌面应用，并以截图完成 UI/视觉验收；Claude Code 的自动化实现或测试结果不能替代该最终产品验收。

如果当前环境没有 Computer Use 或等价真实桌面控制能力，必须把该项记为未执行并移交给具备能力的 agent 或人工 QA，不得自行跳过或标记为通过。
