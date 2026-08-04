# 0029：UI 标准化执行方案与插件原生 UI 契约

> 状态：设计完成，阶段实施中（Primitive、主题 profile 与高复用 feedback pattern 已落地）
> 日期：2026-08-04
> 关联工单：`Serpent-ex46`、`Serpent-ex46.1`、`Serpent-nzxh`、`Serpent-7nah`、`Serpent-fkq3`、`Serpent-gtih`
> 前置研究：[Obsidian UI 与插件机制调研](../research/2026-08-04-obsidian-ui-plugin-research.md)

## 1. 目标与成功标准

Serpent 的 UI 标准化不是一次 CSS 重命名，也不是把所有界面强行做成同一个卡片。目标是建立一套可持续的 UI 设计系统和插件 UI 公共契约，让应用内部和插件扩展遵守同一组语义、状态、可访问性、主题和布局规则。

本项目有三个产品目标：

1. **尽可能复用并保持一致**：相同交互语义使用相同的 primitive/pattern；不同领域只保留数据和业务差异，不复制菜单、设置、Dialog、状态反馈和媒体控制的基础行为。
2. **支持可控的自定义主题**：用户可以切换和自定义完整主题；插件可以引用公开语义 token，并在隔离范围内定义自己的 token；任何主题都不能破坏布局、可访问性、层级和交互状态。
3. **支持插件使用原生 UI**：常见的设置、菜单、通知、Job 状态、工具栏、Inspector 和面板入口由 Host 原生渲染；插件只提交版本化的结构化描述，不依赖宿主 DOM、React 类型或 CSS class。

完成不代表所有业务组件必须共用一个万能组件。完成的判断标准是：

- 同一语义只有一个公开的行为契约和一个主要实现入口；
- 组件的状态、键盘、ARIA、主题和层级行为可以单独测试；
- domain surface 通过 adapter 使用通用表面，而不是重新实现基础交互；
- 插件开发者不需要为 toggle、dropdown、slider、二级菜单、进度状态和字段错误重复造 UI；
- 需要自由布局的复杂插件 UI 仍然可以实现，但通过隔离 Custom View，不进入 Host DOM。

## 2. 研究后的设计原则

### 2.1 借鉴 Obsidian：语义 token、注册式 View、声明式设置

Obsidian 的可借鉴点是：插件使用宿主公开的 CSS variables 来获得主题兼容性；常见 UI 通过注册式 API 进入宿主容器；声明式设置由宿主负责渲染、搜索、持久化和校验；复杂功能才使用自由渲染的 View。

Serpent 采用同样的分层，但保留更强的安全边界：普通插件不能直接访问宿主 DOM、任意文件系统、数据库或 Node API；Custom View 默认继续使用 sandboxed iframe/typed bridge。

### 2.2 借鉴 VS Code：Command、Context、Contribution 和 ThemeColor 统一

命令是行为源，菜单、工具栏、快捷键、命令面板和 Inspector/Viewer action 都引用稳定 command ID。`when` 负责是否出现，`enablement` 负责是否可用，`checked` 负责选中态；Context key 由 Host 管理并带命名空间、revision 和诊断。

主题使用命名语义颜色和 token，而不是插件猜测宿主颜色或依赖 CSS 选择器。Custom View 是标准 Host API 不足时的后备能力，必须仍然主题化并满足键盘和可访问性要求。

### 2.3 借鉴 IntelliJ Platform：Action System、UI Kit 和静态元数据

菜单、工具栏、快捷键和命令面板使用同一套 Action/Command；Action Group 可以嵌套成子菜单，位置通过 group/anchor 约束解决。设置和对话框使用平台 UI Kit，插件不能为每个表面复制控件；设置元数据尽量在加载插件 Worker 前可解析，以保持设置页面响应。

### 2.4 Serpent 自己的约束

