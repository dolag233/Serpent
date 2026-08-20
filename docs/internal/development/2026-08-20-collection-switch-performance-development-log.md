# 合集切换卡顿：递归范围查询优化

- 日期：2026-08-20
- 工单：`Serpent-6355d7`
- 状态：实现完成，独立审查已完成，待人类验收

## 问题与复现

用户反馈切换合集明显比切换文件夹更卡，尤其是开启「包含子合集」时。
代码追踪确认合集切换会经历两次 Worker 查询：首屏 `searchAssets`，以及
`Serpent-sa65` 浏览分页控制器随后发起的全范围 `layoutOnly` 查询。

旧的合集 SQL 同时存在两个成本叠加点：

1. `WHERE` 用递归 CTE 找成员资产；
2. 默认合集排序又对每个候选资产执行一次相关子查询，并在子查询内部重新
   计算递归 CTE 和 `MIN(collection_assets.position)`。

这使递归合集在资产量增大或成员跨多个子合集时，查询成本随候选资产重复放大。

## 实现

在 `src/worker/library-service.ts` 的 `searchAssets` 中，将合集范围改为一次
构造的 `collection_scope` 关系：

- 递归范围先计算 `collection_descendants`，再按 `asset_id` 聚合最小位置；
- 非递归范围直接读取目标合集成员及其位置；
- COUNT、首屏、`idsOnly` 和 `layoutOnly` 均通过同一个 scope join 过滤；
- 默认排序直接使用 `collection_scope.collection_position`，移除每资产一次的
  递归相关子查询；
- `GROUP BY asset_id` 保留父合集与子合集重复归属时的集合并集语义。

同时新增 `tests/worker/collection-switch-performance.test.ts`：

- 合成 20,000 项资产、1 个父合集、10 个子合集；
- 覆盖父子合集重复归属的去重语义；
- 覆盖首屏、全范围布局和查询形状回归；
- 通过 Worker SQL trace 断言不回到旧的逐资产递归排序路径。

并扩展 `tests/worker/large-library-performance.test.ts`，在真实 20k 夹具存在
时额外记录递归合集 `layoutOnly` 耗时。

独立审查后补强了验证边界：合成夹具加入同规模 managed folder 对照和 500ms
首屏门槛；分别对首屏、COUNT、`layoutOnly`、`idsOnly` 的 COUNT/data SQL
断言 scope join；Electron 分页旅程扩展到 173 项，覆盖递归合集切换、首屏后
滚动追加以及「包含子合集」开关。

## 四列证据

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 递归合集只计算一次成员范围与排序位置 | `src/worker/library-service.ts`：`searchAssets` 的 `collectionScope` | `tests/worker/collection-switch-performance.test.ts`：分别断言首屏、layoutOnly、idsOnly 的 COUNT/data SQL 形状，并运行 20k 递归首屏/布局基线 | macOS Worker 合成 20k 已执行；真实 packaged、Windows 未执行 |
| 父合集与子合集重复归属仍只显示一次 | 同上：`collection_scope GROUP BY ca.asset_id` | 同一测试夹具为 20% 资产添加父合集重复归属，并断言总数为 20,000 | macOS Electron 173 项递归合集旅程已通过；真实大库人工计时待用户验收 |
| 首屏和全范围布局不改变结果 | 同上：COUNT/data/layout/idsOnly 共用 scope join | `tests/worker/search.test.ts`、`tests/worker/organization.test.ts`、新性能测试 | macOS Electron 173 项递归合集切换、滚动追加和开关子合集已通过；真实大库人工计时待用户验收 |

## 验证记录

修复前最小夹具输出：

```text
allMs=15.0 directMs=1.1 recursiveMs=110.8 recursiveLayoutMs=145.2
```

修复后同一类 20,000 资产夹具（含父子重复归属）输出：

```text
allMs=16.1 folderMs=6.9 directMs=1.0 recursiveMs=45.7 recursiveLayoutMs=72.3
```

已执行：

```text
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/worker/collection-switch-performance.test.ts \
  tests/worker/search.test.ts tests/worker/organization.test.ts \
  --disableConsoleIntercept
# 3 files / 152 tests passed

npm run test:library-availability
# 9 files / 189 tests passed

node scripts/run-e2e.mjs tests/e2e/asset-pagination.test.ts
# 2 tests passed；173 项递归合集首次切换 99ms

npm test
# 447 files passed / 12 skipped；3917 tests passed / 19 skipped；
# 5 files / 6 tests failed，失败集中在仓库已有的临时路径、IME Escape、
# ffmpeg lavfi、视频编码探针和 webm 代理环境问题，合集相关测试未失败
```

未通过/被仓库现状阻断的检查：

- `npm run typecheck` 仍被既有 `tests/unit/ticket-script.test.ts` 对 `*.mjs` 的
  4 个声明错误阻断，与本变更无关；
- 定向 ESLint 仍报告 `library-service.ts` 既有的 4 个未使用变量（行 17374、
  17387、31071、31072），本次新增代码未产生 lint 错误；
- 已执行 macOS Electron 173 项交互旅程，但它使用 5s 防冻结线；Computer Use
  仅完成当前打开窗口的只读截图，当前 `temp资源库` 没有合集，未建立测试合集，
  因此合集性能的桌面人工路径仍未完成；packaged 与 Windows 也未执行，不能把
  500ms 产品目标写成完整平台验收。

## 待人类验收

使用大型且包含嵌套合集的资源库，分别切换同规模文件夹、普通合集和递归合集，
反复开关「包含子合集」。观察首屏卡片是否快速出现、旧画布是否清空、切换过程
是否仍冻结，以及递归合集是否与文件夹切换处于同一量级。
