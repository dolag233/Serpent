# 2026-08-07 扩展树状拖放保存菜单（Serpent-c0ml）

## 变更

将浏览器扩展拖拽保存 UI 从圆环 Hotbox（一级最多 8 扇区）替换为思维导图双栏树状菜单：

- 左：当前父级 pill（`‹` 返回 + 主体可保存）
- 右：无限纵向命令列表（主体保存，右侧 `›` 悬停进子级）
- 进/退：约 240ms 水平 slide（AE tab 风格）
- 列表边缘自动滚动
- 复用 `buildFolderTree` / `serpent-list-folders` / `serpent-save-request`、压暗、幽灵缩略图、选项开关

## 文件

- `extension/radial-menu-model.ts` — 树项、父级信息、面板布局、矩形命中
- `extension/radial-menu.ts` — Shadow DOM 渲染与拖拽状态机
- `tests/unit/radial-menu-model.test.ts` — 树状命中与无限列表
- `docs/internal/ui/0002-extension-drag-radial-save-menu.md` — v7
- 验收：EXT-010（EXT-009 撤回）

## 验证

- `npm run test:unit -- tests/unit/radial-menu-model.test.ts`
- `npm run extension:build`
- Computer Use / 真实站点拖拽：未执行（移交 EXT-010 人类验收）
