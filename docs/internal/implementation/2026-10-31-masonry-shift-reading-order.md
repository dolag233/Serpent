# 瀑布流 Shift 连续选择（2026-10-31）

状态：实现与直接相关 Renderer 自动化完成，等待主 agent 独立复核和用户人眼验收。工单 `Serpent-9d3244`，基线 `c4e3227d`。

## 用户确认的规则

Shift 点击使用连续阅读区间。阅读顺序按卡片上沿从上到下，同一高度从左到右。起点和终点都包含，反向点击得到同一集合。截图对应的虚构场景：从首层左一到下一层左三，下一层右四的上沿若高于终点，就应选中它；并非把下一层硬分为一整行后只选左三。

## 根因

`useAssetSelection` 的 `applyMasonryShiftSelection` 优先截获 Shift，按两张卡中心点构造矩形。这会漏选起终点水平范围以外、但处于阅读区间内的卡片，也会因图片高度不同而打乱同一上沿的先后关系。

`masonryVisualReadingOrderIds` 名称和注释暗示几何顺序，实际直接返回输入数组，且仍有“round-robin”的旧注释。普通 `MasonryColumns` 已采用最短列分配、DOM 按列分组；大库 `VirtualMasonryColumns` 为保持稀疏索引使用轮转列。数组、DOM、视觉位置是三个不同概念。因此删除矩形分支后直接复用旧数组切片不能对两条布局路径都正确。

此外 `computeMasonrySelectionAssetIds` 使用独立预估参数，不能作为实际几何真相源：真实列宽、逐卡 caption、尺寸补齐和重排都可能变化。原 helper 还被键盘焦点顺序使用，本次不要顺带改变 Tab 交互。

## 实施要求

1. 复用 `canvas-asset-layout` 发布的普通矩形和稀疏 layout index，取得当前布局真实位置；按上沿 y、左沿 x、稳定 tie-break 生成已知资产的 Shift 顺序。不使用中心点，不改瀑布流排布。
2. 接入 `resolveShiftBrowseRange` 的同一选择流程，文件夹在资产前，统一维护原 anchor；重复 Shift 不移动原 anchor，Ctrl/⌘+Shift 合并既有集合，普通 Shift 替换集合并清理不属于区间的文件夹。
3. 依据完整已发布几何覆盖已知但未挂载的卡片；DOM 仅用于未发布布局的降级。不能仅凭几张可见 DOM 对整个浏览范围排序。虚拟 `__geometry__:` 占位不能进入真实资产选择；未知身份仍沿用既有能力边界，不在此轮新增 Worker/协议能力。
4. 布局未就绪、anchor/target 无几何时给出稳定降级，不崩溃、不回退到矩形。明确处理缺失项和重复 ID，不静默漏掉可识别的端点。窗口大小、卡片大小、caption 与 live dimension 改变后读取最新已发布几何，避免过期缓存。
5. 空白拖动框选仍保持矩形；本次只修改 Shift 点击连续选择。平铺模式、Tab/Shift+Tab 的焦点行为保持原语义。
6. 新交互逻辑放独立 helper/hook，避免继续向 App 内联大段逻辑。复用已有区间、布局发布和路径入口；清理不再使用的中心点范围分支/旧契约测试，检查其他消费者后再删除 API。

## 验证与交付

仅运行直接相关 Renderer 单测。包含同上沿高矮图片（中心点排序会失败）、输入与 DOM 均按列混排、最短列和轮转布局、正反向、重复 Shift、Ctrl/⌘+Shift、跨文件夹/资产边界、屏幕外已知项、占位过滤、缺几何/同点/尺寸重排、平铺与框选不回归。若使用静态测试不能证明 hook 的真实派发顺序，应补相应的渲染层交互测试。

用户指定同一 luna extra high subagent 执行开发、测试和 Standards/Spec 自审，主 agent 在交接后独立检查最终实现和证据。按 UI 最小化测试原则不运行 Worker、资源库门禁、性能基线、全量测试或 Electron E2E。真实桌面工具能力与人工验收单独记录，不将自动化写成人工通过。更新开发/审查/QA 记录和人类清单，保持工单进行中；本次未授权提交或推送新需求。

当前实现与验收状态见[开发记录](../development/2026-10-31-masonry-shift-reading-order.md)、[实现者自审](../reviews/2026-10-31-masonry-shift-reading-order-review.md)和[QA 记录](../qa/2026-10-31-masonry-shift-reading-order-qa.md)。
