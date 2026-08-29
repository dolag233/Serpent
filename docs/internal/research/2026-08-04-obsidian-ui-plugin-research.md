# Obsidian UI 与插件机制调研

> 调研日期：2026-08-04  
> 调研范围：Obsidian 官方帮助文档、官方开发者文档、官方 `obsidian-api` 类型定义仓库。  
> 目的：研究 Obsidian 的主题、插件 UI、CSS 变量、样式片段、Workspace/View/Setting API、生命周期和权限边界，提炼 Serpent 可借鉴的设计。  
> 来源约束：本文只使用 Obsidian 官方一手来源；“对 Serpent 的判断”属于基于这些事实的产品/架构推论。

## 结论摘要

Obsidian 值得学习的核心不是“让插件直接改宿主 DOM”，而是把扩展能力分成三层：

1. **宿主设计语言层**：宿主提供稳定的语义 CSS 变量、基础组件和布局约定；插件使用变量和公开组件能力，自动获得主题兼容性。
2. **结构化扩展点层**：命令、设置、View、Workspace leaf、状态栏、Ribbon 等都有明确的注册点；插件声明“是什么”，宿主负责把它放进一致的界面结构中。
3. **自由渲染层**：需要特殊交互时，插件仍然可以渲染自己的 HTML/CSS，但必须通过宿主提供的容器、生命周期和主题变量与宿主协作。

这是一种比“插件只能使用固定几个 UI 字段”更成熟、也比“插件可以随意注入 CSS/DOM”更可控的中间路线。Serpent 应重点借鉴“语义 token + 声明式设置/页面 + 注册式 View + 可控自由渲染”，不要直接复制 Obsidian 的任意代码权限模型或全局 CSS 覆盖模型。

## 一、Obsidian 的主题机制

### 1. 主题不是一套孤立的页面，而是 CSS 变量的默认值集合

