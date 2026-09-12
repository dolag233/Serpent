# 2026-09-12 文件夹栏空白区域：点击回根目录、拖放移动到根目录

> 工单：`Serpent-6e3b10`（点击空白回根目录）、`Serpent-b29bc4`（拖放空白到根目录）
> 清单：`NAV-FOLDER-ROOT-001`、`DND-FOLDER-ROOT-001`
> 基础提交：`89f689b6`（dev）

## 1. 需求来源与最终口径

用户 2026-09-12 反馈（附侧栏截图，红箭头指向「测试」子文件夹下方的空白处）：

1. 文件夹区域点击空白处应回到根目录。这样能缓解「很难添加顶层文件夹」——`+` 跟随选中层级创建，用户没有顺手回到根目录的入口。
2. 文件夹应能拖放到空白处移动到根目录。

**空白区域的口径（用户 2026-09-12 两次澄清，附标注截图）**：指**「文件夹」这一栏的空白区域**，即**文件夹行左侧的缩进槽**（展开箭头所在列）；**不含**下方的「合集 / 智能合集」区域，也不含面板其余部分。用户随后明确：不要在最后一行下方额外加空白条（第三版曾插 24px，已回退，布局间距保持原样）；高亮框要是**圆角矩形**，与其他 UI 对齐。

## 2. 现状盘点（复用优先）

- `resolveFolderOntoFolderDrop({ targetFolderId: null })` 早已把 **null 当作资源库根**（`folder-drag-drop.ts:92-135`），`useFolderDragDropHandlers.handleFoldersDroppedOnFolder` 也已接受 null；缺的只是**空白区域这个投放目标**。
- 文件夹行、链接文件夹行、合集行、回收站行各自注册了 drop 处理器；`<nav class="navigation-scroll">` 自身没有任何点击/拖放处理。
- 因此不需要新增移动语义，只需把「文件夹栏空白区域」接成 null 目标，并复用既有 `moveFolders` 路径与 `toast.folderAlreadyThere` 提示。

## 3. 实现

| 需求 | 实现位置 |
| --- | --- |
| 点击空白回根目录 | `src/renderer/NavigationSidebar.tsx:1219-1224`（`folderListBlankHandlers().onClick`）、`:1975`（挂到 `.nav-folder-list`） |
| 空白判定：非行/非控件即空白 | `src/renderer/NavigationSidebar.tsx:1181-1216`（`NAV_FOREGROUND_SELECTOR` + `isFolderListBlankTarget`） |
| 输入会话期间不抢点击 | `src/renderer/NavigationSidebar.tsx:1232-1238`（`inlineEditorOpen`） |
| 拖放空白移动到根目录 | `src/renderer/NavigationSidebar.tsx:1219-1262`（dragenter/dragover/dragleave/drop） |
| drop 高亮 | `src/renderer/NavigationSidebar.tsx:977,990-1001,1975` + `styles.css:1805-1814`（`.nav-folder-list.is-root-drop-target`：`--accent` token + `border-radius: var(--ui-radius-surface)`（6px，与 `.nav-row` 一致）+ inset 描边不改尺寸） |

设计要点：

- **作用域只有文件夹栏**：处理器挂在包裹文件夹行的 `.nav-folder-list` 上（`<Section title={t("nav.folders")}>` 的正文），不是整个 `.navigation-scroll`；合集/智能合集与面板其余部分点击不触发（`Serpent-6e3b10` 单测「does not navigate from the rest of the pane」）。
- **空白 = 不落在行/控件上的点击**。前景集合 `.nav-row` / `.nav-disclosure` / `.nav-inline-edit` / `button` / `input` / `textarea` / `select` / `label` / `a[href]` / `[role]` / `[tabindex]` / `[contenteditable]`；从事件目标向上走到 `.nav-folder-list` 判定。**缩进槽因此算空白**（它属于 `.nav-tree-row` 的内边距或 `.nav-disclosure-spacer`，不属于任何行），点它回到根目录；行自身与展开箭头仍是前景。
- **行高亮优先**：`dragover` 落在行上时显式清除空白区高亮，避免「行高亮 + 整块空白区高亮」同时亮着；window `dragend`/`drop` 兜底清除。
- **不新增资产/文件投放语义**：只在 `supportsManagedFolderDrag` 时 `preventDefault`；资产拖拽与外部文件拖拽落在空白区域的行为与改动前一致（不处理）。

