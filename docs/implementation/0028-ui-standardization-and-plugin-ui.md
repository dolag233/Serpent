# 0028：UI 标准化与插件结构化 UI 设计分析

状态：阶段 1（内部 UI library 基础层）实施中

日期：2026-08-04

关联工单：`Serpent-nzxh`、`Serpent-7nah`、`Serpent-wjm5`

## 1. 目的与结论

`Serpent-nzxh` 不应被理解成一次 CSS 清理，或者把几个常用 class 改成相同颜色。它需要建立一套由语义、状态、键盘/可访问性行为、布局约束和视觉 token 共同组成的内部 UI library，然后让应用自己的 UI 和插件的 Host-rendered UI 都以这套契约渲染。

本次只完成盘点和设计，不修改现有 Renderer 组件，不迁移 CSS，不改变插件协议。实现必须在本设计获得确认后分阶段进行，避免在 `App.tsx`、`styles.css` 和插件 manifest 之间继续增加隐式约定。

结论如下：

1. 先做 Host 内部 UI library，再开放插件的结构化 UI 描述。插件不能直接依赖宿主 DOM、React 组件名或 CSS class。
2. 菜单、设置、对话框、popover、表单控件、通知/任务、Shell、资产卡片和查看器控制条都要纳入同一套语义体系；共享的是契约和基础表面，不是强行让所有业务组件长得完全一样。
3. 插件的标准 UI 使用受限的声明式描述（semantic descriptor），由 Host 负责布局、主题、焦点、ARIA、校验和持久化。复杂、自由布局的插件界面继续使用隔离 iframe，不把任意 React/DOM/CSS 注入变成公共 API。
4. 命令、菜单、工具栏、Inspector、Viewer action 和设置 action 需要共用 command ID、Context、`when`、`enablement`、`checked`、快捷键和执行语义。菜单树必须递归处理可见性：父项隐藏时整个子树隐藏，子项全部不可见时不留下空的二级菜单。
5. `context` 只服务于 UI 决策和显示；功能执行仍通过完整的脚本/Gateway API。菜单条件不能在打开菜单时等待插件 RPC，也不能直接执行任意 Python/JavaScript。
6. 插件 Job 不跨应用重启恢复已经单独记录为 `Serpent-wjm5`。本设计不把“任务恢复”当成 UI 标准化的一部分，也不为此引入跨会话活动条语义。

## 2. 调查范围与证据

本次检查了 `src/renderer` 的组件、样式、插件渲染层和相关文档，重点覆盖：

- `docs/implementation/0024-script-plugin-platform.md`、`docs/adr/0027-plugin-instance-lifecycle-and-interaction-context.md`；
- `docs/manual/plugins/development.md`、`docs/manual/plugins/api-reference.md`；
- `docs/ui/0001-studio-contact-sheet-direction.md`、`0003-keyboard-shortcut-ux-principles.md`、`0004-calm-error-and-copy-ux-principles.md`；
- 现有 `docs/development/2026-08-02-ui-reuse-audit.md`；
- 所有 Renderer 一级组件，以及 `plugin-*`、`context-menu`、`dialog`、`settings`、`viewer`、`media`、`card`、`toast`、`notice` 相关模块；
- `src/renderer/styles.css` 的 token、组件 class、层级和主题定义；
- `src/plugins/plugin-manifest.ts`、`plugin-contributions.ts`、`src/shared/plugin-ui-protocol.ts` 和 iframe Host。

现状规模和代表性证据：

