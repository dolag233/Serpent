# 2026-08-24：文件夹失焦提交后的侧栏刷新

## 现象与根因

文件夹重命名在当前浏览范围内通过鼠标点击空白处提交后，操作成功提示会出现，但侧栏仍显示旧名称，直到手动刷新。文件夹导航默认会跳过侧栏查询以降低大型资源库切换成本；重命名当前范围时复用了这个轻量路径，因此成功结果没有重新应用到侧栏树。

## 修复

当前浏览文件夹重命名完成后，调用 `chooseFolder` 时明确启用 `refreshSidebar: true`。普通文件夹导航仍保持原有的轻量刷新策略；新建文件夹的失焦提交继续走完整内容刷新。

## 验证

- `node scripts/run-e2e.mjs tests/e2e/folder-context-menu.test.ts --grep "renames a folder inline|creates under the selected folder"`：2 项通过。
- `npm run typecheck`：通过。
- `npx eslint src/renderer/App.tsx`：通过。