## 4. 两次返工的原因（都用真实 Electron 取样定位）

### 4.1 首版：只有容器自身算空白 → 点击被标题/空状态吞掉

首版判定为 `event.target === event.currentTarget`，且处理器挂在 `.navigation-scroll` 上。单测全绿，但用户实测「点击空白处还是不会回到根目录」。临时 Playwright 探针取样：

```
PROBE below-last-row:  under=NAV.navigation-scroll        crumb Beta -> 资源库根目录   ✅
PROBE pane-bottom:     under=NAV.navigation-scroll        crumb Beta -> 资源库根目录   ✅
PROBE empty-state:     under=P.nav-empty「尚无智能合集」  crumb Beta -> Beta          ❌
PROBE folder-row:      under=BUTTON.nav-row               crumb Beta -> Beta          ✅（行语义正确）
```

根因：文件夹树下方的带状区域在真实布局里几乎被「合集 / 智能合集」的分区标题（`div.nav-section-heading`）与空状态段落（`p.nav-empty`）占满，纯 nav 自身只剩分区间约 16px，所以用户点哪里都像没反应。

### 4.2 第二版：整块面板都算空白 → 范围超出用户口径

第二版改成「非行/控件即空白」，但作用域仍是整个 `.navigation-scroll`，于是「合集 / 智能合集」区域与面板底部点击也会回根目录。用户随即用标注截图澄清：**空白区域指「文件夹」这一栏**。第三版把处理器收敛到 `.nav-folder-list`，并补一条最后一行下方的空白条（`.nav-folder-blank`，24px），保证该栏任何情况下都有可点/可放的空白。

修正后同一探针（第三版，真实 Electron）：

```
blank strip below the tree   under=DIV.nav-folder-blank        crumb Beta -> 资源库根目录 ✅
indentation gutter           under=DIV.nav-tree-row            crumb Beta -> 资源库根目录 ✅
collections heading          under=SPAN「合集」                 crumb Beta -> Beta          ✅（不触发）
collections empty state      under=P.nav-empty「尚无合集」       crumb Beta -> Beta          ✅（不触发）
pane bottom                  under=NAV.navigation-scroll        crumb Beta -> Beta          ✅（不触发）
folder row                   under=BUTTON.nav-row「Beta」        crumb Beta -> Beta          ✅（行语义）
drag to blank strip          highlight="nav-folder-list is-root-drop-target"
                             已移动 1 个文件夹 / API relativePath="Beta", parentFolderId=null
                             / 树中与 Alpha 同层
```

### 4.3 第三版：多加的空白条与直角高亮 → 按反馈回退（最终形态）

第三版为了让「最后一行下方」也可点，在文件夹栏末尾插了一条 24px 的 `.nav-folder-blank`，高亮框是直角。用户 2026-09-12 反馈两点：

1. 高亮框应是**圆角矩形**，需要和其他 UI 对齐；
2. **不要扩大**文件夹区域下方的空白，保持原样。

处理：

- 删除 `.nav-folder-blank`（及其 CSS），文件夹栏间距回到改动前的布局；因此该栏的空白目标 = **缩进槽**（行左侧未被行按钮覆盖的那条），不再包含最后一行下方。
- 高亮改 `border-radius: var(--ui-radius-surface)`（6px，与 `.nav-row` 相同），仍保留 `--accent` 底色与 inset 描边，拖拽中不改尺寸。
- 真实 Electron 复核（最终形态）：缩进槽点击回根目录；合集标题 / 合集空状态 / 面板底部不触发；点文件夹行仍只进该文件夹；拖到缩进槽时 `.nav-folder-list` 高亮且 `getComputedStyle(...).borderRadius === "6px"`，释放后移动成功。

**教训（已按验收纪律记录）**：空白/背景类交互的判定与作用域都必须在真实 Electron 里取样确认（命中元素 + 边界 + 计算样式），单测通过不构成覆盖；同时作用域与视觉（圆角、间距）都要按产品口径收敛，不能顺手扩大到整个面板或改变原有布局。

## 5. 测试与证据

