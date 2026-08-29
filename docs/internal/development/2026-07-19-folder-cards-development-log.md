# 2026-07-19 文件夹卡片 / 封面 / 计数（Serpent-5ja）

## 范围

- `Serpent-5ja.1` REQ-FOLDER-001：进入托管文件夹（及托管根 `root`）时，画布在资产之前显示直接子文件夹卡片。
- `Serpent-5ja.2` REQ-FOLDER-002：卡片封面取直接子资产最多 3 张 ready thumbnail/poster（Windows 式拼贴）。
- `Serpent-5ja.3` REQ-FOLDER-003：侧栏托管文件夹、文件夹卡片、移动目标下拉显示直接子资产数（澄清 #2 未决 interim）。
- `Serpent-5ja.4` REQ-FOLDER-010：文件夹卡片参与框选与 Cmd/Shift 多选；`selectedAssetIds` 保持纯资产 ID。

## 实现要点

- Worker：`listFolderBrowseEntries` + `listManagedFolders` 批量计数/封面，禁止 N+1。
- 协议：`folder.browse-entries.request` → Worker → preload `listFolderBrowseEntries`。
- Renderer：`FolderCard`、`folder-browse-canvas.resolveFolderBrowseParentId`、`useAssetSelection` 扩展 marquee/`data-folder-id`。

## 验证

- `npm run typecheck` 通过。
- Worker：`folder-browse-entries` / `managed-folders` / `folder-rename` 13/13。
- Unit：`folder-card-selection` 及相关 fixture 通过。
- Computer Use：当前环境未执行，移交人工验收。

## 已知缺口

- 混合（folder+asset）右键菜单尚未做独立 descriptor；单文件夹右键复用现有文件夹菜单。
- 「所有资产」视图不显示根级文件夹卡片（仅 `assetScope === 'root'` 与具体托管文件夹）。
