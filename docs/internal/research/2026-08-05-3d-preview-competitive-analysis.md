# 3D 资产预览 —— 竞品与技术调研

> 目的：为 Serpent（Electron + TypeScript + React 数字资产管理器，目标用户：游戏美术 / VFX / 设计师）评估「双击 3D 文件 → 实时 3D 预览视口」功能。范围：格式支持、视口功能、PBR 渲染、HDRI 环境光照、Electron 技术栈、缩略图管线、竞品基准。
> 日期：2026-08-05。关联工单：`Serpent-61je.1`（FBX/OBJ 模型预览与 PBR 渲染）、`Serpent-61je`（3D 路线图）。本调研为需求拆解前置。

## 0. TL;DR

- **v1 格式集**：GLB/glTF（一等公民）、OBJ(+MTL)、STL、PLY（three.js 原生 loader 直接加载）+ FBX（Library Worker 中经 FBX2glTF 转成 GLB 后加载，带缓存）。v2 补 DAE、3DS、3MF、USD/USDZ、点云 PLY。BLEND、STEP/IFC 不做（解析复杂度 / 目标用户相关性低）。
- **技术栈**：three.js（不用 Babylon.js、不用 native 渲染）。视口独立 React 模块 + 原生 three.js（R3F 为备选）；渲染后端 v1 用 WebGL2（SwiftShader 软回退利于 CI/E2E），WebGPU 留 v2。
- **PBR**：metal-rough 工作流 + `MeshStandardMaterial`/`MeshPhysicalMaterial`，IBL 由 RGBE `.hdr` 等距柱状图经 `PMREMGenerator` 生成，ACES tone mapping + sRGB 色彩管理。
- **HDRI**：内置 3 个 CC0 预设（studio / natural / sunset），1K–2K 分辨率打包，总计约 5–15 MB；Poly Haven 为来源（CC0 可商用）。
- **缩略图**：渲染进程内隐藏/离屏 WebGL canvas，与视口共用加载与场景构建代码，队列化渲染 PNG，写入现有缩略图管线；不做 headless-gl。
- **竞品定位**：Eagle 已通过「3D Format Extension」支持 FBX/OBJ/GLB 等约 20 种格式并有 hover 预览（PBR 仅 GLB 完整）；Billfish 完全无 3D；Windows 3D Viewer 已下架、FBX 因 CVE-2024-20677 关闭；macOS QuickLook 原生仅 USD 家族。**Serpent 差异化机会：跨平台一致体验 + 更强 PBR/HDRI + 不崩溃的健壮性。**

## 1. 3D 格式支持矩阵

### 目标用户格式分布

| 用户群 | 最常接触格式 | 说明 |
|---|---|---|
| 游戏美术 | FBX（DCC→引擎交换）、glTF/GLB（引擎/Web 交付）、OBJ（雕刻/通用）、STL（打印） | FBX 是 Unity/Unreal 默认导入格式之一；glTF 正在成为"3D 的 JPEG" |
| VFX / 影视后期 | FBX（绑定资产）、USD（电影级流程）、OBJ（渲染交换）、DAE（历史遗留） | 电影行业标准是 USD 与 FBX |
| 平面/UI/品牌 | GLB（电商/AR/交付）、OBJ、STL/3MF（打印）、USDZ（苹果 AR） | AI 生成模型默认导出 GLB/OBJ |

### 格式逐项分析

| 格式 | 常见度 | 解析复杂度 | 加载方式 | 建议 |
|---|---|---|---|---|
| GLB / glTF 2.0 | ★★★★★ | 低（开放标准，PBR 原生） | `GLTFLoader`（一等公民） | **v1 核心** |
| FBX | ★★★★★ | 高（私有二进制无公开规范；three.js FBXLoader 逆向实现不完整） | Worker 内 FBX2glTF → GLB + 缓存 | **v1（经转换）** |
| OBJ (+MTL) | ★★★★ | 低（文本，外部 MTL+纹理） | `OBJLoader` + `MTLLoader` | **v1** |
| STL | ★★★ | 极低（仅三角形，无 UV/材质） | `STLLoader` | **v1** |
| PLY | ★★★ | 低（网格/点云，顶点色） | `PLYLoader` | **v1（网格）/ v2（点云）** |
| DAE / 3DS / 3MF | ★★ | 中 | 现成 loader / 转换 | **v2** |
| USD / USDZ | ★★★ | 高 | `USDZLoader`（简化）或转换 | **v2** |
| BLEND | ★★★ | 高（无可靠公开解析） | 无（提示导出 glTF/FBX） | **不做** |
| STEP / IFC | ★ | 极高（BREP 曲面细分内核） | 无 | **不做** |

