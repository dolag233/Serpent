# 贡献指南 (Contributing to Serpent)

感谢你关注并愿意为 Serpent 做出贡献！

Serpent 是一款开源（MIT 许可证）、跨平台的数字资产管理软件。无论你贡献的是代码、文档、自动化测试、本地化翻译、界面设计改进还是 Bug 反馈，都能帮助项目变得更好。

本文档说明如何参与项目的日常开发与社区协作。更详细的技术架构与本地构建指引可查阅[开发者文档](README.md)。

---

## 1. 行为准则与基本原则

为维护友好、包容且高效的开源协作环境，参与本项目的所有成员（包括贡献者和维护者）应共同遵守以下准则：

- **友好与尊重**：在 Issue 讨论、代码审查和 Pull Request 交流中保持专业、中性、建设性的沟通风格；
- **关注问题本身**：针对工程方案、代码实现或产品体验讨论，不做人身攻击或无意义争执；
- **保护隐私与安全**：在提报 Issue、提交测试用例或附加日志时，**绝不泄露**本地绝对路径、用户隐私文件、密码密钥或未脱敏的个人敏感数据。

---

## 2. 报告问题 (Reporting Issues)

如果你在运行或使用 Serpent 时遇到异常、性能瓶颈或功能缺陷，请前往 [GitHub Issues](https://github.com/dolag233/Serpent/issues) 提交反馈。

### 提报 Bug 时请尽量提供：

1. **运行环境**：操作系统（macOS / Windows / Linux）及版本号、系统架构（arm64 / x64）；
2. **应用版本**：正在使用的 Serpent 版本号（或 Git 提交哈希）；
3. **复现步骤**：清晰、连贯的操作序列，以便维护者能在本地复现；
4. **预期与实际结果**：说明你认为正确的结果以及实际观察到的现象；
5. **错误信息与日志**：相关的错误提示、控制台输出或脱敏后的诊断日志。

---

## 3. 代码与文档贡献流程

### 3.1 分支机制与协作基线

- **`main`**：最新分支。产品代码、测试和公开文档以这里为准。**所有 Pull Request 都合并到 `main`**。
- **`dolag_dev`**：维护者个人工作分支。外部贡献不合并到这里。

### 3.2 步骤指引

1. **Fork 仓库**：在 GitHub 上点击 Fork，将 [dolag233/Serpent](https://github.com/dolag233/Serpent) 复制到你的个人账号下。
2. **克隆到本地**：
   ```bash
   git clone https://github.com/<你的用户名>/Serpent.git
   cd Serpent
   ```
   *注意：请克隆到本地磁盘，避免使用网络挂载或 SMB/NAS 共享目录开发。*
3. **配置依赖环境**：
   - Node.js 版本要求为 **`24.15.0`**（推荐使用 `nvm`：`nvm use`）；
   - Windows 平台需要安装 Visual Studio Build Tools（含 C++ 桌面开发工作负载及 Windows SDK，用于编译 `better-sqlite3`）；若需要构建 Windows 安装器包（`npm run make:inno`），还需要安装 Inno Setup 6（见[环境搭建](setup.md)）；
   - macOS 平台需要安装 Xcode Command Line Tools；
   - Linux 平台需要 `build-essential` / `python3`。未取得媒体包时，`npm start` 还需要系统 `ffmpeg`（见[环境搭建](setup.md)）；发布用 AppImage 会打入 pinned 媒体工具。构建 AppImage 建议使用 Docker；
   - 执行依赖安装与原生模块编译：
     ```bash
     npm ci --registry=https://registry.npmjs.org
     npm run rebuild:native
     ```
4. **基于 `main` 创建分支**：
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/your-feature-name
   # 或者针对 Bug 修复：
   git checkout -b fix/your-bugfix-name
   ```
5. **本地验证门禁**：
   在提交代码前，确保本地通过以下校验：
   ```bash
   npm run typecheck    # 静态类型检查
   npm run lint         # ESLint 代码风格检查
   npm run test:unit    # 纯逻辑单元测试
   ```
   若涉及资源库打开、关闭、迁移或底层文件操作，必须跑完可用性底线：
   ```bash
   npm run test:library-availability
   ```
6. **规范提交信息 (Conventional Commits)**：
   提交信息采用标准格式：
   ```text
   <type>(<scope>): <简要描述>
   ```
   - 常见 `type`：`feat`（新功能）、`fix`（Bug 修复）、`docs`（文档）、`test`（测试）、`refactor`（重构）、`chore`（构建/杂项）；
   - 示例：`fix(viewer): 切换视频资产后连贯自动播放`。
7. **发起 Pull Request**：
   - 将你的分支推送到个人 Fork 仓库：`git push origin feature/your-feature-name`；
   - 在 GitHub 上发起 Pull Request，**确认 base 分支为 `main`**；
   - 在 PR 描述中清晰说明改动的动机、影响面及测试证据。

### 3.3 Pull Request 规则

- 当前 PR 只修改一个功能，而不是多个功能修改一次性提交。
- 在发起 PR 之前已经提出相应的有效 Issue。描述里写上对应编号。
- 仓库里的 Pull Request 模板会要求勾选这两条，以及本机验证、测试覆盖和提交内容不含本机路径或凭据。

---

## 4. 架构与设计约束

在编写代码时，请特别注意 Serpent 的核心架构设计约束：

1. **进程模型不变量**：
   - `Renderer`（渲染进程）处于沙箱环境，绝不直接操作 Node.js、文件系统或 SQL；
   - `Library Worker`（UtilityProcess）是 SQLite 数据库和磁盘资源文件的唯一操作者；
   - 跨进程调用一律经过强类型验证的 IPC 通信协议。
2. **数据兼容性纪律**：
   - 数据库迁移只增不改，禁止删除或重命名既有表和列；
   - 资源库永不提供只读锁死状态，任何版本更新必须能够平滑打开旧数据；遇到损坏时优先从备份与原始文件目录恢复。
3. **工作区洁净与隐私**：
   - 临时文件、解压产物必须在使用结束后在同一生命周期内清理；
   - 代码、测试夹具、文档中绝不硬编码任何私人绝对路径或测试凭据。

---

## 5. 贡献致谢

所有被合并进项目的贡献，维护者均会在根目录的 [`CONTRIBUTORS.md`](https://github.com/dolag233/Serpent/blob/main/CONTRIBUTORS.md) 中记录致谢并说明贡献内容。

感谢你为 Serpent 社区做出的每一份贡献！
