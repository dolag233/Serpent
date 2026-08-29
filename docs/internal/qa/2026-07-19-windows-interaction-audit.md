# 2026-07-19 Windows 交互与跨平台 UI 审计

> 状态：完成（Windows 开发态实机 + 跨平台静态对照；限制见文末）
> 分支：`codex/windows-adaptation`
> 审计基线：`edd00da`
> 主工单：`Serpent-7rd`
> 平台：Windows 真实 Electron 开发态；macOS 以既有真实证据、规格和静态平台分支对照

## 结论

本轮没有修改产品代码。审计新增 7 个缺陷工单，给 4 个既有工单补充 Windows 证据，并把用户本轮明确反馈同步到人类验收清单。

- P1：`Serpent-omn`、`Serpent-itr`、`Serpent-6k1`、`Serpent-j5x`、`Serpent-bwb`。
- P2：`Serpent-d8u`、`Serpent-2vn`。
- 既有工单补证：`Serpent-32p`、`Serpent-7ny`、`Serpent-b54`、`Serpent-5fq`。
- 人类验收变化：新增失败项 `CANVAS-026`、`VIEWER-012`；`CANVAS-021` 补充“卡片保持旧宽并被 Inspector 遮挡”的用户反馈与实测。

## 目标与分类

本轮逐项核对当前 UI/交互是否符合产品文档、Windows 操作习惯及已确认的 macOS 行为。发现按三类记录：

1. Windows 特有：由占位滚动条、Windows 原生菜单、Ctrl/Alt、Explorer 等差异触发。
2. 跨平台差异：Windows 与 macOS 的等价输入没有获得等价结果，或平台提示/快捷键错误。
3. 跨平台共同缺陷：macOS 现状本身也不合理，不能因为两端一致而视为正确。

实机使用隔离 `SERPENT_E2E_USER_DATA_PATH` 与临时资源库 `Windows 交互审计库`，导入 13 张仓库 QA 图片；没有读取或修改用户真实资源库。

## 文档与实现基线

- 产品/流程：`product-brief.md`、`development-process.md`、`domain-model.md`、`project-status.md`。
- UX：`mvp-ui-ux-requirements-backlog.md`、`human-acceptance-checklist.md`、`0001-studio-contact-sheet-direction.md`。
- 交互规格：0012 画布、0013 查看、0014 选择与右键、0016 壳层。
- 平台分支：Main 的 BrowserWindow、原生 dialog/menu、系统回收站、二进制解析；Renderer 的平台快捷键、字体、拖放和查看器 wheel 管线。

## 新确认缺陷

| 工单 | 平台/类别 | 复现与实际结果 | 根因/预期 |
| --- | --- | --- | --- |
| `Serpent-omn` | Windows 首报；跨平台布局根因 | 平铺 13/13 卡片均产生 23–132px 横向无效留白 | `JUSTIFIED_CAPTION_BAND_PX=22`，实际三行 caption 约 58px；flex 压矮媒体但 slot 宽仍按旧行高计算。caption 高度须真实参与布局 |
| `Serpent-itr` | Windows 特有放大 | 初始画布 `clientWidth=778`、`scrollWidth=788`，出现 10px 无意义横向滚动条 | Windows 占位式纵向滚动条暴露内在 min-content 溢出；画布/网格必须 `min-width:0` 并按 client width 布局 |
| `Serpent-6k1` | 跨平台共同产品缺陷 | 图片查看初始 42%；普通 wheel 后仍 42%，Ctrl+wheel 后 77% | 当前仅 `ctrlKey/metaKey` 进入 `zoomAt`，普通 wheel 被解释为平移；按本轮产品反馈，普通鼠标滚轮应直接缩放 |
| `Serpent-j5x` | Windows 原生壳层 | 中文应用仍显示默认英文 File/Edit/View/Window；暴露 Reload、Force Reload、DevTools、网页 Zoom | Windows 应使用本地化产品菜单或隐藏无价值菜单栏；开发命令不得进入生产菜单，缩放不得与资产画布/查看器混淆 |
| `Serpent-bwb` | Windows/macOS 本地化 | 建库、导入、链接、找回系统文件选择器硬编码英文；导出/导入库又硬编码中文 | Main 未接入当前 locale。原生 dialog/menu 文案应集中定义并按应用语言解析 |
| `Serpent-d8u` | Windows/macOS 原生输入习惯 | 右键描述 textarea、作者/源链接 input 无任何菜单 | Electron 不自动提供编辑菜单，Renderer/Main 也未实现；应提供撤销/剪切/复制/粘贴/删除/全选并按状态禁用 |
| `Serpent-2vn` | Windows/macOS 拖放 | 普通拖放成功移动并可撤销；Alt 拖放拒绝复制，Windows 中文提示“松开 Option” | 已关闭 `Serpent-aa3` 只实现复制意图/拒绝路径，managed copy API 仍缺；提示须按 Windows=Alt、macOS=Option 分平台 |

## 用户点名问题的精确复现

### 1. 平铺卡片无效空白

