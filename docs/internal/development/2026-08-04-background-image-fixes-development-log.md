# 背景图替换失败、重载预览与透明度语义修复开发日志

- 日期：2026-08-04
- 分支：`codex/slice-002-asset-ingestion`
- 需求来源：用户直接反馈（2026-08-04 第二轮，含「背景图功能貌似被改坏了」）；工单 `Serpent-lxmx.1`
- 前置：`e68af8a`（背景图重做，auto-compression + panel coverage）

## 需求（用户原话摘要）

1. 替换**正常文件大小**的背景图失败，替换超出大小的背景图反而不会失败。
2. 设置好背景后，再次打开设置窗口无法正常显示当前背景图。
3. 不透明度滑块应**从左到右越来越深**，现在逻辑相反；且最大不透明度需要更高。
4. 背景图信息应保存在**全局用户数据**下（确认现状）。
5. 删除「背景颜色」（现在不会露出背景）。
6. 「图片适配」选项改为「铺满」——随后澄清：铺满 = 等比缩放锁定一轴（y 或 x）铺满、另一轴等比缩放可裁切，**非拉伸**；并补充需要「拉伸」模式。最终模式集：**铺满（cover）/ 拉伸（fill）/ 平铺（tile）**。
7. 「可读性叠加层」改名「不透明度」，去掉解释性语句。
8. 删除「恢复应用背景」（可清空图片）。
9. 删除「图片保存在本机设置中」文案。
10. 图片上限改为 5M，超过 5M 自动压缩到 5M。随后第四轮澄清：压缩目标是**接近上限**（4M 可接受，1M 不可接受），并把上限改为 **4M**（>4M 压缩到 ~4M，保真优先）。
11. 背景图当前显示不了（疑似被改坏）。

## 根因（systematic debugging + 双轴代码审查交叉验证）

| 现象 | 根因 | 证据 |
| --- | --- | --- |
| 正常大小替换失败、超大文件成功 | `imageSource` schema 的 width/height 上限 16384（`background-preferences.ts`）；直通路径保留自然尺寸，高分辨率正常文件在**严格保存**（`saveBackgroundPreferences` → `parseBackgroundPreferences` strict schema）时失败；压缩路径输出 ≤ 2560px 反而总能通过 | 修复前 `validateBackgroundPreferences({...width: 30000})` = false；修复后 true |
| 重开设置不显示当前背景 | 替换保存失败 → 无物可持久化；默认折叠的 disclosure 藏起错误提示与预览 | 保存失败路径仅 `setError` 到折叠区内 |
| 不透明度滑块反向 + 最大不够 | `overlayOpacity` 语义 = 可读性叠加层强度（1 = 遮罩全盖，图片隐藏）；用户期望的是背景图自身不透明度（1 = 完全显示） | `tokens.css` gradient alpha = `var(--ui-background-overlay-opacity)` |
| 背景图显示不了 | (a) 亮色主题：backdrop 变量（`--ui-background-image`/`--ui-backdrop-*`）只在 `[data-theme="dark"]` 块定义，`[data-theme="light"]` 只定义 `--ui-background-color` → 亮色下 `background-image: var(--ui-backdrop-image, none)` = none | `tokens.css` 结构 |

## 存储位置确认（需求 4）

背景偏好（含 5 MiB 上限的 base64 data URL）保存在 **renderer 的 `localStorage`**，其物理位置在 Electron 的 **userData 目录**（`<userData>/Local Storage/leveldb`）——属于全局用户数据，与资源库数据完全隔离：切换/删除资源库不影响背景设置，多资源库共享同一背景。

配额边界：5 MiB data URL ≈ 5.3 MB UTF-8（base64 为纯 ASCII，JSON 序列化不膨胀）。Chromium/Electron 默认 per-origin localStorage 配额 10 MB，5 MiB 预算 + 其余偏好（主题/自定义主题/强调色等，合计 <100 KB）在其内。曾考虑 `session.setStorageQuota` 提升配额，**Electron 43 已无此 API**（`electron.d.ts` 与官方文档均无），故未提升；若未来预算继续增大需迁移 IndexedDB 或 userData 文件。保存失败仍有 `backgroundSaveError` 兜底提示。

