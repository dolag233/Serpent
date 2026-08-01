# 插件分发、Release 命名与更新策略

> 状态：产品规范（2026-08-01）  
> 安装通道：**GitHub** · **本地 ZIP** · **本地文件夹**  
> 实现跟踪：`Serpent-u3nx`（Release asset + 平台匹配）、`Serpent-8r91`（更新提示与自动更新）  

> 相关：[`plugin-development-guide.md`](plugin-development-guide.md)、[0024](implementation/0024-script-plugin-platform.md)、[ADR-0026](adr/0026-plugin-runtime-installation-and-trust.md)

## 1. 安装通道（产品面）

| 通道 | 用户操作 | Serpent 行为 |
| --- | --- | --- |
| **本地文件夹** | 选择已构建的插件目录 | 校验清单与 `runtime.entry` 后拷贝进安装根 |
| **本地 ZIP** | 选择符合规范的 `.zip` | 解压后同上校验 |
| **GitHub** | 粘贴 `https://github.com/owner/repo` 或 Release 页 URL | **优先**取匹配当前平台的 **Release asset ZIP**；不得默认对源码 zipball 跑 `npm install`/`build` |

三条通道装入后的包形态必须相同：**成品包**（见 §3），不是未构建源码树。

本地「源码目录 + 现场 npm」**不做**：用户路径仅为成品包三通道。

## 2. 平台标识（判定与命名共用）

与 Electron / Node `process.platform` + `process.arch` 对齐（清单 `nativeModules` 已用同一套）：

| 规范 token | 含义 | Node 对应 |
| --- | --- | --- |
| `darwin-arm64` | macOS Apple Silicon | `darwin` + `arm64` |
| `darwin-x64` | macOS Intel | `darwin` + `x64` |
| `win32-x64` | Windows 64 位（常见） | `win32` + `x64` |
| `win32-arm64` | Windows on ARM | `win32` + `arm64` |
| `win32-ia32` | Windows 32 位（可选维护） | `win32` + `ia32` |
| `linux-x64` | Linux x86_64 | `linux` + `x64` |
| `linux-arm64` | Linux aarch64 | `linux` + `arm64` |
| `any` | 无原生二进制、全平台同一 ZIP | — |

口语文案映射（UI 可用，**文件名必须用规范 token**）：

| 口语文案 | 规范 token |
| --- | --- |
| Mac Apple Silicon / M 系列 | `darwin-arm64` |
| Mac Intel | `darwin-x64` |
| Windows x64 | `win32-x64` |
| Windows ARM | `win32-arm64` |
| Windows x86（32 位） | `win32-ia32` |

安装与更新时：先匹配 `platform-arch` 精确 asset；若无则尝试 `any`；再无则失败并提示缺少本平台包（不得静默下载错误架构）。

无限制插件若声明 `runtime.nativeModules`，还须与当前 `nodeAbi` 兼容（既有兼容性校验保留）。

## 3. 成品包内容（ZIP 内 / 文件夹内）

根目录（或 ZIP 解压后唯一顶层目录）须含：

```text
serpent-plugin.json
README.md
LICENSE
<entry 指向的已编译 JS>   # 如 entry/main.js 或 dist/main.js
[可选 ui/ 等清单声明文件]
[可选：已捆绑的 node_modules 或原生 .node，按平台 ZIP 分流]
```

禁止依赖用户机器现场执行 `npm install` / `npm run build` 才能通过校验。

## 4. GitHub Release 结构与 asset 命名

### 4.1 Release

- 使用 **GitHub Release**（建议 tag = 清单 `version`，如 `1.2.0` 或 `v1.2.0`，安装器应接受可选 `v` 前缀）。
- 每个需要原生/平台分流的版本，为**每个支持的平台**上传一个 ZIP asset。
- 纯 JS、无原生依赖：可只上传一个 `…-any.zip`。

### 4.2 Asset 文件名（强制）

```text
{pluginId}-{version}-{platformToken}.zip
```

规则：

- `pluginId`：与清单 `id` 完全一致（小写、点分，如 `com.example.image-upscaler`）
- `version`：SemVer，**不含**前导 `v`（如 `1.2.0`）；Release tag 可为 `v1.2.0`
- `platformToken`：§2 规范 token（`darwin-arm64`、`win32-x64`、`any` 等）
- 仅允许字符：`[a-z0-9._-]`；整名大小写敏感，发布时用小写

