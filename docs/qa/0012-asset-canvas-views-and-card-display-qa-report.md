# 0012 QA 报告 — 资产画布视图与卡片信息配置

> 分支:`codex/slice-002-asset-ingestion`
> 基线:`60d3515`;本切片改动:工作树(待提交,见开发日志)
> 构建环境:macOS arm64(Darwin 25.5.0),Node 24(`.nvmrc` 24.15.0),Electron + Vite production-like build(`.vite/build` main/preload/worker + renderer)
> 日期:2026-07-14

## 自动化结果

| 检查 | 命令 | 结果 |
|---|---|---|
| lint | `npm run lint` | GREEN(0 error;初次 3 个 unused-vars 已修) |
| 类型检查 | `npm run typecheck` | GREEN(tsc --noEmit + tsconfig.extension.json) |
| 单元 | `npm run test:unit` | 26 files / 259 passed |
| Worker 集成(含 search-perf) | `npm run test:worker` | 24 files / 536 passed + 1 skipped(platform skip) |
| 回归 E2E(media-preview + organization-search-trash) | `node scripts/run-e2e.mjs <两文件>` | 4/4 passed |
| 新 E2E browsing-preferences | `node scripts/run-e2e.mjs tests/e2e/browsing-preferences.test.ts` | 2/2 passed |
| 回归+新 E2E 合跑(post-fix) | `node scripts/run-e2e.mjs <三文件>` | 6/6 passed(exit 0) |
| 全量 E2E(10 文件) | `npm run test:e2e` | 15 passed / 2 failed(process-lifecycle,见下) |

## 新增自动化覆盖(对应验收条件)

- **#1** 重启持久化:viewMode + cardSize + 3 字段开关 → `application.close()` → 同 `SERPENT_E2E_USER_DATA_PATH` 再 `launch()` → 全恢复 + 校验 `localStorage["serpent.canvas-prefs.v1"]`。
- **#2** 共享 `canvasPrefs` state;无 per-card IPC(no-requery:切换字段前后 `.asset-card[data-asset-id]` 集合不变,bridge `Object.freeze` 无法装 spy 故用行为断言)。
- **#3** 实际卡片宽度:`getComputedStyle(assetGrid).gridTemplateColumns` 含 `${cardSize}px`(96/320);Ctrl+wheel 方向(负 deltaY 增大/正 deltaY 减小)+ 边界[96,320] clamp + 普通滚轮不缩放。
- **#4(a)** 普通滚轮不缩放(已测)。
- **#5** 瀑布流 scrollTop=0 首项 bbox.top ≥ canvas.top + 滚到底末项 bbox.bottom ≤ canvas.bottom。
- **#7** 可访问名(条件化 aria-label,可见时无/隐藏时 = displayName)+ 全范围一致性(所有资产/根目录/标签/合集/回收站)。

## 失败用例

### process-lifecycle 2/2(`firstWindow()` 30s 超时)

- **复现**:`node scripts/run-e2e.mjs tests/e2e/process-lifecycle.test.ts`(孤立、清 stale 单实例锁 `SingletonLock`/`Socket`/`Cookie` 后仍失败)。
- **根因排查**:`git stash -u` 后在 baseline `60d3515` 上**同样 2/2 失败** → **预存在,非 slice 0012 引入**。
- **疑似根因**:process-lifecycle 不设 `SERPENT_E2E`(非 e2e 模式),默认 userData(`~/Library/Application Support/Serpent/`)的 `recent-library.json` 指向已删临时库 → 启动自动恢复陈旧库 → 不开窗 → `firstWindow` 超时。
- **严重程度**:阻断 `verify:mainline` 全绿;不影响 slice 0012 自身行为(renderer-only 改动)。
- **处置**:**移交单独排查**(非本切片职责;不应清默认 userData 的 `recent-library.json` 因属用户本地状态)。

## 未执行项目及原因

- **Computer Use UX/视觉门禁**:**未执行**。本切片是较大 UI 功能,按 `docs/development-process.md`「大功能 UX/UI 人工门禁」+ `CLAUDE.md`,必须主 agent 用 Computer Use 操作真实桌面 + 截图验收(进入态/工作态/完成态 + 空/加载/失败;信息层级/间距对齐/裁剪溢出/文字可读性/控件可发现性/媒体适配/焦点/跨面板一致/窗口缩放布局)。**当前 agent 环境无 Computer Use** → 记为未执行 → 移交具备能力的主 agent/人工 QA。**不可据此标 `accepted`**。
  - 需补验:3 开关可见/可点/pressed 态;卡片字段显隐;隐藏名称仍可访问;**缩放锚点保持(对应 #4b,无自动化)**;窗口缩放布局。
- **#4(b) 锚点资产仍可见**:无自动化测试(rAF/视口 flaky);行为预存在(`resizeAssetCards`)。留 Computer Use 视觉验收。
- **#6 帧率部分**:no-requery(IPC)已覆盖;帧率无可靠自动化,留人工/性能 QA。
- **Windows 平台**:完全未验证(无 runner)。
- **`npm run verify:mainline` 整跑**:未整跑;其 e2e 子集确定性地因预存在 process-lifecycle 失败,各组件已分别验证(lint/typecheck/unit/worker+search-perf/回归+新 e2e)。

## 错误可观测性

本切片新增的失败路径无(画布偏好纯客户端,不产生用户可见错误;损坏/未知 version 回退默认,无 toast)。既有错误可观测性(导入/搜索/删除等)不受本切片影响。

## 最终结论:**有条件通过(不可 `accepted`)**

slice 0012 自身范围:规格内行为已实现(未偷偷加入未确认范围)+ 约定自动化测试通过 + 双轴审查完成且阻断项已修。但:

1. **Computer Use UX 门禁未执行**(环境缺能力)→ 不可标 `accepted`,须移交补验。
2. **process-lifecycle 预存在失败**阻断 `verify:mainline` 全绿(非本切片引入,移交)。
3. **Windows 平台**未验证。

状态:`automated-verification` ✓ + `code-review` ✓ → `qa` 待 Computer Use 补验 → **不可 `accepted`**。
