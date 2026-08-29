# Chromium 扩展与 Electron 桌面应用通信方案调研

> 调研日期：2026-07-12
> 目的：确定 Chromium (Manifest V3) 浏览器扩展如何向运行中的 Serpent Electron 桌面应用发送 "保存此图片/视频到资源库" 命令。
> 来源约束：Chrome/Chromium 官方文档、MDN、Electron 官方文档、竞品公开信息、主流开源库 README。避免 SEO/营销内容。

## 结论

Serpent MVP 推荐 **本地 HTTP/WebSocket 服务器（Electron main process 启动，仅绑定 127.0.0.1）** 作为浏览器扩展与桌面应用之间的通信通道。Post-MVP 可选叠加 Native Messaging 作为身份验证层。

```text
Browser Extension (MV3 service worker)
    │  HTTP POST / WebSocket (ws://127.0.0.1:<port>)
    ▼
Electron Main（轻量 HTTP/WebSocket server，仅 loopback）
    │  校验 sender（127.0.0.1）、URL scheme（仅 http/https）
    │  不暴露任意文件写入或路径遍历
    ▼
Library Worker (UtilityProcess)
    ├─ 下载 URL 内容，校验 MIME type
    ├─ 创建 asset 记录，源链接写入网页地址
    └─ 入队缩略图/预览生成
```

核心决策：

