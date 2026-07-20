# Serpent AI 反馈交接文档（2026-07-20）

> 交接给下一位实施者。本会话由主 agent（opus）执行，已合入 12 个提交到 `codex/slice-002-asset-ingestion`（本地，**未 push**）。本文档记录已完成项、门禁状态、剩余工作、关键代码位置、以及一个重要的 worktree 教训。
>
> **2026-07-20 午间验收收尾（后继 agent）**：已在当前分支直接补齐 F4/F7、修 F5 多选确认与 AI 态刷新、F6 `progress>0` 门槛、3+1 个 setState-in-effect lint；校准 beads 与 `human-acceptance-checklist`（AICFG-004/005、INSPECT-AI-001、MENU-AI-001、JOBS-001）。F8 仍待用户讨论。详见本文 §验收收尾。

## 0. 背景

2026-07-20 用户提出 9 条 AI 功能反馈，拆解为 8 张 beads 工单（F1–F8）+ F8 为讨论项：

| 编号 | 工单 | 需求 |
|---|---|---|
| F1 | Serpent-lqof | API Key 输入框眼睛图标切换显隐 |
| F2 | Serpent-z1oe | 设置界面纯白按钮批量改 token |
| F3 | Serpent-6xj8 | AI 信息蓝色强调色角标 |
| F4 | Serpent-a7ol | AI 信息可编辑，编辑后转人工（不再算 AI） |
| F5 | Serpent-4ia2 | 右键清除 AI 信息（单项 + 多选批量） |
| F6 | Serpent-jwg1 | 耗时后台任务用进度条提示进度 |
| F7 | Serpent-fwne | 自动连接 AI + 实时显示连接情况 |
| F8 | Serpent-1us6 | AI 分析设计进一步讨论（输出字段/配置项/提示词模板） |

## 1. 已完成并合入 main

main HEAD = `e5f8539`。提交链（旧→新）：

- `2b69df7` F1 API key 眼睛图标（初版，独立按钮）+ `a35efad` beads close
- `e147fd8` 修复 OpenAI 适配器解析回归（a9b47dd 遗留，5 单测+2 worker）+ `6ca8402` beads close
- `8af825a` theme-css-tokens hex 修复（#e11d48/#c44 → var(--danger)）
- `e990d97` react-hooks/refs 修复（media seek session 移入 effect）
- `d6dbe0e` exhaustive-deps 修复（cancelDiskDelete）
- `95e749a` CU-M5 智能合集测试对齐（create 允许草稿、update 验证）
- `cb0d599` folder-rename 递归计数 bug 修复 + video-exr/thumbnails stale 测试
- `ffbf9f4` F1 改为内嵌输入框右侧（用户拒独立按钮后的修复；AICFG-003 待人类复验）
- `3f36efa` F2 light `--raised #ffffff → #f1f3ef`（纯白按钮根因）
- `f1f28a4` F5 asset.clear-ai-content 命令 stub（可选 action + 命令定义）
- `a5030c4` F6 进度条（MediaJobsDialog + token CSS + i18n）
- `e5f8539` F5 接线（AssetContextMenu 单+多选 + asset-multi-commands 批量 + App handleClearAiContent + i18n + 测试）

### 各反馈项状态

- **F1（眼睛图标）**：已实现为内嵌输入框右侧（`ffbf9f4`，`.ai-config-visibility-toggle` 绝对定位、透明无描边、input 右内边距避让）。**待用户视觉复验**（AICFG-003 在 human-acceptance-checklist，状态"待人类验收"；Serpent-lqof beads 状态 in_progress）。
- **F2（纯白按钮）**：根因 = light `--raised: #ffffff`，已改 `#f1f3ef`（`3f36efa`）。**剩余**：审计所有设置面板按钮确认无原生纯白 `<button>`（见 §3）。
- **F3（蓝色角标）**：**已存在**——`.inspector-ai-badge`（styles.css:4924）用 `background: var(--accent-soft); color: var(--accent)`（THEME-001 蓝色 accent），AI section 上的 "AI" pill（InspectorPanel.tsx:1267）。无需新工作。
- **F4（编辑转人工）**：**未合入**——两次 sonnet worktree 实现正确但 cherry-pick 失败（见 §5 教训）。需在 main 上重做（见 §3）。
- **F5（右键清 AI）**：已实现并合入（`e5f8539`）。`clearAiContent` 全链路就绪；worker `clearAiContent` 在 worker/index.ts:1304 发 `ai.content.cleared` 事件 → worker-client.ts:71 监听 → App `onAiCleared` 刷新+toast。**待人类验收视觉**。Serpent-4ia2 beads 状态 in_progress（实现完成，可 close）。
- **F6（进度条）**：已实现并合入（`a5030c4`）。MediaJobsDialog 媒体任务用 `job.progress`（0..1）定进度条，AI 任务用 indeterminate 滑动条；i18n `progress`/`progressDone`（ catalogs/zh-CN.ts + en.ts）；token CSS 无 hex。**待人类验收视觉**。Serpent-jwg1 beads 状态 open（实现完成，可 close）。
- **F7（自动连接+状态）**：**未合入**——两次 sonnet worktree 实现正确但 cherry-pick 失败。需在 main 上重做（见 §3）。
- **F8（AI 分析讨论）**：**待用户拍板**（见 §4）。

