# CLIP STUDIO PAINT 与 PaintTool SAI 预览接入评估

> 日期：2026-11-16
> 问题：在 Serpent 中为 CLIP STUDIO PAINT（CSP）和 PaintTool SAI 的原生工程文件提供缩略图与查看器预览，比较支持难度。
> 结论：只取内嵌预览时，CSP 的 `.clip` 为低到中，SAI 1 的 `.sai` 与 SAI 2 的 `.sai2` 为中。两边都没有厂商公开的绘制规格；完整图层合成都是高难度，不应作为第一版。下文前半是文献评估。文末记录了一次本地试写：合成容器和错误输入可以跑通，厂商样本尚未解码。

## 现有接入点

仓库把“格式受支持”定义为拥有缩略图或预览路径。图片缩略图走 sharp，原文件不被覆盖，显示结果写入可重建衍生物。当前图片扩展名包含 `.psd`，不包含 `.clip`、`.sai`、`.sai2`。[媒体格式注册表](../../../src/shared/media-formats.ts)、[ADR-0020](../adr/0020-media-preview-technology-stack.md)

预览目标应是一张可交给现有图片管线的栅格，而不是在 Serpent 里重做绘画软件。入库分类本身不难；难的是能不能从私有文件里取出一张可靠画面。

## 难度比较

| 格式 | 只取内嵌预览 | 按图层重新合成 | 综合（预览） |
| --- | --- | --- | --- |
| CSP `.clip` | 低到中：定位内嵌 SQLite，读出 `CanvasPreview` 的图片字节 | 高：外部块里的压缩分块，表结构随版本变化 | **低到中** |
| SAI 1 `.sai` | 中：块加密和虚拟文件系统之后，缩略图是裸 BGRA 像素 | 高：32×32 RLE 分块、预乘 alpha、线稿层 | **中** |
| SAI 2 `.sai2` | 中：大画布是私有封装的 JPEG，小画布是 DPCM | 高：256×256 分块、多种图层和混合模式 | **中** |

“低到中”只覆盖软件保存时写入的预览图。该图可能比画布小、可能过期，也可能是空白。它不是图层、蒙版或矢量线的可编辑渲染。

## CSP `.clip`：低到中，预览图已经是常规图片

