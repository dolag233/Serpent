# 2026-08-29 合集层级重命名与拖拽高亮回归开发日志

## 用户问题

1. 合集 A 有子合集 B 时，重命名 A 报“目标合集已不存在”；父文件夹的同级层级重命名也需要验证。
2. 资产拖到子合集时只有父合集高亮，实际拖拽目标没有高亮。

## 根因

### 父合集重命名

合集更新会先生成用于撤销/重做的历史快照。快照按请求的根合集递归包含全部后代，但旧校验用 `selected.size !== roots.length` 判断是否缺少目标。父合集 A 的请求根数为 1，而快照正确包含 A、B 两行，因此被错误抛出 `FOLDER_NOT_FOUND`。

### 子合集拖拽高亮

合集树使用嵌套 DOM。子合集行的 `dragenter`/`dragover` 设置了子合集目标后，事件继续冒泡到父合集容器，父容器又把 `assetDropTarget` 改成父合集。文件夹没有这层合集容器嵌套路径，因此不受影响。

第一次修复停止了这段冒泡，但暴露出第二个问题：生产环境的 Electron 原生资产拖拽以 `Files` 类型进入 Renderer。子合集 `NavRow` 为了保持高亮命中而停止了 `dragover` 冒泡，却没有同步调用 `preventDefault()`，因此浏览器认为子行不是可放置目标，最终不会派发有效的 `drop`。

这说明前一次修复只修了“视觉目标选择”，没有闭合“可放置目标”协议：一个目标只有同时完成高亮、`dragover.preventDefault()` 和 `drop` 执行，才算真正可用。

## 修复

- `getCollectionHistorySnapshot` 只校验请求的根 ID 是否存在；递归得到的后代数量不再被误判为缺失。快照仍保留整个子树，撤销/重做语义不变。
- 合集行处理资产拖拽事件时停止向父级冒泡；拖到子合集时只保留实际目标的高亮。对原生 `Files` 拖拽，在子行停止冒泡后复用外部拖拽的 `preventDefault()` 与 `copy` dropEffect，确保高亮目标同时是真正可放置目标。合集重排拖拽仍可走父容器路径。
- 新增真实 Electron 回归：把资产卡片拖入嵌套子合集后重新进入子合集，确认资产成员关系已经持久化。

## 深度复盘：为什么父合集和子合集会出现不同结果

### 1. 领域模型没有错，UI 事件分层错了

在领域模型里，父合集和子合集都是同一个 `Collection` 类型；`parentId` 只是树关系，`addCollectionAssets(collectionId, assetIds)` 也只依赖目标合集 ID，并没有“父合集”和“子合集”两套资产成员语义。因此，这不是 Worker/API 把子合集当成了另一种对象，也不是需要通过继承区分的两个类型。

问题出在 Renderer 把一个合集节点拆成了两个 DOM 职责：外层 `.collection-drop-target` 负责合集重排和冒泡兜底，内层 `NavRow` 负责资产拖拽高亮/放置。父子层级让这两个职责嵌套在一起，而所有节点共享同一个 `assetDropTarget` 状态。子节点事件先把状态设为自己，冒泡到父容器后又被父 ID 覆盖，于是出现“父合集高亮、子合集不高亮”。

为解决冒泡，第一次修改让内层 `NavRow` 对资产拖拽停止传播。但原生 Electron 拖拽传递的是 `Files`，此分支只设置了高亮，没有 `preventDefault()`；停止传播又阻断了外层原本会调用的外部拖拽处理器。HTML5/Electron 的规则是：`dragover` 不被取消，后续 `drop` 就不是合法放置。因此视觉上显示了子合集是目标，实际却根本不会落到子合集。这正是本次用户验收发现的“表现上通过、功能上失败”。

### 2. 这违反的不是“有没有父子类”，而是同一抽象的可替换性

从面向对象和领域设计角度，任何 `Collection` 都应能替换到“资产拖入合集”这个用例中；节点是否有 `parentId`、处于树的哪一层，不应改变该用例的契约。实现却让“嵌套节点的内层按钮”和“节点外层容器”分别承担同一个合集的拖拽协议，形成了按 DOM 位置分裂的伪类型：父节点依赖外层兜底，子节点依赖内层截获，而且两个处理器没有共享完整的协议。

更准确地说，这是三个设计缺口叠加：

