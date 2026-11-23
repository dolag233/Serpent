# 真实滚动中的封面节点周转

## 问题与测量范围

整体性能 `Serpent-3kfe` / 画布 `Serpent-47cc35` 继续调查。审查候选为 `AssetCardMedia` 依实际可见范围挂载封面，是否导致异常节点周转及样式计算。没有修改产品的媒体挂载、缓存、overscan、并发或 CSS。

新增测试层 `canvas-cover-mutation-probe.ts`，在 install-time 的 workspace canvas 内观察静态 cover img 的 childList/src mutation。只输出 source-direct / preview / other 分类计数、start/peak/end 节点数和观测时长，不保留或报告 URL、文件名或资产 ID；不逐帧测几何。分别串行复用既有 CDP layout trace，比较静止两秒与 CDP mouseWheel 四秒。诊断仪器会扰动执行，不能把 trace 当普通 A/B 性能基准。

主 agent 审查修正：移除 img 自身后已失去 card 祖先，不能再用 `closest(.asset-card)` 识别 removal；现由已跟踪 WeakSet 认定，新增节点另查实际 canvas/card 归属。阶段结束以实际 DOM 分类重数，若漂移则失败。Luna 增补 happy-dom 实际执行 installer/MutationObserver 的单独 img 删除、整个 card 删除、同批插入移除回归；不是仅复制计算式的断言。

## 当前构建真实 Windows Electron

两源均为只读原媒体、全新隔离链接 catalog，使用与 AI 修复验证相同的产品构建。没有 AI 延迟探测、CPU profiler、样式覆盖或 GC。本轮从初始页面开始，尚不是四次远跳后的同位置诊断。

| 指标 | 真实源 A：28,930 项 | 真实源 B：15,465 项 |
| --- | --- | --- |
| 静止时长 | 2,013 ms | 2,011 ms |
| 静止 insert/remove/src mutation | 均 0 | 均 0 |
| 静止封面节点 | 24 | 25 |
| CDP wheel 实际位移 | 1,600 px / 4,017 ms | 1,600 px / 4,052 ms |
| 滚动 insert/remove | 40 / 39 | 40 / 35 |
| 滚动 src attribute records | 40 | 40 |
| 滚动封面峰值 / 结束 | 30 / 25 | 30 / 30 |
| 静止 UpdateLayoutTree 总耗时 | 0.32 ms | 11.76 ms |
| 滚动 UpdateLayoutTree 总耗时 | 172.82 ms / 180 项 | 242.55 ms / 174 项 |
| 滚动 Layout 总耗时 | 20.24 ms / 50 项 | 23.89 ms / 43 项 |

source-direct 与 preview 分类分别记数；A 有初始 14 个 source-direct，B 初始全是 preview。新 img 的初次 src attribute 设置也计入 src records，不能把“40 insert + 40 src”说成 80 次重复图片加载。

结论限于此窗口：静止没有封面周转；滚动的新增量与进入画面的新卡片规模接近，没有观察到明显反复挂载风暴。仍存在样式树工作，但此数据不证明封面生命周期是主要根因，也不证明所有同卡反向滚动/不同跳点都没有重复创建。暂不为此保留大范围原图节点，避免把尚未证实的 CPU 问题变成解码内存增长。此前长 trace 含远跳、普通滚动与 idle，不能将其总耗时直接与这四秒窗口比较。

## 命令、失败与限制

- `npx vitest run --config vitest.config.ts tests/unit/canvas-cover-mutation-probe.test.ts`：最终 1 文件 / 5 passed（实际 DOM/MO 3 项 + 分类与输出约束 2 项）。
- 设置 `SERPENT_REAL_NAV_PROBE_COVER_CHURN=1`、`SERPENT_REAL_NAV_WAIT_NAVIGATION=1`，对每个经授权源串行运行 `node node_modules/@playwright/test/cli.js test tests/e2e/real-linked-navigation-perf.test.ts --reporter=line`：首轮各 1 passed / 25.8、19.3 秒。主 agent 补上 trace 结束后可见图片解码断言，最终同构建再次两源串行：各 1 passed / 22.9、18.2 秒，结束时 A 25/25、B 30/30 满足 `complete && naturalWidth > 0`；节点 insert/remove/峰值与首轮相同。第二轮滚动 UpdateLayoutTree 为 A 72.89 ms、B 204.19 ms，产品构建没有变化，故不把轮次波动称为优化效果。
- 初版 E2E 的页面回调中 `window` 被外层 Page 变量遮蔽，静态检查误判 `window.setTimeout`；改为 `globalThis.setTimeout`。这是测试代码类型错误，不归为产品故障。
- 每段 trace 先 stop/dispose，再启动下一段；observer、CDP session 与 owned catalog/output 在 finally 清理。新建产物已清理，旧拒绝目录未重试。

本轮没有新的产品交互，不新增人类验收 ID。前台按用户要求未操作，packaged/macOS、原实例完整历史、远跳后相同资产集合的周转尚未验证。不以本诊断关闭整体性能工单。另有稳定 ARW 迟就绪 `Serpent-fe5da4`，含批次事件的测量更正见同日 AI 连接探测记录。