## 2. 门禁状态（main @ e5f8539）

| 门禁 | 状态 |
|---|---|
| `npm run typecheck` | ✅ PASS |
| `npm run test:unit` | ✅ 1020 passed, 0 failed（116 files） |
| `npm run test:worker` | ✅ 634 passed, 0 failed（33 files） |
| `npm run lint` | ❌ 3 errors（setState-in-effect，见 §3） |

## 3. 待办（剩余工作）

### F4 (Serpent-a7ol) — AI 信息可编辑，编辑后转人工【需在 main 重做】

两次 sonnet（commit `1348351`）实现都正确（typecheck+全量 unit 绿），但 worktree 从旧 base 分出，cherry-pick 到 main 会 AA/UU 冲突。在 main 上直接重做：

**实现要点：**
1. `src/renderer/InspectorPanel.tsx`：
   - `AiContent` 类型（line 80）：`{assetId, description?, tags?, structuredMetadata?, modelVersion?}`。
   - `InspectorPanelProps`（line 88）：加 `onPromoteAiDescription?: (value: string) => void`（在 `onOpenSourceUrl` 后，~line 129）。
   - AI section（line 1264-1293）：把 `<p className="inspector-ai-text">{aiContent.description}</p>`（line 1273）改为可编辑 `<textarea>`（`defaultValue={aiContent.description}`、`onBlur` 调 `onPromoteAiDescription?.(value)`）。最简方案用 `defaultValue`（非受控，无需 local state）；要 autogrow 可仿 human description 的 `resolveAutoGrowHeight` + `descriptionRef`（line 680）。
2. `src/renderer/App.tsx`：
   - 加 `handlePromoteAiDescription(value)`：`if (value === aiContent?.description) return;` → `void saveMetadata({ description: value })`（saveMetadata 签名 line 3447；用法见 line 4917 `saveMetadata({ description: editDescription })`）→ `await api.clearAiContent({ libraryId: library.libraryId, scope: { kind: 'asset', assetIds: [selectedAsset.assetId] }, confirm: false })` → `loadMetadata()` → 成功 toast `toast.aiContentPromoted`、失败 error toast。
   - InspectorPanel 渲染点 line 6584-6623：加 `onPromoteAiDescription={handlePromoteAiDescription}`。
   - 仿 F5 的 `handleClearAiContent`（line ~5262）toast 模式；**不要改** `handleClearAiContent` 或 `onClearAiContent`。
3. i18n `catalogs/zh-CN.ts` + `catalogs/en.ts`（**编辑现有文件，不要新建 `i18n/zh-CN.ts`**）：
   - `inspector` section（~line 437 有 `descriptionAi`）加 `editAiDescription`（zh "编辑 AI 描述（转为人工）" / en "Edit AI description (promote to human)"）。
   - `toast` section（~line 813 有 `aiContentCleared`）加 `aiContentPromoted`（zh "已转为人工内容" / en "Promoted to human content"）。
   - 两 catalog 同键（en 类型 = typeof zhCN，缺键 typecheck 会失败）。
4. `styles.css`：若需要 `.inspector-ai-textarea`，只用现有 token（`var(--pane)`/`var(--secondary)`/`var(--divider-soft)` 等），**无 raw hex**。不要碰 `.task-progress-*`（F6）或 `.ai-connection-*`（F7）。