| 范围 | 当前情况 | 设计含义 |
| --- | --- | --- |
| Renderer 入口组件 | 对话框、设置、菜单、查看器、资源卡片、Inspector、Shell 等分散在 60 多个一级文件中；`App.tsx` 仍包含大量卡片和工作区布局 | 先建立分类和边界，再按表面迁移；不能一次性重写 App |
| CSS | `src/renderer/styles.css` 约 9,947 行，包含 token、布局、组件和页面例外；同一语义存在多套 class | token、primitive、pattern、domain surface 分层，禁止插件使用这些 class |
| 按钮 | `.primary-button`、`.secondary-button`、`.tool-button`、`.compact-action`、`.tiny-action` 等并存，原生 `<button>` 也大量存在 | 统一 Button/IconButton/ToolbarButton 的行为与状态，保留少量明确业务变体 |
| 表单 | `text-field` 使用广泛；toggle 主要通过设置行 CSS 组合；select、slider、range、number input 各自实现 | 建立 TextField、Select、Switch、Slider、NumberField 等真实组件，而不是继续复制 class |
| 菜单 | 主菜单、资源右键菜单、资源库菜单、WorkspaceToolsOverflow、picker/popover 有重叠但不完全相同的实现 | 统一 MenuSurface、MenuItem、Submenu、Section、PopoverSurface 和 roving keyboard contract |
| 对话框 | `create-dialog`、`conflict-dialog` 和多个页面级 shell 并存；尺寸、标题、actions、焦点处理不一致 | 统一 ModalStack/DialogShell，并规定 compact/form/wide/workspace 四类尺寸 |
| 设置 | 应用设置、资源库设置、插件设置共用部分 class，但页面结构和导航行为仍有复制；插件设置直接依赖宿主 CSS class | 统一 SettingsPage/Section/Row/Field；插件只能提交语义描述 |
| 通知与任务 | toast、workspace notice、activity strip、插件 Job banner 各有入口和层级 | 统一反馈语义和层级，区分 transient toast、persistent notice、activity surface、blocking dialog |
| 查看器/媒体 | `VideoPlayerControls`、`AudioPlayerControls`、GIF/文本/序列帧控件各自维护 transport/timeline | 抽 TimelineScrubber、MediaTransportBar、VolumeControl、DecodedMediaFrame；媒体差异留在 adapter |
| 卡片与画布 | 资产卡片主体仍在 `App.tsx`，FolderCard 和媒体卡片有相似选择/预览表面但业务含义不同 | 共享 SelectableSurface、PreviewFrame、CaptionBand，不合并文件夹和资产领域模型 |
| 插件视图 | workspace/sidebar/inspector/viewer/settings 都复用 iframe Host，但 tab、active state、frame wrapper 仍有重复 | 统一 ContributionViewHost 和 ContributionTabs，保持 iframe 隔离 |

已有 `Serpent-yne1` 已统一主菜单、资产右键菜单、资源库菜单的部分 menu token；它是基础，不是本 Epic 的完成状态。已有审计指出，菜单浮层定位、子菜单关闭、键盘 roving、WorkspaceToolsOverflow surface 仍未统一。

## 3. 全量 UI 分类与抽象边界

### 3.1 Shell 与导航

涉及 `App.tsx`、`NavigationSidebar.tsx`、`LibrarySwitcher.tsx`、`ScopeBreadcrumbs.tsx`、`ScopeHistoryButtons.tsx`、`WindowsWindowControls.tsx`、`AppSettingsNavigation.tsx` 以及顶部工具栏、工作区栏、侧栏和 Inspector 布局。

统一对象：

- `ShellChromeRow`：窗口栏、工具栏、工作区栏的高度、水平 padding、分隔线和 slot；
- `PaneShell`：左侧导航、主画布、右侧 Inspector 的 surface、折叠、拖拽 gutter 和空状态；
- `Toolbar`、`ToolbarGroup`、`ToolbarDivider`、`ToolbarIconButton`；
- `Breadcrumbs`、`HistoryButtons`、`NavigationTree`；
- `ContributionViewHost`：插件侧栏/工作区/Inspector/Viewer 入口的挂载表面。

不统一的内容：导航树的领域数据、资源库切换的生命周期、Inspector 的多资产编辑逻辑和查看器 overlay 的定位策略。这些属于 domain surface，只能复用基础 shell 和控制件。

### 3.2 菜单、popover 与 picker

涉及 `context-menu.tsx`、`MainMenu.tsx`、`AssetContextMenu.tsx`、`ViewerContextMenu.tsx`、`LibrarySwitcher.tsx`、`WorkspaceToolsOverflow.tsx`、`TagPickerMenu.tsx`、`CollectionPickerMenu.tsx`、`ColorSpacePickerMenu.tsx`、`FilterTagPicker.tsx`、`SortModeControl.tsx`、`DimensionFilterBar.tsx` 和插件菜单贡献渲染器。

