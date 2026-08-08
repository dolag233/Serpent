# Serpent 项目状态

> 更新时间：2026-08-06
> 事实来源：`docs/internal/implementation/mvp-roadmap.md` 与各切片开发/审查/QA 文档

- **2026-08-06 新增 UI 反馈修复**：拖拽导入提示使用主题画布色 50% 半透明背景，保留虚线边框、
  图标和文字并让底下资产保持可见；3D 查看器 HDRI 当前值控件已统一为与「显示模式」相同的
  下拉控件样式，并将选择器锚定到环境光控件右侧，避免左对齐导致与其他 toolbar 控件重叠。
  `Serpent-h2uj` 已获用户确认通过；`Serpent-osbd` 待用户视觉验收。
- **2026-08-06 3D 模型缩略图**：`Serpent-pjx2` 的离屏帧 IPC 载荷解析根因已修复；
  隔离 userData 的真实 Electron 缩略图格式矩阵通过（OBJ/MTL、glTF + `.bin` companion、
  GLB、STL、FBX 共 5/5），每项证明卡片图片实际解码。另修复 glTF 内嵌 `data:` buffer
  被 Renderer/offscreen CSP 拦截的问题。`MODEL-001` 已加入待人类验收；Computer Use、
  packaged 与 Windows 尚未执行。
- **2026-08-06 3D 光照、Info 与 HDRI 手势收口**：离屏缩略图生产路径已恢复默认内置
  HDRI 环境光，失败时保留 key-light 降级；查看器非阻塞提示统一为共享 `Notice tone="info"`；
  HDRI 旋转支持右键拖拽和 Ctrl+左键拖拽（macOS 触控板/Windows 鼠标）；选择器预览扩大到
  `144×82px`，名称改用较小 caption 并限制占宽。`MODEL-001`、`MODEL-003`、`MODEL-004`
  已同步验收步骤；真实 Computer Use、packaged、Windows 尚未执行。
- **2026-08-06 PBR 贴图通道预览**：认领 `Serpent-61je.2`，新增基于文件名的只读
  PBR 通道识别与显示策略。Base Color/Normal 保持原始颜色语义，Roughness/Metallic/
  Height 使用中性灰度，Smoothness 使用反转灰度，Metallic-Roughness 打包贴图保留
  RGB，并在图像查看器显示 Info 说明。单测 `1 file / 9 passed`、typecheck 和 PBR
  Electron E2E `1 passed (4.4s)` 已通过；测试 fixture 使用不同像素值避免真实内容重复
  对话框阻断矩阵导入；Computer Use、packaged、Windows 尚未执行。
- **2026-08-06 Info 通知布局**：新增 `Serpent-91pn`，定位为通知栈固定 `520px` 宽导致
  短消息右侧保留大段空白；现改为内容自适应宽度并保留最大宽度上限。`NOTIFY-002` 已加入
  待人类验收；既有 `organization-search-trash.test.ts` 完整回归 `4 passed`，本次窄窗
  内容宽度断言定向回归 `1 passed`。窄窗口下通知条目改为按内容收缩，避免
  `min-width: 280px` 与 `width: 100%` 子项将通知栈撑到 viewport 上限；用户视觉验收仍待执行。
- **2026-08-06 上下文菜单 pointer/portal 回归**：修复菜单项仅依赖 `mouseenter` 时
  pointer hover 后焦点未落地的问题；一级菜单改为布局阶段同步提交定位，避免首帧仍在
  `-9999px`；二级菜单使用同步打开状态幂等化 focus/click/hover，避免标签选择器 portal
  短暂隐藏并把点击落到资产网格。`context-menu.test.ts` 完整回归 `10 passed`，
  `organization-search-trash.test.ts` `4 passed`，相关偏好/元数据路径定向通过。
- **2026-08-06 最新主线复跑**：`npm run verify:mainline` 通过：单元/Worker
  `352 files passed / 3076 tests passed`、搜索性能 `5 passed`、主线 Electron E2E
  `72 passed / 3 skipped`；当前 HEAD 的 lint、typecheck、extension verify 均通过。
- **2026-08-06 当前 HEAD 打包阻断**：`npm run package` 在 `prepackage` 的
  `media:verify` 阶段停止；macOS arm64 媒体 bundle 尚未有可验证的不可变 HTTPS 来源和
  SHA-256/manifest SHA-256 pin。该阻断属于发布制品供应链，未用旧包或跳过 provenance 伪造
  packaged 证据；Computer Use、packaged 与 Windows 仍未执行。
- **2026-08-06 HDRI 选择器**：`Serpent-pd6k` 已完成当前值仅显示环境光名称、选择器显示
  更大内置预设缩略图并移除「自定义」入口；旧 `custom` 持久化值回退默认预设。
  `model-viewer` 真实 Electron E2E 3/3 通过，包含四张预设缩略图实际解码与尺寸断言。
  `MODEL-002` 已加入待人类验收；Computer Use、packaged 与 Windows 尚未执行。
- **2026-08-06 HDRI 右键旋转**：`Serpent-xjcy` 的现有实现已核对，右键 pointer 横向拖拽通过
  `environmentYaw` 更新 `scene.environmentRotation.y`，并保留中键相机操作；场景 composer
  单测通过。`MODEL-003` 已加入待人类验收，Computer Use、packaged 与 Windows 尚未执行。
- **2026-08-06 通知堆叠**：`Serpent-0k52` 已将通知控制器从单值优先级通道改为带独立
  生命周期的通知栈；Renderer 在同一 portal 中垂直排列通知，并支持逐条关闭。
  `NOTIFY-001` 已加入待人类验收；`npm run typecheck && npm run lint &&
  npm run test:unit -- tests/unit/toast-notifications.test.ts` 通过（unit 304 文件、
  2257 passed、1 skipped）；Computer Use、packaged 与 Windows 尚未执行。
- **2026-08-06 文件名显示**：`Serpent-kmgw` 修复卡片普通文件名路径中内联 span
  阻止中间省略的根因；长文件名卡片与 Inspector 的定向 Electron E2E `1 passed`，
  `TITLE-001` 已加入待人类验收。Computer Use、packaged 与 Windows 尚未执行。
- **2026-08-06 格式过滤预设**：`Serpent-1d4w` 已确认实现从图像、视频、音频和
  3D 格式注册表派生 chip，并保留文本 token；注册表覆盖单测 `1 file, 4 passed`，
  typecheck/lint 通过。`FILTER-001` 已从历史不通过转为待人类验收；Computer Use、
  packaged 与 Windows 尚未执行。
- **2026-08-06 主题色设置折叠**：`Serpent-siwm` 移除 `ThemeColorSettings` 的
  `defaultOpen`，恢复通用设置折叠默认值；`SETTINGS-004` 已加入待人类验收，并补充
  macOS 设置 E2E 的展开/收起断言。Computer Use、packaged 与 Windows 尚未执行。
