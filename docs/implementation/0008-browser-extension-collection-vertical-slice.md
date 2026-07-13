# 第0008垂直切片：浏览器扩展采集

> 状态：自动实现与安全收口完成；真实 Chrome/Edge/Windows 手工 QA 待完成
> 日期：2026-07-13

## 目标

让用户通过 Chromium 系浏览器扩展右键保存网页中的单张图片或视频到当前活动资源库的选中文件夹，自动记录源网页地址为"源链接"元数据。扩展与桌面应用通过本地 HTTP（127.0.0.1）通信；安全边界仅为 loopback，不暴露任意文件系统能力。下载与写入复用切片 0002 的 staging-commit-rollback 流程和切片 0004 的 `asset_metadata` 层。

## 用户主线

1. 用户在 Chrome/Edge 等 Chromium 浏览器中浏览包含图片或视频的网页。
2. 在目标媒体上右键，点击上下文菜单"保存到 Serpent"。
3. 扩展扫描预设端口列表 [19876, 19877, 19878]，尝试连接 Serpent 桌面应用的本地 HTTP 服务。
4. 若全部端口连接失败，扩展提示"请先启动 Serpent 桌面应用"，不自动启动 Serpent。
5. 连接成功后，扩展发送保存请求（媒体 URL、源网页地址）。桌面应用完成鉴权、下载、媒体校验和原子导入后返回 202 Accepted；无法接收或保存时返回具体 4xx/5xx，扩展据此提示用户。
6. Serpent Worker 下载 URL 内容，校验 MIME type 与文件扩展名，文件进入当前活跃资源库的选中文件夹（未选中时使用 `Assets/` 根目录）。
7. 下载完成后资产出现在当前视图网格中，源网页地址写入资产元数据"源链接"。
8. 下载失败（网络错误、内容非图片/视频、MIME 不匹配、超时或超限）时，不在资源库中留下残留文件或孤儿数据库行；失败原因写入应用日志。

## 范围

### 包含

- Electron Main 在 `127.0.0.1` 上启动轻量 HTTP 服务器，默认端口 19876，EADDRINUSE 时依次回退至 19877、19878。
- Chromium Manifest V3 浏览器扩展源码与可复现构建流程（独立目录，纳入 Serpent monorepo，构建产物手动安装）。
- 扩展右键菜单（`contextMenus`），仅在图片和视频上下文显示；直接使用点击事件的 `srcUrl`、`pageUrl` 与 `mediaType` 形成保存意图，不依赖 content script 或 service worker 内存缓存。
- `GET /ping` 返回 200 `{"app":"Serpent"}`，供扩展做连接检测。
- `POST /save` 接收 `{ mediaUrl, sourcePageUrl, kind, mediaType? }`。只有 Worker 已完成原子导入时返回 202；错误响应只包含安全原因，完整 cause 链进入本地日志。
- Main 维护当前聚焦窗口的活动资源库 ID 与选中文件夹 ID（由 Renderer 在文件夹变更时通过内部 IPC 同步到 Main）。
- Main 校验请求来源为 `127.0.0.1` 或 `::1`，URL scheme 为 `http:` 或 `https:`，拒绝其他来源与 scheme。
- Worker 下载 URL 内容（`node:https`/`node:http`，跟随重定向最大 30 次，User-Agent `Serpent/1.0`），校验响应的 `Content-Type` 属于图片/视频 MIME 白名单。
- 下载文件先写入 `.serpent/operations/<uuid>/stage`，复用切片 0002 的 staging + 事务化流程创建 managed 资产。
- 资产 `origin = 'import'`，`location_kind = 'managed'`，写入当前选中 `managed_folder_id`（无选中时为 `NULL`，即 `Assets/` 根目录）。
- 源网页地址写入 `asset_metadata.source_page_url`（依赖切片 0004 的 `asset_metadata` 表）。
- 下载保护：单文件上限 500 MB，超时 30 秒；超限或超时中止下载并清理临时文件。
- 冲突处理：同名文件已存在时采用安全默认策略（keep-both 自动追加序号），不弹出 UI 冲突窗口。
- Main 退出时正常关闭 HTTP 服务器；扩展通过心跳或重新连接检测断开状态并更新提示。
- 失败原因通过应用日志记录完整错误链（含 HTTP 状态码、MIME、Content-Length）。
- 扩展对 202 接收成功、非 202 拒绝、全部端口不可达以及非法媒体 URL 分别显示 Chrome notification；非 202 通知包含服务端返回的拒绝原因。