建议分成两层：

1. `MenuSurface`：面板定位、viewport 翻转/夹紧、surface token、关闭原因、焦点恢复、roving keyboard、Escape/Arrow/Enter 行为。
2. `MenuNode`：item、submenu、section、separator、checkbox/radio item 的语义、禁用/选中/危险状态和命令绑定。

普通 picker 可以复用 `PopoverSurface` 和 `OptionList`，但搜索、标签颜色、色彩空间等选项数据仍由领域 adapter 提供。Popover 不是菜单的另一个 CSS 副本；它们共用 surface/elevation/layer，但交互 role 和选择模型必须明确。

菜单树必须满足：

- `when=false` 的节点不进入渲染树；隐藏父项的所有 child 一并隐藏；
- 子项全部隐藏时不渲染空 submenu；父项可见但全部子项 disabled 时，按产品策略显示 disabled parent，不伪装成可用操作；
- 每个 item 的可见、可用、checked 结果在一次 resolve 中冻结，菜单打开后不因异步 RPC 产生结构跳动；
- `before`、`after`、`first`、`last` 只影响同一稳定语义组，冲突时有确定的排序和诊断；
- native item、插件 item 和内置 item 最终都落入同一个 `ResolvedMenuTree`，不能各自维护一套渲染器；
- 快捷键只有一个 Registry 来源，菜单显示和真正的 key dispatch 不能出现两个值。

### 3.3 对话框、确认框与阻塞层

涉及 `CreateDialog.tsx`、`ImportDialog.tsx`、`ExportDialog.tsx`、`MoveDialog.tsx`、`RenameDialog.tsx`、`RestoreDialog.tsx`、`PermanentDeleteDialog.tsx`、`DiskDeleteConfirmDialog.tsx`、`DeleteLinkedDialog.tsx`、`ConvertLinkedDialog.tsx`、`NameConflictDialog.tsx`、`ContentDuplicateDialog.tsx`、`ImportConflictDialogShell.tsx`、`PluginTrustPromptDialog.tsx`、`AiConfigDialog.tsx`、`ScriptSandboxPreviewDialog.tsx` 等。

统一对象：

- `ModalStack`：顶层判定、Escape、焦点恢复、背景 inert、嵌套对话框；修复当前 focus trap 只查第一个 dialog 的隐患；
- `DialogShell`：backdrop、surface、标题/描述关联、关闭按钮、content scroll、footer；
- `DialogHeader`、`DialogBody`、`DialogActions`；
- `ConfirmDialog`：info、warning、danger 三种语义，危险操作必须显式使用 danger action；
- `ConflictDialogShell`：把冲突条目、选项列表和确认动作作为 slot，不能再复制整套 dialog surface；
- 尺寸只提供 `compact`、`form`、`wide`、`workspace` 四档，特殊尺寸需要写出原因。

必须补齐的行为契约：每个阻塞 dialog 有稳定标题 ID、`aria-labelledby`/`aria-describedby`，打开时焦点落在规定控件，关闭后恢复到触发源；嵌套 dialog 只能操作最顶层；Enter/Escape 语义与按钮危险级别一致。

### 3.4 设置与表单

涉及 `AppSettingsDialog.tsx`、`AppSettingsPages.tsx`、`AppSettingsNavigation.tsx`、`LibrarySettingsDialog.tsx`、`PluginSettingsPage.tsx`、`plugin-settings-detail.tsx`、`plugin-host-settings-fields.tsx`、`AiConfigDialog.tsx`、`TagManagementWorkspace.tsx` 以及各类 filter/settings row。

内部 library 的语义组件：

- `SettingsPage`、`SettingsNavigation`、`SettingsSection`、`SettingsRow`；
- `Field`、`FieldLabel`、`FieldDescription`、`FieldError`；
- `TextField`、`TextArea`、`NumberField`、`Select`、`Combobox`、`Switch`、`Slider`、`Checkbox`、`RadioGroup`；
- `ActionRow`、`ResetAction`、`InlineValidation`。