示例：

```text
com.example.image-upscaler-1.2.0-darwin-arm64.zip
com.example.image-upscaler-1.2.0-darwin-x64.zip
com.example.image-upscaler-1.2.0-win32-x64.zip
com.example.image-upscaler-1.2.0-win32-arm64.zip
com.example.palette-tools-2.0.1-any.zip
```

推荐另附 `SHA256SUMS`（或每个 zip 旁 `.sha256`）；实现阶段可先做文件名匹配，哈希校验作为增强。

### 4.3 仓库 URL 解析优先级

用户粘贴 GitHub 相关 URL 时，建议顺序：

1. **Release / tag 页** → 解析 owner/repo + tag → 列 assets → 选平台 ZIP  
2. **仓库根 URL** → 取 **最新稳定 Release**（非 draft/prerelease，除非用户显式选预发布）→ 同上  
3. **兼容回退（过渡期）**：若 Release 无规范 asset，但 tag/默认分支 zipball 内已有成品包，可继续旧行为并提示作者迁移到 Release asset（过渡结束后可移除）

不默认执行：对源码归档跑 package manager。

## 5. 更新显示与自动更新

仅对 **来源为 GitHub** 且能解析到规范 Release asset 的安装生效。本地文件夹 / 本地 ZIP 不自动检查远端（用户可重新选择文件覆盖安装）。

### 5.1 显示更新

设置 → 插件列表中，对 GitHub 安装的包：

- 定期或打开设置时检查：是否存在更高 SemVer 的 Release，且含当前平台（或 `any`）asset  
- 若有：显示「有可用更新：{newVersion}」与「更新」按钮  
- 更新前复用既有 **来源/权限/运行时模式变更** 确认；包哈希变化时资源库插件需按信任规则处理

### 5.2 自动更新（可选勾选）

- 默认：**关闭**  
- 勾选前必须展示风险说明（阻塞确认），文案要点：

  - 将从 GitHub 下载并替换本机插件代码，**可能引入恶意或不兼容变更**  
  - 新版本可能提升权限、改为无限制模式或附带原生模块  
  - 网络与 GitHub 可用性影响更新；失败时保持旧版本  
  - 自动更新**不会**跳过本机信任与高风险确认（若策略要求仍弹窗，则自动更新只负责下载，启用前仍确认）

- 策略建议（实现默认）：

  | 变更类型 | 自动更新行为 |
  | --- | --- |
  | 同权限、同 runtime.mode、SemVer 补丁/次要 | 可自动下载并在下次开库切换（或空闲时切换） |
  | 权限增加 / runtime.mode 变更 / 源变更 | **不得**静默启用；改为「待确认更新」通知 |
  | 主版本或破坏性 | 同上，强制确认 |

- 设备态保存：`updatePolicy: follow-latest | pinned` 可扩展为显式 `autoUpdate: boolean`（pinned 时强制关闭自动更新）

### 5.3 与 Safe Mode

Safe Mode 只停用无限制插件；自动更新检查可继续，但**不得**在 Safe Mode 下激活新装的无限制包。

## 6. 作者发布检查清单

1. `npm ci && npm run build`（或等价）产出成品目录  
2. 按平台打 ZIP（原生依赖必须打进对应平台包，勿假设用户有编译链）  
3. 按 §4.2 命名并上传到 GitHub Release  
4. 清单 `version` 与 Release tag / 文件名 version 一致  
5. 无限制插件填写正确的 `nativeModules`（platform/arch/nodeAbi）  
6. README 写明支持的平台 token 列表  

## 7. 实现分期

| 阶段 | 工单 | 内容 |
| --- | --- | --- |
| 1 | `Serpent-u3nx` | GitHub 安装改读 Release assets；平台 token 匹配；文档与校验错误码；过渡期 zipball 回退 |
| 2 | `Serpent-8r91` | 设置页「有可用更新」；手动更新；自动更新勾选 + 风险文案 + 权限升级阻断静默 |
| 后续 | — | SHA256 校验、prerelease 开关（不做源码目录 npm） |

`Serpent-upsn.9`（打包/最终 QA）仍排在平台收口最后，不阻塞本规范文档落地。
