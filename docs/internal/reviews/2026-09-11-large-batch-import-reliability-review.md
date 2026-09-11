# 大批量导入可靠性 — 双轴审查

> 日期：2026-09-11  
> 固定点：`521348a0`  
> Diff：`git diff 521348a0...HEAD`  
> 提交：`6e982c8d` / `7c7fc239` / `c4648ccc`  
> 规格：`docs/internal/implementation/2026-09-11-large-batch-import-reliability.md`  
> 审查模型：composer-2.5（Standards 与 Spec 各一次，互不交叉）  
> 范围：仅导入可靠性改动；工作区未提交的 WebDAV 文档/工单不在本次审查内

两轴分开记录，不跨轴重排。

## Standards

**单行最严重问题**：`library-service.ts` 在大量路径接入分块后，仍约 62 处 `ids.map(() => '?')` 动态 `IN`，与实现文档 §4.3「任意规模 ID 须分块」的全局表述未完全对齐（§5.1 允许分阶段，属判断项而非明确违背本次热路径修复）。

| Sev | 位置 | 问题 |
|-----|------|------|
| **judgement** | `library-service.ts`（多处，如 `10119` 等仍见 `.map(() => '?')`） | **标准**：`2026-09-11-large-batch-import-reliability.md` §4.3 / §5.1。导入/刷新/序列等热路径已用 `sqlite-in`；其余批量 `IN` 未扫完，大规模非导入多选仍有复发风险。 |
| **judgement** | `library-service.ts` `4877–4905`（`measureCopyTree`） vs `4848–4878`（`copyDirRecursiveCancellable`） | **Smell — Duplicated Code**：「`visit`/`readdirSync` 遍历 + 拒绝 symlink」与拷贝前统计重复；大目录导入多一次全树 walk。 |
| **judgement** | `library-service.ts` `40825–40890`（`resolveImport` 内 `completeCommittedImport`） | **Smell — Long Method / 内联闭包**：提交后处理逻辑继续堆在 `resolveImport`；**AGENTS.md** §验收纪律-8（抑制巨型文件内联）为方向性提醒，非新引入架构违规。 |
| **judgement** | `library-service.ts` diff ~+800 行跨标签/合集/回收等 | **Smell — Shotgun Surgery**：单文件横向替换 `IN`，后续同类变更仍易牵动同一巨型模块。 |
| **judgement** | `library-service.ts` `16716–16730`（`listAssetSummariesByIds`） | 10 万级 `affected` 时按 200 分块且 `recursive: true` 调用 `listAssets`，可能极慢；属性能/产品设计，非文档硬性违规。 |

**未发现 hard 违规（本 diff 范围内）**

- **进程架构**（**AGENTS.md**）：分块/恢复/`finalizedImportIds`/TTL 均在 Worker；Renderer 仅清 overlay、文案与取消抑制（`App.tsx` `7187+`、`8524+`）。
- **§4 不变量 2/4/5/6**：applying 恢复查 `path_identity` 后保留已登记资产（`8489–8555`）；无 schema 变更；24h 决策 TTL 仍走 `abandonImport`/`removeOperation`；i18n `cancelNotice` 说明暂存丢弃。
- **§5.2 提交边界**：`rememberFinalizedImport` + `completeCommittedImport` 避免 `committed` catch 再抛 SQL（`41207–41238`）。
- **隐私 / library-availability**：测试无本地绝对路径；开发日志记载已跑 `test:library-availability`（过程合规，非代码 smell）。

**符合设计**：新增 `src/worker/sqlite-in.ts`（§5.1 共享模块，900 上限）。

## Spec

**最严重问题：** §5.5 只把默认 TTL 改为 24h，未实现「冲突/决策期间暂停到期」，超长决策仍可能静默删暂存（L128–129）。

### (a) 缺失 / 部分

| 严重度 | 发现 | 规格 |
|--------|------|------|
| **中** | 无 TTL 暂停；仅 `DEFAULT_IMPORT_DECISION_TTL_MS` 24h（`scheduleImportExpiry` L7415–7429） | §5.5 L128–129 |
| **中** | `IMPORT-UI-006` 验收写成「导入资源库」字节进度；§5.4 要求的是普通导入 `copy`/`hash` 阶段计数更新（L117–118） | §5.4、§9 |
| **中** | `IMPORT-SQL-001` 要求大批量标签/合集/回收站等；自动化 mainly 901 文件导入 + helper 2500 行，无大批量批量操作 Worker 测 | §5.1 L81、§7 L170–175、§9 |
| **低** | §7 要求 applying + 无 DB 孤儿仍删；仅有「有 assets 行保留」测（`import-planning` L1208+），无孤儿路径测 | §7 L173 |
| **低** | §7 要求冲突取消文案 key 单测；i18n/`cancelNotice` 已加，tests 无对应断言 | §7 L174、§5.4 L117 |
| **低** | 清单四条证据列仍写「待本轮测试记录」，与同提交开发日志中的命令结果不一致 | §9 L187–192 |

### (b) 范围外 / creep

| 严重度 | 发现 | 说明 |
|--------|------|------|
| **低** | `ImportSourceFailureDialog` 复用 `cancelNotice` | §5.4 只点名冲突/重复窗 |
| **低** | 清单 `IMPORT-UI-006` 绑定资源库复制字节进度 | 超出 §9 示例与 §5.4 L117 字面范围 |

### (c) 已实现但存疑

| 严重度 | 发现 | 规格 |
|--------|------|------|
| **低** | `finalizedImportIds` 仅进程内；重启后 `cancelImport` 仍可 `IMPORT_NOT_FOUND`（L45066） | §5.2.4、§5.4 L116（会话内抑制） |
| **信息** | `resolveImport` 同步路径不发 `complete`；生产经 `resolveImportCancellable`（worker `asset.import.resolve`）补发 | §5.2.5 |

### 已对齐（抽查）

- `SQLITE_IN_BIND_LIMIT = 900` + 2500 行单测；901 文件 `resolveImport`（§5.1 L69–71、§7 L170–171）。
- 提交后后处理失败仍返回成功、`failAt('committed-result-list')` + `complete` 事件（§5.2 L89–94、§7 L171）。
- applying 恢复：`assets` 有行则跳过 `rmSync`（§5.3 L102–104；`recoverFileOperations` L8526–8535）。
- 冲突取消中英 `cancelNotice`（§5.4 L117）。
- `npm run test:library-availability` 有开发日志记录（不变量 7、§7 L175）。

## 合计

- Standards：0 hard / 5 judgement。轴内最严重：其余动态 `IN` 未分块扫完。
- Spec：0 阻断实现缺口被写成「覆盖完整」；1 项中等规格未实现（决策期 TTL 暂停），另有验收条目口径与测试缺口。轴内最严重：§5.5 TTL 暂停缺失。