- **2026-08-06 macOS Dock 图标**：`Serpent-o71z` 已定位为 `app.dock.setIcon()`
  直接读取贴边的 `app.png`；Electron runtime 无法将 `app.icns` 解码为
  `nativeImage`。现生成带安全边距的 `app-dock.png`，macOS 运行态优先读取该 PNG，
  `.icns` 仍供 packager 使用。路径单测、资源生成、typecheck/lint 已通过；
  `PLATFORM-001` 已加入待人类验收。Computer Use、当前 HEAD packaged 构建与 Windows
  尚未执行。
- **2026-08-06 主线回归收口**：`Serpent-32p` 补齐 Masonry 原始滚动回放对用户主动滚动
  的取消，并将回收站/元数据/文件夹定位回归纳入当前工作树复测。该修复已包含在当前
  `npm run verify:mainline` 证据中；`CANVAS-021` 仍待用户拖拽与滚动验收，packaged
  与 Windows 未执行。

- **2026-08-04 Renderer 诊断**：`Serpent-lyf8` 已补齐开发态与 packaged 的 Renderer
  `console-message` error、`render-process-gone`、`unresponsive`/`responsive` 以及
  App child-process 退出日志；定向单测、lint、typecheck 通过。真实崩溃、GPU、Windows
  packaged 与 Computer Use 仍待执行。
- **2026-08-04 扩展导入契约**：`Serpent-u9yv` 已将扩展 URL 保存与浏览器上传统一接入
  `prepareOrExecuteImport` 导入内核，URL 下载安全校验仍保留在扩展边界；定向 Worker
  测试 55/55、lint、typecheck 通过，EXT-002 真实扩展和 packaged/Windows 复验仍待执行。
- **2026-08-04 对话框快捷键审计**：`Serpent-xdmu` 补齐序列帧导入/设置弹窗的全局
  Escape 栈和导入弹窗焦点陷阱；定向单测 16/16、lint、typecheck 通过，全部模态层的
  Enter/Esc 仍待真实窗口人类验收。

## 2026-07-27 画布精确锚点与序列图

- `Serpent-32p` 的侧栏/窗口重排锚点已按用户硬性要求收口：拖动中冻结重排，松手后以拖动前同一资产内部点为锚，连续两帧稳定后结束补偿；macOS 冷启动真实源码实例双向拖动均保持 `clientY=125`，提交 `2fa3cd5`。
- `Serpent-j8dl` 序列图形成待验候选：单文件/文件夹/链接目录自动识别连续编号图片，缺口拆段且至少三帧；支持解散、手动创建和 1–240 FPS；卡片/Inspector/查看页提供逐帧预览与播放；SQLite schema v23 持久化资产组关系。详见 [`0022 规格`](implementation/0022-image-sequences-and-viewer-transforms.md)。
- 图片、视频和序列查看页新增仅影响显示的顺时针 90°、水平镜像、垂直镜像。相关 89 项定向单元/Worker 测试及 1 条生产式 file:// Electron E2E 通过；IMAGESEQ-001/002 与 VIEWER-024 已进入待人类验收。Windows、packaged 与完整主线仍未验证。
- 2026-08-02 `Serpent-ls2p` 继续收口查看器交互：旋转入口已移入图片/视频/序列底部 toolbar；新增与资产菜单同款的图片/视频/序列右键操作菜单（旋转、双向镜像、适应窗口、全屏），并保留轻微透明模糊。定向类型、lint 和 5 项变换动作单测通过；`VIEWER-026` 待 Windows/macOS 人工视觉验收。

## 2026-07-25 产品待办入池与工单卫生

- 产品负责人新增待办：**ignore**（`Serpent-v6m3`）已完成实现，支持托管/链接文件、文件夹和后缀的持久化忽略、扫描/浏览/搜索过滤、显示隐藏切换、资源库设置及恢复入口；资源库级规则已迁移为可编辑 `.serpentignore`（兼容常用 Git 忽略语法，迁移 v26），当前待人类验收；文件夹级删除回归反馈记录为 `Serpent-nplj`。
- **常用媒体格式**（`Serpent-aav1`）正在实现；Windows 本地 bundle、真实 Worker 解码/代理矩阵和开发态 Electron 媒体预览证据已有，但 Windows/macOS 打包应用查看/播放与人工验收尚未执行，不能标记完成。
- 2026-07-26 媒体验收补充：用户已明确验收通过 SVG、TIFF、TGA、EXR、ARAW（按用户原文）和 PSD；后续需求已拆为 `Serpent-aoj0`（EXR 多通道 + 色彩空间读取/选择，P2）与 `Serpent-oc6g`（RGBA 单通道/组合查看器，P3）。
- **浏览器扩展拖拽树状保存菜单**（`Serpent-c0ml` / REQ-EXT-005）：圆环 Hotbox 已替换为思维导图双栏（v7）；**EXT-010 待人类验收**。原 EXT-009（径向）已撤回。
- 工单卫生：关闭 14 条僵尸 open（实现已完成、验收已通过或已被新工单取代）；重建 `Serpent-ak94`（EXT-003）、`Serpent-u9yv`（EXT-002）。agent 查队列见 `docs/internal/agent-work-queue.md`。
- **Inspector AI 刷新**（`Serpent-c9r3` / REQ-INSPECT-006）：清除或生成 AI 信息后右侧信息栏须立即更新，未实现。
- **2026-07-25 晚**：工具栏后台任务直出（`9gt2`）、浏览总数量/全选全部+重数据懒加载（`6w7n` P1）、type-ahead 跳转（`lfo1` P3）、视频倍速样式（`gplm`）、全屏隐藏光标（`c3lf`）。见 backlog「2026-07-25 补充」。
- **2026-07-25 快捷键与 Inspector**：筛选后快捷键收口 epic（`Serpent-x78x` / REQ-COMMAND-004）；视频 D/F 逐帧、小键盘 `.` 适应窗口 + X/C 倍速档（`Serpent-soii`）；**全局音量 P1**（`Serpent-8w6x` / REQ-VIEW-017）；Windows 文案「在文件浏览器中显示」（`Serpent-a74i`）；AI 描述 textarea（`Serpent-vo24`）。原则文档 [`docs/internal/ui/0003-keyboard-shortcut-ux-principles.md`](ui/0003-keyboard-shortcut-ux-principles.md)。均未实现。
- **2026-08-01 最新验收反馈**：合集创建输入焦点偶发失效为 P0（`Serpent-to9y`）；合集 F2/Delete 与非空删除确认（`Serpent-b7uy`）；硬盘删除确认/Shift+Delete 回归（`Serpent-wuma`）；瀑布流 Tab 单选与 Shift 连续选择（`Serpent-xzmz`）；文件夹卡片圆角（`Serpent-kttg`）、标签 hover 二级定位（`Serpent-hn9u`）和通知按钮视觉（`Serpent-agyz`）已完成代码收口。合集资产跳转来源文件夹（`Serpent-udj5`）按用户要求暂记后续；本轮硬盘删除、媒体句柄释放与瀑布流恢复已获用户验收，通知撤销入口继续收口为无边框回撤图标。
- **2026-08-01 复验结果**：合集创建焦点、合集删除语义、合集 inline 重命名、文件夹卡片圆角、标签 hover 基础行为、合集递归、submenu 生命周期、Windows 硬盘删除与删除前释放媒体句柄、瀑布流原布局恢复、删除通知无边框回撤图标与恢复后刷新均已通过用户验收。
- **2026-08-01 Windows 主菜单**：Windows 隐藏原生 menu bar 后，原设置入口已替换为点击打开的主菜单；菜单项拆分为文件、编辑、资源库、窗口、关于、设置。二级菜单默认不展开并以浮动面板呈现，设置直接打开原设置中心，窗口承载后台任务/诊断日志；关于拆分为独立的「关于 Serpent」产品信息对话框与「开源组件与许可」依赖说明对话框，前者提供 GitHub、版本信息。macOS 原生 menu bar 与齿轮入口保持不变。定向单测、typecheck、lint 与壳层 E2E 已通过，Windows 主菜单相关路径已由用户验收通过（`Serpent-yne1`，2026-08-02）。