### 不包含

- 扩展 popup UI 中浏览资源库文件夹、选择目标位置（后续切片）。
- 拖拽网页图片/视频进入 Serpent 窗口（需 Renderer 拖放区域支持，后续切片）。
- 从剪贴板粘贴网页图片（产品简报列为独立导入入口，由 Renderer 触发，不依赖扩展）。
- 批量保存（当前页全部图片/视频，后续切片）。
- 保存进度推送（扩展等待一次最终 HTTP disposition；WebSocket 进度推送为后续切片）。
- Native Messaging 身份验证层（Post-MVP 可选叠加，见 `docs/research/chromium-extension-electron-native-messaging.md` 第 85–87 行）。
- Firefox 扩展（首发仅 Chromium 系）。
- 扩展自动更新机制（MVP 手动安装 `.crx`/`.zip`）。
- 通过 URL 直接下载资产（不经扩展）的产品入口（后续评估）。

## schema vN [由前序切片 migration 序列决定]

本切片不新增数据库表，不产生独立 migration。在前序切片已建立的表上操作：

```text
-- 复用切片 0002
assets (asset_id, location_kind='managed', managed_folder_id, relative_file_path,
        current_revision_id, availability, path_identity, created_at, updated_at)
revisions (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
           original_filename, origin='import', accepted_at)
file_operations (operation_id, kind='import', status, manifest_json, error_code,
                 created_at, updated_at)

-- 依赖切片 0004
asset_metadata (asset_id, source_page_url, ...)
```

不变量：

- 浏览器导入产生的修订 `origin` 始终为 `'import'`，与本地文件/文件夹导入一致；`location_kind` 始终为 `'managed'`。
- `source_page_url` 仅记录用户浏览的网页地址（如 `https://example.com/gallery`），不记录媒体文件直链。媒体直链仅用于下载，不持久化。
- 下载失败不留下孤儿 `asset`/`revision` 行或 staging 残留文件。复用 `file_operations` 的 staging-commit-rollback 流程：stage 写入成功后再进入 `applying` 阶段，文件 rename 与数据库写在同一事务内，任一失败按 manifest 回滚。
- `managed_folder_id` 使用 Main 从 Renderer 同步的当前选中文件夹；无选中时为 `NULL`（`Assets/` 根目录）。
- 文件名取自 URL 路径最后一段或 `Content-Disposition` header，经清理（移除非法字符、拒绝空名）后由冲突处理策略匹配。

## 协议

### 扩展 HTTP 接口（Electron Main ↔ Browser Extension）

```text
GET /ping
  → 200 {"app":"Serpent"}

POST /save
  Authorization: Bearer <pairing-token>
  Content-Type: application/json
  Body: {
    url: string,             // 图片/视频下载地址，仅 http/https
    sourcePageUrl: string,   // 用户所在网页地址，仅 http/https
    filename?: string,       // 可选，覆盖 URL 默认文件名
    referer?: string         // 可选，下载时携带的 Referer 请求头
  }
  → 202 {"status":"accepted"}
  → 400 {"status":"rejected","reason":"invalid url" | "unsupported scheme" | "invalid source url"}
  → 401 {"status":"rejected","reason":"authentication required"}
  → 403 {"status":"rejected","reason":"forbidden"}
  → 503 {"status":"rejected","reason":"no active library"}
```

Main 校验规则：

- `req.socket.remoteAddress` 必须为 `'127.0.0.1'` 或 `'::1'`。通过 IP 字符串直接比较，不使用 hostname 反向解析。
- `/save` 必须携带桌面应用生成的 32-byte 随机配对码（base64url）作为 Bearer token。令牌由 Electron `safeStorage` 加密后写入 Main 配置目录；Renderer 仅在用户显式打开配对窗口时短暂接收明文，不持久化。轮换成功后旧令牌立即失效，缺失与错误令牌均返回相同 401，不写入日志。
- 显式 `Origin` 仅接受合法 `chrome-extension://<32-char-id>`；MV3 service worker 或受控本机客户端未发送 `Origin` 时，Bearer token 作为调用者身份。其他显式 Origin 返回 403。
- `url` 与 `sourcePageUrl` 均须匹配 `/^https?:\/\//`。拒绝 `file://`、`data:`、`javascript:` 及其他 scheme。
- 任一校验失败立即拒绝，不启动下载，不转发给 Worker。

