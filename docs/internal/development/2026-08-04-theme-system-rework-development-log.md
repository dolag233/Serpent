# 主题系统重构开发日志：预设×明暗正交 + 强调色并入 + 色环选择器

- 日期：2026-08-04
- 分支：`codex/slice-002-asset-ingestion`
- 需求来源：用户 grill 澄清（2026-08-04，Obsidian 式完全自定义样式 vs 颜色配置讨论后收敛为方案 b）；工单 `Serpent-hf1t`

## 第五轮 UI 调整（2026-08-05 追加）

1. **色环拾色器退役**：自定义色环（hue 环 + SV 方块）的指针数学在实机反馈「鼠标与颜色位置不一致」，按用户要求改为**原生 `<input type="color">` 圆角长方形色卡**（点击弹系统取色器，「普通样式」）；删除 `ColorWheelPicker.tsx` 与其测试、样式。
2. **一行两列布局**：自定义主题网格 `grid-template-columns: repeat(2, 1fr)`，左右对齐；每行 = 名称 + 色卡（`justify-content: space-between`）。
3. **清除按钮宽度**：根因 `.app-settings-disclosure-content`（grid）把 Button stretch 到整行；加 `justify-self: start` + `variant="quiet"` 收窄。
4. **亮暗圆环**：未选中时加淡灰外圈（`0 0 0 1px ink 26%`），白主题下白圆环可见；跟随系统的黑白对半改 `linear-gradient(90deg)` 分割（conic 有硬缝瑕疵）。
5. **UI样式预览**：整体居中（heading 靠左、toolbar/卡片居中）；卡片改用 Inspector hero 预览同款阴影组合（inset 高光 + 双层投影 + 圆角 8px）。
6. **删冗余文案**：`customThemeHint`（「仅影响颜色…」）删除——UX 原则删掉冗余内容。

## 第四轮 UI 调整（2026-08-05 追加）

1. 亮暗圆环选中态与工具栏颜色过滤 swatch（`.dimension-color-swatch.is-active`）完全一致：透明边框 + 2px accent outline + 1px 内圈阴影 + 相同 transition——颜色类控件的选中语言统一。
2. 主题卡 hover 抬升（translateY(-1px)）被滚动容器裁剪：`.app-settings-theme-profiles` 增加顶部 padding 3px（max-height 相应 235px）。
3. 主题色设置改横向紧凑布局：`grid` → `flex wrap`，每组 = 名称 + 色样（gap 6px），组间 gap 28px——「主题色 ⭕️ 次要色 ⭕️」一眼可读对应关系。
4. 「清除颜色覆盖」→「清除颜色」。
5. 示例 UI 重做：「实时预览」→「UI样式预览」；改用规范化 primitives（Button primary/secondary/danger、Switch、Slider、TextField 组件）；布局 = 工具栏按钮行 + 带 `--ui-shadow-surface` 阴影的卡片（文字/输入框/选中项/滑块）。

## 第三轮 UI 调整（2026-08-05 追加）

1. 「主题颜色覆盖」→「主题色设置」，设置项移到主题分类正下方（应用背景之前）。
2. 亮暗与主题预设合并进同一个「主题」分类：顶部为亮/暗/跟随系统选择——白、黑、黑白对半圆环表示，hover 提示模式名；下方为主题预设，**最多同时显示两排，超出滚动**（`.app-settings-theme-profiles` max-height 232px + overflow-y auto）。
3. 主题色设置 UI 紧凑化：名称在前、色样在后且同组紧凑（多列 grid）；按重要程度排序（主题色 → 次要色 → 主要文字 → 画布 → 面板 → 卡片 → 错误色）；面板底部新增**实时示例 UI**（主/次/危险按钮、主/次文字、输入框、选中项，全部走 `--ui-*` token 实时反映配置）。

实现位置：`AppSettingsPages.tsx`（结构重排、`ThemeModePicker` 引入、字段排序、示例 UI）、`ThemeAppearanceControls.tsx`（`ThemeModePicker` 圆环组件）、`styles.css`（圆环/两排滚动/紧凑网格/预览样式）、i18n（customTheme → 主题色设置、themeMode、预览文案、删 themeProfiles 未用键）。

## 需求（用户拍板）

