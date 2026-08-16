# 2026-08-16 `dw9a` / `768x` / `cljb` QA 报告

## 范围

本报告覆盖数据库损坏恢复与行级可见性、Eagle 外部资源库打开/导入与根目录浏览、视频 source-first 与按需 proxy 回退。恢复报告摘要/打开入口和已知位置候选探测已补齐；真实损坏库完整退出重启、Windows/packaged 和真实 Eagle 小库仍是未执行项。

## 自动化结果

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | 通过；仅有超大 `library-service.ts` 的 Babel deopt 提示 |
| `npm run typecheck` | 通过；主工程与 extension 类型检查均通过 |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/navigation-sidebar.test.ts tests/unit/proxy-fallback.test.ts tests/unit/proxy-playback-notice.test.ts tests/unit/protocol.test.ts tests/worker/database-recovery.test.ts tests/worker/eagle-open.test.ts` | 6 files passed、99 passed；包含导航层级/根节点、fallback 生命周期、恢复协议/Worker 和 Eagle 转换覆盖 |
| `node scripts/run-e2e.mjs tests/e2e/asset-pagination.test.ts tests/e2e/context-menu.test.ts tests/e2e/folder-recursive-scope.test.ts tests/e2e/media-preview.test.ts tests/e2e/media-video-playback.test.ts tests/e2e/organization-metadata-persistence.test.ts tests/e2e/organization-search-trash.test.ts tests/e2e/plugin-standard-host-activation.test.ts tests/e2e/shell-navigation.test.ts` | 27 passed、1 skipped |
| `node scripts/run-e2e.mjs tests/e2e/browsing-preferences.test.ts tests/e2e/library-recent.test.ts` | 6 passed；用于确认瀑布流边界修正与全量长跑下的切库竞态复验 |
| 最终提示断言回归：5 个相关单元/Worker 文件 + `node scripts/run-e2e.mjs tests/e2e/media-video-playback.test.ts` | 143 passed；视频 E2E 1 passed；精确弱提示及隐藏/恢复交互通过 |
| `npm run pretest:worker && node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/protocol.test.ts tests/worker/database-recovery.test.ts` | 2 files passed、93 passed；恢复报告摘要、Main/Worker 边界协议和已知位置指纹候选通过 |
| `npm run verify:mainline` | 通过：单元/Worker 421 files passed、9 skipped，3709 passed、16 skipped；搜索性能 5/5；Electron E2E 80 passed、3 skipped、0 failed（4.3m） |
| `node scripts/run-e2e.mjs tests/e2e/trash-relink-flow.test.ts tests/e2e/linked-folders.test.ts`（Inspector 候选探测后的启动回归复跑） | 4 passed（11.9s）；覆盖无库首帧、链接库重启恢复和批量重新定位 |
| `node scripts/run-e2e.mjs tests/e2e/media-video-playback.test.ts tests/e2e/trash-relink-flow.test.ts tests/e2e/linked-folders.test.ts`（fallback 生命周期与 Inspector 恢复入口） | 5 passed（21.1s）；覆盖视频 source→MediaError→proxy、提示隐藏/恢复、旧 fallback 运行失效，以及 Inspector 找不到已知位置后的恢复入口 |

## 结果判定

- `cljb`：自动化覆盖了 source-first、无默认 proxy、实际媒体错误后单项 fallback、ready proxy 复用、失败不无限重试，以及提示隐藏/恢复。
- `768x`：自动化覆盖 Eagle 根文件、嵌套组织、源目录不变、二级菜单和根节点；真实 Eagle 小库一次性验证因本机没有真实库未执行。
- `dw9a`：自动化覆盖 backup-1/只读/Assets 抢救、两份轮换、24 小时节流、悬空 revision 可见和重建、同名内容指纹重定位、恢复报告摘要/打开协议和已知位置候选探测；Inspector 首帧空白回归已定位为 null 探测状态访问并修复，相关 4 项 Electron E2E 通过；真实破坏库重启与 packaged/Windows 未执行，未知外部位置仍需用户选根目录。

## 独立代码审查

2026-08-16 使用 `gpt-5.6-luna` 对当前工作树完成一次独立 Standards + Spec 审查，详见[独立审查报告](../reviews/2026-08-16-dw9a-768x-cljb-code-review.md)。已修复审查指出的开发日志过期行号和视频 fallback 轮询生命周期问题；新增 guard 单测与多层导航树单测，并在 Inspector 相关 Electron E2E 中补充“已知位置无候选时要求选择恢复位置”的 UI 断言。审查保留的真实 Eagle、物理损坏重启、packaged/Windows 和真实不支持编码证据仍未执行，故不将工单写为平台全面通过。

## Computer Use / 平台证据

当前 macOS 开发态 Electron 已检查：资源库菜单可到达 Eagle 二级项；虚拟根节点可选中并显示根目录文件；MP4 查看器使用原始 source URL。未将旧 packaged 应用或临时 Eagle fixture 作为当前 HEAD 的 packaged/真实 Eagle 证据。

## 保留项

工单暂不标记为最终关闭：真实 Eagle 小库/Windows 或 packaged 证据，以及真实物理损坏完整退出重启和真实不支持编码证据仍缺失；独立双轴审查已完成。