## 2026-07-18 MVP 循环前沿

- 当日已合流多批可编码增量（查看页直出/视频控件、作者元数据、空态文案、命令注册表、合集菜单成员过滤、智能合集校验与计数、侧栏省略、搜索 snippet 去重、递归来源角标、壳层对齐、GIF 控件与元数据、Option 拖拽复制光标等）；证据与验收 ID 见 `docs/internal/qa/human-acceptance-checklist.md`。
- **2026-07-18 晚验收**：FILTER-013/014、SEARCH-005、NAV-005、SHELL-015/016、META-008、PALETTE-002 人类验收通过；SHELL-017、FILTER-015、VIEW-007 不通过/布局反馈。第五批反馈已入池并开单（`mvp-fifth-batch` 标签）：过滤交互重做、排序去相关性、画布 resize 重排、查看返回保视图等，见 `docs/internal/implementation/mvp-ui-ux-requirements-backlog.md`「2026-07-18 第五批」。
- **澄清队列**：`Serpent-w3b` 已于 2026-07-19 全部裁决或撤回（详见 backlog「集中澄清队列」）。跟进实现：`Serpent-toh`（目录计数全后代）、`Serpent-mqp`（标签管理工作区）、`Serpent-svc`（主题/语言默认跟系统，已实现待验 THEME-017）、`Serpent-5fq`（反选 Ctrl+I / mac Edit 后续）；复制粘贴走系统剪贴板（`Serpent-vgp`/`w29` 已解阻塞）；删除语义 `Serpent-ekj`/`9zc`/`5no`。
- **人类验收**：清单中「待人类验收」项以 `docs/internal/qa/human-acceptance-checklist.md` 为准；状态只能由用户本人改写。2026-07-21 新增待验：FOLDER-015（`Serpent-koy` 混合选中共通删除）、VIEWER-020（`Serpent-noz` 查看页 <>/x 自动对比）。
- **2026-07-19 晚间反馈**（已入需求池与 beads，未实现）：查看页视频逐帧/`Ctrl±2s`（`Serpent-sk1`）、视频缩放（`190`）、滚轮指针缩放（`yo0n`）、切图 mip 式加载（`eh07`）、去掉「安全预览」文案（`dl23`）、亮色面包屑 hover（`xwi1`）、无库态可选已有库（`y0au`）；SVG 原图矢量查看已在本轮接入，并由用户验收通过（2026-07-26）。详见 `mvp-ui-ux-requirements-backlog.md`「2026-07-19 晚间反馈」。
- **2026-07-20 AI 配置/反馈**：BYOK 自定义端点 + F1–F7（眼睛图标、token 按钮、AI 角标、编辑转人工、右键清 AI、任务进度条、自动连接状态）已实现/收尾；待人类验收 AICFG-002–005、INSPECT-AI-001、MENU-AI-001、JOBS-001。F8 设计讨论待用户（`Serpent-1us6`）。
- **2026-07-21 媒体恢复**：MEDIA-003 已在 Worker 实现历史 `FFMPEG_REQUIRED` /
  `OIIO_REQUIRED` 预览的组件探测、自动重新入队和单会话防循环；定向媒体回归
  37/37、缩略图队列回归 38/38；已补充媒体自动修复 Electron E2E，但当前
  Windows Electron 启动参数阻断，Windows 真实 Electron/用户验收仍待执行。
- **2026-07-21 Windows 无边框壳**：产品要求去掉系统标题栏与菜单栏，顶栏右上角自绘窗口控件（`Serpent-znex` / SHELL-024）；已实现，待 Windows 人类验收。既有 Windows 工单（`j5x`/`bwb`/`itr`/`omn`/`6k1`/`2vn`/`d8u`）仍排队，本回合优先 znex。

## 当前方向

v0.1.0 继续收口 0001–0010 的桌面主线，并纳入真实使用反馈确认的 0013–0019 产品化范围。0011 CLI 仍排入 v0.2.0，这只表达领域语义与运行时依赖。0012 已完成 macOS 开发态验收；0014 形成候选 `f1330a7`，但新反馈确认 Inspector、框选修饰键、瀑布流、完整文件菜单、应用壳、目录浏览、标签、双语和主题仍属于 MVP 待办。

## 当前前沿

1. **P0 发布阻断**：0006 不可变媒体二进制发布来源与 receipt、packaged media playback；
   建立真实 Windows runner 并执行跨平台矩阵。
2. **P0 产品正确性**：0018 Label 退役及 0019 Inspector、框选、瀑布流、clock 图标和菜单输入模式已形成实现提交 `5b8b8fe`；真实 Electron E2E、Computer Use 与双轴审查已完成。用户已验收 Inspector 标签、瀑布流横向优先以及等比无框轻圆角预览；最新资产身份区居中布局待其查看。
3. **P1 MVP 产品化**：0016-A 资源库菜单、可点击面包屑、历史导航和普通/链接统一树已落地（SHELL-004、NAV-001–003 待人类验收）；壳层装饰清理与菜单分组/快捷键显示已由用户验收。下一步完成 0015 命令注册表/本地化/主题、0017 文件夹与文件操作、0018 批量标签过滤。详细同步见 `docs/internal/development/0015-0016-progress-sync.md`。
4. **P1 验证收口**：0012 已完成 macOS Computer Use 与截图验收；0007 的 relink v3 已关闭已知文件所有权风险，仍需真实 UtilityProcess kill/restart、macOS Computer Use 与 Windows；0004 待按当前树复审修复真实行为缺陷，并补打包后与 Windows 证据；
   再完成 0005 packaged 搜索冒烟。