1. **预设 × 明暗正交**：预设重组为主题名（Serpent / VS Code / 柔和），每个主题提供亮、暗两版色调；顶部亮/暗/跟随系统切换决定当前主题的明暗变体；选主题不再改全局明暗。
2. **强调色并入自定义主题**：删除独立「强调色」区块与 hex 输入；`--ui-action-accent` 成为普通可覆盖 token（预设内置 + 可自定义覆盖）。
3. **每个主题内置默认主题色（蓝色系）**，后续由用户出更多配色方案。
4. **颜色配置 UI 统一**：自定义主题网格全部改为圆形色样 + 点击弹应用内色环（hue 环 + 饱和度/亮度方块 + 预设色板，无 hex 输入）。
5. 修复「清除颜色覆盖」按钮无效。
6. 「Inspector 预览卡片动效」中文文案改「侧边栏预览卡片动效」（英文 Sidebar preview card motion）。

## 根因（修复项）

| 现象 | 根因 |
| --- | --- |
| 清除颜色覆盖按钮无效 | `clearCustomTheme(storage)` 只在 `if (storage)` 时 `removeItem`；ThemeProvider 默认不传 storage（走 resolveStorage 的 localStorage），导致只清 DOM 不清持久化，重载后覆盖回来 |
| 强调色与自定义主题割裂 | 独立 `accent-prefs`（accentHex state）在 composition 中优先于 custom/profile 的 accent token；选预设不改变独立 accent |

## 实现

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 主题 × 明暗正交（v3 schema：3 主题 × 2 变体，无 mode 字段；v2 预设迁移映射） | `theme-profiles.ts`（v3 契约 :18-30、6 套 palette、`resolveThemeProfile(profile, resolved)` :534-556、legacy 迁移 :470-531） | `tests/unit/theme-profiles.test.ts`：3 主题双变体完整 token、v2→v3 迁移（serpent-dark/light→serpent 等）、按 resolved 取变体、损坏 v3 记录回默认 | 待人工/Computer Use |
| 每主题内置默认主题色（蓝系；serpent/soft 旧紫 → 蓝，vscode 保持品牌蓝），新增 vscodeLight、softDark 两套配色 | `theme-profiles.ts`（serpentDark :180、serpentLight :226、vscodeLight :289、softLight :350、softDark :389） | 「ships a default theme color (blue) per tone variant」：非 legacy 紫 + hex 格式 | 配色是否符合预期待用户验收（用户将出更多配色方案） |
| 强调色并入：composition 删 accentHex 干预，accent = custom override ?? profile token；`--accent` alias 保留 | `theme-composition.ts`（:54-66）+ `ThemeProvider.tsx`（删 accent state/effect，:104 `--accent` 合成） | 「derives the accent from the custom override」/「composes profile and custom override」 | — |
| 旧 accent-prefs 迁移为 custom-theme 覆盖（双明暗写入、删 legacy key、幂等） | `theme-composition.ts`（`migrateLegacyAccentIntoCustomTheme` :79-111）+ `ThemeProvider.tsx`（useState 初始化器 :83-87，规避 set-state-in-effect lint） | 「migrates a legacy accent preference into custom-theme overrides once」+「drops a default legacy accent」 | — |
| 删除独立强调色区块与 hex 输入 | `AppSettingsPages.tsx`（删 swatch/hex/accentDraft/selectAccent；TextField import 清理） | typecheck（i18n MessageTree 删 accentColor/accentHint/accentCustom/accentReset） | — |
| 色环选择器（圆形色样 + hue 环 + SV 方块 + 预设色板，无 hex 输入） | `ColorWheelPicker.tsx`（新组件，`hexToHsl`/`hslToHex` 纯函数）+ `styles.css`（色环样式 :10380+，颜色全部走 token/命名色） | `tests/unit/color-wheel-picker.test.ts`：HSL round-trip、简写 hex、负 hue 回绕、钳制、预设集合 | 交互（拖拽、点击外部关闭）待人工/Computer Use |
| 自定义主题网格改色环（7 字段：canvas/pane/raised/primary/secondary/accent/danger） | `AppSettingsPages.tsx`（grid 行改 label + ColorWheelPicker）+ `styles.css`（`.app-settings-custom-theme-row`） | typecheck | 待人工/Computer Use |
| 清除按钮修复（持久化删除不受 storage 参数影响） | `custom-theme.ts`（`clearCustomTheme` :177-196 改 `resolveStorage(storage).removeItem`） | 现有 custom-theme 测试 + 迁移测试间接覆盖 | — |
| 主题预设 UI 改 3 主题卡（预览按当前明暗变体渲染） | `ThemeAppearanceControls.tsx`（PROFILE_LABELS 新 id、`asPreviewStyle(profile, resolved)`） | typecheck（i18n themeProfileSerpent/Vscode/Soft） | 待人工/Computer Use |
| Inspector 文案 | `i18n/catalogs/{zh-CN,en}.ts`（inspectorCardFeel → 侧边栏预览卡片动效 / Sidebar preview card motion） | MessageTree 类型约束 | — |