CELSYS 向 IANA 注册了 `image/vnd.clip`。登记写明没有公开规格，互操作由 CELSYS 自行决定；魔数是 `CSFCHUNK`，扩展名是 `clip`。[IANA `image/vnd.clip`](https://www.iana.org/assignments/media-types/image/vnd.clip)

独立解析把文件描述为外层分块容器，而不是从字节 0 开始的 SQLite 文件。整数为大端。根头 8 字节是 `CSFCHUNK`，随后是 `CHNKHead`、若干 `CHNKExta`、一个 `CHNKSQLi` 和 `CHNKFoot`。`CHNKSQLi` 的载荷以 `SQLite format 3` 开头，可以单独当作 SQLite 数据库打开。`CanvasPreview.ImageData` 在已检查的样本中是 PNG。[clipfile-rs 格式分析](https://github.com/Aodaruma/clipfile-rs/blob/main/docs/format-analysis.md)

Hydrus 的发行代码走更短的路径：在整个文件里查找 `SQLite format 3`，把其后字节写到临时库，执行 `SELECT ImageData FROM CanvasPreview`，再把结果当 PNG 生成缩略图。找不到库或查询失败则退回默认图标。同一模块还从 `Canvas` 读取宽高；单位不一定是像素，需要按 `CanvasUnit` 和分辨率换算。时间线表存在时还会读帧范围。[HydrusClipHandling.py](https://github.com/hydrusnetwork/hydrus/blob/master/hydrus/core/files/HydrusClipHandling.py)、[HydrusFileHandling.py 的 CLIP 分支与魔数](https://github.com/hydrusnetwork/hydrus/blob/master/hydrus/core/files/HydrusFileHandling.py)

另一份只做预览的实现会在 `CanvasPreview` 中取最大的一行，并按字节识别 PNG、JPEG 或 WebP，而不是假定永远是 PNG。许可为 MIT OR Apache-2.0。[clip2preview](https://github.com/tgim4253/clip2preview)

因此第一版不需要解码图层：

1. 校验 `CSFCHUNK`，或在有上限的扫描中定位 `SQLite format 3`。
2. 只把数据库载荷放到临时文件，用只读连接执行固定查询。
3. 校验图片签名和尺寸上限后，交给现有 sharp 缩略图与查看器。
4. 没有预览行、图片损坏或库打不开时，资产仍可入库，画面显示为不支持预览。

完整画面是另一条路径。像素在 `CHNKExta` 外部块里，经 SQLite 的 `ExternalChunk` 索引；分块可以是 zlib。已观察的库表数量和 `Layer` 列数并不固定。社区实现把栅格解码标成可选能力，并明确格式没有官方规格。[clipfile-rs 说明](https://github.com/Aodaruma/clipfile-rs)、[Hydrus 关于完整渲染的问题](https://github.com/hydrusnetwork/hydrus/issues/1711)

`.cmc` 不是单张 `.clip`。已观察的 `.cmc` 从文件头就是 SQLite，并用 `.:pageNNNN.clip` 指向同目录页面。它是多页索引，不能套用 `CanvasPreview` 这一条查询。[clipfile-rs 对 `.cmc` 的记录](https://github.com/Aodaruma/clipfile-rs/blob/main/docs/format-analysis.md)

实现时不要把整个大文件都读进内存后再搜索。公开分析里单个 `.clip` 可以到数百 MB，SQLite 载荷只占其中一段。应限制扫描长度、临时文件大小和图片解码像素数，并在任务结束时删除临时库。

## SAI：中等难度，缩略图不是现成的图片文件

SYSTEMAX 的开发说明把 SAI2 列为版本 2 的私有读写格式，把 SAI 列为版本 1、仅可读取的格式，并同时列出 PSD、PSB、BMP、JPEG、PNG、TGA。页面没有给出这两种私有格式的结构。[PaintTool SAI 开发室](https://systemax.jp/en/sai/devdept.html)

### `.sai`

公开的逆向记录把 `.sai` 描述为加密后的虚拟文件系统，不是文档化的图像容器。块长 4096 字节。每 512 块有一个表块。表块和数据块用同一组静态 256 个 32 位密钥做不同的对称变换；数据块的初始向量来自表块里的校验值。解密后，根目录的文件表从块 2 开始，其中有 `canvas`、图层目录和 `/thumbnail`。作者把这份记录标为个人逆向，并欢迎纠错；SYSTEMAX 没有发布对应规格。库许可是 MIT。[libsai 格式记录](https://github.com/Wunkolo/libsai)、[libsai LICENSE](https://github.com/Wunkolo/libsai/blob/master/LICENSE)

缩略图样本从文档对象取出宽高和像素，再把 BGRA 换成 RGBA 写成 PNG。也就是说，解密并挂上虚拟文件系统之后，缩略图仍是裸像素，不是 PNG 或 JPEG 文件。[Thumbnail-Sai1.cpp](https://github.com/Wunkolo/libsai/blob/master/samples/Thumbnail-Sai1.cpp)

图层像素是另一套解码。32×32 分块，空块为全透明，有效块按通道做 RLE，alpha 预乘，像素顺序为 BGRA。线稿层另行描述。把这些合成成最终画面比取出 `/thumbnail` 重得多。[libsai 栅格层说明](https://github.com/Wunkolo/libsai)

### `.sai2`

一份非官方规格把文件分成 64 字节头、块表和块数据。头的前 16 字节是 `SAI-CANVAS-TYPE0`。块类型名包括 `thum`、`intg`、`layr`、`lpix`。像素以 256×256 分块存放，`intg` 被写成整张合成图，压缩标记为 `dpcm`。作者写明 SYSTEMAX 没有公开说明。[SAI2 非官方规格](https://github.com/photopea/SAI2-specification)

同一研究者后来的读取接口把两条缩略图路径分开：`thum` 是有损缩略图，封装为 `jssf`，再抽出标准 JPEG；`intg` 是无损缩略图，用 DPCM 解成 BGRA。头注释写的是边长达到 512 的画布用 `jssf`，更小的画布用 DPCM。这和上面那份规格对 `intg` 的“整图合成”描述并不完全相同，采用时要以实际文件里的块类型和四字节标记为准，不能只按扩展名选一种解码器。[sai2.hpp](https://github.com/Wunkolo/libsai/blob/master/include/sai2.hpp)、[Thumbnail-Sai2.cpp](https://github.com/Wunkolo/libsai/blob/master/samples/Thumbnail-Sai2.cpp)

Hydrus 用偏移 0 的 `SAI-CANVAS` 识别 `.sai2`，但缩略图分支只实现了 `.clip` 的 SQLite 提取；`.sai2` 使用默认图标。这和“CSP 预览路径短、SAI2 还要私有解码”的差别一致。[HydrusFileHandling.py](https://github.com/hydrusnetwork/hydrus/blob/master/hydrus/core/files/HydrusFileHandling.py)

SAI 的第一版因此是：识别头，解出 `thum` 的 JPEG 或 `intg` 的 DPCM 缩略图，以及 `.sai` 的 `/thumbnail` 像素；失败则无预览。完整图层、线稿、文字和混合模式留在高难度范围。MIT 许可的 libsai 可以作算法对照，分发时保留其版权与许可声明。

## 可直接参考的开源仓库

没有厂商 SDK。能用的都是逆向实现。下面只列有明确许可证、并且确实读文件的项目。Photopea 能打开 SAI，但它的解码器不是可引用的开源模块。Hydrus 已经在发行版里提取 `.clip` 预览，项目本身是 GPL，只能当行为对照，不能把那段代码并进 Serpent。

| 项目 | 格式 | 许可 | 形态 | 实际能力 | 采用判断 |
| --- | --- | --- | --- | --- | --- |
| [clipstudio.js](https://github.com/saitolume/clipstudio.js) | `.clip` | MIT | TypeScript，依赖 `sql.js` | `getThumbnail()` 读 `CanvasPreview.ImageData`；`getLayers()` 只读名称、透明度、可见性和文件夹标记 | 预览最贴现有技术栈。npm 上的 `clipstudio@0.1.1` 停在 2020 年，当前接口在 GitHub `master`（`package.json` 为 1.0.0，2025-07 仍有提交）。会把 SQLite 整段载入 WASM |
| [clipparse](https://github.com/wamsoft/clipparse) | `.clip` | MIT | C++17，另有 Python 绑定 | `preview_png()` 取内嵌预览；另有按块解码、27 种混合模式合成、写回和 PSD 往返。作者称在 CSP 5.0.4 上核对过 | 唯一声称能合成画面的完整库。2026-08 才建立，星标很少，声明尚未在本仓库复现 |
| [clip2preview](https://github.com/tgim4253/clip2preview) | `.clip` | MIT OR Apache-2.0 | Rust crate | 只取最大的预览行，并识别 PNG、JPEG、WebP | 范围小，适合对照，不是 Node 模块 |
| [clipfile-rs](https://github.com/Aodaruma/clipfile-rs) | `.clip`、`.cmc` | MIT | Rust crate | 流式分块、只读 SQLite、有界 PNG 预览；栅格解码是可选功能 | 大文件比整文件读入更稳。实验性，API 面比预览需求大 |
| [clipthumb](https://github.com/jercos/clipthumb) | `.clip` | BSD-2-Clause | C 命令行 | 抽出第一张 `CanvasPreview` 并写成 PNG | 小工具，没有库接口 |
| [clipdecode](https://github.com/LavenderSnek/clipdecode) | `.clip` | LGPL-2.1 | Rust | 格式说明加解析器 | 静态链进应用的许可成本高，不作为首选 |
| [libsai](https://github.com/Wunkolo/libsai) | `.sai`、`.sai2` | MIT | C++ | `.sai` 解密虚拟文件系统并取出 `/thumbnail` 的 BGRA；`.sai2` 把 `thum` 的 `jssf` 转成 JPEG，把 `intg` 的 DPCM 解成 BGRA | SAI 缩略图目前最完整的库。没有 Node 绑定，适合做成独立命令，而不是改 Electron 主进程 |
| [sai2-parser](https://github.com/mishiki/sai2-parser) | `.sai2` | MIT | Rust，含 CLI | 声称把保存的合成图导出 PNG，并把栅格层、文件夹、蒙版、混合模式和观察到的线稿转成 PSD | 2026-08 建立，0 star，最后提交在 2026-09。能力声明强于 libsai 的图层覆盖，采用记录还没有 |

[clipstudio.js 的查询与 `getThumbnail`](https://github.com/saitolume/clipstudio.js/blob/master/src/clipstudio.ts) 只执行 `SELECT ImageData FROM CanvasPreview`，不解码图层像素。[clipparse 的 README](https://github.com/wamsoft/clipparse) 把合成和预览分成两个 API，并写明矢量层以及色阶、色彩平衡等调整层尚未支持。[sai2-parser 的 Cargo 工作区](https://github.com/mishiki/sai2-parser/blob/main/Cargo.toml) 声明 MIT，crate 拆成 core、png、psd 和 cli。

`calmery/ExtractClipStudio` 已归档，仓库页没有许可证，不使用。

对 Serpent 的预览需求：`.clip` 不必为了第一版引入上述库，现有 SQLite 加一次固定查询就够；若要少写容器解析，引用 GitHub 上的 clipstudio.js，而不是 npm 的 0.1.1。需要比内嵌预览更接近画布时再评估 clipparse。`.sai` / `.sai2` 没有对应的 npm 包；缩略图优先对照 libsai，合成图导出再看 sai2-parser 是否经得起样本。

## 本地试写

`.clip` 预览按上面的固定查询自行实现，没有引入 clipstudio.js 或 clipparse。读取器按大端分块定位 `CHNKSQLi`；文件本身以 `SQLite format 3` 开头时则整文件当作库。SQLite 载荷上限 64 MiB，图片上限 32 MiB。临时库以只读、`query_only` 打开，查询取 `CanvasPreview.ImageData` 中最长的一行，并只接受 PNG、JPEG、WebP。测试用合成容器：分块文件和裸 SQLite 都能取回写入的 1×1 PNG，空表返回空。尚未用 CELSYS 导出的 `.clip` 验证。

`.sai` / `.sai2` 调用 libsai 的 `Thumbnail-Sai1` 与 `Thumbnail-Sai2`，不在 Node 里重写解密。源码浅克隆在被 gitignore 的 `out/libsai`，用 Visual Studio 17 2022、x64、Release 编过这两个目标。编译有移位和弃用函数警告，链接成功。调用侧按文件头是否为 `SAI-CANVAS` 选择工具，只在输出文件具有 PNG 签名时返回字节。libsai 仓库没有附带样本。对非 SAI 文件，SAI 1 工具以退出码 1 结束；截断的 `SAI-CANVAS` 头会让 SAI 2 工具以退出码 0 结束且不写出 PNG。两种情况封装都返回空。

两条路径都还没有登记到媒体格式表，也没有接到缩略图任务。

## 建议

1. 若只做预览，先做 `.clip` 的 `CanvasPreview`。依赖已有 SQLite 与图片解码，失败模式清楚。
2. `.sai2` 次之。先覆盖 `thum`/`jssf` 到 JPEG 的大画布，再补小画布 DPCM。
3. `.sai` 与 `.sai2` 不要共用一个解码器。加密虚拟文件系统和 `SAI-CANVAS-TYPE0` 块文件是两种容器。
4. 图层重合成、`.cmc` 多页工程、以及要求与原软件逐像素一致的查看，单独评估。它们都高于内嵌预览。

原文件保持不变。预览写入衍生物缓存。产品文案应说明这是文件内保存的预览，不是在 Serpent 中重新绘制的图层结果。

## 来源

- [IANA `image/vnd.clip`](https://www.iana.org/assignments/media-types/image/vnd.clip)
- [clipfile-rs 格式分析](https://github.com/Aodaruma/clipfile-rs/blob/main/docs/format-analysis.md)
- [clipfile-rs 项目说明](https://github.com/Aodaruma/clipfile-rs)
- [clip2preview](https://github.com/tgim4253/clip2preview)
- [HydrusClipHandling.py](https://github.com/hydrusnetwork/hydrus/blob/master/hydrus/core/files/HydrusClipHandling.py)
- [HydrusFileHandling.py](https://github.com/hydrusnetwork/hydrus/blob/master/hydrus/core/files/HydrusFileHandling.py)
- [Hydrus `.clip` 完整渲染问题](https://github.com/hydrusnetwork/hydrus/issues/1711)
- [PaintTool SAI 开发室](https://systemax.jp/en/sai/devdept.html)
- [libsai 格式记录与许可](https://github.com/Wunkolo/libsai)
- [SAI2 非官方规格](https://github.com/photopea/SAI2-specification)
- [libsai `sai2.hpp` 与缩略图样本](https://github.com/Wunkolo/libsai/blob/master/include/sai2.hpp)
- [clipstudio.js](https://github.com/saitolume/clipstudio.js) 与 [clipstudio.ts](https://github.com/saitolume/clipstudio.js/blob/master/src/clipstudio.ts)
- [clipparse](https://github.com/wamsoft/clipparse)
- [clipthumb](https://github.com/jercos/clipthumb)
- [clipdecode](https://github.com/LavenderSnek/clipdecode)
- [sai2-parser](https://github.com/mishiki/sai2-parser) 与 [Cargo.toml](https://github.com/mishiki/sai2-parser/blob/main/Cargo.toml)
