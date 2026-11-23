# 资源库磁盘占用与 FBX 查看缓存

## 成因

`.serpent/artifacts/` 下的 `*.model_glb` 是完整模型查看产物。打开 FBX 或在查看器中切换到某个 FBX 时，查看器向 Worker 请求转换，Worker 优先复用当前修订中已就绪且生成器版本匹配的结果。缺少可用结果时，会把 FBX 转成 GLB，写入当前资源库的产物目录。同一个库内同一资产的并发请求复用一次转换。[查看器调用](../../../src/renderer/3d-viewer/viewer-surface.tsx#L336) · [查看器切换](../../../src/renderer/AssetPreviewModal.tsx#L1812) · [转换与落盘](../../../src/worker/fbx/convert-command.ts#L37) · [缓存读取](../../../src/worker/fbx/converter.ts#L272)

原有离屏缩略图和 AI 多视图还会在 Worker 端先转换 FBX，再把 GLB 地址交给离屏页面。即使离屏页面不传转换回调，导入和后台缩略图生成也能积累 `model_glb`。原有实现可在 `v0.3.7` 的 `src/worker/index.ts` 中查看 `orchestrateRender`。[发布版本 Worker 路由](https://github.com/dolag233/Serpent/blob/v0.3.7/src/worker/index.ts)

GLB 可以比 FBX 源文件大。转换桥按面角展开位置、法线和 UV，以 Float32 记录属性，并以 Uint32 记录三角化索引。GLB 构建器写入这些二进制几何数组，还可嵌入材质贴图，包括可用的外部 PNG 或 JPEG。几何数组直接写入 GLB。同一外部贴图若被多个模型引用，每个 GLB 可各自包含这份贴图。[几何打包](../../../scripts/ufbx-bridge.c#L562) · [贴图嵌入](../../../src/worker/fbx/glb-builder.ts#L251)

## 保留与回收

- 转换产物按资产当前修订记录，自身有独立随机文件名。生成器版本变化可以触发重新转换。写入新产物会令同一修订的旧同类产物失效，旧文件不在这次写入中直接删除。[产物写入](../../../src/worker/library-service.ts#L30357)
- 打开资源库后的后台对账会扫描平铺产物目录。在文件不再有有效产物记录引用、超出五分钟宽限期、且为非临时的普通文件时，才尝试删除。当前有效 GLB 会被保留。该写入与对账路径没有 GLB 字节配额、按最近使用时间淘汰或有效文件的过期策略。[孤儿文件回收](../../../src/worker/library-service.ts#L32234) · [后台对账调用位置](../../../src/worker/library-service.ts#L32949)
- 数据库备份采用两个轮换槽。平时在已有近期备份时可跳过，破坏性操作按需申请完整快照。备份、数据库和其他预览均应分别统计，避免把有效派生文件与用户源文件或恢复数据混在一起。[数据库备份轮换](../../../src/worker/library-service.ts#L7881)

确认磁盘占用来源时，分别统计子目录、产物扩展名和目录记录，并按修订聚合。文件与修订可以一一对账时，只能确认注册关系及文件是否孤立。判断不同资产是否使用相同源文件内容，仍需可用指纹或实测内容比对。