- 不采用 XML；使用版本化 JSON/TypeScript descriptor，便于 Zod、JSON Schema、fixture、SDK 和协议测试。
- UI Context 只服务于显示和交互决策；功能执行继续使用完整 Domain/Gateway API。
- 不允许菜单打开时等待插件 RPC；Context 和条件求值必须由 Host 有界、可取消、可缓存地完成。
- 插件权限仍然是 capability/typed IPC/Worker 隔离，不照搬 Obsidian 的宽松社区插件权限。
- Job 不跨应用重启自动恢复；`interrupted` 是 Host 状态，不属于 UI 标准化的恢复语义。

## 3. 分层架构

依赖方向必须从上到下，禁止 primitive 依赖 App、插件 registry、领域数据库或具体业务数据。

```text
Renderer domain adapters
  ├─ AssetCard / FolderCard / Inspector / Viewer / Search / Settings page
  └─ Plugin contribution adapters
              │
              ▼
UI surfaces
  ├─ Shell / Pane / Card / Inspector / Viewer / Activity / PluginHost
              │
              ▼
UI patterns
  ├─ Menu / Popover / Dialog / Settings / Notice / Tabs / StateSurface
              │
              ▼
UI primitives
  ├─ Button / IconButton / TextField / Select / Switch / Slider / Progress
              │
              ▼
Theme and interaction contracts
  ├─ semantic tokens / layers / focus / keyboard / ARIA / density
              │
              ▼
Plugin UI Contract v1
  ├─ descriptor schema / validators / diagnostics / SDK types
```

### 3.1 Token layer

Token 层只表达语义，不表达具体页面 class。每个 token 具有稳定名称、类别、主题值、用途说明和可覆盖性。

```text
surface.canvas          主内容画布
surface.pane            侧栏、Inspector 等面板
surface.raised          卡片、浮起表面
surface.overlay         菜单、Popover、非阻塞覆盖层
content.primary        主文本
content.secondary      次要文本
content.muted          弱化文本
border.divider          分隔线
border.control          控件边框
border.focus            focus-visible 环
action.accent           主操作
action.hover            悬停
action.pressed          按下
state.info/success/warning/error
geometry.control.sm/md/lg
geometry.radius.control/surface/dialog/pill
typography.body/label/caption/title/heading/mono
elevation.surface/popover/modal/notice
layer.base/shell/menu/popover/activity/notice/modal/tooltip
```

Token 规则：

- light、dark 是必需主题；system 只是 Host 的解析策略，不作为第三套 token；
- 组件只能使用语义 token，禁止新增页面私有颜色和 z-index；
- 设计 token 与兼容旧 `styles.css` 的适配变量分开；迁移期间旧变量只能由适配层读取；
- token 变化必须能在不重载插件的情况下传播到 Host UI 和 Custom View；
- token 具有 contrast/disabled/focus 语义，不能只提供“正常状态”的颜色。

### 3.2 Primitive layer

Primitive 是无业务的可交互基础控件，必须有明确的 props、状态矩阵、DOM role、键盘规则和 ARIA 关系。

| Primitive | 必须覆盖的状态 | 特殊要求 |
| --- | --- | --- |
| `Button` | default/hover/focus/pressed/disabled/loading/danger | 文本、图标、危险级别和 loading 语义分开 |
| `IconButton` | default/hover/focus/pressed/disabled/selected | 必须有可访问名称和 tooltip 策略 |
| `TextField` | empty/focus/invalid/disabled/readonly/loading | label/description/error 通过 ID 关联 |
| `Select` | closed/open/focus/selected/disabled/invalid | 键盘上下选择、Escape、焦点恢复 |
| `Switch` | unchecked/checked/focus/disabled/loading | 使用真实 switch 语义，不由 CSS 推断值 |
| `Slider` | min/max/focus/dragging/disabled/invalid | 支持键盘步进、aria-valuemin/max/now |
| `Progress` | determinate/indeterminate/complete/error/cancelled | 不显示内部 `running`；由 label/phase/message 表达状态 |
| `Tooltip` | hidden/visible/delayed/keyboard | 不替代字段描述和错误 |
| `Separator` | horizontal/vertical | 不承担布局间距语义 |
| `Checkbox`/`RadioGroup` | checked/unchecked/indeterminate/disabled | 只在真实选择语义时使用 |

### 3.3 Pattern layer

