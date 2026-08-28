import { z } from 'zod';

export const PUBLIC_ERROR_MESSAGES = {
  CANCELLED: 'The request was cancelled.',
  INTERNAL_ERROR:
    'Serpent hit an unexpected error and could not finish. Open Diagnostics in the app to inspect this session’s log, then retry. If you were opening a library, copy the whole library folder onto a local disk and open it from there.',
  INVALID_LIBRARY_NAME: 'Choose a library name that is safe on macOS and Windows.',
  INVALID_LIBRARY_PATH:
    'The selected location is not a usable folder for a library. Choose an existing writable folder — not a file, and not a disconnected drive.',
  INVALID_FOLDER_NAME: 'Choose a folder name that is safe on macOS and Windows.',
  FOLDER_ALREADY_EXISTS: 'A folder with this name already exists in the selected location.',
  FOLDER_NAME_CONFLICT: 'A folder or file with this name already exists in the selected location.',
  FOLDER_NOT_EMPTY: 'Only folders with no assets, child folders, or unmanaged files can be deleted by this operation.',
  FOLDER_NOT_FOUND:
    'That library folder is no longer at this location. It may have been moved, renamed, or the disk may be disconnected. Reconnect the drive or choose the folder again.',
  INVALID_IMPORT_SOURCE: 'Choose readable local files or a folder without symbolic links.',
  INVALID_DROP_SELECTION: 'Drop either one local folder or one or more local files.',
  WEB_MEDIA_NOT_FOUND: 'The dropped browser content does not contain a downloadable image or video URL.',
  WEB_MEDIA_URL_INVALID: 'The dropped browser media address is not a valid HTTP(S) URL.',
  WEB_MEDIA_DROP_TOO_LARGE: 'The dropped browser metadata is too large to inspect safely.',
  CLIPBOARD_IMAGE_NOT_FOUND: 'Copy an image to the system clipboard and try again.',
  CLIPBOARD_FILES_NOT_FOUND:
    'Copy files or folders in Finder/Explorer, then paste again.',
  IMPORT_COLLECTION_ASSIGN_FAILED: 'The assets were imported, but Serpent could not add them to the selected collection.',
  INVALID_IMPORT_DECISION: 'Choose a valid import conflict decision.',
  IMPORT_NOT_FOUND: 'The pending import no longer exists.',
  IMPORT_APPLY_FAILED:
    'Import stopped before every file was copied and registered. Nothing was silently overwritten. Check disk space and that the source files are still readable, then retry; already-imported items do not need to be selected again.',
  LIBRARY_ALREADY_EXISTS: 'A file or folder with this library name already exists. Choose another name or another parent folder.',
  LIBRARY_NOT_FOUND:
    'Serpent cannot find that library folder. It may have been moved, renamed, or the disk may be disconnected. Reconnect the drive or choose the library again from Open Library.',
  NOT_A_LIBRARY:
    'The selected folder is not a Serpent library (it has no .serpent database).',
  LIBRARY_CORRUPT:
    'Serpent could not read this library’s database (integrity check or migration history failed). Reopen the library so Serpent can restore from a backup. Copy the whole library folder to a local disk first if you want a safety copy.',
  LIBRARY_ENGINE_UNAVAILABLE:
    'Serpent could not load its SQLite database engine. This is an application install problem, not damage to your library files. Reinstall Serpent or rebuild native modules; do not restore backups or delete the library folder.',
  LIBRARY_VERSION_TOO_NEW:
    'This library was created by a newer version of Serpent, so this app cannot open it. Install the latest Serpent, then open the library again.',
  LIBRARY_READ_ONLY:
    'Serpent cannot write to this library because the files are locked or marked read-only. Clear the read-only flag, close other programs using the folder, and retry.',
  LIBRARY_MIGRATION_FAILED:
    'Upgrading this library’s database failed and was rolled back. Your files are unchanged. Open the library again to retry the upgrade; if it keeps failing, copy the library to a local disk and retry.',
  LIBRARY_MIGRATION_STUCK:
    'This library could not be migrated after repeated attempts. Serpent opened it at the last working schema so you can keep using it. Upgrade Serpent when a fix is available; do not delete the library folder.',
  LIBRARY_STRUCTURE_MISMATCH:
    'This library’s database structure does not match this version of Serpent. Upgrade to the latest Serpent and reopen the library.',
  LIBRARY_NOT_WRITABLE:
    'Serpent could not write files in the selected folder. The folder may lack write permission, the disk may be full or read-only, or another program may have the files locked. Check the folder and NAS connection, then retry.',
  LIBRARY_NETWORK_SHARE:
    'Serpent could not open or write the library database on this network share (NAS/SMB). NAS libraries use rollback journaling and depend on the share’s file-locking and reconnect behavior. Check the NAS connection and permissions; if it keeps failing, copy the library to a local disk or use WebDAV sync.',
  LINKED_FOLDER_UNAVAILABLE:
    'This NAS library contains a linked folder that is unavailable on this computer. The library database is intact. Reconnect the folder or relink it on this computer, then open the library again.',
  LIBRARY_IO_ERROR:
    'Serpent could not complete the library operation because the disk or filesystem reported an I/O error. Check the drive connection, free space, and permissions; if it keeps failing, copy the library to a local disk and inspect Diagnostics.',
  LIBRARY_BUSY: 'This library is being updated by another Serpent window or a brief database lock. Wait a few seconds and retry; do not open the same library from two computers at once.',
  LIBRARY_CLEANUP_FAILED:
    'Creating the library failed, and leftover temporary files could not be removed automatically. Delete any `.serpent-create-*.partial` folder next to the chosen location, then retry with a writable folder.',
  LIBRARY_NOT_OPEN: 'That library is not open in this window. Open it again, then retry the action.',
  ASSET_NOT_FOUND: 'The requested asset could not be found.',
  INVALID_ASSET_FILE_NAME: 'Choose a file name that is safe on macOS and Windows.',
  ASSET_FILE_NAME_CONFLICT: 'A file with this name already exists in the asset folder.',
  INVALID_ASSET_METADATA: 'Choose valid asset metadata values, including six-digit hex colors and an HTTP(S) source page URL.',
  INVALID_SEARCH_QUERY: 'Use supported search fields: filename, tags, description, source URL, folder path, or metadata.',
  INVALID_SMART_COLLECTION_QUERY: 'Add a search query or at least one filter before saving a smart collection.',
  ASSET_MOVE_CONFLICT: 'The asset move could not be completed because a source or destination changed.',
  ASSET_SOURCE_TRASH_FAILED: 'Serpent could not move the asset source to the system trash.',
  AI_ANALYSIS_FAILED: 'The AI service could not analyze this asset.',
  AI_SEARCH_FAILED: 'The AI service could not prepare this search.',
  VERSION_CONFLICT: 'The metadata has been modified by another operation. Please refresh and try again.',
  ZIP_TOO_LARGE: 'The library is too large for standard ZIP. Export as a folder instead.',
  TRANSFER_IN_PROGRESS: 'Another library transfer is already using the same library or path.',
  AUTOMATION_UNDO_GROUP_NOT_FOUND: 'The automation undo group is no longer available.',
  AUTOMATION_UNDO_NOT_AVAILABLE: 'This automation result cannot be undone.',
  AUTOMATION_UNDO_STALE: 'The files changed, so this automation result can no longer be undone safely.',
  PLUGIN_HOOK_BLOCKED: 'A plugin blocked this operation before it could run.',
  HISTORY_ENTRY_NOT_FOUND: 'No reversible operation is available for this request.',
  HISTORY_NOT_TOP: 'The requested operation is no longer the current undo or redo target.',
  HISTORY_NOT_REVERSIBLE: 'This operation cannot be undone or redone.',
  HISTORY_TRANSITION_IN_PROGRESS: 'Another undo or redo operation is already in progress.',
  HISTORY_STALE: 'The files or records changed, so this operation cannot be reversed safely.',
  HISTORY_TOO_LARGE: 'This operation is too large to retain in the undo history.',
  SYNC_CONNECTION_FAILED:
    'Serpent could not reach the sync server. Check the address, username, password, and that the computer is online. A more specific reason is listed when Serpent can classify the failure.',
  SYNC_IN_PROGRESS: 'This library is syncing right now. Try again after the current sync finishes.',
  DISK_FULL: 'The disk does not have enough free space to complete this operation. Free up space and try again.',
} as const;