5. **P2 外部旅程**：补 0009 范围分析/清空 UI 与密钥边界决定；完成 0008 真实浏览器扩展
   往返和 0010 大库/跨平台往返。
6. **最终完成审计**：跨资源库复制、视频/GIF 悬停预览、NAS 断线只读、10 万资产冷启动
   3 秒，以及跨切片 packaged/Windows 主线。

## 2026-07-19 Windows 开发态交互审计

- 在 `codex/windows-adaptation` 当前源码上以隔离 userData/临时资源库运行真实 Windows Electron；启动 smoke 通过，基础 Ctrl/Shift/Ctrl+Shift 选择、框选、F2 原地重命名、Explorer 右键文案、普通拖动移动、查看切图/返回与切范围退出已获得 Windows 实机证据。完整矩阵见 `docs/internal/qa/2026-07-19-windows-interaction-audit.md`。
- 用户点名并实机确认三项 P1：平铺 caption 高度模型错误导致 13/13 缩略图横向留白（`Serpent-omn`）；侧栏/窗口收窄后 grid 保留旧 min-content 宽并遮挡资产、视觉锚点丢失（`Serpent-itr` / `Serpent-32p`）；图片查看普通 wheel 不缩放（`Serpent-6k1`）。
- 同轮新增 Windows 原生菜单默认英文并暴露 Reload/DevTools/网页 Zoom（`Serpent-j5x`）、原生文件对话框中英硬编码混杂（`Serpent-bwb`）、文本输入无编辑右键菜单（`Serpent-d8u`）、Alt 拖拽复制未完成且提示误写 Option（`Serpent-2vn`）。
- 这只是开发态 UI/交互审计，不代表 Windows 平台完成：125%/150% DPI、多屏、真实媒体 bundle、packaged/Squirrel、签名、升级卸载与全量 `verify:mainline` 仍未验证；P0 Windows runner 仍是发布阻断。

## 2026-07-17 第二批用户反馈排期与 Wave 1 启动

