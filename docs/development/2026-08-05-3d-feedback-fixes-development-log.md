# 2026-08-05 用户反馈修复：3D 组件缺失 + 标题显示 + 格式过滤 — 开发日志

> 关联切片：0030（3D 模型支持）；分支：`codex/slice-002-asset-ingestion`
> 工单：`Serpent-g05n`（FBX WASM）、`Serpent-pjx2`（模型缩略图）、`Serpent-1d4w`（格式过滤）、`Serpent-kmgw`（标题显示）
> 会话：主 agent（Windows，E:\MyRepositories\Serpent）

## 用户反馈（2026-08-05）

1. 打开模型提示「FBX 转换失败（转换组件不可用，请重新安装应用后重试），已使用兼容模式加载」
2. 模型没有缩略图
3. 格式过滤应支持更多格式（含 3D）
4. 资产标题显示完全错误：短名 `ZKH09734.ARW` 显示为「ZKH09 左对齐 + 734.ARW 右对齐」；期望长名中间省略 `wertyuiasddf...dad.mp4`

## 根因与修复

### 1. FBX 转换组件不可用（Serpent-g05n，已关闭）

**根因**：`resources/ufbx/`（ufbx.wasm + glue）在 `.gitignore` 中，且无 npm script / 打包 hook 自动构建；本机既无产物也无 Emscripten SDK。`prepackage`/`premake` 的 `media:verify` 不校验 ufbx，允许打包出无转换组件的「残废包」——用户「重新安装应用」也救不了。

**修复**（提交 `3181efe`）：
- **ufbx WASM 产物入仓库**（产品负责人拍板：WASM 平台无关单二进制，随 git 分发）。`resources/ufbx/`：ufbx.wasm 326KB + glue 9.6KB + ufbx.c/h 源 + LICENSE（MIT）+ acquisition.json 溯源收据
- `.gitignore` 移除 `resources/ufbx/`
- 新增 `scripts/verify-ufbx-wasm.mjs`（存在性 + SHA-256 对 lock），接入 `prepackage`/`premake`——缺组件即打包失败并给构建指引
- `CLAUDE.md` 环境约束更新：产物随仓库分发，仅重建/升级 ufbx 需要 Emscripten 6.0.5
- 本机安装 Emscripten 6.0.5（用户协助下载 wasm-binaries.zip 649MB，放入 emsdk downloads 缓存）→ `node scripts/build-ufbx-wasm.mjs --emsdk <dir>` 构建

**SHA 差异调查**：本机构建产物与开发机（huangqingsong）的 lock 哈希不一致（wasm `33033b20` vs `d490c5b0`；**js glue `82a9376d` 完全一致**）。glue 一致证明工具链与 flags 相同；wasm 二进制差异为 LLVM 编译的构建路径类非确定性（clang 在 -g0 下仍嵌入源树路径等元数据）。无功能影响：fbx-conversion worker 测试 19/19 通过。lock 已更新为本次产物哈希并附 note；后续机器构建若哈希不同，按 lock 注释核对即可。

**验收**：`npm run test:worker tests/worker/fbx-conversion.test.ts` 19/19；model-viewer E2E FBX 转换旅程 2/2（无兼容模式提示、统计面板真实几何数据）。

### 2. 模型缩略图（Serpent-pjx2，用户决定放弃，deferred）

**排查结论**（2026-08-06，主 agent + 真实应用日志）：
- 代码链路（slice E）完整：worker 入队 → `processModelThumbnailJob` → Main 共享离屏窗口 → `thumbnail` artifact 落库；`enqueueThumbnailJobs` 入队 SQL 已含模型扩展名；`modelThumbnailRenderer` 已接线（worker/index.ts）。
- 用户应用日志（`%APPDATA%/Serpent/logs/serpent.log`）实锤两条失败路径：
  - `FBX_WASM_UNAVAILABLE`（WASM 缺失，g05n 已修）
  - **`MODEL_RENDER_TIMEOUT`**：离屏窗口 `window-ready` 后 30s 无帧。根因：**offscreen 页面依赖 preload `offscreen.js`（`.vite/build/offscreen.js`），但 `scripts/run-e2e.mjs` 的 E2E 构建从未构建它**（仅 Forge dev/package 流程产出）；且 run-e2e.mjs 开头 `rm .vite` 会清掉正在运行的 dev 应用的 preload 产物 → dev 应用离屏渲染也失败（本次会话中用户应用 23:44 的 `MODEL_RENDER_TIMEOUT` 即由此引起）。
