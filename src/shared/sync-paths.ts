/**
 * Serpent 同步共享工具（Serpent-xffq）。
 *
 * 远端库目录名 = 库显示名的安全化结果：WebDAV 服务端与常见文件系统
 * （含 SMB 共享）对目录名有字符与保留名限制，直接使用库显示名可能在
 * 某类服务端上创建目录失败。安全化规则见 sanitizeSyncDirectoryName；
 * 原始显示名由 manifest 的 displayName 保存，UI 始终显示原始库名。
 */

/** Windows 保留设备名（大小写不敏感），避免 NAS/SMB 场景踩坑。 */
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/** 需要从目录名中去除的字符：路径分隔符、保留字符与控制字符（\p{Cc}）。 */
const FORBIDDEN_DIRECTORY_CHARS = /[/\\:*?"<>|\p{Cc}]/gu;

/**
 * 将库显示名安全化为可跨服务端使用的目录名。
 * - 去除/替换路径分隔符、保留字符与控制字符（连续替换为一个下划线）
 * - 去除首尾空格与点
 * - Windows 保留名（CON/PRN/…）加前缀 "_"
 * - 安全化结果为空时兜底 `library-<libraryId 前 8 位>`
 * - 结果长度限制 128 字符（超长截断，保留尾部）
 */
export function sanitizeSyncDirectoryName(
  displayName: string,
  libraryId: string,
): string {
  const replaced = displayName
    .replace(FORBIDDEN_DIRECTORY_CHARS, '_')
    .replace(/_+/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  // 折叠后若不含任何实质字符（纯下划线/空），视为空名兜底。
  let candidate = replaced.replace(/_/g, '').length > 0
    ? replaced
    : `library-${libraryId.slice(0, 8)}`;
  if (candidate.length > 128) {
    candidate = candidate.slice(0, 128).replace(/^[\s.]+|[\s.]+$/g, '');
  }
  if (WINDOWS_RESERVED_NAMES.has(candidate.toUpperCase())) {
    candidate = `_${candidate}`;
  }
  return candidate.length > 0 ? candidate : `library-${libraryId.slice(0, 8)}`;
}

/**
 * 远端库目录的边界结构：一个远端根下按库名（安全化后）建目录，
 * 库目录内分 assets/metadata/trash 与 manifest。
 */
export const SYNC_MANIFEST_FILE = 'manifest.json';
export const SYNC_FORMAT_VERSION_FILE = '.serpent-sync/format-version';
export const SYNC_ASSETS_DIR = 'assets';
export const SYNC_METADATA_DIR = 'metadata/entries';
export const SYNC_TRASH_DIR = 'trash';
export const SYNC_FORMAT_VERSION = 1;
