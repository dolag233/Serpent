# 独立复核：`Serpent-50c466` 错误码归属 + 用户文案 + 日志/记录副作用（2026-09-12）

> 触发：工单 `Serpent-50c466`（INVALID_IMPORT_DECISION 不得用于非导入非法状态）的独立对抗式复核。
> 依据（规范，非事实来源）：`docs/internal/reviews/2026-09-12-error-code-misuse-audit.md`（下称「审计」）、
> `docs/internal/ui/0004-calm-error-and-copy-ux-principles.md`（下称「0004」）。
> 本报告只读源码；唯一写入是本文件。不建单、不提交。

## 0. 复核对象与快照（重要）

| 项 | 值 |
|---|---|
| 基线 | `a1d2a3e9` |
| Phase 1 | `e5292edf` |
| 审计修正 | `80b838aa` |
| Phase 2 | **`4ee7a0d5`**（`fix(errors): 完成 INVALID_IMPORT_DECISION 清扫（Serpent-50c466 Phase 2）`） |

开始复核时 Phase 2 还在工作树未提交（brief 也这么描述）。我于 18:06 读取工作树并记录哈希，18:07 复核途中该工作树被提交为 `4ee7a0d5`。提交内容与我所读的工作树**逐文件哈希一致**：

```
b42c3a94  src/worker/library-service.ts     38458fd5  src/main/index.ts
db3e739b  src/shared/protocol/errors.ts      6f93cb49  src/renderer/i18n/catalogs/en.ts
408f2f09  src/renderer/i18n/catalogs/zh-CN.ts  232f5856  tests/worker/model-pipeline.test.ts
```

因此本报告所有 `file:line` 对 `4ee7a0d5` 有效（行号与未提交工作树相同）。我读取之后唯一变化的是开发日志 §7 与工单评论（已单独核对，见 F12）。

## 1. Method

只读命令与读取范围：

```bash
git log --oneline -6 ; git status --porcelain=v1
git show --stat e5292edf ; git show --stat 80b838aa ; git show --stat 4ee7a0d5
git diff a1d2a3e9 e5292edf -- src/worker/library-service.ts src/main/index.ts     # 40 处旧码 → 44 条新 throw
git diff e5292edf 80b838aa -- src/worker/library-service.ts src/main/index.ts     # 39 条 throw 重判（含 23 条自纠）
git diff 80b838aa 4ee7a0d5 -- src/worker/library-service.ts src/main/index.ts     # 17 条（worker 16 + main 1）
git hash-object <6 files>                                                        # 固定快照
node --input-type=module -e "<import .ts>"                                       # catalog vs PUBLIC_ERROR_MESSAGES 逐码比对
node node_modules/vitest/vitest.mjs run tests/unit/error-state-transition-copy.test.ts
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/{image-sequence,linked-folders,ai-completion,trash-relink,model-pipeline}.test.ts
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/{thumbnails,palette-artifact,derived-artifact-repair,automation-write-fencing,import-planning,ai-analysis}.test.ts
```

读取的源码/文档：`errors.ts` 全文、两个 catalog 的 `error.*` 段、`library-service.ts` 全部被改站点的上下文、`main/index.ts` 相关分支、`worker/index.ts`（日志/诊断/AI 队列失败）、`worker/public-error.ts`、`renderer/error-utils.ts`、`renderer/ai-job-error-message.ts`、`renderer/AppLogDialog.tsx`、`renderer/App.tsx`（6250/6290/7500/7840/8270/10070/10160 段）、`renderer/TextViewerControls.tsx`、`renderer/use-inspector-field-handlers.ts`、`renderer/ImageSequenceDialog.tsx`、`automation/command-registry.ts`、`worker/ai/image-input.ts`、开发日志与验收清单条目、工单评论。

测试复跑结果（均为 `4ee7a0d5`，全绿）：

| 命令 | 结果 |
|---|---|
| `vitest run tests/unit/error-state-transition-copy.test.ts` | **21 passed** |
| worker 5 套（image-sequence / linked-folders / ai-completion / trash-relink / model-pipeline） | **206 passed \| 2 skipped** |
| worker 6 套（thumbnails / palette-artifact / derived-artifact-repair / automation-write-fencing / import-planning / ai-analysis） | **182 passed \| 1 skipped** |

后 6 套合计 183 = 开发日志 §7 声称的 69+11+6+57+28+12，数字自洽。未运行 Electron E2E 与 `test:library-availability`（brief 禁止/不要求）。

---

## 2. Findings（按严重度）

先给三项**核对通过**的结论（brief 明确点名要查的三件事）：

1. **Phase 2 新增的三个「像占位符」的英文字符串与协议规则一致。** `UNSUPPORTED_MEDIA_TYPE`（`errors.ts:82-83`）、`CONFIRMATION_REQUIRED`（`errors.ts:86-87`）在两个 catalog 的 `error.code.*` 里都存在且与 `PUBLIC_ERROR_MESSAGES` **逐字节相同**；reason `IMPORT_AWAITING_SOURCE_DECISION`（`errors.ts:191-192`）在 `error.reason.*` 里存在。所有公开错误都经 `createPublicError` 组装（`errors.ts:233-238`），其 `message` 直接取 `PUBLIC_ERROR_MESSAGES[code]`，`publicErrorSchema` 的 refinement（`errors.ts:206-209`）因此对这三个串成立：**wire `message` === `PUBLIC_ERROR_MESSAGES[code]`，无违反**。
2. 本单新增的 8 个码/reason 在两个 catalog 都有条目（程序化比对：`zh`/`en` 均命中）；只有 `FOLDER_NOT_EMPTY`、`AUTOMATION_UNDO_*`(3)、`PLUGIN_HOOK_BLOCKED`、`HISTORY_TOO_LARGE`、`SYNC_IN_PROGRESS` 这 7 个**本单未触碰**的码仍缺文案（属 `Serpent-3c71f3`）。
3. `INVALID_IMPORT_DECISION` 在生产代码只剩 `library-service.ts:41102`（写 `file_operations.error_code`）与 `:41104`（校验决策取值），两处都与该码文案完全一致（见 §5）。

### F1（高）新写的 zh 文案在最主要用户路径上根本看不到：`App.tsx` 直接渲染协议英文 `message`

- 站点：`library-service.ts:16596`（`ASSET_STATE_CONFLICT`）、`:16599`、`:16602`（`INVALID_SELECTION` + reason `IMAGE_SEQUENCE_SELECTION`）。
- 用户路径：`App.tsx:6236 createSelectedImageSequence` → 失败时 `App.tsx:6244`：
  ```tsx
  current ? { ...current, submitting: false, error: result.error.message } : current,
  ```
  同一写法还有 `App.tsx:6276`（`setImageSequenceFps`）、`:6292`、`:6306`（解散序列），以及 `TextViewerControls.tsx:114`、`:216`。
- 为什么错：`PublicError.message` 被协议强制等于 `PUBLIC_ERROR_MESSAGES[code]`（`errors.ts:206-209`、`errors.ts:233-238`），是**英文**句；而新写的 zh 文案与 reason 只存在于 catalog，经 `messageForPublicError` / `toMessage` 才会用到（`error-utils.ts:54-99`）。于是一个 zh-CN 用户跨文件夹建序列图时读到的是
  `The selected items cannot be used for this action. Reselect them, or refresh the list and try again.`
  ——刚写的「所选内容不适用于这项操作…原因：创建序列图需要同一文件夹内…」一个字都不出现，reason 也被整条丢弃。