- 产品负责人第二批直接反馈已按项目规则进入需求池并排期：选中描边外扩加粗与 Shift 悬停双圈消除（REQ-SELECT-003）、目录高亮仅改背景（REQ-NAV-005）、强调色绿改蓝（REQ-THEME-004）、滑块小巧中性色（REQ-CANVAS-007）、预览图四角圆角（REQ-CANVAS-008）、AI 搜索按钮与搜索框加宽（REQ-CANVAS-006）、通知淡出（REQ-SHELL-010）、新建资源库去侧边栏/「01」（REQ-SHELL-008）、冗余装饰文案清理（REQ-SHELL-009）、文件夹复制路径/访达打开（REQ-MENU-006）、文件夹原地编辑（REQ-FOLDER-007）、回收站预览丢失（BUG-TRASH-001）、侧栏拖拽调宽（REQ-SHELL-007）、资产拖拽移动/删除（REQ-DND-001/002）、多标签+宽高比+分辨率过滤（REQ-TAG-002 解冻、REQ-FILTER-009/010）。排期表见 `docs/internal/implementation/mvp-ui-ux-requirements-backlog.md`「2026-07-17 第二批反馈排期」。
- Wave 1 状态（2026-07-17 中午更新）：workflow 因 API 配额 403 中断，**T3 回收站预览修复已完整落地并合流 `d4de957`**（根因：artifact 解析 SQL 误过滤 deleted_at；worker 四列齐，E2E/视觉待补，TRASH-004 已进待人类验收）；T1/T2/T4 实现 agent 留有大量半成品，由主 agent 顺序检视补齐后合流，不再重开 agent 集群。审查偏差如实记录在 `docs/internal/development/0015-0019-ux-feedback-wave1-development-log.md`（广度 3/6 通过 + 主 agent 深审；2 sonnet 深审 + security 广度未执行）。eslint 已忽略 `.claude/**`（agent 工作树不再被 lint 扫描）。
- Wave 1 全轨道合流完成（2026-07-17 下午）：T1 视觉修饰包 `f93f9f4`（9 REQ：选中外扩环+Shift 双圈根因、目录高亮仅背景、蓝色强调色 color-mix 派生、小巧中性滑块、预览四角圆角、AI 按钮星芒图标+搜索框加宽、toast 淡出状态机、新建资源库去 01 侧栏、冗余英文装饰清理）、T2 文件夹菜单命令 `e257a19`（REQ-MENU-006 全链路，worker 7/7）、T4 文件夹原地编辑 `9f175ad`（REQ-FOLDER-007，删除 FolderRenameDialog/useFolderActions，CreateDialog 收编为纯资源库框）。合流门禁：typecheck/eslint 0 findings/unit 431 passed/worker scoped 88 passed。新增待人类验收 9 项：MENU-018/019、SELECT-008、NAV-004、THEME-001、CANVAS-020/011、SHELL-007/008；MENU-016/017 已注明由 MENU-019 原地流程接替。E2E 由主 agent 后台集中执行中，结果补入开发日志。
- Wave 2 全轨道落地（2026-07-17 傍晚）：T5 侧栏拖拽调宽 `0ae84f5`（REQ-SHELL-007，版本化偏好+拖拽 hook+双击重置）、T6 资产拖拽 `c9d75d1`（REQ-DND-001/002，纯决策模块+复用 move/trash 命令，顺带激活链接行「复制到链接文件夹」拖放）、T7 过滤增强 `308e5b0`（REQ-TAG-002 多标签选择器、REQ-FILTER-009 宽高比预设 ±5%、REQ-FILTER-010 新 long_edge 字段+1K/2K/4K 分桶）。全部为主 agent 顺序实现（配额约束）；门禁：typecheck/eslint 0 findings/unit 454/worker search 69 passed。新增待人类验收 6 项：SHELL-009、DND-001/002、FILTER-009/010/011。E2E 适配：4 处文件夹创建步骤改写为原地流程、6 处标签过滤步骤适配新选择器。多标签过滤冻结正式解除并交付。
- Wave 3 第一步完成（2026-07-17 晚）：真实应用 11 表面截图审查（`docs/internal/qa/evidence/wave3-ux-audit/`）+ 静态扫查。视觉确认达标：蓝色强调色、选中外扩环、预览圆角、回收站预览保留（BUG-TRASH-001 视觉确认）、原地编辑、过滤预设。本轮修复：16 个对话框装饰英文 eyebrow 全清 + 内联 hex token 化（REQ-SHELL-009 扫尾）、过滤面板超高内部滚动。待办与 7 项提案（工具栏折叠/激活过滤徽标/资产原地重命名/评分可读性/查看页胶片条/回收站打磨/通知历史）见 `docs/internal/reviews/2026-07-17-wave3-ui-ux-audit.md`，待用户拍板后入池。
- Wave 3 追加收口（2026-07-17 晚，`56685f5`）：REQ-VIEW-001 查看页类型小字移除（截图确认，VIEWER-002 待验收）、P3 回收站卡片原位置可读（资源库根目录/父目录，TRASH-005 待验收）。
- Wave 1–3 交叉审查与门禁收口（2026-07-17 晚，主 agent 执行）：5 路只读交叉审查（2 深度 Standards/Spec + 3 广度 regression/dead-code+a11y/security），0 HARD 架构违规、12 项 REQ 全部真实实现。审查抓出并已修复 3 个真 bug：多标签排除 SQL 占位符未绑定（≥2 个排除标签时查询报错）、long_edge 分辨率预设不触发防抖搜索、切换浏览范围后 long_edge 隐藏过滤残留；另删孤儿 `.eyebrow` 选择器、补 worker 回归用例。wave 遗留 E2E 测试债 3 处已适配：查看页媒体类型小字断言 2 处（REQ-VIEW-001 已删除该文案，断言改为 serpent:// scheme 证明）、旧对话框式建文件夹步骤 2 处（library-lifecycle、managed-move）。全量门禁：typecheck pass、eslint 0 findings、unit 457 passed、worker 600 passed + 1 skipped、E2E 62/62 passed。审查文档 `docs/internal/reviews/2026-07-17-wave1-3-cross-review.md`；后续项（resizer 键盘 a11y、约 110 处 hex token 债、DnD E2E 缺 spec 要求、chip 全清、旋转视频尺寸既有问题）已记录在案。待人类验收条目以清单为准，状态只能由用户本人确认。
- AGENTS.md 验收纪律新增 #12：自动化测试一律后台运行，不抢占用户前台；E2E 由主 agent 集中串行执行。
- 同步校准：NAV-001/NAV-002/MENU-015/016/017 已在需求池标记人类验收通过（用户 2026-07-17 逐项确认）。
- 第三批反馈落地（2026-07-17 晚，主 agent + 3 编码/测试 subagent 并行）：需求池新增 K 节 5 条并全部实施。① REQ-FOLDER-008/REQ-FILTER-012 文件夹递归显示与递归搜索——调查发现 worker/协议早已支持 `recursive` 布尔（WITH RECURSIVE CTE），仅需渲染层 3 处翻转（浏览/会话恢复/搜索范围），根目录范围除外；孙级深度 worker 回归 + 新 E2E `folder-recursive-scope`。② REQ-DND-003/BUG-DND-001 拖拽预览与高亮——根因为 hover 特异性（0,3,0）压过 drop-target（0,2,0）+ 行子元素 dragenter/leave 抖动；修复为特异性提升、`.nav-row > *` pointer-events 豁免、relatedTarget 守卫、链接行补高亮；`setDragImage` 自定义 96×72/0.6 透明度/圆角预览带多选徽标（新模块 asset-drag-preview.ts）。③ REQ-MENU-007 多选 Inspector 标签批量——调查发现右键菜单批量早已就绪，真缺口是 Inspector 只作用主资产；修复为决策模块 inspector-tag-target.ts + 三个回调分发 + 批量后 chip 刷新 + 「将应用于 N 项资产」提示。门禁：typecheck pass、eslint 0 findings、unit 467、worker 601+1 skipped、E2E 63/63。新增待人类验收 5 项：FOLDER-001、FILTER-012、MENU-020、DND-003、DND-004。开发日志 `docs/internal/development/0015-0019-ux-feedback-batch3-development-log.md`。后续项：worker 标签批量逐项跳过报告、Inspector 评分批量、多选菜单 reveal/copy-path。
- 0015-A/B 命令注册表基础设施（2026-07-17 晚，4 个 subagent + 主 agent 集中门禁）：REQ-COMMAND-001 从「基础设施缺口」推进为部分实现。核心注册表 `src/renderer/commands/`（平台感知快捷键、分组排序、可见性/禁用原因解析，11 单测）；资产单选右键菜单为首个消费方——12 条命令定义 + 零布局重排接入（label/shortcut/disabled/reason 按 id 查注册表，动态行原样），注册表规则与旧内联条件逐条比对无分歧，45 单测锁定。同轮补齐 REQ-MENU-007 的 worker 逐项跳过报告：tag.assign/remove 未知 assetId 逐项跳过（不再整体抛错），响应带 skipped 明细，通知「跳过 N 项（资产不存在）」。全量命令盘点（7 表面逐条清单）作为后续接入地面真源。门禁：typecheck pass、eslint 0 findings、unit 528、worker 603+1 skipped、E2E 63/63。开发日志 `docs/internal/development/0015-command-registry-foundation-development-log.md`。后续：多选菜单/文件夹菜单/工具栏接入、快捷键匹配器统一、Inspector 评分批量。基础设施增量，无新增人类验收条目。
- 0015-C 菜单表面全量接入 + 评分批量（2026-07-17 晚，两波 4 个 subagent）：多选菜单 7 条、侧栏三菜单（文件夹/合集/智能合集）11 条接入注册表，均零布局重排且与旧条件逐条无分歧；快捷键展示与事件匹配统一为 ShortcutChord + matchesShortcut（旧 asset-command-shortcuts 双份定义删除，防漂移）；REQ-MENU-007 收官——新批量命令 `asset.rating.set`（单事务只写 rating 列、逐项跳过），Inspector 星级多选批量，提示语改为「标签与评分操作将应用于 N 项资产」。门禁：typecheck pass、eslint 0 findings、unit 610、worker 608+1 skipped、E2E 63/63。新增待人类验收 1 项：MENU-021（评分批量）；并修复清单中 COMMAND-001 的失效测试链接。开发日志 `docs/internal/development/0015-command-registry-menu-adoption-development-log.md`。后续：工具栏接入、更多命令快捷键、本地化/主题（等澄清 #11）。

## 2026-07-17 0017 第三增量：托管文件夹右键菜单与真实重命名

