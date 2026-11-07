# 开发态 Renderer 启动失败：开发与 QA 记录（2026-11-06）

工单 `Serpent-9d72f7`，验收项 `DEV-START-001`。用户的开发窗口弹出“Renderer remained blank after dev load retries”。这不是资源库 Worker 无法启动：当次日志显示 Worker 已就绪、最近资源库已恢复，Vite URL 可加载；随后 Main 每隔 20 秒判断 `#root .app-shell` 尚未出现，就重新 `loadURL`，共四次后报错。Renderer 日志只有 Electron 的开发 CSP 提示，未记录脚本异常。

## 原因与修订

旧流程把“导航成功后 20 秒尚未挂载”当作需要重新导航，重复导航会中断正在加载的页面。去掉重载后，用户的可见窗口仍在 120 秒后报告 `root=0`，所以重载只是问题的一部分，“隐藏窗口首次绘制”不是这次故障的原因。检查当时进程与端口，没有发现旧 Serpent 或 Vite 进程；Worker 正常启动，窗口确实已显示。入口模块已被请求，但请求不等于执行。隔离隐藏实例中，Vite 首页为 200，WebSocket 握手成功，主模块的第一条语句始终未执行；依赖请求结束后，在同一页面主动导入该模块即可挂载。具体是哪一个 Chromium/Vite 首次模块求值环节中止，当前证据尚不能确定；`resources=250` 是资源计时缓冲区计数，不能据此认定只有 250 个请求。

修订后，Main 只在 `loadURL` 导航本身失败时重试；导航成功后保持同一页面等待首次挂载，预算为 120 秒。若 20 秒仍无应用根节点，在同一页面对入口模块补发一次动态导入，不重新加载页面。开发窗口在导航完成时按既有可见性策略显示；明确要求隐藏的 E2E 窗口仍保持隐藏。第二次启动只唤回已有窗口，不重新导航。控制台诊断改用当前 Electron 事件字段，避免遗漏错误。若仍超时，日志记录文档、根节点、资源计时与 Vite 错误浮层状态。

## 四列追溯

| 需求 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 冷启动超过 20 秒仍保持单次导航 | `src/main/dev-renderer-load.ts` | `tests/unit/dev-renderer-load.test.ts` 的虚拟时钟 40 秒挂载用例 | 用户截图与原实例日志证明旧流程失败；新可见开发窗口未进行前台验收 |
| 初始入口未执行时在原页面补发一次导入 | `src/main/dev-renderer-load.ts` | 同文件 20 秒补发与只补发一次断言 | 隔离隐藏 `npm start` 复现入口未执行；补发后根节点挂载；真实可见窗口待用户复验 |
| 导航失败可重试，服务不可达直接报错 | `src/main/dev-renderer-load.ts` | 同文件导航失败与服务不可达用例 | 隔离隐藏开发实例可启动 Vite；真实网络失败未进行 Electron 实测 |
| 首次导航后显示窗口；第二次启动不重载 | `src/main/index.ts` | `onNavigated` 回调在单元测试中被调用；既有 `tests/e2e/process-lifecycle.test.ts` 为第二实例旅程 | 前台 Computer Use 按用户此前选择未执行；该可见窗口路径仍待人类复验 |

## 当次验证与边界

- `npx vitest run tests/unit/dev-renderer-load.test.ts tests/unit/renderer-diagnostics.test.ts`：2 files，5 tests passed。
- `npm run typecheck`：退出码 0；定向 ESLint：0 errors。
- 隔离隐藏 `npm start`：不补发导入时复现初始入口未执行、`root=0`；手动在同一页面动态导入入口后出现 `mount-verified`。集成补发逻辑后，独立后台实例同样出现 `entry-retry` 和 `mount-verified`，没有页面重载。
- 独立 Vite 服务加 Playwright 附着的隐藏 Electron，在普通与离屏配置下均出现应用根节点；强制重新优化依赖后也能挂载。这验证模块可执行，但不覆盖未附着的可见开发启动。
- 用户最新截图的真实可见窗口仍失败；修订后的真实可见窗口未启动观察，未跑完整 E2E、Worker 或资源库可用性套件；本次只改开发态 Main 窗口加载流程。`DEV-START-001` 维持人类验收不通过，等待用户在当前源码执行 `npm start` 复验。

## 2026-11-07：启动失败的直接错误与恢复

用户再次报告 `npm start` 黑屏。隔离隐藏开发实例中，Chromium 网络诊断捕获到入口模块依赖的多条 `net::ERR_NETWORK_CHANGED`，而同一时刻 Vite 对这些模块仍返回 HTTP 200。失败后的同一文档不会重新执行静态入口；20 秒后的动态导入也失败。强制重建 Vite 依赖缓存、切换到固定 IPv4 环回地址都未消除该错误，因此不能把它归因于缓存或 `localhost` 解析。重启电脑曾让用户暂时恢复，但这里没有证据能确定是哪一个系统网络组件发起切换。

Main 现在只在开发服务器的脚本请求确实报 `net::ERR_NETWORK_CHANGED` 时重建页面，最多四次；普通冷加载仍保持单次导航。隔离隐藏实例分别在启用诊断和移除诊断后复现网络错误，均于第二次或第三次导航挂载。真实可见窗口与用户的长期运行环境仍待复验，工单和 `DEV-START-001` 保持未验收。

当次命令与结果：`npx vitest run tests/unit/dev-renderer-load.test.ts tests/unit/renderer-diagnostics.test.ts` 为 6 tests passed；`npm run typecheck` 通过；定向 ESLint 0 errors。隔离隐藏 `npm start` 的日志包含 `main.window.network-retry` 和 `main.window.mount-verified`。临时 Chromium 诊断已从最终代码移除。

2026-11-07 用户复测当前开发态启动后确认「没有问题」，`DEV-START-001` 更新为人类验收通过。