设置页面不直接拼 class 来表达布局。组件必须统一支持 label/description/error/help、disabled/read-only、loading、keyboard focus、validation 和 dirty state。应用设置、资源库设置、插件设置可以有不同数据源和保存时机，但要共用同一 row/section/layout contract。

现有插件 Host settings 的 boolean/number/string/select 类型继续作为数据输入层，不应继续把 `app-settings-toggle-row` 等宿主 class 当成插件 API。Host 应把 manifest 解析成 `HostSettingDescriptor`，再交给内部组件渲染；非法字段只产生字段级错误，不使整页失效。

### 3.5 反馈、加载与后台任务

涉及 `toast-notifications.ts`、`WorkspaceNoticeBanner.tsx`、`PluginJobActivityBanner.tsx`、`MediaJobsDialog.tsx`、`FatalAlertDialog.tsx`、AI progress/error 组件和各页面 loading/empty/error 状态。

统一语义而不是把所有反馈做成一个组件：

| 语义 | 生命周期 | 适用内容 | 层级 |
| --- | --- | --- | --- |
| `Toast` | 短暂、自动消失 | 成功/info 的即时结果 | 全局 notice layer |
| `Notice` | 持续到用户处理或状态结束 | warning/error、需要 action 的提示 | 全局 notice layer |
| `ActivitySurface` | 与任务生命周期绑定 | Job 阶段、进度、取消/后台运行 | activity layer；可打开任务中心 |
| `Dialog` | 阻塞当前流程 | 必须确认或修复后才能继续 | modal layer |
| `StateSurface` | 占据业务区域 | loading、empty、error、offline | 当前 pane |

进度组件只负责展示明确的 `value/max/label/message/phase`，不自行推断超时，也不把 `running` 这种内部状态直接暴露给用户。插件 Job 是否结束、是否可取消、是否可重试由 Job 契约决定；应用重启后的行为由 `Serpent-wjm5` 定义。

### 3.6 资产卡片、画布与选择

涉及 `App.tsx` 中资产卡片实现、`AssetCardMedia.tsx`、`asset-card-badges.ts`、`FolderCard.tsx`、`TextAssetPreviewTile.tsx`、`SequenceFrameCanvas.tsx`、`justified-asset-rows.tsx`、`masonry-preview-frame.tsx`、拖拽/选择辅助模块。

建议抽取：

- `SelectableSurface`：选中描边、高亮、focus-visible、拖拽态、禁用态；
- `PreviewFrame`/`DecodedMediaFrame`：图片、视频、GIF、序列帧、文本预览的尺寸和失败态；
- `CardCaptionBand`、`CardBadgeStack`、`AssetSourceBadge`；
- `AssetCard` 只保留资产语义；`FolderCard` 只保留文件夹语义，二者共享 surface/preview/caption，不合并业务数据模型；
- `CanvasLayout`、`MasonryGrid`、`JustifiedRows` 负责布局，选择顺序和命令 dispatch 保持独立。

卡片的选中状态不能由某个 toggle 的 value 反推。选择是领域状态，视觉描边、高亮、键盘 anchor 和多选范围都应由统一 selection adapter 提供。

### 3.7 Inspector、查看器和媒体控制

涉及 `InspectorPanel.tsx`、`InspectorCardFeelProvider.tsx`、`AssetPreviewModal.tsx`、`ImageSequencePlayer.tsx`、`VideoPlayerControls.tsx`、`AudioPlayerControls.tsx`、`ViewerVolumeControls.tsx`、`TextViewerControls.tsx`、`SequenceFrameCanvas.tsx`。

可以共享的基础部件：

- `InspectorSection`、`InspectorField`、`InspectorPreview`、`InspectorEmptyState`；
- `TimelineScrubber`、`MediaTransportBar`、`PlayPauseButton`、`FrameStepButton`、`VolumeControl`；
- `ProgressTrack`、`TimecodeLabel`、`MediaStatusBadge`；
- `ViewerOverlaySurface` 和 `ViewerContextMenu` 的 surface/layer/close contract。