**已知限制（诚实记录）：** `clearAiContent` 清该资产**全部** AI（描述+标签）。编辑 AI 描述会连 AI 标签一起清掉。逐字段清需新 worker API（超范围）。

### F7 (Serpent-fwne) — 自动连接 + 实时连接状态【需在 main 重做】

两次 sonnet（commit `ed8284b`）实现都正确，但 worktree 从旧 base 分出，cherry-pick 失败。在 main 上直接重做：

**实现要点：**
1. `src/renderer/AiConfigDialog.tsx`：加 `connectionState: 'idle'|'connecting'|'connected'|'disconnected'|'error'` + `connectionReason?: string` props。dialog header（标题 `<h2>` 旁）加状态指示（dot + label + reason），仅 `state !== 'idle'` 时渲染。保留现有手动"测试连接"按钮。
2. `src/renderer/App.tsx`：
   - `handleTestConnection`（useCallback，调现有 `onTestConnection`）。
   - auto-connect：`useEffect` on `aiConfigOpen`，用 `useRef(false)` guard，`aiHasKey` 为真时触发一次 `handleTestConnection`。
   - `saveAiConfig` 成功后调 `handleTestConnection`：成功关对话框，失败留开 + 显示原因。
   - `aiConnectionState`/`aiConnectionReason` state + reset to 'idle' on close/cancel。
   - 传给 AiConfigDialog。**不要碰** `handleClearAiContent`（~line 5262，F5）。
3. `src/main/index.ts`：`ai.test-connection.request` handler 当 renderer 传空 `apiKey` 时，用 `getDecryptedApiKey()` 回退（存储的 key）。错误码用 `AI_NOT_CONFIGURED`/`AI_ANALYSIS_FAILED`（**不要用 `NOT_A_LIBRARY`**——会映射到"所选文件夹不是 Serpent 资源库。"误导）。复用现有 test-connection 路径，不加新网络原语。
4. i18n `catalogs/zh-CN.ts` + `catalogs/en.ts`：`aiConfig` section（~line 623 zh / 633 en，有 `showApiKey`/`testConnection` 等）加 `connectionConnected`/`connectionConnecting`/`connectionDisconnected`/`connectionError`（zh "已连接"/"连接中"/"未连接"/"连接错误"，en "Connected"/"Connecting"/"Disconnected"/"Error"）。两 catalog 同键。
5. `styles.css`：加 `.ai-connection-indicator`/`.ai-connection-dot`/`.ai-connection-label`/`.ai-connection-reason` + `@keyframes ai-connection-pulse`，**只用现有 `:root` token**（`var(--success)`/`var(--danger)`/`var(--warning)`/`var(--tertiary)`/`var(--secondary)`），**不重声明 token**，**无 raw hex**。不要碰 `.task-progress-*`（F6）。

### F2 剩余 (Serpent-z1oe) — 纯白按钮批量审计

`--raised` hex 部分已做（`3f36efa`）。剩余：审计所有设置面板确认无原生纯白 `<button>`。设置对话框（AppSettingsDialog/ExportDialog/SmartCollectionSettingsDialog/AiConfigDialog）的按钮已用 token className（`secondary-button`/`primary-button`/`dialog-close`/`app-settings-option`，均样式化）。grep `<button` 无 className 的项，确认无遗漏。视觉验收（亮色主题下不再有纯白块）。

### 3 个 setState-in-effect lint（非反馈，HEAD 红）

React 19 `react-hooks/set-state-in-effect` 规则对"按 prop 同步/重置 state"合法模式的保守报错：

- `src/renderer/AudioPlayerControls.tsx:115`（`setTrailParticles([])` in `[src]` effect）
- `src/renderer/SmartCollectionSettingsDialog.tsx:34`（`setName(target?.name ?? ""); setBusy(false)` in `[target]` effect）
- `src/renderer/TextViewerControls.tsx:37`（`setLoading(true)` in fetch effect）

