# 分支与开发工作流

面向参与 Serpent 开发的贡献者与维护者。解释仓库长期分支架构、外部贡献流程以及内部维护者工作规范。

## 1. 分支定位：`main` 与 `dev`

| 分支 | 定位 | 包含内容 | 访问与发布 |
| --- | --- | --- | --- |
| `main` | **发布基线与公开分支** | 稳定代码、自动化测试、运行时资源、公开文档（含 `docs/developer/`）及构建配置 | 外部默认分支、对外打包与 Release 基线 |
| `dev` | **日常开发集成分支** | `main` 的全部内容，加上内部协作工单（`.beads/`）、开发日志与切片设计（`docs/internal/`） | 功能开发与 PR 合流的目标分支 |

- `main` 的目标是“拿来发布、稳定可用、公开透明”，随发布交付给用户与开源社区；
- `dev` 的目标是“支撑活跃开发、追踪过程证据”，承载日常演进；
- **外部贡献者发起 Pull Request 时，目标分支一律选择 `dev`**。

---

## 2. 外部贡献者工作流（GitHub 社区协作）

外部开发者参与 Serpent 开发的推荐流程如下：

### 2.1 准备工作

1. 在 GitHub 上 Fork [dolag233/Serpent](https://github.com/dolag233/Serpent) 仓库；
2. 将 Fork 后的仓库克隆到本地开发环境（请勿放置在 SMB/NAS 网络挂载路径）：
   ```bash
   git clone https://github.com/<你的用户名>/Serpent.git
   cd Serpent
   ```
3. 按照[环境搭建指南](setup.md)配置 Node.js 24 与依赖：
   ```bash
   npm ci --registry=https://registry.npmjs.org
   npm run rebuild:native
   ```
4. 检出最新的 `dev` 分支并创建你的特性或修复分支：
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feature/my-feature-name
   ```

### 2.2 开发与本地门禁

在修改代码时，请遵守以下工程原则：

1. **类型安全与代码风格**：提交前必须通过静态类型检查与 ESLint 校验：
   ```bash
   npm run typecheck
   npm run lint
   ```
2. **测试覆盖**：
   - 纯逻辑修改添加单元测试至 `tests/unit/`；
   - 涉及 Worker、SQLite 数据存储的修改添加测试至 `tests/worker/`；
   - 运行定向测试验证改动：
     ```bash
     npm run test:unit -- tests/unit/<你的测试文件>.test.ts
     ```
   - 若涉及资源库打开、数据库迁移或底层文件操作，必须跑通可用性底线套件：
     ```bash
     npm run test:library-availability
     ```
3. **保持工作区整洁与隐私脱敏**：
   - 提交的文件中**严禁包含任何本机绝对路径、个人用户名、盘符路径、私有凭据或测试产生的临时媒体**；
   - 测试产物应放置在临时目录并在用例结束后清理。

### 2.3 提交信息规范（Conventional Commits）

提交说明应清晰描述改动的意图与范围，采用标准提交格式：

```text
<type>(<scope>): <简要描述>
```

- **`type`** 常用类型：
  - `feat`：新增功能或交互特性；
  - `fix`：问题修复；
  - `docs`：仅文档调整；
  - `test`：新增测试或修复测试；
  - `refactor`：既不修复错误也不添加特性的代码重构；
  - `chore`：构建流程、辅助脚本或依赖维护。
- **`scope`** 可选模块：`canvas`, `viewer`, `library`, `worker`, `mcp`, `plugin`, `shell` 等。

示例：
```bash
git commit -m "fix(viewer): 切换视频资产后连贯自动播放"
git commit -m "feat(canvas): 增加卡片悬停进度跳转"
```

### 2.4 提交 Pull Request 与代码审查

详细的分步指引、代码门禁要求与环境配置，请查阅[贡献指南](contributing.md)。

1. 将你的本地分支推送到 GitHub 上的 Fork 仓库：
   ```bash
   git push origin feature/my-feature-name
   ```
2. 在 GitHub 页面创建 Pull Request，**Base 分支选择 `dev`**；
3. 在 PR 描述中清晰说明修改目的、涉及范围、以及本地验证所运行的测试命令和结果；
4. 维护者会在 PR 中进行审查并可能提出修改建议，完成必要的修改后会合并入 `dev`；
5. 合并入项目的贡献会同步收录至根目录的 [`CONTRIBUTORS.md`](https://github.com/dolag233/Serpent/blob/dev/CONTRIBUTORS.md) 予以致谢。

---

## 3. 核心维护者工作流（内部工程与发布纪律）

此部分面向核心维护团队及具备仓库写权限的成员，说明工单管理与发布合流纪律。

### 3.1 内部工单追踪（`.beads/`）

核心团队在 `dev` 分支使用轻量纯文本工单管理日常待办：

```bash
# 查看就绪待办
node scripts/ticket.mjs ready --json
# 认领工单
node scripts/ticket.mjs claim <issue-id>
# 完成工单并关闭
node scripts/ticket.mjs status <issue-id> closed --reason "完成说明，附提交哈希"
```

*注意：工单数据存储在 `.beads/issues.jsonl` 中，随代码一同进行 Git 版本控制。*

### 3.2 内部切片与设计文档（`docs/internal/`）

大型垂直切片开发需在 `docs/internal/` 中维护技术规格、开发日志与代码审查记录。这些记录属于过程制品，仅保留在 `dev` 分支，便于追溯架构演变。

### 3.3 发布合流与公开分支剥离纪律

当 `dev` 上的功能达到发布阶段、需要将代码合流至 `main` 时，必须遵守以下纪律：

1. **单次合并提交剥离内部开发文件**：
   - 内部开发资料（包括 `AGENTS.md`、`CLAUDE.md`、`docs/internal/`、`.beads/`、`.github/` 里的 CI 配置等）只属于 `dev`，不得污染公开的 `main` 发布基线；
   - `.github/ISSUE_TEMPLATE/` 与 `.github/PULL_REQUEST_TEMPLATE.md` 是公开的 issue / PR 模板，保留在 `main`；
   - `docs/developer/` 是公开开发者与贡献者文档，**必须保留在 `main`**；
   - 合流使用单次提交完成：从 `dev` 合入 `main` 时剥离内部文件，禁止在公开分支上出现“引入又删除”的冗余提交历史。
2. **构建与打包必须在 `dev` 上执行**：
   - 打包流水线包含全量校验门禁，正式发布制品由维护者在 `dev` 环境下执行 `npm run release:local` 生成；
   - 打包完成后执行 `npm run rebuild:native` 恢复开发环境。
