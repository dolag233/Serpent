# 0012 QA 报告 — 资产画布视图与卡片信息配置

> 分支:`codex/slice-002-asset-ingestion`
> 基线:`60d3515`;本切片改动:`60d3515...75019d9` + 验收修复(最终提交见开发日志)
> 构建环境:macOS arm64(Darwin 25.5.0),Node 24(`.nvmrc` 24.15.0),Electron + Vite production-like build(`.vite/build` main/preload/worker + renderer)
> 日期:2026-07-14

## 自动化结果

| 检查 | 命令 | 结果 |
|---|---|---|
| lint | `npm run lint` | GREEN(0 error;初次 3 个 unused-vars 已修) |
| 类型检查 | `npm run typecheck` | GREEN(tsc --noEmit + tsconfig.extension.json) |
| 单元 | `npm run test:unit` | 26 files / 262 passed |
| Worker 集成(含 search-perf) | `npm run test:worker` | 24 files / 536 passed + 1 skipped(platform skip) |
| 回归 E2E(media-preview + organization-search-trash) | `node scripts/run-e2e.mjs <两文件>` | 4/4 passed |
| 新 E2E browsing-preferences | `node scripts/run-e2e.mjs tests/e2e/browsing-preferences.test.ts` | 2/2 passed |
| 回归+新 E2E 合跑(post-fix) | `node scripts/run-e2e.mjs <三文件>` | 6/6 passed(exit 0) |
| 最终主线门禁 | `npm run verify:mainline` | GREEN：lint/typecheck/extension；50 files / 798 passed + 1 skipped；search perf 4/4；Electron E2E **20/20 passed** |

## 新增自动化覆盖(对应验收条件)

- **#1** 重启持久化:viewMode + cardSize + 3 字段开关 → `application.close()` → 同 `SERPENT_E2E_USER_DATA_PATH` 再 `launch()` → 全恢复 + 校验 `localStorage["serpent.canvas-prefs.v1"]`。
- **#2** 共享 `canvasPrefs` state；仅 E2E 模式由 preload 暴露只读请求计数，字段切换前后 `asset.search.request` 数量不变。旧的 card-ID 集合断言不能证明无重查，已替换。
- **#3** grid/masonry 均以 36 张真实卡片测量 96/160/320 的 card bbox；Ctrl+wheel 方向、边界 clamp 与普通滚轮不缩放均覆盖。
- **#4(a)** 普通滚轮不缩放(已测)。
- **#5** 瀑布流 scrollTop=0 首项 bbox.top ≥ canvas.top + 滚到底末项 bbox.bottom ≤ canvas.bottom。
- **#7** 可访问名(条件化 aria-label,可见时无/隐藏时 = displayName)+ 全范围一致性(所有资产/根目录/标签/合集/智能合集/回收站)，并检查真实字段呈现。

## 失败用例

### process-lifecycle 2/2(`firstWindow()` 30s 超时)— **已修(测试隔离)**

- **复现**:`node scripts/run-e2e.mjs tests/e2e/process-lifecycle.test.ts`(孤立、清 stale 单实例锁后仍失败)。
- **根因排查**:`git stash -u` 后在 baseline `60d3515` 上**同样 2/2 失败** → **预存在,非 slice 0012 引入**。
- **可证根因边界**:process-lifecycle 使用开发机默认 userData，造成环境污染与启动不确定；`5e01640` 改为每测试 fresh E2E profile，修复测试隔离。交接文档推断“缺失 recent-library 本身会使真实应用挂起”，但新增完整进程重启 E2E 未复现：不存在路径约 0.8 秒回到起始页。该推断从已知 bug 列表移除，回归测试保留。

## Computer Use UX / 视觉验收

- 主 agent 在真实 Electron 开发应用中创建独立资源库，导入 5 张不同比例图片，操作平铺/瀑布流、三个字段开关、96/160/320、纵向滚动、窗口缩放和锚点。
- 首轮截图发现两个用户可见问题：字段全关仍留空 caption；工具栏项目可收缩导致中文逐字换行，窄窗设置被裁掉。修复后重新操作并截图。
- 缩放锚点：滚动使 `03-player.jpg` 位于中心区域，从 320 缩到 96 后仍在可见首行。
- 瀑布流：滚到底后 5 个资产均可完整到达，末项未被底部裁剪。
- 证据：[宽窗平铺](evidence/0012-canvas-preferences/01-grid-wide.jpg)、[字段全关](evidence/0012-canvas-preferences/02-fields-hidden.jpg)、[窄窗控件](evidence/0012-canvas-preferences/03-narrow-controls.jpg)、[锚点缩放前](evidence/0012-canvas-preferences/04-anchor-before.jpg)、[锚点缩放后](evidence/0012-canvas-preferences/05-anchor-after.jpg)、[瀑布流底部](evidence/0012-canvas-preferences/06-masonry-bottom.jpg)。

## 未执行项目及原因

- **#6 10 万资产帧率**:真实 no-requery 已覆盖；本轮 Computer Use 只有 5 资产，E2E 为 36 资产，不足以证明 10 万资产帧率。
- **Windows 平台**:完全未验证(无 runner)。
- **`npm run verify:mainline`**:最终共享工作树全绿；全量 E2E 11 文件 **20/20 passed**，含真实媒体播放、浏览偏好和不存在 recent 路径回退。

## 错误可观测性

本切片新增的失败路径无(画布偏好纯客户端,不产生用户可见错误;损坏/未知 version 回退默认,无 toast)。既有错误可观测性(导入/搜索/删除等)不受本切片影响。

## 最终结论:**有条件通过**

slice 0012 的 macOS 实现、自动化、双轴审查和真实桌面 UX 门禁完成，Computer Use 发现的两处视觉问题已修并有截图证据。保留条件：10 万资产帧率未专测，Windows 无 runner。不存在路径 recent-library 已有完整重启回归且正常回退，不再列为生产 bug。
