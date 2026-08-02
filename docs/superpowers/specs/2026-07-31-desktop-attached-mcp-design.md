# Serpent Desktop 附着 MCP 与可见执行设计

> 状态：已获产品负责人批准，2026-07-31  
> 实施：延后（不插队 `Serpent-bb56.2` / 0023 Phase E–F 收口）  
> 工单：`Serpent-lq5y`  
> 上位规格：`docs/implementation/0023-automation-scripting-mcp-framework.md`  
> 上位决策：`docs/adr/0025-automation-core-script-runtime-and-mcp.md`、`docs/adr/0021-independent-first-party-clients.md`（实施前需修订冲突条款）  
> 产品类比：Houdini Engine（无头）与 GUI 内 Python Console（进程内）；外部 Agent 再增加「附着已开 GUI」路径

## 1. 目标与范围

### 目标

1. **附着已开实例**：Agent 可通过 MCP 连接**已经打开**的 Serpent Desktop，操作同一 Main / Library Worker；导入、建文件夹、评分等变化在前端可见。
2. **可见回退**：若本机没有 Desktop，默认拉起**带 UI** 的 Desktop 再附着，而不是静默走无窗进程，便于用户观察 Agent 在做什么。
3. **保留无头**：显式 `--headless`（或等价环境变量）仍启动现有 process-local MCP host，服务 CI 与无界面场景。
4. **同一 Action 面**：附着、无头、Desktop Console 仍只经 Automation Command Gateway；差别在宿主与可见性，不在能力子集。

### 非目标（本设计明确不做）

- 系统级常驻 daemon、开机自启 MCP 服务、公网或远程 MCP。
- Agent 驱动任意 UI 点击 / 无障碍树操作（只走领域 Action）。
- 云端多用户共享附着、跨机器附着。
- 用附着路径复活通用 CLI。
- 替换 Desktop 内 Console（Console 仍是进程内脚本入口，类似 Houdini 内部 Python）。

## 2. 产品决策摘要

| 议题 | 决定 |
|------|------|
| 总体方案 | **方案 1**：stdio MCP 代理 + Desktop 本机控制面；非方案 3（Host 直连 Desktop 上的 MCP transport） |
| 连接优先级 | ① 附着已开 Desktop → ② 拉起 GUI Desktop 再附着 → ③ 仅显式无头 |
| 库绑定 | **确认 C**：附着后弹出本机确认「允许 Agent 操作库 X？」；确认后会话内 `bindLibrary`；拒绝/超时失败 |
| 实施时机 | 顶层设计先入库；实现延后，优先级 P3（`Serpent-lq5y`） |

### 方案 1 与方案 3 的边界（避免混淆）

- **相同点**：已开 Desktop 必须在本机开放短寿命控制通道，外部才能把命令送进同一进程。没有「听」就无法附着。
- **不同点**：对 Cursor 等 Agent Host，方案 1 仍是 `spawn serpent-mcp` + **stdio MCP**；子进程做探测/附着/转发。方案 3 是 Host 直接连接 Desktop 暴露的 MCP URL/管道。推荐 1，以保持现有 Host 集成习惯，并把「探测 / 拉起 GUI / headless」收在启动器内。

## 3. Houdini 对齐

| Houdini | Serpent |
|---------|---------|
| 脚本拉起无头 Engine，继续用同一套指令控制 | `--headless` MCP / process-local host |
| 用户打开 GUI，在内部 Python Console 控制 | Desktop Automation Console（进程内，typed IPC） |
| 外部工具控制**已开** GUI 进程 | 附着 MCP：stdio 代理 → Desktop 控制面 → Gateway |

三者共享同一领域指令面（Registry / Gateway）；不共享 transport 或进程模型。

## 4. 架构

```text
Agent Host (Cursor 等)
        │ stdio MCP（不变）
        ▼
serpent-mcp 启动器 / 代理进程
        │
        ├─ 探测 Desktop 控制面 ──是──▶ 附着会话
        │                                    │
        ├─ 否 → 启动 GUI Desktop ──────────▶ 附着会话
        │                                    │
        └─ 显式 --headless ──▶ 现有 process-local MCP host
                                         （独立 Worker，无窗）

附着会话：
  本机控制面（仅本用户、随 Desktop 生灭）
        │
        ▼
  Desktop Main：Execution journal + 附着确认 UI + 计划批准 UI
        │
        ▼
  Automation Command Gateway → Library Worker（与 GUI 同一实例）
        │
        ▼
  Renderer：library.changed / 既有 UI 刷新（用户可见）
```

### 控制面约束

- 仅本机、仅当前用户可连接；不监听公网；路径/套接字权限收紧。
- 随 Desktop 进程退出而消失；不是系统服务。
- 载荷只承载已认证的附着会话与 Gateway 信封转发；不暴露 SQL、任意 FS、Shell、密钥。
- 协议细节（Unix socket / named pipe / 本地抽象）在实施计划中选定；本设计只要求「Desktop 内控制面 + stdio 门面」。

### 单实例

- 复用现有 `requestSingleInstanceLock` / `second-instance`：拉起 GUI 时优先唤醒已有实例，避免双 GUI 写同一库。
- `SERPENT_ALLOW_MULTI_INSTANCE` 开发双开不改变生产附着语义；附着目标必须是明确的单实例控制面。