不能抽成一个万能 Viewer：媒体解码能力、序列帧帧号、音频波形、EXR 通道、文本内容和 Inspector 的多选编辑都由 domain adapter 提供。抽象只覆盖控制条语义、焦点和视觉状态。

### 3.8 插件视图与脚本 UI

涉及 `plugin-iframe-view-host.tsx`、`plugin-workspace-views.tsx`、`plugin-sidebar-views.tsx`、`plugin-inspector-views.tsx`、`plugin-viewer-overlays.tsx`、`plugin-settings-pages.tsx`、`ScriptSandboxPreviewDialog.tsx`。

插件视图统一使用 `ContributionViewHost`：负责实例/贡献校验、iframe 生命周期、theme bridge、错误/加载/空状态和销毁；各 surface 只提供位置和尺寸。Tab 列表统一 `ContributionTabs`，具备 tablist/tab/tabpanel 语义、roving focus 和 active 状态。

脚本预览仍是隔离执行环境，不共享插件 iframe 的权限边界；它可以复用 DialogShell、StateSurface 和代码/日志面板的视觉部件，但不能获得任意宿主 DOM。

## 4. 内部 UI library 设计

### 4.1 分层

建议在 `src/renderer/ui/` 建立明确分层，最终目录名可以在实现工单开始前微调：

```text
ui/
  tokens/       语义颜色、间距、尺寸、字体、圆角、阴影、层级
  primitives/   Button、IconButton、TextField、Select、Switch、Slider、Progress
  patterns/     Field、Tabs、Menu、Popover、Dialog、SettingsRow、Notice
  surfaces/     ShellChrome、Pane、Card、Inspector、Viewer、Activity、PluginHost
  testing/      state matrix、ARIA、主题和视觉 contract helpers
```

依赖方向只能从上到下：domain surface 可以依赖 pattern/primitive；primitive 不能依赖 App、插件 registry 或具体业务数据；插件 adapter 只能依赖公开的 semantic descriptor 和 Host renderer，不依赖内部 CSS 文件。

### 4.2 Token 体系

保留现有 Studio Contact Sheet 的方向：4px 基准间距、44px toolbar、12px pane gutter、4–6px 常规 radius、内容优先、无夸张玻璃感。把现有 CSS 变量逐步归纳为语义 token：

- surface：`canvas`、`pane`、`raised`、`raisedSubtle`、`overlay`；
- content：`text`、`textSecondary`、`textTertiary`、`textDisabled`、`textOnAccent`；
- border/focus：`divider`、`controlBorder`、`focusRing`、`selectionRing`；
- action：`accent`、`accentSoft`、`hover`、`pressed`、`active`；
- status：`success`、`warning`、`danger`、`info` 及其 surface/text 组合；
- geometry：`controlSm/ControlMd/ControlLg`、`radiusControl/Surface/Dialog/Pill`、`space1…space6`；
- typography：`label`、`body`、`caption`、`title`、`mono`；
- elevation/layer：`menu`、`popover`、`activity`、`notice`、`modal`，对应统一 z-index contract。

不要求一次删除旧变量。迁移期间旧变量只能由适配层映射到语义 token，并禁止新组件继续使用无语义的 `--surface`、`--border` 或页面私有 z-index。

### 4.3 组件状态与可访问性

每个 interactive primitive 在设计和测试中必须声明状态矩阵：default、hover、focus-visible、pressed、selected、disabled、invalid、loading、readonly、indeterminate（适用时）。组件同时声明：

- DOM role 和键盘行为；
- label/description/error 的关联方式；
- 是否能被 roving focus 管理；
- pointer、keyboard、screen reader 的等价动作；
- light/dark theme 下的对比度和 disabled 语义。

例如 `Switch` 不只是 `.app-settings-toggle-control` 的样式；它需要稳定的 checked/disabled/label contract。`MenuItem` 不只是一个 `<button>`；submenu、checkbox、radio、danger 和 shortcut 都必须在 `ResolvedMenuTree` 中表达。

## 5. 插件结构化 UI 设计

### 5.1 三种扩展层级

