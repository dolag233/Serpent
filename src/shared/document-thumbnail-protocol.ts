/**
 * Offscreen document-thumbnail render protocol (Serpent-8ca259).
 *
 * Same role split as the model-thumbnail protocol: the Library Worker owns the
 * queue and artifact storage but has no browser engine; Main owns an offscreen
 * BrowserWindow that loads the HTML source and captures a screenshot.
 *
 *   Worker ──postMessage──▶ { type: 'document-thumbnail.render-request', ... }
 *   Main   ──postMessage──▶ { type: 'document-thumbnail.render-response', ... }
 *
 * The request carries the HTML URL (serpent://source) and the viewport size.
 * PNG bytes return to the Worker, which alone persists the artifact row.
 *
 * Security: the offscreen window loads the HTML like a browser opening a local
 * file (sandboxed renderer, no preload, no Node integration). Page JS executes,
 * but only inside the sandbox; Main does not grant any extra capability.
 */

import { z } from 'zod';

/** Fixed capture width; height derived from the page after layout. */
export const DOCUMENT_THUMBNAIL_WIDTH = 1024;
/** generator_version tag for document thumbnail artifacts. */
export const DOCUMENT_THUMBNAIL_GENERATOR_VERSION = 'offscreen-web-1';
/** Typed render failure codes (benign suppression in thumbnail-support.ts). */
export const documentThumbnailErrorCodeSchema = z.enum([
  'DOCUMENT_LOAD_FAILED', // page failed to load (404, malformed file, …)
  'DOCUMENT_BLANK_FRAME', // captured frame is empty
  'DOCUMENT_FRAME_INVALID', // frame bytes failed validation
  'DOCUMENT_WINDOW_FAILED', // offscreen window creation/load/crash
  'DOCUMENT_RENDER_ABORTED', // renderer disposed or window torn down
]);
export type DocumentThumbnailErrorCode = z.infer<typeof documentThumbnailErrorCodeSchema>;

export const documentThumbnailRenderRequestSchema = z.strictObject({
  type: z.literal('document-thumbnail.render-request'),
  requestId: z.string().min(1),
  /** serpent://source URL for the HTML asset. */
  url: z.string().min(1),
  /** Capture viewport width (px). */
  width: z.number().int().positive(),
});

export type DocumentThumbnailRenderRequest = z.infer<typeof documentThumbnailRenderRequestSchema>;

export function parseDocumentThumbnailRenderRequest(
  input: unknown,
): DocumentThumbnailRenderRequest {
  return documentThumbnailRenderRequestSchema.parse(input);
}

export const documentThumbnailRenderResponseSchema = z.strictObject({
  type: z.literal('document-thumbnail.render-response'),
  requestId: z.string().min(1),
  result: z.discriminatedUnion('status', [
    z.strictObject({
      status: z.literal('ok'),
      /** PNG bytes (base64 in transit via structured clone is avoided; bytes). */
      png: z.instanceof(Uint8Array),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    z.strictObject({
      status: z.literal('failed'),
      errorCode: documentThumbnailErrorCodeSchema,
      reason: z.string().optional(),
    }),
  ]),
});

export type DocumentThumbnailRenderResponse = z.infer<typeof documentThumbnailRenderResponseSchema>;

export function parseDocumentThumbnailRenderResponse(
  input: unknown,
): DocumentThumbnailRenderResponse {
  return documentThumbnailRenderResponseSchema.parse(input);
}