- 次生后果：验收清单 `human-acceptance-checklist.md:49` 的 `ERROR-STATE-001` 第 ⑤ 步把预期写成「所选内容不适用于这项操作，原因：创建序列图需要同一文件夹内、文件名按编号连续的一组图片（至少 3 张）」——**这条预期在该路径上无法出现**，人工验收必然判失败（或更糟：验收者以为文案错了）。审计 §3.1 就是把这个路径列为该码的用户可见入口的。
- 纠正：这 4 处（外加 `TextViewerControls.tsx:114/216`）改为 `messageForPublicError(result.error, locale)` / `toMessage`。若坚持留到 `Serpent-3c71f3`，则清单 ⑤ 的预期必须改成英文原文，否则构成虚假验收条件。
- 说明：审计 §4.6 已登记该问题、开发日志 §8 把它列为本单之外，但**本单正是为「用户看到的句子」而改这两个站点**，所以它在本次交付的判定口径内，不只是周边问题。

### F2（高）`deleteLinkedAssets` 把「managed 资产」和「已回收的链接资产」都说成「文件在链接文件夹里」

- 站点：`library-service.ts:37373`
  ```ts
  const exists = openLibrary.connection
    .prepare('SELECT location_kind FROM assets WHERE asset_id = ?').get(id) as ...;
  if (!exists) throw new LibraryServiceError('ASSET_NOT_FOUND');
  throw new LibraryServiceError('ASSET_NOT_MANAGED');
  ```
- 触发条件：`deleteLinkedAssets` 的查询只取 `location_kind = 'linked' AND deleted_at IS NULL`（`:37356`），因此任何**不在结果里的** id 都落到这一行，包括两类完全不同的事实：
  1. `location_kind = 'managed'` 的托管资产 → 文案却称「该文件在链接文件夹里，不在资源库自己的存储中」——**事实相反**；
  2. `location_kind = 'linked'` 但 `deleted_at IS NOT NULL`（已在回收站）→ 真正原因是「已在回收站」，文案却说文件在库外、让用户「在文件管理器中处理」——**原因与解法都错**。
- 为什么是错的而不只是「不精确」：0004 §3/§7 要求正文写出真实原因 + 可执行的解法；这里两个不同事实共享一个假原因。且 `SELECT` 只查了 `location_kind`，代码结构上无法区分第 2 类。
- 纠正：查 `location_kind, deleted_at`，`deleted_at !== null` → `ASSET_ALREADY_TRASHED`（文案已贴合）；`location_kind === 'managed'` → `INVALID_SELECTION`（或新增专用文案，例如「该资产由 Serpent 管理，不能用链接资产的删除方式处理」）。
- 审计在 §2.2 把这一处判为「应为 `INVALID_SELECTION`/`ASSET_NOT_MANAGED`」，Phase 1 取了后者；我判定 shipped 侧错。

### F3（高）`UNSUPPORTED_MEDIA_TYPE` 用在「文本资产含 NUL 字节」——原因错、解法不可用

- 站点：`library-service.ts:33973`
  ```ts
  if (buffer.includes(0)) {
    throw new LibraryServiceError('UNSUPPORTED_MEDIA_TYPE', { reason: 'UNSUPPORTED_FORMAT' });
  }
  ```
- 用户看到（经 `TextViewerControls.tsx:114` 直出英文 / 其它路径经 catalog）：
  「这类文件不支持这项操作。请改选受支持的文件类型。 原因：当前切片不支持此文件格式。」
- 为什么错：该文件的**文件类型是受支持的**（扩展名被判为 text，查看器也已打开），真实原因是**内容不是文本**（二进制/损坏）。因此「请改选受支持的文件类型」这个解法对用户不可执行——它已经是受支持类型。0004 §7 第 2 条要求解法必须对该情形可用。
- 附带：reason `UNSUPPORTED_FORMAT` 的 zh 文案含「**当前切片**」这一内部开发术语（`zh-CN.ts:2177`），违反 0004 §6「不把规格条目、实现约束写进界面」；且它与 code 文案语义重复（见 F6）。
- 纠正：为「内容是二进制」新增 reason（例如 `TEXT_CONTENT_BINARY`，文案：「文件内容不是文本，可能是二进制或已损坏，无法在文本查看器中打开。」）；`UNSUPPORTED_FORMAT` 的「当前切片」措辞需改写。

### F4（高）`INVALID_STATE_TRANSITION` + reason `IMPORT_AWAITING_SOURCE_DECISION`：一句话里两个互相矛盾的「原因 + 解法」

- 站点：`library-service.ts:41094`（Phase 2 新增）
  ```ts
  if (pending.awaitingSourceFailureDecision) {
    throw new LibraryServiceError('INVALID_STATE_TRANSITION', { reason: 'IMPORT_AWAITING_SOURCE_DECISION' });
  }
  ```
- 合成句（`error.withReason` = `{message} 原因：{reason}`，`zh-CN.ts:2228`）：
  「资源库当前的状态不支持这一步（**可能有另一个窗口或后台任务刚改过它**）。**请刷新磁盘变化后重试**。 原因：这次导入正在等待一个决定（关于无法读取的文件）。**请先处理它，再重试**。」
- 为什么错：真实原因不是「另一个窗口改过库状态」，而是**同一个用户自己的这次导入在等他对无法读取的文件作答**。前半句给了假原因和无效解法（刷新磁盘变化不会消解这个等待），后半句给了真原因和真解法——两句并列出现，用户不知道信哪个。审计 §2.1 #31 明确写过「无既有码」，Phase 2 却塞进了最不该用的状态竞争码。
- 纠正：给它自己的码（例如 `IMPORT_AWAITING_DECISION`，文案「这次导入还在等你决定怎么处理读不到的文件。请先回答那个提示，再继续。」）或至少不要复用「另一个窗口/刷新磁盘变化」的文案（例如给 `INVALID_STATE_TRANSITION` 去掉窗口归因、只保留「这一步依赖某个尚未完成的决定」）。可达性属防御/自动化面（Renderer 会先走 skip-source-failure），但不影响「文案自相矛盾」的结论。

### F5（中）`ASSET_NOT_TRASHED` 的「解法」对恢复路径是反的

- 文案（`zh-CN.ts:2125` / `en.ts:2142`）：「该资产不在回收站里。**请先在浏览区把它移入回收站**。」/ "Move it to the trash first."
- 站点与其用户意图：
  - `:35732` `previewRestoreAssets`、`:35831` `restoreAssets`、`:36312` `restoreAssetsIfOriginalVacant`——用户点的是**恢复**；"先把资产移入回收站"等于让他先做与目标相反的操作（移进去再拿出来），而且资产本就不在回收站、也无需恢复。可行的解法是「刷新回收站列表」（视图过期）。
  - `:36530` `deleteAssetsPermanent`（活动资产被永久删除）——「先移入回收站，再永久删除」**是**可用解法，文案在此成立。
- 为什么是问题：一个 code 服务两种相反意图，文案只能贴合其中一种；对恢复路径属于 0004 §7 第 2 条（解法对该情形不可用）。
- 纠正：文案改为意图中立的「该资产不在回收站里，可能已经被恢复。请刷新回收站列表后重试。」；若想保留「先移入回收站」的引导，就给永久删除单独一个 reason（例如 `PERMANENT_DELETE_NEEDS_TRASH`）。