插件 UI 分为三层，不能混用：

1. **Contribution UI**：菜单、toolbar、Inspector action、Viewer action、sidebar/workspace 入口。插件提供语义贡献，Host 负责渲染。
2. **Host-rendered standard UI**：设置页、配置表单、轻量工具页。插件提供受限的语义树，Host 负责控件、布局、主题、ARIA、验证和事件。
3. **Custom isolated UI**：复杂交互、自由布局、图形化工具。继续使用 sandbox iframe，通过 typed bridge 调用命令、storage 和受限上下文；不承诺宿主 React/CSS 兼容。

这使“普通组件写法、Host 样式”变成真正可维护的契约：插件不需要知道 Host 内部组件实现，但可以组合 Host 支持的语义节点。

### 5.2 统一命令与贡献模型

建议把所有 Host-rendered contribution 归一到以下概念：

```ts
type CommandDefinition = {
  id: string;
  title: LocalizedText;
  shortcut?: Shortcut;
  run: InvocationTarget;
};

type ContributionNode =
  | { kind: "command"; id: string; command: string; placement?: Placement; state?: NodeState }
  | { kind: "submenu"; id: string; title: LocalizedText; children: ContributionNode[]; state?: NodeState }
  | { kind: "section"; id: string; title?: LocalizedText; children: ContributionNode[] }
  | { kind: "separator"; id: string };

type NodeState = {
  when?: ContextExpression;
  enablement?: ContextExpression;
  checked?: ContextExpression;
};
```

这是设计形态，不是立即提交的公共 TypeScript API。关键是不再让内置菜单、插件菜单、toolbar 和快捷键各自定义自己的 item 类型。Host 先解析成统一的 `ResolvedContributionTree`，再由 Menu、Toolbar 或 action surface adapter 渲染。

### 5.3 Context 与条件

UI context 保持有界快照，至少覆盖 app/window/surface/library/selection/browse/viewer 等既有设计域：当前资源库、选中资产摘要和数量、当前浏览文件夹/合集、查看器资产、媒体类型、是否托管资产、权限和插件实例范围。不要把完整资产内容、任意路径读写或全套 Gateway API 塞进 context。

- `when=false`：节点及其子树隐藏；
- `enablement=false`：节点保留但置灰，并给出稳定的 disabled reason（如果产品需要）；
- `checked`：只表达 toggle/check 状态，不代替业务执行结果；
- 菜单打开不等待插件执行；异步 predicate 只能提前计算并缓存 namespaced context key；
- `contextId + revision + pluginInstanceId` 冻结一次 resolve，避免菜单在用户点击前改变结构；
- 所有 surface 使用相同条件语义，不允许 toolbar 可见性和 menu 可见性各写一套判断。

功能命令获得的 invocation context 可以比 UI context 更丰富，但应由命令执行入口明确提供，不能通过渲染层绕过权限。

### 5.4 Host-rendered 设置和语义 UI DSL v1

推荐的 descriptor 不是 XML，也不是任意 JSX，而是版本化的 JSON/TypeScript 数据：

```ts
type PluginUiNode =
  | { kind: "page"; id: string; title: LocalizedText; children: PluginUiNode[] }
  | { kind: "section"; id: string; title?: LocalizedText; children: PluginUiNode[] }
  | { kind: "field"; id: string; label: LocalizedText; description?: LocalizedText; control: ControlDescriptor; binding: Binding }
  | { kind: "action"; id: string; label: LocalizedText; command: string; state?: NodeState }
  | { kind: "status"; id: string; tone: "info" | "success" | "warning" | "error"; message: LocalizedText };

type ControlDescriptor =
  | { kind: "toggle"; defaultValue?: boolean }
  | { kind: "text"; defaultValue?: string; multiline?: boolean; placeholder?: LocalizedText }
  | { kind: "number"; min?: number; max?: number; step?: number }
  | { kind: "select"; options: readonly { value: string; label: LocalizedText }[] }
  | { kind: "slider"; min: number; max: number; step?: number };
```

上述字段是设计方向，最终 schema 必须在实现前单独冻结。v1 的约束：