- 尝试修复：run-e2e.mjs 补 `vite.offscreen-preload.config.ts` 构建 + 删除改为仅清 E2E 入口；重跑 E2E 仍失败（OBJ 用例 1.5m 超时，img 未出现），未找到进一步根因。
- **用户决定：不继续此任务。** 相关未验证改动全部回退（run-e2e.mjs 还原、临时 E2E 删除）。后续接手者从「E2E 补 offscreen preload 构建后离屏渲染仍无帧」这一点继续排查（页面侧 WebGL/消息通道为优先嫌疑）。

### 3. 格式过滤预设 chip 扩展（Serpent-1d4w，已关闭）

**根因**：`DimensionFilterBar.tsx` 预设 chip 硬编码 7 个（png/jpg/webp/gif/mp4/mov/text），自由文本过滤虽可用（`expandFormatFilterTokens` + LIKE，无白名单）但 chip 未覆盖 audio/3D/RAW/psd/exr 等。

**修复**（提交 `83ed613`）：新增 `src/renderer/format-filter-presets.ts` 从 `IMAGE/VIDEO/AUDIO/MODEL` 注册表派生分组 chip（图像/视频/音频/3D 模型/文本），注册表扩展自动同步；i18n 中英各 5 键；分组样式。验证：typecheck/lint 0、单测 18/18（含新 4 个：注册表全覆盖 + 无点 token + 去重 + text 独立）。

### 4. 资产标题显示完全错误（Serpent-kmgw，已提交）

**根因**：`.asset-filename-prefix` 的 `flex: 1 1 auto`——`flex-grow: 1` 在短名时把前缀拉宽填满整行，尾段/扩展名被推至最右：`ZKH09734.ARW` → 「ZKH09（左）+ 大段空白 + 734.ARW（右）」。Inspector 侧（`.inspector-hero-compact .asset-filename-prefix`）早已用 `flex: 0 1 auto`（带注释），卡片侧漏同步。

**修复**（提交 `7aaa139`）：`.asset-filename-prefix` 改 `flex: 0 1 auto`——名称放得下时三段紧排，溢出时前缀收缩 + 中间省略号（`wertyuiasddf...dad.mp4`）。

## 基础设施修复：beads Dolt 与 JSONL 镜像脱节

发现本地 Dolt 缺 346 条 JSONL-only 工单记录（`bd list` 查不到 3D 工单、`bd create` 后 auto-export 拒绝覆盖）。按规则处理：
- `bd dolt pull` 从远端同步（首次 SSL 抖动失败，重试成功）
- 剩余 1 条 `Serpent-hf1t`（Mac 侧主题工单，JSONL-only）→ 导出单条快照 → `bd import <snapshot> --json` 增量 upsert（未用 `bd init --from-jsonl` 覆盖式重建）
- auto-export 恢复，`.beads/` 镜像随代码提交同步

## 未完成 / 待办

- pjx2 缩略图 E2E 实测（进行中）
- kmgw 的 E2E 视觉复现（本机 E2E 手动流程被原生对话框阻塞，需 SERPENT_E2E_* hook；修复已提交，用户实机确认中）
- 临时测试 `tests/e2e/tmp-*.test.ts` 验证后清理或转正
- packaged 验证（.hdr 哈希发射、离屏窗口、GLB 产物）仍为 0030 未执行项