Pattern 组合 primitive，提供可复用的交互结构：

- `MenuSurface`、`MenuItem`、`Submenu`、`MenuSection`、`MenuSeparator`；
- `PopoverSurface`、`OptionList`、`SearchablePicker`；
- `DialogShell`、`ModalStack`、`ConfirmDialog`、`ConflictDialogShell`；
- `SettingsPage`、`SettingsNavigation`、`SettingsSection`、`SettingsRow`、`Field`；
- `Tabs`、`TabList`、`TabPanel`；
- `Toast`、`Notice`、`ActivitySurface`、`StateSurface`；
- `TimelineScrubber`、`MediaTransportBar`、`VolumeControl`。

Pattern 负责结构、交互和可访问性，不读取领域数据。领域 adapter 只负责将资产、Job、设置、媒体状态映射成 pattern props。

### 3.4 Surface layer

Surface 是应用可见的稳定表面，允许保留领域差异，但必须复用下层契约：

- `ShellChrome`、`PaneShell`、`Toolbar`、`Breadcrumbs`、`NavigationTree`；
- `AssetCard`、`FolderCard`、`SelectableSurface`、`PreviewFrame`、`CardCaptionBand`；
- `InspectorSection`、`InspectorField`、`InspectorEmptyState`；
- `ViewerSurface`、`ViewerOverlaySurface`、`MediaControls`；
- `ActivityPanel`、`PluginJobActivity`、`PluginContributionViewHost`。

资产卡片和文件夹卡片不合并领域模型，只复用选择、预览、标题、badge 和状态表面。图片、视频、GIF、序列帧、音频、文本和 EXR 不合并成万能 Viewer，只复用 transport、timeline、状态和 overlay 行为。

## 4. 全量 UI 抽象与迁移矩阵

下面是迁移时必须覆盖的 Renderer UI 范围。每一行都需要最终补上实现文件、自动化测试和人工证据。

| 范围 | 共享抽象 | 保留的领域差异 | 迁移门槛 |
| --- | --- | --- | --- |
| Shell/导航 | ShellChrome、PaneShell、Toolbar、Breadcrumbs、NavigationTree | 资源库生命周期、窗口按钮、导航数据 | 切换库/折叠/窗口尺寸不闪烁 |
| 菜单/二级菜单 | MenuSurface、MenuNode、Context resolve、Placement Solver | 资产/文件夹/合集数据 | 隐藏父项递归隐藏 child；不留空 submenu；键盘焦点稳定 |
| Popover/Picker | PopoverSurface、OptionList、SearchablePicker | 标签、合集、色彩空间、筛选数据 | 定位、Esc、外部点击、焦点恢复一致 |
| Dialog/确认 | ModalStack、DialogShell、Confirm、Conflict | 业务内容、确认策略、冲突条目 | 标题/描述 ARIA、Enter/Esc、嵌套焦点一致 |
| 设置 | SettingsPage/Section/Row/Field、控件 primitives | 应用/资源库/插件数据源和保存时机 | 字段错误、dirty、搜索、导航和布局一致 |
| 通知/Job | Toast、Notice、ActivitySurface、Progress | Job 类型、失败资产、阶段数据 | 层级、关闭、取消、完成和失败状态一致 |
| 资产卡片/画布 | SelectableSurface、PreviewFrame、Caption、Badge、CanvasLayout | 资产与文件夹的领域内容 | 多选、键盘、重排可见集合和预览解码不回归 |
| Inspector | InspectorShell、Section、Field、EmptyState | 资产元数据和多选编辑 | 单选/多选/不可用状态一致 |
| Viewer/媒体 | ViewerSurface、MediaTransport、Timeline、Overlay | 解码、媒体格式、序列帧、EXR 通道 | 切换资产不跳动；键盘/鼠标/触控板语义统一 |
| 插件视图 | ContributionViewHost、ContributionTabs、ThemeBridge | 插件的特殊内容和面板状态 | 入口与内容生命周期分离；reload/close/crash 可恢复 |
| 脚本/MCP UI | DialogShell、StateSurface、Notice、LogPanel | 自动化命令和诊断内容 | 权限、错误、确认与 Host UI 语义一致 |

