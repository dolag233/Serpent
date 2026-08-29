# 2026-08-29 合集层级重命名与拖拽高亮回归开发日志

## 用户问题

1. 合集 A 有子合集 B 时，重命名 A 报“目标合集已不存在”；父文件夹的同级层级重命名也需要验证。
2. 资产拖到子合集时只有父合集高亮，实际拖拽目标没有高亮。

## 根因

### 父合集重命名

合集更新会先生成用于撤销/重做的历史快照。快照按请求的根合集递归包含全部后代，但旧校验用 `selected.size !== roots.length` 判断是否缺少目标。父合集 A 的请求根数为 1，而快照正确包含 A、B 两行，因此被错误抛出 `FOLDER_NOT_FOUND`。

### 子合集拖拽高亮

合集树使用嵌套 DOM。子合集行的 `dragenter`/`dragover` 设置了子合集目标后，事件继续冒泡到父合集容器，父容器又把 `assetDropTarget` 改成父合集。文件夹没有这层合集容器嵌套路径，因此不受影响。

## 修复

- `getCollectionHistorySnapshot` 只校验请求的根 ID 是否存在；递归得到的后代数量不再被误判为缺失。快照仍保留整个子树，撤销/重做语义不变。
- 合集行处理资产拖拽事件时停止向父级冒泡；拖到子合集时只保留实际目标的高亮。合集重排拖拽仍可走父容器路径，原生 `Files` 与托管资产拖拽的目标识别不变。

## 验证记录

| 检查 | 命令/结果 |
| --- | --- |
| 回归前侧栏拖拽单测 | `npx vitest run --config vitest.config.ts tests/unit/navigation-sidebar.test.ts`：新增用例先失败，证明子合集高亮被父合集覆盖 |
| 回归前历史快照单测 | `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/organization.test.ts -t "renames a parent collection"`：新增快照断言先因 `FOLDER_NOT_FOUND` 失败 |
| 侧栏拖拽单测 | `npx vitest run --config vitest.config.ts tests/unit/navigation-sidebar.test.ts`：6 passed |
| 合集历史/父合集重命名单测 | `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/organization.test.ts -t "renames a parent collection"`：1 passed |
| 真实 Electron 层级回归 | `node scripts/run-e2e.mjs tests/e2e/collection-folder-hierarchy-regressions.test.ts`：1 passed；覆盖父合集重命名、子合集 parentId 保留、父文件夹重命名和子文件夹保留 |
| 代码格式检查 | `git diff --check`：通过 |

| 资源库可用性底线 | `npm run test:library-availability`：9 files / 208 tests passed |
| 全量 unit | `npm run test:unit`：413 files passed、1 skipped；3038 tests passed、3 skipped |
| 类型检查 | `npm run typecheck`：通过 |
| ESLint | `npm run lint`：通过 |
| 最终差异检查 | `git diff --check`：通过 |

## 待验收边界

- `Serpent-520839`（P0）和 `Serpent-50f2e3`（P1）已具备自动化证据，现进入待人类验收。
- Windows、Finder/Explorer 原生拖拽与 packaged 仍未在当前环境验证，不能写成已通过。
