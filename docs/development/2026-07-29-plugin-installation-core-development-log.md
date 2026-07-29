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

## 本增量验证

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 目录、ZIP、GitHub 安装与不执行脚本 | `src/main/plugin-package-manager.ts`、`plugin-package-archive.ts`、`plugin-github-client.ts` | `tests/unit/plugin-package-manager.test.ts` | 尚未接入界面 |
| 同步代码而非同步信任 | 同上及 `plugin-device-state.json` | 双 userData + 同一 library fixture | 尚未接入界面 |
| 冲突选择、升级重确认、Safe Mode、卸载 | `plugin-package-manager.ts` | 同上 | 尚未接入界面 |

- `npm run test:unit -- tests/unit/plugin-package-manager.test.ts`：203 个测试文件通过，1,616 个测试通过，1 个跳过。
- `npm run typecheck`：通过。
- 定向 lint：通过（仅仓库既有 `library-service.ts` Babel 体积提示）。

## 尚未完成（不得作为已交付宣称）

1. Main/Preload 的受限安装、信任、选择和管理 IPC；Renderer 插件管理页面与 Safe Mode 控件。
2. 真实 Electron/packaged 两设备同步、文件选择器和网络 GitHub 路径证据。
3. Phase C 的 Package 激活、崩溃隔离与 Host；当前安装器永远不执行插件入口。