设计说明：

- **明暗正交的实现**：v3 的 `resolveThemeProfile(profile, resolved)` 把明暗作为输入而非 profile 字段——预设只存主题名，`tokens.dark/light` 两套 palette；`resolveEffectiveThemeTokens` 按 resolved 取变体再叠 custom overrides。选主题不再写全局明暗偏好（`setThemeProfile` 只保存主题名）。
- **accent 单一来源**：`--ui-action-accent` 由 profile（每变体内置）或 custom override 决定；`--accent` legacy alias 由 composition 合成值同步。旧 `accent-prefs` 非默认值迁移为双明暗 custom override，默认值直接删除。
- **配色**：Serpent 深/亮与柔和从紫系改为蓝系（深色模式亮蓝、亮色模式深蓝、柔和温和蓝），VS Code 保持品牌蓝；vscodeLight、softDark 为新增的对应变体。后续配色方案由用户提供。
- **色环组件**：纯函数（HSL 转换）可测；UI 为 hue 环（conic-gradient + 指针角度）+ SV 方块（渐变 + 指针位置）+ 预设色板；无 hex 输入；点击外部/Esc 关闭；样式只使用 token 与命名色（CSS 门禁：裸 hex 只允许在 :root/[data-theme] 块内）。

## 审查修正（交叉审查轮，1 agent 双轴）

1. **Hue 环 90° 相位错误**：`pointerToHue` 用 atan2（0° 在 3 点方向）而 conic-gradient 的 CSS 角度 0° 在顶部——点击色与拾取色差 90°。已加 `+90°` 修正（`ColorWheelPicker.tsx`）。
2. **SV 方块 HSV 当 HSL 存储**：渐变按 HSV 空间绘制，但直接 `hslToHex(hue, s, v)` 把 value 当 lightness，拾取色偏移。新增 `hsvToHsl` 转换（`ColorWheelPicker.tsx`，含单测：中点 #406080、纯 hue、黑）。
3. **迁移 removeItem no-op**：`storage?.removeItem(ACCENT_PREF_KEY)` 在 ThemeProvider 不传 storage 时无效，legacy key 永不删除、迁移每启动重跑。改为解析真实 store（`theme-composition.ts`），幂等。
4. **迁移边界**：v2 记录的非法 overrides 迁移后会在 `resolveThemeProfile` 的 strict parse 抛错（渲染崩溃）——迁移时校验 overrides；corrupt v3 记录不再短路 legacy 迁移（`theme-profiles.ts`）。
5. 死代码清理：`.app-settings-accent-*` CSS、`customThemeAccentHint` i18n key、`theme/index.ts` 无消费者导出、`is-neutral` 不可达分支、`valueOf` 死条件。
6. zh 文案：`inspectorCardFeelHint` 的「右侧 Inspector 预览卡」同步改「侧边栏预览卡」。
7. 测试补强：主题色蓝色系断言（b 通道主导 ×5 token ×6 变体）、`hsvToHsl`、hue 相位约定、`clearCustomTheme()` 无参回归。

## 验证记录

- `npm run typecheck`：通过（含 i18n MessageTree 一致性）。
- `npm run lint`：通过。
- `npm run test:unit`：285 文件 2113 通过 / 1 skip。
- 未执行：Computer Use / 人工视觉验收（主题卡、色环交互、配色观感）——已更新 `docs/internal/qa/human-acceptance-checklist.md`（UI-STD-004 新增）。
- 未执行：packaged app / Windows 验证（无 runner）。

## 关联

- 工单：`Serpent-hf1t`（本次实现）；父系 `Serpent-ex46`（UI 标准化第二阶段）。
- 前置：`Serpent-lxmx.1`（背景图修复，已完成）。
- 遗留：`applyAccentColor`/`normalizeAccentHex` 等 accent-preferences 导出仍保留（迁移兼容），待确认无消费者后清理。

## 第六轮 UI 重做（2026-08-05）

用户反馈“颜色配置界面很丑；亮色下白色不可见；跟随系统按钮有裁剪”。本轮不再在第五轮布局上追加局部修补，改为收紧主题设置区的层级：