### F6（中）`UNSUPPORTED_MEDIA_TYPE` 的 code 文案与附加 reason 语义重复，且 reason 不含解法

- 站点（6 处）：`:21098`（缩略图 `mediaType === 'other'` / 无解码器）、`:26864`（模型伴随扩展名）、`:26910`（工件重试 kind 不符）、`:33931`、`:33973`（见 F3）、`:34036`（文本资产读写）。
- code 文案（`errors.ts:82-83` / `zh-CN.ts:2131`）：「这类文件不支持这项操作。请改选受支持的文件类型。」
  reason（`zh-CN.ts:2177`）：「当前切片不支持此文件格式。」
- 为什么是问题：两句在说同一件事（「这类文件/格式不支持」），reason 没有增加任何信息、没有解法，还带内部术语——命中 brief 里「duplicates its own reason」和 0004 §6。`reason` 存在的意义是把话说具体（对照 `IMAGE_SEQUENCE_SELECTION` 做得好）。
- 纠正：这类站点不要附 `UNSUPPORTED_FORMAT`，或把 reason 写成具体信息（例如「这个格式没有可用的解码器：安装图像组件后重试」）。

### F7（中）`main/index.ts:4219/4225` 用 `AI_ANALYSIS_FAILED` 描述「保存 AI 设置」

- 站点：
  ```ts
  if (request.autoAnalyzeEnabled && !request.disclaimerAccepted) {
    return { ok: false, error: createPublicError("AI_ANALYSIS_FAILED", "AI_NOT_CONFIGURED") };
  }
  if (!request.apiKey && !currentConfig.hasKey) { /* 同上 */ }
  ```
- 文案（`zh-CN.ts:2137` + `:2188`）：「AI 服务未能完成资产分析。 原因：请先在 AI 设置中保存 API Key、选择模型并接受数据发送说明。」
- 为什么错：用户此刻在**保存设置**，没有任何分析在进行；首句把行为说错了（0004 §6「文案要说用户正在做的事」，§3「原因要写系统实际观测到什么」）。后半句（reason）是准确且可执行的。
- 审计 §5.2 #15/#16 就是这么建议的（与同文件 4066/4074 保持一致），但「与既有做法一致」不等于句子为真；规范不是事实来源。可达性：`App.tsx:9752-9777` 的 toast 直接显示该句。
- 纠正：为「AI 设置不完整」给专用文案（新码如 `AI_SETTINGS_INCOMPLETE`，或先保留码、把首句改成「还不能开启自动分析。」）。若决定保留，至少在开发日志里记下这是已知的措辞让步。

### F8（中）三处站点附加的 reason 与本码文案给出的原因互相冲突

- (a) `library-service.ts:39527`（`prepareImport` 收到链接文件夹目标，调用方契约错，应走 `prepareOrExecuteImport`）：
  ```ts
  throw new LibraryServiceError('AUTOMATION_FILE_PLAN_INVALID', { reason: 'SOURCE_NOT_FOUND' });
  ```
  合成句：「文件操作计划无效，请刷新后重试。 原因：**源文件在导入过程中消失或无法找到**。」——没有源文件消失，也没有计划过期。
- (b) `library-service.ts:32298`、`:32358`（`placeManagedRelinkFile`：重定位落点在落盘前/建目录后被占用）：
  ```ts
  throw new LibraryServiceError('ASSET_FILE_NAME_CONFLICT', { reason: 'SOURCE_CHANGED' });
  ```
  合成句：「同一文件夹内已存在同名文件。 原因：**源文件在复制过程中发生了变化**。」——首句已经把原因说清了（同名占用），附加 reason 又给出一个**不同的、假的**原因（源文件变了）。
- 为什么是问题：`error.withReason` 是简单拼接（`zh-CN.ts:2228`），所以 reason 一旦与 code 文案不属于同一个事实，用户会同时读到两个互斥的原因；审计 §5.3 要求 reason 把话说具体，不是叠加噪声。
- 纠正：(a) 去掉 reason 或换成描述调用契约的 reason；(b) 去掉 reason（`ASSET_FILE_NAME_CONFLICT` 的文案已自洽），若要说明「占用是在预览之后才出现」则需一个新 reason（例如 `DESTINATION_APPEARED`）。可达面：32298/32358 走批量重定位落盘，用户可达（审计 §3.1 列在「普通用户操作可达」）。

### F9（中）AI 任务记录里的公开码渲染不出来，界面会显示裸码字符串

- 链路（静态可验证）：`worker/ai/image-input.ts:92-97` 在拿不到现成缩略图时调 `generateThumbnail` 并**原样 rethrow**；`generateThumbnail` 现在对不支持的媒体类型抛 `UNSUPPORTED_MEDIA_TYPE`（`:21098`）→ `worker/index.ts:4470 aiQueueFailure(error)` → `:1531 return { errorCode: error.code }` → `:4476-4480 failAiJob(... errorDetail: safeAiErrorDetail(...))`，即 `jobs.error_code = 'UNSUPPORTED_MEDIA_TYPE'`。
- 渲染端：`App.tsx:10161 summarizeAiFailureCodes(collectRecentAiFailureCodes(jobs), locale)` → `ai-job-error-message.ts:10` 只查 `error.reason.${code}`，查不到就 `?? code`（`:16`）。catalog 里 `error.reason.UNSUPPORTED_MEDIA_TYPE` 不存在（只有 `error.code.UNSUPPORTED_MEDIA_TYPE`），于是 AI 批量失败的阻塞对话框/ toast 会显示字面量 **`UNSUPPORTED_MEDIA_TYPE`**（中英界面都是）。
- 结论：**有码不可渲染**。改判本身让码更真实（之前写的是 `INVALID_IMPORT_DECISION`，同样渲染不出来），但这是本次改动实际喂进 `jobs.error_code` 的新值，属于本单的日志/记录副作用面。
- 纠正：在 `messageForAiErrorCode` 里对公开码回退到 `error.code.*`（这是通用修法，可一并覆盖历史遗留），或为该码补 `error.reason.UNSUPPORTED_MEDIA_TYPE`。
- 未验证部分：我没有构造「AI 分析一个无解码器图片」的运行样例；上面是静态链路。验证方式：对 `messageForAiErrorCode('UNSUPPORTED_MEDIA_TYPE','zh-CN')` 的单测 + 一条 `generateThumbnail` 抛该码后 `enqueueAiAnalysis` 落库的 worker 测试。

### F10（中）`FOLDER_NOT_FOUND` 被用来表示「这个文件夹 id 不存在」，文案却归因磁盘断开

- 站点：`:11130`（自动化文件计划预览 `move` 的 `targetFolderId` 不存在）、`:19510`（`clearAiContent` 的 folder scope 缺 `folderId`，且额外带 `reason: 'SOURCE_NOT_FOUND'`，`:19510-19512`）。
- 文案（`zh-CN.ts:2090` + `:2158`）：「找不到该资源库文件夹。它可能已被移动、重命名，或**磁盘已断开**。**请重新连接磁盘**，或再次选择该文件夹。 原因：源文件在导入过程中消失或无法找到。」
- 为什么是问题：真实原因是「传进来的文件夹记录不存在」（或调用方没给 folderId），一句不含导入、也不含磁盘的句子就够了。用户（MCP/脚本或过期对话框）按提示去「重新连接磁盘」永远不会好，附加的「源文件在导入过程中消失」更与场景无关（同 F8 的拼接问题）。这正是审计 §4.3 自己批评过的同族错配（`FOLDER_NOT_FOUND` 用于标签/合集），只是这两处由它建议使用该码。
- 纠正：给「记录不存在」类情形一个中性文案（新码或 reason），例如「这个文件夹已不存在，可能已被删除。请刷新后重新选择。」，并去掉 `SOURCE_NOT_FOUND`。
- 可达性：`:11130` 仅 MCP/脚本；`:19510` 的 folder/library scope 目前 Renderer 不可达（见 F11），故严重度中等偏低。

