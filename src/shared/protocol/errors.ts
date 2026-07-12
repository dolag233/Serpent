import { z } from 'zod';

export const PUBLIC_ERROR_MESSAGES = {
  CANCELLED: 'The request was cancelled.',
  INTERNAL_ERROR: 'Serpent could not complete the request.',
  INVALID_LIBRARY_NAME: 'Choose a library name that is safe on macOS and Windows.',
  INVALID_LIBRARY_PATH: 'Choose a valid local folder for the library.',
  INVALID_FOLDER_NAME: 'Choose a folder name that is safe on macOS and Windows.',
  FOLDER_ALREADY_EXISTS: 'A folder with this name already exists in the selected location.',
  FOLDER_NOT_FOUND: 'The selected library folder could not be found.',
  INVALID_IMPORT_SOURCE: 'Choose readable local files or a folder without symbolic links.',
  INVALID_IMPORT_DECISION: 'Choose a valid import conflict decision.',
  IMPORT_NOT_FOUND: 'The pending import no longer exists.',
  IMPORT_APPLY_FAILED: 'Serpent could not apply the import safely.',
  LIBRARY_ALREADY_EXISTS: 'A file or folder with this library name already exists.',
  LIBRARY_NOT_FOUND: 'The selected library folder could not be found.',
  NOT_A_LIBRARY: 'The selected folder is not a Serpent library.',
  LIBRARY_CORRUPT: 'The library database or migration history is damaged.',
  LIBRARY_VERSION_TOO_NEW: 'This library was created by a newer version of Serpent.',
  LIBRARY_NOT_WRITABLE: 'Serpent cannot write to the selected location.',
  LIBRARY_CLEANUP_FAILED: 'Library creation failed and temporary files could not be removed.',
  LIBRARY_NOT_OPEN: 'The library is not currently open.',
} as const;

export type PublicErrorCode = keyof typeof PUBLIC_ERROR_MESSAGES;

export const publicErrorReasonSchema = z.enum([
  'PERMISSION_DENIED',
  'PATH_LIMIT_EXCEEDED',
  'DISK_FULL',
  'READ_ONLY_FILESYSTEM',
  'SOURCE_NOT_FOUND',
  'SOURCE_CHANGED',
  'SYMBOLIC_LINK_NOT_ALLOWED',
  'UNSUPPORTED_FILE_ENTRY',
  'NAME_NOT_SUPPORTED',
  'IO_ERROR',
]);

export type PublicErrorReason = z.infer<typeof publicErrorReasonSchema>;

const publicErrorCodeSchema = z.enum(
  Object.keys(PUBLIC_ERROR_MESSAGES) as [PublicErrorCode, ...PublicErrorCode[]],
);

export const publicErrorSchema = z.strictObject({
  code: publicErrorCodeSchema,
  message: z.string(),
  reason: publicErrorReasonSchema.optional(),
}).superRefine((error, context) => {
  if (error.message !== PUBLIC_ERROR_MESSAGES[error.code]) {
    context.addIssue({ code: 'custom', message: 'Public error message does not match its code.' });
  }
});

export type PublicError = z.infer<typeof publicErrorSchema>;

export function createPublicError(
  code: PublicErrorCode,
  reason?: PublicErrorReason,
): PublicError {
  return publicErrorSchema.parse({ code, message: PUBLIC_ERROR_MESSAGES[code], reason });
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
        EACCES: 'PERMISSION_DENIED', EPERM: 'PERMISSION_DENIED',
        ENAMETOOLONG: 'PATH_LIMIT_EXCEEDED', ENOSPC: 'DISK_FULL', EDQUOT: 'DISK_FULL',
        EROFS: 'READ_ONLY_FILESYSTEM', ENOENT: 'SOURCE_NOT_FOUND', ENOTDIR: 'SOURCE_NOT_FOUND',
        EINVAL: 'NAME_NOT_SUPPORTED', EIO: 'IO_ERROR', EBUSY: 'IO_ERROR', EMFILE: 'IO_ERROR',
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
