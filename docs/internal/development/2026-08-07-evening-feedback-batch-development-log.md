# 2026-08-07 晚间反馈批次

## 范围

| 工单 | 反馈 | 处理 |
| --- | --- | --- |
| `Serpent-l0ow` | mac 显示 F2 重命名无效；平台快捷键一致性 | 文件夹 F2 增加当前浏览文件夹 fallback；菜单继续显示 F2。mac 默认需 Fn+F2（系统「标准功能键」未开时）。用户验收通过 SHORTCUT-001。 |
| `Serpent-el2g` | 粘贴报 sequence-offer / 单图粘贴误开序列 | preload 回传 sequence offer；**复验**：`folder.paste` 跳过 sequence probe，并强制 `createImageSequence: false` / `expandImageSequences: false`，原地粘贴应走文件名冲突。待复验 PASTE-001。 |
| `Serpent-37y8` | 多条 toast 未居中 | `align-items: center`；用户验收通过 NOTIFY-003。 |
| `Serpent-thuy` | 内容重复显示已有文件名/预览 | plan examples 补 existing*；对话框列表 + 缩略图；用户验收通过 IMPORT-010。 |
| `Serpent-iihv` | 菜单被侧栏/Inspector 遮挡 | HDRI portal；**复验**：维度过滤条与排序控件改用 `PortaledPopover` 挂到 `document.body`（逃出 `.workspace` isolation）。待复验 MENU-015。 |
| `Serpent-qybz` | 启动总显示所有资产 | 用户接受「重启后显示所有资产」现状；关闭 NAV-010 为通过。 |

## 复验修复（同日）

### PASTE-001

根因：`folder.paste.request` 在 Main 里仍走 `asset.import.probe-sequences`；源路径若落在含帧序号的目录旁还会被当成序列候选。另：跳过 probe 时未写 `createImageSequence: false`，Worker 默认仍可能建序列。

修复：`src/main/index.ts` 对 paste 跳过 probe，并在 prepare 命令上显式关闭序列扩展/创建。

### MENU-015

根因：`.workspace { isolation: isolate; z-index: 0 }` 困住工具栏弹出层；`.inspector-pane { z-index: 2 }` 盖住「更多」等 absolute popover。

修复：`PortaledPopover` + `DimensionFilterBar` / `SortModeControl` 门户到 body，层为 `--ui-layer-popover`；hover/outside-click 把 `[data-dimension-filter-popover]` 算作过滤条内部。

## 验证

- `npm run typecheck`：通过（复验修复后）
- Computer Use / packaged / Windows：未执行
- 待复验：PASTE-001、MENU-015
- 已通过：SHORTCUT-001、NOTIFY-003、IMPORT-010、NAV-010