export type PublicErrorCode = keyof typeof PUBLIC_ERROR_MESSAGES;

export const publicErrorReasonSchema = z.enum([
  'PERMISSION_DENIED',
  'FILE_BUSY',
  'PATH_LIMIT_EXCEEDED',
  'DISK_FULL',
  'READ_ONLY_FILESYSTEM',
  'SOURCE_NOT_FOUND',
  'SOURCE_CHANGED',
  'SOURCE_TRASH_FAILED',
  'SOURCE_TRASH_RECONCILIATION_REQUIRED',
  'SYMBOLIC_LINK_NOT_ALLOWED',
  'ROOT_NOT_ALLOWED',
  'UNSUPPORTED_FILE_ENTRY',
  'MIME_TYPE_MISSING',
  'MIME_TYPE_UNSUPPORTED',
  'MIME_EXTENSION_MISMATCH',
  'MAGIC_BYTES_MISMATCH',
  'NAME_NOT_SUPPORTED',
  'IO_ERROR',
  'SHARP_UNAVAILABLE',
  'FFMPEG_REQUIRED',
  'OIIO_REQUIRED',
  'MEDIA_PROCESSING_FAILED',
  'PALETTE_SOURCE_NOT_READY',
  'PALETTE_EXTRACTION_FAILED',
  'UNSUPPORTED_FORMAT',
  'ZIP_TOO_LARGE',
  'NOT_A_LIBRARY',
  'PATH_ESCAPE',
  'AI_AUTH',
  'AI_PERMISSION',
  'AI_QUOTA',
  'AI_RATE_LIMIT',
  'AI_NETWORK',
  'AI_TIMEOUT',
  'AI_INVALID_RESPONSE',
  'AI_NOT_CONFIGURED',
  'AI_REFUSED',
  'THUMBNAIL_REQUIRED',
  'TRANSFER_IN_PROGRESS',
  'EAGLE_METADATA_UNREADABLE',
  'BILLFISH_METADATA_UNREADABLE',
  'IMPORT_COPY_FAILED',
  'IMPORT_REGISTER_FAILED',
  'EAGLE_THUMBNAIL_FAILED',
  'LIBRARY_PARENT_MISSING',
  'LIBRARY_PARENT_IS_ROOT',
  'LIBRARY_PARENT_NOT_DIRECTORY',
  'LIBRARY_PARENT_INSIDE_SOURCE',
  'LIBRARY_TRANSFER_TIMEOUT',
  'SYNC_AUTH_FAILED',
  'SYNC_INVALID_URL',
  'SYNC_PERMISSION_DENIED',
  'SYNC_NOT_FOUND',
  'SYNC_TIMEOUT',
  'SYNC_TLS',
  'SYNC_DNS',
  'SYNC_CONNECTION_REFUSED',
  'SYNC_NETWORK',
  'SYNC_QUOTA_EXCEEDED',
  'SYNC_LOCKED',
  'SYNC_CONFLICT',
  'SYNC_METHOD_NOT_ALLOWED',
  'SYNC_WRITE_UNSUPPORTED',
  'SYNC_HTTP_ERROR',
  'LINKED_FOLDER_NETWORK_DISCONNECTED',
  'LINKED_FOLDER_NOT_FOUND',
  'LINKED_FOLDER_FOREIGN_DEVICE',
]);