### F11（中）`CONFIRMATION_REQUIRED` 是死文案：没有任何调用方能触发它

- 站点：`library-service.ts:19496`
  ```ts
  if ((input.scope.kind === 'library' || input.scope.kind === 'folder') && !input.confirm) {
    throw new LibraryServiceError('CONFIRMATION_REQUIRED');
  }
  ```
- 事实：`clearAiContent` 只有两个 Renderer 调用方，都发 `scope: { kind: "asset", ... }`（`App.tsx:10069-10073`、`use-inspector-field-handlers.ts:114-119`）；`src/automation/command-registry.ts` 里没有 ai.clear 类命令，脚本 guest API 也没有该调用（grep `clearAiContent` 全仓仅 preload/renderer/worker/main 协议转发）。因此分支不可达。
- 文案（`zh-CN.ts:2132`）：「这项操作需要先确认。请重新打开对话框并确认后再试。」——在唯一可能存在的用户面上（对话框）才成立，而这个分支上根本没有对话框。
- 判定：码的语义选择合理（比原来的 `INVALID_IMPORT_DECISION` + `reason: PERMISSION_DENIED` 好），但「为不可达路径新增公开码 + 中英文案」属于可疑投入；且若将来 MCP/脚本打开 folder/library scope，这句会直接误导脚本用户。
- 纠正：要么删掉这个分支（把 `folder`/`library` scope 从协议里去掉），要么把文案写成不依赖「对话框」的句子（例如「清空整个文件夹或资源库的 AI 信息前需要确认，请带上确认标记重试。」）。验证方式：一个覆盖 `scope.kind==='folder' && confirm===false` 的单测 + 确认没有别的调用方（已 grep 验证）。

### F12（中）开发日志 §7 与提交信息的两处不实：站点数不符、列名「当前行号」是旧行号

- 文件：`docs/internal/development/2026-09-12-error-code-state-conflicts-development-log.md:106-144`。
- (a) 数量：第 106-108 行与提交信息都写「剩下的 **19 处**（worker 18 + main 1）」，但同节表格（`:112-125`）自己列的是 **16 处 worker + 1 处 main = 17**；`git diff 80b838aa 4ee7a0d5` 实测也是 **17** 条被改的 `throw new LibraryServiceError` / `createPublicError` 语句（worker 16 + main 1）。「19」疑似从审计 §2.1 的 37 处减去 80b838aa 已改条数算得，与实际改动不一致。
- (b) 行号：`:110` 表头写「站点（当前行号）」，但所列行号整体偏旧 2 行（worker）/ 3 行（main）：
  | 日志所写 | 实际（`4ee7a0d5`） |
  |---|---|
  | 21100 | **21098** |
  | 33933 / 33975 / 34038 | **33931 / 33973 / 34036** |
  | 38247 | **38242** |
  | 38594 | **38592** |
  | 39529 | **39527** |
  | 41096 | **41094** |
  | `main/index.ts:4652` | **`main/index.ts:4649`** |
- 其余可核对的声明是准确的：`INVALID_IMPORT_DECISION` 在生产代码里只剩 `:41102`（写 `file_operations.error_code`）与 `:41104`（校验决策取值）两处（全仓 grep 仅剩这两处 + 协议定义 + catalog + `import-planning.test.ts:1199` 断言）；§7 的证据数字与我的复跑一致（见 §1 表）。§6 对 Phase 1 失误的自陈（23 处 `INVALID_STATE_TRANSITION` 误用）与 `git diff e5292edf 80b838aa` 相符（23 条 `-INVALID_STATE_TRANSITION`）。

### F13（低）`INVALID_SELECTION` 的文案不说明「原因」，对超限/空集无信息量

- 站点示例：`library-service.ts:37340`（`input.assetIds.length > 20`）、`:35496`（重复或 >10 000）、大量「空/重复 id」守卫（见 §4 表 A 组）。
- 文案（`zh-CN.ts:2128`）：「所选内容不适用于这项操作。请重新选择，或刷新列表后重试。」
- 为什么是（低）问题：0004 §3 要求正文含原因；「所选内容不适用」对 MCP/脚本调用方没有说明是空、重复还是超过 20 项上限，解法也只是「重新选择」。Renderer 侧已按 20 分块（`useBatchActions.ts:240-261`）并在拖放侧拆分 managed/linked，所以普通 UI 很少命中；命中者主要是 MCP/脚本。
- 纠正：给超限一个明确 reason（如「一次最多 20 项」），或在 reason 里写出实际约束。不需要为此新增公开码。

### F14（低）`INTERNAL_ERROR` 被用作序列图 fps 数值守卫的兜底

- 站点：`library-service.ts:16576`、`:16663`（`!Number.isFinite(fps) || fps < 1 || fps > 240` → `INTERNAL_ERROR`）。
- 事实：两条入口都已拦截——对话框 `ImageSequenceDialog.tsx:33`（`valid = Number.isFinite(fps) && fps >= 1 && fps <= 240`）、MCP schema `command-registry.ts:921`（`fps: z.number().min(1).max(240)`）——所以这是不可达的内部契约守卫。
- 判定：作为「调用方违约」的防御选择可接受，但如果真被命中，用户会读到 0004 §7 第 4 条明确警告的兜底句（`zh-CN.ts:2084`「发生了未能分类的内部错误…请打开「诊断日志」查看本次记录」），而原因其实是一个数值越界。建议改为带注释的 `throw new Error(...)`（非公开码）或加 reason 说明是数值非法。

### F15（低）三处 `INVALID_STATE_TRANSITION` 兜底是不可达死代码

- 站点：`:14230`、`:36438`、`:36532`（`if (rows.length !== assetIds.length) { …逐个校验…; throw … }`）。
- 事实：这些分支里的 `assetIds` 都来自 `expandAssetIdsToSequenceMembers`，它返回 `[...new Set(...)]`（`:35214`、`:35233`），且上方循环会为每个 id 抛 `ASSET_NOT_FOUND` / `ASSET_NOT_MANAGED` / `ASSET_ALREADY_TRASHED`；因此「行数不等且每个 id 都存在」不可能成立，兜底行永远不会执行。
- 判定：对用户无影响（审计把 14230/36440 判为「合理兜底」，我判定为死代码）。建议改成断言或删除，避免后人误以为这条路径会被走到。

### F16（低）`INVALID_FOLDER_NAME` 用于链接规则/忽略模式，措辞只提「名称」

