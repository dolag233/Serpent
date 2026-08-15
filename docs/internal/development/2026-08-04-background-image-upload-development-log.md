# 背景图配置 UI 重做与自动压缩开发日志

- 日期：2026-08-04
- 分支：`codex/slice-002-asset-ingestion`
- 需求来源：用户直接反馈（会话 2026-08-04，两轮）
- 范围：设置 → 外观 → 应用背景 / 主题颜色覆盖

## 需求

### 第一轮

1. 背景图配置 UI 太简陋，需要重做。
2. 不得以「文件必须小于 3 MB」的方式拒绝用户；即使存在大小上限，也必须由应用自行压缩，而不是要求用户先压缩。

### 第二轮

3. 背景图像设置放入可折叠菜单，默认折叠。
4. 「样式配置」（主题颜色覆盖）同样放入可折叠菜单。
5. 图像适配方式：不允许出现边缘颜色（letterbox），图像横轴或纵轴铺满界面、不拉伸不空缺，可接受裁剪 → 适配模式收敛为 cover / tile，移除 contain。

### 第三轮

6. 所有中间面板支持背景图：双击资产打开的查看面板、插件添加的中间面板；标签管理面板确认已通过 workspace 透射可见。

### 第四轮（修复）

7. 查看面板背景不透明度与画布区不一致：`.preview-content` 直接把 `--ui-backdrop` 画在自身时，background-image 层位于 `color-mix` 遮罩之上，背景图以全亮度显示（画布区为 workspace 84% 遮罩后的 16%）。修复：面板恢复透明、依赖 workspace 遮罩（与画布区完全一致）；仅全屏（workspace 离屏）时 `.preview-content` 自行绘制背景层。
8. 删除查看面板工具栏的旋转/镜像三个按钮（键盘快捷键与右键菜单入口保留）。

## 现状与根因

- 旧 UI：96px 高的预览条 + 一行小按钮上传 + 底部错误文字。无拖拽、无图片信息、无压缩中反馈。
- 旧限制：`MAX_BACKGROUND_IMAGE_DATA_URL_BYTES = 4 MiB`（localStorage 配额硬约束，背景图以 base64 data URL 持久化于 renderer 的 localStorage）。UI 层用 `file.size > 4MiB * 0.72`（≈3 MB）直接拒绝大文件，文案「请选择小于 3 MB 的图片」。

## 实现

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 大图自动压缩（长边 ≤ 2560px + WebP/JPEG 质量阶梯 + 尺寸递减，直到 data URL ≤ 4 MiB） | `src/renderer/theme/background-image-compression.ts` | `tests/unit/background-image-compression.test.ts`（24 用例中的压缩部分：透传/迭代/兜底/GIF 标记/JPEG 回退/预算约束） | Windows 本机 `npm run typecheck`、eslint 通过；Electron 启动验证（见下） |
| 移除 3 MB 文件拒绝，压缩中进度反馈，压缩结果一次性提示（含 GIF 动图转静态提示） | `src/renderer/theme/ThemeAppearanceControls.tsx`（`handleSelectFile`） | —（UI 逻辑依赖 DOM，未加组件测试，遵循验收纪律按人工验收） | 待人工/Computer Use 验收 |
| 16:9 预览舞台 + 拖拽上传区 + 替换/移除浮层 + 图片元信息（文件名/分辨率/压缩前后大小） | `src/renderer/theme/BackgroundImageControls.tsx` + `styles.css` | — | 待人工/Computer Use 验收 |
| 图片来源元数据持久化（schema v1→v2，`imageSource` 字段，v1 自动迁移） | `src/renderer/theme/background-preferences.ts` | `tests/unit/background-preferences.test.ts`（v2 默认值/校验/v1→v2 迁移/round-trip） | — |
| i18n 文案（中/英） | `src/renderer/i18n/catalogs/{zh-CN,en}.ts` | MessageTree 类型约束（typecheck 覆盖） | — |
| 应用背景与主题颜色覆盖折叠区块（默认折叠） | `src/renderer/ui/patterns/disclosure.tsx` + `AppSettingsPages.tsx` | — | 待人工/Computer Use 验收 |
| 适配模式收敛 cover/tile，`contain` 移除（旧数据回退 cover） | `background-preferences.ts`（`BACKGROUND_DISPLAY_MODES`） | `tests/unit/background-preferences.test.ts`（contain→cover 回退、v1 迁移含 contain 归一） | — |
| 中间面板支持背景图：抽取 `--ui-backdrop-*` 派生变量，查看面板（`.preview-content`）与插件面板（`.plugin-sidebar-view-panel`、iframe frame）同画背景层；查看器/插件面板打开时 `.workspace` 让位避免双重遮罩 | `ui/tokens.css`（backdrop 变量）+ `styles.css`（`.app-shell` 去重改用、`.preview-*`、`.plugin-*`、`.workspace:has`） | —（纯 CSS，无逻辑变更） | 待人工/Computer Use 验收：双击资产查看、打开插件面板、标签管理页观察背景图 |

### 中间面板背景图实现说明