- 节点 ID、绑定 key、命令 ID 稳定；重复 ID、循环引用、过深树和不合法范围在注册时拒绝；
- 布局只允许 Host 定义的 stack/section/grid 变体，不允许任意 CSS、像素坐标或 HTML；
- label、description、help、error、loading、disabled、visible、enabled 都是语义字段；
- binding 只能绑定插件设置或 command input，不能绑定宿主 DOM；
- options、min/max/step、默认值和持久化值在 Host 校验；未知旧设置可以保留但不渲染；
- 插件不能通过 descriptor 改写全局 token、z-index、字体或宿主布局；
- 动态状态引用 Context Key/受控状态，不在 render 过程中执行任意代码；
- 控件的中文/英文文案和本地化由 descriptor 提供，最终排版由 Host 控制。

暂不发布一个要求插件依赖的 React 包。第一版应发布 schema、校验器、fixtures 和 Host renderer；等内部 library 稳定，再考虑给 iframe 提供可选的 Web Components/typed UI kit。

### 5.5 文档和协议需先校准的冲突

实现前必须先修正文档/schema 的不一致：

- `0024` 的菜单示例允许 leaf 同时有 `id` 和 `command`，当前 manifest schema 对 command item 的 `id` 约束不同；必须选定一种规范并让示例、schema、fixture、resolver 一致；
- `manual/plugins/development.md` 目前把 Host-rendered settings 视为可用，但仍是实验性配置 schema，不应暗示插件可以使用宿主 CSS；
- `plugin-themes` 中 `theme.trusted-css` 容易被理解为可注入宿主 CSS，设计上应明确它只影响隔离 iframe 的 token/theme bridge，除非另有安全审查；
- 菜单贡献已经支持 submenu/when/enablement/checked，但 toolbar、Inspector、Viewer 和快捷键的统一条件与最终 resolved tree 证据还不完整；
- 现有 `ResolvedMenuItem` 和核心菜单 JSX 对 icon、danger、separator、submenu、checked、close 行为的表达不完全一致，需要由统一模型补齐。

## 6. 实施顺序

### 阶段 0：冻结设计与契约

- 关闭文档/schema 冲突；
- 建立 token、layer、component state、ARIA、命名和目录规范；
- 给 `Serpent-nzxh` 拆分子工单，但不把当前设计分析误标为实现完成；
- 确定插件 DSL v1 的 schema version、错误报告和拒绝策略。

### 阶段 1：内部基础层

- tokens、theme mapping、layer contract；
- Button/IconButton/TextField/Select/Switch/Slider/Progress/Tooltip；
- ModalStack、focus trap、Escape stack、roving keyboard 基础；
- primitive 的 light/dark/state/ARIA 定向测试。

### 阶段 2：高复用表面

- DialogShell/ConfirmDialog/ConflictDialogShell；
- MenuSurface/MenuNode/PopoverSurface/OptionList；
- Field/SettingsSection/SettingsRow/SettingsNavigation；
- Notice/Toast/ActivitySurface/StateSurface。

### 阶段 3：应用领域表面

- Shell/Panes/toolbar/navigation；
- 资产卡片、文件夹卡片、画布 layout；
- Inspector、Viewer、媒体 transport/timeline；
- 在每次迁移中保留现有业务行为，删除重复 CSS，而不是建立新一套平行 class。

### 阶段 4：统一插件交互渲染

- 内置和插件贡献统一 command/Context/condition/placement/resolved tree；
- 递归隐藏、空 submenu、快捷键、menu/toolbar/Inspector/Viewer contract tests；
- ContributionViewHost/ContributionTabs 收口各插件视图 wrapper。

### 阶段 5：插件 Host-rendered UI DSL

- 先以 settings/sections/fields/actions/status 为 v1；
- manifest/descriptor → validator → Host renderer → typed event/command；
- 提供 schema、开发文档、fixture 和失败示例；
- 在实际插件完成一条完整纵向路径后再扩大控件种类和布局。

### 阶段 6：清理和发布门禁

