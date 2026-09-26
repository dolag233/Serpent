# FLV、Illustrator AI、DOC 与 DOCX 预览接入评估

> 日期：2026-09-25
> 问题：在 Windows/macOS 桌面版 Serpent 中接入 FLV、Adobe Illustrator `.ai`、Word `.doc` / `.docx` 的缩略图和查看器预览。
> 结论：FLV 复用现有 FFmpeg 视频管线，难度低；AI 可对含 PDF 兼容表示的文件复用 PDF 管线，但覆盖并不完整，难度中；DOC/DOCX 建议经 LibreOffice headless 转 PDF 后复用 PDF 预览，能力可控但引入大体积跨平台运行时和格式保真问题，难度中高。以下是技术评估，不是对特定样本的实测结论。

## 现有接入点

仓库当前的格式注册表将“格式受支持”定义为 Serpent 拥有缩略图/预览路径；视频格式由 FFmpeg 处理，文档原生预览目前是 PDF、HTML。依赖中已有 `pdfjs-dist`。因此，四种格式都可以考虑复用既有视频或 PDF 衍生物管线，而不应直接把扩展名加入列表就宣称支持。[媒体格式注册表](../../../src/shared/media-formats.ts)、[媒体解析与预览栈](media-preview-stack.md)

实现时需要贯通共享格式注册、格式筛选项、Worker 分类与缩略图任务、`serpent://` 源文件 MIME、Renderer 查看器路由和测试。主要落点包括 `src/shared/media-formats.ts`、`src/shared/product-format-extensions.ts`、`src/renderer/format-filter-presets.ts`、`LibraryService.detectMediaType` 与 PDF/视频 artifact 生成路径、`AssetPreviewModal.tsx`。视频的现有 E2E 会验证媒体解码和播放；新文档预览也应验证真实页面/画面输出，不能只断言扩展名分类或任务成功。

## 难度比较

| 格式 | 入库与元数据 | 缩略图 | 查看器 | 综合难度 |
| --- | --- | --- | --- | --- |
| FLV | 低：扩展名归入视频，复用 ffprobe | 低：复用 FFmpeg 抽帧 | 低到中：原始 FLV 不走 Chromium 直播路径，应使用已有转码代理 | **低** |
| AI | 低：扩展名和 document 类型 | 中：尝试把 AI 当 PDF 交给现有 PDF.js，PDF 兼容文件可用；非兼容文件需要提示无预览 | 中：同缩略图，PDF 表示只代表可视化快照 | **中** |
| DOCX | 低：扩展名和 document 类型 | 中高：需真实排版渲染后生成 PDF/页面图 | 中高：建议生成 PDF 后复用 PDF.js | **中高** |
| DOC | 低：扩展名和 document 类型 | 高：同样要排版渲染，且老式二进制格式兼容性更难稳定 | 中高：LibreOffice 可尝试转换，个别文档会有布局差异或失败 | **中高** |

“入库难度低”只表示分类与索引接入简单。若只纳入库而不预览，应明确作为 `other`/无预览资产处理，不可误标为完整格式支持。

## FLV：低难度，走既有 FFmpeg 视频路径