- 机制：背景图 + 可读性叠加层从 `.app-shell` 抽为 `--ui-backdrop-{image,position,repeat,size}` 派生变量（`tokens.css`），所有中心面板 `background-image: var(--ui-backdrop-image)` + 半透明基色（`--ui-background-surface-opacity`，无背景图时 100% → 面板保持原有暗底不回归）。
- 查看面板：`.workspace-viewer`/`.preview-modal` 透明化，`.preview-content`（媒体舞台）画背景层；媒体元素与文本查看器（`.preview-text-stage`）保持不透明（读性/色彩准确优先）。
- 双重遮罩：查看器/插件全屏面板打开时 `.workspace` 若仍 84% 遮罩会与面板自身遮罩叠乘（背景图亮度 0.16²），用 `.workspace:has(.workspace-viewer, .plugin-sidebar-view-panel)` 让位为透明。
- 插件 iframe：iframe 文档加载后由插件自身绘制，宿主背景图只在其透明处/圆角外（`.plugin-workspace-view-frame` border-radius）露出——插件侧无法强制。
- 标签管理面板：在 `.workspace` 列内，经 84% 半透明透射已可见背景图，无需改动。

## 设计决策

- **压缩在 renderer 完成**：renderer 是 sandboxed（无 Node），`Canvas.toDataURL` 是标准 web API，无需把文件交给 Main/Worker，也不引入新 IPC 面。`browserCodec` 通过依赖注入隔离，测试不触碰真实 canvas。
- **4 MiB data URL 上限保留**：它是 localStorage 配额的硬约束（`saveBackgroundPreferences` 失败即报 `backgroundSaveError`），不是用户可感知的「文件大小限制」。用户侧效果是：任意大小的图片都能选，应用自动压缩。
- **小图/动画 GIF 原样透传**：≤ 4 MiB 的 payload（含 ≤ ~3 MB 的 GIF）不重新编码，动画 GIF 保留动画；只有超限重编码时才把动图展平为静态（`animationLost` 一次性提示）。
- **WebP 优先，JPEG 兜底**：WebP 保留 alpha 通道；某 codec 编码失败自动降级（每轮 `tryEncode` 双格式）。
- **UI 结构**：预览舞台复用真实的背景渲染（颜色 + 图片 + 叠加层 + 适配模式），无图时退为 pane 底色虚线拖拽区，避免 `transparent` 颜色让虚线框不可见。
- **压缩迭代的纯函数化**：`backgroundImageEncodeAttempts`（generator）+ `fitWithinMaxDimension` 纯函数可独立测试；`compressBackgroundImage(file, maxBytes, codec)` 注入 codec 即可在 happy-dom 中验证迭代行为。

## 验证记录

- `npm run typecheck`：通过（exit 0，含两个 catalog 的 MessageTree 一致性）。
- `npx eslint <变更文件>`：通过。
- `npx vitest run tests/unit/background-preferences.test.ts tests/unit/background-image-compression.test.ts`：26/26 通过。
- `npm start`（Electron + Vite dev）：构建 6 个入口全部成功、主进程/渲染进程正常启动，无运行时错误（后台日志 `start-verify.log`）。
- 未执行：Computer Use / 人工视觉验收（本会话无 Computer Use 能力）——移交给具备能力的 agent 或人工 QA。UI 视觉效果（拖拽区、浮层按钮、元信息行、折叠区块）必须人工确认。

## 关联

- 上一会话修复：`npm start` 卡在编译 = `node_modules` 与 lockfile 不同步（`quickjs-emscripten` 缺失导致 plugin host 构建失败，Forge 不退出继续扫 renderer 依赖）。已 `npm install` 补装。
- 本机 Node 为 v26.0.0，项目要求 `>=24 <25`（`.nvmrc` 24.15.0）——构建可用但有 EBADENGINE 警告，建议切回 24.x。

## 勘误（2026-08-04 修复轮追加，见 `2026-08-04-background-image-fixes-development-log.md`）

1. **`.workspace:has` 让位规则在提交 `e68af8a` 中并未落地，且不需要**。上文「中间面板背景图实现说明」所称 `.workspace:has(.workspace-viewer, .plugin-sidebar-view-panel)` 让位为透明在该提交中不存在（树与历史均无此规则，`git log -S "workspace:has"` 为空）；实际机制是面板透明化（`.workspace-viewer`/`.plugin-sidebar-view-panel` 均为 `background: transparent`）+ 全屏自绘，背景图经 workspace **单层** 84% veil 显示，不存在双重遮罩叠乘。修复轮曾误按本段描述补上该规则，但会让位为不透明纯色导致面板打开时背景消失，已撤销（见 `2026-08-04-background-image-fixes-development-log.md`）。
2. **「Windows 本机 typecheck」为笔误**：本会话在 macOS 上运行，Windows 属显式未验证项，不得写作「Windows 本机」。
3. **4 MiB 上限与 16384 像素上限引发「正常大小替换失败、超大文件成功」**：`imageSource` schema 的 width/height 上限 16384 在直通保存时拒绝高分辨率正常文件；压缩路径输出 ≤ 2560 反而总能通过。上限已移除、预算已提至 5 MiB。
