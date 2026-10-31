# Issue #75 开发记录

状态：实现与定向自动化完成，待人类验收；未提交、未发布。基线：`0991c58d`。方案：[大库导航与 OIIO 路径修复](../implementation/2026-10-31-large-library-navigation-and-oiio-design.md)。工单：`Serpent-df0ce3`、`Serpent-46d599`。

## 2026-10-31

开始实现两项独立功能。现有输入法相关未跟踪文件与既有工单修改属于其他工作，保留。此轮不提交或推送。

OIIO 在公共调用入口统一禁用数字通配符，FBX 贴图转换使用同一参数规则。失败按诊断正文区分颜色变换与一般处理失败，新工件记录字面路径策略版本；旧版本且完整路径含 `#` 的当前缩略图失败有界失效，再由原有队列领取。新版本失败不在开库时循环重试。

新增 v60 加法迁移保存链接目录完整快照、父目录索引及根成员版本。导入复用原扫描；开库和 watcher 复用原异步协调 owner，扫描分片写入，完整成功后切换 generation。新扫描在枚举前取得版本，应用内变更及更新扫描使旧结果失效；清理保护其他仍在写入的 generation。失败和离线继续使用最后完整快照。重新链接显式等待目标根的异步扫描，不依赖 watcher 初始事件。

导航、文件夹卡片、搜索文件夹引用、链接根列表及自动化列表共用分片资产投影；卡片使用父目录索引批量查询子项，忽略设置读取相同目录结构。根成员变化只失效对应根。导航按库实例、浏览版本与显示策略合并同时到达的请求；切库/关闭使旧实例构建失效。忽略规则预编译，显式目录忽略批量读取；空忽略表/序列帧表不再为每条资产执行无意义相关子查询。未改 Renderer、Preload 或公开协议。

另定位到确定性调度顺序问题：maintenance 先运行、随后 status 导航占用例外槽时，primary source 查询无法领取；顺序相反却可领取。新增测试先稳定失败，再修正准入条件：两种顺序都保留一个 primary 槽，第二个 primary 仍等待。此修复只证明该等待机制，不声称重建了原日志的 54 秒绝对时长。

复用点：原有 reconciliation owner、异步枚举、watcher、路径身份、忽略规则、目录计数、缩略图队列及工件失效机制。新增索引/可见性/规则编译/投影/计时/single-flight/OIIO 参数模块独立于大型 service；未建立第二套媒体任务系统。

## 验证与返修

- 定向 Worker/unit 命令及结果见 [QA 报告](../qa/2026-10-31-issue-75-qa.md)：15 文件 222 passed / 2 skipped；忽略与导入准入补充 3 文件 15 passed。
- `npm run test:library-availability`：最终 9 文件 236 passed / 1 skipped。第一次运行出现 10 项失败，原因是历史版本 fixture 回退迁移记录时残留 v60 对象；增加仅供测试使用的 schema 回退清理，保持生产迁移严格创建语义。没有用 `IF NOT EXISTS` 隐藏历史不一致。
- `npm run typecheck` 通过；所有本次修改/新增 TypeScript 文件的定向 ESLint 通过。仅输出已有巨型文件的 Babel 提示。
- 隔离、隐藏、串行 Electron：`node scripts/run-e2e.mjs tests/e2e/linked-navigation-preview.test.ts tests/e2e/tiff-image-preview.test.ts`，最终 2 passed（54.8 秒）。包含 JPG 查看器原图 480×480 解码、含 `#` 的 TGA 卡片、TIFF 卡片 512 与查看图 2048×1024 解码，以及完整退出进程、源根离线后重启重新打开库的空目录保留。
- 新 Electron 测试有两次测试自身修正：卡片可能使用已生成封面工件，原图直出应在查看器断言；隔离测试默认不恢复最近库，重启必须实际点击打开库。两次失败均记录为失败，最终通过基于上述修正后的完整旅程。
- 独立审查使用用户选定的 luna，同一审查 agent 同时覆盖 Standards 与 Spec。发现冷卡片同步读、重新链接缺初始扫描、扫描顺序和旧命令入口残留，均修复并补测试；最终没有代码审查阻断项。详见 [审查记录](../reviews/2026-10-31-issue-75-review.md)。

## 当次性能数据

标准 20,000 混合媒体夹具使用 `node scripts/generate-large-library.mjs --output tmp/issue-75-baseline-20261031 --assets 20000 --seed 20261031` 生成；`node scripts/run-large-library-performance.mjs tmp/issue-75-baseline-20261031` 最终 3 passed（19.50 秒）。startup 9.9 ms、普通浏览 11.3 ms、文件夹切换 0.8 ms、搜索 18 ms、导航初次 139 ms / 热 0.2 ms、Inspector 0.5 ms；后台核对 4487.6 ms、事件循环间隙 p95 1.2 ms / 最大 86 ms，viewer 路径解析 p95 4.7 ms / 最大 9 ms。以上是 Worker 证据，不等于 UI 首屏；删除刷新没有在该基线执行。

额外元数据规模测试：`SERPENT_LINKED_NAV_BENCHMARK=1 node scripts/run-vitest-with-electron.mjs run tests/worker/linked-navigation-performance.test.ts --disableConsoleIntercept`，1 passed（8.49 秒）。150,000 资产记录、4,100 空目录及 200 资产派生目录：并发冷导航 271 ms，热 p50 0 ms / p95 1 ms，最大事件循环间隙 33 ms；阶段 all-count 12.95 ms、资产投影 212.67 ms、链接目录 33.78 ms。该夹具不含 15 万份真实媒体；媒体解码由独立 Worker 与 Electron 测试证明。数值取当次样本，不作为所有磁盘的硬承诺。

## 完成边界

新增验收项 `MEDIA-OIIO-PATH-001`、`PERF-LINKED-NAV-001`、`LINKED-EMPTY-RESTART-001`。本机 Windows 开发态的上述自动化通过；真实用户库恢复、原 JPG 空白案例、原会话 54 秒等待的同环境前后对比、真实慢盘/网络盘、macOS watcher、packaged 和人工视觉操作未验证。当前桌面控制工具不提供 native 应用操作，未执行 Computer Use；隐藏 Electron DOM/解码测试不能代替人眼验收。两张工单保持进行中，等待用户确认，不标记 accepted。


## 收尾检查

新增 Electron 旅程已登记到常规与隔离 E2E 脚本，后续不会只依赖手工定向调用。生成的 20,000 资产夹具与本次 E2E 报告目录均已在确认身份、无链接后删除；元数据基准临时目录剩余 0。未删除其他工作已有的临时目录或未跟踪文件。

`git diff --check` 通过。对所有被跟踪文本执行本机绝对路径/凭据形态扫描：原树仍有 236 条路径形态与 2 条凭据形态命中，包含旧测试/文档，需按既有隐私工单与白名单逐条审核，未把全仓隐私门禁写成通过；本次新增内容两类命中均为 0。两张新工单的创建者/负责人使用通用 agent 标识，公开项目 URL 属于项目引用。没有重写历史。