- 站点：`:13518`、`:13648`（链接目录相对路径非法）、`:38220`、`:38230`、`:38245`（规则 pattern 空 / 含 `/`、`\`、`.`、`..` / 清空前导点后为空）、`:38592`（扩展名忽略项含 `/`、`\`）。
- 文案（`zh-CN.ts:2087` / `en.ts:2102`）：「名称包含不支持的字符。」/ "The name contains unsupported characters."——中英一致、方向正确，但对象是「规则模式/路径」而非文件夹名，且 38592 的对象是扩展名。可达性多为防御（值来自库内数据），`setLinkedFolderRules` 的 pattern 输入框是自由文本（`LinkedRulesDialog.tsx:109-120`）故用户可达。
- 判定：可接受但不够具体；若要更准，可给 reason（例如 `RULE_PATTERN_INVALID`「过滤规则不支持这些字符：/ \ . ..」）。

### F17（低）两个 catalog 里有 3 个「只在 catalog 存在」的死键

- `en.ts:2151/2165/2166` 与 `zh-CN.ts:2134/2148/2149` 的 `TAG_UNDO_EXPIRED`、`INVALID_SYNC_URL`、`SYNC_PASSWORD_STORAGE_UNAVAILABLE` 在 `PUBLIC_ERROR_MESSAGES` 中**没有**对应码（程序化比对确认：72 个公开码 vs 68 个 catalog 键，多出的正是这 3 个）。
- 影响：它们不可能经 `createPublicError` 上线（`errors.ts:197-199` 的 enum 只取 `PUBLIC_ERROR_MESSAGES` 的键），全仓也没有发射点（grep 仅命中 catalog 与 `main/index.ts:3978` 的注释「远端码体系已删除 INVALID_SYNC_URL」）。因此**不违反** `message === PUBLIC_ERROR_MESSAGES[code]` 规则，只是死文案。若 brief 里说的「3 个像占位符的英文串」指这三个，结论是：它们不上线，规则不受影响。

### F18（低）`en` catalog 与协议 `PUBLIC_ERROR_MESSAGES` 对 5 个「本次新复用」的码文本不一致

- 程序化比对：本次新增/新复用的 16 个码里，8 个新码 + `INVALID_SMART_COLLECTION_QUERY` + `LIBRARY_IO_ERROR` + `FOLDER_NOT_FOUND` 的 en catalog 文本与协议文本**逐字节相同**；但
  | 码 | en catalog（用户实际看到的 UI 文案） | 协议 message（日志/兜底用的 wire 文本） |
  |---|---|---|
  | `INVALID_FOLDER_NAME` | `en.ts:2102` The name contains unsupported characters. | `errors.ts:10` Choose a folder name that is safe on macOS and Windows. |
  | `ASSET_FILE_NAME_CONFLICT` | `en.ts:2150` A file with this name already exists in the same folder. | `errors.ts:89` …in the asset folder. |
  | `AI_ANALYSIS_FAILED` | `en.ts:2154` The AI service could not finish asset analysis. | `errors.ts:95` The AI service could not analyze this asset. |
  | `IMPORT_NOT_FOUND` | `en.ts:2121` The pending import is no longer valid. Select the files again. | `errors.ts:27` The pending import no longer exists. |
  | `AUTOMATION_FILE_PLAN_INVALID` | `en.ts:2117` The file operation plan is not valid. Refresh and try again. | `errors.ts:26` The file operation plan is not valid for this request. |
- 判定：这是既有设计（UI 文案归 catalog，wire 文本归协议），**不违反**协议规则（wire message 仍等于 `PUBLIC_ERROR_MESSAGES[code]`），但对本次 8 个新码而言两边完全一致（做得好）；问题在于 `error-state-transition-copy.test.ts:46-48` 的 `enFor()` 同时接受两种文本，于是把这类不一致「容忍」掉了——用它当断言时无法发现 en catalog 与协议文本漂移（见 §6 第 7 条）。
- 纠正：`enFor` 应断言 catalog 文本本身（用户看到的），协议规则交给 `protocol.test.ts` 的 schema 用例。

---

## 3. Per-code table（本单新增/新复用的码与 reason）

| code / reason | zh copy（当前） | verdict | problem |
|---|---|---|---|
| `ASSET_ALREADY_TRASHED` | 该资产已经在回收站里了。请从回收站恢复，或在回收站中永久删除。 | 正确 | 无（原因+两条解法，中英一致） |
| `ASSET_NOT_TRASHED` | 该资产不在回收站里。请先在浏览区把它移入回收站。 | **部分错** | 对恢复路径（`35732/35831/36312`）解法与用户目标相反；对 `36530` 永久删除成立（F5） |
| `ASSET_NOT_MANAGED` | 该文件在链接文件夹里，不在资源库自己的存储中。…请在文件管理器中处理。 | 正确 | 文案本身没问题（与 en 一致）；错的是 `37373` 用它的场景（F2） |
| `INVALID_STATE_TRANSITION` | 资源库当前的状态不支持这一步（可能有另一个窗口或后台任务刚改过它）。请刷新磁盘变化后重试。 | 基本正确 | 保留的 6 处（`14068/14151/14230/36438/36532/37596`）里 3 处不可达、3 处贴合；`41094` 用它属错配（F4） |
| `INVALID_SELECTION` | 所选内容不适用于这项操作。请重新选择，或刷新列表后重试。 | 正确 | 无原因说明（超限/空/重复不可区分，F13，低） |
| `ASSET_STATE_CONFLICT` | 该资产的当前状态不支持这项操作（可能已在别处删除、恢复或修改）。请刷新列表后重试。 | 正确 | 「已在别处成序列」这一子情形刷新列表不会改变（UI 已拦，MCP 可达），可接受 |
| `UNSUPPORTED_MEDIA_TYPE` | 这类文件不支持这项操作。请改选受支持的文件类型。 | **部分错** | 与 reason 语义重复、reason 含「当前切片」且无解法（F6）；用在 NUL 内容上原因错、解法不可用（F3）；AI 任务里渲染成裸码（F9） |
| `CONFIRMATION_REQUIRED` | 这项操作需要先确认。请重新打开对话框并确认后再试。 | 正确但不可达 | 没有任何调用方能触发（F11），文案假定存在对话框 |
| reason `IMAGE_SEQUENCE_SELECTION` | 创建序列图需要同一文件夹内、文件名按编号连续的一组图片（至少 3 张）。 | 正确 | 中英一致、把原因写具体，是全批 reason 的正面样板；但主路径看不到它（F1） |
| reason `IMPORT_AWAITING_SOURCE_DECISION` | 这次导入正在等待一个决定（关于无法读取的文件）。请先处理它，再重试。 | 正确 | 句子本身可用；与 `INVALID_STATE_TRANSITION` 的假原因并列后互相矛盾（F4） |
| `INVALID_SMART_COLLECTION_QUERY`（复用） | 保存智能合集前请先设置搜索词或至少一个过滤条件。 | 正确 | 无（319 段 3 处 + 形参联合类型已同步，`32034`） |
| `INVALID_FOLDER_NAME`（复用） | 名称包含不支持的字符。 | 正确 | 对象是规则/忽略模式时「名称」偏泛（F16，低） |
| `ASSET_FILE_NAME_CONFLICT`（复用） | 同一文件夹内已存在同名文件。 | 正确 | 文案本身没问题；错在 `32298/32358` 附加的 reason `SOURCE_CHANGED`（F8b） |
| `LIBRARY_IO_ERROR`（复用） | 资源库操作未完成：磁盘或文件系统报告了 I/O 错误。… | 正确 | 无（`35348` 场景贴合；该分支不写任何记录，无脏记录风险） |
| `AI_ANALYSIS_FAILED`+`AI_NOT_CONFIGURED`（复用） | AI 服务未能完成资产分析。 原因：请先在 AI 设置中… | **部分错** | 用户在做设置保存，首句把行为说错（F7） |
| `FOLDER_NOT_FOUND`（复用） | 找不到该资源库文件夹。它可能已被移动、重命名，或磁盘已断开。请重新连接磁盘… | **部分错** | `11130`/`19510` 的触发条件是「记录不存在」，归因磁盘断开（F10） |
| `IMPORT_NOT_FOUND`（复用） | 待处理的导入已失效，请重新选择文件。 | 正确 | 无（`main/index.ts:4649` offer 过期场景贴合；与同分支 4638/4644 一致） |
| `AUTOMATION_FILE_PLAN_INVALID`（复用） | 文件操作计划无效，请刷新后重试。 | 正确 | `39527` 附加的 reason `SOURCE_NOT_FOUND` 与场景无关（F8） |
| `INTERNAL_ERROR`（复用） | 发生了未能分类的内部错误…请打开「诊断日志」… | 可接受 | `16576/16663` 不可达（对话框与 MCP schema 都限 1..240）；若可达则是 0004 §7 第 4 条警告的兜底句（F14，低） |

---

## 4. Per-site table（本单改判的调用点，共 73 处）

计数口径：`git diff` 实测——Phase 1 `e5292edf` 移走 40 处旧码、产出 44 条新 throw；修正 `80b838aa` 改 39 条 throw/createPublicError（其中 23 条是 Phase 1 自己误写的 `INVALID_STATE_TRANSITION`）+ 2 处非 throw 引用（`32034` 形参联合类型等）；Phase 2 `4ee7a0d5` 改 17 条（worker 16 + main 1）。去重后共 **73** 处站点。verdict 中的「unreachable」指当前调用方不可能触发。

**A 组：`INVALID_SELECTION`（空/重复 id、类型混杂、批次超限）**

| file:line | 场景 | shipped | verdict |
|---|---|---|---|
| `library-service.ts:11122` | 自动化文件计划预览：assetIds 空/重复 | INVALID_SELECTION | right（仅 MCP） |
| `:12691` | moveManagedFolders：folderIds 空/重复 | INVALID_SELECTION | right |
| `:14200` | deleteAssetsFromDiskAsync：空/重复 | INVALID_SELECTION | right |
| `:15846` | setLinkedFolderRules：>200 条或 ruleId 重复 | INVALID_SELECTION | right |
| `:16034` | copyLinkedAssetsToManagedFolder：空/重复 | INVALID_SELECTION | right |
| `:16580` | createImageSequence：<3 或含重复 | INVALID_SELECTION | right |
| `:16599` | createImageSequence：跨文件夹选择 | INVALID_SELECTION + reason | right（文案在 UI 不可见 → F1） |
| `:16602` | createImageSequence：文件名不成一组 | INVALID_SELECTION + reason | right（同上） |
| `:33106` / `:33125` | moveAssets：空/重复；链接资产 → 链接目标 | INVALID_SELECTION | right |
| `:33335` / `:33376` | copyAssets：空/重复；managed+linked 混批 | INVALID_SELECTION | right |
| `:35173` | renameAssetFiles：items 空/重复 | INVALID_SELECTION | right |
| `:35276` / `:35287` | trashAssets：空/重复；序列展开后空/重复 | INVALID_SELECTION | right |
| `:35488` / `:35496` | trashSelection：资产+文件夹都为空；重复或 >10000 | INVALID_SELECTION | right（原因未写明，F13） |
| `:35705` | previewRestoreAssets：空/重复 | INVALID_SELECTION | right |
| `:35789` / `:35796` | restoreAssets：空/重复；展开后空/重复 | INVALID_SELECTION | right |
| `:36285` / `:36289` | restoreAssetsIfOriginalVacant：同上 | INVALID_SELECTION | right |
| `:36399` / `:36500` | deleteAssetsFromDisk / deleteAssetsPermanent：空/重复 | INVALID_SELECTION | right |
| `:37340` / `:37343` | deleteLinkedAssets：空或 >20；重复 id | INVALID_SELECTION | right（>20 上限无文案，F13） |
| `main/index.ts:4667` | 序列确认：所选帧区间解析后无源文件 | INVALID_SELECTION | right |

**B 组：`ASSET_ALREADY_TRASHED`**

| file:line | 场景 | shipped | verdict |
|---|---|---|---|
| `:14227` / `:14236` | deleteAssetsFromDiskAsync：已回收（循环内 / 批次后） | ASSET_ALREADY_TRASHED | right |
| `:35314` | trashAssets：再次回收同一资产（工单主诉） | ASSET_ALREADY_TRASHED | right |
| `:35562` | trashSelection：批内含已回收项 | ASSET_ALREADY_TRASHED | right |
| `:36435` | deleteAssetsFromDisk：已回收 | ASSET_ALREADY_TRASHED | right |
| `:37595` | relinkAsset：对已回收资产重新定位 | ASSET_ALREADY_TRASHED | right |

**C 组：`ASSET_NOT_MANAGED`**

| file:line | 场景 | shipped | verdict |
|---|---|---|---|
| `:14224` / `:14233` | deleteAssetsFromDiskAsync：非 managed（循环内 / 批次后） | ASSET_NOT_MANAGED | right |
| `:35313` | trashAssets：链接资产 | ASSET_NOT_MANAGED | right |
| `:35559` | trashSelection：批内含链接资产 | ASSET_NOT_MANAGED | right |
| `:36432` | deleteAssetsFromDisk：非 managed | ASSET_NOT_MANAGED | right |
| `:37373` | deleteLinkedAssets：资产存在但不是「活跃链接资产」 | ASSET_NOT_MANAGED | **wrong** → 已回收的链接资产应为 `ASSET_ALREADY_TRASHED`；managed 资产应为 `INVALID_SELECTION`（F2） |

**D 组：`ASSET_NOT_TRASHED`**

| file:line | 场景 | shipped | verdict |
|---|---|---|---|
| `:35732` | previewRestoreAssets：资产存在但未回收 | ASSET_NOT_TRASHED | **wrong copy**（恢复场景下解法反向，F5） |
| `:35831` | restoreAssets：同上 | ASSET_NOT_TRASHED | **wrong copy**（F5） |
| `:36312` | restoreAssetsIfOriginalVacant：同上 | ASSET_NOT_TRASHED | **wrong copy**（F5） |
| `:36530` | deleteAssetsPermanent：活动资产被永久删除 | ASSET_NOT_TRASHED | right（「先移入回收站」在此可用） |

**E 组：`INVALID_STATE_TRANSITION`**

| file:line | 场景 | shipped | verdict |
|---|---|---|---|
| `:14068` / `:14151` | 查询结果少于请求批次（资产已被回收 / 非 managed / 不存在） | INVALID_STATE_TRANSITION | right-enough（确属状态竞争；异步兄弟函数 `:14219-14237` 会逐 id 给出 `ASSET_ALREADY_TRASHED`/`ASSET_NOT_MANAGED`，此处未对齐，但不是错码） |
| `:37596` | relinkAsset：资产已不 missing（可能被自动修复） | INVALID_STATE_TRANSITION | right |
| `:14230` / `:36438` / `:36532` | 「行数与去重后的 id 数不一致」兜底 | INVALID_STATE_TRANSITION | unreachable（死代码，F15） |
| `:41094` | resolveImport：该导入正在等待「源失败」决定 | INVALID_STATE_TRANSITION + reason | **wrong**（假原因 + 与自身 reason 矛盾，F4） |

**F 组：其它新码 / 复用码站点**

| file:line | 场景 | shipped | verdict |
|---|---|---|---|
| `:16596` | createImageSequence：选中帧缺失/已回收/不可用/已成序列 | ASSET_STATE_CONFLICT | right（`已成序列` 子情形文案略泛） |
| `:21098` | generateThumbnail：mediaType other 或无解码器 | UNSUPPORTED_MEDIA_TYPE + reason | right-enough（reason 重复且含「当前切片」，F6/F9） |
| `:26864` | resolveModelCompanions：非受支持模型扩展名 | UNSUPPORTED_MEDIA_TYPE + reason | right |
| `:26910` | enqueueArtifactRetry：kind 与媒体类型不符 | UNSUPPORTED_MEDIA_TYPE + reason | right |
| `:33931` | readTextAsset：非文本资产 | UNSUPPORTED_MEDIA_TYPE + reason | right（查看器只对 text 打开，防御） |
| `:33973` | readTextAsset：内容含 NUL（二进制伪装文本） | UNSUPPORTED_MEDIA_TYPE + reason | **wrong**（原因错、解法不可用，F3） |
| `:34036` | saveTextAsset：非文本资产写回 | UNSUPPORTED_MEDIA_TYPE + reason | right（防御） |
| `:19496` | clearAiContent：folder/library scope 未带 confirm | CONFIRMATION_REQUIRED | right-enough（unreachable，F11） |
| `:16576` / `:16663` | 序列图 fps 非有限 / 越界 | INTERNAL_ERROR | unreachable（对话框 + MCP schema 双重拦截，F14） |
| `:31803` / `:31931`（code 实参）→ `:32036`/`:32040` | 智能合集 queryDefinitionJson 非法 | INVALID_SMART_COLLECTION_QUERY | right（`:32034` 形参联合类型已同步，`:32017` 仍用 `LIBRARY_CORRUPT` 正确） |
| `:13518` / `:13648` | 链接目录相对路径不可规范化 | INVALID_FOLDER_NAME | right |
| `:38220` / `:38230` / `:38245` | 链接规则 pattern 空 / 含分隔符或 `..` / 清空前导点后为空 | INVALID_FOLDER_NAME | right-enough（措辞偏泛，F16） |
| `:38592` | setIgnore：扩展名忽略项含 `/`、`\` | INVALID_FOLDER_NAME | right-enough（对象是扩展名，F16） |
| `:32298` / `:32358` | placeManagedRelinkFile：落点已被占用 | ASSET_FILE_NAME_CONFLICT + SOURCE_CHANGED | **wrong reason**（附加 reason 与首句原因冲突，F8b） |
| `:35348` | trashAssets 第一阶段 lstat 非「路径不可读」失败 | LIBRARY_IO_ERROR + IO_ERROR | right（该分支在任何记录写入之前抛出，无脏记录） |
| `:39527` | prepareImport 收到链接文件夹目标（调用方契约错） | AUTOMATION_FILE_PLAN_INVALID + SOURCE_NOT_FOUND | **wrong reason**（F8） |
| `:11130` | 自动化预览：move 目标文件夹不存在 | FOLDER_NOT_FOUND | unsure → 文案归因磁盘断开（F10） |
| `:19510` | clearAiContent：folder scope 缺 folderId | FOLDER_NOT_FOUND + SOURCE_NOT_FOUND | unsure（unreachable + 归因磁盘断开、附加 reason 与场景无关，F10/F8） |
| `main/index.ts:4219` / `:4225` | 未接受数据发送说明 / 无 API Key 就开自动分析 | AI_ANALYSIS_FAILED + AI_NOT_CONFIGURED | **wrong lead cause**（F7） |
| `main/index.ts:4649` | 序列确认 sequenceIndex 过期（对话框过期） | IMPORT_NOT_FOUND | right |

---

## 5. 日志 / 记录副作用专项（优先级 3 的逐项回答）

| 问题 | 结论 | 证据 |
|---|---|---|
| `updateImportOperation(pending,'rolled_back','INVALID_IMPORT_DECISION')` 是否还真实？ | **真实，无需改**。触发条件是 `suspectedDuplicate`/`nameConflict` 取值非法——正是「导入冲突决策无效」，与码文案完全一致；写入与抛出同源（`41102` 写、`41104` 抛）。 | `library-service.ts:41098-41105`、`7473-7487` |
| 有没有别处把本单新码写进 `error_code`/状态？ | 没有。本单改判的路径要么在任何 DB 写入之前抛出（`35348`），要么用各自私有的 apply-failed 码（`RESTORE_APPLY_FAILED` `:36132`、`COPY_APPLY_FAILED` `:33793`、`MOVE_APPLY_FAILED` `:32999`、`FOLDER_TRASH_APPLY_FAILED` `:13238` 等），与抛出的公开码分离。`jobs.error_code` 是唯一被本单新码喂到的地方（F9）。 | 全仓 `error_code` grep |
| 有没有重命名留下过时/歧义/重复的码串？ | 生产代码里没有：`INVALID_IMPORT_DECISION` 只剩 `41102/41104`（grep 全文 6 命中：协议定义 1 + 注释 1 + 两 catalog + 这两处）。测试里剩 `import-planning.test.ts:1199`（正当用例）与 `comprehensive-perf-bench.test.ts:136` 的一条注释仍在说「触发 INVALID_IMPORT_DECISION」（该注释已过期，现在触发的是 `ASSET_ALREADY_TRASHED`；仅注释，低）。 | `grep -n INVALID_IMPORT_DECISION src tests` |
| 有没有「emit 了但渲染不出来」的码？ | **有**：`UNSUPPORTED_MEDIA_TYPE` 经 `jobs.error_code` → `messageForAiErrorCode` 只查 `error.reason.*` → 回退成裸码字符串，出现在 AI 批量失败的阻塞窗/toast（F9）。其余 7 个新码在两个 catalog 都有条目，可渲染。 | `worker/index.ts:1531,4470-4480`、`ai-job-error-message.ts:10-17`、`App.tsx:10161-10178` |
| 诊断日志记录是否仍真实？ | **真实且比改前更有信息量**：`LibraryServiceError` 的 `super(code)` 使 `error.message === code`（`library-service.ts:4616-4631`），`AppLogger.serializeError` 记录 `code` + `message` + stack（`app-logger.ts:57-70`），诊断查看器原样显示 scope/文本（`AppLogDialog.tsx:116-141`）——它本来就是技术日志，展示英文码符合 0004 §3 的「打开诊断日志查看本次记录」定位。改判后同一次失败在 UI 句子与日志里由**同一个 code**贯穿，可用 code 对上。 | 同上 |
| 有没有地方把原始英文 `message` 渲染进中文界面？ | **有 6 处，其中 4 处正是本单改判的站点**（`App.tsx:6244/6276/6292/6306` + `TextViewerControls.tsx:114/216`），是本单最需要跟进的副作用（F1）。 | 见 F1 |
| `file_operations.error_code` 的码空间是否被本单搞得更混乱？ | 未加剧，但该列本身混装三类字符串（私有码如 `PROCESS_INTERRUPTED`、公开码如 `INVALID_IMPORT_DECISION`、公开 reason 同名串如 `SOURCE_TRASH_RECONCILIATION_REQUIRED`，见 `:8135` vs `zh-CN.ts:2160`）。这是既有设计，本单没有新增混淆；若要收口建议另开单统一成「私有码」或加前缀。 | `:8135`、`:41102` |

---

## 6. Tests（优先级 4）

已复跑：`tests/unit/error-state-transition-copy.test.ts` 21 passed；worker 11 套合计 388 passed | 3 skipped，全绿。`tests/worker/{trash-relink,image-sequence,linked-folders,search,organization,model-pipeline}.test.ts` 的断言与 shipped 码一致（`trash-relink.test.ts:389/427/1188/1203/1269/1290/1297/1777/1932/2044/2100`、`image-sequence.test.ts:677-680/717`、`linked-folders.test.ts:634-636`、`organization.test.ts:1467/1478/1636`、`search.test.ts:1872/1936/1951`、`model-pipeline.test.ts:605-606`）。

缺口：

1. **Phase 2 的两个新码 + 两个新 reason 完全没进文案测试**：`error-state-transition-copy.test.ts:17-36` 只列了 Phase 1/修正期的 6+6 个码，`UNSUPPORTED_MEDIA_TYPE`、`CONFIRMATION_REQUIRED` 不在其中（21 条测试数未变，说明 Phase 2 没动这个文件）。⇒ 中英缺失/漂移不会被发现。
2. **只断言 code，不断言用户看到的句子**：worker 侧全部是 `toMatchObject({ code })` / `expectServiceCode(..., 'X')`；唯一断言整句的是 `error-state-transition-copy.test.ts:79-92`（`INVALID_SELECTION` + `IMAGE_SEQUENCE_SELECTION` 的 zh 合成句）。`ASSET_STATE_CONFLICT`、`ASSET_NOT_TRASHED`、`UNSUPPORTED_MEDIA_TYPE`、`CONFIRMATION_REQUIRED`、`IMPORT_AWAITING_SOURCE_DECISION` 的合成结果都没有断言——F3/F4/F5/F6 这四类「句子本身错」的问题因此不会被测试挡住。
3. **`clearAiContent` 的 confirm 分支未固化**：`ai-completion.test.ts:577-583`、`:588-597` 只 `expect(...).toThrow()`；从 `INVALID_IMPORT_DECISION` 改成 `CONFIRMATION_REQUIRED`（并删掉 reason `PERMISSION_DENIED`）无任何断言（`git diff` 显示 Phase 2 未改该文件）。
4. **fps → `INTERNAL_ERROR`** 无断言（`image-sequence.test.ts` 只测合法 fps）。
5. **`prepareImport` 链接目标 → `AUTOMATION_FILE_PLAN_INVALID`** 无断言；`import-planning.test.ts:1197-1200` 只覆盖 resolveImport 的两种决策取值。
6. **`main/index.ts:4649` 的 `sequenceIndex` 过期**（`INVALID_IMPORT_DECISION`→`IMPORT_NOT_FOUND`）无单测（该分支在 Electron/E2E 面）。
7. **`enFor()` 的宽容写法**（`:46-48`）同时接受 catalog 与协议文本，使 en catalog 与协议文本的漂移（F18 的 5 个码）无法被断言发现。
8. **验收清单 `ERROR-STATE-001` 第 ⑤ 条预期与实现不符**（见 F1）：清单要求人工核对「所选内容不适用于这项操作，原因：…」，而该路径显示英文原文且丢掉 reason。这会让人工验收给出错误结论（无论判通过还是判失败都不是基于真实文案）。

---

## 7. What the work does well

- 三个主诉码（`ASSET_ALREADY_TRASHED` / `ASSET_NOT_TRASHED` / `ASSET_NOT_MANAGED`）与两个新码（`INVALID_SELECTION` / `ASSET_STATE_CONFLICT`）的语义选得准，「已回收/未回收/非托管/所选不适用」四种事实终于各说各的；并且把原来 `location_kind !== 'managed' || deleted_at !== null` 这种「一条件两原因」拆成两条判断（`14224/14227`、`14233/14236`、`35313/35314`、`36432/36435`），这是真正的原因层修复而不是换码补丁。
- 8 个新增码/reason 在两个 catalog 都有条目，且**这是全仓少见的「en catalog 文本与 `PUBLIC_ERROR_MESSAGES` 逐字节一致」的一批**（`errors.ts:65-87`），协议 `message === PUBLIC_ERROR_MESSAGES[code]` 的 refinement（`errors.ts:206-209`）对新码全部成立；`INVALID_IMPORT_DECISION` 从 77 处降到 2 处正当用法（`41102/41104`），审计的四类用户可见错配（智能合集查询、链接规则模式、回收站 lstat、Main AI/帧区间）都在本单内收口，而非留给下一单。
- 我复跑的 11 套 worker + 1 套 unit 全绿（388+21 passed），Phase 2 是在「保持既有断言成立」的前提下完成的；文案测试用 `messageForCode` 而非 fallback 作断言，方向正确。

---

## 8. Counts summary

| 指标 | 数量 |
|---|---|
| 复核站点数（本单改判的调用点，去重） | **73**（Phase 1 40 + 修正期新增 16 + Phase 2 17） |
| verdict = right / right-enough | **58** |
| verdict = wrong（应改码或改 reason） | **11**：`library-service.ts:37373`、`:33973`、`:41094`、`:35732`、`:35831`、`:36312`、`:39527`、`:32298`、`:32358`、`main/index.ts:4219`、`:4225` |
| verdict = unsure / unreachable 需处理 | **4**：`:11130`、`:19510`、`:16576`、`:16663`（另有 `:14230/:36438/:36532` 记入死代码） |
| 文案问题（句子层面） | **9 类 / 20 余个站点**：F3（1）、F4（1）、F5（3）、F6（6）、F7（2）、F8（3）、F10（2）、F13（多处，低）、F14（2，低） |
| 日志/诊断问题 | **2** 实有问题（F9 不可渲染码、F1 英文 message 直出且丢 reason）+ 4 项核对为清白（`updateImportOperation`、诊断日志真实性、无过时码串、无脏记录） |
| 测试缺口 | **8**（§6 第 1–8 条） |
| 文档不实 | **2**（开发日志 §7 的「19 处」与「当前行号」，F12；清单 ⑤ 的预期，F1） |
| 未验证项 | 缩略图/`jobs.error_code` 的端到端运行样例（F9 为静态链路）；未跑 Electron E2E 与 `test:library-availability`（brief 要求） |

## 9. 未覆盖 / 明确不做

- 未运行 Electron E2E 与 `npm run test:library-availability`（brief 明令）；因此「界面实际显示整句」的依据是代码通路（`error-utils.ts` + catalog + `App.tsx` 站点），不是运行截图。
- `INTERNAL_ERROR` 在 shell/剪贴板路径的系统性收口、`FOLDER_ALREADY_EXISTS`/`VERSION_CONFLICT`/7 个缺文案码/worker 硬编码中文缩略图文案（审计 §4.2/§4.5/§4.7/§4.8）属 `Serpent-3c71f3`，本报告只在 F1/F10 处交叉引用，不重复展开。
- 「每类非法状态幂等成功而非报错」的产品口径未评（本单未做，也不该由本复核决定）。
- 本报告不构成 `accepted`；人工/平台证据仍缺（清单 `ERROR-STATE-001` 为「待人类验收」，且其 ⑤ 的预期需先按 F1 修正）。