迁移顺序遵守“先高复用、后高风险”：先 primitives/patterns，再菜单/设置/Dialog/Notice，再 Shell/Card/Inspector/Viewer，最后迁移插件 descriptor 和 Custom View bridge。

## 5. Theme Contract v1

### 5.1 主题层级

```text
Host default light/dark tokens
  → User selected theme / user appearance overrides
  → Library/workspace scoped appearance (如果产品启用)
  → Plugin public token references
  → Plugin-owned namespace tokens
  → Custom View local styles
```

层级规则：

- 用户主题决定 Host 的基础 token；
- 插件不能覆盖 Host 的 layout-critical token、全局 font、全局 reset、layer/z-index 和 DOM selector；
- 插件可以声明 `theme.references` 使用公开 semantic token；
- 插件可以声明 `theme.tokens`，但只能写入 `plugin.<pluginId>.*` 自有命名空间；
- 自有 token 必须由插件 Custom View 使用，不能影响其他插件或 Host；
- Host-rendered descriptor 只能引用 Host 公开 token，不能读取插件私有 CSS；
- 无效主题字段只拒绝该主题贡献，不使插件其他命令和设置消失；
- 禁用、卸载和版本切换必须撤销插件 token，不留下残留变量。

### 5.2 建议的 Manifest 形状

这是设计目标，不是当前发布 API：

```jsonc
{
  "contributes": {
    "themes": [
      {
        "id": "image-upscaler-theme",
        "references": {
          "accent": "action.accent",
          "panel": "surface.raised",
          "mutedText": "content.secondary",
          "error": "state.error"
        },
        "tokens": {
          "modelBadge": "#8b5cf6",
          "queueSurface": "color-mix(in srgb, var(--ui-surface-raised) 88%, #8b5cf6)"
        },
        "light": {},
        "dark": {}
      }
    ]
  }
}
```

第一版实现不直接接受任意 CSS 字符串。颜色值、长度、字体和渐变值需要按字段类型、长度和安全语法校验；`color-mix` 等能力应先通过 allowlist 明确支持，不能用宽松字符串校验伪装安全。

### 5.3 主题传播

Host 必须向所有已挂载的 Plugin View 发送结构化 theme event：

```ts
type PluginThemeChanged = {
  type: 'plugin-ui.theme-changed';
  theme: 'light' | 'dark';
  contrast: 'normal' | 'high';
  tokens: Record<string, string>;
  revision: number;
};
```

主题事件必须：

- 带 revision，防止旧 iframe 事件覆盖新主题；
- 在主题切换、插件 reload、View remount 时可重复发送；
- 不包含绝对路径、用户凭据或任意 Host 状态；
- 对被销毁的 iframe 不再发送；
- 有单测覆盖 light/dark、插件覆盖、无效 token、回滚和旧 revision。

## 6. Plugin UI Contract v1

### 6.1 三种插件 UI 层级

#### A. Host-rendered semantic UI

适用于设置、菜单、工具栏、Inspector action、Viewer action、通知、Job 状态和简单表单。插件提交 descriptor，Host 负责渲染、主题、焦点、ARIA、校验、持久化和权限显示。

#### B. Host-managed View

适用于插件侧栏、工作区、Inspector、Viewer overlay 和 settings page。Host 负责入口、实例、scope、尺寸、主题 bridge、加载态、错误态、销毁和恢复；内容可以是隔离 iframe。

#### C. Custom isolated UI

适用于模型预览、复杂图表、自由布局画布、特殊媒体工具和第三方 Web UI。仍使用 sandboxed iframe/typed bridge；不授予宿主 DOM、React、任意 CSS 或任意 IPC。

### 6.2 Descriptor 通用结构

```ts
type UiDescriptorV1 = {
  version: 1;
  id: string;
  title?: LocalizedText;
  description?: LocalizedText;
  icon?: PublicIconId;
  when?: ContextExpression;
  enablement?: ContextExpression;
  children?: UiDescriptorV1[];
};
```

所有 descriptor 必须：

