# 2026-07-29 插件 Phase B 安装内核开发日志

- 对应工单：`Serpent-upsn.2`（**进行中，未关闭**）
- 对应规格：[0024 脚本—插件扩展平台](../implementation/0024-script-plugin-platform.md)

## 本增量已完成

- `PluginPackageManager` 以 staging → 二次摘要校验 → 同文件系统 rename → 原子 lock 写入的顺序安装用户级和资源库级目录包；失败不会让 lock 指向未完成包。
- 本地 ZIP 安装在受限 staging 目录中逐文件提取，拒绝路径逃逸、符号链接、过大归档、过多文件和解压膨胀；不会调用 `npm`、Shell、构建或生命周期脚本。
- GitHub 安装只使用仓库 URL、tags/default branch 与 ZIP 源码归档；优先尝试最新 SemVer tag，锁定实际 commit SHA，不要求 Releases。
- 资源库包写入 `.serpent/plugins/` 与 `.serpent/plugin-lock.json`；信任与 Resolution 写入每个设备的 `userData/plugin-device-state.json`，不随资源库复制。
- 同 ID 用户级/资源库级冲突必须显式选择；同源、同运行模式且未增加权限的升级可继承选择，改变来源、模式或权限时返回重新确认状态；资源库包未信任时返回等待信任状态；Safe Mode 会禁用解析而不删除包。
- 包按版本不可变存储；卸载先从 lock 脱离，再删除目录，崩溃最多留下不可激活的孤儿文件。
- Package lock 现在也保存不可变来源元数据：GitHub 的仓库、tag、commit 与本地来源类型可安全显示给 Renderer；本地绝对路径仍只留在 Main 的原生选择器内。GitHub commit 不再被误当作“来源变化”，同仓库、同模式且未扩权的升级可沿用选择。
- Main 创建每个 `userData` 独有的稳定 device ID；资源库 lock 永远不含此 ID、信任决定或 Resolution。Preload 只暴露有 Zod 校验的 `plugins.request`，不能访问路径、Node 或任意 IPC。
- 设置中心新增“插件”页面：应用级/资源库级本地成品或 GitHub 安装、Safe Mode、包来源/权限/运行模式/完整性状态、资源库信任、冲突版本选择、风险升级确认入口与卸载均通过受限 Main IPC 完成。
- 已验证的同源升级可显式回退：回退只在本设备的 Resolution 中固定到紧邻的上一个不可变包，不删除包、不改资源库 lock、也不会让后续自动升级覆盖该选择；再次明确选择版本后才恢复自动跟随最新兼容包。
- 已建立 crash quarantine 基础：未来的 Plugin Supervisor 可报告某资源库中某确定包的稳定崩溃码；五分钟内连续三次会仅在本机隔离该包，解析和管理页显示可操作原因，用户可显式清除隔离。计数、隔离和原因码只写入 `userData`；当前尚无第三方入口执行，所以这不是实际 Host 崩溃已验证的宣称。

## 本增量验证

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 目录、ZIP、GitHub 安装与不执行脚本 | `src/main/plugin-package-manager.ts`、`plugin-package-archive.ts`、`plugin-github-client.ts` | `tests/unit/plugin-package-manager.test.ts` | 2026-07-30 Computer Use 在最新 `npm start` 打开插件页，未执行真实安装 |
| 同步代码而非同步信任 | 同上及 `plugin-device-state.json`、`plugin-device-identity.ts` | 双 userData + 同一 library fixture；`plugin-device-identity.test.ts` | 暂无两真实设备证据 |
| 冲突选择、升级重确认、回退、Safe Mode、卸载 | `plugin-package-manager.ts`、`plugin-package-ipc.ts`、`PluginSettingsPage.tsx` | `plugin-package-manager.test.ts`；`plugin-package-ipc.test.ts`；隔离 Electron E2E 安装→信任→Safe Mode | 2026-07-30 Computer Use 已检查空状态和控件布局；回退 UI 尚待人类操作 |
| 连续崩溃本机隔离与显式恢复 | `plugin-package-manager.ts`、`plugin-package-ipc.ts`、`PluginSettingsPage.tsx` | `plugin-package-manager.test.ts`（阈值/恢复）；`plugin-package-ipc.test.ts`（受限 bridge） | 运行时尚未加载第三方入口，不能提供真实崩溃或 UI 人工证据 |

- `npm run test:unit -- tests/unit/plugin-package-manager.test.ts tests/unit/plugin-package-ipc.test.ts`：205 个测试文件通过，1,625 个测试通过，1 个跳过。
- `npm run typecheck`：通过。
- `node scripts/run-e2e-isolated.mjs tests/e2e/plugin-management.test.ts`：1 passed。测试为临时 userData、临时库和临时成品包，覆盖设置页安装资源库插件、per-device 信任与 Safe Mode 切换；macOS 运行器报告使用副屏或主屏 fallback，未把平台隔离写成已完全证明。
- 定向 lint：通过（仅仓库既有 `library-service.ts` Babel 体积提示）。

## 尚未完成（不得作为已交付宣称）

1. 真实 packaged、Windows 与两台独立设备复制同一资源库的证据；网络 GitHub 路径也尚未做人工验收。
2. Phase C 的 Package 激活、真实崩溃上报、健康窗口回滚和运行时 quarantine；当前安装器仍永远不执行插件入口。Phase B 仅已提供本机 quarantine 状态机和管理恢复入口。
3. 插件设置/命名空间存储和资源库级非秘密设置同步属于后续 Host 生命周期工作，尚未作为已完成能力宣称。