1280×820、DPR 1、13 张多比例图片：

- `.workspace-canvas`: `clientWidth=778`，`scrollWidth=788`。
- `.asset-grid`: 宽 788px，padding `16px 16px 48px`。
- `.asset-caption`: 每张约 58px；算法常量只有 22px。
- 7 行 13 张卡片全部存在横向 letterbox，无效宽度最小 23px、最大 132px。

这不是 Windows 图片解码或 DirectWrite 问题，而是 justified 行高模型与真实 caption 结构不一致；Windows 的占位滚动条进一步放大了布局误差。

### 2. 侧栏改宽后不重排、卡片被遮挡

- 调宽 Inspector 前：画布 client width 778px，网格约 788px。
- Inspector 从约 268px 拖到 451px 后：画布 client width 降到 595px，网格仍约 788px；6 张卡片右边缘进入 Inspector 区域。
- 复位后将窗口缩到最小 1040×680：workspace 宽 548px、画布 client width 538px，网格仍保留 778px。
- 收起 Inspector 后网格会扩至 806px；再次展开后画布回到 538px，网格仍保留 806px。
- CSS 证据：`.workspace-canvas` 是 grid + `place-items:center`，`.asset-grid`/`.justified-row` 的 min-content 宽度没有被 `min-width:0` 打断。

这同时包含两个结果：布局没有按新可用宽度收缩，以及视觉锚点从 `scrollTop=800` 跳回 0。前者补入 `Serpent-32p`/`Serpent-itr` 证据，后者与既有 CANVAS-021 不通过一致。

## 交互矩阵

| 表面/旅程 | Windows 实机结果 | 对照与处置 |
| --- | --- | --- |
| 启动当前 HEAD | `windows-typography` Electron smoke 1/1 通过；开发态可启动 | 仅作为本轮构建/启动基线，不替代全回归 |
| 平铺媒体适配 | 失败：13/13 卡片横向留白 | 新开 `Serpent-omn`；`CANVAS-026` 不通过 |
| 纵向/横向滚动 | 普通 wheel 只纵向滚动，符合 0012；但出现水平滚动条 | 新开 `Serpent-itr` |
| Ctrl+wheel 卡片缩放 | 160 经一次 `deltaY=-300` 跳到 320，过粗；普通 wheel 保持 160 | 补证 `Serpent-7ny`；CANVAS-018 已不通过 |
| 平铺/瀑布流切换 | 两种模式可切换；瀑布流首批卡片保持比例 | 通过的主路径；平铺仍受 caption/min-content 缺陷阻断 |
| 窄窗口 1040×680 | 壳层工具按钮进入“更多工具”，无按钮文本自身换行；画布保持旧宽并横向溢出 | 工具栏通过；画布失败见 `Serpent-32p`/`Serpent-itr` |
| 侧栏收起/展开 | Inspector 可收起并从边缘/工具栏恢复；画布扩大 | 基础动作通过；恢复后网格不收缩失败 |
| 单选/Ctrl/Shift/Ctrl+Shift | Ctrl 加选 2 项；Shift 连续范围 4 项；Ctrl+Shift 保留离散项并追加范围，最终 5 项 | 符合 0014；补证 `Serpent-b54` |
| 鼠标框选 | 从空白拖动实测选中 4 项 | 基础 Windows 框选通过；边缘自动滚动未逐项实机 |
| F2 重命名 | 进入卡片原地输入，保留扩展名；Esc 取消 | 符合 Windows 习惯；路径规则静态覆盖 Windows 保留名、尾点/空格、非法字符和大小写身份 |
| 资产右键菜单 | 显示“在文件资源管理器中显示”、Ctrl+O、Delete；打开时首项聚焦，方向键移动，Esc 关闭 | 平台名称/核心键盘导航通过；完整复制/粘贴仍是既有 `Serpent-w29` |
| 文本框右键 | 无菜单 | 新开 `Serpent-d8u` |
| 内部拖动到文件夹 | 普通拖动成功移动 1 项，文件夹计数 0→1，并提供撤销 | 移动路径通过；Alt 复制失败见 `Serpent-2vn` |
| 图片查看进入/切图/返回 | Space 进入；ArrowRight 后媒体名与 Inspector 同步；Esc 返回并聚焦切换后的卡片 | 通过 |
| 查看中切范围 | 点击回收站会退出查看并显示 0 项空态 | 通过 REQ-VIEW-004 |
| 图片查看 wheel | 普通 wheel 不缩放，Ctrl+wheel 才缩放 | 新开 `Serpent-6k1`；`VIEWER-012` 不通过 |
| 过滤维度 | 颜色面板在窄窗内打开，显示排除与 Shift 多选提示；外部点击关闭 | 本轮抽查通过；既有过滤产品工单不重复 |
| 设置模态 | 1040px 宽可打开，主题/语言/画布/字段/角标分区可读；Esc 关闭 | 抽查通过；主题/语言默认仍由 `Serpent-svc` 跟踪 |
| 资源库菜单 | 新建/打开/关闭/移除/从硬盘删除及添加与传输可见 | Renderer 菜单抽查通过；原生 menu/dialog 失败另见 `j5x`/`bwb` |
| 输入无障碍名称 | 搜索、描述、作者、源链接 textbox 均有可访问名称 | 通过；右键编辑能力独立失败 |
| 图标按钮名称 | 当前可见纯图标按钮无“空名称”项 | 抽查通过 SHELL-013 |

