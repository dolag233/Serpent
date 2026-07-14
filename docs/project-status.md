# Serpent 项目状态

> 更新时间：2026-07-14
> 事实来源：`docs/implementation/mvp-roadmap.md` 与各切片开发/审查/QA 文档

## 当前方向

v0.1.0 先收口 0001–0010 的桌面 MVP 主线。0011 CLI 需求已确认并排入 v0.2.0，不代表桌面客户端优先级更高，只表达领域语义与运行时基础的实施依赖。0012 资产画布与卡片信息配置已在 macOS 完成自动化、双轴审查和 Computer Use 验收（Windows/10 万帧率保留条件）。0013 查看器与 0014 选择/上下文操作属于 v0.1.0 UX 收尾；其中查看错位和右键菜单无法关闭按核心 P0 缺陷先修。

## 当前前沿

1. **P0 发布阻断**：0006 不可变媒体二进制发布来源与 receipt、packaged media playback；
   建立真实 Windows runner 并执行跨平台矩阵。
2. **P1 验证收口**：0012 已完成 macOS Computer Use 与截图验收；继续按当前树修复 0004/0007
   复审发现的真实行为缺陷，并补重启、冲突、公共 E2E、packaged 和人工证据；
   再完成 0005 packaged 搜索冒烟。
4. **P2 外部旅程**：补 0009 范围分析/清空 UI 与密钥边界决定；完成 0008 真实浏览器扩展
   往返和 0010 大库/跨平台往返。
5. **最终完成审计**：跨资源库复制、视频/GIF 悬停预览、NAS 断线只读、10 万资产冷启动
   3 秒，以及跨切片 packaged/Windows 主线。
6. 0013/0014 完整 UX 实施前先做竞品研究与交互原型；已报告的查看错位与右键菜单关闭缺陷不等待完整原型。

## 2026-07-14 0012 实施与门禁

- 版本化画布偏好模块 `src/renderer/canvas-preferences.ts`（Zod 校验、遗留 key 迁移、存储可注入）+ App.tsx 集成（统一 state、3 字段开关 `文件名`/`文件大小`/`修改日期`、条件化 aria-label、条件化 caption）。
- 最终 `verify:mainline` 全绿：lint/typecheck/extension、798 passed + 1 skipped、search perf 4/4、Electron E2E 20/20。
- 双轴审查完成、阻断项已修（descriptor 数组、PREF_KEY import、实际卡片宽度断言、tag/collection scope）。
- **有条件通过**：macOS Computer Use 与截图门禁完成，发现并修复空 caption、工具栏逐字换行和窄窗设置裁剪；Windows 与 10 万资产帧率未验证。
- `process-lifecycle` 已用 fresh E2E profile 隔离；不存在 recent 路径的完整重启回归约 0.8 秒回到起始页，未复现交接文档推断的生产挂起。
- 详见 `docs/development/0012-asset-canvas-views-and-card-display-development-log.md`、`docs/reviews/0012-asset-canvas-views-and-card-display-code-review.md`、`docs/qa/0012-asset-canvas-views-and-card-display-qa-report.md`、`docs/implementation/0012-design-decisions-2026-07-14.md`。

## 状态校准（2026-07-14）

- 0003 的可编辑规则、复制与 linked→managed 已有实现/测试；主要剩余规格偏差与平台证据。
- 0004 已完成字段清空、输入校验、串行乐观锁、批量/递归一致性、完整重启与竞争写入 E2E，并完成 macOS Computer Use；packaged 与 Windows QA 保留条件。
- 最终主线门禁为 810 passed + 1 skipped、搜索性能 4/4、Electron E2E 22/22；E2E 默认 profile 已隔离，完整重启/单实例用例仅共享显式传入的临时 profile。
- 0005 自动化与 10 万资产热查询性能门禁已通过，剩余以 packaged/人工/Windows 证据为主。
- 0006 的本地真实队列、source/proxy 播放、Computer Use 和最终 mainline 已通过；发布仍被
  二进制来源、packaged playback 与 Windows 阻断。
- 0007 已扩展恢复位置、三种冲突策略、多选恢复和 `keepMetadata=false`；需按当前树复审。
- 0009 已存在有界缩略图输入、并发限制、进度事件和任务控制 UI；真实功能缺口集中在按范围
  分析/清空入口与密钥边界决定。

## 2026-07-14 已记录的查看页面 UX 缺口

- 图片、视频及其他支持查看的资产首次打开应完整显示并尽可能撑满查看区域，不能裁剪或变形。
- 移除常驻底部缩放条；重新设计敷衍的顶部工具栏，优先探索无栏沉浸画布和左上角轻量“返回”。
- 查看页面的退出语义是“返回资产浏览”，不是“关闭”；Esc 与返回入口结果一致。
- 提高 macOS 触控板 pinch 灵敏度，统一缩放焦点，并实现成熟、低冲突的平移交互。
- 在查看页面切换文件夹、合集、标签等资产范围时，必须先返回资产浏览页面。
- 详细范围与验收条件见 `docs/implementation/0013-asset-viewer-navigation-and-gestures-vertical-slice.md`；本轮不修改生产代码。

## 2026-07-14 已记录的选择与右键菜单 UX 缺口

- 资产画布增加框选；统一 Windows Ctrl / Shift 与 macOS Command / Shift 的增选、范围选择和取消选择语义。
- 移除遮挡画布的顶部多选操作条，把单项/批量动作统一到右键菜单。
- 右键菜单需要统一视觉与定位，并在外点、Esc、滚动、resize 和窗口失焦时可靠消失。
- 详细范围与验收条件见 `docs/implementation/0014-asset-selection-and-context-actions-vertical-slice.md`。

## 2026-07-13 浏览与恢复收口

- 缩略图等比显示；支持媒体缺少预览时自动生成；查看页面不被生成任务阻塞。
- 客户端查看嵌入中央，支持前后切换、统一缩放和视频原生控制。
- 浏览区无分页，平铺/瀑布流连续加载；卡片尺寸可调并保留视觉锚点。
- 瀑布流顶部负溢出裁剪已修复，首尾可达加入 E2E。
- Main 保存最近资源库路径，Renderer 保存不含绝对路径的浏览范围/资产身份；完整进程重启后自动恢复与聚焦。
- 通知 5 秒、错误 10 秒自动关闭；完整诊断仍保留在持久日志。

## 仍未宣称完成

Windows 未进行真实平台 QA；0006 的首发视频格式、FFmpeg/OIIO 随包分发和 packaged-app 媒体主线仍需验证。任何“已实现”不等同于满足项目完成定义。