- 在安装/激活时做静态 schema 校验；
- 具有稳定 local ID，并在插件实例范围内唯一；
- 限制深度、节点数、文案长度和 options 数量；
- 不包含函数、JS、Python、HTML、React element 或任意 CSS class；
- 动态值只通过有界 typed bridge 或 Host context 更新；
- 字段级错误不会清空整个插件 UI；
- 贡献撤销时按 `pluginInstanceId` 清理，不能只按 plugin ID。

### 6.3 Settings Descriptor

```ts
type SettingDescriptorV1 =
  | {
      type: 'group';
      id: string;
      title: LocalizedText;
      children: SettingDescriptorV1[];
    }
  | {
      type: 'field';
      id: string;
      key: string;
      control: 'toggle' | 'select' | 'slider' | 'number' | 'text' | 'secret';
      label: LocalizedText;
      description?: LocalizedText;
      default?: JsonValue;
      options?: Array<{ value: string; label: LocalizedText }>;
      min?: number;
      max?: number;
      step?: number;
      visible?: ContextExpression;
      enablement?: ContextExpression;
      validation?: ValidationDescriptor;
    }
  | {
      type: 'action';
      id: string;
      command: string;
      label: LocalizedText;
      enablement?: ContextExpression;
    };
```

设置要求：

- Host 可以在不启动插件 Worker 的情况下构建导航和静态字段；
- `select` 当前值不在 options 中时回退 default 并报告字段级 diagnostic；
- 未声明旧值保留在 storage，但不渲染；
- `visible` 隐藏字段不自动删除其值；
- `enablement` 置灰而不是隐藏；
- secret 只保存引用，不把 secret 值写入普通 settings response 或 UI Context；
- 异步校验必须有 timeout、取消和安全错误码，不能阻塞整个设置页面；
- `render`/Custom Field 只能作为明确的隔离扩展点，不能成为普通字段的默认路径。

### 6.4 Menu Descriptor

菜单继续使用 `Command Registry + ResolvedMenuTree`，并统一内置与插件贡献：

```ts
type MenuDescriptorV1 = {
  surface: 'asset' | 'folder' | 'collection' | 'workspace' | 'viewer';
  items: Array<{
    type: 'command' | 'submenu' | 'separator';
    id: string;
    command?: string;
    title?: LocalizedText;
    children?: MenuDescriptorV1['items'];
    group?: string;
    before?: string;
    after?: string;
    first?: boolean;
    last?: boolean;
    when?: ContextExpression;
    enablement?: ContextExpression;
    checked?: ContextExpression;
  }>;
};
```

菜单 resolve 规则：

- `when=false` 的节点不进入树；
- 父项不可见时递归隐藏全部 child；
- child 全部不可见时不渲染空 submenu；
- 父项可见但 child 全部 disabled 时按明确策略显示 disabled parent，不伪装成可用菜单；
- `when`、`enablement`、`checked` 在一次 resolve 中冻结；
- 菜单打开不等待插件 RPC；
- shortcut 只来自 Keybinding Registry；
- 相对定位只在同一语义 group 中求解；循环、缺锚点、深度超限只影响相关分支并产生诊断；
- 多选不因菜单未声明数量条件而被 Host 默认排除。

### 6.5 State、Notice 和 Job Descriptor

插件 Job 的 Host UI 只接受结构化状态：

```ts
type ActivityStateV1 = {
  id: string;
  title: LocalizedText;
  phase?: LocalizedText;
  message?: LocalizedText;
  completed?: number;
  total?: number;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  canCancel?: boolean;
  canRetry?: boolean;
};
```

UI 不把 `running` 直接显示给用户；状态通过“处理中”、阶段、消息和百分比表达。Host 不推断插件超时；超时/取消/失败由插件 Job 契约和 Host 调度器分别负责。

## 7. View Contract

每个插件 View 是有稳定身份和生命周期的面板实例，不是侧栏按钮的副作用：

```ts
type PluginViewInstanceV1 = {
  viewType: string;
  instanceId: string;
  pluginInstanceId: string;
  scope: 'global' | 'library';
  libraryId?: string;
  state: JsonObject;
  ephemeralState?: JsonObject;
};
```