```
node node_modules/vitest/vitest.mjs run tests/unit/navigation-sidebar.test.ts tests/unit/folder-drag-drop.test.ts
→ tests/unit/folder-drag-drop.test.ts (10 tests) 全通过
→ tests/unit/navigation-sidebar.test.ts：NavigationSidebar folder-section blank area 13 条全通过
  （同文件 4 条既有用例失败，见 §6）

node scripts/run-e2e.mjs tests/e2e/nav-pane-background.test.ts
→ 1 passed（真实 Electron：缩进槽点击回根目录；合集标题、合集空状态、面板底部不触发；
   点文件夹行仍进该文件夹；拖放到缩进槽时高亮为圆角 6px 并移动到根目录，
   核对 API 与侧栏树）

node node_modules/typescript/bin/tsc --noEmit   → exit 0
node node_modules/eslint/bin/eslint.js <改动文件> → exit 0
```

单测（`tests/unit/navigation-sidebar.test.ts` 的 `NavigationSidebar folder-section blank area`）：

- 点文件夹栏容器自身 → `onChooseFolder("root")`
- 点文件夹栏空状态（无文件夹时）→ 回根目录
- 点**缩进槽** → 回根目录
- 点面板其余部分（合集标题、合集空状态、nav 自身）→ **不**导航
- 点文件夹行只进该文件夹
- inline 编辑会话中点空白/缩进槽不跳转
- 拖放到文件夹栏空白区 → `onFoldersDroppedOnFolder(null, [...])` 且高亮切换
- 拖放到缩进槽 → 同上
- 拖到文件夹行 → 目标仍是该行，空白区高亮不亮
- 从空白区拖到行上 → 高亮让位给行
- 拖到文件夹栏之外（合集标题）→ 不触发移动
- 资产/外部文件拖到空白区 → 行为不变（不 preventDefault、不触发移动）

`tests/unit/folder-drag-drop.test.ts:84-105`：`targetFolderId: null` 时把嵌套文件夹移到根目录；已在根目录的文件夹得到 `same-parent` 拒绝（对应「已在该位置」提示）。

真实 Electron 回归：`tests/e2e/nav-pane-background.test.ts`，已加入 `npm run test:e2e` 与 `test:e2e:isolated` 清单。

## 6. 环境问题（与本次改动无关，需注意）

本机 Node 为 **v26.0.0**，项目要求 `>=24 <25`（`.nvmrc` = 24.15.0）。Node 26 自带 `localStorage` 全局会遮蔽 happy-dom 注入的 web storage，导致 `NavigationSidebar` 中 4 条既有用例（`:145`、`:172`、`:415`、`:467`）挂载即失败：

```
Error: LocalePreferences: no storage provided and globalThis.localStorage is not available.
```

已用 `git stash push -- src/renderer/NavigationSidebar.tsx src/renderer/styles.css` 做基线对照：stash 掉本次源码改动后同样 4 条失败，确认为环境问题而非本次回归。请在 Node 24 下复跑该文件。本次新增用例显式传 `initialPreference`，不依赖 `globalThis.localStorage`。

另：受限沙箱下 vitest 与 Playwright 无法启动（Vite 的 Windows 路径探测 `exec("net use")` 走管道 stdio 被拦为 `spawn EPERM`），需在非受限模式运行测试。

## 7. 未验证项

- packaged / Windows：未执行（真实 Electron 开发态已按 §4 证据验证）。
- 其余 E2E 套件本轮未跑：改动仅限 Renderer，未触及跨进程协议、自定义协议、媒体二进制或打包资源。
- 拖拽手感与高亮观感仍需人眼确认；人工验收见清单 `NAV-FOLDER-ROOT-001` / `DND-FOLDER-ROOT-001`。
- 「缩进槽算空白」是本次的实现选择：按用户要求不再额外插入空白条，因此文件夹栏里可点/可放的空白只剩行左侧那条窄带。若实际手感不足，需要产品再决定是加空白条还是改行布局。

## 8. 关联后续工单（2026-09-12 用户确认）

- `Serpent-186547`（P1）：「+」与「链接」按钮改为在资源库根目录创建文件夹（现状 `App.tsx:11055` 跟随选中层级）。
- `Serpent-316493`（P1）：文件夹右键支持创建子链接文件夹（语义待产品确认）。