### 主流工具支持对比

| 工具 | 支持 | 备注 |
|---|---|---|
| Windows 3D Viewer | 3MF/GLB/OBJ/PLY/STL/glTF；FBX 2024-02 起关闭（CVE）；**2026-07-01 下架** | 微软建议替代 Babylon.js Sandbox |
| macOS QuickLook | 原生仅 USD 家族 | FBX/OBJ/glTF 需转换或插件（Eyemesh/Trice）——对游戏美术基本不可用 |
| Eagle | 约 20 格式（3D Format Extension）；GLB 最完整（PBR+嵌入纹理），FBX 支持嵌入纹理；hover 预览、动画预览 | 复杂大文件有崩溃投诉；无 HDRI 切换；双端体验不一致 |
| Billfish | 无 3D | 空白市场 |
| Unity/Unreal 浏览器 | FBX、OBJ、glTF | 证明"FBX+OBJ+glTF"是引擎资产事实集合 |

来源：[Microsoft FBX 关闭公告](https://support.microsoft.com/da-DK/Windows/Apps/support-for-fbx-files-has-been-turned-off-in-3d-viewer)、[Apple 论坛](https://developer.apple.com/forums/thread/695118)、[Eagle 3D 格式](https://en.eagle.cool:2096/support/article/supported-3d-file-formats-for-thumbnail-preview-what-about-3ds-max-and-maya)、[Billfish 请求帖](https://www.billfish.cn/bbs/thread-70851-1-16.html)

## 2. 合格 3D 视口：功能清单

### Must（合格基线）
- **Orbit / Pan / Zoom**（OrbitControls：左键旋转、滚轮缩放、右键平移；阻尼惯性）
- **Fit-to-view**（加载时自动 + F 快捷键；`Box3.setFromObject`）
- **Reset camera**、up-axis 修正（glTF=Y-up、STL 常为 Z-up，按格式默认 + 可手动切）
- **Solid / Wireframe** 切换；无 UV 模型 flatShading
- **Grid 地面网格 + 软阴影**（model-viewer shadow-intensity 做法，不必实时阴影）
- **PBR 材质**（albedo/normal/metal-rough/emissive/AO 全通道）
- **HDRI 环境切换**（studio / natural 预设）+ 背景色模式
- **ACES tone mapping + sRGB 色彩管理 + exposure 控制**
- **Auto-rotate** 开关
- **三角形/顶点/材质统计 HUD**（`renderer.info`）
- **错误处理**：不支持格式/损坏/超时（>30s）/超体积的明确错误态 + 外部程序兜底
- **性能**：pixelRatio≤2、纹理>2048 降采样、资源 dispose、上下文丢失恢复

### Should（重要加分）
截图导出 PNG（`toDataURL`/`toBlob`）、快捷键（F fit / R reset / 1-2 着色 / 空格暂停）、动画播放（glTF/FBX clips + AnimationMixer）、hover 网格预览（Eagle 标杆体验）、模型信息面板（格式/三角数/材质/包围盒/时间）、up-axis 手动修正持久化。

### Could（v2 打磨）
正交相机、X-ray/半透明、剖面（clipping）、turntable 录制动图、自定义 HDRI 导入 + 环境旋转角 + exposure 滑杆、点云模式、SSAO/bloom、材质变体（KHR_materials_variants）、多选对比视口。

**判断**：Must 齐了才算"合格预览"；Should 是日常使用意愿关键（尤其 hover 预览与截图）。

## 3. PBR 实时渲染（最小可行）

### metal-rough 工作流通道映射
| 通道 | glTF 字段 | three.js 属性 | 说明 |
|---|---|---|---|
| Albedo | `baseColorTexture` | `map` | sRGB 输入，r152+ 自动转线性 |
| Normal | `normalTexture` | `normalMap` | 需切线；OBJ 需 computeVertexNormals |
| Metal/Rough | `metallicRoughnessTexture` | `metalnessMap`+`roughnessMap` | glTF 约定 B=metalness、G=roughness |
| Emissive | `emissiveTexture` | `emissiveMap`+`emissive` | |
| AO | `occlusionTexture` | `aoMap`（需 uv2） | 常与 metal-rough 共用通道位 |
| Alpha | `alphaMode` | `transparent`/`alphaTest` | BLEND/OPAQUE/MASK |

未纹理化兜底：`MeshStandardMaterial` + flatShading + 少量辅助光 + HDRI 环境。顶点色模型 `vertexColors: true`。

### 纹理侧车文件（DAM 特有坑）
- GLB 全内嵌；`.gltf` 可外部引用 `.bin`+纹理——**拖入库时必须保留侧车结构**否则断链
- OBJ 三件套（.obj+.mtl+纹理）路径脆弱——**以资产磁盘位置为基准解析**，断链降级纯色 + 提示
- FBX 转换管线必须**把外部纹理一并嵌入输出 GLB**

## 4. HDRI 环境光照策略

### IBL 流程
1. RGBE `.hdr` 等距柱状图（`RGBELoader`；LDR PNG 做 IBL 效果差）
2. `PMREMGenerator.fromEquirectangular` → PMREM（按 roughness 分级预滤波，同时服务漫反射与高光反射）
3. `scene.environment = pmremTexture` + 可选背景；**切换时预生成 2–3 个 PMREM 缓存**避免卡顿

### 预设来源与体积
- **Poly Haven**（CC0 可商用无需署名）：Studio / 自然（Fields、Coast、Mountains）分类
- 1K/2K 档位通常 1–4 MB/张；**4 张 1K 约 4–8 MB，2K 约 12–20 MB**——作为 app 内置可接受；绝不打包 8K

### Electron 打包策略
内置 3 预设（studio 棚拍 / natural 户外晴天 / sunset 黄昏），1K（缩略图）–2K（视口）分辨率；`app.asar` 内 `resources/hdri/*.hdr` 异步加载 + 按需生成 PMREM；启动零预处理；用户导入自定义 `.hdr` 放 v2；README/关于页致谢 Poly Haven。

## 5. Electron 技术栈选型

### three.js vs Babylon.js vs native
| 维度 | three.js | Babylon.js | native |
|---|---|---|---|
| 定位 | 轻量渲染库（~200KB gzip） | 全功能引擎（1MB+） | 自建一切 |
| loader 生态 | GLTF/OBJ/STL/PLY/DAE/3DS/USDZ/FBX 最全 | glTF 健壮、格式略逊 | 需绑 assimp |
| React | R3F+drei（Environment/OrbitControls/Stats 现成） | 无官方绑定 | — |
| WebGPU | r171+ 零配置，WebGL2 自动回退 | 最早最完整 | — |
| 风险 | WebGPU 在部分硬件（M1 Pro 多物体 15fps）性能倒退 | 单体重 | 维护成本高 1-2 数量级 |

**结论：three.js**。需求是"单模型预览视口"；loader 生态最全；R3F/drei 覆盖大半需求；SwiftShader 软回退保证 CI/E2E 可用。**WebGL2 锁定 v1**（兼容面最广 + SwiftShader），WebGPU 留 v2（r182+ 评估）。

### React 集成：原生 three.js vs R3F
**推荐原生 three.js + 薄 React 组件封装**（`<Asset3DViewport />`），共享模块抽 `renderer/3d/`（loaders/scene-builder/env-manager）。理由：3D 模块保持最小依赖面；**场景构建与缩略图管线共用纯 TS 代码是核心收益**；功能稳定后视口几乎不变。R3F 备选（若做动画面板/材质调试 UI 再评估）。

### FBX 处理：转换而非硬解析
- three.js FBXLoader 是逆向实现：版本兼容性差、官方态度"FBX 需要死掉"
- **推荐：Library Worker（UtilityProcess）内 FBX→GLB 转换**：FBX2glTF（facebookincubator，BSD-3，`--binary --pbr-metallic-roughness`，嵌入纹理/动画烘焙）或 npm 包装 `fbx2glb`（+gltf-transform 优化）；备选 assimp
- **转换产物缓存**（GLB 按源文件 hash+mtime 失效）
- **为什么 Worker**：符合 Serpent 架构（Worker 是文件系统唯一所有者）；FBX 解析有安全史（CVE-2024-20677），隔离解析器；CPU 密集不阻塞 UI
- 转换失败兜底：FBXLoader 直读（能看几何即可）→ 仍失败显示"不支持该 FBX 变体"

### 性能边界（DAM 预览量级）
- 三角形：1–5M 可流畅；>2M 提示、>20M 拒绝并建议外部程序
- 纹理显存：2048² RGBA8 ≈16-22MB；预览一律降到 2048 以下；全场景预算 <500MB
- pixelRatio≤2、draw call <1000、交互 60fps / 自动旋转 30fps

## 6. 缩略图生成

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| A. 隐藏 WebGL canvas（渲染进程内） | 与视口共享代码；toBlob 直接出图 | 占用渲染进程 GPU 上下文 | **推荐** |
| B. 打开视口时截图 | 零额外代码 | 首屏网格无图 | 仅补充 |
| C. headless-gl | 完全脱离 UI | 仅 WebGL1；three 已弃用 WebGL1 | **否决** |
| D. 隐藏 BrowserWindow | 完整渲染能力 | 多窗口进程 | 备选 |

推荐 A：渲染进程隐藏离屏 canvas + 单例 WebGL context + 批量队列（并发 1–2）：
1. 检测新 3D 文件 → 入队；2. 解析/转换（FBX 走 Worker）→ 构建场景（**与视口共用 buildScene()**）→ 渲染 1–2 帧 → `canvas.toBlob('image/png')` → 缩略图库；3. 时间预算（单资产 10s）、尺寸上限（>20M 跳过占位）、失败错误态；4. 动画默认第 0 帧；5. 源文件 mtime/hash 变化 → 失效重生成。

## 7. 竞品基准表

| 产品 | 格式 | 预览交互 | 材质/光照 | 缩略图 | 借鉴点 / 短板 |
|---|---|---|---|---|---|
| Windows 3D Viewer | 3MF/GLB/OBJ/PLY/STL/glTF（FBX 关闭）| orbit/zoom、着色模式 | 高质量 PBR | 无 | 教训：FBX 安全风险；已下架 |
| macOS QuickLook | 仅 USD 家族 | 简单旋转/缩放 | USD 材质 | Finder（仅 USD） | macOS 端对游戏美术基本不可用——**空白市场** |
| Eagle | ~20 格式 | hover 预览、双击视口、动画 clip 切换 | GLB PBR；FBX 仅嵌入纹理 | 刷新、换帧 | **最直接标杆**；短板：大文件崩溃、无 HDRI、双端不一致 |
| Billfish | 无 3D | — | — | — | 竞品缺口 |
| model-viewer | 仅 GLB | orbit/auto-rotate/shadow/exposure | glTF PBR + IBL 环境 | poster | **HDRI 环境切换的产品范式**（environment-image + shadow-intensity）|
| Unity/Unreal | FBX/OBJ/glTF | 缩略图+导入预览 | 引擎级 PBR | 导入生成 | 事实格式集合 |

## 8. 推荐 v1 范围 + v2 路线图

### v1（一个切片可交付）
- **格式**：GLB/glTF（一等）、OBJ(+MTL)、STL、PLY（原生 loader）；FBX → Worker FBX2glTF 转 GLB + 缓存；明确的不支持/损坏错误态
- **视口**：orbit/zoom/pan（阻尼）、fit-to-view、reset、auto-rotate、solid/wireframe、grid+软阴影、背景色、ACES+exposure、统计 HUD、截图导出、up-axis 默认修正
- **渲染**：MeshStandardMaterial/MeshPhysicalMaterial 全通道 PBR、无纹理 flatShading 兜底、**3 个内置 HDRI 预设（studio/natural/sunset，1K–2K，PMREM 缓存）**
- **缩略图**：隐藏离屏 canvas 队列管线（并发 1–2、10s 预算、尺寸上限、失败占位），FBX 走转换产物；与视口共享 `buildScene()`
- **健壮性**：>2M 三角警告、>20M 拒绝、纹理>2048 降采样、pixelRatio≤2、dispose、WebGL 上下文丢失恢复
- **架构契合**：文件字节经 IPC（typed array + Zod）从 Library Worker 流向渲染进程；转换只在 Worker；3D 模块独立目录（`renderer/3d/`），不膨胀 App.tsx

### v2
DAE/3DS/3MF/USD/USDZ、PLY 点云、Draco/KTX2；hover 网格预览、动画播放/选帧缩略图、正交视图、X-ray、剖面、turntable 录制；自定义 HDRI 导入、环境旋转角、光照预设 4–6 个；SSAO/bloom、WebGPU 迁移评估（r182+）；Windows/macOS 双端 QA（Windows 无 runner，显式未验证项）。

## 9. 风险与未验证项

1. **FBX 生态碎片化**：FBX2glTF 对 Maya/3ds Max 产出覆盖度需真实样本验证；转换失败兜底（FBXLoader 直读）实测
2. **Windows 无 CI/runner**：WebGL/FBX 转换/缩略图行为无法自动验证（既有约束）
3. **超大/畸形文件**：v1 必须把体积/拓扑守卫做成硬门禁，QA 用大模型（5M+ 三角、4096² 纹理）实测
4. **侧车纹理断链**：OBJ/glTF 外部纹理在库内移动/重命名后的路径解析是 DAM 特有坑
5. **HDRI 版权**：选 Poly Haven CC0，发布前逐资产核对
6. **WebGPU 性能退步**：v1 锁定 WebGL2 避免踩坑

## 参考来源

- 格式：[Tripo3D](https://www.tripo3d.ai/blog/glb-vs-gltf-vs-obj) · [Meshy](https://www.meshy.ai/zh/blog/3d-file-formats) · [3dverse](https://docs.3dverse.com/references/supported-file-formats) · [Appian 3D Viewer](https://docs.appian.com/suite/help/26.6/3d-viewer.html)
- 查看器：[Microsoft FBX 关闭](https://support.microsoft.com/da-DK/Windows/Apps/support-for-fbx-files-has-been-turned-off-in-3d-viewer) · [3D Viewer 下架](https://dev.to/josh_green_dev/microsoft-3d-viewer-dies-july-1-the-stl-gap-nobody-is-talking-about-2580) · [Apple 论坛](https://developer.apple.com/forums/thread/695118) · [Eagle 3D 格式](https://en.eagle.cool:2096/support/article/supported-3d-file-formats-for-thumbnail-preview-what-about-3ds-max-and-maya) · [Eagle 动画预览](https://en.eagle.cool:2096/support/article/how-to-enable-animation-preview-for-3d-models) · [Billfish](https://www.billfish.cn/bbs/thread-70851-1-16.html) · [Unreal Interchange](https://dev.epicgames.com/documentation/unreal-engine/importing-assets-using-interchange-in-unreal-engine)
- three.js：[格式讨论](https://discourse.threejs.org/t/what-3d-model-file-type-is-best-for-three-js/22308) · [r152 色彩管理](https://github.com/mrdoob/three.js/issues/30305) · [PMREM 示例](https://threejs.org/examples/webgl_materials_envmaps_hdr.html) · [性能](https://discourse.threejs.org/t/complex-gltf-performance-improvement-advice/84447/2) · [WebGPU 对比](https://discourse.threejs.org/t/why-webgpurenderer-performance-significantly-lower-than-webglrenderer/77629/11)
- 引擎：[edana 对比](https://edana.ch/en/2025/10/17/three-js-vs-babylon-js-vs-verge3d-which-to-choose-for-a-successful-3d-project/) · [dev.to 对比](https://dev.to/devin-rosario/babylonjs-vs-threejs-the-360deg-technical-comparison-for-production-workloads-2fn6)
- 转换：[FBX2glTF](https://github.com/facebookincubator/FBX2glTF/blob/main/npm/fbx2gltf/README.md) · [fbx2glb](https://www.npmjs.com/package/fbx2glb)
- HDRI：[Poly Haven 许可（CC0）](https://polyhaven.com/license) · [HDRI 分类](https://polyhaven.com/hdris) · [体积参考](https://polyhaven.com/zh/a/lakes) · [FastHDR](https://cloud.needle.tools/articles/fasthdr-environment-maps)
- 缩略图：[render-glb](https://www.npmjs.com/package/render-glb) · [3d2png](https://github.com/OpenDEM/3d2png) · [Spacedrive 讨论](https://github.com/spacedriveapp/spacedrive/discussions/2454)
- model-viewer：[FAQ](https://modelviewer.dev/docs/faq.html)
