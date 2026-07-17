import type {
  PublicError,
  PublicErrorCode,
  PublicErrorReason,
} from "../shared/protocol/errors";

export class LibraryOperationError extends Error {
  readonly code: PublicError["code"];
  readonly reason?: PublicErrorReason;
  constructor(error: PublicError) {
    super(error.message);
    this.code = error.code;
    this.reason = error.reason;
  }
}

export const PUBLIC_ERROR_MESSAGES_ZH: Partial<Record<PublicErrorCode, string>> = {
  CANCELLED: "操作已取消。",
  INTERNAL_ERROR: "Serpent 无法完成这项操作，请重试。",
  INVALID_LIBRARY_NAME: "请输入可跨平台安全使用的资源库名称。",
  INVALID_LIBRARY_PATH: "请选择有效的本地文件夹。",
  INVALID_FOLDER_NAME: "名称包含不支持的字符。",
  FOLDER_ALREADY_EXISTS: "当前位置已经存在同名文件夹。",
  FOLDER_NAME_CONFLICT: "已存在同名文件夹或文件。",
  FOLDER_NOT_FOUND: "找不到所选资源库文件夹。",
  INVALID_IMPORT_SOURCE: "无法读取所选导入内容。",
  INVALID_DROP_SELECTION:
    "请一次拖入一个本地文件夹，或一个及以上本地文件；不能混合拖入文件与文件夹。",
  WEB_MEDIA_NOT_FOUND: "拖放内容中没有可下载的网页图片或视频地址。",
  WEB_MEDIA_URL_INVALID: "拖放内容中的媒体地址不是有效的 HTTP(S) 链接。",
  WEB_MEDIA_DROP_TOO_LARGE: "网页拖放元数据过大，Serpent 已拒绝解析。",
  CLIPBOARD_IMAGE_NOT_FOUND:
    "系统剪贴板中没有可导入的图片，请先复制图片再重试。",
  IMPORT_COLLECTION_ASSIGN_FAILED:
    "资产已经导入目标文件夹，但未能加入所选合集；资产不会丢失，请查看日志后重试合集操作。",
  INVALID_IMPORT_DECISION: "导入冲突处理选项无效。",
  INVALID_ASSET_METADATA:
    "请使用六位十六进制色值，并填写有效的 HTTP(S) 源链接。",
  IMPORT_NOT_FOUND: "待处理的导入已失效，请重新选择文件。",
  IMPORT_APPLY_FAILED: "无法安全完成导入。",
  LIBRARY_ALREADY_EXISTS: "该位置已经存在同名文件或文件夹。",
  LIBRARY_NOT_FOUND: "找不到所选资源库。",
  NOT_A_LIBRARY: "所选文件夹不是有效的 Serpent 资源库。",
  LIBRARY_CORRUPT: "资源库数据库或迁移记录已损坏。",
  LIBRARY_VERSION_TOO_NEW: "该资源库由更新版本的 Serpent 创建。",
  LIBRARY_NOT_WRITABLE: "Serpent 无法写入所选位置。",
  LIBRARY_CLEANUP_FAILED: "创建失败，且临时文件无法自动清理。",
  LIBRARY_NOT_OPEN: "该资源库当前没有打开。",
  ASSET_NOT_FOUND: "找不到所选资产。",
  INVALID_ASSET_FILE_NAME: "请输入可跨平台安全使用的文件名。",
  ASSET_FILE_NAME_CONFLICT: "同一文件夹内已存在同名文件。",
  ASSET_MOVE_CONFLICT:
    "资产移动无法完成：源位置或目标位置已经变化，Serpent 未执行静默覆盖。",
  ASSET_SOURCE_TRASH_FAILED:
    "无法将源文件移入系统回收站，请查看日志了解具体原因。",
  AI_ANALYSIS_FAILED: "AI 服务未能完成资产分析。",
  AI_SEARCH_FAILED: "AI 服务未能转换这次搜索。",
  VERSION_CONFLICT: "元数据已被其他操作修改。请刷新后重新编辑。",
  ZIP_TOO_LARGE:
    "资源库大小超出标准 ZIP 限制（4 GiB / 65534 条目）。请改为导出文件夹。",
  TRANSFER_IN_PROGRESS: "已有资源库导入或导出正在使用相同资源库或路径。",
};