Obsidian 官方开发者文档说明，应用 UI 使用 CSS 控制，内置了大量 CSS variables；插件可以直接使用这些变量构建自己的元素，主题则可以通过覆盖变量值创建主题，而不需要依赖复杂的 CSS 选择器。[About styling](https://docs.obsidian.md/Reference/CSS%20variables/About%20styling)

官方变量文档把颜色拆成基础色、强调色、语义色和交互色。例如背景、边框、hover、正常文本、弱化文本、错误、成功和强调色都有独立的语义变量；颜色还提供 RGB 变量，以便在 CSS 中组合透明度。[Colors](https://docs.obsidian.md/Reference/CSS%20variables/Foundations/Colors)

官方还为 Modal 等组件单独维护变量，例如背景、宽高、最大宽度、边框和圆角。也就是说，主题系统不仅有“颜色 token”，还有“组件级 token”。[Modal](https://docs.obsidian.md/Reference/CSS%20variables/Components/Modal)

### 2. 主题、用户 snippets、插件样式是不同层次

官方帮助文档将三种能力分开：

- **Theme**：整体外观方案，用户安装后立即应用，可以切换和更新。[Themes](https://obsidian.md/help/themes)
- **CSS snippets**：放在 vault 配置目录中的小型 CSS 覆盖，用于在现有主题上做局部调整；可以单独启用/禁用，并且保存后通常自动应用，不需要重启。[CSS snippets](https://obsidian.md/help/snippets)
- **Plugin `styles.css`**：随插件发布的插件自身样式，用于插件自定义元素；官方要求插件尽量使用内置变量，以兼容不同主题。[HTML elements](https://docs.obsidian.md/Plugins/User%20interface/HTML%20elements)

官方帮助中的 CSS snippets 示例也体现了“作用域优先”的思路：可以通过变量改变全局语义，也可以通过自定义 class 只影响具有该 class 的内容。[CSS snippets](https://obsidian.md/help/snippets)

### 3. 主题兼容的关键是“使用宿主语义变量”，不是猜测宿主颜色

官方插件 UI 文档使用 `--background-modifier-border`、`--text-muted` 等变量作为插件样式示例，并明确说明使用这些变量可以让插件在用户切换主题后仍然保持良好外观。[HTML elements](https://docs.obsidian.md/Plugins/User%20interface/HTML%20elements)

Obsidian 的主题开发检查清单也强调尽量使用 CSS variables、避免 `!important`、避免无必要的高成本选择器，并避免覆盖核心样式。[Theme self-critique checklist](https://docs.obsidian.md/oo/theme)

### 4. 对 Serpent 的可借鉴点

Serpent 应将主题系统设计为：

- **语义 token 为公开稳定契约**，例如 `surface.canvas`、`surface.panel`、`surface.popover`、`text.primary`、`text.muted`、`border.subtle`、`accent.default`、`state.error`、`state.warning`、`state.success`。
- 同一 token 在 light/dark 下分别有值；组件不要直接写死颜色。
- 除基础 token 外，再提供组件 token，例如 `menu.background`、`menu.item.hover`、`dialog.radius`、`setting.control.height`、`progress.track`。
- 插件默认只能使用语义 token 和公开组件，不直接依赖宿主生成的内部 class 名。
- 用户主题、插件主题和局部样式应有清晰层级，且有冲突策略和恢复默认入口。
- 样式片段可以作为开发/高级用户能力，但必须限定作用域，避免把“能覆盖任意 DOM”当成普通插件 API。

### 5. 不应照搬的部分

- 不应允许普通插件用任意全局 CSS 覆盖 Serpent 的全部 UI；这会破坏组件一致性，也会使插件之间互相污染。
- 不应把内部 DOM class 当作长期 API。Obsidian 的 CSS 变量之所以重要，正是因为变量比 DOM 结构更稳定。
- 不应直接接受任意 CSS 作为插件主题 token 值；应校验类型、长度、允许的属性和作用域。
- Serpent 的主题功能必须遵守当前产品边界：主题自定义可以逐步开放，但不能绕过 UI 标准化和设计系统。

## 二、Obsidian 的插件 UI 模型

### 1. 插件有注册式 UI 入口

官方 API 将插件常见 UI 入口定义为可注册的能力，包括：Ribbon 图标、底部状态栏、全局命令、设置页和自定义 View。官方 `obsidian-api` README 将这些能力列为 Plugin 继承后可使用的主要扩展点。[obsidian-api README](https://github.com/obsidianmd/obsidian-api)

官方类型定义中，`Plugin` 持有 `app` 和 `manifest`，并提供 `addRibbonIcon`、`addStatusBarItem`、`addCommand`、`addSettingTab`、`registerView` 等 API。[Plugin API 类型定义](https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts#L4691-L4766)

这说明 Obsidian 的基本 UI 设计不是让插件自己决定“把元素插到哪个 DOM 兄弟节点”，而是让插件注册语义入口，宿主决定具体落点和展示方式。

### 2. 插件可以自由渲染 HTML，但自由渲染发生在宿主容器内

Obsidian 为插件设置、View 和其他界面提供 `HTMLElement` 容器；插件可以使用 `createEl()` 等 API 创建元素，并通过插件自己的 `styles.css` 定义类名。[HTML elements](https://docs.obsidian.md/Plugins/User%20interface/HTML%20elements)

这种模式保留了足够的扩展能力：插件可以做特殊卡片、图表、编辑器、媒体视图，而宿主仍能控制 View 的生命周期、位置和主题上下文。

对 Serpent 的重要启示是：

- “结构化 Host UI”与“插件自绘 UI”应该并存。
- 常见设置、菜单、对话框、Job 状态等应走 Host 组件；只有无法表达的特殊内容才使用自定义视图/iframe。
- 自定义视图必须获得明确的容器、主题 token、尺寸变化事件、销毁通知和宿主导航语义。

### 3. View 是带状态和导航语义的扩展点

Obsidian 的 `View` 不只是一个 HTML 容器。官方类型定义为 View 提供 `leaf`、`containerEl`、`getViewType()`、`getDisplayText()`、`getState()`、`setState()`、临时状态、尺寸变化回调以及 pane menu；View 还可以声明是否属于可导航内容。[View API 类型定义](https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts#L7287-L7401)

View 状态可以进入工作区布局，`setState` 还能通过结果参数声明是否写入导航历史。[View API 类型定义](https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts#L7351-L7439)

对 Serpent 的可借鉴点：插件面板不应只是“挂在左侧的 React 节点”，而应有明确的实例身份和状态模型：

- `viewType` / `viewId`：区分不同插件视图。
- `instanceId`：同一插件可以同时打开多个面板实例。
- `state`：可持久化的用户状态，例如当前过滤条件、排序、选中资产。
- `ephemeralState`：不应持久化的临时 UI 状态。
- `onResize` / viewport contract：插件知道可用空间变化，而不是自行轮询 DOM。
- `onClose` / dispose：视图关闭时释放事件、计时器、worker 和 IPC 订阅。
- `navigation`：区分可恢复浏览页面和固定工具面板。

### 4. Workspace 是“布局和 View 实例的宿主”，不是插件的全局 DOM

官方 Workspace API 有左右侧 dock、根布局、当前 focus、`layoutReady`、布局保存、创建 leaf、split/tab/window 等能力；`onLayoutReady()` 会在布局已经准备好时立即调用，否则排队到布局完成后。[Workspace API 类型定义](https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts#L7446-L7584)

官方还提供 deferred views：启动时 View 可能只是 `DeferredView`，只有真正可见时才实例化完整 View；如果插件必须提前访问，则需显式加载，但官方提醒这会牺牲性能。[Defer views](https://docs.obsidian.md/plugins/guides/defer-views)

对 Serpent 的可借鉴点：

- 插件 UI 注册应进入 Host 的布局树/面板树，不能由插件直接改变全局布局状态。
- 面板入口和面板内容应分离；切换资源库或插件状态变化时，入口不应因内容重渲染短暂消失。
- 视图应支持延迟创建和按需挂载，尤其是图片、视频、模型等重型面板。
- 与资源库相关的插件视图需要明确 `global` / `library` 实例作用域，并由 Host 管理实例销毁时机。

## 三、Obsidian 的设置 UI：从命令式组件到声明式定义

### 1. 传统 API：统一 Setting 容器与标准组件

传统插件设置使用 `PluginSettingTab` 和 `Setting`，在宿主提供的 `containerEl` 中添加 toggle、dropdown、text 等组件。设置组件由 Host 提供统一的布局和交互基础，插件只提供名称、描述、值和变更回调。[HTML elements](https://docs.obsidian.md/Plugins/User%20interface/HTML%20elements)

### 2. 新的声明式 Settings API

官方文档介绍了 `getSettingDefinitions()`：插件返回设置定义数组，Obsidian 负责渲染、搜索索引、持久化和校验。定义中可以描述 toggle、dropdown、text、number、slider、file、folder、secret 等控件；还可以定义 group、list、嵌套 page、可见性、验证和自定义 render。[Migrate to declarative settings](https://docs.obsidian.md/plugins/guides/migrate-declarative-settings)

官方 API 类型定义进一步表明，声明式设置支持：

- 分组和分组标题；
- 分组搜索；
- list 的添加、删除、拖拽排序；
- 嵌套设置页面；
- `visible` 条件；
- `displayValue` 和状态标记；
- `validate` 校验；
- 需要时通过 `render` 退出声明式模式进行自定义渲染。[Setting API 类型定义](https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts#L5817-L6027)

这正是 Serpent 当前插件设置设计最值得借鉴的部分：插件开发者描述字段结构，Host 负责一致的 UI、搜索、错误展示、持久化和生命周期。

### 3. 声明式不是“所有东西都禁止自定义”

Obsidian 保留了 `render` 回调，用于副作用、派生值、特殊 suggester 或不适合用标准控件表达的内容；但官方同时指出，render 不会自动保存，插件需要自行处理保存和清理。[Migrate to declarative settings](https://docs.obsidian.md/plugins/guides/migrate-declarative-settings)

这提供了一个适合 Serpent 的分层：

1. **标准字段**：toggle、select、slider、number、text、path、secret、button 等。
2. **结构容器**：group、page、list、repeatable item、visible/enablement。
3. **受控自定义**：Host 提供一个隔离容器，插件可以渲染特殊控件，但不能破坏父页面布局和主题契约。

### 4. 对 Serpent 的建议

Serpent 的插件设置 descriptor 可以演进为类似以下概念（这里只是设计建议，不是当前实现 API）：

```ts
{
  type: "group",
  title: "模型设置",
  items: [
    {
      type: "toggle",
      key: "enabled",
      label: "启用放大",
      description: "在导入图片时启用放大处理",
    },
    {
      type: "select",
      key: "model",
      label: "模型",
      options: [
        { value: "fast", label: "快速" },
        { value: "quality", label: "高质量" },
      ],
    },
  ],
}
```

需要额外加入：字段 schema、默认值、版本迁移、字段级错误、可见性、置灰条件、异步校验、权限声明和敏感值引用。不要把整个设置页设计成插件传入任意 JSX 或 HTML 字符串。

## 四、生命周期与资源管理

### 1. 插件本身是 Component 生命周期的一部分

官方类型定义显示 `Plugin extends Component`，并提供 `onload()`；插件注册事件、DOM 事件和定时器时，官方建议使用注册方法，以便在插件卸载时自动解除。[Plugin API 类型定义](https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts#L4691-L4766)

官方 Events 文档明确说明，插件注册的事件处理器必须在插件卸载时解除，最安全的方式是使用 `registerEvent()`；定时器使用 `registerInterval()`。[Events](https://docs.obsidian.md/Plugins/Events)

### 2. 初始化和布局就绪是两个阶段

Obsidian 官方加载性能指南要求 `onload()` 尽量只做注册命令、View、Markdown processor 等轻量初始化；昂贵计算和数据获取应放到 `workspace.onLayoutReady()` 之后。[Optimize plugin load time](https://docs.obsidian.md/plugins/guides/load-time)

官方还提示，vault 初始化期间会为现有文件触发 create 事件；如果插件不希望在初始化阶段收到这些事件，应在 `onLayoutReady()` 中注册监听。[Optimize plugin load time](https://docs.obsidian.md/plugins/guides/load-time)

### 3. View 也有自己的加载/卸载边界

View 通过 `onOpen()`、`onClose()`、`onResize()` 等方法和 Component 生命周期管理 UI。延迟 View 的机制还要求插件不要假设所有 workspace leaf 的 `view` 都已经是完整的自定义 View。[View API 类型定义](https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts#L7287-L7401)；[Defer views](https://docs.obsidian.md/plugins/guides/defer-views)

### 4. 对 Serpent 的可借鉴点

Serpent 的插件生命周期可以明确分为：

- `register`：注册菜单、设置、View、命令、MCP、Job handler；应该快速完成。
- `setup`：Host 已建立插件实例和权限上下文后执行，可读取轻量配置。
- `ready`：资源库、Renderer 或 UI 布局达到可用状态后通知插件。
- `dispose`：移除所有贡献、取消 IPC 订阅、停止 Job/worker、释放外部资源。
- View 层再提供 `mount`、`unmount`、`resize`、`stateChanged`。

用户此前决定不区分 library/global 的回调名称，这与 Obsidian 的思路并不冲突：可以使用同一套 `setup` / `dispose`，通过参数告诉插件当前实例作用域和资源库上下文。

插件 Host 应维护注册资源清单，使插件无需为每个 event、timer、menu、view 自己记忆清理路径。插件卸载、资源库切换、插件重载、应用退出都应走同一个 dispose 机制；仅依赖进程退出清理不够。

## 五、权限与安全边界

### 1. Obsidian 的现实边界：普通插件不是强权限沙箱

Obsidian 官方帮助明确警告：社区插件会以用户身份执行第三方代码；Restricted Mode 默认阻止第三方代码，关闭后用户需要信任插件作者。[Community plugins](https://help.obsidian.md/Extending%2BObsidian/Community%2Bplugins)

更关键的是，官方明确承认由于技术限制，Obsidian 不能可靠地把社区插件限制到特定权限或访问级别。因此插件可能访问计算机文件、连接互联网、安装额外程序；官方建议对敏感数据进行独立安全审计。[Plugin security](https://help.obsidian.md/Extending%2BObsidian/Plugin%2Bsecurity)

官方通过 Restricted Mode、插件目录审核、自动扫描和安全评分来降低风险，但这不是细粒度运行时权限沙箱。[Plugin security](https://help.obsidian.md/Extending%2BObsidian/Plugin%2Bsecurity)；[Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)

### 2. 这部分不能照搬到 Serpent

Serpent 已经选择了 Renderer → Preload → Main → Library Worker 的分层架构，并要求插件显式声明权限。因此不应因为 Obsidian 的成熟生态允许任意 JavaScript，就把 Serpent 的权限模型退回为“启用插件即授予宿主所有能力”。

Serpent 应保留并强化：

- capability/permission manifest；
- Host 对 IPC 命令的 schema 校验；
- 文件系统、外部进程、网络、凭据和资源库写入的权限区分；
- UI Context 与功能 API 分离；
- 插件只能通过 typed API 访问资产和资源库，不直接获得数据库、绝对路径或任意 SQL；
- 对敏感操作显示可解释的授权和失败原因。

### 3. 可以借鉴的安全 UX

Obsidian 的 Restricted Mode 是一个简单、清晰、可理解的总开关：用户知道“第三方代码是否运行”。Serpent 可以借鉴其可见性，但做得更细：

- 插件列表显示已授权能力；
- 首次使用敏感能力时解释用途；
- 设置里可以撤销单项权限；
- 拒绝权限时仍允许插件的非敏感 UI 加载；
- 日志和错误信息说明缺少哪项 capability，而不是笼统显示 operation failed。

## 六、对 Serpent 插件平台的综合设计建议

### 建议 A：建立三层 UI 契约

```text
Serpent Design Tokens
        ↓
Host Semantic Components / Descriptors
        ↓
Plugin Custom View / Isolated Renderer
```

- **Tokens**：颜色、间距、字体、圆角、层级、动效和控件尺寸。
- **Host components**：菜单、设置、Dialog、Toast、Job、列表、表格、选择器、空态、错误态。
- **Custom view**：只负责特殊内容；必须使用 Host 主题上下文、尺寸和生命周期。

### 建议 B：优先把设置、菜单和 Job 做成声明式

Obsidian 的声明式设置说明，声明式 API 的价值不仅是少写 UI，而是把搜索、校验、持久化和可见性统一交给宿主。Serpent 应沿用同一原则：

- 设置字段由 descriptor 描述；
- 菜单由树状 descriptor 描述；
- `when`、`enablement`、`checked` 只接受纯数据上下文和安全表达式；
- Job 由结构化阶段、进度、消息、取消策略描述；
- Host 负责布局、主题、可访问性、键盘导航和错误展示。

### 建议 C：主题覆盖采用 allowlist、作用域和层级

建议的主题层级：

```text
Host base tokens
  → User appearance/theme
  → Workspace/library scoped overrides
  → Plugin scoped tokens
  → Plugin view local styles
```

其中插件只允许覆盖：

- 自己的命名空间 token；
- Host 明确公开的少量语义 token；
- 不允许修改 layout-critical token、z-index 全局范围、字体加载策略、全局 reset 和宿主 DOM 选择器。

插件主题应有：schema 校验、light/dark 可选值、大小限制、插件卸载回滚、冲突诊断和预览。

### 建议 D：把 View 当成产品级实体，而不是“侧栏按钮的副作用”

每个插件 View 都应有：

- 稳定的类型和实例 ID；
- global/library scope；
- 持久化 state 与临时 state；
- 可见性、激活、关闭、重挂载和恢复语义；
- resize 与主题变化事件；
- worker/job 生命周期绑定；
- 插件禁用或资源库关闭时的确定性清理。

这可以直接解决当前插件左侧入口闪烁、资源库切换时贡献短暂消失、跨会话残留和面板状态竞态等类别的问题。

### 建议 E：保留“受控自定义”，不要追求“完全自由”或“完全固定”

推荐的最终插件 UI API：

- 常规设置、菜单、通知、Job、工具栏、Inspector：结构化描述；
- 特殊图表、模型预览、复杂表格：Custom View；
- Custom View 使用隔离 DOM/iframe 或受控组件容器；
- Host 提供 token、组件适配器和事件桥；
- 插件不能依赖宿主内部 React、CSS class、任意 DOM 位置。

这是从 Obsidian 的“标准 API + 自定义 HTML/CSS + CSS variable”模型推导出的 Serpent 版本，而不是照搬其非沙箱权限模式。

## 七、对当前 Serpent 方案的结论

当前 Serpent 的方向是正确的，但需要明确三个边界：

1. **UI 标准化不是只建立一组颜色变量**。还需要稳定的组件语义、状态模型、键盘/可访问性规则、尺寸和层级契约。
2. **主题自定义不等于任意 CSS 自定义**。第一阶段应开放 token 和插件自身作用域，之后再决定是否提供用户 CSS snippets；不能把 snippets 变成绕过组件规范的默认开发路径。
3. **声明式 API 应覆盖最常见的 80% UI**。插件不需要为 toggle、dropdown、slider、菜单二级结构、Job 进度和错误态重复造轮子；但复杂媒体/AI 工具仍需 Custom View 和完整脚本 API。

## 八、横向对照：VS Code 的贡献点、上下文和主题

VS Code 的扩展模型比 Obsidian 更接近 Serpent 当前要解决的问题：它把扩展声明集中放在一个 Manifest 的 `contributes` 下，并把命令、菜单、子菜单、视图、主题、颜色、快捷键和设置分别建模为稳定的 Contribution Point。[Contribution Points](https://code.visualstudio.com/api/references/contribution-points)

### 1. 一个命令，多种 UI 表面

VS Code 的命令是行为源，菜单、命令面板和快捷键都引用同一个 command ID。命令可以声明标题、图标、类别和 enablement；同一命令在不同菜单中的呈现由菜单表面决定。[Commands](https://code.visualstudio.com/api/extension-guides/command)

这带来三个重要效果：

- 插件不需要为“右键菜单版本”“工具栏版本”“命令面板版本”复制三份业务 handler；
- 快捷键、菜单和命令面板不会因为各自注册而产生行为分叉；
- 宿主可以在命令注册表层统一做权限、诊断、冲突和生命周期管理。

Serpent 当前的 Command Registry 方向是正确的，但需要把它真正作为所有 UI 表面的唯一行为源，而不是只让插件菜单引用它。

### 2. `when` 与 `enablement` 是两个不同的用户体验语义

VS Code 明确区分：`when` 决定菜单项是否出现，`enablement` 决定命令是否可用。菜单的 `when` 用于避免充满无关禁用项的菜单，而 `enablement` 会作用于菜单和快捷键；不同表面还可以对禁用项采取不同展示策略。[Commands](https://code.visualstudio.com/api/extension-guides/command)

VS Code 还允许扩展通过 `setContext` 写入自己命名空间下的 context key，再由声明式 when clause 使用。[When clause contexts](https://code.visualstudio.com/api/references/when-clause-contexts)

对 Serpent 的直接启示：

- Context key 必须有注册和命名空间，不允许插件任意污染全局字段；
- `when`、`enablement`、`checked` 应统一解析并在一次 resolve 中冻结；
- UI Context 可以是摘要和派生状态，完整资产操作仍走 Domain API；
- 对同一命令，菜单隐藏、菜单置灰、快捷键拒绝和命令执行失败要有明确且一致的分层语义；
- Host 应能记录“哪个 context key 使贡献出现/隐藏/置灰”，否则插件条件很难排查。

### 3. 主题是命名颜色契约，不是让插件猜内部 CSS

VS Code 的 Color Theme 将工作台组件颜色和编辑器 token 颜色分开；扩展可以声明新的可主题颜色，之后自己的 UI 可以通过 `ThemeColor` 使用这些名字，用户主题也可以覆盖它们。[Theming](https://code.visualstudio.com/api/extension-capabilities/theming)；[Theme Color](https://code.visualstudio.com/api/references/theme-color)

对于 Webview，主题颜色会以 CSS variables 提供；官方 UX 指南要求 Webview 只有在标准 API 不足时才使用，并且必须做到可主题化、可访问和只在相关上下文激活。[Webviews](https://code.visualstudio.com/api/ux-guidelines/webviews)

这比当前 Serpent 的 `contributes.themes` 更完整之处在于：

- 主题不是只有 Host → iframe 的一次性 token 注入，而是有可声明、可被用户覆盖的命名颜色 ID；
- 插件可以声明“我需要一个错误色/强调色”，但不必知道具体 hex 值；
- 主题 token 可以按表面和语义分组，而不是暴露任意 CSS 变量；
- 自定义 Webview 仍是后备能力，不应成为常规设置、菜单和状态 UI 的默认实现。

Serpent 可借鉴命名颜色 ID 和插件自有 token namespace，但不应照搬 VS Code 的大量工作台颜色到第一版。Serpent 应先稳定自己的语义 token，并给插件提供有限的语义引用，例如 `status.error`、`action.accent`、`surface.raised`，而不是让插件覆盖任意 Host token。

## 九、横向对照：IntelliJ Platform 的 Action System 与 UI Kit

IntelliJ Platform 的扩展模型从“Action”出发：Action 可以被放进菜单、工具栏、快捷键和 Find Action；Action Group 可以嵌套成子菜单，注册时通过 group 和 anchor 指定位置。[Actions](https://plugins.jetbrains.com/docs/intellij/plugin-actions.html)；[Creating Actions](https://plugins.jetbrains.com/docs/intellij/creating-actions-tutorial.html)

它还要求插件尽量使用平台提供的 UI 组件和 Kotlin UI DSL，使设置、Dialog、Popup、通知、列表和树保持一致；菜单和工具栏由 Action System 构建，而不是插件直接拼接普通 Swing 控件。[User Interface Components](https://plugins.jetbrains.com/docs/intellij/user-interface-components.html)

### 1. 贡献注册不只是“把按钮放进去”

IntelliJ 的 Action 有三个独立部分：

- 定义行为和稳定 ID；
- 通过 `update()` 根据当前上下文计算可用状态；
- 通过 group/anchor 将同一行为挂到一个或多个 UI 位置。

这与 Serpent 需要的“命令—Context—菜单树—快捷键”模型高度一致。Serpent 应把 `before/after/first/last` 看成注册到同一语义 group 的布局约束，而不是直接操作渲染后的数组。

### 2. Host UI Kit 应是插件 API 的默认依赖

IntelliJ 官方明确建议插件使用平台组件，以保证视觉和交互一致，并提供 UI Inspector 反查现有组件；设置/对话框则有专门的 UI DSL。[User Interface Components](https://plugins.jetbrains.com/docs/intellij/user-interface-components.html)

对 Serpent 的启示不是直接暴露 React 组件，而是：

- 发布版本化的 semantic descriptor schema；
- Host 内部用自己的 UI library 渲染 descriptor；
- 给开发者提供 descriptor 预览、字段校验和 UI Inspector/诊断；
- 禁止插件依赖内部 DOM、React 类型或页面 CSS class。

### 3. 设置声明应尽量在加载前可解析

IntelliJ 的 Settings Guide 提醒，为了性能，能在扩展点声明中表达的设置元数据应尽量静态声明；动态计算设置树会导致构建设置页面时加载更多实现。[Settings Guide](https://plugins.jetbrains.com/docs/intellij/settings-guide.html)

这适合 Serpent 的插件设置：Manifest 先提供标题、分组、字段类型、默认值、可见性和权限等元数据，Host 可以在不启动插件 Worker 的情况下构建设置导航和基本表单。需要动态数据的选项（例如模型列表）再通过受限的异步 provider 补充，而不是让整个设置页等待插件启动。

### 4. 主题颜色应通过命名主题对象读取

IntelliJ 的 UI FAQ 要求自定义颜色通过当前主题提供的命名颜色读取，而不是直接保存一个固定 `Color`；这样主题切换时组件能自动更新。[User Interface FAQ](https://plugins.jetbrains.com/docs/intellij/ui-faq.html)

Serpent 也应把“主题切换可传播”作为组件契约：插件 View、Host-rendered settings、通知、Job 面板和自定义图表都必须能收到主题变化，不能只在首次挂载时读取一次 token。

## 十、三种产品的共同规律与差异

| 能力 | Obsidian | VS Code | IntelliJ Platform | Serpent 应取的交集 |
| --- | --- | --- | --- | --- |
| 行为源 | Plugin API 注册命令 | Command contribution/registry | Action System | 一个稳定 Command/Action ID，所有表面引用它 |
| 菜单 | API/宿主容器 | `menus`、`submenus`、`when`、`group` | Action Group、group、anchor | 树形菜单 + Context + 可解释定位约束 |
| 设置 | `Setting`，逐步转 declarative | configuration contribution | Settings extension point/UI DSL | Host-rendered semantic descriptor，字段级校验和搜索 |
| 自定义 UI | 容器内 HTML/CSS | Webview/Webview View | 平台组件、Tool Window、必要时自定义 Swing | 结构化 UI 覆盖常见 80%，Custom View 承担复杂 20% |
| 主题 | CSS variables，插件消费宿主变量 | Color IDs、ThemeColor、Webview CSS variables | Named colors / UI Kit | 语义 token、命名色、light/dark 传播，禁止内部 CSS 依赖 |
| 生命周期 | Plugin/Component/View | Extension host/activation | Plugin/action/component lifecycle | setup/dispose + View mount/unmount/resize/state |
| 上下文 | App/Workspace/View 状态 | Context keys 和 when clauses | Action `update()` 上下文 | 有界 Context 快照 + 统一条件求值 + Invocation 快照 |
| 安全 | Restricted Mode + 信任，细粒度弱 | Extension host/Webview 边界 | 平台插件权限与审核 | 保留 Serpent capability、typed IPC 和 Worker 隔离 |

共同规律是：**插件描述意图，宿主负责落地；插件需要自由度时，进入明确隔离的 Custom View，而不是获得宿主内部实现细节。**

## 十一、Serpent 的具体落地建议

### P0：把 UI Contract 定义成真正的公共协议

建议新增版本化 `Plugin UI Contract v1`，至少包括：

```text
ThemeContract
  semantic colors / surfaces / typography / geometry / status / layer

CommandContract
  command id / title / icon / shortcut / context / when / enablement / checked

MenuContract
  surface / section / item / submenu / group / placement / visibility / shortcut

SettingsContract
  group / page / field / default / options / validate / visible / enablement / secret

StateContract
  loading / empty / error / disabled / progress / cancelled / completed

ViewContract
  view type / instance / scope / state / mount / unmount / resize / theme change
```

这个协议应有 JSON Schema、TypeScript 类型、诊断错误码和 fixture。插件只依赖协议包，不依赖 `src/renderer/ui` 的内部实现。

### P1：先实现声明式 Settings Descriptor

从当前已有的 boolean/number/string/select 扩展为：

- `group`、`page`、`list`、`action`、`secret`；
- `visible` 和 `enablement` 的纯表达式；
- `validate` 的有界同步结果和受控异步校验；
- 字段级错误、默认值回退、迁移和搜索索引；
- 统一 Host 组件渲染，插件无需编写 UI。

Slider、toggle、dropdown、模型选择、按钮和错误提示都应成为 descriptor 的数据，而不是新建一套插件专用 React 组件。

### P1：完善主题模型，但分成三种能力

1. **Host Theme**：Serpent 自己的完整主题，控制所有内部组件。
2. **Plugin Theme Reference**：插件只能引用公开语义 token 和自有 namespace token；不能改全局布局、z-index、字体加载或宿主 DOM。
3. **Custom View Theme Bridge**：iframe/隔离 View 收到当前 resolved theme、语义 token、contrast/high-contrast 信息和变更事件。

用户级全局主题和插件级 token 覆盖必须有明确优先级、预览、禁用、卸载回滚和冲突诊断。

### P1：把 View 做成稳定的面板实例

当前插件注册的左侧入口出现瞬间消失，根因类别很可能不是 CSS，而是“贡献注册状态”和“View 内容状态”耦合。建议：

- 入口由 Host 的 contribution tree 持有，内容重载不撤销入口；
- View 内容更新只替换 view state，不重新构造整个导航树；
- 每个实例绑定 `pluginInstanceId`、scope、libraryId、viewId；
- 资源库切换、插件 reload、iframe crash 和 dispose 都有独立状态；
- 入口显示/隐藏和 iframe 加载/失败分别呈现，不用短暂卸载制造 glitch。

### P2：引入开发者可见的 UI 诊断

参考 VS Code 的 context key 和 IntelliJ 的 UI Inspector，Serpent 可以提供开发态诊断：

- 当前选中 Context 快照和 revision；
- 菜单节点最终的 `visible/enabled/checked` 原因；
- 每个插件贡献的 Host surface、group、anchor 和排序结果；
- Settings descriptor 展开的字段、默认值和字段级错误；
- 当前主题、实际 token 值和来源层级；
- View 的 mount/unmount、resize、theme-change 和 dispose 记录。

这会显著降低“插件明明注册了但菜单不见了”“设置页为空”“主题切换后颜色不对”“面板闪烁”等问题的排查成本。

## 十二、暂不采纳的方向

- 不采用 XML。三种参考产品都没有证明 XML 能解决 Serpent 的核心问题；版本化 JSON/TypeScript descriptor 更适合 Zod、JSON Schema、测试 fixture 和生成 SDK。
- 不允许插件执行任意 UI predicate Python/JavaScript。条件应当是 Host 可缓存、可取消、可解释的纯数据表达式；功能逻辑仍走完整脚本 API。
- 不把完整 Host DOM、React 组件或内部 CSS class 暴露给插件。
- 不把 Obsidian 的“关闭 Restricted Mode 后第三方代码可访问本机能力”作为 Serpent 安全模型。Serpent 继续使用 capability、typed IPC、Worker 和资源库所有权隔离。
- 不把 Custom View 作为 toggle、select、菜单、通知、Job 进度等常规 UI 的默认实现。自由 UI 只能覆盖无法由标准 descriptor 表达的场景。

## 十三、研究结论

如果只提炼一句话：**Serpent 应学习 Obsidian 的语义变量与 View/Setting 扩展点，学习 VS Code 的 Command/Context/Contribution/ThemeColor 统一模型，学习 IntelliJ 的 Action System、UI Kit 和静态设置元数据；三者的共同部分正好指向我们需要的 Host-rendered semantic descriptor。**

这意味着下一阶段的重点不是继续增加零散的 `toggle`、`dropdown` 或右键菜单特例，而是把它们全部纳入一个版本化、可验证、可诊断的插件 UI Contract。

因此，Serpent 下一阶段最有价值的工作不是继续增加零散控件，而是形成一套可版本化的 `Plugin UI Contract`：

- `tokens`：主题和视觉语义；
- `components`：标准控件能力；
- `descriptors`：设置/菜单/Job/面板结构；
- `context`：只读 UI 上下文；
- `lifecycle`：注册、setup、ready、dispose；
- `capabilities`：功能权限；
- `custom views`：隔离且主题兼容的自由渲染。

这套契约应成为插件文档、Manifest schema、Host registry、Renderer 组件库和自动化测试的共同来源。

## 官方来源索引

### 主题、样式和 UI

- [About styling](https://docs.obsidian.md/Reference/CSS%20variables/About%20styling)
- [Colors / CSS variables](https://docs.obsidian.md/Reference/CSS%20variables/Foundations/Colors)
- [Modal CSS variables](https://docs.obsidian.md/Reference/CSS%20variables/Components/Modal)
- [HTML elements](https://docs.obsidian.md/Plugins/User%20interface/HTML%20elements)
- [CSS snippets](https://obsidian.md/help/snippets)
- [Themes](https://obsidian.md/help/themes)
- [Appearance](https://obsidian.md/help/appearance)
- [Theme self-critique checklist](https://docs.obsidian.md/oo/theme)

### 插件、设置、View 和生命周期

- [Obsidian API repository](https://github.com/obsidianmd/obsidian-api)
- [Obsidian API type definitions](https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts)
- [Build a plugin](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin)
- [Manifest](https://docs.obsidian.md/Reference/Manifest)
- [Migrate to declarative settings](https://docs.obsidian.md/plugins/guides/migrate-declarative-settings)
- [Events](https://docs.obsidian.md/Plugins/Events)
- [Optimize plugin load time](https://docs.obsidian.md/plugins/guides/load-time)
- [Defer views](https://docs.obsidian.md/plugins/guides/defer-views)
- [Build a Bases view](https://docs.obsidian.md/plugins/guides/bases-view)
- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)

### 插件安全和权限

- [Community plugins](https://help.obsidian.md/Extending%2BObsidian/Community%2Bplugins)
- [Plugin security](https://help.obsidian.md/Extending%2BObsidian/Plugin%2Bsecurity)
- [Settings](https://obsidian.md/help/settings)

### VS Code 扩展模型

- [Extension API](https://code.visualstudio.com/api/)
- [Contribution Points](https://code.visualstudio.com/api/references/contribution-points)
- [Commands](https://code.visualstudio.com/api/extension-guides/command)
- [When clause contexts](https://code.visualstudio.com/api/references/when-clause-contexts)
- [Theming](https://code.visualstudio.com/api/extension-capabilities/theming)
- [Theme Color](https://code.visualstudio.com/api/references/theme-color)
- [Webviews UX guidelines](https://code.visualstudio.com/api/ux-guidelines/webviews)

### IntelliJ Platform 扩展模型

- [Actions](https://plugins.jetbrains.com/docs/intellij/plugin-actions.html)
- [Creating Actions](https://plugins.jetbrains.com/docs/intellij/creating-actions-tutorial.html)
- [User Interface Components](https://plugins.jetbrains.com/docs/intellij/user-interface-components.html)
- [Settings Guide](https://plugins.jetbrains.com/docs/intellij/settings-guide.html)
- [User Interface FAQ](https://plugins.jetbrains.com/docs/intellij/ui-faq.html)

## 说明

本文没有使用社区博客、第三方插件源码、论坛帖子或非官方教程作为事实依据。官方文档中的 API 和变量会随 Obsidian 版本变化；Serpent 借鉴时应把上述原则转化为自己的版本化契约，不应假设 Obsidian 当前 API 的具体命名或版本行为可以直接复制。