1. 将亮暗选择与主题预设组合为主题区顶部摘要行，模式按钮保持圆环语义，但按钮扩大为独立命中区，圆环绘制到内部 surface，选中环不再受原生按钮盒裁剪；白色圆环使用语义边框和内圈对比线，在亮色背景下始终可见。
2. 主题预设卡改为低对比度工作台卡片：缩短预览高度、降低默认边框重量，选中态使用主题色外环而不是大面积蓝色填充；继续保留最多两排滚动容器。
3. 颜色设置、清除操作和当前亮暗作用域抽出 `ThemeColorSettings.tsx`，`AppSettingsPages.tsx` 仅负责页面编排；颜色编辑保持原生系统取色器和亮/暗独立持久化。
4. UI 样式预览改为紧凑的双列组件样本，减少纵向高度，避免在设置窗口首屏底部形成大块裁切；窄窗自动退回单列。

实现入口：`src/renderer/theme/ThemeColorSettings.tsx`、`src/renderer/theme/ThemeAppearanceControls.tsx`、`src/renderer/AppSettingsPages.tsx`、`src/renderer/styles.css`。

当前验证：`npm run typecheck` 已通过；主题改动文件的 ESLint 已通过。真实 Electron 视觉复验尚未完成，UI-STD-004 仍保持“待人类验收”。

## 第七轮 UI 修正（2026-08-05）

针对第六轮反馈继续调整主题设置页：

1. 模式圆环缩小到更紧凑的命中区与选中环，系统模式改用两个独立伪元素绘制左右半圆，避免渐变接缝或父级裁剪造成黑色竖边；白色圆环继续保留语义边框和内圈对比线。
2. 自定义颜色输入改为更长的胶囊形色卡，去除外边框；原生取色器取消时不提交变更，聚焦色卡后按 `Escape` 会恢复编辑前的颜色。
3. 「清除颜色」恢复为默认 secondary Button，删除其右侧的亮/暗作用域文字。
4. 删除旧的按钮/开关/输入框组件样本布局，重新构建 Inspector 风格预览：左侧为带灰色资产卡片占位块的资产区域，右侧为 Inspector 面板，保留选中项、按钮、输入框和滑块作为语义组件样本，并在窄窗口下切换为单列。

实现入口：`src/renderer/theme/ThemeColorSettings.tsx`、`src/renderer/styles.css`、`src/renderer/i18n/catalogs/{zh-CN,en}.ts`。

验证记录：`npm run typecheck` 通过；`npx eslint src/renderer/AppSettingsPages.tsx src/renderer/theme/ThemeAppearanceControls.tsx src/renderer/theme/ThemeColorSettings.tsx` 通过；`npx vitest run --config vitest.config.ts tests/unit/theme-profiles.test.ts tests/unit/custom-theme.test.ts` 通过（2 个文件、20 个测试）。真实 Electron 视觉验收待执行；packaged/Windows 未执行。

## 第八轮 UI 微调（2026-08-05）

根据人工查看结果继续微调：

1. 色卡圆角从胶囊形收紧为 10px，并增加 12% 主文字混合透明度的 1px 极弱描边；颜色本体仍不使用明显边框。颜色标签改用 12px label 字号。
2. Inspector 预览文案改为资产语境：来源链接、资产详情、已选中此资产、评分、打开源文件和移除资产，避免使用孤立的「输入框」「选中项」等控件名。
3. 删除 Inspector 预览左侧底部的灰色圆点，仅保留必要的导航状态点。

实现入口：`src/renderer/theme/ThemeColorSettings.tsx`、`src/renderer/styles.css`、`src/renderer/i18n/catalogs/{zh-CN,en}.ts`。

验证记录：`npm run typecheck` 通过；`npx eslint src/renderer/theme/theme-composition.ts src/renderer/theme/ThemeColorSettings.tsx tests/unit/theme-profiles.test.ts` 通过；`npx vitest run --config vitest.config.ts tests/unit/theme-profiles.test.ts tests/unit/custom-theme.test.ts` 通过（2 个文件、21 个测试）。真实 Electron 视觉验收仍由人工完成，packaged/Windows 未执行。

## 第九轮 UI 语义色修正（2026-08-05）

本轮修复了自定义主题色只改变基础 token、没有同步影响派生 token 的问题：

1. 自定义「主题色」现在会重新计算选中背景、焦点环、强调色 hover/pressed/soft、按钮背景和内容强调色；「错误颜色」会同步影响危险按钮、危险 hover、危险边框、危险背景和危险文字。
2. Inspector 预览增加描述、作者和标签字段，字段标签统一读取次要色，值保持主要文字；按钮改为打开源文件和移除资产等有语境的动作。
3. 实际 Inspector 的描述/作者等 `.micro-label` 和元数据标签统一使用次要色，避免只有标签 chip 响应自定义次要色。

实现入口：`src/renderer/theme/theme-composition.ts`、`src/renderer/styles.css`、`src/renderer/theme/ThemeColorSettings.tsx`、`tests/unit/theme-profiles.test.ts`。
