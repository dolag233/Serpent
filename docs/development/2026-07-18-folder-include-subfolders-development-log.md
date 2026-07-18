# 2026-07-18 REQ-FOLDER-009 包含子文件夹显式开关

## 背景

FOLDER-001 人类验收不通过：默认递归不符合预期。用户要求显式勾选后才显示子文件夹资产（`Serpent-1lx` / REQ-FOLDER-009）。

## 实现

- `folderBrowseScope(scope, recursive)`：统一构造浏览/搜索的 folder scope。
- `folderRecursive` 默认 `false`；状态按 **libraryId + folderId** 写入 `serpent.folder-recursive.v1`（仅存开启项）。
- 控件位置：资产浏览区 `workspace-title` 内、文件夹名**左侧**；图标为双层文件夹 `folders`。
- 进入文件夹时从偏好恢复开关；会话恢复同样读取偏好。

## 验证

- `tests/unit/folder-browse-scope.test.ts`、`folder-recursive-preferences.test.ts`
- `tests/e2e/folder-recursive-scope.test.ts`：断言 `.workspace-title` 内按钮

## 人类验收

清单条目：`FOLDER-009`（待人类验收）。