- REQ-MENU-005 部分落地：统一目录树中托管文件夹获得共享组件右键菜单——「新建子文件夹」（落在被右键文件夹下）与「重命名…」（folder.rename 全链路：物理目录 rename + 后代文件夹/子树资产路径前缀事务重写 + 未删除资产 FTS 同步 + 失败回滚；冲突 FOLDER_NAME_CONFLICT 与非法名 INVALID_FOLDER_NAME 类型化拒绝，纯大小写改名可行；回收站恢复经 trashed_from_folder_id 落回新目录）。复制/粘贴/克隆/移动/删除待澄清队列 #5/#7 裁决，不在本增量。
- 验证：typecheck/lint、unit 398 passed；worker folder-rename 10/10 + asset-rename 8/8；E2E 新文件 4/4、修复后复跑 18/18（folder-context-menu/asset-rename/context-menu/shell-navigation）；`test:e2e` 清单补挂 folder-context-menu 与上一增量遗漏的 asset-rename。
- 交叉审查（1 Standards 深审 + 1 Spec 深审 + 4 广度）：0 HARD 安全项；纪律 #8（App.tsx 内联）已抽 `useFolderActions` hook、文案双真源已并入共享表、父名提示重复已撤销、取消路径陈旧 parentId 已清、maxLength 对齐 80；回滚分支/崩溃窗口按纪律记未验证。
- **Computer Use 未执行**（当前环境无桌面控制能力）：MENU-016/MENU-017 进入待人类验收，截图证据移交人工 QA。
- 详见 `docs/internal/development/0017-folder-context-menu-and-rename-development-log.md`。

## 2026-07-17 0017 第二增量：资产文件重命名与侧栏标签枚举移除

- REQ-MENU-002 重命名落地：asset.renameFile 全链路（protocol/preload/main/worker），扩展名保留、非法名（含 Windows 禁用字符 `<>:"|?*`，审查修正）与同名冲突类型化拒绝、missing/trashed/offline 拒绝、同名 no-op、FTS 事务内同步；单资产菜单新增「重命名…」，对话框保留扩展名、内联中文错误、选择保持。
- REQ-TAG-001 修订（2026-07-19）：侧栏仍不枚举全部标签；改为侧栏「标签管理」入口 → 中间全页 CRUD（`Serpent-mqp`）。
- 验证：typecheck/lint、unit 395 passed；worker rename 8/8；E2E 当次全绿——asset-rename 3/3、context-menu 10/10、organization-search-trash 3/3、metadata-persistence、asset-pagination、browsing-preferences、shell-navigation（含新增 REQ-TAG-001 负向断言）。
- 交叉审查（2 深审 + 4 广度）：0 HARD；M1（Windows 禁用字符）已修并补测试；M3（缺负向断言）已补；回滚/IO 失败分支按纪律记未验证。
- **Computer Use 未执行**（当前环境无桌面控制能力）：MENU-015 进入待人类验收，截图证据移交人工 QA。
- 详见 `docs/internal/development/0017-rename-file-and-tag-nav-removal-development-log.md`。

## 2026-07-17 0017/0018 增量：可搜索标签选择器与文件操作命令

- REQ-TAG-004 落地：资产右键菜单标签操作（单资产添加、批量添加/移除）从平铺枚举改为可搜索选择器；菜单添加包含零使用标签（选择器无创建入口），移除与 Inspector 建议保持 TAG-008 排除；修复审查发现的菜单内滚动误关菜单与返回后焦点丢失。
- REQ-MENU-002 部分落地：单资产新增「在 Finder/Explorer 中显示」「复制文件路径」，全链路仿 openExternal（Main 进程 shell/clipboard），绝对路径不越界（REQ-COMMAND-003，协议单测双向注入拒绝）。
- 验证：typecheck/lint、unit 391 passed；E2E 16/17 文件当次全绿（含新选择器交互用例，context-menu 10/10）。双轴审查：Standards 通过、Spec 有条件通过（HARD-1/MEDIUM-1 已本回合修复复验）。
- **Computer Use 未执行**（当前环境无桌面控制能力）：TAG-004/TAG-005 保持不通过、待补截图证据后重新验收；SHELL-004/005/006 与 NAV-002 的 0016-A 修复已按用户指示重新进入待验收。
- **known-red 移交**：`tests/e2e/linked-folders.test.ts` 为另一 agent 未提交改动，其 `.empty-actions` 作用域下不存在「导入链接文件夹」按钮（该按钮在 `.tool-group-import` 与侧栏 secondaryAction），3/3 红；本回合未触碰该文件，修正方向已记录在开发日志。
- **2026-08-01 验收反馈跟进**：合集 inline 重命名/快捷键展示与右键二级菜单互斥已按用户反馈通过；删除通知已改为“撤销”并在恢复后刷新当前范围，无边框回撤图标也已验收通过，`Serpent-mxxc` 关闭。Windows 硬盘删除真实权限错误与删除前媒体句柄释放已获用户验收通过，`Serpent-cwor` 关闭；瀑布流已用 `git diff` 恢复原有显式列布局并获用户验收通过，`SELECT-014/015` 与 `Serpent-6b3i` 关闭。
- 详见 `docs/internal/development/0017-0018-searchable-tag-picker-and-file-commands-development-log.md`。

## 2026-07-16 新增 MVP UI/UX 与文件管理需求

- 两轮真实使用反馈已形成共享需求池：`docs/internal/implementation/mvp-ui-ux-requirements-backlog.md`；0015–0019 的暂定范围和 12 项集中澄清问题均在该文档。
- 已确认进入 MVP：应用壳与面包屑/历史、文件夹卡片与封面/计数/递归范围、完整资产和文件夹菜单、命令快捷键、中英文、亮/暗主题、标签 chip/过滤入口、Inspector 真实缩略图，以及选择和瀑布流正确性。
- 已确认产品模型变化：撤销 Label/资产显示别名，资产名称统一为真实文件名；ADR 0022、产品简报、领域模型和术语表已同步。v14 前向迁移直接丢弃预发布 Label/AI Label，并删除显式依赖 Label 的旧智能合集；其余元数据、标签关系和智能合集保留。实现与 macOS 开发态 QA 见 `5b8b8fe`。
- 自定义主题明确推迟到 MVP 后；Eagle 是信息密度和控件分组参考，不是逐像素复制目标。
- 四张用户截图已保存到 `docs/internal/前端参考/2026-07-16-*.png`，包括 Eagle 布局/过滤参考、Serpent 瀑布流空当和标签 chip 方向。
- 0015–0018 仍未全部完成；`38fa873`、`591f524`、`64521c3`、`197ea9e`、`e2d5d60` 的部分 UI/UX 实现已在当前基线，完整状态和缺口见进度同步记录。0018 的 Label 退役和 Inspector 标签入口已形成候选，批量标签选择器与标签过滤仍待实施。0019 当前候选已合流此前独立改动并补齐集成测试、真实应用检查和等比预览修复。

## 2026-07-16 0018–0019 当前候选

