import { z } from 'zod';

export const PUBLIC_ERROR_MESSAGES = {
  CANCELLED: 'The request was cancelled.',
  INTERNAL_ERROR: 'Serpent could not complete the request.',
  INVALID_LIBRARY_NAME: 'Choose a library name that is safe on macOS and Windows.',
  INVALID_LIBRARY_PATH: 'Choose a valid local folder for the library.',
  INVALID_FOLDER_NAME: 'Choose a folder name that is safe on macOS and Windows.',
  FOLDER_ALREADY_EXISTS: 'A folder with this name already exists in the selected location.',
  FOLDER_NAME_CONFLICT: 'A folder or file with this name already exists in the selected location.',
  FOLDER_NOT_EMPTY: 'Only folders with no assets, child folders, or unmanaged files can be deleted by this operation.',
  FOLDER_NOT_FOUND: 'The selected library folder could not be found.',
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
  IMPORT_APPLY_FAILED: 'Serpent could not apply the import safely.',
  LIBRARY_ALREADY_EXISTS: 'A file or folder with this library name already exists.',
  LIBRARY_NOT_FOUND: 'The selected library folder could not be found.',
  NOT_A_LIBRARY: 'The selected folder is not a Serpent library.',
  LIBRARY_CORRUPT: 'The library database or migration history is damaged.',
  LIBRARY_VERSION_TOO_NEW: 'This library was created by a newer version of Serpent.',
  LIBRARY_READ_ONLY:
    'Serpent cannot write to this library. Check that the files are not locked or marked read-only.',
  LIBRARY_MIGRATION_FAILED:
    'The library migration failed and was rolled back. Serpent will retry it automatically when you open the library again.',
  LIBRARY_MIGRATION_STUCK:
    'This library could not be migrated after repeated attempts. Serpent opened it at the last working schema so you can keep using it.',
  LIBRARY_STRUCTURE_MISMATCH:
    'This library has an incompatible structure for this operation. Upgrade Serpent to the latest version.',
  LIBRARY_NOT_WRITABLE: 'Serpent cannot write to the selected location.',
  LIBRARY_BUSY: 'This library is being updated by another Serpent session. Try again in a moment.',
  LIBRARY_CLEANUP_FAILED: 'Library creation failed and temporary files could not be removed.',
  LIBRARY_NOT_OPEN: 'The library is not currently open.',
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
  SYNC_CONNECTION_FAILED: 'Serpent could not connect to the sync server.',
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
  'IMPORT_COPY_FAILED',
  'IMPORT_REGISTER_FAILED',
  'EAGLE_THUMBNAIL_FAILED',
  'SYNC_AUTH_FAILED',
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

/**
 * Converts an untrusted internal failure into the stable renderer-safe shape.
 * Deliberately do not inspect or serialize the input: Error messages can contain
 * filesystem paths, database details, credentials, or other diagnostics.
 */
export function toPublicError(_error: unknown): PublicError {
  void _error;
  return createPublicError('INTERNAL_ERROR');
}
