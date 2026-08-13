# 2026-08-13 全量 E2E（C 阶段）报告

## 范围

- 当前 HEAD：`41429aaa1ad7f2c86eb35ee2dddba0320a18f130`
- 标准开发态 Electron E2E：`npm run test:e2e:isolated`
- 扩展功能 E2E：未列入标准脚本的 15 个 E2E 文件，按功能组串行隔离执行
- 当前 HEAD packaged E2E：重新执行 `npm run package` 后运行 `npm run test:e2e:packaged`
- 所有 packaged 测试均使用临时 `SERPENT_E2E_USER_DATA_PATH`；未使用用户默认数据

## 结果

| 范围 | 结果 |
| --- | --- |
| 标准开发态套件 | 76 passed / 3 skipped / 0 failed（79 tests，4.3m） |
| 自动化脚本功能组 | 8 passed |
| AI Inspector | 0 passed / 2 failed |
| MCP headless launcher | 0 passed / 1 failed |
| 图片序列、导入冲突、元数据 | 1 passed / 2 failed |
| 模型缩略图、模型查看器、PBR | 1 passed / 8 blocked（WebGL 不可用） |
| 插件功能组 | 3 passed |
| packaged macOS | 2 passed / 1 skipped（Windows 专属） |

## 已确认问题

1. `Serpent-ibu7`：MCP headless launcher 的 `listTools` 60 秒超时；renderer console 报 `Icons.tsx:331 $RefreshReg$ is not defined`。
2. `Serpent-ramh`：图片序列查看器键盘 `Home` 后 `ArrowRight` 稳定得到 `motion_002.png`，而用例预期 `motion_001.png`，存在帧索引语义不一致。
3. `Serpent-4g1p`：AI Inspector 用例在 macOS 查找 Windows 专用的“主菜单”入口，未进入业务断言。
4. `Serpent-4rr4`：元数据 E2E 的可访问名称因排版拆词导致定位器失效；错误上下文显示资产已导入并显示在界面中。

## 环境限制与未验证项

- 模型相关 8 个用例运行环境报告 `GL_VENDOR=Disabled`、`Could not create a WebGL context`；这是当前无可用 WebGL/GPU 的执行环境限制，不能记为业务通过，需在有 GPU 的真实桌面或 Computer Use 环境复验。
- 标准套件的 3 个 skip 为历史视频预览完全重启、Windows 自定义关闭/托盘、Windows 字体；packaged 套件另有 1 个 Windows 专属 skip。
- Windows packaged、Windows installer 和真实 Windows GPU/WebGL 旅程未执行。

## 进程与环境清理

- MCP launcher 失败后检查无残留 `run-mcp`、Serpent 或 Electron 进程。
- `npm run package` 成功；随后执行 `npx @electron/rebuild -f -w better-sqlite3`，开发态 native ABI 已恢复。