export type PublicErrorReason = z.infer<typeof publicErrorReasonSchema>;

const publicErrorCodeSchema = z.enum(
  Object.keys(PUBLIC_ERROR_MESSAGES) as [PublicErrorCode, ...PublicErrorCode[]],
);

export const publicErrorSchema = z.strictObject({
  code: publicErrorCodeSchema,
  message: z.string(),
  reason: publicErrorReasonSchema.optional(),
  currentEntityVersion: z.number().int().nonnegative().optional(),
}).superRefine((error, context) => {
  if (error.message !== PUBLIC_ERROR_MESSAGES[error.code]) {
    context.addIssue({ code: 'custom', message: 'Public error message does not match its code.' });
  }
  if (error.code === 'VERSION_CONFLICT' && error.currentEntityVersion === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['currentEntityVersion'],
      message: 'Version conflicts must include the current entity version.',
    });
  }
  if (error.code !== 'VERSION_CONFLICT' && error.currentEntityVersion !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['currentEntityVersion'],
      message: 'Only version conflicts may include the current entity version.',
    });
  }
});

export type PublicError = z.infer<typeof publicErrorSchema>;

export function createPublicError(
  code: PublicErrorCode,
  reason?: PublicErrorReason,
  currentEntityVersion?: number,
): PublicError {
  return publicErrorSchema.parse({
    code,
    message: PUBLIC_ERROR_MESSAGES[code],
    ...(reason === undefined ? {} : { reason }),
    ...(currentEntityVersion === undefined ? {} : { currentEntityVersion }),
  });
}