export const PUBLIC_ERROR_REASONS_ZH: Record<PublicErrorReason, string> = {
  PERMISSION_DENIED: "当前用户没有读取源文件或写入目标位置的权限。",
  FILE_BUSY: "文件正被其他应用使用，请关闭后重试。",
  PATH_LIMIT_EXCEEDED: "目标文件系统拒绝了该路径或名称长度。",
  DISK_FULL: "目标磁盘空间不足。",
  READ_ONLY_FILESYSTEM: "目标位置位于只读文件系统。",
  SOURCE_NOT_FOUND: "源文件在导入过程中消失或无法找到。",
  SOURCE_CHANGED: "源文件在复制过程中发生了变化。",
  SOURCE_TRASH_FAILED:
    "操作系统拒绝将源文件移入系统回收站；源文件与 Serpent 记录均已保留。",
  SOURCE_TRASH_RECONCILIATION_REQUIRED:
    "源文件可能已进入系统回收站，但记录尚未完成清理；请重新打开资源库以自动对账，并查看日志。",
  SYMBOLIC_LINK_NOT_ALLOWED: "目录中包含当前切片不支持的符号链接。",
  UNSUPPORTED_FILE_ENTRY: "目录中包含普通文件和文件夹之外的项目。",
  MIME_TYPE_MISSING: "远程响应未声明媒体类型，为避免保存伪装文件已拒绝导入。",
  MIME_TYPE_UNSUPPORTED: "远程响应声明的媒体类型不受支持。",
  MIME_EXTENSION_MISMATCH: "文件扩展名与远程响应声明的媒体类型不一致。",
  MAGIC_BYTES_MISMATCH:
    "文件头与远程响应声明的媒体类型不一致，文件可能已损坏或被伪装。",
  NAME_NOT_SUPPORTED: "当前目标文件系统不接受其中的文件名。",
  IO_ERROR: "操作系统报告了磁盘读写错误。",
  SHARP_UNAVAILABLE: "图像处理引擎 Sharp 不可用。",
  FFMPEG_REQUIRED: "当前安装中未找到 FFmpeg，暂时无法生成视频预览。",
  OIIO_REQUIRED: "当前安装中未找到 OpenImageIO，暂时无法解码 EXR/TGA。",
  MEDIA_PROCESSING_FAILED:
    "媒体处理失败。请检查源文件是否损坏，并查看应用日志了解详细原因。",
  PALETTE_SOURCE_NOT_READY: "当前修订的缩略图或视频封面尚未就绪。",
  PALETTE_EXTRACTION_FAILED: "本地色卡提取失败，请查看应用日志了解详细原因。",
  UNSUPPORTED_FORMAT: "当前切片不支持此文件格式。",
  ZIP_TOO_LARGE: "资源库大小超出标准 ZIP 限制（4 GiB / 65534 条目）。",
  NOT_A_LIBRARY: "所选目标不是有效的 Serpent 资源库。",
  PATH_ESCAPE: "ZIP 中包含路径逃逸条目，可能造成安全风险。",
  AI_AUTH: "API Key 无效或已失效，请更新凭据。",
  AI_PERMISSION: "当前 API Key 没有访问所选模型的权限。",
  AI_QUOTA: "供应商账户额度已用尽，请检查计费与额度。",
  AI_RATE_LIMIT: "请求过于频繁，Serpent 将稍后重试。",
  AI_NETWORK: "无法连接 AI 供应商，请检查网络。",
  AI_TIMEOUT: "AI 请求超时，Serpent 将稍后重试。",
  AI_INVALID_RESPONSE: "AI 供应商返回了无法解析的结果。",
  AI_NOT_CONFIGURED:
    "请先在 AI 设置中保存 API Key、选择模型并接受数据发送说明。",
  AI_REFUSED: "AI 供应商拒绝了这次查询转换；查询内容未执行。",
  THUMBNAIL_REQUIRED: "资产缩略图尚未就绪，无法安全发送到 AI 供应商。",
  TRANSFER_IN_PROGRESS: "已有资源库导入或导出正在使用相同资源库或路径。",
};

export function toMessage(error: unknown, fallback: string) {
  if (error instanceof LibraryOperationError) {
    const message = PUBLIC_ERROR_MESSAGES_ZH[error.code] ?? fallback;
    const reason = error.reason
      ? PUBLIC_ERROR_REASONS_ZH[error.reason]
      : undefined;
    return reason ? `${message} 原因：${reason}` : message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
