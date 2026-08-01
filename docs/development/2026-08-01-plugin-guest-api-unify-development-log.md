# 插件 Guest API 统一开发日志

> 日期：2026-08-01  
> 工单：`Serpent-029r`（已认领，未关闭）  
> 状态：开发态部分实现，待并行内容读取轨道合流

## 目标与范围

将 Standard QuickJS 与 Trusted Node Host 的 `serpent.assets.*`、`serpent.library.*` 方法定义收敛到 `src/scripting/serpent-guest-api.ts`。共享模块同时负责命令输入构造和资产列表、资源库摘要的 Guest 投影；storage、events、hooks、jobs、providers、commands、input 和 console 保留为各 Host 的运行时适配器。

本增量未加入 `assets.readContent`：`asset.content.read` 仍由并行工单实现，避免与其同时修改命令协议和 QuickJS 接缝。

## 实现入口

- `src/scripting/serpent-guest-api.ts`：共享命令表、`createSerpentGuestApi`、资产/资源库方法集合。
- `src/scripting/plugin-trusted-host.ts`：移除 Trusted 的 assets/library 手工列表，改用共享 Guest API。
- `src/scripting/quickjs-sandbox-prototype.ts`：通过共享命令表生成 QuickJS assets/library 函数；其他插件专属表面仍按现有 Host 接缝生成。
- `tests/unit/plugin-trusted-host.test.ts`：校验 Trusted Host 暴露的资产和资源库方法键与共享集合一致。

## 验证与剩余范围

本回合执行：

```bash
npx vitest run tests/unit/plugin-trusted-host.test.ts -t "shared Guest API|loads a CommonJS"
npx vitest run tests/unit/quickjs-sandbox-prototype.test.ts -t "fixed asset|organize automation|library.changeSequence|headless library|does not expose process"
npx tsc --noEmit --pretty false
```

结果：Trusted 定向测试 2/2 通过；QuickJS 共享命令定向测试 5/5 通过。类型检查已排除本增量引入的错误，但当前共享工作树仍被并行轨道的 `src/worker/library-service.ts` 未定义变量和缺失 `src/plugins/plugin-data-directory.ts` 模块阻断。完整 Trusted/QuickJS 文件测试中的 `assets.readContent` 用例继续等待并行 content.read 实现。

未执行完整测试、Electron E2E 或 `verify:mainline`。

已知剩余：

- `assets.readContent` 等 `content.read` 接缝待并行轨道合流后纳入共享命令表。
- storage、events、hooks、jobs、providers、commands、input、console 仍允许由 Standard/Trusted 分别提供运行时适配器。
- Trusted/Standard 的完整真实插件旅程、packaged、Windows 和 Computer Use 未验证。
