# Serpent 插件开发指南

> 面向人类插件开发者。规格原文见 [`0024`](implementation/0024-script-plugin-platform.md) 与 [ADR-0026](adr/0026-plugin-runtime-installation-and-trust.md)。  
> API 明细见 [`plugin-api-reference.md`](plugin-api-reference.md)。  
> **Agent 开发/测试步骤**见 [`agent-plugin-playbook.md`](agent-plugin-playbook.md)（自动化验收口径）。  
> 自动化脚本（Console / MCP）见 [`automation-scripting-guide.md`](automation-scripting-guide.md)；脚本与插件共享领域 Action，但生命周期不同。

## 1. 插件能做什么

插件用于**长期扩展** Serpent：菜单、工具栏、Inspector、查看器、设置、侧栏/工作区自定义 UI、快捷键与输入捕获、领域事件/Hook、后台 Job、以及预览/搜索等 Provider。

插件通过注入的 `serpent` 对象调用领域能力（与脚本同一套 Automation Gateway）。插件**不能**：

- 让 Renderer 直接执行第三方后端代码
- 获得任意 SQL
- 在标准（受限）模式下获得 Node / 任意磁盘路径
- 把信任状态或本机密钥写入可随库同步的数据

## 2. 安装范围与磁盘布局

### 2.1 插件代码（Package）

| 安装范围 | 代码位置 |
| --- | --- |
| 应用级（本应用 / user） | `{userData}/plugins/<pluginId>/<version>/` |
| 资源库级（此资源库 / library） | `<库根>/.serpent/plugins/<pluginId>/<version>/` |

`{userData}` 是 Electron 应用数据目录（不是裸的 `%APPDATA%`）：

| 平台 | 典型路径 |
| --- | --- |
| macOS | `~/Library/Application Support/Serpent/` |
| Windows | `%APPDATA%\Serpent\` |
| Linux | `~/.config/Serpent/` |

Finder 默认隐藏 `~/Library`：菜单「前往」时按住 ⌥ 可见「资源库」，或终端执行 `open ~/Library`。

### 2.2 插件数据目录（模型、缓存、大文件）

与「KV storage JSON」不同，这是给插件放文件的根目录：

| 范围 | 路径 |
| --- | --- |
| 应用级 | `{userData}/plugin-data/<pluginId>/` |
| 资源库级 | `<库根>/.serpent/plugin-data/<pluginId>/` |

约定：

- 目录由 Host 在首次解析时创建；插件应通过 `serpent.data.getDirectory(...)` 取得路径（无限制模式可再用 Node `fs` 读写其下文件）。
- **库级**数据落在资源库内，复制/同步库时会带走该目录（大模型是否适合进库由插件作者自行权衡）。
- **应用级**数据不随库同步。
- 现有 KV `storage` 在库级可能仍使用 `.serpent/plugin-data/<pluginId>.json` 单文件；与 `<pluginId>/` **目录**路径不冲突。新的大文件请放在 `<pluginId>/` 目录下。

### 2.3 安装 ≠ 信任 ≠ 激活

1. **安装**：代码出现在上述目录  
2. **信任**：本机用户明确允许该包装载（资源库插件每台设备都要信任；信任不随库同步）  
3. **激活**：打开资源库且 Resolution 允许后，Host 加载入口并调用 `activate(serpent)`

## 3. 两种运行模式

清单字段：`runtime.mode`

| 模式（清单值） | 对用户展示（规划改名） | 运行时 | 能力边界 |
| --- | --- | --- | --- |
| `restricted` | 受限模式 | 独立 QuickJS（无 Node） | 只能通过 `serpent.*`；无 `require('fs')` |
| `unrestricted` | 无限制模式 | 独立 Node UtilityProcess | 完整 Node；`serpent.*` 仍走 Gateway。权限**不能**拦截任意 `fs`/子进程 |

读入时仍接受旧别名：`standard` → `restricted`，`trusted` → `unrestricted`。

产品要求：**两端共用同一套 Guest API（`serpent.*`）接线**，不得 Restricted / Unrestricted 各写一份互相漂移的方法表。

需要 ONNX 原生模块、外部 CLI、任意本机目录扫描时，使用 `unrestricted`，并在设置/信任 UI 中按高风险披露。

## 4. 最小插件包

```text
my-plugin/
  serpent-plugin.json
  entry/main.js          # 或 runtime.entry 指向的已编译入口
  README.md
  LICENSE
  # 可选 UI：ui.entry → dist/ui/index.html 等