export function publicReasonFromError(error: unknown): PublicErrorReason | undefined {
  const visited = new Set<unknown>();
  let current = error;
  while (typeof current === 'object' && current !== null && !visited.has(current)) {
    visited.add(current);
    if ('reason' in current) {
      const parsedReason = publicErrorReasonSchema.safeParse(current.reason);
      if (parsedReason.success) return parsedReason.data;
    }
    if ('code' in current && typeof current.code === 'string') {
      const reasonByCode: Partial<Record<string, PublicErrorReason>> = {
        EACCES: 'PERMISSION_DENIED',
        // Windows EPERM is overwhelmingly a lock / delete-pending state
        // (Explorer holding a folder, Defender scan) rather than an ACL
        // denial, which surfaces as EACCES; FILE_BUSY gives the actionable
        // guidance instead of a misleading permission message.
        EPERM: process.platform === 'win32' ? 'FILE_BUSY' : 'PERMISSION_DENIED',
        ENOTEMPTY: process.platform === 'win32' ? 'FILE_BUSY' : 'IO_ERROR',
        ENAMETOOLONG: 'PATH_LIMIT_EXCEEDED', ENOSPC: 'DISK_FULL', EDQUOT: 'DISK_FULL',
        EROFS: 'READ_ONLY_FILESYSTEM', ENOENT: 'SOURCE_NOT_FOUND', ENOTDIR: 'SOURCE_NOT_FOUND',
        EINVAL: 'NAME_NOT_SUPPORTED', EIO: 'IO_ERROR', EBUSY: 'FILE_BUSY', EMFILE: 'IO_ERROR',
      };
      const reason = reasonByCode[current.code];
      if (reason) return reason;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

function walkErrorCodes(error: unknown): Array<{ code: string; message?: string }> {
  const visited = new Set<unknown>();
  const collected: Array<{ code: string; message?: string }> = [];
  let current = error;
  while (typeof current === 'object' && current !== null && !visited.has(current)) {
    visited.add(current);
    const code = 'code' in current && typeof current.code === 'string' ? current.code : undefined;
    const message = current instanceof Error ? current.message : undefined;
    if (code || message) collected.push({ ...(code ? { code } : { code: '' }), ...(message ? { message } : {}) });
    current = 'cause' in current ? current.cause : undefined;
  }
  return collected;
}

/**
 * Maps SQLite / disk failures to a renderer-safe public code without copying
 * Error.message (which may contain filesystem paths).
 */
export function isSqliteEngineUnavailableError(error: unknown): boolean {
  for (const { code, message } of walkErrorCodes(error)) {
    if (code === 'ERR_DLOPEN_FAILED') return true;
    if (code === 'MODULE_NOT_FOUND' && message !== undefined && /better-sqlite3/i.test(message)) {
      return true;
    }
    if (message !== undefined && /no such module:\s*fts5/i.test(message)) return true;
    if (
      message !== undefined
      && /specified module could not be found/i.test(message)
      && /better_sqlite3\.node/i.test(message)
    ) {
      return true;
    }
  }
  return false;
}

export function classifyUnknownFailure(
  error: unknown,
): { code: PublicErrorCode; reason?: PublicErrorReason } | undefined {
  if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'DriverUnsupportedError') {
    return { code: 'SYNC_CONNECTION_FAILED', reason: 'SYNC_METHOD_NOT_ALLOWED' };
  }
  if (isSqliteEngineUnavailableError(error)) {
    return { code: 'LIBRARY_ENGINE_UNAVAILABLE' };
  }

  for (const { code, message } of walkErrorCodes(error)) {
    if (code === 'ENOSPC' || code === 'EDQUOT' || code === 'SQLITE_FULL') {
      return { code: 'DISK_FULL' };
    }
    if (code === 'SQLITE_READONLY' || code === 'SQLITE_READONLY_CANTINIT') {
      return { code: 'LIBRARY_READ_ONLY' };
    }
    if (
      code === 'SQLITE_BUSY'
      || code.startsWith('SQLITE_BUSY_')
      || code === 'SQLITE_LOCKED'
      || code.startsWith('SQLITE_LOCKED_')
      || (code === 'SQLITE_ERROR' && message !== undefined && /database is locked/i.test(message))
    ) {
      return { code: 'LIBRARY_BUSY' };
    }
    if (code.startsWith('SQLITE_IOERR')) {
      return { code: 'LIBRARY_IO_ERROR', reason: 'IO_ERROR' };
    }
    if (code === 'SQLITE_CORRUPT' || code.startsWith('SQLITE_CORRUPT_') || code === 'SQLITE_NOTADB') {
      return { code: 'LIBRARY_CORRUPT' };
    }
    if (code === 'SQLITE_CANTOPEN' || code.startsWith('SQLITE_CANTOPEN_')) {
      return { code: 'LIBRARY_NOT_WRITABLE', reason: 'IO_ERROR' };
    }
  }
  return undefined;
}

/**
 * Converts an untrusted internal failure into the stable renderer-safe shape.
 * Inspects only errno / SQLite codes (and DriverUnsupportedError.name). Never
 * copies Error.message into the public payload.
 */
export function toPublicError(error: unknown): PublicError {
  const classified = classifyUnknownFailure(error);
  if (classified) return createPublicError(classified.code, classified.reason);
  return createPublicError('INTERNAL_ERROR', publicReasonFromError(error));
}