生命周期：

```text
registered → available → mounted → active/inactive → unmounted → disposed
                                  └→ failed → retrying / disposed
```

要求：

- `setup(context)`/`dispose(reason)` 仍然是插件实例生命周期，不增加 `openLibrary`；
- View 另有 mount/unmount/resize/theme-changed 事件；
- View 入口由 Host contribution tree 持有，内容加载失败不撤销入口；
- 资源库切换只更新对应 scope 实例，不撤销其他库或 global 实例贡献；
- iframe crash、插件 reload、应用关闭和库关闭都走确定性 dispose；
- 可持久化 state 不得包含绝对路径、secret 或过大的资产对象；
- 重型 View 支持延迟挂载，不因启动时扫描所有 View 拖慢应用。

## 8. 可访问性、交互状态和诊断

每个 primitive/pattern 必须维护状态矩阵：

```text
default / hover / focus-visible / pressed / selected / disabled
invalid / loading / readonly / indeterminate / high-contrast
```

每个组件的测试记录：

- DOM role、label/description/error 关系；
- Tab、Arrow、Enter、Space、Escape 和 typeahead 行为；
- pointer、keyboard 和 screen reader 的等价动作；
- light/dark/high-contrast 的对比度和 disabled 语义；
- Portal、外部点击、焦点恢复、嵌套 surface 和窗口边界行为。

开发态增加 UI Inspector/diagnostic：

- Context 快照、revision 和命中条件；
- 菜单节点最终 visible/enabled/checked 原因、group 和 anchor；
- descriptor schema path、默认值、当前值和字段级错误；
- 当前 theme、token 来源层级和插件覆盖；
- View mount/unmount/resize/theme/dispose；
- Contribution 与 `pluginInstanceId` 的注册/撤销关系。

## 9. 实施阶段

### 阶段 0：冻结设计和契约

交付：本设计文档、Token/Descriptor JSON Schema、TypeScript 类型、错误码、fixture、四列追溯模板、插件开发文档更新。

退出条件：不再从内部 CSS class 或 React 结构推导插件 API；现有 `0028` 中的设计与本文件没有冲突，旧设计文档标明本文件为执行版。

### 阶段 1：完成 Theme/Token 与 Primitive

交付：token catalog、light/dark/system 解析、layer contract、Button/IconButton/TextField/Select/Switch/Slider/Progress/Tooltip/Field，状态和主题测试。

退出条件：新组件不新增页面私有 token；组件可在 Host 和插件 Host-rendered UI 中复用；旧 CSS 仍由 adapter 兼容，但有迁移清单。

### 阶段 2：完成高复用 Pattern

交付：Menu/Popover/Dialog/ModalStack/Settings/Notice/Activity/Tabs/StateSurface/MediaTransport。

退出条件：同类菜单、设置、Dialog、通知和 Job surface 至少各有一条主实现路径，键盘/ARIA/层级行为由共享 pattern 提供。

### 阶段 3：迁移应用领域 Surface

交付：Shell、Navigation、资产/文件夹卡片、Canvas、Inspector、Viewer、媒体控制和设置页面迁移。

退出条件：迁移覆盖矩阵每项都有实现位置、定向测试和人工/平台证据；不以截图 snapshot 替代真实交互证据。

### 阶段 4：统一插件交互渲染

交付：Command/Context/Keybinding/ResolvedMenuTree 统一；插件 menu、toolbar、Inspector、Viewer、侧栏入口、Job activity 使用共享 Host surface。

退出条件：隐藏父菜单递归隐藏 child；插件入口与 View 内容生命周期分离；global/library 多实例和多库贡献隔离。

### 阶段 5：发布 Plugin UI Contract v1

交付：Settings/Menu/Notice/Activity/Job/View descriptor validator、Host renderer、SDK 类型、fixtures、开发文档和错误诊断。

退出条件：Image Upscaler 类插件可以只用 Manifest + typed command + descriptor 实现 toggle/select/slider/设置页/进度/右键菜单，无需宿主 CSS 或 React。