## 实现

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 移除 16384 像素上限（高分辨率直通可保存） | `background-preferences.ts:103-111`（`backgroundImageSourceSchema` width/height 仅 `int().min(1)`） | `tests/unit/background-preferences.test.ts:166-185`「accepts high-resolution passthrough sources (no 16384 cap)」：width 30000 严格校验 + 保存成功 | 待人工/Computer Use |
| schema v3：删背景色、`cover`→`fill`、`overlayOpacity`→`imageOpacity`（迁移 1−x，0.2→0.8 视觉等价）、5 MiB 预算、v2/v1 双 key 迁移 | `background-preferences.ts:4-27`（v3 契约与 5 MiB 上限）+ `141-149`（`normalizeBackgroundDisplayMode`）+ `158-171`（`normalizeBackgroundImageOpacity`）+ `236-253`（`loadBackgroundPreferences` legacy 遍历） | 同测试文件：v3 defaults/strict、cover→fill 迁移、overlay→image opacity 迁移（0.2→0.8 / 0.75→0.25）、v1 与 v2 迁移（:213、:239）、5 MiB 上限断言（:191）、`color` 字段拒绝（strict `validate` false） | — |
| 亮色主题渲染背景图（backdrop 变量上移共享 `:root`） | `ui/tokens.css:21-53`（背景契约块独立 `:root`，dark/light 均继承；gradient alpha = `(1 - imageOpacity)`） | typecheck（CSS 无单测） | 待人工/Computer Use：亮色主题下观察背景 |
| 滑块语义反转：`overlayOpacity` 0.2 默认 → `imageOpacity` 0.8 默认，`max=1` 为完全显示；**设置所见即所得**（有背景图时 workspace/左右侧栏 veil 全部 0%，背景图在画布、查看器、插件面板与侧栏同亮度显示） | `background-preferences.ts:298-317`（`applyBackgroundPreferences`：`--ui-background-image-opacity`、`--ui-background-color` removeProperty、cover/fill/tile → `cover`/`100% 100%`/`auto`） | `tests/unit/background-preferences.test.ts:303-341`「applies only validated CSS variables」：cover/fill/tile/none 四态断言（size、surface-opacity 有图 0% / 无图 100%）+ `--ui-background-color` remove | 待人工/Computer Use：设置 100% 时主界面背景图亮度与预览一致 |
| 适配模式三选：铺满（cover，等比锁轴+裁切）/ 拉伸（fill）/ 平铺（tile），默认 cover | `background-preferences.ts:24-31`（`BACKGROUND_DISPLAY_MODES`）+ `ThemeAppearanceControls.tsx`（Select 三选项）+ i18n（铺满/拉伸/平铺） | 迁移测试：contain→cover、fill 保留合法 | — |
| 删除背景色 / 恢复按钮 / 存储提示；适配「铺满」；叠加层改名「不透明度」去说明 | `ThemeAppearanceControls.tsx`（删颜色 TextField/Reset/提示；Select fill/tile；Slider 无 hint；previewStyle 引用 `var(--ui-backdrop-*)` :178 单一事实源） | typecheck（i18n MessageTree 约束） | — |
| i18n 中/英同步 | `i18n/catalogs/{zh-CN,en}.ts`（删 6 键、改 3 键、新增 `backgroundModeFill`/`backgroundOpacity`，en.ts:1085-1089） | MessageTree 类型约束 | — |
| 压缩预算 5 MiB → 4 MiB，**保真优先**（第一档长边 2560 → 4096，先质量阶梯后尺寸递减，压缩结果接近 4M 而非过度缩小到 1M） | `background-preferences.ts:23`（`MAX_BACKGROUND_IMAGE_DATA_URL_BYTES` 4 MiB）+ `background-image-compression.ts:19-27`（`BACKGROUND_IMAGE_MAX_DIMENSION` 4096，注释保真优先） | `tests/unit/background-image-compression.test.ts:53-75`（首档 4096×2304 全质量阶梯、10 级递减）；4 MiB 断言 `background-preferences.test.ts:206` | 待人工/Computer Use：>4M 大图压缩结果接近 4M |
| 压缩兜底不谎报 `compressed`（全失败时返回原图且 `compressed: false`） | `background-image-compression.ts:154-185`（`reencoded` 标志） | `tests/unit/background-image-compression.test.ts:122-140`「does not claim compression when every encode attempt failed」 | — |
| 前端 token 契约同步（`overlayOpacity` → `imageOpacity`） | `ui/foundation.ts`（`UI_CSS_VAR.background`） | — | — |

设计说明：

- **无双重遮罩，不补 `:has` 规则**：交叉审查（第二轮）验证 `.workspace-viewer` 与 `.plugin-sidebar-view-panel` 均为 `background: transparent`（`styles.css`），背景图经 workspace **单层** 84% veil 显示——第一轮推断的「84% 叠乘 → ~16%」不成立。修复轮一度按原开发日志的虚构描述补了 `.workspace:has(...)` 让位规则，但这会把 workspace 变为不透明纯色，面板打开时背景图反而完全消失，**已撤销**。查看器/插件面板打开时的背景亮度即画布区一致（同一 veil），无需额外规则。
- **预览舞台引用真实 token**：`ThemeAppearanceControls` 的 `previewStyle` 从重复内联渐变公式改为 `var(--ui-backdrop-*)` 引用，与 `tokens.css` 单一事实源，滑块/适配/主题切换预览即真实效果。
- **迁移保持视觉不变**：旧 `overlayOpacity` x 的含义是「叠加层强度」（x 越大图越被盖），新 `imageOpacity` = 1 − x 保持同一渲染结果（默认 0.2 → 0.8），只是滑块语义反转。
- **`fill` 默认**：v1 `contain` / v2 `cover` 均归一为 `fill`（拉伸铺满不裁剪不留边）。
- **5 MiB 预算与直通边界**：文件 ≤ ~3.7 MB（data URL ≤ 5 MiB）原样透传（GIF 保留动画）；更大则 WebP/JPEG 质量阶梯 + 尺寸递减压缩至 ≤ 5 MiB；全失败兜底返回最佳尝试且不谎报压缩。

## 验证记录

- `npm run typecheck`：通过（含两个 catalog MessageTree 一致性、`tsconfig.extension.json`）。
- `npm run lint`：通过。
- `npx vitest run tests/unit/background-preferences.test.ts tests/unit/background-image-compression.test.ts`：30/30 通过。
- `npm run test:unit`：285 文件 2099 通过 / 1 skip。
- 未执行：Computer Use / 人工视觉验收（需真实桌面确认亮色主题、面板背景亮度、滑块方向与折叠交互）——已更新 `docs/internal/qa/human-acceptance-checklist.md` UI-STD-003。
- 未执行：packaged app / Windows 验证（无 runner）。

## 关联

- 工单：`Serpent-lxmx.1`（背景图替换、重载预览与透明度语义修复，本次认领并修复）。
- 前置开发日志：`2026-08-04-background-image-upload-development-log.md`（含本次追加的勘误段）。
- 上一轮修复尝试（2026-08-04 上午）已按要求回退，问题待重新定位——本次按根因修复而非补丁。
