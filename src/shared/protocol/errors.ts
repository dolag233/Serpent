import { z } from 'zod';

export const PUBLIC_ERROR_MESSAGES = {
  CANCELLED: 'The request was cancelled.',
  INTERNAL_ERROR: 'Serpent could not complete the request.',
  INVALID_LIBRARY_NAME: 'Choose a library name that is safe on macOS and Windows.',
  INVALID_LIBRARY_PATH: 'Choose a valid local folder for the library.',
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

export const publicErrorSchema = z.discriminatedUnion('code', [
  z.strictObject({
    code: z.literal('CANCELLED'),
    message: z.literal(PUBLIC_ERROR_MESSAGES.CANCELLED),
  }),
  z.strictObject({
    code: z.literal('INTERNAL_ERROR'),
    message: z.literal(PUBLIC_ERROR_MESSAGES.INTERNAL_ERROR),
  }),
  z.strictObject({
    code: z.literal('INVALID_LIBRARY_NAME'),
    message: z.literal(PUBLIC_ERROR_MESSAGES.INVALID_LIBRARY_NAME),
  }),
  z.strictObject({
    code: z.literal('INVALID_LIBRARY_PATH'),
    message: z.literal(PUBLIC_ERROR_MESSAGES.INVALID_LIBRARY_PATH),
  }),
  z.strictObject({
    code: z.literal('LIBRARY_ALREADY_EXISTS'),
    message: z.literal(PUBLIC_ERROR_MESSAGES.LIBRARY_ALREADY_EXISTS),
  }),
  z.strictObject({
    code: z.literal('LIBRARY_NOT_FOUND'),
    message: z.literal(PUBLIC_ERROR_MESSAGES.LIBRARY_NOT_FOUND),
  }),
  z.strictObject({
    code: z.literal('NOT_A_LIBRARY'),
    message: z.literal(PUBLIC_ERROR_MESSAGES.NOT_A_LIBRARY),
  }),
  z.strictObject({
    code: z.literal('LIBRARY_CORRUPT'),
    message: z.literal(PUBLIC_ERROR_MESSAGES.LIBRARY_CORRUPT),
  }),
  z.strictObject({
    code: z.literal('LIBRARY_VERSION_TOO_NEW'),
    message: z.literal(PUBLIC_ERROR_MESSAGES.LIBRARY_VERSION_TOO_NEW),
  }),
  z.strictObject({
    code: z.literal('LIBRARY_NOT_WRITABLE'),
    message: z.literal(PUBLIC_ERROR_MESSAGES.LIBRARY_NOT_WRITABLE),
  }),
  z.strictObject({
    code: z.literal('LIBRARY_CLEANUP_FAILED'),
    message: z.literal(PUBLIC_ERROR_MESSAGES.LIBRARY_CLEANUP_FAILED),
  }),
  z.strictObject({
    code: z.literal('LIBRARY_NOT_OPEN'),
    message: z.literal(PUBLIC_ERROR_MESSAGES.LIBRARY_NOT_OPEN),
  }),
]);

export type PublicError = z.infer<typeof publicErrorSchema>;

export function createPublicError(code: PublicErrorCode): PublicError {
  return publicErrorSchema.parse({ code, message: PUBLIC_ERROR_MESSAGES[code] });
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