### 阶段 6：清理、发布和兼容门禁

交付：旧 CSS/class 使用审计、死组件清理、文档、迁移日志、插件示例、自动化/E2E/Computer Use/packaged 证据。

退出条件：核心 UI 旅程和插件 UI 旅程在当前 HEAD 构建上通过；Windows 未验证项必须明确保留，不能写成已完成。

## 10. 测试策略与验收追溯

每个能力维护四列：

| 需求 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 语义 token light/dark | file:line | token/主题单测 | Computer Use 截图 |
| Switch/Select/Slider 状态 | file:line | state/ARIA 单测 | 设置页人工验收 |
| 父菜单隐藏递归 child | file:line | menu tree 单测 | 右键菜单人工验收 |
| descriptor 字段容错 | file:line | schema/store/Host 单测 | 插件设置 E2E |
| View 生命周期/主题 bridge | file:line | protocol/lifecycle E2E | 多库/切换库人工验收 |
| Job activity | file:line | worker/scheduler/E2E | 真实任务面板人工验收 |

测试分层：

1. 纯 token/descriptor/resolve/state 单测；
2. Host renderer pattern 单测；
3. plugin fixture + IPC/Worker 集成；
4. Electron E2E，必须隔离 userData；
5. 当前 HEAD packaged smoke；
6. Computer Use 真实界面验收，关注视觉一致性、焦点、切换和无闪烁。

UI 变化不能只跑 snapshot。涉及 Renderer/Preload/Main/Worker、自定义协议、CSP、媒体和持久化时，必须按仓库核心体验门禁重跑真实 Electron E2E。

## 11. 明确不做

- 不让插件直接注入 Host DOM/React/CSS class。
- 不开放任意全局 CSS 主题覆盖作为普通插件能力。
- 不在菜单打开时调用插件 RPC 或执行任意 Python/JavaScript predicate。
- 不把所有 domain surface 合并成一个万能 Card/Viewer/Dialog。
- 不因标准化而删除复杂媒体、模型预览和图形工具的 Custom View 能力。
- 不把应用重启后的 Job 恢复混入 UI 标准化。
- 不以“内部已有组件文件”作为全量标准化完成证据；必须有迁移和验收证据。

## 12. 当前状态与下一步

已有 `src/renderer/ui/` foundation、tokens、layers、Button/TextField/Select/Switch/Slider/Progress/Tooltip、Dialog/Menu/Popover/Settings/Notice/Activity patterns，以及版本化用户主题覆盖和 `contributes.themes` iframe token bridge。阶段 1 的 Theme Contract、阶段 2 的 primitive/feedback 基础、Shell/Pane/Card/Viewer domain surfaces 和 Plugin UI Contract v1 descriptor 基础已落地；descriptor 已接入设置分组和插件菜单的实际 Host 路径，Navigation/Canvas/Workspace overflow 也已迁移到共享 surface/pattern，但 Job/Notice 的运行时声明入口、更多媒体 surface、E2E/Computer Use 仍未完成。

实施顺序：

1. 提交本设计文档并在 Beads 中创建阶段子工单；
2. 完成 Token/Theme Contract 和 primitive 状态/ARIA 测试；（已完成基础增量，提交 `f46b2e0`、`a536f97`）
3. 迁移 Menu/Dialog/Settings/Notice/Activity 等高复用 pattern；（已完成基础实现，仍需旧 CSS/class 审计）
4. 迁移应用领域 surface；（已落地 FolderCard/Inspector/Viewer、Navigation/Canvas/Workspace overflow 基础迁移，更多媒体控制仍在推进，提交 `8cab211`、`0c87b2f`）
5. 实现并发布 Plugin UI Contract v1；（descriptor、Host renderer、manifest/IPC、设置分组和菜单接入已落地；运行时 Job/Notice 入口仍在推进）
6. 由独立审查和 Computer Use/packaged QA 完成最终验收。

本设计文档是执行版。若实施中需要改变主题优先级、插件 descriptor 范围或安全边界，必须先更新本文件和对应 Beads 工单，再改代码。