1. 没有把“合集资产拖拽目标”抽象成单一的 `CollectionNavNode` 行为；
2. 没有把“是否高亮”和“是否允许 drop”视为同一个目标状态的两个必备结果；
3. 没有在拖拽传输格式（managed MIME / native `Files`）边界统一解析，再交给同一套合集成员操作。

所以这不是“父合集和子合集本来就不同”的合理差异，而是违反了同一领域对象应有的统一行为契约。说得更直接一点：代码把 DOM 的嵌套结构误当成了业务对象的类型差异。

### 3. 为什么之前的测试会给出错误安全感

第一次回归测试只断言了 `.is-drop-target`，它证明了“状态最后指向子合集”，却没有证明：

- 原生 `Files` 的 `dragover` 被 `preventDefault()`；
- `drop` 事件确实进入了子合集目标；
- 资产 ID 被解析并传给 `onAssetsDroppedOnCollection`；
- Worker/API 成功写入成员关系，重新进入子合集仍能看到资产。

已有 Electron 拖拽测试还通过 `SERPENT_E2E` 走 Renderer 内部的 managed MIME 路径，而生产 Electron 的 `startDrag` 返回的是原生 `Files` 路径，因此没有覆盖用户实际失败的分支。结果是“高亮测试绿”被误读成“拖拽功能绿”。本次先让 `Files` 的 `defaultPrevented` 断言在修复前失败，再补了原生解析回调单测和真实 Electron 的成员持久化测试，避免再次只测表象。

### 4. 后续设计与代码审查门禁

- 合集资产拖拽以后按“所有 `Collection` 节点同一套行为”设计；`parentId` 只影响渲染层级、折叠和导航，不参与资产 drop 分支。
- 每个节点的资产 drop 处理必须同时完成：识别传输 → 设置目标 ID → `dragover.preventDefault()`/dropEffect → drop 时解析资产 → 调用统一成员写入；不能由父容器兜底补齐子节点缺失的步骤。
- 高亮状态只由实际目标 ID 驱动，父级事件不得覆盖子级目标；重排合集和资产成员拖拽要用不同的显式 payload/处理器，不靠事件冒泡猜测语义。
- 回归矩阵固定包含：根合集/父合集/子合集、managed MIME/原生 `Files`、高亮/可放置/实际成员持久化四层断言。自动化通过仍不替代 Finder/Explorer、Windows、packaged 的人工验证。

## 验证记录

| 检查 | 命令/结果 |
| --- | --- |
| 回归前侧栏拖拽单测 | `npx vitest run --config vitest.config.ts tests/unit/navigation-sidebar.test.ts`：新增用例先失败，证明子合集高亮被父合集覆盖 |
| 回归前历史快照单测 | `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/organization.test.ts -t "renames a parent collection"`：新增快照断言先因 `FOLDER_NOT_FOUND` 失败 |
| 侧栏拖拽单测 | `npx vitest run --config vitest.config.ts tests/unit/navigation-sidebar.test.ts`：6 passed |
| 原生 Files 子合集可放置回归 | 同一侧栏单测新增断言：`Files` dragover 必须 `defaultPrevented`，drop 调用原生文件解析并把解析出的资产 ID交给子合集；6 passed |
| 合集历史/父合集重命名单测 | `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/organization.test.ts -t "renames a parent collection"`：1 passed |
| 真实 Electron 层级回归 | `node scripts/run-e2e.mjs tests/e2e/collection-folder-hierarchy-regressions.test.ts`：2 passed；覆盖父合集重命名、子合集 parentId 保留、父文件夹重命名和子文件夹保留，以及资产拖入嵌套子合集后的成员关系持久化 |
| 代码格式检查 | `git diff --check`：通过 |

| 资源库可用性底线 | `npm run test:library-availability`：9 files / 208 tests passed |
| 全量 unit | `npm run test:unit`：413 files passed、1 skipped；3038 tests passed、3 skipped |
| 类型检查 | `npm run typecheck`：通过 |
| ESLint | `npm run lint`：通过 |
| 最终差异检查 | `git diff --check`：通过 |

## 待验收边界

- `Serpent-520839`（P0）已由用户验收通过并关闭。
- `Serpent-50f2e3`（P1）用户第一次验收发现“高亮但无法把资产拖入子合集”；已补修并由用户复验通过，工单关闭。本次复盘保留该失败链路和测试缺口。
- Windows、Finder/Explorer 原生拖拽与 packaged 仍未在当前环境验证，不能写成已通过；本次用户验收为当前 macOS 开发态路径。