```

`serpent-plugin.json` 示例（标准模式）：

```json
{
  "manifestVersion": 1,
  "id": "com.example.hello",
  "version": "1.0.0",
  "name": "Hello",
  "description": "Minimal plugin.",
  "author": "Example",
  "license": "MIT",
  "engines": {
    "serpent": ">=0.1.0 <1.0.0",
    "pluginApi": 1
  },
  "runtime": {
    "mode": "restricted",
    "entry": "entry/main.js"
  },
  "permissions": [
    "library.read",
    "asset.read",
    "storage.read",
    "storage.write"
  ],
  "contributes": {
    "commands": [],
    "menus": {},
    "views": [],
    "settings": [],
    "hooks": [],
    "jobs": [],
    "providers": [],
    "themes": []
  }
}
```

入口（CommonJS，受限与无限制均支持导出 `activate` / `deactivate`）：

```js
exports.activate = async function activate(serpent) {
  await serpent.storage.set('hello', { ok: true });
};

exports.deactivate = async function deactivate() {};
```

无限制模式把 `runtime.mode` 设为 `"unrestricted"`（对用户显示「无限制模式」），入口可用完整 Node（仍应优先用 `serpent.*` 改库内资产）。

## 5. 本地联调

1. 开发构建产出可安装目录（含清单与已编译 `entry`）。  
2. 启动 Serpent → 打开测试库 → **设置 → 插件**。  
3. 选择范围（本应用 / 此资源库）→ **选择本地插件…** → 指向该目录。  
4. 点 **信任**，必要时重新打开资源库以激活。  

探测用固定夹具（主仓）：

- `tests/fixtures/plugins/standard-host-probe/`
- `tests/fixtures/plugins/trusted-host-probe/`

不在 NAS/SMB 上开发或运行 Electron；插件仓建议与 Serpent 同级 sibling 克隆。

## 6. 权限与高风险写

- 清单 `permissions` 声明能力；未声明则 Gateway / Host 拒绝。  
- 与 Automation 同名的权限会映射为 Gateway capability（如 `asset.read`、`content.write`）。  
- `storage.*`、`data.files`、`ui.*`、`net.fetch` 等由 Host 表面单独执行。  
- **原地替换资产内容**（`content.write` / `assets.replaceContent`）会走 **Execution Plan 确认**，文案含覆盖警告；取消则不写盘。  
- 不要用绝对路径 `fs.writeFile` 覆盖库内 `Assets/`；应使用内容 API，否则元数据/缩略图可能不一致，且无计划确认。

## 7. Contribution 概要

Host 渲染（声明式）：`commands`、`menus.*`、`toolbar`、`inspector`、`viewerActions`、`settings.sections`、`shortcuts`。  

Sandboxed iframe：`workspace.views`、`sidebar.entries`、`inspector.views`、`viewer.overlays`、`settings.pages`。  

详细字段与 Provider / Hook / Job / Input Capture 见 API 参考与规格 0024。

## 8. 与脚本的差异

| | 脚本 | 插件 |
| --- | --- | --- |
| 生命周期 | 跑完即结束 | 安装 / 信任 / 激活 / 停用 |
| UI | 无 Contribution | 有 |
| Storage / 数据目录 | 无插件命名空间 | 有 |
| 运行时 | QuickJS | restricted QuickJS 或 unrestricted Node |

## 9. 安全模式

产品规划：安全模式用于急救，**停用无限制（unrestricted）插件**；受限插件可继续运行（与早期「停用全部第三方插件」不同，以当前产品决定为准）。

## 10. 建议工作流（图像处理类插件）

1. `unrestricted` + `content.read` / `content.write` + `data.files`
2. `getDirectory({ scope: 'user' })` 下载/扫描模型  
3. Job 处理队列与进度  
4. `replaceContent` 写回，依赖用户确认对话框  
5. 不要 shell `mv` 覆盖库文件  

## 11. 相关文档

- [插件 API 参考](plugin-api-reference.md)  
- [0024 规格](implementation/0024-script-plugin-platform.md)  
- [ADR-0026](adr/0026-plugin-runtime-installation-and-trust.md)  
- [自动化脚本指南](automation-scripting-guide.md)  
- 人类验收：`docs/qa/human-acceptance-checklist.md` 中 `PLUGIN-*` 条目  