### Worker 内部命令（Main → Library Worker）

```text
extension.save-asset {
  type: 'extension.save-asset',
  url: string,
  sourcePageUrl: string,
  filename?: string,
  referer?: string,
  libraryId: string,
  targetFolderId?: string
}
```

Worker 处理流程：

1. 校验 `url` scheme 为 `http:`/`https:`，`sourcePageUrl` 非空且 scheme 合法。
2. 解析目标 `managed_folder_id`：有 `targetFolderId` 时确认其存在且属于当前资源库；无时为 `NULL`。
3. 创建 `file_operations` 行（`kind='import'`, `status='preparing'`）。
4. 在 `.serpent/operations/<operationId>/stage` 下创建临时文件。
5. 使用 `node:https`/`node:http` 发起 GET 请求：跟随重定向（最大 30 次），User-Agent `Serpent/1.0`，携带可选 `Referer` 头。
6. 流式写入 stage 文件；累加字节数；超出 500 MB 或 30 秒超时则中止流并进入回滚路径。
7. 下载完成后校验 `Content-Type` 是否属于白名单：`image/png, image/jpeg, image/gif, image/webp, image/tiff, image/bmp, image/svg+xml, video/mp4, video/webm, video/quicktime, video/x-msvideo, video/x-ms-wmv`。不在白名单内拒绝。
8. 从 URL 路径最后一段或 `Content-Disposition` header 提取文件名；校验扩展名与 Content-Type 一致；不一致时拒绝。
9. 复用 `resolveImport` 的事务化流程：更新 `file_operations.status = 'applying'`，将 stage 文件 rename 到 `Assets/` 目标路径，在单个 SQLite 事务内创建 `asset`（`location_kind='managed'`）、`revision`（`origin='import'`），写入 `asset_metadata.source_page_url`，更新 `file_operations.status = 'committed'`。
10. 任一阶段失败：rollback 已放置文件，更新 `file_operations.status = 'failed'` 或 `'rolled_back'`，清理 staging。

Worker 响应：

```text
extension.asset-saved {
  type: 'extension.asset-saved',
  assetId: string,
  displayName: string,
  byteSize: number
}

extension.save-rejected {
  type: 'extension.save-rejected',
  reason: 'download-failed' | 'invalid-content-type' | 'size-exceeded' | 'timeout' |
          'too-many-redirects' | 'no-active-library' | 'import-failed',
  detail?: string
}
```

### Renderer 状态同步（Renderer → Main，内部 IPC）

Main 需获知当前活动窗口的上下文以解析 `libraryId` 与 `targetFolderId`。新增内部 IPC handler：

```text
renderer.active-context {
  type: 'renderer.active-context',
  libraryId: string | null,     // null 表示该窗口当前无活动资源库
  selectedFolderId?: string
}
```

Renderer 在以下生命周期节点发送：
- 资源库打开成功后。
- 用户切换选中文件夹后。
- 资源库关闭后（发送 `libraryId: null`）。

Main 维护 `Map<BrowserWindow.id, { libraryId: string | null; selectedFolderId?: string }>`。扩展保存请求到达时，查询 `BrowserWindow.getFocusedWindow()` 的上下文，`libraryId` 为 `null` 时拒绝并返回 503。

此项为 Main ↔ Renderer 内部 IPC，不经过 preload 直接暴露给网页上下文。preload 仅提供语义化桥接方法 `setActiveFolder(libraryId: string | null, folderId?: string)`。

## 测试接缝

