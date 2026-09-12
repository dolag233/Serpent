# 2026-09-12 「+」与「链接」按钮改为在资源库根目录创建文件夹

> 工单：`Serpent-186547`（P1）｜ 清单：`FOLDER-CREATE-001`
> 关联：`Serpent-316493`（右键「导入链接文件夹」到子级，随后实施）

## 1. 反馈与决定

用户 2026-09-12：「+ 和链接按钮的语义改成创建根目录下的文件夹比较好」。此前「+」创建的是**当前选中文件夹**的子级（`App.tsx` `onAddFolder` → `openInlineFolderCreate(selectedFolderId ?? null)`），实测选中 Alpha 后点「+」新文件夹落在 Alpha 内，这也是「很难添加顶层文件夹」的直接原因。

分工确定为：

- **根级按钮**（侧栏「文件夹」栏标题右侧的 `+` 与链接按钮）= 在**资源库根目录**创建（普通文件夹 / 链接文件夹）。
- **右键** = 建子级（普通子文件夹今天已有；链接子级见 `Serpent-316493`）。

## 2. 实现

| 改动 | 位置 |
| --- | --- |
| 「+」固定创建在库根 | `src/renderer/App.tsx` `onAddFolder` → `openInlineFolderCreate(null)` |
| 「链接」按钮 | 本来就调用 `importFolderAsLinked()`（无父级参数，落在根级），无需改动；`Serpent-316493` 会为它加上可选的父级参数，根级按钮仍不传 |
| 文案 | 「添加文件夹」「导入链接文件夹」两个悬停提示本身就是中性描述，不再暗示「当前层级」，无需改字 |

快捷键 `⌘⇧N` / `Ctrl+Shift+N` 保持「新建子文件夹」语义不变（它是右键同级命令的快捷键，不是「+」的快捷键）。

## 3. 测试与证据

```
node scripts/run-e2e.mjs tests/e2e/nav-pane-background.test.ts
→ 2 passed
```

- 新增用例「folder-section + creates at the library root while a subfolder is in scope」：进入子文件夹 Beta（面包屑确认）后点「+」新建 `Created`，断言 worker `listFolders` 中 `parentFolderId === null`，且侧栏缩进 `Alpha|Created|Beta = 14px|14px|28px`（与前两者同层，不在 Beta 内）。
- 原有用例同步改造：嵌套文件夹改为**右键 → 新建子文件夹**创建（`createSubfolder` helper），验证新分工下既有能力不回归。

本机 Node v26 下 `NavigationSidebar` 单测仍有 4 条既有用例因 `localStorage` 失败（见另一份开发日志），与本次改动无关。

## 4. 未验证项

- packaged / Windows：未执行。
- 人类验收：见清单 `FOLDER-CREATE-001`（含「选中子文件夹时点 + 落在根级」「右键仍能建子级」「链接文件夹落在根级」三步）。