- **不直接用 Native Messaging 作为主通道。** Chrome 每连接 spawn 新 host 进程；Electron GUI 进程在 Windows 上无法直接读写 stdin（[Electron issue #14438](https://github.com/electron/electron/issues/14438)）。MVP 用本地 WebSocket 避免跨平台 stdio 陷阱和 OS 级 manifest 注册。
- **Eagle 使用同样方案。** Eagle 监听 localhost:41593/41595 的 WebSocket 服务器（[Eagle 端口检查文档](https://en.eagle.cool/support/article/how-to-check-if-eagle-extension-communication-port-is-functioning-properly)），扩展通过连接成功与否判断应用是否运行。1Password 在此基础上叠加 Native Messaging 做浏览器身份验证（[1Password Browser Security](https://support.1password.com/1password-browser-security/)）。
- **安全边界**：仅监听 127.0.0.1；只接受 "下载 URL" 语义命令（不暴露泛型文件写）；Library Worker 负责下载和 MIME type 校验；URL scheme 白名单（仅 http/https）。最坏后果是把垃圾图片写入资源库，不造成数据泄露或系统级危害 —— 这对于素材采集工具是可接受的风险。
- **发现机制**：扩展尝试连接预设端口列表（默认 19876，回退 19877--19878）。连接成功 = Serpent 在运行；全部失败提示用户启动 Serpent（符合 product-brief.md 第 94 行要求）。
- **许可证**：仅使用 Node.js 内建模块（`http`、`net`）和浏览器 Web API（`fetch`、`WebSocket`），不引入第三方依赖，与 Serpent MIT 完全兼容。

## 四种候选方案比较

### 1. Native Messaging Host（stdio）

Chrome 通过 `chrome.runtime.connectNative()` 启动本地可执行文件，经 stdin/stdout 通信。消息格式：4 字节 little-endian 长度前缀 + UTF-8 JSON payload（[Chrome Native Messaging 官方文档](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)）。`allowed_origins` 白名单限定可连接的 extension ID；host 进程收到首个 CLI 参数为 `chrome-extension://<id>/`（[Chromium code review 12406002](https://codereview.chromium.org/12406002/)）。

**优点：** 浏览器强制 `allowed_origins` 白名单。Host CLI 参数可做服务端身份验证。Native messaging port 活跃期间 service worker 不被 Chrome 标记为 inactive。

**缺点：**

- Windows 上 Electron GUI 进程无法直接访问 stdin（`ERR_UNKNOWN_STDIN_TYPE`）。必须写独立非 GUI Node.js 脚本作为 host 代理，通过 IPC/socket 转发到 Electron 主进程（[SO: Electron Native Messaging](https://stackoverflow.com/questions/42256410/chrome-native-messaging-with-electron-app)）。
- Chrome 每连接 spawn 新 host 进程，无法复用已运行的 Electron 实例。
- 安装需 OS 级 manifest（Windows 注册表、macOS `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`），每个 Chromium 系浏览器路径不同。
- Chrome 122 存在回归：关闭最后一个窗口时 native host 被终止（[issue #329309459](https://issuetracker.google.com/issues/329309459)）。
- Chrome 官方安全 FAQ 明确指出 Native Messaging 自身不是安全通信通道，开发者需额外实施传输安全（[Chromium Extensions Security FAQ](https://chromium.googlesource.com/chromium/src/+/25ddb5bb3141436cfb4ca506dec794c99f63e5c2%5E%21/extensions/docs/security_faq.md)）。

### 2. 本地 HTTP/WebSocket 服务器

Electron main 在 127.0.0.1 上启动轻量 HTTP/WebSocket 服务器，扩展直接连接。

**优点：** 实现简单（Node.js 内建 `http` 模块）。无需 OS 级 manifest 注册。可连接已运行的应用。竞品成熟先例（Eagle、1Password）。

**缺点：** 无浏览器级别调用方身份验证。MV3 service worker 的空闲 WebSocket 不阻止 SW 终止（[Chromium bug #1152255](https://bugs.chromium.org/p/chromium/issues/detail?id=1152255)），需要心跳或 `chrome.alarms` 唤醒。固定端口可能冲突，需要回退扫描。

### 3. 自定义 URL 协议处理器

Chromium MV3 的 `protocol_handlers` manifest key 只将自定义协议重定向到 HTTPS URL，不直接启动桌面应用（[Igalia Blog: Protocol Handler Registration](https://blogs.igalia.com/jfernandez/2026/03/24/protocol-handler-registration-via-browser-extensions/)）。OS 级协议注册可启动桌面应用但不能从 extension 内直接触发 —— 本质上回退到 Native Messaging。

**结论：** 不适用于实时双向通道。未来可能用于 deep link（`serpent://library/import?...`）。

### 4. 剪贴板轮询

MV3 service worker 无法访问 `navigator.clipboard`，需要 offscreen document 作为桥梁，轮询效率低（500--1000ms），`chrome.storage.local` 仅 10MB 不足以缓存 base64 图片，且无法区分 "复制" 和 "保存到磁盘" 等 OS 级动作。

**结论：** 不适用于主要通信机制。product-brief.md 已将剪贴板粘贴列为独立导入入口，由 Renderer 触发，无需 extension 参与。

## 竞品分析

| 竞品 | 方案 | 端口/机制 | 扩展发现应用方式 | 安全层 |
|------|------|----------|-----------------|--------|
| Eagle | 本地 WebSocket | 固定端口 41593 + 41595 | 连接成功 = 运行中；失败显示 "Eagle Not Open" | 仅 127.0.0.1 绑定 |
| Billfish | 本地 HTTP/WebSocket（推断） | 未公开 | 类似 Eagle | 仅 127.0.0.1 绑定（推断） |
| 1Password | 混合：Native Messaging 验证 + WebSocket/named pipe 通信 | 动态端口 + named pipe | Native Messaging 可用性 + WebSocket 连接 | Curve25519 ECDH + Salsa20/Poly1305 加密 |

Eagle 是 Serpent 最直接竞品，其方案已在大量用户中验证可行。1Password 的混合方案对素材采集来说过度设计。

## MV3 Native Messaging 关键约束（供 Post-MVP 参考）

如果将来叠加 Native Messaging 做身份验证，以下约束必须记住：

1. Host 必须是独立非 GUI 可执行文件/脚本。在 Electron 语境下需额外打包一个薄 Node.js 代理，通过 local socket 转发到主 Electron 进程。
2. Host manifest 注册路径依浏览器和 OS 不同（Chrome/Edge/Brave 各有不同路径），需安装器支持。
3. Windows 上必须设置 stdin/stdout 为 binary mode 以防 CR/LF 破坏 4 字节长度前缀。
4. 消息大小限制：host -> Chrome 最大 1MB，Chrome -> host 最大 64MiB。
5. Extension 侧只需 `"permissions": ["nativeMessaging"]`，放在 `permissions` 数组而非 `host_permissions`。

## 安全模型

### MVP 威胁模型与接受的风险

- **攻击面**：127.0.0.1 上其他进程可能伪造保存请求。
- **最坏后果**：不想要的图片/视频被写入资源库。不会数据泄露、不会覆盖已有文件、不会执行代码。
- **缓解措施**：
  1. 仅绑定 127.0.0.1（不是 `"localhost"`，后者可能被 hosts 文件映射到外部地址）。
  2. Electron main 只接受 "下载 URL" 语义命令，不暴露泛型文件写入。
  3. URL scheme 白名单（仅 http/https）。
  4. Library Worker 下载后校验 MIME type 和文件扩展名，不合格的直接丢弃。
  5. 文件名取 URL 最后一段或 Content-Disposition header，经清理后由冲突处理策略匹配。

### MVP 消息格式

```typescript
// Extension -> Electron main
interface SaveAssetRequest {
  type: "save_asset";
  url: string;          // https://... only
  sourceUrl: string;    // 用户所在网页地址，用作源链接
  filename?: string;    // 可选，覆盖 URL 默认文件名
  referer?: string;
}

// Electron main -> Extension
interface SaveAssetResponse {
  type: "save_asset_result";
  requestId: string;
  status: "accepted" | "rejected";
  reason?: string;
}
```

**关键约束**：客户端不能指定目标文件夹路径或本地文件路径。文件由 Library Worker 写入当前活跃资源库的选中文件夹（未选中时写入 `Assets/` 根目录）。

### Post-MVP 纵深防御（可选）

叠加 Native Messaging host 薄代理：host 从 CLI args 读取 `chrome-extension://<id>/`，生成一次性 token，通过 local WebSocket 注册到 Electron main。Extension 的 WebSocket 连接需携带有效 token。但这在 MVP 不必要。

## 扩展发现应用是否运行

扩展在右键菜单点击时执行端口扫描：

```typescript
const PORTS = [19876, 19877, 19878];
for (const port of PORTS) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/ping`);
    if (res.ok) return port;
  } catch { continue; }
}
// 全部失败 -> prompt 用户启动 Serpent
```

端口选择策略：默认 19876，避开 Eagle（41593/41595）和常见开发端口。端口被占用时 Electron main 回退到下一个，extension 扫描预设列表发现实际端口。

## Electron Main 实现骨架

```typescript
// main process, after app.on('ready')
import * as http from "node:http";

const PORTS = [19876, 19877, 19878];

function startExtensionServer(): void {
  for (const port of PORTS) {
    const server = http.createServer((req, res) => {
      const remoteAddr = req.socket.remoteAddress;
      if (remoteAddr !== "127.0.0.1" && remoteAddr !== "::1") {
        res.writeHead(403); res.end(); return;
      }
      if (req.method === "GET" && req.url === "/ping") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ app: "Serpent" }));
        return;
      }
      if (req.method === "POST" && req.url === "/save") {
        let body = "";
        req.on("data", (chunk) => body += chunk);
        req.on("end", () => {
          const msg = JSON.parse(body);
          if (!/^https?:\/\//.test(msg.url)) {
            res.writeHead(400); res.end(JSON.stringify({ error: "invalid url" }));
            return;
          }
          // 转发给 Library Worker...
          res.writeHead(202); res.end(JSON.stringify({ status: "accepted" }));
        });
      }
    });
    server.on("error", () => { /* EADDRINUSE, try next */ });
    server.listen(port, "127.0.0.1"); // 显式绑定 IPv4 loopback
    return; // success
  }
}
```

## 跨平台注意事项

| 关注点 | macOS | Windows |
|--------|-------|---------|
| 本地回环 | `127.0.0.1` 始终可用。某些 VPN/代理劫持 localhost DNS —— 绑定 IP 而非 hostname 避免。 | 同 macOS。Windows 防火墙默认放行 localhost。 |
| 端口占用 | `server.listen()` 的 `error` 事件返回 `EADDRINUSE`。 | 同 macOS。 |
| 打包 | `app.asar` 中 Node.js server 代码正常工作。 | 同 macOS。 |
| Native Messaging（未来） | 需在 `~/Library/Application Support/<Browser>/NativeMessagingHosts/` 安装 manifest JSON。 | 需在 `HKCU\Software\<Browser>\NativeMessagingHosts\<name>` 注册表键值指向 manifest 文件路径。 |

## 实施顺序

1. **MVP：** Electron main 启动 localhost HTTP server。Extension 通过右键菜单发送 `save_asset`，fire-and-forget 模式（202 Accepted 即返回，不推送进度）。
2. **第二阶段：** 添加 WebSocket，支持 save 进度推送。Extension 侧心跳保持 service worker 活跃。
3. **第三阶段（可选）：** Native Messaging host 薄代理做浏览器身份验证，注入一次性 token 到 WebSocket 握手。
4. **第四阶段（可选）：** Extension popup UI 中浏览当前资源库文件夹、选择目标位置。

## 参考文献

- [Chrome Native Messaging 官方文档](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [MDN Native Messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging)
- [Electron issue #14438: Native Messaging on Windows stdin](https://github.com/electron/electron/issues/14438)
- [Chromium Extensions Security FAQ](https://chromium.googlesource.com/chromium/src/+/25ddb5bb3141436cfb4ca506dec794c99f63e5c2%5E%21/extensions/docs/security_faq.md)
- [Chromium bug #1152255: WebSocket not keeping SW alive](https://bugs.chromium.org/p/chromium/issues/detail?id=1152255)
- [Chromium issue #329309459: Native Messaging host killed on window close](https://issuetracker.google.com/issues/329309459)
- [SO: Chrome Native Messaging with Electron](https://stackoverflow.com/questions/42256410/chrome-native-messaging-with-electron-app)
- [SO: MV3 Native Messaging with already-running instance](https://stackoverflow.com/questions/74410394/mv3-native-messaging-how-do-you-communicate-with-an-already-running-instance-of)
- [Eagle 端口检查支持文档](https://en.eagle.cool/support/article/how-to-check-if-eagle-extension-communication-port-is-functioning-properly)
- [Eagle 扩展 MV3 兼容性](https://en.eagle.cool/support/article/cannot-install-browser-extension-invalid-package-error)
- [1Password Browser Security](https://support.1password.com/1password-browser-security/)
- [Igalia Blog: Protocol Handler Registration via Browser Extensions](https://blogs.igalia.com/jfernandez/2026/03/24/protocol-handler-registration-via-browser-extensions/)
- [Chromium code review 12406002: Pass extension ID to native host](https://codereview.chromium.org/12406002/)
- [Billfish 浏览器扩展帮助](https://www.billfish.cn/help/chajiancaiji)