- Inspector 已显示真实 artifact，切换时按资产 ID 隔离元数据/AI 内容且不显示“连接中/加载中”占位；预览采用自然比例、宽度优先和最大高度约束。
- Inspector tag chip 支持直接移除、空输入建议、搜索、输入创建、鼠标立即添加和方向键/回车；零使用标签不进入建议。用户已明确反馈“标签验收了，还不错”。
- 瀑布流改为首行从左到右、后续最短列的显式列布局；稀疏三资产、多比例、多卡片尺寸和窗口宽度均有真实 Electron 断言。用户已明确反馈“瀑布流验收了，还不错”。
- Shift 框选会释放导航焦点；右键菜单按指针/键盘输入模式显示单一、克制的高亮；修改日期使用时钟图标。
- schema v14 完成 Label/AI Label/FTS Label 退役；预发布值按产品决定直接丢弃，依赖 Label 的旧智能合集删除，其他元数据与智能合集保留。
- 代码基线为 `07d2f7e`（实现提交 `5b8b8fe`，文档/证据提交 `07d2f7e`）；Computer Use 截图、双轴审查和自动化见对应开发/审查/QA 文档。Windows 与 packaged app 仍未验证。

## 2026-07-16 0019 产品正确性分支审计（已解决）

- 早期独立候选没有进入当时主线，验收链接一度失效；其功能已由当前集成实现、测试和文档在 `5b8b8fe` 统一落地，不再依赖那些孤立提交。
- CANVAS-007–009、INSPECT-001–004、MENU-013、SELECT-007 已按当前基线重新建立准确的人类验收条目；其中用户已验收 CANVAS-009 与 INSPECT-003。
- 框选集合语义现为 Shift 并集、Command/Ctrl 切换、Command/Ctrl+Shift 范围追加；Windows 真实 Ctrl 仍待平台验证。

## 2026-07-16 0014 功能收口与 0007 文件恢复安全

- 候选提交 `f1330a7` 完成框选、跨视口多选、Windows Ctrl / macOS Command 与 Shift 组合键、统一单项/批量右键菜单，并移除遮挡画布的选择态顶部操作条。
- 右键菜单显示明确选中数量；混合选择对不适用动作给出跳过说明；动作执行使用打开菜单时的选择快照，避免菜单打开后选择变化导致误操作。
- Computer Use 在真实 Serpent 中发现并修复顶部选择操作仍残留的问题；入口、缺陷和修复后三张截图已经进入 `docs/internal/qa/evidence/0014-selection-context/`。
- 0007 relink v3 使用不可变 manifest、放置回执、源身份与 SHA-256 校验；恢复不明确时保留两侧文件并记录诊断，不再凭路径猜测删除。
- 自动证据：lint、typecheck 通过；relink Worker 11/11；相关 Electron E2E 26/26。最终工具栏迁移后的完整 `verify:mainline` 尚未重跑，避免把历史全量结果误写成当前候选结果。
- **可供人类验收**：0014 中仍符合当前产品方向的选择与菜单基础行为；标签菜单 `MENU-003` 已因新信息架构撤回，准确队列见 `docs/internal/qa/human-acceptance-checklist.md`。
- **保留条件**：真实 UtilityProcess kill/restart、最终合流门禁、packaged/Windows 平台验证。

## 2026-07-14 0013 P0 查看错位热修

- 根因：绝对定位的查看器渲染在保留深层 `scrollTop` 的 `.workspace-canvas` 内部，导致查看器使用滚动内容坐标系；稳定复现的偏移量为 `10673px`，与画布当前滚动量完全一致。
- 修复：查看器移到非滚动 `.workspace` 定位上下文；进入时保存、返回时精确恢复画布滚动位置并以 `preventScroll` 恢复资产焦点。
- 自动化：相关 Electron E2E 6/6；最终 `verify:mainline` 全绿（lint、typecheck、extension、874 passed + 1 skipped、搜索性能 4/4、Electron E2E 42/42）。
- Computer Use：在真实 142 项资源库滚动至第 100 项附近后打开图片，查看页面位置与解码正常；返回后原位置和选择保持。
- **状态：P0 通过，可验收 `VIEWER-001`；完整 0013 仍未完成。**
- 详见 `docs/internal/development/0013-asset-viewer-navigation-and-gestures-development-log.md` 与 `docs/internal/qa/0013-asset-viewer-navigation-and-gestures-qa-report.md`。

## 2026-07-14 0012 实施与门禁

- 版本化画布偏好模块 `src/renderer/canvas-preferences.ts`（Zod 校验、遗留 key 迁移、存储可注入）+ App.tsx 集成（统一 state、3 字段开关 `文件名`/`文件大小`/`修改日期`、条件化 aria-label、条件化 caption）。
- 最终 `verify:mainline` 全绿：lint/typecheck/extension、798 passed + 1 skipped、search perf 4/4、Electron E2E 20/20。
- 双轴审查完成、阻断项已修（descriptor 数组、PREF_KEY import、实际卡片宽度断言、tag/collection scope）。
- **有条件通过**：macOS Computer Use 与截图门禁完成，发现并修复空 caption、工具栏逐字换行和窄窗设置裁剪；Windows 与 10 万资产帧率未验证。
- `process-lifecycle` 已用 fresh E2E profile 隔离；不存在 recent 路径的完整重启回归约 0.8 秒回到起始页，未复现交接文档推断的生产挂起。
- 详见 `docs/internal/development/0012-asset-canvas-views-and-card-display-development-log.md`、`docs/internal/reviews/0012-asset-canvas-views-and-card-display-code-review.md`、`docs/internal/qa/0012-asset-canvas-views-and-card-display-qa-report.md`、`docs/internal/implementation/0012-design-decisions-2026-07-14.md`。

## 状态校准（2026-07-14）

- 0003 的可编辑规则、复制与 linked→managed 已有实现/测试；主要剩余规格偏差与平台证据。
- 0004 已完成字段清空、输入校验、串行乐观锁、批量/递归一致性、完整重启与竞争写入 E2E，并完成 macOS Computer Use；packaged 与 Windows QA 保留条件。
- 最终主线门禁为 810 passed + 1 skipped、搜索性能 4/4、Electron E2E 22/22；E2E 默认 profile 已隔离，完整重启/单实例用例仅共享显式传入的临时 profile。
- 0005 自动化与 10 万资产热查询性能门禁已通过，剩余以 packaged/人工/Windows 证据为主。
- 0006 的本地真实队列、source/proxy 播放、Computer Use 和最终 mainline 已通过；发布仍被
  二进制来源、packaged playback 与 Windows 阻断。
- 0007 已完成 stateful relink-preview 与 v3 文件所有权恢复安全（不可变 manifest、放置回执、身份/SHA-256 校验、歧义时保留）；真实 UtilityProcess kill/restart 仍未覆盖，另待 macOS Computer Use 与 Windows 验证。
- 0009 已存在有界缩略图输入、并发限制、进度事件和任务控制 UI；真实功能缺口集中在按范围
  分析/清空入口与密钥边界决定。

## 2026-07-14 已记录的查看页面 UX 缺口

