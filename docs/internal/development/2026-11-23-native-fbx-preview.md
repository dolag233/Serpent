# FBX 直接预览

工单 `Serpent-e70485`。交互查看、后台模型缩略图和 AI 多视图直接读取当前 FBX 源修订。旧 GLB 文件和显式转换接口保留。独立 GLB、glTF、OBJ、STL 继续走原格式加载器。

| 行为 | 实现 | 验证 |
| --- | --- | --- |
| 查看 FBX 源模型 | `src/renderer/3d-viewer/loader-registry.ts`、`src/renderer/3d-viewer/viewer-surface.tsx` | `tests/e2e/model-viewer.test.ts` 核对真实几何统计和没有 `.model_glb` |
| 模型缩略图和多视图读取源修订 | `src/worker/index.ts` 的 `orchestrateRender`；保留源与贴图授权 | `tests/e2e/model-thumbnail.test.ts` 实际解码 FBX 缩略图且没有 `.model_glb`；AI 完整旅程未运行 |
| 贴图加载完成后才绘制，重复打开可结束加载 | `loader-registry.ts` 的独立 LoadingManager 计数、库内贴图重映射和 TGA/TIFF 解码器 | `tests/unit/3d-viewer-loader-registry.test.ts` 覆盖源加载、共享请求、伴随贴图等待和错误 |
| 后台 FBX 完成后释放离屏页面 | `src/main/offscreen-thumbnail-renderer.ts` 结算后重建下一任务的离屏页面 | `tests/unit/offscreen-thumbnail-renderer.test.ts` 覆盖 FBX 完成后的窗口回收和下一作业接续 |

旧 Worker 会在缩略图或 AI 渲染前写完整 GLB。交互查看也曾请求转换，因此只改交互入口无法停止增长。查阅旧版路由后更正了[磁盘调查](../research/2026-11-22-library-storage-usage.md)。

独立审查发现共享读取可能不向第二个 Loader manager 登记、原生贴图解码能力和资源保留三处风险。已增加每次加载自己的计数、TGA/TIFF loader、释放已请求内嵌贴图的对象 URL、处理取消后迟到的场景，以及完成后销毁离屏页面。主窗口里的原生 `FBXLoader` 仍同步解析。超大模型的交互解析时延和模块引用保留尚未解决，不能用后台缩略图证据宣称主窗口性能改善。

## 验证

- `node scripts/run-e2e.mjs tests/e2e/model-viewer.test.ts tests/e2e/model-thumbnail.test.ts -g FBX --trace off`，Windows 后台 Electron 从当前代码重建，2 项通过。查看器得到真实几何统计，缩略图实际解码，两条用例均核对未生成 `.model_glb`。
- 同一构建执行 `tests/e2e/fbx-capacity-recovery.test.ts`，1 项通过。对只读大型样本的导入副本生成了原生缩略图，文件哈希验证源未变化。浏览请求 177 次，P95 为 7.3 ms，最大值 22.4 ms。任务结算后只剩主界面的 Tab 进程，未生成 GLB。此用例检查后台路径，前台大文件查看未运行。
- 定向 Vitest 4 文件 33 项通过，相关 ESLint 和差异检查通过。全仓类型检查仅见既有 CLIP 四项错误。
- Three 对内嵌 `.tiff` 的前置兼容仍有限，注册 TIFFLoader 可以处理外链及加载器已接受的内嵌 `.tif`。macOS、安装包和 AI 完整旅程未执行。