- **HTTP 服务器生命周期**：`app.on('ready')` 启动服务器，优先绑定 19876，EADDRINUSE 时自动回退至 19877/19878；三个端口均被占用时记录错误但不阻止应用启动。`app.on('will-quit')` 关闭服务器。
- **来源校验**：外部 IP（非 127.0.0.1/::1）连接 `POST /save` → 403；外部 IP `GET /ping` → 403。绑定 `127.0.0.1` 显式 IPv4 地址，不绑定 hostname `localhost`。
- **配对鉴权**：正确 token → 进入 body 校验；缺失/错误 token → 相同 401；轮换后旧 token 立即 401、新 token 可用；响应、诊断与持久日志不包含 token。
- **端口扫描**：扩展按序尝试 19876 → 19877 → 19878；`/ping` 返回 200 即确认；全部超时/拒绝时展示"请先启动 Serpent"提示。
- **URL 校验**：非 http/https scheme → 400；空 `sourcePageUrl` → 400；超长 URL（>8KB）→ 400；`127.0.0.1`/`localhost` 回环 URL → 400（回环下载无业务意义且可能被滥用）。
- **媒体真实性校验**：缺失或不在白名单的 Content-Type → 拒绝；Content-Type 与文件扩展名不一致 → 拒绝；随后用有界前缀验证容器魔数（PNG、JPEG、GIF、TIFF、WebP、BMP、MP4/MOV、WebM、AVI、WMV），三者不一致即拒绝，不接受 SVG 或未知容器。
- **下载行为**：HTTP 200 + 正确 Content-Type → 成功导入；HTTP 404/403/500 → 拒绝并记录状态码；重定向链超过 30 次 → 拒绝；文件超过 500 MB → 中止并清理 stage；超过 30 秒 → 超时中止并清理。
- **原子性**：下载中途 Worker 崩溃 → 下次打开资源库时 `file_operations` 恢复扫描将 `preparing`/`applying` 行清理并移除残留 stage 文件。文件写入一半 → 无 asset 行残留，stage 文件被清理。
- **冲突处理**：同名文件已存在（同文件名、同大小） → 自动 keep-both 追加序号（复用 `copyNameCandidates`），不弹 UI。同名但大小不同 → 自动 keep-both 追加序号。`Assets/` 根目录同时导入同名文件 → 序号递增去重。
- **目标文件夹上下文**：Renderer 选中文件夹 → Worker 收到对应 `targetFolderId`；Renderer 未选中 → Worker 收到 `targetFolderId: undefined`，资产进入 `Assets/` 根目录。`targetFolderId` 指向不存在的文件夹 → 拒绝。
- **多窗口与多资源库**：同时打开两个窗口各对应不同资源库 → 扩展保存到 `getFocusedWindow()` 的活跃资源库。切换聚焦窗口后保存目标跟随切换。关闭全部资源库后 → 503 no active library。
- **preload 安全**：preload 桥接仅暴露 `setActiveFolder(libraryId: string | null, selectedFolderId?: string)`，不暴露 `sourcePageUrl`、扩展 URL 或任何下载路径给 Renderer 网页上下文。
- **扩展 Manifest V3 约束**：service worker 在扩展空闲后可能被终止；保存请求在用户点击右键菜单时触发，此时 MV3 会唤醒 service worker 执行 `contextMenus.onClicked` 回调，无需额外保活机制（用户交互驱动，非后台定时任务）。
- **扩展构建产物**：`npm run extension:build` 输出 `dist/extension/`；Manifest 仅引用生成的 `background.js` 和实际存在的 16/32/48/128 PNG 图标。构建校验拒绝缺失文件、源码 `.ts` 引用以及重新引入 content-script 内存捕获的产物。
- **错误可观测性**：Renderer 不接收扩展保存的 URL 或 sourcePageUrl。所有失败原因通过 `onDiagnostic` 回调记录完整错误链。HTTP 下载层的网络错误、HTTP 状态码、MIME 信息均写入日志。

## 完成标准

- 全部自动化门禁通过（`npm run lint`、`npm run typecheck`、`npm run test`、`npm run test:e2e`）。macOS Chrome 扩展采集冒烟有明确结果，Windows 保留为显式未验证项。
- 扩展右键保存图片/视频到活跃资源库选中文件夹成功；资产出现在网格中。
- 源网页地址正确写入 `asset_metadata.source_page_url`。
- 下载失败不留下孤儿 `asset`/`revision` 行或 `.serpent/operations/` 残留文件。
- HTTP 服务器仅接受 `127.0.0.1`/`::1` 连接；外部 IP 与非法 scheme 均被拒绝。
- Serpent 未运行时扩展提示用户启动应用，不自动启动。
- Renderer 不通过任何 IPC 路径接收扩展发送的 URL 或 sourcePageUrl。
- 开发日志、双轴审查与 QA 报告完整。