- 图片、视频及其他支持查看的资产首次打开应完整显示并尽可能撑满查看区域，不能裁剪或变形。
- 移除常驻底部缩放条；重新设计敷衍的顶部工具栏，优先探索无栏沉浸画布和左上角轻量“返回”。
- 查看页面的退出语义是“返回资产浏览”，不是“关闭”；Esc 与返回入口结果一致。
- 提高 macOS 触控板 pinch 灵敏度，统一缩放焦点，并实现成熟、低冲突的平移交互。
- 在查看页面切换文件夹、合集、标签等资产范围时，必须先返回资产浏览页面。
- 深滚动进入查看页面的错位已完成 P0 热修；其余详细范围与验收条件见 `docs/internal/implementation/0013-asset-viewer-navigation-and-gestures-vertical-slice.md`。

## 2026-07-14 0014 P1 选择模型

- 框选（marquee drag-select）：3 阶段 document-level mousedown/mousemove/mouseup + AABB box-overlap intersection（grid/masonry 一致）+ 40px 边缘自动滚动。
- 组合键模型：普通点击始终只选择目标；Ctrl/Cmd+click 增减；Shift+click 范围扩展（基于 selectionAnchorRef）；Ctrl/Cmd+Shift+click 范围追加。
- Esc 清除选择：非捕获 handler 在 `selectedAssetIds.length > 0` 且无 preview 且无 modal dialog 时清选；捕获阶段 guard（`stopPropagation`）在上下文菜单打开时阻止清选，确保第一 Esc 只关闭菜单、第二 Esc 才清选。
- 选择锚点修复：框选 mouseup 结束时设置 `selectionAnchorRef` 为第一个命中资产 ID，使后续 Shift+click 可从框选结果正确扩展。
- 死代码清理：移除未使用的 `autoScrollRaf` 变量及其 `cancelAnimationFrame` 清理分支。
- 交叉去重：`marqueeHitIdsRef` 存储 mousemove 命中结果，mouseup 复用避免重复 DOM AABB 遍历。
- 右键 mousedown 追踪：`lastMousedownButtonRef` 防止 Playwright 右击合成的 click 事件触发 re-click-deselect（真实浏览器右击不派发 click，仅 contextmenu）。
- 新增 E2E 测试 `tests/e2e/selection-marquee.test.ts`：10 项测试（5 原有 + 5 新增：框选后 Shift 扩展、选择生存视图切换/缩放、Ctrl/Cmd 增减往返、瀑布流自动滚动、上下文菜单 Escape 序贯保护）。
- 修复后验证：typecheck/lint 绿、unit 320 passed、E2E 24/24（selection-marquee 10 + context-menu 7 + organization-search-trash 3 + media-preview 2 + browsing-preferences 2）。
- 双轴审查：Standards 0 HARD 违规（medium 已修复：stale-anchor、dead-code、intersection-dedup；non-blocking follow-up：Primitive Obsession、Long Method、Windows Ctrl）。Spec 选择模型完成；测试缺口 line 21/16/20 已关闭；Windows Ctrl 已确认缺口。
- **状态更新（2026-07-16）：`f1330a7` 已移除顶部批量条、完成统一批量菜单连线与 macOS Computer Use 截图验收；现可按清单做人类功能验收。最终合流门禁与 Windows 平台验证未执行。**
- 详见 `docs/internal/development/0014-asset-selection-and-context-actions-development-log.md`、`docs/internal/reviews/0014-asset-selection-and-context-actions-code-review.md`、`docs/internal/qa/0014-asset-selection-and-context-actions-qa-report.md`。

## 2026-07-14 0014 P0 右键菜单热修

- 实现：新文件 `src/renderer/context-menu.tsx`（`ContextMenuProvider`/`useContextMenu` 单一状态控制器、`ContextMenuBackdrop` 5 套关闭监听、`ContextMenu` viewport clamp/flip、`ContextMenuItem`/`ContextMenuSection` 统一菜单项与分组）；`App.tsx` 重构（消除 3 套分散菜单实现，统一为 `useContextMenu` hook + `<ContextMenu>` 组件）；`src/renderer/styles.css` 新增统一设计 token（+110 行）。
- 可靠关闭触发器：外部点击（document capture phase）/Escape/滚动/resize/窗口 blur/范围切换（`chooseFolder`/`chooseTag`/`chooseCollection`/`chooseSmartCollection`）/菜单项执行后自动关闭。
- 新增 E2E 测试 `tests/e2e/context-menu.test.ts`：7 项测试覆盖外部点击/Escape/滚动/resize 关闭、viewport 边缘 clamp、单菜单 mutex、可访问名称与 Escape、窗口 blur、四角 viewport clamp、范围切换关闭。
- 验证通过：typecheck/lint、unit 320 passed、context-menu E2E 7/7、回归 organization-search-trash 3/3 + media-preview 2/2 + browsing-preferences 2/2。
- 双轴审查通过（0 HARD 违规，4 非阻断气味已记录为 follow-up）。死代码 `useSingleContextMenu` export 已移除。
- **有条件通过**：P0 热修完成；P1 完整切片（框选、组合键模型、移除顶部批量条、统一批量右键菜单、视觉打磨）待实施；macOS Computer Use 人工视觉 QA 与 Windows 平台验证未执行。
- 详见 `docs/internal/development/0014-asset-selection-and-context-actions-development-log.md`、`docs/internal/reviews/0014-asset-selection-and-context-actions-code-review.md`、`docs/internal/qa/0014-asset-selection-and-context-actions-qa-report.md`。

## 2026-07-14 已记录的选择与右键菜单 UX 缺口

- 资产画布增加框选；统一 Windows Ctrl / Shift 与 macOS Command / Shift 的增选、范围选择和取消选择语义。
- 移除遮挡画布的顶部多选操作条，把单项/批量动作统一到右键菜单。
- 右键菜单需要统一视觉与定位，并在外点、Esc、滚动、resize 和窗口失焦时可靠消失。
- 详细范围与验收条件见 `docs/internal/implementation/0014-asset-selection-and-context-actions-vertical-slice.md`。

## 2026-07-13 浏览与恢复收口

- 缩略图等比显示；支持媒体缺少预览时自动生成；查看页面不被生成任务阻塞。
- 客户端查看嵌入中央，支持前后切换、统一缩放和视频原生控制。
- 浏览区无分页，平铺/瀑布流连续加载；卡片尺寸可调并保留视觉锚点。
- 瀑布流顶部负溢出裁剪已修复，首尾可达加入 E2E。
- Main 保存最近资源库路径，Renderer 保存不含绝对路径的浏览范围/资产身份；完整进程重启后自动恢复与聚焦。
- 通知 5 秒、错误 10 秒自动关闭；完整诊断仍保留在持久日志。

## 仍未宣称完成

Windows 已完成一次有边界的开发态 UI/交互审计，但尚未完成 DPI、多屏、真实媒体、packaged/Squirrel 与发布级平台 QA；0006 的首发视频格式、FFmpeg/OIIO 随包分发和 packaged-app 媒体主线仍需验证。任何“已实现”不等同于满足项目完成定义。