## 已有缺陷与需求，不重复开单

| 范围 | 现状/本轮处理 |
| --- | --- |
| 重排保持可见集合 | `Serpent-32p` / CANVAS-021 已不通过；补入 Inspector 改宽与 1040px 窗口的精确测量 |
| 卡片离散档与 pinch 灵敏度 | `Serpent-7ny` / CANVAS-018 已不通过；补入 Windows Ctrl+wheel 160→320 结果 |
| 竖图卡片/Inspector | `Serpent-woa` / CANVAS-023 已不通过；未重复开单 |
| 仅子文件夹空当 | `Serpent-an1` / CANVAS-022 已不通过 |
| 文件夹卡片单击选择/双击进入 | `Serpent-829`；本轮侧栏文件夹单击导航通过，不等价于文件夹卡片验收 |
| 文件夹拼盘封面 | `Serpent-7ms` |
| Ctrl+I 反选 / macOS Edit 菜单 | `Serpent-5fq`；补入 Windows 默认菜单没有产品命令的证据 |
| 系统文件剪贴板复制/粘贴 | 资产 `Serpent-w29`、文件夹 `Serpent-vgp` |
| Windows/macOS 主题语言默认 | `Serpent-svc` |
| 查看器 chevron/关闭随背景对比 | `Serpent-noz` |
| 排序方向并入面板 | `Serpent-v78` |
| 文本、音频、导入库等用户既有不通过项 | 保持 `Serpent-4l7`、`Serpent-vlx`、`Serpent-pxd` 等原工单状态，本轮未伪造平台通过 |

## 原生与文件系统静态核对

- BrowserWindow：Windows 使用系统 frame；macOS 使用 `hiddenInset` + traffic lights。Windows 原生 frame 本身符合平台惯例，本轮未把“双顶栏”主观差异单独判 bug。
- 生命周期：Windows 关闭最后窗口后 `app.quit()`；macOS 保持应用并允许重新激活，符合平台惯例。
- 系统回收站：`trash@10.1.1` 分别使用 `windows-trash.exe` / `macos-trash`，隐藏 Windows helper 窗口。
- 路径与重命名：统一拒绝 Windows 设备名、`<>:"|?*`、路径分隔符、尾随点/空格；portable identity 做 NFC + 大小写折叠；Windows transfer path key 小写化。
- 媒体/预览：二进制解析支持 `win32-x64` 与 `.exe`；Windows 打包媒体 bundle、真实 MP4/GIF/音频/EXR 解码仍需要独立 packaged 证据，不能由图片 fixture 推断通过。
- Renderer 边界：Explorer/reveal、复制路径等仍只跨 asset/folder ID，绝对路径由 Worker/Main 解析，符合架构约束。

## 证据索引

- `01-grid-initial.png`：平铺卡片空白与初始水平滚动。
- `02-resize-before.png` / `03-resize-after.png`：Inspector 改宽前后，网格不收缩、卡片被遮挡。
- `04-viewer-wheel-zoom.png`：普通 wheel 无缩放、Ctrl+wheel 后 77%。
- `05-windows-context-menu.png`：Windows 资产右键菜单、Explorer/Ctrl+O/Delete 文案。
- `06-windows-narrow-1040.png`：最小窗口宽度的工具栏与画布溢出。
- `07-inspector-collapsed.png`：收起 Inspector 后画布扩展。
- `08-color-filter-open.png`：窄窗颜色过滤面板。
- `09-masonry-view.png`：Windows 瀑布流抽查。

## 明确未验证边界

以下项目不能写成“通过”：

- macOS 本轮没有重新运行真实设备；触控板 pinch、三指导航、traffic lights 仅引用既有验收和静态实现。
- Windows 125%/150%/多显示器 DPI 没有切换系统缩放实测；本轮页面证据为 DPR≈1 的 1280×820/1040×680 viewport。
- Windows packaged 安装包、Squirrel 安装/升级/卸载、签名、文件关联和开机/多实例没有执行。
- 真实 MP4/GIF/音频/文本/EXR 媒体 fixture 没有在本轮 Windows 应用中重跑；已有测试与人类验收不等于本轮平台证据。
- 原生文件选择器在隔离 E2E 会被环境变量替代，因此中英混杂结论来自 Main 代码的确定性硬编码，而非本轮截图。
- 框选边缘自动滚动、修饰键框选全部集合运算、窗口失焦关闭菜单没有逐项手工重复；基础 Windows Ctrl/Ctrl+Shift/框选与既有自动化已交叉覆盖。
- 没有执行整套回归或 `verify:mainline`；本轮只做当前 HEAD 的 Windows Electron 启动 smoke 和交互审计。