**修法（key-reset）：**
- SmartCollectionSettingsDialog：App.tsx:6769 `<SmartCollectionSettingsDialog>` 加 `key={smartCollectionSettings?.collectionId ?? 'none'}` + 删 effect（line 33-36）。**注意**：rename 后 `target.name` == 用户输入（setName 无操作），busy 由 `run()` 管——key-reset 后确认这两点。
- TextViewerControls：AssetPreviewModal.tsx:529 `<TextViewerControls>` 加 `key={\`${libraryId}:${assetId}\`}` + 删 effect 的 `setLoading(true)`（useState init 已 true）。
- AudioPlayerControls：AssetPreviewModal.tsx:522 `<AudioPlayerControls>` 加 `key={src}` + 删 `[src]` effect 的 `setTrailParticles`（useState [] init）。`[src]` effect 的 `seekSessionRef.current?.cancel()` 保留（ref 操作不触发规则）。
- **需行为保持 + E2E**（media-video-playback / media-preview / 相关）。discipline #10：根因修复，不是 disable 注释。

## 4. F8 (Serpent-1us6) — AI 分析设计讨论（待用户）

用户明确要"进一步讨论后再定，勿先行实现"。待用户回 5 个决议点：
1. 输出 JSON schema 字段集（标签/作者/描述/美学评分/其他？）。
2. 用户可配置项（最大标签数、评分标准提示词、描述字数上限、输出风格 正常/精简/严谨、描述默认结构 先类型→风格→内容）+ 默认值。
3. 视觉分析提示词模板（用户已给草案：复用已有标签数组、标签不超最大数、评分 1-5 带可设标准、描述按类型-风格-内容顺序且限字数、以指定风格输出、严格 JSON）+ 占位符最终取值。
4. 配置 UI 形态（AI 设置面板？独立？）。
5. 与现有 AI 内容层 / schema v15 关系（新生成结果原子替换该资产 AI 内容，产品简报已定；字段映射）。

决议后产出实现规格 + 提示词工程。用户提示词草案全文见 Serpent-1us6 工单描述 + 本会话历史。

## 5. 重要教训：worktree isolation 在此 repo 不可靠

本会话用 `isolation: "worktree"` 派的 sonnet agent **全部从旧 base 分出**（a9b47dd / 3f36efa / 85a327e，非当前 HEAD），cherry-pick 到 main 会 AA（add/add）/UU 冲突：
- F6（`39f9fde`）+ F5 收尾（`9fc35ce`）侥幸 cherry-pick 干净（diff 上下文未撞）。
- F4（`1348351`）+ F7-redo（`ed8284b`）两次实现都正确（typecheck+unit 绿），但 cherry-pick 全失败（diff 上下文与 main 错位 + AA 把文件当新增）。

**建议：** 剩余 F4/F7/3-state-effect 在 main 上**直接做**（不用 worktree），或用**非 worktree 的 sequential agent**（在当前 main worktree 上 sequential 跑，无 stale-base 问题）。不要再用 `isolation: "worktree"` 派 agent 改共享文件（App.tsx/i18n/styles.css）。

## 6. 关键代码位置

- **clearAiContent 全链路**（F5 用，F4 也要用）：
  - `src/worker/library-service.ts:6746` `clearAiContent(input)`（清全部 AI，返回 `{clearedCount}`）
  - `src/worker/index.ts:1304` 调 `libraryService.clearAiContent` + line 1308 发 `ai.content.cleared` 事件
  - `src/main/worker-client.ts:71` `#aiClearedListeners` + line 245 解析 + `onAiContentCleared` 监听
  - `src/preload/index.ts:1092` `clearAiContent` + line 1161 `onAiCleared`
  - `src/shared/library-api.ts:371` `clearAiContent` 类型签名
- **AI 适配器解析**（已修复）：`src/worker/ai/protocol.ts` `parseAiAnalysisResult`（内置 `stripNullValues` 丢 null）；`src/worker/ai/openai-adapter.ts` `#extractChatResult`/`#extractResponsesResult`（先加 modelVersion 再 parse + try/catch→invalid_response）。ai-protocol.test.ts 35/35。
- **Inspector AI section**：`src/renderer/InspectorPanel.tsx:80`（AiContent 类型）、`:88`（props）、`:1264-1293`（AI section）、`:1133`（human description textarea）、`:680`（autogrow）。
- **AI 设置**：`src/renderer/AiConfigDialog.tsx`（API key 眼睛 `.ai-config-visibility-toggle` 已内嵌）、`src/shared/ai-endpoints.ts`、`src/worker/ai/*-adapter.ts`。
- **媒体任务进度条**（F6）：`src/renderer/MediaJobsDialog.tsx:125-262`、`src/renderer/styles.css` `.task-progress-*`（~5461）。
- **beads 工单**：`.beads/`（进 git）。`bd show <id>` 查看。`bd ready` 取无阻塞工单。