## 5. 会话、授权与库绑定

1. 代理成功附着后，Desktop Main 创建 `source: 'mcp'` Automation Execution（与现有 MCP Execution 同源语义）。
2. **不得**静默把 GUI 焦点库当作授权依据。
3. Desktop 弹出本机确认，至少展示：
   - 库显示名与可理解的位置摘要（绝对路径仅进本地诊断，用户可见文案按现有脱敏原则）；
   - 申请能力（只读 / 写）；
   - 连接来源摘要（本机 MCP 附着）。
4. 用户确认 → Journal `bindLibrary`；拒绝或超时 → 稳定错误（建议码：`AUTOMATION_ATTACH_DENIED`），stdio 侧对 Agent 可见。
5. 会话内换库（显式打开 / `library.create` 后绑定）再次要求本机确认或沿用既有高风险计划批准，不得静默切换。
6. 高风险 Action 的计划批准仍走 Desktop UI，与 Console / 现行 MCP 同级；禁止 Agent 自提权。
7. Renderer 与代理均不能提交可作为授权依据的 `source`、能力集合或库 ID；只由 Main 按 `executionId` 解析。

## 6. 与现行 ADR / 0023 的关系

实施前必须修订文档中与本设计冲突的表述，至少包括：

- ADR-0025 / 0023：MCP「不要求 Desktop GUI 正在运行」改为「默认可附着或拉起 GUI；`--headless` 可不依赖 GUI」。
- ADR-0021「客户端互不依赖」：保留「无头可独立运行」；增加「可选附着正在运行的 Desktop」为对等客户端协作模式，仍**不**引入系统 daemon。
- 0023「不得从 GUI 焦点隐式选库」：附着场景改为「本机确认后的显式会话绑定」，不是模型猜测或未确认的焦点推断。

当前 headless MCP 路径在修订生效前保持可用；本设计不删除该路径。

## 7. 用户可见性与 Console

- 附着模式下，领域写入必须进入与 GUI 相同的 Worker，并触发既有 `library.changed`（或等价）刷新，使用户在网格/侧栏中看到变化。
- Desktop 可展示「Agent 会话已附着」类只读状态（文案实施时定）；该状态**不是**授权依据。
- Desktop Console 继续作为进程内脚本入口；不要求 Console 与 MCP 附着互斥，但同一库的写协调仍走租约 / Job lease（`Serpent-bb56.2`）。

## 8. 启动器行为（产品契约）

建议 `serpent mcp` / `run-mcp.mjs`（及 packaged 等价物）支持：

| 模式 | 行为 |
|------|------|
| 默认（未来） | 附着已开 Desktop；否则拉起 GUI 再附着；附着后走确认 C |
| `--headless` | 现有无窗 process-local host（需 `--library` 或 `--unbound` 等现有约束） |
| `--write-access` | 仍只表示「Host 侧意图暴露写工具」；真正写授权与库绑定由 Desktop 确认 / Journal 签发 |

默认模式切换属于破坏性产品变更：实施时须更新 `docs/manual/scripts/development.md`、Skills、MCP Host 配置说明，并保留 `--headless` 文档入口。

## 9. 错误与安全

- 控制面不可达、附着拒绝、确认超时、Desktop 退出导致会话断开：使用稳定错误码，可操作、可重试说明分开。
- 诊断日志可含本机套接字路径与 libraryId；MCP stdout / Agent 可见结果不得泄漏未脱敏绝对路径或秘密。
- 不因附着而放宽：eval、Shell、SQL、任意文件系统、原始网络、秘密配置、永久删除。

## 10. 测试与完成定义（实施阶段）

四列可追溯；下列为验收意图，非本轮实现：

- 已开 Desktop + 附着：确认 C → 绑定 → `file.import` / 建文件夹后 GUI 可见；拒绝确认则无写副作用。
- 无 Desktop：默认拉起 GUI 再附着；窗口存在且同一 Worker。
- `--headless`：无窗、行为与现行 MCP 回归一致。
- 单实例：第二启动唤醒而非双开写同库。
- Console 与附着 MCP 对同一 Action 的结果 / 错误 / 计划批准语义一致。
- 控制面权限：非本用户 / 异常连接失败 closed。
- macOS 开发态至少一条 Electron E2E 或等价集成证明；Windows / packaged 单独记未验证直至实机。

## 11. 实施顺序（延后）

1. 修订 ADR-0025 / 0021 与 0023 冲突条款（文档先行）。
2. Desktop 控制面 + 附着确认 UI + Journal 绑定。
3. stdio 代理：探测 → 附着 → 转发；失败语义。
4. 启动器：默认附着/拉起 GUI；保留 `--headless`。
5. 可见性回归与双 Host 冒烟；更新 guide / Skills / project-status。

依赖：写协调与 Gateway 计划批准主线（`Serpent-bb56.2`、`Serpent-y51c.8/9`）宜先稳定，再开本 epic 的实现子单。

## 12. 开放细节（实施计划再定）

- 控制面具体 transport 与鉴权握手字节级格式。
- 多窗口 / 多库同时打开时确认 UI 的库列表与默认选项。
- Desktop 退出时代理是失败退出还是尝试 `--headless` 回退（默认建议：失败退出，不静默降级）。
- packaged 启动器与开发 `run-mcp.mjs` 的参数对齐表。