FFmpeg 官方 `libavformat` 文档明确列出 FLV demuxer，并给出读取 `.flv` 输入的命令示例。项目已有 ffprobe 探测、FFmpeg poster/代理及视频查看器路径，因此主要工作是注册 `.flv`、映射为视频 MIME/类型、检查现有 FFmpeg 构建中 FLV demuxer 与目标编码 decoder 均启用，然后让源文件进入抽帧和代理流程。[FFmpeg FLV demuxer](https://ffmpeg.org/ffmpeg-formats.html#flv_002c-live_005fflv_002c-kux)、[现有视频预览设计](media-preview-stack.md)

FLV 是容器，不保证其中的视频/音频编码都能被当前发行构建解码。应以随应用 FFmpeg 构建的实际能力为准。Chromium `<video>` 的容器/编码支持取决于构建和平台，因此应将 FLV 排除在原文件直播放行之外：卡片抽帧，查看器用现有代理编码成应用支持的播放格式。少量损坏文件、未编入的 codec 或专有编码仍可能失败。[Chromium 音视频格式说明](https://www.chromium.org/audio-video/)、[FFmpeg `ffprobe`](https://ffmpeg.org/ffprobe.html)

许可方面，FLV demux 本身不会自动让 FFmpeg 变成 GPL；Serpent 现有 FFmpeg 分发方案仍须按精确构建参数审查。FFmpeg 官方要求 LGPL 构建不得启用 `--enable-gpl` / `--enable-nonfree`，并提醒某些编解码器另有专利风险。[FFmpeg 法律与许可清单](https://www.ffmpeg.org/legal.html)

## Adobe Illustrator AI：中难度，PDF 兼容表示是有条件的捷径

Adobe 文档说明，保存 AI 时可选择 **Create PDF Compatible File**，在 Illustrator 文件里保存 PDF 表示；关闭该选项可减小文件，但其他 PDF 应用也就不能依赖其中存在可读取的 PDF 表示。于是 Serpent 可先按 PDF.js 尝试解析 AI 文件，解析成功则复用 PDF 的多页渲染与缩略图缓存；解析失败则显示无预览状态，而不是调用 PDF 查看器时让用户看到损坏页面。[Adobe Illustrator 保存选项说明](https://helpx.adobe.com/archive/illustrator/illustrator-cs4-troubleshooting.pdf)、[Adobe PDF 文件选项](https://helpx.adobe.com/illustrator/using/pdf-options.html)

边界要在产品文案中说清：这是 AI 文件内嵌的 PDF 兼容表示，不是 Illustrator 原生文档渲染器。它可能不覆盖私有可编辑数据、效果或在导出视图之外的信息，也不能证明无 PDF 兼容表示的 AI 文件可预览。Adobe 当前仍将 AI 列为 Illustrator 自有格式，并把 PDF 单独列为支持格式，说明二者不能按扩展名等同。[Adobe Illustrator 支持格式](https://helpx.adobe.com/in/illustrator/desktop/get-started/learn-the-basics/supported-file-formats.html)

建议首版：对 `.ai` 执行受限 PDF.js 探测，合法解析后走 PDF 页面渲染；失败则保留可管理/可打开外部应用的资产，但显示“暂不支持预览”。测试样本需覆盖带 PDF 兼容表示、未带兼容表示、加密/损坏、多画板、透明效果和链接图像。若要求“所有 AI 文件有预览”或忠实呈现画板/图层，就需要专用转换工具或 Illustrator 自动化，范围会扩大到高难度及额外许可/安装条件。

## DOC / DOCX：中高难度，统一转换为 PDF

`.doc` 与 `.docx` 不是同一格式。Microsoft 将 DOC 描述为 Word 97–2003 二进制文件，并为其发布 [MS-DOC 二进制格式规范](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/ccd7b486-7881-484c-a137-51170af7cc22)。`.docx` 是 Word 的 XML 文档格式，Microsoft 文件格式参考将其关联到 Open XML / ISO/IEC 29500，并另行维护 Word 扩展规范。[Microsoft Office 文件格式参考](https://learn.microsoft.com/en-us/office/compatibility/office-file-format-reference)、[MS-DOCX 扩展规范](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/b839fe1f-e1ca-4fa6-8c26-5954d0abbccd)

**推荐实现路径**：在隔离的媒体处理进程中调用 LibreOffice Writer headless，把 DOC/DOCX 转成临时 PDF；成功后继续复用 Serpent 的 PDF.js 页面渲染、首屏缩略图和 PDF 查看器。LibreOffice 官方命令行文档支持 `--headless`、`--convert-to pdf` 和指定输出目录，并列有 DOC 转 PDF 的用法。[LibreOffice 启动参数](https://help.libreoffice.org/latest/en-GB/text/shared/guide/start_parameters.html)

这条路径比自行实现 Word 排版现实得多，但属于格式转换，不是 Word 兼容性保证。字体缺失、分页、复杂表格、文本框、嵌入对象、修订/批注、宏、损坏文件及 Word 私有扩展都可能造成差异。DOCX 虽基于公开 XML 标准，也有 Office 扩展；DOC 是历史二进制格式，测试面更大。因此建议在 UI 明确它是预览转换结果，原文件保持不变；第一阶段可先做 DOCX，再纳入 DOC。

### 方案取舍

- **LibreOffice CLI（建议）**：同一跨平台转换后端，复用 PDF.js。代价是要捆绑或可靠发现 LibreOffice，增加安装包体积、启动耗时、平台打包和许可证清单工作；还要在临时目录控制输出及生命周期。LibreOffice 采用 MPL 2.0，项目内包含不同许可证的组件，分发前应盘点实际打包内容并履行 notices/source 要求。[LibreOffice 官方许可说明](https://www.libreoffice.org/licenses/)
- **纯 JS 解析 DOCX**：可提取段落和图片，适合文本索引或简化预览，不足以承诺 Word 页面布局一致。对以视觉浏览素材为主的 Serpent，不适合作为最终文档预览的主路径。
- **依赖用户安装的 Microsoft Word**：Office 能力和版本不可控，macOS/Windows 双平台、无 Office 用户及无人值守批处理都无法得到一致体验；不建议作为内置缩略图路径。

### 开源工具对比

| 工具 | `.doc` | `.docx` | 能力与适合度 |
| --- | --- | --- | --- |
| LibreOffice Writer | 是 | 是 | 完整桌面套件，可 headless 转 PDF 后交给现有 PDF.js。两种格式共用一个方案，综合最适合追求逐页预览的路线；代价是随包提供或发现整个 Office 运行时。 |
| `docx-preview`（docxjs） | 否 | 是 | Apache-2.0 JavaScript 库，在 DOM 中把 DOCX 渲染为 HTML，适合直接在 Electron Renderer 快速做 DOCX 查看器。它不是 DOCX 转 PDF 工具，也不提供高效缩略图接口；实时分页未实现，不能承诺与 Word 页面对齐。 |
| Mammoth.js | 否 | 是 | BSD-2-Clause，把 DOCX 内容转换成简化、语义化 HTML；会有意丢弃许多格式，适合文字提取或可读性优先的预览，不适合视觉版式复现。项目明确提醒调用方对 HTML 做安全处理，并限制不可信文档耗时。 |
| Apache POI HWPF/XWPF | 是 | 是 | Apache-2.0 Java API，能解析两代格式并取文本、段落、表格等；官方称功能中等且部分不完整。HWPF 文档指出其维护人手缺失；虽有 HTML/FO 转换器，但仍需额外 JVM，复杂版式不是低成本保证。 |
| ONLYOFFICE Docs / DocumentServer | 是 | 是 | 有完整文档引擎与 DOC/DOCX 转换能力，但定位为完整 Office Server；Community 版为 AGPL-3.0，官方另有专有版。可做服务集成，不适合作为 Serpent 内轻量库直接嵌入。 |

来源：[`docx-preview` 项目说明与页面限制](https://github.com/VolodymyrBaydalka/docxjs)、[其 Apache-2.0 许可证](https://github.com/VolodymyrBaydalka/docxjs/blob/master/LICENSE)；[Mammoth.js 项目能力、格式取舍及安全提示](https://github.com/mwilliamson/mammoth.js)、[Mammoth.js BSD-2-Clause 许可证](https://github.com/mwilliamson/mammoth.js/blob/master/LICENSE)；[Apache POI HWPF/XWPF 能力与维护状态](https://poi.apache.org/components/document/)；[ONLYOFFICE 支持格式、转换组件和版本许可证](https://github.com/ONLYOFFICE/DocumentServer)；[LibreOffice 转换参数](https://help.libreoffice.org/latest/en-GB/text/shared/guide/start_parameters.html)、[LibreOffice 许可证及第三方组件说明](https://www.libreoffice.org/licenses/)。

**按 Serpent 的成本/效果折中建议**：如果只要求 DOCX 可阅读，优先评估 `docx-preview`，无需打包一套 Office；DOC 仍交给 LibreOffice 转换或只提供外部打开。若 DOC 与 DOCX 都必须有页面级缩略图和查看器，LibreOffice 仍是更直接的共同后端。Mammoth/POI 适合补全文本提取，ONLYOFFICE 适合需要内嵌完整 Office 编辑/协作体验的产品方向。

LibreOffice 转换器属于大型不可信输入解析器。需要独立进程、超时/取消、唯一临时 profile 与临时输出目录、并发限制、输出 PDF 校验和生命周期清理；不要在 renderer 或 Electron main 中运行解析。DOCX 可含嵌入媒体和关系部件，转换时仍须按输入体积、超时与临时磁盘空间限制处理；创建转换目录前先检查目标卷剩余空间，并说明数据写入位置。临时输出必须随任务成功/失败清理，异常退出还需启动时回收机制，遵守仓库的磁盘与临时文件要求。

## 建议推进顺序

1. **FLV**：扩展格式注册和 MIME/视频分类，复用 ffprobe、缩略图、代理与播放状态。风险低，先做。
2. **AI（PDF 兼容样本）**：加 PDF.js 探测/转换器分派，让成功解析的 AI 复用 PDF 视图；无 PDF 兼容内容则明确无预览。风险中，先限定支持边界。
3. **DOCX**：验证打包 LibreOffice 在 macOS/Windows 的安装包体积、启动时间和 PDF 转换质量后，接入 PDF 管线。
4. **DOC**：使用同一转换管线，在真实旧式 Word 文档样本验证后开放；预期比 DOCX 多一些兼容问题。

若不接受打包 LibreOffice 的体积、维护和许可成本，可把 DOC/DOCX 首版降为“可导入与索引、无内置预览”，提供打开外部应用的动作。无需为浏览而上传用户文档到云端。

## 来源

- [FFmpeg Formats：demuxer 与 FLV](https://ffmpeg.org/ffmpeg-formats.html#flv_002c-live_005fflv_002c-kux)
- [FFmpeg Legal：构建及 LGPL/GPL 注意事项](https://www.ffmpeg.org/legal.html)
- [Chromium：音频/视频容器与编解码支持](https://www.chromium.org/audio-video/)
- [Adobe：Illustrator CS4 中 AI/PDF 兼容文件说明](https://helpx.adobe.com/archive/illustrator/illustrator-cs4-troubleshooting.pdf)
- [Adobe：Illustrator 支持格式](https://helpx.adobe.com/in/illustrator/desktop/get-started/learn-the-basics/supported-file-formats.html)
- [Microsoft：MS-DOC](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/ccd7b486-7881-484c-a137-51170af7cc22)
- [Microsoft：Office 文件格式参考](https://learn.microsoft.com/en-us/office/compatibility/office-file-format-reference)
- [Microsoft：MS-DOCX 扩展规范](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/b839fe1f-e1ca-4fa6-8c26-5954d0abbccd)
- [LibreOffice：命令行启动参数](https://help.libreoffice.org/latest/en-GB/text/shared/guide/start_parameters.html)
- [LibreOffice：许可](https://www.libreoffice.org/licenses/)
- [`docx-preview`（docxjs）README](https://github.com/VolodymyrBaydalka/docxjs)
- [Mammoth.js README](https://github.com/mwilliamson/mammoth.js)
- [Apache POI Word API](https://poi.apache.org/components/document/)
- [ONLYOFFICE DocumentServer](https://github.com/ONLYOFFICE/DocumentServer)