## 7. beads 工单状态（需校准）

- Serpent-lqof（F1）in_progress——实现完成（`ffbf9f4`），待人类视觉复验。
- Serpent-z1oe（F2）open——hex 已做（`3f36efa`），白按钮审计未做。
- Serpent-6xj8（F3）open——badge 已存在，可 close（"已实现 .inspector-ai-badge"）。
- Serpent-a7ol（F4）open——需重做。
- Serpent-4ia2（F5）in_progress——实现完成（`e5f8539`），可 close（待人类验收视觉）。
- Serpent-jwg1（F6）open——实现完成（`a5030c4`），可 close（待人类验收视觉）。
- Serpent-fwne（F7）open——需重做。
- Serpent-1us6（F8）open——待用户讨论。
- 额外：Serpent-d0oo（OpenAI 适配器回归）已 close（`e147fd8`）。

## 8. 验证命令

```bash
npm run typecheck     # tsc --noEmit + extension
npm run lint          # eslint
npm run test:unit     # vitest 单元
npm run test:worker   # vitest worker 集成
npm run test:e2e      # Playwright E2E（Electron，后台跑，勿抢前台）
```

当前 main：typecheck + unit（1020）+ worker（634）全绿；lint 仅 3 setState-in-effect。

## 9. 未 push + git 身份

- 本会话 ~12 个本地 commit（`2b69df7`..`e5f8539`）**未 push** 到 `origin/codex/slice-002-asset-ingestion`。`git push` 同步。
- 提交者身份 `Dolag <dolag@MacBookAir.insania.ichor.work>`（本机 hostname）——push 前 `git config --global user.email <正式邮箱>` + `git config --global user.name <正式名>`，或用 `git rebase --exec` 重写 author。

## 10. human-acceptance-checklist（docs/qa/human-acceptance-checklist.md）

- AICFG-003（F1 眼睛图标）状态"待人类验收"——用户曾不通过（独立按钮），已改为内嵌（`ffbf9f4`），待复验。
- AICFG-002（AI 自定义端点）"待人类验收"。
- 视觉项（F2/F5/F6/F7）实现后均需用户实机视觉验收——本会话环境无 Computer Use，不能自签。

## 11. 验收收尾记录（2026-07-20 午间）

### 前会话质量问题（已修）

| 问题 | 严重度 | 处理 |
|---|---|---|
| F4/F7 声称「实现正确」但未合入 main | 高 | 在当前分支直接重做并接线 |
| F5 多选无 UI 确认（产品简报要求批量确认） | 高 | `confirm()` + i18n |
| F5 清除后 Inspector 仍显示本地 `aiContent` | 中 | `onAiCleared` / 成功路径 `setAiContent(null)` |
| F6 媒体进度条要求 `progress > 0` 才显示 | 中 | running 即显示，clamp 0..1 |
| lint 3× setState-in-effect（预览/智能合集） | 中 | key-remount，删 sync effect |
| test-connection 无 Key 时走 `CANCELLED` | 中 | Main 早处理 → `AI_NOT_CONFIGURED` |
| beads 与真实完成度脱节；清单缺 F4–F7 条目 | 中 | close 校准 + 新增验收 ID |
| F3 仍 open 尽管 badge 早已存在 | 低 | close |
| worktree isolation 导致无效劳动 | 流程 | 本收尾未再用 worktree |

### 门禁（收尾后）

- `npm run typecheck` ✅
- `npm run lint` ✅（原 3 error 已清）
- 相关 unit（asset-commands / multi / ai-endpoints / ai-search-planner）✅
- 全量 unit/worker/E2E：未在本收尾重跑全量（建议提交前主 agent 跑 `verify:mainline` 或至少 unit+worker）

### 仍待用户

- F8（`Serpent-1us6`）设计讨论
- 人类验收：AICFG-002/003/004/005、INSPECT-AI-001、MENU-AI-001、JOBS-001
- `Serpent-lqof` 可保持 open/in_progress 直至 AICFG-003 人类通过
- 未 push 的前会话 15 commit + 本收尾未提交改动：需用户确认后 commit/push
