/**
 * 远端存储驱动抽象（Serpent-xffq）。
 *
 * 同步编排层只依赖这里的文件语义（list/read/write/delete/mkdir/move/
 * exists + 能力探测），与具体协议无关。WebDAV 是第一个实现；未来可
 * 增加 S3 兼容存储或 Serpent Cloud。所有 path 为以库目录为根的
 * portable 相对路径（`/` 分隔、不以 `/` 开头）。
 */

export interface RemoteEntry {
  /** portable 相对路径，目录以 `/` 结尾表示。 */
  path: string;
  isDirectory: boolean;
  size?: number;
  etag?: string;
  lastModified?: string;
}

export interface RemoteReadResult {
  body: Buffer;
  etag?: string;
  lastModified?: string;
}

export interface RemoteWriteOptions {
  /** 服务端 ETag；提供时用 If-Match 做条件写（CAS）。 */
  ifMatch?: string;
  /** 允许覆盖已存在资源（默认 true）。 */
  overwrite?: boolean;
}

export interface RemoteWriteResult {
  etag?: string;
  status: number;
}

export interface DriverCapabilities {
  /** 探测出的认证模式：匿名、Basic 或 Digest。 */
  auth: 'none' | 'basic' | 'digest';
  /** 能否上传/下载文件内容（PUT 与 GET 均可用）；false 表示该服务器不能承载同步。 */
  supportsContentTransfer: boolean;
  supportsDepthInfinity: boolean;
  supportsEtagIfMatch: boolean;
  supportsMove: boolean;
  supportsLock: boolean;
  quotaBytes?: number;
  usedBytes?: number;
  maxUploadBytes?: number;
}

export interface RemoteStorageDriver {
  /** 列举路径；单条目请求（depth 0）也通过本接口返回数组。 */
  list(path: string, depth?: '0' | '1' | 'infinity'): Promise<RemoteEntry[]>;
  read(path: string): Promise<RemoteReadResult>;
  write(path: string, body: Buffer, options?: RemoteWriteOptions): Promise<RemoteWriteResult>;
  delete(path: string): Promise<void>;
  /** 创建目录（含中间层级）；已存在视为成功。 */
  mkdir(path: string): Promise<void>;
  /** 移动/重命名；服务端不支持 MOVE 时抛出 DriverUnsupportedError。 */
  move(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** 连接级能力探测，结果可缓存；失败抛出可读错误。 */
  probe(): Promise<DriverCapabilities>;
}

/** 驱动明确不支持某能力（如 MOVE）时抛出，编排层据此降级。 */
export class DriverUnsupportedError extends Error {
  override readonly name = 'DriverUnsupportedError';
  constructor(message: string) {
    super(message);
  }
}

/** 驱动连接/认证/传输层错误；message 面向用户可读，不暴露堆栈。 */
export class RemoteStorageError extends Error {
  override readonly name = 'RemoteStorageError';
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}