- 删除不再使用的旧 class/变量；
- 检查所有 UI 入口都落在标准组件或有记录的 domain exception；
- 更新插件、脚本、MCP 用户文档；
- 以当前构建跑 unit/typecheck/lint/核心 Electron E2E，并进行独立 Computer Use 视觉验收；
- 维护“四列可追溯”：需求、实现位置、自动化测试、人工/平台证据。

## 7. 验收与测试设计

标准化不能只用截图或 snapshot 判断。每个阶段至少需要：

| 层级 | 必须证明的内容 |
| --- | --- |
| schema/纯函数 | descriptor 校验、默认值、字段级错误、Context expression、placement、隐藏父树、空 submenu、快捷键冲突 |
| primitive | state matrix、ARIA、键盘、focus-visible、disabled/invalid/loading、亮暗主题 |
| pattern | Dialog 顶层焦点、Menu roving/submenu、Popover 关闭、Settings validation、Notice 层级 |
| domain | 资产多选、查看器媒体、Inspector 多资产、导入/冲突/删除等业务动作不回归 |
| 插件 fixture | menu/toolbar/Inspector/Viewer 使用同一 command/context；settings DSL 正常、非法字段局部失败；iframe 仍隔离 |
| Electron E2E | 完整启动、开库/切库、导入、查看、菜单、设置、插件贡献和任务入口；每次跨 Renderer/Main/Worker 修改都重跑核心旅程 |
| 人眼验收 | 主窗口、弹窗、菜单、picker、通知、任务、查看器在亮/暗主题和不同窗口尺寸下无跳动/遮挡/层级错误 |

重点回归场景：

- 切换文件夹时插件侧栏入口不闪烁；
- 全局通知位于统一 notice layer，不被设置 dialog 遮挡；
- 插件菜单隐藏父项时 child 不残留；
- 插件设置列表加载/刷新不破坏当前页面；
- 资源库关闭/重开不把插件 Job 当成跨应用恢复任务（由 `Serpent-wjm5` 单独验收）；
- nested dialog 的焦点和 Escape 不操作底层窗口；
- 多选资产的卡片描边、context menu 数量和命令 context 一致；
- viewer/media 的预览实际解码，不只验证 DOM 或进度文字。

## 8. 非目标与明确拒绝项

- 不做 XML；结构化 JSON/TypeScript descriptor 足够表达树、顺序、条件和控件；
- 不提供通用 Host GPU/CPU/内存/显存 API；插件需要硬件信息时通过自己的完整脚本/运行时能力获取；
- 不允许插件通过 UI context 取得完整领域数据或绕过权限；
- 不允许插件注入宿主 DOM、React、任意 CSS、z-index 或事件监听器；
- 不把任意 Python 回调塞进菜单 `when`；动态条件使用受限 Context Key/predicate；
- 不在本 Epic 里设计新的视觉风格；先把现有 Studio Contact Sheet 方向结构化和一致化；
- 不为了复用把不同领域强行合并成一个万能组件；
- 不把插件 Job 的跨应用重启恢复重新加入 UI library，产品决定以 `Serpent-wjm5` 为准。

## 9. 当前状态

阶段 1 已开始实施，当前落地内容包括 `src/renderer/ui/` 的语义 tokens/layer contract、Button/IconButton、Field/TextField、Switch、Select、Progress、Tooltip、DialogShell、ModalStack、MenuSurface，以及设置页和插件 Host settings 的小范围接入。实现保留旧 `styles.css` 作为迁移适配层，尚未声称全量 UI 统一；Slider、完整 Settings patterns、业务菜单/Popover、插件管理页 toggle 和 Host-rendered UI DSL 仍属于后续阶段。

本阶段的自动化证据记录在 `docs/development/2026-08-04-ui-standardization-development-log.md`：定向单测、typecheck、lint 和插件设置/Shell Electron E2E 已执行；全量核心 E2E、Computer Use 视觉验收和其余业务 surface 迁移仍未完成。现有 `docs/development/2026-08-02-ui-reuse-audit.md` 继续作为菜单 token 审计和历史缺口记录；实现工单必须在四列证据齐全后分别关闭，不能因为本设计文档存在就将 `Serpent-nzxh` 标记为完成。
